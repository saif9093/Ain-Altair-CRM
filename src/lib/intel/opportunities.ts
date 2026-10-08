import { z } from "zod";
import type { OpportunityType } from "@/lib/search/criteria";
import type { BusinessSignals, Evidence } from "./types";
import { BOOKING_CATEGORIES } from "./website-classify";

/** Opportunity engine: what problem exists, what Ain AlTair can sell, and for how much. */

export const pricingConfigSchema = z.object({
  currency: z.string().default("AED"),
  packages: z.array(z.object({ key: z.string(), name: z.string(), min: z.number(), max: z.number() })).default([
    { key: "BASIC", name: "Basic", min: 500, max: 750 },
    { key: "PROFESSIONAL", name: "Professional", min: 750, max: 1000 },
    { key: "PREMIUM", name: "Premium", min: 1000, max: 1500 },
    { key: "ADVANCED", name: "Advanced", min: 1500, max: 3000 },
  ]),
  services: z.record(z.string(), z.object({ min: z.number(), max: z.number(), recurring: z.boolean().default(false) })).default({
    WHATSAPP_INTEGRATION: { min: 150, max: 300, recurring: false },
    BOOKING_SYSTEM: { min: 300, max: 750, recurring: false },
    SEO: { min: 500, max: 1500, recurring: true },
    LOCAL_SEO: { min: 300, max: 800, recurring: false },
    GOOGLE_BUSINESS_OPTIMISATION: { min: 200, max: 500, recurring: false },
    DIGITAL_MENU: { min: 250, max: 500, recurring: false },
    CATALOGUE: { min: 500, max: 1000, recurring: false },
    LEAD_FORM: { min: 150, max: 300, recurring: false },
    MOBILE_OPTIMISATION: { min: 400, max: 800, recurring: false },
    LANDING_PAGE: { min: 500, max: 750, recurring: false },
    CRM: { min: 1000, max: 3000, recurring: false },
    AUTOMATION: { min: 750, max: 2500, recurring: false },
    MAINTENANCE: { min: 150, max: 300, recurring: true },
  }),
  /** Probability weight applied to upsells when estimating opportunity value. */
  upsellWeight: z.number().min(0).max(1).default(0.35),
});
export type PricingConfig = z.infer<typeof pricingConfigSchema>;
export const DEFAULT_PRICING: PricingConfig = pricingConfigSchema.parse({});

const BAND: Record<OpportunityType, "$" | "$$" | "$$$" | "$$$$" | "$$$$$"> = {
  NEW_WEBSITE: "$$$$$", WEBSITE_FIX: "$$$$", WEBSITE_REDESIGN: "$$$$", MOBILE_OPTIMISATION: "$$$", SEO: "$$$", LOCAL_SEO: "$$",
  WHATSAPP_INTEGRATION: "$$", BOOKING_SYSTEM: "$$$", DIGITAL_MENU: "$$", CATALOGUE: "$$$", LEAD_FORM: "$$", LANDING_PAGE: "$$$",
  GOOGLE_BUSINESS_OPTIMISATION: "$$", CRM: "$$$$", AUTOMATION: "$$$", MAINTENANCE: "$", OTHER: "$",
};

export interface Opportunity {
  type: OpportunityType;
  priority: number; // 0–100
  valueBand: (typeof BAND)[OpportunityType];
  min: number;
  max: number;
  reason: string;
  evidence: Evidence[];
}

export interface OpportunityPlan {
  opportunities: Opportunity[];
  primary: Opportunity | null;
  recommendedService: string | null;
  recommendedPackage: string | null;
  priceMin: number | null;
  priceMax: number | null;
  upsells: OpportunityType[];
  estimatedValue: number;
  currency: string;
  whyThisBusiness: string[];
}

const FOOD = new Set(["restaurants", "cafeterias", "bakeries"]);
const CATALOGUE_CATS = new Set(["flower_shops", "bakeries", "tailors"]);

const LABEL: Record<OpportunityType, string> = {
  NEW_WEBSITE: "New website", WEBSITE_REDESIGN: "Website redesign", WEBSITE_FIX: "Website fix", LANDING_PAGE: "Landing page",
  MOBILE_OPTIMISATION: "Mobile optimisation", SEO: "SEO", LOCAL_SEO: "Local SEO", GOOGLE_BUSINESS_OPTIMISATION: "Google Business optimisation",
  WHATSAPP_INTEGRATION: "WhatsApp integration", BOOKING_SYSTEM: "Booking system", DIGITAL_MENU: "Digital menu", CATALOGUE: "Online catalogue",
  LEAD_FORM: "Lead / quote form", CRM: "CRM", AUTOMATION: "Automation", MAINTENANCE: "Website maintenance", OTHER: "Other",
};
export const opportunityLabel = (t: OpportunityType) => LABEL[t];

