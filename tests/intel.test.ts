import { describe, expect, it } from "vitest";
import { classifyWebsite, classifyNoWebsite, websiteMatchesFilter } from "@/lib/intel/website-classify";
import { computeLeadScore, computeSalesIntent, tierFor, DEFAULT_SCORING, scoringConfigSchema } from "@/lib/intel/scoring";
import { buildOpportunities } from "@/lib/intel/opportunities";
import { qualify, checkQualityGates } from "@/lib/intel/qualification";
import { classifyBusinessSize, detectFranchise } from "@/lib/intel/classify-business";
import { searchCriteriaSchema } from "@/lib/search/criteria";

const NOW = new Date("2026-10-08T00:00:00Z");
const goodAudit = {
  requestedUrl: "https://good.ae", reachable: true, httpStatus: 200, https: true, sslValid: true, hasViewport: true,
  title: "Good Cleaning Dubai", metaDescription: "Best cleaning", h1Count: 1, hasCta: true, hasWhatsapp: true, hasForm: true,
  hasBooking: true, hasServices: true, hasContact: true, hasPhoneLink: true, hasEmail: true, navLinkCount: 8, imageCount: 10,
  imagesMissingAlt: 1, copyrightYear: 2026, pageBytes: 80000, perfMeasured: true, performanceScore: 85, seoScore: 95,
};

describe("website classification", () => {
  it("classifies an unreachable site as BROKEN with measured evidence", () => {
    const r = classifyWebsite({ requestedUrl: "https://x.ae", reachable: false, error: "ENOTFOUND" }, { now: NOW });
    expect(r.status).toBe("BROKEN");
    expect(r.evidence[0].measured).toBe(true);
  });
  it("classifies HTTP 500 as BROKEN", () => {
    expect(classifyWebsite({ requestedUrl: "https://x.ae", reachable: true, httpStatus: 500 }, { now: NOW }).status).toBe("BROKEN");
  });
  it("classifies a modern complete site as HIGH_QUALITY", () => {
    const r = classifyWebsite(goodAudit, { categoryKey: "cleaning_services", now: NOW });
    expect(r.status).toBe("HIGH_QUALITY");
    expect(r.score).toBeGreaterThanOrEqual(90);
  });
  it("flags outdated sites from multiple observed signals", () => {
    const r = classifyWebsite({ ...goodAudit, hasViewport: false, copyrightYear: 2016, https: false, perfMeasured: false }, { now: NOW });
    expect(r.status).toBe("OUTDATED");
    expect(r.issues).toEqual(expect.arrayContaining(["NO_VIEWPORT", "OUTDATED_COPYRIGHT", "NO_SSL"]));
    expect(r.evidence.find((e) => e.code === "OUTDATED")?.detail).toMatch(/copyright 2016/);
  });
  it("never calls a site SLOW without measured data", () => {
    const r = classifyWebsite({ ...goodAudit, perfMeasured: false, performanceScore: null, responseMs: 9000 }, { now: NOW });
    expect(r.issues).not.toContain("SLOW_MEASURED");
    expect(r.status).not.toBe("SLOW");
  });
  it("calls a site SLOW only with Lighthouse evidence", () => {
    const r = classifyWebsite({ ...goodAudit, performanceScore: 30, lcpMs: 6200 }, { now: NOW });
    expect(r.issues).toContain("SLOW_MEASURED");
    expect(r.evidence.find((e) => e.code === "SLOW")?.source).toBe("pagespeed");
  });
  it("detects missing conversion features", () => {
    const r = classifyWebsite({ ...goodAudit, hasCta: false, hasWhatsapp: false, hasBooking: false, hasForm: false }, { categoryKey: "salons", now: NOW });
    expect(r.issues).toEqual(expect.arrayContaining(["MISSING_CTA", "MISSING_WHATSAPP", "MISSING_BOOKING"]));
    expect(r.status).toBe("MISSING_FUNCTIONALITY");
  });
  it("records evidence for no-website classification", () => {
    const r = classifyNoWebsite(["Google Places listing", "web search"]);
    expect(r.status).toBe("NO_WEBSITE");
    expect(r.evidence[0].detail).toMatch(/Google Places listing/);
  });
  it("maps classifications to search filters, unknown → null", () => {
    expect(websiteMatchesFilter("NO_WEBSITE", [], "NO_WEBSITE")).toBe(true);
    expect(websiteMatchesFilter("GOOD", [], "NO_WEBSITE")).toBe(false);
    expect(websiteMatchesFilter("UNKNOWN", [], "OUTDATED")).toBeNull();
    expect(websiteMatchesFilter("AVERAGE", ["OUTDATED_COPYRIGHT"], "OUTDATED")).toBe(true);
  });
});

