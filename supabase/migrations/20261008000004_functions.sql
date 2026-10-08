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
    'pipeline_value', coalesce(sum(coalesce(deal_value, recommended_price_max)) filter (where pipeline_stage in ('INTERESTED','MEETING','QUOTE_SENT')), 0),
    'won_value', coalesce(sum(coalesce(deal_value, recommended_price_max)) filter (where pipeline_stage = 'WON'), 0),
    'opportunity_value', coalesce(sum(opportunity_value) filter (where pipeline_stage not in ('WON','LOST')), 0),
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
    coalesce(sum(b.opportunity_value), 0),
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
