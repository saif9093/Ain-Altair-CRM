"use server";
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { canAssignRole, PERMISSIONS, ROLES, type PermissionKey, type RoleKey } from "@/lib/auth/permissions";
import { notifyUsers } from "@/lib/notifications";
import { scoringConfigSchema } from "@/lib/intel/scoring";
import { pricingConfigSchema } from "@/lib/intel/opportunities";
import { qualityGatesSchema } from "@/lib/intel/qualification";
import { appUrl } from "@/lib/env";
import { executeAssignment } from "@/lib/leads/assign";
import { act } from "./_util";

const uuid = z.string().uuid();

async function targetProfile(org: string, userId: string) {
  const { data } = await createAdminClient().from("profiles").select("*").eq("id", uuid.parse(userId)).single();
  if (!data || (data.organisation_id && data.organisation_id !== org)) throw new Error("User not found");
  return data;
}

export async function setUserStatus(input: { userId: string; status: "ACTIVE" | "REJECTED" | "SUSPENDED"; role?: RoleKey; teamId?: string | null }) {
  return act(async () => {
    const s = await assertPermission("admin.users");
    const t = await targetProfile(s.organisationId, input.userId);
    if (t.id === s.userId) throw new Error("You cannot change your own status");
    if (t.role_key === "SUPER_ADMIN" && s.role !== "SUPER_ADMIN") throw new Error("Only a Super Admin can change another Super Admin");
    const patch: Record<string, unknown> = { status: input.status, organisation_id: s.organisationId };
    if (input.status === "ACTIVE" && t.status === "PENDING") Object.assign(patch, { approved_by: s.userId, approved_at: new Date().toISOString() });
    if (input.role) {
      if (!ROLES.includes(input.role) || !canAssignRole(s.role, input.role)) throw new Error("You cannot assign that role");
      patch.role_key = input.role;
    }
    if (input.teamId !== undefined) patch.team_id = input.teamId;
    const admin = createAdminClient();
    const { error } = await admin.from("profiles").update(patch).eq("id", t.id);
    if (error) throw new Error(error.message);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: `user.${input.status.toLowerCase()}`, entityType: "user", entityId: t.id, before: { status: t.status, role: t.role_key }, after: patch });
    if (input.status === "ACTIVE") await notifyUsers(admin, s.organisationId, [t.id], { type: "ACCOUNT_APPROVED", title: "Your account was approved", body: `Role: ${(input.role ?? t.role_key).replace("_", " ")}`, link: "/dashboard" });
    revalidatePath("/admin/users");
    return { ok: true as const, message: `User ${input.status.toLowerCase()}` };
  });
}

export async function changeRole(input: { userId: string; role: RoleKey }) {
  return act(async () => {
    const s = await assertPermission("admin.users");
    const t = await targetProfile(s.organisationId, input.userId);
    if (t.id === s.userId) throw new Error("You cannot change your own role");
    if (!canAssignRole(s.role, input.role) || (t.role_key === "SUPER_ADMIN" && s.role !== "SUPER_ADMIN")) throw new Error("You cannot assign that role");
    const admin = createAdminClient();
    // Elevations to ADMIN/SUPER_ADMIN by non-super-admins go through approval.
    if ((input.role === "ADMIN" || input.role === "SUPER_ADMIN") && s.role !== "SUPER_ADMIN") {
      await admin.from("approval_requests").insert({ organisation_id: s.organisationId, type: "ROLE_CHANGE", summary: `Make ${t.email} ${input.role}`, payload: input, requested_by: s.userId });
      return { ok: true as const, message: "Role elevation requires Super Admin approval — request submitted." };
    }
    await admin.from("profiles").update({ role_key: input.role }).eq("id", t.id);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "user.role_changed", entityType: "user", entityId: t.id, before: { role: t.role_key }, after: { role: input.role } });
    revalidatePath("/admin/users");
    return { ok: true as const, message: "Role updated" };
  });
}

