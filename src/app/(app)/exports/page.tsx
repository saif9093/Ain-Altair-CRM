import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { EXPORT_COLUMNS, DEFAULT_EXPORT_KEYS } from "@/lib/exports/columns";
import { sheetsConfigured } from "@/lib/imports/sheets";
import { fmtDate } from "@/lib/format";
import { ExportForm } from "./export-form";

export const metadata = { title: "Exports" };

export default async function Exports({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireUser("exports.run");
  const sp = await searchParams;
  const db = await createClient();
  let ids = sp.ids ?? "";
  if (sp.job) {
    const { data } = await db.from("search_results").select("business_id").eq("job_id", sp.job).in("stage", ["QUALIFIED", "APPROVED", "REVIEW_REQUIRED"]).limit(5000);
    ids = (data ?? []).map((d) => d.business_id).join(",");
  }
  const { data: history } = await db.from("exports").select("*").order("created_at", { ascending: false }).limit(30);
  const cols = EXPORT_COLUMNS.filter((c) => !c.pricing || s.can("pricing.view")).map((c) => ({ key: c.key, label: c.label, pricing: !!c.pricing }));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Data" title="Exports" description="XLSX (formatted, clickable links), CSV, JSON or Google Sheets. Exports contain only leads you can see." />
      <ExportForm columns={cols} defaults={DEFAULT_EXPORT_KEYS} ids={ids} job={sp.job} sheets={sheetsConfigured()} />
      <Card>
        <CardHeader eyebrow="History" title="Recent exports" />
        <ul className="divide-y divide-line text-sm">{(history ?? []).map((e) => <li key={e.id} className="flex justify-between px-5 py-2.5"><span>{e.filename} · {e.format} · {e.row_count} rows{e.sheet_url && <> · <a className="underline" href={e.sheet_url} target="_blank" rel="noreferrer">open sheet</a></>}</span><span className="text-mute">{fmtDate(e.created_at, true)}</span></li>)}</ul>
      </Card>
    </div>
  );
}
