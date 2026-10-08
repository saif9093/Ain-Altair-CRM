/**
 * Small built-in gazetteer used to recognise well-known places in natural-
 * language queries and to split large areas into sub-areas for bulk research.
 * It is a hint list only — every location is still geocoded (Nominatim) and
 * the engine works for any place worldwide.
 */
export interface GazetteerPlace {
  name: string;
  aliases?: string[];
  kind: "COUNTRY" | "EMIRATE" | "REGION" | "CITY" | "DISTRICT" | "AREA";
  parent?: string;
  countryCode: string;
}

export const GAZETTEER: GazetteerPlace[] = [
  { name: "United Arab Emirates", aliases: ["uae", "emirates", "u.a.e"], kind: "COUNTRY", countryCode: "AE" },
  { name: "Saudi Arabia", aliases: ["ksa"], kind: "COUNTRY", countryCode: "SA" },
  { name: "United Kingdom", aliases: ["uk", "england", "britain"], kind: "COUNTRY", countryCode: "GB" },
  { name: "Qatar", kind: "COUNTRY", countryCode: "QA" },
  { name: "Oman", kind: "COUNTRY", countryCode: "OM" },
  { name: "Bahrain", kind: "COUNTRY", countryCode: "BH" },
  { name: "Kuwait", kind: "COUNTRY", countryCode: "KW" },

  { name: "Dubai", kind: "EMIRATE", parent: "United Arab Emirates", countryCode: "AE" },
  { name: "Abu Dhabi", kind: "EMIRATE", parent: "United Arab Emirates", countryCode: "AE" },
  { name: "Sharjah", kind: "EMIRATE", parent: "United Arab Emirates", countryCode: "AE" },
  { name: "Ajman", kind: "EMIRATE", parent: "United Arab Emirates", countryCode: "AE" },
  { name: "Ras Al Khaimah", aliases: ["rak"], kind: "EMIRATE", parent: "United Arab Emirates", countryCode: "AE" },
  { name: "Fujairah", kind: "EMIRATE", parent: "United Arab Emirates", countryCode: "AE" },
  { name: "Umm Al Quwain", aliases: ["uaq"], kind: "EMIRATE", parent: "United Arab Emirates", countryCode: "AE" },
  { name: "Al Ain", kind: "CITY", parent: "Abu Dhabi", countryCode: "AE" },

  // Dubai areas (used for bulk-research splitting)
  { name: "Downtown Dubai", aliases: ["downtown"], kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Dubai Marina", aliases: ["marina"], kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Jumeirah Village Circle", aliases: ["jvc"], kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Jumeirah Lake Towers", aliases: ["jlt"], kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Al Barsha", aliases: ["barsha"], kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Deira", kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Bur Dubai", kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Business Bay", kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Jumeirah", kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Al Quoz", kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Karama", aliases: ["al karama"], kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Al Qusais", aliases: ["qusais"], kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Mirdif", kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Dubai Silicon Oasis", aliases: ["silicon oasis", "dso"], kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "International City", kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Al Nahda", kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Satwa", aliases: ["al satwa"], kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Motor City", kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Dubai Sports City", aliases: ["sports city"], kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Arabian Ranches", kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Palm Jumeirah", aliases: ["the palm"], kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Al Furjan", kind: "AREA", parent: "Dubai", countryCode: "AE" },
  { name: "Dubai Investments Park", aliases: ["dip"], kind: "AREA", parent: "Dubai", countryCode: "AE" },

  // Sharjah areas
  { name: "Sharjah Industrial Area", aliases: ["industrial area"], kind: "AREA", parent: "Sharjah", countryCode: "AE" },
  { name: "Al Majaz", kind: "AREA", parent: "Sharjah", countryCode: "AE" },
  { name: "Al Nahda Sharjah", kind: "AREA", parent: "Sharjah", countryCode: "AE" },
  { name: "Al Khan", kind: "AREA", parent: "Sharjah", countryCode: "AE" },
  { name: "Muwaileh", kind: "AREA", parent: "Sharjah", countryCode: "AE" },
  { name: "Al Taawun", kind: "AREA", parent: "Sharjah", countryCode: "AE" },
  { name: "Al Qasimia", kind: "AREA", parent: "Sharjah", countryCode: "AE" },

  // Abu Dhabi areas
  { name: "Khalifa City", kind: "AREA", parent: "Abu Dhabi", countryCode: "AE" },
  { name: "Al Reem Island", aliases: ["reem island"], kind: "AREA", parent: "Abu Dhabi", countryCode: "AE" },
  { name: "Mussafah", kind: "AREA", parent: "Abu Dhabi", countryCode: "AE" },
  { name: "Al Khalidiyah", aliases: ["khalidiya"], kind: "AREA", parent: "Abu Dhabi", countryCode: "AE" },
  { name: "Yas Island", kind: "AREA", parent: "Abu Dhabi", countryCode: "AE" },

  // Ajman areas
  { name: "Al Nuaimiya", kind: "AREA", parent: "Ajman", countryCode: "AE" },
  { name: "Al Rashidiya Ajman", kind: "AREA", parent: "Ajman", countryCode: "AE" },
];

export function findPlace(text: string): GazetteerPlace | undefined {
  const t = text.trim().toLowerCase();
  return GAZETTEER.find((p) => p.name.toLowerCase() === t || p.aliases?.some((a) => a === t));
}

export function subAreasOf(name: string): GazetteerPlace[] {
  const parent = findPlace(name);
  if (!parent) return [];
  return GAZETTEER.filter((p) => p.parent === parent.name && (p.kind === "AREA" || p.kind === "DISTRICT" || p.kind === "CITY" || p.kind === "EMIRATE"));
}

/** Find all gazetteer places mentioned in free text, longest names first, non-overlapping. */
export function placesInText(text: string): { place: GazetteerPlace; matched: string; index: number }[] {
  const lower = ` ${text.toLowerCase()} `;
  const candidates: { place: GazetteerPlace; name: string }[] = [];
  for (const p of GAZETTEER) {
    candidates.push({ place: p, name: p.name.toLowerCase() });
    for (const a of p.aliases ?? []) if (a.length >= 3) candidates.push({ place: p, name: a });
  }
  candidates.sort((a, b) => b.name.length - a.name.length);
  const taken: [number, number][] = [];
  const out: { place: GazetteerPlace; matched: string; index: number }[] = [];
  for (const c of candidates) {
    const re = new RegExp(`[^a-z0-9]${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z0-9]`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower))) {
      const start = m.index + 1;
      const end = start + c.name.length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      out.push({ place: c.place, matched: text.substr(start - 1, c.name.length), index: start - 1 });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
