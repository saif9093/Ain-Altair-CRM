import type { SupabaseClient } from "@supabase/supabase-js";
import { bboxFromRadius, bboxOfPolygon, bboxCenter, type BBox } from "@/lib/geo/geo";
import { geocode } from "@/lib/providers/nominatim";
import { subAreasOf } from "@/lib/search/gazetteer";
import type { LocationSpec } from "@/lib/search/criteria";
import type { ResolvedLocation } from "./planner";

/**
 * Resolve location specs into geometry. Named places are geocoded once and
 * cached in public.locations (shared cache rows have organisation_id null).
 */
export async function resolveLocation(db: SupabaseClient, spec: LocationSpec, defaultCountry: string): Promise<ResolvedLocation | null> {
  if (spec.kind === "POLYGON" && spec.polygon?.length) {
    const bbox = bboxOfPolygon(spec.polygon);
    return { label: spec.label, center: bboxCenter(bbox), bbox, polygon: spec.polygon, countryCode: spec.countryCode ?? defaultCountry, city: spec.city, area: spec.area };
  }
  if (spec.kind === "BBOX" && spec.bbox) {
    const bbox = spec.bbox as BBox;
    return { label: spec.label, center: bboxCenter(bbox), bbox, countryCode: spec.countryCode ?? defaultCountry, city: spec.city, area: spec.area };
  }
  if (spec.center && spec.radiusM) {
    return { label: spec.label, center: spec.center, bbox: bboxFromRadius(spec.center, spec.radiusM), radiusM: spec.radiusM, countryCode: spec.countryCode ?? defaultCountry, city: spec.city, area: spec.area };
  }

  const query = [spec.area && spec.area !== spec.label ? spec.area : null, spec.label, spec.city && spec.city !== spec.label ? spec.city : null].filter(Boolean).join(", ");
  const country = spec.countryCode ?? (spec.country ? null : defaultCountry);

  // Cache lookup
  const { data: cached } = await db.from("locations").select("*").is("organisation_id", null).ilike("name", query).eq("source", "NOMINATIM").limit(1).maybeSingle();
  let geo: { center: { lat: number; lng: number }; bbox: BBox; polygon: { lat: number; lng: number }[] | null; countryCode: string | null; country?: string | null; region?: string | null; city?: string | null; area?: string | null } | null = null;
  if (cached?.bbox && cached.lat != null) {
    const gj = cached.geojson as { polygon?: { lat: number; lng: number }[]; country?: string; region?: string; city?: string; area?: string } | null;
    geo = { center: { lat: cached.lat, lng: cached.lng }, bbox: cached.bbox as BBox, polygon: gj?.polygon ?? null, countryCode: cached.country_code, country: gj?.country, region: gj?.region, city: gj?.city, area: gj?.area };
  } else {
    const r = await geocode(query, { countryCode: country, postalCode: spec.postalCode ?? null });
    if (!r) return null;
    geo = r;
    await db.from("locations").insert({
      organisation_id: null, name: query, display_name: r.displayName, kind: r.kind, country_code: r.countryCode,
      lat: r.center.lat, lng: r.center.lng, bbox: r.bbox, geojson: { polygon: r.polygon, country: r.country, region: r.region, city: r.city, area: r.area },
      source: "NOMINATIM", external_id: r.externalId,
    });
  }
  if (spec.kind === "RADIUS" && spec.radiusM) {
    return { label: spec.label, center: geo.center, bbox: bboxFromRadius(geo.center, spec.radiusM), radiusM: spec.radiusM, countryCode: geo.countryCode ?? country, city: geo.city ?? spec.city, area: geo.area ?? spec.area, region: geo.region, country: geo.country };
  }
  return { label: spec.label, center: geo.center, bbox: geo.bbox, polygon: geo.polygon, countryCode: geo.countryCode ?? country, city: spec.city ?? geo.city, area: spec.area ?? geo.area, region: geo.region, country: geo.country };
}

/** Bulk research: "all salons in Dubai" → one search per known sub-area of Dubai (results are merged + deduplicated). */
export function expandSubAreas(spec: LocationSpec): LocationSpec[] {
  if (!spec.splitIntoSubAreas) return [spec];
  const subs = subAreasOf(spec.label);
  if (!subs.length) return [spec];
  return subs.map((s) => ({ label: s.name, kind: "NAMED" as const, countryCode: s.countryCode, city: spec.label, area: s.name }));
}
