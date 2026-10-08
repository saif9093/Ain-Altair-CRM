/**
 * Granular permission model. This file is the single source of truth for the
 * role → permission matrix; `supabase/migrations/*_reference_data.sql` is
 * generated from it (`npx tsx scripts/gen-permissions-sql.ts`) and a test
 * asserts the two never drift apart.
 *
 * UI checks use this matrix for display only — the database (RLS + has_perm)
 * and server actions enforce it independently.
 */

export const ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES", "RESEARCHER", "VIEWER"] as const;
export type RoleKey = (typeof ROLES)[number];

export const ROLE_META: Record<RoleKey, { name: string; description: string; rank: number }> = {
  SUPER_ADMIN: { name: "Super Admin", description: "Full system control, approvals and permanent deletion.", rank: 100 },
  ADMIN: { name: "Admin", description: "Manages users, providers, scoring and configuration.", rank: 80 },
  MANAGER: { name: "Manager", description: "Leads the sales team; sees team leads, assigns and approves research.", rank: 60 },
  SALES: { name: "Sales", description: "Works their own leads: outreach, notes and follow-ups.", rank: 40 },
  RESEARCHER: { name: "Researcher", description: "Runs lead searches, reviews research and imports data.", rank: 40 },
  VIEWER: { name: "Viewer", description: "Read-only access to team leads and analytics.", rank: 10 },
};

export const PERMISSIONS = {
  "leads.view_own": { category: "Leads", description: "View leads assigned to me" },
  "leads.view_team": { category: "Leads", description: "View my team's leads and unassigned leads" },
  "leads.view_all": { category: "Leads", description: "View every lead in the organisation" },
  "leads.create": { category: "Leads", description: "Create leads manually" },
  "leads.edit": { category: "Leads", description: "Edit lead details and pipeline stage" },
  "leads.assign": { category: "Leads", description: "Assign leads to users and teams" },
  "leads.archive": { category: "Leads", description: "Archive (soft delete) leads" },
  "leads.delete_permanent": { category: "Leads", description: "Permanently delete leads" },
  "leads.override": { category: "Leads", description: "Override score, opportunity, website status, category and price" },
  "leads.merge": { category: "Leads", description: "Merge duplicate records" },
  "leads.bulk": { category: "Leads", description: "Run bulk actions" },
  "search.run": { category: "Research", description: "Start lead searches" },
  "search.view": { category: "Research", description: "View searches, jobs and research results" },
  "search.manage_templates": { category: "Research", description: "Edit and delete any saved search" },
  "search.schedule": { category: "Research", description: "Schedule recurring searches" },
  "research.review": { category: "Research", description: "Review, qualify and reject research results" },
  "research.approve": { category: "Research", description: "Approve research results into the CRM" },
  "imports.run": { category: "Data", description: "Import CSV / XLSX / Google Sheets" },
  "exports.run": { category: "Data", description: "Export leads" },
  "outreach.log": { category: "Sales", description: "Log outreach and manage follow-ups" },
  "notes.create": { category: "Sales", description: "Write notes" },
  "analytics.view": { category: "Insights", description: "View analytics and market intelligence" },
  "assistant.use": { category: "Insights", description: "Use the AI sales assistant" },
  "admin.users": { category: "Admin", description: "Approve, suspend and manage users and teams" },
  "admin.approvals": { category: "Admin", description: "Approve or reject sensitive operations" },
  "admin.providers": { category: "Admin", description: "Manage data providers and integrations" },
  "admin.categories": { category: "Admin", description: "Manage categories and synonyms" },
  "admin.locations": { category: "Admin", description: "Manage saved locations and territories" },
  "admin.scoring": { category: "Admin", description: "Manage scoring, pricing and quality gates" },
  "admin.audit": { category: "Admin", description: "View audit logs" },
  "admin.settings": { category: "Admin", description: "Manage system settings" },
  "admin.data_purge": { category: "Admin", description: "Purge data permanently" },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

const SALES_CORE: PermissionKey[] = ["outreach.log", "notes.create", "exports.run", "analytics.view", "assistant.use"];

export const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  SUPER_ADMIN: [...ALL_PERMISSIONS],
  ADMIN: ALL_PERMISSIONS.filter((p) => !["admin.approvals", "admin.data_purge", "leads.delete_permanent"].includes(p)),
  MANAGER: [
    "leads.view_own", "leads.view_team", "leads.create", "leads.edit", "leads.assign", "leads.archive",
    "leads.override", "leads.merge", "leads.bulk",
    "search.run", "search.view", "search.manage_templates", "search.schedule",
    "research.review", "research.approve", "imports.run",
    ...SALES_CORE,
  ],
  SALES: ["leads.view_own", "leads.edit", ...SALES_CORE],
  RESEARCHER: [
    "leads.view_own", "leads.view_team", "leads.create", "leads.edit",
    "search.run", "search.view", "search.manage_templates",
    "research.review", "imports.run", "exports.run", "notes.create", "analytics.view", "assistant.use",
  ],
  VIEWER: ["leads.view_team", "search.view", "analytics.view"],
};

export interface PermissionSubject {
  role: RoleKey;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";
  overrides?: { permission: PermissionKey; granted: boolean }[];
}

/** Mirrors public.has_perm() in SQL. */
export function hasPermission(subject: PermissionSubject | null | undefined, perm: PermissionKey): boolean {
  if (!subject || subject.status !== "ACTIVE") return false;
  if (subject.role === "SUPER_ADMIN") return true;
  const override = subject.overrides?.find((o) => o.permission === perm);
  if (override) return override.granted;
  return ROLE_PERMISSIONS[subject.role].includes(perm);
}

/** A user may only assign roles strictly below their own rank (super admins may assign any). */
export function canAssignRole(actor: RoleKey, target: RoleKey): boolean {
  if (actor === "SUPER_ADMIN") return true;
  return ROLE_META[target].rank < ROLE_META[actor].rank;
}
