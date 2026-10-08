-- AIN ALTAIR LEAD INTELLIGENCE — all migrations in one file for the Supabase SQL editor.
-- Generated from supabase/migrations. Run once on a fresh project.

-- >>> 20261008000001_core_identity.sql
-- ============================================================================
-- AIN ALTAIR LEAD INTELLIGENCE — 0001 CORE IDENTITY, ROLES & PERMISSIONS
-- Multi-tenant ready: every business table carries organisation_id.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ---------------------------------------------------------------------------
-- Organisations & teams
-- ---------------------------------------------------------------------------
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  default_currency text not null default 'AED',
  default_country_code text not null default 'AE',
  timezone text not null default 'Asia/Dubai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, name)
);

-- ---------------------------------------------------------------------------
-- Roles & permissions (granular). Role keys are fixed; permissions are data.
-- ---------------------------------------------------------------------------
create table public.roles (
  key text primary key check (key in ('SUPER_ADMIN','ADMIN','MANAGER','SALES','RESEARCHER','VIEWER')),
  name text not null,
  description text,
  rank int not null -- higher = more privileged; used to stop privilege escalation
);

create table public.permissions (
  key text primary key,
  description text not null,
  category text not null
);

create table public.role_permissions (
  role_key text not null references public.roles(key) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

-- ---------------------------------------------------------------------------
-- Users (application profile for each auth.users row)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organisation_id uuid references public.organisations(id) on delete set null,
  email text not null,
  full_name text,
  role_key text not null default 'VIEWER' references public.roles(key),
  status text not null default 'PENDING' check (status in ('PENDING','ACTIVE','SUSPENDED','REJECTED')),
  team_id uuid references public.teams(id) on delete set null,
  avatar_url text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_org_idx on public.profiles(organisation_id, status);
create unique index profiles_email_idx on public.profiles(lower(email));

-- Per-user grants/revocations layered over the role.
create table public.user_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, permission_key)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  email text not null,
  role_key text not null references public.roles(key),
  team_id uuid references public.teams(id) on delete set null,
  token_hash text not null unique, -- sha256 of the token; the raw token is only ever emailed/shown once
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index invites_org_idx on public.invites(organisation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helper functions used by RLS. SECURITY DEFINER so they can read profiles
-- without recursive policy evaluation; search_path pinned.
-- ---------------------------------------------------------------------------
create or replace function public.current_profile()
returns public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.current_org()
returns uuid
language sql stable security definer set search_path = public as $$
  select p.organisation_id from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'
$$;

create or replace function public.current_team()
returns uuid
language sql stable security definer set search_path = public as $$
  select p.team_id from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE')
$$;

create or replace function public.has_perm(perm text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE') then false
    when exists (select 1 from public.profiles p where p.id = auth.uid() and p.role_key = 'SUPER_ADMIN') then true
    when exists (select 1 from public.user_permissions up where up.user_id = auth.uid() and up.permission_key = perm and up.granted = false) then false
    when exists (select 1 from public.user_permissions up where up.user_id = auth.uid() and up.permission_key = perm and up.granted = true) then true
    else exists (
      select 1 from public.profiles p
      join public.role_permissions rp on rp.role_key = p.role_key
      where p.id = auth.uid() and rp.permission_key = perm
    )
  end
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role_key = 'SUPER_ADMIN')
$$;

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger organisations_touch before update on public.organisations for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- Users may edit their own name/avatar, but never their own role, status,
-- organisation or team. Those change only through the service role, which the
-- server uses after verifying admin.users permission and logging the change.
-- SECURITY INVOKER on purpose: current_user must reflect the caller's role.
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres','supabase_admin') then
    return new;
  end if;
  if new.role_key is distinct from old.role_key
     or new.status is distinct from old.status
     or new.organisation_id is distinct from old.organisation_id
     or new.team_id is distinct from old.team_id
     or new.approved_by is distinct from old.approved_by then
    raise exception 'Privileged profile fields can only be changed by an administrator';
  end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles for each row execute function public.protect_profile_privileges();

-- New auth user -> PENDING profile in the default organisation (or the
-- organisation of a valid invite, which the server finalises on acceptance).
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  default_org uuid;
begin
  select id into default_org from public.organisations order by created_at asc limit 1;
  insert into public.profiles (id, organisation_id, email, full_name, status, role_key)
  values (
    new.id,
    default_org,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'PENDING',
    'VIEWER'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- >>> 20261008000002_leads.sql
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

-- >>> 20261008000003_research.sql
-- ============================================================================
-- 0003 RESEARCH ENGINE: providers, searches, jobs, queue, staging, raw data,
-- coverage, imports/exports, approvals, audit logs, notifications, settings.
-- ============================================================================

-- Provider registry. Secrets are NEVER stored here — only in server env vars.
create table public.providers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  key text not null,
  name text not null,
  kind text not null check (kind in ('DISCOVERY','ENRICHMENT','AUDIT','AI','GEOCODING','INTEROP')),
  enabled boolean not null default true,
  priority int not null default 100, -- lower runs first (primary), higher are fallbacks
  config jsonb not null default '{}'::jsonb, -- non-secret config (e.g. language, max pages)
  rate_limit_per_minute int,
  daily_quota int,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  run_count int not null default 0,
  error_count int not null default 0,
  usage_today int not null default 0,
  usage_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, key)
);
create trigger providers_touch before update on public.providers for each row execute function public.touch_updated_at();

