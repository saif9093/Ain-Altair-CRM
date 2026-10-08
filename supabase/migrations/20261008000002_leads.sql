-- ============================================================================
-- 0002 LEAD DATA MODEL
-- Data layers are kept distinct:
--   RAW         -> source_records (0003)
--   NORMALISED  -> businesses core columns + business_field_sources (provenance)
--   RESEARCHED  -> websites, website_audits, business_socials
--   AI ANALYSIS -> businesses.ai_analysis (always labelled, never merged into facts)
--   SALES       -> pipeline, outreach, follow_ups, notes, opportunities
-- ============================================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade, -- null = global default
  key text not null,
  name text not null,
  parent_key text,
  synonyms text[] not null default '{}',
  exclusions text[] not null default '{}',
  google_types text[] not null default '{}',
  osm_tags jsonb not null default '[]'::jsonb, -- [{"key":"shop","value":"florist"}]
  value_multiplier numeric not null default 1.0, -- commercial value weighting for sales intent
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_org_key_idx on public.categories(coalesce(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
create trigger categories_touch before update on public.categories for each row execute function public.touch_updated_at();

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade, -- null = shared geocode cache
  name text not null,
  display_name text,
  kind text not null check (kind in ('COUNTRY','REGION','EMIRATE','STATE','CITY','DISTRICT','NEIGHBOURHOOD','AREA','POSTCODE','CUSTOM')),
  parent_id uuid references public.locations(id) on delete set null,
  country_code text,
  lat double precision,
  lng double precision,
  bbox double precision[] check (bbox is null or array_length(bbox, 1) = 4), -- [south, west, north, east]
  geojson jsonb,
  source text not null default 'MANUAL' check (source in ('NOMINATIM','GOOGLE','MANUAL','DRAWN')),
  external_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index locations_parent_idx on public.locations(parent_id);
create index locations_name_trgm on public.locations using gin (name gin_trgm_ops);

create sequence public.lead_code_seq start 1000;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  lead_code text not null unique default ('AA-' || lpad(nextval('public.lead_code_seq')::text, 6, '0')),
  lifecycle text not null default 'RESEARCH' check (lifecycle in ('RESEARCH','ACTIVE','ARCHIVED','MERGED','REJECTED')),
  merged_into uuid references public.businesses(id) on delete set null,

  -- identity (normalised)
  name text not null,
  normalized_name text not null,
  category_key text,
  category_label text,
  subcategory text,
  keywords text[] not null default '{}',
  description text,

  -- location
  country_code text,
  country text,
  region text,
  city text,
  district text,
  area text,
  postal_code text,
  address text,
  lat double precision,
  lng double precision,

  -- phone (international — never assumes UAE)
  phone_e164 text,
  phone_country_code text,      -- e.g. "971"
  phone_national text,          -- e.g. "501234567"
  phone_formatted text,         -- e.g. "+971 50 123 4567"
  phone_region text,            -- ISO2 of the number, e.g. "AE"
  phone_type text,              -- MOBILE / FIXED_LINE / FIXED_LINE_OR_MOBILE / TOLL_FREE / UNKNOWN
  whatsapp_e164 text,           -- only set from evidence (wa.me link, WhatsApp widget, user entry)
  whatsapp_source text,         -- where the WhatsApp evidence came from
  email text,
  email_source text,

  -- web
  website_url text,
  website_domain text,
  website_status text not null default 'UNKNOWN',  -- primary classification, see website_audits.classifications
  website_issues text[] not null default '{}',
  website_score int check (website_score between 0 and 100),

  -- google business profile
  google_place_id text,
  google_maps_url text,
  google_rating numeric(2,1),
  google_review_count int,
  business_status text not null default 'UNKNOWN' check (business_status in ('OPERATIONAL','CLOSED_TEMPORARILY','CLOSED_PERMANENTLY','UNKNOWN')),
  opening_hours jsonb,
  price_level text,

  -- observable classification
  business_size text not null default 'UNKNOWN' check (business_size in ('MICRO','SMALL','MEDIUM','LARGE','ENTERPRISE','UNKNOWN')),
  franchise_status text not null default 'UNKNOWN' check (franchise_status in ('FRANCHISE','INDEPENDENT','UNKNOWN')),

  -- scoring (current values; history in lead_scores / sales_intent)
  lead_score int check (lead_score between 0 and 100),
  lead_score_breakdown jsonb,
  sales_intent int check (sales_intent between 0 and 100),
  sales_intent_factors jsonb,
  tier text check (tier in ('HOT','HIGH','GOOD','MEDIUM','LOW')),

  -- commercial (non-monetary). Amounts live in public.lead_pricing, which is
  -- only readable with the pricing.view permission.
  recommended_service text,
  recommended_package text,
  upsells text[] not null default '{}',

  -- sales
  pipeline_stage text not null default 'NOT_CONTACTED' check (pipeline_stage in ('NOT_CONTACTED','CONTACTED','REPLIED','INTERESTED','MEETING','QUOTE_SENT','WON','LOST')),
  owner_id uuid references public.profiles(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  next_follow_up_at timestamptz,
  last_contacted_at timestamptz,
  lost_reason text,

  -- AI layer (inference — never treated as observed fact)
  ai_analysis jsonb,
  ai_generated_at timestamptz,
  ai_model text,

  -- future: website preview generation
  preview_status text not null default 'NOT_CREATED' check (preview_status in ('NOT_CREATED','QUEUED','GENERATING','READY','SENT')),

  -- governance
  field_confidence jsonb not null default '{}'::jsonb, -- {"phone":"HIGH","email":"MEDIUM"}
  overrides jsonb not null default '{}'::jsonb,        -- manual overrides: {"lead_score":{"value":95,"by":"...","at":"...","reason":"..."}}
  source text,
  source_confidence text check (source_confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  last_researched_at timestamptz,
  last_audited_at timestamptz,

  search_text tsvector generated always as (
    to_tsvector('simple',
      coalesce(name,'') || ' ' || coalesce(category_label,'') || ' ' || coalesce(subcategory,'') || ' ' ||
      coalesce(city,'') || ' ' || coalesce(area,'') || ' ' || coalesce(district,'') || ' ' ||
      coalesce(website_domain,'') || ' ' || coalesce(email,'') || ' ' || coalesce(lead_code,''))
  ) stored
);

create trigger businesses_touch before update on public.businesses for each row execute function public.touch_updated_at();

-- Indexes designed for 100k+ rows with server-side filtering.
create index businesses_org_lifecycle_score_idx on public.businesses(organisation_id, lifecycle, lead_score desc nulls last);
create index businesses_org_stage_idx on public.businesses(organisation_id, pipeline_stage) where lifecycle = 'ACTIVE';
create index businesses_owner_idx on public.businesses(owner_id) where lifecycle = 'ACTIVE';
create index businesses_team_idx on public.businesses(team_id);
create index businesses_category_city_idx on public.businesses(organisation_id, category_key, city);
create index businesses_tier_idx on public.businesses(organisation_id, tier) where lifecycle = 'ACTIVE';
create index businesses_website_status_idx on public.businesses(organisation_id, website_status);
create index businesses_follow_up_idx on public.businesses(next_follow_up_at) where next_follow_up_at is not null;
create index businesses_phone_idx on public.businesses(organisation_id, phone_e164) where phone_e164 is not null;
create index businesses_domain_idx on public.businesses(organisation_id, website_domain) where website_domain is not null;
create index businesses_place_idx on public.businesses(organisation_id, google_place_id) where google_place_id is not null;
create index businesses_email_idx on public.businesses(organisation_id, lower(email)) where email is not null;
create index businesses_geo_idx on public.businesses(organisation_id, lat, lng) where lat is not null;
create index businesses_name_trgm on public.businesses using gin (normalized_name gin_trgm_ops);
create index businesses_search_idx on public.businesses using gin (search_text);
create index businesses_created_idx on public.businesses(organisation_id, created_at desc);

-- Field-level provenance. Every observed value with where it came from.
create table public.business_field_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  field text not null,
  value text,
  provider text not null,
  source_url text,
  source_record_id uuid,
  confidence text not null default 'UNKNOWN' check (confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  is_current boolean not null default false,
  retrieved_at timestamptz not null default now()
);
create index bfs_business_field_idx on public.business_field_sources(business_id, field, retrieved_at desc);

create table public.business_socials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  platform text not null check (platform in ('INSTAGRAM','FACEBOOK','TIKTOK','LINKEDIN','YOUTUBE','X','SNAPCHAT','OTHER')),
  url text not null,
  username text,
  followers int,
  followers_source text,
  last_post_at timestamptz,
  activity text not null default 'UNKNOWN' check (activity in ('ACTIVE','INACTIVE','UNKNOWN')),
  source text not null,
  source_url text,
  confidence text not null default 'UNKNOWN' check (confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  detected_at timestamptz not null default now(),
  checked_at timestamptz,
  unique (business_id, platform, url)
);
create index business_socials_platform_idx on public.business_socials(platform, activity);

create table public.websites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  url text not null,
  domain text not null,
  is_primary boolean not null default true,
  first_detected_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_status text,
  removed_at timestamptz,
  unique (business_id, domain)
);

create table public.website_audits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  website_id uuid references public.websites(id) on delete set null,
  audited_at timestamptz not null default now(),
  requested_url text not null,
  final_url text,
  http_status int,
  reachable boolean not null default false,
  https boolean,
  ssl_valid boolean,
  redirect_count int,
  response_ms int,
  page_bytes int,
  -- structure / content signals
  has_viewport boolean,
  title text,
  meta_description text,
  h1_count int,
  has_cta boolean,
  has_whatsapp boolean,
  has_phone_link boolean,
  has_email boolean,
  has_form boolean,
  has_booking boolean,
  has_services boolean,
  has_about boolean,
  has_contact boolean,
  has_location_pages boolean,
  has_structured_data boolean,
  nav_link_count int,
  internal_link_count int,
  image_count int,
  images_missing_alt int,
  copyright_year int,
  generator text,
  technologies text[] not null default '{}',
  -- measured performance (PageSpeed / Lighthouse) — null when not measured
  perf_source text,
  performance_score int,
  mobile_score int,
  seo_score int,
  accessibility_score int,
  best_practices_score int,
  lcp_ms int,
  cls numeric,
  tbt_ms int,
  -- results
  website_score int,
  classifications text[] not null default '{}',
  evidence jsonb not null default '[]'::jsonb,
  error text,
  raw jsonb
);
create index website_audits_business_idx on public.website_audits(business_id, audited_at desc);

create table public.lead_scores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  score int not null check (score between 0 and 100),
  tier text not null,
  breakdown jsonb not null,
  config_version int,
  is_override boolean not null default false,
  override_reason text,
  computed_by uuid references auth.users(id),
  computed_at timestamptz not null default now()
);
create index lead_scores_business_idx on public.lead_scores(business_id, computed_at desc);

