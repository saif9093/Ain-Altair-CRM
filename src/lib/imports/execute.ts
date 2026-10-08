import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, phoneFromWhatsappLink } from "@/lib/normalize/phone";
import { domainOf, normalizeUrl, parseSocialUrl } from "@/lib/normalize/url";
import { normalizeEmail, normalizeBusinessName } from "@/lib/normalize/text";
import { DEFAULT_CATEGORIES } from "@/lib/categories/taxonomy";
import { ingestRawBusiness } from "@/lib/research/ingest";
import { processBusiness } from "@/lib/research/process";
import { loadOrgSettings } from "@/lib/research/settings";
import { STAGE_ALIASES, type ImportField } from "./mapping";

/**
 * Import preview + execution. Preview classifies every row as NEW / UPDATE /
 * DUPLICATE / INVALID without writing business data. Execution honours the
 * explicitly chosen mode and match strategy; nothing is silently overwritten.
 */

export type ImportMode = "ADD_ONLY" | "UPDATE_EXISTING" | "UPSERT";
export type MatchStrategy = "LEAD_ID" | "PHONE" | "DOMAIN" | "GOOGLE_PLACE_ID" | "AUTO";

export function mapRow(raw: Record<string, string>, mapping: Record<string, ImportField | null>): Partial<Record<ImportField, string>> {
  const out: Partial<Record<ImportField, string>> = {};
  for (const [col, field] of Object.entries(mapping)) if (field && raw[col]?.trim()) out[field] = raw[col].trim();
  return out;
}

/** Hard errors make a row invalid (only a missing name). Everything else is a warning and the bad value is dropped. */
export function validateRow(m: Partial<Record<ImportField, string>>, defaultCountry: string): string[] {
  return m.name && m.name.trim().length >= 2 ? [] : ["Missing business name"];
}

const PLACEHOLDER = /^(n\/?a|na|none|nil|null|-+|—|not (mentioned|found|available|confirmed|listed|provided|known)|no (website|email|phone|data)|unknown|tbd|tba|\?)$/i;

