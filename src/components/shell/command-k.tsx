"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui";
import { TIER_TONE } from "@/lib/format";

interface Hit { id: string; lead_code: string; name: string; category_label: string | null; city: string | null; area: string | null; lifecycle: string; tier: string | null; lead_score: number | null; matched_on: string }

/** CMD/CTRL+K global search over business, phone, email, website, Instagram, area, category, lead ID and tags. */
export function CommandK() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 10); }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }).catch(() => null);
      if (r?.ok) { setHits(await r.json()); setActive(0); }
    }, 200); // debounced
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const go = (h: Hit) => { setOpen(false); setQ(""); router.push(h.lifecycle === "RESEARCH" ? `/leads/${h.id}?research=1` : `/leads/${h.id}`); };

  return (
    <>
      <button onClick={() => setOpen(true)} className="focus-ring flex h-10 w-full max-w-md items-center gap-2 rounded-full border border-line-strong bg-ink-3 px-4 text-sm text-dim shadow-sm hover:border-paper">
        <SearchIcon size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Search leads, phone, website, @instagram…</span>
        <span className="tag-mono hidden shrink-0 rounded border border-line px-1.5 text-[10px] sm:inline">⌘K</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-paper/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-ink-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
                if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
                if (e.key === "Enter" && hits[active]) go(hits[active]);
              }}
              className="h-14 w-full border-b border-line bg-transparent px-5 text-base outline-none" />
            <div className="max-h-[50vh] overflow-y-auto">
              {hits.map((h, i) => (
                <button key={h.id} onClick={() => go(h)} onMouseEnter={() => setActive(i)} className={`flex w-full items-center justify-between gap-3 px-5 py-3 text-left ${i === active ? "bg-ink-2" : ""}`}>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{h.name}</div>
                    <div className="truncate text-xs text-mute">{h.lead_code} · {[h.category_label, h.area ?? h.city].filter(Boolean).join(" · ")} · matched on {h.matched_on}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {h.lifecycle === "RESEARCH" && <Badge tone="warn">Research</Badge>}
                    {h.tier && <Badge tone={TIER_TONE[h.tier]}>{h.tier} {h.lead_score}</Badge>}
                  </div>
                </button>
              ))}
              {q.length >= 2 && !hits.length && <div className="px-5 py-6 text-sm text-mute">No matches.</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
