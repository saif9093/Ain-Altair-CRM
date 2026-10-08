"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, Card, Textarea } from "@/components/ui";
import { ask } from "@/app/actions/assistant";

const SUGGEST = ["Show me the 20 best cleaning leads in Dubai that haven't been contacted.", "How many salon leads have no website?", "Show me today's follow-ups.", "Show me all leads in Sharjah with outdated websites."];

function render(text: string) {
  return text.split(/(\[[^\]]+\]\(\/leads\/[0-9a-f-]+\))/g).map((part, i) => {
    const m = part.match(/^\[([^\]]+)\]\((\/leads\/[0-9a-f-]+)\)$/);
    return m ? <Link key={i} href={m[2]} className="underline">{m[1]}</Link> : <span key={i}>{part}</span>;
  });
}

export function Chat() {
  const [turns, setTurns] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const send = (text: string) => {
    const next = [...turns, { role: "user" as const, content: text }];
    setTurns(next);
    setQ("");
    start(async () => {
      const r = await ask(next);
      setTurns([...next, { role: "assistant", content: r.ok ? r.data!.answer : `⚠ ${r.error}` }]);
    });
  };
  return (
    <Card className="flex h-[70vh] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {!turns.length && <div className="flex flex-wrap gap-2">{SUGGEST.map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border border-line-strong px-3 py-1.5 text-left text-sm hover:border-paper">{s}</button>)}</div>}
        {turns.map((t, i) => <div key={i} className={`max-w-3xl whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm ${t.role === "user" ? "ml-auto bg-paper text-white" : "bg-ink-2"}`}>{t.role === "assistant" ? render(t.content) : t.content}</div>)}
        {pending && <div className="text-sm text-mute">Querying your CRM…</div>}
      </div>
      <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); if (q.trim()) send(q.trim()); }}>
        <Textarea rows={1} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your leads…" className="flex-1" />
        <Button variant="primary" disabled={pending || !q.trim()}>Ask</Button>
      </form>
    </Card>
  );
}
