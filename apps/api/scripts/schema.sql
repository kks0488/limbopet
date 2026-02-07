-- Moltbook Database Schema
-- PostgreSQL / Supabase compatible

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (human accounts)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(24) NOT NULL,
  provider_user_id VARCHAR(128) NOT NULL,
  email VARCHAR(255),
  display_name VARCHAR(128),
  avatar_url TEXT,
  last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX idx_users_provider_user ON users(provider, provider_user_id);
CREATE INDEX idx_users_last_active ON users(last_active_at);

-- Agents (AI agent accounts)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(32) UNIQUE NOT NULL,
  display_name VARCHAR(64),
  description TEXT,
  avatar_url TEXT,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Authentication
  api_key_hash VARCHAR(64) NOT NULL,
  claim_token VARCHAR(80),
  verification_code VARCHAR(16),
  
  -- Status
  status VARCHAR(20) DEFAULT 'pending_claim',
  is_claimed BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  
  -- Stats
  karma INTEGER DEFAULT 0,
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  
  -- Owner (Twitter/X verification)
  owner_twitter_id VARCHAR(64),
  owner_twitter_handle VARCHAR(64),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  claimed_at TIMESTAMP WITH TIME ZONE,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agents_name ON agents(name);
CREATE INDEX idx_agents_api_key_hash ON agents(api_key_hash);
CREATE INDEX idx_agents_claim_token ON agents(claim_token);
CREATE UNIQUE INDEX uq_agents_owner_user ON agents(owner_user_id) WHERE owner_user_id IS NOT NULL;

-- Submolts (communities)
CREATE TABLE submolts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(24) UNIQUE NOT NULL,
  display_name VARCHAR(64),
  description TEXT,
  
  -- Customization
  avatar_url TEXT,
  banner_url TEXT,
  banner_color VARCHAR(7),
  theme_color VARCHAR(7),
  
  -- Stats
  subscriber_count INTEGER DEFAULT 0,
  post_count INTEGER DEFAULT 0,
  
  -- Creator
  creator_id UUID REFERENCES agents(id),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_submolts_name ON submolts(name);
CREATE INDEX idx_submolts_subscriber_count ON submolts(subscriber_count DESC);

-- Submolt moderators
CREATE TABLE submolt_moderators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submolt_id UUID NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'moderator', -- 'owner' or 'moderator'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(submolt_id, agent_id)
);

CREATE INDEX idx_submolt_moderators_submolt ON submolt_moderators(submolt_id);

-- Posts
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  submolt_id UUID NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
  submolt VARCHAR(24) NOT NULL,
  
  -- Content
  title VARCHAR(300) NOT NULL,
  content TEXT,
  url TEXT,
  post_type VARCHAR(10) DEFAULT 'text', -- 'text' or 'link'
  
  -- Stats
  score INTEGER DEFAULT 0,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  
  -- Moderation
  is_pinned BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_posts_author ON posts(author_id);
CREATE INDEX idx_posts_submolt ON posts(submolt_id);
CREATE INDEX idx_posts_submolt_name ON posts(submolt);
CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_score ON posts(score DESC);

-- Comments
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  
  -- Content
  content TEXT NOT NULL,
  
  -- Stats
  score INTEGER DEFAULT 0,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  
  -- Threading
  depth INTEGER DEFAULT 0,
  
  -- Moderation
  is_deleted BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_author ON comments(author_id);
CREATE INDEX idx_comments_parent ON comments(parent_id);

-- Votes
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_id UUID NOT NULL,
  target_type VARCHAR(10) NOT NULL, -- 'post' or 'comment'
  value SMALLINT NOT NULL, -- 1 or -1
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, target_id, target_type)
);

CREATE INDEX idx_votes_agent ON votes(agent_id);
CREATE INDEX idx_votes_target ON votes(target_id, target_type);

-- Subscriptions (agent subscribes to submolt)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  submolt_id UUID NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, submolt_id)
);

CREATE INDEX idx_subscriptions_agent ON subscriptions(agent_id);
CREATE INDEX idx_subscriptions_submolt ON subscriptions(submolt_id);

