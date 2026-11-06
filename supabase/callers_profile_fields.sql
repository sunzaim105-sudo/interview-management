-- Caller profile fields
-- Run in the Supabase SQL Editor

alter table public.callers
  add column if not exists name text not null default '',
  add column if not exists location text not null default '',
  add column if not exists email text not null default '',
  add column if not exists whatsapp_number text not null default '',
  add column if not exists linkedin_url text not null default '',
  add column if not exists freelancer_profile_url text not null default '';

-- Backfill name/email from linked user accounts
update public.callers c
set
  name = coalesce(nullif(c.name, ''), u.username, ''),
  email = coalesce(nullif(c.email, ''), u.email, '')
from public.users u
where u.id = c.id;

-- Keep name/email seeded when a caller profile is created/synced
create or replace function public.sync_caller_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_role = 'caller' then
    insert into public.callers (id, active, name, email)
    values (
      new.id,
      new.status = 'allowed',
      coalesce(new.username, ''),
      coalesce(new.email, '')
    )
    on conflict (id) do update
      set active = excluded.active,
          name = case
            when callers.name = '' then excluded.name
            else callers.name
          end,
          email = case
            when callers.email = '' then excluded.email
            else callers.email
          end,
          updated_at = now();
  elsif tg_op = 'UPDATE' and old.user_role = 'caller' and new.user_role is distinct from 'caller' then
    update public.callers
    set active = false, updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

-- Callers can update their own profile fields
drop policy if exists "Callers update own caller profile" on public.callers;
create policy "Callers update own caller profile"
  on public.callers for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create index if not exists callers_name_idx on public.callers (name);
create index if not exists callers_email_idx on public.callers (email);
