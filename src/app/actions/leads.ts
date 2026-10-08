"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission, type SessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { diffObjects, writeAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { generateLeadAnalysis } from "@/lib/research/ai-analysis";
import { processBusiness } from "@/lib/research/process";
import { loadOrgSettings } from "@/lib/research/settings";
import { STAGES } from "@/lib/format";
import { act, BULK_APPROVAL_THRESHOLD } from "./_util";
import { executeAssignment } from "@/lib/leads/assign";

const uuid = z.string().uuid();
const uuids = z.array(uuid).min(1).max(5000);

async function audit(s: SessionContext, action: string, entityId: string | null, before?: unknown, after?: unknown, metadata?: Record<string, unknown>) {
  await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action, entityType: "business", entityId, before, after, metadata });
}

/** Rows the user can see (RLS) — used to validate ids before privileged writes. */
async function visibleIds(ids: string[]): Promise<string[]> {
  const supabase = await createClient();
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from("businesses").select("id").in("id", ids.slice(i, i + 300));
    out.push(...(data ?? []).map((d) => d.id));
  }
  return out;
}

export async function updateStage(businessId: string, stage: string, lostReason?: string) {
  return act(async () => {
    const s = await assertPermission("leads.edit");
    uuid.parse(businessId);
    if (!STAGES.includes(stage as never)) throw new Error("Invalid stage");
    const supabase = await createClient();
    const { data: before } = await supabase.from("businesses").select("pipeline_stage, last_contacted_at").eq("id", businessId).single();
    if (!before) throw new Error("Lead not found or not visible");
    const patch: Record<string, unknown> = { pipeline_stage: stage, lost_reason: stage === "LOST" ? lostReason ?? null : null };
    if (stage === "CONTACTED" && before.pipeline_stage === "NOT_CONTACTED") patch.last_contacted_at = new Date().toISOString();
    const { error } = await supabase.from("businesses").update(patch).eq("id", businessId);
    if (error) throw new Error(error.message);
    const admin = createAdminClient();
    await admin.from("activities").insert({ organisation_id: s.organisationId, business_id: businessId, type: `STAGE_${stage}`, title: `Stage: ${before.pipeline_stage.replace(/_/g, " ").toLowerCase()} → ${stage.replace(/_/g, " ").toLowerCase()}`, actor_id: s.userId, data: { from: before.pipeline_stage, to: stage, lostReason } });
    await audit(s, "lead.stage_changed", businessId, { pipeline_stage: before.pipeline_stage }, { pipeline_stage: stage });
    // Auto follow-up after first contact (2 days later) if none pending
    if (stage === "CONTACTED") {
      const { count } = await supabase.from("follow_ups").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "PENDING");
      if (!count) {
        const due = new Date(Date.now() + 2 * 86_400_000);
        await supabase.from("follow_ups").insert({ business_id: businessId, due_at: due.toISOString(), note: "Follow up on first contact", assigned_to: s.userId, created_by: s.userId });
        await supabase.from("businesses").update({ next_follow_up_at: due.toISOString() }).eq("id", businessId);
      }
    }
    revalidatePath(`/leads/${businessId}`);
    revalidatePath("/pipeline");
    return { ok: true as const, message: stage === "CONTACTED" ? "Marked contacted — follow-up scheduled in 2 days" : "Stage updated" };
  });
}

/**
 * Assign leads to a user and/or team. Modes: manual (one user) or round-robin
 * across several users. Mass reassignment above the threshold requires a
 * Super Admin approval.
 */
