-- Central Gmail inbox (forwarded interview mail)
-- Run after supabase/gmail_mail.sql
-- One shared mailbox receives auto-forwards from team members; we match
-- threads to teammembers by original From / forwarded headers.

-- Allow a single central account without a team_member_id
alter table public.gmail_accounts
  alter column team_member_id drop not null;

alter table public.gmail_accounts
  drop constraint if exists gmail_accounts_team_member_id_key;

create unique index if not exists gmail_accounts_team_member_unique
  on public.gmail_accounts (team_member_id)
  where team_member_id is not null;

alter table public.gmail_accounts
  add column if not exists account_kind text not null default 'member'
    check (account_kind in ('central', 'member'));

-- Only one central inbox
create unique index if not exists gmail_accounts_one_central
  on public.gmail_accounts ((account_kind))
  where account_kind = 'central';

-- Which team member this conversation belongs to (via forward matching)
alter table public.mail_threads
  add column if not exists matched_team_member_id uuid
    references public.teammembers (id) on delete set null;

create index if not exists mail_threads_matched_member_idx
  on public.mail_threads (matched_team_member_id, last_message_at desc);

-- Admin-only policies for central inbox (callers no longer open mailboxes)
drop policy if exists "Mail readers see gmail accounts" on public.gmail_accounts;
create policy "Admins see gmail accounts"
  on public.gmail_accounts for select to authenticated
  using (public.is_admin());

drop policy if exists "Mail readers see threads" on public.mail_threads;
create policy "Admins see mail threads"
  on public.mail_threads for select to authenticated
  using (public.is_admin());

drop policy if exists "Mail readers see messages" on public.mail_messages;
create policy "Admins see mail messages"
  on public.mail_messages for select to authenticated
  using (public.is_admin());
