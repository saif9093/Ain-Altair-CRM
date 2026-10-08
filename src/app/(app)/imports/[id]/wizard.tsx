"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Field, Select } from "@/components/ui";
import { useAction } from "@/components/client";
import { saveImportMapping, runImport, promoteImport } from "@/app/actions/imports";

export function ImportWizard({ imp, fields }: { imp: { id: string; status: string; headers: string[]; column_mapping: Record<string, string | null>; mode: string | null; match_strategy: string | null; target_lifecycle: string; new_count: number; update_count: number }; fields: { key: string; label: string }[] }) {
  const [mapping, setMapping] = useState(imp.column_mapping);
  const [mode, setMode] = useState(imp.mode ?? "UPSERT");
  const [match, setMatch] = useState(imp.match_strategy ?? "AUTO");
  const [target, setTarget] = useState(imp.status === "UPLOADED" ? "ACTIVE" : imp.target_lifecycle);
  const { run, pending } = useAction();
  const done = ["COMPLETED", "IMPORTING", "PENDING_APPROVAL"].includes(imp.status);
  return (
    <Card>
      <CardHeader eyebrow="Step 1 · Smart column mapping" title="Confirm how columns map to lead fields" />
      <div className="grid gap-3 p-5 md:grid-cols-3">
        {imp.headers.map((h) => (
          <Field key={h} label={h}>
            <Select value={mapping[h] ?? ""} disabled={done} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value || null })}><option value="">— ignore —</option>{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>
          </Field>
        ))}
      </div>
      <div className="grid gap-3 border-t border-line p-5 md:grid-cols-3">
        <Field label="Import mode (required)" hint="Nothing is overwritten silently."><Select value={mode} disabled={done} onChange={(e) => setMode(e.target.value)}><option value="">Choose…</option><option value="ADD_ONLY">Add only (skip existing)</option><option value="UPDATE_EXISTING">Update existing only</option><option value="UPSERT">Upsert (add + update)</option></Select></Field>
        <Field label="Match existing records by"><Select value={match} disabled={done} onChange={(e) => setMatch(e.target.value)}><option value="AUTO">Auto (Lead ID → Place ID → phone → domain)</option><option value="LEAD_ID">Lead ID</option><option value="PHONE">Phone</option><option value="DOMAIN">Domain</option><option value="GOOGLE_PLACE_ID">Google Maps ID</option></Select></Field>
        <Field label="Imported leads go to"><Select value={target} disabled={done} onChange={(e) => setTarget(e.target.value)}><option value="RESEARCH">Research (review first)</option><option value="ACTIVE">CRM directly</option></Select></Field>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line p-5">
        <Button variant="dark" disabled={pending || done || !mode || !Object.values(mapping).includes("name" as never)} onClick={() => run(() => saveImportMapping({ id: imp.id, mapping, mode, match, target }))}>{pending ? "Checking…" : "Step 2 · Preview & validate"}</Button>
        {imp.status === "PREVIEWED" && <Button variant="primary" size="lg" disabled={pending || imp.new_count + imp.update_count === 0} onClick={() => run(() => runImport(imp.id))}>Step 3 · Import {imp.new_count + imp.update_count} rows into {target === "ACTIVE" ? "the CRM" : "Research"} →</Button>}
        {!Object.values(mapping).includes("name" as never) && <span className="self-center text-xs text-signal-ink">Map a column to “Business name”.</span>}
      </div>
    </Card>
  );
}

/** Refreshes the page every few seconds while an import runs (real counts from the database). */
export function ImportLive() {
  const router = useRouter();
  useEffect(() => { const t = setInterval(() => router.refresh(), 3000); return () => clearInterval(t); }, [router]);
  return null;
}

export function PromoteButton({ id }: { id: string }) {
  const { run, pending } = useAction();
  return <Button variant="primary" disabled={pending} onClick={() => run(() => promoteImport(id))}>{pending ? "Moving…" : "Move these leads into the CRM"}</Button>;
}
