-- Callers table, interview videos, indexes, tighter RLS
-- Run in the Supabase SQL Editor

-- 1) Callers (1:1 with users; id matches auth/users id) -------------------
create table if not exists public.callers (
  id uuid primary key references public.users (id) on delete cascade,
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists callers_set_updated_at on public.callers;
create trigger callers_set_updated_at
  before update on public.callers
  for each row execute function public.set_updated_at();

-- Backfill from role + existing interview assignments
insert into public.callers (id)
select id from public.users where user_role = 'caller'
on conflict (id) do nothing;

insert into public.callers (id)
select distinct caller_id
from public.interviews
where caller_id is not null
on conflict (id) do nothing;

-- interviews.caller_id stays on users(id) (= callers.id) to avoid duplicating people data.
-- Require a callers row before assigning an interview to a caller.
create or replace function public.ensure_caller_exists()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.callers (id)
  values (new.caller_id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists interviews_ensure_caller on public.interviews;
create trigger interviews_ensure_caller
  before insert or update of caller_id on public.interviews
  for each row execute function public.ensure_caller_exists();

-- Keep callers in sync when user role changes
create or replace function public.sync_caller_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_role = 'caller' then
    insert into public.callers (id, active)
    values (new.id, new.status = 'allowed')
    on conflict (id) do update
      set active = excluded.active,
          updated_at = now();
  elsif tg_op = 'UPDATE' and old.user_role = 'caller' and new.user_role is distinct from 'caller' then
    update public.callers
    set active = false, updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists users_sync_caller_profile on public.users;
create trigger users_sync_caller_profile
  after insert or update of user_role, status on public.users
  for each row execute function public.sync_caller_profile();

alter table public.callers enable row level security;

drop policy if exists "Admins manage callers" on public.callers;
create policy "Admins manage callers"
  on public.callers for all to authenticated
  using (public.is_allowed_admin())
  with check (public.is_allowed_admin());

drop policy if exists "Callers read own caller row" on public.callers;
create policy "Callers read own caller row"
  on public.callers for select to authenticated
  using (id = auth.uid());

-- 2) Interview video path ------------------------------------------------
alter table public.interviews
  add column if not exists video_path text not null default '';

-- Callers may update only video_path on their own interviews
create or replace function public.restrict_caller_interview_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_allowed_admin() then
    return new;
  end if;

  if auth.uid() is null or old.caller_id is distinct from auth.uid() then
    raise exception 'Not allowed to update this interview';
  end if;

  if
    new.interview_name is distinct from old.interview_name
    or new.caller_id is distinct from old.caller_id
    or new.invited_member_id is distinct from old.invited_member_id
    or new.job_id is distinct from old.job_id
    or new.meeting_link is distinct from old.meeting_link
    or new.booking_note is distinct from old.booking_note
    or new.stage is distinct from old.stage
    or new.result is distinct from old.result
    or new.start_time is distinct from old.start_time
    or new.end_time is distinct from old.end_time
    or new.created_by is distinct from old.created_by
  then
    raise exception 'Callers may only update the interview video';
  end if;

  return new;
end;
$$;

drop trigger if exists interviews_restrict_caller_updates on public.interviews;
create trigger interviews_restrict_caller_updates
  before update on public.interviews
  for each row execute function public.restrict_caller_interview_updates();

drop policy if exists "Callers update own interview video" on public.interviews;
create policy "Callers update own interview video"
  on public.interviews for update to authenticated
  using (caller_id = auth.uid())
  with check (caller_id = auth.uid());

-- 3) Indexes -------------------------------------------------------------
create index if not exists interviews_caller_id_idx on public.interviews (caller_id);
create index if not exists interviews_invited_member_id_idx on public.interviews (invited_member_id);
create index if not exists interviews_job_id_idx on public.interviews (job_id);
create index if not exists interviews_start_time_idx on public.interviews (start_time);
create index if not exists interviews_stage_idx on public.interviews (stage);
create index if not exists interviews_result_idx on public.interviews (result);
create index if not exists callers_active_idx on public.callers (active);

-- 4) Jobs / teammembers SELECT ------------------------------------------
-- Admin + team_member: full directory. Caller: only rows linked to their interviews.
drop policy if exists "Authenticated read jobs" on public.jobs;
drop policy if exists "Admins and linked callers read jobs" on public.jobs;
drop policy if exists "Role based read jobs" on public.jobs;
create policy "Role based read jobs"
  on public.jobs for select to authenticated
  using (
    public.is_allowed_admin()
    or public.is_allowed_team_member()
    or exists (
      select 1
      from public.interviews i
      where i.job_id = jobs.id
        and i.caller_id = auth.uid()
    )
  );

drop policy if exists "Authenticated read teammembers" on public.teammembers;
drop policy if exists "Admins and linked callers read teammembers" on public.teammembers;
drop policy if exists "Role based read teammembers" on public.teammembers;
create policy "Role based read teammembers"
  on public.teammembers for select to authenticated
  using (
    public.is_allowed_admin()
    or public.is_allowed_team_member()
    or exists (
      select 1
      from public.interviews i
      where i.invited_member_id = teammembers.id
        and i.caller_id = auth.uid()
    )
  );

-- 5) Interview video storage --------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'interview-videos',
  'interview-videos',
  false,
  524288000,
  array[
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska'
  ]
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_interview_video(object_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_allowed_admin()
    or exists (
      select 1
      from public.interviews i
      where i.caller_id = auth.uid()
        and (
          i.video_path = object_name
          or object_name like (i.id::text || '/%')
        )
    );
$$;

revoke all on function public.can_access_interview_video(text) from public;
grant execute on function public.can_access_interview_video(text) to authenticated;

drop policy if exists "Interview video read" on storage.objects;
create policy "Interview video read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'interview-videos'
    and public.can_access_interview_video(name)
  );

drop policy if exists "Interview video insert" on storage.objects;
create policy "Interview video insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'interview-videos'
    and public.can_access_interview_video(name)
  );

drop policy if exists "Interview video update" on storage.objects;
create policy "Interview video update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'interview-videos'
    and public.can_access_interview_video(name)
  )
  with check (
    bucket_id = 'interview-videos'
    and public.can_access_interview_video(name)
  );

drop policy if exists "Interview video delete" on storage.objects;
create policy "Interview video delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'interview-videos'
    and (
      public.is_allowed_admin()
      or public.can_access_interview_video(name)
    )
  );