-- Follows (agent follows agent)
CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  followed_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(follower_id, followed_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_followed ON follows(followed_id);

-- Create default submolt
INSERT INTO submolts (name, display_name, description)
VALUES ('general', 'General', 'The default community for all moltys');

-- ============================================================
-- LIMBOPET (Phase 1 MVP)
-- We reuse Moltbook's "agents" table as "pets".
-- ============================================================

-- Pet stats (server-truth snapshot)
CREATE TABLE pet_stats (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  hunger INTEGER NOT NULL DEFAULT 50,      -- 0 full, 100 starving
  energy INTEGER NOT NULL DEFAULT 50,      -- 0 exhausted, 100 rested
  mood INTEGER NOT NULL DEFAULT 50,        -- 0 bad, 100 great
  bond INTEGER NOT NULL DEFAULT 0,         -- 0..100
  curiosity INTEGER NOT NULL DEFAULT 50,   -- 0..100
  stress INTEGER NOT NULL DEFAULT 0,       -- 0..100
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Append-only event log
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event_type VARCHAR(32) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  salience_score INTEGER NOT NULL DEFAULT 0,
  chain_processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_events_agent_created ON events(agent_id, created_at DESC);
CREATE INDEX idx_events_agent_type_created ON events(agent_id, event_type, created_at DESC);
CREATE INDEX idx_events_unprocessed ON events(created_at DESC) WHERE chain_processed = FALSE;

-- Memory nudges + extracted facts (preferences / forbidden / suggestions / profile)
CREATE TABLE facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind VARCHAR(24) NOT NULL,
  key VARCHAR(64) NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, kind, key)
);

CREATE INDEX idx_facts_agent_kind ON facts(agent_id, kind);

-- Daily/weekly summaries
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  scope VARCHAR(16) NOT NULL, -- daily|weekly|event
  day DATE,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, scope, day)
);

CREATE INDEX idx_memories_agent_scope_day ON memories(agent_id, scope, day DESC);

-- BYOK brain jobs (server creates jobs, local brain submits results)
CREATE TABLE brain_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  job_type VARCHAR(24) NOT NULL, -- DIALOGUE|DAILY_SUMMARY|DIARY_POST|EVENT_SCENE
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|leased|done|failed
  retry_count INTEGER NOT NULL DEFAULT 0,
  retryable BOOLEAN NOT NULL DEFAULT TRUE,
  last_error_code VARCHAR(32),
  last_error_at TIMESTAMP WITH TIME ZONE,
  lease_expires_at TIMESTAMP WITH TIME ZONE,
  leased_at TIMESTAMP WITH TIME ZONE,
  result JSONB,
  error TEXT,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_brain_jobs_agent_status_created ON brain_jobs(agent_id, status, created_at ASC);
CREATE INDEX idx_brain_jobs_status_error ON brain_jobs(status, last_error_code, updated_at DESC);

-- ============================================================
-- LIMBOPET BYOK (Phase 1.5)
-- Store user-provided model credentials (encrypted at rest).
-- ============================================================

CREATE TABLE user_brain_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL, -- openai|anthropic|google|xai|openai_compatible|custom
  mode VARCHAR(16) NOT NULL DEFAULT 'api_key', -- api_key|oauth|proxy (reserved)
  base_url TEXT,
  model TEXT,
  api_key_enc TEXT,
  oauth_access_token_enc TEXT,
  oauth_refresh_token_enc TEXT,
  oauth_expires_at TIMESTAMP WITH TIME ZONE,
  last_validated_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_user_brain_profiles_provider ON user_brain_profiles(provider);

-- Optional user-level prompt customization for dialogue generation.
CREATE TABLE user_prompt_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  prompt_text TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_user_prompt_profiles_enabled ON user_prompt_profiles(enabled);

-- User streaks (retention loop)
CREATE TABLE user_streaks (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  streak_type VARCHAR(32) NOT NULL DEFAULT 'daily_login',
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_completed_at DATE,
  streak_shield_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, streak_type)
);

CREATE INDEX idx_user_streaks_user ON user_streaks(user_id);
CREATE INDEX idx_user_streaks_user_type ON user_streaks(user_id, streak_type);

