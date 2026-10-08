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
