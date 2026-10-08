"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Field, Input, NotConfigured, Select, Textarea, cx } from "@/components/ui";
import { useToast } from "@/components/client";
import { interpretQuery, aiToCriteria, startSearch, saveSearchTemplate, type Interpreted } from "@/app/actions/search";
import { describeLocation, OPPORTUNITY_TYPES, type SearchCriteriaInput, type LocationSpec } from "@/lib/search/criteria";
import { human } from "@/lib/format";

interface Cat { key: string; name: string; synonyms: string[] }
interface Prov { key: string; name: string; description?: string; state: string }

const WEB = ["NO_WEBSITE", "OUTDATED", "BROKEN", "POOR", "MOBILE_ISSUE", "SLOW", "GOOD"] as const;
const TARGETS = [50, 100, 200, 300, 500, 1000];
const EXAMPLES = [
  "Find small cleaning companies in Dubai with 20+ reviews, no website, active Instagram and WhatsApp.",
  "Find flower shops in Sharjah with outdated websites and at least 30 Google reviews.",
  "Find restaurants around Al Barsha with no website or very poor mobile websites.",
  "Salons within 10 km of Downtown Dubai with 4.5 stars, no franchises",
];

function emptyCriteria(): SearchCriteriaInput {
  return { categories: [], keywords: [], excludeKeywords: [], locations: [], business: { sizes: [], franchise: "INCLUDE", activeOnly: true }, digital: { website: ["ANY"], instagram: "ANY", facebook: "ANY" }, contact: { whatsapp: "ANY", phone: "ANY", email: "ANY", social: "ANY" }, opportunities: [], quality: {}, output: { targetCount: 100, depth: "BALANCED" }, providers: [], coverage: { skipRecentlySearchedDays: 14, splitLargeAreas: true } };
}

