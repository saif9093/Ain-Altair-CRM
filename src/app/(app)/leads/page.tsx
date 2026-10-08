import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { queryLeads, type LeadFilters } from "@/lib/leads/query";
import { SimpleLeads } from "./simple-leads";

export const metadata = { title: "Leads" };

const TABS: Record<string, Partial<LeadFilters>> = {
  all: {},
  new: { stage: "NOT_CONTACTED" },
  followup: { followup: "today" },
  talking: { stage: "CONTACTED,REPLIED" },
  interested: { stage: "INTERESTED,MEETING,QUOTE_SENT" },
  won: { stage: "WON" },
  lost: { stage: "LOST" },
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadFilters & { tab?: string }> }) {
  const s = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab && TABS[sp.tab] ? sp.tab : "all";
  const db = await createClient();
  const filters: LeadFilters = { ...sp, ...TABS[tab], per: "50" };
  const { rows, count, page, per } = await queryLeads(db, filters, s.userId);
  const counts = Object.fromEntries(await Promise.all(Object.entries(TABS).map(async ([k, f]) => {
    const { count: c } = await queryLeads(db, { owner: sp.owner, q: sp.q, ...f, per: "1" }, s.userId, { columns: "id" });
    return [k, c] as const;
  })));
  const { data: users } = s.can("leads.assign") ? await db.from("profiles").select("id, full_name, email").eq("status", "ACTIVE").order("full_name") : { data: [] };
  return (
    <SimpleLeads rows={rows as never} count={count} page={page} per={per} tab={tab} counts={counts} q={sp.q ?? ""} owner={sp.owner ?? ""} users={users ?? []}
      canAssign={s.can("leads.assign")} canEdit={s.can("leads.edit")} canExport={s.can("exports.run")} canAdd={s.can("imports.run") || s.can("search.run")} />
  );
}
