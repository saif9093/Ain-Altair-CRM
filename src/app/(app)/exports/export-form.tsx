"use client";
import { useState } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { useToast } from "@/components/client";
import { STAGES, human } from "@/lib/format";

export function ExportForm({ columns, defaults, ids, job, sheets }: { columns: { key: string; label: string; pricing: boolean }[]; defaults: string[]; ids: string; job?: string; sheets: boolean }) {
  const [cols, setCols] = useState<string[]>(defaults);
  const [format, setFormat] = useState("XLSX");
  const [f, setF] = useState<Record<string, string>>(ids ? { ids } : {});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const go = async () => {
    setBusy(true);
    const r = await fetch("/api/exports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format, filters: f, columns: cols, scope: job ? `Search ${job}` : ids ? "Selected leads" : "Filtered leads" }) });
    setBusy(false);
    if (!r.ok) return toast((await r.json()).error ?? "Export failed", "err");
    if (format === "GOOGLE_SHEETS") { const { url } = await r.json(); window.open(url, "_blank"); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = r.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "export";
    a.click();
  };
  return (
    <Card className="space-y-4 p-5">
      {ids ? <p className="text-sm">Exporting {ids.split(",").length} selected leads{job ? " from the search" : ""}.</p> : (
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Tier"><Select value={f.tier ?? ""} onChange={(e) => setF({ ...f, tier: e.target.value })}><option value="">Any</option>{["HOT", "HIGH", "GOOD", "MEDIUM", "LOW"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Status"><Select value={f.stage ?? ""} onChange={(e) => setF({ ...f, stage: e.target.value })}><option value="">Any</option>{STAGES.map((t) => <option key={t} value={t}>{human(t)}</option>)}</Select></Field>
          <Field label="Website"><Select value={f.website ?? ""} onChange={(e) => setF({ ...f, website: e.target.value })}><option value="">Any</option>{["NO_WEBSITE", "BROKEN", "OUTDATED", "MOBILE_ISSUE", "POOR_DESIGN", "GOOD"].map((t) => <option key={t} value={t}>{human(t)}</option>)}</Select></Field>
          <Field label="City"><Input value={f.city ?? ""} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="Min score"><Input type="number" value={f.minScore ?? ""} onChange={(e) => setF({ ...f, minScore: e.target.value })} /></Field>
        </div>
      )}
      <Field label="Columns">
        <div className="flex flex-wrap gap-1.5">
          {columns.map((c) => <label key={c.key} className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${cols.includes(c.key) ? "border-paper bg-paper text-white" : "border-line-strong"}`}><input type="checkbox" className="hidden" checked={cols.includes(c.key)} onChange={() => setCols(cols.includes(c.key) ? cols.filter((x) => x !== c.key) : [...cols, c.key])} />{c.label}{c.pricing && " 🔒"}</label>)}
        </div>
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Format"><Select value={format} onChange={(e) => setFormat(e.target.value)}><option value="XLSX">XLSX</option><option value="CSV">CSV</option><option value="JSON">JSON</option>{sheets && <option value="GOOGLE_SHEETS">Google Sheets</option>}</Select></Field>
        <Button variant="primary" disabled={busy || !cols.length} onClick={go}>{busy ? "Building…" : "Export"}</Button>
      </div>
    </Card>
  );
}
