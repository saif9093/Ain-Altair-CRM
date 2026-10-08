import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, ButtonLink, Card, CardHeader, Empty, PageHeader } from "@/components/ui";
import { fmtDate, fmtRelative, human, JOB_TONE } from "@/lib/format";
import { criteriaSummary, searchCriteriaSchema } from "@/lib/search/criteria";
import { TemplateActions } from "./template-actions";

export const metadata = { title: "Search History" };

export default async function SearchesPage() {
  const s = await requireUser("search.view");
  const db = await createClient();
  const [{ data: jobs }, { data: templates }] = await Promise.all([
    db.from("search_jobs").select("id, name, status, target_count, discovered_count, qualified_count, created_at, is_scheduled, depth, configuration, creator:profiles!search_jobs_created_by_fkey(full_name, email)").order("created_at", { ascending: false }).limit(100),
    db.from("searches").select("id, name, criteria, schedule_enabled, schedule_cron, next_run_at, last_run_at, run_count, created_by").is("archived_at", null).eq("is_template", true).order("updated_at", { ascending: false }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Research" title="Search History" description="Every lead search, its results, and your saved templates & schedules." actions={s.can("search.run") && <ButtonLink href="/search" variant="primary">New search</ButtonLink>} />
      <Card>
        <CardHeader eyebrow="Templates" title="Saved searches" />
        {templates?.length ? (
          <div className="divide-y divide-line">
            {templates.map((t) => {
              let summary = "";
              try { summary = criteriaSummary(searchCriteriaSchema.parse(t.criteria)); } catch { summary = "Invalid criteria"; }
              return (
                <div key={t.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-mute">{summary} · run {t.run_count}× · last {fmtRelative(t.last_run_at)}</div>
                    {t.schedule_enabled && <div className="mt-1"><Badge tone="navy">Scheduled · {t.schedule_cron} · next {fmtDate(t.next_run_at, true)}</Badge></div>}
                  </div>
                  <TemplateActions id={t.id} name={t.name} cron={t.schedule_enabled ? t.schedule_cron : null} canRun={s.can("search.run")} canSchedule={s.can("search.schedule")} />
                </div>
              );
            })}
          </div>
        ) : <div className="p-5 text-sm text-mute">No templates yet. Save one from the Lead Search page.</div>}
      </Card>
      <Card>
        <CardHeader eyebrow="Jobs" title="Search runs" />
        {jobs?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="tag-mono text-left text-[10.5px] text-mute"><tr className="border-b border-line">{["Search", "Location", "Target", "Results", "Qualified", "Date", "Created by", "Status"].map((h) => <th key={h} className="px-5 py-2 font-normal">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {jobs.map((j) => {
                  const crit = j.configuration?.criteria;
                  return (
                    <tr key={j.id} className="hover:bg-ink-2">
                      <td className="px-5 py-3"><Link href={`/searches/${j.id}`} className="font-medium hover:underline">{j.name}</Link>{j.is_scheduled && <Badge tone="navy" className="ml-2">Scheduled</Badge>}<div className="text-xs text-dim">{(crit?.categories ?? []).map((x: { label: string }) => x.label).join(", ")} · {human(j.depth)}</div></td>
                      <td className="px-5 py-3 text-mute">{(crit?.locations ?? []).map((x: { label: string }) => x.label).join(" + ")}</td>
                      <td className="px-5 py-3">{j.target_count}</td>
                      <td className="px-5 py-3">{j.discovered_count}</td>
                      <td className="px-5 py-3 font-semibold">{j.qualified_count}</td>
                      <td className="px-5 py-3 text-mute">{fmtDate(j.created_at, true)}</td>
                      <td className="px-5 py-3 text-mute">{(j.creator as unknown as { full_name?: string; email?: string } | null)?.full_name ?? "—"}</td>
                      <td className="px-5 py-3"><Badge tone={JOB_TONE[j.status]}>{human(j.status)}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="p-5"><Empty title="No searches yet" action={s.can("search.run") && <ButtonLink href="/search" variant="primary">Run your first search</ButtonLink>} /></div>}
      </Card>
    </div>
  );
}
