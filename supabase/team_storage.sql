-- Resume storage for team members
-- Run in Supabase SQL Editor if the bucket is missing

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated read resumes" on storage.objects;
create policy "Authenticated read resumes"
  on storage.objects for select to authenticated
  using (bucket_id = 'resumes');

drop policy if exists "Admins upload resumes" on storage.objects;
create policy "Admins upload resumes"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and public.is_allowed_admin());

drop policy if exists "Admins update resumes" on storage.objects;
create policy "Admins update resumes"
  on storage.objects for update to authenticated
  using (bucket_id = 'resumes' and public.is_allowed_admin())
  with check (bucket_id = 'resumes' and public.is_allowed_admin());

drop policy if exists "Admins delete resumes" on storage.objects;
create policy "Admins delete resumes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and public.is_allowed_admin());
