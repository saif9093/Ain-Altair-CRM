import type { PermissionKey } from "@/lib/auth/permissions";

export interface NavItem { href: string; label: string; icon: string; perm?: PermissionKey; anyOf?: PermissionKey[]; hint?: string }
export interface NavSection { title: string; items: NavItem[] }

const LEADS: PermissionKey[] = ["leads.view_own", "leads.view_team", "leads.view_all"];

/** Deliberately small: the daily loop only. Power tools live under Settings → Advanced. */
export const NAV: NavSection[] = [
  {
    title: "",
    items: [
      { href: "/dashboard", label: "Home", icon: "home" },
      { href: "/outreach", label: "Today", icon: "send", perm: "outreach.log", hint: "Who to contact now" },
      { href: "/leads", label: "Leads", icon: "users", anyOf: LEADS },
      { href: "/add", label: "Add leads", icon: "plus", anyOf: ["imports.run", "search.run"] },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/admin/users", label: "Team", icon: "usercheck", perm: "admin.users" },
      { href: "/admin", label: "Settings", icon: "settings", anyOf: ["admin.users", "admin.approvals", "admin.providers", "admin.settings"] },
    ],
  },
];

export function visibleSections(can: (p: PermissionKey) => boolean): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => (!i.perm || can(i.perm)) && (!i.anyOf || i.anyOf.some(can))) })).filter((s) => s.items.length);
}
