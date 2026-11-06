-- Structured job posting metadata captured from job links
alter table public.jobs
  add column if not exists workplace_location text not null default '',
  add column if not exists work_setup text not null default '',
  add column if not exists salary text not null default '',
  add column if not exists required_level text not null default '',
  add column if not exists required_experience text not null default '';