/** Per-user permission grant/revoke on top of the role. null = follow role. */
export async function setUserPermission(input: { userId: string; permission: string; granted: boolean | null }) {
  return act(async () => {
    const s = await assertPermission("admin.users");
    if (!(input.permission in PERMISSIONS)) throw new Error("Unknown permission");
    const perm = input.permission as PermissionKey;
    const t = await targetProfile(s.organisationId, input.userId);
    if (t.role_key === "SUPER_ADMIN") throw new Error("Super Admins always have every permission");
    if (perm.startsWith("admin.") && s.role !== "SUPER_ADMIN") throw new Error("Only a Super Admin can grant admin permissions");
    if (perm === "pricing.view" && s.role !== "SUPER_ADMIN") throw new Error("Only a Super Admin can grant pricing visibility");
    const admin = createAdminClient();
    if (input.granted === null) await admin.from("user_permissions").delete().eq("user_id", t.id).eq("permission_key", perm);
    else await admin.from("user_permissions").upsert({ user_id: t.id, permission_key: perm, granted: input.granted, created_by: s.userId }, { onConflict: "user_id,permission_key" });
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "user.permission_changed", entityType: "user", entityId: t.id, after: { permission: perm, granted: input.granted } });
    revalidatePath(`/admin/users/${t.id}`);
    return { ok: true as const, message: input.granted === null ? "Reset to role default" : input.granted ? "Permission granted" : "Permission revoked" };
  });
}

export async function upsertTeam(input: { id?: string; name: string }) {
  return act(async () => {
    const s = await assertPermission("admin.users");
    const name = z.string().trim().min(2).max(60).parse(input.name);
    const admin = createAdminClient();
    if (input.id) await admin.from("teams").update({ name }).eq("id", input.id).eq("organisation_id", s.organisationId);
    else await admin.from("teams").insert({ organisation_id: s.organisationId, name });
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "team.saved", entityType: "team", entityId: input.id ?? null, after: { name } });
    revalidatePath("/admin/users");
    return { ok: true as const };
  });
}

export async function setUserTeam(userId: string, teamId: string | null) {
  return act(async () => {
    const s = await assertPermission("admin.users");
    const t = await targetProfile(s.organisationId, userId);
    await createAdminClient().from("profiles").update({ team_id: teamId }).eq("id", t.id);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "user.team_changed", entityType: "user", entityId: t.id, before: { team: t.team_id }, after: { team: teamId } });
    revalidatePath("/admin/users");
    return { ok: true as const };
  });
}

/** Invite by email. The raw token is shown once; only its hash is stored. Expires in 7 days. */
export async function createInvite(input: { email: string; role: RoleKey; teamId?: string | null }) {
  return act<{ link: string }>(async () => {
    const s = await assertPermission("admin.users");
    const email = z.string().email().parse(input.email.trim().toLowerCase());
    if (!canAssignRole(s.role, input.role)) throw new Error("You cannot invite with that role");
    const token = randomBytes(24).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    const admin = createAdminClient();
    const { error } = await admin.from("invites").insert({ organisation_id: s.organisationId, email, role_key: input.role, team_id: input.teamId ?? null, token_hash: hash, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), invited_by: s.userId });
    if (error) throw new Error(error.message);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "user.invited", entityType: "invite", entityId: email, after: { role: input.role } });
    revalidatePath("/admin/users");
    return { link: `${appUrl()}/invite/${token}` };
  });
}

export async function revokeInvite(id: string) {
  return act(async () => {
    const s = await assertPermission("admin.users");
    await createAdminClient().from("invites").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("organisation_id", s.organisationId);
    revalidatePath("/admin/users");
    return { ok: true as const };
  });
}

