import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_PERMISSIONS, ROLES, canAssignRole, type RoleKey } from "@/lib/auth/permissions";
import { human, fmtDate } from "@/lib/format";
import { UserManage } from "../users-client";

export const metadata = { title: "User" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireUser("admin.users");
  const { id } = await params;
  const admin = createAdminClient();
  const { data: u } = await admin.from("profiles").select("*").eq("id", id).single();
  if (!u || (u.organisation_id && u.organisation_id !== s.organisationId)) notFound();
  const [{ data: teams }, { data: ov }, { count: owned }] = await Promise.all([
    admin.from("teams").select("id, name").eq("organisation_id", s.organisationId),
    admin.from("user_permissions").select("permission_key, granted").eq("user_id", id),
    admin.from("businesses").select("id", { count: "exact", head: true }).eq("owner_id", id).eq("lifecycle", "ACTIVE"),
  ]);
  const role = u.role_key as RoleKey;
  return (
    <div>
      <PageHeader eyebrow="User" title={u.full_name ?? u.email} description={<span className="flex gap-2"><Badge tone="navy">{human(role)}</Badge><Badge tone={u.status === "ACTIVE" ? "ok" : "warn"}>{human(u.status)}</Badge><span>{u.email} · {owned ?? 0} assigned leads · joined {fmtDate(u.created_at)}</span></span>} />
      <Card className="p-5">
        {u.id === s.userId ? <p className="text-sm text-mute">You cannot change your own role or permissions.</p> :
          <UserManage user={{ id: u.id, status: u.status, role, teamId: u.team_id }} roles={ROLES.filter((r) => canAssignRole(s.role, r))} teams={teams ?? []}
            perms={ALL_PERMISSIONS.map((p) => ({ key: p, description: PERMISSIONS[p].description, category: PERMISSIONS[p].category, fromRole: ROLE_PERMISSIONS[role].includes(p) }))}
            overrides={Object.fromEntries((ov ?? []).map((o) => [o.permission_key, o.granted]))} />}
      </Card>
    </div>
  );
}
