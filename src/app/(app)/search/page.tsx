import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CATEGORIES } from "@/lib/categories/taxonomy";
import { PROVIDER_CATALOG } from "@/lib/providers/catalog";
import { providerState, type ProviderRow } from "@/lib/providers/registry";
import { isAiConfigured } from "@/lib/ai/client";
import { loadOrgSettings } from "@/lib/research/settings";
import { SearchBuilder } from "./search-builder";

export const metadata = { title: "Lead Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ template?: string; q?: string; location?: string; category?: string; polygon?: string }> }) {
  const s = await requireUser("search.run");
  const sp = await searchParams;
  const db = await createClient();
  const settings = await loadOrgSettings(createAdminClient(), s.organisationId);
  const { data: orgCats } = await db.from("categories").select("key, name, synonyms").eq("organisation_id", s.organisationId).eq("is_active", true);
  const categories = [...DEFAULT_CATEGORIES.map((c) => ({ key: c.key, name: c.name, synonyms: c.synonyms })), ...(orgCats ?? [])];
  const providers = PROVIDER_CATALOG.filter((p) => p.kind === "DISCOVERY").map((p) => ({
    key: p.key, name: p.name, description: p.description,
    state: providerState(settings.providers.find((r) => r.key === p.key) as ProviderRow | undefined, p.key),
  }));
  const enrichment = ["brave_search", "pagespeed", "apify_instagram", "anthropic"].map((k) => ({ key: k, name: PROVIDER_CATALOG.find((p) => p.key === k)!.name, state: providerState(settings.providers.find((r) => r.key === k) as ProviderRow | undefined, k) }));
  let template: unknown = null;
  if (sp.template) {
    const { data } = await db.from("searches").select("id, name, criteria").eq("id", sp.template).maybeSingle();
    template = data;
  }
  let polygon: { lat: number; lng: number }[] | null = null;
  try { polygon = sp.polygon ? JSON.parse(sp.polygon) : null; } catch { polygon = null; }
  return (
    <SearchBuilder categories={categories} providers={providers} enrichment={enrichment} aiConfigured={isAiConfigured()} defaultCountry={settings.defaultCountry}
      template={template as { id: string; name: string; criteria: unknown } | null} initialQuery={sp.q ?? ""} prefill={{ location: sp.location, category: sp.category, polygon }} canSchedule={s.can("search.schedule")} />
  );
}