describe("lead scoring", () => {
  const hot = {
    name: "Al Noor", rating: 4.8, reviewCount: 112, businessStatus: "OPERATIONAL" as const, hasPhone: true, hasWhatsapp: true, hasEmail: true,
    websiteStatus: "NO_WEBSITE" as const, instagram: { present: true, activity: "ACTIVE" as const, followers: 3500 }, facebook: { present: true, activity: "ACTIVE" as const },
  };
  it("matches the default 100-point model", () => {
    const s = computeLeadScore(hot);
    expect(s.total).toBe(100);
    expect(s.tier).toBe("HOT");
    expect(s.components.map((c) => c.key)).toEqual(["reviews", "rating", "website", "social", "contact", "activity"]);
  });
  it("scores good websites with no website-opportunity points", () => {
    const s = computeLeadScore({ ...hot, websiteStatus: "GOOD" });
    expect(s.components.find((c) => c.key === "website")!.points).toBe(0);
    expect(s.total).toBe(65);
  });
  it("gives zero to permanently closed businesses", () => {
    expect(computeLeadScore({ ...hot, businessStatus: "CLOSED_PERMANENTLY" }).total).toBe(0);
  });
  it("uses configurable weights and tiers", () => {
    const cfg = scoringConfigSchema.parse({ tiers: { HOT: 95 } });
    expect(tierFor(92, cfg)).toBe("HIGH");
    expect(tierFor(92, DEFAULT_SCORING)).toBe("HOT");
    expect(tierFor(59)).toBe("LOW");
  });
  it("treats unverified Instagram activity as partial credit", () => {
    const s = computeLeadScore({ ...hot, instagram: { present: true, activity: "UNKNOWN" }, facebook: null });
    expect(s.components.find((c) => c.key === "social")!.points).toBe(5);
  });
  it("labels sales intent as a heuristic estimate and penalises franchises", () => {
    const si = computeSalesIntent({ ...hot, categoryValueMultiplier: 1.1 });
    expect(si.method).toBe("HEURISTIC_ESTIMATE");
    expect(si.score).toBeGreaterThan(70);
    const fr = computeSalesIntent({ ...hot, franchiseStatus: "FRANCHISE" });
    expect(fr.score).toBeLessThan(si.score);
  });
});

describe("opportunity engine", () => {
  it("recommends a new website with upsells for no-website businesses", () => {
    const plan = buildOpportunities({ name: "x", categoryKey: "salons", reviewCount: 120, rating: 4.7, websiteStatus: "NO_WEBSITE", phoneIsMobile: true, businessStatus: "OPERATIONAL" });
    expect(plan.primary?.type).toBe("NEW_WEBSITE");
    expect(plan.upsells).toEqual(expect.arrayContaining(["BOOKING_SYSTEM"]));
    expect(plan.priceMin).toBeGreaterThan(0);
    expect(plan.estimatedValue).toBeGreaterThan(plan.priceMax!);
  });
  it("recommends a fix for broken websites", () => {
    expect(buildOpportunities({ name: "x", websiteStatus: "BROKEN" }).primary?.type).toBe("WEBSITE_FIX");
  });
  it("creates multiple opportunities from website issues", () => {
    const plan = buildOpportunities({ name: "x", categoryKey: "restaurants", websiteStatus: "MISSING_FUNCTIONALITY", websiteIssues: ["WEAK_SEO", "MISSING_WHATSAPP", "MISSING_BOOKING"] });
    const types = plan.opportunities.map((o) => o.type);
    expect(types).toEqual(expect.arrayContaining(["SEO", "WHATSAPP_INTEGRATION", "BOOKING_SYSTEM", "DIGITAL_MENU"]));
  });
});

