import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * International phone normalisation. The default region is only a parsing
 * hint for numbers written in national format (e.g. "050 123 4567" in the
 * UAE); numbers with a country code are always respected.
 */
export interface NormalizedPhone {
  e164: string;            // +971501234567
  countryCallingCode: string; // 971
  nationalNumber: string;  // 501234567
  international: string;   // +971 50 123 4567
  region: string | null;   // AE
  type: "MOBILE" | "FIXED_LINE" | "FIXED_LINE_OR_MOBILE" | "TOLL_FREE" | "VOIP" | "UNKNOWN";
  isMobileCapable: boolean;
}

export function normalizePhone(raw: string | null | undefined, defaultRegion: string = "AE"): NormalizedPhone | null {
  if (!raw) return null;
  let input = String(raw).trim();
  if (!input) return null;
  // wa.me / tel: links and common prefixes
  input = input.replace(/^tel:/i, "").replace(/^https?:\/\/(wa\.me|api\.whatsapp\.com\/send\?phone=)\/?/i, "+");
  // International "00" prefix → "+"
  input = input.replace(/^\s*00(?=[1-9])/, "+");
  // Keep only characters relevant to a phone number (drop extensions text)
  input = input.split(/(?:ext\.?|x|#)\s*\d+$/i)[0];

  const region = (defaultRegion || "AE").toUpperCase() as CountryCode;
  const parsed = parsePhoneNumberFromString(input, region);
  if (!parsed || !parsed.isValid()) return null;

  const t = parsed.getType();
  const type: NormalizedPhone["type"] =
    t === "MOBILE" ? "MOBILE"
    : t === "FIXED_LINE" ? "FIXED_LINE"
    : t === "FIXED_LINE_OR_MOBILE" ? "FIXED_LINE_OR_MOBILE"
    : t === "TOLL_FREE" ? "TOLL_FREE"
    : t === "VOIP" ? "VOIP"
    : "UNKNOWN";

  return {
    e164: parsed.number,
    countryCallingCode: String(parsed.countryCallingCode),
    nationalNumber: String(parsed.nationalNumber),
    international: parsed.formatInternational(),
    region: parsed.country ?? null,
    type,
    isMobileCapable: type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE",
  };
}

/**
 * WhatsApp click-to-chat URL for a number that is KNOWN to be on WhatsApp.
 * Callers must only pass numbers with WhatsApp evidence — this function never
 * decides that a number is on WhatsApp.
 */
export function whatsappUrl(e164: string | null | undefined, message?: string): string | null {
  if (!e164) return null;
  const digits = e164.replace(/[^0-9]/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** Extract a WhatsApp number from a wa.me / api.whatsapp.com link. */
export function phoneFromWhatsappLink(href: string): string | null {
  try {
    const u = new URL(href, "https://example.invalid");
    const host = u.hostname.replace(/^www\./, "");
    if (host === "wa.me") {
      const digits = u.pathname.replace(/[^0-9]/g, "");
      return digits.length >= 8 ? `+${digits}` : null;
    }
    if (host === "api.whatsapp.com" || host === "web.whatsapp.com" || host === "whatsapp.com") {
      const p = u.searchParams.get("phone");
      const digits = p ? p.replace(/[^0-9]/g, "") : "";
      return digits.length >= 8 ? `+${digits}` : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export function telUrl(e164: string | null | undefined): string | null {
  return e164 ? `tel:${e164}` : null;
}
