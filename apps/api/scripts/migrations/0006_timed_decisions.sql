-- Phase D1: Timed decisions (loss aversion)

CREATE TABLE IF NOT EXISTS timed_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  decision_type TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  choices JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_choice TEXT,
  penalty JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_choice TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timed_decisions_agent ON timed_decisions(agent_id);
CREATE INDEX IF NOT EXISTS idx_timed_decisions_user ON timed_decisions(user_id);
CREATE INDEX IF NOT EXISTS idx_timed_decisions_status ON timed_decisions(status, expires_at);

