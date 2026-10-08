import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Live job progress (RLS: search.view). Polled by the progress UI. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createClient();
  const { data, error } = await db.from("search_jobs").select("id, name, status, depth, started_at, completed_at, created_at, target_count, discovered_count, retained_count, duplicate_count, rejected_count, enriched_count, audited_count, qualified_count, error_count, new_count, changed_count, providers, source_status, progress, error").eq("id", id).single();
  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
