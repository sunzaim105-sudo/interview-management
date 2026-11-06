-- Interview report fields + expanded user roles/permissions
-- Run in the Supabase SQL Editor

-- Interview stage + result -----------------------------------------------
alter table public.interviews
  add column if not exists stage text not null default 'Initial Recruiter Screening';

alter table public.interviews
  add column if not exists result text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'interviews_stage_check'
  ) then
    alter table public.interviews
      add constraint interviews_stage_check
      check (
        stage in (
          'Initial Recruiter Screening',
          'Hiring Manager Interview',
          'Technical Assessment / Coding Interview',
          'Behavioral / Team Interview',
          'Final Decision and Job Offer',
          'Onboarding'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'interviews_result_check'
  ) then
    alter table public.interviews
      add constraint interviews_result_check
      check (result is null or result in ('pass', 'fail'));
  end if;
end $$;

-- Normalize legacy onboarding casing if present
update public.interviews
set stage = 'Onboarding'
where lower(stage) = 'onboarding'
  and stage is distinct from 'Onboarding';

-- Users: role + permission (status) --------------------------------------
alter table public.users drop constraint if exists users_user_role_check;
alter table public.users
  add constraint users_user_role_check
  check (user_role in ('admin', 'caller', 'team_member'));

alter table public.users drop constraint if exists users_status_check;
alter table public.users
  add constraint users_status_check
  check (status in ('pending', 'allowed', 'suspended', 'blocked'));

-- Admins may insert profile rows (used with Auth Admin create)
drop policy if exists "Admins can insert profiles" on public.users;
create policy "Admins can insert profiles"
  on public.users
  for insert
  to authenticated
  with check (public.is_allowed_admin());

-- Admins may delete profile rows
drop policy if exists "Admins can delete profiles" on public.users;
create policy "Admins can delete profiles"
  on public.users
  for delete
  to authenticated
  using (public.is_allowed_admin());
