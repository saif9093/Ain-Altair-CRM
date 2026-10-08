"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { CopyButton, useAction } from "@/components/client";
import { addNote, archiveLeads, completeFollowUp, deleteLeadPermanently, dismissDuplicate, logOutreach, mergeLeads, overrideLead, reprocessLeads, scheduleFollowUp, setPricing, updateStage } from "@/app/actions/leads";
import { AssignModal } from "../leads-view";
import { fmtDate, human, STAGES } from "@/lib/format";
import { whatsappUrl } from "@/lib/normalize/phone";

export function Outreach({ businessId, message, whatsapp, aiMessage, canLog }: { businessId: string; message: string; whatsapp: string | null; aiMessage: boolean; canLog: boolean }) {
  const [text, setText] = useState(message);
  const { run, pending } = useAction();
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between"><span className="tag-mono text-[10.5px] text-mute">Personalised message {aiMessage ? "(AI draft — check facts)" : "(built from observed facts)"}</span></div>
      <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyButton text={text} label="Copy message" />
        {whatsapp && <a href={whatsappUrl(whatsapp, text)!} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-full bg-ok px-3.5 text-[13px] text-white">Open WhatsApp with message</a>}
        {canLog && <Button size="sm" variant="dark" disabled={pending} onClick={() => run(() => logOutreach({ businessId, channel: whatsapp ? "WHATSAPP" : "CALL", message: text, outcome: "Message sent", markContacted: true }))}>Log as sent → Contacted</Button>}
      </div>
    </div>
  );
}

