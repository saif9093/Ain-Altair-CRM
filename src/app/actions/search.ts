"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { parseNaturalQuery, type ParsedSearch } from "@/lib/search/parse";
import { searchCriteriaSchema, type SearchCriteria } from "@/lib/search/criteria";
import { interpretSearchWithAi, type AiInterpretation } from "@/lib/ai/search-interpret";
import { isAiConfigured } from "@/lib/ai/client";
import { categoryByKey, expandCategoryTerms } from "@/lib/categories/taxonomy";
import { createSearchJob, cancelSearchJob } from "@/lib/jobs/search-jobs";
import { nextRun } from "@/lib/jobs/scheduler";
import { loadOrgSettings } from "@/lib/research/settings";
import { checkQualityGates } from "@/lib/intel/qualification";
import { executeAssignment } from "@/lib/leads/assign";
import { act } from "./_util";

export interface Interpreted { rule: ParsedSearch; ai: AiInterpretation | null; aiError: string | null }

/** Interpret a natural-language query. Rule-based always; AI-assisted when configured. */
export async function interpretQuery(query: string, useAi: boolean) {
  return act<Interpreted>(async () => {
    const s = await assertPermission("search.run");
    const q = z.string().trim().min(3).max(1000).parse(query);
    const settings = await loadOrgSettings(createAdminClient(), s.organisationId);
    const rule = parseNaturalQuery(q, { defaultCountryCode: settings.defaultCountry });
    let ai: AiInterpretation | null = null;
    let aiError: string | null = null;
    if (useAi && isAiConfigured()) {
      try { ai = await interpretSearchWithAi(q, settings.defaultCountry); } catch (e) { aiError = (e as Error).message; }
    } else if (useAi) aiError = "AI is not configured (ANTHROPIC_API_KEY).";
    return { rule, ai, aiError };
  });
}

/** Convert the AI interpretation into the canonical criteria shape. */
export async function aiToCriteria(ai: AiInterpretation, query: string): Promise<SearchCriteria> {
  return searchCriteriaSchema.parse({
    naturalQuery: query,
    categories: ai.categories.map((c) => {
      const def = c.key ? categoryByKey(c.key) : undefined;
      return def ? { key: def.key, label: def.name, terms: expandCategoryTerms(def, [], ai.exclude_keywords) } : { label: c.label, terms: c.terms.length ? c.terms : [c.label] };
    }),
    excludeKeywords: ai.exclude_keywords,
    locations: ai.locations.map((l) => (l.radius_km ? { label: l.label, kind: "RADIUS", radiusM: Math.round(l.radius_km * 1000), countryCode: l.country_code ?? undefined } : { label: l.label, kind: "NAMED", countryCode: l.country_code ?? undefined, splitIntoSubAreas: l.split_into_sub_areas })),
    business: { minRating: ai.min_rating ?? undefined, minReviews: ai.min_reviews ?? undefined, sizes: ai.business_sizes, franchise: ai.franchise },
    digital: { website: ai.website.length ? ai.website : ["ANY"], instagram: ai.instagram },
    contact: { whatsapp: ai.whatsapp },
    opportunities: ai.opportunities,
    quality: { minOpportunityValue: ai.min_opportunity_value ?? undefined },
    output: { targetCount: ai.target_count ?? 100, depth: ai.depth },
  });
}

export async function startSearch(input: { criteria: unknown; name?: string; saveAs?: string | null; searchId?: string | null }) {
  return act<{ jobId: string; searchId: string | null }>(async () => {
    const s = await assertPermission("search.run");
    const criteria = searchCriteriaSchema.parse(input.criteria);
    const supabase = await createClient();
    let searchId = input.searchId ?? null;
    if (input.saveAs) {
      const { data, error } = await supabase.from("searches").insert({ organisation_id: s.organisationId, name: input.saveAs.slice(0, 120), natural_query: criteria.naturalQuery ?? null, criteria, is_template: true, created_by: s.userId }).select("id").single();
      if (error) throw new Error(error.message);
      searchId = data.id;
    }
    const admin = createAdminClient();
    const jobId = await createSearchJob(admin, { organisationId: s.organisationId, userId: s.userId, criteria, name: input.name, searchId });
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "search.started", entityType: "search_job", entityId: jobId, after: { name: input.name, target: criteria.output.targetCount, depth: criteria.output.depth } });
    return { jobId, searchId };
  });
}

export async function rerunSearch(searchId: string) {
  return act<{ jobId: string }>(async () => {
    const s = await assertPermission("search.run");
    const supabase = await createClient();
    const { data: search } = await supabase.from("searches").select("*").eq("id", z.string().uuid().parse(searchId)).single();
    if (!search) throw new Error("Search not found");
    const jobId = await createSearchJob(createAdminClient(), { organisationId: s.organisationId, userId: s.userId, criteria: searchCriteriaSchema.parse(search.criteria), name: search.name, searchId, previousJobId: search.last_job_id });
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "search.started", entityType: "search_job", entityId: jobId, metadata: { rerun: searchId } });
    return { jobId };
  });
}