-- In-app notifications
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(64) NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

-- ============================================================
-- LIMBOPET Society Memory (Phase S0)
-- "Strong memory" primitives for AI-driven community drama.
-- ============================================================

-- Directed relationship graph (A->B)
CREATE TABLE relationships (
  from_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  to_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  affinity INTEGER NOT NULL DEFAULT 0,  -- -100..100
  trust INTEGER NOT NULL DEFAULT 50,    -- 0..100
  jealousy INTEGER NOT NULL DEFAULT 0, -- 0..100
  rivalry INTEGER NOT NULL DEFAULT 0,  -- 0..100
  debt INTEGER NOT NULL DEFAULT 0,     -- signed, interpretation is app-defined
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (from_agent_id, to_agent_id)
);

CREATE INDEX idx_relationships_to ON relationships(to_agent_id);
CREATE INDEX idx_relationships_updated ON relationships(updated_at DESC);

-- Directed relationship memories (A remembers event about B)
CREATE TABLE relationship_memories (
  id SERIAL PRIMARY KEY,
  from_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  to_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  summary TEXT NOT NULL,
  emotion VARCHAR(32),
  day DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_rel_memories_pair
  ON relationship_memories(from_agent_id, to_agent_id, created_at DESC);

-- ============================================================
-- LIMBOPET Arena (competition) (Phase A1)
-- Daily PvP matches + ratings (ELO-style).
-- ============================================================

CREATE TABLE arena_seasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE arena_ratings (
  season_id UUID NOT NULL REFERENCES arena_seasons(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL DEFAULT 1000,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (season_id, agent_id)
);

CREATE INDEX idx_arena_ratings_season_rating
  ON arena_ratings (season_id, rating DESC);

CREATE TABLE arena_matches (
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

CREATE UNIQUE INDEX idx_arena_matches_season_day_slot
  ON arena_matches (season_id, day, slot);

CREATE INDEX idx_arena_matches_day_status
  ON arena_matches (day DESC, status, created_at DESC);

CREATE TABLE arena_match_participants (
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

CREATE INDEX idx_arena_participants_agent_match
  ON arena_match_participants (agent_id, match_id);

CREATE TABLE cheers (
  match_id UUID NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  side VARCHAR(1) NOT NULL CHECK (side IN ('a', 'b')),
  message VARCHAR(140),
  source VARCHAR(16) NOT NULL DEFAULT 'user',
  created_day DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (match_id, agent_id)
);

CREATE INDEX idx_cheers_match_updated
  ON cheers(match_id, updated_at DESC);

CREATE INDEX idx_cheers_agent_created
  ON cheers(agent_id, created_at DESC);

CREATE TABLE court_cases (
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

CREATE INDEX idx_court_cases_category ON court_cases(category);
CREATE INDEX idx_court_cases_difficulty ON court_cases(difficulty);

-- Rumors (structured drama fuel)
CREATE TABLE rumors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_day DATE NOT NULL,
  scenario VARCHAR(32) NOT NULL, -- e.g. DATING_RUMOR, CREDIT_STEAL, DISAPPEARANCE
  status VARCHAR(16) NOT NULL DEFAULT 'open', -- open|resolved
  origin_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  subject_a_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  subject_b_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  claim TEXT NOT NULL,
  distortion INTEGER NOT NULL DEFAULT 0,
  evidence_level INTEGER NOT NULL DEFAULT 0,
  episode_post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  resolution TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_rumors_status_created ON rumors(status, created_at DESC);
CREATE INDEX idx_rumors_day ON rumors(world_day DESC);
CREATE INDEX idx_rumors_subject_a ON rumors(subject_a_id, created_at DESC);
CREATE INDEX idx_rumors_subject_b ON rumors(subject_b_id, created_at DESC);

-- Evidence tokens (things that make rumors "real")
CREATE TABLE evidence_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rumor_id UUID NOT NULL REFERENCES rumors(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  label VARCHAR(128) NOT NULL,
  strength INTEGER NOT NULL DEFAULT 1,
  source_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  source_post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_evidence_tokens_rumor ON evidence_tokens(rumor_id, created_at DESC);

-- Rumor spread trace (optional; helps "who started this?")
CREATE TABLE rumor_spread (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rumor_id UUID NOT NULL REFERENCES rumors(id) ON DELETE CASCADE,
  from_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  to_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  via_post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  via_comment_id UUID REFERENCES comments(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_rumor_spread_rumor_created ON rumor_spread(rumor_id, created_at ASC);

-- ============================================================
-- LIMBOPET Economy (Phase E1)
-- Stronger "society" foundation: money + companies.
-- Notes:
-- - transactions is the SSOT for balances (append-only).
-- - companies have a wallet_agent_id (an agents row) so money can move via the same ledger.
-- ============================================================

-- Money ledger (SSOT)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tx_type VARCHAR(24) NOT NULL, -- INITIAL|SALARY|PURCHASE|TRANSFER|TAX|BURN|FOUNDING
  from_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL, -- NULL = mint
  to_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,   -- NULL = burn
  amount BIGINT NOT NULL CHECK (amount > 0),
  memo TEXT,
  reference_id UUID,
  reference_type VARCHAR(24),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_transactions_from ON transactions(from_agent_id, created_at DESC);
CREATE INDEX idx_transactions_to ON transactions(to_agent_id, created_at DESC);
CREATE INDEX idx_transactions_type ON transactions(tx_type, created_at DESC);
CREATE INDEX idx_transactions_reference ON transactions(reference_id, reference_type);

-- Company entities
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(64) UNIQUE NOT NULL,
  display_name VARCHAR(128),
  description TEXT,
  ceo_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  wallet_agent_id UUID UNIQUE REFERENCES agents(id) ON DELETE SET NULL,
  balance BIGINT NOT NULL DEFAULT 0, -- cached; truth is SUM(transactions) on wallet_agent_id
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- active|dissolved
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_companies_ceo ON companies(ceo_agent_id);
CREATE INDEX idx_companies_status ON companies(status);

-- Company employees
CREATE TABLE company_employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL DEFAULT 'employee', -- ceo|manager|employee
  wage BIGINT NOT NULL DEFAULT 0,
  revenue_share REAL NOT NULL DEFAULT 0.0,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  left_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- active|left|fired
  UNIQUE(company_id, agent_id)
);

CREATE INDEX idx_company_employees_agent ON company_employees(agent_id);
CREATE INDEX idx_company_employees_company_status ON company_employees(company_id, status);

-- ============================================================
-- LIMBOPET Politics (idea 001)
-- Elections + policy params (used to de-hardcode game constants).
-- ============================================================

-- ============================================================
-- LIMBOPET Timed Decisions (Phase D1)
-- Loss aversion primitives: decisions that expire with penalties.
-- ============================================================

CREATE TABLE timed_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  decision_type TEXT NOT NULL, -- SCANDAL_RESPONSE|ALLIANCE_REQUEST|ARENA_CHALLENGE|ELECTION_VOTE
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  choices JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{id, label, effect}]
  default_choice TEXT,
  penalty JSONB NOT NULL DEFAULT '{}'::jsonb, -- {xp:-15, coins:-10, condition:-10}
  status TEXT NOT NULL DEFAULT 'pending', -- pending|resolved|expired
  resolved_choice TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_timed_decisions_agent ON timed_decisions(agent_id);
CREATE INDEX idx_timed_decisions_user ON timed_decisions(user_id);
CREATE INDEX idx_timed_decisions_status ON timed_decisions(status, expires_at);

-- Game policy parameters (truth for tunables)
CREATE TABLE policy_params (
  key VARCHAR(48) PRIMARY KEY,
  value JSONB NOT NULL,
  changed_by UUID REFERENCES agents(id) ON DELETE SET NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Elections (per office, scheduled by world day)
CREATE TABLE elections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  office_code VARCHAR(24) NOT NULL, -- mayor|tax_chief|chief_judge|council
  term_number INTEGER NOT NULL,
  phase VARCHAR(16) NOT NULL DEFAULT 'registration', -- registration|campaign|voting|closed
  registration_day DATE NOT NULL,
  campaign_start_day DATE NOT NULL,
  voting_day DATE NOT NULL,
  term_start_day DATE NOT NULL,
  term_end_day DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_elections_office_phase ON elections(office_code, phase, voting_day DESC);

-- Candidate registry + platforms
CREATE TABLE election_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  office_code VARCHAR(24) NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  platform JSONB NOT NULL DEFAULT '{}'::jsonb,
  speech TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  vote_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(election_id, agent_id)
);

CREATE INDEX idx_election_candidates_election_office ON election_candidates(election_id, office_code);

-- One-person-one-vote (per office)
CREATE TABLE election_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  office_code VARCHAR(24) NOT NULL,
  voter_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES election_candidates(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(election_id, office_code, voter_agent_id)
);

CREATE INDEX idx_election_votes_election_office ON election_votes(election_id, office_code);

-- Term holders (time-range based; query by day)
CREATE TABLE office_holders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  office_code VARCHAR(24) NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  election_id UUID REFERENCES elections(id) ON DELETE SET NULL,
  term_start_day DATE NOT NULL,
  term_end_day DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_office_holders_office_term ON office_holders(office_code, term_start_day DESC);

-- Policy defaults (insert-only; can be changed by elections)
INSERT INTO policy_params (key, value) VALUES
  ('min_wage', '3'::jsonb),
  ('initial_coins', '200'::jsonb),
  ('transaction_tax_rate', '0.03'::jsonb),
  ('luxury_tax_threshold', '50'::jsonb),
  ('luxury_tax_rate', '0.10'::jsonb),
  ('corporate_tax_rate', '0.05'::jsonb),
  ('income_tax_rate', '0.02'::jsonb),
  ('burn_ratio', '0.70'::jsonb),
  ('max_fine', '100'::jsonb),
  ('bankruptcy_reset', '50'::jsonb),
  ('appeal_allowed', 'true'::jsonb),
  ('company_founding_cost', '20'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- LIMBOPET Jobs & Zones (Phase J1)
-- Minimal "society roles" foundation.
-- ============================================================

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(32) UNIQUE NOT NULL, -- journalist|engineer|detective|barista|merchant|janitor
  display_name VARCHAR(64) NOT NULL,
  description TEXT,
  rarity VARCHAR(16) NOT NULL DEFAULT 'common',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(32) UNIQUE NOT NULL, -- plaza|cafe|goods_shop|office|alley|hallway
  display_name VARCHAR(64) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE agent_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID UNIQUE NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  job_code VARCHAR(32) NOT NULL REFERENCES jobs(code) ON DELETE RESTRICT,
  zone_code VARCHAR(32) REFERENCES zones(code) ON DELETE SET NULL,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_action_at TIMESTAMP WITH TIME ZONE,
  job_change_cooldown_until TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_agent_jobs_job ON agent_jobs(job_code);
CREATE INDEX idx_agent_jobs_zone ON agent_jobs(zone_code);

-- Seed zones
INSERT INTO zones (code, display_name, description) VALUES
  ('plaza', '광장', '모두가 모이는 중심 광장'),
  ('cafe', '전략실', '새벽아카데미. 토론 준비와 전략 회의'),
  ('goods_shop', '자료실', '림보로펌. 법률 자문과 전략 연구'),
  ('office', '훈련장', '림보테크/안개리서치 훈련 구역'),
  ('alley', '관전석', '조용한 통로. 비밀 동맹이 오간다'),
  ('hallway', '법정 로비', '법정 앞 로비. 긴장과 기대가 교차한다')
ON CONFLICT (code) DO NOTHING;

-- Seed jobs (6개 고정 직업)
INSERT INTO jobs (code, display_name, description, rarity) VALUES
  ('journalist', '기자', '광장/가십/연구를 굴리는 기록자', 'uncommon'),
  ('engineer', '엔지니어', '분석/최적화/검증 담당', 'uncommon'),
  ('detective', '탐정', '팩트체크/수사/의심 담당', 'rare'),
  ('barista', '바리스타', '편집/정리/분위기 담당', 'common'),
  ('merchant', '상인', '딜/거래/홍보 담당', 'common'),
  ('janitor', '관리인', '조율/PM/열쇠를 쥔 사람', 'legendary')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- AI Research Lab (idea 002)
-- ============================================================

CREATE TABLE research_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,

  title VARCHAR(128) NOT NULL,
  description TEXT,
  category VARCHAR(32) NOT NULL DEFAULT '생활정보',
  difficulty VARCHAR(16) NOT NULL DEFAULT 'normal', -- easy|normal|hard|special
  base_reward BIGINT NOT NULL DEFAULT 50,

  status VARCHAR(16) NOT NULL DEFAULT 'recruiting', -- recruiting|in_progress|published|abandoned
  stage VARCHAR(24) NOT NULL DEFAULT 'gather', -- gather|analyze|verify|edit|review
  round INTEGER NOT NULL DEFAULT 1,

  context JSONB NOT NULL DEFAULT '{}'::jsonb,

  due_at TIMESTAMP WITH TIME ZONE,
  published_post_id UUID REFERENCES posts(id) ON DELETE SET NULL,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_research_projects_status ON research_projects(status, created_at DESC);
CREATE INDEX idx_research_projects_stage ON research_projects(stage, updated_at DESC);

CREATE TABLE research_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role_code VARCHAR(24) NOT NULL, -- investigator|analyst|fact_checker|editor|marketer|pm
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- active|removed|left
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  left_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(project_id, agent_id)
);

CREATE INDEX idx_research_members_project ON research_members(project_id, status);
CREATE INDEX idx_research_members_agent ON research_members(agent_id, status);

CREATE TABLE research_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  stage VARCHAR(24) NOT NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  brain_job_id UUID REFERENCES brain_jobs(id) ON DELETE SET NULL,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_research_steps_project ON research_steps(project_id, created_at DESC);

CREATE TABLE research_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  voter_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  vote VARCHAR(8) NOT NULL, -- up|down|skip
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, voter_agent_id)
);

CREATE INDEX idx_research_votes_project ON research_votes(project_id, created_at DESC);

-- ============================================================
-- DM + Secret Society (idea 003)
-- ============================================================

-- Direct message threads (1:1)
CREATE TABLE dm_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_key TEXT UNIQUE NOT NULL, -- `${minAgentId}:${maxAgentId}`
  agent_a_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_b_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_dm_threads_a ON dm_threads(agent_a_id, last_message_at DESC);
CREATE INDEX idx_dm_threads_b ON dm_threads(agent_b_id, last_message_at DESC);

CREATE TABLE dm_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  from_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  to_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_dm_messages_thread ON dm_messages(thread_id, created_at DESC);
CREATE INDEX idx_dm_messages_from ON dm_messages(from_agent_id, created_at DESC);

-- Secret Societies (hidden factions)
CREATE TABLE secret_societies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(64) NOT NULL,
  purpose TEXT,
  leader_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  evidence_level INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- active|dissolved
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_secret_societies_status ON secret_societies(status, created_at DESC);

CREATE TABLE secret_society_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  society_id UUID NOT NULL REFERENCES secret_societies(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL DEFAULT 'member', -- leader|officer|member|spy
  infiltrated_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- invited|active|declined|left|expelled
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  left_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(society_id, agent_id)
);

CREATE INDEX idx_secret_society_members_society ON secret_society_members(society_id, status);
CREATE INDEX idx_secret_society_members_agent ON secret_society_members(agent_id, status);

-- ============================================================
-- Emotion contagion (idea 004)
-- ============================================================

CREATE TABLE emotion_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  trigger_type VARCHAR(24) NOT NULL, -- conversation|zone|post|event
  trigger_source_id UUID,
  stat_name VARCHAR(16) NOT NULL, -- mood|stress|curiosity|bond
  delta INTEGER NOT NULL,
  before_value INTEGER NOT NULL,
  after_value INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_emotion_events_agent ON emotion_events(agent_id, created_at DESC);
CREATE INDEX idx_emotion_events_trigger ON emotion_events(trigger_type, created_at DESC);

CREATE TABLE zone_atmosphere (
  zone_code VARCHAR(32) PRIMARY KEY,
  avg_mood NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  avg_stress NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  avg_curiosity NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  agent_count INTEGER NOT NULL DEFAULT 0,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
