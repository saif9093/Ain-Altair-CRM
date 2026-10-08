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
