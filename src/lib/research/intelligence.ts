import type { SupabaseClient } from "@supabase/supabase-js";
import { subAreasOf, findPlace } from "@/lib/search/gazetteer";

/**
 * Search result intelligence + next-search recommendations. Stored on the job.
 * Deliberately contains NO monetary amounts: job rows are visible to every
 * user with search.view, while amounts are restricted to pricing.view and are
 * computed at render time from lead_pricing (RLS-protected).
 */
export interface JobStats {
  found: number;
  qualified: number;
  reviewRequired: number;
  rejected: number;
  approved: number;
  noWebsite: number;
  redesign: number;
  fixes: number;
  seo: number;
  whatsapp: number;
  instagram: number;
  phone: number;
  hot: number;
  high: number;
  newSinceLast: number;
  changed: number;
  avgScore: number | null;
  byCategory: Record<string, { label: string; found: number; qualified: number; noWebsite: number }>;
  byArea: Record<string, number>;
  rejectReasons: Record<string, number>;
}

export async function computeJobStats(db: SupabaseClient, jobId: string): Promise<JobStats> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("search_results")
      .select("stage, is_new, changes, reject_reason, category_key, businesses(website_status, website_issues, whatsapp_e164, phone_e164, lead_score, tier, area, city, category_label, business_socials(platform))")
      .eq("job_id", jobId).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const s: JobStats = { found: rows.length, qualified: 0, reviewRequired: 0, rejected: 0, approved: 0, noWebsite: 0, redesign: 0, fixes: 0, seo: 0, whatsapp: 0, instagram: 0, phone: 0, hot: 0, high: 0, newSinceLast: 0, changed: 0, avgScore: null, byCategory: {}, byArea: {}, rejectReasons: {} };
  let scoreSum = 0, scoreN = 0;
  for (const r of rows) {
    const b = (r.businesses ?? {}) as Record<string, unknown>;
    const stage = r.stage as string;
    if (stage === "QUALIFIED") s.qualified++;
    if (stage === "APPROVED") { s.approved++; s.qualified++; }
    if (stage === "REVIEW_REQUIRED") s.reviewRequired++;
    if (stage === "REJECTED") { s.rejected++; const rr = (r.reject_reason as string) ?? "OTHER"; s.rejectReasons[rr] = (s.rejectReasons[rr] ?? 0) + 1; }
    const ws = b.website_status as string;
    const issues = (b.website_issues ?? []) as string[];
    if (ws === "NO_WEBSITE") s.noWebsite++;
    if (ws === "OUTDATED" || ws === "POOR_DESIGN") s.redesign++;
    if (ws === "BROKEN" || ws === "MOBILE_ISSUE" || ws === "SLOW" || ws === "MISSING_FUNCTIONALITY") s.fixes++;
    if (issues.includes("WEAK_SEO")) s.seo++;
    if (b.whatsapp_e164) s.whatsapp++;
    if (b.phone_e164) s.phone++;
    if (((b.business_socials ?? []) as { platform: string }[]).some((x) => x.platform === "INSTAGRAM")) s.instagram++;
    if (b.tier === "HOT") s.hot++;
    if (b.tier === "HIGH") s.high++;
    if (r.is_new) s.newSinceLast++;
    if (((r.changes ?? []) as unknown[]).length) s.changed++;
    if (typeof b.lead_score === "number") { scoreSum += b.lead_score; scoreN++; }
    const ck = (r.category_key as string) ?? "uncategorised";
    s.byCategory[ck] ??= { label: (b.category_label as string) ?? ck, found: 0, qualified: 0, noWebsite: 0 };
    s.byCategory[ck].found++;
    if (stage === "QUALIFIED" || stage === "APPROVED") s.byCategory[ck].qualified++;
    if (ws === "NO_WEBSITE") s.byCategory[ck].noWebsite++;
    const area = (b.area as string) || (b.city as string) || "Unknown";
    s.byArea[area] = (s.byArea[area] ?? 0) + 1;
  }
  s.avgScore = scoreN ? Math.round((scoreSum / scoreN) * 10) / 10 : null;
  return s;
}

export interface Recommendation {
  text: string;
  location: string;
  categoryKey?: string;
  categoryLabel?: string;
}

/** Suggest neighbouring, not-yet-researched areas for strong categories. */
export async function recommendNextSearches(db: SupabaseClient, organisationId: string, stats: JobStats, locations: { label: string; city?: string | null }[]): Promise<Recommendation[]> {
  const recs: Recommendation[] = [];
  const strongCats = Object.entries(stats.byCategory).filter(([, v]) => v.found >= 5 && v.qualified / v.found >= 0.3).sort((a, b) => b[1].qualified - a[1].qualified).slice(0, 2);
  for (const [catKey, cat] of strongCats) {
    for (const loc of locations) {
      const place = findPlace(loc.label);
      const parent = place?.kind === "AREA" ? place.parent : loc.label;
      if (!parent) continue;
      const siblings = subAreasOf(parent).filter((s) => s.name !== loc.label);
      if (!siblings.length) continue;
      const { data: covered } = await db.from("search_coverage").select("location_label").eq("organisation_id", organisationId).eq("category_key", catKey);
      const done = new Set((covered ?? []).map((c) => c.location_label));
      const todo = siblings.filter((s) => !done.has(s.name)).slice(0, 3);
      if (!todo.length) continue;
      const qualifiedPct = Math.round((cat.qualified / cat.found) * 100);
      for (const t of todo) {
        recs.push({
          text: `${cat.label} in ${loc.label} qualified at ${qualifiedPct}%. ${t.name} has not been researched for ${cat.label.toLowerCase()} yet.`,
          location: t.name,
          categoryKey: catKey.startsWith("custom:") ? undefined : catKey,
          categoryLabel: cat.label,
        });
      }
    }
  }
  return recs.slice(0, 6);
}
