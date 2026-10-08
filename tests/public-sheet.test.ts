import { describe, expect, it } from "vitest";
import { sheetCandidates } from "@/lib/imports/public-sheet";

describe("public Google Sheet links", () => {
  it("rejects non-Google hosts (no arbitrary fetches)", () => {
    expect(() => sheetCandidates("https://evil.example.com/spreadsheets/d/abc")).toThrow(/Google Sheets link/);
    expect(() => sheetCandidates("http://docs.google.com/spreadsheets/d/abc")).toThrow(/Google Sheets link/);
    expect(() => sheetCandidates("not a url")).toThrow(/valid link/);
  });
  it("handles share links with gid in the hash", () => {
    const c = sheetCandidates("https://docs.google.com/spreadsheets/d/ABC123/edit?usp=sharing#gid=42");
    expect(c[0]).toBe("https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=42");
    expect(c[1]).toContain("/gviz/tq?tqx=out:csv&gid=42");
  });
  it("handles publish-to-web links", () => {
    expect(sheetCandidates("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml")[0]).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv");
  });
});
