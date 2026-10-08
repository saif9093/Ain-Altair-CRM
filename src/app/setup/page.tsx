import { isSupabaseConfigured } from "@/lib/env";
import { redirect } from "next/navigation";

export default function Setup() {
  if (isSupabaseConfigured()) redirect("/login");
  return (
    <main className="mx-auto max-w-2xl p-10">
      <div className="eyebrow mb-3">Setup required</div>
      <h1 className="display text-4xl">Connect Supabase</h1>
      <p className="mt-3 text-mute">This deployment has no database configured yet. Set these environment variables and redeploy:</p>
      <pre className="mt-4 rounded-2xl bg-paper p-5 text-sm text-white">{`NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server only
CRON_SECRET=<random string>`}</pre>
      <p className="mt-4 text-sm text-mute">Then apply the SQL migrations in <code>supabase/migrations</code>. See README → Installation.</p>
    </main>
  );
}
