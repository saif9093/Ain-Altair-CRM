import { NotConfiguredError, providerFetch } from "./http";

/** Google PageSpeed Insights v5 (Lighthouse, mobile strategy) — measured performance only. */
const KEY = "pagespeed";

export interface PageSpeedResult {
  performanceScore: number | null;
  seoScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fetchedUrl: string | null;
}

interface PsiResponse {
  lighthouseResult?: {
    finalUrl?: string;
    categories?: Record<string, { score?: number | null }>;
    audits?: Record<string, { numericValue?: number }>;
  };
}

const pct = (v?: number | null) => (v == null ? null : Math.round(v * 100));

export async function runPageSpeed(url: string, rateLimitPerMinute?: number | null): Promise<PageSpeedResult> {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) throw new NotConfiguredError(KEY, ["PAGESPEED_API_KEY"]);
  const params = new URLSearchParams({ url, strategy: "mobile", key });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) params.append("category", c);
  const res = await providerFetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
    provider: KEY,
    timeoutMs: 90_000,
    retries: 1,
    rateLimitPerMinute,
  });
  const json = (await res.json()) as PsiResponse;
  const lh = json.lighthouseResult;
  return {
    performanceScore: pct(lh?.categories?.performance?.score),
    seoScore: pct(lh?.categories?.seo?.score),
    accessibilityScore: pct(lh?.categories?.accessibility?.score),
    bestPracticesScore: pct(lh?.categories?.["best-practices"]?.score),
    lcpMs: lh?.audits?.["largest-contentful-paint"]?.numericValue != null ? Math.round(lh.audits["largest-contentful-paint"].numericValue!) : null,
    cls: lh?.audits?.["cumulative-layout-shift"]?.numericValue ?? null,
    tbtMs: lh?.audits?.["total-blocking-time"]?.numericValue != null ? Math.round(lh.audits["total-blocking-time"].numericValue!) : null,
    fetchedUrl: lh?.finalUrl ?? null,
  };
}
