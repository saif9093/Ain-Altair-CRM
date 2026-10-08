import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCriteria, type SearchCriteria } from "@/lib/search/criteria";
import { getAdapter, selectDiscoveryProviders, enrichmentAvailability } from "@/lib/providers/registry";
import { NotConfiguredError, ProviderError } from "@/lib/providers/http";
import { pointInPolygon } from "@/lib/geo/geo";
import { loadOrgSettings, type OrgSettings } from "@/lib/research/settings";
import { expandSubAreas, resolveLocation } from "@/lib/research/location";
import { planSourceTasks, categoryKeyOf, type ResolvedLocation, type SourceTaskPlan } from "@/lib/research/planner";
import { ingestRawBusiness } from "@/lib/research/ingest";
import { processBusiness, recordUsage } from "@/lib/research/process";
import { computeJobStats, recommendNextSearches } from "@/lib/research/intelligence";
import { generateLeadAnalysis } from "@/lib/research/ai-analysis";
import { notifyPermission, notifyUsers } from "@/lib/notifications";
import { enqueue, deferTask, type JobTask } from "./queue";
import { TERMINAL } from "./search-jobs";

/** Error that should not be retried (bad config, invalid input). */
export class FatalTaskError extends Error {}

export interface HandlerResult { deferMs?: number; deferPayload?: Record<string, unknown> }
type Handler = (db: SupabaseClient, t: JobTask) => Promise<HandlerResult | void>;

const settingsCache = new Map<string, { at: number; s: OrgSettings }>();
async function settingsFor(db: SupabaseClient, org: string) {
  const c = settingsCache.get(org);
  if (c && Date.now() - c.at < 60_000) return c.s;
  const s = await loadOrgSettings(db, org);
  settingsCache.set(org, { at: Date.now(), s });
  return s;
}

async function loadJob(db: SupabaseClient, jobId: string) {
  const { data, error } = await db.from("search_jobs").select("*").eq("id", jobId).single();
  if (error || !data) throw new FatalTaskError(`job ${jobId} not found`);
  return data;
}

const MAX_PAGES: Record<string, number> = { google_places: 3, apify_google_maps: 50, osm_overpass: 1 };
const OVERFETCH = 2.5;

