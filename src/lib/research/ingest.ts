import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawBusiness } from "@/lib/providers/types";
import { assessDuplicate, DUPLICATE_THRESHOLDS, type MatchableRecord } from "@/lib/dedup/similarity";
import { mergeObservations, observationsFromRaw, type FieldConfidenceMap, type Observation } from "./observations";

/**
 * Ingest one provider record: store the raw payload, normalise, resolve the
 * entity (link to an existing record only on a hard identifier match), merge
 * fields under provenance rules, and queue questionable matches for review.
 */

export interface IngestContext {
  organisationId: string;
  jobId?: string | null;
  importId?: string | null;
  createdBy?: string | null;
  defaultCountry: string;
  categoryKey?: string | null;
  categoryLabel?: string | null;
  lifecycle?: "RESEARCH" | "ACTIVE";
}

export interface IngestResult {
  businessId: string;
  created: boolean;
  matchedExisting: boolean;
  matchedLifecycle?: string;
  possibleDuplicates: number;
}

const MERGE_COLUMNS = "id, lifecycle, name, normalized_name, phone_e164, whatsapp_e164, website_domain, website_url, email, address, city, area, lat, lng, google_rating, google_review_count, google_maps_url, google_place_id, business_status, opening_hours, field_confidence, category_key, category_label, keywords";

export async function recordObservationSources(db: SupabaseClient, businessId: string, accepted: Observation[], sourceRecordId: string | null) {
  if (!accepted.length) return;
  const fields = [...new Set(accepted.map((a) => a.field))];
  await db.from("business_field_sources").update({ is_current: false }).eq("business_id", businessId).in("field", fields);
  await db.from("business_field_sources").insert(accepted.map((o) => ({
    business_id: businessId, field: o.field, value: o.display.slice(0, 2000), provider: o.provider, source_url: o.sourceUrl ?? null,
    source_record_id: sourceRecordId, confidence: o.confidence, is_current: true, retrieved_at: o.retrievedAt,
  })));
}

export async function upsertSocials(db: SupabaseClient, businessId: string, socials: { platform: string; url: string; username: string | null; confidence: string; source: string; sourceUrl?: string | null }[]) {
  if (!socials.length) return;
  await db.from("business_socials").upsert(
    socials.map((s) => ({ business_id: businessId, platform: s.platform, url: s.url, username: s.username, source: s.source, source_url: s.sourceUrl ?? null, confidence: s.confidence })),
    { onConflict: "business_id,platform,url", ignoreDuplicates: true },
  );
}

