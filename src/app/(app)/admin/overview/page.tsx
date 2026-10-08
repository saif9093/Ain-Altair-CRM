import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { PROVIDER_CATALOG } from "@/lib/providers/catalog";
import { providerState, type ProviderRow } from "@/lib/providers/registry";
import { fmtRelative, human, JOB_TONE } from "@/lib/format";

export const metadata = { title: "System health" };

export default async function AdminHome() {
  const s = await requireUser();
  if (!s.can("admin.users") && !s.can("admin.approvals")) return null;
  const db = await createClient();
  const admin = createAdminClient();
  const c = async (t: string, col?: string, val?: string) => {
    let q = db.from(t).select("id", { count: "exact", head: true });
    if (col) q = q.eq(col, val!);
    return (await q).count ?? 0;
  };
  const [pendingUsers, users, approvals, leads, research, imports, exports] = await Promise.all([
    c("profiles", "status", "PENDING"), c("profiles"), c("approval_requests", "status", "PENDING"),
    c("businesses", "lifecycle", "ACTIVE"), c("businesses", "lifecycle", "RESEARCH"), c("imports"), c("exports"),
  ]);
  const { data: jobs } = await db.from("search_jobs").select("id, name, status, created_at").order("created_at", { ascending: false }).limit(8);
  const { data: providers } = await admin.from("providers").select("*").eq("organisation_id", s.organisationId);
  const { data: logs } = s.can("admin.audit") ? await db.from("audit_logs").select("id, action, user_email, created_at").order("created_at", { ascending: false }).limit(10) : { data: [] };
  const { count: queue } = await admin.from("job_tasks").select("id", { count: "exact", head: true }).eq("status", "PENDING");
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Super Admin" title="System overview" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Link href="/admin/users"><Stat label="Pending users" value={pendingUsers} accent={pendingUsers > 0} /></Link>
        <Stat label="Users" value={users} />
        <Link href="/admin/approvals"><Stat label="Pending approvals" value={approvals} accent={approvals > 0} /></Link>
        <Stat label="CRM leads" value={leads} /><Stat label="In research" value={research} /><Stat label="Imports" value={imports} /><Stat label="Exports" value={exports} /><Stat label="Queued tasks" value={queue ?? 0} hint="worker backlog" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card><CardHeader eyebrow="Providers" title="Health" action={<Link href="/admin/providers" className="text-sm underline">Manage</Link>} />
          <ul className="divide-y divide-line text-sm">{PROVIDER_CATALOG.map((p) => { const row = providers?.find((r) => r.key === p.key); const st = providerState(row as ProviderRow, p.key); return <li key={p.key} className="flex justify-between px-5 py-2"><span>{p.name}</span><Badge tone={st === "READY" ? (row?.last_error_at && (!row.last_success_at || row.last_error_at > row.last_success_at) ? "warn" : "ok") : "neutral"}>{human(st)}</Badge></li>; })}</ul></Card>
        <Card><CardHeader eyebrow="Research" title="Search jobs" />
          <ul className="divide-y divide-line text-sm">{(jobs ?? []).map((j) => <li key={j.id} className="flex justify-between gap-2 px-5 py-2"><Link className="truncate underline" href={`/searches/${j.id}`}>{j.name}</Link><Badge tone={JOB_TONE[j.status]}>{human(j.status)}</Badge></li>)}</ul></Card>
        <Card><CardHeader eyebrow="Activity" title="Audit log" action={<Link href="/admin/audit-logs" className="text-sm underline">All</Link>} />
          <ul className="divide-y divide-line text-sm">{(logs ?? []).map((l) => <li key={l.id} className="px-5 py-2"><span className="tag-mono text-[10px]">{l.action}</span> <span className="text-mute">{l.user_email} · {fmtRelative(l.created_at)}</span></li>)}</ul></Card>
      </div>
    </div>
  );
}
