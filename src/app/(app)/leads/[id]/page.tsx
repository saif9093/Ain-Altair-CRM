import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ContactLinks, IntentBadge, TierBadge, WebsiteBadge } from "@/components/lead-bits";
import { buildOutreachMessage } from "@/lib/intel/outreach";
import { CONF_TONE, fmtDate, fmtRelative, human, money } from "@/lib/format";
import { opportunityLabel } from "@/lib/intel/opportunities";
import { LeadSidebar, Outreach, NotesBox, Reprocess, MergePanel, OverridePanel, PricingPanel } from "./lead-client";

export const metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireUser();
  const { id } = await params;
  const db = await createClient();
  const { data: b } = await db.from("businesses").select("*, owner:profiles!businesses_owner_id_fkey(id, full_name, email), business_socials(*)").eq("id", id).single();
  if (!b) notFound();
  const [{ data: opps }, { data: audit }, { data: sources }, { data: notes }, { data: fus }, { data: acts }, { data: outreach }, { data: dups }, { data: users }, { data: teams }, { data: tags }, { data: pricing }] = await Promise.all([
    db.from("opportunities").select("*").eq("business_id", id).order("priority", { ascending: false }),
    db.from("website_audits").select("*").eq("business_id", id).order("audited_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("business_field_sources").select("field, value, provider, source_url, confidence, retrieved_at, is_current").eq("business_id", id).order("retrieved_at", { ascending: false }).limit(60),
    db.from("notes").select("*, author:profiles!notes_author_id_fkey(full_name, email)").eq("business_id", id).order("created_at", { ascending: false }),
    db.from("follow_ups").select("*").eq("business_id", id).order("due_at"),
    db.from("activities").select("*").eq("business_id", id).order("created_at", { ascending: false }).limit(60),
    db.from("outreach").select("*, user:profiles!outreach_user_id_fkey(full_name, email)").eq("business_id", id).order("created_at", { ascending: false }),
    db.from("duplicate_candidates").select("id, confidence, reasons, business_a, business_b, a:businesses!duplicate_candidates_business_a_fkey(id, name, lead_code, phone_e164, website_domain, city, lifecycle), b:businesses!duplicate_candidates_business_b_fkey(id, name, lead_code, phone_e164, website_domain, city, lifecycle)").eq("status", "OPEN").or(`business_a.eq.${id},business_b.eq.${id}`),
    s.can("leads.assign") ? db.from("profiles").select("id, full_name, email").eq("status", "ACTIVE").order("full_name") : Promise.resolve({ data: [] }),
    db.from("teams").select("id, name"),
    db.from("lead_tags").select("tags(name)").eq("business_id", id),
    db.from("lead_pricing").select("*").eq("business_id", id).maybeSingle(), // RLS: null for BDOs
  ]);
  const ai = b.ai_analysis as null | { summary: string; observed_facts: string[]; inferences: string[]; business_opportunity: string; problem: string; why_contact: string; recommended_service: string; potential_upsells: string[]; sales_angle: string; urgency: string; outreach_message: string; data_gaps: string[] };
  const ig = (b.business_socials as { platform: string }[]).some((x) => x.platform === "INSTAGRAM");
  const message = ai?.outreach_message ?? buildOutreachMessage({ businessName: b.name, area: b.area, city: b.city, categoryLabel: b.category_label, rating: b.google_rating, reviewCount: b.google_review_count, websiteStatus: b.website_status, websiteIssues: b.website_issues, websiteDomain: b.website_domain, instagramPresent: ig, senderName: s.fullName?.split(" ")[0] });
  const breakdown = (b.lead_score_breakdown ?? {}) as { components?: { key: string; label: string; points: number; max: number; reason: string }[]; signals?: { size: string[]; franchise: string[] } };
  const intent = (b.sales_intent_factors ?? {}) as { factors?: { label: string; points: number; max: number; reason: string }[] };
  const fc = (b.field_confidence ?? {}) as Record<string, { confidence: string; provider: string; at: string }>;
  const evidence = ((audit?.evidence ?? []) as { code: string; label: string; detail: string; source: string; observedAt?: string; measured?: boolean }[]);
  const noWebEvidence = b.website_status === "NO_WEBSITE" ? (opps ?? []).flatMap((o) => (o.evidence ?? []) as typeof evidence).filter((e) => e.code === "NO_WEBSITE") : [];
  const overrides = (b.overrides ?? {}) as Record<string, { value: unknown; byEmail: string; at: string; reason: string }>;

  return (
    <div className="space-y-6">
      {b.lifecycle !== "ACTIVE" && <div className="rounded-2xl bg-warn-tint px-4 py-3 text-sm text-warn">This record is in <b>{human(b.lifecycle)}</b>{b.lifecycle === "RESEARCH" ? " — it is not in the CRM until approved from a search's results." : "."}{b.merged_into && <> Merged into <Link className="underline" href={`/leads/${b.merged_into}`}>surviving record</Link>.</>}</div>}
      <PageHeader eyebrow={`${b.lead_code} · ${b.category_label ?? "Uncategorised"}`} title={b.name}
        description={<span className="flex flex-wrap items-center gap-2"><TierBadge tier={b.tier} score={b.lead_score} /><IntentBadge v={b.sales_intent} /><WebsiteBadge status={b.website_status} /><span>{[b.area, b.city, b.country].filter(Boolean).join(", ")}</span>{b.google_rating && <span>· {b.google_rating}★ ({b.google_review_count})</span>}{(tags ?? []).map((t, i) => <Badge key={i} tone="navy">{(t.tags as unknown as { name: string }).name}</Badge>)}</span>} />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader eyebrow="Contact" title="Reach out" />
            <div className="space-y-4 p-5">
              <ContactLinks b={b as never} message={message} />
              {!b.whatsapp_e164 && b.phone_e164 && (b.phone_type === "MOBILE" || b.phone_type === "FIXED_LINE_OR_MOBILE") && <p className="text-xs text-mute">No verified WhatsApp. The listed number is a mobile number — WhatsApp availability is unverified.</p>}
              <Outreach businessId={id} message={message} whatsapp={b.whatsapp_e164} aiMessage={!!ai?.outreach_message} canLog={s.can("outreach.log")} />
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Why this business?" title={b.recommended_service ? `What to sell: ${b.recommended_service}` : "Opportunity"} />
            <div className="space-y-4 p-5">
              {ai ? (
                <div className="rounded-xl border border-navy/20 bg-navy-tint p-4 text-sm">
                  <div className="mb-2 flex items-center gap-2"><Badge tone="navy">AI summary</Badge><span className="text-xs text-mute">Inference based on observed facts · {fmtRelative(b.ai_generated_at)}</span></div>
                  <p>{ai.summary}</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div><div className="tag-mono text-[10px] text-mute">Observed facts</div><ul className="mt-1 list-disc pl-4">{ai.observed_facts.map((f, i) => <li key={i}>{f}</li>)}</ul></div>
                    <div><div className="tag-mono text-[10px] text-mute">AI inferences</div><ul className="mt-1 list-disc pl-4 italic">{ai.inferences.map((f, i) => <li key={i}>{f}</li>)}</ul></div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2"><div><b>Problem:</b> {ai.problem}</div><div><b>Why contact:</b> {ai.why_contact}</div><div><b>Sales angle:</b> {ai.sales_angle}</div><div><b>Upsells:</b> {ai.potential_upsells.join(", ")}</div></div>
                  {!!ai.data_gaps.length && <div className="mt-2 text-xs text-warn">Verify before contact: {ai.data_gaps.join("; ")}</div>}
                </div>
              ) : <p className="text-sm text-mute">No AI analysis yet. Rule-based opportunities below are derived from observed data.</p>}
              <div className="space-y-2">
                {(opps ?? []).map((o) => (
                  <div key={o.id} className="rounded-xl bg-ink-2 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{opportunityLabel(o.type)}</span><Badge tone={o.priority >= 75 ? "signal" : "neutral"}>Priority {o.priority}</Badge>{o.is_override && <Badge tone="warn">Override</Badge>}<Badge>{human(o.status)}</Badge></div>
                    <div className="mt-1 text-mute">{o.reason}</div>
                  </div>
                ))}
                {!opps?.length && <p className="text-sm text-mute">No opportunities computed yet.</p>}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Evidence" title="Why we believe this" />
            <div className="space-y-2 p-5 text-sm">
              {[...noWebEvidence, ...evidence].map((e, i) => (
                <div key={i} className="flex gap-3 rounded-xl border border-line p-3">
                  <Badge tone={e.measured ? "ok" : "neutral"}>{e.measured ? "Measured" : "Observed"}</Badge>
                  <div><div className="font-medium">{e.label}</div><div className="text-mute">{e.detail}</div><div className="text-xs text-dim">Source: {e.source}{e.observedAt ? ` · ${fmtDate(e.observedAt, true)}` : ""}</div></div>
                </div>
              ))}
              {!evidence.length && !noWebEvidence.length && <p className="text-mute">No website evidence recorded yet{b.website_url ? " — run a website audit." : "."}</p>}
              {audit && (
                <div className="grid grid-cols-2 gap-2 pt-2 text-xs md:grid-cols-4">
                  {[["HTTP", audit.http_status], ["HTTPS", audit.https], ["Viewport", audit.has_viewport], ["CTA", audit.has_cta], ["WhatsApp", audit.has_whatsapp], ["Form", audit.has_form], ["Booking", audit.has_booking], ["Services", audit.has_services], ["Title", audit.title ? "yes" : "no"], ["Meta desc.", audit.meta_description ? "yes" : "no"], ["H1", audit.h1_count], ["©", audit.copyright_year], ["Perf (mobile)", audit.performance_score], ["SEO", audit.seo_score], ["LCP", audit.lcp_ms ? `${(audit.lcp_ms / 1000).toFixed(1)}s` : null], ["Tech", (audit.technologies ?? []).join(", ")]].map(([k, v]) => (
                    <div key={String(k)} className="rounded-lg bg-ink-2 px-2 py-1"><span className="text-mute">{k}: </span>{v === true ? "yes" : v === false ? "no" : v ?? "—"}</div>
                  ))}
                  <div className="col-span-full text-dim">Audited {fmtDate(audit.audited_at, true)}{audit.perf_source ? " · Lighthouse via PageSpeed" : " · performance not measured"}</div>
                </div>
              )}
            </div>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader eyebrow="Lead score" title={`${b.lead_score ?? "—"} / 100`} />
              <div className="space-y-2 p-5 text-sm">
                {(breakdown.components ?? []).map((c) => (
                  <div key={c.key}><div className="flex justify-between"><span>{c.label}</span><span className="font-medium">{c.points}/{c.max}</span></div><div className="text-xs text-mute">{c.reason}</div></div>
                ))}
                {overrides.lead_score && <p className="text-xs text-warn">Overridden by {overrides.lead_score.byEmail} ({overrides.lead_score.reason})</p>}
                {breakdown.signals && <p className="text-xs text-dim">Size: {human(b.business_size)} ({breakdown.signals.size.join(", ")}) · Franchise: {human(b.franchise_status)} {breakdown.signals.franchise.length ? `(${breakdown.signals.franchise.join(", ")})` : ""}</p>}
              </div>
            </Card>
            <Card>
              <CardHeader eyebrow="Sales intent · AI ESTIMATE" title={`${b.sales_intent ?? "—"} / 100`} />
              <div className="space-y-2 p-5 text-sm">
                {(intent.factors ?? []).map((f) => <div key={f.label}><div className="flex justify-between"><span>{f.label}</span><span className="font-medium">{f.points}/{f.max}</span></div><div className="text-xs text-mute">{f.reason}</div></div>)}
                <p className="text-xs text-dim">Heuristic estimate of buying potential — not an objective fact.</p>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader eyebrow="Data provenance" title="Sources & confidence" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="tag-mono text-left text-[10.5px] text-mute"><tr className="border-b border-line">{["Field", "Value", "Source", "Confidence", "Retrieved"].map((h) => <th key={h} className="px-4 py-2 font-normal">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {(sources ?? []).map((r, i) => (
                    <tr key={i} className={r.is_current ? "" : "text-dim"}>
                      <td className="px-4 py-2">{human(r.field)}{r.is_current && fc[r.field] && <span className="ml-1 text-xs text-ok">current</span>}</td>
                      <td className="max-w-[240px] truncate px-4 py-2">{r.source_url ? <a href={r.source_url} target="_blank" rel="noreferrer" className="underline">{r.value}</a> : r.value}</td>
                      <td className="px-4 py-2">{human(r.provider)}</td>
                      <td className="px-4 py-2"><Badge tone={CONF_TONE[r.confidence]}>{r.confidence}</Badge></td>
                      <td className="px-4 py-2 text-xs">{fmtDate(r.retrieved_at, true)}</td>
                    </tr>
                  ))}
                  {(b.business_socials as { id: string; platform: string; url: string; source: string; confidence: string; followers: number | null; activity: string; last_post_at: string | null }[]).map((so) => (
                    <tr key={so.id}><td className="px-4 py-2">{human(so.platform)}</td><td className="px-4 py-2"><a href={so.url} target="_blank" rel="noreferrer" className="underline">{so.url.replace(/^https?:\/\/(www\.)?/, "")}</a>{so.followers != null && ` · ${so.followers.toLocaleString()} followers`} · {human(so.activity)}{so.last_post_at && ` (last post ${fmtDate(so.last_post_at)})`}</td><td className="px-4 py-2">{human(so.source)}</td><td className="px-4 py-2"><Badge tone={CONF_TONE[so.confidence]}>{so.confidence}</Badge></td><td /></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <NotesBox businessId={id} notes={(notes ?? []) as never} canWrite={s.can("notes.create")} />

          <Card>
            <CardHeader eyebrow="Timeline" title="Activity" />
            <ul className="divide-y divide-line">
              {(outreach ?? []).map((o) => <li key={o.id} className="px-5 py-2.5 text-sm"><Badge tone="ok">{o.channel}</Badge> <span className="ml-1">{o.outcome ?? "Outreach"}</span> <span className="text-xs text-mute">· {(o.user as unknown as { full_name?: string } | null)?.full_name ?? ""} · {fmtDate(o.created_at, true)}</span></li>)}
              {(acts ?? []).map((a) => <li key={a.id} className="px-5 py-2.5 text-sm"><span className="tag-mono mr-2 text-[10px] text-mute">{a.type}</span>{a.title} <span className="text-xs text-mute">· {fmtDate(a.created_at, true)}</span></li>)}
              <li className="px-5 py-2.5 text-sm text-mute">Created {fmtDate(b.created_at, true)} · source {human(b.source)}</li>
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <LeadSidebar lead={{ id, stage: b.pipeline_stage, ownerId: b.owner_id, lifecycle: b.lifecycle }} users={users ?? []} teams={teams ?? []} followUps={(fus ?? []) as never}
            perms={{ edit: s.can("leads.edit"), assign: s.can("leads.assign"), followup: s.can("outreach.log"), archive: s.can("leads.archive"), del: s.can("leads.delete_permanent") }}
            ownerName={(b.owner as { full_name?: string; email?: string } | null)?.full_name ?? (b.owner as { email?: string } | null)?.email ?? null} />
          {pricing !== null && s.can("pricing.view") && <PricingPanel businessId={id} pricing={pricing} currency={b.currency ?? "AED"} money={{ min: money(pricing?.recommended_price_min), max: money(pricing?.recommended_price_max), opp: money(pricing?.opportunity_value), deal: money(pricing?.deal_value) }} />}
          {s.can("pricing.view") && !pricing && <PricingPanel businessId={id} pricing={null} currency="AED" money={{ min: "—", max: "—", opp: "—", deal: "—" }} />}
          {s.can("leads.override") && <OverridePanel businessId={id} />}
          <Reprocess businessId={id} canResearch={s.can("research.review")} canEdit={s.can("leads.edit")} />
          {!!dups?.length && <MergePanel currentId={id} candidates={dups as never} canMerge={s.can("leads.merge")} />}
          <Card className="p-4 text-xs text-mute">
            <div>Last researched {fmtRelative(b.last_researched_at)} · last audited {fmtRelative(b.last_audited_at)}</div>
            <div>Overall source confidence: <Badge tone={CONF_TONE[b.source_confidence ?? "UNKNOWN"]}>{b.source_confidence ?? "UNKNOWN"}</Badge></div>
            <div>Website preview: {human(b.preview_status)}</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
