import { z } from "zod";

/** Canonical, validated search definition shared by the UI, API, jobs and templates. */

export const WEBSITE_FILTERS = ["NO_WEBSITE", "OUTDATED", "BROKEN", "POOR", "MOBILE_ISSUE", "SLOW", "GOOD", "ANY"] as const;
export const SOCIAL_FILTERS = ["ACTIVE", "INACTIVE", "PRESENT", "ANY"] as const;
export const OPPORTUNITY_TYPES = [
  "NEW_WEBSITE", "WEBSITE_REDESIGN", "WEBSITE_FIX", "LANDING_PAGE", "MOBILE_OPTIMISATION", "SEO", "LOCAL_SEO",
  "GOOGLE_BUSINESS_OPTIMISATION", "WHATSAPP_INTEGRATION", "BOOKING_SYSTEM", "DIGITAL_MENU", "CATALOGUE", "LEAD_FORM",
  "CRM", "AUTOMATION", "MAINTENANCE", "OTHER",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];
export const BUSINESS_SIZES = ["MICRO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE", "UNKNOWN"] as const;
export const DEPTHS = ["FAST", "BALANCED", "DEEP"] as const;
export type Depth = (typeof DEPTHS)[number];

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export const locationSpecSchema = z.object({
  label: z.string().min(1).max(200),
  kind: z.enum(["NAMED", "RADIUS", "BBOX", "POLYGON"]),
  locationId: z.string().uuid().optional(),
  country: z.string().max(100).optional(),
  countryCode: z.string().length(2).optional(),
  region: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  area: z.string().max(150).optional(),
  postalCode: z.string().max(20).optional(),
  center: latLng.optional(),
  radiusM: z.number().int().min(100).max(200_000).optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  polygon: z.array(latLng).min(3).max(500).optional(),
  /** Split into known sub-areas (bulk research) */
  splitIntoSubAreas: z.boolean().optional(),
});
export type LocationSpec = z.infer<typeof locationSpecSchema>;

export const categorySpecSchema = z.object({
  key: z.string().max(80).optional(), // taxonomy key; absent for custom niches
  label: z.string().min(1).max(120),
  terms: z.array(z.string().min(1).max(120)).max(40).default([]), // expanded search terms
});
export type CategorySpec = z.infer<typeof categorySpecSchema>;

export const searchCriteriaSchema = z.object({
  naturalQuery: z.string().max(1000).optional(),
  categories: z.array(categorySpecSchema).min(1, "Choose at least one category or niche").max(20),
  keywords: z.array(z.string().max(80)).max(30).default([]),
  excludeKeywords: z.array(z.string().max(80)).max(30).default([]),
  locations: z.array(locationSpecSchema).min(1, "Choose at least one location").max(30),
  business: z.object({
    minRating: z.number().min(0).max(5).optional(),
    minReviews: z.number().int().min(0).max(100_000).optional(),
    sizes: z.array(z.enum(BUSINESS_SIZES)).default([]),
    franchise: z.enum(["INCLUDE", "EXCLUDE", "PREFER", "ONLY"]).default("INCLUDE"),
    activeOnly: z.boolean().default(true),
  }).default({}),
  digital: z.object({
    website: z.array(z.enum(WEBSITE_FILTERS)).default(["ANY"]),
    instagram: z.enum(SOCIAL_FILTERS).default("ANY"),
    facebook: z.enum(SOCIAL_FILTERS).default("ANY"),
    maxWebsiteScore: z.number().int().min(0).max(100).optional(),
  }).default({}),
  contact: z.object({
    whatsapp: z.enum(["REQUIRED", "PREFERRED", "ANY"]).default("ANY"),
    phone: z.enum(["REQUIRED", "ANY"]).default("ANY"),
    email: z.enum(["REQUIRED", "PREFERRED", "ANY"]).default("ANY"),
    social: z.enum(["REQUIRED", "ANY"]).default("ANY"),
  }).default({}),
  opportunities: z.array(z.enum(OPPORTUNITY_TYPES)).default([]),
  quality: z.object({
    minLeadScore: z.number().int().min(0).max(100).optional(),
    minSalesIntent: z.number().int().min(0).max(100).optional(),
    minOpportunityValue: z.number().min(0).optional(),
  }).default({}),
  output: z.object({
    targetCount: z.number().int().min(1).max(5000).default(100),
    depth: z.enum(DEPTHS).default("BALANCED"),
  }).default({}),
  providers: z.array(z.string().max(60)).default([]), // empty = every enabled + configured discovery provider
  coverage: z.object({
    skipRecentlySearchedDays: z.number().int().min(0).max(365).default(14),
    splitLargeAreas: z.boolean().default(true),
  }).default({}),
});
export type SearchCriteria = z.infer<typeof searchCriteriaSchema>;
export type SearchCriteriaInput = z.input<typeof searchCriteriaSchema>;

export function parseCriteria(input: unknown): SearchCriteria {
  return searchCriteriaSchema.parse(input);
}

export function describeLocation(l: LocationSpec): string {
  if (l.kind === "RADIUS" && l.radiusM) return `Within ${(l.radiusM / 1000).toFixed(l.radiusM % 1000 ? 1 : 0)} km of ${l.label}`;
  if (l.kind === "POLYGON") return `${l.label} (custom map area)`;
  if (l.kind === "BBOX") return `${l.label} (map rectangle)`;
  return l.label;
}

export function criteriaSummary(c: SearchCriteria): string {
  const cats = c.categories.map((x) => x.label).join(", ");
  const locs = c.locations.map(describeLocation).join(" + ");
  return `${cats} — ${locs}`;
}
