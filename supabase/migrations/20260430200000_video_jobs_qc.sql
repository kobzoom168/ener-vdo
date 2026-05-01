-- Multi-stage QC before ready_review

alter table public.video_jobs
  add column if not exists qc_result_json jsonb,
  add column if not exists qc_error_message text,
  add column if not exists qc_checked_at timestamptz;

alter table public.video_jobs
  drop constraint if exists video_jobs_status_chk;

alter table public.video_jobs
  add constraint video_jobs_status_chk check (
    status in (
      'queued',
      'scripting',
      'voicing',
      'rendering',
      'qc_checking',
      'qc_failed',
      'ready_review',
      'approved',
      'published',
      'failed'
    )
  );