export function cleanRow(m: Partial<Record<ImportField, string>>, defaultCountry: string): { row: Partial<Record<ImportField, string>>; warnings: string[] } {
  const row = { ...m };
  const warnings: string[] = [];
  for (const k of Object.keys(row) as ImportField[]) if (PLACEHOLDER.test(String(row[k] ?? "").trim())) delete row[k];
  // A phone cell may hold several values ("971 6 555 0357\nhttps://wa.me/+97158…"): take the
  // first valid number as phone and any wa.me link as WhatsApp.
  if (row.phone && /[\n,;\/|]|wa\.me|whatsapp/i.test(row.phone)) {
    const parts = row.phone.split(/[\n,;|]+|\s+\/\s+/).map((p) => p.trim()).filter(Boolean);
    const wa = parts.find((p) => /wa\.me|whatsapp/i.test(p));
    if (wa && !row.whatsapp) { const n = phoneFromWhatsappLink(wa.replace(/wa\.me\/\+/, "wa.me/")); if (n) row.whatsapp = n; }
    const ph = parts.find((p) => !/wa\.me|whatsapp|https?:/i.test(p) && normalizePhone(p, defaultCountry));
    if (ph) row.phone = ph;
  }
  const drop = (f: ImportField, why: string) => { warnings.push(why); delete row[f]; };
  if (row.phone && !normalizePhone(row.phone, defaultCountry)) drop("phone", `Phone "${row.phone}" not recognised — imported without phone`);
  if (row.whatsapp && !normalizePhone(row.whatsapp, defaultCountry)) drop("whatsapp", `WhatsApp "${row.whatsapp}" not recognised — skipped`);
  if (row.email && !normalizeEmail(row.email)) drop("email", `Email "${row.email}" not valid — skipped`);
  if (row.website && !normalizeUrl(row.website)) drop("website", `Website "${row.website}" not valid — skipped`);
  if (row.google_maps_url && !/^https?:\/\//.test(row.google_maps_url)) delete row.google_maps_url;
  if (row.google_rating && !(Number(row.google_rating) >= 0 && Number(row.google_rating) <= 5)) drop("google_rating", "Rating must be 0–5 — skipped");
  if (row.google_reviews && !/^\d+$/.test(row.google_reviews.replace(/,/g, ""))) drop("google_reviews", "Reviews must be a whole number — skipped");
  return { row, warnings };
}

async function findMatch(db: SupabaseClient, org: string, m: Partial<Record<ImportField, string>>, strategy: MatchStrategy, defaultCountry: string): Promise<{ id: string; reason: string } | null> {
  const tries: [MatchStrategy, () => Promise<string | null>][] = [
    ["LEAD_ID", async () => m.lead_code ? (await db.from("businesses").select("id").eq("organisation_id", org).eq("lead_code", m.lead_code.toUpperCase()).maybeSingle()).data?.id ?? null : null],
    ["GOOGLE_PLACE_ID", async () => m.google_place_id ? (await db.from("businesses").select("id").eq("organisation_id", org).eq("google_place_id", m.google_place_id).maybeSingle()).data?.id ?? null : null],
    ["PHONE", async () => {
      const p = normalizePhone(m.phone ?? m.whatsapp, defaultCountry)?.e164;
      return p ? (await db.from("businesses").select("id").eq("organisation_id", org).or(`phone_e164.eq.${p},whatsapp_e164.eq.${p}`).neq("lifecycle", "MERGED").limit(1).maybeSingle()).data?.id ?? null : null;
    }],
    ["DOMAIN", async () => {
      const d = domainOf(m.website);
      return d ? (await db.from("businesses").select("id").eq("organisation_id", org).eq("website_domain", d).neq("lifecycle", "MERGED").limit(1).maybeSingle()).data?.id ?? null : null;
    }],
  ];
  for (const [kind, fn] of tries) {
    if (strategy !== "AUTO" && strategy !== kind) continue;
    const id = await fn();
    if (id) return { id, reason: kind };
  }
  return null;
}

export async function previewImport(db: SupabaseClient, importId: string) {
  const { data: imp } = await db.from("imports").select("*").eq("id", importId).single();
  if (!imp) throw new Error("Import not found");
  const settings = await loadOrgSettings(db, imp.organisation_id);
  const counts = { NEW: 0, UPDATE: 0, DUPLICATE: 0, INVALID: 0 };
  const seen = new Set<string>();
  for (let from = 0; ; from += 500) {
    const { data: rows } = await db.from("import_rows").select("id, raw").eq("import_id", importId).order("row_number").range(from, from + 499);
    for (const r of rows ?? []) {
      const { row: m, warnings } = cleanRow(mapRow(r.raw, imp.column_mapping), settings.defaultCountry);
      const errors = validateRow(m, settings.defaultCountry);
      let status: keyof typeof counts;
      let matched: { id: string; reason: string } | null = null;
      const key = `${normalizeBusinessName(m.name ?? "")}|${normalizePhone(m.phone, settings.defaultCountry)?.e164 ?? ""}|${domainOf(m.website) ?? ""}`;
      if (errors.length) status = "INVALID";
      else if (seen.has(key)) { status = "DUPLICATE"; errors.push("Duplicate of an earlier row in this file"); }
      else {
        seen.add(key);
        matched = await findMatch(db, imp.organisation_id, m, imp.match_strategy ?? "AUTO", settings.defaultCountry);
        status = matched ? (imp.mode === "ADD_ONLY" ? "DUPLICATE" : "UPDATE") : imp.mode === "UPDATE_EXISTING" ? "DUPLICATE" : "NEW";
        if (!matched && imp.mode === "UPDATE_EXISTING") errors.push("No existing record matched (update-only mode)");
        if (matched && imp.mode === "ADD_ONLY") errors.push("Already exists (add-only mode)");
      }
      counts[status]++;
      await db.from("import_rows").update({ mapped: m, status, errors: [...errors, ...warnings], matched_business_id: matched?.id ?? null, match_reason: matched?.reason ?? null }).eq("id", r.id);
    }
    if (!rows || rows.length < 500) break;
  }
  await db.from("imports").update({ status: "PREVIEWED", new_count: counts.NEW, update_count: counts.UPDATE, duplicate_count: counts.DUPLICATE, invalid_count: counts.INVALID }).eq("id", importId);
  return counts;
}

/**
 * Runs (or resumes) an import. Processes pending rows until `deadline`, then
 * returns `{ done: false }` so the job queue can continue in the next tick —
 * large imports never hit serverless time limits and nothing is processed twice.
 */
export async function executeImport(db: SupabaseClient, importId: string, actorId: string, deadline = Date.now() + 40_000) {
  const { data: imp } = await db.from("imports").select("*").eq("id", importId).single();
  if (!imp) throw new Error("Import not found");
  if (!["PREVIEWED", "PENDING_APPROVAL", "IMPORTING"].includes(imp.status)) throw new Error(`Import is ${imp.status}`);
  if (imp.status !== "IMPORTING") await db.from("imports").update({ status: "IMPORTING" }).eq("id", importId);
  const settings = await loadOrgSettings(db, imp.organisation_id);
  let outOfTime = false;
  for (;;) {
    if (Date.now() > deadline) { outOfTime = true; break; }
    const { data: rows } = await db.from("import_rows").select("*").eq("import_id", importId).in("status", ["NEW", "UPDATE"]).order("row_number").range(0, 24);
    if (!rows?.length) break;
    for (const r of rows) {
      if (Date.now() > deadline) { outOfTime = true; break; }
      try {
        const m = r.mapped as Partial<Record<ImportField, string>>;
        const cat = m.category ? DEFAULT_CATEGORIES.find((c) => [c.name, ...c.synonyms].some((x) => x.toLowerCase() === m.category!.toLowerCase())) : undefined;
        const socials = [m.instagram, m.facebook].filter(Boolean).map((s) => (s!.startsWith("@") ? `https://www.instagram.com/${s!.slice(1)}` : s!)).filter((u) => parseSocialUrl(u));
        const res = await ingestRawBusiness(db, {
          organisationId: imp.organisation_id, importId, createdBy: actorId, defaultCountry: settings.defaultCountry,
          categoryKey: cat?.key ?? null, categoryLabel: cat?.name ?? m.category ?? null, lifecycle: imp.target_lifecycle,
        }, {
          provider: "import", externalId: `${importId}:${r.row_number}`, name: m.name!, categoryLabels: m.category ? [m.category] : [],
          phone: m.phone ?? null, website: m.website ?? null, email: m.email ?? null, address: m.address ?? null, area: m.area ?? null, city: m.city ?? null,
          countryCode: m.country && m.country.length === 2 ? m.country.toUpperCase() : null, country: m.country && m.country.length > 2 ? m.country : null,
          lat: m.lat ? Number(m.lat) : null, lng: m.lng ? Number(m.lng) : null, rating: m.google_rating ? Number(m.google_rating) : null,
          reviewCount: m.google_reviews ? Number(m.google_reviews.replace(/,/g, "")) : null, googleMapsUrl: m.google_maps_url ?? null, googlePlaceId: m.google_place_id ?? null,
          socialUrls: socials, sourceUrl: imp.sheet_url ?? null, raw: { file: imp.filename, row: r.row_number, values: r.raw },
        });
        const id = r.status === "UPDATE" && r.matched_business_id ? r.matched_business_id : res.businessId;
        const patch: Record<string, unknown> = {};
        const wa = normalizePhone(m.whatsapp, settings.defaultCountry);
        if (wa) Object.assign(patch, { whatsapp_e164: wa.e164, whatsapp_source: "import" });
        if (m.pipeline_stage && STAGE_ALIASES[m.pipeline_stage.toLowerCase()]) patch.pipeline_stage = STAGE_ALIASES[m.pipeline_stage.toLowerCase()];
        if (Object.keys(patch).length) await db.from("businesses").update(patch).eq("id", id);
        // "Import into CRM": also promote matching records that were still in research.
        if (imp.target_lifecycle === "ACTIVE") await db.from("businesses").update({ lifecycle: "ACTIVE", approved_at: new Date().toISOString(), approved_by: actorId }).eq("id", id).eq("lifecycle", "RESEARCH");
        if (m.notes) await db.from("notes").insert({ business_id: id, body: m.notes.slice(0, 10000), visibility: "TEAM", author_id: actorId });
        await db.from("import_rows").update({ status: r.status === "UPDATE" ? "UPDATED" : "IMPORTED", business_id: id }).eq("id", r.id);
        // Score now (FAST: no external calls) so the lead is ready to work.
        await processBusiness(db, id, { depth: "FAST", settings, actorId }).catch(() => undefined);
      } catch (e) {
        await db.from("import_rows").update({ status: "ERROR", errors: [...(r.errors ?? []), (e as Error).message] }).eq("id", r.id);
      }
    }
    if (outOfTime) break;
  }
  const count = async (st: string) => (await db.from("import_rows").select("id", { count: "exact", head: true }).eq("import_id", importId).eq("status", st)).count ?? 0;
  const [imported, updated, errors] = await Promise.all([count("IMPORTED"), count("UPDATED"), count("ERROR")]);
  if (outOfTime) {
    await db.from("imports").update({ imported_count: imported, updated_count: updated, error_count: errors }).eq("id", importId);
    return { imported, updated, errors, done: false };
  }
  await db.from("imports").update({ status: "COMPLETED", imported_count: imported, updated_count: updated, error_count: errors, completed_at: new Date().toISOString() }).eq("id", importId);
  await db.from("activities").insert({ organisation_id: imp.organisation_id, type: "IMPORT_COMPLETED", title: `Import ${imp.filename}: ${imported} new, ${updated} updated`, actor_id: actorId, data: { importId, errors } });
  await db.from("notifications").insert({ organisation_id: imp.organisation_id, user_id: actorId, type: "IMPORT_COMPLETED", title: `Import finished: ${imported} new, ${updated} updated`, body: errors ? `${errors} rows had errors` : undefined, link: `/imports/${importId}` });
  return { imported, updated, errors, done: true };
}
