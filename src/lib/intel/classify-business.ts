/**
 * Observable-signal classification of business size and franchise status.
 * Never invents employee counts — returns UNKNOWN without enough signals and
 * lists the signals used so the UI can show them.
 */

export type BusinessSize = "MICRO" | "SMALL" | "MEDIUM" | "LARGE" | "ENTERPRISE" | "UNKNOWN";
export type FranchiseStatus = "FRANCHISE" | "INDEPENDENT" | "UNKNOWN";

// Well-known chains/franchises commonly found in GCC listings (extend in Admin).
export const KNOWN_CHAINS = [
  "starbucks", "mcdonalds", "mcdonald s", "kfc", "subway", "pizza hut", "dominos", "domino s", "burger king", "hardees", "costa coffee",
  "tim hortons", "dunkin", "baskin robbins", "papa johns", "papa john s", "nandos", "shake shack", "five guys", "paul", "caribou coffee",
  "tchibo", "krispy kreme", "cinnabon", "gold s gym", "golds gym", "fitness first", "anytime fitness", "gymnation", "snap fitness",
  "toni guy", "tips toes", "tips & toes", "nstyle", "n style", "sisters beauty lounge", "emaar", "damac", "betterhomes", "allsopp allsopp",
  "dubizzle", "carrefour", "lulu", "spinneys", "waitrose", "choithrams", "aster", "nmc", "mediclinic", "drs nicolas asp", "dr nicolas asp",
  "emirates nbd", "adcb", "rotana", "marriott", "hilton", "hyatt", "accor", "ibis", "novotel", "jumeirah", "rove", "citymax", "premier inn",
  "al tayer", "al futtaim", "jashanmal", "magrudy", "flowers by", "interflora", "tavola", "home centre", "ace hardware", "petzone",
  "the pet shop", "pet s delight", "dr fixit", "servicemarket", "justlife", "urban company", "helpbit", "mr usta", "emrill", "imdaad",
];

export function classifyBusinessSize(input: {
  reviewCount?: number | null;
  hasWebsite?: boolean;
  locationCount?: number | null;       // same brand seen at N locations in research
  isKnownChain?: boolean;
}): { size: BusinessSize; signals: string[] } {
  const signals: string[] = [];
  const r = input.reviewCount;
  if (input.isKnownChain) {
    signals.push("recognised chain/brand");
    return { size: "ENTERPRISE", signals };
  }
  if ((input.locationCount ?? 1) >= 6) {
    signals.push(`${input.locationCount} locations observed`);
    return { size: "LARGE", signals };
  }
  if (r == null) return { size: "UNKNOWN", signals: ["no review data"] };
  signals.push(`${r} reviews`);
  if ((input.locationCount ?? 1) >= 3) {
    signals.push(`${input.locationCount} locations observed`);
    return { size: r >= 1500 ? "LARGE" : "MEDIUM", signals };
  }
  if (r >= 1500) return { size: "LARGE", signals };
  if (r >= 400) return { size: "MEDIUM", signals };
  if (r < 15 && input.hasWebsite === false) {
    signals.push("no website");
    return { size: "MICRO", signals };
  }
  return { size: "SMALL", signals };
}

export function isKnownChain(normalizedName: string, extraChains: string[] = []): boolean {
  const n = ` ${normalizedName.toLowerCase()} `;
  return [...KNOWN_CHAINS, ...extraChains].some((c) => n.includes(` ${c} `) || n.startsWith(` ${c}`));
}

export function detectFranchise(input: {
  normalizedName: string;
  sameNameLocationCount?: number; // within the same research job/CRM
  sharedDomainCount?: number;     // listings sharing the same website domain
  rawName?: string;
  extraChains?: string[];
}): { status: FranchiseStatus; signals: string[] } {
  const signals: string[] = [];
  if (isKnownChain(input.normalizedName, input.extraChains)) signals.push("recognised chain/brand name");
  if ((input.sameNameLocationCount ?? 1) >= 3) signals.push(`same name at ${input.sameNameLocationCount} locations`);
  if ((input.sharedDomainCount ?? 1) >= 3) signals.push(`website shared by ${input.sharedDomainCount} listings`);
  if (input.rawName && /\b(branch|franchise)\b|\s[-–|]\s*(mall|city centre|city center|branch)\b/i.test(input.rawName)) signals.push("branch naming pattern");
  if (signals.length) return { status: "FRANCHISE", signals };
  if ((input.sameNameLocationCount ?? 1) === 1 && input.sameNameLocationCount !== undefined) return { status: "INDEPENDENT", signals: ["single location observed"] };
  return { status: "UNKNOWN", signals: [] };
}
