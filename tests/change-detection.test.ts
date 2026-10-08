import { describe, expect, it } from "vitest";
import { diffSnapshots, type BusinessSnapshot } from "@/lib/research/change-detection";

const base: BusinessSnapshot = { website_domain: null, website_status: "NO_WEBSITE", google_rating: 4.5, google_review_count: 40, business_status: "OPERATIONAL", phone_e164: "+971501234567", whatsapp_e164: null, instagram_present: true, instagram_activity: "INACTIVE", lead_score: 80 };

describe("change detection", () => {
  it("returns nothing for the first observation", () => {
    expect(diffSnapshots(null, base)).toEqual([]);
  });
  it("flags a newly detected website", () => {
    const c = diffSnapshots(base, { ...base, website_domain: "example.ae", website_status: "GOOD" });
    expect(c[0]).toMatchObject({ type: "WEBSITE_DETECTED", alert: true });
  });
  it("flags good → broken and good → outdated as new opportunities", () => {
    const good = { ...base, website_domain: "x.ae", website_status: "GOOD" };
    expect(diffSnapshots(good, { ...good, website_status: "BROKEN" }).map((c) => c.type)).toContain("WEBSITE_BROKEN");
    expect(diffSnapshots(good, { ...good, website_status: "OUTDATED" }).map((c) => c.type)).toContain("NEW_OPPORTUNITY");
  });
  it("detects review growth, rating change, social activation and closure", () => {
    const c = diffSnapshots(base, { ...base, google_review_count: 60, google_rating: 4.8, instagram_activity: "ACTIVE", business_status: "CLOSED_PERMANENTLY" });
    expect(c.map((x) => x.type)).toEqual(expect.arrayContaining(["REVIEW_GROWTH", "RATING_CHANGED", "SOCIAL_ACTIVATED", "BUSINESS_CLOSED"]));
  });
});