export async function rerunJob(jobId: string) {
  return act<{ jobId: string }>(async () => {
    const s = await assertPermission("search.run");
    const supabase = await createClient();
    const { data: job } = await supabase.from("search_jobs").select("configuration, name, search_id").eq("id", jobId).single();
    if (!job) throw new Error("Job not found");
    const id = await createSearchJob(createAdminClient(), { organisationId: s.organisationId, userId: s.userId, criteria: searchCriteriaSchema.parse(job.configuration.criteria), name: job.name, searchId: job.search_id, previousJobId: jobId });
    return { jobId: id };
  });
}

export async function saveSearchTemplate(input: { id?: string; name: string; criteria: unknown; description?: string }) {
  return act<{ id: string }>(async () => {
    const s = await assertPermission("search.run");
    const criteria = searchCriteriaSchema.parse(input.criteria);
    const supabase = await createClient();
    const row = { name: z.string().trim().min(2).max(120).parse(input.name), description: input.description ?? null, criteria, natural_query: criteria.naturalQuery ?? null, is_template: true };
    const { data, error } = input.id
      ? await supabase.from("searches").update(row).eq("id", input.id).select("id").single()
      : await supabase.from("searches").insert({ ...row, organisation_id: s.organisationId, created_by: s.userId }).select("id").single();
    if (error) throw new Error(error.message);
    revalidatePath("/searches");
    return { id: data.id };
  });
}

export async function manageSearch(input: { id: string; op: "rename" | "duplicate" | "delete"; name?: string }) {
  return act(async () => {
    const s = await assertPermission("search.run");
    const supabase = await createClient();
    const { data: search } = await supabase.from("searches").select("*").eq("id", z.string().uuid().parse(input.id)).single();
    if (!search) throw new Error("Search not found");
    if (input.op === "rename") await supabase.from("searches").update({ name: z.string().trim().min(2).max(120).parse(input.name) }).eq("id", input.id);
    if (input.op === "duplicate") await supabase.from("searches").insert({ organisation_id: s.organisationId, name: `${search.name} (copy)`, criteria: search.criteria, natural_query: search.natural_query, is_template: true, created_by: s.userId });
    if (input.op === "delete") await supabase.from("searches").update({ archived_at: new Date().toISOString(), schedule_enabled: false }).eq("id", input.id);
    revalidatePath("/searches");
    return { ok: true as const };
  });
}

export async function scheduleSearch(input: { id: string; cron: string | null; timezone?: string }) {
  return act(async () => {
    const s = await assertPermission("search.schedule");
    const supabase = await createClient();
    if (!input.cron) {
      await supabase.from("searches").update({ schedule_enabled: false, schedule_cron: null, next_run_at: null }).eq("id", input.id);
    } else {
      const tz = input.timezone ?? "Asia/Dubai";
      let next: Date;
      try { next = nextRun(input.cron, tz); } catch { throw new Error("Invalid schedule expression"); }
      await supabase.from("searches").update({ schedule_enabled: true, schedule_cron: input.cron, schedule_timezone: tz, next_run_at: next.toISOString() }).eq("id", input.id);
    }
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "search.scheduled", entityType: "search", entityId: input.id, after: { cron: input.cron } });
    revalidatePath("/searches");
    return { ok: true as const, message: input.cron ? "Schedule saved" : "Schedule removed" };
  });
}

export async function cancelJob(jobId: string) {
  return act(async () => {
    const s = await assertPermission("search.run");
    const supabase = await createClient();
    const { data: job } = await supabase.from("search_jobs").select("id").eq("id", jobId).single();
    if (!job) throw new Error("Job not found");
    await cancelSearchJob(createAdminClient(), jobId);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "search.cancelled", entityType: "search_job", entityId: jobId });
    revalidatePath(`/searches/${jobId}`);
    return { ok: true as const, message: "Search cancelled" };
  });
}

/**
 * Approve research results into the CRM. Each lead must pass the configured
 * quality gates; failing leads stay in research with the missing items listed.
 */