export async function updateProvider(input: { key: string; enabled?: boolean; priority?: number; rateLimit?: number | null; dailyQuota?: number | null; config?: Record<string, unknown> }) {
  return act(async () => {
    const s = await assertPermission("admin.providers");
    const patch: Record<string, unknown> = {};
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.priority !== undefined) patch.priority = z.number().int().min(1).max(1000).parse(input.priority);
    if (input.rateLimit !== undefined) patch.rate_limit_per_minute = input.rateLimit;
    if (input.dailyQuota !== undefined) patch.daily_quota = input.dailyQuota;
    if (input.config) patch.config = input.config;
    const admin = createAdminClient();
    const { data: before } = await admin.from("providers").select("enabled, priority, rate_limit_per_minute, daily_quota, config").eq("organisation_id", s.organisationId).eq("key", input.key).single();
    await admin.from("providers").update(patch).eq("organisation_id", s.organisationId).eq("key", input.key);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "provider.updated", entityType: "provider", entityId: input.key, before, after: patch });
    revalidatePath("/admin/providers");
    return { ok: true as const, message: "Provider updated" };
  });
}

export async function saveSettings(input: { section: "scoring" | "pricing" | "gates" | "assignment"; value: unknown }) {
  return act(async () => {
    const s = await assertPermission(input.section === "pricing" ? "pricing.view" : "admin.scoring");
    if (input.section === "pricing") await assertPermission("admin.scoring");
    const admin = createAdminClient();
    const { data: cur } = await admin.from("org_settings").select("*").eq("organisation_id", s.organisationId).single();
    const patch: Record<string, unknown> = { updated_by: s.userId };
    if (input.section === "scoring") Object.assign(patch, { scoring_config: scoringConfigSchema.parse(input.value), scoring_version: (cur?.scoring_version ?? 1) + 1 });
    if (input.section === "pricing") patch.pricing_config = pricingConfigSchema.parse(input.value);
    if (input.section === "gates") patch.quality_gates = qualityGatesSchema.parse(input.value);
    if (input.section === "assignment") patch.assignment_rules = z.object({ mode: z.enum(["MANUAL", "ROUND_ROBIN"]), users: z.array(uuid).max(100) }).parse(input.value);
    await admin.from("org_settings").update(patch).eq("organisation_id", s.organisationId);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: `settings.${input.section}_updated`, entityType: "org_settings", entityId: s.organisationId, before: cur?.[input.section === "scoring" ? "scoring_config" : input.section === "pricing" ? "pricing_config" : input.section === "gates" ? "quality_gates" : "assignment_rules"], after: patch });
    revalidatePath("/admin/scoring");
    return { ok: true as const, message: "Settings saved" };
  });
}

