import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { fmtDate, human } from "@/lib/format";
import { sheetsConfigured } from "@/lib/imports/sheets";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Imports" };

export default async function Imports() {
  await requireUser("imports.run");
  const db = await createClient();
  const { data } = await db.from("imports").select("*, creator:profiles!imports_created_by_fkey(full_name, email)").order("created_at", { ascending: false }).limit(100);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Data" title="Imports" description="XLSX, CSV or Google Sheets. You review the column mapping, duplicates and validation before anything is imported." />
      <UploadForm sheets={sheetsConfigured()} />
      <Card className="overflow-x-auto">
        <CardHeader eyebrow="History" title="Import history" />
        <table className="w-full text-sm">
          <thead className="tag-mono text-left text-[10.5px] text-mute"><tr className="border-b border-line">{["File", "User", "Date", "Rows", "Imported", "Updated", "Duplicates", "Errors", "Status"].map((h) => <th key={h} className="px-4 py-2 font-normal">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {(data ?? []).map((i) => <tr key={i.id}><td className="px-4 py-2"><Link className="underline" href={`/imports/${i.id}`}>{i.filename}</Link></td><td className="px-4 py-2">{(i.creator as unknown as { full_name?: string } | null)?.full_name}</td><td className="px-4 py-2">{fmtDate(i.created_at, true)}</td><td className="px-4 py-2">{i.row_count}</td><td className="px-4 py-2">{i.imported_count}</td><td className="px-4 py-2">{i.updated_count}</td><td className="px-4 py-2">{i.duplicate_count}</td><td className="px-4 py-2">{i.error_count + i.invalid_count}</td><td className="px-4 py-2"><Badge>{human(i.status)}</Badge></td></tr>)}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
