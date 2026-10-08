import { NextResponse } from "next/server";
import { assertPermission, AuthError } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { parseUpload } from "@/lib/imports/parse";
import { readSheet, sheetsConfigured } from "@/lib/imports/sheets";
import { suggestMapping } from "@/lib/imports/mapping";

export const maxDuration = 120;
const MAX_BYTES = 15 * 1024 * 1024;

/** Upload (XLSX/CSV) or Google Sheet URL → staged import with suggested mapping. Nothing touches leads yet. */
export async function POST(req: Request) {
  try {
    const s = await assertPermission("imports.run");
    const form = await req.formData();
    const file = form.get("file");
    const sheetUrl = form.get("sheetUrl");
    let parsed: { headers: string[]; rows: Record<string, string>[] };
    let filename: string;
    let fileType: "XLSX" | "CSV" | "GOOGLE_SHEETS";
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 15 MB)" }, { status: 400 });
      filename = file.name.slice(0, 200);
      fileType = /\.csv$/i.test(filename) ? "CSV" : "XLSX";
      parsed = await parseUpload(await file.arrayBuffer(), filename);
    } else if (typeof sheetUrl === "string" && sheetUrl) {
      if (!sheetsConfigured()) return NextResponse.json({ error: "Google Sheets is not configured" }, { status: 400 });
      parsed = await readSheet(sheetUrl);
      filename = "Google Sheet";
      fileType = "GOOGLE_SHEETS";
    } else return NextResponse.json({ error: "Choose a file or Google Sheet" }, { status: 400 });
    if (!parsed.rows.length) return NextResponse.json({ error: "No data rows found" }, { status: 400 });
    const admin = createAdminClient();
    const { data: imp, error } = await admin.from("imports").insert({
      organisation_id: s.organisationId, filename, file_type: fileType, sheet_url: typeof sheetUrl === "string" ? sheetUrl : null, status: "UPLOADED",
      headers: parsed.headers, column_mapping: suggestMapping(parsed.headers), row_count: parsed.rows.length, created_by: s.userId,
    }).select("id").single();
    if (error) throw new Error(error.message);
    for (let i = 0; i < parsed.rows.length; i += 500) {
      await admin.from("import_rows").insert(parsed.rows.slice(i, i + 500).map((raw, j) => ({ import_id: imp.id, row_number: i + j + 2, raw })));
    }
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "import.started", entityType: "import", entityId: imp.id, after: { filename, rows: parsed.rows.length } });
    return NextResponse.json({ id: imp.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof AuthError ? e.status : 500 });
  }
}
