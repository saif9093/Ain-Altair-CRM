import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runWorkerBatch } from "@/lib/jobs/runner";

export const maxDuration = 300;

/** Serverless worker tick (e.g. Vercel Cron every minute). Protected by CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const processed = await runWorkerBatch(createAdminClient(), { workerId: `cron:${Date.now()}`, concurrency: 4, deadlineMs: 240_000 });
  return NextResponse.json({ processed });
}
