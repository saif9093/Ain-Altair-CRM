import { describe, expect, it } from "vitest";
import { normalizePhone, whatsappUrl, phoneFromWhatsappLink } from "@/lib/normalize/phone";
import { normalizeUrl, domainOf, isOwnedWebsite, parseSocialUrl } from "@/lib/normalize/url";
import { normalizeBusinessName, normalizeEmail } from "@/lib/normalize/text";

describe("phone normalisation", () => {
  it("normalises UAE national mobile numbers to E.164", () => {
    const p = normalizePhone("0501234567", "AE")!;
    expect(p.e164).toBe("+971501234567");
    expect(p.countryCallingCode).toBe("971");
    expect(p.nationalNumber).toBe("501234567");
    expect(p.type).toBe("MOBILE");
    expect(p.region).toBe("AE");
  });
  it("handles 00 prefix, spaces and dashes", () => {
    expect(normalizePhone("00971 50-123-4567")!.e164).toBe("+971501234567");
    expect(normalizePhone("+971 4 331 2345")!.type).toBe("FIXED_LINE");
  });
  it("respects explicit country codes regardless of default region", () => {
    const uk = normalizePhone("+44 7400 123456", "AE")!;
    expect(uk.e164).toBe("+447400123456");
    expect(uk.region).toBe("GB");
    const sa = normalizePhone("+966 50 123 4567", "AE")!;
    expect(sa.countryCallingCode).toBe("966");
  });
  it("parses national numbers using the provided region", () => {
    expect(normalizePhone("07911 123456", "GB")!.e164).toBe("+447911123456");
  });
  it("accepts country code written without +", () => {
    expect(normalizePhone("971 6 555 0357", "AE")!.e164).toBe("+97165550357");
    expect(normalizePhone("971 58 638 2901", "AE")!.type).toBe("MOBILE");
  });
  it("rejects invalid input instead of guessing", () => {
    expect(normalizePhone("12345", "AE")).toBeNull();
    expect(normalizePhone("", "AE")).toBeNull();
    expect(normalizePhone("call us", "AE")).toBeNull();
  });
});

describe("WhatsApp links", () => {
  it("builds wa.me links from E.164 with the correct country code", () => {
    expect(whatsappUrl("+971501234567")).toBe("https://wa.me/971501234567");
    expect(whatsappUrl("+447911123456")).toBe("https://wa.me/447911123456");
    expect(whatsappUrl("+966501234567", "Hi there")).toBe("https://wa.me/966501234567?text=Hi%20there");
  });
  it("returns null without a number (never invents one)", () => {
    expect(whatsappUrl(null)).toBeNull();
    expect(whatsappUrl("")).toBeNull();
  });
  it("extracts numbers from WhatsApp links", () => {
    expect(phoneFromWhatsappLink("https://wa.me/971501234567?text=hello")).toBe("+971501234567");
    expect(phoneFromWhatsappLink("https://api.whatsapp.com/send?phone=971501234567")).toBe("+971501234567");
    expect(phoneFromWhatsappLink("https://example.com")).toBeNull();
  });
});

describe("URL & social normalisation", () => {
  it("normalises URLs and strips tracking", () => {
    expect(normalizeUrl("Example.com/?utm_source=x")).toBe("https://example.com");
    expect(normalizeUrl("http://www.foo.ae/page#top")).toBe("http://www.foo.ae/page");
    expect(normalizeUrl("tel:123")).toBeNull();
  });
  it("extracts domains", () => {
    expect(domainOf("https://www.AlNoor-Cleaning.ae/services")).toBe("alnoor-cleaning.ae");
  });
  it("distinguishes owned websites from social/listing URLs", () => {
    expect(isOwnedWebsite("https://instagram.com/foo")).toBe(false);
    expect(isOwnedWebsite("https://linktr.ee/foo")).toBe(false);
    expect(isOwnedWebsite("https://foo-flowers.ae")).toBe(true);
  });
  it("parses social profiles and ignores share/post links", () => {
    expect(parseSocialUrl("https://www.instagram.com/alnoor.cleaning/?hl=en")).toMatchObject({ platform: "INSTAGRAM", username: "alnoor.cleaning" });
    expect(parseSocialUrl("https://instagram.com/p/Cxyz123")).toBeNull();
    expect(parseSocialUrl("https://www.facebook.com/sharer/sharer.php?u=x")).toBeNull();
    expect(parseSocialUrl("https://facebook.com/AlNoorCleaning")).toMatchObject({ platform: "FACEBOOK", username: "AlNoorCleaning" });
    expect(parseSocialUrl("https://www.tiktok.com/@alnoor")).toMatchObject({ platform: "TIKTOK", username: "alnoor" });
    expect(parseSocialUrl("https://www.linkedin.com/company/al-noor")).toMatchObject({ platform: "LINKEDIN" });
  });
});

describe("text normalisation", () => {
  it("removes legal suffixes and plurals", () => {
    expect(normalizeBusinessName("Al Noor Cleaning Services L.L.C.")).toBe("al noor cleaning service");
    expect(normalizeBusinessName("Al Noor Cleaning Service LLC")).toBe("al noor cleaning service");
    expect(normalizeBusinessName("AL NOOR CLEANING")).toBe("al noor cleaning");
  });
  it("validates emails and rejects asset filenames", () => {
    expect(normalizeEmail("mailto:Info@AlNoor.ae")).toBe("info@alnoor.ae");
    expect(normalizeEmail("logo@2x.png")).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});
