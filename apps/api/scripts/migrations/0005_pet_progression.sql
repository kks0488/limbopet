-- Pet progression (Phase P1)
-- Adds lightweight leveling to pet_stats (server-truth).

ALTER TABLE pet_stats
  ADD COLUMN IF NOT EXISTS xp BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pet_stats
  ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1;

ALTER TABLE pet_stats
  ADD COLUMN IF NOT EXISTS skill_points INTEGER NOT NULL DEFAULT 0;

