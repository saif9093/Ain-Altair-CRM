"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { IMPORT_FIELDS } from "@/lib/imports/mapping";
import { executeImport, previewImport } from "@/lib/imports/execute";
import { act } from "./_util";

const LARGE_IMPORT = 1000;

async function ownImport(id: string) {
  const db = await createClient(); // RLS-checked visibility
  const { data } = await db.from("imports").select("id, organisation_id, status, row_count, filename").eq("id", z.string().uuid().parse(id)).single();
  if (!data) throw new Error("Import not found");
  return data;
}

export async function saveImportMapping(input: { id: string; mapping: Record<string, string | null>; mode: string; match: string; target: string }) {
  return act(async () => {
    await assertPermission("imports.run");
    const imp = await ownImport(input.id);
    const valid = new Set(Object.keys(IMPORT_FIELDS));
    const mapping = Object.fromEntries(Object.entries(input.mapping).map(([k, v]) => [k, v && valid.has(v) ? v : null]));
    const admin = createAdminClient();
    await admin.from("imports").update({
      column_mapping: mapping, mode: z.enum(["ADD_ONLY", "UPDATE_EXISTING", "UPSERT"]).parse(input.mode),
      match_strategy: z.enum(["AUTO", "LEAD_ID", "PHONE", "DOMAIN", "GOOGLE_PLACE_ID"]).parse(input.match), target_lifecycle: z.enum(["RESEARCH", "ACTIVE"]).parse(input.target), status: "MAPPED",
    }).eq("id", imp.id);
    const counts = await previewImport(admin, imp.id);
    revalidatePath(`/imports/${imp.id}`);
    return { ok: true as const, message: `${counts.NEW} new · ${counts.UPDATE} updates · ${counts.DUPLICATE} duplicates · ${counts.INVALID} invalid` };
  });
}

export async function runImport(id: string) {
  return act(async () => {
    const s = await assertPermission("imports.run");
    const imp = await ownImport(id);
    const admin = createAdminClient();
    if (imp.row_count > LARGE_IMPORT && s.role !== "SUPER_ADMIN") {
      await admin.from("approval_requests").insert({ organisation_id: s.organisationId, type: "LARGE_IMPORT", summary: `Import ${imp.row_count} rows from ${imp.filename}`, payload: { importId: imp.id }, requested_by: s.userId });
      await admin.from("imports").update({ status: "PENDING_APPROVAL" }).eq("id", imp.id);
      revalidatePath(`/imports/${imp.id}`);
      return { ok: true as const, message: "Large import submitted for Super Admin approval" };
    }
    const r = await executeImport(admin, imp.id, s.userId);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "import.completed", entityType: "import", entityId: imp.id, after: r });
    revalidatePath(`/imports/${imp.id}`);
    return { ok: true as const, message: `Imported ${r.imported}, updated ${r.updated}, errors ${r.errors}` };
  });
}
