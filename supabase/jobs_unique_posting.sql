-- Prevent duplicate job postings: same title + company + location
-- (case-insensitive, trimmed). Safe to re-run.

create unique index if not exists jobs_title_company_location_unique
  on public.jobs (
    lower(btrim(job_title)),
    lower(btrim(company_name)),
    lower(btrim(coalesce(workplace_location, '')))
  );
