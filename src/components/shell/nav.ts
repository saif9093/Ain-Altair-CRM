import type { PermissionKey } from "@/lib/auth/permissions";

export interface NavItem { href: string; label: string; perm?: PermissionKey; anyOf?: PermissionKey[] }

export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/search", label: "Lead Search", perm: "search.run" },
  { href: "/searches", label: "Search History", perm: "search.view" },
  { href: "/prospects", label: "Today's Prospects", anyOf: ["leads.view_own", "leads.view_team", "leads.view_all"] },
  { href: "/leads", label: "Leads", anyOf: ["leads.view_own", "leads.view_team", "leads.view_all"] },
  { href: "/opportunities", label: "Opportunities", anyOf: ["leads.view_own", "leads.view_team", "leads.view_all"] },
  { href: "/pipeline", label: "Pipeline", anyOf: ["leads.view_own", "leads.view_team", "leads.view_all"] },
  { href: "/follow-ups", label: "Follow-ups", perm: "outreach.log" },
  { href: "/research", label: "Research Queue", perm: "research.review" },
  { href: "/map", label: "Map", anyOf: ["leads.view_own", "leads.view_team", "leads.view_all"] },
  { href: "/analytics", label: "Analytics", perm: "analytics.view" },
  { href: "/assistant", label: "AI Assistant", perm: "assistant.use" },
  { href: "/imports", label: "Imports", perm: "imports.run" },
  { href: "/exports", label: "Exports", perm: "exports.run" },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", anyOf: ["admin.users", "admin.approvals"] },
  { href: "/admin/users", label: "Users", perm: "admin.users" },
  { href: "/admin/approvals", label: "Approvals", perm: "admin.approvals" },
  { href: "/admin/providers", label: "Providers", perm: "admin.providers" },
  { href: "/admin/categories", label: "Categories", perm: "admin.categories" },
  { href: "/admin/locations", label: "Locations", perm: "admin.locations" },
  { href: "/admin/scoring", label: "Scoring", perm: "admin.scoring" },
  { href: "/admin/audit-logs", label: "Audit Logs", perm: "admin.audit" },
  { href: "/admin/settings", label: "Settings", perm: "admin.settings" },
];

export function visible(items: NavItem[], can: (p: PermissionKey) => boolean) {
  return items.filter((i) => (!i.perm || can(i.perm)) && (!i.anyOf || i.anyOf.some(can)));
}
