import { providerFetch } from "./http";
import { userAgent } from "./overpass";
import type { BBox, LatLng } from "@/lib/geo/geo";

/**
 * Geocoding via OpenStreetMap Nominatim (usage policy: ≤1 req/s, identify the
 * application). Results are cached by the caller in public.locations.
 */
const KEY = "nominatim";
const endpoint = () => (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");

export interface GeocodeResult {
  label: string;
  displayName: string;
  center: LatLng;
  bbox: BBox;
  polygon: LatLng[] | null;
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  area: string | null;
  kind: "COUNTRY" | "REGION" | "EMIRATE" | "STATE" | "CITY" | "DISTRICT" | "NEIGHBOURHOOD" | "AREA" | "POSTCODE" | "CUSTOM";
  externalId: string;
  raw: unknown;
}

interface NominatimItem {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // [south, north, west, east]
  display_name: string;
  addresstype?: string;
  type?: string;
  address?: Record<string, string>;
  geojson?: { type: string; coordinates: unknown };
}

function kindOf(t?: string): GeocodeResult["kind"] {
  switch (t) {
    case "country": return "COUNTRY";
    case "state": return "STATE";
    case "region": case "province": return "REGION";
    case "city": case "town": case "municipality": return "CITY";
    case "city_district": case "district": case "borough": return "DISTRICT";
    case "suburb": case "neighbourhood": case "quarter": return "NEIGHBOURHOOD";
    case "postcode": return "POSTCODE";
    default: return "AREA";
  }
}

/** Take the outer ring of a (Multi)Polygon and simplify to ≤ 200 points. */
function polygonFrom(geo?: NominatimItem["geojson"]): LatLng[] | null {
  if (!geo) return null;
  let ring: number[][] | null = null;
  if (geo.type === "Polygon") ring = (geo.coordinates as number[][][])[0];
  else if (geo.type === "MultiPolygon") {
    const polys = geo.coordinates as number[][][][];
    ring = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
  }
  if (!ring?.length) return null;
  const step = Math.max(1, Math.ceil(ring.length / 200));
  return ring.filter((_, i) => i % step === 0).map(([lng, lat]) => ({ lat, lng }));
}

export async function geocode(query: string, opts: { countryCode?: string | null; postalCode?: string | null } = {}): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({ format: "jsonv2", limit: "1", addressdetails: "1", polygon_geojson: "1", "accept-language": "en" });
  if (opts.postalCode) params.set("postalcode", opts.postalCode);
  else params.set("q", query);
  if (opts.countryCode) params.set("countrycodes", opts.countryCode.toLowerCase());
  if (process.env.NOMINATIM_EMAIL) params.set("email", process.env.NOMINATIM_EMAIL);
  const res = await providerFetch(`${endpoint()}/search?${params}`, {
    provider: KEY,
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    rateLimitPerMinute: 50,
    timeoutMs: 15_000,
  });
  const items = (await res.json()) as NominatimItem[];
  const it = items[0];
  if (!it) return null;
  const [s, n, w, e] = it.boundingbox.map(Number);
  const a = it.address ?? {};
  return {
    label: query,
    displayName: it.display_name,
    center: { lat: Number(it.lat), lng: Number(it.lon) },
    bbox: [s, w, n, e],
    polygon: polygonFrom(it.geojson),
    countryCode: a.country_code?.toUpperCase() ?? null,
    country: a.country ?? null,
    region: a.state ?? a.region ?? null,
    city: a.city ?? a.town ?? a.state ?? null,
    area: a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? null,
    kind: kindOf(it.addresstype ?? it.type),
    externalId: `${it.osm_type}/${it.osm_id}`,
    raw: { display_name: it.display_name, addresstype: it.addresstype, address: it.address },
  };
}