export async function approveResults(input: { jobId?: string; resultIds?: string[]; allQualified?: boolean; assignTo?: string[] }) {
  return act<{ approved: number; blocked: { name: string; missing: string[] }[] }>(async () => {
    const s = await assertPermission("research.approve");
    const supabase = await createClient();
    const admin = createAdminClient();
    let q = supabase.from("search_results").select("id, business_id, stage, businesses(id, name, category_key, category_label, city, area, address, lat, phone_e164, whatsapp_e164, email, source, recommended_service, lead_score, tier, lifecycle, business_socials(id), opportunities(id))");
    if (input.allQualified && input.jobId) q = q.eq("job_id", input.jobId).eq("stage", "QUALIFIED");
    else if (input.resultIds?.length) q = q.in("id", input.resultIds);
    else throw new Error("Nothing selected");
    const { data: rows, error } = await q.limit(5000);
    if (error) throw new Error(error.message);
    const settings = await loadOrgSettings(admin, s.organisationId);
    const approvedIds: string[] = [];
    const blocked: { name: string; missing: string[] }[] = [];
    for (const r of rows ?? []) {
      const b = r.businesses as unknown as Record<string, unknown> & { business_socials: unknown[]; opportunities: unknown[] };
      if (!b) continue;
      const gate = checkQualityGates({
        name: b.name as string, categoryKey: b.category_key as string, categoryLabel: b.category_label as string, city: b.city as string, area: b.area as string, address: b.address as string, lat: b.lat as number,
        phone: b.phone_e164 as string, whatsapp: b.whatsapp_e164 as string, email: b.email as string, socialCount: b.business_socials?.length ?? 0, source: b.source as string,
        reason: (b.recommended_service as string) ?? null, leadScore: b.lead_score as number, tier: b.tier as string, opportunityCount: b.opportunities?.length ?? 0,
      }, settings.gates);
      if (!gate.passed) { blocked.push({ name: b.name as string, missing: gate.missing }); continue; }
      approvedIds.push(b.id as string);
      await admin.from("search_results").update({ stage: "APPROVED", reviewed_by: s.userId, reviewed_at: new Date().toISOString() }).eq("id", r.id);
    }
    for (let i = 0; i < approvedIds.length; i += 300) {
      await admin.from("businesses").update({ lifecycle: "ACTIVE", approved_at: new Date().toISOString(), approved_by: s.userId }).in("id", approvedIds.slice(i, i + 300)).eq("lifecycle", "RESEARCH");
    }
    if (approvedIds.length) {
      await admin.from("activities").insert(approvedIds.map((id) => ({ organisation_id: s.organisationId, business_id: id, type: "APPROVED", title: "Approved into CRM", actor_id: s.userId, search_job_id: input.jobId ?? null })));
      // Assignment: explicit users (round robin) or the organisation's assignment rules.
      const users = input.assignTo?.length ? input.assignTo : await ruleAssignees(admin, s.organisationId);
      if (users.length) await executeAssignment(admin, s.organisationId, s.userId, approvedIds, users, null, "ROUND_ROBIN");
    }
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "research.approved", entityType: "search_job", entityId: input.jobId ?? null, after: { approved: approvedIds.length, blocked: blocked.length } });
    if (input.jobId) revalidatePath(`/searches/${input.jobId}`);
    return { approved: approvedIds.length, blocked };
  });
}

async function ruleAssignees(admin: ReturnType<typeof createAdminClient>, org: string): Promise<string[]> {
  const { data } = await admin.from("org_settings").select("assignment_rules").eq("organisation_id", org).single();
  const r = (data?.assignment_rules ?? {}) as { mode?: string; users?: string[] };
  return r.mode === "ROUND_ROBIN" && r.users?.length ? r.users : [];
}

const REJECT = ["DUPLICATE", "LARGE_COMPANY", "FRANCHISE", "NO_CONTACT", "NOT_RELEVANT", "EXCELLENT_WEBSITE", "CLOSED", "INVALID", "LOW_QUALITY", "OTHER"] as const;
export async function rejectResults(input: { resultIds: string[]; reason: string; note?: string }) {
  return act(async () => {
    const s = await assertPermission("research.review");
    const reason = z.enum(REJECT).parse(input.reason);
    const supabase = await createClient();
    const { error } = await supabase.from("search_results").update({ stage: "REJECTED", reject_reason: reason, reject_note: input.note?.slice(0, 500) ?? null, reviewed_by: s.userId, reviewed_at: new Date().toISOString() }).in("id", input.resultIds);
    if (error) throw new Error(error.message);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "research.rejected", entityType: "search_result", entityId: input.resultIds.length === 1 ? input.resultIds[0] : null, after: { reason, count: input.resultIds.length } });
    return { ok: true as const, message: `${input.resultIds.length} rejected` };
  });
}

export async function moveToReview(resultIds: string[]) {
  return act(async () => {
    const s = await assertPermission("research.review");
    const supabase = await createClient();
    await supabase.from("search_results").update({ stage: "REVIEW_REQUIRED", reject_reason: null, reviewed_by: s.userId, reviewed_at: new Date().toISOString() }).in("id", resultIds);
    return { ok: true as const };
  });
}
