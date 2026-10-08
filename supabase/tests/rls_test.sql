-- RLS / permission regression tests. Run via `npm run db:check`.
-- Each assertion raises on failure, which aborts with a non-zero exit.
\set ON_ERROR_STOP 1
begin;

create temp table t_ids (k text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

do $$
declare
  org uuid; team_a uuid; team_b uuid;
  u_sa uuid := gen_random_uuid(); u_s1 uuid := gen_random_uuid(); u_s2 uuid := gen_random_uuid();
  u_mgr uuid := gen_random_uuid(); u_pending uuid := gen_random_uuid();
  bid uuid;
begin
  select id into org from public.organisations where slug = 'ain-altair';
  insert into public.teams (organisation_id, name) values (org, 'Team A') returning id into team_a;
  insert into public.teams (organisation_id, name) values (org, 'Team B') returning id into team_b;
  insert into auth.users (id, email) values (u_sa,'sa@test'),(u_s1,'s1@test'),(u_s2,'s2@test'),(u_mgr,'mgr@test'),(u_pending,'p@test');
  update public.profiles set status='ACTIVE', role_key='SUPER_ADMIN' where id=u_sa;
  update public.profiles set status='ACTIVE', role_key='SALES', team_id=team_a where id=u_s1;
  update public.profiles set status='ACTIVE', role_key='SALES', team_id=team_b where id=u_s2;
  update public.profiles set status='ACTIVE', role_key='MANAGER', team_id=team_a where id=u_mgr;
  insert into t_ids values ('org',org),('sa',u_sa),('s1',u_s1),('s2',u_s2),('mgr',u_mgr),('pending',u_pending);

  insert into public.businesses (organisation_id, name, normalized_name, lifecycle, owner_id, team_id) values (org,'Al Noor Cleaning','al noor cleaning','ACTIVE',u_s1,team_a) returning id into bid;
  insert into t_ids values ('b1', bid);
  insert into public.businesses (organisation_id, name, normalized_name, lifecycle, owner_id, team_id) values (org,'Sharjah Flowers','sharjah flowers','ACTIVE',u_s2,team_b) returning id into bid;
  insert into t_ids values ('b2', bid);
  insert into public.businesses (organisation_id, name, normalized_name, lifecycle) values (org,'Unassigned Salon','unassigned salon','ACTIVE') returning id into bid;
  insert into t_ids values ('b3', bid);
  insert into public.businesses (organisation_id, name, normalized_name, lifecycle) values (org,'Research Bakery','research bakery','RESEARCH') returning id into bid;
  insert into t_ids values ('b4', bid);
end $$;

create or replace function pg_temp.act_as(who text) returns void language plpgsql as $$
declare uid uuid;
begin
  select id into uid from t_ids where k = who;
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

create or replace function pg_temp.assert_eq(label text, got bigint, expected bigint) returns void language plpgsql as $$
begin
  if got is distinct from expected then raise exception 'ASSERT FAILED: % (got %, expected %)', label, got, expected; end if;
  raise notice 'ok: %', label;
end $$;

-- SALES sees only own leads
select pg_temp.act_as('s1');
set local role authenticated;
select pg_temp.assert_eq('sales sees only own leads', (select count(*) from public.businesses), 1);
select pg_temp.assert_eq('sales has no admin perm', (select count(*) from public.audit_logs), 0);
reset role;

-- MANAGER (team A) sees team lead + unassigned + research, not team B's
select pg_temp.act_as('mgr');
set local role authenticated;
select pg_temp.assert_eq('manager sees team, unassigned and research', (select count(*) from public.businesses), 3);
select pg_temp.assert_eq('manager cannot see team B lead', (select count(*) from public.businesses where name = 'Sharjah Flowers'), 0);
reset role;

-- SUPER ADMIN sees everything
select pg_temp.act_as('sa');
set local role authenticated;
select pg_temp.assert_eq('super admin sees all', (select count(*) from public.businesses), 4);
reset role;

-- PENDING users see nothing
select pg_temp.act_as('pending');
set local role authenticated;
select pg_temp.assert_eq('pending user sees no leads', (select count(*) from public.businesses), 0);
select pg_temp.assert_eq('pending user sees own profile', (select count(*) from public.profiles), 1);
reset role;

-- Privilege escalation: a user cannot change their own role
select pg_temp.act_as('s1');
set local role authenticated;
do $$ begin
  begin
    update public.profiles set role_key = 'SUPER_ADMIN' where id = auth.uid();
    raise exception 'ASSERT FAILED: self role escalation allowed';
  exception when others then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
    raise notice 'ok: self role escalation blocked (%)', sqlerrm;
  end;
end $$;
reset role;

-- Users cannot write audit logs directly
select pg_temp.act_as('s1');
set local role authenticated;
do $$ begin
  begin
    insert into public.audit_logs (action, entity_type) values ('forged', 'x');
    raise exception 'ASSERT FAILED: user inserted audit log';
  exception when others then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
    raise notice 'ok: audit log insert blocked';
  end;
end $$;
reset role;

-- Private notes visible to author only
select pg_temp.act_as('s1');
set local role authenticated;
insert into public.notes (business_id, body, visibility, author_id)
  select (select id from t_ids where k='b1'), 'private thought', 'PRIVATE', auth.uid();
insert into public.notes (business_id, body, visibility, author_id)
  select (select id from t_ids where k='b1'), 'shared note', 'TEAM', auth.uid();
select pg_temp.assert_eq('author sees both notes', (select count(*) from public.notes), 2);
reset role;
select pg_temp.act_as('mgr');
set local role authenticated;
select pg_temp.assert_eq('manager sees only team note', (select count(*) from public.notes), 1);
reset role;

-- Sales cannot merge; manager can, and children move to the survivor
select pg_temp.act_as('s1');
set local role authenticated;
do $$ begin
  begin
    perform public.merge_businesses((select id from t_ids where k='b1'), (select id from t_ids where k='b3'), '{}'::jsonb, auth.uid());
    raise exception 'ASSERT FAILED: sales merged records';
  exception when others then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
    raise notice 'ok: sales merge blocked';
  end;
end $$;
reset role;

select pg_temp.act_as('mgr');
set local role authenticated;
select public.merge_businesses((select id from t_ids where k='b3'), (select id from t_ids where k='b1'), '{}'::jsonb, auth.uid());
reset role;
select pg_temp.assert_eq('notes moved to survivor', (select count(*) from public.notes where business_id = (select id from t_ids where k='b3')), 2);
select pg_temp.assert_eq('merged record marked MERGED', (select count(*) from public.businesses where id = (select id from t_ids where k='b1') and lifecycle = 'MERGED'), 1);

-- Audit log is append-only even for the owner role
insert into public.audit_logs (action, entity_type) values ('test', 'x');
do $$ begin
  begin
    update public.audit_logs set action = 'tampered';
    raise exception 'ASSERT FAILED: audit log updated';
  exception when others then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
    raise notice 'ok: audit log immutable';
  end;
end $$;

-- Queue claiming
insert into public.job_tasks (organisation_id, kind) select id, 'test.kind' from t_ids where k='org';
select pg_temp.assert_eq('claim returns the task', (select count(*) from public.claim_job_tasks('w1', 5)), 1);
select pg_temp.assert_eq('claimed task not re-claimed', (select count(*) from public.claim_job_tasks('w2', 5)), 0);

rollback;
