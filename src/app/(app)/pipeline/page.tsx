import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { STAGES } from "@/lib/format";
import { Board } from "./board";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const s = await requireUser();
  const sp = await searchParams;
  const db = await createClient();
  const cols = await Promise.all(STAGES.map(async (stage) => {
    let q = db.from("businesses").select("id, name, lead_code, tier, lead_score, area, city, recommended_service, whatsapp_e164, next_follow_up_at", { count: "exact" }).eq("lifecycle", "ACTIVE").eq("pipeline_stage", stage);
    if (sp.owner === "me") q = q.eq("owner_id", s.userId);
    const { data, count } = await q.order("lead_score", { ascending: false, nullsFirst: false }).limit(60);
    return { stage, items: data ?? [], count: count ?? 0 };
  }));
  return (
    <div>
      <PageHeader eyebrow="Sales" title="Pipeline" description="Drag cards between stages — changes save to the database." actions={<a href={sp.owner === "me" ? "/pipeline" : "/pipeline?owner=me"} className="text-sm underline">{sp.owner === "me" ? "Show all visible" : "Only mine"}</a>} />
      <Board columns={cols as never} canEdit={s.can("leads.edit")} />
    </div>
  );
}
