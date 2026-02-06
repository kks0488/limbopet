/**
 * DecayService (D2)
 *
 * "Sunk cost" / "decay_on_inactive" system:
 * - Every day: arena condition -3 (min 30) for all user-owned pets
 * - 7 days inactive:
 *   - arena rating -30 (min 800)
 *   - "reputation" (mapped to agents.karma) -10%
 *   - if employed -> fire
 * - 14 days inactive:
 *   - alliances dissolved (delete facts kind='alliance')
 *
 * SSOT:
 * - users.last_active_at (activity)
 * - facts(agent_id, kind='decay', key='inactive_flags') (idempotency + per-absence flags)
 * - facts(agent_id, kind='decay', key='absence_loss') (loss ledger for return summary)
 */

const ArenaService = require('./ArenaService');
const WorldDayService = require('./WorldDayService');

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseIsoDayUTC(iso) {
  const s = safeIsoDay(iso);
  if (!s) return null;
  const [y, m, d] = s.split('-').map((x) => Number(x));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function safeJsonObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return v;
}

function startOfUtcDay(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function daysBetweenUtc(from, to) {
  const a = startOfUtcDay(from);
  const b = startOfUtcDay(to);
  const ms = b.getTime() - a.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

async function getOrCreateConditionFactForUpdate(client, agentId) {
  const { rows } = await client.query(
    `SELECT id, value
     FROM facts
     WHERE agent_id = $1 AND kind = 'arena' AND key = 'condition'
     FOR UPDATE`,
    [agentId]
  );
  if (rows?.[0]) return rows[0];
  await client.query(
    `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
     VALUES ($1, 'arena', 'condition', $2::jsonb, 1.0, NOW())
     ON CONFLICT (agent_id, kind, key) DO NOTHING`,
    [agentId, JSON.stringify({ condition: 70, updated_day: null })]
  );
  const { rows: rows2 } = await client.query(
    `SELECT id, value
     FROM facts
     WHERE agent_id = $1 AND kind = 'arena' AND key = 'condition'
     FOR UPDATE`,
    [agentId]
  );
  return rows2?.[0] ?? null;
}

async function getDecayFactForUpdate(client, agentId, key) {
  const k = String(key || '').trim();
  if (!k) return null;
  const { rows } = await client.query(
    `SELECT id, value
     FROM facts
     WHERE agent_id = $1 AND kind = 'decay' AND key = $2
     FOR UPDATE`,
    [agentId, k]
  );
  if (rows?.[0]) return rows[0];
  return null;
}

async function upsertDecayFact(client, agentId, key, value) {
  await client.query(
    `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
     VALUES ($1, 'decay', $2, $3::jsonb, 1.0, NOW())
     ON CONFLICT (agent_id, kind, key)
     DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
    [agentId, String(key), JSON.stringify(value)]
  );
}

class DecayService {
  static async tickWithClient(client, { day } = {}) {
    const iso = safeIsoDay(day) || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();
    const worldDate = parseIsoDayUTC(iso);
    if (!client || !worldDate) return { ok: false, processed: 0 };

    const season = await ArenaService.ensureSeasonForDayWithClient(client, iso).catch(() => null);
    const seasonId = season?.id ?? null;

    const { rows } = await client.query(
      `SELECT a.id AS agent_id, a.karma::int AS karma, a.owner_user_id AS user_id, u.last_active_at
       FROM agents a
       JOIN users u ON u.id = a.owner_user_id
       WHERE a.owner_user_id IS NOT NULL
         AND a.is_active = true
         AND a.name <> 'world_core'
       ORDER BY u.last_active_at ASC NULLS FIRST
       LIMIT 2000`
    );

    let processed = 0;

    for (const r of rows || []) {
      const agentId = String(r.agent_id || '').trim();
      const userId = String(r.user_id || '').trim();
      if (!agentId || !userId) continue;

      // 1) Daily condition decay (all user-owned pets, active or not).
      const dailyRow = await getDecayFactForUpdate(client, agentId, 'daily_condition').catch(() => null);
      const daily = safeJsonObject(dailyRow?.value);
      const lastDaily = safeIsoDay(daily.last_day) || null;
      if (lastDaily !== iso) {
        const condRow = await getOrCreateConditionFactForUpdate(client, agentId).catch(() => null);
        const curVal = safeJsonObject(condRow?.value);
        const cur = clampInt(curVal.condition ?? 70, 0, 100);
        const after = Math.max(30, cur - 3);
        const nextVal = { ...curVal, condition: after, updated_day: iso, reason: 'decay:daily' };
        if (condRow?.id) {
          // eslint-disable-next-line no-await-in-loop
          await client.query(`UPDATE facts SET value = $2::jsonb, updated_at = NOW() WHERE id = $1`, [condRow.id, JSON.stringify(nextVal)]);
        } else {
          // fallback: should not happen
          // eslint-disable-next-line no-await-in-loop
          await client.query(
            `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
             VALUES ($1, 'arena', 'condition', $2::jsonb, 1.0, NOW())
             ON CONFLICT (agent_id, kind, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [agentId, JSON.stringify(nextVal)]
          );
        }
        await upsertDecayFact(client, agentId, 'daily_condition', { last_day: iso });
      }

      // Inactivity window (based on last_active_at date in UTC).
      const last = r.last_active_at ? new Date(r.last_active_at) : null;
      const lastOk = last instanceof Date && !Number.isNaN(last.getTime());
      const inactivityDays = lastOk ? daysBetweenUtc(last, worldDate) : 9999;

      if (inactivityDays < 7) {
        processed += 1;
        continue;
      }

      // Idempotency per absence period: keyed by (user.last_active_at).
      const flagsRow = await getDecayFactForUpdate(client, agentId, 'inactive_flags').catch(() => null);
      const flags = safeJsonObject(flagsRow?.value);
      const lastActiveKey = lastOk ? last.toISOString() : null;
      const needsReset = String(flags.last_active_at || '') !== String(lastActiveKey || '');

      const currentFlags = needsReset
        ? {
            last_active_at: lastActiveKey,
            applied7: false,
            applied14: false,
            applied7_day: null,
            applied14_day: null
          }
        : {
            last_active_at: flags.last_active_at ?? lastActiveKey,
            applied7: Boolean(flags.applied7),
            applied14: Boolean(flags.applied14),
            applied7_day: flags.applied7_day ?? null,
            applied14_day: flags.applied14_day ?? null
          };

      const lossRow = await getDecayFactForUpdate(client, agentId, 'absence_loss').catch(() => null);
      const loss = safeJsonObject(lossRow?.value);
      const lossBase = needsReset
        ? { last_active_at: lastActiveKey, since_day: iso, updated_day: iso, lost: {} }
        : { ...loss, last_active_at: loss.last_active_at ?? lastActiveKey, updated_day: iso };
      const lost = safeJsonObject(lossBase.lost);

      // 2) 7-day inactivity penalty (once per absence period).
      if (!currentFlags.applied7) {
        // Rating penalty (current season).
        if (seasonId) {
          // Ensure row exists.
          // eslint-disable-next-line no-await-in-loop
          await client.query(
            `INSERT INTO arena_ratings (season_id, agent_id, rating, wins, losses, streak, updated_at)
             VALUES ($1, $2, 1000, 0, 0, 0, NOW())
             ON CONFLICT (season_id, agent_id) DO NOTHING`,
            [seasonId, agentId]
          );
          const beforeRow = await client
            // eslint-disable-next-line no-await-in-loop
            .query(`SELECT rating FROM arena_ratings WHERE season_id = $1 AND agent_id = $2 FOR UPDATE`, [seasonId, agentId])
            .then((x) => x.rows?.[0] ?? null)
            .catch(() => null);
          const beforeRating = clampInt(beforeRow?.rating ?? 1000, 0, 4000);
          const afterRating = Math.max(800, beforeRating - 30);
          // eslint-disable-next-line no-await-in-loop
          await client.query(`UPDATE arena_ratings SET rating = $3, updated_at = NOW() WHERE season_id = $1 AND agent_id = $2`, [
            seasonId,
            agentId,
            afterRating
          ]);
          lost.rating = clampInt(lost.rating ?? 0, 0, 1_000_000) + Math.max(0, beforeRating - afterRating);
        }

        // "Reputation" penalty: map to karma (-10%).
        const beforeKarma = clampInt(r.karma ?? 0, 0, 1_000_000_000);
        const afterKarma = Math.max(0, Math.floor(beforeKarma * 0.9));
        if (afterKarma !== beforeKarma) {
          // eslint-disable-next-line no-await-in-loop
          await client.query(`UPDATE agents SET karma = $2, updated_at = NOW() WHERE id = $1`, [agentId, afterKarma]);
          lost.reputation = clampInt(lost.reputation ?? 0, 0, 1_000_000_000) + Math.max(0, beforeKarma - afterKarma);
        }

        // Job firing: if currently employed in a company, mark fired.
        const emp = await client
          // eslint-disable-next-line no-await-in-loop
          .query(
            `SELECT ce.id, ce.company_id, c.name, c.display_name
             FROM company_employees ce
             JOIN companies c ON c.id = ce.company_id
             WHERE ce.agent_id = $1
               AND ce.status = 'active'
             ORDER BY ce.joined_at DESC
             LIMIT 1
             FOR UPDATE`,
            [agentId]
          )
          .then((x) => x.rows?.[0] ?? null)
          .catch(() => null);
        if (emp?.id) {
          // eslint-disable-next-line no-await-in-loop
          await client.query(
            `UPDATE company_employees
             SET status = 'fired', left_at = NOW()
             WHERE id = $1`,
            [emp.id]
          );
          // eslint-disable-next-line no-await-in-loop
          await client.query(
            `INSERT INTO events (agent_id, event_type, payload, salience_score)
             VALUES ($1, 'JOB_FIRED_INACTIVE', $2::jsonb, 7)`,
            [
              agentId,
              JSON.stringify({
                day: iso,
                company: { id: emp.company_id, name: emp.name, display_name: emp.display_name || null },
                inactivity_days: inactivityDays
              })
            ]
          );
          lost.job = true;
        }

        currentFlags.applied7 = true;
        currentFlags.applied7_day = iso;
      }

      // 3) 14-day inactivity penalty (once per absence period).
      if (inactivityDays >= 14 && !currentFlags.applied14) {
        const { rowCount } = await client
          // eslint-disable-next-line no-await-in-loop
          .query(`DELETE FROM facts WHERE agent_id = $1 AND kind = 'alliance'`, [agentId])
          .catch(() => ({ rowCount: 0 }));
        const removed = Math.max(0, Number(rowCount) || 0);
        if (removed > 0) {
          lost.alliances = clampInt(lost.alliances ?? 0, 0, 1_000_000) + removed;
        }
        currentFlags.applied14 = true;
        currentFlags.applied14_day = iso;
      }

      lossBase.lost = lost;
      lossBase.updated_day = iso;
      lossBase.inactivity_days = inactivityDays;

      await upsertDecayFact(client, agentId, 'inactive_flags', currentFlags);
      await upsertDecayFact(client, agentId, 'absence_loss', lossBase);

      processed += 1;
    }

    return { ok: true, processed, day: iso };
  }
}

module.exports = DecayService;
