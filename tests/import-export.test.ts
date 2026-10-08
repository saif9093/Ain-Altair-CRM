import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { suggestMapping } from "@/lib/imports/mapping";
import { mapRow, validateRow } from "@/lib/imports/execute";
import { allowedColumns, EXPORT_COLUMNS } from "@/lib/exports/columns";
import { buildCsv, buildXlsx, exportFilename } from "@/lib/exports/build";

describe("import column mapping", () => {
  it("maps common spreadsheet headers", () => {
    const m = suggestMapping(["Business Name", "WhatsApp No.", "Phone", "Google Reviews", "Rating", "Website", "Insta", "Emirate", "Area"]);
    expect(m["WhatsApp No."]).toBe("whatsapp");
    expect(m["Google Reviews"]).toBe("google_reviews");
    expect(m["Business Name"]).toBe("name");
    expect(m["Phone"]).toBe("phone");
    expect(m["Emirate"]).toBe("city");
    expect(m["Insta"]).toBe("instagram");
  });
  it("validates rows without guessing", () => {
    const m = mapRow({ Name: "Al Noor", Tel: "abc", Rating: "7" }, { Name: "name", Tel: "phone", Rating: "google_rating" });
    const errs = validateRow(m, "AE");
    expect(errs).toEqual(expect.arrayContaining([expect.stringMatching(/Invalid phone/), "Rating must be 0–5"]));
    expect(validateRow({ name: "Ok", phone: "0501234567" }, "AE")).toEqual([]);
  });
});

describe("exports", () => {
  const row = { lead_code: "AA-001000", name: "Al Noor", whatsapp_e164: "+971501234567", website_url: "https://alnoor.ae", tier: "HOT", lead_pricing: { recommended_price_min: 750, recommended_price_max: 1000, opportunity_value: 1200 }, business_socials: [{ platform: "INSTAGRAM", url: "https://www.instagram.com/alnoor" }] };
  it("never includes pricing columns without pricing.view", () => {
    const cols = allowedColumns(EXPORT_COLUMNS.map((c) => c.key), false);
    expect(cols.some((c) => c.pricing)).toBe(false);
    expect(buildCsv(cols, [row])).not.toMatch(/750|1200/);
    expect(allowedColumns([], true).some((c) => c.key === "recommended_price")).toBe(true);
  });
  it("produces a formatted XLSX with clickable links", async () => {
    const buf = await buildXlsx(allowedColumns(["lead_code", "name", "whatsapp_link", "website", "instagram"], false), [row], { title: "t", generatedBy: "x" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Leads")!;
    expect(ws.getRow(1).getCell(1).value).toBe("Lead ID");
    expect((ws.getRow(2).getCell(3).value as { hyperlink: string }).hyperlink).toBe("https://wa.me/971501234567");
    expect(exportFilename("xlsx", new Date("2026-10-08"))).toBe("AIN_ALTAIR_LEADS_2026-10-08.xlsx");
  });
});
