-- CRITICAL: Team members see ALL workspace data (like admin), read-only.
-- Fixes policies from callers_videos_rls.sql that only allowed admin/linked-caller.
-- Apply in Supabase → SQL Editor. Safe to re-run.

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

-- ---------------------------------------------------------------------------
-- Interviews: every interview + result (not only "related to me")
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Jobs: entire jobs table for team members
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Team directory: every team member row (not only self / linked)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Callers (for schedule/report filters) — full caller directory
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Mail: every connected mailbox / thread / message (read-only)
-- (Vite Mail API also uses service role; these policies cover direct client reads.)
-- ---------------------------------------------------------------------------
drop policy if exists "Admins see gmail accounts" on public.gmail_accounts;
drop policy if exists "Mail readers see gmail accounts" on public.gmail_accounts;
create policy "Mail readers see gmail accounts"
  on public.gmail_accounts
  for select
  to authenticated
  using (
    public.is_allowed_admin()
    or public.is_allowed_team_member()
  );

drop policy if exists "Admins see mail threads" on public.mail_threads;
drop policy if exists "Mail readers see threads" on public.mail_threads;
create policy "Mail readers see threads"
  on public.mail_threads
  for select
  to authenticated
  using (
    public.is_allowed_admin()
    or public.is_allowed_team_member()
  );

drop policy if exists "Admins see mail messages" on public.mail_messages;
drop policy if exists "Mail readers see messages" on public.mail_messages;
create policy "Mail readers see messages"
  on public.mail_messages
  for select
  to authenticated
  using (
    public.is_allowed_admin()
    or public.is_allowed_team_member()
  );
