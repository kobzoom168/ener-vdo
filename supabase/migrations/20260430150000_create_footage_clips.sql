create table if not exists public.footage_clips (
  id uuid primary key default gen_random_uuid(),
  temple_name text,
  clip_type text not null check (
    clip_type in (
      'temple_exterior',
      'buddha_image',
      'incense',
      'walking',
      'market',
      'amulet_table',
      'generic_spiritual'
    )
  ),
  scene_label text,
  storage_bucket text not null,
  storage_path text not null,
  duration_sec numeric,
  width integer,
  height integer,
  fps numeric,
  has_audio boolean not null default false,
  ambient_audio_enabled boolean not null default true,
  status text not null default 'active' check (status in ('active', 'hidden', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists footage_clips_status_idx on public.footage_clips(status);
create index if not exists footage_clips_clip_type_idx on public.footage_clips(clip_type);
create index if not exists footage_clips_temple_name_idx on public.footage_clips(temple_name);

create or replace function public.set_footage_clips_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_footage_clips_updated_at on public.footage_clips;
create trigger trg_footage_clips_updated_at
  before update on public.footage_clips
  for each row
  execute function public.set_footage_clips_updated_at();
