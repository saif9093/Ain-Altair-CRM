"use client";
import Link from "next/link";
import { Fragment, useState } from "react";
import { Badge, Button, Select } from "@/components/ui";
import { useAction } from "@/components/client";
import { ContactLinks, TierBadge, WebsiteBadge } from "@/components/lead-bits";
import { approveResults, rejectResults, moveToReview } from "@/app/actions/search";
import { human, STAGE_TONE } from "@/lib/format";

type Row = { id: string; stage: string; is_new: boolean; matched_existing: boolean; changes: { title: string }[]; sources: string[]; reject_reason: string | null; qualification: { checks?: { label: string; outcome: string; detail: string }[] };
  businesses: { id: string; lead_code: string; name: string; category_label: string | null; area: string | null; city: string | null; google_rating: number | null; google_review_count: number | null; website_status: string; lead_score: number | null; sales_intent: number | null; tier: string | null; recommended_service: string | null; whatsapp_e164: string | null; phone_e164: string | null; email: string | null; google_maps_url: string | null; website_url: string | null; business_socials: { platform: string; url: string }[] } };
const REASONS = ["DUPLICATE", "LARGE_COMPANY", "FRANCHISE", "NO_CONTACT", "NOT_RELEVANT", "EXCELLENT_WEBSITE", "CLOSED", "INVALID", "LOW_QUALITY", "OTHER"];

export function ResultsTable({ jobId, rows, total, page, stage, users, canApprove, canReview }: { jobId: string; rows: Row[]; total: number; page: number; stage: string; users: { id: string; full_name: string | null; email: string }[]; canApprove: boolean; canReview: boolean; searchSummary: string }) {
  const [sel, setSel] = useState<string[]>([]);
  const [reason, setReason] = useState("NOT_RELEVANT");
  const [assignTo, setAssignTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { run, pending } = useAction();
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const approve = (all: boolean) => run(() => approveResults({ jobId, resultIds: all ? undefined : sel, allQualified: all, assignTo: assignTo ? [assignTo] : undefined }), {
    onDone: (d) => { const r = d as { approved: number; blocked: { name: string; missing: string[] }[] }; if (r.blocked.length) alert(`${r.approved} approved. ${r.blocked.length} blocked by quality gates:\n` + r.blocked.slice(0, 10).map((b) => `• ${b.name}: ${b.missing.join(", ")}`).join("\n")); setSel([]); },
    success: "Approved to CRM",
  });
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-sm">
        <span className="text-mute">{sel.length ? `${sel.length} selected` : `${total} results`}</span>
        {canApprove && (<>
          {!!users.length && <Select className="h-8 w-48 text-xs" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}><option value="">Assign on approve: rules</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}</Select>}
          <Button size="sm" variant="primary" disabled={pending || !sel.length} onClick={() => approve(false)}>Approve to CRM</Button>
          <Button size="sm" variant="dark" disabled={pending} onClick={() => confirm("Approve every QUALIFIED result into the CRM?") && approve(true)}>Approve all qualified</Button>
        </>)}
        {canReview && (<>
          <Select className="h-8 w-44 text-xs" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{human(r)}</option>)}</Select>
          <Button size="sm" variant="outline" disabled={pending || !sel.length} onClick={() => run(() => rejectResults({ resultIds: sel, reason }), { onDone: () => setSel([]) })}>Reject</Button>
          <Button size="sm" variant="ghost" disabled={pending || !sel.length} onClick={() => run(() => moveToReview(sel), { onDone: () => setSel([]) })}>Mark for review</Button>
        </>)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="tag-mono text-left text-[10.5px] text-mute"><tr className="border-b border-line"><th className="w-8 px-3 py-2"><input type="checkbox" checked={sel.length === rows.length && rows.length > 0} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])} /></th>{["Business", "Rating", "Website", "Score", "Opportunity", "Contact", "Stage"].map((h) => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const b = r.businesses;
              return (
                <Fragment key={r.id}>
                  <tr className="align-top hover:bg-ink-2">
                    <td className="px-3 py-3"><input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td className="px-3 py-3"><Link href={`/leads/${b.id}`} className="font-medium hover:underline">{b.name}</Link><div className="text-xs text-mute">{[b.category_label, b.area ?? b.city].filter(Boolean).join(" · ")}</div>
                      <div className="mt-1 flex flex-wrap gap-1">{r.is_new && <Badge tone="signal">New</Badge>}{r.matched_existing && <Badge>Already known</Badge>}{r.changes?.map((c, i) => <Badge key={i} tone="warn">{c.title}</Badge>)}{r.sources.map((s) => <Badge key={s} tone="navy">{s.replace("_", " ")}</Badge>)}</div></td>
                    <td className="px-3 py-3 whitespace-nowrap">{b.google_rating ?? "—"}★ <span className="text-mute">({b.google_review_count ?? 0})</span></td>
                    <td className="px-3 py-3"><WebsiteBadge status={b.website_status} /></td>
                    <td className="px-3 py-3"><TierBadge tier={b.tier} score={b.lead_score} /></td>
                    <td className="px-3 py-3 text-xs">{b.recommended_service ?? "—"}</td>
                    <td className="px-3 py-3"><ContactLinks b={b} /></td>
                    <td className="px-3 py-3"><Badge tone={STAGE_TONE[r.stage]}>{human(r.stage)}</Badge>{r.reject_reason && <div className="text-xs text-mute">{human(r.reject_reason)}</div>}
                      {!!r.qualification?.checks?.length && <button onClick={() => setOpen(open === r.id ? null : r.id)} className="mt-1 block text-xs underline">why?</button>}</td>
                  </tr>
                  {open === r.id && (
                    <tr><td /><td colSpan={7} className="px-3 pb-3"><div className="grid gap-1 rounded-xl bg-ink-2 p-3 text-xs md:grid-cols-2">{r.qualification.checks!.map((c, i) => <div key={i}><Badge tone={c.outcome === "PASS" ? "ok" : c.outcome === "FAIL" ? "signal" : "warn"}>{c.outcome}</Badge> {c.label} — <span className="text-mute">{c.detail}</span></div>)}</div></td></tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="px-5 py-10 text-center text-mute">No results in this stage{stage === "QUALIFIED" ? " yet" : ""}.</td></tr>}
          </tbody>
        </table>
      </div>
      {total > 50 && (
        <div className="flex justify-between px-5 py-3 text-sm">
          {page > 1 ? <Link href={`/searches/${jobId}?stage=${stage}&page=${page - 1}`} className="underline">← Previous</Link> : <span />}
          <span className="text-mute">Page {page} of {Math.ceil(total / 50)}</span>
          {page * 50 < total ? <Link href={`/searches/${jobId}?stage=${stage}&page=${page + 1}`} className="underline">Next →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
