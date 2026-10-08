import { DEFAULT_CATEGORIES, expandCategoryTerms, type CategoryDef } from "@/lib/categories/taxonomy";
import { placesInText, findPlace } from "./gazetteer";
import type { CategorySpec, LocationSpec, SearchCriteriaInput, OpportunityType } from "./criteria";

/**
 * Deterministic natural-language → structured criteria parser. It never
 * invents filters: every interpreted field carries the phrase that produced
 * it so the UI can show "why" before the search runs. An optional AI pass
 * (src/lib/ai/search-interpret.ts) can refine this; both are shown to the user.
 */

export interface Interpretation {
  field: string;
  value: string;
  phrase: string;
}

export interface ParsedSearch {
  criteria: SearchCriteriaInput;
  interpretations: Interpretation[];
  unparsed: string[];
  warnings: string[];
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})*|\d+)`;
const toNum = (s: string) => Number(s.replace(/,/g, ""));

function matchCategories(text: string, categories: CategoryDef[]): { cat: CategoryDef; phrase: string }[] {
  const lower = text.toLowerCase();
  const pairs: { cat: CategoryDef; term: string }[] = [];
  for (const c of categories) {
    for (const t of [c.name, ...c.synonyms]) pairs.push({ cat: c, term: t.toLowerCase() });
  }
  pairs.sort((a, b) => b.term.length - a.term.length);
  const found: { cat: CategoryDef; phrase: string; start: number; end: number }[] = [];
  for (const p of pairs) {
    const escaped = p.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z])${escaped}(s|es)?(?=$|[^a-z])`, "i");
    const m = re.exec(lower);
    if (!m) continue;
    const start = m.index + m[1].length;
    const end = start + m[0].length - m[1].length;
    if (found.some((f) => start < f.end && end > f.start)) continue;
    if (found.some((f) => f.cat.key === p.cat.key)) continue;
    found.push({ cat: p.cat, phrase: text.slice(start, end), start, end });
  }
  return found.sort((a, b) => a.start - b.start);
}

const LOCATION_STOP = /\b(with|that|which|who|having|have|has|without|no|and\s+(?:at|a|an|no|with)|but|where|whose|likely|rated|at\s+least|excluding|exclude|except|for|whatsapp|instagram|facebook|reviews?|stars?)\b|[,.;:!?]/i;

function cleanLocationPhrase(s: string): string {
  const cut = s.split(LOCATION_STOP)[0] ?? s;
  return cut.replace(/\b(the|area|region)\s*$/i, "").replace(/\s+/g, " ").trim();
}

