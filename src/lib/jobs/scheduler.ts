import type { SupabaseClient } from "@supabase/supabase-js";
import { CronExpressionParser } from "cron-parser";
import { parseCriteria } from "@/lib/search/criteria";
import { createSearchJob } from "./search-jobs";
import { notifyUsers } from "@/lib/notifications";

export function nextRun(cron: string, tz: string, from = new Date()): Date {
  return CronExpressionParser.parse(cron, { currentDate: from, tz }).next().toDate();
}

/** Starts due scheduled searches and sends follow-up reminders. Idempotent. */
export async function runScheduler(db: SupabaseClient): Promise<{ started: number; reminders: number }> {
  const nowIso = new Date().toISOString();
  let started = 0;
  const { data: due } = await db.from("searches").select("*").eq("schedule_enabled", true).is("archived_at", null).lte("next_run_at", nowIso).limit(20);
  for (const s of due ?? []) {
    // Claim by advancing next_run_at first so concurrent schedulers don't double-start.
    const next = nextRun(s.schedule_cron, s.schedule_timezone).toISOString();
    const { data: claimed } = await db.from("searches").update({ next_run_at: next }).eq("id", s.id).eq("next_run_at", s.next_run_at).select("id");
    if (!claimed?.length) continue;
    try {
      await createSearchJob(db, { organisationId: s.organisation_id, userId: s.created_by, criteria: parseCriteria(s.criteria), name: `${s.name} (scheduled)`, searchId: s.id, scheduled: true, previousJobId: s.last_job_id });
      started++;
    } catch (e) {
      console.error("[scheduler] failed to start", s.id, (e as Error).message);
    }
  }

  // Follow-up reminders: due within the next hour or overdue, not yet notified.
  let reminders = 0;
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const { data: fus } = await db.from("follow_ups").select("id, due_at, note, assigned_to, created_by, business_id, businesses(name, organisation_id)").eq("status", "PENDING").is("notified_at", null).lte("due_at", soon).limit(200);
  for (const f of fus ?? []) {
    const b = f.businesses as unknown as { name: string; organisation_id: string } | null;
    if (!b) continue;
    const overdue = Date.parse(f.due_at) < Date.now();
    await notifyUsers(db, b.organisation_id, [f.assigned_to ?? f.created_by].filter(Boolean) as string[], {
      type: overdue ? "FOLLOW_UP_OVERDUE" : "FOLLOW_UP_DUE", title: `${overdue ? "Overdue" : "Follow-up due"}: ${b.name}`, body: f.note ?? undefined, link: `/leads/${f.business_id}`,
    });
    await db.from("follow_ups").update({ notified_at: nowIso }).eq("id", f.id);
    reminders++;
  }
  return { started, reminders };
}
