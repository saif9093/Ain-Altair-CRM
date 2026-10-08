import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s || s.status !== "ACTIVE") return NextResponse.json([], { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 120) ?? "";
  if (q.trim().length < 2) return NextResponse.json([]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("global_search", { q, max_results: 15 }); // RLS-filtered
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
