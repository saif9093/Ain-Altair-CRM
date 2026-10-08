import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Append-only audit trail. Written with the service role so users cannot
 * forge or alter entries (RLS has no insert policy for users; a trigger
 * blocks updates/deletes).
 */
export interface AuditEntry {
  organisationId: string | null;
  userId: string | null;
  userEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Keep only the fields that changed, to make before/after diffs readable. */
export function diffObjects(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined) {
  if (!before || !after) return { before: before ?? null, after: after ?? null };
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === "updated_at" || k === "search_text") continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a };
}

export async function writeAudit(e: AuditEntry): Promise<void> {
  let ip: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip");
  } catch {
    /* outside a request (worker) */
  }
  const { error } = await createAdminClient().from("audit_logs").insert({
    organisation_id: e.organisationId,
    user_id: e.userId,
    user_email: e.userEmail ?? null,
    action: e.action,
    entity_type: e.entityType,
    entity_id: e.entityId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    metadata: e.metadata ?? {},
    ip,
  });
  if (error) console.error("[audit] failed to write audit log", error.message, e.action);
}