export async function assignLeads(input: { businessIds: string[]; userIds: string[]; teamId?: string | null; mode?: "MANUAL" | "ROUND_ROBIN"; unassign?: boolean }) {
  return act(async () => {
    const s = await assertPermission("leads.assign");
    const ids = uuids.parse(input.businessIds);
    const users = z.array(uuid).max(100).parse(input.userIds ?? []);
    if (!input.unassign && !users.length && !input.teamId) throw new Error("Choose a user or team");
    const admin = createAdminClient();
    if (users.length) {
      const { data: valid } = await admin.from("profiles").select("id").in("id", users).eq("organisation_id", s.organisationId).eq("status", "ACTIVE");
      if ((valid?.length ?? 0) !== users.length) throw new Error("One or more users are not active members of your organisation");
    }
    const visible = await visibleIds(ids);
    if (ids.length > BULK_APPROVAL_THRESHOLD && s.role !== "SUPER_ADMIN") {
      const { data: req } = await admin.from("approval_requests").insert({ organisation_id: s.organisationId, type: "MASS_REASSIGN", summary: `Reassign ${visible.length} leads`, payload: { ...input, businessIds: visible }, requested_by: s.userId }).select("id").single();
      await audit(s, "approval.requested", req?.id ?? null, null, { type: "MASS_REASSIGN", count: visible.length });
      return { ok: true as const, message: `Reassigning ${visible.length} leads needs Super Admin approval — request submitted.` };
    }
    const n = await executeAssignment(admin, s.organisationId, s.userId, visible, users, input.teamId ?? null, input.mode ?? "MANUAL", !!input.unassign);
    await audit(s, "lead.assigned", null, null, { count: n, users, teamId: input.teamId, mode: input.mode, unassign: input.unassign }, { businessIds: visible.slice(0, 200) });
    revalidatePath("/leads");
    return { ok: true as const, message: input.unassign ? `${n} leads unassigned` : `${n} leads assigned` };
  });
}

export async function logOutreach(input: { businessId: string; channel: string; message?: string; outcome?: string; markContacted?: boolean }) {
  return act(async () => {
    const s = await assertPermission("outreach.log");
    uuid.parse(input.businessId);
    const channel = z.enum(["WHATSAPP", "CALL", "EMAIL", "INSTAGRAM", "FACEBOOK", "IN_PERSON", "OTHER"]).parse(input.channel);
    const supabase = await createClient();
    const { error } = await supabase.from("outreach").insert({ business_id: input.businessId, channel, message: input.message?.slice(0, 5000) ?? null, outcome: input.outcome?.slice(0, 500) ?? null, user_id: s.userId });
    if (error) throw new Error(error.message);
    await createAdminClient().from("activities").insert({ organisation_id: s.organisationId, business_id: input.businessId, type: "OUTREACH", title: `Outreach via ${channel.toLowerCase()}`, actor_id: s.userId, data: { outcome: input.outcome } });
    await supabase.from("businesses").update({ last_contacted_at: new Date().toISOString() }).eq("id", input.businessId);
    if (input.markContacted) await updateStage(input.businessId, "CONTACTED");
    revalidatePath(`/leads/${input.businessId}`);
    return { ok: true as const, message: "Outreach logged" };
  });
}

export async function addNote(input: { businessId: string; body: string; visibility: "PRIVATE" | "TEAM" }) {
  return act(async () => {
    const s = await assertPermission("notes.create");
    const body = z.string().trim().min(1).max(10000).parse(input.body);
    const supabase = await createClient();
    const { error } = await supabase.from("notes").insert({ business_id: uuid.parse(input.businessId), body, visibility: input.visibility === "PRIVATE" ? "PRIVATE" : "TEAM", author_id: s.userId });
    if (error) throw new Error(error.message);
    revalidatePath(`/leads/${input.businessId}`);
    return { ok: true as const, message: "Note added" };
  });
}

export async function scheduleFollowUp(input: { businessIds: string[]; dueAt: string; note?: string; assignTo?: string | null }) {
  return act(async () => {
    const s = await assertPermission("outreach.log");
    const ids = uuids.parse(input.businessIds);
    const due = new Date(input.dueAt);
    if (Number.isNaN(due.getTime())) throw new Error("Invalid date");
    const supabase = await createClient();
    const visible = await visibleIds(ids);
    const { error } = await supabase.from("follow_ups").insert(visible.map((id) => ({ business_id: id, due_at: due.toISOString(), note: input.note?.slice(0, 1000) ?? null, assigned_to: input.assignTo ?? s.userId, created_by: s.userId })));
    if (error) throw new Error(error.message);
    for (let i = 0; i < visible.length; i += 300) await supabase.from("businesses").update({ next_follow_up_at: due.toISOString() }).in("id", visible.slice(i, i + 300));
    revalidatePath("/follow-ups");
    return { ok: true as const, message: `Follow-up scheduled for ${visible.length} lead(s)` };
  });
}

