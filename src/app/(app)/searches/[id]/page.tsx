import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, ButtonLink, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { fmtDate, fmtElapsed, human, JOB_TONE, money } from "@/lib/format";
import type { JobStats, Recommendation } from "@/lib/research/intelligence";
import { JobLive, JobActions } from "./job-client";
import { ResultsTable } from "./results-table";

export const metadata = { title: "Search results" };
const STAGES = ["ALL", "QUALIFIED", "REVIEW_REQUIRED", "APPROVED", "REJECTED", "RAW", "ENRICHING"];

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stage?: string; tier?: string; changed?: string; new?: string; page?: string }> }) {
  const s = await requireUser("search.view");
  const { id } = await params;
  const sp = await searchParams;
  const db = await createClient();
  const { data: job } = await db.from("search_jobs").select("*").eq("id", id).single();
  if (!job) notFound();
  const stage = sp.stage ?? (["COMPLETED", "PARTIALLY_COMPLETED"].includes(job.status) ? "QUALIFIED" : "ALL");
  const page = Math.max(1, Number(sp.page) || 1);
  let q = db.from("search_results").select("id, stage, is_new, matched_existing, changes, sources, reject_reason, qualification, businesses!inner(id, lead_code, name, category_label, area, city, google_rating, google_review_count, website_status, website_domain, website_url, whatsapp_e164, phone_e164, email, google_maps_url, lead_score, sales_intent, tier, recommended_service, lifecycle, business_socials(platform, url))", { count: "exact" }).eq("job_id", id);
  if (stage !== "ALL") q = q.eq("stage", stage);
  if (sp.tier) q = q.eq("businesses.tier", sp.tier);
  if (sp.new === "1") q = q.eq("is_new", true);
  if (sp.changed === "1") q = q.neq("changes", "[]");
  const { data: results, count } = await q.order("lead_score", { referencedTable: "businesses", ascending: false, nullsFirst: false }).range((page - 1) * 50, page * 50 - 1);
  const { data: users } = s.can("leads.assign") ? await db.from("profiles").select("id, full_name, email").eq("status", "ACTIVE").order("full_name") : { data: [] };

  let pipelineEstimate: number | null = null;
  if (s.can("pricing.view")) {
    const { data: ids } = await db.from("search_results").select("business_id").eq("job_id", id).in("stage", ["QUALIFIED", "APPROVED", "REVIEW_REQUIRED"]).limit(5000);
    const list = (ids ?? []).map((r) => r.business_id);
    let sum = 0;
    for (let i = 0; i < list.length; i += 300) {
      const { data } = await db.from("lead_pricing").select("opportunity_value").in("business_id", list.slice(i, i + 300));
      sum += (data ?? []).reduce((a, r) => a + Number(r.opportunity_value ?? 0), 0);
    }
    pipelineEstimate = sum;
  }
  const stats = job.stats as JobStats | null;
  const recs = (job.recommendations ?? []) as Recommendation[];
  const crit = job.configuration?.criteria;
  const terminal = ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"].includes(job.status);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`Search job · ${fmtDate(job.created_at, true)}`} title={job.name}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={JOB_TONE[job.status]}>{human(job.status)}</Badge><span>Elapsed {fmtElapsed(job.started_at ?? job.created_at, job.completed_at)}</span><span>· {human(job.depth)} research · target {job.target_count}</span>{job.is_scheduled && <Badge tone="navy">Scheduled run</Badge>}</span>}
        actions={<JobActions jobId={id} terminal={terminal} canRun={s.can("search.run")} canExport={s.can("exports.run")} />} />
      {job.error && <div className="rounded-2xl border border-signal/30 bg-signal-tint p-4 text-sm text-signal-ink">{job.error}</div>}

      <JobLive jobId={id} initial={job} />

      {stats && (
        <Card>
          <CardHeader eyebrow="Search result intelligence" title={`${stats.found} businesses found · ${stats.qualified} qualified`} />
          <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Found" value={stats.found} />
            <Stat label="Qualified" value={stats.qualified} accent />
            <Stat label="Need review" value={stats.reviewRequired} />
            <Stat label="No website" value={stats.noWebsite} />
            <Stat label="Redesign" value={stats.redesign} />
            <Stat label="Website fixes" value={stats.fixes} />
            <Stat label="SEO" value={stats.seo} />
            <Stat label="WhatsApp" value={stats.whatsapp} />
            <Stat label="Instagram" value={stats.instagram} />
            <Stat label="HOT" value={stats.hot} />
            <Stat label="New since last" value={stats.newSinceLast} />
            <Stat label="Changed" value={stats.changed} />
            {pipelineEstimate != null && <Stat label="Estimated opportunity" value={money(pipelineEstimate)} hint="Estimate · qualified + review" />}
          </div>
          {!!Object.keys(stats.rejectReasons).length && <div className="px-5 pb-4 text-xs text-mute">Rejected: {Object.entries(stats.rejectReasons).map(([k, v]) => `${human(k)} ${v}`).join(" · ")}</div>}
        </Card>
      )}

      {!!recs.length && (
        <Card>
          <CardHeader eyebrow="Smart recommendations" title="Where to search next" />
          <div className="space-y-2 p-5">
            {recs.map((r, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-xl bg-ink-2 p-3 text-sm md:flex-row md:items-center md:justify-between">
                <span>{r.text}</span>
                <ButtonLink size="sm" variant="outline" href={`/search?location=${encodeURIComponent(r.location)}${r.categoryKey ? `&category=${r.categoryKey}` : ""}`}>Search {r.location}</ButtonLink>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader eyebrow="Research results" title="Review before anything enters the CRM" />
        <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
          {STAGES.map((st) => <Link key={st} href={`/searches/${id}?stage=${st}`} className={`rounded-full border px-3 py-1 text-xs ${st === stage ? "border-paper bg-paper text-white" : "border-line-strong"}`}>{human(st)}</Link>)}
          <Link href={`/searches/${id}?stage=ALL&new=1`} className="rounded-full border border-line-strong px-3 py-1 text-xs">New since last search</Link>
          <Link href={`/searches/${id}?stage=ALL&changed=1`} className="rounded-full border border-line-strong px-3 py-1 text-xs">Recently changed</Link>
        </div>
        <ResultsTable jobId={id} rows={(results ?? []) as never} total={count ?? 0} page={page} stage={stage} users={users ?? []}
          canApprove={s.can("research.approve")} canReview={s.can("research.review")} searchSummary={crit ? `${(crit.categories ?? []).map((c: { label: string }) => c.label).join(", ")}` : ""} />
      </Card>
    </div>
  );
}
