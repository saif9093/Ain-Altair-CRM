/* eslint-disable @typescript-eslint/no-unsafe-function-type -- generic over the Supabase query builder */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Server-side lead filtering & pagination (never loads the whole table into the browser). */
export interface LeadFilters {
  q?: string;
  tier?: string;
  stage?: string;
  website?: string;
  category?: string;
  city?: string;
  area?: string;
  owner?: string; // "me" | "unassigned" | uuid
  team?: string;
  whatsapp?: string; // "1"
  instagram?: string;
  minScore?: string;
  minIntent?: string;
  opportunity?: string;
  tag?: string;
  followup?: string; // "overdue" | "today" | "week"
  lifecycle?: string; // ACTIVE (default) | ARCHIVED
  contacted?: string; // "no"
  sort?: string; // score | intent | newest | name | reviews
  page?: string;
  per?: string;
  ids?: string;
}

export const LEAD_LIST_COLUMNS = "id, lead_code, name, category_key, category_label, city, area, google_rating, google_review_count, phone_e164, phone_formatted, phone_type, whatsapp_e164, email, website_url, website_domain, website_status, website_issues, lead_score, sales_intent, tier, pipeline_stage, owner_id, team_id, next_follow_up_at, last_contacted_at, recommended_service, lat, lng, google_maps_url, created_at, approved_at, business_status, franchise_status, business_size, owner:profiles!businesses_owner_id_fkey(id, full_name, email), business_socials(platform, url, activity, followers)";

export function applyLeadFilters<Q extends { eq: Function; neq: Function; in: Function; gte: Function; lte: Function; lt: Function; is: Function; not: Function; or: Function; ilike: Function; textSearch: Function }>(q: Q, f: LeadFilters, userId: string): Q {
  let x = q as unknown as Record<string, Function>;
  const call = (m: string, ...a: unknown[]) => { x = (x[m] as Function)(...a); };
  call("eq", "lifecycle", f.lifecycle === "ARCHIVED" ? "ARCHIVED" : "ACTIVE");
  if (f.q?.trim()) {
    const t = f.q.trim().replace(/[%,()]/g, " ");
    const digits = t.replace(/\D/g, "");
    call("or", [`name.ilike.%${t}%`, `lead_code.ilike.%${t}%`, `website_domain.ilike.%${t}%`, `email.ilike.%${t}%`, `area.ilike.%${t}%`, digits.length >= 6 ? `phone_e164.ilike.%${digits}%` : null].filter(Boolean).join(","));
  }
  if (f.tier) call("in", "tier", f.tier.split(","));
  if (f.stage) call("in", "pipeline_stage", f.stage.split(","));
  if (f.website) call("in", "website_status", f.website.split(","));
  if (f.category) call("in", "category_key", f.category.split(","));
  if (f.city) call("ilike", "city", f.city);
  if (f.area) call("ilike", "area", `%${f.area}%`);
  if (f.owner === "me") call("eq", "owner_id", userId);
  else if (f.owner === "unassigned") call("is", "owner_id", null);
  else if (f.owner && /^[0-9a-f-]{36}$/.test(f.owner)) call("eq", "owner_id", f.owner);
  if (f.team && /^[0-9a-f-]{36}$/.test(f.team)) call("eq", "team_id", f.team);
  if (f.whatsapp === "1") call("not", "whatsapp_e164", "is", null);
  if (f.minScore) call("gte", "lead_score", Number(f.minScore));
  if (f.minIntent) call("gte", "sales_intent", Number(f.minIntent));
  if (f.contacted === "no") call("eq", "pipeline_stage", "NOT_CONTACTED");
  if (f.followup) {
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    if (f.followup === "overdue") call("lt", "next_follow_up_at", now.toISOString());
    if (f.followup === "today") { call("lte", "next_follow_up_at", end.toISOString()); }
    if (f.followup === "week") call("lte", "next_follow_up_at", new Date(Date.now() + 7 * 86_400_000).toISOString());
  }
  if (f.ids) call("in", "id", f.ids.split(",").slice(0, 1000));
  return x as unknown as Q;
}

export function sortLeads<Q extends { order: Function }>(q: Q, sort?: string): Q {
  switch (sort) {
    case "intent": return q.order("sales_intent", { ascending: false, nullsFirst: false });
    case "newest": return q.order("created_at", { ascending: false });
    case "name": return q.order("name", { ascending: true });
    case "reviews": return q.order("google_review_count", { ascending: false, nullsFirst: false });
    default: return q.order("lead_score", { ascending: false, nullsFirst: false }).order("sales_intent", { ascending: false, nullsFirst: false });
  }
}

/** Some filters need joins (opportunity type, tag, instagram) — resolve them to id lists first. */
export async function resolveJoinFilters(db: SupabaseClient, f: LeadFilters): Promise<LeadFilters> {
  const sets: string[][] = [];
  if (f.opportunity) {
    const { data } = await db.from("opportunities").select("business_id").in("type", f.opportunity.split(",")).eq("status", "OPEN").limit(5000);
    sets.push((data ?? []).map((d) => d.business_id));
  }
  if (f.tag) {
    const { data } = await db.from("lead_tags").select("business_id, tags!inner(name)").eq("tags.name", f.tag).limit(5000);
    sets.push((data ?? []).map((d) => d.business_id));
  }
  if (f.instagram === "1") {
    const { data } = await db.from("business_socials").select("business_id").eq("platform", "INSTAGRAM").limit(10000);
    sets.push((data ?? []).map((d) => d.business_id));
  }
  if (!sets.length) return f;
  let ids = sets[0];
  for (const s of sets.slice(1)) ids = ids.filter((i) => s.includes(i));
  return { ...f, ids: (ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).join(",") };
}

export async function queryLeads(db: SupabaseClient, f: LeadFilters, userId: string, opts: { columns?: string; perPage?: number } = {}) {
  const resolved = await resolveJoinFilters(db, f);
  const per = Math.min(200, Number(f.per) || opts.perPage || 50);
  const page = Math.max(1, Number(f.page) || 1);
  let q = db.from("businesses").select(opts.columns ?? LEAD_LIST_COLUMNS, { count: "exact" });
  q = applyLeadFilters(q, resolved, userId);
  q = sortLeads(q, f.sort);
  const { data, count, error } = await q.range((page - 1) * per, page * per - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as unknown as Record<string, unknown>[], count: count ?? 0, page, per };
}