export async function completeFollowUp(id: string, outcome?: string) {
  return act(async () => {
    const s = await assertPermission("outreach.log");
    const supabase = await createClient();
    const { data: fu, error } = await supabase.from("follow_ups").update({ status: "DONE", completed_at: new Date().toISOString() }).eq("id", uuid.parse(id)).select("business_id").single();
    if (error) throw new Error(error.message);
    const { data: next } = await supabase.from("follow_ups").select("due_at").eq("business_id", fu.business_id).eq("status", "PENDING").order("due_at").limit(1).maybeSingle();
    await supabase.from("businesses").update({ next_follow_up_at: next?.due_at ?? null }).eq("id", fu.business_id);
    await createAdminClient().from("activities").insert({ organisation_id: s.organisationId, business_id: fu.business_id, type: "FOLLOW_UP_DONE", title: "Follow-up completed", actor_id: s.userId, data: { outcome } });
    revalidatePath("/follow-ups");
    return { ok: true as const };
  });
}

/** Manual overrides — every override is tracked with who/when/why. */
export async function overrideLead(input: { businessId: string; field: "lead_score" | "website_status" | "category" | "recommended_service"; value: string; reason: string }) {
  return act(async () => {
    const s = await assertPermission("leads.override");
    const id = uuid.parse(input.businessId);
    const reason = z.string().trim().min(3).max(500).parse(input.reason);
    const supabase = await createClient();
    const { data: b } = await supabase.from("businesses").select("overrides, lead_score, website_status, category_key, category_label, recommended_service, tier").eq("id", id).single();
    if (!b) throw new Error("Lead not found");
    const meta = { by: s.userId, byEmail: s.email, at: new Date().toISOString(), reason };
    const overrides = { ...(b.overrides ?? {}) } as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (input.field === "lead_score") {
      const v = z.coerce.number().int().min(0).max(100).parse(input.value);
      overrides.lead_score = { value: v, ...meta, previous: b.lead_score };
      const { tierFor } = await import("@/lib/intel/scoring");
      const settings = await loadOrgSettings(createAdminClient(), s.organisationId);
      Object.assign(patch, { lead_score: v, tier: tierFor(v, settings.scoring) });
      await createAdminClient().from("lead_scores").insert({ business_id: id, score: v, tier: tierFor(v, settings.scoring), breakdown: { override: true }, is_override: true, override_reason: reason, computed_by: s.userId });
    } else if (input.field === "website_status") {
      overrides.website_status = { value: input.value, ...meta, previous: b.website_status };
      patch.website_status = input.value;
    } else if (input.field === "category") {
      const { categoryByKey } = await import("@/lib/categories/taxonomy");
      const cat = categoryByKey(input.value);
      overrides.category = { value: input.value, ...meta, previous: b.category_key };
      Object.assign(patch, { category_key: cat?.key ?? null, category_label: cat?.name ?? input.value });
    } else {
      overrides.recommended_service = { value: input.value.slice(0, 200), ...meta, previous: b.recommended_service };
      patch.recommended_service = input.value.slice(0, 200);
    }
    patch.overrides = overrides;
    const { error } = await supabase.from("businesses").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    await createAdminClient().from("activities").insert({ organisation_id: s.organisationId, business_id: id, type: "OVERRIDE", title: `Manual override: ${input.field.replace(/_/g, " ")} → ${input.value}`, actor_id: s.userId, data: { reason } });
    await audit(s, "lead.override", id, { [input.field]: (b as Record<string, unknown>)[input.field === "category" ? "category_key" : input.field] }, { [input.field]: input.value }, { reason });
    revalidatePath(`/leads/${id}`);
    return { ok: true as const, message: "Override saved" };
  });
}

/** Price & deal amounts — pricing.view only (hidden from BDOs). */
export async function setPricing(input: { businessId: string; min?: number | null; max?: number | null; dealValue?: number | null; reason?: string }) {
  return act(async () => {
    const s = await assertPermission("pricing.view");
    const id = uuid.parse(input.businessId);
    const supabase = await createClient();
    const { data: before } = await supabase.from("lead_pricing").select("*").eq("business_id", id).maybeSingle();
    const patch: Record<string, unknown> = { business_id: id, updated_by: s.userId };
    if (input.min !== undefined || input.max !== undefined) Object.assign(patch, { recommended_price_min: input.min ?? null, recommended_price_max: input.max ?? null, price_override: true });
    if (input.dealValue !== undefined) patch.deal_value = input.dealValue;
    const { error } = await supabase.from("lead_pricing").upsert(patch, { onConflict: "business_id" });
    if (error) throw new Error(error.message);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "lead.pricing_changed", entityType: "lead_pricing", entityId: id, ...diffObjects(before ?? {}, { ...(before ?? {}), ...patch }), metadata: { reason: input.reason } });
    revalidatePath(`/leads/${id}`);
    return { ok: true as const, message: "Pricing saved" };
  });
}

