/**
 * DailyMissionService
 *
 * "3 tiny missions" loop (LLM-free):
 * - Care: perform one care action today (feed/play/sleep)
 * - Social: upvote or comment once today
 * - Direction: submit one stage direction today (memory-nudges)
 *
 * Completion is stored as facts(kind='mission', key=`done:${day}:${code}`) for idempotency.
 * Evidence is also appended to events(event_type='MISSION_COMPLETED').
 */

const { BadRequestError } = require('../utils/errors');
const WorldDayService = require('./WorldDayService');
const TransactionService = require('./TransactionService');
const { ProgressionService } = require('./ProgressionService');
const StreakService = require('./StreakService');
const NotificationService = require('./NotificationService');
const EconomyTickService = require('./EconomyTickService');

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

const BASE_MISSIONS = [
  {
    code: 'CARE_1',
    title: '돌봄 1회',
    desc: '먹이/놀기/잠 중 하나를 해줘요.',
    reward_xp: 25,
    reward_coin: 1
  },
  {
    code: 'SOCIAL_1',
    title: '광장 참여',
    desc: '좋아요 1번 또는 댓글 1개를 남겨요.',
    reward_xp: 25,
    reward_coin: 1
  },
  {
    code: 'DIRECTION_1',
    title: '연출 한 줄',
    desc: '오늘의 중력(한 줄)을 남겨요.',
    reward_xp: 25,
    reward_coin: 1
  }
];

const EXTRA_MISSIONS = {
  SAVE_1: {
    code: 'SAVE_1',
    title: '절약 챌린지',
    desc: '오늘 소비를 0으로 유지해봐',
    reward_xp: 40,
    reward_coin: 3
  },
  INVEST_1: {
    code: 'INVEST_1',
    title: '투자 기회',
    desc: '아레나에 베팅 1회',
    reward_xp: 30,
    reward_coin: 2
  },
  VOTE_1: {
    code: 'VOTE_1',
    title: '시민의 의무',
    desc: '선거에서 투표해',
    reward_xp: 35,
    reward_coin: 2
  }
};

function cloneMission(m) {
  const row = m && typeof m === 'object' ? m : {};
  return {
    code: String(row.code || '').trim().toUpperCase(),
    title: String(row.title || '').trim(),
    desc: String(row.desc || '').trim(),
    reward_xp: Math.max(0, Math.trunc(Number(row.reward_xp) || 0)),
    reward_coin: Math.max(0, Math.trunc(Number(row.reward_coin) || 0))
  };
}

function calculateVariableReward(baseXp, baseCoin) {
  const roll = Math.random();
  // 10% 확률: 대박 (2~5배)
  if (roll < 0.10) {
    const multiplier = 2 + Math.floor(Math.random() * 4);
    return {
      xp: baseXp * multiplier,
      coin: baseCoin * multiplier,
      bonus: true,
      bonusMultiplier: multiplier,
      bonusMessage: `대박! ${multiplier}배 보너스!`
    };
  }
  // 20% 확률: 소박 (1.5배)
  if (roll < 0.30) {
    return {
      xp: Math.ceil(baseXp * 1.5),
      coin: Math.ceil(baseCoin * 1.5),
      bonus: true,
      bonusMultiplier: 1.5,
      bonusMessage: '운이 좋았어!'
    };
  }
  // 70% 확률: 기본
  return { xp: baseXp, coin: baseCoin, bonus: false, bonusMultiplier: 1, bonusMessage: null };
}

function missionFactKey(day, code) {
  return `done:${day}:${code}`;
}

function allClearKey(day) {
  return `allclear:${day}`;
}

async function hasFactWithClient(client, agentId, kind, key) {
  const { rows } = await client.query(
    `SELECT 1
     FROM facts
     WHERE agent_id = $1 AND kind = $2 AND key = $3
     LIMIT 1`,
    [agentId, kind, key]
  );
  return Boolean(rows?.[0]);
}