create table public.sales_intent (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  score int not null check (score between 0 and 100),
  factors jsonb not null,
  method text not null default 'HEURISTIC_ESTIMATE',
  is_override boolean not null default false,
  computed_by uuid references auth.users(id),
  computed_at timestamptz not null default now()
);
create index sales_intent_business_idx on public.sales_intent(business_id, computed_at desc);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  type text not null check (type in ('NEW_WEBSITE','WEBSITE_REDESIGN','WEBSITE_FIX','LANDING_PAGE','MOBILE_OPTIMISATION','SEO','LOCAL_SEO','GOOGLE_BUSINESS_OPTIMISATION','WHATSAPP_INTEGRATION','BOOKING_SYSTEM','DIGITAL_MENU','CATALOGUE','LEAD_FORM','CRM','AUTOMATION','MAINTENANCE','OTHER')),
  priority int not null default 50 check (priority between 0 and 100),
  value_band text check (value_band in ('$','$$','$$$','$$$$','$$$$$')),
  reason text not null,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN','PITCHED','WON','LOST','DISMISSED')),
  is_override boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, type)
);
create trigger opportunities_touch before update on public.opportunities for each row execute function public.touch_updated_at();
create index opportunities_type_idx on public.opportunities(type, status);

-- Commercial amounts, isolated so row-level security can hide them from BDOs.
create table public.lead_pricing (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  currency text not null default 'AED',
  recommended_price_min numeric,
  recommended_price_max numeric,
  opportunity_value numeric,          -- ESTIMATE
  opportunity_values jsonb not null default '{}'::jsonb, -- {"NEW_WEBSITE":{"min":750,"max":1000}}
  deal_value numeric,                 -- actual agreed amount
  price_override boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create trigger lead_pricing_touch before update on public.lead_pricing for each row execute function public.touch_updated_at();

create table public.outreach (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null check (channel in ('WHATSAPP','CALL','EMAIL','INSTAGRAM','FACEBOOK','IN_PERSON','OTHER')),
  direction text not null default 'OUTBOUND' check (direction in ('OUTBOUND','INBOUND')),
  message text,
  outcome text,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index outreach_business_idx on public.outreach(business_id, created_at desc);

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  due_at timestamptz not null,
  note text,
  status text not null default 'PENDING' check (status in ('PENDING','DONE','CANCELLED')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index follow_ups_due_idx on public.follow_ups(status, due_at);
create index follow_ups_assignee_idx on public.follow_ups(assigned_to, status, due_at);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  body text not null check (length(body) between 1 and 10000),
  visibility text not null default 'TEAM' check (visibility in ('PRIVATE','TEAM')),
  author_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_business_idx on public.notes(business_id, created_at desc);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table public.lead_tags (
  business_id uuid not null references public.businesses(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (business_id, tag_id)
);

-- Lead timeline & change detection events
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  type text not null,
  title text not null,
  data jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id),
  search_job_id uuid,
  created_at timestamptz not null default now()
);
create index activities_business_idx on public.activities(business_id, created_at desc);
create index activities_org_type_idx on public.activities(organisation_id, type, created_at desc);

-- Change detection baseline per research run
create table public.business_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  search_job_id uuid,
  snapshot jsonb not null,
  taken_at timestamptz not null default now()
);
create index business_snapshots_idx on public.business_snapshots(business_id, taken_at desc);

-- Entity resolution
create table public.duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  business_a uuid not null references public.businesses(id) on delete cascade,
  business_b uuid not null references public.businesses(id) on delete cascade,
  confidence int not null check (confidence between 0 and 100),
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN','MERGED','DISMISSED')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  check (business_a < business_b),
  unique (business_a, business_b)
);
create index duplicate_candidates_open_idx on public.duplicate_candidates(organisation_id, status, confidence desc);

create table public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  scope text not null default 'leads',
  filters jsonb not null,
  is_shared boolean not null default false,
  created_at timestamptz not null default now()
);
