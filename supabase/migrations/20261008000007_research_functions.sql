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
