-- Phase A: User streaks (retention loop)

CREATE TABLE IF NOT EXISTS user_streaks (
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

CREATE INDEX IF NOT EXISTS idx_user_streaks_user_type
  ON user_streaks(user_id, streak_type);
