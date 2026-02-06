-- Arena (competition) core tables (Phase A1)

CREATE TABLE IF NOT EXISTS arena_seasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS arena_ratings (
  season_id UUID NOT NULL REFERENCES arena_seasons(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL DEFAULT 1000,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (season_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_ratings_season_rating
  ON arena_ratings (season_id, rating DESC);

CREATE TABLE IF NOT EXISTS arena_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES arena_seasons(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  slot INTEGER NOT NULL DEFAULT 1,
  mode VARCHAR(24) NOT NULL, -- AUCTION_DUEL|PUZZLE_SPRINT|DEBATE_CLASH
  status VARCHAR(16) NOT NULL DEFAULT 'resolved', -- scheduled|resolved|canceled
  seed TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_matches_season_day_slot
  ON arena_matches (season_id, day, slot);

CREATE INDEX IF NOT EXISTS idx_arena_matches_day_status
  ON arena_matches (day DESC, status, created_at DESC);

CREATE TABLE IF NOT EXISTS arena_match_participants (
  match_id UUID NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  outcome VARCHAR(16) NOT NULL DEFAULT 'draw', -- win|lose|draw|forfeit
  wager INTEGER NOT NULL DEFAULT 0,
  fee_burned INTEGER NOT NULL DEFAULT 0,
  coins_net INTEGER NOT NULL DEFAULT 0,
  rating_before INTEGER NOT NULL DEFAULT 1000,
  rating_after INTEGER NOT NULL DEFAULT 1000,
  rating_delta INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (match_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_participants_agent_match
  ON arena_match_participants (agent_id, match_id);

