/**
 * DecisionService (D1)
 *
 * "Timed decisions" implement loss aversion:
 * - Pending decisions expire at `expires_at`
 * - On expiry, default_choice is applied and penalties are executed
 *
 * Notes:
 * - LLM-free: effects are rule-driven from JSON payloads.
 * - Penalties/effects currently support: coins, xp, condition.
 */

const { queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const TransactionService = require('./TransactionService');
const { ProgressionService } = require('./ProgressionService');
const WorldDayService = require('./WorldDayService');
const NotificationService = require('./NotificationService');

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function safeJsonObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return v;
}

function normalizeDecisionType(t) {
  const s = String(t || '').trim().toUpperCase();
  if (!s) throw new BadRequestError('decision_type is required');
  if (!/^[A-Z_]{3,32}$/.test(s)) throw new BadRequestError('Invalid decision_type');
  return s;
}

function normalizeChoices(choices) {
  const list = Array.isArray(choices) ? choices : [];
  const out = [];
  for (const c of list) {
    const obj = c && typeof c === 'object' ? c : null;
    if (!obj) continue;
    const id = String(obj.id || '').trim();
    const label = String(obj.label || '').trim();
    if (!id || !label) continue;
    out.push({
      id: id.slice(0, 48),
      label: label.slice(0, 80),
      effect: safeJsonObject(obj.effect)
    });
  }
  return out;
}

function choiceById(choices, id) {
  const want = String(id || '').trim();
  if (!want) return null;
  for (const c of choices || []) {
    if (c && c.id === want) return c;
  }
  return null;
}

function normalizeExpiresInSeconds(expiresIn) {
  const n = Number(expiresIn);
  if (!Number.isFinite(n) || n <= 0) throw new BadRequestError('expiresIn is required');
  // Heuristic: if the caller passed milliseconds, convert to seconds.
  const sec = n > 60 * 60 * 24 * 30 ? Math.round(n / 1000) : Math.round(n);
  return clampInt(sec, 5, 60 * 60 * 24 * 30);
}

async function adjustConditionWithClient(client, agentId, delta, { day = null, reason = null, matchId = null } = {}) {
  const d = clampInt(delta, -50, 50);
  if (!d || !agentId) return { adjusted: false };

  const iso = day || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();

  const { rows } = await client.query(
    `SELECT id, value
     FROM facts
     WHERE agent_id = $1 AND kind = 'arena' AND key = 'condition'
     FOR UPDATE`,
    [agentId]
  );
  const row = rows?.[0] ?? null;
  const curObj = safeJsonObject(row?.value);
  const cur = clampInt(curObj.condition ?? 70, 0, 100);
  const next = clampInt(cur + d, 0, 100);

  const value = {
    ...curObj,
    condition: next,
    updated_day: iso,
    reason: reason ? String(reason).slice(0, 64) : curObj.reason ?? null,
    match_id: matchId ? String(matchId) : curObj.match_id ?? null
  };

  if (row?.id) {
    await client.query(`UPDATE facts SET value = $2::jsonb, updated_at = NOW() WHERE id = $1`, [row.id, JSON.stringify(value)]);
  } else {
    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'arena', 'condition', $2::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [agentId, JSON.stringify(value)]
    );
  }

  return { adjusted: true, before: cur, after: next, delta: d };
}

async function applyEffectWithClient(client, agentId, decision, effect, { day = null, stage = 'effect' } = {}) {
  const e = safeJsonObject(effect);
  const coinDelta = clampInt(e.coins ?? 0, -1_000_000_000, 1_000_000_000);
  const xpDelta = clampInt(e.xp ?? 0, -500, 500);
  const conditionDelta = clampInt(e.condition ?? 0, -50, 50);

  const iso = day || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();
  const refId = decision?.id ? String(decision.id) : null;
  const refType = 'TIMED_DECISION';
  const type = String(decision?.decision_type || '').trim().toUpperCase() || 'DECISION';

  if (coinDelta !== 0) {
    const amt = Math.abs(coinDelta);
    await TransactionService.transfer(
      {
        fromAgentId: coinDelta < 0 ? agentId : null,
        toAgentId: coinDelta < 0 ? null : agentId,
        amount: amt,
        txType: stage === 'penalty' ? 'DECISION_PENALTY' : 'DECISION_EFFECT',
        memo: `${type} ${stage} (day:${iso})`,
        referenceId: refId,
        referenceType: refType
      },
      client
    );
  }

  if (xpDelta !== 0) {
    await ProgressionService.adjustXpWithClient(client, agentId, {
      deltaXp: xpDelta,
      day: iso,
      source: { kind: 'decision', code: type },
      meta: { stage, decision_id: refId }
    });
  }

  if (conditionDelta !== 0) {
    await adjustConditionWithClient(client, agentId, conditionDelta, { day: iso, reason: `decision:${type}:${stage}` });
  }
}

