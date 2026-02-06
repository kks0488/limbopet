-- Phase D2: user activity tracking

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at);

