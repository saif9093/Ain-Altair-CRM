import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { InviteAccept } from "./accept";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: inv } = await createAdminClient().from("invites").select("email, expires_at, accepted_at, revoked_at").eq("token_hash", hash).maybeSingle();
  const valid = inv && !inv.accepted_at && !inv.revoked_at && Date.parse(inv.expires_at) > Date.now();
  if (!valid) return <div><div className="eyebrow mb-3">Invite</div><h2 className="display text-4xl">Link expired</h2><p className="mt-2 text-sm text-mute">This invite is invalid, used or expired. Ask an admin for a new one.</p></div>;
  return <InviteAccept token={token} email={inv.email} />;
}
