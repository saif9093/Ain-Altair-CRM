import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyUsers } from "@/lib/notifications";

/**
 * Executes a (pre-authorised) assignment. NOT a server action: callers must
 * check leads.assign / approvals before invoking it.
 */
export async function executeAssignment(admin: SupabaseClient, org: string, actor: string, ids: string[], users: string[], teamId: string | null, mode: "MANUAL" | "ROUND_ROBIN", unassign = false): Promise<number> {
  const { data: profs } = users.length ? await admin.from("profiles").select("id, team_id, full_name, email").in("id", users) : { data: [] };
  const byUser = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i++) {
    const owner = unassign ? null : users.length ? (mode === "ROUND_ROBIN" ? users[i % users.length] : users[0]) : null;
    const key = owner ?? "";
    byUser.set(key, [...(byUser.get(key) ?? []), ids[i]]);
  }
  for (const [owner, list] of byUser) {
    const team = owner ? teamId ?? profs?.find((p) => p.id === owner)?.team_id ?? null : unassign ? null : teamId;
    for (let i = 0; i < list.length; i += 300) {
      await admin.from("businesses").update({ owner_id: owner || null, team_id: team }).in("id", list.slice(i, i + 300)).eq("organisation_id", org);
    }
    const who = profs?.find((p) => p.id === owner);
    await admin.from("activities").insert(list.map((id) => ({ organisation_id: org, business_id: id, type: "ASSIGNED", title: owner ? `Assigned to ${who?.full_name ?? who?.email}` : "Unassigned", actor_id: actor, data: { owner, team } })));
    if (owner && owner !== actor) await notifyUsers(admin, org, [owner], { type: "LEADS_ASSIGNED", title: `${list.length} lead${list.length > 1 ? "s" : ""} assigned to you`, link: "/leads?owner=me" });
  }
  return ids.length;
}

