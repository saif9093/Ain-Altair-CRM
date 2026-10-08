import type { Confidence } from "@/lib/intel/types";

/**
 * Field-level provenance & confidence. Rules:
 *  1. Manual overrides always win.
 *  2. Stronger confidence is never overwritten by weaker confidence.
 *  3. With equal confidence the more recent observation wins.
 *  4. Empty incoming values never erase existing values.
 */

export const CONFIDENCE_RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

export interface FieldValue<T = unknown> {
  value: T | null | undefined;
  confidence: Confidence;
  provider: string;
  sourceUrl?: string | null;
  retrievedAt: string; // ISO
  manual?: boolean;
}

export type MergeDecision = "KEEP_CURRENT" | "TAKE_INCOMING" | "SAME";

export function decideField<T>(current: FieldValue<T> | null | undefined, incoming: FieldValue<T>): MergeDecision {
  const empty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  if (empty(incoming.value)) return "KEEP_CURRENT";
  if (!current || empty(current.value)) return "TAKE_INCOMING";
  if (JSON.stringify(current.value) === JSON.stringify(incoming.value)) return "SAME";
  if (current.manual && !incoming.manual) return "KEEP_CURRENT";
  if (incoming.manual) return "TAKE_INCOMING";
  const rc = CONFIDENCE_RANK[current.confidence];
  const ri = CONFIDENCE_RANK[incoming.confidence];
  if (ri > rc) return "TAKE_INCOMING";
  if (ri < rc) return "KEEP_CURRENT";
  return Date.parse(incoming.retrievedAt) >= Date.parse(current.retrievedAt) ? "TAKE_INCOMING" : "KEEP_CURRENT";
}

/**
 * Default confidence for a field observed from a provider. Official listing
 * data is HIGH; data found on the business's own website is HIGH; community
 * data (OSM) MEDIUM; search-engine inference LOW/MEDIUM; imports MEDIUM.
 */
export function defaultConfidence(provider: string, field: string): Confidence {
  const p = provider.toLowerCase();
  if (p === "manual") return "HIGH";
  if (p === "google_places") return "HIGH";
  if (p === "apify_google_maps") return field === "email" || field.startsWith("social") ? "MEDIUM" : "HIGH";
  if (p === "website_audit") return "HIGH"; // found on the business's own site
  if (p === "osm_overpass") return field === "name" || field === "location" ? "HIGH" : "MEDIUM";
  if (p === "brave_search") return field === "website" ? "MEDIUM" : "LOW";
  if (p === "apify_instagram") return "HIGH";
  if (p === "import") return "MEDIUM";
  return "UNKNOWN";
}

export function overallConfidence(fields: Record<string, Confidence>): Confidence {
  const vals = Object.values(fields);
  if (!vals.length) return "UNKNOWN";
  const avg = vals.reduce((s, c) => s + CONFIDENCE_RANK[c], 0) / vals.length;
  if (avg >= 2.5) return "HIGH";
  if (avg >= 1.5) return "MEDIUM";
  if (avg > 0) return "LOW";
  return "UNKNOWN";
}