export function parseNaturalQuery(input: string, opts: { defaultCountryCode?: string; categories?: CategoryDef[] } = {}): ParsedSearch {
  const text = input.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const interpretations: Interpretation[] = [];
  const warnings: string[] = [];
  const cats = opts.categories ?? DEFAULT_CATEGORIES;

  const criteria: SearchCriteriaInput = {
    naturalQuery: text,
    categories: [],
    keywords: [],
    excludeKeywords: [],
    locations: [],
    business: {},
    digital: { website: ["ANY"], instagram: "ANY", facebook: "ANY" },
    contact: {},
    opportunities: [],
    quality: {},
    output: {},
  };

  // ---- Exclusions first (so excluded words are not read as categories)
  let working = text;
  const exclRe = /\b(?:exclude|excluding|except|not including|but not|without any)\s+([a-z0-9 ,&'-]+?)(?=\s+(?:with|in|around|near|that|who|and\s+(?:with|have|has))\b|[.;]|$)/gi;
  let em: RegExpExecArray | null;
  while ((em = exclRe.exec(text))) {
    const items = em[1].split(/,|\bor\b|\band\b/).map((s) => s.trim()).filter(Boolean);
    for (const it of items) {
      if (/^(a\s+)?websites?$/i.test(it)) continue; // "without any website" handled below
      criteria.excludeKeywords!.push(it);
      interpretations.push({ field: "Exclude", value: it, phrase: em[0] });
    }
    working = working.replace(em[0], " ");
  }
  if (/\b(no|exclude|excluding|without)\s+franchises?\b/i.test(lower) || /\bindependent\b|\bfamily[- ]owned\b|\bnon[- ]franchise\b/i.test(lower)) {
    criteria.business!.franchise = "EXCLUDE";
    interpretations.push({ field: "Franchise", value: "Exclude likely franchises", phrase: (lower.match(/no franchises?|exclud\w* franchises?|independent|family[- ]owned|non[- ]franchise/) ?? [""])[0] });
  } else if (/\bonly franchises?\b/i.test(lower)) {
    criteria.business!.franchise = "ONLY";
  }

  // ---- Categories
  const catMatches = matchCategories(working, cats);
  for (const { cat, phrase } of catMatches) {
    const spec: CategorySpec = { key: cat.key, label: cat.name, terms: expandCategoryTerms(cat, [], criteria.excludeKeywords) };
    criteria.categories.push(spec);
    interpretations.push({ field: "Category", value: cat.name, phrase });
  }
  if (criteria.categories.length === 0) {
    // Custom niche: take the noun phrase after find/search for, before location cue.
    const m = /\b(?:find|search(?: for)?|show(?: me)?|get|list|look(?:ing)? for)\s+(?:all\s+|me\s+)?(?:small\s+|local\s+|independent\s+|new\s+)*(.+?)(?=\s+(?:in|around|near|within|across|inside|at)\b|\s+with\b|\s+that\b|[,.]|$)/i.exec(working);
    const niche = m?.[1]?.replace(/\b\d+\b|\bleads?\b|\bbusinesses\b|\bcompanies\b/gi, " ").replace(/\s+/g, " ").trim();
    if (niche && niche.length >= 3 && !/^(businesses|companies|shops|places)$/i.test(niche)) {
      criteria.categories.push({ label: niche.replace(/\b\w/g, (c) => c.toUpperCase()), terms: [niche] });
      interpretations.push({ field: "Category", value: `${niche} (custom niche)`, phrase: m![0] });
    } else if (/\b(small|local|independent)?\s*(businesses|companies|shops)\b/i.test(lower)) {
      criteria.categories.push({ label: "Local Businesses", terms: ["local business"] });
      interpretations.push({ field: "Category", value: "Any local business (broad)", phrase: "businesses" });
      warnings.push("No specific niche detected — broad searches return mixed categories. Add a niche for better results.");
    }
  }

  // ---- Locations: radius phrases
  const radiusRe = new RegExp(String.raw`within\s+${NUM}(?:\.(\d+))?\s*(km|kilometers?|kilometres?|m|meters?|metres?|miles?)\s+(?:of|from|around)\s+([^,.;]+)`, "i");
  const rm = radiusRe.exec(working);
  if (rm) {
    const n = toNum(rm[1]) + (rm[2] ? Number(`0.${rm[2]}`) : 0);
    const unit = rm[3].toLowerCase();
    const metres = unit.startsWith("k") ? n * 1000 : unit.startsWith("mi") ? n * 1609 : n;
    const label = cleanLocationPhrase(rm[4]);
    if (label) {
      const place = findPlace(label);
      criteria.locations.push({ label, kind: "RADIUS", radiusM: Math.round(metres), countryCode: place?.countryCode ?? opts.defaultCountryCode });
      interpretations.push({ field: "Location", value: `Within ${n} ${unit} of ${label}`, phrase: rm[0] });
      working = working.replace(rm[0], " ");
    }
  }

  // ---- Locations: gazetteer places (supports "Dubai + Sharjah + Ajman")
  if (criteria.locations.length === 0) {
    const places = placesInText(working);
    const specific = places.filter((p) => p.place.kind !== "COUNTRY");
    const chosen = specific.length ? specific : places;
    for (const p of chosen) {
      if (criteria.locations.some((l) => l.label === p.place.name)) continue;
      const loc: LocationSpec = {
        label: p.place.name,
        kind: "NAMED",
        countryCode: p.place.countryCode,
        ...(p.place.kind === "AREA" || p.place.kind === "DISTRICT" ? { area: p.place.name, city: p.place.parent } : {}),
        ...(p.place.kind === "EMIRATE" || p.place.kind === "CITY" ? { city: p.place.name } : {}),
        ...(p.place.kind === "COUNTRY" ? { country: p.place.name } : {}),
      };
      // A parent named alongside its own area ("Al Barsha, Dubai") is context, not a second location.
      const isParentOfOther = chosen.some((o) => o.place.parent === p.place.name);
      if (isParentOfOther) continue;
      if (/\ball (?:businesses|of them)?\s*in\b/i.test(lower) || p.place.kind === "COUNTRY") loc.splitIntoSubAreas = p.place.kind !== "AREA";
      criteria.locations.push(loc);
      interpretations.push({ field: "Location", value: p.place.name, phrase: p.matched });
    }
  }

  // ---- Locations: free-form "in X" / "around X" (anywhere in the world)
  if (criteria.locations.length === 0) {
    const m = /\b(?:in|around|near|across|inside|at)\s+(.+)$/i.exec(working);
    if (m) {
      const parts = cleanLocationPhrase(m[1]).split(/\s*(?:\+|&|\band\b|\/)\s*/i).map((s) => s.trim()).filter((s) => s.length >= 2);
      for (const label of parts) {
        if (/^\d+$/.test(label)) continue;
        const postal = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$|^\d{4,6}$/i.test(label);
        criteria.locations.push({ label, kind: "NAMED", ...(postal ? { postalCode: label } : {}), countryCode: opts.defaultCountryCode });
        interpretations.push({ field: "Location", value: postal ? `Postcode ${label}` : label, phrase: m[0] });
      }
    }
  }
  if (criteria.locations.length === 0) warnings.push("No location detected — add a city, area, radius or map region.");

  // ---- Reviews
  const reviewPatterns = [
    new RegExp(String.raw`${NUM}\s*\+\s*(?:google\s+)?reviews?`, "i"),
    new RegExp(String.raw`(?:at\s+least|minimum(?:\s+of)?|min\.?|over|more\s+than|above)\s+${NUM}\s+(?:google\s+)?reviews?`, "i"),
    new RegExp(String.raw`${NUM}\s+or\s+more\s+(?:google\s+)?reviews?`, "i"),
    new RegExp(String.raw`${NUM}\s+(?:google\s+)?reviews?`, "i"),
  ];
  for (const re of reviewPatterns) {
    const m = re.exec(lower);
    if (m) {
      let n = toNum(m[1]);
      if (/over|more than|above/.test(m[0])) n += 1;
      criteria.business!.minReviews = n;
      interpretations.push({ field: "Minimum reviews", value: String(n), phrase: m[0] });
      break;
    }
  }
  if (criteria.business!.minReviews === undefined && /\bstrong (?:google )?reviews\b|\bwell[- ]reviewed\b/.test(lower)) {
    criteria.business!.minReviews = 30;
    criteria.business!.minRating = criteria.business!.minRating ?? 4.0;
    interpretations.push({ field: "Business quality", value: "≥30 reviews and ≥4.0 rating", phrase: (lower.match(/strong (?:google )?reviews|well[- ]reviewed/) ?? [""])[0] });
  }

  // ---- Rating
  const ratingRe = /(?:rated|rating(?:\s+of)?|at\s+least|minimum|above|over)?\s*(\d(?:\.\d)?)\s*\+?\s*(?:stars?|★|rating|star rating)(?:\s+(?:or\s+(?:more|above|higher)))?/i;
  const rt = ratingRe.exec(lower);
  if (rt) {
    const v = Number(rt[1]);
    if (v > 0 && v <= 5) {
      criteria.business!.minRating = v;
      interpretations.push({ field: "Minimum rating", value: v.toFixed(1), phrase: rt[0].trim() });
    }
  } else {
    const r2 = /(?:rating|rated)\s+(?:of\s+)?(?:at\s+least|above|over|>=?)\s*(\d(?:\.\d)?)/i.exec(lower);
    if (r2) {
      criteria.business!.minRating = Number(r2[1]);
      interpretations.push({ field: "Minimum rating", value: Number(r2[1]).toFixed(1), phrase: r2[0] });
    }
  }

  // ---- Website status
  const website = new Set<string>();
  const addWeb = (v: string, phrase: string, label: string) => {
    website.add(v);
    interpretations.push({ field: "Website", value: label, phrase });
  };
  let m2: RegExpMatchArray | null;
  if ((m2 = lower.match(/\b(no|without(?: an?| any)?|lack(?:ing)?(?: an?)?|don'?t have(?: an?)?|do not have(?: an?)?|missing(?: an?)?)\s+(?:proper\s+|real\s+|own\s+|dedicated\s+)?websites?\b/))) addWeb("NO_WEBSITE", m2[0], "No website");
  if ((m2 = lower.match(/\b(outdated|old|old-fashioned|dated|ancient)\s+websites?\b/))) addWeb("OUTDATED", m2[0], "Outdated website");
  if ((m2 = lower.match(/\bbroken\s+websites?\b|\bwebsites?\s+(?:that\s+(?:are|is)\s+)?(?:down|broken)\b/))) addWeb("BROKEN", m2[0], "Broken website");
  if ((m2 = lower.match(/\b(?:poor|bad|weak|very poor)\s+mobile(?:\s+websites?)?\b|\bnot mobile[- ]friendly\b|\bmobile (?:issues?|problems?)\b/))) addWeb("MOBILE_ISSUE", m2[0], "Mobile issues");
  if ((m2 = lower.match(/\bslow\s+websites?\b/))) addWeb("SLOW", m2[0], "Slow website (measured)");
  if ((m2 = lower.match(/\b(?:poor|bad|weak|ugly|terrible)\s+websites?\b/))) addWeb("POOR", m2[0], "Poor website");
  if (website.size) criteria.digital!.website = [...website] as never;

  // ---- Social
  if ((m2 = lower.match(/\bactive\s+(?:on\s+)?instagram\b|\binstagram\s+(?:is\s+)?active\b/))) {
    criteria.digital!.instagram = "ACTIVE";
    interpretations.push({ field: "Instagram", value: "Active", phrase: m2[0] });
  } else if ((m2 = lower.match(/\b(?:with|has|have|on)\s+(?:an?\s+)?instagram\b|\binstagram\s+(?:account|profile|page)\b/))) {
    criteria.digital!.instagram = "PRESENT";
    interpretations.push({ field: "Instagram", value: "Has a profile", phrase: m2[0] });
  }
  if ((m2 = lower.match(/\bactive\s+(?:on\s+)?facebook\b|\bfacebook\s+(?:is\s+)?active\b/))) {
    criteria.digital!.facebook = "ACTIVE";
    interpretations.push({ field: "Facebook", value: "Active", phrase: m2[0] });
  }

  // ---- Contactability
  if ((m2 = lower.match(/\bwhatsapp\s+preferred\b|\bprefer(?:ably|ring)?\s+(?:with\s+)?whatsapp\b/))) {
    criteria.contact!.whatsapp = "PREFERRED";
    interpretations.push({ field: "WhatsApp", value: "Preferred", phrase: m2[0] });
  } else if ((m2 = lower.match(/\bwhatsapp\b/))) {
    criteria.contact!.whatsapp = "REQUIRED";
    interpretations.push({ field: "WhatsApp", value: "Required (verified on website/social)", phrase: m2[0] });
  }
  if ((m2 = lower.match(/\b(?:with|has|have)\s+(?:a\s+)?phone(?: number)?\b|\bphone required\b/))) {
    criteria.contact!.phone = "REQUIRED";
    interpretations.push({ field: "Phone", value: "Required", phrase: m2[0] });
  }
  if ((m2 = lower.match(/\b(?:with|has|have)\s+(?:an?\s+)?emails?\b|\bemail required\b/))) {
    criteria.contact!.email = "REQUIRED";
    interpretations.push({ field: "Email", value: "Required", phrase: m2[0] });
  } else if ((m2 = lower.match(/\bemail preferred\b/))) {
    criteria.contact!.email = "PREFERRED";
    interpretations.push({ field: "Email", value: "Preferred", phrase: m2[0] });
  }

  // ---- Business size (observable-signal classification)
  if ((m2 = lower.match(/\b(small|micro|tiny|family[- ]owned|local)\b/))) {
    criteria.business!.sizes = ["MICRO", "SMALL", "UNKNOWN"];
    interpretations.push({ field: "Business size", value: "Micro / small (estimated from observable signals)", phrase: m2[0] });
  } else if ((m2 = lower.match(/\b(medium|mid-sized|mid size)\b/))) {
    criteria.business!.sizes = ["MEDIUM"];
    interpretations.push({ field: "Business size", value: "Medium", phrase: m2[0] });
  }

  // ---- Value / price intent
  const valRe = new RegExp(String.raw`(?:pay|worth|budget(?: of)?|spend|value(?: of)?)\s+(?:at\s+least\s+)?(?:aed|dhs?|usd|\$|£|gbp|sar)?\s*${NUM}\s*(k)?\s*(?:aed|dhs?)?\s*\+?`, "i");
  const vm = valRe.exec(lower);
  if (vm) {
    const v = toNum(vm[1]) * (vm[2] ? 1000 : 1);
    criteria.quality!.minOpportunityValue = v;
    criteria.output!.depth = "DEEP";
    interpretations.push({ field: "Opportunity value", value: `≥ ${v.toLocaleString()} (estimate)`, phrase: vm[0] });
    if (website.size === 0) {
      criteria.digital!.website = ["NO_WEBSITE", "OUTDATED", "POOR", "BROKEN", "MOBILE_ISSUE"];
      interpretations.push({ field: "Website", value: "Needs website work (implied by purchase intent)", phrase: vm[0] });
    }
  }

  // ---- Opportunities
  const oppMap: [RegExp, OpportunityType, string][] = [
    [/\bredesign|revamp|refresh\b/, "WEBSITE_REDESIGN", "Website redesign"],
    [/\bseo\b|search engine/, "SEO", "SEO"],
    [/\bbooking\b|appointments?/, "BOOKING_SYSTEM", "Booking system"],
    [/\b(digital )?menu\b/, "DIGITAL_MENU", "Digital menu"],
    [/\blanding page\b/, "LANDING_PAGE", "Landing page"],
    [/\bcrm\b/, "CRM", "CRM"],
    [/\bautomation\b/, "AUTOMATION", "Automation"],
  ];
  for (const [re, type, label] of oppMap) {
    const mm = lower.match(re);
    if (mm) {
      criteria.opportunities!.push(type);
      interpretations.push({ field: "Opportunity focus", value: label, phrase: mm[0] });
    }
  }
  if (website.has("NO_WEBSITE")) criteria.opportunities!.unshift("NEW_WEBSITE");
  if (website.has("OUTDATED") || website.has("POOR")) criteria.opportunities!.push("WEBSITE_REDESIGN");
  if (website.has("BROKEN") || website.has("MOBILE_ISSUE") || website.has("SLOW")) criteria.opportunities!.push("WEBSITE_FIX");
  criteria.opportunities = [...new Set(criteria.opportunities)];

  // ---- Target count & depth
  const tc = new RegExp(String.raw`\b(?:find|get|top|show(?: me)?|give me)\s+(?:the\s+)?${NUM}\b|\b${NUM}\s+(?:leads?|businesses|prospects|results|companies)\b`, "i").exec(lower);
  if (tc) {
    const n = toNum(tc[1] ?? tc[2]);
    if (n > 0 && n <= 5000) {
      criteria.output!.targetCount = n;
      interpretations.push({ field: "Target leads", value: String(n), phrase: tc[0] });
    }
  }
  if (/\bdeep(?:ly)?\b|\bthorough\b|\bfull audit\b/.test(lower)) {
    criteria.output!.depth = "DEEP";
    interpretations.push({ field: "Research depth", value: "Deep", phrase: (lower.match(/deep(?:ly)?|thorough|full audit/) ?? [""])[0] });
  } else if (/\bquick(?:ly)?\b|\bfast\b|\bbasic\b/.test(lower)) {
    criteria.output!.depth = "FAST";
    interpretations.push({ field: "Research depth", value: "Fast", phrase: (lower.match(/quick(?:ly)?|fast|basic/) ?? [""])[0] });
  }

  if (criteria.categories.length === 0) warnings.push("No business category detected — choose one in the search builder.");

  // Anything not consumed by an interpretation is reported, not silently dropped.
  const consumed = interpretations.map((i) => i.phrase.toLowerCase()).filter(Boolean);
  const leftovers = lower
    .split(/[,.;]/)
    .map((s) => s.trim())
    .filter((s) => s && !consumed.some((c) => s.includes(c) || c.includes(s)) && !/^(find|search|show|get|list)\b/.test(s));
  return { criteria, interpretations, unparsed: leftovers, warnings };
}
