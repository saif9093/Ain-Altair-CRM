import { whatsappUrl } from "@/lib/normalize/phone";

/** Export columns. `pricing: true` columns are only offered to users with pricing.view. */
export interface ExportRow {
  [k: string]: unknown;
}
export interface ExportColumn { key: string; label: string; width?: number; link?: boolean; pricing?: boolean; value: (r: ExportRow) => string | number | null }

const s = (v: unknown) => (v == null || v === "" ? null : String(v));
const human = (v: unknown) => (v ? String(v).replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null);
const social = (r: ExportRow, p: string) => ((r.business_socials ?? []) as { platform: string; url: string }[]).find((x) => x.platform === p)?.url ?? null;
const ai = (r: ExportRow) => (r.ai_analysis ?? {}) as { why_contact?: string; outreach_message?: string };
const owner = (r: ExportRow) => (r.owner as { full_name?: string; email?: string } | null);
const pricing = (r: ExportRow) => (r.lead_pricing as { recommended_price_min?: number; recommended_price_max?: number; opportunity_value?: number; deal_value?: number } | null);

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "lead_code", label: "Lead ID", width: 12, value: (r) => s(r.lead_code) },
  { key: "name", label: "Business", width: 32, value: (r) => s(r.name) },
  { key: "category", label: "Category", width: 20, value: (r) => s(r.category_label) },
  { key: "subcategory", label: "Subcategory", width: 18, value: (r) => s(r.subcategory) },
  { key: "country", label: "Country", width: 12, value: (r) => s(r.country ?? r.country_code) },
  { key: "region", label: "Emirate/Region", width: 16, value: (r) => s(r.region) },
  { key: "city", label: "City", width: 14, value: (r) => s(r.city) },
  { key: "area", label: "Area", width: 18, value: (r) => s(r.area) },
  { key: "address", label: "Address", width: 36, value: (r) => s(r.address) },
  { key: "rating", label: "Rating", width: 8, value: (r) => (r.google_rating != null ? Number(r.google_rating) : null) },
  { key: "reviews", label: "Reviews", width: 9, value: (r) => (r.google_review_count as number) ?? null },
  { key: "phone", label: "Phone", width: 18, value: (r) => s(r.phone_formatted ?? r.phone_e164) },
  { key: "whatsapp", label: "WhatsApp", width: 18, value: (r) => s(r.whatsapp_e164) },
  { key: "whatsapp_link", label: "WhatsApp Link", width: 30, link: true, value: (r) => whatsappUrl(r.whatsapp_e164 as string) },
  { key: "email", label: "Email", width: 28, value: (r) => s(r.email) },
  { key: "website", label: "Website", width: 30, link: true, value: (r) => s(r.website_url) },
  { key: "website_status", label: "Website Status", width: 18, value: (r) => human(r.website_status) },
  { key: "website_issue", label: "Website Issue", width: 30, value: (r) => ((r.website_issues ?? []) as string[]).map((i) => human(i)).join(", ") || null },
  { key: "instagram", label: "Instagram", width: 30, link: true, value: (r) => social(r, "INSTAGRAM") },
  { key: "facebook", label: "Facebook", width: 30, link: true, value: (r) => social(r, "FACEBOOK") },
  { key: "google_maps", label: "Google Maps", width: 30, link: true, value: (r) => s(r.google_maps_url) },
  { key: "lead_score", label: "Lead Score", width: 10, value: (r) => (r.lead_score as number) ?? null },
  { key: "sales_intent", label: "Sales Intent (estimate)", width: 12, value: (r) => (r.sales_intent as number) ?? null },
  { key: "tier", label: "Tier", width: 8, value: (r) => s(r.tier) },
  { key: "opportunity", label: "Opportunity", width: 22, value: (r) => ((r.opportunities ?? []) as { type: string; priority: number }[]).sort((a, b) => b.priority - a.priority).map((o) => human(o.type)).join(", ") || null },
  { key: "recommended_service", label: "Recommended Service", width: 22, value: (r) => s(r.recommended_service) },
  { key: "recommended_price", label: "Recommended Price", width: 18, pricing: true, value: (r) => { const p = pricing(r); return p?.recommended_price_min != null ? `${r.currency ?? "AED"} ${p.recommended_price_min}–${p.recommended_price_max}` : null; } },
  { key: "opportunity_value", label: "Estimated Opportunity", width: 16, pricing: true, value: (r) => pricing(r)?.opportunity_value ?? null },
  { key: "deal_value", label: "Deal Value", width: 14, pricing: true, value: (r) => pricing(r)?.deal_value ?? null },
  { key: "why", label: "Why This Lead", width: 40, value: (r) => s(ai(r).why_contact) },
  { key: "message", label: "Suggested Message", width: 50, value: (r) => s(ai(r).outreach_message) },
  { key: "status", label: "Outreach Status", width: 14, value: (r) => human(r.pipeline_stage) },
  { key: "assigned_to", label: "Assigned To", width: 20, value: (r) => s(owner(r)?.full_name ?? owner(r)?.email) },
  { key: "follow_up", label: "Follow-up Date", width: 14, value: (r) => (r.next_follow_up_at ? String(r.next_follow_up_at).slice(0, 10) : null) },
  { key: "source", label: "Source", width: 16, value: (r) => human(r.source) },
  { key: "created", label: "Created Date", width: 14, value: (r) => String(r.created_at ?? "").slice(0, 10) || null },
];

export const DEFAULT_EXPORT_KEYS = EXPORT_COLUMNS.filter((c) => !c.pricing).map((c) => c.key);

export function allowedColumns(keys: string[], canSeePricing: boolean): ExportColumn[] {
  const chosen = keys.length ? EXPORT_COLUMNS.filter((c) => keys.includes(c.key)) : EXPORT_COLUMNS;
  return chosen.filter((c) => !c.pricing || canSeePricing);
}
