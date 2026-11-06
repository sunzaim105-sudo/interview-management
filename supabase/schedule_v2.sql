-- Schedule v2: jobs, teammembers, rebuilt interviews

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_title text not null,
  company_name text not null,
  job_link text not null default '',
  workplace_location text not null default '',
  work_setup text not null default '',
  salary text not null default '',
  required_level text not null default '',
  required_experience text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teammembers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  professional_title text not null default '',
  email text not null unique,
  phone_number text not null default '',
  location text not null default '',
  resume_file text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rebuild interviews with new schema
drop table if exists public.interviews cascade;

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  interview_name text not null,
  caller_id uuid not null references public.users (id) on delete restrict,
  invited_member_id uuid not null references public.teammembers (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete restrict,
  meeting_link text not null default '',
  booking_note text not null default '',
  stage text not null default 'Initial Recruiter Screening'
    check (
      stage in (
        'Initial Recruiter Screening',
        'Hiring Manager Interview',
        'Technical Assessment / Coding Interview',
        'Behavioral / Team Interview',
        'Final Decision and Job Offer',
        'Onboarding'
      )
    ),
  result text check (result is null or result in ('pass', 'fail')),
  start_time timestamptz not null,
  end_time timestamptz not null,
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interviews_time_check check (end_time > start_time)
);

create index if not exists interviews_start_time_idx on public.interviews (start_time);
create index if not exists interviews_caller_id_idx on public.interviews (caller_id);
create index if not exists interviews_invited_member_id_idx on public.interviews (invited_member_id);
create index if not exists interviews_job_id_idx on public.interviews (job_id);

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

drop trigger if exists teammembers_set_updated_at on public.teammembers;
create trigger teammembers_set_updated_at
  before update on public.teammembers
  for each row execute function public.set_updated_at();

drop trigger if exists interviews_set_updated_at on public.interviews;
create trigger interviews_set_updated_at
  before update on public.interviews
  for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;
alter table public.teammembers enable row level security;
alter table public.interviews enable row level security;

drop policy if exists "Authenticated read jobs" on public.jobs;
create policy "Authenticated read jobs"
  on public.jobs for select to authenticated using (true);

drop policy if exists "Admins manage jobs" on public.jobs;
create policy "Admins manage jobs"
  on public.jobs for all to authenticated
  using (public.is_allowed_admin())
  with check (public.is_allowed_admin());

drop policy if exists "Authenticated read teammembers" on public.teammembers;
create policy "Authenticated read teammembers"
  on public.teammembers for select to authenticated using (true);

drop policy if exists "Admins manage teammembers" on public.teammembers;
create policy "Admins manage teammembers"
  on public.teammembers for all to authenticated
  using (public.is_allowed_admin())
  with check (public.is_allowed_admin());

drop policy if exists "Admins manage interviews" on public.interviews;
create policy "Admins manage interviews"
  on public.interviews for all to authenticated
  using (public.is_allowed_admin())
  with check (public.is_allowed_admin());

drop policy if exists "Callers read own interviews" on public.interviews;
create policy "Callers read own interviews"
  on public.interviews for select to authenticated
  using (caller_id = auth.uid());

-- Seed sample jobs / teammembers for testing
insert into public.jobs (job_title, company_name, job_link)
select * from (values
  ('Frontend Engineer', 'Cal ID', 'https://example.com/jobs/frontend'),
  ('Backend Engineer', 'Cal ID', 'https://example.com/jobs/backend'),
  ('Talent Partner', 'Northwind Hiring', 'https://example.com/jobs/talent-partner')
) as v(job_title, company_name, job_link)
where not exists (select 1 from public.jobs limit 1);

insert into public.teammembers (
  name, professional_title, email, phone_number, location, resume_file
)
select * from (values
  ('Alex Rivera', 'Senior Engineer', 'alex.rivera@calid.dev', '+1-555-0101', 'New York, USA', ''),
  ('Sarah Lin', 'Hiring Manager', 'sarah.lin@calid.dev', '+1-555-0102', 'Manila, PH', ''),
  ('Jordan Lee', 'Staff Engineer', 'jordan.lee@calid.dev', '+1-555-0103', 'Toronto, CA', '')
) as v(name, professional_title, email, phone_number, location, resume_file)
where not exists (select 1 from public.teammembers limit 1);
