import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buildOutreachQueue } from "@/lib/leads/outreach-queue";
import { OutreachFlow } from "./outreach-flow";

export const metadata = { title: "Start outreach" };

export default async function OutreachPage() {
  const s = await requireUser("outreach.log");
  const db = await createClient();
  const queue = await buildOutreachQueue(db, s.userId, s.fullName, s.role === "SALES");
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const { count: doneToday } = await db.from("outreach").select("id", { count: "exact", head: true }).eq("user_id", s.userId).gte("created_at", start.toISOString());
  return <OutreachFlow queue={queue} doneToday={doneToday ?? 0} firstName={s.fullName?.split(" ")[0] ?? "there"} />;
}
