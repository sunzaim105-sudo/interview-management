-- Fix self-serve signup → public.users profile creation.
-- Safe to re-run in the Supabase SQL Editor.

-- Ensure role/status checks allow signup defaults
alter table public.users drop constraint if exists users_user_role_check;
alter table public.users
  add constraint users_user_role_check
  check (user_role in ('admin', 'caller', 'team_member'));

alter table public.users drop constraint if exists users_status_check;
alter table public.users
  add constraint users_status_check
  check (status in ('pending', 'allowed', 'suspended', 'blocked'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_user_id text;
  v_role text;
begin
  v_username := nullif(trim(coalesce(new.raw_user_meta_data->>'username', '')), '');
  if v_username is null then
    v_username := split_part(coalesce(new.email, new.id::text), '@', 1);
  end if;

  v_user_id := nullif(trim(coalesce(new.raw_user_meta_data->>'user_id', '')), '');
  if v_user_id is null then
    v_user_id := new.id::text;
  end if;

  v_role := lower(coalesce(new.raw_user_meta_data->>'user_role', 'caller'));
  if v_role not in ('caller', 'team_member') then
    -- Never allow self-serve signup to create admins via metadata
    v_role := 'caller';
  end if;

  insert into public.users (id, username, user_id, user_role, email, status)
  values (
    new.id,
    v_username,
    v_user_id,
    v_role,
    lower(coalesce(new.email, '')),
    'pending'
  )
  on conflict (id) do update
    set
      username = excluded.username,
      user_id = excluded.user_id,
      email = excluded.email,
      -- Keep existing role/status on conflict (admin may have already approved)
      updated_at = now();

  return new;
exception
  when unique_violation then
    -- If username/user_id/email collides with another row, still keep auth user
    -- and best-effort insert by id only when missing.
    insert into public.users (id, username, user_id, user_role, email, status)
    values (
      new.id,
      v_username,
      new.id::text,
      'caller',
      lower(coalesce(new.email, new.id::text || '@users.local')),
      'pending'
    )
    on conflict (id) do nothing;
    return new;
  when others then
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any auth users missing a public.users row
insert into public.users (id, username, user_id, user_role, email, status)
select
  au.id,
  coalesce(
    nullif(trim(au.raw_user_meta_data->>'username'), ''),
    split_part(coalesce(au.email, au.id::text), '@', 1)
  ),
  coalesce(
    nullif(trim(au.raw_user_meta_data->>'user_id'), ''),
    au.id::text
  ),
  case
    when lower(coalesce(au.raw_user_meta_data->>'user_role', 'caller'))
      in ('caller', 'team_member')
      then lower(coalesce(au.raw_user_meta_data->>'user_role', 'caller'))
    else 'caller'
  end,
  lower(coalesce(au.email, au.id::text || '@users.local')),
  'pending'
from auth.users au
left join public.users pu on pu.id = au.id
where pu.id is null
on conflict (id) do nothing;