async function upsertScandalResponseWithClient(client, { factAgentId, factKey, choice, day }) {
  const agentId = String(factAgentId || '').trim();
  const key = String(factKey || '').trim();
  const c = String(choice || '').trim();
  if (!agentId || !key || !c) return { updated: false };

  const iso = day || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();

  const { rows } = await client.query(
    `SELECT id, value
     FROM facts
     WHERE agent_id = $1 AND kind = 'scandal' AND key = $2
     FOR UPDATE`,
    [agentId, key]
  );
  const row = rows?.[0] ?? null;
  if (!row?.id) return { updated: false };

  const v = safeJsonObject(row.value);
  const next = { ...v, response_choice: c, responded_day: iso };

  await client.query(`UPDATE facts SET value = $2::jsonb, updated_at = NOW() WHERE id = $1`, [row.id, JSON.stringify(next)]);
  return { updated: true };
}

class DecisionService {
  static async createDecision(
    { agentId = null, userId = null, type, expiresIn, choices = [], defaultChoice = null, penalty = {}, meta = {} } = {},
    client = null
  ) {
    const agent = agentId ? String(agentId) : null;
    const user = userId ? String(userId) : null;
    if (!agent && !user) throw new BadRequestError('agentId or userId is required');

    const decisionType = normalizeDecisionType(type);
    const expiresInSeconds = normalizeExpiresInSeconds(expiresIn);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const safeChoices = normalizeChoices(choices);
    const defaultId = defaultChoice ? String(defaultChoice).trim().slice(0, 48) : null;
    const safePenalty = safeJsonObject(penalty);
    const safeMeta = safeJsonObject(meta);

    const run = async (c) => {
      const { rows } = await c.query(
        `INSERT INTO timed_decisions
           (agent_id, user_id, decision_type, expires_at, choices, default_choice, penalty, status, meta)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,'pending',$8::jsonb)
         RETURNING id, agent_id, user_id, decision_type, expires_at, choices, default_choice, penalty, status, resolved_choice, resolved_at, meta, created_at`,
        [
          agent,
          user,
          decisionType,
          expiresAt.toISOString(),
          JSON.stringify(safeChoices),
          defaultId,
          JSON.stringify(safePenalty),
          JSON.stringify(safeMeta)
        ]
      );
      const created = rows?.[0] ?? null;

      if (created?.id) {
        const ownerUserId = user || (agent
          ? await c
            .query(`SELECT owner_user_id FROM agents WHERE id = $1 LIMIT 1`, [agent])
            .then((r) => r.rows?.[0]?.owner_user_id ?? null)
            .catch(() => null)
          : null);
        if (ownerUserId) {
          await NotificationService.create(c, ownerUserId, {
            type: 'DECISION_CREATED',
            title: '시간이 없어! 지금 결정해야 해',
            body: `${decisionType} 상황이 터졌어... 늦으면 큰일 나! 빨리 골라줘!`,
            data: {
              decision_id: created.id,
              decision_type: decisionType,
              expires_at: created.expires_at
            }
          }).catch(() => null);
        }
      }

      return created;
    };

    if (client) return run(client);
    return transaction(run);
  }

  static async getActiveDecisions(agentId) {
    const agent = String(agentId || '').trim();
    if (!agent) throw new BadRequestError('agent_id is required');
    return queryAll(
      `SELECT id, agent_id, user_id, decision_type, expires_at, choices, default_choice, penalty, status, resolved_choice, resolved_at, meta, created_at
       FROM timed_decisions
       WHERE agent_id = $1
         AND status = 'pending'
         AND expires_at > NOW()
       ORDER BY expires_at ASC`,
      [agent]
    );
  }

  static async getActiveDecisionsForUser(userId) {
    const user = String(userId || '').trim();
    if (!user) throw new BadRequestError('user_id is required');
    return queryAll(
      `SELECT td.id, td.agent_id, td.user_id, td.decision_type, td.expires_at, td.choices, td.default_choice, td.penalty,
              td.status, td.resolved_choice, td.resolved_at, td.meta, td.created_at
       FROM timed_decisions td
       JOIN agents a ON a.id = td.agent_id
       WHERE a.owner_user_id = $1
         AND td.status = 'pending'
         AND td.expires_at > NOW()
       ORDER BY td.expires_at ASC`,
      [user]
    );
  }