export async function ingestRawBusiness(db: SupabaseClient, ctx: IngestContext, raw: RawBusiness): Promise<IngestResult> {
  const retrievedAt = new Date().toISOString();
  const { data: sr, error: srErr } = await db.from("source_records").insert({
    organisation_id: ctx.organisationId, provider: raw.provider, external_id: raw.externalId, search_job_id: ctx.jobId ?? null,
    import_id: ctx.importId ?? null, raw_payload: raw.raw ?? {}, source_url: raw.sourceUrl ?? null, retrieved_at: retrievedAt,
  }).select("id").single();
  if (srErr) throw new Error(`source_records insert failed: ${srErr.message}`);

  const norm = observationsFromRaw(raw, ctx.defaultCountry, retrievedAt);
  const nameObs = norm.observations.find((o) => o.field === "name")!.value as { name: string; normalized: string };
  const phone = (norm.observations.find((o) => o.field === "phone")?.value as { e164?: string } | undefined)?.e164 ?? null;
  const domain = (norm.observations.find((o) => o.field === "website")?.value as { domain?: string } | undefined)?.domain ?? null;
  const email = (norm.observations.find((o) => o.field === "email")?.value as { email?: string } | undefined)?.email ?? null;
  const instagram = norm.socials.find((s) => s.platform === "INSTAGRAM")?.username?.toLowerCase() ?? null;

  // ---- Entity resolution
  const { data: candidates, error: cErr } = await db.rpc("find_business_candidates", {
    p_org: ctx.organisationId, p_name: nameObs.normalized, p_phone: phone, p_domain: domain, p_place_id: raw.googlePlaceId ?? null,
    p_lat: raw.lat ?? null, p_lng: raw.lng ?? null, p_instagram: instagram, p_email: email, p_limit: 15,
  });
  if (cErr) throw new Error(`candidate lookup failed: ${cErr.message}`);
  const me: MatchableRecord = { name: nameObs.name, phoneE164: phone, domain, googlePlaceId: raw.googlePlaceId ?? null, googleMapsUrl: raw.googleMapsUrl ?? null, address: raw.address ?? null, lat: raw.lat ?? null, lng: raw.lng ?? null, instagram, email };
  const scored = (candidates ?? []).map((c: Record<string, unknown>) => ({
    c,
    a: assessDuplicate(me, {
      id: c.id as string, name: c.name as string, phoneE164: c.phone_e164 as string | null, whatsappE164: c.whatsapp_e164 as string | null,
      domain: c.website_domain as string | null, googlePlaceId: c.google_place_id as string | null, googleMapsUrl: c.google_maps_url as string | null,
      address: c.address as string | null, lat: c.lat as number | null, lng: c.lng as number | null, instagram: c.instagram as string | null, email: c.email as string | null,
    }),
  })).sort((x: { a: { confidence: number } }, y: { a: { confidence: number } }) => y.a.confidence - x.a.confidence);

  const best = scored[0];
  let businessId: string;
  let created = false;
  let matchedLifecycle: string | undefined;

  if (best && best.a.hardMatch && best.a.confidence >= DUPLICATE_THRESHOLDS.autoLink) {
    // Same real-world entity: merge new observations into the existing record.
    const { data: row } = await db.from("businesses").select(MERGE_COLUMNS).eq("id", best.c.id).single();
    const m = mergeObservations(row as Record<string, unknown>, (row?.field_confidence ?? {}) as FieldConfidenceMap, norm.observations);
    const patch: Record<string, unknown> = { ...m.patch, field_confidence: m.fieldConfidence, source_confidence: m.overall };
    if (!row?.category_key && ctx.categoryKey) Object.assign(patch, { category_key: ctx.categoryKey, category_label: ctx.categoryLabel });
    await db.from("businesses").update(patch).eq("id", best.c.id);
    businessId = best.c.id as string;
    matchedLifecycle = row?.lifecycle as string;
    await recordObservationSources(db, businessId, m.accepted, sr.id);
  } else {
    const m = mergeObservations(null, {}, norm.observations);
    const insert = {
      organisation_id: ctx.organisationId,
      lifecycle: ctx.lifecycle ?? "RESEARCH",
      ...m.patch,
      name: (m.patch.name as string) ?? nameObs.name,
      normalized_name: (m.patch.normalized_name as string) ?? nameObs.normalized,
      category_key: ctx.categoryKey ?? null,
      category_label: ctx.categoryLabel ?? norm.categoryLabels[0] ?? null,
      keywords: norm.categoryLabels.slice(0, 10),
      field_confidence: m.fieldConfidence,
      source: raw.provider,
      source_confidence: m.overall,
      created_by: ctx.createdBy ?? null,
    };
    const { data: b, error } = await db.from("businesses").insert(insert).select("id").single();
    if (error) throw new Error(`business insert failed: ${error.message}`);
    businessId = b.id;
    created = true;
    await recordObservationSources(db, businessId, m.accepted, sr.id);
  }

  await db.from("source_records").update({ business_id: businessId }).eq("id", sr.id);
  await upsertSocials(db, businessId, norm.socials.map((s) => ({ ...s, sourceUrl: raw.sourceUrl })));

  // Possible duplicates (never merged automatically)
  let possibleDuplicates = 0;
  for (const { c, a } of scored) {
    if (c.id === businessId) continue;
    if (a.confidence < DUPLICATE_THRESHOLDS.review) continue;
    if (a.hardMatch && a.confidence >= DUPLICATE_THRESHOLDS.autoLink && !created) continue;
    const [x, y] = [businessId, c.id as string].sort();
    await db.from("duplicate_candidates").upsert(
      { organisation_id: ctx.organisationId, business_a: x, business_b: y, confidence: a.confidence, reasons: a.reasons },
      { onConflict: "business_a,business_b", ignoreDuplicates: true },
    );
    possibleDuplicates++;
  }

  return { businessId, created, matchedExisting: !created, matchedLifecycle, possibleDuplicates };
}
