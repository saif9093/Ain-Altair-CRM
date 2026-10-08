import type { RawBusiness } from "@/lib/providers/types";
import type { Confidence } from "@/lib/intel/types";
import { CONFIDENCE_RANK, decideField, defaultConfidence, overallConfidence } from "@/lib/dedup/provenance";
import { normalizePhone } from "@/lib/normalize/phone";
import { displayName, normalizeBusinessName, normalizeEmail } from "@/lib/normalize/text";
import { domainOf, isOwnedWebsite, normalizeUrl, parseSocialUrl, type SocialProfile } from "@/lib/normalize/url";

/**
 * Observations: provider facts normalised into tracked fields, then merged
 * into the business row under the provenance rules (never overwrite stronger
 * data with weaker data; manual values always win).
 */

export const TRACKED_FIELDS = ["name", "phone", "whatsapp", "website", "email", "address", "location", "rating", "review_count", "google_maps_url", "google_place_id", "business_status", "opening_hours"] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export interface Observation {
  field: TrackedField;
  value: unknown;               // normalised value object for the field
  display: string;              // human-readable value for provenance table
  provider: string;
  confidence: Confidence;
  sourceUrl?: string | null;
  retrievedAt: string;
}

export interface FieldMeta { confidence: Confidence; provider: string; at: string; manual?: boolean }
export type FieldConfidenceMap = Partial<Record<TrackedField, FieldMeta>>;

/** Map a tracked field's normalised value to business columns. */
export function columnsFor(field: TrackedField, value: unknown): Record<string, unknown> {
  const v = value as Record<string, unknown>;
  switch (field) {
    case "name": return { name: v.name, normalized_name: v.normalized };
    case "phone": return { phone_e164: v.e164, phone_country_code: v.countryCallingCode, phone_national: v.nationalNumber, phone_formatted: v.international, phone_region: v.region, phone_type: v.type };
    case "whatsapp": return { whatsapp_e164: v.e164, whatsapp_source: v.source };
    case "website": return { website_url: v.url, website_domain: v.domain };
    case "email": return { email: v.email, email_source: v.source };
    case "address": return { address: v.address ?? null, area: v.area ?? null, city: v.city ?? null, region: v.region ?? null, country: v.country ?? null, country_code: v.countryCode ?? null, postal_code: v.postalCode ?? null };
    case "location": return { lat: v.lat, lng: v.lng };
    case "rating": return { google_rating: value };
    case "review_count": return { google_review_count: value };
    case "google_maps_url": return { google_maps_url: value };
    case "google_place_id": return { google_place_id: value };
    case "business_status": return { business_status: value };
    case "opening_hours": return { opening_hours: value };
  }
}

/** Current comparable value of a tracked field from a business row. */
export function currentValue(field: TrackedField, row: Record<string, unknown> | null): unknown {
  if (!row) return null;
  switch (field) {
    case "name": return row.name ? { name: row.name, normalized: row.normalized_name } : null;
    case "phone": return row.phone_e164 ? { e164: row.phone_e164 } : null;
    case "whatsapp": return row.whatsapp_e164 ? { e164: row.whatsapp_e164 } : null;
    case "website": return row.website_domain ? { domain: row.website_domain } : null;
    case "email": return row.email ? { email: row.email } : null;
    case "address": return row.address || row.city ? { address: row.address, city: row.city } : null;
    case "location": return row.lat != null ? { lat: row.lat, lng: row.lng } : null;
    case "rating": return row.google_rating;
    case "review_count": return row.google_review_count;
    case "google_maps_url": return row.google_maps_url;
    case "google_place_id": return row.google_place_id;
    case "business_status": return row.business_status === "UNKNOWN" ? null : row.business_status;
    case "opening_hours": return row.opening_hours;
  }
}

/** Comparable identity for "is this the same value?" checks. */
function identity(field: TrackedField, value: unknown): unknown {
  const v = value as Record<string, unknown> | null;
  if (v == null) return null;
  switch (field) {
    case "name": return v.normalized;
    case "phone": case "whatsapp": return v.e164;
    case "website": return v.domain;
    case "email": return v.email;
    case "address": return `${v.address ?? ""}|${v.city ?? ""}`;
    case "location": return `${Number(v.lat).toFixed(5)},${Number(v.lng).toFixed(5)}`;
    default: return value;
  }
}

export interface RawNormalisation {
  observations: Observation[];
  socials: (SocialProfile & { confidence: Confidence; source: string })[];
  categoryLabels: string[];
}

