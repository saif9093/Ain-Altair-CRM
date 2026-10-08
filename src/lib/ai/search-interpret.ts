import { z } from "zod/v4";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, AiRefusalError, AiUnavailableError, FALLBACK_BETA, getAnthropic } from "./client";
import { DEFAULT_CATEGORIES } from "@/lib/categories/taxonomy";
import { BUSINESS_SIZES, OPPORTUNITY_TYPES, WEBSITE_FILTERS } from "@/lib/search/criteria";

/**
 * AI-assisted interpretation of a natural-language search. Output is shown to
 * the user next to the rule-based interpretation before anything runs.
 */
const interpretationSchema = z.object({
  categories: z.array(z.object({ key: z.string().nullable(), label: z.string(), terms: z.array(z.string()) })),
  locations: z.array(z.object({ label: z.string(), radius_km: z.number().nullable(), country_code: z.string().nullable(), split_into_sub_areas: z.boolean() })),
  min_rating: z.number().nullable(),
  min_reviews: z.number().nullable(),
  business_sizes: z.array(z.enum(BUSINESS_SIZES)),
  franchise: z.enum(["INCLUDE", "EXCLUDE", "PREFER", "ONLY"]),
  website: z.array(z.enum(WEBSITE_FILTERS)),
  instagram: z.enum(["ACTIVE", "INACTIVE", "PRESENT", "ANY"]),
  whatsapp: z.enum(["REQUIRED", "PREFERRED", "ANY"]),
  exclude_keywords: z.array(z.string()),
  opportunities: z.array(z.enum(OPPORTUNITY_TYPES)),
  min_opportunity_value: z.number().nullable(),
  target_count: z.number().nullable(),
  depth: z.enum(["FAST", "BALANCED", "DEEP"]),
  explanation: z.array(z.string()).describe("One line per interpreted constraint, quoting the phrase it came from."),
  assumptions: z.array(z.string()).describe("Anything assumed rather than stated."),
});
export type AiInterpretation = z.infer<typeof interpretationSchema>;

export async function interpretSearchWithAi(query: string, defaultCountry: string): Promise<AiInterpretation> {
  const client = getAnthropic();
  if (!client) throw new AiUnavailableError();
  const cats = DEFAULT_CATEGORIES.map((c) => `${c.key}: ${c.name} (${c.synonyms.slice(0, 6).join(", ")})`).join("\n");
  const response = await client.beta.messages.parse({
    model: AI_MODEL(),
    max_tokens: 8000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(interpretationSchema) },
    system: `You convert a sales researcher's request into structured lead-search criteria for a prospecting tool.
Only encode constraints the user actually expressed or clearly implied; record implications under assumptions.
Use a known category key when one fits, else key null with a custom label and 3–8 search terms.
Locations work worldwide; default country hint: ${defaultCountry}. "All businesses in <city>" → split_into_sub_areas true.
"Likely to pay X" → min_opportunity_value X and website opportunities; it is an estimate, say so in assumptions.
Known categories:\n${cats}`,
    messages: [{ role: "user", content: query }],
  });
  if (response.stop_reason === "refusal") throw new AiRefusalError(response.stop_details?.category ?? null);
  if (!response.parsed_output) throw new Error("AI interpretation could not be parsed");
  return response.parsed_output;
}
