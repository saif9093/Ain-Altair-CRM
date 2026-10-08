import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasPermission, type PermissionKey, type RoleKey } from "./permissions";

export interface SessionContext {
  userId: string;
  email: string;
  fullName: string | null;
  role: RoleKey;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";
  organisationId: string;
  teamId: string | null;
  overrides: { permission: PermissionKey; granted: boolean }[];
  can: (p: PermissionKey) => boolean;
}

/** Loads the signed-in user's profile + permission overrides once per request. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role_key, status, organisation_id, team_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return null;
  const { data: overrides } = await supabase.from("user_permissions").select("permission_key, granted").eq("user_id", user.id);
  const ctx: SessionContext = {
    userId: user.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role_key as RoleKey,
    status: profile.status,
    organisationId: profile.organisation_id,
    teamId: profile.team_id,
    overrides: (overrides ?? []).map((o) => ({ permission: o.permission_key as PermissionKey, granted: o.granted })),
    can: () => false,
  };
  ctx.can = (p) => hasPermission({ role: ctx.role, status: ctx.status, overrides: ctx.overrides }, p);
  return ctx;
});

/** For pages: redirect when not signed in / not active / lacking permission. */
export async function requireUser(perm?: PermissionKey): Promise<SessionContext> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.status === "PENDING") redirect("/pending");
  if (s.status !== "ACTIVE") redirect("/suspended");
  if (perm && !s.can(perm)) redirect("/forbidden");
  return s;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status = 403) {
    super(message);
  }
}

/** For server actions / route handlers: throw instead of redirecting. */
export async function assertPermission(perm?: PermissionKey): Promise<SessionContext> {
  const s = await getSession();
  if (!s) throw new AuthError("Not signed in", 401);
  if (s.status !== "ACTIVE") throw new AuthError("Account is not active", 403);
  if (perm && !s.can(perm)) throw new AuthError(`Missing permission: ${perm}`, 403);
  return s;
}
