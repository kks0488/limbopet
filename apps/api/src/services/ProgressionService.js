/**
 * ProgressionService
 *
 * Lightweight pet progression (LLM-free fun loop):
 * - XP + level + skill_points are stored in `pet_stats` (server truth).
 * - XP grants are rate-limited per day via a facts row (agent_id, kind='xp', key=`day:${YYYY-MM-DD}`).
 * - XP grants and level ups are recorded in `events` for UI evidence.
 */

const crypto = require('crypto');
const { BadRequestError } = require('../utils/errors');
const WorldDayService = require('./WorldDayService');

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function nextLevelXp(level) {
  const lv = Math.max(1, clampInt(level, 1, 1000));
  // Decision-complete curve:
  // L1->2: 100, then +75 per level step.
  return 100 + (lv - 1) * 75;
}

function applyXp({ level, xp, skill_points }, deltaXp) {
  const delta = Math.max(0, Math.trunc(Number(deltaXp) || 0));
  let lv = Math.max(1, Math.trunc(Number(level) || 1));
  let x = Math.max(0, Math.trunc(Number(xp) || 0));
  let sp = Math.max(0, Math.trunc(Number(skill_points) || 0));

  const before = { level: lv, xp: x, skill_points: sp };

  x += delta;
  let leveledUp = 0;
  for (let guard = 0; guard < 50; guard += 1) {
    const need = nextLevelXp(lv);
    if (x < need) break;
    x -= need;
    lv += 1;
    sp += 1;
    leveledUp += 1;
  }

  return {
    before,
    after: { level: lv, xp: x, skill_points: sp },
    leveledUp
  };
}

function applyXpSigned({ level, xp, skill_points }, deltaXp) {
  const delta = Math.trunc(Number(deltaXp) || 0);
  let lv = Math.max(1, Math.trunc(Number(level) || 1));
  let x = Math.max(0, Math.trunc(Number(xp) || 0));
  let sp = Math.max(0, Math.trunc(Number(skill_points) || 0));

  const before = { level: lv, xp: x, skill_points: sp };

  if (delta === 0) {
    return { before, after: before, leveledUp: 0, leveledDown: 0 };
  }

  x += delta;
  let leveledUp = 0;
  let leveledDown = 0;

  if (delta > 0) {
    for (let guard = 0; guard < 50; guard += 1) {
      const need = nextLevelXp(lv);
      if (x < need) break;
      x -= need;
      lv += 1;
      sp += 1;
      leveledUp += 1;
    }
  } else {
    for (let guard = 0; guard < 50; guard += 1) {
      if (x >= 0) break;
      if (lv <= 1) {
        x = 0;
        break;
      }
      lv -= 1;
      sp = Math.max(0, sp - 1);
      leveledDown += 1;
      // Borrow XP from the previous level step.
      x += nextLevelXp(lv);
    }
    x = Math.max(0, x);
  }

  return {
    before,
    after: { level: lv, xp: x, skill_points: sp },
    leveledUp,
    leveledDown
  };
}

