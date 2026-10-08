import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODEL, AiRefusalError, AiUnavailableError, FALLBACK_BETA, getAnthropic } from "./client";
import { queryLeads, type LeadFilters } from "@/lib/leads/query";
import { buildOutreachMessage } from "@/lib/intel/outreach";

/**
 * AI Sales Assistant. Claude answers ONLY from tool results, and every tool
 * queries the CRM with the signed-in user's RLS-scoped client, so the
 * assistant can never see more than the user can.
 */
const LEAD_FILTER_PROPS = {
  q: { type: "string", description: "free-text name/phone/domain search" },
  tier: { type: "string", description: "comma list of HOT,HIGH,GOOD,MEDIUM,LOW" },
  stage: { type: "string", description: "comma list of NOT_CONTACTED,CONTACTED,REPLIED,INTERESTED,MEETING,QUOTE_SENT,WON,LOST" },
  website: { type: "string", description: "comma list of NO_WEBSITE,BROKEN,OUTDATED,MOBILE_ISSUE,SLOW,POOR_DESIGN,MISSING_FUNCTIONALITY,AVERAGE,GOOD,HIGH_QUALITY" },
  category: { type: "string", description: "category key e.g. cleaning_services, salons, flower_shops, restaurants" },
  city: { type: "string" },
  area: { type: "string" },
  owner: { type: "string", description: "'me' or 'unassigned'" },
  whatsapp: { type: "string", description: "'1' to require WhatsApp" },
  minScore: { type: "string" },
  contacted: { type: "string", description: "'no' for not contacted" },
  followup: { type: "string", description: "overdue | today | week" },
  sort: { type: "string", description: "score | intent | newest | reviews" },
} as const;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: "search_leads", description: "List CRM leads matching filters (max 25). Returns id, name, score, tier, website status, stage, area, recommended service.", input_schema: { type: "object", properties: { ...LEAD_FILTER_PROPS, limit: { type: "number" } } } },
  { name: "count_leads", description: "Count CRM leads matching filters.", input_schema: { type: "object", properties: LEAD_FILTER_PROPS } },
  { name: "get_lead", description: "Full details for one lead by id, including evidence, opportunities and score breakdown.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "draft_message", description: "Draft a WhatsApp outreach message for a lead from its observed facts.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
];

async function runTool(db: SupabaseClient, userId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
  const f = Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === "string")) as LeadFilters;
  if (name === "search_leads") {
    const { rows, count } = await queryLeads(db, { ...f, per: String(Math.min(25, Number(input.limit) || 20)) }, userId, { columns: "id, lead_code, name, category_label, area, city, lead_score, sales_intent, tier, website_status, pipeline_stage, recommended_service, whatsapp_e164, google_rating, google_review_count" });
    return { total_matching: count, leads: rows };
  }
  if (name === "count_leads") return { count: (await queryLeads(db, { ...f, per: "1" }, userId, { columns: "id" })).count };
  if (name === "get_lead" || name === "draft_message") {
    const { data: b } = await db.from("businesses").select("id, lead_code, name, category_label, area, city, google_rating, google_review_count, phone_e164, whatsapp_e164, email, website_url, website_domain, website_status, website_issues, lead_score, lead_score_breakdown, sales_intent, tier, pipeline_stage, recommended_service, ai_analysis, business_socials(platform, url, activity, followers), opportunities(type, reason, priority)").eq("id", String(input.id)).maybeSingle();
    if (!b) return { error: "Lead not found or not visible to you" };
    if (name === "draft_message") return { message: (b.ai_analysis as { outreach_message?: string } | null)?.outreach_message ?? buildOutreachMessage({ businessName: b.name, area: b.area, city: b.city, categoryLabel: b.category_label, rating: b.google_rating, reviewCount: b.google_review_count, websiteStatus: b.website_status, websiteIssues: b.website_issues, websiteDomain: b.website_domain, instagramPresent: (b.business_socials ?? []).some((s: { platform: string }) => s.platform === "INSTAGRAM") }) };
    return b;
  }
  return { error: `unknown tool ${name}` };
}

export interface ChatTurn { role: "user" | "assistant"; content: string }

export async function askAssistant(db: SupabaseClient, userId: string, history: ChatTurn[]): Promise<{ answer: string; toolCalls: { name: string; input: unknown }[] }> {
  const client = getAnthropic();
  if (!client) throw new AiUnavailableError();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12).map((t) => ({ role: t.role, content: t.content }));
  const toolCalls: { name: string; input: unknown }[] = [];
  for (let i = 0; i < 8; i++) {
    const res = await client.beta.messages.create({
      model: AI_MODEL(), max_tokens: 8000, betas: [FALLBACK_BETA], fallbacks: "default", output_config: { effort: "low" },
      system: `You are the AI Sales Assistant inside Ain AlTair's lead CRM. Answer questions using ONLY data returned by the tools — never invent leads, counts or facts. If the tools return nothing, say so. Prices and deal values are not available to you; do not discuss amounts. Link leads as markdown [Name](/leads/<id>). Be concise. Today is ${new Date().toISOString().slice(0, 10)}.`,
      tools: TOOLS, messages,
    });
    if (res.stop_reason === "refusal") throw new AiRefusalError(res.stop_details?.category ?? null);
    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
    const uses = res.content.filter((c): c is Anthropic.Beta.BetaToolUseBlock => c.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) {
      return { answer: res.content.filter((c): c is Anthropic.Beta.BetaTextBlock => c.type === "text").map((c) => c.text).join("\n"), toolCalls };
    }
    const results = await Promise.all(uses.map(async (u) => {
      toolCalls.push({ name: u.name, input: u.input });
      try {
        return { type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(await runTool(db, userId, u.name, (u.input ?? {}) as Record<string, unknown>)).slice(0, 60_000) };
      } catch (e) {
        return { type: "tool_result" as const, tool_use_id: u.id, content: `Error: ${(e as Error).message}`, is_error: true };
      }
    }));
    messages.push({ role: "user", content: results });
  }
  return { answer: "I couldn't complete that within the tool-call limit. Try a narrower question.", toolCalls };
}
