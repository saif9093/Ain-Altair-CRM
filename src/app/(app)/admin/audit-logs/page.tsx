import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Audit logs" };

export default async function AuditLogs({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  await requireUser("admin.audit");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const db = await createClient();
  let q = db.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (sp.action) q = q.ilike("action", `${sp.action}%`);
  const { data, count } = await q.range((page - 1) * 100, page * 100 - 1);
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Audit logs" description="Append-only record of every important operation (who, when, what, before → after)." />
      <form className="mb-3"><input name="action" defaultValue={sp.action} placeholder="Filter by action prefix e.g. lead., user., search." className="h-10 w-80 rounded-xl border border-line-strong bg-ink-3 px-3 text-sm" /></form>
      <Card className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="tag-mono text-left text-[10px] text-mute"><tr className="border-b border-line">{["Time", "User", "Action", "Entity", "Before", "After"].map((h) => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {(data ?? []).map((l) => (
              <tr key={l.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2">{fmtDate(l.created_at, true)}</td><td className="px-3 py-2">{l.user_email ?? "system"}</td><td className="px-3 py-2 font-mono">{l.action}</td>
                <td className="px-3 py-2">{l.entity_type}{l.entity_type === "business" && l.entity_id ? <> <Link className="underline" href={`/leads/${l.entity_id}`}>open</Link></> : ""}</td>
                <td className="max-w-[260px] px-3 py-2"><pre className="whitespace-pre-wrap break-all text-[10px] text-mute">{l.before ? JSON.stringify(l.before).slice(0, 400) : ""}</pre></td>
                <td className="max-w-[260px] px-3 py-2"><pre className="whitespace-pre-wrap break-all text-[10px]">{l.after ? JSON.stringify(l.after).slice(0, 400) : ""}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="mt-3 flex justify-between text-sm">{page > 1 ? <Link className="underline" href={`?page=${page - 1}&action=${sp.action ?? ""}`}>← Newer</Link> : <span />}{page * 100 < (count ?? 0) && <Link className="underline" href={`?page=${page + 1}&action=${sp.action ?? ""}`}>Older →</Link>}</div>
    </div>
  );
}
