import { NotConfiguredError, ProviderError, providerFetch } from "./http";
import type { DiscoveryPage, DiscoveryQuery, LeadProvider, ProviderRuntime, RawBusiness, SocialProfileData } from "./types";

/**
 * Apify actors via the official Apify API (https://docs.apify.com/api/v2).
 * Long runs are asynchronous: the first call starts the run and returns a
 * pending continuation token; the job system re-polls later instead of
 * blocking a worker. Tokens: "run:<runId>" → poll; "ds:<datasetId>:<offset>" → read items.
 */
const KEY = "apify_google_maps";
const IG_KEY = "apify_instagram";
const BASE = "https://api.apify.com/v2";
const PAGE = 100;

function token(provider: string): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new NotConfiguredError(provider, ["APIFY_TOKEN"]);
  return t;
}
const actorId = () => (process.env.APIFY_GOOGLE_MAPS_ACTOR || "compass~crawler-google-places").replace("/", "~");
const igActorId = () => (process.env.APIFY_INSTAGRAM_ACTOR || "apify~instagram-profile-scraper").replace("/", "~");

interface ApifyPlace {
  placeId?: string;
  title?: string;
  categoryName?: string;
  categories?: string[];
  address?: string;
  neighborhood?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
  website?: string;
  phone?: string;
  phoneUnformatted?: string;
  location?: { lat: number; lng: number };
  totalScore?: number;
  reviewsCount?: number;
  url?: string;
  permanentlyClosed?: boolean;
  temporarilyClosed?: boolean;
  openingHours?: unknown;
  price?: string;
  emails?: string[];
  instagrams?: string[];
  facebooks?: string[];
  tiktoks?: string[];
  linkedIns?: string[];
  youtubes?: string[];
}

export function mapApifyPlace(p: ApifyPlace): RawBusiness | null {
  if (!p.title) return null;
  return {
    provider: KEY,
    externalId: p.placeId ?? p.url ?? `${p.title}|${p.address ?? ""}`,
    name: p.title,
    categoryLabels: [p.categoryName, ...(p.categories ?? [])].filter(Boolean) as string[],
    phone: p.phoneUnformatted ?? p.phone ?? null,
    website: p.website ?? null,
    email: p.emails?.[0] ?? null,
    address: p.address ?? null,
    area: p.neighborhood ?? null,
    city: p.city ?? null,
    region: p.state ?? null,
    countryCode: p.countryCode ?? null,
    postalCode: p.postalCode ?? null,
    lat: p.location?.lat ?? null,
    lng: p.location?.lng ?? null,
    rating: p.totalScore ?? null,
    reviewCount: p.reviewsCount ?? null,
    googlePlaceId: p.placeId ?? null,
    googleMapsUrl: p.url ?? null,
    businessStatus: p.permanentlyClosed ? "CLOSED_PERMANENTLY" : p.temporarilyClosed ? "CLOSED_TEMPORARILY" : "OPERATIONAL",
    openingHours: p.openingHours ?? null,
    priceLevel: p.price ?? null,
    socialUrls: [...(p.instagrams ?? []), ...(p.facebooks ?? []), ...(p.tiktoks ?? []), ...(p.linkedIns ?? []), ...(p.youtubes ?? [])],
    sourceUrl: p.url ?? null,
    raw: p,
  };
}

