"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink, Field, Input, Select } from "@/components/ui";
import { Modal, useAction } from "@/components/client";
import { manageSearch, rerunSearch, scheduleSearch } from "@/app/actions/search";

const PRESETS = [
  ["Every Monday 09:00", "0 9 * * 1"], ["Every Friday 09:00", "0 9 * * 5"], ["Daily 08:00", "0 8 * * *"], ["Weekly (Sunday 07:00)", "0 7 * * 0"], ["Monthly (1st, 09:00)", "0 9 1 * *"],
];

export function TemplateActions({ id, name, cron, canRun, canSchedule }: { id: string; name: string; cron: string | null; canRun: boolean; canSchedule: boolean }) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [sched, setSched] = useState(false);
  const [expr, setExpr] = useState(cron ?? "0 9 * * 1");
  return (
    <div className="flex flex-wrap gap-2">
      {canRun && <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => rerunSearch(id), { success: "Search started", onDone: (d) => d && router.push(`/searches/${(d as { jobId: string }).jobId}`) })}>Run</Button>}
      <ButtonLink size="sm" variant="outline" href={`/search?template=${id}`}>Edit</ButtonLink>
      <Button size="sm" variant="outline" onClick={() => run(() => manageSearch({ id, op: "duplicate" }), { success: "Duplicated" })}>Duplicate</Button>
      <Button size="sm" variant="outline" onClick={() => { const n = prompt("Rename search", name); if (n) run(() => manageSearch({ id, op: "rename", name: n })); }}>Rename</Button>
      {canSchedule && <Button size="sm" variant="outline" onClick={() => setSched(true)}>{cron ? "Schedule ✓" : "Schedule"}</Button>}
      <Button size="sm" variant="ghost" onClick={() => confirm(`Delete “${name}”?`) && run(() => manageSearch({ id, op: "delete" }), { success: "Deleted" })}>Delete</Button>
      <Modal open={sched} onClose={() => setSched(false)} title="Schedule recurring search">
        <div className="space-y-3">
          <Field label="Preset"><Select onChange={(e) => setExpr(e.target.value)} value={PRESETS.find((p) => p[1] === expr)?.[1] ?? ""}><option value="">Custom</option>{PRESETS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Cron expression (Asia/Dubai)" hint="minute hour day month weekday — e.g. 0 9 * * 1 = Mondays 09:00"><Input value={expr} onChange={(e) => setExpr(e.target.value)} /></Field>
          <p className="text-xs text-mute">Each run compares results with the previous run: new businesses, newly detected websites, broken sites, review growth and new opportunities are flagged.</p>
          <div className="flex gap-2">
            <Button variant="primary" disabled={pending} onClick={() => run(() => scheduleSearch({ id, cron: expr }), { onDone: () => setSched(false) })}>Save schedule</Button>
            {cron && <Button variant="outline" onClick={() => run(() => scheduleSearch({ id, cron: null }), { onDone: () => setSched(false) })}>Remove schedule</Button>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
