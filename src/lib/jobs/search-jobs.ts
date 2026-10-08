import type { SupabaseClient } from "@supabase/supabase-js";
import { criteriaSummary, type SearchCriteria } from "@/lib/search/criteria";
import { enqueue, cancelJobTasks } from "./queue";

export interface CreateJobInput {
  organisationId: string;
  userId: string | null;
  criteria: SearchCriteria;
  name?: string;
  searchId?: string | null;
  scheduled?: boolean;
  previousJobId?: string | null;
}

/** Creates a QUEUED search job and its planning task. Work happens in the worker. */
export async function createSearchJob(db: SupabaseClient, input: CreateJobInput): Promise<string> {
  const c = input.criteria;
  const { data, error } = await db.from("search_jobs").insert({
    organisation_id: input.organisationId,
    search_id: input.searchId ?? null,
    name: input.name ?? criteriaSummary(c),
    created_by: input.userId,
    status: "QUEUED",
    depth: c.output.depth,
    is_scheduled: !!input.scheduled,
    previous_job_id: input.previousJobId ?? null,
    target_count: c.output.targetCount,
    configuration: { criteria: c },
    filters: { business: c.business, digital: c.digital, contact: c.contact, quality: c.quality, exclude: c.excludeKeywords },
    location_definition: { requested: c.locations },
    category_definition: { requested: c.categories },
    progress: {},
  }).select("id").single();
  if (error) throw new Error(`Could not create search job: ${error.message}`);
  await enqueue(db, { organisationId: input.organisationId, jobId: data.id, kind: "search.plan", priority: 10 });
  if (input.searchId) {
    const { data: s } = await db.from("searches").select("run_count").eq("id", input.searchId).maybeSingle();
    await db.from("searches").update({ last_run_at: new Date().toISOString(), last_job_id: data.id, run_count: (s?.run_count ?? 0) + 1 }).eq("id", input.searchId);
  }
  return data.id;
}

export async function cancelSearchJob(db: SupabaseClient, jobId: string) {
  await db.from("search_jobs").update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), completed_at: new Date().toISOString() })
    .eq("id", jobId).not("status", "in", "(COMPLETED,PARTIALLY_COMPLETED,FAILED,CANCELLED)");
  await cancelJobTasks(db, jobId);
}

export const TERMINAL = ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"];
