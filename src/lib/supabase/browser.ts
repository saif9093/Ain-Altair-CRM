"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Browser client: anon key + user session only. Never holds privileged credentials. */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
