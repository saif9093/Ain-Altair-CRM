import { describe, expect, it } from "vitest";
import { assessDuplicate, nameSimilarity, DUPLICATE_THRESHOLDS } from "@/lib/dedup/similarity";
import { decideField, overallConfidence } from "@/lib/dedup/provenance";

describe("entity resolution", () => {
  it("recognises name variants of the same business", () => {
    expect(nameSimilarity("Al Noor Cleaning Services", "Al Noor Cleaning Service LLC")).toBeGreaterThan(0.95);
    expect(nameSimilarity("Al Noor Cleaning", "Al Noor Cleaning Service LLC")).toBeGreaterThan(0.88);
    expect(nameSimilarity("Al Noor Cleaning", "Blue Sky Flowers")).toBeLessThan(0.55);
  });
  it("hard-matches on Google place id", () => {
    const r = assessDuplicate({ name: "X", googlePlaceId: "abc" }, { name: "Y Different", googlePlaceId: "abc" });
    expect(r.hardMatch).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLDS.autoLink);
  });
  it("hard-matches on phone + similar name", () => {
    const r = assessDuplicate(
      { name: "Al Noor Cleaning Services", phoneE164: "+971501234567" },
      { name: "Al Noor Cleaning", phoneE164: "+971501234567" },
    );
    expect(r.hardMatch).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(95);
  });
  it("does not hard-match on a shared phone with unrelated names", () => {
    const r = assessDuplicate({ name: "Al Noor Cleaning", phoneE164: "+97141234567" }, { name: "Golden Bakery", phoneE164: "+97141234567" });
    expect(r.hardMatch).toBe(false);
    expect(r.confidence).toBeLessThan(DUPLICATE_THRESHOLDS.autoLink);
  });
  it("flags similar names nearby as possible duplicates for review (not auto-merge)", () => {
    const r = assessDuplicate(
      { name: "Al Noor Cleaning", lat: 25.1, lng: 55.2 },
      { name: "Al Noor Cleaning Services LLC", lat: 25.1002, lng: 55.2001 },
    );
    expect(r.hardMatch).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLDS.review);
    expect(r.confidence).toBeLessThan(DUPLICATE_THRESHOLDS.autoLink);
  });
  it("penalises far-apart branches with the same name", () => {
    const r = assessDuplicate({ name: "Rose Florist", lat: 25.2, lng: 55.3 }, { name: "Rose Florist", lat: 24.4, lng: 54.4 });
    expect(r.confidence).toBeLessThan(DUPLICATE_THRESHOLDS.review);
  });
});

describe("provenance merge rules", () => {
  const t1 = "2026-10-01T00:00:00Z";
  const t2 = "2026-10-05T00:00:00Z";
  it("never overwrites strong data with weaker data", () => {
    expect(decideField({ value: "+971501", confidence: "HIGH", provider: "google_places", retrievedAt: t1 }, { value: "+971999", confidence: "LOW", provider: "brave_search", retrievedAt: t2 })).toBe("KEEP_CURRENT");
  });
  it("takes stronger or newer equal-confidence data", () => {
    expect(decideField({ value: "a", confidence: "MEDIUM", provider: "osm", retrievedAt: t2 }, { value: "b", confidence: "HIGH", provider: "google_places", retrievedAt: t1 })).toBe("TAKE_INCOMING");
    expect(decideField({ value: "a", confidence: "HIGH", provider: "x", retrievedAt: t1 }, { value: "b", confidence: "HIGH", provider: "y", retrievedAt: t2 })).toBe("TAKE_INCOMING");
  });
  it("manual overrides win and empty values never erase", () => {
    expect(decideField({ value: "manual", confidence: "HIGH", provider: "manual", retrievedAt: t1, manual: true }, { value: "auto", confidence: "HIGH", provider: "google_places", retrievedAt: t2 })).toBe("KEEP_CURRENT");
    expect(decideField({ value: "a", confidence: "LOW", provider: "x", retrievedAt: t1 }, { value: "", confidence: "HIGH", provider: "y", retrievedAt: t2 })).toBe("KEEP_CURRENT");
  });
  it("summarises overall confidence", () => {
    expect(overallConfidence({ phone: "HIGH", email: "HIGH", instagram: "MEDIUM" })).toBe("HIGH");
    expect(overallConfidence({})).toBe("UNKNOWN");
  });
});
