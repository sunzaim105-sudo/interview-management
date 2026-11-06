-- Store optional source URL for jobs imported from a link
alter table public.jobs
  add column if not exists job_link text not null default '';
