import type { SupabaseClient } from "@supabase/supabase-js";

export type TaskKind = "search.plan" | "search.source" | "search.enrich" | "lead.ai" | "search.finalize" | "lead.process" | "import.process";

export interface JobTask {
  id: number;
  organisation_id: string;
  job_id: string | null;
  kind: TaskKind;
  payload: Record<string, unknown>;
  priority: number;
  status: string;
  attempts: number;
  max_attempts: number;
  run_after: string;
  last_error: string | null;
}

export interface NewTask {
  organisationId: string;
  jobId?: string | null;
  kind: TaskKind;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date;
}

export async function enqueue(db: SupabaseClient, tasks: NewTask | NewTask[]): Promise<void> {
  const list = Array.isArray(tasks) ? tasks : [tasks];
  if (!list.length) return;
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await db.from("job_tasks").insert(list.slice(i, i + 500).map((t) => ({
      organisation_id: t.organisationId,
      job_id: t.jobId ?? null,
      kind: t.kind,
      payload: t.payload ?? {},
      priority: t.priority ?? 100,
      max_attempts: t.maxAttempts ?? 4,
      run_after: (t.runAfter ?? new Date()).toISOString(),
    })));
    if (error) throw new Error(`enqueue failed: ${error.message}`);
  }
}

export async function claimTasks(db: SupabaseClient, worker: string, n: number): Promise<JobTask[]> {
  const { data, error } = await db.rpc("claim_job_tasks", { worker, n });
  if (error) throw new Error(`claim failed: ${error.message}`);
  return (data ?? []) as JobTask[];
}

export async function completeTask(db: SupabaseClient, id: number) {
  await db.from("job_tasks").update({ status: "DONE", finished_at: new Date().toISOString(), locked_at: null }).eq("id", id);
}

/** Put a task back without consuming an attempt (e.g. async provider still running). */
export async function deferTask(db: SupabaseClient, t: JobTask, delayMs: number, payload?: Record<string, unknown>) {
  await db.from("job_tasks").update({
    status: "PENDING", attempts: Math.max(0, t.attempts - 1), locked_at: null, locked_by: null,
    run_after: new Date(Date.now() + delayMs).toISOString(), ...(payload ? { payload } : {}),
  }).eq("id", t.id);
}

/** Retry with exponential backoff, or fail permanently when attempts are exhausted. Returns true if final. */
export async function failTask(db: SupabaseClient, t: JobTask, err: unknown, retryable: boolean, retryAfterMs?: number): Promise<boolean> {
  const message = err instanceof Error ? err.message : String(err);
  const final = !retryable || t.attempts >= t.max_attempts;
  const delay = retryAfterMs ?? Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, t.attempts - 1));
  await db.from("job_tasks").update({
    status: final ? "FAILED" : "PENDING",
    last_error: message.slice(0, 2000),
    locked_at: null,
    locked_by: null,
    run_after: new Date(Date.now() + (final ? 0 : delay)).toISOString(),
    finished_at: final ? new Date().toISOString() : null,
  }).eq("id", t.id);
  return final;
}

export async function cancelJobTasks(db: SupabaseClient, jobId: string) {
  await db.from("job_tasks").update({ status: "CANCELLED", finished_at: new Date().toISOString() }).eq("job_id", jobId).in("status", ["PENDING"]);
}
