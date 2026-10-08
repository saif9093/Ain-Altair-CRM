import { z } from "zod";
import type { BusinessSignals, WebsiteStatus } from "./types";

/**
 * Lead Score (0–100) — configurable, explainable. Defaults follow the Ain
 * AlTair model: Business quality 20 · Website opportunity 35 · Social 15 ·
 * Contactability 20 · Activity 10.
 */

export const scoringConfigSchema = z.object({
  reviews: z.object({
    max: z.number().default(10),
    bands: z.array(z.object({ min: z.number(), points: z.number() })).default([
      { min: 100, points: 10 }, { min: 50, points: 8 }, { min: 20, points: 6 }, { min: 10, points: 4 }, { min: 1, points: 2 },
    ]),
  }).default({}),
  rating: z.object({
    max: z.number().default(10),
    bands: z.array(z.object({ min: z.number(), points: z.number() })).default([
      { min: 4.7, points: 10 }, { min: 4.5, points: 9 }, { min: 4.2, points: 7 }, { min: 4.0, points: 6 }, { min: 3.5, points: 3 },
    ]),
  }).default({}),
  website: z.record(z.string(), z.number()).default({
    NO_WEBSITE: 35, BROKEN: 32, OUTDATED: 30, MOBILE_ISSUE: 27, POOR_DESIGN: 23, MISSING_FUNCTIONALITY: 20,
    SLOW: 20, AVERAGE: 10, GOOD: 0, HIGH_QUALITY: 0, UNKNOWN: 0,
  }),
  social: z.object({
    instagramActive: z.number().default(10),
    instagramPresent: z.number().default(5),
    facebookActive: z.number().default(5),
    facebookPresent: z.number().default(2),
    max: z.number().default(15),
  }).default({}),
  contact: z.object({
    whatsapp: z.number().default(10),
    phone: z.number().default(5),
    email: z.number().default(5),
  }).default({}),
  activity: z.object({
    activeGoogleProfile: z.number().default(5),
    activeSocial: z.number().default(5),
  }).default({}),
  tiers: z.object({
    HOT: z.number().default(90),
    HIGH: z.number().default(80),
    GOOD: z.number().default(70),
    MEDIUM: z.number().default(60),
  }).default({}),
});
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
export const DEFAULT_SCORING: ScoringConfig = scoringConfigSchema.parse({});

export type Tier = "HOT" | "HIGH" | "GOOD" | "MEDIUM" | "LOW";

export interface ScoreBreakdown {
  total: number;
  tier: Tier;
  components: { key: string; label: string; points: number; max: number; reason: string }[];
}

function band(value: number | null | undefined, bands: { min: number; points: number }[]): number {
  if (value == null) return 0;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  for (const b of sorted) if (value >= b.min) return b.points;
  return 0;
}

export function tierFor(score: number, cfg: ScoringConfig = DEFAULT_SCORING): Tier {
  if (score >= cfg.tiers.HOT) return "HOT";
  if (score >= cfg.tiers.HIGH) return "HIGH";
  if (score >= cfg.tiers.GOOD) return "GOOD";
  if (score >= cfg.tiers.MEDIUM) return "MEDIUM";
  return "LOW";
}

export function computeLeadScore(s: BusinessSignals, cfg: ScoringConfig = DEFAULT_SCORING): ScoreBreakdown {
  const components: ScoreBreakdown["components"] = [];

  const reviewPts = Math.min(cfg.reviews.max, band(s.reviewCount, cfg.reviews.bands));
  components.push({ key: "reviews", label: "Reviews", points: reviewPts, max: cfg.reviews.max,
    reason: s.reviewCount != null ? `${s.reviewCount} reviews` : "Review count unknown" });

  const ratingPts = Math.min(cfg.rating.max, band(s.rating, cfg.rating.bands));
  components.push({ key: "rating", label: "Rating", points: ratingPts, max: cfg.rating.max,
    reason: s.rating != null ? `${s.rating.toFixed(1)}★` : "Rating unknown" });

  const status: WebsiteStatus = s.websiteStatus ?? "UNKNOWN";
  const webMax = Math.max(...Object.values(cfg.website));
  const webPts = cfg.website[status] ?? 0;
  components.push({ key: "website", label: "Website opportunity", points: webPts, max: webMax,
    reason: status === "UNKNOWN" ? "Website not yet assessed" : status.replace(/_/g, " ").toLowerCase() });

  let socialPts = 0;
  const socialReasons: string[] = [];
  if (s.instagram?.present) {
    if (s.instagram.activity === "ACTIVE") { socialPts += cfg.social.instagramActive; socialReasons.push("active Instagram"); }
    else if (s.instagram.activity === "UNKNOWN") { socialPts += cfg.social.instagramPresent; socialReasons.push("Instagram profile (activity unverified)"); }
    else socialReasons.push("inactive Instagram");
  }
  if (s.facebook?.present) {
    if (s.facebook.activity === "ACTIVE") { socialPts += cfg.social.facebookActive; socialReasons.push("active Facebook"); }
    else if (s.facebook.activity === "UNKNOWN") { socialPts += cfg.social.facebookPresent; socialReasons.push("Facebook page (activity unverified)"); }
  }
  socialPts = Math.min(cfg.social.max, socialPts);
  components.push({ key: "social", label: "Social presence", points: socialPts, max: cfg.social.max,
    reason: socialReasons.length ? socialReasons.join(", ") : "No social profiles found" });

  let contactPts = 0;
  const contactReasons: string[] = [];
  if (s.hasWhatsapp) { contactPts += cfg.contact.whatsapp; contactReasons.push("WhatsApp"); }
  if (s.hasPhone) { contactPts += cfg.contact.phone; contactReasons.push("phone"); }
  if (s.hasEmail) { contactPts += cfg.contact.email; contactReasons.push("email"); }
  const contactMax = cfg.contact.whatsapp + cfg.contact.phone + cfg.contact.email;
  components.push({ key: "contact", label: "Contactability", points: contactPts, max: contactMax,
    reason: contactReasons.length ? contactReasons.join(" + ") : "No verified contact method" });

  let activityPts = 0;
  const actReasons: string[] = [];
  if (s.businessStatus === "OPERATIONAL" && (s.reviewCount ?? 0) > 0) { activityPts += cfg.activity.activeGoogleProfile; actReasons.push("operational listing with reviews"); }
  if (s.instagram?.activity === "ACTIVE" || s.facebook?.activity === "ACTIVE") { activityPts += cfg.activity.activeSocial; actReasons.push("recent social activity"); }
  components.push({ key: "activity", label: "Activity", points: activityPts, max: cfg.activity.activeGoogleProfile + cfg.activity.activeSocial,
    reason: actReasons.length ? actReasons.join(", ") : "No activity signals observed" });

  let total = components.reduce((a, c) => a + c.points, 0);
  if (s.businessStatus === "CLOSED_PERMANENTLY") total = 0;
  total = Math.max(0, Math.min(100, Math.round(total)));
  return { total, tier: tierFor(total, cfg), components };
}

