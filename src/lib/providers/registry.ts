import { apifyGoogleMapsProvider, apifyInstagramProvider } from "./apify";
import { braveSearchProvider } from "./brave";
import { catalogEntry, isProviderConfigured, missingEnv, PROVIDER_CATALOG } from "./catalog";
import { googlePlacesProvider } from "./google-places";
import { overpassProvider } from "./overpass";
import type { LeadProvider } from "./types";

/** Adapter registry. Adding a provider = implementing LeadProvider + a catalog entry. */
const ADAPTERS: Record<string, LeadProvider> = {
  google_places: googlePlacesProvider,
  apify_google_maps: apifyGoogleMapsProvider,
  osm_overpass: overpassProvider,
  brave_search: braveSearchProvider,
  apify_instagram: apifyInstagramProvider,
};

export function getAdapter(key: string): LeadProvider | undefined {
  return ADAPTERS[key];
}

export interface ProviderRow {
  key: string;
  enabled: boolean;
  priority: number;
  config: Record<string, unknown> | null;
  rate_limit_per_minute: number | null;
  daily_quota: number | null;
  usage_today: number;
  usage_date: string | null;
}

export type ProviderState = "READY" | "NOT_CONFIGURED" | "DISABLED" | "QUOTA_EXHAUSTED";

export function providerState(row: ProviderRow | undefined, key: string, today = new Date().toISOString().slice(0, 10)): ProviderState {
  if (!isProviderConfigured(key)) return "NOT_CONFIGURED";
  if (row && !row.enabled) return "DISABLED";
  if (row?.daily_quota != null && row.usage_date === today && row.usage_today >= row.daily_quota) return "QUOTA_EXHAUSTED";
  return "READY";
}

/**
 * Choose discovery providers for a search: the requested ones (or all), that
 * are configured, enabled and within quota, ordered primary → fallback.
 * Returns the skipped ones with reasons so the UI can show exactly what ran.
 */
export function selectDiscoveryProviders(rows: ProviderRow[], requested: string[] = []) {
  const discovery = PROVIDER_CATALOG.filter((p) => p.kind === "DISCOVERY" && ADAPTERS[p.key]?.searchBusinesses);
  const chosen: { key: string; priority: number; row?: ProviderRow }[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const p of discovery) {
    if (requested.length && !requested.includes(p.key)) continue;
    const row = rows.find((r) => r.key === p.key);
    const st = providerState(row, p.key);
    if (st === "READY") chosen.push({ key: p.key, priority: row?.priority ?? p.defaultPriority, row });
    else skipped.push({ key: p.key, reason: st === "NOT_CONFIGURED" ? `Not configured (missing ${missingEnv(p.key).join(", ")})` : st === "DISABLED" ? "Disabled by admin" : "Daily quota reached" });
  }
  chosen.sort((a, b) => a.priority - b.priority);
  return { chosen, skipped };
}

export function enrichmentAvailability(rows: ProviderRow[]) {
  const ready = (key: string) => providerState(rows.find((r) => r.key === key), key) === "READY";
  return {
    webSearch: ready("brave_search"),
    instagramMetrics: ready("apify_instagram"),
    pageSpeed: ready("pagespeed"),
    ai: ready("anthropic"),
    websiteAudit: providerState(rows.find((r) => r.key === "website_audit"), "website_audit") === "READY",
  };
}

export { catalogEntry };