// ---------------------------------------------------------------------------
async function planSearch(db: SupabaseClient, t: JobTask) {
  const job = await loadJob(db, t.job_id!);
  if (TERMINAL.includes(job.status)) return;
  const settings = await settingsFor(db, job.organisation_id);
  const criteria = parseCriteria(job.configuration.criteria);

  const { chosen, skipped } = selectDiscoveryProviders(settings.providers, criteria.providers);
  const sourceStatus: Record<string, unknown> = {};
  for (const s of skipped) sourceStatus[s.key] = { state: "SKIPPED", reason: s.reason, found: 0, pages: 0 };
  if (!chosen.length) {
    await db.from("search_jobs").update({ status: "FAILED", source_status: sourceStatus, error: "No discovery provider is configured and enabled. Configure one in Admin → Providers.", completed_at: new Date().toISOString(), started_at: new Date().toISOString() }).eq("id", job.id);
    if (job.created_by) await notifyUsers(db, job.organisation_id, [job.created_by], { type: "SEARCH_FAILED", title: `Search failed: ${job.name}`, body: "No configured data provider.", link: `/searches/${job.id}` });
    return;
  }

  const resolved: ResolvedLocation[] = [];
  const locationErrors: string[] = [];
  for (const spec of criteria.locations.flatMap(expandSubAreas)) {
    try {
      const r = await resolveLocation(db, spec, settings.defaultCountry);
      if (r) resolved.push(r);
      else locationErrors.push(`Could not find "${spec.label}"`);
    } catch (e) {
      locationErrors.push(`${spec.label}: ${(e as Error).message}`);
    }
  }
  if (!resolved.length) {
    await db.from("search_jobs").update({ status: "FAILED", error: `Location could not be resolved. ${locationErrors.join("; ")}`, source_status: sourceStatus, completed_at: new Date().toISOString() }).eq("id", job.id);
    return;
  }

  const since = new Date(Date.now() - criteria.coverage.skipRecentlySearchedDays * 86_400_000).toISOString();
  const catKeys = criteria.categories.map(categoryKeyOf);
  const { data: recent } = criteria.coverage.skipRecentlySearchedDays > 0
    ? await db.from("search_coverage").select("provider, category_key, cell_id, searched_at").eq("organisation_id", job.organisation_id).in("category_key", catKeys).gte("searched_at", since)
    : { data: [] };

  const plan = planSourceTasks({
    categories: criteria.categories, locations: resolved, providers: chosen.map((c) => c.key), depth: criteria.output.depth,
    keywords: criteria.keywords, targetCount: criteria.output.targetCount, splitLargeAreas: criteria.coverage.splitLargeAreas, recentCoverage: recent ?? [],
  });
  for (const c of chosen) sourceStatus[c.key] = { state: "RUNNING", found: 0, pages: 0, tasks: plan.tasks.filter((x) => x.provider === c.key).length, priority: c.priority };

  await db.from("search_jobs").update({
    status: "RUNNING",
    started_at: new Date().toISOString(),
    providers: chosen.map((c) => c.key),
    provider: chosen[0].key,
    location_definition: { requested: criteria.locations, resolved: resolved.map((r) => ({ ...r, polygon: r.polygon ? `${r.polygon.length} points` : null })), errors: locationErrors },
    category_definition: { requested: criteria.categories, keys: catKeys },
    source_status: sourceStatus,
    progress: { sourcing: { total: plan.tasks.length }, skippedCells: plan.skippedCells.length, skippedCellsDetail: plan.skippedCells.slice(0, 50) },
  }).eq("id", job.id);

  if (!plan.tasks.length) {
    // Everything was searched recently: go straight to finalisation.
    await enqueue(db, { organisationId: job.organisation_id, jobId: job.id, kind: "search.finalize", priority: 5 });
    await db.rpc("transition_job", { p_job: job.id, p_from: ["RUNNING"], p_to: "DEDUPLICATING" });
    return;
  }
  await enqueue(db, plan.tasks.map((p, i) => ({ organisationId: job.organisation_id, jobId: job.id, kind: "search.source" as const, priority: 20 + Math.floor(i / 10), payload: { plan: p, pageToken: null, page: 0 } })));
}