export function SearchBuilder({ categories, providers, enrichment, aiConfigured, defaultCountry, template, initialQuery, prefill, canSchedule }: {
  categories: Cat[]; providers: Prov[]; enrichment: Prov[]; aiConfigured: boolean; defaultCountry: string; template: { id: string; name: string; criteria: unknown } | null; initialQuery: string;
  prefill: { location?: string; category?: string; polygon: { lat: number; lng: number }[] | null }; canSchedule: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState(initialQuery || (template?.criteria as SearchCriteriaInput | undefined)?.naturalQuery || "");
  const [useAi, setUseAi] = useState(aiConfigured);
  const [interp, setInterp] = useState<Interpreted | null>(null);
  const [c, setC] = useState<SearchCriteriaInput>(() => {
    const base = (template?.criteria as SearchCriteriaInput) ?? emptyCriteria();
    const out = { ...emptyCriteria(), ...base };
    if (prefill.location) out.locations = [{ label: prefill.location, kind: "NAMED", countryCode: defaultCountry }];
    if (prefill.polygon?.length) out.locations = [{ label: "Drawn map area", kind: "POLYGON", polygon: prefill.polygon }];
    if (prefill.category) { const cat = categories.find((x) => x.key === prefill.category); if (cat) out.categories = [{ key: cat.key, label: cat.name, terms: [cat.name, ...cat.synonyms] }]; }
    return out;
  });
  const [stage, setStage] = useState<"edit" | "preview">("edit");
  const [templateName, setTemplateName] = useState(template?.name ?? "");
  const [pending, start] = useTransition();
  const set = (patch: Partial<SearchCriteriaInput>) => setC((x) => ({ ...x, ...patch }));
  const setIn = <K extends keyof SearchCriteriaInput>(k: K, patch: Record<string, unknown>) => setC((x) => ({ ...x, [k]: { ...(x[k] as object), ...patch } }));

  const interpret = () => start(async () => {
    const r = await interpretQuery(query, useAi);
    if (!r.ok) return toast(r.error, "err");
    setInterp(r.data!);
    setC({ ...emptyCriteria(), ...r.data!.rule.criteria });
  });
  const useAiVersion = () => start(async () => { if (interp?.ai) setC(await aiToCriteria(interp.ai, query)); });

  const readyProviders = providers.filter((p) => p.state === "READY");
  const chosenProviders = c.providers?.length ? c.providers : readyProviders.map((p) => p.key);
  const workload = useMemo(() => {
    const termsPer = c.output?.depth === "DEEP" ? 3 : c.output?.depth === "BALANCED" ? 2 : 1;
    return c.categories.length * Math.max(1, c.locations.length) * chosenProviders.length * termsPer;
  }, [c, chosenProviders.length]);

  const launch = (saveAs?: string) => start(async () => {
    const r = await startSearch({ criteria: { ...c, naturalQuery: query || undefined }, saveAs: saveAs ?? null, searchId: template?.id ?? null });
    if (!r.ok) return toast(r.error, "err");
    router.push(`/searches/${r.data!.jobId}`);
  });
  const saveTemplate = () => start(async () => {
    if (!templateName.trim()) return toast("Name the template first", "err");
    const r = await saveSearchTemplate({ id: template?.id, name: templateName, criteria: { ...c, naturalQuery: query || undefined } });
    toast(r.ok ? "Template saved" : r.error, r.ok ? "ok" : "err");
  });

  const toggleCat = (cat: Cat) => setC((x) => ({ ...x, categories: x.categories.some((k) => k.key === cat.key) ? x.categories.filter((k) => k.key !== cat.key) : [...x.categories, { key: cat.key, label: cat.name, terms: [cat.name, ...cat.synonyms] }] }));
  const valid = c.categories.length > 0 && c.locations.length > 0;

  return (
    <div className="space-y-6">
      <section className="hero-bg overflow-hidden rounded-3xl p-6 text-white md:p-10">
        <div className="tag-mono mb-4 inline-flex rounded-full border border-white/25 px-3 py-1 text-[11px] text-white/80">01 · Lead search</div>
        <h1 className="display text-4xl md:text-6xl">FIND NEW<br />BUSINESS LEADS</h1>
        <div className="mt-6 rounded-2xl bg-white/10 p-2 backdrop-blur">
          <Textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={2} placeholder="What businesses are you looking for?" className="border-0 bg-transparent text-lg text-white placeholder:text-white/50" />
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1">
            <label className="flex items-center gap-2 text-sm text-white/80"><input type="checkbox" checked={useAi} disabled={!aiConfigured} onChange={(e) => setUseAi(e.target.checked)} /> AI-assisted interpretation {!aiConfigured && <span className="text-white/50">(not configured)</span>}</label>
            <Button variant="primary" onClick={interpret} disabled={pending || query.trim().length < 3}>{pending ? "Interpreting…" : "Interpret search →"}</Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => <button key={e} onClick={() => setQuery(e)} className="rounded-full border border-white/20 px-3 py-1 text-left text-xs text-white/70 hover:border-white/60 hover:text-white">{e}</button>)}
        </div>
      </section>

      {interp && (
        <Card>
          <CardHeader eyebrow="Interpreted criteria" title="Here is how the search was understood — review before running" />
          <div className="grid gap-6 p-5 md:grid-cols-2">
            <div>
              <div className="tag-mono mb-2 text-[11px] text-mute">Rule-based</div>
              <ul className="space-y-1.5 text-sm">
                {interp.rule.interpretations.map((i, k) => <li key={k} className="flex gap-2"><span className="w-36 shrink-0 font-medium">{i.field}</span><span>{i.value}</span><span className="text-dim">“{i.phrase}”</span></li>)}
              </ul>
              {interp.rule.warnings.map((w) => <p key={w} className="mt-2 rounded-lg bg-warn-tint px-3 py-2 text-sm text-warn">{w}</p>)}
              {!!interp.rule.unparsed.length && <p className="mt-2 text-xs text-mute">Not understood: {interp.rule.unparsed.map((u) => `“${u}”`).join(", ")}</p>}
            </div>
            <div>
              <div className="tag-mono mb-2 text-[11px] text-mute">AI-assisted <Badge tone="navy">AI</Badge></div>
              {interp.ai ? (
                <>
                  <ul className="space-y-1 text-sm">{interp.ai.explanation.map((e) => <li key={e}>• {e}</li>)}</ul>
                  {!!interp.ai.assumptions.length && <div className="mt-2 text-xs text-mute">Assumptions: {interp.ai.assumptions.join("; ")}</div>}
                  <Button variant="outline" size="sm" className="mt-3" onClick={useAiVersion}>Use AI interpretation</Button>
                </>
              ) : <p className="text-sm text-mute">{interp.aiError ?? "Not requested."}</p>}
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader eyebrow="Business" title="What" />
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat) => {
                  const on = c.categories.some((k) => k.key === cat.key);
                  return <button key={cat.key} onClick={() => toggleCat(cat)} className={cx("rounded-full border px-3 py-1 text-[13px]", on ? "border-paper bg-paper text-white" : "border-line-strong hover:border-paper")}>{cat.name}</button>;
                })}
              </div>
              <CustomNiche onAdd={(label, terms) => set({ categories: [...c.categories, { label, terms }] })} />
              {c.categories.map((cat, i) => (
                <div key={i} className="rounded-xl bg-ink-2 p-3 text-sm">
                  <div className="flex items-center justify-between"><span className="font-medium">{cat.label}</span><button className="text-xs text-mute underline" onClick={() => set({ categories: c.categories.filter((_, j) => j !== i) })}>remove</button></div>
                  <div className="mt-1 text-xs text-mute">Expanded terms: {(cat.terms ?? []).slice(0, 12).join(", ")}</div>
                </div>
              ))}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Extra keywords (comma separated)"><Input value={(c.keywords ?? []).join(", ")} onChange={(e) => set({ keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></Field>
                <Field label="Exclude (negative keywords)"><Input value={(c.excludeKeywords ?? []).join(", ")} onChange={(e) => set({ excludeKeywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="industrial cleaning, government" /></Field>
                <Field label="Minimum Google rating"><Input type="number" step="0.1" min="0" max="5" value={c.business?.minRating ?? ""} onChange={(e) => setIn("business", { minRating: e.target.value ? Number(e.target.value) : undefined })} /></Field>
                <Field label="Minimum reviews"><Input type="number" min="0" value={c.business?.minReviews ?? ""} onChange={(e) => setIn("business", { minReviews: e.target.value ? Number(e.target.value) : undefined })} /></Field>
                <Field label="Business size (observable signals)">
                  <div className="flex flex-wrap gap-1.5">
                    {["MICRO", "SMALL", "MEDIUM", "LARGE", "UNKNOWN"].map((sz) => {
                      const on = c.business?.sizes?.includes(sz as never);
                      return <button key={sz} onClick={() => setIn("business", { sizes: on ? c.business!.sizes!.filter((x) => x !== sz) : [...(c.business?.sizes ?? []), sz] })} className={cx("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-paper bg-paper text-white" : "border-line-strong")}>{human(sz)}</button>;
                    })}
                  </div>
                </Field>
                <Field label="Franchises"><Select value={c.business?.franchise ?? "INCLUDE"} onChange={(e) => setIn("business", { franchise: e.target.value })}><option value="INCLUDE">Include</option><option value="EXCLUDE">Exclude</option><option value="PREFER">Prefer independents</option><option value="ONLY">Franchises only</option></Select></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.business?.activeOnly ?? true} onChange={(e) => setIn("business", { activeOnly: e.target.checked })} /> Only active (not permanently closed) businesses</label>
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Location" title="Where" action={<a href="/map?draw=1" className="text-sm underline">Draw on map</a>} />
            <div className="space-y-3 p-5">
              {c.locations.map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-ink-2 px-3 py-2 text-sm">
                  <span>{describeLocation(l as LocationSpec)} {l.splitIntoSubAreas && <Badge tone="navy">split into sub-areas</Badge>}</span>
                  <button className="text-xs text-mute underline" onClick={() => set({ locations: c.locations.filter((_, j) => j !== i) })}>remove</button>
                </div>
              ))}
              <AddLocation defaultCountry={defaultCountry} onAdd={(l) => set({ locations: [...c.locations, l] })} />
              <p className="text-xs text-dim">Works for any country, city, district, neighbourhood or postcode. Add several locations (e.g. Dubai + Sharjah + Ajman) in one search.</p>
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Digital presence & contactability" title="Opportunity filters" />
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label="Website" className="md:col-span-2">
                <div className="flex flex-wrap gap-1.5">
                  {["ANY", ...WEB].map((w) => {
                    const cur = c.digital?.website ?? ["ANY"];
                    const on = cur.includes(w as never);
                    return <button key={w} onClick={() => setIn("digital", { website: w === "ANY" ? ["ANY"] : on ? (cur.filter((x) => x !== w).length ? cur.filter((x) => x !== w) : ["ANY"]) : [...cur.filter((x) => x !== "ANY"), w] })} className={cx("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-signal bg-signal text-white" : "border-line-strong")}>{human(w)}</button>;
                  })}
                </div>
              </Field>
              <Field label="Instagram"><Select value={c.digital?.instagram ?? "ANY"} onChange={(e) => setIn("digital", { instagram: e.target.value })}><option value="ANY">Any</option><option value="PRESENT">Has profile</option><option value="ACTIVE">Active (verified)</option><option value="INACTIVE">Inactive / none</option></Select></Field>
              <Field label="Facebook"><Select value={c.digital?.facebook ?? "ANY"} onChange={(e) => setIn("digital", { facebook: e.target.value })}><option value="ANY">Any</option><option value="PRESENT">Has page</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive / none</option></Select></Field>
              <Field label="WhatsApp"><Select value={c.contact?.whatsapp ?? "ANY"} onChange={(e) => setIn("contact", { whatsapp: e.target.value })}><option value="ANY">Any</option><option value="PREFERRED">Preferred</option><option value="REQUIRED">Required</option></Select></Field>
              <Field label="Phone"><Select value={c.contact?.phone ?? "ANY"} onChange={(e) => setIn("contact", { phone: e.target.value })}><option value="ANY">Any</option><option value="REQUIRED">Required</option></Select></Field>
              <Field label="Email"><Select value={c.contact?.email ?? "ANY"} onChange={(e) => setIn("contact", { email: e.target.value })}><option value="ANY">Any</option><option value="PREFERRED">Preferred</option><option value="REQUIRED">Required</option></Select></Field>
              <Field label="Social media"><Select value={c.contact?.social ?? "ANY"} onChange={(e) => setIn("contact", { social: e.target.value })}><option value="ANY">Any</option><option value="REQUIRED">Required</option></Select></Field>
              <Field label="Max website score (0–100)"><Input type="number" min="0" max="100" value={c.digital?.maxWebsiteScore ?? ""} onChange={(e) => setIn("digital", { maxWebsiteScore: e.target.value ? Number(e.target.value) : undefined })} /></Field>
              <Field label="Min lead score"><Input type="number" min="0" max="100" value={c.quality?.minLeadScore ?? ""} onChange={(e) => setIn("quality", { minLeadScore: e.target.value ? Number(e.target.value) : undefined })} /></Field>
              <Field label="Sales opportunity focus" className="md:col-span-2">
                <div className="flex flex-wrap gap-1.5">
                  {OPPORTUNITY_TYPES.map((o) => {
                    const on = c.opportunities?.includes(o);
                    return <button key={o} onClick={() => set({ opportunities: on ? c.opportunities!.filter((x) => x !== o) : [...(c.opportunities ?? []), o] })} className={cx("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-navy bg-navy text-white" : "border-line-strong")}>{human(o)}</button>;
                  })}
                </div>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Output" title="How much & how deep" />
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label="Target qualified leads" hint="Quality beats quantity: only businesses that qualify are returned, even if fewer than the target.">
                <div className="flex flex-wrap gap-1.5">
                  {TARGETS.map((t) => <button key={t} onClick={() => setIn("output", { targetCount: t })} className={cx("rounded-full border px-3 py-1 text-sm", c.output?.targetCount === t ? "border-paper bg-paper text-white" : "border-line-strong")}>{t.toLocaleString()}</button>)}
                  <Input type="number" min={1} max={5000} className="w-24" value={c.output?.targetCount ?? 100} onChange={(e) => setIn("output", { targetCount: Number(e.target.value) || 100 })} />
                </div>
              </Field>
              <Field label="Research depth">
                <div className="grid grid-cols-3 gap-2">
                  {[["FAST", "Identity, phone, maps, rating, reviews"], ["BALANCED", "+ website check, social, WhatsApp, opportunity"], ["DEEP", "+ full audit, PageSpeed, Instagram activity, AI analysis"]].map(([d, desc]) => (
                    <button key={d} onClick={() => setIn("output", { depth: d })} className={cx("rounded-xl border p-2 text-left", c.output?.depth === d ? "border-signal bg-signal-tint" : "border-line-strong")}>
                      <div className="text-sm font-semibold">{human(d)}</div><div className="text-[11px] text-mute">{desc}</div>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Skip areas searched in the last (days)"><Input type="number" min={0} max={365} value={c.coverage?.skipRecentlySearchedDays ?? 14} onChange={(e) => setIn("coverage", { skipRecentlySearchedDays: Number(e.target.value) })} /></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={c.coverage?.splitLargeAreas ?? true} onChange={(e) => setIn("coverage", { splitLargeAreas: e.target.checked })} /> Split large areas into cells for better coverage</label>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="sticky top-20">
            <CardHeader eyebrow="Search preview" title={stage === "preview" ? "Ready to run" : "Summary"} />
            <div className="space-y-3 p-5 text-sm">
              <Row k="Categories" v={c.categories.map((x) => x.label).join(", ") || "—"} />
              <Row k="Locations" v={c.locations.map((l) => describeLocation(l as LocationSpec)).join(" + ") || "—"} />
              <Row k="Quality" v={[c.business?.minRating && `≥${c.business.minRating}★`, c.business?.minReviews && `≥${c.business.minReviews} reviews`, c.business?.franchise === "EXCLUDE" && "no franchises"].filter(Boolean).join(", ") || "Any"} />
              <Row k="Website" v={(c.digital?.website ?? ["ANY"]).map(human).join(" or ")} />
              <Row k="Contact" v={[c.contact?.whatsapp !== "ANY" && `WhatsApp ${human(c.contact?.whatsapp)}`, c.digital?.instagram !== "ANY" && `Instagram ${human(c.digital?.instagram)}`].filter(Boolean).join(", ") || "Any"} />
              <Row k="Target" v={`${c.output?.targetCount ?? 100} qualified · ${human(c.output?.depth ?? "BALANCED")}`} />
              <div>
                <div className="tag-mono mb-1 text-[10.5px] text-mute">Data providers</div>
                {providers.map((p) => (
                  <label key={p.key} className="flex items-center justify-between gap-2 py-0.5">
                    <span className="flex items-center gap-2"><input type="checkbox" disabled={p.state !== "READY"} checked={p.state === "READY" && chosenProviders.includes(p.key)} onChange={(e) => set({ providers: e.target.checked ? [...chosenProviders, p.key] : chosenProviders.filter((k) => k !== p.key) })} />{p.name}</span>
                    <Badge tone={p.state === "READY" ? "ok" : "warn"}>{human(p.state)}</Badge>
                  </label>
                ))}
                <div className="mt-2 space-y-0.5 text-xs text-mute">{enrichment.map((p) => <div key={p.key}>{p.name}: {p.state === "READY" ? "ready" : human(p.state).toLowerCase()}</div>)}</div>
              </div>
              {!readyProviders.length && <NotConfigured what="No discovery provider is configured">An admin must configure Google Places, Apify or enable OpenStreetMap in Admin → Providers.</NotConfigured>}
              <Row k="Estimated workload" v={`~${workload} provider queries before area splitting (more for large areas). Paid providers bill per request.`} />
              {stage === "edit" ? (
                <Button variant="dark" className="w-full" disabled={!valid} onClick={() => setStage("preview")}>Preview search</Button>
              ) : (
                <div className="space-y-2">
                  <Button variant="primary" size="lg" className="w-full" disabled={pending || !valid || !readyProviders.length} onClick={() => launch()}>{pending ? "Starting…" : "START LEAD SEARCH →"}</Button>
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => setStage("edit")}>Back to edit</Button>
                </div>
              )}
              <div className="border-t border-line pt-3">
                <Field label="Save as template"><Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Dubai No Website Cleaning Leads" /></Field>
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" disabled={!valid || pending} onClick={saveTemplate}>{template ? "Update template" : "Save template"}</Button>
                  <Button variant="outline" size="sm" disabled={!valid || pending || !templateName} onClick={() => launch(templateName)}>Save & run</Button>
                </div>
                {canSchedule && <p className="mt-2 text-xs text-dim">Schedule recurring runs from Search History after saving.</p>}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div><div className="tag-mono text-[10.5px] text-mute">{k}</div><div>{v}</div></div>;
}

function CustomNiche({ onAdd }: { onAdd: (label: string, terms: string[]) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="Custom niche, e.g. yacht charter, abaya boutiques" />
      <Button variant="outline" disabled={v.trim().length < 3} onClick={() => { onAdd(v.trim().replace(/\b\w/g, (x) => x.toUpperCase()), [v.trim()]); setV(""); }}>Add</Button>
    </div>
  );
}

function AddLocation({ defaultCountry, onAdd }: { defaultCountry: string; onAdd: (l: LocationSpec) => void }) {
  const [label, setLabel] = useState("");
  const [radius, setRadius] = useState("");
  const [country, setCountry] = useState(defaultCountry);
  const [split, setSplit] = useState(false);
  return (
    <div className="grid gap-2 md:grid-cols-[1fr_110px_80px_auto]">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="City, area, neighbourhood or postcode (e.g. Al Barsha, Dubai)" />
      <Input value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="Radius km" type="number" min="0.5" step="0.5" />
      <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder="AE" title="Country code hint" />
      <Button variant="outline" disabled={label.trim().length < 2} onClick={() => {
        onAdd(radius ? { label: label.trim(), kind: "RADIUS", radiusM: Math.round(Number(radius) * 1000), countryCode: country || undefined } : { label: label.trim(), kind: "NAMED", countryCode: country || undefined, splitIntoSubAreas: split || undefined });
        setLabel(""); setRadius("");
      }}>Add</Button>
      <label className="flex items-center gap-2 text-xs text-mute md:col-span-4"><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Bulk research: split a city into its known sub-areas (e.g. Dubai → Marina, JVC, Al Barsha, Deira…)</label>
    </div>
  );
}
