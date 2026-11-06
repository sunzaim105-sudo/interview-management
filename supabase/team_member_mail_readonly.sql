-- Team members: read-only access to Gmail cache tables (same visibility as admin).
-- Mutations remain admin-only via existing manage policies / service-role API.
-- Safe to re-run. Requires public.is_allowed_team_member() (role_based_access.sql).

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
