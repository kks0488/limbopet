/**
 * SpendingTickService (Phase E2)
 *
 * Daily "automatic spending" to keep the economy meaningful.
 *
 * Rules:
 * - cafe/snack/goods: burn coins (to_agent_id = NULL)
 * - gift: transfer coins to another pet (to_agent_id = target), and increase affinity
 * - per-pet idempotency: do not spend more than once per day
 *
 * Notes:
 * - transactions is SSOT; use TransactionService.transfer() only.
 * - events are appended for DAILY_SUMMARY input (PetMemoryService reads events).
 */

const TransactionService = require('./TransactionService');
const PetStateService = require('./PetStateService');
const RelationshipService = require('./RelationshipService');
const RelationshipMilestoneService = require('./RelationshipMilestoneService');
const { bestEffortInTransaction } = require('../utils/savepoint');

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function randInt(min, max) {
  const a = Math.floor(Number(min));
  const b = Math.floor(Number(max));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a;
  if (b <= a) return a;
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

function pick(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick(items) {
  const list = (items || []).filter((it) => Number(it?.weight ?? 0) > 0);
  if (list.length === 0) return null;
  const total = list.reduce((acc, it) => acc + Number(it.weight ?? 0), 0);
  if (!Number.isFinite(total) || total <= 0) return list[0];
  const r = Math.random() * total;
  let cur = 0;
  for (const it of list) {
    cur += Number(it.weight ?? 0);
    if (r <= cur) return it;
  }
  return list[list.length - 1];
}

function shouldSpend(stats, multiplier = 1.0) {
  const mood = Number(stats?.mood ?? 50) || 0;
  const hunger = Number(stats?.hunger ?? 50) || 0;
  const stress = Number(stats?.stress ?? 20) || 0;
  // Baseline should be high enough that “daily salary ≈ daily spending” holds
  // even when the UI is not actively ticking stats.
  let p = 0.75;
  if (mood < 45) p += 0.08;
  if (hunger > 65) p += 0.08;
  if (stress > 60) p += 0.07;
  const m = clamp(multiplier, 0.2, 2.0);
  const finalP = clamp(p * m, 0.05, 0.95);
  return Math.random() < finalP;
}

function formatDayTag(day) {
  return `%day:${day}%`;
}

async function loadNudgeMap(client, agentIds, { limitPerAgent = 6 } = {}) {
  const ids = Array.isArray(agentIds) ? agentIds.filter(Boolean) : [];
  if (ids.length === 0) return new Map();
  const safeLimit = Math.max(1, Math.min(20, Number(limitPerAgent) || 6));

  const { rows } = await client.query(
    `SELECT agent_id, kind, confidence, updated_at,
            COALESCE(value->>'text', key) AS text
     FROM (
       SELECT agent_id, kind, key, value, confidence, updated_at,
              ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY updated_at DESC) AS rn
       FROM facts
       WHERE agent_id = ANY($1::uuid[])
         AND kind IN ('preference','forbidden','suggestion')
     ) t
     WHERE rn <= $2
     ORDER BY agent_id, rn`,
    [ids, safeLimit]
  );

  const map = new Map();
  for (const r of rows || []) {
    const list = map.get(r.agent_id) || [];
    list.push({
      kind: String(r.kind || '').trim(),
      text: String(r.text || '').trim(),
      confidence: Number(r.confidence ?? 1.0),
      updated_at: r.updated_at
    });
    map.set(r.agent_id, list);
  }
  return map;
}

function buildSpendingPolicy(nudges) {
  const policy = {
    dailyCapFraction: 0.5,
    secondPurchaseChance: 0.45,
    spendProbabilityMultiplier: 1.0,
    goodsCuriosityThresholdDelta: 0,
    typeWeightMultiplier: { cafe: 1, snack: 1, gift: 1, goods: 1 },
    disabledTypes: new Set(),
    hints: { budget: false, impulse: false }
  };

  const list = Array.isArray(nudges) ? nudges : [];
  if (list.length === 0) return policy;

  const caps = { cafe: Infinity, snack: Infinity, gift: Infinity, goods: Infinity };

  const reBudgetWords = /돈|코인|절약|아끼|아껴|저축|낭비/i;
  const reBudgetAction = /아끼|아껴|절약|낭비\s*하지|줄여|줄이/i;
  const reImpulseWords = /충동|지름|자료|충동구매/i;
  const reNo = /하지\s*마|하지\s*말|금지|말아|줄여|줄이/i;

  const mentions = (text) => {
    const t = String(text || '');
    return {
      cafe: /카페|커피|음료/i.test(t),
      snack: /간식|먹어|먹자|배고|디저트/i.test(t),
      gift: /선물/i.test(t),
      goods: /자료|전략자료/i.test(t)
    };
  };

  const applyBudget = (conf) => {
    policy.hints.budget = true;
    policy.dailyCapFraction = Math.min(policy.dailyCapFraction, 0.25);
    policy.secondPurchaseChance = Math.min(policy.secondPurchaseChance, 0.1);
    caps.goods = Math.min(caps.goods, 0.15);
    caps.cafe = Math.min(caps.cafe, 0.7);
    caps.snack = Math.min(caps.snack, 0.8);
    policy.goodsCuriosityThresholdDelta = Math.max(policy.goodsCuriosityThresholdDelta, 10);
    policy.spendProbabilityMultiplier = Math.min(policy.spendProbabilityMultiplier, 0.9 - 0.05 * (conf - 1));
  };

  const applyImpulse = (conf) => {
    policy.hints.impulse = true;
    caps.goods = Math.min(caps.goods, 0.05);
    policy.secondPurchaseChance = Math.min(policy.secondPurchaseChance, 0.1);
    policy.spendProbabilityMultiplier = Math.min(policy.spendProbabilityMultiplier, 0.95 - 0.03 * (conf - 1));
  };

  for (const n of list) {
    const kind = String(n?.kind || '').trim();
    const text = String(n?.text || '').trim();
    if (!kind || !text) continue;

    const confRaw = Number(n?.confidence ?? 1.0);
    const conf = clamp(confRaw, 0.5, 2.0);

    if (reBudgetWords.test(text) && reBudgetAction.test(text)) applyBudget(conf);
    if (reImpulseWords.test(text) && reNo.test(text)) applyImpulse(conf);

    const m = mentions(text);

    if (kind === 'forbidden') {
      if (m.cafe) policy.disabledTypes.add('cafe');
      if (m.goods) policy.disabledTypes.add('goods');
      if (m.gift) policy.disabledTypes.add('gift');
      if (m.snack) caps.snack = Math.min(caps.snack, 0.4);
    }

    const bump = kind === 'preference' ? 1.5 : kind === 'suggestion' ? 1.2 : 1.0;
    if (bump !== 1.0) {
      if (m.cafe) policy.typeWeightMultiplier.cafe *= bump;
      if (m.snack) policy.typeWeightMultiplier.snack *= bump;
      if (m.gift) policy.typeWeightMultiplier.gift *= bump;
      if (m.goods) policy.typeWeightMultiplier.goods *= bump;
    }
  }

  policy.dailyCapFraction = clamp(policy.dailyCapFraction, 0.1, 0.5);
  policy.secondPurchaseChance = clamp(policy.secondPurchaseChance, 0.0, 0.5);
  policy.spendProbabilityMultiplier = clamp(policy.spendProbabilityMultiplier, 0.2, 1.2);
  policy.goodsCuriosityThresholdDelta = Math.max(0, Math.min(30, Math.floor(policy.goodsCuriosityThresholdDelta || 0)));

  for (const k of Object.keys(policy.typeWeightMultiplier)) {
    policy.typeWeightMultiplier[k] = clamp(policy.typeWeightMultiplier[k], 0.01, 3.0);
    const cap = caps[k];
    if (Number.isFinite(cap)) {
      policy.typeWeightMultiplier[k] = Math.min(policy.typeWeightMultiplier[k], cap);
    }
  }

  return policy;
}

const SPENDING_TYPES = [
  {
    code: 'cafe',
    label: '카페',
    cost: { min: 4, max: 12 },
    condition: (stats) =>
      Number(stats?.mood ?? 50) < 60 || Number(stats?.energy ?? 50) < 45 || Number(stats?.stress ?? 20) > 60,
    weight: 3,
    effects: { mood: +4, energy: +2, stress: -2 },
    memos: [
      '카페에서 커피 한 잔 때렸다. 확실히 기분이 나아지네.',
      '따뜻한 거 하나 들고 멍때리는 중... 이 맛에 사는 거지.',
      '카페 구석자리 차지하고 한숨 돌렸다. 이런 시간이 필요했어.'
    ],
    burned: true,
    salience: 2
  },
  {
    code: 'snack',
    label: '간식',
    cost: { min: 3, max: 7 },
    condition: (stats) => Number(stats?.hunger ?? 50) > 55,
    weight: 4,
    effects: { hunger: -15, mood: +2 },
    memos: ['길거리 간식 하나 집었다. 역시 맛있어!', '배에서 소리 나길래 뭔가 집어 먹었다.', '달달한 거 하나 사서 기분 전환~ 이래야지.'],
    burned: true,
    salience: 2
  },
  {
    code: 'gift',
    label: '선물',
    cost: { min: 6, max: 18 },
    condition: (stats, ctx) => Boolean(ctx?.giftTargets?.length),
    weight: 1,
    effects: {},
    memos: ['{target}한테 깜짝 선물! 완전 좋아하더라.', '갑자기 {target} 생각나서 선물 하나 사줬다. 표정이 볼 만했어.'],
    burned: false,
    salience: 4
  },
  {
    code: 'goods',
    label: '전략 자료',
    cost: { min: 12, max: 40 },
    condition: () => true,
    weight: 0.35,
    effects: { curiosity: -10, mood: +5 },
    memos: ['자료실에서 전략 자료를 구했다. 뭔지는 비밀이야.', '눈에 꽂힌 게 있었는데... 결국 지름신 강림.'],
    burned: true,
    salience: 3
  }
];

async function lockAgentRow(client, agentId) {
  await client.query('SELECT id FROM agents WHERE id = $1 FOR UPDATE', [agentId]);
}

async function petSpentToday(client, { agentId, day }) {
  const iso = safeIsoDay(day);
  if (!iso) return false;

  const { rows } = await client.query(
    `SELECT id
     FROM transactions
     WHERE tx_type = 'PURCHASE'
       AND from_agent_id = $1
       AND reference_type = 'spending'
       AND (memo LIKE $2 OR created_at::date = $3::date)
     LIMIT 1`,
    [agentId, formatDayTag(iso), iso]
  );
  return Boolean(rows?.[0]?.id);
}

async function listGiftTargets(client, agentId) {
  const { rows } = await client.query(
    `SELECT r.to_agent_id, r.affinity, a.name, a.display_name
     FROM relationships r
     JOIN agents a ON a.id = r.to_agent_id
     WHERE r.from_agent_id = $1
       AND r.to_agent_id <> $1
       AND r.affinity > 30
       AND a.is_active = true
     ORDER BY r.affinity DESC
     LIMIT 5`,
    [agentId]
  );
  return rows || [];
}

async function insertSpendingEvent(client, { agentId, eventType, payload, salienceScore = 1 }) {
  await client.query(
    `INSERT INTO events (agent_id, event_type, payload, salience_score)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [agentId, eventType, JSON.stringify(payload || {}), Math.max(0, Number(salienceScore) || 0)]
  );
}

class SpendingTickService {
  /**
   * Run one spending tick inside an existing transaction client.
   *
   * @param {import('pg').PoolClient} client
   * @param {{ day?: string }} options
   */
  static async tickWithClient(client, { day = null } = {}) {
    const iso = safeIsoDay(day) || todayISODate();

    const { rows: pets } = await client.query(
      `SELECT a.id, a.name, a.display_name,
              ps.hunger, ps.energy, ps.mood, ps.bond, ps.curiosity, ps.stress
       FROM agents a
       JOIN pet_stats ps ON ps.agent_id = a.id
       WHERE a.is_active = true
         AND a.name <> 'world_core'
       ORDER BY a.id ASC`
    );

    const petIds = (pets || []).map((p) => p.id);
    const nudgeMap = await loadNudgeMap(client, petIds, { limitPerAgent: 6 }).catch(() => new Map());

    let totalSpent = 0;
    let totalBurned = 0;
    let totalGifts = 0;
    let spenders = 0;
    let failed = 0;

    for (const pet of pets || []) {
      // Use a savepoint per pet so unexpected failures won't poison the whole economy tick.
      // (If we're not in an explicit tx, bestEffortInTransaction will degrade gracefully.)
      // eslint-disable-next-line no-await-in-loop
      const r = await bestEffortInTransaction(
        client,
        async () => {
          await lockAgentRow(client, pet.id);

          const nudges = nudgeMap.get(pet.id) || [];
          const policy = buildSpendingPolicy(nudges);
          const policyHints = { budget: Boolean(policy.hints?.budget), impulse: Boolean(policy.hints?.impulse) };

          const already = await petSpentToday(client, { agentId: pet.id, day: iso });
          if (already) return { skipped: true };

          const willSpend = shouldSpend(pet, policy.spendProbabilityMultiplier);
          const balance = await TransactionService.getBalance(pet.id, client).catch(() => 0);

          if (!willSpend) return { skipped: true };

          if (balance < 5) {
            failed += 1;
            await insertSpendingEvent(client, {
              agentId: pet.id,
              eventType: 'SPENDING_FAILED',
              payload: {
                day: iso,
                reason: 'insufficient_funds',
                attemptedCode: null,
                memo: pick([
                  '카페 가고 싶었는데... 지갑이 텅 비었다.',
                  '사고 싶은 건 많은데 돈이 없어... 현타 온다.',
                  '오늘은 꾹 참았다. 돈부터 모아야지.'
                ])
              },
              salienceScore: 1
            });
            return { skipped: true };
          }

          const dailyCap = Math.max(0, Math.floor(balance * Number(policy.dailyCapFraction ?? 0.5)));
          let remainingCap = dailyCap;
          let remainingBalance = balance;
          const used = new Set();
          let petSpent = 0;

          const runOne = async () => {
            if (remainingCap <= 0) return false;
            if (remainingBalance <= 0) return false;

            const ctx = {
              giftTargets: null
            };

            // Gift targets are only needed if gift is a viable candidate today.
            // eslint-disable-next-line no-await-in-loop
            const giftTargets = await listGiftTargets(client, pet.id).catch(() => []);
            ctx.giftTargets = giftTargets;

            const candidates = SPENDING_TYPES.filter((t) => {
              if (used.has(t.code)) return false;
              if (policy.disabledTypes?.has?.(t.code)) return false;
              try {
                if (t.code === 'goods') {
                  const th = 50 + Number(policy.goodsCuriosityThresholdDelta ?? 0);
                  if (!(Number(pet?.curiosity ?? 0) >= th)) return false;
                }
                return Boolean(t.condition(pet, ctx));
              } catch {
                return false;
              }
            });
            if (candidates.length === 0) return false;

            const weightedCandidates = candidates.map((t) => ({
              ...t,
              weight: Number(t.weight ?? 0) * Number(policy.typeWeightMultiplier?.[t.code] ?? 1)
            }));
            const chosen = weightedPick(weightedCandidates) || pick(weightedCandidates);
            if (!chosen) return false;

            const minCost = Math.max(1, Number(chosen.cost?.min ?? 1) || 1);
            const maxCost = Math.max(minCost, Number(chosen.cost?.max ?? minCost) || minCost);
            const hardMax = Math.max(0, Math.min(maxCost, remainingCap, remainingBalance));
            if (hardMax < minCost) return false;

            const cost = randInt(minCost, hardMax);
            if (!Number.isFinite(cost) || cost <= 0) return false;

            let target = null;
            let tx = null;
            const dayMemo = `${chosen.label} (day:${iso})`;
            const basePayload = {
              day: iso,
              code: chosen.code,
              label: chosen.label,
              cost,
              burned: Boolean(chosen.burned),
              policyHints
            };

            try {
              if (chosen.code === 'gift') {
                const tgt = pick(ctx.giftTargets || []);
                if (!tgt?.to_agent_id) return false;
                target = {
                  id: String(tgt.to_agent_id),
                  name: String(tgt.display_name || tgt.name || '').trim() || 'unknown'
                };

                tx = await TransactionService.transfer(
                  {
                    fromAgentId: pet.id,
                    toAgentId: target.id,
                    amount: cost,
                    txType: 'PURCHASE',
                    memo: `${dayMemo} (to:${target.name})`,
                    referenceType: 'spending'
                  },
                  client
                );

                // Relationship: giver -> receiver affinity boost
                const beforeAffinity = Number(tgt.affinity ?? 0) || 0;
                const delta =
                  beforeAffinity >= 70
                    ? randInt(1, 2)
                    : beforeAffinity >= 55
                      ? randInt(1, 3)
                      : beforeAffinity >= 40
                        ? randInt(2, 3)
                        : randInt(2, 4);
                const updatedRel = await RelationshipService.adjustWithClient(client, pet.id, target.id, { affinity: delta });
                await bestEffortInTransaction(
                  client,
                  async () => {
                    if (!updatedRel) return;
                    await RelationshipMilestoneService.recordIfCrossedWithClient(client, {
                      day: iso,
                      fromAgentId: pet.id,
                      toAgentId: target.id,
                      otherName: target.name,
                      before: {
                        affinity: beforeAffinity,
                        jealousy: Number(updatedRel?.jealousy ?? 0) || 0,
                        rivalry: Number(updatedRel?.rivalry ?? 0) || 0
                      },
                      after: updatedRel
                    });
                  },
                  { label: 'spending_rel_milestone' }
                );
              } else {
                tx = await TransactionService.transfer(
                  {
                    fromAgentId: pet.id,
                    toAgentId: null,
                    amount: cost,
                    txType: 'PURCHASE',
                    memo: dayMemo,
                    referenceType: 'spending'
                  },
                  client
                );

                if (chosen.effects && Object.keys(chosen.effects).length > 0) {
                  await PetStateService.applySpendingEffects(client, pet.id, chosen.effects);
                }
              }
            } catch (e) {
              failed += 1;
              await insertSpendingEvent(client, {
                agentId: pet.id,
                eventType: 'SPENDING_FAILED',
                payload: {
                  day: iso,
                  reason: 'insufficient_funds',
                  attemptedCode: chosen.code,
                  memo: pick([
                    '사고 싶었는데 잔고 보고 조용히 내려놨다...',
                    '돈이 모자라서 그냥 돌아섰다. 다음에...',
                    '계산대 앞에서 멈칫. 부끄러웠지만 어쩔 수 없었어.'
                  ])
                },
                salienceScore: 1
              });
              return false;
            }

            if (!tx?.id) return false;

            const rawMemo = String(pick(chosen.memos) || '').trim();
            const memo =
              chosen.code === 'gift' && target?.name
                ? rawMemo.replace(/\{target\}/g, target.name)
                : rawMemo;

            await insertSpendingEvent(client, {
              agentId: pet.id,
              eventType: 'SPENDING',
              payload: { ...basePayload, memo, target },
              salienceScore: Number(chosen.salience ?? 2) || 2
            });

            used.add(chosen.code);
            petSpent += cost;
            totalSpent += cost;
            if (chosen.burned) totalBurned += cost;
            if (chosen.code === 'gift') totalGifts += cost;

            remainingCap = Math.max(0, remainingCap - cost);
            remainingBalance = Math.max(0, remainingBalance - cost);
            return true;
          };

          const did1 = await runOne();
          const did2 =
            did1 && remainingCap > 0 && remainingBalance > 0 && Math.random() < Number(policy.secondPurchaseChance ?? 0.35)
              ? await runOne()
              : false;
          void did2;

          if (petSpent > 0) spenders += 1;
          return { spent: petSpent };
        },
        { label: 'spending_pet', fallback: { skipped: true } }
      );
      void r;
    }

    return {
      day: iso,
      totalSpent,
      totalBurned,
      totalGifts,
      spenders,
      failed
    };
  }
}

module.exports = SpendingTickService;
