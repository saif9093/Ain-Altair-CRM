"use client";
import Link from "next/link";
import { useState } from "react";
import { useAction } from "@/components/client";
import { TierBadge } from "@/components/lead-bits";
import { updateStage } from "@/app/actions/leads";
import { human } from "@/lib/format";
import { cx } from "@/components/ui";

type Item = { id: string; name: string; tier: string | null; lead_score: number | null; area: string | null; city: string | null; recommended_service: string | null };

export function Board({ columns, canEdit }: { columns: { stage: string; items: Item[]; count: number }[]; canEdit: boolean }) {
  const [cols, setCols] = useState(columns);
  const [over, setOver] = useState<string | null>(null);
  const { run } = useAction();
  const move = (id: string, to: string) => {
    const from = cols.find((c) => c.items.some((i) => i.id === id));
    if (!from || from.stage === to) return;
    const item = from.items.find((i) => i.id === id)!;
    setCols((cs) => cs.map((c) => c.stage === from.stage ? { ...c, items: c.items.filter((i) => i.id !== id), count: c.count - 1 } : c.stage === to ? { ...c, items: [item, ...c.items], count: c.count + 1 } : c));
    const reason = to === "LOST" ? prompt("Why was it lost?") ?? undefined : undefined;
    run(() => updateStage(id, to, reason));
  };
  return (
    <div className="scroll-thin flex gap-3 overflow-x-auto pb-4">
      {cols.map((c) => (
        <div key={c.stage} onDragOver={(e) => { e.preventDefault(); setOver(c.stage); }} onDragLeave={() => setOver(null)} onDrop={(e) => { setOver(null); move(e.dataTransfer.getData("id"), c.stage); }}
          className={cx("w-72 shrink-0 rounded-2xl border bg-ink-2 p-2", over === c.stage ? "border-signal" : "border-line")}>
          <div className="flex items-center justify-between px-2 py-1.5"><span className="tag-mono text-[11px]">{human(c.stage)}</span><span className="text-xs text-mute">{c.count}</span></div>
          <div className="space-y-2">
            {c.items.map((i) => (
              <div key={i.id} draggable={canEdit} onDragStart={(e) => e.dataTransfer.setData("id", i.id)} className="cursor-grab rounded-xl border border-line bg-ink-3 p-3 text-sm active:cursor-grabbing">
                <Link href={`/leads/${i.id}`} className="font-medium hover:underline">{i.name}</Link>
                <div className="mt-1 flex items-center gap-2 text-xs text-mute"><TierBadge tier={i.tier} score={i.lead_score} />{i.area ?? i.city}</div>
                {i.recommended_service && <div className="mt-1 text-xs">→ {i.recommended_service}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
