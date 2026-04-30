alter table public.video_jobs
  add column if not exists footage_clip_id uuid;

create index if not exists video_jobs_footage_clip_id_idx
  on public.video_jobs(footage_clip_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'video_jobs_footage_clip_id_fkey'
  ) then
    alter table public.video_jobs
      add constraint video_jobs_footage_clip_id_fkey
      foreign key (footage_clip_id)
      references public.footage_clips(id)
      on delete set null;
  end if;
end $$;
