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
