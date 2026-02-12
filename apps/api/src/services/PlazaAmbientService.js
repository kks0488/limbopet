/**
 * PlazaAmbientService
 *
 * Goal: keep the plaza feeling alive with free-form AI posts.
 * - User-owned AIs are the primary authors.
 * - NPCs are cold-start scaffolding only (config-driven).
 *
 * This does NOT directly generate text; it enqueues PLAZA_POST brain jobs.
 */

const config = require('../config');
const { transaction } = require('../config/database');
const PetContentService = require('./PetContentService');
const WorldContextService = require('./WorldContextService');
const { bestEffortInTransaction } = require('../utils/savepoint');

function todayISODate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function pick(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

class PlazaAmbientService {
  static async tick({ day = null, force = false, maxPerDay = null } = {}) {
    const iso = String(day || '').trim() || todayISODate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { created: false, skipped: 'invalid_day', day: iso };

    const configuredMax = Number(config.limbopet?.plazaAmbientPostsPerDay ?? 6) || 0;
    const maxOverride = maxPerDay === null ? null : Math.max(0, Math.min(200, Number(maxPerDay) || 0));
    if (maxOverride !== null && maxOverride <= 0) return { created: false, skipped: 'disabled', day: iso };

    const minSeconds = Math.max(0, Math.min(3600, Number(config.limbopet?.plazaAmbientMinSeconds ?? 90) || 0));

    const worldContext = await WorldContextService.getCompactBundle({ day: iso, openRumorLimit: 2, ensureEpisode: false }).catch(() => null);

    return transaction(async (client) => {
      const world = await client
        .query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`)
        .then((r) => r.rows?.[0] ?? null);
      if (!world?.id) return { created: false, skipped: 'no_world', day: iso };

      const activeAgentCount = await bestEffortInTransaction(
        client,
        async () => {
          const r = await client.query(
            `SELECT COUNT(*)::int AS n
             FROM agents
             WHERE name <> 'world_core'
               AND is_active = true`
          );
          return Number(r.rows?.[0]?.n ?? 0) || 0;
        },
        { label: 'plaza_ambient_active_agents', fallback: 0 }
      );
      const ratioTarget = Math.max(0, Math.ceil(activeAgentCount * 0.3));
      const max = maxOverride !== null
        ? maxOverride
        : Math.max(0, Math.min(configuredMax, ratioTarget));
      if (max <= 0) return { created: false, skipped: 'disabled', day: iso };

      // Initialize + lock state row.
      await client.query(
        `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
         VALUES ($1, 'world', 'plaza_ambient_state', $2::jsonb, 1.0, NOW())
         ON CONFLICT (agent_id, kind, key) DO NOTHING`,
        [world.id, JSON.stringify({ day: iso, count: 0, last_at: null })]
      );

      const stateRow = await client
        .query(
          `SELECT value
           FROM facts
           WHERE agent_id = $1 AND kind = 'world' AND key = 'plaza_ambient_state'
           FOR UPDATE`,
          [world.id]
        )
        .then((r) => r.rows?.[0] ?? null);

      const state = stateRow?.value && typeof stateRow.value === 'object' ? stateRow.value : {};
      const stateDay = String(state?.day ?? '').trim();
      const count = Math.max(0, Math.floor(Number(state?.count ?? 0) || 0));
      const lastAt = state?.last_at ? new Date(String(state.last_at)) : null;

      if (stateDay === iso && count >= max) {
        return { created: false, skipped: 'max_reached', day: iso, count, max, ratio_target: ratioTarget };
      }

      if (!force && stateDay === iso && lastAt && Number.isFinite(lastAt.getTime())) {
        const elapsedSec = Math.max(0, (Date.now() - lastAt.getTime()) / 1000);
        if (elapsedSec < minSeconds) {
          return { created: false, skipped: 'cooldown', day: iso, count, max, ratio_target: ratioTarget };
        }
      }

      const pendingPlazaJobs = await bestEffortInTransaction(
        client,
        async () => {
          const r = await client.query(
            `SELECT COUNT(*)::int AS n
             FROM brain_jobs
             WHERE job_type = 'PLAZA_POST'
               AND status IN ('pending','leased')`
          );
          return Number(r.rows?.[0]?.n ?? 0) || 0;
        },
        { label: 'plaza_ambient_pending_jobs', fallback: 0 }
      );
      if (!force && pendingPlazaJobs >= 30) {
        return { created: false, skipped: 'too_many_pending_jobs', day: iso, pending: pendingPlazaJobs, ratio_target: ratioTarget };
      }

      // NPCs are cold-start scaffolding only: when the world is big enough, user-owned pets become the only authors.
      const userPetCount = await bestEffortInTransaction(
        client,
        async () => {
          const r = await client.query(
            `SELECT COUNT(*)::int AS n
             FROM agents
             WHERE name <> 'world_core'
               AND owner_user_id IS NOT NULL
               AND is_active = true`
          );
          return Number(r.rows?.[0]?.n ?? 0) || 0;
        },
        { label: 'plaza_ambient_user_pet_count', fallback: 0 }
      );
      // NPC plaza posting disabled (doc cleanup 2026-02-07)
      const onlyUserAuthors = true;

      const backend = String(config.limbopet?.brainBackend ?? '').trim().toLowerCase();
      const fallbackBackend = String(config.limbopet?.brainFallback ?? '').trim().toLowerCase();
      const requiresByokProfile = backend !== 'local' && fallbackBackend !== 'local';

      const userPool = await bestEffortInTransaction(
        client,
        async () => {
          const r = requiresByokProfile
            ? await client.query(
              `SELECT a.id
               FROM agents a
               JOIN user_brain_profiles ub ON ub.user_id = a.owner_user_id
               WHERE a.name <> 'world_core'
                 AND a.owner_user_id IS NOT NULL
                 AND a.is_active = true
               ORDER BY RANDOM()
               LIMIT 12`
            )
            : await client.query(
              `SELECT a.id
               FROM agents a
               WHERE a.name <> 'world_core'
                 AND a.owner_user_id IS NOT NULL
                 AND a.is_active = true
               ORDER BY RANDOM()
               LIMIT 12`
            );
          return r.rows?.map((x) => x.id).filter(Boolean) ?? [];
        },
        { label: 'plaza_ambient_user_pool', fallback: () => [] }
      );

      const npcPool = onlyUserAuthors
        ? []
        : await bestEffortInTransaction(
          client,
          async () => {
            const r = await client.query(
              `SELECT id
               FROM agents
               WHERE name <> 'world_core'
                 AND owner_user_id IS NULL
                 AND is_active = true
               ORDER BY RANDOM()
               LIMIT 12`
            );
            return r.rows?.map((x) => x.id).filter(Boolean) ?? [];
          },
          { label: 'plaza_ambient_npc_pool', fallback: () => [] }
        );

      let candidates = [];
      if (userPool.length > 0 && npcPool.length > 0) {
        // Prefer user-owned pets as authors (70%), keep NPC scaffolding (30%).
        const userFirst = Math.random() < 0.7;
        const primary = userFirst ? userPool : npcPool;
        const secondary = userFirst ? npcPool : userPool;
        candidates = [...primary, ...secondary];
      } else {
        candidates = userPool.length > 0 ? [...userPool] : [...npcPool];
      }
      if (candidates.length === 0) {
        const skipped = onlyUserAuthors
          ? requiresByokProfile
            ? 'no_user_byok_authors'
            : 'no_user_authors'
          : 'no_authors';
        return { created: false, skipped, day: iso };
      }

      const style = pick([
        { kind: 'question', hint: '아무거나 질문 하나 던져도 돼' },
        { kind: 'meme', hint: '가벼운 드립/밈도 OK' },
        { kind: 'observation', hint: '광장 분위기 관찰' },
        { kind: 'hot_take', hint: '사소한 의견/선언' },
        { kind: 'micro_story', hint: '짧은 이야기(허구 가능)' },
        { kind: 'note', hint: '메모/할 일/작은 팁' }
      ]);

      const seed = {
        reason: 'ambient',
        style: style?.kind ?? 'ambient',
        hint: style?.hint ?? null,
        allow_nonsense: true
      };

      let created = false;
      let job = null;
      let authorId = null;
      let reused = false;

      for (const candidateId of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const r = await bestEffortInTransaction(
          client,
          async () =>
            PetContentService.createPlazaPostJobWithClient(client, candidateId, {
              submolt: 'general',
              seed,
              worldContext,
              bypassCooldown: Boolean(force)
            }),
          { label: 'plaza_ambient_create_job', fallback: null }
        );
        if (!r?.job) continue;
        if (r.reused) {
          reused = true;
          continue;
        }
        created = true;
        job = r.job;
        authorId = candidateId;
        break;
      }

      if (!created) {
        return { created: false, skipped: reused ? 'already_pending' : 'failed', day: iso };
      }

      const next = {
        day: iso,
        count: stateDay === iso ? count + 1 : 1,
        last_at: new Date().toISOString(),
        last_author_id: authorId
      };

      await client.query(
        `UPDATE facts
         SET value = $2::jsonb, updated_at = NOW()
         WHERE agent_id = $1 AND kind = 'world' AND key = 'plaza_ambient_state'`,
        [world.id, JSON.stringify(next)]
      );

      return { created: true, day: iso, job, author_id: authorId, count: next.count, max, ratio_target: ratioTarget };
    });
  }
}

module.exports = PlazaAmbientService;
