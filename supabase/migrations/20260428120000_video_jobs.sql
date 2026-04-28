-- Video generation pipeline (isolated from scan workers).
-- Assumes public.scan_results_v2 exists for optional auto-trigger.

create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid,
  source_metadata jsonb,
  script_text text,
  voice_url text,
  video_url text,
  subtitle_url text,
  status text not null default 'queued',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_jobs_source_type_chk check (source_type in ('scan_result', 'temple_footage')),
  constraint video_jobs_status_chk check (
    status in (
      'queued',
      'scripting',
      'voicing',
      'rendering',
      'ready_review',
      'approved',
      'published',
      'failed'
    )
  )
);

create index if not exists video_jobs_status_created_idx
  on public.video_jobs (status, created_at);

create or replace function public.set_video_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_video_jobs_updated_at on public.video_jobs;
create trigger trg_video_jobs_updated_at
  before update on public.video_jobs
  for each row
  execute function public.set_video_jobs_updated_at();

-- Claim helpers (single-statement row locks via CTE + UPDATE)
create or replace function public.claim_next_video_job_script()
returns setof public.video_jobs
language sql
as $$
  with cte as (
    select id
    from public.video_jobs
    where status = 'queued'
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.video_jobs v
  set status = 'scripting'
  from cte
  where v.id = cte.id
  returning v.*;
$$;

create or replace function public.claim_next_video_job_voice()
returns setof public.video_jobs
language sql
as $$
  with cte as (
    select id
    from public.video_jobs
    where status = 'voicing'
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.video_jobs v
  set updated_at = now()
  from cte
  where v.id = cte.id
  returning v.*;
$$;

create or replace function public.claim_next_video_job_render()
returns setof public.video_jobs
language sql
as $$
  with cte as (
    select id
    from public.video_jobs
    where status = 'rendering'
      and voice_url is not null
      and subtitle_url is not null
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.video_jobs v
  set updated_at = now()
  from cte
  where v.id = cte.id
  returning v.*;
$$;

-- Optional auto-trigger after scan_results_v2 insert (toggle via settings row).
create table if not exists public.video_pipeline_settings (
  key text primary key,
  value boolean not null default false
);

insert into public.video_pipeline_settings (key, value)
values ('auto_video_job_on_scan_result', false)
on conflict (key) do nothing;

create or replace function public.enqueue_video_job_from_scan_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.video_pipeline_settings s
    where s.key = 'auto_video_job_on_scan_result'
      and s.value = true
  ) then
    insert into public.video_jobs (source_type, source_id, status)
    values ('scan_result', new.id, 'queued');
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.scan_results_v2') is not null then
    if not exists (
      select 1
      from pg_trigger
      where tgname = 'trg_scan_results_v2_enqueue_video_job'
    ) then
      create trigger trg_scan_results_v2_enqueue_video_job
        after insert on public.scan_results_v2
        for each row
        execute function public.enqueue_video_job_from_scan_result();
    end if;
  end if;
end $$;

-- Storage bucket for rendered assets (service role uploads; signed URLs for preview).
insert into storage.buckets (id, name, public)
values ('video-assets', 'video-assets', false)
on conflict (id) do nothing;

grant execute on function public.claim_next_video_job_script() to service_role;
grant execute on function public.claim_next_video_job_voice() to service_role;
grant execute on function public.claim_next_video_job_render() to service_role;