export async function archiveLeads(businessIds: string[], restore = false) {
  return act(async () => {
    const s = await assertPermission("leads.archive");
    const ids = uuids.parse(businessIds);
    const admin = createAdminClient();
    const visible = await visibleIds(ids);
    if (visible.length > BULK_APPROVAL_THRESHOLD && s.role !== "SUPER_ADMIN") {
      await admin.from("approval_requests").insert({ organisation_id: s.organisationId, type: "BULK_ARCHIVE", summary: `${restore ? "Restore" : "Archive"} ${visible.length} leads`, payload: { businessIds: visible, restore }, requested_by: s.userId });
      return { ok: true as const, message: "Bulk archive needs Super Admin approval — request submitted." };
    }
    for (let i = 0; i < visible.length; i += 300) {
      await admin.from("businesses").update(restore ? { lifecycle: "ACTIVE", archived_at: null, archived_by: null } : { lifecycle: "ARCHIVED", archived_at: new Date().toISOString(), archived_by: s.userId }).in("id", visible.slice(i, i + 300)).eq("organisation_id", s.organisationId);
    }
    await audit(s, restore ? "lead.restored" : "lead.archived", visible.length === 1 ? visible[0] : null, null, { count: visible.length }, { businessIds: visible.slice(0, 200) });
    revalidatePath("/leads");
    return { ok: true as const, message: `${visible.length} lead(s) ${restore ? "restored" : "archived"}` };
  });
}

export async function deleteLeadPermanently(businessId: string) {
  return act(async () => {
    const s = await assertPermission("leads.delete_permanent");
    const admin = createAdminClient();
    const { data: before } = await admin.from("businesses").select("id, name, lead_code, organisation_id").eq("id", uuid.parse(businessId)).single();
    if (!before || before.organisation_id !== s.organisationId) throw new Error("Lead not found");
    await admin.from("businesses").delete().eq("id", businessId);
    await audit(s, "lead.deleted_permanently", businessId, before, null);
    return { ok: true as const, message: "Lead permanently deleted" };
  });
}

export async function tagLeads(businessIds: string[], tagName: string) {
  return act(async () => {
    const s = await assertPermission("leads.edit");
    const name = z.string().trim().min(1).max(40).parse(tagName);
    const supabase = await createClient();
    let { data: tag } = await supabase.from("tags").select("id").eq("organisation_id", s.organisationId).eq("name", name).maybeSingle();
    if (!tag) ({ data: tag } = await supabase.from("tags").insert({ organisation_id: s.organisationId, name }).select("id").single());
    const visible = await visibleIds(uuids.parse(businessIds));
    await supabase.from("lead_tags").upsert(visible.map((id) => ({ business_id: id, tag_id: tag!.id, created_by: s.userId })), { onConflict: "business_id,tag_id", ignoreDuplicates: true });
    revalidatePath("/leads");
    return { ok: true as const, message: `Tagged ${visible.length} lead(s) “${name}”` };
  });
}

export async function bulkStage(businessIds: string[], stage: string) {
  return act(async () => {
    const s = await assertPermission("leads.bulk");
    if (!STAGES.includes(stage as never)) throw new Error("Invalid stage");
    const visible = await visibleIds(uuids.parse(businessIds));
    const supabase = await createClient();
    for (let i = 0; i < visible.length; i += 300) await supabase.from("businesses").update({ pipeline_stage: stage }).in("id", visible.slice(i, i + 300));
    await audit(s, "lead.bulk_stage", null, null, { stage, count: visible.length });
    revalidatePath("/leads");
    return { ok: true as const, message: `${visible.length} lead(s) moved to ${stage.replace(/_/g, " ").toLowerCase()}` };
  });
}

