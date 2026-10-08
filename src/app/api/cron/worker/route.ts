import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runWorkerBatch } from "@/lib/jobs/runner";
import { runScheduler } from "@/lib/jobs/scheduler";

export const maxDuration = 60;

/**
 * Serverless worker tick. Called every minute by Supabase pg_cron (or Vercel
 * Cron / any scheduler). Protected by CRON_SECRET. Each tick also runs the
 * scheduler so scheduled searches and follow-up reminders stay on time.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const db = createAdminClient();
  const schedule = await runScheduler(db).catch((e: Error) => ({ error: e.message }));
  const processed = await runWorkerBatch(db, { workerId: `cron:${Date.now()}`, concurrency: 4, deadlineMs: 45_000 });
  return NextResponse.json({ processed, schedule });
}

export const POST = GET;
