-- Legacy interviews bootstrap (superseded by schedule_v2.sql).
-- Kept for reference; prefer running schedule_v2.sql for the current schema.

-- Interviews table + RLS
-- Run in Supabase SQL Editor (or alongside bootstrap)

create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  interview_name text not null,
  caller_id uuid not null references public.users (id) on delete restrict,
  company_name text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interviews_time_check check (end_time > start_time)
);

create index if not exists interviews_start_time_idx on public.interviews (start_time);
create index if not exists interviews_caller_id_idx on public.interviews (caller_id);
create index if not exists interviews_created_by_idx on public.interviews (created_by);

drop trigger if exists interviews_set_updated_at on public.interviews;
create trigger interviews_set_updated_at
  before update on public.interviews
  for each row execute function public.set_updated_at();

alter table public.interviews enable row level security;

-- Admins can manage all interviews
drop policy if exists "Admins manage interviews" on public.interviews;
create policy "Admins manage interviews"
  on public.interviews
  for all
  to authenticated
  using (public.is_allowed_admin())
  with check (public.is_allowed_admin());

-- Callers can read interviews assigned to them
drop policy if exists "Callers read own interviews" on public.interviews;
create policy "Callers read own interviews"
  on public.interviews
  for select
  to authenticated
  using (caller_id = auth.uid());

-- Allowed admins can read caller profiles for assignment
drop policy if exists "Admins can read callers for booking" on public.users;
create policy "Admins can read callers for booking"
  on public.users
  for select
  to authenticated
  using (
    public.is_allowed_admin()
    or auth.uid() = id
  );

-- If an older interviews.position column still exists, drop it
alter table public.interviews drop column if exists position;
