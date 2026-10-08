import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, ButtonLink, Card, CardHeader, Empty, PageHeader, Stat } from "@/components/ui";
import { ContactLinks, TierBadge, WebsiteBadge } from "@/components/lead-bits";
import { fmtRelative, human, JOB_TONE, money, STAGES } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const s = await requireUser();
  const db = await createClient();
  const [{ data: stats }, { data: today }, { data: jobs }, { data: alerts }] = await Promise.all([
    db.rpc("dashboard_stats"),
    db.from("businesses").select("id, name, lead_code, area, city, tier, lead_score, website_status, recommended_service, whatsapp_e164, phone_e164, email, google_maps_url, website_url, business_socials(platform,url)").eq("lifecycle", "ACTIVE").eq("pipeline_stage", "NOT_CONTACTED").gte("lead_score", 70).order("lead_score", { ascending: false }).limit(6),
    s.can("search.view") ? db.from("search_jobs").select("id, name, status, qualified_count, discovered_count, created_at").order("created_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
    db.from("activities").select("id, title, type, created_at, business_id, businesses(name)").in("type", ["WEBSITE_DETECTED", "WEBSITE_BROKEN", "NEW_OPPORTUNITY", "NEWLY_CONTACTABLE", "REVIEW_GROWTH"]).order("created_at", { ascending: false }).limit(6),
  ]);
  const st = (stats ?? {}) as Record<string, number | boolean | Record<string, number>>;
  const n = (k: string) => Number(st[k] ?? 0).toLocaleString();
  const byStage = (st.by_stage ?? {}) as Record<string, number>;
  const pricing = st.pricing_visible === true;

  return (
    <div>
      <PageHeader eyebrow={`Welcome back${s.fullName ? `, ${s.fullName.split(" ")[0]}` : ""}`} title="Dashboard" description="Where the best prospects are, who to contact today, and what changed."
        actions={<>{s.can("search.run") && <ButtonLink href="/search" variant="primary">Find new leads →</ButtonLink>}<ButtonLink href="/prospects" variant="outline">Today&apos;s prospects</ButtonLink></>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Total leads" value={n("total")} />
        <Stat label="New today" value={n("new_today")} />
        <Stat label="Hot" value={n("hot")} accent />
        <Stat label="High" value={n("high")} />
        <Stat label="No website" value={n("no_website")} />
        <Stat label="Website fixes" value={n("website_fix")} />
        <Stat label="Redesign" value={n("redesign")} />
        <Stat label="Contactable" value={n("contactable")} />
        <Stat label="Follow-ups due" value={n("follow_ups_due")} />
        <Stat label="Interested" value={n("interested")} />
        <Stat label="Quotes" value={n("quotes")} />
        <Stat label="Won" value={n("won")} />
        {pricing && <Stat label="Pipeline value" value={money(Number(st.pipeline_value ?? 0))} hint="Interested → quote" />}
        {pricing && <Stat label="Est. opportunity" value={money(Number(st.opportunity_value ?? 0))} hint="Estimate · open leads" />}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader eyebrow="Contact today" title="Top uncontacted leads" action={<Link href="/prospects" className="text-sm underline">All prospects</Link>} />
          {today?.length ? (
            <ul className="divide-y divide-line">
              {today.map((b) => (
                <li key={b.id} className="flex flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <Link href={`/leads/${b.id}`} className="font-medium hover:underline">{b.name}</Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-mute"><TierBadge tier={b.tier} score={b.lead_score} /><WebsiteBadge status={b.website_status} />{b.recommended_service && <span>→ {b.recommended_service}</span>}<span>{b.area ?? b.city}</span></div>
                  </div>
                  <ContactLinks b={b} />
                </li>
              ))}
            </ul>
          ) : <div className="p-5"><Empty title="No high-scoring uncontacted leads yet">Run a lead search and approve results into the CRM.</Empty></div>}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader eyebrow="Pipeline" title="By stage" action={<Link href="/pipeline" className="text-sm underline">Open board</Link>} />
            <div className="space-y-2 p-5">
              {STAGES.map((stg) => {
                const v = byStage[stg] ?? 0;
                const max = Math.max(1, ...Object.values(byStage));
                return (
                  <div key={stg} className="grid grid-cols-[120px_1fr_40px] items-center gap-3 text-sm">
                    <span className="text-mute">{human(stg)}</span>
                    <div className="h-2 rounded-full bg-ink-4"><div className="h-2 rounded-full bg-navy" style={{ width: `${(v / max) * 100}%` }} /></div>
                    <span className="text-right font-medium">{v}</span>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card>
            <CardHeader eyebrow="Research alerts" title="Recently changed" />
            <ul className="divide-y divide-line">
              {(alerts ?? []).map((a) => (
                <li key={a.id} className="px-5 py-3 text-sm">
                  <Link href={`/leads/${a.business_id}`} className="font-medium hover:underline">{(a.businesses as unknown as { name: string } | null)?.name}</Link>
                  <div className="text-mute">{a.title} · {fmtRelative(a.created_at)}</div>
                </li>
              ))}
              {!alerts?.length && <li className="px-5 py-4 text-sm text-mute">No change alerts yet. Scheduled searches detect new websites, broken sites and new opportunities.</li>}
            </ul>
          </Card>
          {!!jobs?.length && (
            <Card>
              <CardHeader eyebrow="Research" title="Recent searches" action={<Link href="/searches" className="text-sm underline">History</Link>} />
              <ul className="divide-y divide-line">
                {jobs.map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <Link href={`/searches/${j.id}`} className="truncate font-medium hover:underline">{j.name}</Link>
                    <div className="flex shrink-0 items-center gap-2"><span className="text-mute">{j.qualified_count}/{j.discovered_count}</span><Badge tone={JOB_TONE[j.status]}>{human(j.status)}</Badge></div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
