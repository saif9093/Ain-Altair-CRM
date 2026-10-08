import { describe, expect, it } from "vitest";
import { parseNaturalQuery } from "@/lib/search/parse";
import { searchCriteriaSchema } from "@/lib/search/criteria";

describe("natural language search parsing", () => {
  it("parses the cleaning-companies example into structured criteria", () => {
    const r = parseNaturalQuery("Find small cleaning companies in Dubai with 20+ reviews, no website, active Instagram and WhatsApp.");
    const c = r.criteria;
    expect(c.categories[0].key).toBe("cleaning_services");
    expect(c.categories[0].terms).toEqual(expect.arrayContaining(["deep cleaning", "sofa cleaning", "janitorial"]));
    expect(c.locations).toHaveLength(1);
    expect(c.locations[0].label).toBe("Dubai");
    expect(c.business?.minReviews).toBe(20);
    expect(c.digital?.website).toEqual(["NO_WEBSITE"]);
    expect(c.digital?.instagram).toBe("ACTIVE");
    expect(c.contact?.whatsapp).toBe("REQUIRED");
    expect(c.business?.sizes).toContain("SMALL");
    expect(c.opportunities).toContain("NEW_WEBSITE");
    expect(() => searchCriteriaSchema.parse(c)).not.toThrow();
  });

  it("parses flower shops with outdated websites and review minimum", () => {
    const r = parseNaturalQuery("Find flower shops in Sharjah with outdated websites and at least 30 Google reviews.");
    expect(r.criteria.categories[0].key).toBe("flower_shops");
    expect(r.criteria.locations[0].label).toBe("Sharjah");
    expect(r.criteria.digital?.website).toEqual(["OUTDATED"]);
    expect(r.criteria.business?.minReviews).toBe(30);
    expect(r.criteria.opportunities).toContain("WEBSITE_REDESIGN");
  });

  it("parses restaurants around Al Barsha with multiple website states", () => {
    const r = parseNaturalQuery("Find restaurants around Al Barsha with no website or very poor mobile websites");
    expect(r.criteria.categories[0].key).toBe("restaurants");
    expect(r.criteria.locations[0].label).toBe("Al Barsha");
    expect(r.criteria.locations[0].city).toBe("Dubai");
    expect(r.criteria.digital?.website).toEqual(expect.arrayContaining(["NO_WEBSITE", "MOBILE_ISSUE"]));
  });

  it("supports radius searches", () => {
    const r = parseNaturalQuery("salons within 10 km of Downtown Dubai with 4.5 stars");
    expect(r.criteria.locations[0]!).toMatchObject({ kind: "RADIUS", radiusM: 10000, label: "Downtown Dubai" });
    expect(r.criteria.business?.minRating).toBe(4.5);
    expect(r.criteria.categories[0].key).toBe("salons");
  });

  it("supports multiple locations in one search", () => {
    const r = parseNaturalQuery("barbers in Dubai + Sharjah + Ajman");
    expect(r.criteria.locations.map((l) => l.label)).toEqual(["Dubai", "Sharjah", "Ajman"]);
  });

  it("does not treat a parent city as a second location", () => {
    const r = parseNaturalQuery("cleaning in Al Barsha, Dubai");
    expect(r.criteria.locations.map((l) => l.label)).toEqual(["Al Barsha"]);
  });

  it("handles places outside the UAE via free-form location", () => {
    const r = parseNaturalQuery("Find bakeries in Manchester with 50+ reviews", { defaultCountryCode: "GB" });
    expect(r.criteria.categories[0].key).toBe("bakeries");
    expect(r.criteria.locations[0].label).toBe("Manchester");
    expect(r.criteria.business?.minReviews).toBe(50);
  });

  it("interprets purchase intent as value + website opportunity, marked as estimate", () => {
    const r = parseNaturalQuery("Find small businesses in Abu Dhabi that are likely to pay AED 1,000 for a website.");
    expect(r.criteria.quality?.minOpportunityValue).toBe(1000);
    expect(r.criteria.output?.depth).toBe("DEEP");
    expect(r.criteria.digital?.website).toContain("NO_WEBSITE");
    expect(r.interpretations.find((i) => i.field === "Opportunity value")?.value).toMatch(/estimate/);
  });

  it("reads exclusions and franchise preferences", () => {
    const r = parseNaturalQuery("Cleaning in Dubai excluding industrial cleaning, no franchises");
    expect(r.criteria.excludeKeywords).toContain("industrial cleaning");
    expect(r.criteria.business?.franchise).toBe("EXCLUDE");
    expect((r.criteria.categories[0].terms ?? []).some((t) => /industrial/i.test(t))).toBe(false);
  });

  it("reads target counts", () => {
    expect(parseNaturalQuery("find 300 gyms in Dubai").criteria.output?.targetCount).toBe(300);
    expect(parseNaturalQuery("200 leads for dentists in Sharjah").criteria.output?.targetCount).toBe(200);
  });

  it("captures custom niches when no taxonomy category matches", () => {
    const r = parseNaturalQuery("Find yacht charter companies in Dubai Marina");
    expect(r.criteria.categories[0].key).toBeUndefined();
    expect(r.criteria.categories[0].label.toLowerCase()).toContain("yacht charter");
    expect(r.criteria.locations[0].label).toBe("Dubai Marina");
  });

  it("warns instead of guessing when location is missing", () => {
    const r = parseNaturalQuery("florists with no website");
    expect(r.criteria.locations).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/location/i);
  });
});
