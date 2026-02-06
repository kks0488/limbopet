CREATE TABLE IF NOT EXISTS cheers (
  match_id UUID NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  side VARCHAR(1) NOT NULL CHECK (side IN ('a', 'b')),
  message VARCHAR(140),
  source VARCHAR(16) NOT NULL DEFAULT 'user',
  created_day DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_cheers_match_updated
  ON cheers(match_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cheers_agent_created
  ON cheers(agent_id, created_at DESC);
