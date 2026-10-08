import { describe, expect, it } from "vitest";
import { planSourceTasks, termsFor, osmNameTerm } from "@/lib/research/planner";
import { gridCells, haversine } from "@/lib/geo/geo";

const dubai = { label: "Dubai", center: { lat: 25.2, lng: 55.27 }, bbox: [24.95, 54.9, 25.35, 55.6] as [number, number, number, number], countryCode: "AE" };
const barsha = { label: "Al Barsha", center: { lat: 25.11, lng: 55.2 }, bbox: [25.095, 55.18, 25.125, 55.215] as [number, number, number, number], countryCode: "AE" };
const cat = { key: "cleaning_services", label: "Cleaning Services", terms: ["cleaning", "deep cleaning", "sofa cleaning"] };

describe("coverage planner", () => {
  it("splits large areas into cells for Google Places", () => {
    const p = planSourceTasks({ categories: [cat], locations: [dubai], providers: ["google_places"], depth: "FAST", keywords: [], targetCount: 300, splitLargeAreas: true, recentCoverage: [] });
    expect(p.tasks.length).toBeGreaterThan(4);
    expect(new Set(p.tasks.map((t) => t.cell.id)).size).toBe(p.tasks.length);
  });
  it("uses a single cell for small areas", () => {
    const p = planSourceTasks({ categories: [cat], locations: [barsha], providers: ["google_places"], depth: "FAST", keywords: [], targetCount: 100, splitLargeAreas: true, recentCoverage: [] });
    expect(p.tasks).toHaveLength(1);
  });
  it("skips cells searched recently", () => {
    const first = planSourceTasks({ categories: [cat], locations: [barsha], providers: ["google_places"], depth: "FAST", keywords: [], targetCount: 100, splitLargeAreas: true, recentCoverage: [] });
    const again = planSourceTasks({ categories: [cat], locations: [barsha], providers: ["google_places"], depth: "FAST", keywords: [], targetCount: 100, splitLargeAreas: true, recentCoverage: [{ provider: "google_places", category_key: "cleaning_services", cell_id: first.tasks[0].cell.id, searched_at: "2026-10-01" }] });
    expect(again.tasks).toHaveLength(0);
    expect(again.skippedCells).toHaveLength(1);
  });
  it("keeps categories independent for cross-category research", () => {
    const p = planSourceTasks({ categories: [cat, { key: "salons", label: "Salons", terms: ["salon"] }], locations: [barsha], providers: ["osm_overpass"], depth: "FAST", keywords: [], targetCount: 50, splitLargeAreas: true, recentCoverage: [] });
    expect(p.tasks.map((t) => t.categoryKey).sort()).toEqual(["cleaning_services", "salons"]);
    expect(p.tasks.find((t) => t.categoryKey === "salons")?.osmTags?.length).toBeGreaterThan(0);
  });
  it("expands search terms by depth", () => {
    expect(termsFor(cat, "FAST", [])).toEqual(["Cleaning Services"]);
    expect(termsFor(cat, "DEEP", [])).toHaveLength(3);
    expect(osmNameTerm(cat)).toBe("cleaning");
  });
  it("grid cells cover the bbox with bounded count", () => {
    const cells = gridCells(dubai.bbox, 4000, undefined, 50);
    expect(cells.length).toBeLessThanOrEqual(50);
    expect(cells[0].radiusM).toBeGreaterThan(0);
    expect(haversine(cells[0].center, cells[1].center)).toBeGreaterThan(1000);
  });
});
