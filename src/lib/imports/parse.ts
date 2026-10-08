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
    const used = headers.filter((h) => !/^Column \d+$/.test(h) || rows.some((r) => r[h]));
    return { headers: used, rows: rows.map((r) => Object.fromEntries(used.map((h) => [h, r[h] ?? ""]))) };
  }
  throw new Error("Unsupported file type — upload .xlsx or .csv");
}

const SHEET_ERROR = /^#(ERROR!|N\/A|REF!|VALUE!|NAME\?|DIV\/0!|NUM!|NULL!)$/i;
const LINK_LABEL = /^(open( in)?( google)? maps?|maps?|link|view|click( here)?|website|here|visit|open)$/i;

/** Cell → text. Recovers values hidden behind broken formulas (e.g. a phone typed as "+971 4 …"). */
export function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) {
      const result = o.result;
      const resultText = result == null ? "" : typeof result === "object" ? ((result as { error?: string }).error ?? "") : String(result);
      if (!resultText || SHEET_ERROR.test(resultText)) {
        const f = String(o.formula ?? o.sharedFormula ?? "");
        // A formula that is really a literal (phone numbers typed with a leading +)
        if (/^[+\d\s()-]{6,}$/.test(f)) return f.startsWith("+") ? f : f.replace(/^=/, "");
        return "";
      }
      return resultText;
    }
    if ("hyperlink" in o && typeof o.hyperlink === "string") {
      const t = o.text == null ? "" : typeof o.text === "string" ? o.text : cellText(o.text as ExcelJS.CellValue);
      return !t.trim() || LINK_LABEL.test(t.trim()) ? o.hyperlink : t;
    }
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return cellText(o.text as ExcelJS.CellValue);
    if ("error" in o) return "";
  }
  const str = String(v);
  return SHEET_ERROR.test(str.trim()) ? "" : str;
}
