import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. SERVER ONLY — bypasses RLS. Used by the job worker,
 * audit logging and admin operations *after* explicit permission checks.
 * The key is not NEXT_PUBLIC_, so it can never be bundled for the browser.
 */
let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("createAdminClient must never run in the browser");
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  cached = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}
