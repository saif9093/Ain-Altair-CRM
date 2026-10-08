import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionKey } from "@/lib/auth/permissions";
import { ROLE_PERMISSIONS, type RoleKey } from "@/lib/auth/permissions";

export interface NewNotification {
  type: string;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
}

export async function notifyUsers(admin: SupabaseClient, organisationId: string, userIds: string[], n: NewNotification) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  await admin.from("notifications").insert(ids.map((user_id) => ({ organisation_id: organisationId, user_id, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, data: n.data ?? {} })));
}

/** Notify every active user in the organisation whose role grants a permission. */
export async function notifyPermission(admin: SupabaseClient, organisationId: string, perm: PermissionKey, n: NewNotification) {
  const roles = (Object.keys(ROLE_PERMISSIONS) as RoleKey[]).filter((r) => ROLE_PERMISSIONS[r].includes(perm));
  const { data } = await admin.from("profiles").select("id").eq("organisation_id", organisationId).eq("status", "ACTIVE").in("role_key", roles);
  await notifyUsers(admin, organisationId, (data ?? []).map((d) => d.id), n);
}
