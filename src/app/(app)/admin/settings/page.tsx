import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, PageHeader } from "@/components/ui";
import { isAiConfigured } from "@/lib/ai/client";
import { anthropicModel } from "@/lib/env";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const s = await requireUser("admin.settings");
  const { data: org } = await createAdminClient().from("organisations").select("*").eq("id", s.organisationId).single();
  const env = [["Supabase", !!process.env.SUPABASE_SERVICE_ROLE_KEY], ["Cron secret", !!process.env.CRON_SECRET], ["AI (Claude)", isAiConfigured()], ["App URL", !!process.env.NEXT_PUBLIC_APP_URL]] as const;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin" title="System settings" />
      <Card className="p-5 text-sm">
        <div><b>Organisation:</b> {org?.name} · currency {org?.default_currency} · default country {org?.default_country_code} · {org?.timezone}</div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">{env.map(([k, v]) => <div key={k} className="rounded-xl bg-ink-2 p-3"><div className="text-xs text-mute">{k}</div><div className={v ? "text-ok" : "text-warn"}>{v ? "Configured" : "NOT CONFIGURED"}</div></div>)}</div>
        <p className="mt-3 text-xs text-mute">AI model: {anthropicModel()}. Secrets are environment variables on the server and are never displayed.</p>
      </Card>
    </div>
  );
}
