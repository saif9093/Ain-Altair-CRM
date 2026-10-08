import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { suggestMapping } from "@/lib/imports/mapping";
import { mapRow, validateRow, cleanRow } from "@/lib/imports/execute";
import { allowedColumns, EXPORT_COLUMNS } from "@/lib/exports/columns";
import { buildCsv, buildXlsx, exportFilename } from "@/lib/exports/build";
import { cellText } from "@/lib/imports/parse";

describe("spreadsheet cell recovery", () => {
  it("recovers phone numbers hidden behind broken formulas", () => {
    expect(cellText({ formula: "+971 4 437 0626", result: "#ERROR!" } as never)).toBe("+971 4 437 0626");
    expect(cellText({ formula: "SUM(A1:A2)", result: { error: "#REF!" } } as never)).toBe("");
    expect(cellText("#N/A")).toBe("");
  });
  it("turns link labels into the real URL", () => {
    expect(cellText({ text: "Open in Maps", hyperlink: "https://maps.google.com/?cid=1" } as never)).toBe("https://maps.google.com/?cid=1");
    expect(cellText({ text: { richText: [{ text: "https://a.ae/" }] }, hyperlink: "https://a.ae/" } as never)).toBe("https://a.ae/");
  });
});

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
  it("only a missing name invalidates a row; bad fields become warnings", () => {
    const m = mapRow({ Name: "Al Noor", Tel: "#ERROR!", Rating: "7" }, { Name: "name", Tel: "phone", Rating: "google_rating" });
    const { row, warnings } = cleanRow(m, "AE");
    expect(validateRow(row, "AE")).toEqual([]);
    expect(row.phone).toBeUndefined();
    expect(row.google_rating).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/Phone .* not recognised/);
    expect(validateRow({ phone: "0501234567" }, "AE")).toEqual(["Missing business name"]);
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

describe("import robustness", () => {
  it("never maps Business Size or Decision-Maker to the business name", () => {
    const m = suggestMapping(["Industry", "Business Size", "Decision-Maker", "Phone"]);
    expect(Object.values(m)).not.toContain("name");
    expect(suggestMapping(["Company", "Business Size"]).Company).toBe("name");
  });
  it("cleans placeholders and splits phone + WhatsApp link cells", () => {
    const { row } = cleanRow({ name: "X", phone: "971 6 555 0357\nhttps://wa.me/+971585200357", email: "Not mentioned", website: "No website" }, "AE");
    expect(row.phone).toBe("971 6 555 0357");
    expect(row.whatsapp).toBe("+971585200357");
    expect(row.email).toBeUndefined();
    expect(row.website).toBeUndefined();
  });
});
