import { z } from "zod";
import type { SearchCriteria } from "@/lib/search/criteria";
import type { BusinessSignals } from "./types";
import { websiteMatchesFilter } from "./website-classify";

/**
 * Qualification against search criteria + research quality gates.
 * Unknown data never auto-rejects a business: it routes to REVIEW_REQUIRED so
 * a researcher decides. Only observed contradictions reject.
 */

export type RejectReason = "DUPLICATE" | "LARGE_COMPANY" | "FRANCHISE" | "NO_CONTACT" | "NOT_RELEVANT" | "EXCELLENT_WEBSITE" | "CLOSED" | "INVALID" | "LOW_QUALITY" | "OTHER";

export interface CheckResult {
  key: string;
  label: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN";
  detail: string;
  rejectReason?: RejectReason;
}

export interface QualificationResult {
  stage: "QUALIFIED" | "REVIEW_REQUIRED" | "REJECTED";
  checks: CheckResult[];
  rejectReason?: RejectReason;
}

export interface QualificationInput extends BusinessSignals {
  normalizedName: string;
  categoryLabel?: string | null;
  leadScore?: number | null;
  salesIntent?: number | null;
  opportunityValue?: number | null;
}

export function qualify(b: QualificationInput, c: SearchCriteria): QualificationResult {
  const checks: CheckResult[] = [];
  const push = (r: CheckResult) => checks.push(r);

  // Business active
  if (c.business.activeOnly) {
    if (b.businessStatus === "CLOSED_PERMANENTLY") push({ key: "active", label: "Business active", outcome: "FAIL", detail: "Listing marked permanently closed", rejectReason: "CLOSED" });
    else if (b.businessStatus === "CLOSED_TEMPORARILY") push({ key: "active", label: "Business active", outcome: "UNKNOWN", detail: "Temporarily closed" });
    else push({ key: "active", label: "Business active", outcome: b.businessStatus === "OPERATIONAL" ? "PASS" : "UNKNOWN", detail: b.businessStatus ?? "UNKNOWN" });
  }

  // Negative keywords
  const excl = c.excludeKeywords.map((k) => k.toLowerCase().trim()).filter(Boolean);
  const hay = `${b.normalizedName} ${(b.categoryLabel ?? "").toLowerCase()}`;
  const hit = excl.find((k) => hay.includes(k));
  if (hit) push({ key: "exclusions", label: "Exclusions", outcome: "FAIL", detail: `Matches excluded keyword "${hit}"`, rejectReason: "NOT_RELEVANT" });

  // Rating / reviews
  if (c.business.minRating != null) {
    if (b.rating == null) push({ key: "rating", label: `Rating ≥ ${c.business.minRating}`, outcome: "UNKNOWN", detail: "No rating data" });
    else push({ key: "rating", label: `Rating ≥ ${c.business.minRating}`, outcome: b.rating >= c.business.minRating ? "PASS" : "FAIL", detail: `${b.rating}★`, rejectReason: "LOW_QUALITY" });
  }
  if (c.business.minReviews != null) {
    if (b.reviewCount == null) push({ key: "reviews", label: `Reviews ≥ ${c.business.minReviews}`, outcome: "UNKNOWN", detail: "No review data" });
    else push({ key: "reviews", label: `Reviews ≥ ${c.business.minReviews}`, outcome: b.reviewCount >= c.business.minReviews ? "PASS" : "FAIL", detail: `${b.reviewCount} reviews`, rejectReason: "LOW_QUALITY" });
  }

  // Size & franchise
  if (c.business.sizes.length) {
    const sz = b.businessSize ?? "UNKNOWN";
    if (sz === "UNKNOWN") push({ key: "size", label: "Business size", outcome: c.business.sizes.includes("UNKNOWN") ? "PASS" : "UNKNOWN", detail: "Size unknown" });
    else push({ key: "size", label: "Business size", outcome: c.business.sizes.includes(sz) ? "PASS" : "FAIL", detail: sz, rejectReason: sz === "LARGE" || sz === "ENTERPRISE" ? "LARGE_COMPANY" : "NOT_RELEVANT" });
  }
  if (c.business.franchise === "EXCLUDE" && b.franchiseStatus === "FRANCHISE") push({ key: "franchise", label: "Independent only", outcome: "FAIL", detail: "Likely franchise/chain", rejectReason: "FRANCHISE" });
  if (c.business.franchise === "ONLY" && b.franchiseStatus !== "FRANCHISE") push({ key: "franchise", label: "Franchises only", outcome: b.franchiseStatus === "INDEPENDENT" ? "FAIL" : "UNKNOWN", detail: b.franchiseStatus ?? "UNKNOWN", rejectReason: "NOT_RELEVANT" });

  // Website
  const webFilters = c.digital.website.filter((w) => w !== "ANY");
  if (webFilters.length) {
    const results = webFilters.map((f) => websiteMatchesFilter(b.websiteStatus, b.websiteIssues, f));
    const label = `Website: ${webFilters.join(" or ").replace(/_/g, " ").toLowerCase()}`;
    if (results.some((r) => r === true)) push({ key: "website", label, outcome: "PASS", detail: (b.websiteStatus ?? "").replace(/_/g, " ").toLowerCase() });
    else if (results.every((r) => r === false)) push({ key: "website", label, outcome: "FAIL", detail: (b.websiteStatus ?? "").replace(/_/g, " ").toLowerCase(), rejectReason: b.websiteStatus === "GOOD" || b.websiteStatus === "HIGH_QUALITY" ? "EXCELLENT_WEBSITE" : "NOT_RELEVANT" });
    else push({ key: "website", label, outcome: "UNKNOWN", detail: "Website not assessed yet" });
  }
  if (c.digital.maxWebsiteScore != null && b.websiteScore != null) {
    push({ key: "website_score", label: `Website score ≤ ${c.digital.maxWebsiteScore}`, outcome: b.websiteScore <= c.digital.maxWebsiteScore ? "PASS" : "FAIL", detail: `${b.websiteScore}/100`, rejectReason: "EXCELLENT_WEBSITE" });
  }

  // Social
  const social = (label: string, key: "instagram" | "facebook", want: string) => {
    if (want === "ANY") return;
    const s = b[key];
    if (want === "PRESENT") push({ key, label: `${label} profile`, outcome: s?.present ? "PASS" : s === null ? "FAIL" : "UNKNOWN", detail: s?.present ? "found" : "not found", rejectReason: "NOT_RELEVANT" });
    if (want === "ACTIVE") {
      if (!s?.present) push({ key, label: `${label} active`, outcome: s === null ? "FAIL" : "UNKNOWN", detail: "no profile found", rejectReason: "NOT_RELEVANT" });
      else push({ key, label: `${label} active`, outcome: s.activity === "ACTIVE" ? "PASS" : s.activity === "INACTIVE" ? "FAIL" : "UNKNOWN", detail: s.activity === "UNKNOWN" ? "profile found, activity not verified" : s.activity.toLowerCase(), rejectReason: "NOT_RELEVANT" });
    }
    if (want === "INACTIVE") push({ key, label: `${label} inactive`, outcome: !s?.present || s.activity === "INACTIVE" ? "PASS" : s.activity === "ACTIVE" ? "FAIL" : "UNKNOWN", detail: s?.activity ?? "none", rejectReason: "NOT_RELEVANT" });
  };
  social("Instagram", "instagram", c.digital.instagram);
  social("Facebook", "facebook", c.digital.facebook);

  // Contactability
  if (c.contact.whatsapp === "REQUIRED") push({ key: "whatsapp", label: "WhatsApp available", outcome: b.hasWhatsapp ? "PASS" : b.websiteAudited || b.websiteStatus === "NO_WEBSITE" ? (b.phoneIsMobile ? "UNKNOWN" : "FAIL") : "UNKNOWN", detail: b.hasWhatsapp ? "verified WhatsApp link" : b.phoneIsMobile ? "mobile number listed, WhatsApp not verified" : "no WhatsApp evidence", rejectReason: "NO_CONTACT" });
  if (c.contact.phone === "REQUIRED") push({ key: "phone", label: "Phone available", outcome: b.hasPhone ? "PASS" : "FAIL", detail: b.hasPhone ? "phone found" : "no phone", rejectReason: "NO_CONTACT" });
  if (c.contact.email === "REQUIRED") push({ key: "email", label: "Email available", outcome: b.hasEmail ? "PASS" : b.websiteAudited ? "FAIL" : "UNKNOWN", detail: b.hasEmail ? "email found" : "no email found", rejectReason: "NO_CONTACT" });
  if (c.contact.social === "REQUIRED") push({ key: "social", label: "Social profile", outcome: b.instagram?.present || b.facebook?.present || (b.otherSocialCount ?? 0) > 0 ? "PASS" : "UNKNOWN", detail: "", rejectReason: "NO_CONTACT" });
  if (!b.hasPhone && !b.hasWhatsapp && !b.hasEmail && !b.instagram?.present && !b.facebook?.present) {
    push({ key: "contactable", label: "Any contact method", outcome: b.websiteAudited || b.websiteStatus === "NO_WEBSITE" ? "FAIL" : "UNKNOWN", detail: "no contact method found", rejectReason: "NO_CONTACT" });
  }

  // Score thresholds
  if (c.quality.minLeadScore != null && b.leadScore != null) push({ key: "lead_score", label: `Lead score ≥ ${c.quality.minLeadScore}`, outcome: b.leadScore >= c.quality.minLeadScore ? "PASS" : "FAIL", detail: String(b.leadScore), rejectReason: "LOW_QUALITY" });
  if (c.quality.minSalesIntent != null && b.salesIntent != null) push({ key: "sales_intent", label: `Sales intent ≥ ${c.quality.minSalesIntent} (estimate)`, outcome: b.salesIntent >= c.quality.minSalesIntent ? "PASS" : "FAIL", detail: String(b.salesIntent), rejectReason: "LOW_QUALITY" });
  if (c.quality.minOpportunityValue != null && b.opportunityValue != null) push({ key: "value", label: `Opportunity ≥ ${c.quality.minOpportunityValue} (estimate)`, outcome: b.opportunityValue >= c.quality.minOpportunityValue ? "PASS" : "FAIL", detail: String(b.opportunityValue), rejectReason: "LOW_QUALITY" });

  const fail = checks.find((x) => x.outcome === "FAIL");
  if (fail) return { stage: "REJECTED", checks, rejectReason: fail.rejectReason ?? "OTHER" };
  if (checks.some((x) => x.outcome === "UNKNOWN")) return { stage: "REVIEW_REQUIRED", checks };
  return { stage: "QUALIFIED", checks };
}

