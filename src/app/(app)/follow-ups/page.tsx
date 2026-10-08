import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { completeFollowUp } from "@/app/actions/leads";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Follow-ups" };

export default async function FollowUps({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const s = await requireUser("outreach.log");
  const sp = await searchParams;
  const db = await createClient();
  let q = db.from("follow_ups").select("id, due_at, note, assigned_to, business_id, businesses(name, lead_code, whatsapp_e164, phone_e164)").eq("status", "PENDING").order("due_at").limit(500);
  if (!sp.all) q = q.eq("assigned_to", s.userId);
  const { data } = await q;
  const now = new Date();
  const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
  const endTomorrow = new Date(endToday.getTime() + 86_400_000);
  const endWeek = new Date(endToday.getTime() + 6 * 86_400_000);
  const groups: [string, (d: Date) => boolean][] = [["Overdue", (d) => d < now], ["Today", (d) => d >= now && d <= endToday], ["Tomorrow", (d) => d > endToday && d <= endTomorrow], ["This week", (d) => d > endTomorrow && d <= endWeek], ["Upcoming", (d) => d > endWeek]];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Sales" title="Follow-ups" actions={<Link className="text-sm underline" href={sp.all ? "/follow-ups" : "/follow-ups?all=1"}>{sp.all ? "Only mine" : "All visible"}</Link>} />
      {groups.map(([label, test]) => {
        const items = (data ?? []).filter((f) => test(new Date(f.due_at)));
        return (
          <Card key={label}>
            <CardHeader eyebrow={label} title={`${items.length} follow-up${items.length === 1 ? "" : "s"}`} />
            <ul className="divide-y divide-line">
              {items.map((f) => {
                const b = f.businesses as unknown as { name: string; lead_code: string } | null;
                return (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div><Link href={`/leads/${f.business_id}`} className="font-medium hover:underline">{b?.name}</Link><div className="text-xs text-mute">{fmtDate(f.due_at, true)}{f.note ? ` · ${f.note}` : ""}</div></div>
                    <div className="flex items-center gap-2">{label === "Overdue" && <Badge tone="signal">Overdue</Badge>}<ActionButton action={completeFollowUp.bind(null, f.id, undefined)}>Done</ActionButton></div>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
