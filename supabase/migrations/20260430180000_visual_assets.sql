create table if not exists public.visual_assets (
  id uuid primary key default gen_random_uuid(),
  video_job_id uuid references public.video_jobs (id) on delete cascade,
  content_session_id uuid,
  asset_type text not null check (
    asset_type in (
      'opening_card',
      'transition_card',
      'explainer_card',
      'cta_card',
      'product_support',
      'motion_background'
    )
  ),
  prompt_text text not null,
  storage_bucket text,
  storage_path text,
  asset_url text,
  status text not null default 'queued' check (
    status in (
      'queued',
      'generating',
      'ready',
      'failed',
      'rejected',
      'used'
    )
  ),
  generation_provider text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists visual_assets_video_job_id_idx on public.visual_assets (video_job_id);
create index if not exists visual_assets_content_session_id_idx on public.visual_assets (content_session_id);
create index if not exists visual_assets_status_idx on public.visual_assets (status);

create or replace function public.set_visual_assets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_visual_assets_updated_at on public.visual_assets;
create trigger trg_visual_assets_updated_at
  before update on public.visual_assets
  for each row
  execute function public.set_visual_assets_updated_at();

create table if not exists public.video_job_visual_assets (
  id uuid primary key default gen_random_uuid(),
  video_job_id uuid not null references public.video_jobs (id) on delete cascade,
  visual_asset_id uuid not null references public.visual_assets (id) on delete cascade,
  insert_position text not null check (
    insert_position in ('intro', 'middle', 'before_cta', 'outro')
  ),
  duration_sec numeric not null default 3,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists video_job_visual_assets_video_job_id_idx
  on public.video_job_visual_assets (video_job_id);
create index if not exists video_job_visual_assets_visual_asset_id_idx
  on public.video_job_visual_assets (visual_asset_id);
