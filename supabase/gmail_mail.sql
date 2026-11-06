-- Gmail Mail integration
-- Run in the Supabase SQL Editor after Team / interviews exist.

-- Connected Gmail accounts (metadata). OAuth secrets live in gmail_account_secrets.
create table if not exists public.gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null unique references public.teammembers (id) on delete cascade,
  gmail_address text not null,
  google_user_id text not null default '',
  history_id text not null default '',
  watch_expiration timestamptz,
  last_sync_at timestamptz,
  last_error text not null default '',
  status text not null default 'connected'
    check (status in ('connected', 'revoked', 'error')),
  connected_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gmail_accounts_status_idx on public.gmail_accounts (status);
create index if not exists gmail_accounts_gmail_address_idx on public.gmail_accounts (gmail_address);

-- Server-only secrets (no grants to authenticated / anon).
create table if not exists public.gmail_account_secrets (
  gmail_account_id uuid primary key references public.gmail_accounts (id) on delete cascade,
  refresh_token_enc text not null,
  access_token_enc text not null default '',
  access_token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

revoke all on table public.gmail_account_secrets from anon, authenticated;
-- service_role bypasses RLS and has full access by default in Supabase

-- Explicit mailbox ACL: which app users may open a team member's connected Gmail.
-- Admins always have access (enforced in app + policies).
create table if not exists public.mail_access (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references public.teammembers (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  granted_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_member_id, user_id)
);

create index if not exists mail_access_user_idx on public.mail_access (user_id);

create table if not exists public.mail_threads (
  id uuid primary key default gen_random_uuid(),
  gmail_account_id uuid not null references public.gmail_accounts (id) on delete cascade,
  gmail_thread_id text not null,
  subject text not null default '',
  snippet text not null default '',
  participants text[] not null default '{}',
  label_ids text[] not null default '{}',
  is_unread boolean not null default false,
  is_starred boolean not null default false,
  last_message_at timestamptz,
  interview_id uuid references public.interviews (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gmail_account_id, gmail_thread_id)
);

create index if not exists mail_threads_account_last_idx
  on public.mail_threads (gmail_account_id, last_message_at desc);
create index if not exists mail_threads_interview_idx on public.mail_threads (interview_id);

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  gmail_account_id uuid not null references public.gmail_accounts (id) on delete cascade,
  thread_id uuid not null references public.mail_threads (id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text not null,
  from_header text not null default '',
  to_header text not null default '',
  cc_header text not null default '',
  subject text not null default '',
  snippet text not null default '',
  body_text text not null default '',
  body_html text not null default '',
  label_ids text[] not null default '{}',
  internal_date timestamptz,
  has_attachments boolean not null default false,
  raw_headers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gmail_account_id, gmail_message_id)
);

create index if not exists mail_messages_thread_idx
  on public.mail_messages (thread_id, internal_date);
create index if not exists mail_messages_account_date_idx
  on public.mail_messages (gmail_account_id, internal_date desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gmail_accounts_set_updated_at on public.gmail_accounts;
create trigger gmail_accounts_set_updated_at
  before update on public.gmail_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists mail_threads_set_updated_at on public.mail_threads;
create trigger mail_threads_set_updated_at
  before update on public.mail_threads
  for each row execute function public.set_updated_at();

drop trigger if exists mail_messages_set_updated_at on public.mail_messages;
create trigger mail_messages_set_updated_at
  before update on public.mail_messages
  for each row execute function public.set_updated_at();

alter table public.gmail_accounts enable row level security;
alter table public.gmail_account_secrets enable row level security;
alter table public.mail_access enable row level security;
alter table public.mail_threads enable row level security;
alter table public.mail_messages enable row level security;

-- Deny all client access to secrets (service role bypasses RLS)
drop policy if exists "No client access to gmail secrets" on public.gmail_account_secrets;
create policy "No client access to gmail secrets"
  on public.gmail_account_secrets for all to authenticated
  using (false)
  with check (false);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.user_role = 'admin'
      and u.status = 'allowed'
  );
$$;

create or replace function public.can_access_mail_member(p_team_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.mail_access a
      where a.team_member_id = p_team_member_id
        and a.user_id = auth.uid()
    );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.can_access_mail_member(uuid) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_access_mail_member(uuid) to authenticated;

drop policy if exists "Mail readers see gmail accounts" on public.gmail_accounts;
create policy "Mail readers see gmail accounts"
  on public.gmail_accounts for select to authenticated
  using (public.can_access_mail_member(team_member_id));

drop policy if exists "Admins manage mail access" on public.mail_access;
create policy "Admins manage mail access"
  on public.mail_access for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users read own mail access" on public.mail_access;
create policy "Users read own mail access"
  on public.mail_access for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Mail readers see threads" on public.mail_threads;
create policy "Mail readers see threads"
  on public.mail_threads for select to authenticated
  using (
    exists (
      select 1 from public.gmail_accounts ga
      where ga.id = mail_threads.gmail_account_id
        and public.can_access_mail_member(ga.team_member_id)
    )
  );

drop policy if exists "Mail readers see messages" on public.mail_messages;
create policy "Mail readers see messages"
  on public.mail_messages for select to authenticated
  using (
    exists (
      select 1 from public.gmail_accounts ga
      where ga.id = mail_messages.gmail_account_id
        and public.can_access_mail_member(ga.team_member_id)
    )
  );
