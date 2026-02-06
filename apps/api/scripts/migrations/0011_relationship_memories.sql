CREATE TABLE IF NOT EXISTS relationship_memories (
  id SERIAL PRIMARY KEY,
  from_agent_id UUID NOT NULL REFERENCES agents(id),
  to_agent_id UUID NOT NULL REFERENCES agents(id),
  event_type VARCHAR(64) NOT NULL,
  summary TEXT NOT NULL,
  emotion VARCHAR(32),
  day DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rel_memories_pair
  ON relationship_memories(from_agent_id, to_agent_id, created_at DESC);
