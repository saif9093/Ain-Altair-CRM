/**
 * Default category taxonomy. Seeds `public.categories` (global rows) and powers
 * natural-language parsing + category expansion. Organisations can add or
 * override categories in Admin → Categories.
 *
 * googleTypes: Google Places (New) primary types where one exists.
 * osm: OpenStreetMap tags used by the Overpass provider.
 * valueMultiplier: relative commercial value for sales-intent estimates.
 */
export interface CategoryDef {
  key: string;
  name: string;
  synonyms: string[];
  exclusions?: string[];
  googleTypes?: string[];
  osm?: { key: string; value: string }[];
  valueMultiplier?: number;
}

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  {
    key: "cleaning_services", name: "Cleaning Services",
    synonyms: ["cleaning", "cleaners", "cleaning company", "deep cleaning", "sofa cleaning", "carpet cleaning", "home cleaning", "house cleaning", "office cleaning", "commercial cleaning", "janitorial", "residential cleaning", "maid service", "housekeeping"],
    osm: [{ key: "craft", value: "cleaning" }, { key: "office", value: "cleaning" }, { key: "shop", value: "cleaning" }],
    valueMultiplier: 1.1,
  },
  {
    key: "flower_shops", name: "Flower Shops",
    synonyms: ["florist", "florists", "flower shop", "flowers", "flower delivery", "bouquets", "floral design"],
    googleTypes: ["florist"], osm: [{ key: "shop", value: "florist" }], valueMultiplier: 1.0,
  },
  {
    key: "salons", name: "Salons",
    synonyms: ["salon", "beauty salon", "ladies salon", "beauty center", "beauty centre", "nail salon", "nail spa", "spa", "hair salon", "beauty parlour", "lash studio", "brow bar"],
    googleTypes: ["beauty_salon", "hair_salon", "nail_salon", "spa"],
    osm: [{ key: "shop", value: "beauty" }, { key: "shop", value: "hairdresser" }, { key: "leisure", value: "spa" }],
    valueMultiplier: 1.15,
  },
  {
    key: "barbers", name: "Barbers",
    synonyms: ["barber", "barbershop", "barber shop", "gents salon", "men's salon", "mens grooming"],
    googleTypes: ["barber_shop"], osm: [{ key: "shop", value: "hairdresser" }], valueMultiplier: 0.9,
  },
  {
    key: "restaurants", name: "Restaurants",
    synonyms: ["restaurant", "restaurants", "eatery", "diner", "grill", "kitchen", "bistro", "takeaway", "food delivery"],
    googleTypes: ["restaurant"], osm: [{ key: "amenity", value: "restaurant" }, { key: "amenity", value: "fast_food" }],
    valueMultiplier: 1.2,
  },
  {
    key: "cafeterias", name: "Cafeterias & Cafés",
    synonyms: ["cafe", "café", "cafes", "coffee shop", "coffee", "cafeteria", "karak", "tea shop"],
    googleTypes: ["cafe", "coffee_shop", "cafeteria"], osm: [{ key: "amenity", value: "cafe" }], valueMultiplier: 0.95,
  },
  {
    key: "car_detailing", name: "Car Detailing",
    synonyms: ["car detailing", "auto detailing", "ceramic coating", "ppf", "paint protection film", "car polishing", "window tinting"],
    googleTypes: ["car_wash"], osm: [{ key: "amenity", value: "car_wash" }, { key: "shop", value: "car" }], valueMultiplier: 1.2,
  },
  {
    key: "mobile_car_wash", name: "Mobile Car Wash",
    synonyms: ["mobile car wash", "car wash", "doorstep car wash", "waterless car wash", "car cleaning"],
    googleTypes: ["car_wash"], osm: [{ key: "amenity", value: "car_wash" }], valueMultiplier: 1.0,
  },
  {
    key: "pest_control", name: "Pest Control",
    synonyms: ["pest control", "pest", "exterminator", "termite control", "fumigation", "bed bug treatment", "disinfection"],
    osm: [{ key: "craft", value: "pest_control" }, { key: "shop", value: "pest_control" }], valueMultiplier: 1.15,
  },
  {
    key: "ac_maintenance", name: "AC Maintenance",
    synonyms: ["ac maintenance", "ac repair", "air conditioning", "hvac", "ac cleaning", "duct cleaning", "ac service"],
    osm: [{ key: "craft", value: "hvac" }], valueMultiplier: 1.2,
  },
  {
    key: "home_maintenance", name: "Home Maintenance",
    synonyms: ["home maintenance", "handyman", "maintenance company", "plumber", "plumbing", "electrician", "painting services", "renovation", "technical services", "fit out"],
    googleTypes: ["plumber", "electrician", "painter", "general_contractor"],
    osm: [{ key: "craft", value: "handyman" }, { key: "craft", value: "plumber" }, { key: "craft", value: "electrician" }, { key: "craft", value: "painter" }],
    valueMultiplier: 1.15,
  },
  {
    key: "laundry", name: "Laundry",
    synonyms: ["laundry", "dry cleaning", "dry cleaners", "laundromat", "ironing", "laundry service"],
    googleTypes: ["laundry"], osm: [{ key: "shop", value: "laundry" }, { key: "shop", value: "dry_cleaning" }], valueMultiplier: 0.9,
  },
  {
    key: "pet_grooming", name: "Pet Grooming",
    synonyms: ["pet grooming", "dog grooming", "cat grooming", "pet salon", "pet spa", "pet care"],
    googleTypes: ["pet_care"], osm: [{ key: "shop", value: "pet_grooming" }], valueMultiplier: 1.05,
  },
  {
    key: "gyms", name: "Gyms & Fitness",
    synonyms: ["gym", "gyms", "fitness", "fitness center", "fitness centre", "crossfit", "personal training", "yoga studio", "pilates", "martial arts"],
    googleTypes: ["gym", "fitness_center", "yoga_studio"], osm: [{ key: "leisure", value: "fitness_centre" }, { key: "sport", value: "fitness" }],
    valueMultiplier: 1.15,
  },
  {
    key: "real_estate", name: "Real Estate Agencies",
    synonyms: ["real estate", "real estate agency", "property agency", "estate agent", "brokerage", "property management", "realtor"],
    googleTypes: ["real_estate_agency"], osm: [{ key: "office", value: "estate_agent" }], valueMultiplier: 1.4,
  },
  {
    key: "dental_clinics", name: "Dental Clinics",
    synonyms: ["dental clinic", "dentist", "dentists", "orthodontist", "dental care", "dental centre", "dental center"],
    googleTypes: ["dentist", "dental_clinic"], osm: [{ key: "amenity", value: "dentist" }, { key: "healthcare", value: "dentist" }],
    valueMultiplier: 1.4,
  },
  {
    key: "accountants", name: "Accountants",
    synonyms: ["accountant", "accountants", "accounting firm", "bookkeeping", "audit firm", "vat consultant", "tax consultant", "corporate tax"],
    googleTypes: ["accounting"], osm: [{ key: "office", value: "accountant" }, { key: "office", value: "tax_advisor" }], valueMultiplier: 1.3,
  },
  {
    key: "law_firms", name: "Law Firms",
    synonyms: ["law firm", "lawyer", "lawyers", "advocate", "advocates", "legal consultant", "legal services", "attorney"],
    googleTypes: ["lawyer"], osm: [{ key: "office", value: "lawyer" }], valueMultiplier: 1.4,
  },
  {
    key: "auto_repair", name: "Auto Repair",
    synonyms: ["auto repair", "car repair", "garage", "mechanic", "auto workshop", "car service", "car garage", "auto service"],
    googleTypes: ["car_repair"], osm: [{ key: "shop", value: "car_repair" }], valueMultiplier: 1.1,
  },
  {
    key: "tailors", name: "Tailors",
    synonyms: ["tailor", "tailors", "tailoring", "alterations", "abaya tailor", "bespoke tailoring", "stitching"],
    osm: [{ key: "craft", value: "tailor" }, { key: "shop", value: "tailor" }], valueMultiplier: 0.85,
  },
  {
    key: "bakeries", name: "Bakeries",
    synonyms: ["bakery", "bakeries", "cake shop", "patisserie", "custom cakes", "desserts", "pastry shop"],
    googleTypes: ["bakery"], osm: [{ key: "shop", value: "bakery" }, { key: "shop", value: "pastry" }], valueMultiplier: 1.0,
  },
  {
    key: "hotels", name: "Hotels",
    synonyms: ["hotel", "hotels", "hotel apartments", "guest house", "boutique hotel", "resort", "hostel"],
    exclusions: ["international chain"],
    googleTypes: ["hotel", "lodging"], osm: [{ key: "tourism", value: "hotel" }, { key: "tourism", value: "guest_house" }],
    valueMultiplier: 1.3,
  },
  {
    key: "travel_agencies", name: "Travel Agencies",
    synonyms: ["travel agency", "travel agent", "tour operator", "tours", "visa services", "holiday packages", "desert safari"],
    googleTypes: ["travel_agency"], osm: [{ key: "shop", value: "travel_agency" }, { key: "office", value: "travel_agent" }],
    valueMultiplier: 1.15,
  },
];

export function categoryByKey(key: string | null | undefined): CategoryDef | undefined {
  if (!key) return undefined;
  return DEFAULT_CATEGORIES.find((c) => c.key === key);
}

/** Expand a category into the search terms we will actually send to providers. */
export function expandCategoryTerms(cat: CategoryDef, extraKeywords: string[] = [], exclusions: string[] = []): string[] {
  const terms = [cat.name, ...cat.synonyms, ...extraKeywords];
  const excl = exclusions.map((e) => e.toLowerCase());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const norm = t.trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    if (excl.some((e) => norm.includes(e))) continue;
    seen.add(norm);
    out.push(t.trim());
  }
  return out;
}
