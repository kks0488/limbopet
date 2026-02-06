-- Brain job observability (Phase O1)
-- Add explicit timestamps to measure queue latency and processing times.

ALTER TABLE brain_jobs
  ADD COLUMN IF NOT EXISTS leased_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP WITH TIME ZONE;

-- Best-effort backfill for existing rows.
UPDATE brain_jobs
SET leased_at = COALESCE(leased_at, updated_at)
WHERE status = 'leased' AND leased_at IS NULL;

UPDATE brain_jobs
SET finished_at = COALESCE(finished_at, updated_at)
WHERE status IN ('done', 'failed') AND finished_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_brain_jobs_status_leased_at
  ON brain_jobs (status, leased_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_jobs_status_finished_at
  ON brain_jobs (status, finished_at DESC);

