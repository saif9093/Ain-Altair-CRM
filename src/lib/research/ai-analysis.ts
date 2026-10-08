import type { SupabaseClient } from "@supabase/supabase-js";
import { analyseLead, type LeadFacts } from "@/lib/ai/lead-analysis";
import { loadOrgSettings } from "./settings";

/**
 * Builds the verified-facts packet for a lead and stores Claude's analysis.
 * The suggested price is stored in lead_pricing (pricing.view only) and is
 * stripped from the analysis visible to every user.
 */
export async function buildLeadFacts(db: SupabaseClient, businessId: string): Promise<LeadFacts> {
  const { data: b } = await db.from("businesses").select("*").eq("id", businessId).single();
  if (!b) throw new Error("lead not found");
  const settings = await loadOrgSettings(db, b.organisation_id);
  const [{ data: sources }, { data: socials }, { data: audit }, { data: opps }, { data: org }] = await Promise.all([
    db.from("business_field_sources").select("field, value, provider, confidence").eq("business_id", businessId).eq("is_current", true),
    db.from("business_socials").select("platform, url, followers, activity, source, confidence").eq("business_id", businessId),
    db.from("website_audits").select("evidence").eq("business_id", businessId).order("audited_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("opportunities").select("type, reason").eq("business_id", businessId),
    db.from("organisations").select("name").eq("id", b.organisation_id).single(),
  ]);
  const { data: pricing } = await db.from("lead_pricing").select("opportunity_values").eq("business_id", businessId).maybeSingle();
  const ov = (pricing?.opportunity_values ?? {}) as Record<string, { min: number; max: number }>;
  const facts: LeadFacts["facts"] = (sources ?? []).filter((s) => !["opening_hours", "google_place_id", "location"].includes(s.field)).map((s) => ({ label: s.field.replace(/_/g, " "), value: s.value ?? "", source: s.provider, confidence: s.confidence }));
  facts.push({ label: "website status", value: b.website_status, source: "website classification", confidence: b.last_audited_at ? "HIGH" : "MEDIUM" });
  for (const s of socials ?? []) facts.push({ label: `${s.platform.toLowerCase()} profile`, value: `${s.url}${s.followers ? ` (${s.followers} followers)` : ""}${s.activity !== "UNKNOWN" ? `, ${s.activity.toLowerCase()}` : ", activity unverified"}`, source: s.source, confidence: s.confidence });
  return {
    business: b.name,
    category: b.category_label,
    location: [b.area, b.city, b.country].filter(Boolean).join(", ") || null,
    facts,
    websiteFindings: ((audit?.evidence ?? []) as { label: string; detail: string; source: string; measured?: boolean }[]).map((e) => ({ label: e.label, detail: e.detail, source: e.source, measured: !!e.measured })),
    opportunities: (opps ?? []).map((o) => ({ type: o.type, reason: o.reason, priceMin: ov[o.type]?.min ?? 0, priceMax: ov[o.type]?.max ?? 0 })),
    pricing: { packages: settings.pricing.packages, currency: settings.currency },
    senderCompany: org?.name ?? "Ain AlTair",
  };
}

export async function generateLeadAnalysis(db: SupabaseClient, businessId: string) {
  const facts = await buildLeadFacts(db, businessId);
  const { analysis, model } = await analyseLead(facts);
  const { recommended_price, ...visible } = analysis;
  await db.from("businesses").update({ ai_analysis: { ...visible, label: "AI ANALYSIS — inference based on the listed facts" }, ai_generated_at: new Date().toISOString(), ai_model: model }).eq("id", businessId);
  await db.from("lead_pricing").upsert({ business_id: businessId, currency: recommended_price.currency }, { onConflict: "business_id", ignoreDuplicates: true });
  await db.from("lead_pricing").update({ opportunity_values: { ...(await currentOv(db, businessId)), AI_SUGGESTED: { min: recommended_price.min, max: recommended_price.max, rationale: recommended_price.rationale } } }).eq("business_id", businessId);
  const { data: b } = await db.from("businesses").select("organisation_id").eq("id", businessId).single();
  await db.from("activities").insert({ organisation_id: b!.organisation_id, business_id: businessId, type: "AI_ANALYSED", title: "AI analysis generated", data: { model } });
  return visible;
}

async function currentOv(db: SupabaseClient, id: string) {
  const { data } = await db.from("lead_pricing").select("opportunity_values").eq("business_id", id).maybeSingle();
  return (data?.opportunity_values ?? {}) as Record<string, unknown>;
}
