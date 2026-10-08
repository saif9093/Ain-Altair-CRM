import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { human } from "@/lib/format";
import { IMPORT_FIELDS } from "@/lib/imports/mapping";
import { ImportWizard } from "./wizard";

export const metadata = { title: "Import" };

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("imports.run");
  const { id } = await params;
  const db = await createClient();
  const { data: imp } = await db.from("imports").select("*").eq("id", id).single();
  if (!imp) notFound();
  const { data: rows } = await db.from("import_rows").select("row_number, raw, status, errors, match_reason").eq("import_id", id).order("row_number").limit(50);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`Import · ${human(imp.file_type)}`} title={imp.filename} description={<Badge>{human(imp.status)}</Badge>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Rows" value={imp.row_count} /><Stat label="New" value={imp.new_count} accent /><Stat label="Updates" value={imp.update_count} /><Stat label="Duplicates" value={imp.duplicate_count} /><Stat label="Invalid" value={imp.invalid_count} />
      </div>
      <ImportWizard imp={imp} fields={Object.entries(IMPORT_FIELDS).map(([k, v]) => ({ key: k, label: v.label }))} />
      <Card className="overflow-x-auto">
        <CardHeader eyebrow="Preview" title="First 50 rows" />
        <table className="w-full text-xs">
          <thead className="text-left text-mute"><tr className="border-b border-line"><th className="px-3 py-2">#</th><th className="px-3 py-2">Status</th>{imp.headers.slice(0, 8).map((h: string) => <th key={h} className="px-3 py-2">{h}</th>)}<th className="px-3 py-2">Issues</th></tr></thead>
          <tbody className="divide-y divide-line">
            {(rows ?? []).map((r) => <tr key={r.row_number}><td className="px-3 py-1.5">{r.row_number}</td><td className="px-3 py-1.5"><Badge tone={r.status === "INVALID" || r.status === "ERROR" ? "signal" : r.status === "NEW" || r.status === "IMPORTED" ? "ok" : "neutral"}>{r.status}</Badge>{r.match_reason && <span className="ml-1 text-dim">by {human(r.match_reason)}</span>}</td>{imp.headers.slice(0, 8).map((h: string) => <td key={h} className="max-w-[160px] truncate px-3 py-1.5">{(r.raw as Record<string, string>)[h]}</td>)}<td className="px-3 py-1.5 text-signal-ink">{(r.errors ?? []).join("; ")}</td></tr>)}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
