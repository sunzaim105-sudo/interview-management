-- Remove teammembers.linkedin and teammembers.university
alter table public.teammembers
  drop column if exists linkedin,
  drop column if exists university;
