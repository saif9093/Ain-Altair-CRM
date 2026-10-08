import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { decideApproval } from "@/app/actions/admin";
import { fmtDate, human } from "@/lib/format";

export const metadata = { title: "Approvals" };

export default async function Approvals() {
  await requireUser("admin.approvals");
  const db = await createClient();
  const { data } = await db.from("approval_requests").select("*, requester:profiles!approval_requests_requested_by_fkey(full_name, email)").order("created_at", { ascending: false }).limit(100);
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Approvals" description="Sensitive operations (large imports, bulk archive/delete, mass reassignment, role elevation) wait here for a Super Admin decision. Every decision is logged." />
      <Card>
        <ul className="divide-y divide-line">
          {(data ?? []).map((a) => (
            <li key={a.id} className="flex flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:justify-between">
              <div><div className="font-medium">{a.summary}</div><div className="text-xs text-mute">{human(a.type)} · by {(a.requester as unknown as { full_name?: string; email?: string } | null)?.full_name} · {fmtDate(a.created_at, true)}{a.decision_note ? ` · note: ${a.decision_note}` : ""}</div></div>
              {a.status === "PENDING" ? (
                <div className="flex gap-2"><ActionButton variant="primary" action={decideApproval.bind(null, { id: a.id, approve: true })}>Approve</ActionButton><ActionButton variant="outline" action={decideApproval.bind(null, { id: a.id, approve: false })}>Reject</ActionButton></div>
              ) : <Badge tone={a.status === "EXECUTED" ? "ok" : a.status === "REJECTED" ? "neutral" : "warn"}>{human(a.status)}</Badge>}
            </li>
          ))}
          {!data?.length && <li className="px-5 py-8 text-center text-sm text-mute">No approval requests.</li>}
        </ul>
      </Card>
    </div>
  );
}
