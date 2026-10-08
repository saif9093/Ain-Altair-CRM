"use client";
import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { CopyButton, useAction } from "@/components/client";
import { changeRole, createInvite, setUserPermission, setUserStatus, setUserTeam, upsertTeam } from "@/app/actions/admin";
import { human } from "@/lib/format";
import type { RoleKey } from "@/lib/auth/permissions";

export function UserRowActions({ user, roles, teams, self }: { user: { id: string; status: string; role: string; teamId: string | null }; roles: readonly RoleKey[]; teams: { id: string; name: string }[]; self: boolean }) {
  const [role, setRole] = useState<RoleKey>((roles.includes("SALES") ? "SALES" : roles[0]) as RoleKey);
  const [team, setTeam] = useState(user.teamId ?? "");
  const { run, pending } = useAction();
  if (self) return <span className="text-xs text-mute">You</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className="h-8 w-36 text-xs" value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>{roles.map((r) => <option key={r} value={r}>{human(r)}</option>)}</Select>
      <Select className="h-8 w-36 text-xs" value={team} onChange={(e) => setTeam(e.target.value)}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => setUserStatus({ userId: user.id, status: "ACTIVE", role, teamId: team || null }))}>Approve</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setUserStatus({ userId: user.id, status: "REJECTED" }))}>Reject</Button>
    </div>
  );
}

export function UserManage({ user, roles, teams, perms, overrides }: { user: { id: string; status: string; role: RoleKey; teamId: string | null }; roles: readonly RoleKey[]; teams: { id: string; name: string }[]; perms: { key: string; description: string; category: string; fromRole: boolean }[]; overrides: Record<string, boolean> }) {
  const { run, pending } = useAction();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-44" defaultValue={user.role} disabled={user.role === "SUPER_ADMIN" && !roles.includes("SUPER_ADMIN")} onChange={(e) => run(() => changeRole({ userId: user.id, role: e.target.value as RoleKey }))}>{[...new Set([user.role, ...roles])].map((r) => <option key={r} value={r}>{human(r)}</option>)}</Select>
        <Select className="w-44" defaultValue={user.teamId ?? ""} onChange={(e) => run(() => setUserTeam(user.id, e.target.value || null))}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        {user.status === "ACTIVE" ? <Button variant="danger" size="sm" disabled={pending} onClick={() => confirm("Suspend this user?") && run(() => setUserStatus({ userId: user.id, status: "SUSPENDED" }))}>Suspend</Button>
          : <Button variant="primary" size="sm" disabled={pending} onClick={() => run(() => setUserStatus({ userId: user.id, status: "ACTIVE" }))}>Reactivate</Button>}
      </div>
      <div>
        <div className="tag-mono mb-2 text-[11px] text-mute">Permissions (role default + per-user overrides)</div>
        <div className="divide-y divide-line rounded-2xl border border-line">
          {perms.map((p) => {
            const ov = overrides[p.key];
            const effective = ov ?? p.fromRole;
            return (
              <div key={p.key} className="flex flex-col gap-2 px-4 py-2.5 text-sm md:flex-row md:items-center md:justify-between">
                <div><span className="font-medium">{p.description}</span> <span className="tag-mono text-[10px] text-dim">{p.key}</span><div className="text-xs text-mute">{p.category} · role default: {p.fromRole ? "allowed" : "denied"}{ov !== undefined && <b className="text-warn"> · overridden</b>}</div></div>
                <div className="flex items-center gap-1">
                  <span className={`mr-2 text-xs font-semibold ${effective ? "text-ok" : "text-signal-ink"}`}>{effective ? "ALLOWED" : "DENIED"}</span>
                  <Button size="sm" variant={ov === true ? "dark" : "outline"} disabled={pending || user.role === "SUPER_ADMIN"} onClick={() => run(() => setUserPermission({ userId: user.id, permission: p.key, granted: true }))}>Grant</Button>
                  <Button size="sm" variant={ov === false ? "danger" : "outline"} disabled={pending || user.role === "SUPER_ADMIN"} onClick={() => run(() => setUserPermission({ userId: user.id, permission: p.key, granted: false }))}>Revoke</Button>
                  {ov !== undefined && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setUserPermission({ userId: user.id, permission: p.key, granted: null }))}>Reset</Button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function InviteForm({ roles, teams }: { roles: readonly RoleKey[]; teams: { id: string; name: string }[] }) {
  const { run, pending } = useAction();
  const [link, setLink] = useState("");
  return (
    <form className="space-y-2" action={(fd) => run(() => createInvite({ email: String(fd.get("email")), role: String(fd.get("role")) as RoleKey, teamId: String(fd.get("team") || "") || null }), { onDone: (d) => setLink((d as { link: string }).link) })}>
      <div className="grid gap-2 md:grid-cols-3"><Input name="email" type="email" required placeholder="name@company.com" /><Select name="role">{roles.map((r) => <option key={r} value={r}>{human(r)}</option>)}</Select><Select name="team"><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></div>
      <Button size="sm" variant="dark" disabled={pending}>Create invite link</Button>
      {link && <div className="rounded-xl bg-ink-2 p-3 text-xs"><div className="mb-1 break-all">{link}</div><CopyButton text={link} label="Copy link" /><div className="mt-1 text-mute">Shown once. Expires in 7 days. Send it to the invitee.</div></div>}
    </form>
  );
}

export function TeamForm() {
  const { run, pending } = useAction();
  return <form className="flex gap-2" action={(fd) => run(() => upsertTeam({ name: String(fd.get("name")) }))}><Input name="name" placeholder="Team name" required /><Button size="sm" variant="dark" disabled={pending}>Add team</Button></form>;
}
