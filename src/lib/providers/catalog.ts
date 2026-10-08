/**
 * Static catalogue of supported providers: what they do, which env vars they
 * need and how to set them up. Credentials live ONLY in server environment
 * variables — never in the database or client bundle.
 */
export type ProviderKind = "DISCOVERY" | "ENRICHMENT" | "AUDIT" | "AI" | "GEOCODING" | "INTEROP";

export interface ProviderCatalogEntry {
  key: string;
  name: string;
  kind: ProviderKind;
  description: string;
  /** Env vars that must all be set for the provider to be usable. Empty = no credentials needed. */
  requiredEnv: string[];
  optionalEnv?: string[];
  defaultPriority: number;
  defaultRateLimitPerMinute?: number;
  docsUrl: string;
  setup: string[];
  /** Terms / responsible-use notes shown to admins. */
  notes?: string;
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    key: "google_places",
    name: "Google Places API (New)",
    kind: "DISCOVERY",
    description: "Official Google Maps Platform business listings: name, category, rating, reviews, phone, website, address, coordinates, hours and status.",
    requiredEnv: ["GOOGLE_PLACES_API_KEY"],
    defaultPriority: 10,
    defaultRateLimitPerMinute: 120,
    docsUrl: "https://developers.google.com/maps/documentation/places/web-service/text-search",
    setup: [
      "Create a Google Cloud project and enable billing.",
      "Enable “Places API (New)”.",
      "Create an API key restricted to Places API (New) (and to your server IPs if possible).",
      "Set GOOGLE_PLACES_API_KEY in the server environment (never NEXT_PUBLIC_).",
    ],
    notes: "Text Search returns at most 60 results per query (3 pages of 20); the coverage engine splits large areas into cells to go further. Usage is billed per request by Google.",
  },
  {
    key: "apify_google_maps",
    name: "Apify — Google Maps Scraper",
    kind: "DISCOVERY",
    description: "Runs an Apify actor (default: compass/crawler-google-places) that extracts public Google Maps listings, optionally including social links and emails.",
    requiredEnv: ["APIFY_TOKEN"],
    optionalEnv: ["APIFY_GOOGLE_MAPS_ACTOR"],
    defaultPriority: 20,
    defaultRateLimitPerMinute: 10,
    docsUrl: "https://apify.com/compass/crawler-google-places",
    setup: [
      "Create an Apify account and copy your API token (Settings → Integrations).",
      "Set APIFY_TOKEN in the server environment.",
      "Optionally set APIFY_GOOGLE_MAPS_ACTOR (default compass~crawler-google-places).",
    ],
    notes: "Apify usage is billed to your Apify account. Respect the actor's and Google's terms; operate conservatively.",
  },
  {
    key: "osm_overpass",
    name: "OpenStreetMap (Overpass API)",
    kind: "DISCOVERY",
    description: "Open, community-maintained points of interest with name, category tags, phone, website and coordinates. No API key required.",
    requiredEnv: [],
    optionalEnv: ["OVERPASS_API_URL"],
    defaultPriority: 30,
    defaultRateLimitPerMinute: 6,
    docsUrl: "https://wiki.openstreetmap.org/wiki/Overpass_API",
    setup: ["Works out of the box against the public Overpass endpoint.", "For heavy use, point OVERPASS_API_URL at your own Overpass instance."],
    notes: "Public Overpass servers are shared infrastructure; requests are rate-limited conservatively. Data © OpenStreetMap contributors (ODbL).",
  },
  {
    key: "brave_search",
    name: "Brave Search API",
    kind: "ENRICHMENT",
    description: "Web search used to discover a business's website and public social profiles when listings do not include them.",
    requiredEnv: ["BRAVE_SEARCH_API_KEY"],
    defaultPriority: 40,
    defaultRateLimitPerMinute: 50,
    docsUrl: "https://api-dashboard.search.brave.com/app/documentation/web-search/get-started",
    setup: ["Subscribe to the Brave Search API (free tier available).", "Set BRAVE_SEARCH_API_KEY in the server environment."],
  },
  {
    key: "website_audit",
    name: "Built-in Website Auditor",
    kind: "AUDIT",
    description: "Fetches the public homepage and evaluates HTTPS/SSL, status, viewport, CTA, WhatsApp, forms, booking, services, SEO basics and outdated-site indicators.",
    requiredEnv: [],
    defaultPriority: 50,
    defaultRateLimitPerMinute: 60,
    docsUrl: "https://developer.mozilla.org/en-US/docs/Web/HTTP",
    setup: ["No setup needed. Requests identify themselves with the AUDIT_USER_AGENT (configurable) and respect robots.txt."],
  },
  {
    key: "pagespeed",
    name: "Google PageSpeed Insights",
    kind: "AUDIT",
    description: "Measured Lighthouse performance, SEO, accessibility and Core Web Vitals (mobile strategy). Only measured data is ever used to call a site “slow”.",
    requiredEnv: ["PAGESPEED_API_KEY"],
    defaultPriority: 55,
    defaultRateLimitPerMinute: 60,
    docsUrl: "https://developers.google.com/speed/docs/insights/v5/get-started",
    setup: ["Enable the PageSpeed Insights API in Google Cloud.", "Create an API key and set PAGESPEED_API_KEY."],
  },
  {
    key: "nominatim",
    name: "OpenStreetMap Nominatim",
    kind: "GEOCODING",
    description: "Resolves place names (country, emirate, city, neighbourhood, postcode) into coordinates, bounding boxes and polygons.",
    requiredEnv: [],
    optionalEnv: ["NOMINATIM_URL", "NOMINATIM_EMAIL"],
    defaultPriority: 60,
    defaultRateLimitPerMinute: 50,
    docsUrl: "https://nominatim.org/release-docs/latest/api/Search/",
    setup: ["Works out of the box (max 1 request/second on the public server).", "Set NOMINATIM_EMAIL to identify your application per the usage policy."],
    notes: "Results are cached in the locations table to avoid repeat lookups.",
  },
  {
    key: "anthropic",
    name: "Claude (Anthropic API)",
    kind: "AI",
    description: "AI-assisted search interpretation, lead analysis, outreach drafting and the AI Sales Assistant. All output is labelled as AI inference.",
    requiredEnv: ["ANTHROPIC_API_KEY"],
    optionalEnv: ["ANTHROPIC_MODEL"],
    defaultPriority: 70,
    defaultRateLimitPerMinute: 50,
    docsUrl: "https://platform.claude.com/docs",
    setup: ["Create an API key in the Claude Console.", "Set ANTHROPIC_API_KEY in the server environment."],
  },
  {
    key: "google_sheets",
    name: "Google Sheets",
    kind: "INTEROP",
    description: "Optional import from and export to Google Sheets via a service account. Supabase remains the source of truth.",
    requiredEnv: ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"],
    optionalEnv: ["GOOGLE_SHEETS_SHARE_WITH"],
    defaultPriority: 80,
    defaultRateLimitPerMinute: 60,
    docsUrl: "https://developers.google.com/sheets/api/guides/concepts",
    setup: [
      "Create a service account in Google Cloud and enable the Google Sheets and Google Drive APIs.",
      "Create a JSON key; set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (keep \\n escapes).",
      "Share source sheets with the service account email to import them.",
      "Optionally set GOOGLE_SHEETS_SHARE_WITH so exported sheets are shared with your team.",
    ],
  },
];

export function catalogEntry(key: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.key === key);
}

/** Server-only: whether all required env vars are present. Never returns values. */
export function isProviderConfigured(key: string, env: Record<string, string | undefined> = process.env): boolean {
  const entry = catalogEntry(key);
  if (!entry) return false;
  return entry.requiredEnv.every((v) => typeof env[v] === "string" && env[v]!.trim().length > 0);
}

export function missingEnv(key: string, env: Record<string, string | undefined> = process.env): string[] {
  const entry = catalogEntry(key);
  if (!entry) return [];
  return entry.requiredEnv.filter((v) => !(typeof env[v] === "string" && env[v]!.trim().length > 0));
}
