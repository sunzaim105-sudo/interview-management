-- Enforce: stage / result / video_path changes only after end_time
-- (except clearing video_path for admin cleanup). Safe to re-run.

create or replace function public.enforce_interview_result_after_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Allow clearing a video path (admin delete / cleanup).
  if
    new.video_path is distinct from old.video_path
    and coalesce(new.video_path, '') = ''
    and new.stage is not distinct from old.stage
    and new.result is not distinct from old.result
  then
    return new;
  end if;

  if
    new.stage is distinct from old.stage
    or new.result is distinct from old.result
    or new.video_path is distinct from old.video_path
  then
    if old.end_time is null or old.end_time > now() then
      raise exception
        'Interview results can only be added after the interview session has concluded';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists interviews_result_after_end on public.interviews;
create trigger interviews_result_after_end
  before update on public.interviews
  for each row execute function public.enforce_interview_result_after_end();