async function apifyJson<T>(path: string, provider: string, rt: ProviderRuntime, init: RequestInit = {}): Promise<T> {
  const res = await providerFetch(`${BASE}${path}`, {
    provider,
    ...init,
    headers: { Authorization: `Bearer ${token(provider)}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    rateLimitPerMinute: rt.rateLimitPerMinute,
    timeoutMs: 60_000,
  });
  return (await res.json()) as T;
}

interface RunInfo { data: { id: string; status: string; defaultDatasetId: string; statusMessage?: string } }

export const apifyGoogleMapsProvider: LeadProvider = {
  key: KEY,

  async searchBusinesses(q: DiscoveryQuery, pageToken: string | null, rt: ProviderRuntime): Promise<DiscoveryPage> {
    // Continue an existing run
    if (pageToken?.startsWith("run:")) {
      const runId = pageToken.slice(4);
      const info = await apifyJson<RunInfo>(`/actor-runs/${runId}`, KEY, rt);
      const st = info.data.status;
      if (st === "READY" || st === "RUNNING") return { results: [], nextPageToken: pageToken, pending: true, retryAfterMs: 20_000 };
      if (st !== "SUCCEEDED") throw new ProviderError(`Apify run ${runId} ended with status ${st}${info.data.statusMessage ? `: ${info.data.statusMessage}` : ""}`, KEY, undefined, false);
      pageToken = `ds:${info.data.defaultDatasetId}:0`;
    }
    if (pageToken?.startsWith("ds:")) {
      const [, datasetId, offStr] = pageToken.split(":");
      const offset = Number(offStr) || 0;
      const items = await apifyJson<ApifyPlace[]>(`/datasets/${datasetId}/items?clean=true&format=json&offset=${offset}&limit=${PAGE}`, KEY, rt);
      const results = items.map(mapApifyPlace).filter((x): x is RawBusiness => !!x);
      return { results, nextPageToken: items.length === PAGE ? `ds:${datasetId}:${offset + PAGE}` : null, usageUnits: 0 };
    }

    // Start a new run
    const input: Record<string, unknown> = {
      searchStringsArray: [q.term],
      maxCrawledPlacesPerSearch: Math.min(500, q.maxResults ?? 100),
      language: q.language ?? "en",
      scrapeContacts: Boolean((rt.config as { scrapeContacts?: boolean } | undefined)?.scrapeContacts),
      skipClosedPlaces: false,
    };
    if (q.location.polygon?.length) {
      input.customGeolocation = { type: "Polygon", coordinates: [[...q.location.polygon.map((p) => [p.lng, p.lat]), [q.location.polygon[0].lng, q.location.polygon[0].lat]]] };
    } else if (q.location.center && q.location.radiusM) {
      input.customGeolocation = { type: "Point", coordinates: [q.location.center.lng, q.location.center.lat], radiusKm: Math.max(0.5, q.location.radiusM / 1000) };
    } else {
      input.locationQuery = q.location.label;
    }
    const run = await apifyJson<RunInfo>(`/acts/${actorId()}/runs`, KEY, rt, { method: "POST", body: JSON.stringify(input) });
    return { results: [], nextPageToken: `run:${run.data.id}`, pending: true, retryAfterMs: 30_000, usageUnits: 1 };
  },
};

interface IgProfile {
  username?: string;
  followersCount?: number;
  private?: boolean;
  externalUrl?: string;
  latestPosts?: { timestamp?: string }[];
}

/** Public Instagram profile metrics (followers, last post) — public profiles only. */
export const apifyInstagramProvider: LeadProvider = {
  key: IG_KEY,
  async getSocialProfileData(usernames: string[], rt: ProviderRuntime): Promise<SocialProfileData[]> {
    if (!usernames.length) return [];
    const res = await providerFetch(`${BASE}/acts/${igActorId()}/run-sync-get-dataset-items?timeout=240`, {
      provider: IG_KEY,
      method: "POST",
      headers: { Authorization: `Bearer ${token(IG_KEY)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: usernames.slice(0, 25) }),
      timeoutMs: 260_000,
      retries: 1,
      rateLimitPerMinute: rt.rateLimitPerMinute,
    });
    const items = (await res.json()) as IgProfile[];
    const now = Date.now();
    return items.filter((i) => i.username).map((i) => {
      const last = (i.latestPosts ?? []).map((p) => (p.timestamp ? Date.parse(p.timestamp) : NaN)).filter(Number.isFinite).sort((a, b) => b - a)[0];
      const ageDays = last ? (now - last) / 86_400_000 : null;
      return {
        platform: "INSTAGRAM" as const,
        username: i.username!,
        followers: i.private ? null : i.followersCount ?? null,
        lastPostAt: last ? new Date(last).toISOString() : null,
        activity: i.private || ageDays == null ? ("UNKNOWN" as const) : ageDays <= 60 ? ("ACTIVE" as const) : ("INACTIVE" as const),
        isPrivate: !!i.private,
        externalUrl: i.externalUrl ?? null,
        raw: { username: i.username, followersCount: i.followersCount, private: i.private, latestPostTimestamps: (i.latestPosts ?? []).slice(0, 5).map((p) => p.timestamp) },
      };
    });
  },
};
