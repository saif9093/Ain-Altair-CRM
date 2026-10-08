import { describe, expect, it } from "vitest";
import { readPublicSheet } from "@/lib/imports/public-sheet";

describe("public Google Sheet import", () => {
  it("rejects non-Google hosts (no arbitrary fetches)", async () => {
    await expect(readPublicSheet("https://evil.example.com/spreadsheets/d/abc")).rejects.toThrow(/Google Sheets link/);
    await expect(readPublicSheet("http://docs.google.com/spreadsheets/d/abc")).rejects.toThrow(/Google Sheets link/);
    await expect(readPublicSheet("not a url")).rejects.toThrow(/valid link/);
  });
});
