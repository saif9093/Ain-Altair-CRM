import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Circle, Flame, Globe, MessageCircle, Phone, Search, Send, ThumbsUp, Trophy, Users, Wrench, Zap } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, ButtonLink, Card, CardHeader, Stat } from "@/components/ui";
import { TierBadge, WebsiteBadge } from "@/components/lead-bits";
import { fmtDate, fmtRelative, human, JOB_TONE, money, STAGES } from "@/lib/format";
import { isProviderConfigured } from "@/lib/providers/catalog";

export const metadata = { title: "Home" };

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Dubai" }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function Dashboard() {
  const s = await requireUser();
  const db = await createClient();
  const first = s.fullName?.split(" ")[0] ?? "there";
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const isBdo = !s.can("search.run");

  const [{ data: stats }, { count: myContactedToday }, { data: myFollowUps }, { count: myNew }, { count: myInterested }, { count: myWon }, { data: top }] = await Promise.all([
    db.rpc("dashboard_stats"),
    db.from("outreach").select("id", { count: "exact", head: true }).eq("user_id", s.userId).gte("created_at", start.toISOString()),
    db.from("follow_ups").select("id, due_at, note, business_id, businesses(name)").eq("status", "PENDING").eq("assigned_to", s.userId).lte("due_at", endToday.toISOString()).order("due_at").limit(6),
    db.from("businesses").select("id", { count: "exact", head: true }).eq("lifecycle", "ACTIVE").eq("pipeline_stage", "NOT_CONTACTED").eq("owner_id", s.userId),
    db.from("businesses").select("id", { count: "exact", head: true }).eq("lifecycle", "ACTIVE").in("pipeline_stage", ["REPLIED", "INTERESTED", "MEETING", "QUOTE_SENT"]).eq("owner_id", s.userId),
    db.from("businesses").select("id", { count: "exact", head: true }).eq("lifecycle", "ACTIVE").eq("pipeline_stage", "WON").eq("owner_id", s.userId).gte("updated_at", weekAgo),
    db.from("businesses").select("id, name, area, city, tier, lead_score, website_status, recommended_service, google_rating, google_review_count").eq("lifecycle", "ACTIVE").eq("pipeline_stage", "NOT_CONTACTED").order("lead_score", { ascending: false, nullsFirst: false }).limit(5),
  ]);
  const st = (stats ?? {}) as Record<string, number | boolean | Record<string, number>>;
  const n = (k: string) => Number(st[k] ?? 0);
  const byStage = (st.by_stage ?? {}) as Record<string, number>;
  const pricing = st.pricing_visible === true;
  const queueSize = (myFollowUps?.length ?? 0) + (myNew ?? 0);

  // Setup checklist for admins on an empty CRM
  let checklist: { done: boolean; label: string; href: string; cta: string }[] = [];
  if (!isBdo && n("total") < 10) {
    const [{ count: jobs }, { count: team }, { count: assigned }] = await Promise.all([
      db.from("search_jobs").select("id", { count: "exact", head: true }),
      db.from("profiles").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
      db.from("businesses").select("id", { count: "exact", head: true }).not("owner_id", "is", null),
    ]);
    checklist = [
      { done: isProviderConfigured("apify_google_maps") || isProviderConfigured("google_places"), label: "Connect a lead source (Apify or Google Places)", href: "/admin/providers", cta: "Providers" },
      { done: (jobs ?? 0) > 0, label: "Run your first lead search", href: "/search", cta: "Find leads" },
      { done: n("total") > 0, label: "Approve qualified results into the CRM", href: "/searches", cta: "Review results" },
      { done: (team ?? 0) > 1, label: "Invite your BDOs", href: "/admin/users", cta: "Invite team" },
      { done: (assigned ?? 0) > 0, label: "Assign leads to BDOs", href: "/leads?owner=unassigned", cta: "Assign leads" },
    ];
  }

  return (
    <div className="space-y-6">
      <section className="hero-bg relative overflow-hidden rounded-3xl p-6 text-white md:p-10">
        <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-signal/30 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="tag-mono inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-[11px] text-white/75"><span className="h-1.5 w-1.5 rounded-full bg-signal" />{fmtDate(new Date().toISOString())}</div>
            <h1 className="display mt-4 text-4xl md:text-6xl">{greeting()},<br />{first}.</h1>
            <p className="mt-3 max-w-lg text-[15px] text-white/75">
              {queueSize > 0 ? <>You have <b className="text-white">{myFollowUps?.length ?? 0} follow-up{(myFollowUps?.length ?? 0) === 1 ? "" : "s"}</b> due and <b className="text-white">{myNew ?? 0} new lead{(myNew ?? 0) === 1 ? "" : "s"}</b> waiting. Let&apos;s start.</> : isBdo ? "Your queue is clear. New leads appear here as soon as they're assigned to you." : "Find new businesses to contact, or assign leads to your team."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {s.can("outreach.log") && <ButtonLink href="/outreach" variant="primary" size="lg"><Send size={17} />Start outreach{queueSize ? ` (${queueSize})` : ""}</ButtonLink>}
            {s.can("search.run") && <ButtonLink href="/search" size="lg" variant="light"><Search size={17} />Find new leads</ButtonLink>}
          </div>
        </div>
      </section>

      {!!checklist.length && (
        <Card>
          <CardHeader eyebrow="Getting started" title={`${checklist.filter((c) => c.done).length} of ${checklist.length} done`} />
          <ol className="divide-y divide-line">
            {checklist.map((c, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-3">
                {c.done ? <CheckCircle2 size={20} className="text-ok" /> : <Circle size={20} className="text-line-strong" />}
                <span className={c.done ? "flex-1 text-mute line-through" : "flex-1 font-medium"}>{c.label}</span>
                {!c.done && <ButtonLink href={c.href} size="sm" variant="outline">{c.cta} <ArrowRight size={13} /></ButtonLink>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div>
        <div className="eyebrow mb-3">My day</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Contacted today" value={myContactedToday ?? 0} icon={<MessageCircle size={16} />} tone="ok" />
          <Stat label="Follow-ups due" value={myFollowUps?.length ?? 0} icon={<CalendarClock size={16} />} tone="warn" href="/follow-ups" />
          <Stat label="Hot conversations" value={myInterested ?? 0} hint="Replied → quote sent" icon={<ThumbsUp size={16} />} tone="navy" href="/pipeline?owner=me" />
          <Stat label="Won this week" value={myWon ?? 0} icon={<Trophy size={16} />} accent={(myWon ?? 0) > 0} tone="ok" />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader eyebrow="Due today" title="Follow-ups" action={<Link href="/follow-ups" className="text-sm underline">All</Link>} />
          <ul className="divide-y divide-line">
            {(myFollowUps ?? []).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-warn-tint text-warn"><Phone size={15} /></div><div><Link href={`/leads/${f.business_id}`} className="font-medium hover:underline">{(f.businesses as unknown as { name: string } | null)?.name}</Link><div className="text-xs text-mute">{f.note ?? "Follow up"} · {fmtRelative(f.due_at)}</div></div></div>
                <ButtonLink href="/outreach" size="sm" variant="outline">Open</ButtonLink>
              </li>
            ))}
            {!myFollowUps?.length && <li className="px-5 py-8 text-center text-sm text-mute">Nothing due today. 🎉</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader eyebrow="Best to contact" title="Top uncontacted leads" action={<Link href="/prospects" className="text-sm underline">All prospects</Link>} />
          <ul className="divide-y divide-line">
            {(top ?? []).map((b, i) => (
              <li key={b.id} className="flex items-center gap-3 px-5 py-3">
                <span className="tag-mono w-6 text-lg font-bold text-signal">{i + 1}</span>
                <div className="min-w-0 flex-1"><Link href={`/leads/${b.id}`} className="block truncate font-medium hover:underline">{b.name}</Link><div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-mute"><TierBadge tier={b.tier} score={b.lead_score} /><WebsiteBadge status={b.website_status} /><span>{b.area ?? b.city}</span></div></div>
              </li>
            ))}
            {!top?.length && <li className="px-5 py-8 text-center text-sm text-mute">No uncontacted leads yet.</li>}
          </ul>
        </Card>
      </div>

      {!isBdo && (
        <>
          <div>
            <div className="eyebrow mb-3">CRM overview</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Stat label="Total leads" value={n("total").toLocaleString()} icon={<Users size={16} />} href="/leads" />
              <Stat label="Hot leads" value={n("hot")} icon={<Flame size={16} />} accent href="/leads?tier=HOT" />
              <Stat label="No website" value={n("no_website")} icon={<Globe size={16} />} tone="signal" href="/leads?website=NO_WEBSITE" />
              <Stat label="Need fixes / redesign" value={n("website_fix") + n("redesign")} icon={<Wrench size={16} />} tone="warn" href="/opportunities?segment=revamp" />
              <Stat label="Contactable" value={n("contactable")} icon={<Phone size={16} />} tone="navy" />
              <Stat label="Won" value={n("won")} icon={<Trophy size={16} />} tone="ok" />
              {pricing && <Stat label="Pipeline value" value={money(Number(st.pipeline_value ?? 0))} hint="Interested → quote" icon={<Zap size={16} />} tone="navy" />}
              {pricing && <Stat label="Est. opportunity" value={money(Number(st.opportunity_value ?? 0))} hint="Estimate · open leads" icon={<Zap size={16} />} tone="signal" />}
            </div>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader eyebrow="Pipeline" title="Funnel" action={<Link href="/pipeline" className="text-sm underline">Open board</Link>} />
              <div className="space-y-2.5 p-5">
                {STAGES.map((stg, i) => {
                  const v = byStage[stg] ?? 0;
                  const max = Math.max(1, ...Object.values(byStage));
                  return (
                    <div key={stg} className="grid grid-cols-[110px_1fr_36px] items-center gap-3 text-sm">
                      <span className="text-mute">{human(stg)}</span>
                      <div className="h-2.5 rounded-full bg-ink-4"><div className="h-2.5 rounded-full" style={{ width: `${Math.max(v ? 4 : 0, (v / max) * 100)}%`, background: stg === "WON" ? "var(--color-ok)" : stg === "LOST" ? "var(--color-dim)" : `color-mix(in srgb, var(--color-signal) ${30 + i * 10}%, var(--color-navy))` }} /></div>
                      <span className="text-right font-semibold">{v}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
            <RecentActivity canSearch={s.can("search.view")} />
          </div>
        </>
      )}
    </div>
  );
}

async function RecentActivity({ canSearch }: { canSearch: boolean }) {
  const db = await createClient();
  const [{ data: jobs }, { data: alerts }] = await Promise.all([
    canSearch ? db.from("search_jobs").select("id, name, status, qualified_count, discovered_count, created_at").order("created_at", { ascending: false }).limit(4) : Promise.resolve({ data: [] }),
    db.from("activities").select("id, title, created_at, business_id, businesses(name)").in("type", ["WEBSITE_DETECTED", "WEBSITE_BROKEN", "NEW_OPPORTUNITY", "NEWLY_CONTACTABLE", "REVIEW_GROWTH"]).order("created_at", { ascending: false }).limit(4),
  ]);
  return (
    <Card>
      <CardHeader eyebrow="Research" title="Latest searches & alerts" action={canSearch ? <Link href="/searches" className="text-sm underline">History</Link> : undefined} />
      <ul className="divide-y divide-line text-sm">
        {(jobs ?? []).map((j) => <li key={j.id} className="flex items-center justify-between gap-3 px-5 py-3"><Link href={`/searches/${j.id}`} className="truncate font-medium hover:underline">{j.name}</Link><div className="flex shrink-0 items-center gap-2"><span className="text-xs text-mute">{j.qualified_count} qualified</span><Badge tone={JOB_TONE[j.status]}>{human(j.status)}</Badge></div></li>)}
        {(alerts ?? []).map((a) => <li key={a.id} className="px-5 py-3"><Link href={`/leads/${a.business_id}`} className="font-medium hover:underline">{(a.businesses as unknown as { name: string } | null)?.name}</Link><div className="text-xs text-mute">{a.title} · {fmtRelative(a.created_at)}</div></li>)}
        {!jobs?.length && !alerts?.length && <li className="px-5 py-8 text-center text-mute">No searches yet. <Link className="underline" href="/search">Run your first one →</Link></li>}
      </ul>
    </Card>
  );
}
