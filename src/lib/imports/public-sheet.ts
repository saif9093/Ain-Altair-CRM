import Papa from "papaparse";
import { parseUpload } from "./parse";

/**
 * Import from a PUBLIC Google Sheet with no Google credentials. Supports
 * normal share links (…/d/<id>/edit#gid=…) and "Publish to web" links
 * (…/d/e/<pubId>/pubhtml). Tries the CSV export first, then the gviz CSV
 * endpoint. Only docs.google.com is ever requested.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export function sheetCandidates(url: string): string[] {
  let u: URL;
  try { u = new URL(url.trim()); } catch { throw new Error("That is not a valid link"); }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com" || !u.pathname.startsWith("/spreadsheets/")) {
    throw new Error("Paste a Google Sheets link (https://docs.google.com/spreadsheets/d/…)");
  }
  const gid = u.searchParams.get("gid") ?? u.hash.match(/gid=(\d+)/)?.[1] ?? null;
  const g = gid ? `&gid=${gid}` : "";
  const pub = u.pathname.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
  if (pub) return [`https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${g}`];
  const id = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) throw new Error("Could not find the sheet ID in that link");
  return [
    // .xlsx export keeps original cell values (incl. text hidden behind broken formulas); first tab only
    ...(!gid || gid === "0" ? [`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`] : []),
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${g || "&gid=0"}`,
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${g}`,
    // Uploaded Excel files opened in Sheets (rtpof=true): download the original .xlsx
    `https://drive.google.com/uc?export=download&id=${id}`,
  ];
}

export async function readPublicSheet(url: string, opts: { sheet?: string | null; onWorkbook?: (buf: ArrayBuffer) => void } = {}): Promise<{ headers: string[]; rows: Record<string, string>[]; title: string }> {
  const attempts: string[] = [];
  for (const candidate of sheetCandidates(url)) {
    let res: Response;
    try {
      res = await fetch(candidate, { redirect: "follow", headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      attempts.push(`network error (${(e as Error).message})`);
      continue;
    }
    const type = res.headers.get("content-type") ?? "";
    const landed = new URL(res.url).hostname;
    if (!res.ok || type.includes("text/html") || landed === "accounts.google.com") {
      attempts.push(`HTTP ${res.status}${landed === "accounts.google.com" ? " (sign-in required)" : type.includes("text/html") ? " (HTML page)" : ""}`);
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    if (candidate.includes("drive.google.com") || candidate.includes("format=xlsx") || /spreadsheetml|octet-stream/.test(type)) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 15 * 1024 * 1024) throw new Error("Sheet is too large (max 15 MB)");
      opts.onWorkbook?.(buf);
      const x = await parseUpload(buf, "sheet.xlsx", opts.sheet).catch(() => null);
      if (!x || !x.headers.length) { attempts.push("xlsx export unreadable"); continue; }
      return { ...x, title: "Google Sheet" };
    }
    const text = (await res.text()).replace(/^﻿/, "");
    if (text.length > 15 * 1024 * 1024) throw new Error("Sheet is too large (max 15 MB)");
    const out = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    // Drop blank trailing columns (PapaParse renames empty duplicate headers to _1, _2…)
    const headers = (out.meta.fields ?? []).filter((h) => h && h.trim() && !/^_\d+$/.test(h));
    const rows = out.data
      .map((r) => Object.fromEntries(headers.map((h) => { const v = String(r[h] ?? "").trim(); return [h, /^#(ERROR!|N\/A|REF!|VALUE!|NAME\?|DIV\/0!)$/i.test(v) ? "" : v]; })))
      .filter((r) => Object.values(r).some(Boolean))
      .slice(0, 20_000);
    if (!headers.length) throw new Error("The sheet is empty or the first row has no column headers");
    const disp = res.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1];
    return { headers, rows, title: disp ? decodeURIComponent(disp).replace(/\.csv$/i, "") : "Google Sheet" };
  }
  throw new Error(`Google didn't allow access to this sheet (${attempts.join("; ")}). In Google Sheets click Share → General access → “Anyone with the link” (Viewer). If your Google Workspace blocks public sharing, use File → Download → .xlsx and upload the file instead.`);
}
