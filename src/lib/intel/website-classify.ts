import type { Evidence, WebsiteIssue, WebsiteStatus } from "./types";

/**
 * Turns an observed website audit into an opportunity classification with
 * evidence. Rules are conservative:
 *  - "SLOW" and poor-performance claims require measured Lighthouse data.
 *  - Missing information is never treated as a negative signal.
 */

export interface AuditObservation {
  requestedUrl: string;
  finalUrl?: string | null;
  reachable: boolean;
  httpStatus?: number | null;
  error?: string | null;
  https?: boolean | null;
  sslValid?: boolean | null;
  responseMs?: number | null;
  pageBytes?: number | null;
  hasViewport?: boolean | null;
  title?: string | null;
  metaDescription?: string | null;
  h1Count?: number | null;
  hasCta?: boolean | null;
  hasWhatsapp?: boolean | null;
  hasPhoneLink?: boolean | null;
  hasEmail?: boolean | null;
  hasForm?: boolean | null;
  hasBooking?: boolean | null;
  hasServices?: boolean | null;
  hasAbout?: boolean | null;
  hasContact?: boolean | null;
  hasLocationPages?: boolean | null;
  hasStructuredData?: boolean | null;
  navLinkCount?: number | null;
  internalLinkCount?: number | null;
  imageCount?: number | null;
  imagesMissingAlt?: number | null;
  copyrightYear?: number | null;
  generator?: string | null;
  technologies?: string[];
  legacySignals?: string[];   // e.g. "<font> tags", "Flash object", "jQuery 1.8"
  parked?: boolean;
  underConstruction?: boolean;
  // measured (PageSpeed / Lighthouse, mobile strategy)
  perfMeasured?: boolean;
  performanceScore?: number | null;
  seoScore?: number | null;
  accessibilityScore?: number | null;
  lcpMs?: number | null;
  cls?: number | null;
  auditedAt?: string;
}

export interface WebsiteClassification {
  status: WebsiteStatus;
  issues: WebsiteIssue[];
  score: number; // 0–100 website quality (higher = better site, lower = bigger opportunity)
  evidence: Evidence[];
}

// Categories where online booking is a core expectation.
export const BOOKING_CATEGORIES = new Set([
  "salons", "barbers", "pet_grooming", "dental_clinics", "gyms", "cleaning_services", "car_detailing",
  "mobile_car_wash", "pest_control", "ac_maintenance", "home_maintenance", "restaurants", "hotels",
]);

export function classifyNoWebsite(checkedSources: string[], at?: string): WebsiteClassification {
  return {
    status: "NO_WEBSITE",
    issues: [],
    score: 0,
    evidence: [{
      code: "NO_WEBSITE",
      label: "No website detected",
      detail: checkedSources.length
        ? `No owned website found in: ${checkedSources.join(", ")}.`
        : "No website listed by the source.",
      source: checkedSources[0] ?? "listing",
      observedAt: at,
    }],
  };
}

