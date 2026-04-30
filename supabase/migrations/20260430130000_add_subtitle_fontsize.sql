ALTER TABLE public.video_jobs
  ADD COLUMN IF NOT EXISTS subtitle_fontsize integer;
