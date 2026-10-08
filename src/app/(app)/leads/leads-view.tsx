"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, Field, Input, Select, cx } from "@/components/ui";
import { Modal, useAction } from "@/components/client";
import { ContactLinks, IntentBadge, TierBadge, WebsiteBadge } from "@/components/lead-bits";
import { archiveLeads, assignLeads, bulkStage, createLead, reprocessLeads, scheduleFollowUp, tagLeads } from "@/app/actions/leads";
import { saveFilter, deleteFilter } from "@/app/actions/filters";
import { fmtDate, human, STAGES } from "@/lib/format";
import type { LeadFilters } from "@/lib/leads/query";

type Lead = Record<string, unknown> & { id: string; name: string; lead_code: string; owner: { full_name: string | null; email: string } | null; business_socials: { platform: string; url: string }[] };
type User = { id: string; full_name: string | null; email: string };

export function LeadsView({ rows, count, page, per, filters, view, users, teams, saved, categories, perms }: {
  rows: Lead[]; count: number; page: number; per: number; filters: LeadFilters; view: string; users: User[]; teams: { id: string; name: string }[]; saved: { id: string; name: string; filters: Record<string, string> }[];
  categories: { key: string; name: string }[]; perms: Record<string, boolean>;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [sel, setSel] = useState<string[]>([]);
  const [modal, setModal] = useState<null | "assign" | "followup" | "tag" | "new">(null);
  const { run, pending } = useAction();
  const setF = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    if (!("page" in patch)) p.delete("page");
    router.push(`${path}?${p.toString()}`);
  };
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Input placeholder="Search name, phone, domain…" defaultValue={filters.q ?? ""} onKeyDown={(e) => e.key === "Enter" && setF({ q: (e.target as HTMLInputElement).value })} className="md:col-span-2" />
          <Select value={filters.tier ?? ""} onChange={(e) => setF({ tier: e.target.value })}><option value="">Any tier</option>{["HOT", "HIGH", "GOOD", "MEDIUM", "LOW"].map((t) => <option key={t}>{t}</option>)}</Select>
          <Select value={filters.stage ?? ""} onChange={(e) => setF({ stage: e.target.value })}><option value="">Any stage</option>{STAGES.map((t) => <option key={t} value={t}>{human(t)}</option>)}</Select>
          <Select value={filters.website ?? ""} onChange={(e) => setF({ website: e.target.value })}><option value="">Any website</option>{["NO_WEBSITE", "BROKEN", "OUTDATED", "MOBILE_ISSUE", "SLOW", "POOR_DESIGN", "MISSING_FUNCTIONALITY", "AVERAGE", "GOOD", "HIGH_QUALITY", "UNKNOWN"].map((t) => <option key={t} value={t}>{human(t)}</option>)}</Select>
          <Select value={filters.category ?? ""} onChange={(e) => setF({ category: e.target.value })}><option value="">Any category</option>{categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select>
          <Select value={filters.owner ?? ""} onChange={(e) => setF({ owner: e.target.value })}><option value="">Any owner</option><option value="me">Mine</option><option value="unassigned">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}</Select>
          <Input placeholder="City" defaultValue={filters.city ?? ""} onKeyDown={(e) => e.key === "Enter" && setF({ city: (e.target as HTMLInputElement).value })} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {[["whatsapp", "WhatsApp"], ["instagram", "Instagram"]].map(([k, l]) => <button key={k} onClick={() => setF({ [k]: (filters as Record<string, string>)[k] === "1" ? undefined : "1" })} className={cx("rounded-full border px-3 py-0.5 text-xs", (filters as Record<string, string>)[k] === "1" ? "border-paper bg-paper text-white" : "border-line-strong")}>{l}</button>)}
          <button onClick={() => setF({ contacted: filters.contacted === "no" ? undefined : "no" })} className={cx("rounded-full border px-3 py-0.5 text-xs", filters.contacted === "no" ? "border-paper bg-paper text-white" : "border-line-strong")}>Not contacted</button>
          <Select className="h-8 w-40 text-xs" value={filters.followup ?? ""} onChange={(e) => setF({ followup: e.target.value })}><option value="">Any follow-up</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">This week</option></Select>
          <Select className="h-8 w-36 text-xs" value={filters.sort ?? ""} onChange={(e) => setF({ sort: e.target.value })}><option value="">Sort: score</option><option value="intent">Sales intent</option><option value="newest">Newest</option><option value="reviews">Reviews</option><option value="name">Name</option></Select>
          <Select className="h-8 w-32 text-xs" value={filters.lifecycle ?? ""} onChange={(e) => setF({ lifecycle: e.target.value })}><option value="">Active</option><option value="ARCHIVED">Archived</option></Select>
          <span className="mx-1 text-line-strong">|</span>
          {saved.map((sf) => <span key={sf.id} className="inline-flex items-center gap-1"><Link href={`/leads?${new URLSearchParams(sf.filters).toString()}`} className="rounded-full bg-navy-tint px-3 py-0.5 text-xs text-navy">{sf.name}</Link><button className="text-xs text-dim" onClick={() => run(() => deleteFilter(sf.id))}>×</button></span>)}
          <button className="text-xs underline" onClick={() => { const n = prompt("Save these filters as…"); if (n) run(() => saveFilter(n, Object.fromEntries(sp.entries()))); }}>Save filter</button>
          <div className="ml-auto flex gap-1">{["table", "cards"].map((v) => <button key={v} onClick={() => setF({ view: v })} className={cx("rounded-full border px-3 py-0.5 text-xs", view === v ? "border-paper bg-paper text-white" : "border-line-strong")}>{human(v)}</button>)}<Link href="/pipeline" className="rounded-full border border-line-strong px-3 py-0.5 text-xs">Kanban</Link><Link href="/map" className="rounded-full border border-line-strong px-3 py-0.5 text-xs">Map</Link></div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-mute">{sel.length ? `${sel.length} selected` : ""}</span>
        {perms.assign && <Button size="sm" variant="dark" disabled={!sel.length} onClick={() => setModal("assign")}>Assign</Button>}
        {perms.edit && <Button size="sm" variant="outline" disabled={!sel.length} onClick={() => setModal("tag")}>Tag</Button>}
        {perms.bulk && <Select className="h-8 w-44 text-xs" disabled={!sel.length} value="" onChange={(e) => e.target.value && run(() => bulkStage(sel, e.target.value), { onDone: () => setSel([]) })}><option value="">Set status…</option>{STAGES.map((t) => <option key={t} value={t}>{human(t)}</option>)}</Select>}
        {perms.followup && <Button size="sm" variant="outline" disabled={!sel.length} onClick={() => setModal("followup")}>Schedule follow-up</Button>}
        {perms.rescore && <Button size="sm" variant="outline" disabled={!sel.length || pending} onClick={() => run(() => reprocessLeads({ businessIds: sel, mode: "RESCORE" }))}>Re-score</Button>}
        {perms.archive && <Button size="sm" variant="ghost" disabled={!sel.length} onClick={() => confirm(`${filters.lifecycle === "ARCHIVED" ? "Restore" : "Archive"} ${sel.length} lead(s)?`) && run(() => archiveLeads(sel, filters.lifecycle === "ARCHIVED"), { onDone: () => setSel([]) })}>{filters.lifecycle === "ARCHIVED" ? "Restore" : "Archive"}</Button>}
        {sel.length > 0 && <a className="text-xs underline" href={`/exports?ids=${sel.join(",")}`}>Export selected</a>}
        {perms.create && <Button size="sm" variant="primary" className="ml-auto" onClick={() => setModal("new")}>+ New lead</Button>}
      </div>

      {view === "cards" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((b) => (
            <Card key={b.id} className={cx("p-4", sel.includes(b.id) && "ring-2 ring-signal")}>
              <div className="flex items-start justify-between gap-2"><Link href={`/leads/${b.id}`} className="font-semibold hover:underline">{b.name}</Link><input type="checkbox" checked={sel.includes(b.id)} onChange={() => setSel((s) => s.includes(b.id) ? s.filter((x) => x !== b.id) : [...s, b.id])} /></div>
              <div className="text-xs text-mute">{[b.category_label, b.area ?? b.city].filter(Boolean).join(" · ") as string}</div>
              <div className="mt-2 flex flex-wrap gap-1"><TierBadge tier={b.tier as string} score={b.lead_score as number} /><WebsiteBadge status={b.website_status as string} /><IntentBadge v={b.sales_intent as number} /></div>
              {Boolean(b.recommended_service) && <div className="mt-2 text-sm">→ {b.recommended_service as string}</div>}
              <div className="mt-3"><ContactLinks b={b as never} /></div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="tag-mono text-left text-[10.5px] text-mute"><tr className="border-b border-line"><th className="w-8 px-3 py-2"><input type="checkbox" checked={sel.length === rows.length && rows.length > 0} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])} /></th>{["Business", "Score", "Website", "Rating", "Stage", "Owner", "Follow-up", "Contact"].map((h) => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((b) => (
                <tr key={b.id} className="hover:bg-ink-2">
                  <td className="px-3 py-2.5"><input type="checkbox" checked={sel.includes(b.id)} onChange={() => setSel((s) => s.includes(b.id) ? s.filter((x) => x !== b.id) : [...s, b.id])} /></td>
                  <td className="max-w-[280px] px-3 py-2.5"><Link href={`/leads/${b.id}`} className="block truncate font-medium hover:underline">{b.name}</Link><div className="truncate text-xs text-mute">{b.lead_code} · {[b.category_label, b.area ?? b.city].filter(Boolean).join(" · ") as string}</div></td>
                  <td className="px-3 py-2.5"><TierBadge tier={b.tier as string} score={b.lead_score as number} /></td>
                  <td className="px-3 py-2.5"><WebsiteBadge status={b.website_status as string} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5">{(b.google_rating as number) ?? "—"}★ <span className="text-mute">({(b.google_review_count as number) ?? 0})</span></td>
                  <td className="px-3 py-2.5"><Badge>{human(b.pipeline_stage as string)}</Badge></td>
                  <td className="px-3 py-2.5 text-xs">{b.owner?.full_name ?? b.owner?.email ?? <span className="text-dim">Unassigned</span>}</td>
                  <td className="px-3 py-2.5 text-xs">{fmtDate(b.next_follow_up_at as string)}</td>
                  <td className="px-3 py-2.5"><ContactLinks b={b as never} /></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9} className="px-5 py-10 text-center text-mute">No leads match. Approve research results into the CRM, import a file, or clear filters.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      <div className="flex items-center justify-between text-sm">
        {page > 1 ? <button className="underline" onClick={() => setF({ page: String(page - 1) })}>← Previous</button> : <span />}
        <span className="text-mute">Page {page} of {Math.max(1, Math.ceil(count / per))}</span>
        {page * per < count ? <button className="underline" onClick={() => setF({ page: String(page + 1) })}>Next →</button> : <span />}
      </div>

      <AssignModal open={modal === "assign"} onClose={() => setModal(null)} ids={sel} users={users} teams={teams} onDone={() => setSel([])} />
      <Modal open={modal === "followup"} onClose={() => setModal(null)} title={`Follow-up for ${sel.length} lead(s)`}>
        <form action={(fd) => run(() => scheduleFollowUp({ businessIds: sel, dueAt: String(fd.get("due")), note: String(fd.get("note") ?? "") }), { onDone: () => setModal(null) })} className="space-y-3">
          <Field label="Due"><Input type="datetime-local" name="due" required /></Field>
          <Field label="Note"><Input name="note" /></Field>
          <Button variant="primary" disabled={pending}>Schedule</Button>
        </form>
      </Modal>
      <Modal open={modal === "tag"} onClose={() => setModal(null)} title="Tag leads">
        <form action={(fd) => run(() => tagLeads(sel, String(fd.get("tag"))), { onDone: () => setModal(null) })} className="space-y-3">
          <Field label="Tag"><Input name="tag" required maxLength={40} /></Field>
          <Button variant="primary" disabled={pending}>Apply tag</Button>
        </form>
      </Modal>
      <Modal open={modal === "new"} onClose={() => setModal(null)} title="New lead (manual research)">
        <form action={(fd) => run(() => createLead({ name: String(fd.get("name")), phone: String(fd.get("phone") || "") || undefined, website: String(fd.get("website") || "") || undefined, city: String(fd.get("city") || "") || undefined, area: String(fd.get("area") || "") || undefined, categoryKey: String(fd.get("category") || "") || undefined }), { onDone: (d) => { setModal(null); if (d) router.push(`/leads/${(d as { id: string }).id}`); } })} className="grid gap-3 md:grid-cols-2">
          <Field label="Business name" className="md:col-span-2"><Input name="name" required /></Field>
          <Field label="Phone"><Input name="phone" /></Field>
          <Field label="Website"><Input name="website" /></Field>
          <Field label="City"><Input name="city" /></Field>
          <Field label="Area"><Input name="area" /></Field>
          <Field label="Category" className="md:col-span-2"><Select name="category"><option value="">—</option>{categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select></Field>
          <Button variant="primary" disabled={pending} className="md:col-span-2">Create & research</Button>
        </form>
      </Modal>
    </div>
  );
}

export function AssignModal({ open, onClose, ids, users, teams, onDone }: { open: boolean; onClose: () => void; ids: string[]; users: User[]; teams: { id: string; name: string }[]; onDone?: () => void }) {
  const [mode, setMode] = useState<"MANUAL" | "ROUND_ROBIN">("MANUAL");
  const [picked, setPicked] = useState<string[]>([]);
  const [team, setTeam] = useState("");
  const { run, pending } = useAction();
  return (
    <Modal open={open} onClose={onClose} title={`Assign ${ids.length} lead(s)`}>
      <div className="space-y-3">
        <Field label="Method"><Select value={mode} onChange={(e) => setMode(e.target.value as "MANUAL")}><option value="MANUAL">Assign to one user</option><option value="ROUND_ROBIN">Round robin across users</option></Select></Field>
        <Field label={mode === "MANUAL" ? "User" : "Users (round robin)"}>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <input type={mode === "MANUAL" ? "radio" : "checkbox"} name="u" checked={picked.includes(u.id)} onChange={(e) => setPicked(mode === "MANUAL" ? [u.id] : e.target.checked ? [...picked, u.id] : picked.filter((x) => x !== u.id))} />
                {u.full_name ?? u.email} <span className="text-xs text-dim">{u.email}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Team (optional)"><Select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">User&apos;s own team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <div className="flex gap-2">
          <Button variant="primary" disabled={pending || (!picked.length && !team)} onClick={() => run(() => assignLeads({ businessIds: ids, userIds: picked, teamId: team || null, mode }), { onDone: () => { onClose(); onDone?.(); } })}>Assign</Button>
          <Button variant="outline" disabled={pending} onClick={() => run(() => assignLeads({ businessIds: ids, userIds: [], unassign: true }), { onDone: () => { onClose(); onDone?.(); } })}>Unassign</Button>
        </div>
      </div>
    </Modal>
  );
}
