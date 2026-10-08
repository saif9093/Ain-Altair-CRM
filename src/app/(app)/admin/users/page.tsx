import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { fmtDate, human } from "@/lib/format";
import { ROLES, canAssignRole } from "@/lib/auth/permissions";
import { UserRowActions, InviteForm, TeamForm } from "./users-client";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const s = await requireUser("admin.users");
  const admin = createAdminClient();
  const [{ data: users }, { data: teams }, { data: invites }] = await Promise.all([
    admin.from("profiles").select("*").or(`organisation_id.eq.${s.organisationId},organisation_id.is.null`).order("status").order("created_at", { ascending: false }),
    admin.from("teams").select("id, name").eq("organisation_id", s.organisationId).order("name"),
    admin.from("invites").select("*").eq("organisation_id", s.organisationId).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false }),
  ]);
  const roles = ROLES.filter((r) => canAssignRole(s.role, r));
  const pending = (users ?? []).filter((u) => u.status === "PENDING");
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin" title="Users & teams" description="Approve new users, assign roles and teams, and fine-tune individual permissions." />
      {!!pending.length && (
        <Card className="border-signal/40">
          <CardHeader eyebrow="Awaiting approval" title={`${pending.length} new user${pending.length > 1 ? "s" : ""}`} />
          <ul className="divide-y divide-line">{pending.map((u) => <li key={u.id} className="flex flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:justify-between"><div><div className="font-medium">{u.full_name}</div><div className="text-xs text-mute">{u.email} · registered {fmtDate(u.created_at, true)}</div></div><UserRowActions user={{ id: u.id, status: u.status, role: u.role_key, teamId: u.team_id }} roles={roles} teams={teams ?? []} self={u.id === s.userId} /></li>)}</ul>
        </Card>
      )}
      <Card className="overflow-x-auto">
        <CardHeader eyebrow="Directory" title="All users" />
        <table className="w-full text-sm">
          <thead className="tag-mono text-left text-[10.5px] text-mute"><tr className="border-b border-line">{["User", "Role", "Team", "Status", "Approved", ""].map((h) => <th key={h} className="px-4 py-2 font-normal">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {(users ?? []).filter((u) => u.status !== "PENDING").map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2.5"><Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">{u.full_name ?? u.email}</Link><div className="text-xs text-mute">{u.email}</div></td>
                <td className="px-4 py-2.5"><Badge tone={u.role_key === "SUPER_ADMIN" ? "signal" : "navy"}>{human(u.role_key)}</Badge></td>
                <td className="px-4 py-2.5">{teams?.find((t) => t.id === u.team_id)?.name ?? "—"}</td>
                <td className="px-4 py-2.5"><Badge tone={u.status === "ACTIVE" ? "ok" : "warn"}>{human(u.status)}</Badge></td>
                <td className="px-4 py-2.5 text-xs text-mute">{fmtDate(u.approved_at)}</td>
                <td className="px-4 py-2.5"><Link href={`/admin/users/${u.id}`} className="text-xs underline">Role & permissions →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader eyebrow="Invites" title="Invite by email" /><div className="p-5"><InviteForm roles={roles} teams={teams ?? []} />
          <ul className="mt-4 space-y-1 text-sm">{(invites ?? []).map((i) => <li key={i.id} className="flex justify-between"><span>{i.email} · {human(i.role_key)}</span><span className="text-xs text-mute">expires {fmtDate(i.expires_at)}</span></li>)}</ul></div></Card>
        <Card><CardHeader eyebrow="Teams" title="Sales teams" /><div className="p-5"><TeamForm /><ul className="mt-3 space-y-1 text-sm">{(teams ?? []).map((t) => <li key={t.id}>{t.name} · {(users ?? []).filter((u) => u.team_id === t.id).length} members</li>)}</ul></div></Card>
      </div>
    </div>
  );
}
