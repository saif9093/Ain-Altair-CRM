import { bboxFromRadius, bboxOfPolygon, bboxSizeM, gridCells, cellId, type BBox, type LatLng } from "@/lib/geo/geo";
import { categoryByKey } from "@/lib/categories/taxonomy";
import { slugify } from "@/lib/normalize/text";
import type { CategorySpec, Depth } from "@/lib/search/criteria";

/**
 * Coverage engine: turns (categories × locations × providers) into concrete
 * source tasks, splitting large areas into cells for providers with result
 * caps and skipping cells that were searched recently.
 */

export interface ResolvedLocation {
  label: string;
  center: LatLng;
  bbox: BBox;
  polygon?: LatLng[] | null;
  radiusM?: number | null;
  countryCode?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  area?: string | null;
}

export interface SourceTaskPlan {
  provider: string;
  categoryKey: string;
  categoryLabel: string;
  term: string;
  osmTags?: { key: string; value: string }[];
  googleTypes?: string[];
  cell: { id: string; bbox: BBox; center: LatLng; radiusM: number; polygon?: LatLng[] | null };
  locationLabel: string;
  countryCode?: string | null;
  maxResults: number;
}

export interface PlanResult {
  tasks: SourceTaskPlan[];
  skippedCells: { provider: string; categoryKey: string; cellId: string; locationLabel: string; searchedAt: string }[];
}

export function categoryKeyOf(c: CategorySpec): string {
  return c.key ?? `custom:${slugify(c.label)}`;
}

export function termsFor(c: CategorySpec, depth: Depth, keywords: string[]): string[] {
  const base = c.terms.length ? c.terms : [c.label];
  const n = depth === "DEEP" ? 3 : depth === "BALANCED" ? 2 : 1;
  const terms = [c.label, ...base].filter((t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i).slice(0, n);
  for (const k of keywords.slice(0, 3)) terms.push(`${k} ${c.label}`.trim());
  return terms;
}

/** Short distinctive keyword for name matching on OSM (e.g. "cleaning", "florist"). */
export function osmNameTerm(c: CategorySpec): string {
  const def = c.key ? categoryByKey(c.key) : undefined;
  const t = def?.synonyms[0] ?? c.terms[0] ?? c.label;
  return t.split(" ").sort((a, b) => b.length - a.length)[0];
}

export function planSourceTasks(input: {
  categories: CategorySpec[];
  locations: ResolvedLocation[];
  providers: string[];
  depth: Depth;
  keywords: string[];
  targetCount: number;
  splitLargeAreas: boolean;
  recentCoverage: { provider: string; category_key: string; cell_id: string; searched_at: string }[];
}): PlanResult {
  const tasks: SourceTaskPlan[] = [];
  const skippedCells: PlanResult["skippedCells"] = [];
  const recent = new Map(input.recentCoverage.map((r) => [`${r.provider}|${r.category_key}|${r.cell_id}`, r.searched_at]));

  for (const cat of input.categories) {
    const key = categoryKeyOf(cat);
    const def = cat.key ? categoryByKey(cat.key) : undefined;
    for (const loc of input.locations) {
      const bbox = loc.polygon?.length ? bboxOfPolygon(loc.polygon) : loc.bbox;
      const { widthM, heightM } = bboxSizeM(bbox);
      const span = Math.max(widthM, heightM);
      for (const provider of input.providers) {
        let cells: { id: string; bbox: BBox; center: LatLng; radiusM: number; polygon?: LatLng[] | null }[];
        if (provider === "google_places" && input.splitLargeAreas && span > 6000) {
          const cellSize = input.depth === "DEEP" ? 2500 : 4000;
          const maxCells = Math.min(120, Math.max(4, Math.ceil(input.targetCount / 12)));
          cells = gridCells(bbox, cellSize, loc.polygon ?? undefined, maxCells);
        } else if (provider === "osm_overpass" && span > 80_000) {
          cells = gridCells(bbox, 40_000, loc.polygon ?? undefined, 60);
        } else {
          const radiusM = loc.radiusM ?? Math.ceil(Math.sqrt(widthM ** 2 + heightM ** 2) / 2);
          const b = loc.radiusM ? bboxFromRadius(loc.center, loc.radiusM) : bbox;
          cells = [{ id: cellId(b), bbox: b, center: loc.center, radiusM, polygon: loc.polygon }];
        }
        const terms = provider === "osm_overpass" ? [osmNameTerm(cat)] : termsFor(cat, input.depth, input.keywords);
        for (const cell of cells) {
          const seenAt = recent.get(`${provider}|${key}|${cell.id}`);
          if (seenAt) {
            skippedCells.push({ provider, categoryKey: key, cellId: cell.id, locationLabel: loc.label, searchedAt: seenAt });
            continue;
          }
          for (const term of terms) {
            tasks.push({
              provider,
              categoryKey: key,
              categoryLabel: cat.label,
              term,
              osmTags: provider === "osm_overpass" ? def?.osm : undefined,
              googleTypes: def?.googleTypes,
              cell: provider === "apify_google_maps" && !loc.radiusM && !loc.polygon ? { ...cell, radiusM: 0 } : cell,
              locationLabel: loc.label,
              countryCode: loc.countryCode,
              maxResults: Math.min(500, Math.max(40, Math.ceil((input.targetCount * 2.5) / Math.max(1, cells.length)))),
            });
          }
        }
      }
    }
  }
  return { tasks, skippedCells };
}
