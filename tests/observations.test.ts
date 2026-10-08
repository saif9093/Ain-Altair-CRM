import { describe, expect, it } from "vitest";
import { observationsFromRaw, mergeObservations } from "@/lib/research/observations";
import type { RawBusiness } from "@/lib/providers/types";

const google: RawBusiness = {
  provider: "google_places", externalId: "pid1", name: "AL NOOR CLEANING SERVICES LLC", categoryLabels: ["Cleaning service"],
  phone: "+971 50 123 4567", website: "https://www.instagram.com/alnoor.cleaning", address: "Al Barsha 1, Dubai", city: "Dubai", countryCode: "AE",
  lat: 25.11, lng: 55.2, rating: 4.8, reviewCount: 112, googlePlaceId: "pid1", googleMapsUrl: "https://maps.google.com/?cid=1", businessStatus: "OPERATIONAL", raw: {},
};

describe("observations & provenance merge", () => {
  it("normalises provider data; social links are not treated as websites", () => {
    const n = observationsFromRaw(google, "AE", "2026-10-01T00:00:00Z");
    expect(n.observations.find((o) => o.field === "website")).toBeUndefined();
    expect(n.socials[0]).toMatchObject({ platform: "INSTAGRAM", username: "alnoor.cleaning" });
    expect(n.observations.find((o) => o.field === "phone")?.value).toMatchObject({ e164: "+971501234567" });
    expect(n.observations.find((o) => o.field === "name")?.confidence).toBe("HIGH");
  });
  it("creates a full patch for a new record", () => {
    const n = observationsFromRaw(google, "AE", "2026-10-01T00:00:00Z");
    const m = mergeObservations(null, {}, n.observations);
    expect(m.patch).toMatchObject({ phone_e164: "+971501234567", google_rating: 4.8, google_place_id: "pid1", lat: 25.11 });
    expect(m.fieldConfidence.phone?.confidence).toBe("HIGH");
    expect(m.overall).toBe("HIGH");
  });
  it("does not let weaker OSM data overwrite Google data", () => {
    const g = mergeObservations(null, {}, observationsFromRaw(google, "AE", "2026-10-01T00:00:00Z").observations);
    const row: Record<string, unknown> = { ...g.patch };
    const osm: RawBusiness = { provider: "osm_overpass", externalId: "node/1", name: "Al Noor Cleaning", categoryLabels: [], phone: "+971 4 331 2345", raw: {} };
    const m = mergeObservations(row, g.fieldConfidence, observationsFromRaw(osm, "AE", "2026-10-05T00:00:00Z").observations);
    expect(m.patch.phone_e164).toBeUndefined();
    expect(m.rejected.map((r) => r.field)).toContain("phone");
  });
  it("fills gaps from weaker sources", () => {
    const g = mergeObservations(null, {}, observationsFromRaw({ ...google, phone: null }, "AE", "2026-10-01T00:00:00Z").observations);
    const row: Record<string, unknown> = { ...g.patch };
    const osm: RawBusiness = { provider: "osm_overpass", externalId: "node/1", name: "Al Noor Cleaning", categoryLabels: [], phone: "+971 4 331 2345", raw: {} };
    const m = mergeObservations(row, g.fieldConfidence, observationsFromRaw(osm, "AE", "2026-10-05T00:00:00Z").observations);
    expect(m.patch.phone_e164).toBe("+97143312345");
    expect(m.fieldConfidence.phone?.confidence).toBe("MEDIUM");
  });
  it("respects manual values", () => {
    const row = { phone_e164: "+971500000000" };
    const m = mergeObservations(row, { phone: { confidence: "HIGH", provider: "manual", at: "2026-01-01T00:00:00Z", manual: true } }, observationsFromRaw(google, "AE").observations);
    expect(m.patch.phone_e164).toBeUndefined();
  });
});
