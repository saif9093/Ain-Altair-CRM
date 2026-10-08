/**
 * Change detection between two research snapshots of the same business.
 * Produces activity events such as WEBSITE_DETECTED or NEW_OPPORTUNITY.
 */
export interface BusinessSnapshot {
  website_domain: string | null;
  website_status: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  business_status: string | null;
  phone_e164: string | null;
  whatsapp_e164: string | null;
  instagram_present: boolean;
  instagram_activity: string | null;
  lead_score: number | null;
}

export type ChangeType =
  | "WEBSITE_DETECTED" | "WEBSITE_REMOVED" | "WEBSITE_CHANGED" | "WEBSITE_BROKEN" | "NEW_OPPORTUNITY"
  | "RATING_CHANGED" | "REVIEW_GROWTH" | "SOCIAL_ACTIVATED" | "PHONE_CHANGED" | "NEWLY_CONTACTABLE" | "BUSINESS_CLOSED";

export interface DetectedChange {
  type: ChangeType;
  title: string;
  from: unknown;
  to: unknown;
  /** Worth an alert to sales (strong signal of a new or changed opportunity). */
  alert: boolean;
}

const GOODISH = new Set(["GOOD", "HIGH_QUALITY", "AVERAGE"]);
const OPPORTUNITY = new Set(["BROKEN", "OUTDATED", "MOBILE_ISSUE", "SLOW", "POOR_DESIGN", "MISSING_FUNCTIONALITY", "NO_WEBSITE"]);

export function diffSnapshots(prev: BusinessSnapshot | null, next: BusinessSnapshot): DetectedChange[] {
  if (!prev) return [];
  const out: DetectedChange[] = [];
  if (!prev.website_domain && next.website_domain) {
    out.push({ type: "WEBSITE_DETECTED", title: `Website detected: ${next.website_domain}`, from: null, to: next.website_domain, alert: true });
  } else if (prev.website_domain && !next.website_domain && next.website_status === "NO_WEBSITE") {
    out.push({ type: "WEBSITE_REMOVED", title: `Website no longer listed (${prev.website_domain})`, from: prev.website_domain, to: null, alert: true });
  } else if (prev.website_domain && next.website_domain && prev.website_domain !== next.website_domain) {
    out.push({ type: "WEBSITE_CHANGED", title: `Website changed: ${prev.website_domain} → ${next.website_domain}`, from: prev.website_domain, to: next.website_domain, alert: false });
  }
  if (prev.website_status !== "BROKEN" && next.website_status === "BROKEN" && prev.website_status && prev.website_status !== "UNKNOWN") {
    out.push({ type: "WEBSITE_BROKEN", title: "Website became broken", from: prev.website_status, to: next.website_status, alert: true });
  }
  if (prev.website_status && GOODISH.has(prev.website_status) && next.website_status && OPPORTUNITY.has(next.website_status) && next.website_status !== "BROKEN") {
    out.push({ type: "NEW_OPPORTUNITY", title: `Recently became an opportunity: ${prev.website_status.replace(/_/g, " ").toLowerCase()} → ${next.website_status.replace(/_/g, " ").toLowerCase()}`, from: prev.website_status, to: next.website_status, alert: true });
  }
  if (prev.google_rating != null && next.google_rating != null && Math.abs(prev.google_rating - next.google_rating) >= 0.2) {
    out.push({ type: "RATING_CHANGED", title: `Rating ${prev.google_rating} → ${next.google_rating}`, from: prev.google_rating, to: next.google_rating, alert: false });
  }
  if (prev.google_review_count != null && next.google_review_count != null) {
    const growth = next.google_review_count - prev.google_review_count;
    if (growth >= 10 || (prev.google_review_count > 0 && growth / prev.google_review_count >= 0.2 && growth >= 3)) {
      out.push({ type: "REVIEW_GROWTH", title: `+${growth} new reviews (${prev.google_review_count} → ${next.google_review_count})`, from: prev.google_review_count, to: next.google_review_count, alert: false });
    }
  }
  if ((!prev.instagram_present || prev.instagram_activity !== "ACTIVE") && next.instagram_present && next.instagram_activity === "ACTIVE") {
    out.push({ type: "SOCIAL_ACTIVATED", title: "Instagram became active", from: prev.instagram_activity, to: "ACTIVE", alert: false });
  }
  if (prev.phone_e164 && next.phone_e164 && prev.phone_e164 !== next.phone_e164) {
    out.push({ type: "PHONE_CHANGED", title: `Phone changed: ${prev.phone_e164} → ${next.phone_e164}`, from: prev.phone_e164, to: next.phone_e164, alert: false });
  }
  if (!prev.phone_e164 && !prev.whatsapp_e164 && (next.phone_e164 || next.whatsapp_e164)) {
    out.push({ type: "NEWLY_CONTACTABLE", title: "Became contactable", from: null, to: next.whatsapp_e164 ?? next.phone_e164, alert: (next.lead_score ?? 0) >= 70 });
  }
  if (prev.business_status !== "CLOSED_PERMANENTLY" && next.business_status === "CLOSED_PERMANENTLY") {
    out.push({ type: "BUSINESS_CLOSED", title: "Business marked permanently closed", from: prev.business_status, to: next.business_status, alert: false });
  }
  return out;
}
