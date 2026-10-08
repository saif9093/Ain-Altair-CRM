"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "@/components/ui";
import type { NavItem } from "./nav";

export function Sidebar({ main, admin, user }: { main: NavItem[]; admin: NavItem[]; user: { name: string; role: string } }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const link = (i: NavItem) => {
    const active = path === i.href || (i.href !== "/admin" && path.startsWith(`${i.href}/`));
    return (
      <Link key={i.href} href={i.href} onClick={() => setOpen(false)}
        className={cx("group flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13.5px] transition-colors", active ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white")}>
        <span className={cx("h-1.5 w-1.5 rounded-[1px]", active ? "bg-signal" : "bg-white/20 group-hover:bg-white/40")} />
        {i.label}
      </Link>
    );
  };
  return (
    <>
      <button className="fixed left-3 top-3 z-50 rounded-full bg-navy px-3 py-1.5 text-xs text-white lg:hidden" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
      <aside className={cx("fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-navy text-white transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <Link href="/dashboard" className="flex items-center gap-3 px-5 pb-4 pt-6">
          <Image src="/brand/ainaltair-logo.png" alt="Ain AlTair" width={56} height={38} className="h-auto w-12 brightness-0 invert" />
          <div className="leading-tight">
            <div className="text-[13px] font-bold tracking-tight">AIN ALTAIR</div>
            <div className="tag-mono text-[9.5px] text-white/50">Lead Intelligence</div>
          </div>
        </Link>
        <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {main.map(link)}
          {admin.length > 0 && <div className="tag-mono px-3 pb-1 pt-5 text-[10px] text-white/40">Admin</div>}
          {admin.map(link)}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <div className="truncate text-[13px] font-medium">{user.name}</div>
          <div className="tag-mono text-[10px] text-white/50">{user.role.replace("_", " ")}</div>
        </div>
      </aside>
    </>
  );
}
