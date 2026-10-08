import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { human, money } from "@/lib/format";

export const metadata = { title: "Analytics" };

export default async function Analytics({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const s = await requireUser("analytics.view");
  const sp = await searchParams;
  const db = await createClient();
  const { data: market } = await db.rpc("market_intelligence", { p_category: null, p_city: null, p_area: null });
  const rows = (market ?? []) as { category_key: string; category_label: string; city: string; discovered: number; qualified: number; pct_no_website: number; pct_poor_website: number; avg_rating: number; avg_reviews: number; pct_whatsapp: number; pct_instagram: number; opportunity_value: number | null; avg_score: number }[];
  const { data: coverage } = await db.from("search_coverage").select("location_label, category_key, searched_at").order("searched_at", { ascending: false }).limit(1000);
  const covMap = new Map<string, Set<string>>();
  for (const c of coverage ?? []) { if (!covMap.has(c.location_label ?? "?")) covMap.set(c.location_label ?? "?", new Set()); covMap.get(c.location_label ?? "?")!.add(c.category_key); }
  const { data: jobs } = await db.from("search_jobs").select("id, name, discovered_count, qualified_count, stats").in("status", ["COMPLETED", "PARTIALLY_COMPLETED"]).order("created_at", { ascending: false }).limit(50);
  const ja = jobs?.find((j) => j.id === sp.a); const jb = jobs?.find((j) => j.id === sp.b);
  const pricing = s.can("pricing.view");
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Insights" title="Market Intelligence" description="Aggregated from researched businesses only — a sample, not a market census." />
      <Card className="overflow-x-auto">
        <CardHeader eyebrow="By category & city" title="Market snapshot" />
        <table className="w-full text-sm">
          <thead className="tag-mono text-left text-[10.5px] text-mute"><tr className="border-b border-line">{["Market", "Sample", "Qualified", "No website", "Poor website", "Avg rating", "Avg reviews", "WhatsApp", "Instagram", "Avg score", ...(pricing ? ["Est. opportunity"] : [])].map((h) => <th key={h} className="px-4 py-2 font-normal">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i}><td className="px-4 py-2 font-medium">{(r.city ?? "Unknown").toUpperCase()} · {r.category_label ?? human(r.category_key)}</td><td className="px-4 py-2">{r.discovered}</td><td className="px-4 py-2">{r.qualified}</td><td className="px-4 py-2">{r.pct_no_website ?? 0}%</td><td className="px-4 py-2">{r.pct_poor_website ?? 0}%</td><td className="px-4 py-2">{r.avg_rating ?? "—"}</td><td className="px-4 py-2">{r.avg_reviews ?? "—"}</td><td className="px-4 py-2">{r.pct_whatsapp ?? 0}%</td><td className="px-4 py-2">{r.pct_instagram ?? 0}%</td><td className="px-4 py-2">{r.avg_score ?? "—"}</td>{pricing && <td className="px-4 py-2">{money(r.opportunity_value)}</td>}</tr>
            ))}
            {!rows.length && <tr><td colSpan={11} className="px-4 py-8 text-center text-mute">No research data yet.</td></tr>}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-dim">Methodology: percentages are over businesses discovered by your searches/imports in each category × city (sample size shown). Estimated values are rule-based estimates.</p>
      </Card>
      <Card>
        <CardHeader eyebrow="Coverage" title="Areas already searched" />
        <div className="grid gap-2 p-5 md:grid-cols-3">{[...covMap.entries()].map(([loc, cats]) => <div key={loc} className="rounded-xl bg-ink-2 p-3 text-sm"><b>{loc}</b> ✅<div className="text-xs text-mute">{[...cats].map((c) => human(c)).join(", ")}</div></div>)}{!covMap.size && <p className="text-sm text-mute">No coverage yet.</p>}</div>
      </Card>
      <Card>
        <CardHeader eyebrow="Search comparison" title="Compare two searches" />
        <form className="flex flex-wrap gap-2 px-5 pt-4">
          {["a", "b"].map((k) => <select key={k} name={k} defaultValue={(sp as Record<string, string>)[k]} className="h-10 rounded-xl border border-line-strong bg-ink-3 px-3 text-sm"><option value="">Choose search…</option>{(jobs ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select>)}
          <button className="h-10 rounded-full bg-paper px-5 text-sm text-white">Compare</button>
        </form>
        {ja && jb && (
          <table className="m-5 w-[calc(100%-2.5rem)] text-sm"><tbody className="divide-y divide-line">
            {[["Businesses found", "found"], ["Qualified", "qualified"], ["No website", "noWebsite"], ["Redesign", "redesign"], ["Website fixes", "fixes"], ["WhatsApp", "whatsapp"], ["HOT", "hot"], ["Avg score", "avgScore"]].map(([l, k]) => (
              <tr key={k}><td className="py-2 text-mute">{l}</td><td className="py-2 font-medium">{String((ja.stats as Record<string, unknown>)?.[k] ?? "—")}</td><td className="py-2 font-medium">{String((jb.stats as Record<string, unknown>)?.[k] ?? "—")}</td></tr>
            ))}
            <tr><td /><td className="pt-2 text-xs"><Link className="underline" href={`/searches/${ja.id}`}>{ja.name}</Link></td><td className="pt-2 text-xs"><Link className="underline" href={`/searches/${jb.id}`}>{jb.name}</Link></td></tr>
          </tbody></table>
        )}
      </Card>
    </div>
  );
}
