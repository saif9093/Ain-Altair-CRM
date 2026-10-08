import type { SupabaseClient } from "@supabase/supabase-js";
import { scoringConfigSchema, type ScoringConfig } from "@/lib/intel/scoring";
import { pricingConfigSchema, type PricingConfig } from "@/lib/intel/opportunities";
import { qualityGatesSchema, type QualityGates } from "@/lib/intel/qualification";
import type { ProviderRow } from "@/lib/providers/registry";

export interface OrgSettings {
  organisationId: string;
  scoring: ScoringConfig;
  scoringVersion: number;
  pricing: PricingConfig;
  gates: QualityGates;
  defaultCountry: string;
  currency: string;
  providers: ProviderRow[];
}

export async function loadOrgSettings(db: SupabaseClient, organisationId: string): Promise<OrgSettings> {
  const [{ data: s }, { data: org }, { data: providers }] = await Promise.all([
    db.from("org_settings").select("*").eq("organisation_id", organisationId).maybeSingle(),
    db.from("organisations").select("default_country_code, default_currency").eq("id", organisationId).maybeSingle(),
    db.from("providers").select("key, enabled, priority, config, rate_limit_per_minute, daily_quota, usage_today, usage_date").eq("organisation_id", organisationId),
  ]);
  return {
    organisationId,
    scoring: scoringConfigSchema.parse(s?.scoring_config ?? {}),
    scoringVersion: s?.scoring_version ?? 1,
    pricing: pricingConfigSchema.parse({ currency: org?.default_currency ?? "AED", ...(s?.pricing_config ?? {}) }),
    gates: qualityGatesSchema.parse(s?.quality_gates ?? {}),
    defaultCountry: org?.default_country_code ?? "AE",
    currency: org?.default_currency ?? "AED",
    providers: (providers ?? []) as ProviderRow[],
  };
}