// ---------------------------------------------------------------------------
async function sourceSearch(db: SupabaseClient, t: JobTask): Promise<HandlerResult | void> {
  const job = await loadJob(db, t.job_id!);
  if (TERMINAL.includes(job.status) || job.status !== "RUNNING") return;
  const settings = await settingsFor(db, job.organisation_id);
  const criteria: SearchCriteria = parseCriteria(job.configuration.criteria);
  const plan = t.payload.plan as SourceTaskPlan;
  const page = (t.payload.page as number) ?? 0;
  const target = job.target_count * OVERFETCH;

  if (job.retained_count >= target && !(t.payload.pageToken as string | null)?.startsWith("run:")) return; // enough candidates

  const adapter = getAdapter(plan.provider);
  if (!adapter?.searchBusinesses) throw new FatalTaskError(`Provider ${plan.provider} cannot search`);
  const row = settings.providers.find((p) => p.key === plan.provider);
  let res;
  try {
    res = await adapter.searchBusinesses({
      term: plan.term, categoryKey: plan.categoryKey, osmTags: plan.osmTags, googleTypes: plan.googleTypes,
      location: { label: plan.locationLabel, center: plan.cell.center, radiusM: plan.cell.radiusM || undefined, bbox: plan.cell.radiusM ? plan.cell.bbox : undefined, polygon: plan.cell.polygon ?? undefined, countryCode: plan.countryCode ?? undefined },
      maxResults: plan.maxResults,
    }, (t.payload.pageToken as string | null) ?? null, { rateLimitPerMinute: row?.rate_limit_per_minute, config: (row?.config ?? {}) as Record<string, unknown> });
  } catch (e) {
    await recordUsage(db, job.organisation_id, plan.provider, 1, false, (e as Error).message);
    if (e instanceof NotConfiguredError) throw new FatalTaskError(e.message);
    throw e;
  }
  await recordUsage(db, job.organisation_id, plan.provider, res.usageUnits ?? 0, true);
  if (res.pending) return { deferMs: res.retryAfterMs ?? 20_000, deferPayload: { ...t.payload, pageToken: res.nextPageToken } };

  const polygons = criteria.locations.filter((l) => l.polygon?.length).map((l) => l.polygon!);
  let retained = 0, duplicates = 0, errors = 0, outside = 0;
  for (const raw of res.results) {
    try {
      if (polygons.length && raw.lat != null && raw.lng != null && !polygons.some((p) => pointInPolygon({ lat: raw.lat!, lng: raw.lng! }, p))) { outside++; continue; }
      const r = await ingestRawBusiness(db, {
        organisationId: job.organisation_id, jobId: job.id, createdBy: job.created_by, defaultCountry: plan.countryCode ?? settings.defaultCountry,
        categoryKey: plan.categoryKey.startsWith("custom:") ? null : plan.categoryKey, categoryLabel: plan.categoryLabel,
      }, raw);
      const { data: existing } = await db.from("search_results").select("id, sources").eq("job_id", job.id).eq("business_id", r.businessId).maybeSingle();
      if (existing) {
        duplicates++;
        if (!existing.sources.includes(plan.provider)) await db.from("search_results").update({ sources: [...existing.sources, plan.provider] }).eq("id", existing.id);
      } else {
        const { error } = await db.from("search_results").insert({
          organisation_id: job.organisation_id, job_id: job.id, business_id: r.businessId, stage: "RAW",
          matched_existing: r.matchedExisting, sources: [plan.provider], category_key: plan.categoryKey,
          ...(r.matchedLifecycle === "ACTIVE" ? { stage: "APPROVED", reviewed_at: new Date().toISOString() } : {}),
        });
        if (error && error.code === "23505") duplicates++;
        else if (error) throw new Error(error.message);
        else retained++;
      }
    } catch (e) {
      errors++;
      console.error(`[source] record failed (${plan.provider} ${raw.externalId}):`, (e as Error).message);
    }
  }

  await db.rpc("increment_job_counters", { p_job: job.id, deltas: { discovered_count: res.results.length, retained_count: retained, duplicate_count: duplicates, error_count: errors } });
  const st = (job.source_status?.[plan.provider] ?? {}) as Record<string, number | string>;
  await db.rpc("patch_job_json", { p_job: job.id, col: "source_status", patch: { [plan.provider]: { ...st, state: "RUNNING", found: Number(st.found ?? 0) + res.results.length, pages: Number(st.pages ?? 0) + 1, outsideArea: Number(st.outsideArea ?? 0) + outside } } });

  const { data: cov } = await db.from("search_coverage").select("result_count").eq("organisation_id", job.organisation_id).eq("category_key", plan.categoryKey).eq("provider", plan.provider).eq("cell_id", plan.cell.id).maybeSingle();
  await db.from("search_coverage").upsert({
    organisation_id: job.organisation_id, category_key: plan.categoryKey, provider: plan.provider, cell_id: plan.cell.id, location_label: plan.locationLabel,
    bbox: plan.cell.bbox, lat: plan.cell.center.lat, lng: plan.cell.center.lng, radius_m: plan.cell.radiusM, result_count: (page === 0 ? 0 : cov?.result_count ?? 0) + res.results.length,
    exhausted: !res.nextPageToken, job_id: job.id, searched_at: new Date().toISOString(),
  }, { onConflict: "organisation_id,category_key,provider,cell_id" });

  if (res.nextPageToken && page + 1 < (MAX_PAGES[plan.provider] ?? 3) && job.retained_count + retained < target) {
    await enqueue(db, { organisationId: job.organisation_id, jobId: job.id, kind: "search.source", priority: 15, payload: { plan, pageToken: res.nextPageToken, page: page + 1 } });
    const prog = (job.progress?.sourcing ?? {}) as { total?: number };
    await db.rpc("patch_job_json", { p_job: job.id, col: "progress", patch: { sourcing: { total: (prog.total ?? 0) + 1 } } });
  }
}

