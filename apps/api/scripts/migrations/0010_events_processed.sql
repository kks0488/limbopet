-- Cross-system chain reaction processing flag

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS chain_processed BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_events_unprocessed
  ON events(created_at DESC)
  WHERE chain_processed = FALSE;
