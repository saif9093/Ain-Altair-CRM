import ExcelJS from "exceljs";
import Papa from "papaparse";

export interface ParsedSheet { headers: string[]; rows: Record<string, string>[] }
export interface SheetInfo { name: string; rows: number; headers: string[] }

const MAX_ROWS = 20_000;
export const ALL_TABS = "__all__";

function sheetToRows(ws: ExcelJS.Worksheet): ParsedSheet {
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (headers[i - 1] = cellText(c.value).trim() || `Column ${i}`));
  // de-duplicate header names
  const seen = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i] ?? `Column ${i + 1}`;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    headers[i] = n > 1 ? `${h} (${n})` : h;
  }
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

/** List the tabs of a workbook (name, data rows, headers). */
export async function listSheets(buffer: ArrayBuffer): Promise<SheetInfo[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets.map((ws) => { const p = sheetToRows(ws); return { name: ws.name, rows: p.rows.length, headers: p.headers }; }).filter((s) => s.rows > 0);
}

/**
 * Parse an upload. For workbooks, `sheet` picks a tab by name; ALL_TABS combines
 * every tab (columns unioned by header name, with a "Source tab" column).
 */
export async function parseUpload(buffer: ArrayBuffer, filename: string, sheet?: string | null): Promise<ParsedSheet> {
  if (/\.csv$/i.test(filename)) {
    const text = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
    const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    return { headers: (res.meta.fields ?? []).filter(Boolean), rows: res.data.slice(0, MAX_ROWS) };
  }
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheets = wb.worksheets.filter((ws) => ws.actualRowCount > 1);
    if (!sheets.length) return { headers: [], rows: [] };
    if (sheet === ALL_TABS) {
      const headers: string[] = ["Source tab"];
      const rows: Record<string, string>[] = [];
      for (const ws of sheets) {
        const p = sheetToRows(ws);
        for (const h of p.headers) if (!headers.includes(h)) headers.push(h);
        for (const r of p.rows) if (rows.length < MAX_ROWS) rows.push({ "Source tab": ws.name, ...r });
      }
      return { headers, rows: rows.map((r) => Object.fromEntries(headers.map((h) => [h, r[h] ?? ""]))) };
    }
    const ws = (sheet && sheets.find((w) => w.name === sheet)) || sheets[0];
    return sheetToRows(ws);
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
