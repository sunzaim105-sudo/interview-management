-- Remove jobs.position from schema
alter table public.jobs
  drop column if exists position;
