"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { parseNaturalQuery } from "@/lib/search/parse";
import { searchCriteriaSchema } from "@/lib/search/criteria";
import { createSearchJob } from "@/lib/jobs/search-jobs";
import { kickWorker } from "@/lib/jobs/kick";
import { loadOrgSettings } from "@/lib/research/settings";
import { act } from "./_util";

/** "Find on Google Maps": what + where + how many → results go straight into the CRM. */
export async function quickFind(input: { what: string; where: string; count: number; noWebsiteOnly?: boolean; assignTo?: string | null }) {
  return act<{ jobId: string }>(async () => {
    const s = await assertPermission("search.run");
    const what = z.string().trim().min(2).max(120).parse(input.what);
    const where = z.string().trim().min(2).max(120).parse(input.where);
    const admin = createAdminClient();
    const settings = await loadOrgSettings(admin, s.organisationId);
    const parsed = parseNaturalQuery(`find ${what} in ${where}`, { defaultCountryCode: settings.defaultCountry });
    const c = parsed.criteria;
    if (!c.categories.length) c.categories = [{ label: what.replace(/\b\w/g, (x) => x.toUpperCase()), terms: [what] }];
    if (!c.locations.length) c.locations = [{ label: where, kind: "NAMED", countryCode: settings.defaultCountry }];
    c.output = { targetCount: Math.min(500, Math.max(10, input.count || 50)), depth: "BALANCED" };
    c.digital = { ...(c.digital ?? {}), website: input.noWebsiteOnly ? ["NO_WEBSITE"] : ["ANY"] };
    c.coverage = { skipRecentlySearchedDays: 0, splitLargeAreas: true };
    const criteria = searchCriteriaSchema.parse(c);
    const jobId = await createSearchJob(admin, { organisationId: s.organisationId, userId: s.userId, criteria, name: `${what} — ${where}`, autoApprove: { assignTo: input.assignTo ?? null } });
    await kickWorker();
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "search.started", entityType: "search_job", entityId: jobId, after: { what, where, count: input.count, simple: true } });
    return { jobId };
  });
}

/** Move every lead still sitting in Research (old searches/imports) into the CRM. */
export async function moveAllResearchToCrm() {
  return act(async () => {
    const s = await assertPermission("research.approve");
    const admin = createAdminClient();
    const { data, error } = await admin.from("businesses").update({ lifecycle: "ACTIVE", approved_at: new Date().toISOString(), approved_by: s.userId })
      .eq("organisation_id", s.organisationId).eq("lifecycle", "RESEARCH").select("id");
    if (error) throw new Error(error.message);
    await admin.from("search_results").update({ stage: "APPROVED", reviewed_by: s.userId, reviewed_at: new Date().toISOString() }).eq("organisation_id", s.organisationId).in("stage", ["QUALIFIED", "REVIEW_REQUIRED", "RAW"]);
    await writeAudit({ organisationId: s.organisationId, userId: s.userId, userEmail: s.email, action: "research.moved_all_to_crm", entityType: "business", after: { count: data?.length ?? 0 } });
    revalidatePath("/add");
    revalidatePath("/leads");
    return { ok: true as const, message: `${data?.length ?? 0} leads added to the CRM` };
  });
}
