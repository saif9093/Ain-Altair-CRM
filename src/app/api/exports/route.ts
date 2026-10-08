import { NextResponse } from "next/server";
import { assertPermission, AuthError } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { applyLeadFilters, resolveJoinFilters, sortLeads, type LeadFilters } from "@/lib/leads/query";
import { allowedColumns } from "@/lib/exports/columns";
import { buildCsv, buildJson, buildXlsx, exportFilename } from "@/lib/exports/build";
import { sheetsConfigured, writeNewSheet } from "@/lib/imports/sheets";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const s = await assertPermission("exports.run");
    const body = (await req.json()) as { format: "XLSX" | "CSV" | "JSON" | "GOOGLE_SHEETS"; filters: LeadFilters; columns: string[]; scope: string };
    const canPrice = s.can("pricing.view");
    const columns = allowedColumns(body.columns ?? [], canPrice);
    const db = await createClient(); // RLS: exports contain only what the user can see
    const f = await resolveJoinFilters(db, body.filters ?? {});
    const select = `*, owner:profiles!businesses_owner_id_fkey(full_name, email), business_socials(platform, url), opportunities(type, priority)${canPrice ? ", lead_pricing(*)" : ""}`;
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; from < 50_000; from += 1000) {
      let q = db.from("businesses").select(select);
      q = applyLeadFilters(q, f, s.userId);
      q = sortLeads(q, f.sort);
      const { data, error } = await q.range(from, from + 999);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < 1000) break;
    }
    const admin = createAdminClient();
    const record = async (format: string, filename: string, sheetUrl?: string) => {
      await admin.from("exports").insert({ organisation_id: s.organisationId, format, scope: body.scope ?? "filtered", filters: body.filters ?? {}, columns: columns.map((c) => c.key), row_count: rows.length, filename, sheet_url: sheetUrl ?? null, created_by: s.userId });
      await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "export.generated", entityType: "export", entityId: filename, after: { format, rows: rows.length, columns: columns.length, pricingIncluded: columns.some((c) => c.pricing) } });
    };
    if (body.format === "GOOGLE_SHEETS") {
      if (!sheetsConfigured()) return NextResponse.json({ error: "Google Sheets is not configured" }, { status: 400 });
      const url = await writeNewSheet(exportFilename("sheet").replace(".sheet", ""), columns.map((c) => c.label), rows.map((r) => columns.map((c) => c.value(r))));
      await record("GOOGLE_SHEETS", "Google Sheet", url);
      return NextResponse.json({ url });
    }
    const meta = { title: body.scope ?? "Leads", generatedBy: s.email };
    if (body.format === "CSV") {
      const name = exportFilename("csv");
      await record("CSV", name);
      return new NextResponse(buildCsv(columns, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
    }
    if (body.format === "JSON") {
      const name = exportFilename("json");
      await record("JSON", name);
      return new NextResponse(buildJson(columns, rows), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}"` } });
    }
    const name = exportFilename("xlsx");
    const buf = await buildXlsx(columns, rows, meta);
    await record("XLSX", name);
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"` } });
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
