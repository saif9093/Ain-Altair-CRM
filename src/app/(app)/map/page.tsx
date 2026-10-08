import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { MapLoader } from "./map-loader";

export const metadata = { title: "Map" };

export default async function MapPage({ searchParams }: { searchParams: Promise<{ draw?: string; tier?: string }> }) {
  const s = await requireUser();
  const sp = await searchParams;
  const db = await createClient();
  let q = db.from("businesses").select("id, name, lat, lng, tier, lead_score, website_status, whatsapp_e164, category_label").in("lifecycle", ["ACTIVE"]).not("lat", "is", null).limit(5000);
  if (sp.tier) q = q.eq("tier", sp.tier);
  const { data } = await q;
  const { data: coverage } = s.can("search.view") ? await db.from("search_coverage").select("bbox, location_label, category_key, searched_at, result_count").limit(2000) : { data: [] };
  return (
    <div>
      <PageHeader eyebrow="Geography" title="Map" description="Leads clustered by location, with research coverage. Draw an area to search inside it." />
      <MapLoader leads={(data ?? []) as never} coverage={(coverage ?? []) as never} drawMode={sp.draw === "1"} canSearch={s.can("search.run")} />
    </div>
  );
}
