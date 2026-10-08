import { JWT } from "google-auth-library";

/** Google Sheets via a service account (optional interoperability; Supabase stays the source of truth). */
export function sheetsConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

function jwt() {
  if (!sheetsConfigured()) throw new Error("Google Sheets is not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)");
  return new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"],
  });
}

export function sheetIdFromUrl(url: string): string {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error("Not a Google Sheets URL");
  return m[1];
}

export async function readSheet(url: string): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const client = jwt();
  const id = sheetIdFromUrl(url);
  const res = await client.request<{ values?: string[][] }>({ url: `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:ZZ20001` });
  const values = res.data.values ?? [];
  const headers = (values[0] ?? []).map((h, i) => h?.trim() || `Column ${i + 1}`);
  const rows = values.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))).filter((r) => Object.values(r).some(Boolean));
  return { headers, rows };
}

export async function writeNewSheet(title: string, headers: string[], rows: (string | number | null)[][]): Promise<string> {
  const client = jwt();
  const created = await client.request<{ spreadsheetId: string; spreadsheetUrl: string }>({
    url: "https://sheets.googleapis.com/v4/spreadsheets", method: "POST",
    data: { properties: { title }, sheets: [{ properties: { title: "Leads", gridProperties: { frozenRowCount: 1 } } }] },
  });
  const id = created.data.spreadsheetId;
  await client.request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/Leads!A1:append?valueInputOption=USER_ENTERED`, method: "POST",
    data: { values: [headers, ...rows.map((r) => r.map((v) => (v == null ? "" : v)))] },
  });
  const share = process.env.GOOGLE_SHEETS_SHARE_WITH;
  if (share) {
    for (const email of share.split(",").map((e) => e.trim()).filter(Boolean)) {
      await client.request({ url: `https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false`, method: "POST", data: { type: "user", role: "writer", emailAddress: email } });
    }
  }
  return created.data.spreadsheetUrl;
}