/** Reprocessing without recreating the record. Small sets run inline; larger sets are queued. */
export async function reprocessLeads(input: { businessIds: string[]; mode: "AUDIT" | "SOCIAL" | "RESCORE" | "DUPLICATES" | "FULL" | "AI" }) {
  return act(async () => {
    const s = await assertPermission(input.mode === "RESCORE" ? "leads.edit" : "research.review");
    const visible = await visibleIds(uuids.parse(input.businessIds));
    const admin = createAdminClient();
    const steps = input.mode === "AUDIT" ? { discover: false, audit: true, social: false } : input.mode === "SOCIAL" ? { discover: true, audit: false, social: true } : input.mode === "RESCORE" ? { discover: false, audit: false, social: false } : {};
    const depth = input.mode === "FULL" ? "DEEP" : "BALANCED";
    if (input.mode === "DUPLICATES") {
      const { ingestRecheck } = await import("@/lib/research/recheck");
      let n = 0;
      for (const id of visible) n += await ingestRecheck(admin, id);
      return { ok: true as const, message: `${n} possible duplicate(s) found` };
    }
    if (input.mode === "AI") {
      if (visible.length > 3) {
        await enqueue(admin, { organisationId: s.organisationId, kind: "lead.process", payload: { businessIds: visible, depth: "BALANCED", steps: { discover: false, audit: false, social: false }, ai: true, actorId: s.userId } });
        return { ok: true as const, message: `AI analysis queued for ${visible.length} leads` };
      }
      for (const id of visible) await generateLeadAnalysis(admin, id);
      revalidatePath(`/leads/${visible[0]}`);
      return { ok: true as const, message: "AI analysis generated" };
    }
    if (visible.length <= 2) {
      const settings = await loadOrgSettings(admin, s.organisationId);
      for (const id of visible) await processBusiness(admin, id, { depth, settings, steps, actorId: s.userId });
      revalidatePath(`/leads/${visible[0]}`);
      return { ok: true as const, message: "Done" };
    }
    for (let i = 0; i < visible.length; i += 10) {
      await enqueue(admin, { organisationId: s.organisationId, kind: "lead.process", payload: { businessIds: visible.slice(i, i + 10), depth, steps, actorId: s.userId } });
    }
    await audit(s, "lead.reprocess_queued", null, null, { mode: input.mode, count: visible.length });
    return { ok: true as const, message: `Queued ${visible.length} lead(s) for processing` };
  });
}

export async function mergeLeads(keepId: string, mergeId: string, fieldChoices: Record<string, "keep" | "merge">) {
  return act(async () => {
    const s = await assertPermission("leads.merge");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("merge_businesses", { p_keep: uuid.parse(keepId), p_merge: uuid.parse(mergeId), field_choices: fieldChoices, p_actor: s.userId });
    if (error) throw new Error(error.message);
    await audit(s, "lead.merged", keepId, { merged: mergeId }, data, { fieldChoices });
    revalidatePath(`/leads/${keepId}`);
    return { ok: true as const, message: "Records merged — history preserved" };
  });
}

export async function dismissDuplicate(candidateId: string) {
  return act(async () => {
    const s = await assertPermission("leads.merge");
    const supabase = await createClient();
    await supabase.from("duplicate_candidates").update({ status: "DISMISSED", resolved_at: new Date().toISOString(), resolved_by: s.userId }).eq("id", uuid.parse(candidateId));
    return { ok: true as const, message: "Marked as not a duplicate" };
  });
}

export async function createLead(input: { name: string; phone?: string; website?: string; city?: string; area?: string; categoryKey?: string }) {
  return act(async () => {
    const s = await assertPermission("leads.create");
    const name = z.string().trim().min(2).max(200).parse(input.name);
    const admin = createAdminClient();
    const settings = await loadOrgSettings(admin, s.organisationId);
    const { ingestRawBusiness } = await import("@/lib/research/ingest");
    const { categoryByKey } = await import("@/lib/categories/taxonomy");
    const cat = input.categoryKey ? categoryByKey(input.categoryKey) : undefined;
    const r = await ingestRawBusiness(admin, { organisationId: s.organisationId, createdBy: s.userId, defaultCountry: settings.defaultCountry, categoryKey: cat?.key ?? null, categoryLabel: cat?.name ?? null, lifecycle: "ACTIVE" }, {
      provider: "manual", externalId: `manual:${crypto.randomUUID()}`, name, categoryLabels: [], phone: input.phone ?? null, website: input.website ?? null, city: input.city ?? null, area: input.area ?? null, raw: { enteredBy: s.email, ...input },
    });
    await admin.from("businesses").update({ owner_id: s.userId, team_id: s.teamId, approved_at: new Date().toISOString(), approved_by: s.userId }).eq("id", r.businessId).eq("lifecycle", "ACTIVE");
    await processBusiness(admin, r.businessId, { depth: "BALANCED", settings, actorId: s.userId }).catch(() => undefined);
    await audit(s, "lead.created", r.businessId, null, { name, manual: true });
    return { ok: true as const, data: { id: r.businessId }, message: r.created ? "Lead created" : "Matched an existing record" };
  });
}