/**
 * Sales Intent (0–100) — an ESTIMATE of buying potential from observable
 * signals. Always presented with an "Estimate" label; never a fact.
 */
export interface SalesIntent {
  score: number;
  method: "HEURISTIC_ESTIMATE";
  factors: { key: string; label: string; points: number; max: number; reason: string }[];
}

export function computeSalesIntent(s: BusinessSignals): SalesIntent {
  const f: SalesIntent["factors"] = [];
  const severity: Record<string, number> = {
    NO_WEBSITE: 25, BROKEN: 24, OUTDATED: 21, MOBILE_ISSUE: 19, POOR_DESIGN: 18, SLOW: 15, MISSING_FUNCTIONALITY: 14, AVERAGE: 7, GOOD: 2, HIGH_QUALITY: 0, UNKNOWN: 6,
  };
  const st = s.websiteStatus ?? "UNKNOWN";
  f.push({ key: "problem", label: "Website problem severity", points: severity[st] ?? 6, max: 25, reason: st.replace(/_/g, " ").toLowerCase() });

  const reviews = s.reviewCount ?? 0;
  const visibility = Math.min(20, Math.round(Math.log10(reviews + 1) * 8) + (s.rating && s.rating >= 4.3 ? 3 : 0));
  f.push({ key: "visibility", label: "Business activity & visibility", points: visibility, max: 20, reason: `${reviews} reviews${s.rating ? `, ${s.rating}★` : ""}` });

  const followers = (s.instagram?.followers ?? 0) + (s.facebook?.followers ?? 0);
  let social = 0;
  if (s.instagram?.present || s.facebook?.present) social += 5;
  if (s.instagram?.activity === "ACTIVE" || s.facebook?.activity === "ACTIVE") social += 5;
  if (followers > 0) social += Math.min(5, Math.round(Math.log10(followers + 1) * 1.5));
  f.push({ key: "social", label: "Social engagement", points: Math.min(15, social), max: 15, reason: followers ? `${followers.toLocaleString()} followers observed` : s.instagram?.present ? "social profile present" : "no social profiles" });

  let contact = 0;
  if (s.hasWhatsapp) contact += 8;
  if (s.hasPhone) contact += 4;
  if (s.hasEmail) contact += 3;
  f.push({ key: "contact", label: "Ease of contact", points: Math.min(15, contact), max: 15, reason: [s.hasWhatsapp && "WhatsApp", s.hasPhone && "phone", s.hasEmail && "email"].filter(Boolean).join(", ") || "none verified" });

  const mult = s.categoryValueMultiplier ?? 1;
  const commercial = Math.max(0, Math.min(15, Math.round((mult - 0.7) * 20)));
  f.push({ key: "commercial", label: "Commercial category value", points: commercial, max: 15, reason: `category value ×${mult.toFixed(2)}` });

  // Digital maturity gap: invests in social/reviews but lacks an owned site.
  const gap = (s.instagram?.present || reviews >= 30) && ["NO_WEBSITE", "BROKEN", "OUTDATED", "MOBILE_ISSUE", "POOR_DESIGN"].includes(st) ? 10 : 0;
  f.push({ key: "gap", label: "Digital maturity gap", points: gap, max: 10, reason: gap ? "existing demand without a strong owned website" : "no significant gap observed" });

  let score = f.reduce((a, x) => a + x.points, 0);
  if (s.businessStatus === "CLOSED_PERMANENTLY") score = 0;
  if (s.franchiseStatus === "FRANCHISE") score = Math.round(score * 0.6);
  if (s.businessSize === "LARGE" || s.businessSize === "ENTERPRISE") score = Math.round(score * 0.7);
  return { score: Math.max(0, Math.min(100, score)), method: "HEURISTIC_ESTIMATE", factors: f };
}