create table public.searches (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  description text,
  natural_query text,
  criteria jsonb not null, -- full SearchCriteria (see src/lib/search/criteria.ts)
  is_template boolean not null default false,
  schedule_cron text,
  schedule_timezone text not null default 'Asia/Dubai',
  schedule_enabled boolean not null default false,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_job_id uuid,
  run_count int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create trigger searches_touch before update on public.searches for each row execute function public.touch_updated_at();
create index searches_org_idx on public.searches(organisation_id, created_at desc) where archived_at is null;
create index searches_schedule_idx on public.searches(next_run_at) where schedule_enabled and archived_at is null;

create table public.search_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  search_id uuid references public.searches(id) on delete set null,
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  providers text[] not null default '{}',
  provider text, -- primary provider
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','ENRICHING','AUDITING','DEDUPLICATING','SCORING','COMPLETED','PARTIALLY_COMPLETED','FAILED','CANCELLED')),
  depth text not null default 'BALANCED' check (depth in ('FAST','BALANCED','DEEP')),
  is_scheduled boolean not null default false,
  previous_job_id uuid references public.search_jobs(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  target_count int not null default 100,
  discovered_count int not null default 0,
  retained_count int not null default 0,
  duplicate_count int not null default 0,
  rejected_count int not null default 0,
  enriched_count int not null default 0,
  audited_count int not null default 0,
  qualified_count int not null default 0,
  error_count int not null default 0,
  new_count int not null default 0,
  changed_count int not null default 0,
  configuration jsonb not null default '{}'::jsonb,
  filters jsonb not null default '{}'::jsonb,
  location_definition jsonb not null default '{}'::jsonb,
  category_definition jsonb not null default '{}'::jsonb,
  source_status jsonb not null default '{}'::jsonb, -- {"google_places":{"state":"DONE","found":120,"pages":3,"error":null}}
  progress jsonb not null default '{}'::jsonb,       -- {"sourcing":{"done":4,"total":6},"enrichment":{...}}
  stats jsonb,                                       -- search result intelligence
  recommendations jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger search_jobs_touch before update on public.search_jobs for each row execute function public.touch_updated_at();
create index search_jobs_org_idx on public.search_jobs(organisation_id, created_at desc);
create index search_jobs_search_idx on public.search_jobs(search_id, created_at desc);
create index search_jobs_status_idx on public.search_jobs(status) where status not in ('COMPLETED','PARTIALLY_COMPLETED','FAILED','CANCELLED');

-- Durable work queue (Postgres SKIP LOCKED). Processed by the worker process
-- (scripts/worker.ts) or the cron route (/api/cron/worker).
create table public.job_tasks (
  id bigserial primary key,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid references public.search_jobs(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  priority int not null default 100,
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','DONE','FAILED','CANCELLED')),
  attempts int not null default 0,
  max_attempts int not null default 4,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index job_tasks_claim_idx on public.job_tasks(status, run_after, priority, id) where status = 'PENDING';
create index job_tasks_job_idx on public.job_tasks(job_id, status);

-- Raw provider payloads — kept verbatim for debugging and reprocessing.
create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  provider text not null,
  external_id text,
  search_job_id uuid references public.search_jobs(id) on delete set null,
  import_id uuid,
  business_id uuid references public.businesses(id) on delete set null,
  raw_payload jsonb not null,
  source_url text,
  retrieved_at timestamptz not null default now()
);
create index source_records_business_idx on public.source_records(business_id);
create index source_records_job_idx on public.source_records(search_job_id);
create index source_records_external_idx on public.source_records(organisation_id, provider, external_id);

-- Research staging: which businesses a job found and their review stage.
create table public.search_results (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid not null references public.search_jobs(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  stage text not null default 'RAW' check (stage in ('RAW','ENRICHING','QUALIFIED','REVIEW_REQUIRED','REJECTED','APPROVED')),
  matched_existing boolean not null default false, -- business already existed (CRM or earlier research)
  is_new boolean not null default true,            -- not seen in the previous run of the same search
  changes jsonb not null default '[]'::jsonb,       -- change detection vs. previous snapshot
  qualification jsonb not null default '{}'::jsonb, -- {"passed":[...],"failed":[...],"gate":{...}}
  sources text[] not null default '{}',
  category_key text,
  reject_reason text check (reject_reason in ('DUPLICATE','LARGE_COMPANY','FRANCHISE','NO_CONTACT','NOT_RELEVANT','EXCELLENT_WEBSITE','CLOSED','INVALID','LOW_QUALITY','OTHER')),
  reject_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, business_id)
);
create trigger search_results_touch before update on public.search_results for each row execute function public.touch_updated_at();
create index search_results_job_stage_idx on public.search_results(job_id, stage);
create index search_results_org_stage_idx on public.search_results(organisation_id, stage, created_at desc);

-- Geographic coverage: which cells/areas were searched for which category.
create table public.search_coverage (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  category_key text not null,
  provider text not null,
  cell_id text not null,
  location_label text,
  bbox double precision[],
  lat double precision,
  lng double precision,
  radius_m int,
  result_count int not null default 0,
  exhausted boolean not null default false,
  job_id uuid references public.search_jobs(id) on delete set null,
  searched_at timestamptz not null default now(),
  unique (organisation_id, category_key, provider, cell_id)
);
create index search_coverage_label_idx on public.search_coverage(organisation_id, location_label);

-- Imports
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  filename text not null,
  file_type text not null check (file_type in ('XLSX','CSV','GOOGLE_SHEETS')),
  sheet_url text,
  status text not null default 'UPLOADED' check (status in ('UPLOADED','MAPPED','PREVIEWED','PENDING_APPROVAL','IMPORTING','COMPLETED','FAILED','CANCELLED')),
  mode text check (mode in ('ADD_ONLY','UPDATE_EXISTING','UPSERT')),
  match_strategy text check (match_strategy in ('LEAD_ID','PHONE','DOMAIN','GOOGLE_PLACE_ID','AUTO')),
  target_lifecycle text not null default 'RESEARCH' check (target_lifecycle in ('RESEARCH','ACTIVE')),
  headers text[] not null default '{}',
  column_mapping jsonb not null default '{}'::jsonb,
  row_count int not null default 0,
  new_count int not null default 0,
  update_count int not null default 0,
  duplicate_count int not null default 0,
  invalid_count int not null default 0,
  imported_count int not null default 0,
  updated_count int not null default 0,
  error_count int not null default 0,
  approval_request_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);
create index imports_org_idx on public.imports(organisation_id, created_at desc);

create table public.import_rows (
  id bigserial primary key,
  import_id uuid not null references public.imports(id) on delete cascade,
  row_number int not null,
  raw jsonb not null,
  mapped jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','NEW','UPDATE','DUPLICATE','INVALID','IMPORTED','UPDATED','SKIPPED','ERROR')),
  errors text[] not null default '{}',
  matched_business_id uuid references public.businesses(id) on delete set null,
  match_reason text,
  business_id uuid references public.businesses(id) on delete set null
);
create index import_rows_import_idx on public.import_rows(import_id, row_number);

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  format text not null check (format in ('XLSX','CSV','JSON','GOOGLE_SHEETS','PDF')),
  scope text not null,
  filters jsonb not null default '{}'::jsonb,
  columns text[] not null default '{}',
  row_count int not null default 0,
  filename text,
  sheet_url text,
  status text not null default 'COMPLETED' check (status in ('PENDING','COMPLETED','FAILED')),
  error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index exports_org_idx on public.exports(organisation_id, created_at desc);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  type text not null check (type in ('LARGE_IMPORT','BULK_DELETE','BULK_ARCHIVE','MASS_REASSIGN','PERMISSION_CHANGE','ROLE_CHANGE','DATA_PURGE','PERMANENT_DELETE')),
  summary text not null,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','EXECUTED','FAILED','CANCELLED')),
  requested_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  result jsonb,
  created_at timestamptz not null default now()
);
create index approval_requests_org_idx on public.approval_requests(organisation_id, status, created_at desc);

-- Append-only audit trail.
create table public.audit_logs (
  id bigserial primary key,
  organisation_id uuid references public.organisations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs(organisation_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);
create index audit_logs_action_idx on public.audit_logs(organisation_id, action, created_at desc);

create or replace function public.audit_logs_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs for each row execute function public.audit_logs_immutable();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, read_at, created_at desc);

-- Organisation-level configuration (scoring, pricing, quality gates, assignment).
create table public.org_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  scoring_config jsonb not null default '{}'::jsonb,
  scoring_version int not null default 1,
  pricing_config jsonb not null default '{}'::jsonb,
  quality_gates jsonb not null default '{}'::jsonb,
  research_defaults jsonb not null default '{}'::jsonb,
  assignment_rules jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create trigger org_settings_touch before update on public.org_settings for each row execute function public.touch_updated_at();

-- >>> 20261008000004_functions.sql
-- ============================================================================
-- 0004 DATABASE FUNCTIONS: visibility, queue claiming, counters, merge,
-- global search, dashboard & market aggregates.
-- ============================================================================

-- Can the current user see this business? (role/team/ownership aware)
create or replace function public.can_view_business(b_org uuid, b_owner uuid, b_team uuid, b_lifecycle text)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    b_org = public.current_org()
    and (
      public.has_perm('leads.view_all')
      or (b_lifecycle = 'RESEARCH' and (public.has_perm('research.review') or public.has_perm('search.run')))
      or (public.has_perm('leads.view_team') and (
            b_owner is null
            or b_team = public.current_team()
            or exists (select 1 from public.profiles p where p.id = b_owner and p.team_id is not null and p.team_id = public.current_team())
         ))
      or b_owner = auth.uid()
    )
$$;

create or replace function public.can_view_business_id(bid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.businesses b
    where b.id = bid and public.can_view_business(b.organisation_id, b.owner_id, b.team_id, b.lifecycle)
  )
$$;

create or replace function public.can_edit_business_id(bid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_view_business_id(bid)
    and (public.has_perm('leads.edit') or public.has_perm('research.review'))
$$;

-- ---------------------------------------------------------------------------
-- Queue: claim up to n tasks atomically. Stale RUNNING tasks (worker died)
-- are returned to PENDING first so a crash never strands a job.
-- ---------------------------------------------------------------------------
create or replace function public.claim_job_tasks(worker text, n int default 5, stale_after interval default interval '10 minutes')
returns setof public.job_tasks
language plpgsql security definer set search_path = public as $$
begin
  update public.job_tasks
     set status = case when attempts >= max_attempts then 'FAILED' else 'PENDING' end,
         last_error = coalesce(last_error, '') || ' [reclaimed after stale lock]',
         locked_at = null, locked_by = null,
         finished_at = case when attempts >= max_attempts then now() else null end
   where status = 'RUNNING' and locked_at < now() - stale_after;

  return query
  update public.job_tasks t
     set status = 'RUNNING', locked_at = now(), locked_by = worker, attempts = t.attempts + 1
   where t.id in (
     select id from public.job_tasks
      where status = 'PENDING' and run_after <= now()
      order by priority asc, id asc
      limit n
      for update skip locked
   )
  returning t.*;
end $$;
revoke all on function public.claim_job_tasks(text, int, interval) from public, anon, authenticated;

-- Atomic counter increments for search jobs: deltas like {"discovered_count": 5}
create or replace function public.increment_job_counters(p_job uuid, deltas jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  k text;
  allowed text[] := array['discovered_count','retained_count','duplicate_count','rejected_count','enriched_count','audited_count','qualified_count','error_count','new_count','changed_count'];
  sets text := '';
begin
  for k in select jsonb_object_keys(deltas) loop
    if k = any(allowed) then
      sets := sets || format('%I = %I + %s,', k, k, (deltas->>k)::int);
    end if;
  end loop;
  if sets = '' then return; end if;
  execute format('update public.search_jobs set %s updated_at = now() where id = %L', sets, p_job);
end $$;
revoke all on function public.increment_job_counters(uuid, jsonb) from public, anon, authenticated;

-- Atomic merge of a JSON patch into search_jobs.source_status / progress
create or replace function public.patch_job_json(p_job uuid, col text, patch jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if col not in ('source_status','progress') then
    raise exception 'invalid column %', col;
  end if;
  execute format('update public.search_jobs set %I = coalesce(%I, ''{}''::jsonb) || $1, updated_at = now() where id = $2', col, col)
    using patch, p_job;
end $$;
revoke all on function public.patch_job_json(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Merge two businesses. Nothing historical is lost: every child row is moved
-- to the surviving record, conflicting rows are de-duplicated, and the merged
-- record is kept (lifecycle MERGED, merged_into = keep) for traceability.
-- field_choices: {"phone_e164":"merge", "email":"keep"} — 'merge' copies the
-- merged record's value onto the surviving record.
-- ---------------------------------------------------------------------------
create or replace function public.merge_businesses(p_keep uuid, p_merge uuid, field_choices jsonb default '{}'::jsonb, p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  keep_row public.businesses;
  merge_row public.businesses;
  k text;
  mergeable text[] := array['name','category_key','category_label','subcategory','description','country_code','country','region','city','district','area','postal_code','address','lat','lng','phone_e164','phone_country_code','phone_national','phone_formatted','phone_region','phone_type','whatsapp_e164','whatsapp_source','email','email_source','website_url','website_domain','google_place_id','google_maps_url','google_rating','google_review_count','business_status','opening_hours','owner_id','team_id','pipeline_stage'];
  moved jsonb := '{}'::jsonb;
  n int;
begin
  if p_keep = p_merge then raise exception 'cannot merge a record into itself'; end if;

  -- Authorisation when invoked by an end user. (current_user is the definer
  -- here, so the caller is identified from the JWT: the service role and
  -- direct database sessions carry no user id.)
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' then
    if not public.has_perm('leads.merge') then raise exception 'permission denied: leads.merge'; end if;
    if not public.can_view_business_id(p_keep) or not public.can_view_business_id(p_merge) then
      raise exception 'permission denied: records not visible';
    end if;
  end if;

  select * into keep_row from public.businesses where id = p_keep for update;
  select * into merge_row from public.businesses where id = p_merge for update;
  if keep_row.id is null or merge_row.id is null then raise exception 'record not found'; end if;
  if keep_row.organisation_id <> merge_row.organisation_id then raise exception 'cross-organisation merge refused'; end if;
  if merge_row.lifecycle = 'MERGED' then raise exception 'record already merged'; end if;

  -- Field choices (whitelisted columns only).
  for k in select jsonb_object_keys(coalesce(field_choices, '{}'::jsonb)) loop
    if k = any(mergeable) and field_choices->>k = 'merge' then
      execute format('update public.businesses set %I = (select %I from public.businesses where id = $1) where id = $2', k, k)
        using p_merge, p_keep;
    end if;
  end loop;

  -- Fill gaps on the survivor from the merged record (never overwrite).
  update public.businesses b set
    phone_e164 = coalesce(b.phone_e164, m.phone_e164),
    phone_country_code = coalesce(b.phone_country_code, m.phone_country_code),
    phone_national = coalesce(b.phone_national, m.phone_national),
    phone_formatted = coalesce(b.phone_formatted, m.phone_formatted),
    phone_region = coalesce(b.phone_region, m.phone_region),
    phone_type = coalesce(b.phone_type, m.phone_type),
    whatsapp_e164 = coalesce(b.whatsapp_e164, m.whatsapp_e164),
    whatsapp_source = coalesce(b.whatsapp_source, m.whatsapp_source),
    email = coalesce(b.email, m.email),
    website_url = coalesce(b.website_url, m.website_url),
    website_domain = coalesce(b.website_domain, m.website_domain),
    google_place_id = coalesce(b.google_place_id, m.google_place_id),
    google_maps_url = coalesce(b.google_maps_url, m.google_maps_url),
    google_rating = coalesce(b.google_rating, m.google_rating),
    google_review_count = greatest(coalesce(b.google_review_count, 0), coalesce(m.google_review_count, 0)),
    lat = coalesce(b.lat, m.lat), lng = coalesce(b.lng, m.lng),
    address = coalesce(b.address, m.address),
    area = coalesce(b.area, m.area),
    keywords = (select array(select distinct unnest(b.keywords || m.keywords))),
    lifecycle = case when b.lifecycle = 'RESEARCH' and m.lifecycle = 'ACTIVE' then 'ACTIVE' else b.lifecycle end
  from public.businesses m
  where b.id = p_keep and m.id = p_merge;

  -- Move children. Conflicting unique rows are dropped from the merged side
  -- only when an equivalent row already exists on the survivor.
  delete from public.business_socials s using public.business_socials k2
   where s.business_id = p_merge and k2.business_id = p_keep and k2.platform = s.platform and k2.url = s.url;
  update public.business_socials set business_id = p_keep where business_id = p_merge;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('socials', n);

  delete from public.websites w using public.websites k2
   where w.business_id = p_merge and k2.business_id = p_keep and k2.domain = w.domain;
  update public.websites set business_id = p_keep where business_id = p_merge;
  update public.website_audits set business_id = p_keep where business_id = p_merge;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('website_audits', n);

  -- Opportunities: keep survivor's row per type; preserve merged evidence on it.
  update public.opportunities o set evidence = o.evidence || m.evidence
    from public.opportunities m
   where o.business_id = p_keep and m.business_id = p_merge and m.type = o.type;
  delete from public.opportunities m using public.opportunities o
   where m.business_id = p_merge and o.business_id = p_keep and o.type = m.type;
  update public.opportunities set business_id = p_keep where business_id = p_merge;

  -- Commercial row: keep the survivor's; adopt the merged one only if none exists.
  update public.lead_pricing set business_id = p_keep
   where business_id = p_merge and not exists (select 1 from public.lead_pricing where business_id = p_keep);
  delete from public.lead_pricing where business_id = p_merge;

  update public.outreach set business_id = p_keep where business_id = p_merge;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('outreach', n);
  update public.follow_ups set business_id = p_keep where business_id = p_merge;
  update public.notes set business_id = p_keep where business_id = p_merge;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('notes', n);
  insert into public.lead_tags (business_id, tag_id, created_by, created_at)
    select p_keep, tag_id, created_by, created_at from public.lead_tags where business_id = p_merge
    on conflict do nothing;
  delete from public.lead_tags where business_id = p_merge;
  update public.activities set business_id = p_keep where business_id = p_merge;
  update public.source_records set business_id = p_keep where business_id = p_merge;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('source_records', n);
  update public.business_field_sources set business_id = p_keep where business_id = p_merge;
  update public.lead_scores set business_id = p_keep where business_id = p_merge;
  update public.sales_intent set business_id = p_keep where business_id = p_merge;
  update public.business_snapshots set business_id = p_keep where business_id = p_merge;
  update public.import_rows set business_id = p_keep where business_id = p_merge;
  update public.import_rows set matched_business_id = p_keep where matched_business_id = p_merge;
  delete from public.search_results r using public.search_results k2
   where r.business_id = p_merge and k2.business_id = p_keep and k2.job_id = r.job_id;
  update public.search_results set business_id = p_keep where business_id = p_merge;

  update public.duplicate_candidates
     set status = 'MERGED', resolved_at = now(), resolved_by = p_actor
   where (business_a = least(p_keep, p_merge) and business_b = greatest(p_keep, p_merge));
  -- Other open candidates pointing at the merged record now point at the survivor.
  delete from public.duplicate_candidates d
   where status = 'OPEN' and (business_a = p_merge or business_b = p_merge)
     and exists (
       select 1 from public.duplicate_candidates d2
        where d2.business_a = least(p_keep, case when d.business_a = p_merge then d.business_b else d.business_a end)
          and d2.business_b = greatest(p_keep, case when d.business_a = p_merge then d.business_b else d.business_a end)
     );
  update public.duplicate_candidates d
     set business_a = least(p_keep, case when d.business_a = p_merge then d.business_b else d.business_a end),
         business_b = greatest(p_keep, case when d.business_a = p_merge then d.business_b else d.business_a end)
   where status = 'OPEN' and (business_a = p_merge or business_b = p_merge)
     and (case when d.business_a = p_merge then d.business_b else d.business_a end) <> p_keep;

  update public.businesses
     set lifecycle = 'MERGED', merged_into = p_keep, archived_at = now(), archived_by = p_actor
   where id = p_merge;

  insert into public.activities (organisation_id, business_id, type, title, data, actor_id)
  values (keep_row.organisation_id, p_keep, 'MERGED', 'Merged duplicate record ' || merge_row.lead_code,
          jsonb_build_object('merged_id', p_merge, 'merged_code', merge_row.lead_code, 'moved', moved, 'field_choices', field_choices), p_actor);

  return jsonb_build_object('kept', p_keep, 'merged', p_merge, 'moved', moved);
end $$;
revoke all on function public.merge_businesses(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.merge_businesses(uuid, uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Global search (Cmd/Ctrl+K). SECURITY INVOKER: results are filtered by RLS.
-- ---------------------------------------------------------------------------
create or replace function public.global_search(q text, max_results int default 20)
returns table (id uuid, lead_code text, name text, category_label text, city text, area text, lifecycle text, tier text, lead_score int, matched_on text)
language sql stable security invoker set search_path = public as $$
  with input as (
    select trim(q) as raw,
           lower(trim(q)) as lq,
           regexp_replace(q, '[^0-9]', '', 'g') as digits
  )
  select b.id, b.lead_code, b.name, b.category_label, b.city, b.area, b.lifecycle, b.tier, b.lead_score,
    case
      when upper(b.lead_code) = upper(i.raw) then 'Lead ID'
      when length(i.digits) >= 6 and (b.phone_e164 like '%' || i.digits || '%' or b.whatsapp_e164 like '%' || i.digits || '%') then 'Phone'
      when b.email is not null and lower(b.email) like '%' || i.lq || '%' then 'Email'
      when b.website_domain is not null and b.website_domain like '%' || i.lq || '%' then 'Website'
      when exists (select 1 from public.business_socials s where s.business_id = b.id and (lower(s.username) like '%' || ltrim(i.lq, '@') || '%' or lower(s.url) like '%' || ltrim(i.lq, '@') || '%')) then 'Social'
      when exists (select 1 from public.lead_tags lt join public.tags t on t.id = lt.tag_id where lt.business_id = b.id and lower(t.name) = i.lq) then 'Tag'
      when lower(coalesce(b.area,'')) like '%' || i.lq || '%' or lower(coalesce(b.city,'')) like '%' || i.lq || '%' then 'Area'
      when lower(coalesce(b.category_label,'')) like '%' || i.lq || '%' then 'Category'
      else 'Name'
    end as matched_on
  from public.businesses b, input i
  where length(i.raw) >= 2
    and b.lifecycle in ('ACTIVE','RESEARCH')
    and (
      upper(b.lead_code) = upper(i.raw)
      or b.normalized_name % i.lq
      or b.normalized_name like '%' || i.lq || '%'
      or b.search_text @@ plainto_tsquery('simple', i.raw)
      or (length(i.digits) >= 6 and (b.phone_e164 like '%' || i.digits || '%' or b.whatsapp_e164 like '%' || i.digits || '%'))
      or (b.email is not null and lower(b.email) like '%' || i.lq || '%')
      or exists (select 1 from public.business_socials s where s.business_id = b.id and (lower(s.username) like '%' || ltrim(i.lq, '@') || '%' or lower(s.url) like '%' || ltrim(i.lq, '@') || '%'))
      or exists (select 1 from public.lead_tags lt join public.tags t on t.id = lt.tag_id where lt.business_id = b.id and lower(t.name) = i.lq)
    )
  order by (upper(b.lead_code) = upper(i.raw)) desc, similarity(b.normalized_name, i.lq) desc, b.lead_score desc nulls last
  limit least(max_results, 50)
$$;

-- ---------------------------------------------------------------------------
-- Dashboard aggregates (RLS-filtered — each user sees their own scope).
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total', count(*),
    'new_today', count(*) filter (where approved_at >= date_trunc('day', now())),
    'hot', count(*) filter (where tier = 'HOT'),
    'high', count(*) filter (where tier = 'HIGH'),
    'no_website', count(*) filter (where website_status = 'NO_WEBSITE'),
    'website_fix', count(*) filter (where website_status in ('BROKEN','MOBILE_ISSUE','SLOW','MISSING_FUNCTIONALITY') or 'MISSING_WHATSAPP' = any(website_issues) or 'MISSING_CTA' = any(website_issues)),
    'redesign', count(*) filter (where website_status in ('OUTDATED','POOR_DESIGN')),
    'contactable', count(*) filter (where phone_e164 is not null or whatsapp_e164 is not null or email is not null),
    'follow_ups_due', count(*) filter (where next_follow_up_at is not null and next_follow_up_at <= now() + interval '1 day'),
    'interested', count(*) filter (where pipeline_stage = 'INTERESTED'),
    'meetings', count(*) filter (where pipeline_stage = 'MEETING'),
    'quotes', count(*) filter (where pipeline_stage = 'QUOTE_SENT'),
    'won', count(*) filter (where pipeline_stage = 'WON'),
    -- Amounts come from lead_pricing, which RLS hides without pricing.view (→ null).
    'pipeline_value', (select sum(coalesce(lp.deal_value, lp.recommended_price_max)) from public.lead_pricing lp join public.businesses b2 on b2.id = lp.business_id where b2.lifecycle = 'ACTIVE' and b2.pipeline_stage in ('INTERESTED','MEETING','QUOTE_SENT')),
    'won_value', (select sum(coalesce(lp.deal_value, lp.recommended_price_max)) from public.lead_pricing lp join public.businesses b2 on b2.id = lp.business_id where b2.lifecycle = 'ACTIVE' and b2.pipeline_stage = 'WON'),
    'opportunity_value', (select sum(lp.opportunity_value) from public.lead_pricing lp join public.businesses b2 on b2.id = lp.business_id where b2.lifecycle = 'ACTIVE' and b2.pipeline_stage not in ('WON','LOST')),
    'pricing_visible', public.has_perm('pricing.view'),
    'by_stage', (
      select coalesce(jsonb_object_agg(pipeline_stage, c), '{}'::jsonb)
      from (select pipeline_stage, count(*) c from public.businesses where lifecycle = 'ACTIVE' group by pipeline_stage) s
    )
  )
  from public.businesses
  where lifecycle = 'ACTIVE'
$$;

-- Market intelligence for a category/location sample (RLS-filtered).
create or replace function public.market_intelligence(p_category text default null, p_city text default null, p_area text default null)
returns table (
  category_key text, category_label text, city text,
  discovered bigint, qualified bigint,
  pct_no_website numeric, pct_poor_website numeric,
  avg_rating numeric, avg_reviews numeric,
  pct_whatsapp numeric, pct_instagram numeric, pct_phone numeric,
  opportunity_value numeric, avg_score numeric
)
language sql stable security invoker set search_path = public as $$
  select
    b.category_key, max(b.category_label), b.city,
    count(*) as discovered,
    count(*) filter (where b.lead_score >= 60) as qualified,
    round(100.0 * count(*) filter (where b.website_status = 'NO_WEBSITE') / nullif(count(*),0), 1),
    round(100.0 * count(*) filter (where b.website_status in ('OUTDATED','POOR_DESIGN','BROKEN','MOBILE_ISSUE','SLOW')) / nullif(count(*),0), 1),
    round(avg(b.google_rating), 2),
    round(avg(b.google_review_count), 1),
    round(100.0 * count(*) filter (where b.whatsapp_e164 is not null) / nullif(count(*),0), 1),
    round(100.0 * count(*) filter (where exists (select 1 from public.business_socials s where s.business_id = b.id and s.platform = 'INSTAGRAM')) / nullif(count(*),0), 1),
    round(100.0 * count(*) filter (where b.phone_e164 is not null) / nullif(count(*),0), 1),
    (select sum(lp.opportunity_value) from public.lead_pricing lp where lp.business_id = any(array_agg(b.id))),
    round(avg(b.lead_score), 1)
  from public.businesses b
  where b.lifecycle in ('ACTIVE','RESEARCH')
    and (p_category is null or b.category_key = p_category)
    and (p_city is null or lower(b.city) = lower(p_city))
    and (p_area is null or lower(b.area) = lower(p_area))
  group by b.category_key, b.city
  order by count(*) desc
  limit 200
$$;

-- >>> 20261008000005_rls.sql
-- ============================================================================
-- 0005 ROW LEVEL SECURITY
-- The browser only ever holds the anon key + the user's JWT. Every table is
-- locked down here; privileged writes (worker, audit log, role changes) use
-- the service role on the server after explicit permission checks.
-- ============================================================================

alter table public.organisations enable row level security;
alter table public.teams enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.user_permissions enable row level security;
alter table public.invites enable row level security;
alter table public.categories enable row level security;
alter table public.locations enable row level security;
alter table public.businesses enable row level security;
alter table public.business_field_sources enable row level security;
alter table public.business_socials enable row level security;
alter table public.websites enable row level security;
alter table public.website_audits enable row level security;
alter table public.lead_scores enable row level security;
alter table public.sales_intent enable row level security;
alter table public.opportunities enable row level security;
alter table public.lead_pricing enable row level security;
alter table public.outreach enable row level security;
alter table public.follow_ups enable row level security;
alter table public.notes enable row level security;
alter table public.tags enable row level security;
alter table public.lead_tags enable row level security;
alter table public.activities enable row level security;
alter table public.business_snapshots enable row level security;
alter table public.duplicate_candidates enable row level security;
alter table public.saved_filters enable row level security;
alter table public.providers enable row level security;
alter table public.searches enable row level security;
alter table public.search_jobs enable row level security;
alter table public.job_tasks enable row level security;
alter table public.source_records enable row level security;
alter table public.search_results enable row level security;
alter table public.search_coverage enable row level security;
alter table public.imports enable row level security;
alter table public.import_rows enable row level security;
alter table public.exports enable row level security;
alter table public.approval_requests enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.org_settings enable row level security;

-- Reference data -------------------------------------------------------------
create policy roles_read on public.roles for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

create policy organisations_read on public.organisations for select to authenticated
  using (id = public.current_org());
create policy organisations_update on public.organisations for update to authenticated
  using (id = public.current_org() and public.has_perm('admin.settings'))
  with check (id = public.current_org());

create policy teams_read on public.teams for select to authenticated using (organisation_id = public.current_org());
create policy teams_write on public.teams for all to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.users'))
  with check (organisation_id = public.current_org() and public.has_perm('admin.users'));

-- Profiles: everyone sees their own row (even while PENDING); active users see
-- colleagues; only self-updates of non-privileged fields (trigger-enforced).
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_org_read on public.profiles for select to authenticated using (organisation_id = public.current_org());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy user_permissions_read on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_perm('admin.users'));

create policy invites_admin on public.invites for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.users'));

-- Categories / locations: global defaults readable by all active users.
create policy categories_read on public.categories for select to authenticated
  using (public.is_active_user() and (organisation_id is null or organisation_id = public.current_org()));
create policy categories_write on public.categories for all to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.categories'))
  with check (organisation_id = public.current_org() and public.has_perm('admin.categories'));

create policy locations_read on public.locations for select to authenticated
  using (public.is_active_user() and (organisation_id is null or organisation_id = public.current_org()));
create policy locations_write on public.locations for all to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.locations'))
  with check (organisation_id = public.current_org() and public.has_perm('admin.locations'));

-- Businesses -----------------------------------------------------------------
create policy businesses_read on public.businesses for select to authenticated
  using (public.can_view_business(organisation_id, owner_id, team_id, lifecycle));
create policy businesses_insert on public.businesses for insert to authenticated
  with check (organisation_id = public.current_org() and (public.has_perm('leads.create') or public.has_perm('search.run')));
create policy businesses_update on public.businesses for update to authenticated
  using (public.can_view_business(organisation_id, owner_id, team_id, lifecycle)
         and (public.has_perm('leads.edit') or public.has_perm('research.review')))
  with check (organisation_id = public.current_org());
create policy businesses_delete on public.businesses for delete to authenticated
  using (organisation_id = public.current_org() and public.has_perm('leads.delete_permanent'));

-- Children of a business inherit its visibility.
create policy bfs_read on public.business_field_sources for select to authenticated using (public.can_view_business_id(business_id));
create policy socials_read on public.business_socials for select to authenticated using (public.can_view_business_id(business_id));
create policy socials_write on public.business_socials for all to authenticated
  using (public.can_edit_business_id(business_id)) with check (public.can_edit_business_id(business_id));
create policy websites_read on public.websites for select to authenticated using (public.can_view_business_id(business_id));
create policy website_audits_read on public.website_audits for select to authenticated using (public.can_view_business_id(business_id));
create policy lead_scores_read on public.lead_scores for select to authenticated using (public.can_view_business_id(business_id));
create policy sales_intent_read on public.sales_intent for select to authenticated using (public.can_view_business_id(business_id));
create policy opportunities_read on public.opportunities for select to authenticated using (public.can_view_business_id(business_id));
create policy opportunities_write on public.opportunities for all to authenticated
  using (public.can_edit_business_id(business_id) and public.has_perm('leads.override'))
  with check (public.can_edit_business_id(business_id) and public.has_perm('leads.override'));
-- Prices / estimated values / deal amounts: pricing.view only (hidden from BDOs).
create policy lead_pricing_read on public.lead_pricing for select to authenticated
  using (public.has_perm('pricing.view') and public.can_view_business_id(business_id));
create policy lead_pricing_write on public.lead_pricing for all to authenticated
  using (public.has_perm('pricing.view') and public.can_edit_business_id(business_id))
  with check (public.has_perm('pricing.view') and public.can_edit_business_id(business_id));
create policy snapshots_read on public.business_snapshots for select to authenticated using (public.can_view_business_id(business_id));

create policy outreach_read on public.outreach for select to authenticated using (public.can_view_business_id(business_id));
create policy outreach_insert on public.outreach for insert to authenticated
  with check (public.can_view_business_id(business_id) and public.has_perm('outreach.log') and user_id = auth.uid());

create policy follow_ups_read on public.follow_ups for select to authenticated using (public.can_view_business_id(business_id));
create policy follow_ups_write on public.follow_ups for all to authenticated
  using (public.can_view_business_id(business_id) and public.has_perm('outreach.log'))
  with check (public.can_view_business_id(business_id) and public.has_perm('outreach.log'));

-- Private notes are visible to their author only.
create policy notes_read on public.notes for select to authenticated
  using (public.can_view_business_id(business_id) and (visibility = 'TEAM' or author_id = auth.uid()));
create policy notes_insert on public.notes for insert to authenticated
  with check (public.can_view_business_id(business_id) and public.has_perm('notes.create') and author_id = auth.uid());
create policy notes_update on public.notes for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy notes_delete on public.notes for delete to authenticated using (author_id = auth.uid());

create policy tags_read on public.tags for select to authenticated using (organisation_id = public.current_org());
create policy tags_write on public.tags for insert to authenticated
  with check (organisation_id = public.current_org() and public.has_perm('leads.edit'));
create policy lead_tags_read on public.lead_tags for select to authenticated using (public.can_view_business_id(business_id));
create policy lead_tags_write on public.lead_tags for all to authenticated
  using (public.can_edit_business_id(business_id)) with check (public.can_edit_business_id(business_id));

create policy activities_read on public.activities for select to authenticated
  using (organisation_id = public.current_org() and (business_id is null or public.can_view_business_id(business_id)));

create policy duplicates_read on public.duplicate_candidates for select to authenticated
  using (organisation_id = public.current_org() and public.can_view_business_id(business_a) and public.can_view_business_id(business_b));
create policy duplicates_update on public.duplicate_candidates for update to authenticated
  using (organisation_id = public.current_org() and public.has_perm('leads.merge'))
  with check (organisation_id = public.current_org());

create policy saved_filters_read on public.saved_filters for select to authenticated
  using (organisation_id = public.current_org() and (user_id = auth.uid() or is_shared));
create policy saved_filters_write on public.saved_filters for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and organisation_id = public.current_org());

-- Research --------------------------------------------------------------------
create policy providers_read on public.providers for select to authenticated
  using (organisation_id = public.current_org() and (public.has_perm('search.run') or public.has_perm('admin.providers')));
create policy providers_write on public.providers for update to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.providers'))
  with check (organisation_id = public.current_org());

create policy searches_read on public.searches for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('search.view'));
create policy searches_insert on public.searches for insert to authenticated
  with check (organisation_id = public.current_org() and public.has_perm('search.run') and created_by = auth.uid());
create policy searches_update on public.searches for update to authenticated
  using (organisation_id = public.current_org() and (created_by = auth.uid() or public.has_perm('search.manage_templates')))
  with check (organisation_id = public.current_org());

create policy search_jobs_read on public.search_jobs for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('search.view'));

create policy source_records_read on public.source_records for select to authenticated
  using (organisation_id = public.current_org() and (public.has_perm('research.review') or public.has_perm('admin.providers')));

create policy search_results_read on public.search_results for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('search.view'));
create policy search_results_update on public.search_results for update to authenticated
  using (organisation_id = public.current_org() and public.has_perm('research.review'))
  with check (organisation_id = public.current_org());

create policy coverage_read on public.search_coverage for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('search.view'));

-- job_tasks: no policies => no access for users. Service role only.

create policy imports_read on public.imports for select to authenticated
  using (organisation_id = public.current_org() and (created_by = auth.uid() or public.has_perm('admin.audit') or public.has_perm('imports.run')));
create policy import_rows_read on public.import_rows for select to authenticated
  using (exists (select 1 from public.imports i where i.id = import_id and i.organisation_id = public.current_org() and (i.created_by = auth.uid() or public.has_perm('imports.run'))));

create policy exports_read on public.exports for select to authenticated
  using (organisation_id = public.current_org() and (created_by = auth.uid() or public.has_perm('admin.audit')));

create policy approvals_read on public.approval_requests for select to authenticated
  using (organisation_id = public.current_org() and (requested_by = auth.uid() or public.has_perm('admin.approvals')));

create policy audit_logs_read on public.audit_logs for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.audit'));

create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy org_settings_read on public.org_settings for select to authenticated
  using (organisation_id = public.current_org());
create policy org_settings_write on public.org_settings for update to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.scoring'))
  with check (organisation_id = public.current_org());

-- Function grants for authenticated users (RLS still applies inside invokers).
grant execute on function public.global_search(text, int) to authenticated;
grant execute on function public.dashboard_stats() to authenticated;
grant execute on function public.market_intelligence(text, text, text) to authenticated;
grant execute on function public.has_perm(text) to authenticated;

-- >>> 20261008000006_reference_data.sql
-- ============================================================================
-- 0006 REFERENCE DATA — GENERATED by scripts/gen-reference-sql.ts. Do not edit
-- by hand; edit src/lib/auth/permissions.ts, src/lib/categories/taxonomy.ts or
-- src/lib/providers/catalog.ts and regenerate.
-- ============================================================================

-- BEGIN GENERATED PERMISSIONS (scripts/gen-permissions-sql.ts)
insert into public.roles (key, name, description, rank) values
  ('SUPER_ADMIN', 'Super Admin', 'Full system control, approvals and permanent deletion.', 100),
  ('ADMIN', 'Admin', 'Manages users, providers, scoring and configuration.', 80),
  ('MANAGER', 'Manager', 'Leads the sales team; sees team leads, assigns and approves research.', 60),
  ('SALES', 'Sales', 'Works their own leads: outreach, notes and follow-ups.', 40),
  ('RESEARCHER', 'Researcher', 'Runs lead searches, reviews research and imports data.', 40),
  ('VIEWER', 'Viewer', 'Read-only access to team leads and analytics.', 10)
on conflict (key) do update set name = excluded.name, description = excluded.description, rank = excluded.rank;
insert into public.permissions (key, description, category) values
  ('leads.view_own', 'View leads assigned to me', 'Leads'),
  ('leads.view_team', 'View my team''s leads and unassigned leads', 'Leads'),
  ('leads.view_all', 'View every lead in the organisation', 'Leads'),
  ('leads.create', 'Create leads manually', 'Leads'),
  ('leads.edit', 'Edit lead details and pipeline stage', 'Leads'),
  ('leads.assign', 'Assign leads to users and teams', 'Leads'),
  ('leads.archive', 'Archive (soft delete) leads', 'Leads'),
  ('leads.delete_permanent', 'Permanently delete leads', 'Leads'),
  ('leads.override', 'Override score, opportunity, website status, category and price', 'Leads'),
  ('leads.merge', 'Merge duplicate records', 'Leads'),
  ('leads.bulk', 'Run bulk actions', 'Leads'),
  ('pricing.view', 'See prices, estimated opportunity values and deal amounts (hidden from BDOs by default)', 'Commercial'),
  ('search.run', 'Start lead searches', 'Research'),
  ('search.view', 'View searches, jobs and research results', 'Research'),
  ('search.manage_templates', 'Edit and delete any saved search', 'Research'),
  ('search.schedule', 'Schedule recurring searches', 'Research'),
  ('research.review', 'Review, qualify and reject research results', 'Research'),
  ('research.approve', 'Approve research results into the CRM', 'Research'),
  ('imports.run', 'Import CSV / XLSX / Google Sheets', 'Data'),
  ('exports.run', 'Export leads', 'Data'),
  ('outreach.log', 'Log outreach and manage follow-ups', 'Sales'),
  ('notes.create', 'Write notes', 'Sales'),
  ('analytics.view', 'View analytics and market intelligence', 'Insights'),
  ('assistant.use', 'Use the AI sales assistant', 'Insights'),
  ('admin.users', 'Approve, suspend and manage users and teams', 'Admin'),
  ('admin.approvals', 'Approve or reject sensitive operations', 'Admin'),
  ('admin.providers', 'Manage data providers and integrations', 'Admin'),
  ('admin.categories', 'Manage categories and synonyms', 'Admin'),
  ('admin.locations', 'Manage saved locations and territories', 'Admin'),
  ('admin.scoring', 'Manage scoring, pricing and quality gates', 'Admin'),
  ('admin.audit', 'View audit logs', 'Admin'),
  ('admin.settings', 'Manage system settings', 'Admin'),
  ('admin.data_purge', 'Purge data permanently', 'Admin')
on conflict (key) do update set description = excluded.description, category = excluded.category;
delete from public.role_permissions;
insert into public.role_permissions (role_key, permission_key) values
  ('SUPER_ADMIN', 'leads.view_own'),
  ('SUPER_ADMIN', 'leads.view_team'),
  ('SUPER_ADMIN', 'leads.view_all'),
  ('SUPER_ADMIN', 'leads.create'),
  ('SUPER_ADMIN', 'leads.edit'),
  ('SUPER_ADMIN', 'leads.assign'),
  ('SUPER_ADMIN', 'leads.archive'),
  ('SUPER_ADMIN', 'leads.delete_permanent'),
  ('SUPER_ADMIN', 'leads.override'),
  ('SUPER_ADMIN', 'leads.merge'),
  ('SUPER_ADMIN', 'leads.bulk'),
  ('SUPER_ADMIN', 'pricing.view'),
  ('SUPER_ADMIN', 'search.run'),
  ('SUPER_ADMIN', 'search.view'),
  ('SUPER_ADMIN', 'search.manage_templates'),
  ('SUPER_ADMIN', 'search.schedule'),
  ('SUPER_ADMIN', 'research.review'),
  ('SUPER_ADMIN', 'research.approve'),
  ('SUPER_ADMIN', 'imports.run'),
  ('SUPER_ADMIN', 'exports.run'),
  ('SUPER_ADMIN', 'outreach.log'),
  ('SUPER_ADMIN', 'notes.create'),
  ('SUPER_ADMIN', 'analytics.view'),
  ('SUPER_ADMIN', 'assistant.use'),
  ('SUPER_ADMIN', 'admin.users'),
  ('SUPER_ADMIN', 'admin.approvals'),
  ('SUPER_ADMIN', 'admin.providers'),
  ('SUPER_ADMIN', 'admin.categories'),
  ('SUPER_ADMIN', 'admin.locations'),
  ('SUPER_ADMIN', 'admin.scoring'),
  ('SUPER_ADMIN', 'admin.audit'),
  ('SUPER_ADMIN', 'admin.settings'),
  ('SUPER_ADMIN', 'admin.data_purge'),
  ('ADMIN', 'leads.view_own'),
  ('ADMIN', 'leads.view_team'),
  ('ADMIN', 'leads.view_all'),
  ('ADMIN', 'leads.create'),
  ('ADMIN', 'leads.edit'),
  ('ADMIN', 'leads.assign'),
  ('ADMIN', 'leads.archive'),
  ('ADMIN', 'leads.override'),
  ('ADMIN', 'leads.merge'),
  ('ADMIN', 'leads.bulk'),
  ('ADMIN', 'pricing.view'),
  ('ADMIN', 'search.run'),
  ('ADMIN', 'search.view'),
  ('ADMIN', 'search.manage_templates'),
  ('ADMIN', 'search.schedule'),
  ('ADMIN', 'research.review'),
  ('ADMIN', 'research.approve'),
  ('ADMIN', 'imports.run'),
  ('ADMIN', 'exports.run'),
  ('ADMIN', 'outreach.log'),
  ('ADMIN', 'notes.create'),
  ('ADMIN', 'analytics.view'),
  ('ADMIN', 'assistant.use'),
  ('ADMIN', 'admin.users'),
  ('ADMIN', 'admin.providers'),
  ('ADMIN', 'admin.categories'),
  ('ADMIN', 'admin.locations'),
  ('ADMIN', 'admin.scoring'),
  ('ADMIN', 'admin.audit'),
  ('ADMIN', 'admin.settings'),
  ('MANAGER', 'leads.view_own'),
  ('MANAGER', 'leads.view_team'),
  ('MANAGER', 'leads.create'),
  ('MANAGER', 'leads.edit'),
  ('MANAGER', 'leads.assign'),
  ('MANAGER', 'leads.archive'),
  ('MANAGER', 'leads.override'),
  ('MANAGER', 'leads.merge'),
  ('MANAGER', 'leads.bulk'),
  ('MANAGER', 'search.run'),
  ('MANAGER', 'search.view'),
  ('MANAGER', 'search.manage_templates'),
  ('MANAGER', 'search.schedule'),
  ('MANAGER', 'research.review'),
  ('MANAGER', 'research.approve'),
  ('MANAGER', 'imports.run'),
  ('MANAGER', 'outreach.log'),
  ('MANAGER', 'notes.create'),
  ('MANAGER', 'exports.run'),
  ('MANAGER', 'analytics.view'),
  ('MANAGER', 'assistant.use'),
  ('SALES', 'leads.view_own'),
  ('SALES', 'leads.edit'),
  ('SALES', 'outreach.log'),
  ('SALES', 'notes.create'),
  ('SALES', 'exports.run'),
  ('SALES', 'analytics.view'),
  ('SALES', 'assistant.use'),
  ('RESEARCHER', 'leads.view_own'),
  ('RESEARCHER', 'leads.view_team'),
  ('RESEARCHER', 'leads.create'),
  ('RESEARCHER', 'leads.edit'),
  ('RESEARCHER', 'search.run'),
  ('RESEARCHER', 'search.view'),
  ('RESEARCHER', 'search.manage_templates'),
  ('RESEARCHER', 'research.review'),
  ('RESEARCHER', 'imports.run'),
  ('RESEARCHER', 'exports.run'),
  ('RESEARCHER', 'notes.create'),
  ('RESEARCHER', 'analytics.view'),
  ('RESEARCHER', 'assistant.use'),
  ('VIEWER', 'leads.view_team'),
  ('VIEWER', 'search.view'),
  ('VIEWER', 'analytics.view');
-- END GENERATED PERMISSIONS

-- Global default categories
insert into public.categories (organisation_id, key, name, synonyms, exclusions, google_types, osm_tags, value_multiplier) values
  (null, 'cleaning_services', 'Cleaning Services', array['cleaning','cleaners','cleaning company','deep cleaning','sofa cleaning','carpet cleaning','home cleaning','house cleaning','office cleaning','commercial cleaning','janitorial','residential cleaning','maid service','housekeeping']::text[], '{}'::text[], '{}'::text[], '[{"key":"craft","value":"cleaning"},{"key":"office","value":"cleaning"},{"key":"shop","value":"cleaning"}]'::jsonb, 1.1),
  (null, 'flower_shops', 'Flower Shops', array['florist','florists','flower shop','flowers','flower delivery','bouquets','floral design']::text[], '{}'::text[], array['florist']::text[], '[{"key":"shop","value":"florist"}]'::jsonb, 1),
  (null, 'salons', 'Salons', array['salon','beauty salon','ladies salon','beauty center','beauty centre','nail salon','nail spa','spa','hair salon','beauty parlour','lash studio','brow bar']::text[], '{}'::text[], array['beauty_salon','hair_salon','nail_salon','spa']::text[], '[{"key":"shop","value":"beauty"},{"key":"shop","value":"hairdresser"},{"key":"leisure","value":"spa"}]'::jsonb, 1.15),
  (null, 'barbers', 'Barbers', array['barber','barbershop','barber shop','gents salon','men''s salon','mens grooming']::text[], '{}'::text[], array['barber_shop']::text[], '[{"key":"shop","value":"hairdresser"}]'::jsonb, 0.9),
  (null, 'restaurants', 'Restaurants', array['restaurant','restaurants','eatery','diner','grill','kitchen','bistro','takeaway','food delivery']::text[], '{}'::text[], array['restaurant']::text[], '[{"key":"amenity","value":"restaurant"},{"key":"amenity","value":"fast_food"}]'::jsonb, 1.2),
  (null, 'cafeterias', 'Cafeterias & Cafés', array['cafe','café','cafes','coffee shop','coffee','cafeteria','karak','tea shop']::text[], '{}'::text[], array['cafe','coffee_shop','cafeteria']::text[], '[{"key":"amenity","value":"cafe"}]'::jsonb, 0.95),
  (null, 'car_detailing', 'Car Detailing', array['car detailing','auto detailing','ceramic coating','ppf','paint protection film','car polishing','window tinting']::text[], '{}'::text[], array['car_wash']::text[], '[{"key":"amenity","value":"car_wash"},{"key":"shop","value":"car"}]'::jsonb, 1.2),
  (null, 'mobile_car_wash', 'Mobile Car Wash', array['mobile car wash','car wash','doorstep car wash','waterless car wash','car cleaning']::text[], '{}'::text[], array['car_wash']::text[], '[{"key":"amenity","value":"car_wash"}]'::jsonb, 1),
  (null, 'pest_control', 'Pest Control', array['pest control','pest','exterminator','termite control','fumigation','bed bug treatment','disinfection']::text[], '{}'::text[], '{}'::text[], '[{"key":"craft","value":"pest_control"},{"key":"shop","value":"pest_control"}]'::jsonb, 1.15),
  (null, 'ac_maintenance', 'AC Maintenance', array['ac maintenance','ac repair','air conditioning','hvac','ac cleaning','duct cleaning','ac service']::text[], '{}'::text[], '{}'::text[], '[{"key":"craft","value":"hvac"}]'::jsonb, 1.2),
  (null, 'home_maintenance', 'Home Maintenance', array['home maintenance','handyman','maintenance company','plumber','plumbing','electrician','painting services','renovation','technical services','fit out']::text[], '{}'::text[], array['plumber','electrician','painter','general_contractor']::text[], '[{"key":"craft","value":"handyman"},{"key":"craft","value":"plumber"},{"key":"craft","value":"electrician"},{"key":"craft","value":"painter"}]'::jsonb, 1.15),
  (null, 'laundry', 'Laundry', array['laundry','dry cleaning','dry cleaners','laundromat','ironing','laundry service']::text[], '{}'::text[], array['laundry']::text[], '[{"key":"shop","value":"laundry"},{"key":"shop","value":"dry_cleaning"}]'::jsonb, 0.9),
  (null, 'pet_grooming', 'Pet Grooming', array['pet grooming','dog grooming','cat grooming','pet salon','pet spa','pet care']::text[], '{}'::text[], array['pet_care']::text[], '[{"key":"shop","value":"pet_grooming"}]'::jsonb, 1.05),
  (null, 'gyms', 'Gyms & Fitness', array['gym','gyms','fitness','fitness center','fitness centre','crossfit','personal training','yoga studio','pilates','martial arts']::text[], '{}'::text[], array['gym','fitness_center','yoga_studio']::text[], '[{"key":"leisure","value":"fitness_centre"},{"key":"sport","value":"fitness"}]'::jsonb, 1.15),
  (null, 'real_estate', 'Real Estate Agencies', array['real estate','real estate agency','property agency','estate agent','brokerage','property management','realtor']::text[], '{}'::text[], array['real_estate_agency']::text[], '[{"key":"office","value":"estate_agent"}]'::jsonb, 1.4),
  (null, 'dental_clinics', 'Dental Clinics', array['dental clinic','dentist','dentists','orthodontist','dental care','dental centre','dental center']::text[], '{}'::text[], array['dentist','dental_clinic']::text[], '[{"key":"amenity","value":"dentist"},{"key":"healthcare","value":"dentist"}]'::jsonb, 1.4),
  (null, 'accountants', 'Accountants', array['accountant','accountants','accounting firm','bookkeeping','audit firm','vat consultant','tax consultant','corporate tax']::text[], '{}'::text[], array['accounting']::text[], '[{"key":"office","value":"accountant"},{"key":"office","value":"tax_advisor"}]'::jsonb, 1.3),
  (null, 'law_firms', 'Law Firms', array['law firm','lawyer','lawyers','advocate','advocates','legal consultant','legal services','attorney']::text[], '{}'::text[], array['lawyer']::text[], '[{"key":"office","value":"lawyer"}]'::jsonb, 1.4),
  (null, 'auto_repair', 'Auto Repair', array['auto repair','car repair','garage','mechanic','auto workshop','car service','car garage','auto service']::text[], '{}'::text[], array['car_repair']::text[], '[{"key":"shop","value":"car_repair"}]'::jsonb, 1.1),
  (null, 'tailors', 'Tailors', array['tailor','tailors','tailoring','alterations','abaya tailor','bespoke tailoring','stitching']::text[], '{}'::text[], '{}'::text[], '[{"key":"craft","value":"tailor"},{"key":"shop","value":"tailor"}]'::jsonb, 0.85),
  (null, 'bakeries', 'Bakeries', array['bakery','bakeries','cake shop','patisserie','custom cakes','desserts','pastry shop']::text[], '{}'::text[], array['bakery']::text[], '[{"key":"shop","value":"bakery"},{"key":"shop","value":"pastry"}]'::jsonb, 1),
  (null, 'hotels', 'Hotels', array['hotel','hotels','hotel apartments','guest house','boutique hotel','resort','hostel']::text[], array['international chain']::text[], array['hotel','lodging']::text[], '[{"key":"tourism","value":"hotel"},{"key":"tourism","value":"guest_house"}]'::jsonb, 1.3),
  (null, 'travel_agencies', 'Travel Agencies', array['travel agency','travel agent','tour operator','tours','visa services','holiday packages','desert safari']::text[], '{}'::text[], array['travel_agency']::text[], '[{"key":"shop","value":"travel_agency"},{"key":"office","value":"travel_agent"}]'::jsonb, 1.15)
on conflict do nothing;

-- Default organisation (Ain AlTair). Additional organisations can be added later.
insert into public.organisations (name, slug, default_currency, default_country_code, timezone)
values ('Ain AlTair', 'ain-altair', 'AED', 'AE', 'Asia/Dubai')
on conflict (slug) do nothing;

-- Register providers + default settings for every organisation (idempotent).
create or replace function public.bootstrap_organisation(org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.providers (organisation_id, key, name, kind, priority, rate_limit_per_minute) values
    (org_id, 'google_places', 'Google Places API (New)', 'DISCOVERY', 10, 120),
    (org_id, 'apify_google_maps', 'Apify — Google Maps Scraper', 'DISCOVERY', 20, 10),
    (org_id, 'osm_overpass', 'OpenStreetMap (Overpass API)', 'DISCOVERY', 30, 6),
    (org_id, 'brave_search', 'Brave Search API', 'ENRICHMENT', 40, 50),
    (org_id, 'apify_instagram', 'Apify — Instagram Profile Metrics', 'ENRICHMENT', 45, 6),
    (org_id, 'website_audit', 'Built-in Website Auditor', 'AUDIT', 50, 60),
    (org_id, 'pagespeed', 'Google PageSpeed Insights', 'AUDIT', 55, 60),
    (org_id, 'nominatim', 'OpenStreetMap Nominatim', 'GEOCODING', 60, 50),
    (org_id, 'anthropic', 'Claude (Anthropic API)', 'AI', 70, 50),
    (org_id, 'google_sheets', 'Google Sheets', 'INTEROP', 80, 60)
  on conflict (organisation_id, key) do update set name = excluded.name, kind = excluded.kind;
  insert into public.org_settings (organisation_id) values (org_id) on conflict do nothing;
end $$;
revoke all on function public.bootstrap_organisation(uuid) from public, anon, authenticated;

select public.bootstrap_organisation(id) from public.organisations;

create or replace function public.on_organisation_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.bootstrap_organisation(new.id);
  return new;
end $$;
create trigger organisations_bootstrap after insert on public.organisations
  for each row execute function public.on_organisation_created();

-- >>> 20261008000007_research_functions.sql
-- ============================================================================
-- 0007 RESEARCH HELPERS (service role only)
-- ============================================================================

create index if not exists businesses_normname_idx on public.businesses(organisation_id, normalized_name);

-- Candidate records for entity resolution. Returns exact identifier matches
-- plus fuzzy-name matches nearby; the application scores them precisely.
create or replace function public.find_business_candidates(
  p_org uuid, p_name text, p_phone text default null, p_domain text default null,
  p_place_id text default null, p_lat double precision default null, p_lng double precision default null,
  p_instagram text default null, p_email text default null, p_limit int default 15
)
returns table (
  id uuid, name text, normalized_name text, lifecycle text, phone_e164 text, whatsapp_e164 text, website_domain text,
  google_place_id text, google_maps_url text, address text, lat double precision, lng double precision, email text, instagram text, name_sim real
)
language sql stable security definer set search_path = public as $$
  select b.id, b.name, b.normalized_name, b.lifecycle, b.phone_e164, b.whatsapp_e164, b.website_domain, b.google_place_id,
         b.google_maps_url, b.address, b.lat, b.lng, b.email,
         (select lower(s.username) from public.business_socials s where s.business_id = b.id and s.platform = 'INSTAGRAM' limit 1),
         similarity(b.normalized_name, p_name)
  from public.businesses b
  where b.organisation_id = p_org
    and b.lifecycle in ('RESEARCH','ACTIVE','ARCHIVED','REJECTED')
    and (
      (p_place_id is not null and b.google_place_id = p_place_id)
      or (p_phone is not null and (b.phone_e164 = p_phone or b.whatsapp_e164 = p_phone))
      or (p_domain is not null and b.website_domain = p_domain)
      or (p_email is not null and lower(b.email) = lower(p_email))
      or (p_instagram is not null and exists (select 1 from public.business_socials s where s.business_id = b.id and s.platform = 'INSTAGRAM' and lower(s.username) = lower(p_instagram)))
      or (b.normalized_name % p_name and (
            p_lat is null or b.lat is null
            or (abs(b.lat - p_lat) < 0.03 and abs(b.lng - p_lng) < 0.03)
         ))
    )
  order by (b.google_place_id = p_place_id) desc nulls last, similarity(b.normalized_name, p_name) desc
  limit p_limit
$$;
revoke all on function public.find_business_candidates(uuid, text, text, text, text, double precision, double precision, text, text, int) from public, anon, authenticated;

-- Job task bookkeeping: counts of unfinished tasks per kind for a job.
create or replace function public.job_task_counts(p_job uuid)
returns table (kind text, pending bigint, running bigint, done bigint, failed bigint)
language sql stable security definer set search_path = public as $$
  select kind,
         count(*) filter (where status = 'PENDING'),
         count(*) filter (where status = 'RUNNING'),
         count(*) filter (where status = 'DONE'),
         count(*) filter (where status = 'FAILED')
  from public.job_tasks where job_id = p_job group by kind
$$;
revoke all on function public.job_task_counts(uuid) from public, anon, authenticated;

-- Atomic stage transition: only one worker wins.
create or replace function public.transition_job(p_job uuid, p_from text[], p_to text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.search_jobs set status = p_to, updated_at = now()
   where id = p_job and status = any(p_from);
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.transition_job(uuid, text[], text) from public, anon, authenticated;

-- Provider usage accounting (daily counters reset by date).
create or replace function public.record_provider_usage(p_org uuid, p_key text, p_units int, p_ok boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.providers set
    usage_today = case when usage_date = current_date then usage_today + p_units else p_units end,
    usage_date = current_date,
    run_count = run_count + 1,
    error_count = error_count + case when p_ok then 0 else 1 end,
    last_success_at = case when p_ok then now() else last_success_at end,
    last_error_at = case when p_ok then last_error_at else now() end,
    last_error = case when p_ok then last_error else left(p_error, 1000) end
  where organisation_id = p_org and key = p_key;
end $$;
revoke all on function public.record_provider_usage(uuid, text, int, boolean, text) from public, anon, authenticated;

-- >>> 20261008000008_bootstrap_admins.sql
-- ============================================================================
-- 0008 BOOTSTRAP SUPER ADMINS
-- Emails listed here are activated as SUPER_ADMIN automatically when they
-- register (solves the "first admin" problem without manual SQL).
-- Only the service role / database owner can read or write this table.
-- ============================================================================
create table if not exists public.bootstrap_super_admins (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.bootstrap_super_admins enable row level security;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  default_org uuid;
  is_boot boolean;
begin
  select id into default_org from public.organisations order by created_at asc limit 1;
  select exists (select 1 from public.bootstrap_super_admins b where lower(b.email) = lower(new.email)) into is_boot;
  insert into public.profiles (id, organisation_id, email, full_name, status, role_key, approved_at)
  values (
    new.id, default_org, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when is_boot then 'ACTIVE' else 'PENDING' end,
    case when is_boot then 'SUPER_ADMIN' else 'VIEWER' end,
    case when is_boot then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end $$;
