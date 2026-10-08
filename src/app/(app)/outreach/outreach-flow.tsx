"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ArrowRight, CalendarClock, CheckCircle2, Copy, ExternalLink, Flame, Globe, Mail, MapPin, MessageCircle, Phone, PhoneOff, SkipForward, Star, ThumbsDown, ThumbsUp, Users } from "lucide-react";
import { Badge, ButtonLink, Card, Textarea, cx } from "@/components/ui";
import { useToast } from "@/components/client";
import { WebsiteBadge } from "@/components/lead-bits";
import { quickOutcome, type QuickOutcome } from "@/app/actions/leads";
import { whatsappUrl } from "@/lib/normalize/phone";
import type { QueueLead } from "@/lib/leads/outreach-queue";

export function OutreachFlow({ queue, doneToday, firstName }: { queue: QueueLead[]; doneToday: number; firstName: string }) {
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useToast();
  const lead = queue[idx];
  const msg = lead ? messages[lead.id] ?? lead.message : "";
  const completed = Object.keys(done).length;
  const goNext = () => setIdx((i) => Math.min(i + 1, queue.length));
  const record = (outcome: QuickOutcome, label: string) => start(async () => {
    const r = await quickOutcome({ businessId: lead.id, outcome, message: msg });
    if (!r.ok) return toast(r.error, "err");
    toast(r.message ?? "Saved");
    setDone((d) => ({ ...d, [lead.id]: label }));
    goNext();
  });
  const unverifiedWa = lead && !lead.whatsapp_e164 && lead.phone_e164 && (lead.phone_type === "MOBILE" || lead.phone_type === "FIXED_LINE_OR_MOBILE") ? lead.phone_e164 : null;
  const waNumber = lead?.whatsapp_e164 ?? unverifiedWa;
  const progress = queue.length ? Math.round((completed / queue.length) * 100) : 0;
  const followUps = useMemo(() => queue.filter((q) => q.reason === "FOLLOW_UP").length, [queue]);

  if (!queue.length) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-ok-tint text-ok"><CheckCircle2 size={30} /></div>
        <h1 className="display text-4xl">All clear, {firstName}!</h1>
        <p className="mt-3 text-mute">No follow-ups due and no new leads waiting for you. Ask your manager to assign more leads, or check the pipeline.</p>
        <div className="mt-6 flex justify-center gap-2"><ButtonLink href="/pipeline" variant="dark">Open pipeline</ButtonLink><ButtonLink href="/leads" variant="outline">All my leads</ButtonLink></div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="hero-bg relative overflow-hidden rounded-3xl px-6 py-6 text-white md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="tag-mono text-[11px] text-white/60">Start outreach</div>
            <h1 className="display mt-1 text-3xl md:text-4xl">{idx < queue.length ? `Lead ${idx + 1} of ${queue.length}` : "Session complete 🎉"}</h1>
            <p className="mt-1 text-sm text-white/70">{followUps} follow-up{followUps === 1 ? "" : "s"} due · {queue.length - followUps} new leads · {doneToday + completed} contacted today</p>
          </div>
          <div className="w-full max-w-xs">
            <div className="mb-1 flex justify-between text-xs text-white/70"><span>Session progress</span><span>{completed}/{queue.length}</span></div>
            <div className="h-2 rounded-full bg-white/15"><div className="h-2 rounded-full bg-signal transition-all duration-500" style={{ width: `${progress}%` }} /></div>
          </div>
        </div>
      </section>

      {idx >= queue.length ? (
        <Card className="p-10 text-center">
          <CheckCircle2 className="mx-auto text-ok" size={40} />
          <h2 className="mt-3 text-2xl font-bold">Great work — {completed} lead{completed === 1 ? "" : "s"} handled.</h2>
          <p className="mt-1 text-mute">Follow-ups were scheduled automatically. They&apos;ll show up here on the right day.</p>
          <div className="mt-5 flex justify-center gap-2"><ButtonLink href="/follow-ups" variant="dark">See follow-ups</ButtonLink><ButtonLink href="/pipeline" variant="outline">Pipeline</ButtonLink></div>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
          <Card className="overflow-hidden">
            <div className="border-b border-line bg-ink-2/60 px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                {lead.reason === "FOLLOW_UP" ? <Badge tone="warn"><CalendarClock size={11} /> Follow-up due</Badge> : <Badge tone="signal"><Flame size={11} /> New lead</Badge>}
                {lead.tier && <Badge tone={lead.tier === "HOT" ? "signal" : "navy"}>{lead.tier} · {lead.lead_score}</Badge>}
                <WebsiteBadge status={lead.website_status} />
              </div>
              <h2 className="mt-3 text-2xl font-extrabold tracking-tight md:text-3xl">{lead.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-mute">
                {lead.category_label && <span>{lead.category_label}</span>}
                {(lead.area || lead.city) && <span className="inline-flex items-center gap-1"><MapPin size={13} />{[lead.area, lead.city].filter(Boolean).join(", ")}</span>}
                {lead.google_rating != null && <span className="inline-flex items-center gap-1"><Star size={13} className="fill-current text-warn" />{lead.google_rating} ({lead.google_review_count} reviews)</span>}
              </div>
              {lead.followUpNote && <p className="mt-2 text-sm text-warn">{lead.followUpNote}</p>}
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-2">
              <div>
                <div className="tag-mono mb-2 text-[10.5px] text-mute">Step 1 · Why call them</div>
                <ul className="space-y-2 text-[14px]">
                  {lead.talkingPoints.map((p, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />{p}</li>)}
                </ul>
                <div className="tag-mono mb-2 mt-6 text-[10.5px] text-mute">Step 2 · Reach out</div>
                <div className="grid grid-cols-2 gap-2">
                  {waNumber ? (
                    <a href={whatsappUrl(waNumber, msg)!} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-3 py-3 text-sm font-semibold text-white hover:brightness-95">
                      <MessageCircle size={17} />WhatsApp{!lead.whatsapp_e164 && <span className="text-[10px] font-normal opacity-80">(try)</span>}
                    </a>
                  ) : <div className="grid place-items-center rounded-xl border border-dashed border-line-strong px-3 py-3 text-xs text-dim">No WhatsApp</div>}
                  {lead.phone_e164 ? <a href={`tel:${lead.phone_e164}`} className="flex items-center justify-center gap-2 rounded-xl bg-paper px-3 py-3 text-sm font-semibold text-white hover:bg-navy"><Phone size={16} />Call</a>
                    : <div className="grid place-items-center rounded-xl border border-dashed border-line-strong px-3 py-3 text-xs text-dim">No phone</div>}
                </div>
                {lead.phone_e164 && <div className="mt-2 text-center font-mono text-sm">{lead.phone_formatted ?? lead.phone_e164}</div>}
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {lead.instagram && <a className="inline-flex items-center gap-1 rounded-full border border-line-strong px-3 py-1 hover:border-paper" href={lead.instagram} target="_blank" rel="noreferrer"><Users size={12} />Instagram</a>}
                  {lead.facebook && <a className="inline-flex items-center gap-1 rounded-full border border-line-strong px-3 py-1 hover:border-paper" href={lead.facebook} target="_blank" rel="noreferrer"><Users size={12} />Facebook</a>}
                  {lead.email && <a className="inline-flex items-center gap-1 rounded-full border border-line-strong px-3 py-1 hover:border-paper" href={`mailto:${lead.email}?subject=${encodeURIComponent(`Website for ${lead.name}`)}&body=${encodeURIComponent(msg)}`}><Mail size={12} />Email</a>}
                  {lead.google_maps_url && <a className="inline-flex items-center gap-1 rounded-full border border-line-strong px-3 py-1 hover:border-paper" href={lead.google_maps_url} target="_blank" rel="noreferrer"><MapPin size={12} />Maps</a>}
                  {lead.website_url && <a className="inline-flex items-center gap-1 rounded-full border border-line-strong px-3 py-1 hover:border-paper" href={lead.website_url} target="_blank" rel="noreferrer"><Globe size={12} />Website</a>}
                  <Link className="inline-flex items-center gap-1 rounded-full border border-line-strong px-3 py-1 hover:border-paper" href={`/leads/${lead.id}`} target="_blank"><ExternalLink size={12} />Full profile</Link>
                </div>
              </div>
              <div>
                <div className="tag-mono mb-2 flex items-center justify-between text-[10.5px] text-mute"><span>Your message (edit freely)</span>
                  <button className="inline-flex items-center gap-1 normal-case tracking-normal text-paper underline" onClick={() => { navigator.clipboard.writeText(msg); toast("Message copied"); }}><Copy size={12} />Copy</button></div>
                <Textarea rows={11} value={msg} onChange={(e) => setMessages((m) => ({ ...m, [lead.id]: e.target.value }))} className="text-[14px] leading-relaxed" />
                <p className="mt-1 text-[11px] text-dim">Built only from verified facts about this business. The WhatsApp button opens with this message pre-filled.</p>
              </div>
            </div>

            <div className="border-t border-line bg-ink-2/60 px-6 py-5">
              <div className="tag-mono mb-3 text-[10.5px] text-mute">Step 3 · What happened? (saves and moves to the next lead)</div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                {([
                  ["WHATSAPP_SENT", "Message sent", MessageCircle, "bg-ok text-white"],
                  ["NO_ANSWER", "No answer", PhoneOff, "bg-ink-3 border border-line-strong"],
                  ["REPLIED", "They replied", CheckCircle2, "bg-navy text-white"],
                  ["CALLED_INTERESTED", "Interested!", ThumbsUp, "bg-signal text-white"],
                  ["MEETING", "Meeting booked", CalendarClock, "bg-paper text-white"],
                  ["NOT_INTERESTED", "Not interested", ThumbsDown, "bg-ink-3 border border-line-strong"],
                ] as const).map(([o, label, Icon, cls]) => (
                  <button key={o} disabled={pending} onClick={() => record(o, label)} className={cx("flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-[13px] font-semibold transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50", cls)}>
                    <Icon size={18} />{label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <button disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))} className="text-mute underline disabled:opacity-30">← Previous</button>
                <button onClick={goNext} className="inline-flex items-center gap-1 text-mute hover:text-paper"><SkipForward size={14} />Skip for now</button>
              </div>
            </div>
          </Card>

          <Card className="h-fit overflow-hidden">
            <div className="border-b border-line px-4 py-3 text-sm font-semibold">Today&apos;s queue</div>
            <ol className="scroll-thin max-h-[70vh] overflow-y-auto">
              {queue.map((q, i) => (
                <li key={q.id}>
                  <button onClick={() => setIdx(i)} className={cx("flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left text-sm", i === idx ? "border-signal bg-signal-tint" : "border-transparent hover:bg-ink-2")}>
                    <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold", done[q.id] ? "bg-ok text-white" : q.reason === "FOLLOW_UP" ? "bg-warn-tint text-warn" : "bg-ink-4")}>{done[q.id] ? "✓" : i + 1}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{q.name}</span><span className="block truncate text-xs text-mute">{done[q.id] ?? (q.reason === "FOLLOW_UP" ? "Follow-up" : q.why.slice(0, 2).join(" · "))}</span></span>
                    {i === idx && <ArrowRight size={14} className="text-signal" />}
                  </button>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </div>
  );
}
