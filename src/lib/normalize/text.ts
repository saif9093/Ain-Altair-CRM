/** Business-name and text normalisation used for matching and display. */

// Legal / corporate suffixes that should not affect entity matching.
const LEGAL_SUFFIXES = [
  "l\\.?l\\.?c\\.?", "llc", "l\\.?l\\.?p", "ltd\\.?", "limited", "inc\\.?", "incorporated", "co\\.?", "corp\\.?", "corporation",
  "fze", "fzco", "fz-?llc", "fzc", "fz", "est\\.?", "establishment", "plc", "pvt\\.?", "private", "gmbh", "s\\.?a\\.?r\\.?l", "w\\.?l\\.?l",
  "sole proprietorship( llc)?", "one person company", "opc", "branch", "trading", "general trading", "&? ?co",
];

// Generic words that inflate similarity between unrelated businesses.
const STOPWORDS = new Set(["the", "and", "of", "for", "a", "an", "&", "dubai", "uae", "sharjah", "ajman", "abu", "dhabi"]);

const PLURALS: [RegExp, string][] = [
  [/\bservices\b/g, "service"],
  [/\bsalons\b/g, "salon"],
  [/\bshops\b/g, "shop"],
  [/\bflowers\b/g, "flower"],
  [/\bcleaners\b/g, "cleaning"],
  [/\brestaurants\b/g, "restaurant"],
];

export function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Lowercase, strip punctuation, diacritics, legal suffixes; collapse whitespace. */
export function normalizeBusinessName(name: string): string {
  let s = stripDiacritics(name).toLowerCase();
  s = s.replace(/[’'`]/g, "");
  // Collapse dotted abbreviations first ("L.L.C." → "llc") so suffixes are recognised.
  s = s.replace(/\b([a-z])\.(?=[a-z]\.?)/g, "$1").replace(/\b([a-z]{1,3})\.(?=\s|$)/g, "$1");
  s = s.replace(/[^\p{L}\p{N}&]+/gu, " ").trim();
  for (let i = 0; i < 2; i++) {
    for (const suf of LEGAL_SUFFIXES) {
      s = s.replace(new RegExp(`(?:^|\\s)${suf}$`, "i"), "").trim();
    }
  }
  for (const [re, rep] of PLURALS) s = s.replace(re, rep);
  return s.replace(/\s+/g, " ").trim();
}

/** Tokens used for fuzzy matching (stopwords removed). */
export function nameTokens(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/** Title-case a name for display without mangling acronyms (e.g. "AC", "UAE"). */
export function displayName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (trimmed !== trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length <= 3 && /^[a-z]+$/.test(w) && ["ac", "uae", "llc", "fze", "it"].includes(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function slugify(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0];
  // Pragmatic validation; rejects image filenames that look like emails (e.g. logo@2x.png).
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(e)) return null;
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(e)) return null;
  if (/(example\.com|sentry\.io|wixpress\.com|domain\.com)$/.test(e)) return null;
  return e;
}
