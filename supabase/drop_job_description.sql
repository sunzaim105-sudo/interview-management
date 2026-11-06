-- Remove jobs.job_description from schema
alter table public.jobs
  drop column if exists job_description;
