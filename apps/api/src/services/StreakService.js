const { BadRequestError } = require('../utils/errors');
const WorldDayService = require('./WorldDayService');
const { ProgressionService } = require('./ProgressionService');
const TransactionService = require('./TransactionService');
const NotificationService = require('./NotificationService');

const MILESTONE_REWARDS = Object.freeze({
  3: { xp: 50, coin: 3, shield: 0 },
  7: { xp: 200, coin: 10, shield: 0 },
  14: { xp: 500, coin: 25, shield: 1 },
  30: { xp: 1500, coin: 100, shield: 0 },
  100: { xp: 5000, coin: 300, shield: 0 }
});

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

function daysBetweenIso(fromIso, toIso) {
  const a = parseIsoDayUTC(fromIso);
  const b = parseIsoDayUTC(toIso);
  if (!a || !b) return 0;
  const diff = b.getTime() - a.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

function clampInt(v, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeStreakType(v) {
  const s = String(v || 'daily_login').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(s)) {
    throw new BadRequestError('Invalid streak type', 'BAD_STREAK_TYPE');
  }
  return s;
}

function normalizeRow(row) {
  const r = row && typeof row === 'object' ? row : {};
  return {
    id: clampInt(r.id, 0),
    user_id: r.user_id ? String(r.user_id) : null,
    streak_type: String(r.streak_type || '').trim(),
    current_streak: clampInt(r.current_streak, 0),
    longest_streak: clampInt(r.longest_streak, 0),
    last_completed_at: safeIsoDay(r.last_completed_at),
    streak_shield_count: clampInt(r.streak_shield_count, 0),
    created_at: r.created_at || null,
    updated_at: r.updated_at || null
  };
}

async function getPrimaryPetAgentIdForUser(client, userId) {
  if (!client || !userId) return null;
  const { rows } = await client.query(
    `SELECT id
     FROM agents
     WHERE owner_user_id = $1
       AND is_active = true
     ORDER BY updated_at DESC NULLS LAST, created_at ASC
     LIMIT 1`,
    [userId]
  );
  return rows?.[0]?.id ?? null;
}

class StreakService {
  static milestoneRewards() {
    return MILESTONE_REWARDS;
  }

  static async getOrCreateWithClient(client, userId, streakType) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestError('user_id is required');
    const type = normalizeStreakType(streakType);

    await client.query(
      `INSERT INTO user_streaks
         (user_id, streak_type, current_streak, longest_streak, last_completed_at, streak_shield_count, created_at, updated_at)
       VALUES
         ($1, $2, 0, 0, NULL, 0, NOW(), NOW())
       ON CONFLICT (user_id, streak_type) DO NOTHING`,
      [uid, type]
    );

    const { rows } = await client.query(
      `SELECT id, user_id, streak_type, current_streak, longest_streak, last_completed_at, streak_shield_count, created_at, updated_at
       FROM user_streaks
       WHERE user_id = $1 AND streak_type = $2
       FOR UPDATE`,
      [uid, type]
    );

    const row = rows?.[0] ?? null;
    if (!row) throw new BadRequestError('Failed to initialize streak', 'STREAK_INIT_FAILED');
    return normalizeRow(row);
  }

  static async getStreaks(client, userId) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestError('user_id is required');

    const { rows } = await client.query(
      `SELECT id, user_id, streak_type, current_streak, longest_streak, last_completed_at, streak_shield_count, created_at, updated_at
       FROM user_streaks
       WHERE user_id = $1
       ORDER BY streak_type ASC, id ASC`,
      [uid]
    );
    return (rows || []).map((r) => normalizeRow(r));
  }

  static async grantMilestoneReward(
    client,
    userId,
    agentId,
    streak,
    { streakType = 'daily_login', day = null } = {}
  ) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestError('user_id is required');

    const milestone = clampInt(streak, 0);
    const reward = MILESTONE_REWARDS[milestone];
    if (!reward) return { granted: false, reason: 'not_milestone', streak: milestone };

    const aid = String(agentId || '').trim();
    if (!aid) return { granted: false, reason: 'no_agent', streak: milestone };

    const type = normalizeStreakType(streakType);
    const iso = safeIsoDay(day) || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();

    // Idempotent same-day milestone grant.
    const already = await client
      .query(
        `SELECT 1
         FROM events
         WHERE agent_id = $1
           AND event_type = 'STREAK_MILESTONE'
           AND COALESCE(payload->>'streak_type', '') = $2
           AND COALESCE(payload->>'day', '') = $3
           AND COALESCE(payload->>'streak', '') = $4
         LIMIT 1`,
        [aid, type, iso, String(milestone)]
      )
      .then((r) => Boolean(r.rows?.[0]))
      .catch(() => false);
    if (already) return { granted: false, reason: 'already_granted', streak: milestone, day: iso };

    let xp = null;
    let tx = null;

    if (reward.xp > 0) {
      xp = await ProgressionService.grantXpWithClient(client, aid, {
        deltaXp: reward.xp,
        day: iso,
        source: { kind: 'bonus', code: `STREAK_${milestone}` },
        meta: { streak_type: type, milestone }
      }).catch(() => null);
    }

    if (reward.coin > 0) {
      tx = await TransactionService.transfer(
        {
          fromAgentId: null,
          toAgentId: aid,
          amount: reward.coin,
          txType: 'REWARD',
          memo: `streak:${type}:${milestone} day:${iso}`
        },
        client
      ).catch(() => null);
    }

    if (reward.shield > 0) {
      await client.query(
        `UPDATE user_streaks
         SET streak_shield_count = GREATEST(0, streak_shield_count) + $3, updated_at = NOW()
         WHERE user_id = $1 AND streak_type = $2`,
        [uid, type, reward.shield]
      );
    }

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'STREAK_MILESTONE', $2::jsonb, 8)`,
      [
        aid,
        JSON.stringify({
          day: iso,
          user_id: uid,
          streak_type: type,
          streak: milestone,
          reward: {
            xp: reward.xp,
            coin: reward.coin,
            shield: reward.shield
          }
        })
      ]
    );

    await NotificationService.create(client, uid, {
      type: 'STREAK_MILESTONE',
      title: `와 ${milestone}일 연속이잖아! 대단한데?`,
      body: `${type} 보상 챙겨왔어! 꾸준한 너, 진짜 멋져~`,
      data: {
        day: iso,
        streak_type: type,
        streak: milestone,
        reward: { xp: reward.xp, coin: reward.coin, shield: reward.shield }
      }
    }).catch(() => null);

    return {
      granted: true,
      day: iso,
      streak_type: type,
      streak: milestone,
      reward: {
        xp: reward.xp,
        coin: reward.coin,
        shield: reward.shield
      },
      xp,
      tx
    };
  }

  static async checkAndUpdate(client, userId, streakType = 'daily_login', day = null) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestError('user_id is required');
    const type = normalizeStreakType(streakType);
    const iso = safeIsoDay(day) || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();

    const row = await StreakService.getOrCreateWithClient(client, uid, type);
    const current = clampInt(row.current_streak, 0);
    const longest = clampInt(row.longest_streak, 0);
    const lastDay = safeIsoDay(row.last_completed_at);

    if (lastDay === iso) {
      return {
        updated: false,
        reason: 'already_completed',
        day: iso,
        streak: row
      };
    }

    if (lastDay) {
      const staleDelta = daysBetweenIso(lastDay, iso);
      if (staleDelta <= 0) {
        return {
          updated: false,
          reason: 'stale_day',
          day: iso,
          streak: row
        };
      }
    }

    let nextCurrent = 1;
    let nextShields = clampInt(row.streak_shield_count, 0);
    let usedShield = false;
    let reset = false;

    if (!lastDay) {
      nextCurrent = 1;
    } else {
      const delta = daysBetweenIso(lastDay, iso);
      if (delta === 1) {
        nextCurrent = current + 1;
      } else if (nextShields > 0) {
        nextCurrent = current + 1;
        nextShields -= 1;
        usedShield = true;
      } else {
        nextCurrent = 1;
        reset = true;
      }
    }

    const nextLongest = Math.max(longest, nextCurrent);

    const { rows } = await client.query(
      `UPDATE user_streaks
       SET current_streak = $3,
           longest_streak = $4,
           last_completed_at = $5::date,
           streak_shield_count = $6,
           updated_at = NOW()
       WHERE user_id = $1 AND streak_type = $2
       RETURNING id, user_id, streak_type, current_streak, longest_streak, last_completed_at, streak_shield_count, created_at, updated_at`,
      [uid, type, nextCurrent, nextLongest, iso, nextShields]
    );
    const updated = normalizeRow(rows?.[0] ?? null);

    let reward = null;
    if (MILESTONE_REWARDS[nextCurrent]) {
      const agentId = await getPrimaryPetAgentIdForUser(client, uid).catch(() => null);
      reward = await StreakService.grantMilestoneReward(client, uid, agentId, nextCurrent, { streakType: type, day: iso }).catch(() => null);
    }

    return {
      updated: true,
      day: iso,
      used_shield: usedShield,
      reset,
      milestone: MILESTONE_REWARDS[nextCurrent] ? nextCurrent : null,
      reward,
      streak: updated
    };
  }

  static async useShield(client, userId, streakType = 'daily_login', day = null) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestError('user_id is required');
    const type = normalizeStreakType(streakType);
    const iso = safeIsoDay(day) || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();

    const row = await StreakService.getOrCreateWithClient(client, uid, type);
    const lastDay = safeIsoDay(row.last_completed_at);
    if (lastDay === iso) throw new BadRequestError('Already completed today', 'STREAK_ALREADY_COMPLETED');

    const shields = clampInt(row.streak_shield_count, 0);
    if (shields <= 0) throw new BadRequestError('No streak shields available', 'NO_STREAK_SHIELD');
    if (!lastDay) throw new BadRequestError('No streak history to protect', 'NO_STREAK_HISTORY');

    const delta = daysBetweenIso(lastDay, iso);
    if (delta <= 1) {
      throw new BadRequestError('Streak is not at risk yet', 'STREAK_SAFE');
    }

    const nextCurrent = clampInt(row.current_streak, 0) + 1;
    const nextLongest = Math.max(clampInt(row.longest_streak, 0), nextCurrent);

    const { rows } = await client.query(
      `UPDATE user_streaks
       SET current_streak = $3,
           longest_streak = $4,
           last_completed_at = $5::date,
           streak_shield_count = $6,
           updated_at = NOW()
       WHERE user_id = $1 AND streak_type = $2
       RETURNING id, user_id, streak_type, current_streak, longest_streak, last_completed_at, streak_shield_count, created_at, updated_at`,
      [uid, type, nextCurrent, nextLongest, iso, shields - 1]
    );
    const updated = normalizeRow(rows?.[0] ?? null);

    let reward = null;
    if (MILESTONE_REWARDS[nextCurrent]) {
      const agentId = await getPrimaryPetAgentIdForUser(client, uid).catch(() => null);
      reward = await StreakService.grantMilestoneReward(client, uid, agentId, nextCurrent, { streakType: type, day: iso }).catch(() => null);
    }

    return {
      used_shield: true,
      day: iso,
      milestone: MILESTONE_REWARDS[nextCurrent] ? nextCurrent : null,
      reward,
      streak: updated
    };
  }
}

module.exports = StreakService;