// ---------------------------------------------------------------------------
async function enrichResults(db: SupabaseClient, t: JobTask) {
  const job = await loadJob(db, t.job_id!);
  if (TERMINAL.includes(job.status)) return;
  const settings = await settingsFor(db, job.organisation_id);
  const criteria = parseCriteria(job.configuration.criteria);
  const ids = t.payload.businessIds as string[];
  let enriched = 0, audited = 0, qualified = 0, rejected = 0, changed = 0, errors = 0;
  for (const id of ids) {
    const { data: sr } = await db.from("search_results").select("id, stage, reviewed_by").eq("job_id", job.id).eq("business_id", id).single();
    if (!sr) continue;
    const humanDecided = !!sr.reviewed_by || sr.stage === "APPROVED";
    if (!humanDecided) await db.from("search_results").update({ stage: "ENRICHING" }).eq("id", sr.id);
    try {
      const r = await processBusiness(db, id, { depth: criteria.output.depth, settings, criteria, jobId: job.id });
      enriched++;
      if (r.audited) audited++;
      if (r.changes.length) changed++;
      const q = r.qualification!;
      if (q.stage === "QUALIFIED") qualified++;
      if (q.stage === "REJECTED") rejected++;
      await db.from("search_results").update({
        ...(humanDecided ? {} : { stage: q.stage, reject_reason: q.stage === "REJECTED" ? q.rejectReason ?? "OTHER" : null }),
        qualification: { checks: q.checks, errors: r.errors }, changes: r.changes,
      }).eq("id", sr.id);
    } catch (e) {
      errors++;
      await db.from("search_results").update({ stage: humanDecided ? sr.stage : "REVIEW_REQUIRED", qualification: { error: (e as Error).message } }).eq("id", sr.id);
    }
  }
  await db.rpc("increment_job_counters", { p_job: job.id, deltas: { enriched_count: enriched + errors, audited_count: audited, qualified_count: qualified, rejected_count: rejected, changed_count: changed, error_count: errors } });
}

// ---------------------------------------------------------------------------
async function aiAnalyse(db: SupabaseClient, t: JobTask) {
  const ids = t.payload.businessIds as string[];
  let done = 0;
  for (const id of ids) {
    try {
      await generateLeadAnalysis(db, id);
      done++;
    } catch (e) {
      console.error("[ai] analysis failed", id, (e as Error).message);
    }
  }
  if (t.job_id) await db.rpc("patch_job_json", { p_job: t.job_id, col: "progress", patch: { aiDoneBatch: { [String(t.id)]: done } } });
}

