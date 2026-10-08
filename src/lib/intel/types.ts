/** Shared shapes for the intelligence layer (classification, scoring, qualification). */

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export const WEBSITE_STATUSES = [
  "NO_WEBSITE", "BROKEN", "OUTDATED", "MOBILE_ISSUE", "SLOW", "POOR_DESIGN", "MISSING_FUNCTIONALITY",
  "AVERAGE", "GOOD", "HIGH_QUALITY", "UNKNOWN",
] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

export const WEBSITE_ISSUES = [
  "NO_SSL", "WEAK_SEO", "MISSING_CTA", "MISSING_WHATSAPP", "MISSING_BOOKING", "MISSING_SERVICE_PAGES",
  "MISSING_CONTACT", "NO_VIEWPORT", "OUTDATED_COPYRIGHT", "LEGACY_TECH", "POOR_MOBILE_PERFORMANCE",
  "SLOW_MEASURED", "PARKED_DOMAIN", "UNREACHABLE", "MISSING_FORM", "MISSING_ALT_TEXT",
] as const;
export type WebsiteIssue = (typeof WEBSITE_ISSUES)[number];

export interface Evidence {
  code: string;
  label: string;
  detail: string;
  source: string;        // provider or "website_audit"/"pagespeed"
  observedAt?: string;   // ISO timestamp
  measured?: boolean;    // true when backed by a measurement (status code, Lighthouse)
}

/** The facts the intelligence layer reasons about. All optional: unknown ≠ false. */
export interface BusinessSignals {
  name: string;
  categoryKey?: string | null;
  categoryValueMultiplier?: number;
  rating?: number | null;
  reviewCount?: number | null;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | "UNKNOWN";
  hasPhone?: boolean;
  phoneIsMobile?: boolean;
  hasWhatsapp?: boolean;
  hasEmail?: boolean;
  websiteUrl?: string | null;
  websiteStatus?: WebsiteStatus;
  websiteIssues?: WebsiteIssue[];
  websiteScore?: number | null;
  websiteAudited?: boolean;
  instagram?: { present: boolean; activity: "ACTIVE" | "INACTIVE" | "UNKNOWN"; followers?: number | null } | null;
  facebook?: { present: boolean; activity: "ACTIVE" | "INACTIVE" | "UNKNOWN"; followers?: number | null } | null;
  otherSocialCount?: number;
  businessSize?: "MICRO" | "SMALL" | "MEDIUM" | "LARGE" | "ENTERPRISE" | "UNKNOWN";
  franchiseStatus?: "FRANCHISE" | "INDEPENDENT" | "UNKNOWN";
  hasMenuLink?: boolean;
  hasEcommerce?: boolean;
  previouslyContacted?: boolean;
}
