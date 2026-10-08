import type { BBox, LatLng } from "@/lib/geo/geo";

/**
 * Provider abstraction. Every external source is an adapter that maps its own
 * payload into RawBusiness; the rest of the pipeline never sees provider-
 * specific shapes. Providers are independently replaceable.
 */

export interface RawBusiness {
  provider: string;
  externalId: string;
  name: string;
  categoryLabels: string[];
  phone?: string | null;
  website?: string | null;
  email?: string | null;
  address?: string | null;
  area?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  countryCode?: string | null;
  postalCode?: string | null;
  lat?: number | null;
  lng?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  googlePlaceId?: string | null;
  googleMapsUrl?: string | null;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | "UNKNOWN";
  openingHours?: unknown;
  priceLevel?: string | null;
  socialUrls?: string[];
  sourceUrl?: string | null;
  raw: unknown;
}

export interface DiscoveryQuery {
  term: string;
  categoryKey?: string;
  googleTypes?: string[];
  osmTags?: { key: string; value: string }[];
  location: {
    label: string;
    center?: LatLng;
    radiusM?: number;
    bbox?: BBox;
    polygon?: LatLng[];
    countryCode?: string;
  };
  language?: string;
  pageSize?: number;
  maxResults?: number;
}

export interface DiscoveryPage {
  results: RawBusiness[];
  /** Opaque continuation token. Null when the provider is exhausted for this query. */
  nextPageToken: string | null;
  /** The provider has accepted the work but results are not ready (async actors). */
  pending?: boolean;
  retryAfterMs?: number;
  /** Provider-reported or estimated usage units for this call. */
  usageUnits?: number;
}

export interface WebPresence {
  website?: { url: string; confidence: "HIGH" | "MEDIUM" | "LOW"; evidence: string } | null;
  socials: { url: string; platform: string; username: string | null; confidence: "HIGH" | "MEDIUM" | "LOW"; evidence: string }[];
  checked: string[];
}

export interface SocialProfileData {
  platform: "INSTAGRAM";
  username: string;
  followers: number | null;
  lastPostAt: string | null;
  activity: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  isPrivate: boolean;
  externalUrl: string | null;
  raw: unknown;
}

export interface ProviderRuntime {
  rateLimitPerMinute?: number | null;
  config?: Record<string, unknown>;
}

export interface LeadProvider {
  key: string;
  /** Discovery: search businesses for a term within a location, page by page. */
  searchBusinesses?(q: DiscoveryQuery, pageToken: string | null, rt: ProviderRuntime): Promise<DiscoveryPage>;
  /** Full details for one business by the provider's external id. */
  getBusinessDetails?(externalId: string, rt: ProviderRuntime): Promise<RawBusiness | null>;
  /** Find an owned website for a business (name + location). */
  getWebsite?(b: { name: string; city?: string | null; country?: string | null }, rt: ProviderRuntime): Promise<WebPresence["website"]>;
  /** Discover public social profiles for a business. */
  getSocialProfiles?(b: { name: string; city?: string | null; country?: string | null }, rt: ProviderRuntime): Promise<WebPresence["socials"]>;
  /** Public social profile metrics (followers, last post) for known usernames. */
  getSocialProfileData?(usernames: string[], rt: ProviderRuntime): Promise<SocialProfileData[]>;
}
