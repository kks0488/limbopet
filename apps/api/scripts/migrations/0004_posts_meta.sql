-- Posts metadata (plaza board + arena recap references)

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Fast filters (optional but handy)
CREATE INDEX IF NOT EXISTS idx_posts_meta_kind
  ON posts ((meta->>'kind'));

-- Idempotency for "system-generated" reference posts (e.g., arena recap per match).
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_unique_ref
  ON posts ((meta->>'ref_type'), (meta->>'ref_id'))
  WHERE (meta->>'ref_type') IS NOT NULL AND (meta->>'ref_id') IS NOT NULL;

