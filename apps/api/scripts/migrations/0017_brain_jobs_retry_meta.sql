ALTER TABLE brain_jobs
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(32),
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_brain_jobs_status_error
  ON brain_jobs(status, last_error_code, updated_at DESC);
