import * as cheerio from "cheerio";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AuditObservation } from "@/lib/intel/website-classify";
import { normalizeEmail } from "@/lib/normalize/text";
import { phoneFromWhatsappLink } from "@/lib/normalize/phone";
import { normalizeUrl, parseSocialUrl, type SocialProfile } from "@/lib/normalize/url";

/**
 * Built-in website auditor. Fetches ONLY the public homepage (plus robots.txt),
 * respects robots.txt, never submits forms or logs in, and blocks requests to
 * private/internal network addresses (SSRF protection), re-checking every
 * redirect hop.
 */

export interface SiteExtraction {
  whatsappNumbers: string[]; // E.164-ish (+digits) from wa.me / api.whatsapp.com links
  phones: string[];          // from tel: links and JSON-LD
  emails: string[];
  socials: SocialProfile[];
  hasMenuLink: boolean;
  hasEcommerce: boolean;
}

export interface WebsiteAuditResult {
  observation: AuditObservation;
  extraction: SiteExtraction;
  robotsBlocked: boolean;
}

const MAX_BYTES = 2_500_000;
const TIMEOUT_MS = 15_000;
const UA = () => process.env.AUDIT_USER_AGENT || "AinAltairSiteAudit/1.0 (+https://www.ainaltair.com)";

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("::ffff:127.") || v6.startsWith("::ffff:10.") || v6.startsWith("::ffff:192.168.") || v6.startsWith("::ffff:169.254.");
}

async function assertPublicHost(url: URL): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`Blocked protocol ${url.protocol}`);
  if (url.port && !["80", "443", ""].includes(url.port)) throw new Error(`Blocked port ${url.port}`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new Error("Blocked internal hostname");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("Blocked private network address");
}

