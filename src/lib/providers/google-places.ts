import { NotConfiguredError, providerFetch } from "./http";
import type { DiscoveryPage, DiscoveryQuery, LeadProvider, ProviderRuntime, RawBusiness } from "./types";
import { bboxFromRadius } from "@/lib/geo/geo";

/**
 * Google Places API (New) — official endpoint.
 * https://developers.google.com/maps/documentation/places/web-service/text-search
 * Text Search returns up to 20 results per page and at most 60 per query;
 * the coverage engine splits large areas into cells to go beyond that.
 */
const KEY = "google_places";
const BASE = "https://places.googleapis.com/v1";
const FIELDS = [
  "id", "displayName", "formattedAddress", "addressComponents", "location", "rating", "userRatingCount",
  "nationalPhoneNumber", "internationalPhoneNumber", "websiteUri", "googleMapsUri", "businessStatus",
  "primaryType", "primaryTypeDisplayName", "types", "regularOpeningHours", "priceLevel",
];

interface PlaceComponent { longText?: string; shortText?: string; types?: string[] }
interface Place {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: PlaceComponent[];
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  businessStatus?: string;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  regularOpeningHours?: unknown;
  priceLevel?: string;
}

function apiKey(): string {
  const k = process.env.GOOGLE_PLACES_API_KEY;
  if (!k) throw new NotConfiguredError(KEY, ["GOOGLE_PLACES_API_KEY"]);
  return k;
}

function comp(p: Place, type: string, short = false): string | null {
  const c = p.addressComponents?.find((x) => x.types?.includes(type));
  return (short ? c?.shortText : c?.longText) ?? null;
}

export function mapPlace(p: Place): RawBusiness {
  const status =
    p.businessStatus === "OPERATIONAL" ? "OPERATIONAL"
    : p.businessStatus === "CLOSED_TEMPORARILY" ? "CLOSED_TEMPORARILY"
    : p.businessStatus === "CLOSED_PERMANENTLY" ? "CLOSED_PERMANENTLY"
    : "UNKNOWN";
  return {
    provider: KEY,
    externalId: p.id,
    name: p.displayName?.text ?? "Unnamed place",
    categoryLabels: [p.primaryTypeDisplayName?.text, ...(p.types ?? [])].filter(Boolean) as string[],
    phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    address: p.formattedAddress ?? null,
    area: comp(p, "sublocality_level_1") ?? comp(p, "sublocality") ?? comp(p, "neighborhood"),
    city: comp(p, "locality") ?? comp(p, "administrative_area_level_2"),
    region: comp(p, "administrative_area_level_1"),
    country: comp(p, "country"),
    countryCode: comp(p, "country", true),
    postalCode: comp(p, "postal_code"),
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
    googlePlaceId: p.id,
    googleMapsUrl: p.googleMapsUri ?? null, // only the URL Google returns — never constructed
    businessStatus: status,
    openingHours: p.regularOpeningHours ?? null,
    priceLevel: p.priceLevel ?? null,
    sourceUrl: p.googleMapsUri ?? null,
    raw: p,
  };
}

export const googlePlacesProvider: LeadProvider = {
  key: KEY,

  async searchBusinesses(q: DiscoveryQuery, pageToken: string | null, rt: ProviderRuntime): Promise<DiscoveryPage> {
    const body: Record<string, unknown> = {
      textQuery: q.location.label && !q.location.bbox && !q.location.center ? `${q.term} in ${q.location.label}` : q.term,
      pageSize: Math.min(20, q.pageSize ?? 20),
      languageCode: q.language ?? "en",
    };
    if (q.location.countryCode) body.regionCode = q.location.countryCode;
    if (pageToken) body.pageToken = pageToken;
    // Prefer a hard rectangle restriction (exact cell); fall back to a circular bias.
    const bbox = q.location.bbox ?? (q.location.center && q.location.radiusM ? bboxFromRadius(q.location.center, q.location.radiusM) : undefined);
    if (bbox) {
      body.locationRestriction = { rectangle: { low: { latitude: bbox[0], longitude: bbox[1] }, high: { latitude: bbox[2], longitude: bbox[3] } } };
    } else if (q.location.center) {
      body.locationBias = { circle: { center: { latitude: q.location.center.lat, longitude: q.location.center.lng }, radius: Math.min(50_000, q.location.radiusM ?? 5_000) } };
    }

    const res = await providerFetch(`${BASE}/places:searchText`, {
      provider: KEY,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask": [...FIELDS.map((f) => `places.${f}`), "nextPageToken"].join(","),
      },
      body: JSON.stringify(body),
      rateLimitPerMinute: rt.rateLimitPerMinute,
    });
    const json = (await res.json()) as { places?: Place[]; nextPageToken?: string };
    return {
      results: (json.places ?? []).map(mapPlace),
      nextPageToken: json.nextPageToken ?? null,
      usageUnits: 1,
    };
  },

  async getBusinessDetails(externalId: string, rt: ProviderRuntime): Promise<RawBusiness | null> {
    const res = await providerFetch(`${BASE}/places/${encodeURIComponent(externalId)}`, {
      provider: KEY,
      headers: { "X-Goog-Api-Key": apiKey(), "X-Goog-FieldMask": FIELDS.join(",") },
      rateLimitPerMinute: rt.rateLimitPerMinute,
    });
    return mapPlace((await res.json()) as Place);
  },
};