export function observationsFromRaw(raw: RawBusiness, defaultCountry: string, retrievedAt = new Date().toISOString()): RawNormalisation {
  const obs: Observation[] = [];
  const conf = (f: string) => defaultConfidence(raw.provider, f);
  const add = (field: TrackedField, value: unknown, display: string) =>
    obs.push({ field, value, display, provider: raw.provider, confidence: conf(field), sourceUrl: raw.sourceUrl ?? null, retrievedAt });

  const nm = displayName(raw.name);
  add("name", { name: nm, normalized: normalizeBusinessName(nm) }, nm);
  const region = raw.countryCode ?? defaultCountry;
  const phone = normalizePhone(raw.phone, region);
  if (phone) add("phone", phone, phone.international);

  const socials: RawNormalisation["socials"] = [];
  const web = normalizeUrl(raw.website);
  if (web) {
    if (isOwnedWebsite(web)) add("website", { url: web, domain: domainOf(web) }, web);
    else {
      const sp = parseSocialUrl(web);
      if (sp) socials.push({ ...sp, confidence: conf("social"), source: raw.provider });
    }
  }
  for (const u of raw.socialUrls ?? []) {
    const sp = parseSocialUrl(u);
    if (sp && !socials.some((s) => s.url === sp.url)) socials.push({ ...sp, confidence: conf("social"), source: raw.provider });
  }
  const email = normalizeEmail(raw.email);
  if (email) add("email", { email, source: raw.provider }, email);
  if (raw.address || raw.city || raw.area) {
    add("address", { address: raw.address, area: raw.area, city: raw.city, region: raw.region, country: raw.country, countryCode: raw.countryCode ?? null, postalCode: raw.postalCode }, [raw.address, raw.city].filter(Boolean).join(", "));
  }
  if (raw.lat != null && raw.lng != null) add("location", { lat: raw.lat, lng: raw.lng }, `${raw.lat.toFixed(5)}, ${raw.lng.toFixed(5)}`);
  if (raw.rating != null) add("rating", raw.rating, `${raw.rating}★`);
  if (raw.reviewCount != null) add("review_count", raw.reviewCount, `${raw.reviewCount} reviews`);
  if (raw.googleMapsUrl) add("google_maps_url", raw.googleMapsUrl, raw.googleMapsUrl);
  if (raw.googlePlaceId) add("google_place_id", raw.googlePlaceId, raw.googlePlaceId);
  if (raw.businessStatus && raw.businessStatus !== "UNKNOWN") add("business_status", raw.businessStatus, raw.businessStatus);
  if (raw.openingHours) add("opening_hours", raw.openingHours, "opening hours");
  return { observations: obs, socials, categoryLabels: raw.categoryLabels };
}

export interface MergeOutcome {
  patch: Record<string, unknown>;
  fieldConfidence: FieldConfidenceMap;
  accepted: Observation[];
  rejected: Observation[];
  overall: Confidence;
}

/** Merge observations into a (possibly null) current row under provenance rules. */
export function mergeObservations(row: Record<string, unknown> | null, current: FieldConfidenceMap, observations: Observation[]): MergeOutcome {
  const fc: FieldConfidenceMap = { ...current };
  const patch: Record<string, unknown> = {};
  const accepted: Observation[] = [];
  const rejected: Observation[] = [];
  for (const o of observations) {
    const meta = fc[o.field];
    const cur = currentValue(o.field, row);
    const curFv = cur == null ? null : {
      value: identity(o.field, cur),
      confidence: meta?.confidence ?? "UNKNOWN",
      provider: meta?.provider ?? "unknown",
      retrievedAt: meta?.at ?? "1970-01-01T00:00:00Z",
      manual: meta?.manual,
    };
    // A field already set in this same merge pass takes precedence over the row.
    const decision = decideField(curFv, { value: identity(o.field, o.value), confidence: o.confidence, provider: o.provider, retrievedAt: o.retrievedAt });
    if (decision === "TAKE_INCOMING") {
      Object.assign(patch, columnsFor(o.field, o.value));
      fc[o.field] = { confidence: o.confidence, provider: o.provider, at: o.retrievedAt };
      accepted.push(o);
      if (row) Object.assign(row, columnsFor(o.field, o.value));
    } else if (decision === "SAME") {
      // Refresh volatile values (rating / review count) and bump timestamp.
      if (o.field === "rating" || o.field === "review_count") Object.assign(patch, columnsFor(o.field, o.value));
      const stronger = meta && CONFIDENCE_RANK[meta.confidence] > CONFIDENCE_RANK[o.confidence];
      fc[o.field] = stronger ? { ...meta! } : { confidence: o.confidence, provider: o.provider, at: o.retrievedAt, manual: meta?.manual };
      accepted.push(o);
    } else {
      rejected.push(o);
    }
  }
  const simple: Record<string, Confidence> = {};
  for (const [k, v] of Object.entries(fc)) if (v) simple[k] = v.confidence;
  return { patch, fieldConfidence: fc, accepted, rejected, overall: overallConfidence(simple) };
}
