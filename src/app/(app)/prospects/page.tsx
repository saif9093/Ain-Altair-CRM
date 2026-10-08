import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader } from "@/components/ui";
import { ContactLinks, IntentBadge, TierBadge, WebsiteBadge } from "@/components/lead-bits";
import { rankContactToday } from "@/lib/intel/ranking";

export const metadata = { title: "Today's Prospects" };

/** CONTACT TODAY: ranked uncontacted, active, reachable leads with strong opportunity. */
export default async function Prospects({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const s = await requireUser();
  const sp = await searchParams;
  const db = await createClient();
  let q = db.from("businesses").select("id, name, lead_code, category_label, area, city, tier, lead_score, sales_intent, website_status, google_rating, google_review_count, business_status, recommended_service, whatsapp_e164, phone_e164, email, google_maps_url, website_url, business_socials(platform, url, activity)")
    .eq("lifecycle", "ACTIVE").eq("pipeline_stage", "NOT_CONTACTED").neq("business_status", "CLOSED_PERMANENTLY").gte("lead_score", 50).limit(500);
  if (sp.mine) q = q.eq("owner_id", s.userId);
  const { data } = await q;
  const ranked = rankContactToday((data ?? []) as never).slice(0, 50);
  return (
    <div>
      <PageHeader eyebrow="Contact today" title="Today's Prospects" description="Ranked by lead score, sales intent, website problem severity, WhatsApp availability, reviews and social activity — only businesses not yet contacted." actions={<Link href={sp.mine ? "/prospects" : "/prospects?mine=1"} className="text-sm underline">{sp.mine ? "All visible" : "Only mine"}</Link>} />
      {ranked.length ? (
        <div className="space-y-2">
          {ranked.map(({ lead, priority, reasons }, i) => { const b = lead as unknown as Record<string, string & number & null> & { id: string; name: string; tier: string | null }; return (
            <Card key={b.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
              <div className="tag-mono w-10 text-2xl font-bold text-signal">{String(i + 1).padStart(2, "0")}</div>
              <div className="min-w-0 flex-1">
                <Link href={`/leads/${b.id}`} className="text-[15px] font-semibold hover:underline">{b.name}</Link>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-mute"><TierBadge tier={b.tier} score={b.lead_score} /><IntentBadge v={b.sales_intent} /><WebsiteBadge status={b.website_status} /><span>{b.category_label} · {b.area ?? b.city}</span>{b.google_rating && <span>· {b.google_rating}★ ({b.google_review_count})</span>}</div>
                <div className="mt-1 text-sm"><b>Why:</b> {reasons.join(" · ")}{b.recommended_service && <> · <b>Sell:</b> {b.recommended_service}</>}</div>
              </div>
              <div className="flex flex-col items-end gap-2"><span className="tag-mono text-[10px] text-mute">Priority {priority}</span><ContactLinks b={b as never} /></div>
            </Card>
          ); })}
        </div>
      ) : <Empty title="Nothing to contact today">No uncontacted leads scoring 50+. Approve more research results or check follow-ups.</Empty>}
    </div>
  );
}
