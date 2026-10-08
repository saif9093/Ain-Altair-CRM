"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, FileSpreadsheet, Loader2, MapPin, Search, Upload } from "lucide-react";
import { Button, Card, Input, Select, cx } from "@/components/ui";
import { useAction, useToast } from "@/components/client";
import { quickConfigureImport, runImport } from "@/app/actions/imports";
import { moveAllResearchToCrm, quickFind } from "@/app/actions/simple";

type User = { id: string; full_name: string | null; email: string };

export function AddLeads({ canImport, canFind, research, users }: { canImport: boolean; canFind: boolean; research: number; users: User[] }) {
  const { run, pending } = useAction();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="eyebrow mb-2">Add leads</div>
        <h1 className="display text-4xl">Get leads into the CRM</h1>
        <p className="mt-2 text-mute">Two ways. Both put leads straight into your Leads list — ready for your team to contact.</p>
      </div>
      {research > 0 && (
        <Card className="flex flex-col gap-3 border-signal/40 p-5 md:flex-row md:items-center md:justify-between">
          <div><b>{research} leads</b> from earlier searches/imports are waiting outside the CRM.</div>
          <Button variant="primary" disabled={pending} onClick={() => run(() => moveAllResearchToCrm())}>Add all {research} to my Leads</Button>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {canImport && <ImportCard users={users} />}
        {canFind ? <FindCard users={users} /> : (
          <Card className="p-6 text-sm text-mute">Finding businesses on Google Maps isn&apos;t available for your account. Ask an admin.</Card>
        )}
      </div>
    </div>
  );
}

function AssignSelect({ users, value, onChange }: { users: User[]; value: string; onChange: (v: string) => void }) {
  if (!users.length) return null;
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-mute">Give these leads to (optional)</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}><option value="">Nobody yet — I&apos;ll assign later</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}</Select>
    </label>
  );
}

function ImportCard({ users }: { users: User[] }) {
  const [mode, setMode] = useState<"link" | "file">("link");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [tabs, setTabs] = useState<{ name: string; rows: number; headers: string[] }[] | null>(null);
  const [summary, setSummary] = useState<{ id: string; rows: number; newCount: number; updateCount: number; skipped: number } | null>(null);
  const [assign, setAssign] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  const read = async (tab?: string) => {
    const fd = new FormData();
    if (mode === "file") { if (!file) return toast("Choose a file", "err"); fd.set("file", file); }
    else { if (!url.trim()) return toast("Paste your Google Sheet link", "err"); fd.set("sheetUrl", url.trim()); }
    if (tab) fd.set("sheet", tab);
    setBusy(true);
    const r = await fetch("/api/imports", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); return toast(j.error ?? "Could not read the sheet", "err"); }
    if (j.needsSheet) {
      setBusy(false);
      // Auto-pick when exactly one tab has a business name column
      const withName = (j.sheets as { name: string; headers: string[] }[]).filter((t) => t.headers.some((h) => /company|business name|^name$|shop name/i.test(h)));
      if (withName.length === 1) return read(withName[0].name);
      return setTabs(j.sheets);
    }
    const c = await quickConfigureImport(j.id);
    setBusy(false);
    if (!c.ok) return toast(c.error, "err");
    if (!c.data!.hasName) { toast("We couldn't find the business name column — please pick it", "err"); return router.push(`/imports/${j.id}`); }
    setTabs(null);
    setSummary({ id: j.id, ...c.data! });
  };

  const go = async () => {
    if (!summary) return;
    setBusy(true);
    const r = await runImport(summary.id, assign || null);
    setBusy(false);
    if (!r.ok) return toast(r.error, "err");
    router.push(`/imports/${summary.id}`);
  };

  return (
    <Card className="flex flex-col p-6">
      <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-ok-tint text-ok"><FileSpreadsheet size={20} /></div><div><h2 className="text-lg font-bold">Import your list</h2><p className="text-sm text-mute">Google Sheet link or Excel / CSV file</p></div></div>
      {!summary ? (
        <div className="mt-5 space-y-3">
          <div className="flex gap-1 rounded-full bg-ink-4 p-1 text-sm">
            {(["link", "file"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={cx("flex-1 rounded-full py-1.5", mode === m ? "bg-ink-3 font-semibold shadow-sm" : "text-mute")}>{m === "link" ? "Google Sheet link" : "Upload file"}</button>)}
          </div>
          {mode === "link" ? (
            <>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="h-12" />
              <p className="text-xs text-mute">Sheet must be shared as “Anyone with the link”. First row = column names.</p>
            </>
          ) : (
            <button onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line-strong px-4 py-8 text-sm hover:border-paper">
              <Upload size={20} />{file ? file.name : "Choose an .xlsx or .csv file"}
              <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </button>
          )}
          {tabs && (
            <div className="rounded-xl bg-ink-2 p-3 text-sm">
              <div className="mb-2 font-medium">Which tab?</div>
              <div className="flex flex-wrap gap-2">
                {tabs.map((t) => <Button key={t.name} size="sm" variant="outline" disabled={busy} onClick={() => read(t.name)}>{t.name} · {t.rows}</Button>)}
                <Button size="sm" variant="dark" disabled={busy} onClick={() => read("__all__")}>All tabs</Button>
              </div>
            </div>
          )}
          <Button variant="primary" size="lg" className="w-full" disabled={busy} onClick={() => read()}>{busy ? <><Loader2 size={16} className="animate-spin" />Reading…</> : "Check my list →"}</Button>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-ok-tint p-3"><div className="text-2xl font-extrabold text-ok">{summary.newCount}</div><div className="text-xs text-mute">new leads</div></div>
            <div className="rounded-xl bg-navy-tint p-3"><div className="text-2xl font-extrabold text-navy">{summary.updateCount}</div><div className="text-xs text-mute">already in CRM (updated)</div></div>
            <div className="rounded-xl bg-ink-4 p-3"><div className="text-2xl font-extrabold">{summary.skipped}</div><div className="text-xs text-mute">skipped (no name / repeats)</div></div>
          </div>
          <AssignSelect users={users} value={assign} onChange={setAssign} />
          <Button variant="primary" size="lg" className="w-full" disabled={busy || summary.newCount + summary.updateCount === 0} onClick={go}>{busy ? "Starting…" : `Import ${summary.newCount + summary.updateCount} leads →`}</Button>
          <div className="flex justify-between text-xs"><Link href={`/imports/${summary.id}`} className="underline">See details / change columns</Link><button className="underline" onClick={() => setSummary(null)}>Start over</button></div>
        </div>
      )}
    </Card>
  );
}

