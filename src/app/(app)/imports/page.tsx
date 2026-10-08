import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { fmtDate, human } from "@/lib/format";
import { sheetsConfigured } from "@/lib/imports/sheets";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Imports" };

const TONE: Record<string, "ok" | "warn" | "signal" | "neutral" | "navy"> = { COMPLETED: "ok", FAILED: "signal", PENDING_APPROVAL: "warn", IMPORTING: "navy", PREVIEWED: "navy" };

export default async function Imports() {
  await requireUser("imports.run");
  const db = await createClient();
  const { data } = await db.from("imports").select("*, creator:profiles!imports_created_by_fkey(full_name, email)").order("created_at", { ascending: false }).limit(100);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Data" title="Import leads" description="Bring leads in from a Google Sheet link or an Excel/CSV file. You check the column mapping and duplicates before anything is saved." />
      <UploadForm sheets={sheetsConfigured()} />
      <Card className="overflow-hidden">
        <CardHeader eyebrow="History" title="Previous imports" />
        {data?.length ? (
          <ul className="divide-y divide-line">
            {data.map((i) => {
              const errors = (i.error_count ?? 0) + (i.invalid_count ?? 0);
              return (
                <li key={i.id}>
                  <Link href={`/imports/${i.id}`} className="flex flex-col gap-3 px-5 py-4 hover:bg-ink-2 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{i.filename}</div>
                      <div className="text-xs text-mute">{human(i.file_type)} · {(i.creator as unknown as { full_name?: string } | null)?.full_name ?? "—"} · {fmtDate(i.created_at, true)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-ink-4 px-2.5 py-1">{i.row_count} rows</span>
                      <span className="rounded-full bg-ok-tint px-2.5 py-1 text-ok">{i.imported_count} imported</span>
                      {!!i.updated_count && <span className="rounded-full bg-navy-tint px-2.5 py-1 text-navy">{i.updated_count} updated</span>}
                      {!!i.duplicate_count && <span className="rounded-full bg-ink-4 px-2.5 py-1">{i.duplicate_count} duplicates</span>}
                      {!!errors && <span className="rounded-full bg-signal-tint px-2.5 py-1 text-signal-ink">{errors} with errors</span>}
                      <Badge tone={TONE[i.status] ?? "neutral"}>{human(i.status)}</Badge>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : <div className="px-5 py-10 text-center text-sm text-mute">No imports yet.</div>}
      </Card>
    </div>
  );
}
