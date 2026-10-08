"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Link2, Upload } from "lucide-react";
import { Button, Card, Input, cx } from "@/components/ui";
import { useToast } from "@/components/client";

export function UploadForm({ sheets }: { sheets: boolean }) {
  const [tab, setTab] = useState<"file" | "sheet">("sheet");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  const submit = async () => {
    const fd = new FormData();
    if (tab === "file") { if (!file) return toast("Choose a file first", "err"); fd.set("file", file); }
    else { if (!url.trim()) return toast("Paste a Google Sheets link", "err"); fd.set("sheetUrl", url.trim()); }
    setBusy(true);
    const r = await fetch("/api/imports", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(j.error ?? "Import failed", "err");
    router.push(`/imports/${j.id}`);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex border-b border-line">
        {([["sheet", "Google Sheet link", Link2], ["file", "Upload Excel / CSV", FileSpreadsheet]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={cx("flex flex-1 items-center justify-center gap-2 px-4 py-3.5 text-sm font-medium transition", tab === k ? "border-b-2 border-signal bg-ink-3 text-paper" : "text-mute hover:bg-ink-2")}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>
      <div className="p-6">
        {tab === "sheet" ? (
          <div className="space-y-3">
            <label className="block text-sm font-medium">Paste your Google Sheets link</label>
            <div className="flex flex-col gap-2 md:flex-row">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="h-12 flex-1 text-[15px]" />
              <Button variant="primary" size="lg" disabled={busy} onClick={submit}>{busy ? "Reading sheet…" : "Import from sheet →"}</Button>
            </div>
            <div className="rounded-xl bg-navy-tint px-4 py-3 text-sm text-navy">
              <b>Make the sheet viewable:</b> in Google Sheets click <b>Share</b> → General access → <b>Anyone with the link</b> (Viewer). The first row must contain column headers. The tab in your link (gid) is the one imported.
              {sheets && <span className="block text-xs opacity-80">Private sheets also work if shared with the configured service account.</span>}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
              onClick={() => input.current?.click()}
              className={cx("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition", drag ? "border-signal bg-signal-tint" : "border-line-strong hover:border-paper hover:bg-ink-2")}>
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-ink-4"><Upload size={20} /></div>
              <div className="font-medium">{file ? file.name : "Drop an .xlsx or .csv file here, or click to choose"}</div>
              <div className="text-xs text-mute">{file ? `${(file.size / 1024).toFixed(0)} KB` : "Max 15 MB · first row = column headers"}</div>
              <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="flex justify-end"><Button variant="primary" size="lg" disabled={busy || !file} onClick={submit}>{busy ? "Reading…" : "Upload & map columns →"}</Button></div>
          </div>
        )}
        <ol className="mt-6 grid gap-3 text-sm md:grid-cols-3">
          {["Paste link or upload", "Check column mapping & duplicates", "Import into CRM"].map((t, i) => (
            <li key={t} className="flex items-center gap-3 rounded-xl bg-ink-2 px-4 py-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-paper text-xs font-bold text-white">{i + 1}</span>{t}</li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