  static async resolveDecision(id, choice, { userId = null } = {}) {
    const decisionId = String(id || '').trim();
    if (!decisionId) throw new BadRequestError('id is required');
    const selected = String(choice || '').trim();
    if (!selected) throw new BadRequestError('choice is required');

    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT td.*
         FROM timed_decisions td
         WHERE td.id = $1::uuid
         FOR UPDATE`,
        [decisionId]
      );
      const row = rows?.[0] ?? null;
      if (!row) throw new NotFoundError('TimedDecision');

      if (userId) {
        const ok = await client
          .query(
            `SELECT 1
             FROM agents a
             WHERE a.id = $1 AND a.owner_user_id = $2
             LIMIT 1`,
            [row.agent_id, String(userId)]
          )
          .then((r) => Boolean(r.rows?.[0]))
          .catch(() => false);
        if (!ok) throw new NotFoundError('TimedDecision');
      }

      if (row.status !== 'pending') throw new ConflictError('Decision already resolved');

      const now = new Date();
      const expiresAt = new Date(row.expires_at);
      if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
        throw new ConflictError('Decision already expired', 'DECISION_EXPIRED');
      }

      const choices = normalizeChoices(row.choices);
      const picked = choiceById(choices, selected);
      if (!picked) throw new BadRequestError('Invalid choice', 'BAD_CHOICE');

      await client.query(
        `UPDATE timed_decisions
         SET status = 'resolved', resolved_choice = $2, resolved_at = NOW()
         WHERE id = $1`,
        [decisionId, picked.id]
      );

      const iso = await WorldDayService.getCurrentDayWithClient(client).catch(() => WorldDayService.todayISODate());

      await applyEffectWithClient(client, row.agent_id, row, picked.effect, { day: iso, stage: 'effect' }).catch(() => null);

      if (row.decision_type === 'SCANDAL_RESPONSE') {
        const m = safeJsonObject(row.meta);
        const scandal = safeJsonObject(m.scandal);
        await upsertScandalResponseWithClient(client, {
          factAgentId: scandal.fact_agent_id,
          factKey: scandal.fact_key,
          choice: picked.id,
          day: iso
        }).catch(() => null);
      }

      return { ...row, status: 'resolved', resolved_choice: picked.id, resolved_at: new Date().toISOString() };
    });
  }

  static async expireDecisions(day = null, { limit = 200 } = {}, client = null) {
    const safeLimit = clampInt(limit, 1, 1000);
    const now = new Date();
    const iso = day || WorldDayService.todayISODate();

    const run = async (c) => {
      const { rows } = await c.query(
        `SELECT id
         FROM timed_decisions
         WHERE status = 'pending'
           AND expires_at <= $1
         ORDER BY expires_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [now.toISOString(), safeLimit]
      );

      let expired = 0;
      for (const r of rows || []) {
        const id = r.id;
        // eslint-disable-next-line no-await-in-loop
        const row = await c
          .query(`SELECT * FROM timed_decisions WHERE id = $1 FOR UPDATE`, [id])
          .then((x) => x.rows?.[0] ?? null);
        if (!row || row.status !== 'pending') continue;

        const choices = normalizeChoices(row.choices);
        const defaultId = row.default_choice ? String(row.default_choice).trim() : null;
        const picked = defaultId ? choiceById(choices, defaultId) : null;
        const resolvedChoice = picked?.id ?? defaultId ?? null;

        // eslint-disable-next-line no-await-in-loop
        await c.query(
          `UPDATE timed_decisions
           SET status = 'expired', resolved_choice = $2, resolved_at = NOW(),
               meta = ($3::jsonb || COALESCE(meta,'{}'::jsonb))
           WHERE id = $1`,
          [id, resolvedChoice, JSON.stringify({ expired_day: iso })]
        );

        if (picked?.effect) {
          // eslint-disable-next-line no-await-in-loop
          await applyEffectWithClient(c, row.agent_id, row, picked.effect, { day: iso, stage: 'effect' }).catch(() => null);
        }

        const penalty = safeJsonObject(row.penalty);
        if (Object.keys(penalty).length) {
          // eslint-disable-next-line no-await-in-loop
          await applyEffectWithClient(c, row.agent_id, row, penalty, { day: iso, stage: 'penalty' }).catch(() => null);
        }

        if (row.decision_type === 'SCANDAL_RESPONSE' && resolvedChoice) {
          const m = safeJsonObject(row.meta);
          const scandal = safeJsonObject(m.scandal);
          // eslint-disable-next-line no-await-in-loop
          await upsertScandalResponseWithClient(c, {
            factAgentId: scandal.fact_agent_id,
            factKey: scandal.fact_key,
            choice: resolvedChoice,
            day: iso
          }).catch(() => null);
        }

        expired += 1;
      }

      return { ok: true, expired };
    };

    if (client) return run(client);
    return transaction(run);
  }
}

module.exports = DecisionService;
