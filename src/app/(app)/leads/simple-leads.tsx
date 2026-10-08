"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Download, MessageCircle, Phone, Plus, Search } from "lucide-react";
import { Badge, ButtonLink, Card, Input, Select, cx } from "@/components/ui";
import { useAction } from "@/components/client";
import { assignLeads, updateStage } from "@/app/actions/leads";
import { fmtDate, human, STAGES } from "@/lib/format";
import { whatsappUrl } from "@/lib/normalize/phone";

type Lead = { id: string; name: string; category_label: string | null; area: string | null; city: string | null; tier: string | null; pipeline_stage: string; owner_id: string | null;
  whatsapp_e164: string | null; phone_e164: string | null; phone_formatted: string | null; phone_type: string | null; website_status: string; google_rating: number | null; google_review_count: number | null; next_follow_up_at: string | null };
type User = { id: string; full_name: string | null; email: string };

const TAB_LABELS: [string, string][] = [["all", "All"], ["new", "To contact"], ["followup", "Follow-up today"], ["talking", "Contacted"], ["interested", "Interested"], ["won", "Won"], ["lost", "Lost"]];
const STAGE_COLOR: Record<string, string> = { NOT_CONTACTED: "bg-ink-4", CONTACTED: "bg-navy-tint text-navy", REPLIED: "bg-navy-tint text-navy", INTERESTED: "bg-signal-tint text-signal-ink", MEETING: "bg-signal-tint text-signal-ink", QUOTE_SENT: "bg-warn-tint text-warn", WON: "bg-ok-tint text-ok", LOST: "bg-ink-4 text-dim" };

