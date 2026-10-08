import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/** Supabase client bound to the signed-in user's session (RLS enforced). */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = publicEnv();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component — middleware refreshes the session instead.
        }
      },
    },
  });
}
