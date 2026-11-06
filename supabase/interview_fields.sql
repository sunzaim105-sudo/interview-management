-- Add meeting link + booking note to interviews
alter table public.interviews
  add column if not exists meeting_link text not null default '';

alter table public.interviews
  add column if not exists booking_note text not null default '';