export function LeadSidebar({ lead, users, teams, followUps, perms, ownerName }: { lead: { id: string; stage: string; ownerId: string | null; lifecycle: string }; users: { id: string; full_name: string | null; email: string }[]; teams: { id: string; name: string }[]; followUps: { id: string; due_at: string; note: string | null; status: string }[]; perms: Record<string, boolean>; ownerName: string | null }) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [assign, setAssign] = useState(false);
  return (
    <Card>
      <CardHeader eyebrow="Sales" title="Pipeline" />
      <div className="space-y-4 p-4">
        <Field label="Stage">
          <Select value={lead.stage} disabled={!perms.edit || pending} onChange={(e) => { const v = e.target.value; const reason = v === "LOST" ? prompt("Why was it lost?") ?? undefined : undefined; run(() => updateStage(lead.id, v, reason)); }}>
            {STAGES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
          </Select>
        </Field>
        <div>
          <div className="tag-mono mb-1 text-[10.5px] text-mute">Owner</div>
          <div className="flex items-center justify-between text-sm"><span>{ownerName ?? "Unassigned"}</span>{perms.assign && <Button size="sm" variant="outline" onClick={() => setAssign(true)}>Assign</Button>}</div>
        </div>
        <div>
          <div className="tag-mono mb-1 text-[10.5px] text-mute">Follow-ups</div>
          {followUps.filter((f) => f.status === "PENDING").map((f) => (
            <div key={f.id} className="mb-1 flex items-center justify-between gap-2 rounded-lg bg-ink-2 px-2 py-1.5 text-sm">
              <span className={Date.parse(f.due_at) < Date.now() ? "text-signal-ink" : ""}>{fmtDate(f.due_at, true)}{f.note ? ` · ${f.note}` : ""}</span>
              {perms.followup && <button className="text-xs underline" onClick={() => run(() => completeFollowUp(f.id))}>Done</button>}
            </div>
          ))}
          {perms.followup && (
            <form className="mt-2 space-y-2" action={(fd) => run(() => scheduleFollowUp({ businessIds: [lead.id], dueAt: String(fd.get("due")), note: String(fd.get("note") || "") }))}>
              <Input type="datetime-local" name="due" required />
              <div className="flex gap-2"><Input name="note" placeholder="Note" /><Button size="sm" variant="outline" disabled={pending}>Add</Button></div>
            </form>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {perms.archive && <Button size="sm" variant="ghost" onClick={() => confirm(lead.lifecycle === "ARCHIVED" ? "Restore lead?" : "Archive lead?") && run(() => archiveLeads([lead.id], lead.lifecycle === "ARCHIVED"))}>{lead.lifecycle === "ARCHIVED" ? "Restore" : "Archive"}</Button>}
          {perms.del && <Button size="sm" variant="danger" onClick={() => confirm("Permanently delete this lead and all its history? This cannot be undone.") && run(() => deleteLeadPermanently(lead.id), { onDone: () => router.push("/leads"), refresh: false })}>Delete permanently</Button>}
        </div>
      </div>
      <AssignModal open={assign} onClose={() => setAssign(false)} ids={[lead.id]} users={users} teams={teams} />
    </Card>
  );
}

export function NotesBox({ businessId, notes, canWrite }: { businessId: string; notes: { id: string; body: string; visibility: string; created_at: string; author: { full_name: string | null; email: string } | null }[]; canWrite: boolean }) {
  const { run, pending } = useAction();
  const [body, setBody] = useState("");
  const [vis, setVis] = useState<"TEAM" | "PRIVATE">("TEAM");
  return (
    <Card>
      <CardHeader eyebrow="Notes" title="Sales notes" />
      <div className="space-y-3 p-5">
        {canWrite && (
          <div className="space-y-2">
            <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note…" />
            <div className="flex gap-2"><Select className="w-40" value={vis} onChange={(e) => setVis(e.target.value as "TEAM")}><option value="TEAM">Shared with team</option><option value="PRIVATE">Private</option></Select><Button variant="dark" size="sm" disabled={pending || !body.trim()} onClick={() => run(() => addNote({ businessId, body, visibility: vis }), { onDone: () => setBody("") })}>Add note</Button></div>
          </div>
        )}
        {notes.map((n) => <div key={n.id} className="rounded-xl bg-ink-2 p-3 text-sm"><div className="whitespace-pre-wrap">{n.body}</div><div className="mt-1 text-xs text-mute">{n.author?.full_name ?? n.author?.email} · {fmtDate(n.created_at, true)} {n.visibility === "PRIVATE" && <Badge>Private</Badge>}</div></div>)}
        {!notes.length && <p className="text-sm text-mute">No notes yet.</p>}
      </div>
    </Card>
  );
}

export function Reprocess({ businessId, canResearch, canEdit }: { businessId: string; canResearch: boolean; canEdit: boolean }) {
  const { run, pending } = useAction();
  const btn = (label: string, mode: "AUDIT" | "SOCIAL" | "RESCORE" | "DUPLICATES" | "FULL" | "AI") => <Button key={mode} size="sm" variant="outline" disabled={pending} onClick={() => run(() => reprocessLeads({ businessIds: [businessId], mode }))}>{label}</Button>;
  return (
    <Card>
      <CardHeader eyebrow="Reprocessing" title="Refresh research" />
      <div className="flex flex-wrap gap-2 p-4">
        {canResearch && btn("Re-run website audit", "AUDIT")}
        {canResearch && btn("Re-run social enrichment", "SOCIAL")}
        {canEdit && btn("Re-score", "RESCORE")}
        {canResearch && btn("Re-check duplicates", "DUPLICATES")}
        {canResearch && btn("Full re-research", "FULL")}
        {canResearch && btn("Generate AI analysis", "AI")}
        {pending && <span className="text-xs text-mute">Working… (website audits can take ~20s)</span>}
      </div>
    </Card>
  );
}

export function OverridePanel({ businessId }: { businessId: string }) {
  const { run, pending } = useAction();
  const [field, setField] = useState<"lead_score" | "website_status" | "category" | "recommended_service">("lead_score");
  return (
    <Card>
      <CardHeader eyebrow="Manual override" title="Tracked overrides" />
      <form className="space-y-2 p-4" action={(fd) => run(() => overrideLead({ businessId, field, value: String(fd.get("value")), reason: String(fd.get("reason")) }))}>
        <Select value={field} onChange={(e) => setField(e.target.value as "lead_score")}><option value="lead_score">Lead score</option><option value="website_status">Website status</option><option value="category">Category key</option><option value="recommended_service">Recommended service</option></Select>
        {field === "website_status" ? <Select name="value">{["NO_WEBSITE", "BROKEN", "OUTDATED", "MOBILE_ISSUE", "SLOW", "POOR_DESIGN", "MISSING_FUNCTIONALITY", "AVERAGE", "GOOD", "HIGH_QUALITY"].map((v) => <option key={v} value={v}>{human(v)}</option>)}</Select> : <Input name="value" required placeholder={field === "lead_score" ? "0–100" : ""} />}
        <Input name="reason" required minLength={3} placeholder="Reason (required, logged)" />
        <Button size="sm" variant="dark" disabled={pending}>Save override</Button>
      </form>
    </Card>
  );
}

export function PricingPanel({ businessId, pricing, money }: { businessId: string; pricing: Record<string, unknown> | null; currency: string; money: { min: string; max: string; opp: string; deal: string } }) {
  const { run, pending } = useAction();
  return (
    <Card>
      <CardHeader eyebrow="Commercial · restricted" title="Pricing" />
      <div className="space-y-2 p-4 text-sm">
        <div className="flex justify-between"><span className="text-mute">Recommended</span><span>{money.min} – {money.max}</span></div>
        <div className="flex justify-between"><span className="text-mute">Est. opportunity</span><span>{money.opp}</span></div>
        <div className="flex justify-between"><span className="text-mute">Deal value</span><span>{money.deal}</span></div>
        {Boolean(pricing?.price_override) && <Badge tone="warn">Manual price</Badge>}
        <form className="grid grid-cols-2 gap-2 pt-2" action={(fd) => run(() => setPricing({ businessId, min: fd.get("min") ? Number(fd.get("min")) : undefined, max: fd.get("max") ? Number(fd.get("max")) : undefined, dealValue: fd.get("deal") ? Number(fd.get("deal")) : undefined, reason: "manual" }))}>
          <Input name="min" type="number" placeholder="Min" /><Input name="max" type="number" placeholder="Max" />
          <Input name="deal" type="number" placeholder="Deal value" className="col-span-2" />
          <Button size="sm" variant="dark" className="col-span-2" disabled={pending}>Save pricing</Button>
        </form>
        <p className="text-xs text-dim">Visible only to users with the pricing permission. BDOs cannot see these amounts.</p>
      </div>
    </Card>
  );
}

type Dup = { id: string; confidence: number; reasons: { signal: string; detail: string }[]; a: { id: string; name: string; lead_code: string; phone_e164: string | null; website_domain: string | null; city: string | null; lifecycle: string }; b: Dup["a"] };
export function MergePanel({ currentId, candidates, canMerge }: { currentId: string; candidates: Dup[]; canMerge: boolean }) {
  const { run, pending } = useAction();
  return (
    <Card>
      <CardHeader eyebrow="Entity resolution" title="Possible duplicates" />
      <div className="space-y-3 p-4">
        {candidates.map((c) => {
          const other = c.a.id === currentId ? c.b : c.a;
          return (
            <div key={c.id} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex items-center justify-between"><a href={`/leads/${other.id}`} className="font-medium underline">{other.name}</a><Badge tone={c.confidence >= 85 ? "signal" : "warn"}>{c.confidence}% duplicate</Badge></div>
              <div className="text-xs text-mute">{other.lead_code} · {other.phone_e164 ?? "no phone"} · {other.website_domain ?? "no website"} · {human(other.lifecycle)}</div>
              <ul className="mt-1 text-xs text-mute">{c.reasons.slice(0, 4).map((r, i) => <li key={i}>• {r.detail}</li>)}</ul>
              {canMerge && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="dark" disabled={pending} onClick={() => confirm(`Merge ${other.name} into this record? All notes, outreach, audits, sources and history are kept.`) && run(() => mergeLeads(currentId, other.id, {}))}>Merge into this</Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dismissDuplicate(c.id))}>Not a duplicate</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
