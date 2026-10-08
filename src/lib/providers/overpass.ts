import { providerFetch } from "./http";
import type { DiscoveryPage, DiscoveryQuery, LeadProvider, ProviderRuntime, RawBusiness } from "./types";
import { bboxFromRadius } from "@/lib/geo/geo";

/**
 * OpenStreetMap via the Overpass API. Public, no key; operated conservatively
 * (low rate limit, bounded result counts). Data © OpenStreetMap contributors.
 */
const KEY = "osm_overpass";
const endpoint = () => process.env.OVERPASS_API_URL || "https://overpass-api.de/api/interpreter";

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const escRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");

export function buildOverpassQuery(q: DiscoveryQuery, limit: number): string {
  let area: string;
  if (q.location.polygon && q.location.polygon.length >= 3) {
    area = `(poly:"${q.location.polygon.map((p) => `${p.lat.toFixed(6)} ${p.lng.toFixed(6)}`).join(" ")}")`;
  } else {
    const b = q.location.bbox ?? (q.location.center ? bboxFromRadius(q.location.center, q.location.radiusM ?? 5000) : null);
    if (!b) throw new Error("Overpass requires a geocoded area (bbox, radius or polygon)");
    area = `(${b.map((v) => v.toFixed(6)).join(",")})`;
  }
  const selectors: string[] = [];
  for (const t of q.osmTags ?? []) selectors.push(`nwr["${esc(t.key)}"="${esc(t.value)}"]["name"]${area};`);
  // Name keyword match catches businesses with generic tags (e.g. office=company).
  const kw = q.term.trim();
  if (kw.length >= 3) selectors.push(`nwr["name"~"${esc(escRegex(kw))}",i]${area};`);
  return `[out:json][timeout:90];(${selectors.join("")});out center tags ${limit};`;
}

function t(tags: Record<string, string>, ...keys: string[]): string | null {
  for (const k of keys) if (tags[k]) return tags[k].split(";")[0].trim();
  return null;
}

export function mapOsm(e: OsmElement): RawBusiness | null {
  const tags = e.tags ?? {};
  if (!tags.name) return null;
  const lat = e.lat ?? e.center?.lat ?? null;
  const lng = e.lon ?? e.center?.lon ?? null;
  const socials = [tags["contact:instagram"], tags["contact:facebook"], tags["contact:tiktok"], tags["contact:linkedin"], tags["contact:youtube"]]
    .filter(Boolean)
    .map((v) => (v!.startsWith("http") ? v! : v!.startsWith("@") ? `https://www.instagram.com/${v!.slice(1)}` : v!));
  const addrParts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"], tags["addr:city"]].filter(Boolean);
  const status = tags.disused === "yes" || tags["disused:shop"] || tags["was:shop"] ? "CLOSED_PERMANENTLY" : "UNKNOWN";
  const catTags = ["shop", "amenity", "office", "craft", "leisure", "tourism", "healthcare"].filter((k) => tags[k]).map((k) => `${k}=${tags[k]}`);
  return {
    provider: KEY,
    externalId: `${e.type}/${e.id}`,
    name: tags.name,
    categoryLabels: catTags,
    phone: t(tags, "phone", "contact:phone", "contact:mobile", "mobile"),
    website: t(tags, "website", "contact:website", "url"),
    email: t(tags, "email", "contact:email"),
    address: addrParts.length ? addrParts.join(", ") : null,
    area: t(tags, "addr:suburb", "addr:district", "addr:neighbourhood"),
    city: t(tags, "addr:city"),
    postalCode: t(tags, "addr:postcode"),
    countryCode: t(tags, "addr:country"),
    lat,
    lng,
    businessStatus: status,
    openingHours: tags.opening_hours ?? null,
    socialUrls: socials,
    sourceUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    raw: e,
  };
}

export const overpassProvider: LeadProvider = {
  key: KEY,
  async searchBusinesses(q: DiscoveryQuery, _pageToken: string | null, rt: ProviderRuntime): Promise<DiscoveryPage> {
    const limit = Math.min(1000, Math.max(50, q.maxResults ?? 300));
    const query = buildOverpassQuery(q, limit);
    const res = await providerFetch(endpoint(), {
      provider: KEY,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent() },
      body: new URLSearchParams({ data: query }).toString(),
      timeoutMs: 100_000,
      retries: 2,
      backoffMs: 5_000,
      rateLimitPerMinute: rt.rateLimitPerMinute ?? 6,
    });
    const json = (await res.json()) as { elements?: OsmElement[] };
    const results = (json.elements ?? []).map(mapOsm).filter((x): x is RawBusiness => !!x);
    // Overpass returns everything in one response — no further pages.
    return { results, nextPageToken: null, usageUnits: 1 };
  },
};

export function userAgent(): string {
  const contact = process.env.NOMINATIM_EMAIL || process.env.APP_CONTACT_EMAIL || "";
  return `AinAltairLeadIntelligence/1.0${contact ? ` (${contact})` : ""}`;
}
