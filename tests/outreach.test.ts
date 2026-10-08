import { describe, expect, it } from "vitest";
import { buildOutreachMessage } from "@/lib/intel/outreach";
import { factsToPrompt } from "@/lib/ai/lead-analysis";

describe("outreach message", () => {
  it("references only observed facts", () => {
    const m = buildOutreachMessage({ businessName: "Al Noor Cleaning", area: "Al Barsha", city: "Dubai", categoryLabel: "Cleaning Services", rating: 4.8, reviewCount: 112, websiteStatus: "NO_WEBSITE", instagramPresent: true });
    expect(m).toContain("4.8★ from 112 Google reviews");
    expect(m).toContain("beyond your Instagram");
    expect(m).toContain("Al Barsha");
  });
  it("omits claims when facts are missing", () => {
    const m = buildOutreachMessage({ businessName: "X", websiteStatus: "UNKNOWN" });
    expect(m).not.toMatch(/reviews|website isn't|Instagram/);
    expect(m).toMatch(/Would you be open/);
  });
  it("mentions broken websites by domain", () => {
    expect(buildOutreachMessage({ businessName: "X", websiteStatus: "BROKEN", websiteDomain: "x.ae" })).toContain("x.ae isn't loading");
  });
  it("builds AI prompts from facts with sources", () => {
    const p = factsToPrompt({ business: "X", category: "Salons", location: "Dubai", facts: [{ label: "Rating", value: "4.6", source: "google_places", confidence: "HIGH" }], websiteFindings: [], opportunities: [], pricing: { packages: [{ name: "Basic", min: 500, max: 750 }], currency: "AED" }, senderCompany: "Ain AlTair" });
    expect(p).toContain("Rating: 4.6 — google_places, HIGH");
    expect(p).toContain("Basic 500–750");
  });
});