function hashSeed(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function normalizeXpLedgerValue(v) {
  const obj = v && typeof v === 'object' ? v : {};
  const actions = obj.actions && typeof obj.actions === 'object' ? obj.actions : {};
  const missions = obj.missions && typeof obj.missions === 'object' ? obj.missions : {};
  const total = Math.max(0, Math.trunc(Number(obj.total ?? 0) || 0));
  return {
    day: safeIsoDay(obj.day) || null,
    actions: {
      feed: Math.max(0, Math.trunc(Number(actions.feed ?? 0) || 0)),
      play: Math.max(0, Math.trunc(Number(actions.play ?? 0) || 0)),
      sleep: Math.max(0, Math.trunc(Number(actions.sleep ?? 0) || 0)),
      talk: Math.max(0, Math.trunc(Number(actions.talk ?? 0) || 0))
    },
    missions,
    total
  };
}

function actionGrantCap(action) {
  const a = String(action || '').trim().toLowerCase();
  if (a === 'talk') return 3;
  if (a === 'feed') return 3;
  if (a === 'play') return 3;
  if (a === 'sleep') return 3;
  return 0;
}

class ProgressionService {
  static nextLevelXp(level) {
    return nextLevelXp(level);
  }

  static applyXpSnapshot(snapshot, deltaXp) {
    return applyXp(snapshot, deltaXp);
  }

  static applyXpSnapshotSigned(snapshot, deltaXp) {
    return applyXpSigned(snapshot, deltaXp);
  }

  static async getOrCreateXpLedgerRowForUpdate(client, agentId, day) {
    const iso = safeIsoDay(day);
    if (!iso) return null;
    const key = `day:${iso}`;
    const { rows } = await client.query(
      `SELECT id, value
       FROM facts
       WHERE agent_id = $1 AND kind = 'xp' AND key = $2
       FOR UPDATE`,
      [agentId, key]
    );
    if (rows?.[0]) return rows[0];

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'xp', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key) DO NOTHING`,
      [agentId, key, JSON.stringify({ day: iso, actions: {}, missions: {}, total: 0 })]
    );

    const { rows: rows2 } = await client.query(
      `SELECT id, value
       FROM facts
       WHERE agent_id = $1 AND kind = 'xp' AND key = $2
       FOR UPDATE`,
      [agentId, key]
    );
    return rows2?.[0] ?? null;
  }

  static async grantXpWithClient(
    client,
    agentId,
    {
      deltaXp,
      day = null,
      source = null, // { kind:'action'|'mission'|'bonus', code? }
      meta = null
    } = {}
  ) {
    if (!client) throw new Error('client is required');
    if (!agentId) throw new BadRequestError('agent_id is required');

    const iso = safeIsoDay(day) || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();
    const delta = clampInt(deltaXp, 0, 500);
    if (delta <= 0) return { granted: false, reason: 'zero', delta: 0 };

    const src = source && typeof source === 'object' ? source : {};
    const srcKind = String(src.kind || '').trim() || 'other';
    const srcCode = String(src.code || src.action || '').trim();

    // Rate-limit XP grants for action sources.
    if (srcKind === 'action') {
      const cap = actionGrantCap(srcCode);
      if (cap > 0) {
        const row = await ProgressionService.getOrCreateXpLedgerRowForUpdate(client, agentId, iso);
        const ledger = normalizeXpLedgerValue(row?.value);
        const currentCount = Math.max(0, Math.trunc(Number(ledger.actions?.[srcCode] ?? 0) || 0));
        if (currentCount >= cap) {
          return { granted: false, reason: 'cap', delta: 0, day: iso, cap, count: currentCount };
        }
        ledger.actions[srcCode] = currentCount + 1;
        ledger.total = Math.max(0, ledger.total + delta);
        ledger.day = iso;
        await client.query(
          `UPDATE facts
           SET value = $2::jsonb, confidence = 1.0, updated_at = NOW()
           WHERE id = $1`,
          [row.id, JSON.stringify(ledger)]
        );
      }
    }

    // Lock progression row.
    const { rows: statRows } = await client.query(
      `SELECT xp, level, skill_points
       FROM pet_stats
       WHERE agent_id = $1
       FOR UPDATE`,
      [agentId]
    );
    const cur = statRows?.[0];
    if (!cur) throw new BadRequestError('PetStats not found');

    const snapshot = {
      level: Math.max(1, Math.trunc(Number(cur.level) || 1)),
      xp: Math.max(0, Math.trunc(Number(cur.xp) || 0)),
      skill_points: Math.max(0, Math.trunc(Number(cur.skill_points) || 0))
    };

    const applied = applyXp(snapshot, delta);
    const after = applied.after;

    await client.query(
      `UPDATE pet_stats
       SET xp = $2, level = $3, skill_points = $4, updated_at = NOW()
       WHERE agent_id = $1`,
      [agentId, after.xp, after.level, after.skill_points]
    );

    const payload = {
      day: iso,
      delta_xp: delta,
      source: { kind: srcKind, code: srcCode || null },
      meta: meta && typeof meta === 'object' ? meta : null,
      progression: {
        before: applied.before,
        after: applied.after,
        leveled_up: applied.leveledUp,
        next_level_xp: nextLevelXp(after.level)
      },
      id: hashSeed(`${agentId}:${iso}:${Date.now()}`).slice(0, 12)
    };

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'PET_XP_GAINED', $2::jsonb, $3)`,
      [agentId, JSON.stringify(payload), Math.min(10, Math.max(1, applied.leveledUp ? 6 : 2))]
    );

    if (applied.leveledUp > 0) {
      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'PET_LEVEL_UP', $2::jsonb, 8)`,
        [
          agentId,
          JSON.stringify({
            day: iso,
            from_level: applied.before.level,
            to_level: applied.after.level,
            gained_skill_points: applied.leveledUp
          })
        ]
      );
    }

    return { granted: true, day: iso, delta, before: applied.before, after: applied.after, leveledUp: applied.leveledUp };
  }

  static async adjustXpWithClient(
    client,
    agentId,
    {
      deltaXp,
      day = null,
      source = null, // { kind, code? }
      meta = null
    } = {}
  ) {
    if (!client) throw new Error('client is required');
    if (!agentId) throw new BadRequestError('agent_id is required');

    const iso = safeIsoDay(day) || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();
    const delta = clampInt(deltaXp, -500, 500);
    if (delta === 0) return { adjusted: false, reason: 'zero', delta: 0, day: iso };

    const src = source && typeof source === 'object' ? source : {};
    const srcKind = String(src.kind || '').trim() || 'other';
    const srcCode = String(src.code || src.action || '').trim();

    const { rows: statRows } = await client.query(
      `SELECT xp, level, skill_points
       FROM pet_stats
       WHERE agent_id = $1
       FOR UPDATE`,
      [agentId]
    );
    const cur = statRows?.[0];
    if (!cur) throw new BadRequestError('PetStats not found');

    const snapshot = {
      level: Math.max(1, Math.trunc(Number(cur.level) || 1)),
      xp: Math.max(0, Math.trunc(Number(cur.xp) || 0)),
      skill_points: Math.max(0, Math.trunc(Number(cur.skill_points) || 0))
    };

    const applied = applyXpSigned(snapshot, delta);
    const after = applied.after;

    await client.query(
      `UPDATE pet_stats
       SET xp = $2, level = $3, skill_points = $4, updated_at = NOW()
       WHERE agent_id = $1`,
      [agentId, after.xp, after.level, after.skill_points]
    );

    const payload = {
      day: iso,
      delta_xp: delta,
      source: { kind: srcKind, code: srcCode || null },
      meta: meta && typeof meta === 'object' ? meta : null,
      progression: {
        before: applied.before,
        after: applied.after,
        leveled_up: applied.leveledUp,
        leveled_down: applied.leveledDown,
        next_level_xp: nextLevelXp(after.level)
      },
      id: hashSeed(`${agentId}:${iso}:${Date.now()}:${delta}`).slice(0, 12)
    };

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [
        agentId,
        delta > 0 ? 'PET_XP_GAINED' : 'PET_XP_PENALTY',
        JSON.stringify(payload),
        Math.min(10, Math.max(1, applied.leveledUp || applied.leveledDown ? 6 : 2))
      ]
    );

    if (applied.leveledUp > 0) {
      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'PET_LEVEL_UP', $2::jsonb, 8)`,
        [
          agentId,
          JSON.stringify({
            day: iso,
            from_level: applied.before.level,
            to_level: applied.after.level,
            gained_skill_points: applied.leveledUp
          })
        ]
      );
    }
    if (applied.leveledDown > 0) {
      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'PET_LEVEL_DOWN', $2::jsonb, 8)`,
        [
          agentId,
          JSON.stringify({
            day: iso,
            from_level: applied.before.level,
            to_level: applied.after.level,
            lost_skill_points: applied.leveledDown
          })
        ]
      );
    }

    return {
      adjusted: true,
      day: iso,
      delta,
      before: applied.before,
      after: applied.after,
      leveledUp: applied.leveledUp,
      leveledDown: applied.leveledDown
    };
  }
}

module.exports = {
  nextLevelXp,
  applyXp,
  applyXpSigned,
  ProgressionService
};
