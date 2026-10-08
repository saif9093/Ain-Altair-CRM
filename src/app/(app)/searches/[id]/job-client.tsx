"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { Progress, useAction } from "@/components/client";
import { cancelJob, rerunJob } from "@/app/actions/search";
import { fmtElapsed, human } from "@/lib/format";

type Job = Record<string, unknown> & { status: string; source_status: Record<string, Record<string, unknown>>; progress: Record<string, Record<string, number> | number | unknown> };
const TERMINAL = ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"];
const NAMES: Record<string, string> = { google_places: "Google Business Listings", apify_google_maps: "Google Maps (Apify)", osm_overpass: "OpenStreetMap" };

/** Live progress from real job counters — polls the database, never simulates. */
export function JobLive({ jobId, initial }: { jobId: string; initial: Job }) {
  const [job, setJob] = useState<Job>(initial);
  const router = useRouter();
  const lastStatus = useRef(initial.status);
  useEffect(() => {
    if (TERMINAL.includes(job.status)) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as Job;
      setJob(j);
      if (j.status !== lastStatus.current) { lastStatus.current = j.status; router.refresh(); }
    }, 3000);
    return () => clearInterval(t);
  }, [job.status, jobId, router]);

  const n = (k: string) => Number(job[k] ?? 0);
  const prog = (job.progress ?? {}) as Record<string, { total?: number } | number>;
  const total = (k: string) => Number((prog[k] as { total?: number } | undefined)?.total ?? 0);
  const sources = Object.entries(job.source_status ?? {});
  const enrichTotal = total("enrichment");
  const done = TERMINAL.includes(job.status);
  const qualRate = n("enriched_count") ? n("qualified_count") / n("enriched_count") : 0;

  return (
    <Card>
      <CardHeader eyebrow={done ? "Finished" : "Live progress"} title={done ? "Search progress" : `${human(job.status)}…`} action={<span className="tag-mono text-[11px] text-mute">Elapsed {fmtElapsed((job.started_at as string) ?? (job.created_at as string), job.completed_at as string | null)}</span>} />
      <div className="grid gap-6 p-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          {job.status === "QUEUED" && <p className="text-sm text-mute">Queued — waiting for a worker. If this does not start within a minute, check that the background worker or cron is running (README → Workers).</p>}
          {sources.map(([key, st]) => (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium">{NAMES[key] ?? key}</span>
                <span className="flex items-center gap-2"><span className="text-xs text-mute">{Number(st.found ?? 0)} found · {Number(st.pages ?? 0)} pages</span><Badge tone={st.state === "DONE" ? "ok" : st.state === "FAILED" ? "signal" : st.state === "SKIPPED" ? "neutral" : st.state === "PARTIAL" ? "warn" : "navy"}>{human(String(st.state))}</Badge></span>
              </div>
              {st.state === "SKIPPED" && <div className="text-xs text-mute">{String(st.reason)}</div>}
              {Boolean(st.lastError) && <div className="text-xs text-signal-ink">{String(st.lastError).slice(0, 200)}</div>}
            </div>
          ))}
          <Progress label="Sourcing" value={job.status === "RUNNING" || job.status === "QUEUED" ? Math.min(total("sourcing"), sources.reduce((a, [, s]) => a + Number(s.pages ?? 0), 0)) : total("sourcing")} total={total("sourcing")} sub="planning…" />
          <Progress label="Enrichment & audit" value={n("enriched_count")} total={enrichTotal} sub={job.status === "RUNNING" ? "starts after sourcing" : "—"} />
          {!!total("ai") && <Progress label="AI qualification" value={Object.values((prog.aiDoneBatch ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0)} total={total("ai")} />}
          {Number(prog.skippedCells ?? 0) > 0 && <p className="text-xs text-mute">{Number(prog.skippedCells)} area cells skipped — already searched recently (coverage engine).</p>}
        </div>
        <div className="grid grid-cols-2 gap-3 self-start text-sm">
          {[["Discovered", "discovered_count"], ["Retained", "retained_count"], ["Duplicates", "duplicate_count"], ["Enriched", "enriched_count"], ["Audited", "audited_count"], ["Qualified", "qualified_count"], ["Rejected", "rejected_count"], ["Errors", "error_count"]].map(([l, k]) => (
            <div key={k} className="rounded-xl bg-ink-2 px-3 py-2"><div className="tag-mono text-[10px] text-mute">{l}</div><div className="text-xl font-bold">{n(k)}</div></div>
          ))}
          {!done && n("enriched_count") >= 10 && <div className="col-span-2 text-xs text-mute">Estimated final: ~{Math.round(qualRate * (enrichTotal || n("retained_count")))} qualified leads (based on the qualification rate so far).</div>}
        </div>
      </div>
    </Card>
  );
}

export function JobActions({ jobId, terminal, canRun, canExport }: { jobId: string; terminal: boolean; canRun: boolean; canExport: boolean }) {
  const { run, pending } = useAction();
  const router = useRouter();
  return (
    <>
      {!terminal && canRun && <Button variant="danger" disabled={pending} onClick={() => confirm("Cancel this search?") && run(() => cancelJob(jobId))}>Cancel</Button>}
      {terminal && canRun && <Button variant="outline" disabled={pending} onClick={() => run(() => rerunJob(jobId), { success: "Search started", onDone: (d) => d && router.push(`/searches/${(d as { jobId: string }).jobId}`) })}>Run again</Button>}
      {canExport && <a href={`/exports?job=${jobId}`} className="inline-flex h-10 items-center rounded-full border border-line-strong bg-ink-3 px-5 text-sm">Export</a>}
    </>
  );
}