export function classifyWebsite(a: AuditObservation, opts: { categoryKey?: string | null; now?: Date } = {}): WebsiteClassification {
  const now = opts.now ?? new Date();
  const year = now.getUTCFullYear();
  const at = a.auditedAt ?? now.toISOString();
  const evidence: Evidence[] = [];
  const issues = new Set<WebsiteIssue>();
  const ev = (code: string, label: string, detail: string, source = "website_audit", measured = false) =>
    evidence.push({ code, label, detail, source, observedAt: at, measured });

  // ---- Broken / unreachable
  if (!a.reachable || (a.httpStatus != null && a.httpStatus >= 400)) {
    issues.add("UNREACHABLE");
    ev("BROKEN", "Website not working",
      a.httpStatus ? `Homepage returned HTTP ${a.httpStatus} for ${a.requestedUrl}.` : `Homepage could not be loaded (${a.error ?? "no response"}).`,
      "website_audit", true);
    return { status: "BROKEN", issues: [...issues], score: 5, evidence };
  }
  if (a.parked) {
    issues.add("PARKED_DOMAIN");
    ev("BROKEN", "Parked / placeholder domain", "Page content indicates a parked or for-sale domain rather than a business site.");
    return { status: "BROKEN", issues: [...issues], score: 8, evidence };
  }

  let score = 100;
  const penalise = (pts: number) => { score -= pts; };

  if (a.underConstruction) {
    penalise(35);
    ev("UNDER_CONSTRUCTION", "Under construction", "Homepage says the site is under construction / coming soon.");
  }

  // ---- Security
  if (a.https === false || a.sslValid === false) {
    issues.add("NO_SSL");
    penalise(12);
    ev("NO_SSL", "No valid HTTPS", a.sslValid === false ? "TLS certificate failed validation." : "Site is served over plain HTTP.", "website_audit", true);
  }

  // ---- Mobile
  if (a.hasViewport === false) {
    issues.add("NO_VIEWPORT");
    penalise(15);
    ev("NO_VIEWPORT", "Not mobile-ready", "No responsive viewport meta tag found — pages render as desktop layout on phones.");
  }
  if (a.perfMeasured && a.performanceScore != null && a.performanceScore < 50) {
    issues.add("POOR_MOBILE_PERFORMANCE");
    penalise(10);
    ev("MOBILE_PERF", "Poor mobile performance", `Lighthouse mobile performance score ${a.performanceScore}/100.`, "pagespeed", true);
  }

  // ---- Speed (measured only)
  const slowMeasured = !!a.perfMeasured && ((a.performanceScore != null && a.performanceScore < 40) || (a.lcpMs != null && a.lcpMs > 4000));
  if (slowMeasured) {
    issues.add("SLOW_MEASURED");
    penalise(8);
    ev("SLOW", "Slow (measured)",
      `Lighthouse mobile: performance ${a.performanceScore ?? "n/a"}/100${a.lcpMs != null ? `, LCP ${(a.lcpMs / 1000).toFixed(1)}s` : ""}.`, "pagespeed", true);
  }

  // ---- Outdated indicators
  const outdatedSignals: string[] = [];
  if (a.copyrightYear && a.copyrightYear <= year - 3) {
    issues.add("OUTDATED_COPYRIGHT");
    outdatedSignals.push(`copyright ${a.copyrightYear}`);
  }
  if (a.legacySignals?.length) {
    issues.add("LEGACY_TECH");
    outdatedSignals.push(...a.legacySignals);
  }
  if (a.hasViewport === false) outdatedSignals.push("no responsive viewport");
  if (a.https === false) outdatedSignals.push("no HTTPS");
  if (outdatedSignals.length) {
    penalise(Math.min(25, outdatedSignals.length * 7));
    ev("OUTDATED", "Outdated indicators", `Observed: ${outdatedSignals.join("; ")}.`);
  }

  // ---- SEO basics
  const seoProblems: string[] = [];
  if (!a.title || a.title.trim().length < 5) seoProblems.push("missing/short title");
  if (!a.metaDescription) seoProblems.push("no meta description");
  if (a.h1Count === 0) seoProblems.push("no H1 heading");
  if (a.perfMeasured && a.seoScore != null && a.seoScore < 70) seoProblems.push(`Lighthouse SEO ${a.seoScore}/100`);
  if (seoProblems.length >= 2 || (a.perfMeasured && a.seoScore != null && a.seoScore < 70)) {
    issues.add("WEAK_SEO");
    penalise(8);
    ev("WEAK_SEO", "Weak SEO basics", seoProblems.join("; ") + ".");
  }

  // ---- Conversion functionality
  const missing: string[] = [];
  if (a.hasCta === false) { issues.add("MISSING_CTA"); missing.push("no clear call-to-action"); penalise(8); }
  if (a.hasWhatsapp === false) { issues.add("MISSING_WHATSAPP"); missing.push("no WhatsApp contact"); penalise(5); }
  if (a.hasBooking === false && opts.categoryKey && BOOKING_CATEGORIES.has(opts.categoryKey)) {
    issues.add("MISSING_BOOKING"); missing.push("no online booking"); penalise(5);
  }
  if (a.hasServices === false) { issues.add("MISSING_SERVICE_PAGES"); missing.push("no services section"); penalise(5); }
  if (a.hasContact === false && a.hasPhoneLink === false && a.hasEmail === false) { issues.add("MISSING_CONTACT"); missing.push("no contact details"); penalise(8); }
  if (a.hasForm === false) { issues.add("MISSING_FORM"); missing.push("no enquiry form"); penalise(3); }
  if (missing.length) ev("MISSING_FUNCTIONALITY", "Missing conversion features", `Observed: ${missing.join("; ")}.`);

  if (a.imageCount && a.imagesMissingAlt && a.imagesMissingAlt / a.imageCount > 0.6) {
    issues.add("MISSING_ALT_TEXT");
    penalise(2);
  }
  // Very thin page: likely a placeholder/one-pager with little content.
  const thin = (a.pageBytes != null && a.pageBytes < 6000) || (a.navLinkCount != null && a.navLinkCount < 2 && (a.imageCount ?? 0) < 2);
  if (thin) {
    penalise(12);
    ev("THIN_SITE", "Very thin site", "Homepage has almost no navigation or content (possible placeholder or one-page site).");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // ---- Primary status (most severe first)
  let status: WebsiteStatus;
  if (outdatedSignals.length >= 2 || (issues.has("OUTDATED_COPYRIGHT") && issues.has("LEGACY_TECH"))) status = "OUTDATED";
  else if (issues.has("NO_VIEWPORT") || issues.has("POOR_MOBILE_PERFORMANCE")) status = "MOBILE_ISSUE";
  else if (issues.has("SLOW_MEASURED")) status = "SLOW";
  else if (a.underConstruction || thin || score < 50) status = "POOR_DESIGN";
  else if (missing.length >= 2) status = "MISSING_FUNCTIONALITY";
  else if (outdatedSignals.length === 1 && issues.has("OUTDATED_COPYRIGHT")) status = "OUTDATED";
  else if (score >= 90 && a.hasCta !== false && (a.hasWhatsapp || a.hasBooking || a.hasForm) && a.https !== false && (!a.perfMeasured || (a.performanceScore ?? 0) >= 70)) status = "HIGH_QUALITY";
  else if (score >= 75) status = "GOOD";
  else status = "AVERAGE";

  if (status === "GOOD" || status === "HIGH_QUALITY") {
    ev(status, status === "HIGH_QUALITY" ? "High-quality website" : "Good website", `Website quality score ${score}/100 with no major issues observed.`);
  }

  return { status, issues: [...issues], score, evidence };
}

/** Map a classification to the coarse filter vocabulary used by search criteria. */
export function websiteMatchesFilter(status: WebsiteStatus | undefined, issues: WebsiteIssue[] = [], filter: string): boolean | null {
  if (filter === "ANY") return true;
  if (!status || status === "UNKNOWN") return null; // unknown, needs audit/review
  switch (filter) {
    case "NO_WEBSITE": return status === "NO_WEBSITE";
    case "BROKEN": return status === "BROKEN";
    case "OUTDATED": return status === "OUTDATED" || issues.includes("OUTDATED_COPYRIGHT") || issues.includes("LEGACY_TECH");
    case "MOBILE_ISSUE": return status === "MOBILE_ISSUE" || issues.includes("NO_VIEWPORT") || issues.includes("POOR_MOBILE_PERFORMANCE");
    case "SLOW": return status === "SLOW" || issues.includes("SLOW_MEASURED");
    case "POOR": return ["POOR_DESIGN", "MISSING_FUNCTIONALITY", "OUTDATED", "BROKEN", "MOBILE_ISSUE", "AVERAGE"].includes(status);
    case "GOOD": return status === "GOOD" || status === "HIGH_QUALITY";
    default: return null;
  }
}
