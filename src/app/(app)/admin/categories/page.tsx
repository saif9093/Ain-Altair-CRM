import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { CategoryForm } from "./category-form";

export const metadata = { title: "Categories" };

export default async function Categories() {
  await requireUser("admin.categories");
  const db = await createClient();
  const { data } = await db.from("categories").select("*").order("name");
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin" title="Categories" description="Synonyms drive search expansion; exclusions act as default negative keywords; value multiplier feeds the sales-intent estimate." />
      <Card><CardHeader title="Add / override a category" /><div className="p-5"><CategoryForm /></div></Card>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm"><tbody className="divide-y divide-line">
          {(data ?? []).map((c) => <tr key={c.id}><td className="px-4 py-2 font-medium">{c.name}<div className="font-mono text-[10px] text-dim">{c.key}{c.organisation_id ? " · custom" : " · default"}</div></td><td className="px-4 py-2 text-xs text-mute">{c.synonyms.join(", ")}</td><td className="px-4 py-2 text-xs">×{c.value_multiplier}</td></tr>)}
        </tbody></table>
      </Card>
    </div>
  );
}
