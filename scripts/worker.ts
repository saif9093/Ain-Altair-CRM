/**
 * Background worker: processes the job queue continuously and runs the
 * scheduler every minute. Run with `npm run worker` (needs the server env:
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, provider keys).
 */
import { hostname } from "node:os";
import { createAdminClient } from "../src/lib/supabase/admin";
import { runWorkerBatch } from "../src/lib/jobs/runner";
import { runScheduler } from "../src/lib/jobs/scheduler";

const db = createAdminClient();
const workerId = `${hostname()}:${process.pid}`;
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function main() {
  console.log(`[worker] ${workerId} started (concurrency ${concurrency})`);
  let lastSchedule = 0;
  while (!stopping) {
    if (Date.now() - lastSchedule > 60_000) {
      lastSchedule = Date.now();
      try {
        const r = await runScheduler(db);
        if (r.started || r.reminders) console.log(`[scheduler] started ${r.started} searches, sent ${r.reminders} reminders`);
      } catch (e) {
        console.error("[scheduler]", (e as Error).message);
      }
    }
    try {
      const n = await runWorkerBatch(db, { workerId, concurrency, deadlineMs: 30_000 });
      if (!n) await new Promise((r) => setTimeout(r, 2_000));
    } catch (e) {
      console.error("[worker]", (e as Error).message);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  console.log("[worker] stopped");
}
main();
