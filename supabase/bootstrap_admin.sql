-- Run this once in the Supabase SQL Editor.
-- 1) Creates public.users + auth helpers
-- 2) Inserts Brian Bruce as an allowed admin
-- Auth user already exists: a6159d58-fe11-4e21-b6c0-496df11b4e65

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  user_id text not null unique,
  user_role text not null default 'caller'
    check (user_role in ('admin', 'caller')),
  email text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'allowed', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_user_id_idx on public.users (user_id);
create index if not exists users_status_idx on public.users (status);
create index if not exists users_role_idx on public.users (user_role);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, username, user_id, user_role, email, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'user_id', new.id::text),
    coalesce(new.raw_user_meta_data->>'user_role', 'caller'),
    new.email,
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.get_email_by_user_id(p_user_id text)
returns text
language sql
security definer
set search_path = public
as $$
  select email
  from public.users
  where user_id = p_user_id
  limit 1;
$$;

revoke all on function public.get_email_by_user_id(text) from public;
grant execute on function public.get_email_by_user_id(text) to anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

alter table public.users enable row level security;

create or replace function public.is_allowed_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and user_role = 'admin'
      and status = 'allowed'
  );
$$;

revoke all on function public.is_allowed_admin() from public;
grant execute on function public.is_allowed_admin() to authenticated;

drop policy if exists "Users can read own profile" on public.users;
create policy "Users can read own profile"
  on public.users
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Admins can read all profiles" on public.users;
create policy "Admins can read all profiles"
  on public.users
  for select
  to authenticated
  using (public.is_allowed_admin());

drop policy if exists "Admins can update profiles" on public.users;
create policy "Admins can update profiles"
  on public.users
  for update
  to authenticated
  using (public.is_allowed_admin())
  with check (public.is_allowed_admin());

-- Confirm email so the admin can sign in immediately
update auth.users
set
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'username', 'Brian Bruce',
    'user_id', 'Brian_Bruce_1010',
    'user_role', 'admin'
  )
where id = 'a6159d58-fe11-4e21-b6c0-496df11b4e65'
   or email = 'jeannie16nguyen@gmail.com';

-- Upsert admin profile
insert into public.users (id, username, user_id, user_role, email, status)
select
  u.id,
  'Brian Bruce',
  'Brian_Bruce_1010',
  'admin',
  u.email,
  'allowed'
from auth.users u
where u.id = 'a6159d58-fe11-4e21-b6c0-496df11b4e65'
   or u.email = 'jeannie16nguyen@gmail.com'
on conflict (id) do update
set
  username = excluded.username,
  user_id = excluded.user_id,
  user_role = 'admin',
  email = excluded.email,
  status = 'allowed',
  updated_at = now();
