import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui";
import { loadOrgSettings } from "@/lib/research/settings";
import { SettingsEditor } from "./settings-editor";

export const metadata = { title: "Scoring" };

export default async function Scoring() {
  const s = await requireUser("admin.scoring");
  const admin = createAdminClient();
  const settings = await loadOrgSettings(admin, s.organisationId);
  const { data: row } = await admin.from("org_settings").select("assignment_rules").eq("organisation_id", s.organisationId).single();
  const { data: users } = await admin.from("profiles").select("id, full_name, email").eq("organisation_id", s.organisationId).eq("status", "ACTIVE");
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Scoring, pricing, gates & assignment" description={`Scoring config v${settings.scoringVersion}. Changes apply to newly processed leads; use Re-score to refresh existing ones.`} />
      <SettingsEditor sections={[
        { key: "scoring", title: "Lead score weights & tiers", value: settings.scoring },
        { key: "gates", title: "Research → CRM quality gates", value: settings.gates },
        { key: "assignment", title: "Auto-assignment on approval", value: { mode: "MANUAL", users: [], ...(row?.assignment_rules ?? {}) }, hint: `Mode MANUAL or ROUND_ROBIN; users = profile ids. Active users: ${(users ?? []).map((u) => `${u.full_name ?? u.email}=${u.id}`).join(", ")}` },
        ...(s.can("pricing.view") ? [{ key: "pricing" as const, title: "Pricing packages (restricted)", value: settings.pricing }] : []),
      ]} />
    </div>
  );
}
