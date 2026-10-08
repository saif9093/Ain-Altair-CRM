"use client";
import { useState } from "react";
import { Button, Card, CardHeader, Textarea } from "@/components/ui";
import { useAction, useToast } from "@/components/client";
import { saveSettings } from "@/app/actions/admin";

type Section = { key: "scoring" | "pricing" | "gates" | "assignment"; title: string; value: unknown; hint?: string };

export function SettingsEditor({ sections }: { sections: Section[] }) {
  return <div className="space-y-6">{sections.map((s) => <Editor key={s.key} s={s} />)}</div>;
}

function Editor({ s }: { s: Section }) {
  const [text, setText] = useState(JSON.stringify(s.value, null, 2));
  const { run, pending } = useAction();
  const toast = useToast();
  return (
    <Card>
      <CardHeader eyebrow={s.key} title={s.title} />
      <div className="space-y-2 p-5">
        {s.hint && <p className="text-xs text-mute">{s.hint}</p>}
        <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
        <Button variant="dark" size="sm" disabled={pending} onClick={() => { let v: unknown; try { v = JSON.parse(text); } catch { return toast("Invalid JSON", "err"); } run(() => saveSettings({ section: s.key, value: v })); }}>Save</Button>
      </div>
    </Card>
  );
}
