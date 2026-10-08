import { z } from "zod/v4";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, AiRefusalError, AiUnavailableError, FALLBACK_BETA, getAnthropic } from "./client";

/**
 * AI lead analysis. The model receives ONLY verified facts (each with its
 * source) and must separate observed facts from inferences. Output is stored
 * in businesses.ai_analysis and always rendered with an "AI" label.
 */

export const leadAnalysisSchema = z.object({
  summary: z.string().describe("2–3 sentence research summary. Facts must come from the provided facts; mark inferences with words like 'likely'."),
  observed_facts: z.array(z.string()).describe("Facts restated from the input that support the recommendation."),
  inferences: z.array(z.string()).describe("Reasoned inferences (not facts), each phrased as an inference."),
  business_opportunity: z.string(),
  problem: z.string().describe("The specific digital problem observed."),
  why_contact: z.string(),
  recommended_service: z.string(),
  recommended_price: z.object({ min: z.number(), max: z.number(), currency: z.string(), rationale: z.string() }),
  potential_upsells: z.array(z.string()),
  sales_angle: z.string(),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  outreach_message: z.string().describe("Concise, friendly WhatsApp message (max ~90 words) referencing only provided facts. No invented compliments, numbers or claims."),
  email_subject: z.string(),
  data_gaps: z.array(z.string()).describe("Important facts that were unknown and should be verified before contact."),
});
export type LeadAnalysis = z.infer<typeof leadAnalysisSchema>;

export interface LeadFacts {
  business: string;
  category: string | null;
  location: string | null;
  facts: { label: string; value: string; source: string; confidence: string }[];
  websiteFindings: { label: string; detail: string; source: string; measured: boolean }[];
  opportunities: { type: string; reason: string; priceMin: number; priceMax: number }[];
  pricing: { packages: { name: string; min: number; max: number }[]; currency: string };
  senderCompany: string;
}

const SYSTEM = `You are a senior sales researcher at Ain AlTair, a web design and digital agency in the UAE.
You analyse one local business at a time and prepare an honest sales brief.

Rules:
- Use ONLY the facts provided. Never invent reviews, follower counts, owner names, awards, years in business or website problems.
- Keep observed facts and inferences separate. Phrase inferences as inferences ("likely", "suggests").
- If an important fact is unknown, list it under data_gaps instead of guessing.
- Prices must come from the provided pricing packages/opportunity ranges.
- The outreach message must be polite, specific and short, reference at most two observed facts, include no false urgency, and end with a soft question. Do not claim you visited their premises.
- Write in clear British English.`;

export function factsToPrompt(f: LeadFacts): string {
  return [
    `Business: ${f.business}`,
    `Category: ${f.category ?? "unknown"}`,
    `Location: ${f.location ?? "unknown"}`,
    "",
    "Verified facts (label: value — source, confidence):",
    ...f.facts.map((x) => `- ${x.label}: ${x.value} — ${x.source}, ${x.confidence}`),
    "",
    "Website findings:",
    ...(f.websiteFindings.length ? f.websiteFindings.map((w) => `- ${w.label}: ${w.detail} — ${w.source}${w.measured ? " (measured)" : ""}`) : ["- none recorded"]),
    "",
    "Rule-based opportunities already identified:",
    ...(f.opportunities.length ? f.opportunities.map((o) => `- ${o.type}: ${o.reason} (${o.priceMin}–${o.priceMax} ${f.pricing.currency})`) : ["- none"]),
    "",
    `Pricing packages (${f.pricing.currency}): ${f.pricing.packages.map((p) => `${p.name} ${p.min}–${p.max}`).join("; ")}`,
    `Sender: ${f.senderCompany}`,
  ].join("\n");
}

export async function analyseLead(f: LeadFacts): Promise<{ analysis: LeadAnalysis; model: string }> {
  const client = getAnthropic();
  if (!client) throw new AiUnavailableError();
  const response = await client.beta.messages.parse({
    model: AI_MODEL(),
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(leadAnalysisSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: factsToPrompt(f) }],
  });
  if (response.stop_reason === "refusal") throw new AiRefusalError(response.stop_details?.category ?? null);
  if (!response.parsed_output) throw new Error(`AI response could not be parsed (stop_reason: ${response.stop_reason})`);
  return { analysis: response.parsed_output, model: response.model };
}
