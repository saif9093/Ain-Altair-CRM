import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ContactLinks, TierBadge, WebsiteBadge } from "@/components/lead-bits";
import { rankBestOpportunities } from "@/lib/intel/ranking";
import { opportunityLabel } from "@/lib/intel/opportunities";

export const metadata = { title: "Opportunities" };
const MATRIX: [string, string, string][] = [["NO_WEBSITE", "No website", "$$$$$"], ["BROKEN", "Broken website", "$$$$$"], ["OUTDATED", "Outdated website", "$$$$"], ["MOBILE_ISSUE", "Weak mobile", "$$$"], ["POOR_DESIGN", "Poor design", "$$$"], ["MISSING_FUNCTIONALITY", "Missing WhatsApp / booking / CTA", "$$"]];

export default async function Opps({ searchParams }: { searchParams: Promise<{ segment?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const db = await createClient();
  const counts = await Promise.all(MATRIX.map(async ([st]) => (await db.from("businesses").select("id", { count: "exact", head: true }).eq("lifecycle", "ACTIVE").eq("website_status", st)).count ?? 0));
  const segment = sp.segment === "revamp" ? ["OUTDATED", "POOR_DESIGN", "MOBILE_ISSUE", "MISSING_FUNCTIONALITY", "SLOW", "BROKEN"] : sp.segment ? [sp.segment] : null;
  let q = db.from("businesses").select("id, name, lead_code, area, city, tier, lead_score, sales_intent, website_status, website_issues, google_rating, google_review_count, business_status, whatsapp_e164, phone_e164, email, google_maps_url, website_url, recommended_service, business_socials(platform, url), opportunities(type, priority)").eq("lifecycle", "ACTIVE").not("pipeline_stage", "in", "(WON,LOST)").limit(400);
  if (segment) q = q.in("website_status", segment);
  const { data } = await q;
  const ranked = rankBestOpportunities((data ?? []).map((b) => ({ ...b, opportunity_priority: Math.max(0, ...((b.opportunities ?? []) as { priority: number }[]).map((o) => o.priority)) })) as never).slice(0, 60);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Sales intelligence" title="Best Opportunities" description="Ranked by likelihood of needing the service, likelihood of responding, ease of contact, business quality and opportunity size." />
      <Card>
        <CardHeader eyebrow="Opportunity matrix" title="Prioritise outreach" />
        <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-3 xl:grid-cols-6">
          {MATRIX.map(([st, label, band], i) => (
            <Link key={st} href={`/opportunities?segment=${st}`} className={`rounded-xl border p-3 hover:border-paper ${sp.segment === st ? "border-signal bg-signal-tint" : "border-line"}`}>
              <div className="tag-mono text-[10.5px] text-mute">{label}</div><div className="mt-1 text-2xl font-extrabold">{counts[i]}</div><div className="text-signal">{band}</div>
            </Link>
          ))}
        </div>
        <div className="flex gap-3 px-5 pb-4 text-sm"><Link className="underline" href="/opportunities?segment=revamp">Website revamp opportunities</Link><Link className="underline" href="/opportunities">All</Link></div>
      </Card>
      <Card>
        <CardHeader eyebrow="Ranked" title={sp.segment === "revamp" ? "Website revamp opportunities" : "Best opportunities"} />
        <ul className="divide-y divide-line">
          {ranked.map(({ lead: b, score }) => (
            <li key={b.id} className="flex flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <Link href={`/leads/${b.id}`} className="font-medium hover:underline">{b.name}</Link>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-mute"><Badge tone="dark">Opportunity {score}</Badge><TierBadge tier={b.tier as string} score={b.lead_score} /><WebsiteBadge status={b.website_status} />{((b.opportunities ?? []) as { type: string }[]).slice(0, 3).map((o) => <Badge key={o.type}>{opportunityLabel(o.type as never)}</Badge>)}<span>{(b.area ?? b.city) as string}</span></div>
              </div>
              <ContactLinks b={b as never} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
