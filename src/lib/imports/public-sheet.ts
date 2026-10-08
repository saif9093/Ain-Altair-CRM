import Papa from "papaparse";
import { sheetIdFromUrl } from "./sheets";

/**
 * Import from a PUBLIC Google Sheet ("Anyone with the link can view") with no
 * Google credentials: uses the sheet's CSV export. Only docs.google.com URLs
 * are accepted, so this cannot be used to fetch arbitrary hosts.
 */
export async function readPublicSheet(url: string): Promise<{ headers: string[]; rows: Record<string, string>[]; title: string }> {
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { throw new Error("That is not a valid link"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "docs.google.com") throw new Error("Paste a Google Sheets link (https://docs.google.com/spreadsheets/d/…)");
  const id = sheetIdFromUrl(url);
  const gid = parsed.searchParams.get("gid") ?? parsed.hash.match(/gid=(\d+)/)?.[1] ?? "0";
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const type = res.headers.get("content-type") ?? "";
  if (res.status === 401 || res.status === 403 || res.status === 404 || type.includes("text/html")) {
    throw new Error("Google didn't allow access to this sheet. In Google Sheets click Share → General access → “Anyone with the link” (Viewer), then try again.");
  }
  if (!res.ok) throw new Error(`Google Sheets returned HTTP ${res.status}`);
  const text = (await res.text()).replace(/^﻿/, "");
  if (text.length > 15 * 1024 * 1024) throw new Error("Sheet is too large (max 15 MB)");
  const out = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = (out.meta.fields ?? []).filter(Boolean);
  const rows = out.data.filter((r) => Object.values(r).some((v) => String(v ?? "").trim())).slice(0, 20_000);
  const disp = res.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1];
  return { headers, rows, title: disp ? decodeURIComponent(disp).replace(/\.csv$/i, "") : "Google Sheet" };
}
