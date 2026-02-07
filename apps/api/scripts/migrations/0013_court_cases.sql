CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS court_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number VARCHAR(50),
  title VARCHAR(200) NOT NULL,
  category VARCHAR(30) NOT NULL,
  difficulty SMALLINT DEFAULT 2,
  summary TEXT NOT NULL,
  facts JSONB NOT NULL,
  statute TEXT,
  actual_verdict TEXT,
  actual_reasoning TEXT,
  learning_points JSONB,
  source_url VARCHAR(500),
  anonymized BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_court_cases_category ON court_cases(category);
CREATE INDEX IF NOT EXISTS idx_court_cases_difficulty ON court_cases(difficulty);
