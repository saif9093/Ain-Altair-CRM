"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CalendarClock, ChartColumn, ClipboardCheck, Download, Gauge, History, House, Layers, Map, MapPin, Menu, Plug, ScrollText, Search,
  Send, Settings, ShieldCheck, Sparkles, SquareKanban, Tags, Target, Upload, UserCheck, Users, X, Zap, type LucideIcon,
} from "lucide-react";
import { cx } from "@/components/ui";
import type { NavSection } from "./nav";

const ICONS: Record<string, LucideIcon> = {
  home: House, send: Send, target: Target, calendar: CalendarClock, kanban: SquareKanban, users: Users, search: Search, history: History,
  clipboard: ClipboardCheck, map: Map, zap: Zap, chart: ChartColumn, sparkles: Sparkles, upload: Upload, download: Download, gauge: Gauge,
  usercheck: UserCheck, shield: ShieldCheck, plug: Plug, tags: Tags, pin: MapPin, layers: Layers, scroll: ScrollText, settings: Settings,
};

export function Sidebar({ sections, user, badges }: { sections: NavSection[]; user: { name: string; role: string }; badges: Record<string, number> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button aria-label="Menu" className="fixed left-3 top-3 z-50 grid h-9 w-9 place-items-center rounded-full bg-navy text-white lg:hidden" onClick={() => setOpen(!open)}>{open ? <X size={16} /> : <Menu size={16} />}</button>
      {open && <div className="fixed inset-0 z-30 bg-paper/30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={cx("fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy text-white transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-[radial-gradient(80%_60%_at_100%_100%,rgba(232,70,31,.35),transparent)]" />
        <Link href="/dashboard" className="relative flex items-center gap-3 px-5 pb-5 pt-6">
          <Image src="/brand/ainaltair-logo.png" alt="Ain AlTair" width={56} height={38} className="h-auto w-11 brightness-0 invert" />
          <div className="leading-tight">
            <div className="text-[14px] font-extrabold tracking-tight">AIN ALTAIR</div>
            <div className="tag-mono text-[9.5px] text-white/50">Lead Intelligence</div>
          </div>
        </Link>
        <nav className="scroll-thin relative flex-1 overflow-y-auto px-3 pb-4">
          {sections.map((s) => (
            <div key={s.title || "root"} className="mb-3">
              {s.title && <div className="tag-mono px-3 pb-1.5 pt-2 text-[9.5px] text-white/35">{s.title}</div>}
              {s.items.map((i) => {
                const active = path === i.href || (i.href !== "/admin" && i.href !== "/dashboard" && path.startsWith(`${i.href}/`));
                const Icon = ICONS[i.icon] ?? House;
                const highlight = i.href === "/outreach";
                return (
                  <Link key={i.href} href={i.href} onClick={() => setOpen(false)}
                    className={cx("group mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] transition-all",
                      active ? "bg-white text-navy shadow-sm" : highlight ? "bg-signal/90 text-white hover:bg-signal" : "text-white/70 hover:bg-white/8 hover:text-white")}>
                    <Icon size={16} strokeWidth={2} className={cx(active ? "text-signal" : highlight ? "text-white" : "text-white/45 group-hover:text-white/80")} />
                    <span className="flex-1">{i.label}</span>
                    {!!badges[i.href] && <span className={cx("rounded-full px-1.5 text-[10.5px] font-semibold", active ? "bg-signal text-white" : "bg-white/15 text-white")}>{badges[i.href]}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="relative flex items-center gap-3 border-t border-white/10 px-5 py-4">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-signal text-sm font-bold">{user.name.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{user.name}</div>
            <div className="tag-mono text-[9.5px] text-white/50">{user.role === "SALES" ? "BDO / SALES" : user.role.replace("_", " ")}</div>
          </div>
        </div>
      </aside>
    </>
  );
}
