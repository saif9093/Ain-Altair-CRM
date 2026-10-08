/**
 * Smart column mapping for CSV / XLSX / Google Sheets imports. Deterministic
 * synonym matching (no AI required); the mapping is always shown to the user
 * for confirmation before anything is written.
 */
export const IMPORT_FIELDS = {
  lead_code: { label: "Lead ID", synonyms: ["lead id", "lead code", "id", "crm id", "ref"] },
  name: { label: "Business name", synonyms: ["business name", "company", "company name", "name", "shop name", "store name", "business", "title"] },
  category: { label: "Category", synonyms: ["category", "niche", "industry", "type", "business type", "sector"] },
  phone: { label: "Phone", synonyms: ["phone", "phone number", "telephone", "tel", "mobile", "contact number", "contact no", "landline"] },
  whatsapp: { label: "WhatsApp number", synonyms: ["whatsapp", "whatsapp no", "whatsapp number", "wa", "wa number", "whats app"] },
  email: { label: "Email", synonyms: ["email", "e-mail", "email address", "mail"] },
  website: { label: "Website", synonyms: ["website", "web", "url", "site", "domain", "web site"] },
  instagram: { label: "Instagram", synonyms: ["instagram", "insta", "ig", "instagram url", "instagram handle"] },
  facebook: { label: "Facebook", synonyms: ["facebook", "fb", "facebook url", "facebook page"] },
  address: { label: "Address", synonyms: ["address", "full address", "street", "location address"] },
  area: { label: "Area", synonyms: ["area", "neighbourhood", "neighborhood", "district", "community", "locality"] },
  city: { label: "City / Emirate", synonyms: ["city", "emirate", "town", "region", "state"] },
  country: { label: "Country", synonyms: ["country", "country code"] },
  google_rating: { label: "Google rating", synonyms: ["rating", "google rating", "stars", "score (google)", "review score"] },
  google_reviews: { label: "Google reviews", synonyms: ["reviews", "google reviews", "review count", "no of reviews", "number of reviews", "total reviews"] },
  google_maps_url: { label: "Google Maps URL", synonyms: ["google maps", "maps url", "google maps url", "maps link", "gmb", "google business"] },
  google_place_id: { label: "Google place ID", synonyms: ["place id", "google place id", "placeid"] },
  lat: { label: "Latitude", synonyms: ["lat", "latitude"] },
  lng: { label: "Longitude", synonyms: ["lng", "lon", "long", "longitude"] },
  notes: { label: "Notes", synonyms: ["notes", "note", "comments", "remarks"] },
  pipeline_stage: { label: "Outreach status", synonyms: ["status", "outreach status", "stage", "pipeline stage", "lead status"] },
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;

const norm = (s: string) => s.toLowerCase().replace(/[._\-/#:]+/g, " ").replace(/\bno\b\.?/g, "no").replace(/\s+/g, " ").trim();

export function suggestMapping(headers: string[]): Record<string, ImportField | null> {
  const out: Record<string, ImportField | null> = {};
  const used = new Set<ImportField>();
  for (const h of headers) {
    const n = norm(h);
    let best: { f: ImportField; score: number } | null = null;
    for (const [f, def] of Object.entries(IMPORT_FIELDS) as [ImportField, (typeof IMPORT_FIELDS)[ImportField]][]) {
      for (const syn of def.synonyms) {
        // Generic one-word synonyms ("business", "name", "title") must match exactly,
        // so "Business Size" or "Decision-Maker name" never become the business name.
        const generic = f === "name" && ["business", "name", "title"].includes(syn);
        const score = n === syn ? 3 : generic ? 0 : n.startsWith(syn) || n.endsWith(syn) ? 2 : n.includes(syn) && syn.length >= 4 ? 1 : 0;
        if (score && (!best || score > best.score)) best = { f, score };
      }
    }
    // WhatsApp beats phone when both words appear (e.g. "WhatsApp No.")
    if (/whats\s?app|\bwa\b/.test(n)) best = { f: "whatsapp", score: 3 };
    if (best && !used.has(best.f)) {
      out[h] = best.f;
      used.add(best.f);
    } else out[h] = null;
  }
  return out;
}

export const STAGE_ALIASES: Record<string, string> = {
  "not contacted": "NOT_CONTACTED", new: "NOT_CONTACTED", contacted: "CONTACTED", replied: "REPLIED", interested: "INTERESTED",
  meeting: "MEETING", "quote sent": "QUOTE_SENT", quoted: "QUOTE_SENT", won: "WON", closed: "WON", lost: "LOST",
};