/** Super Admin approves/rejects a sensitive operation; approved operations execute immediately. */
export async function decideApproval(input: { id: string; approve: boolean; note?: string }) {
  return act(async () => {
    const s = await assertPermission("admin.approvals");
    const admin = createAdminClient();
    const { data: req } = await admin.from("approval_requests").select("*").eq("id", uuid.parse(input.id)).eq("organisation_id", s.organisationId).single();
    if (!req || req.status !== "PENDING") throw new Error("Request is not pending");
    if (!input.approve) {
      await admin.from("approval_requests").update({ status: "REJECTED", decided_by: s.userId, decided_at: new Date().toISOString(), decision_note: input.note ?? null }).eq("id", req.id);
      await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "approval.rejected", entityType: "approval_request", entityId: req.id, after: { type: req.type, note: input.note } });
      if (req.requested_by) await notifyUsers(admin, s.organisationId, [req.requested_by], { type: "APPROVAL_DECIDED", title: `Rejected: ${req.summary}`, body: input.note });
      revalidatePath("/admin/approvals");
      return { ok: true as const, message: "Rejected" };
    }
    let result: unknown = null;
    let status = "EXECUTED";
    try {
      const p = req.payload as Record<string, unknown>;
      if (req.type === "MASS_REASSIGN") {
        result = { assigned: await executeAssignment(admin, s.organisationId, s.userId, p.businessIds as string[], (p.userIds as string[]) ?? [], (p.teamId as string) ?? null, (p.mode as "MANUAL" | "ROUND_ROBIN") ?? "MANUAL", !!p.unassign) };
      } else if (req.type === "BULK_ARCHIVE") {
        const ids = p.businessIds as string[];
        for (let i = 0; i < ids.length; i += 300) await admin.from("businesses").update(p.restore ? { lifecycle: "ACTIVE", archived_at: null } : { lifecycle: "ARCHIVED", archived_at: new Date().toISOString(), archived_by: s.userId }).in("id", ids.slice(i, i + 300)).eq("organisation_id", s.organisationId);
        result = { archived: ids.length };
      } else if (req.type === "ROLE_CHANGE") {
        await admin.from("profiles").update({ role_key: p.role }).eq("id", p.userId).eq("organisation_id", s.organisationId);
        result = { role: p.role };
      } else if (req.type === "LARGE_IMPORT") {
        const { enqueue } = await import("@/lib/jobs/queue");
        await admin.from("imports").update({ status: "IMPORTING" }).eq("id", p.importId as string);
        await enqueue(admin, { organisationId: s.organisationId, kind: "import.process", priority: 5, payload: { importId: p.importId, actorId: req.requested_by ?? s.userId } });
        await (await import("@/lib/jobs/kick")).kickWorker();
        result = { queued: true };
      } else if (req.type === "BULK_DELETE" || req.type === "PERMANENT_DELETE" || req.type === "DATA_PURGE") {
        const ids = (p.businessIds as string[]) ?? [];
        for (let i = 0; i < ids.length; i += 300) await admin.from("businesses").delete().in("id", ids.slice(i, i + 300)).eq("organisation_id", s.organisationId);
        result = { deleted: ids.length };
      } else if (req.type === "PERMISSION_CHANGE") {
        await admin.from("user_permissions").upsert({ user_id: p.userId, permission_key: p.permission, granted: p.granted, created_by: s.userId }, { onConflict: "user_id,permission_key" });
        result = p;
      }
    } catch (e) {
      status = "FAILED";
      result = { error: (e as Error).message };
    }
    await admin.from("approval_requests").update({ status, decided_by: s.userId, decided_at: new Date().toISOString(), decision_note: input.note ?? null, result }).eq("id", req.id);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "approval.approved", entityType: "approval_request", entityId: req.id, after: { type: req.type, status, result } });
    if (req.requested_by) await notifyUsers(admin, s.organisationId, [req.requested_by], { type: "APPROVAL_DECIDED", title: `Approved: ${req.summary}`, body: status === "FAILED" ? "Execution failed — see approvals." : undefined });
    revalidatePath("/admin/approvals");
    return { ok: true as const, message: status === "FAILED" ? "Approved but execution failed" : "Approved and executed" };
  });
}

export async function upsertCategory(input: { id?: string; key: string; name: string; synonyms: string[]; exclusions: string[]; valueMultiplier: number }) {
  return act(async () => {
    const s = await assertPermission("admin.categories");
    const admin = createAdminClient();
    const row = { organisation_id: s.organisationId, key: z.string().regex(/^[a-z0-9_]{2,60}$/).parse(input.key), name: input.name.trim().slice(0, 80), synonyms: input.synonyms.slice(0, 40), exclusions: input.exclusions.slice(0, 40), value_multiplier: Math.max(0.5, Math.min(2, input.valueMultiplier)) };
    if (input.id) await admin.from("categories").update(row).eq("id", input.id).eq("organisation_id", s.organisationId);
    else await admin.from("categories").insert(row);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "category.saved", entityType: "category", entityId: row.key, after: row });
    revalidatePath("/admin/categories");
    return { ok: true as const, message: "Category saved" };
  });
}

export async function markNotificationsRead(ids?: string[]) {
  const s = await assertPermission();
  const admin = createAdminClient();
  let q = admin.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", s.userId).is("read_at", null);
  if (ids?.length) q = q.in("id", ids);
  await q;
  revalidatePath("/notifications");
}