function FindCard({ users }: { users: User[] }) {
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [count, setCount] = useState(50);
  const [noWeb, setNoWeb] = useState(false);
  const [assign, setAssign] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const { run, pending } = useAction();
  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (r.ok) setJob(await r.json());
    }, 3000);
    return () => clearInterval(t);
  }, [jobId]);
  const status = String(job?.status ?? "QUEUED");
  const done = ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"].includes(status);
  const found = Number(job?.retained_count ?? 0);
  const enriched = Number(job?.enriched_count ?? 0);

  return (
    <Card className="flex flex-col p-6">
      <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-signal-tint text-signal"><MapPin size={20} /></div><div><h2 className="text-lg font-bold">Find new businesses</h2><p className="text-sm text-mute">Search Google Maps — results go straight into Leads</p></div></div>
      {!jobId ? (
        <div className="mt-5 space-y-3">
          <label className="block text-sm"><span className="mb-1 block text-mute">What kind of business?</span><Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. salons, cleaning companies, restaurants" className="h-12" /></label>
          <label className="block text-sm"><span className="mb-1 block text-mute">Where?</span><Input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="e.g. Al Barsha, Dubai" className="h-12" /></label>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-mute">How many:</span>
            {[25, 50, 100, 200].map((n) => <button key={n} onClick={() => setCount(n)} className={cx("rounded-full border px-3 py-1", count === n ? "border-paper bg-paper text-white" : "border-line-strong")}>{n}</button>)}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noWeb} onChange={(e) => setNoWeb(e.target.checked)} /> Only businesses with no website</label>
          <AssignSelect users={users} value={assign} onChange={setAssign} />
          <Button variant="primary" size="lg" className="w-full" disabled={pending || what.trim().length < 2 || where.trim().length < 2}
            onClick={() => run(() => quickFind({ what, where, count, noWebsiteOnly: noWeb, assignTo: assign || null }), { refresh: false, success: "Search started", onDone: (d) => setJobId((d as { jobId: string }).jobId) })}>
            <Search size={16} />{pending ? "Starting…" : "Find businesses →"}
          </Button>
        </div>
      ) : (
        <div className="mt-6 space-y-4 text-center">
          {done ? <CheckCircle2 className="mx-auto text-ok" size={40} /> : <Loader2 className="mx-auto animate-spin text-signal" size={40} />}
          <div className="text-lg font-semibold">{done ? (status === "FAILED" ? "Search failed" : `Done — ${found} businesses added to Leads`) : found ? `Found ${found} so far… checking websites (${enriched}/${found})` : "Searching Google Maps…"}</div>
          {!done && <p className="text-sm text-mute">This usually takes 1–3 minutes. You can leave this page; it keeps running.</p>}
          {Boolean(job?.error) && <p className="text-sm text-signal-ink">{String(job?.error)}</p>}
          <div className="flex justify-center gap-2">
            {done && <Link href="/leads?sort=newest" className="inline-flex h-10 items-center rounded-full bg-signal px-5 text-sm font-medium text-white">See the new leads →</Link>}
            <Button variant="outline" onClick={() => { setJobId(null); setJob(null); }}>New search</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
