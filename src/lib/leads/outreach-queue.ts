import type { SupabaseClient } from "@supabase/supabase-js";
import { rankContactToday } from "@/lib/intel/ranking";
import { buildOutreachMessage } from "@/lib/intel/outreach";

export interface QueueLead {
  id: string; name: string; lead_code: string; category_label: string | null; area: string | null; city: string | null;
  google_rating: number | null; google_review_count: number | null; website_status: string; website_url: string | null; website_domain: string | null;
  whatsapp_e164: string | null; phone_e164: string | null; phone_formatted: string | null; phone_type: string | null; email: string | null; google_maps_url: string | null;
  tier: string | null; lead_score: number | null; recommended_service: string | null; pipeline_stage: string;
  instagram: string | null; facebook: string | null;
  reason: "FOLLOW_UP" | "NEW"; followUpNote: string | null; followUpDue: string | null;
  why: string[]; message: string; talkingPoints: string[];
}

const COLS = "id, name, lead_code, category_label, area, city, google_rating, google_review_count, website_status, website_issues, website_url, website_domain, whatsapp_e164, phone_e164, phone_formatted, phone_type, email, google_maps_url, tier, lead_score, sales_intent, recommended_service, pipeline_stage, business_status, ai_analysis, business_socials(platform, url, activity)";

/** Today's outreach queue: due follow-ups first, then the best uncontacted leads. */
export async function buildOutreachQueue(db: SupabaseClient, userId: string, senderName: string | null, onlyMine: boolean): Promise<QueueLead[]> {
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const { data: fus } = await db.from("follow_ups").select("business_id, note, due_at").eq("status", "PENDING").eq("assigned_to", userId).lte("due_at", endToday.toISOString()).order("due_at").limit(40);
  const fuIds = [...new Set((fus ?? []).map((f) => f.business_id))];
  const { data: fuLeads } = fuIds.length ? await db.from("businesses").select(COLS).in("id", fuIds).eq("lifecycle", "ACTIVE").not("pipeline_stage", "in", "(WON,LOST)") : { data: [] };
  let q = db.from("businesses").select(COLS).eq("lifecycle", "ACTIVE").eq("pipeline_stage", "NOT_CONTACTED").neq("business_status", "CLOSED_PERMANENTLY").limit(300);
  q = onlyMine ? q.eq("owner_id", userId) : q.or(`owner_id.eq.${userId},owner_id.is.null`);
  const { data: fresh } = await q;
  const ranked = rankContactToday(((fresh ?? []) as never[]).filter((b: { id: string }) => !fuIds.includes(b.id))).slice(0, 60);
  const toLead = (b: Record<string, unknown>, reason: QueueLead["reason"], why: string[]): QueueLead => {
    const socials = (b.business_socials ?? []) as { platform: string; url: string }[];
    const ai = b.ai_analysis as { outreach_message?: string; sales_angle?: string; problem?: string } | null;
    const fu = (fus ?? []).find((f) => f.business_id === b.id);
    const ws = b.website_status as string;
    const points: string[] = [];
    if (ws === "NO_WEBSITE") points.push("They have no website — customers only find them on Google/Instagram.");
    if (ws === "BROKEN") points.push("Their website is not loading right now.");
    if (ws === "OUTDATED" || ws === "POOR_DESIGN") points.push("Their website looks outdated compared with their reputation.");
    if (ws === "MOBILE_ISSUE") points.push("Their website is hard to use on phones.");
    if ((b.google_review_count as number) >= 20) points.push(`Strong reputation: ${b.google_rating}★ from ${b.google_review_count} Google reviews — compliment this.`);
    if (b.recommended_service) points.push(`Offer: ${b.recommended_service}. Suggest a free mock-up.`);
    if (ai?.sales_angle) points.push(`Angle: ${ai.sales_angle}`);
    return {
      ...(b as unknown as QueueLead),
      instagram: socials.find((s) => s.platform === "INSTAGRAM")?.url ?? null,
      facebook: socials.find((s) => s.platform === "FACEBOOK")?.url ?? null,
      reason, followUpNote: fu?.note ?? null, followUpDue: fu?.due_at ?? null, why,
      talkingPoints: points,
      message: ai?.outreach_message ?? buildOutreachMessage({ businessName: b.name as string, area: b.area as string, city: b.city as string, categoryLabel: b.category_label as string, rating: b.google_rating as number, reviewCount: b.google_review_count as number, websiteStatus: ws, websiteIssues: b.website_issues as string[], websiteDomain: b.website_domain as string, instagramPresent: socials.some((s) => s.platform === "INSTAGRAM"), senderName: senderName?.split(" ")[0] }),
    };
  };
  return [
    ...((fuLeads ?? []) as Record<string, unknown>[]).map((b) => toLead(b, "FOLLOW_UP", ["Follow-up due today"])),
    ...ranked.map((r) => toLead(r.lead as Record<string, unknown>, "NEW", r.reasons)),
  ];
}
