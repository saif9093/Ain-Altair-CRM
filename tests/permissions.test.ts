import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hasPermission, canAssignRole, ROLE_PERMISSIONS, ALL_PERMISSIONS } from "@/lib/auth/permissions";
import { permissionsSql } from "../scripts/gen-permissions-sql";

describe("permissions", () => {
  it("denies everything to non-active users", () => {
    expect(hasPermission({ role: "SUPER_ADMIN", status: "PENDING" }, "leads.view_all")).toBe(false);
    expect(hasPermission({ role: "ADMIN", status: "SUSPENDED" }, "admin.users")).toBe(false);
    expect(hasPermission(null, "leads.view_own")).toBe(false);
  });
  it("grants super admin everything", () => {
    for (const p of ALL_PERMISSIONS) expect(hasPermission({ role: "SUPER_ADMIN", status: "ACTIVE" }, p)).toBe(true);
  });
  it("restricts sensitive operations to super admin", () => {
    expect(hasPermission({ role: "ADMIN", status: "ACTIVE" }, "admin.approvals")).toBe(false);
    expect(hasPermission({ role: "ADMIN", status: "ACTIVE" }, "leads.delete_permanent")).toBe(false);
    expect(hasPermission({ role: "MANAGER", status: "ACTIVE" }, "admin.users")).toBe(false);
  });
  it("scopes sales users to their own leads", () => {
    const sales = { role: "SALES" as const, status: "ACTIVE" as const };
    expect(hasPermission(sales, "leads.view_own")).toBe(true);
    expect(hasPermission(sales, "leads.view_team")).toBe(false);
    expect(hasPermission(sales, "search.run")).toBe(false);
  });
  it("applies per-user overrides (revoke wins over role)", () => {
    expect(hasPermission({ role: "MANAGER", status: "ACTIVE", overrides: [{ permission: "leads.bulk", granted: false }] }, "leads.bulk")).toBe(false);
    expect(hasPermission({ role: "VIEWER", status: "ACTIVE", overrides: [{ permission: "exports.run", granted: true }] }, "exports.run")).toBe(true);
  });
  it("prevents privilege escalation when assigning roles", () => {
    expect(canAssignRole("ADMIN", "SUPER_ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "MANAGER")).toBe(true);
    expect(canAssignRole("SUPER_ADMIN", "ADMIN")).toBe(true);
  });
  it("keeps the SQL reference data in sync with the TS matrix", () => {
    const sql = readFileSync("supabase/migrations/20261008000006_reference_data.sql", "utf8");
    expect(sql).toContain(permissionsSql());
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) for (const p of perms) expect(sql).toContain(`('${role}', '${p}')`);
  });
});