async function safeFetch(url: string, maxRedirects = 5): Promise<{ res: Response; finalUrl: string; redirects: number; ms: number }> {
  let current = new URL(url);
  const started = Date.now();
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicHost(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(current, { redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": UA(), Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current);
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      return { res, finalUrl: current.toString(), redirects: i, ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------
export function robotsAllows(robotsTxt: string, path: string, agent = "ainaltairsiteaudit"): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (cur && (key === "allow" || key === "disallow")) {
      lastWasAgent = false;
      if (val || key === "allow") cur.rules.push({ allow: key === "allow", path: val });
    } else lastWasAgent = false;
  }
  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const group = specific ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: { allow: boolean; path: string } | null = null;
  for (const r of group.rules) {
    if (r.path && path.startsWith(r.path.replace(/\*.*$/, "")) && (!best || r.path.length > best.path.length)) best = r;
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------
// HTML analysis
// ---------------------------------------------------------------------------
const CTA_RE = /\b(book( now| online| an appointment)?|get (a )?(free )?quote|request (a )?quote|call (us )?now|contact us|order (now|online)|whatsapp us|enquire|inquire|get started|reserve|schedule)\b/i;
const BOOKING_RE = /\b(book (now|online|an appointment|a table)|online booking|reservations?|appointment)\b/i;
const BOOKING_HOSTS = /(calendly\.com|fresha\.com|booksy\.com|setmore\.com|simplybook|acuityscheduling|square\.site|opentable|sevenrooms|eat\.app|vagaro|mindbodyonline|zenoti|timely|squareup\.com\/appointments)/i;
const PARKED_RE = /(this domain (is|may be) for sale|buy this domain|domain parking|parked free|sedoparking|hugedomains|godaddy\.com\/forsale|domain has expired)/i;
const CONSTRUCTION_RE = /\b(under construction|coming soon|site is being built|launching soon|website coming)\b/i;
const MENU_RE = /\b(menu|our menu|food menu|order online)\b/i;
const ECOM_RE = /(add to cart|add-to-cart|woocommerce|shopify|cart\.js|\/cart\b|checkout)/i;

export function analyseHtml(html: string, baseUrl: string, now = new Date()): Omit<AuditObservation, "requestedUrl" | "reachable"> & { extraction: SiteExtraction } {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").slice(0, 200_000);
  const base = new URL(baseUrl);

  const links = $("a[href]").map((_, a) => ($(a).attr("href") ?? "").trim()).get();
  const linkTexts = $("a, button, input[type=submit]").map((_, el) => `${$(el).text()} ${$(el).attr("value") ?? ""} ${$(el).attr("aria-label") ?? ""}`.trim()).get();

  const whatsapp = new Set<string>();
  const phones = new Set<string>();
  const emails = new Set<string>();
  const socials = new Map<string, SocialProfile>();
  let internal = 0;
  let hasBookingLink = false;
  let hasMenuLink = false;

  for (const href of links) {
    if (/^tel:/i.test(href)) { phones.add(href.replace(/^tel:/i, "").trim()); continue; }
    if (/^mailto:/i.test(href)) { const e = normalizeEmail(href); if (e) emails.add(e); continue; }
    let abs: URL | null = null;
    try { abs = new URL(href, base); } catch { continue; }
    const wa = phoneFromWhatsappLink(abs.toString());
    if (wa) { whatsapp.add(wa); continue; }
    const social = parseSocialUrl(abs.toString());
    if (social) { socials.set(social.url, social); continue; }
    if (BOOKING_HOSTS.test(abs.hostname + abs.pathname)) hasBookingLink = true;
    if (abs.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")) {
      internal++;
      if (/menu/i.test(abs.pathname)) hasMenuLink = true;
    }
  }
  // Emails in visible text (only well-formed, non-asset)
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g)) {
    const e = normalizeEmail(m[0]);
    if (e) emails.add(e);
  }

  // JSON-LD structured data (telephone, email, sameAs)
  let hasStructured = false;
  $('script[type="application/ld+json"]').each((_, s) => {
    hasStructured = true;
    try {
      const data = JSON.parse($(s).contents().text());
      const nodes: unknown[] = Array.isArray(data) ? data : (data["@graph"] as unknown[]) ?? [data];
      for (const n of nodes as Record<string, unknown>[]) {
        if (typeof n?.telephone === "string") phones.add(n.telephone);
        if (typeof n?.email === "string") { const e = normalizeEmail(n.email); if (e) emails.add(e); }
        const same = Array.isArray(n?.sameAs) ? (n.sameAs as string[]) : typeof n?.sameAs === "string" ? [n.sameAs as string] : [];
        for (const u of same) { const sp = parseSocialUrl(u); if (sp) socials.set(sp.url, sp); }
      }
    } catch { /* malformed JSON-LD is common; ignore */ }
  });

  // WhatsApp widgets that embed the number in data attributes / inline scripts
  const waInline = html.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\d{8,15})/g) ?? [];
  for (const m of waInline) { const d = m.replace(/\D/g, ""); if (d.length >= 8) whatsapp.add(`+${d}`); }

  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1])).filter((y) => y >= 1995 && y <= now.getUTCFullYear() + 1);
  const copyrightYear = years.length ? Math.max(...years) : null;

  const generator = $('meta[name="generator"]').attr("content") ?? null;
  const tech = new Set<string>();
  if (/wp-content|wp-includes/i.test(html)) tech.add("WordPress");
  if (/static\.wixstatic\.com|wix\.com/i.test(html)) tech.add("Wix");
  if (/cdn\.shopify\.com/i.test(html)) tech.add("Shopify");
  if (/squarespace/i.test(html)) tech.add("Squarespace");
  if (/webflow/i.test(html)) tech.add("Webflow");
  if (/__NEXT_DATA__|\/_next\//.test(html)) tech.add("Next.js");
  if (/bootstrap(\.min)?\.(css|js)/i.test(html)) tech.add("Bootstrap");
  const jq = html.match(/jquery[.-]?(\d)\.(\d+)(?:\.\d+)?(?:\.min)?\.js/i);
  if (jq) tech.add(`jQuery ${jq[1]}.${jq[2]}`);

  const legacy: string[] = [];
  if ($("font, center, marquee, blink").length) legacy.push("legacy HTML tags (<font>/<center>/<marquee>)");
  if ($('object[type*="flash"], embed[src$=".swf"], object param[value$=".swf"]').length || /\.swf["']/i.test(html)) legacy.push("Flash content");
  if (jq && Number(jq[1]) === 1 && Number(jq[2]) < 9) legacy.push(`jQuery ${jq[1]}.${jq[2]} (2012 or earlier)`);
  if ($("table[width], td[bgcolor], body[bgcolor]").length >= 3) legacy.push("table-based layout");
  const wpVer = generator?.match(/WordPress\s+(\d+)\./i);
  if (wpVer && Number(wpVer[1]) < 5) legacy.push(`WordPress ${wpVer[1]}.x`);
  if (/Joomla!?\s*(1|2)\./i.test(generator ?? "")) legacy.push(generator!);

  const navLinks = $("nav a, header a, [role=navigation] a").length;
  const images = $("img");
  const missingAlt = images.filter((_, i) => !($(i).attr("alt") ?? "").trim()).length;
  const lowerLinks = links.join(" ").toLowerCase();
  const allLinkText = linkTexts.join(" | ");

  return {
    hasViewport: $('meta[name="viewport"]').length > 0,
    title: $("title").first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr("content")?.trim() || null,
    h1Count: $("h1").length,
    hasCta: CTA_RE.test(allLinkText) || whatsapp.size > 0 || phones.size > 0,
    hasWhatsapp: whatsapp.size > 0 || /whatsapp/i.test(lowerLinks),
    hasPhoneLink: phones.size > 0,
    hasEmail: emails.size > 0,
    hasForm: $("form").filter((_, f) => $(f).find("input, textarea").length >= 2 && !/search/i.test($(f).attr("role") ?? $(f).attr("class") ?? "")).length > 0,
    hasBooking: hasBookingLink || BOOKING_RE.test(allLinkText),
    hasServices: /servic|what we do|treatments|our work|solutions|packages|pricing/i.test(lowerLinks + " " + allLinkText),
    hasAbout: /about|who we are|our story/i.test(lowerLinks + " " + allLinkText),
    hasContact: /contact/i.test(lowerLinks + " " + allLinkText) || phones.size > 0 || emails.size > 0,
    hasLocationPages: /locations?|branches|areas we serve|service areas/i.test(lowerLinks + " " + allLinkText),
    hasStructuredData: hasStructured,
    navLinkCount: navLinks,
    internalLinkCount: internal,
    imageCount: images.length,
    imagesMissingAlt: missingAlt,
    copyrightYear,
    generator,
    technologies: [...tech],
    legacySignals: legacy,
    parked: PARKED_RE.test(text) || PARKED_RE.test(html.slice(0, 20_000)),
    underConstruction: CONSTRUCTION_RE.test(text.slice(0, 5000)) && text.length < 4000,
    pageBytes: Buffer.byteLength(html),
    extraction: {
      whatsappNumbers: [...whatsapp],
      phones: [...phones],
      emails: [...emails].slice(0, 10),
      socials: [...socials.values()],
      hasMenuLink: hasMenuLink || MENU_RE.test(allLinkText),
      hasEcommerce: ECOM_RE.test(html),
    },
  };
}

export async function auditWebsite(rawUrl: string, now = new Date()): Promise<WebsiteAuditResult> {
  const requestedUrl = normalizeUrl(rawUrl) ?? rawUrl;
  const emptyExtraction: SiteExtraction = { whatsappNumbers: [], phones: [], emails: [], socials: [], hasMenuLink: false, hasEcommerce: false };
  const auditedAt = now.toISOString();
  let url: URL;
  try {
    url = new URL(requestedUrl);
  } catch {
    return { observation: { requestedUrl, reachable: false, error: "Invalid URL", auditedAt }, extraction: emptyExtraction, robotsBlocked: false };
  }

  // robots.txt (best effort; missing robots = allowed)
  try {
    const { res } = await safeFetch(`${url.protocol}//${url.host}/robots.txt`, 3);
    if (res.ok) {
      const txt = (await readCapped(res)).slice(0, 200_000);
      if (!robotsAllows(txt, url.pathname || "/")) {
        return { observation: { requestedUrl, reachable: true, error: "Audit skipped: robots.txt disallows automated access", auditedAt }, extraction: emptyExtraction, robotsBlocked: true };
      }
    } else await res.body?.cancel().catch(() => undefined);
  } catch { /* ignore robots failures */ }

  let https = url.protocol === "https:";
  let sslValid: boolean | null = https ? true : null;
  let fetched: Awaited<ReturnType<typeof safeFetch>> | null = null;
  let error: string | null = null;
  try {
    fetched = await safeFetch(url.toString());
  } catch (e) {
    const msg = (e as Error & { cause?: { code?: string } }).cause?.code ?? (e as Error).message;
    error = msg;
    if (/CERT|SSL|TLS|self.signed|UNABLE_TO_VERIFY/i.test(msg)) {
      sslValid = false;
      // Retry over plain HTTP to see if the site itself works.
      try {
        url.protocol = "http:";
        fetched = await safeFetch(url.toString());
        https = false;
        error = null;
      } catch (e2) {
        error = (e2 as Error).message;
      }
    }
  }
  if (!fetched) {
    return { observation: { requestedUrl, reachable: false, error, https, sslValid, auditedAt }, extraction: emptyExtraction, robotsBlocked: false };
  }

  const { res, finalUrl, redirects, ms } = fetched;
  const finalHttps = finalUrl.startsWith("https:");
  const contentType = res.headers.get("content-type") ?? "";
  const html = /html|xml|text/i.test(contentType) || !contentType ? await readCapped(res) : "";
  const base: AuditObservation = {
    requestedUrl, finalUrl, reachable: true, httpStatus: res.status, https: finalHttps, sslValid: finalHttps ? sslValid ?? true : sslValid,
    responseMs: ms, error: null, auditedAt,
  };
  if (res.status >= 400 || !html) {
    return { observation: { ...base, pageBytes: html.length }, extraction: emptyExtraction, robotsBlocked: false };
  }
  const analysed = analyseHtml(html, finalUrl, now);
  const { extraction, ...obs } = analysed;
  void redirects;
  return { observation: { ...base, ...obs }, extraction, robotsBlocked: false };
}