// ---------------------------------------------------------------------------
// Research quality gates (RESEARCH → CRM). Configurable per organisation.
// ---------------------------------------------------------------------------
export const qualityGatesSchema = z.object({
  requireCategory: z.boolean().default(true),
  requireLocation: z.boolean().default(true),
  requireContactMethod: z.boolean().default(true),
  requireSource: z.boolean().default(true),
  requireReason: z.boolean().default(true),
  hot: z.object({
    requireLeadScore: z.boolean().default(true),
    requireOpportunity: z.boolean().default(true),
    requireContactability: z.boolean().default(true),
  }).default({}),
});
export type QualityGates = z.infer<typeof qualityGatesSchema>;
export const DEFAULT_GATES: QualityGates = qualityGatesSchema.parse({});

export interface GateSubject {
  name?: string | null;
  categoryKey?: string | null;
  categoryLabel?: string | null;
  city?: string | null;
  area?: string | null;
  address?: string | null;
  lat?: number | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  socialCount?: number;
  source?: string | null;
  reason?: string | null;       // why qualified (opportunity reason / why contact)
  leadScore?: number | null;
  tier?: string | null;
  opportunityCount?: number;
}

export function checkQualityGates(b: GateSubject, g: QualityGates = DEFAULT_GATES): { passed: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!b.name?.trim()) missing.push("Business identity (name)");
  if (g.requireCategory && !b.categoryKey && !b.categoryLabel) missing.push("Category");
  if (g.requireLocation && !b.city && !b.area && !b.address && b.lat == null) missing.push("Location");
  const contactable = !!(b.phone || b.whatsapp || b.email || (b.socialCount ?? 0) > 0);
  if (g.requireContactMethod && !contactable) missing.push("Phone or other contact method");
  if (g.requireSource && !b.source) missing.push("Source");
  if (g.requireReason && !b.reason?.trim()) missing.push("Reason for qualification");
  if (b.tier === "HOT") {
    if (g.hot.requireLeadScore && b.leadScore == null) missing.push("Lead score (HOT)");
    if (g.hot.requireOpportunity && !b.opportunityCount) missing.push("Opportunity (HOT)");
    if (g.hot.requireContactability && !(b.phone || b.whatsapp)) missing.push("Direct contactability (HOT)");
  }
  return { passed: missing.length === 0, missing };
}
