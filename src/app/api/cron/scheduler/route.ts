import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runScheduler } from "@/lib/jobs/scheduler";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  return NextResponse.json(await runScheduler(createAdminClient()));
}
