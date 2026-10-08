import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { TierBadge, WebsiteBadge } from "@/components/lead-bits";
import { human, STAGE_TONE } from "@/lib/format";

export const metadata = { title: "Research Queue" };

export default async function ResearchQueue({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  await requireUser("research.review");
  const sp = await searchParams;
  const stage = sp.stage ?? "REVIEW_REQUIRED";
  const db = await createClient();
  const { data, count } = await db.from("search_results").select("id, stage, job_id, created_at, search_jobs(name), businesses(id, name, area, city, tier, lead_score, website_status)", { count: "exact" }).eq("stage", stage).order("created_at", { ascending: false }).limit(200);
  const { data: dups } = await db.from("duplicate_candidates").select("id, confidence, a:businesses!duplicate_candidates_business_a_fkey(id, name), b:businesses!duplicate_candidates_business_b_fkey(id, name)").eq("status", "OPEN").order("confidence", { ascending: false }).limit(50);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Research" title="Research Queue" description="Results waiting for a researcher across all searches, plus possible duplicates." />
      <div className="flex gap-2">{["REVIEW_REQUIRED", "QUALIFIED", "RAW", "REJECTED"].map((s) => <Link key={s} href={`/research?stage=${s}`} className={`rounded-full border px-3 py-1 text-xs ${s === stage ? "border-paper bg-paper text-white" : "border-line-strong"}`}>{human(s)}</Link>)}</div>
      <Card>
        <CardHeader title={`${count ?? 0} results`} />
        <ul className="divide-y divide-line">
          {(data ?? []).map((r) => {
            const b = r.businesses as unknown as { id: string; name: string; area: string; city: string; tier: string; lead_score: number; website_status: string };
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div><Link href={`/leads/${b.id}`} className="font-medium hover:underline">{b.name}</Link><div className="text-xs text-mute">{b.area ?? b.city} · from <Link className="underline" href={`/searches/${r.job_id}?stage=${stage}`}>{(r.search_jobs as unknown as { name: string })?.name}</Link></div></div>
                <div className="flex gap-1.5"><TierBadge tier={b.tier} score={b.lead_score} /><WebsiteBadge status={b.website_status} /><Badge tone={STAGE_TONE[r.stage]}>{human(r.stage)}</Badge></div>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <CardHeader eyebrow="Deduplication" title="Possible duplicates" />
        <ul className="divide-y divide-line">
          {(dups ?? []).map((d) => {
            const a = d.a as unknown as { id: string; name: string }; const b = d.b as unknown as { id: string; name: string };
            return <li key={d.id} className="flex items-center justify-between px-5 py-3 text-sm"><span><Link className="underline" href={`/leads/${a.id}`}>{a.name}</Link> ↔ <Link className="underline" href={`/leads/${b.id}`}>{b.name}</Link></span><Badge tone={d.confidence >= 85 ? "signal" : "warn"}>{d.confidence}%</Badge></li>;
          })}
          {!dups?.length && <li className="px-5 py-4 text-sm text-mute">No open duplicate candidates.</li>}
        </ul>
      </Card>
    </div>
  );
}