// ---------------------------------------------------------------------------
async function finalizeSearch(db: SupabaseClient, t: JobTask) {
  const job = await loadJob(db, t.job_id!);
  if (["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return;

  // New since previous run of the same saved search
  if (job.previous_job_id) {
    const prevIds = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from("search_results").select("business_id").eq("job_id", job.previous_job_id).range(from, from + 999);
      for (const d of data ?? []) prevIds.add(d.business_id);
      if (!data || data.length < 1000) break;
    }
    const { data: mine } = await db.from("search_results").select("id, business_id").eq("job_id", job.id);
    const seen = (mine ?? []).filter((m) => prevIds.has(m.business_id)).map((m) => m.id);
    for (let i = 0; i < seen.length; i += 200) await db.from("search_results").update({ is_new: false }).in("id", seen.slice(i, i + 200));
  } else {
    // First run: "new" means not already in the CRM/research before this job.
    await db.from("search_results").update({ is_new: false }).eq("job_id", job.id).eq("matched_existing", true);
  }

  const stats = await computeJobStats(db, job.id);
  const resolved = ((job.location_definition?.resolved ?? []) as { label: string; city?: string | null }[]);
  const recommendations = await recommendNextSearches(db, job.organisation_id, stats, resolved).catch(() => []);
  const sources = (job.source_status ?? {}) as Record<string, { state: string }>;
  const ran = Object.values(sources).filter((s) => s.state !== "SKIPPED");
  const failed = ran.filter((s) => s.state === "FAILED").length;
  for (const [k, v] of Object.entries(sources)) if (v.state === "RUNNING") sources[k] = { ...v, state: "DONE" };
  const status = ran.length && failed === ran.length && stats.found === 0 ? "FAILED" : failed > 0 || job.error_count > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED";
  await db.from("search_jobs").update({
    status, stats, recommendations, source_status: sources, new_count: stats.newSinceLast, completed_at: new Date().toISOString(),
    error: status === "FAILED" ? "All providers failed. See source status for details." : job.error,
  }).eq("id", job.id);

  if (job.created_by) {
    await notifyUsers(db, job.organisation_id, [job.created_by], {
      type: "SEARCH_COMPLETED", title: `Search ${status === "FAILED" ? "failed" : "completed"}: ${job.name}`,
      body: `${stats.found} businesses found · ${stats.qualified} qualified · ${stats.reviewRequired} need review`, link: `/searches/${job.id}`,
    });
  }
  if (stats.hot > 0) {
    await notifyPermission(db, job.organisation_id, "research.approve", { type: "HIGH_VALUE_LEADS", title: `${stats.hot} HOT lead${stats.hot > 1 ? "s" : ""} found`, body: job.name, link: `/searches/${job.id}?tier=HOT` });
  }
  if (job.is_scheduled && stats.changed > 0) {
    const { data: alerts } = await db.from("activities").select("id").eq("search_job_id", job.id).eq("data->>alert", "true");
    if ((alerts?.length ?? 0) > 0) await notifyPermission(db, job.organisation_id, "research.review", { type: "RESEARCH_ALERT", title: `${alerts!.length} new opportunity alert(s)`, body: `Changes detected by scheduled search: ${job.name}`, link: `/searches/${job.id}?changed=1` });
  }
  await db.from("audit_logs").insert({ organisation_id: job.organisation_id, user_id: job.created_by, action: "search.completed", entity_type: "search_job", entity_id: job.id, after: { status, found: stats.found, qualified: stats.qualified }, metadata: { scheduled: job.is_scheduled } });
}

// ---------------------------------------------------------------------------
async function processLeads(db: SupabaseClient, t: JobTask) {
  const settings = await settingsFor(db, t.organisation_id);
  const ids = t.payload.businessIds as string[];
  const depth = (t.payload.depth as "FAST" | "BALANCED" | "DEEP") ?? "BALANCED";
  const steps = (t.payload.steps as Record<string, boolean>) ?? {};
  for (const id of ids) {
    try {
      await processBusiness(db, id, { depth, settings, steps, actorId: (t.payload.actorId as string) ?? null });
      if (t.payload.ai && enrichmentAvailability(settings.providers).ai) await generateLeadAnalysis(db, id);
    } catch (e) {
      console.error("[lead.process] failed", id, (e as Error).message);
    }
  }
}

async function processImport(db: SupabaseClient, t: JobTask): Promise<HandlerResult | void> {
  const { executeImport } = await import("@/lib/imports/execute");
  const r = await executeImport(db, t.payload.importId as string, t.payload.actorId as string, Date.now() + 35_000);
  if (!r.done) return { deferMs: 1_000 };
}

export const HANDLERS: Record<string, Handler> = {
  "import.process": processImport,
  "search.plan": planSearch,
  "search.source": sourceSearch,
  "search.enrich": enrichResults,
  "lead.ai": aiAnalyse,
  "search.finalize": finalizeSearch,
  "lead.process": processLeads,
};

/**
 * Stage machine. Called after each task finishes. transition_job() is atomic,
 * so exactly one worker enqueues the next stage.
 */
export async function advanceJob(db: SupabaseClient, jobId: string) {
  const { data: job } = await db.from("search_jobs").select("id, organisation_id, status, depth, configuration").eq("id", jobId).single();
  if (!job || TERMINAL.includes(job.status)) return;
  const { data: counts } = await db.rpc("job_task_counts", { p_job: jobId });
  const open = (kinds: string[]) => (counts ?? []).filter((c: { kind: string }) => kinds.includes(c.kind)).reduce((a: number, c: { pending: number; running: number }) => a + Number(c.pending) + Number(c.running), 0);

  if (job.status === "RUNNING" && open(["search.plan", "search.source"]) === 0) {
    if (!(await transition(db, jobId, ["RUNNING"], "ENRICHING"))) return;
    // Mark sources done / failed
    const { data: failedSrc } = await db.from("job_tasks").select("payload, last_error").eq("job_id", jobId).eq("kind", "search.source").eq("status", "FAILED");
    const { data: fresh } = await db.from("search_jobs").select("source_status").eq("id", jobId).single();
    const ss = { ...(fresh?.source_status ?? {}) } as Record<string, Record<string, unknown>>;
    for (const f of failedSrc ?? []) {
      const key = (f.payload as { plan: SourceTaskPlan }).plan.provider;
      ss[key] = { ...ss[key], failedTasks: Number(ss[key]?.failedTasks ?? 0) + 1, lastError: f.last_error };
    }
    for (const [k, v] of Object.entries(ss)) {
      if (v.state !== "RUNNING") continue;
      const pages = Number(v.pages ?? 0);
      ss[k] = { ...v, state: pages === 0 && Number(v.failedTasks ?? 0) > 0 ? "FAILED" : Number(v.failedTasks ?? 0) > 0 ? "PARTIAL" : "DONE" };
    }
    await db.from("search_jobs").update({ source_status: ss }).eq("id", jobId);

    const ids: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from("search_results").select("business_id").eq("job_id", jobId).range(from, from + 999);
      ids.push(...(data ?? []).map((d) => d.business_id));
      if (!data || data.length < 1000) break;
    }
    await db.rpc("patch_job_json", { p_job: jobId, col: "progress", patch: { enrichment: { total: ids.length } } });
    if (!ids.length) {
      await transition(db, jobId, ["ENRICHING"], "DEDUPLICATING");
      await enqueue(db, { organisationId: job.organisation_id, jobId, kind: "search.finalize", priority: 5 });
      return;
    }
    const batch = job.depth === "FAST" ? 25 : 5;
    const tasks = [];
    for (let i = 0; i < ids.length; i += batch) tasks.push({ organisationId: job.organisation_id, jobId, kind: "search.enrich" as const, priority: 50, payload: { businessIds: ids.slice(i, i + batch) } });
    await enqueue(db, tasks);
    return;
  }

  if (job.status === "ENRICHING" && open(["search.enrich"]) === 0) {
    const settings = await settingsFor(db, job.organisation_id);
    const wantAi = job.depth === "DEEP" && enrichmentAvailability(settings.providers).ai;
    if (wantAi) {
      if (!(await transition(db, jobId, ["ENRICHING"], "SCORING"))) return;
      const { data: top } = await db.from("search_results").select("business_id, businesses!inner(lead_score)").eq("job_id", jobId).in("stage", ["QUALIFIED", "REVIEW_REQUIRED"]).order("lead_score", { referencedTable: "businesses", ascending: false }).limit(100);
      const ids = (top ?? []).map((r) => r.business_id);
      await db.rpc("patch_job_json", { p_job: jobId, col: "progress", patch: { ai: { total: ids.length } } });
      const tasks = [];
      for (let i = 0; i < ids.length; i += 3) tasks.push({ organisationId: job.organisation_id, jobId, kind: "lead.ai" as const, priority: 60, payload: { businessIds: ids.slice(i, i + 3) } });
      if (tasks.length) { await enqueue(db, tasks); return; }
    }
    if (await transition(db, jobId, ["ENRICHING", "SCORING"], "DEDUPLICATING")) {
      await enqueue(db, { organisationId: job.organisation_id, jobId, kind: "search.finalize", priority: 5 });
    }
    return;
  }

  if (job.status === "SCORING" && open(["lead.ai"]) === 0) {
    if (await transition(db, jobId, ["SCORING"], "DEDUPLICATING")) {
      await enqueue(db, { organisationId: job.organisation_id, jobId, kind: "search.finalize", priority: 5 });
    }
  }
}

async function transition(db: SupabaseClient, jobId: string, from: string[], to: string): Promise<boolean> {
  const { data } = await db.rpc("transition_job", { p_job: jobId, p_from: from, p_to: to });
  return data === true;
}

export function isRetryable(e: unknown): { retryable: boolean; retryAfterMs?: number } {
  if (e instanceof FatalTaskError) return { retryable: false };
  if (e instanceof ProviderError) return { retryable: e.retryable, retryAfterMs: e.retryAfterMs };
  return { retryable: true };
}

export { deferTask };
