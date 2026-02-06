const { BadRequestError } = require('../utils/errors');
const WorldDayService = require('./WorldDayService');
const TransactionService = require('./TransactionService');
const RumorService = require('./RumorService');

const COSTS = Object.freeze({
  gossip: 5,
  scandal_hint: 15,
  secret_reveal: 30,
});

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function safeText(v, maxLen = 200) {
  return String(v ?? '').trim().slice(0, Math.max(1, Math.trunc(Number(maxLen) || 200)));
}

function safeRumorType(v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (t === 'gossip' || t === 'scandal_hint' || t === 'secret_reveal') return t;
  throw new BadRequestError('Invalid rumor_type', 'BAD_RUMOR_TYPE');
}

function rumorScenarioByType(rumorType) {
  if (rumorType === 'scandal_hint') return 'PLAYER_SCANDAL_HINT';
  if (rumorType === 'secret_reveal') return 'PLAYER_SECRET_REVEAL';
  return 'PLAYER_GOSSIP';
}

function rumorCredibilityByType(rumorType) {
  if (rumorType === 'scandal_hint') return 0.6;
  if (rumorType === 'secret_reveal') return 0.8;
  return 0.3;
}

class RumorPlantService {
  static async plantWithClient(client, userId, agentId, { targetAgentId, rumorType, content } = {}) {
    if (!client) throw new BadRequestError('client is required');

    const uid = String(userId || '').trim();
    const aId = String(agentId || '').trim();
    const targetId = String(targetAgentId || '').trim();
    const kind = safeRumorType(rumorType);
    if (!uid || !aId) throw new BadRequestError('userId and agentId are required');
    if (!targetId) throw new BadRequestError('target_agent_id is required', 'BAD_TARGET_AGENT');

    const today =
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      WorldDayService.todayISODate();
    const iso = safeIsoDay(today) || WorldDayService.todayISODate();

    const { rows: targetRows } = await client.query(
      `SELECT id
       FROM agents
       WHERE id = $1
         AND name <> 'world_core'
         AND is_active = true
       LIMIT 1`,
      [targetId]
    );
    if (!targetRows?.[0]?.id) {
      throw new BadRequestError('target_agent_id is invalid', 'BAD_TARGET_AGENT');
    }

    const { rows: ownerRows } = await client.query(
      `SELECT owner_user_id
       FROM agents
       WHERE id = $1
       LIMIT 1`,
      [aId]
    );
    const ownerUserId = String(ownerRows?.[0]?.owner_user_id || '').trim();
    if (!ownerUserId || ownerUserId !== uid) {
      throw new BadRequestError('Not your pet', 'FORBIDDEN');
    }

    const cost = COSTS[kind] || COSTS.gossip;
    const balance = await TransactionService.getBalance(aId, client);
    if ((Number(balance) || 0) < cost) {
      throw new BadRequestError('코인이 부족해', 'INSUFFICIENT_FUNDS');
    }

    const { rows: dailyRows } = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM events
       WHERE agent_id = $1
         AND event_type = 'RUMOR_PLANTED'
         AND payload->>'day' = $2`,
      [aId, iso]
    );
    const dailyCount = Number(dailyRows?.[0]?.cnt ?? 0) || 0;
    if (dailyCount >= 3) {
      throw new BadRequestError('오늘 루머 한도 초과', 'DAILY_LIMIT');
    }

    await TransactionService.transfer(
      {
        fromAgentId: aId,
        toAgentId: null,
        amount: cost,
        txType: 'RUMOR_PLANT',
        memo: `rumor:${kind} target:${targetId} day:${iso}`,
        referenceType: 'rumor',
      },
      client
    );

    const rumor = await RumorService.createWithClient(client, {
      worldDay: iso,
      scenario: rumorScenarioByType(kind),
      originAgentId: aId,
      subjectAId: targetId,
      subjectBId: null,
      claim: safeText(content, 200) || '뭔가 수상한 소문이...',
      evidence: [
        {
          kind: 'player_plant',
          label: `cred:${rumorCredibilityByType(kind)}`,
          strength: Math.max(1, Math.min(5, Math.round(rumorCredibilityByType(kind) * 5))),
          sourceAgentId: aId,
        },
      ],
      episodePostId: null,
    });

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'RUMOR_PLANTED', $2::jsonb, 5)`,
      [
        aId,
        JSON.stringify({
          day: iso,
          target: targetId,
          target_agent_id: targetId,
          type: kind,
          rumor_type: kind,
          cost,
          rumor_id: rumor?.id ?? null,
          credibility: rumorCredibilityByType(kind),
        }),
      ]
    );

    return {
      planted: true,
      cost,
      rumor_id: rumor?.id ?? null,
      rumor_type: kind,
      day: iso,
    };
  }
}

module.exports = RumorPlantService;
