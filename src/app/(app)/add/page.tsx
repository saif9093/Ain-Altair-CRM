import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { providerState, type ProviderRow } from "@/lib/providers/registry";
import { loadOrgSettings } from "@/lib/research/settings";
import { AddLeads } from "./add-leads";

export const metadata = { title: "Add leads" };

export default async function AddPage() {
  const s = await requireUser();
  const db = await createClient();
  const settings = await loadOrgSettings(createAdminClient(), s.organisationId);
  const canFind = s.can("search.run");
  const findReady = ["apify_google_maps", "google_places", "osm_overpass"].some((k) => providerState(settings.providers.find((p) => p.key === k) as ProviderRow | undefined, k) === "READY");
  const [{ count: research }, { data: users }] = await Promise.all([
    s.can("research.approve") ? db.from("businesses").select("id", { count: "exact", head: true }).eq("lifecycle", "RESEARCH") : Promise.resolve({ count: 0 }),
    s.can("leads.assign") ? db.from("profiles").select("id, full_name, email").eq("status", "ACTIVE").order("full_name") : Promise.resolve({ data: [] }),
  ]);
  return <AddLeads canImport={s.can("imports.run")} canFind={canFind && findReady} research={research ?? 0} users={users ?? []} />;
}
