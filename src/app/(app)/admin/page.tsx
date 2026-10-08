import Link from "next/link";
import { BarChart3, CalendarClock, ClipboardCheck, Download, Gauge, History, Layers, Map, MapPin, Plug, ScrollText, Search, Settings, ShieldCheck, Sparkles, SquareKanban, Tags, Upload, UserCheck, Zap } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import type { PermissionKey } from "@/lib/auth/permissions";

export const metadata = { title: "Settings" };

const MAIN: { href: string; label: string; desc: string; icon: React.ReactNode; perm: PermissionKey }[] = [
  { href: "/admin/users", label: "Team", desc: "Add people, approve sign-ups, roles and permissions", icon: <UserCheck size={18} />, perm: "admin.users" },
  { href: "/admin/approvals", label: "Approvals", desc: "Big imports, bulk changes and role changes waiting for you", icon: <ShieldCheck size={18} />, perm: "admin.approvals" },
  { href: "/admin/providers", label: "Data sources", desc: "Google Maps / Apify connection and usage", icon: <Plug size={18} />, perm: "admin.providers" },
];
const ADVANCED: { href: string; label: string; icon: React.ReactNode; perm?: PermissionKey }[] = [
  { href: "/search", label: "Advanced lead search", icon: <Search size={16} />, perm: "search.run" },
  { href: "/searches", label: "Search history", icon: <History size={16} />, perm: "search.view" },
  { href: "/research", label: "Research queue", icon: <ClipboardCheck size={16} />, perm: "research.review" },
  { href: "/pipeline", label: "Pipeline board", icon: <SquareKanban size={16} /> },
  { href: "/follow-ups", label: "All follow-ups", icon: <CalendarClock size={16} />, perm: "outreach.log" },
  { href: "/opportunities", label: "Opportunities", icon: <Zap size={16} />, perm: "leads.view_team" },
  { href: "/analytics", label: "Analytics", icon: <BarChart3 size={16} />, perm: "analytics.view" },
  { href: "/map", label: "Map", icon: <Map size={16} /> },
  { href: "/assistant", label: "AI assistant", icon: <Sparkles size={16} />, perm: "assistant.use" },
  { href: "/imports", label: "Import history", icon: <Upload size={16} />, perm: "imports.run" },
  { href: "/exports", label: "Exports", icon: <Download size={16} />, perm: "exports.run" },
  { href: "/admin/categories", label: "Categories", icon: <Tags size={16} />, perm: "admin.categories" },
  { href: "/admin/locations", label: "Locations", icon: <MapPin size={16} />, perm: "admin.locations" },
  { href: "/admin/scoring", label: "Scoring & pricing", icon: <Layers size={16} />, perm: "admin.scoring" },
  { href: "/admin/audit-logs", label: "Audit log", icon: <ScrollText size={16} />, perm: "admin.audit" },
  { href: "/admin/settings", label: "System", icon: <Settings size={16} />, perm: "admin.settings" },
  { href: "/admin/overview", label: "System health", icon: <Gauge size={16} />, perm: "admin.users" },
];

export default async function SettingsHub() {
  const s = await requireUser();
  const db = await createClient();
  const { count: approvals } = s.can("admin.approvals") ? await db.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "PENDING") : { count: 0 };
  const { count: pendingUsers } = s.can("admin.users") ? await db.from("profiles").select("id", { count: "exact", head: true }).eq("status", "PENDING") : { count: 0 };
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader eyebrow="Admin" title="Settings" />
      <div className="grid gap-4 md:grid-cols-3">
        {MAIN.filter((m) => s.can(m.perm)).map((m) => (
          <Link key={m.href} href={m.href}>
            <Card className="h-full p-5 transition hover:-translate-y-0.5 hover:border-line-strong">
              <div className="flex items-center justify-between"><div className="grid h-10 w-10 place-items-center rounded-xl bg-navy-tint text-navy">{m.icon}</div>
                {m.href === "/admin/users" && !!pendingUsers && <span className="rounded-full bg-signal px-2 text-xs font-bold text-white">{pendingUsers} waiting</span>}
                {m.href === "/admin/approvals" && !!approvals && <span className="rounded-full bg-signal px-2 text-xs font-bold text-white">{approvals}</span>}
              </div>
              <div className="mt-3 font-semibold">{m.label}</div><div className="text-sm text-mute">{m.desc}</div>
            </Card>
          </Link>
        ))}
      </div>
      <div>
        <div className="eyebrow mb-3">Advanced tools</div>
        <p className="mb-3 text-sm text-mute">You don&apos;t need these day to day. They&apos;re here when you want deeper research or reporting.</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {ADVANCED.filter((a) => !a.perm || s.can(a.perm)).map((a) => (
            <Link key={a.href} href={a.href} className="flex items-center gap-2 rounded-xl border border-line bg-ink-3 px-3 py-2.5 text-sm hover:border-paper">{a.icon}{a.label}</Link>
          ))}
        </div>
      </div>
    </div>
  );
}
