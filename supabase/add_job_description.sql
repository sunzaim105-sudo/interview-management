-- Restore full imported job description text + embed hint from scrape headers.
-- Safe to re-run.

alter table public.jobs
  add column if not exists job_description text not null default '',
  add column if not exists can_embed boolean not null default false;

create index if not exists jobs_job_link_idx
  on public.jobs (job_link)
  where job_link <> '';
