import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge, Card, PageHeader } from "@/components/ui";
import { PROVIDER_CATALOG, missingEnv } from "@/lib/providers/catalog";
import { providerState, type ProviderRow } from "@/lib/providers/registry";
import { fmtRelative, human } from "@/lib/format";
import { ProviderControls } from "./provider-controls";

export const metadata = { title: "Providers" };

export default async function Providers() {
  const s = await requireUser("admin.providers");
  const { data: rows } = await createAdminClient().from("providers").select("*").eq("organisation_id", s.organisationId);
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Providers & integrations" description="Credentials are server environment variables only — never stored in the database or shown here. Fallback order = priority (lower runs first)." />
      <div className="grid gap-4 lg:grid-cols-2">
        {PROVIDER_CATALOG.map((p) => {
          const row = rows?.find((r) => r.key === p.key);
          const st = providerState(row as ProviderRow, p.key);
          const missing = missingEnv(p.key);
          return (
            <Card key={p.key} className="p-5">
              <div className="flex items-start justify-between gap-3"><div><div className="tag-mono text-[10.5px] text-mute">{p.kind}</div><div className="text-lg font-semibold">{p.name}</div></div><Badge tone={st === "READY" ? "ok" : st === "NOT_CONFIGURED" ? "warn" : "neutral"}>{human(st)}</Badge></div>
              <p className="mt-1 text-sm text-mute">{p.description}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                <div><span className="text-mute">Last success </span>{fmtRelative(row?.last_success_at)}</div>
                <div><span className="text-mute">Runs </span>{row?.run_count ?? 0}</div>
                <div><span className="text-mute">Errors </span>{row?.error_count ?? 0} {row?.run_count ? `(${Math.round((100 * (row.error_count ?? 0)) / row.run_count)}%)` : ""}</div>
                <div><span className="text-mute">Usage today </span>{row?.usage_date === new Date().toISOString().slice(0, 10) ? row?.usage_today : 0}{row?.daily_quota ? ` / ${row.daily_quota}` : ""}</div>
              </div>
              {row?.last_error && <p className="mt-2 rounded-lg bg-signal-tint px-3 py-2 text-xs text-signal-ink">Last error {fmtRelative(row.last_error_at)}: {row.last_error.slice(0, 240)}</p>}
              {missing.length > 0 && (
                <div className="mt-3 rounded-xl bg-warn-tint p-3 text-xs">
                  <div className="font-semibold text-warn">NOT CONFIGURED — set: {missing.join(", ")}</div>
                  <ol className="mt-1 list-decimal pl-4 text-mute">{p.setup.map((x) => <li key={x}>{x}</li>)}</ol>
                  <a className="underline" href={p.docsUrl} target="_blank" rel="noreferrer">Documentation</a>
                </div>
              )}
              {p.notes && <p className="mt-2 text-xs text-dim">{p.notes}</p>}
              {row && <ProviderControls pkey={p.key} enabled={row.enabled} priority={row.priority} rateLimit={row.rate_limit_per_minute} quota={row.daily_quota} />}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
