import type { Tone } from "@/components/ui";

export const STAGES = ["NOT_CONTACTED", "CONTACTED", "REPLIED", "INTERESTED", "MEETING", "QUOTE_SENT", "WON", "LOST"] as const;
export type Stage = (typeof STAGES)[number];

export const human = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—");

export const TIER_TONE: Record<string, Tone> = { HOT: "signal", HIGH: "dark", GOOD: "navy", MEDIUM: "neutral", LOW: "neutral" };

export const WEBSITE_TONE: Record<string, Tone> = {
  NO_WEBSITE: "signal", BROKEN: "signal", OUTDATED: "warn", MOBILE_ISSUE: "warn", SLOW: "warn", POOR_DESIGN: "warn",
  MISSING_FUNCTIONALITY: "warn", AVERAGE: "neutral", GOOD: "ok", HIGH_QUALITY: "ok", UNKNOWN: "neutral",
};

export const JOB_TONE: Record<string, Tone> = {
  QUEUED: "neutral", RUNNING: "navy", ENRICHING: "navy", AUDITING: "navy", DEDUPLICATING: "navy", SCORING: "navy",
  COMPLETED: "ok", PARTIALLY_COMPLETED: "warn", FAILED: "signal", CANCELLED: "neutral",
};

export const STAGE_TONE: Record<string, Tone> = {
  RAW: "neutral", ENRICHING: "navy", QUALIFIED: "ok", REVIEW_REQUIRED: "warn", REJECTED: "neutral", APPROVED: "dark",
};

export const CONF_TONE: Record<string, Tone> = { HIGH: "ok", MEDIUM: "navy", LOW: "warn", UNKNOWN: "neutral" };

export function fmtDate(d: string | null | undefined, withTime = false) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}), timeZone: "Asia/Dubai" });
}

export function fmtRelative(d: string | null | undefined) {
  if (!d) return "—";
  const diff = (Date.now() - Date.parse(d)) / 1000;
  const abs = Math.abs(diff);
  const unit = abs < 60 ? ["s", 1] : abs < 3600 ? ["m", 60] : abs < 86400 ? ["h", 3600] : ["d", 86400];
  const n = Math.round(abs / (unit[1] as number));
  return diff >= 0 ? `${n}${unit[0]} ago` : `in ${n}${unit[0]}`;
}

export function fmtElapsed(start: string | null, end?: string | null) {
  if (!start) return "—";
  const s = Math.max(0, Math.round(((end ? Date.parse(end) : Date.now()) - Date.parse(start)) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function money(v: number | null | undefined, currency = "AED") {
  if (v == null) return "—";
  return `${currency} ${Math.round(v).toLocaleString("en-US")}`;
}
