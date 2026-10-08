import Anthropic from "@anthropic-ai/sdk";
import { anthropicModel } from "@/lib/env";

/**
 * Claude client (server only). Returns null when ANTHROPIC_API_KEY is not
 * configured so callers can show "NOT CONFIGURED" instead of faking output.
 *
 * Requests opt into server-side refusal fallbacks (`fallbacks: "default"`), so
 * a request declined by a safety classifier is retried on Anthropic's
 * recommended fallback model instead of failing.
 */
let client: Anthropic | null = null;

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAnthropic(): Anthropic | null {
  if (!isAiConfigured()) return null;
  if (!client) client = new Anthropic({ maxRetries: 3, timeout: 120_000 });
  return client;
}

export const AI_MODEL = () => anthropicModel();
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AiUnavailableError extends Error {
  constructor(message = "AI is not configured (set ANTHROPIC_API_KEY)") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export class AiRefusalError extends Error {
  constructor(public readonly category: string | null) {
    super(`The AI model declined this request${category ? ` (${category})` : ""}`);
    this.name = "AiRefusalError";
  }
}