const OUTCOMES = {
  WHATSAPP_SENT: { channel: "WHATSAPP", stage: "CONTACTED", followDays: 2, label: "WhatsApp message sent" },
  CALLED_INTERESTED: { channel: "CALL", stage: "INTERESTED", followDays: 1, label: "Called — interested" },
  REPLIED: { channel: "WHATSAPP", stage: "REPLIED", followDays: 1, label: "They replied" },
  NO_ANSWER: { channel: "CALL", stage: "CONTACTED", followDays: 1, label: "No answer — try again" },
  NOT_INTERESTED: { channel: "OTHER", stage: "LOST", followDays: 0, label: "Not interested" },
  MEETING: { channel: "CALL", stage: "MEETING", followDays: 1, label: "Meeting booked" },
} as const;
export type QuickOutcome = keyof typeof OUTCOMES;

/**
 * One-click outreach outcome for the guided BDO flow: logs the outreach,
 * moves the pipeline stage, closes due follow-ups and schedules the next one.
 */
export async function quickOutcome(input: { businessId: string; outcome: QuickOutcome; message?: string; note?: string }) {
  return act(async () => {
    const s = await assertPermission("outreach.log");
    const id = uuid.parse(input.businessId);
    const o = OUTCOMES[input.outcome];
    if (!o) throw new Error("Unknown outcome");
    const supabase = await createClient();
    const { data: b } = await supabase.from("businesses").select("pipeline_stage, owner_id").eq("id", id).single();
    if (!b) throw new Error("Lead not found or not visible");
    const now = new Date();
    const { error } = await supabase.from("outreach").insert({ business_id: id, channel: o.channel, message: input.message?.slice(0, 5000) ?? null, outcome: o.label + (input.note ? ` — ${input.note.slice(0, 300)}` : ""), user_id: s.userId });
    if (error) throw new Error(error.message);
    // Close any follow-ups that are due — this contact handles them.
    await supabase.from("follow_ups").update({ status: "DONE", completed_at: now.toISOString() }).eq("business_id", id).eq("status", "PENDING").lte("due_at", new Date(now.getTime() + 12 * 3_600_000).toISOString());
    let next: string | null = null;
    if (o.followDays) {
      const due = new Date(now.getTime() + o.followDays * 86_400_000);
      due.setHours(10, 0, 0, 0);
      next = due.toISOString();
      await supabase.from("follow_ups").insert({ business_id: id, due_at: next, note: `Follow up: ${o.label.toLowerCase()}`, assigned_to: s.userId, created_by: s.userId });
    }
    const patch: Record<string, unknown> = { last_contacted_at: now.toISOString(), next_follow_up_at: next };
    const order = ["NOT_CONTACTED", "CONTACTED", "REPLIED", "INTERESTED", "MEETING", "QUOTE_SENT", "WON"];
    // Never move a lead backwards (e.g. "no answer" on an interested lead).
    if (o.stage === "LOST" || order.indexOf(o.stage) > order.indexOf(b.pipeline_stage)) patch.pipeline_stage = o.stage;
    if (o.stage === "LOST") patch.lost_reason = input.note ?? "Not interested";
    if (!b.owner_id) patch.owner_id = s.userId;
    await supabase.from("businesses").update(patch).eq("id", id);
    await createAdminClient().from("activities").insert({ organisation_id: s.organisationId, business_id: id, type: "OUTREACH", title: o.label, actor_id: s.userId, data: { outcome: input.outcome, stage: patch.pipeline_stage ?? b.pipeline_stage } });
    revalidatePath("/outreach");
    return { ok: true as const, message: o.followDays ? `${o.label} · follow-up ${o.followDays === 1 ? "tomorrow" : `in ${o.followDays} days`}` : o.label };
  });
}
