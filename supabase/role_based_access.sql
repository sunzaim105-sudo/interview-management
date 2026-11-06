-- Role-based read access
-- Admin: full manage (existing policies)
-- Team member: read ALL interviews / jobs / teammembers / callers (not self-only)
-- Caller: read only interviews assigned to them + linked jobs / teammembers
-- Safe to re-run.
-- NOTE: If callers_videos_rls.sql was applied later, re-run team_member_full_readonly.sql.

create or replace function public.is_allowed_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and user_role = 'team_member'
      and status = 'allowed'
  );
$$;

revoke all on function public.is_allowed_team_member() from public;
grant execute on function public.is_allowed_team_member() to authenticated;

-- Interviews SELECT -------------------------------------------------------
drop policy if exists "Callers read own interviews" on public.interviews;
drop policy if exists "Team members read interviews" on public.interviews;
drop policy if exists "Assigned callers and team members read interviews" on public.interviews;

create policy "Assigned callers and team members read interviews"
  on public.interviews
  for select
  to authenticated
  using (
    public.is_allowed_admin()
    or public.is_allowed_team_member()
    or caller_id = auth.uid()
  );

-- Jobs SELECT -------------------------------------------------------------
drop policy if exists "Authenticated read jobs" on public.jobs;
drop policy if exists "Admins and linked callers read jobs" on public.jobs;
drop policy if exists "Role based read jobs" on public.jobs;

create policy "Role based read jobs"
  on public.jobs
  for select
  to authenticated
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

-- Team members SELECT -----------------------------------------------------
drop policy if exists "Authenticated read teammembers" on public.teammembers;
drop policy if exists "Admins and linked callers read teammembers" on public.teammembers;
drop policy if exists "Role based read teammembers" on public.teammembers;

create policy "Role based read teammembers"
  on public.teammembers
  for select
  to authenticated
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

-- Caller profiles (for schedule/report filters & joined interview rows)
drop policy if exists "Team members read caller profiles" on public.users;
create policy "Team members read caller profiles"
  on public.users
  for select
  to authenticated
  using (
    public.is_allowed_team_member()
    and user_role = 'caller'
  );

drop policy if exists "Team members read callers" on public.callers;
create policy "Team members read callers"
  on public.callers
  for select
  to authenticated
  using (public.is_allowed_team_member());
