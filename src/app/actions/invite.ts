"use server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { act } from "./_util";

/** Accept an invite: creates the auth user (email pre-confirmed) and activates it with the invited role. */
export async function acceptInvite(token: string, fullName: string, password: string) {
  return act(async () => {
    const admin = createAdminClient();
    const hash = createHash("sha256").update(token).digest("hex");
    const { data: inv } = await admin.from("invites").select("*").eq("token_hash", hash).maybeSingle();
    if (!inv || inv.accepted_at || inv.revoked_at || Date.parse(inv.expires_at) < Date.now()) throw new Error("Invite is invalid or expired");
    const { data: created, error } = await admin.auth.admin.createUser({ email: inv.email, password: z.string().min(8).parse(password), email_confirm: true, user_metadata: { full_name: z.string().trim().min(2).max(100).parse(fullName) } });
    if (error) throw new Error(error.message);
    await admin.from("profiles").update({ organisation_id: inv.organisation_id, role_key: inv.role_key, team_id: inv.team_id, status: "ACTIVE", approved_by: inv.invited_by, approved_at: new Date().toISOString(), full_name: fullName }).eq("id", created.user.id);
    await admin.from("invites").update({ accepted_at: new Date().toISOString() }).eq("id", inv.id);
    await writeAudit({ organisationId: inv.organisation_id, userId: created.user.id, userEmail: inv.email, action: "user.invite_accepted", entityType: "user", entityId: created.user.id, after: { role: inv.role_key } });
    return { ok: true as const };
  });
}
