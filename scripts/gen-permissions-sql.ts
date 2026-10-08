/**
 * Prints the SQL that seeds roles, permissions and role_permissions from
 * src/lib/auth/permissions.ts. Used to (re)generate the reference-data
 * migration block between the BEGIN/END GENERATED markers.
 */
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_META, ROLE_PERMISSIONS, ROLES } from "../src/lib/auth/permissions";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function permissionsSql(): string {
  const lines: string[] = ["-- BEGIN GENERATED PERMISSIONS (scripts/gen-permissions-sql.ts)"];
  lines.push("insert into public.roles (key, name, description, rank) values");
  lines.push(ROLES.map((r) => `  (${q(r)}, ${q(ROLE_META[r].name)}, ${q(ROLE_META[r].description)}, ${ROLE_META[r].rank})`).join(",\n") +
    "\non conflict (key) do update set name = excluded.name, description = excluded.description, rank = excluded.rank;");
  lines.push("insert into public.permissions (key, description, category) values");
  lines.push(ALL_PERMISSIONS.map((p) => `  (${q(p)}, ${q(PERMISSIONS[p].description)}, ${q(PERMISSIONS[p].category)})`).join(",\n") +
    "\non conflict (key) do update set description = excluded.description, category = excluded.category;");
  lines.push("delete from public.role_permissions;");
  lines.push("insert into public.role_permissions (role_key, permission_key) values");
  const pairs: string[] = [];
  for (const r of ROLES) for (const p of ROLE_PERMISSIONS[r]) pairs.push(`  (${q(r)}, ${q(p)})`);
  lines.push(pairs.join(",\n") + ";");
  lines.push("-- END GENERATED PERMISSIONS");
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("gen-permissions-sql.ts")) {
  console.log(permissionsSql());
}