describe("qualification", () => {
  const criteria = searchCriteriaSchema.parse({
    categories: [{ key: "cleaning_services", label: "Cleaning Services", terms: ["cleaning"] }],
    locations: [{ label: "Dubai", kind: "NAMED" }],
    business: { minReviews: 20, minRating: 4.0 },
    digital: { website: ["NO_WEBSITE", "POOR"], instagram: "ACTIVE" },
    contact: { whatsapp: "PREFERRED" },
  });
  const base = { name: "A", normalizedName: "a", reviewCount: 50, rating: 4.5, businessStatus: "OPERATIONAL" as const, hasPhone: true, websiteStatus: "NO_WEBSITE" as const, instagram: { present: true, activity: "ACTIVE" as const } };
  it("qualifies a matching business", () => {
    expect(qualify(base, criteria).stage).toBe("QUALIFIED");
  });
  it("rejects observed contradictions with a reason", () => {
    const r = qualify({ ...base, reviewCount: 5 }, criteria);
    expect(r.stage).toBe("REJECTED");
    expect(r.rejectReason).toBe("LOW_QUALITY");
    expect(qualify({ ...base, websiteStatus: "HIGH_QUALITY" }, criteria).rejectReason).toBe("EXCELLENT_WEBSITE");
  });
  it("routes unknowns to review instead of rejecting", () => {
    expect(qualify({ ...base, websiteStatus: "UNKNOWN" }, criteria).stage).toBe("REVIEW_REQUIRED");
    expect(qualify({ ...base, instagram: { present: true, activity: "UNKNOWN" } }, criteria).stage).toBe("REVIEW_REQUIRED");
  });
  it("applies exclusions and franchise rules", () => {
    const c2 = searchCriteriaSchema.parse({ ...criteria, excludeKeywords: ["industrial"], business: { franchise: "EXCLUDE" } });
    expect(qualify({ ...base, normalizedName: "abc industrial cleaning" }, c2).stage).toBe("REJECTED");
    expect(qualify({ ...base, franchiseStatus: "FRANCHISE" }, c2).rejectReason).toBe("FRANCHISE");
  });
  it("enforces research quality gates, stricter for HOT", () => {
    expect(checkQualityGates({ name: "A", categoryKey: "x", city: "Dubai", phone: "+971", source: "google_places", reason: "No website" }).passed).toBe(true);
    const r = checkQualityGates({ name: "A", categoryKey: "x", city: "Dubai", email: "a@b.ae", source: "s", reason: "r", tier: "HOT", leadScore: 92, opportunityCount: 0 });
    expect(r.passed).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(["Opportunity (HOT)", "Direct contactability (HOT)"]));
  });
});

describe("business size & franchise", () => {
  it("uses only observable signals and returns UNKNOWN without data", () => {
    expect(classifyBusinessSize({}).size).toBe("UNKNOWN");
    expect(classifyBusinessSize({ reviewCount: 8, hasWebsite: false }).size).toBe("MICRO");
    expect(classifyBusinessSize({ reviewCount: 120 }).size).toBe("SMALL");
    expect(classifyBusinessSize({ reviewCount: 50, isKnownChain: true }).size).toBe("ENTERPRISE");
  });
  it("detects franchises from names and repeated locations", () => {
    expect(detectFranchise({ normalizedName: "starbucks dubai mall" }).status).toBe("FRANCHISE");
    expect(detectFranchise({ normalizedName: "rose petals", sameNameLocationCount: 4 }).status).toBe("FRANCHISE");
    expect(detectFranchise({ normalizedName: "rose petals", sameNameLocationCount: 1 }).status).toBe("INDEPENDENT");
  });
});
