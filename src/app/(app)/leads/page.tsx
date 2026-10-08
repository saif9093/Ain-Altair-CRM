import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { queryLeads, type LeadFilters } from "@/lib/leads/query";
import { DEFAULT_CATEGORIES } from "@/lib/categories/taxonomy";
import { PageHeader } from "@/components/ui";
import { LeadsView } from "./leads-view";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadFilters & { view?: string }> }) {
  const s = await requireUser();
  const f = await searchParams;
  const db = await createClient();
  const { rows, count, page, per } = await queryLeads(db, f, s.userId);
  const [{ data: users }, { data: teams }, { data: saved }] = await Promise.all([
    db.from("profiles").select("id, full_name, email").eq("status", "ACTIVE").order("full_name"),
    db.from("teams").select("id, name").order("name"),
    db.from("saved_filters").select("id, name, filters").eq("scope", "leads").order("name"),
  ]);
  return (
    <div>
      <PageHeader eyebrow="CRM" title="Leads" description={`${count.toLocaleString()} leads match your filters.`} actions={<Link href="/exports" className="text-sm underline">Export</Link>} />
      <LeadsView rows={rows as never} count={count} page={page} per={per} filters={f} view={f.view ?? "table"} users={users ?? []} teams={teams ?? []} saved={(saved ?? []) as never}
        categories={DEFAULT_CATEGORIES.map((c) => ({ key: c.key, name: c.name }))}
        perms={{ assign: s.can("leads.assign"), bulk: s.can("leads.bulk"), archive: s.can("leads.archive"), edit: s.can("leads.edit"), followup: s.can("outreach.log"), create: s.can("leads.create"), rescore: s.can("leads.edit") }} />
    </div>
  );
}
