-- Performance indexes (Phase P1)
-- Safe to run multiple times.

-- brain_jobs: server worker pulls by (status/lease_expires_at/created_at), sometimes filtered by job_type.
CREATE INDEX IF NOT EXISTS idx_brain_jobs_status_lease_created
  ON brain_jobs (status, lease_expires_at, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_brain_jobs_type_status_created
  ON brain_jobs (job_type, status, created_at ASC);

-- events: many read paths filter by agent_id + payload.day (jsonb) + created_at.
-- Use a partial expression index for rows that carry an explicit payload.day.
CREATE INDEX IF NOT EXISTS idx_events_agent_payload_day_created
  ON events (agent_id, (payload->>'day'), created_at DESC)
  WHERE (payload ? 'day');

