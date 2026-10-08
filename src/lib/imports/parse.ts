import ExcelJS from "exceljs";
import Papa from "papaparse";

export interface ParsedSheet { headers: string[]; rows: Record<string, string>[] }

const MAX_ROWS = 20_000;

export async function parseUpload(buffer: ArrayBuffer, filename: string): Promise<ParsedSheet> {
  if (/\.csv$/i.test(filename)) {
    const text = new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, "");
    const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    return { headers: (res.meta.fields ?? []).filter(Boolean), rows: res.data.slice(0, MAX_ROWS) };
  }
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) return { headers: [], rows: [] };
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (headers[i - 1] = cellText(c.value).trim() || `Column ${i}`));
    const rows: Record<string, string>[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1 || rows.length >= MAX_ROWS) return;
      const r: Record<string, string> = {};
      headers.forEach((h, i) => (r[h] = cellText(row.getCell(i + 1).value).trim()));
      if (Object.values(r).some(Boolean)) rows.push(r);
    });
    return { headers, rows };
  }
  throw new Error("Unsupported file type — upload .xlsx or .csv");
}

export function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("hyperlink" in v && typeof v.hyperlink === "string") return (v as { text?: string }).text ?? v.hyperlink;
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return String(v.result ?? "");
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
}