function pickPackage(s: BusinessSignals, cfg: PricingConfig, kind: "NEW" | "REDESIGN" | "FIX") {
  const byKey = Object.fromEntries(cfg.packages.map((p) => [p.key, p]));
  const reviews = s.reviewCount ?? 0;
  const mult = s.categoryValueMultiplier ?? 1;
  if (kind === "FIX") return byKey.BASIC ?? cfg.packages[0];
  if (reviews >= 200 || mult >= 1.35 || s.businessSize === "MEDIUM") return byKey.PREMIUM ?? cfg.packages[2];
  if (s.businessSize === "MICRO" && reviews < 20) return byKey.BASIC ?? cfg.packages[0];
  return byKey.PROFESSIONAL ?? cfg.packages[1];
}

export function buildOpportunities(s: BusinessSignals, cfg: PricingConfig = DEFAULT_PRICING, websiteEvidence: Evidence[] = []): OpportunityPlan {
  const opps: Opportunity[] = [];
  const issues = new Set(s.websiteIssues ?? []);
  const st = s.websiteStatus ?? "UNKNOWN";
  const findEv = (...codes: string[]) => websiteEvidence.filter((e) => codes.includes(e.code));
  const svc = (t: OpportunityType) => cfg.services[t] ?? { min: 0, max: 0, recurring: false };
  const add = (type: OpportunityType, priority: number, min: number, max: number, reason: string, evidence: Evidence[] = []) =>
    opps.push({ type, priority, valueBand: BAND[type], min, max, reason, evidence });

  const why: string[] = [];
  if ((s.reviewCount ?? 0) >= 20 && (s.rating ?? 0) >= 4) why.push(`Established reputation: ${s.rating?.toFixed(1)}★ from ${s.reviewCount} Google reviews.`);
  if (s.instagram?.present) why.push(`Invests in social media${s.instagram.followers ? ` (${s.instagram.followers.toLocaleString()} Instagram followers)` : ""}.`);
  if (s.hasWhatsapp) why.push("Reachable directly on WhatsApp.");

  if (st === "NO_WEBSITE") {
    const pkg = pickPackage(s, cfg, "NEW");
    add("NEW_WEBSITE", 95, pkg.min, pkg.max, "No owned website — customers can only find them through listings/social.", findEv("NO_WEBSITE"));
    why.push("No dedicated website detected.");
    add("LOCAL_SEO", 60, svc("LOCAL_SEO").min, svc("LOCAL_SEO").max, "A new site can rank for local searches the listing alone cannot capture.");
  } else if (st === "BROKEN") {
    const pkg = pickPackage(s, cfg, "REDESIGN");
    add("WEBSITE_FIX", 92, cfg.packages[0].min, pkg.max, "Website is not working — they are losing every visitor right now.", findEv("BROKEN"));
    why.push("Their website is currently broken.");
  } else if (st === "OUTDATED" || st === "POOR_DESIGN") {
    const pkg = pickPackage(s, cfg, "REDESIGN");
    add("WEBSITE_REDESIGN", st === "OUTDATED" ? 85 : 78, pkg.min, pkg.max,
      st === "OUTDATED" ? "Website shows clear signs of being outdated." : "Website quality is weak relative to the business's reputation.",
      findEv("OUTDATED", "THIN_SITE", "UNDER_CONSTRUCTION"));
    why.push(st === "OUTDATED" ? "Outdated website." : "Weak website design/content.");
  } else if (st === "MOBILE_ISSUE") {
    add("MOBILE_OPTIMISATION", 80, svc("MOBILE_OPTIMISATION").min, svc("MOBILE_OPTIMISATION").max, "Website is not mobile-ready, where most local customers browse.", findEv("NO_VIEWPORT", "MOBILE_PERF"));
    add("WEBSITE_REDESIGN", 70, cfg.packages[1].min, cfg.packages[2].max, "A mobile-first rebuild usually beats patching a desktop-only site.", findEv("NO_VIEWPORT"));
    why.push("Website has mobile issues.");
  } else if (st === "SLOW") {
    add("WEBSITE_FIX", 72, cfg.packages[0].min, cfg.packages[0].max, "Measured slow performance on mobile.", findEv("SLOW"));
  }

  if (st !== "NO_WEBSITE" && st !== "UNKNOWN") {
    if (issues.has("WEAK_SEO")) add("SEO", 55, svc("SEO").min, svc("SEO").max, "Missing basic on-page SEO (title/meta/H1).", findEv("WEAK_SEO"));
    if (issues.has("MISSING_WHATSAPP")) add("WHATSAPP_INTEGRATION", 50, svc("WHATSAPP_INTEGRATION").min, svc("WHATSAPP_INTEGRATION").max, "No WhatsApp button on the website.", findEv("MISSING_FUNCTIONALITY"));
    if (issues.has("MISSING_BOOKING")) add("BOOKING_SYSTEM", 58, svc("BOOKING_SYSTEM").min, svc("BOOKING_SYSTEM").max, "Appointment-based business without online booking.", findEv("MISSING_FUNCTIONALITY"));
    if (issues.has("MISSING_CTA") || issues.has("MISSING_FORM")) add("LEAD_FORM", 45, svc("LEAD_FORM").min, svc("LEAD_FORM").max, "No clear call-to-action or enquiry form.", findEv("MISSING_FUNCTIONALITY"));
    if (issues.has("NO_SSL")) add("MAINTENANCE", 40, svc("MAINTENANCE").min, svc("MAINTENANCE").max, "No valid HTTPS — browsers show 'Not secure'.", findEv("NO_SSL"));
    if (st === "GOOD" || st === "HIGH_QUALITY" || st === "AVERAGE") {
      if (issues.size === 0) add("MAINTENANCE", 15, svc("MAINTENANCE").min, svc("MAINTENANCE").max, "Website is in reasonable shape; maintenance/upsell only.");
    }
  }
  if (st === "NO_WEBSITE" && s.categoryKey && BOOKING_CATEGORIES.has(s.categoryKey)) add("BOOKING_SYSTEM", 55, svc("BOOKING_SYSTEM").min, svc("BOOKING_SYSTEM").max, "Appointment-based business — booking can be built into the new site.");
  if (st === "NO_WEBSITE" && !s.hasWhatsapp && s.phoneIsMobile) add("WHATSAPP_INTEGRATION", 40, svc("WHATSAPP_INTEGRATION").min, svc("WHATSAPP_INTEGRATION").max, "Mobile number listed; WhatsApp click-to-chat can be added to the site.");
  if (s.categoryKey && FOOD.has(s.categoryKey) && !s.hasMenuLink) add("DIGITAL_MENU", 50, svc("DIGITAL_MENU").min, svc("DIGITAL_MENU").max, "Food business without an online menu.");
  if (s.categoryKey && CATALOGUE_CATS.has(s.categoryKey) && !s.hasEcommerce) add("CATALOGUE", 48, svc("CATALOGUE").min, svc("CATALOGUE").max, "Products could be showcased/ordered online.");
  if ((s.reviewCount ?? 0) >= 150) add("CRM", 35, svc("CRM").min, svc("CRM").max, "High customer volume suggests value from CRM/follow-up tooling.");
  if ((s.reviewCount ?? 0) >= 80 && s.hasWhatsapp) add("AUTOMATION", 30, svc("AUTOMATION").min, svc("AUTOMATION").max, "Busy WhatsApp-led business — enquiry automation upsell.");
  if ((s.reviewCount ?? 0) < 10 && s.businessStatus === "OPERATIONAL") add("GOOGLE_BUSINESS_OPTIMISATION", 35, svc("GOOGLE_BUSINESS_OPTIMISATION").min, svc("GOOGLE_BUSINESS_OPTIMISATION").max, "Few reviews — Google Business Profile optimisation can improve visibility.");

  // De-duplicate by type (keep highest priority), sort by priority.
  const byType = new Map<OpportunityType, Opportunity>();
  for (const o of opps) if (!byType.has(o.type) || byType.get(o.type)!.priority < o.priority) byType.set(o.type, o);
  const list = [...byType.values()].sort((a, b) => b.priority - a.priority);
  const primary = list.find((o) => o.priority >= 60) ?? list[0] ?? null;

  let recommendedPackage: string | null = null;
  if (primary && ["NEW_WEBSITE", "WEBSITE_REDESIGN", "WEBSITE_FIX"].includes(primary.type)) {
    const pkg = cfg.packages.find((p) => p.min === primary.min) ?? cfg.packages.find((p) => p.max === primary.max);
    recommendedPackage = pkg?.name ?? null;
  }
  const upsells = list.filter((o) => o !== primary).slice(0, 4).map((o) => o.type);
  const estimatedValue = primary
    ? Math.round(primary.max + list.filter((o) => o !== primary).slice(0, 4).reduce((a, o) => a + ((o.min + o.max) / 2) * cfg.upsellWeight, 0))
    : 0;

  return {
    opportunities: list,
    primary,
    recommendedService: primary ? LABEL[primary.type] : null,
    recommendedPackage,
    priceMin: primary?.min ?? null,
    priceMax: primary?.max ?? null,
    upsells,
    estimatedValue,
    currency: cfg.currency,
    whyThisBusiness: why,
  };
}

/** Classification used to label urgency in the UI. */
export function urgencyFor(plan: OpportunityPlan): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  const p = plan.primary?.priority ?? 0;
  if (p >= 90) return "CRITICAL";
  if (p >= 75) return "HIGH";
  if (p >= 50) return "MEDIUM";
  return "LOW";
}
