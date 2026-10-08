import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceJob, HANDLERS, isRetryable } from "./handlers";
import { claimTasks, completeTask, deferTask, failTask, type JobTask } from "./queue";

/**
 * Executes queued tasks. Used by the long-running worker (scripts/worker.ts)
 * and the serverless cron route. A failing task never takes the job down:
 * it is retried with backoff and, when exhausted, recorded as failed while
 * the rest of the job continues.
 */
export async function runTask(db: SupabaseClient, t: JobTask): Promise<void> {
  const handler = HANDLERS[t.kind];
  try {
    if (!handler) throw new Error(`No handler for ${t.kind}`);
    const r = await handler(db, t);
    if (r && r.deferMs) {
      await deferTask(db, t, r.deferMs, r.deferPayload);
      return;
    }
    await completeTask(db, t.id);
  } catch (e) {
    const { retryable, retryAfterMs } = isRetryable(e);
    const final = await failTask(db, t, e, retryable, retryAfterMs);
    console.error(`[worker] task ${t.id} ${t.kind} ${final ? "FAILED" : "will retry"}: ${(e as Error).message}`);
    if (final && t.job_id) await db.rpc("increment_job_counters", { p_job: t.job_id, deltas: { error_count: 1 } });
  }
  if (t.job_id) {
    try {
      await advanceJob(db, t.job_id);
    } catch (e) {
      console.error(`[worker] advance failed for job ${t.job_id}:`, (e as Error).message);
    }
  }
}

export async function runWorkerBatch(db: SupabaseClient, opts: { workerId: string; concurrency?: number; deadlineMs?: number }): Promise<number> {
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000);
  const concurrency = opts.concurrency ?? 4;
  let processed = 0;
  while (Date.now() < deadline) {
    const tasks = await claimTasks(db, opts.workerId, concurrency);
    if (!tasks.length) break;
    await Promise.all(tasks.map((t) => runTask(db, t)));
    processed += tasks.length;
  }
  return processed;
}