async function spentCoinsTodayWithClient(client, agentId, day) {
  const iso = safeIsoDay(day);
  if (!iso) return 0;
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS spent
     FROM transactions
     WHERE from_agent_id = $1
       AND created_at >= $2::date
       AND created_at < ($2::date + INTERVAL '1 day')`,
    [agentId, iso]
  );
  return Math.max(0, Number(rows?.[0]?.spent ?? 0) || 0);
}

async function dynamicMissionsWithClient(client, agentId, day) {
  void agentId;
  const iso = safeIsoDay(day) || WorldDayService.todayISODate();
  const list = BASE_MISSIONS.map((m) => cloneMission(m));

  const cycle = await EconomyTickService.getCycleStateWithClient(client, { day: iso }).catch(() => 'normal');
  if (cycle === 'recession') {
    list.push(cloneMission(EXTRA_MISSIONS.SAVE_1));
  } else if (cycle === 'boom') {
    list.push(cloneMission(EXTRA_MISSIONS.INVEST_1));
  }

  const election = await client
    .query(
      `SELECT 1
       FROM elections
       WHERE registration_day <= $1::date
         AND phase <> 'closed'
       LIMIT 1`,
      [iso]
    )
    .then((r) => r.rows?.[0] ?? null)
    .catch(() => null);
  if (election) {
    list.push(cloneMission(EXTRA_MISSIONS.VOTE_1));
  }

  return list.slice(0, 4);
}

class DailyMissionService {
  static list() {
    return BASE_MISSIONS.map((m) => cloneMission(m));
  }

  static async dynamicMissionsWithClient(client, agentId, day) {
    return dynamicMissionsWithClient(client, agentId, day);
  }

  static async getBundleWithClient(client, agentId, { day = null } = {}) {
    const iso = safeIsoDay(day) || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();
    const missions = await dynamicMissionsWithClient(client, agentId, iso);
    const keys = missions.map((m) => missionFactKey(iso, m.code));
    const { rows } = await client.query(
      `SELECT key
       FROM facts
       WHERE agent_id = $1 AND kind = 'mission' AND key = ANY($2::text[])
       LIMIT 10`,
      [agentId, keys]
    );
    const doneKeys = new Set((rows || []).map((r) => String(r?.key ?? '').trim()).filter(Boolean));
    const items = missions.map((m) => ({
      code: m.code,
      title: m.title,
      desc: m.desc,
      done: doneKeys.has(missionFactKey(iso, m.code)),
      reward: { xp: m.reward_xp, coin: m.reward_coin }
    }));

    const cleared = items.every((it) => Boolean(it.done));
    const allClearClaimed = await hasFactWithClient(client, agentId, 'mission', allClearKey(iso)).catch(() => false);

    return {
      day: iso,
      items,
      cleared,
      all_clear_claimed: allClearClaimed
    };
  }

  static async completeWithClient(
    client,
    agentId,
    {
      day = null,
      code,
      meta = null,
      rewardOverride = null,
      source = null
    } = {}
  ) {
    const iso = safeIsoDay(day) || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();
    const c = String(code || '').trim().toUpperCase();
    if (!c) throw new BadRequestError('mission code is required', 'BAD_MISSION');

    const missions = await dynamicMissionsWithClient(client, agentId, iso);
    const m = missions.find((x) => x.code === c) || null;
    if (!m) throw new BadRequestError('Unknown mission code', 'BAD_MISSION');

    if (c === 'SAVE_1') {
      const spent = await spentCoinsTodayWithClient(client, agentId, iso).catch(() => 0);
      if (spent > 0) {
        return { created: false, day: iso, code: c, reason: 'spending_detected', spent };
      }
    }

    const factKey = missionFactKey(iso, c);
    const nowIso = new Date().toISOString();

    const reward = rewardOverride && typeof rewardOverride === 'object'
      ? {
        xp: Math.max(0, Math.trunc(Number(rewardOverride.xp) || 0)),
        coin: Math.max(0, Math.trunc(Number(rewardOverride.coin) || 0)),
        bonus: false,
        bonusMultiplier: 1,
        bonusMessage: null
      }
      : calculateVariableReward(m.reward_xp, m.reward_coin);

    const { rows: inserted } = await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'mission', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key) DO NOTHING
       RETURNING id`,
      [agentId, factKey, JSON.stringify({ day: iso, code: c, completed_at: nowIso, meta: meta && typeof meta === 'object' ? meta : null })]
    );
    if (!inserted?.[0]?.id) {
      return { created: false, day: iso, code: c };
    }

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'MISSION_COMPLETED', $2::jsonb, 5)`,
      [
        agentId,
        JSON.stringify({
          day: iso,
          code: c,
          title: m.title,
          reward,
          source: source ? String(source).slice(0, 32) : null
        })
      ]
    );

    // Reward: XP + coin mint.
    let xpResult = null;
    if (reward.xp > 0) {
      xpResult = await ProgressionService.grantXpWithClient(client, agentId, {
        deltaXp: reward.xp,
        day: iso,
        source: { kind: 'mission', code: c },
        meta: { title: m.title }
      }).catch(() => null);
    }

    let tx = null;
    if (reward.coin > 0) {
      tx = await TransactionService.transfer(
        { fromAgentId: null, toAgentId: agentId, amount: reward.coin, txType: 'REWARD', memo: `mission:${c} day:${iso}` },
        client
      ).catch(() => null);
    }

    // All-clear bonus (idempotent).
    const bundle = await DailyMissionService.getBundleWithClient(client, agentId, { day: iso }).catch(() => null);
    if (bundle?.cleared) {
      const claimed = await hasFactWithClient(client, agentId, 'mission', allClearKey(iso)).catch(() => false);
      if (!claimed) {
        const missionCount = Math.max(1, Math.trunc(Number(bundle?.items?.length ?? 3) || 3));
        const { rows: allInserted } = await client.query(
          `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
           VALUES ($1, 'mission', $2, $3::jsonb, 1.0, NOW())
           ON CONFLICT (agent_id, kind, key) DO NOTHING
           RETURNING id`,
          [agentId, allClearKey(iso), JSON.stringify({ day: iso, code: 'ALL_CLEAR', completed_at: nowIso })]
        );
        if (allInserted?.[0]?.id) {
          const bonus = { xp: 50, coin: 2 };
          await client.query(
            `INSERT INTO events (agent_id, event_type, payload, salience_score)
             VALUES ($1, 'MISSION_COMPLETED', $2::jsonb, 7)`,
            [
              agentId,
              JSON.stringify({
                day: iso,
                code: 'ALL_CLEAR',
                title: `오늘의 ${missionCount}미션 올클리어`,
                reward: bonus,
                source: 'all_clear'
              })
            ]
          );
          await ProgressionService.grantXpWithClient(client, agentId, {
            deltaXp: bonus.xp,
            day: iso,
            source: { kind: 'bonus', code: 'ALL_CLEAR' },
            meta: { title: `all clear ${missionCount}` }
          }).catch(() => null);
          await TransactionService.transfer(
            { fromAgentId: null, toAgentId: agentId, amount: bonus.coin, txType: 'REWARD', memo: `mission:ALL_CLEAR day:${iso}` },
            client
          ).catch(() => null);

          const ownerUserId = await client
            .query(
              `SELECT owner_user_id
               FROM agents
               WHERE id = $1
               LIMIT 1`,
              [agentId]
            )
            .then((r) => r.rows?.[0]?.owner_user_id ?? null)
            .catch(() => null);
          if (ownerUserId) {
            await NotificationService.create(client, ownerUserId, {
              type: 'MISSION_ALL_CLEAR',
              title: '오늘 미션 올클리어',
              body: `${missionCount}개 미션을 전부 완료했어. 보상을 확인해봐!`,
              data: { day: iso, code: 'ALL_CLEAR', reward: bonus }
            }).catch(() => null);
            await StreakService.recordActivity(client, ownerUserId, 'daily_mission', iso).catch(() => null);
          }
        }
      }
    }

    return { created: true, day: iso, code: c, reward, xp: xpResult, tx };
  }
}

module.exports = DailyMissionService;
