import { NotConfiguredError, providerFetch } from "./http";
import type { LeadProvider, ProviderRuntime, WebPresence } from "./types";
import { domainOf, isOwnedWebsite, parseSocialUrl } from "@/lib/normalize/url";
import { nameSimilarity } from "@/lib/dedup/similarity";
import { normalizeBusinessName, nameTokens } from "@/lib/normalize/text";

/**
 * Brave Search API — finds a business's website and public social profiles
 * when listings omit them. Matches are accepted only when the result clearly
 * refers to the same business name; confidence is never HIGH from search alone.
 */
const KEY = "brave_search";

interface BraveResult { url: string; title?: string; description?: string; profile?: { name?: string } }

async function search(q: string, country: string | null | undefined, rt: ProviderRuntime): Promise<BraveResult[]> {
  const k = process.env.BRAVE_SEARCH_API_KEY;
  if (!k) throw new NotConfiguredError(KEY, ["BRAVE_SEARCH_API_KEY"]);
  const params = new URLSearchParams({ q, count: "10", safesearch: "moderate" });
  if (country && /^[a-z]{2}$/i.test(country)) params.set("country", country.toUpperCase());
  const res = await providerFetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    provider: KEY,
    headers: { Accept: "application/json", "X-Subscription-Token": k },
    rateLimitPerMinute: rt.rateLimitPerMinute,
  });
  const json = (await res.json()) as { web?: { results?: BraveResult[] } };
  return json.web?.results ?? [];
}

/** Does a domain plausibly belong to this business name? (e.g. alnoorcleaning.ae ↔ "Al Noor Cleaning") */
export function domainMatchesName(domain: string, name: string): boolean {
  const label = domain.split(".")[0].replace(/[^a-z0-9]/g, "");
  const tokens = nameTokens(normalizeBusinessName(name)).filter((t) => t.length >= 3);
  if (!tokens.length || label.length < 4) return false;
  const condensed = tokens.join("");
  if (condensed.includes(label) || label.includes(condensed)) return true;
  const hits = tokens.filter((t) => label.includes(t)).length;
  return hits >= Math.min(2, tokens.length);
}

export async function findWebPresence(b: { name: string; city?: string | null; country?: string | null }, rt: ProviderRuntime): Promise<WebPresence> {
  const q = `"${b.name}"${b.city ? ` ${b.city}` : ""}`;
  const results = await search(q, b.country, rt);
  const presence: WebPresence = { website: null, socials: [], checked: [`Brave web search: ${q}`] };
  for (const r of results) {
    const social = parseSocialUrl(r.url);
    const titleSim = nameSimilarity(b.name, (r.title ?? "").split(/[|\-–•(@]/)[0]);
    if (social) {
      const handleSim = social.username ? nameSimilarity(b.name, social.username.replace(/[._]/g, " ")) : 0;
      const sim = Math.max(titleSim, handleSim);
      if (sim >= 0.8 && !presence.socials.some((s) => s.url === social.url)) {
        presence.socials.push({ ...social, confidence: sim >= 0.92 ? "MEDIUM" : "LOW", evidence: `Search result "${r.title ?? r.url}" (name match ${Math.round(sim * 100)}%)` });
      }
      continue;
    }
    if (!presence.website && isOwnedWebsite(r.url)) {
      const d = domainOf(r.url)!;
      const domainOk = domainMatchesName(d, b.name);
      if (domainOk || titleSim >= 0.9) {
        presence.website = {
          url: `https://${new URL(r.url).hostname}`,
          confidence: domainOk && titleSim >= 0.8 ? "MEDIUM" : "LOW",
          evidence: `Search result "${r.title ?? d}" — ${domainOk ? "domain matches business name" : "title matches business name"}`,
        };
      }
    }
  }
  return presence;
}

export const braveSearchProvider: LeadProvider = {
  key: KEY,
  async getWebsite(b, rt) {
    return (await findWebPresence(b, rt)).website ?? null;
  },
  async getSocialProfiles(b, rt) {
    return (await findWebPresence(b, rt)).socials;
  },
};
