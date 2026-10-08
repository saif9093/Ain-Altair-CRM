import { nameTokens, normalizeBusinessName } from "@/lib/normalize/text";
import { haversine } from "@/lib/geo/geo";

/** Entity resolution: fuzzy name matching combined with hard identifiers. */

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matchDist = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array(a.length).fill(false);
  const bM = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = bM[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length) && a[i] === b[i]; i++) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Name similarity 0–1 robust to word order, legal suffixes and extra generic words. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeBusinessName(a);
  const nb = normalizeBusinessName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = nameTokens(na);
  const tb = nameTokens(nb);
  if (!ta.length || !tb.length) return jaroWinkler(na, nb);
  const sortedA = [...ta].sort().join(" ");
  const sortedB = [...tb].sort().join(" ");
  const jw = Math.max(jaroWinkler(na, nb), jaroWinkler(sortedA, sortedB));
  // Token containment: "al noor cleaning" ⊂ "al noor cleaning service"
  const setA = new Set(ta);
  const setB = new Set(tb);
  const inter = [...setA].filter((t) => setB.has(t)).length;
  const containment = inter / Math.min(setA.size, setB.size);
  const jaccard = inter / new Set([...ta, ...tb]).size;
  const tokenScore = containment >= 1 && Math.min(setA.size, setB.size) >= 2 ? 0.93 : 0.6 * containment + 0.4 * jaccard;
  return Math.max(jw * (containment > 0 ? 1 : 0.85), tokenScore);
}

export interface MatchableRecord {
  id?: string;
  name: string;
  phoneE164?: string | null;
  whatsappE164?: string | null;
  domain?: string | null;
  googlePlaceId?: string | null;
  googleMapsUrl?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  instagram?: string | null; // username, lowercase
  email?: string | null;
}

export interface DuplicateAssessment {
  confidence: number; // 0–100
  hardMatch: boolean; // matched on an unambiguous identifier
  reasons: { signal: string; detail: string; weight: number }[];
}

// Shared/generic domains that do not identify a single business.
const GENERIC_DOMAINS = new Set(["facebook.com", "instagram.com", "business.site", "wixsite.com", "linktr.ee", "google.com", "sites.google.com"]);

export function assessDuplicate(a: MatchableRecord, b: MatchableRecord): DuplicateAssessment {
  const reasons: DuplicateAssessment["reasons"] = [];
  let hardMatch = false;
  const add = (signal: string, detail: string, weight: number) => reasons.push({ signal, detail, weight });

  if (a.googlePlaceId && b.googlePlaceId) {
    if (a.googlePlaceId === b.googlePlaceId) {
      add("google_place_id", "Same Google place ID", 100);
      hardMatch = true;
    } else {
      add("google_place_id", "Different Google place IDs", -40);
    }
  }
  if (a.googleMapsUrl && b.googleMapsUrl && a.googleMapsUrl === b.googleMapsUrl) {
    add("google_maps_url", "Same Google Maps URL", 90);
    hardMatch = true;
  }

  const nameSim = nameSimilarity(a.name, b.name);
  if (nameSim >= 0.97) add("name", `Names match (${Math.round(nameSim * 100)}%)`, 50);
  else if (nameSim >= 0.88) add("name", `Names very similar (${Math.round(nameSim * 100)}%)`, 40);
  else if (nameSim >= 0.8) add("name", `Names similar (${Math.round(nameSim * 100)}%)`, 20);
  else if (nameSim < 0.55) add("name", `Names differ (${Math.round(nameSim * 100)}%)`, -25);

  const phonesA = [a.phoneE164, a.whatsappE164].filter(Boolean) as string[];
  const phonesB = [b.phoneE164, b.whatsappE164].filter(Boolean) as string[];
  const sharedPhone = phonesA.find((p) => phonesB.includes(p));
  if (sharedPhone) {
    add("phone", `Same phone ${sharedPhone}`, 45);
    if (nameSim >= 0.6) hardMatch = true;
  }
  if (a.domain && b.domain && a.domain === b.domain && !GENERIC_DOMAINS.has(a.domain)) {
    add("domain", `Same website domain ${a.domain}`, 40);
    if (nameSim >= 0.6) hardMatch = true;
  }
  if (a.instagram && b.instagram && a.instagram.toLowerCase() === b.instagram.toLowerCase()) {
    add("instagram", `Same Instagram @${a.instagram}`, 40);
    if (nameSim >= 0.6) hardMatch = true;
  }
  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) add("email", `Same email ${a.email}`, 35);

  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    const d = haversine({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    if (d < 50) add("coordinates", `${Math.round(d)} m apart`, 20);
    else if (d < 250) add("coordinates", `${Math.round(d)} m apart`, 10);
    else if (d > 5000) add("coordinates", `${(d / 1000).toFixed(1)} km apart`, -30);
  }
  if (a.address && b.address) {
    const as = a.address.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const bs = b.address.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (as && as === bs) add("address", "Same address", 10);
  }

  const raw = reasons.reduce((s, r) => s + r.weight, 0);
  const confidence = hardMatch ? Math.max(95, Math.min(100, raw)) : Math.max(0, Math.min(94, raw));
  return { confidence, hardMatch, reasons };
}

/** Threshold policy. Never silently merge questionable records. */
export const DUPLICATE_THRESHOLDS = {
  /** Same real-world entity (hard identifier) → link the new source data to the existing record. */
  autoLink: 95,
  /** Possible duplicate → create a duplicate_candidates row for human review. */
  review: 60,
} as const;
