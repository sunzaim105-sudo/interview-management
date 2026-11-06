-- Multi-account Gmail (per team member OAuth)
-- Run after supabase/gmail_mail.sql (and optionally after gmail_central_inbox.sql).
-- Safe to re-run.

-- Prefer member-linked accounts again (central inbox is deprecated).
alter table public.gmail_accounts
  add column if not exists account_kind text not null default 'member';

alter table public.gmail_accounts
  drop constraint if exists gmail_accounts_account_kind_check;

alter table public.gmail_accounts
  add constraint gmail_accounts_account_kind_check
  check (account_kind in ('central', 'member'));

-- Keep matched_team_member_id for UI joins; member accounts set it = team_member_id.
alter table public.mail_threads
  add column if not exists matched_team_member_id uuid
    references public.teammembers (id) on delete set null;

create index if not exists mail_threads_matched_member_idx
  on public.mail_threads (matched_team_member_id, last_message_at desc);

-- Unique member account when team_member_id is present
drop index if exists gmail_accounts_team_member_unique;
create unique index if not exists gmail_accounts_team_member_unique
  on public.gmail_accounts (team_member_id)
  where team_member_id is not null;

-- Optional: remove legacy central rows after migrating (commented — run manually if desired)
-- delete from public.gmail_accounts where account_kind = 'central';

-- Admins see all gmail accounts / threads / messages (service role used by API).
drop policy if exists "Admins see gmail accounts" on public.gmail_accounts;
drop policy if exists "Mail readers see gmail accounts" on public.gmail_accounts;
create policy "Admins see gmail accounts"
  on public.gmail_accounts for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins see mail threads" on public.mail_threads;
drop policy if exists "Mail readers see threads" on public.mail_threads;
create policy "Admins see mail threads"
  on public.mail_threads for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins see mail messages" on public.mail_messages;
drop policy if exists "Mail readers see messages" on public.mail_messages;
create policy "Admins see mail messages"
  on public.mail_messages for select to authenticated
  using (public.is_admin());