export function SimpleLeads({ rows, count, page, per, tab, counts, q, owner, users, canAssign, canEdit, canExport, canAdd }: {
  rows: Lead[]; count: number; page: number; per: number; tab: string; counts: Record<string, number | null>; q: string; owner: string; users: User[];
  canAssign: boolean; canEdit: boolean; canExport: boolean; canAdd: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [sel, setSel] = useState<string[]>([]);
  const { run, pending } = useAction();
  const go = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    if (!("page" in patch)) p.delete("page");
    router.push(`${path}?${p.toString()}`);
  };
  const userName = (id: string | null) => users.find((u) => u.id === id)?.full_name ?? users.find((u) => u.id === id)?.email ?? "";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div><h1 className="display text-4xl">Leads</h1><p className="mt-1 text-mute">{count.toLocaleString()} {tab === "all" ? "leads" : TAB_LABELS.find((t) => t[0] === tab)?.[1].toLowerCase()}</p></div>
        <div className="flex gap-2">
          {canExport && <a href={`/exports${sel.length ? `?ids=${sel.join(",")}` : ""}`} className="inline-flex h-10 items-center gap-2 rounded-full border border-line-strong bg-ink-3 px-4 text-sm"><Download size={15} />Export</a>}
          {canAdd && <ButtonLink href="/add" variant="primary"><Plus size={16} />Add leads</ButtonLink>}
        </div>
      </div>

      <div className="scroll-thin flex gap-1 overflow-x-auto rounded-2xl border border-line bg-ink-3 p-1">
        {TAB_LABELS.map(([k, label]) => (
          <button key={k} onClick={() => go({ tab: k === "all" ? undefined : k })} className={cx("whitespace-nowrap rounded-xl px-4 py-2 text-sm transition", tab === k ? "bg-navy text-white" : "text-mute hover:bg-ink-2")}>
            {label} <span className={cx("ml-1 rounded-full px-1.5 text-[11px]", tab === k ? "bg-white/20" : "bg-ink-4")}>{counts[k] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" /><Input defaultValue={q} placeholder="Search name, phone, area…" className="pl-9" onKeyDown={(e) => e.key === "Enter" && go({ q: (e.target as HTMLInputElement).value || undefined })} /></div>
        {canAssign && <Select className="md:w-56" value={owner} onChange={(e) => go({ owner: e.target.value || undefined })}><option value="">Everyone&apos;s leads</option><option value="me">My leads</option><option value="unassigned">Not assigned yet</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}</Select>}
      </div>

      {canAssign && sel.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-navy px-4 py-3 text-sm text-white">
          <span className="font-semibold">{sel.length} selected</span>
          <span className="opacity-70">→ give to</span>
          <Select className="h-9 w-56 text-paper" value="" disabled={pending} onChange={(e) => e.target.value && run(() => assignLeads({ businessIds: sel, userIds: [e.target.value] }), { onDone: () => setSel([]) })}>
            <option value="">Choose a person…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}
          </Select>
          <button className="underline opacity-80" onClick={() => run(() => assignLeads({ businessIds: sel, userIds: [], unassign: true }), { onDone: () => setSel([]) })}>Unassign</button>
          <button className="ml-auto underline opacity-80" onClick={() => setSel([])}>Clear</button>
        </div>
      )}

      <Card className="overflow-hidden">
        {rows.length ? (
          <ul className="divide-y divide-line">
            {canAssign && (
              <li className="flex items-center gap-3 bg-ink-2 px-4 py-2 text-xs text-mute">
                <input type="checkbox" checked={sel.length === rows.length} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])} /> Select all on this page
              </li>
            )}
            {rows.map((b) => {
              const wa = b.whatsapp_e164 ?? (b.phone_e164 && (b.phone_type === "MOBILE" || b.phone_type === "FIXED_LINE_OR_MOBILE") ? b.phone_e164 : null);
              return (
                <li key={b.id} className={cx("flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center", sel.includes(b.id) && "bg-signal-tint/40")}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {canAssign && <input type="checkbox" checked={sel.includes(b.id)} onChange={() => setSel((s) => (s.includes(b.id) ? s.filter((x) => x !== b.id) : [...s, b.id]))} />}
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy-tint text-sm font-bold text-navy">{b.name.slice(0, 1).toUpperCase()}</div>
                    <div className="min-w-0">
                      <Link href={`/leads/${b.id}`} className="block truncate font-semibold hover:underline">{b.name}</Link>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-mute">
                        <span className="truncate">{[b.category_label, b.area ?? b.city].filter(Boolean).join(" · ")}</span>
                        {b.google_rating != null && <span>★ {b.google_rating} ({b.google_review_count})</span>}
                        {b.tier === "HOT" && <Badge tone="signal">Hot</Badge>}
                        {b.website_status === "NO_WEBSITE" && <Badge tone="warn">No website</Badge>}
                        {b.next_follow_up_at && <span className={cx(Date.parse(b.next_follow_up_at) < Date.now() && "font-semibold text-signal-ink")}>Follow-up {fmtDate(b.next_follow_up_at)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    {wa && <a href={whatsappUrl(wa)!} target="_blank" rel="noreferrer" title="WhatsApp" className="grid h-9 w-9 place-items-center rounded-full bg-[#25D366] text-white"><MessageCircle size={16} /></a>}
                    {b.phone_e164 && <a href={`tel:${b.phone_e164}`} title={b.phone_formatted ?? b.phone_e164} className="grid h-9 w-9 place-items-center rounded-full bg-paper text-white"><Phone size={15} /></a>}
                    <select disabled={!canEdit || pending} value={b.pipeline_stage} onChange={(e) => run(() => updateStage(b.id, e.target.value))}
                      className={cx("h-9 rounded-full border-0 px-3 text-xs font-semibold", STAGE_COLOR[b.pipeline_stage])}>
                      {STAGES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
                    </select>
                    {canAssign ? (
                      <select value={b.owner_id ?? ""} disabled={pending} onChange={(e) => run(() => e.target.value ? assignLeads({ businessIds: [b.id], userIds: [e.target.value] }) : assignLeads({ businessIds: [b.id], userIds: [], unassign: true }))}
                        className="h-9 w-36 rounded-full border border-line-strong bg-ink-3 px-3 text-xs">
                        <option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}
                      </select>
                    ) : b.owner_id && <span className="text-xs text-mute">{userName(b.owner_id)}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-6 py-16 text-center">
            <div className="text-lg font-semibold">No leads here yet</div>
            <p className="mt-1 text-sm text-mute">{canAdd ? "Import your list or find businesses on Google Maps." : "Your manager will assign leads to you."}</p>
            {canAdd && <ButtonLink href="/add" variant="primary" className="mt-4"><Plus size={16} />Add leads</ButtonLink>}
          </div>
        )}
      </Card>
      {count > per && (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? <button className="underline" onClick={() => go({ page: String(page - 1) })}>← Previous</button> : <span />}
          <span className="text-mute">Page {page} of {Math.ceil(count / per)}</span>
          {page * per < count ? <button className="underline" onClick={() => go({ page: String(page + 1) })}>Next →</button> : <span />}
        </div>
      )}
    </div>
  );
}
