import type { PermissionKey } from "@/lib/auth/permissions";

export interface NavItem { href: string; label: string; icon: string; perm?: PermissionKey; anyOf?: PermissionKey[]; hint?: string }
export interface NavSection { title: string; items: NavItem[] }

const LEADS: PermissionKey[] = ["leads.view_own", "leads.view_team", "leads.view_all"];

export const NAV: NavSection[] = [
  { title: "", items: [{ href: "/dashboard", label: "Home", icon: "home" }] },
  {
    title: "Sell",
    items: [
      { href: "/outreach", label: "Start outreach", icon: "send", perm: "outreach.log", hint: "One lead at a time" },
      { href: "/prospects", label: "Today's prospects", icon: "target", anyOf: LEADS },
      { href: "/follow-ups", label: "Follow-ups", icon: "calendar", perm: "outreach.log" },
      { href: "/pipeline", label: "Pipeline", icon: "kanban", anyOf: LEADS },
      { href: "/leads", label: "Leads", icon: "users", anyOf: LEADS },
    ],
  },
  {
    title: "Find",
    items: [
      { href: "/search", label: "Lead search", icon: "search", perm: "search.run" },
      { href: "/searches", label: "Search history", icon: "history", perm: "search.view" },
      { href: "/research", label: "Research queue", icon: "clipboard", perm: "research.review" },
      { href: "/map", label: "Map", icon: "map", anyOf: LEADS },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/opportunities", label: "Opportunities", icon: "zap", anyOf: ["leads.view_team", "leads.view_all"] },
      { href: "/analytics", label: "Analytics", icon: "chart", perm: "analytics.view" },
      { href: "/assistant", label: "AI assistant", icon: "sparkles", perm: "assistant.use" },
    ],
  },
  {
    title: "Data",
    items: [
      { href: "/imports", label: "Imports", icon: "upload", perm: "imports.run" },
      { href: "/exports", label: "Exports", icon: "download", perm: "exports.run" },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/admin", label: "Overview", icon: "gauge", anyOf: ["admin.users", "admin.approvals"] },
      { href: "/admin/users", label: "Users & teams", icon: "usercheck", perm: "admin.users" },
      { href: "/admin/approvals", label: "Approvals", icon: "shield", perm: "admin.approvals" },
      { href: "/admin/providers", label: "Providers", icon: "plug", perm: "admin.providers" },
      { href: "/admin/categories", label: "Categories", icon: "tags", perm: "admin.categories" },
      { href: "/admin/locations", label: "Locations", icon: "pin", perm: "admin.locations" },
      { href: "/admin/scoring", label: "Scoring", icon: "layers", perm: "admin.scoring" },
      { href: "/admin/audit-logs", label: "Audit logs", icon: "scroll", perm: "admin.audit" },
      { href: "/admin/settings", label: "Settings", icon: "settings", perm: "admin.settings" },
    ],
  },
];

export function visibleSections(can: (p: PermissionKey) => boolean): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => (!i.perm || can(i.perm)) && (!i.anyOf || i.anyOf.some(can))) })).filter((s) => s.items.length);
}
