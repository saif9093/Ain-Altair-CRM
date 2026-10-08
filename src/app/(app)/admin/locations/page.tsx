import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { human } from "@/lib/format";

export const metadata = { title: "Locations" };

export default async function Locations() {
  await requireUser("admin.locations");
  const db = await createClient();
  const { data } = await db.from("locations").select("id, name, display_name, kind, country_code, source, created_at").order("created_at", { ascending: false }).limit(300);
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Locations" description="Geocoded places cached from searches (OpenStreetMap Nominatim). Draw custom territories from the Map page." />
      <Card><ul className="divide-y divide-line text-sm">{(data ?? []).map((l) => <li key={l.id} className="flex justify-between px-5 py-2"><span><b>{l.name}</b> <span className="text-xs text-mute">{l.display_name}</span></span><span className="text-xs text-mute">{human(l.kind)} · {l.country_code} · {l.source}</span></li>)}{!data?.length && <li className="px-5 py-6 text-mute">No locations cached yet.</li>}</ul></Card>
    </div>
  );
}
