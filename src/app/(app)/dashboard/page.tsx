import Link from "next/link";
import { CalendarClock, MessageCircle, Plus, Send, ThumbsUp, Trophy, UserPlus, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink, Card, CardHeader, Stat } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Home" };

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Dubai" }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function Home() {
  const s = await requireUser();
  const db = await createClient();
  const first = s.fullName?.split(" ")[0] ?? "there";
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const isAdmin = s.can("leads.assign");
  const leads = () => db.from("businesses").select("id", { count: "exact", head: true }).eq("lifecycle", "ACTIVE");

  const [{ count: toContact }, { count: dueToday }, { count: interested }, { count: won }, { count: contactedToday }] = await Promise.all([
    isAdmin ? leads().eq("pipeline_stage", "NOT_CONTACTED") : leads().eq("pipeline_stage", "NOT_CONTACTED").eq("owner_id", s.userId),
    db.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "PENDING").eq("assigned_to", s.userId).lte("due_at", endToday.toISOString()),
    isAdmin ? leads().in("pipeline_stage", ["INTERESTED", "MEETING", "QUOTE_SENT"]) : leads().in("pipeline_stage", ["INTERESTED", "MEETING", "QUOTE_SENT"]).eq("owner_id", s.userId),
    isAdmin ? leads().eq("pipeline_stage", "WON") : leads().eq("pipeline_stage", "WON").eq("owner_id", s.userId),
    isAdmin ? db.from("outreach").select("id", { count: "exact", head: true }).gte("created_at", start.toISOString()) : db.from("outreach").select("id", { count: "exact", head: true }).eq("user_id", s.userId).gte("created_at", start.toISOString()),
  ]);
  const myQueue = isAdmin ? (await leads().eq("pipeline_stage", "NOT_CONTACTED").or(`owner_id.eq.${s.userId},owner_id.is.null`)).count ?? 0 : toContact ?? 0;

  // Team table for admins/managers
  let team: { id: string; name: string; assigned: number; toContact: number; today: number; interested: number; won: number }[] = [];
  let unassigned = 0;
  if (isAdmin) {
    const { data: users } = await db.from("profiles").select("id, full_name, email, role_key").eq("status", "ACTIVE").order("full_name");
    team = await Promise.all((users ?? []).filter((u) => u.role_key !== "VIEWER").map(async (u) => {
      const [a, t, td, i, w] = await Promise.all([
        leads().eq("owner_id", u.id), leads().eq("owner_id", u.id).eq("pipeline_stage", "NOT_CONTACTED"),
        db.from("outreach").select("id", { count: "exact", head: true }).eq("user_id", u.id).gte("created_at", start.toISOString()),
        leads().eq("owner_id", u.id).in("pipeline_stage", ["INTERESTED", "MEETING", "QUOTE_SENT"]), leads().eq("owner_id", u.id).eq("pipeline_stage", "WON"),
      ]);
      return { id: u.id, name: u.full_name ?? u.email, assigned: a.count ?? 0, toContact: t.count ?? 0, today: td.count ?? 0, interested: i.count ?? 0, won: w.count ?? 0 };
    }));
    unassigned = (await leads().is("owner_id", null)).count ?? 0;
  }
  const queue = (dueToday ?? 0) + myQueue;

  return (
    <div className="space-y-6">
      <section className="hero-bg relative overflow-hidden rounded-3xl p-6 text-white md:p-10">
        <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-signal/30 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="tag-mono text-[11px] text-white/60">{fmtDate(new Date().toISOString())}</div>
            <h1 className="display mt-3 text-4xl md:text-6xl">{greeting()}, {first}.</h1>
            <p className="mt-3 text-[16px] text-white/80">
              {queue > 0 ? <>You have <b className="text-white">{queue} {queue === 1 ? "business" : "businesses"}</b> to contact today.</> : "Nothing waiting right now."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {s.can("outreach.log") && <ButtonLink href="/outreach" variant="primary" size="lg"><Send size={17} />Start contacting</ButtonLink>}
            {(s.can("imports.run") || s.can("search.run")) && <ButtonLink href="/add" size="lg" variant="light"><Plus size={17} />Add leads</ButtonLink>}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={isAdmin ? "Not contacted yet" : "My leads to contact"} value={toContact ?? 0} icon={<Users size={16} />} href="/leads?tab=new" />
        <Stat label="My follow-ups today" value={dueToday ?? 0} icon={<CalendarClock size={16} />} tone="warn" href="/leads?tab=followup" />
        <Stat label={isAdmin ? "Contacted today (team)" : "Contacted today"} value={contactedToday ?? 0} icon={<MessageCircle size={16} />} tone="ok" />
        <Stat label="Interested" value={interested ?? 0} icon={<ThumbsUp size={16} />} tone="navy" href="/leads?tab=interested" />
        <Stat label="Won" value={won ?? 0} icon={<Trophy size={16} />} tone="ok" href="/leads?tab=won" />
      </div>

      {isAdmin && unassigned > 0 && (
        <Card className="flex flex-col gap-3 border-signal/40 p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-signal-tint text-signal"><UserPlus size={18} /></div><div><b>{unassigned} leads</b> aren&apos;t assigned to anyone yet.</div></div>
          <ButtonLink href="/leads?owner=unassigned" variant="dark">Assign them →</ButtonLink>
        </Card>
      )}

      {isAdmin && (
        <Card className="overflow-hidden">
          <CardHeader eyebrow="Team" title="Who is doing what" action={<Link href="/admin/users" className="text-sm underline">Manage team</Link>} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-mute"><tr className="border-b border-line">{["Person", "Leads", "Not contacted", "Contacted today", "Interested", "Won"].map((h) => <th key={h} className="px-5 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {team.map((t) => (
                  <tr key={t.id} className="hover:bg-ink-2">
                    <td className="px-5 py-3 font-medium"><Link href={`/leads?owner=${t.id}`} className="hover:underline">{t.name}</Link></td>
                    <td className="px-5 py-3">{t.assigned}</td>
                    <td className="px-5 py-3">{t.toContact}</td>
                    <td className="px-5 py-3"><span className={t.today ? "font-bold text-ok" : "text-dim"}>{t.today}</span></td>
                    <td className="px-5 py-3">{t.interested}</td>
                    <td className="px-5 py-3">{t.won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
