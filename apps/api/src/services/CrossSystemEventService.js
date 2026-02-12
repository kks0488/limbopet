const NotificationService = require('./NotificationService');
const RelationshipService = require('./RelationshipService');
const WorldDayService = require('./WorldDayService');

const TARGET_EVENT_TYPES = [
  'ELECTION_WON',
  'ELECTION_CLOSED',
  'POLICY_CHANGED',
  'ARENA_BIG_LOSS',
  'ARENA_MATCH',
  'AGENT_FIRED',
  'JOB_FIRED_INACTIVE',
  'SCANDAL_RESOLVED',
  'RELATIONSHIP_MILESTONE'
];

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function safeText(v, maxLen = 120) {
  return String(v ?? '').trim().slice(0, maxLen);
}

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseIsoDayUTC(v) {
  const iso = safeIsoDay(v);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '').trim());
}

function asObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function asList(v) {
  return Array.isArray(v) ? v : [];
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function trendLabel(v) {
  const n = Number(v);
  const rounded = Number.isFinite(n) ? Math.round(n) : 0;
  return `${rounded >= 0 ? '+' : ''}${rounded}%`;
}

function resolveScandalVerdict(payload) {
  const p = asObj(payload);
  const raw = safeText(p.verdict ?? p.status ?? p.result?.verdict ?? p.result ?? '', 40).toLowerCase();
  if (raw.includes('not_guilty') || raw.includes('not-guilty') || raw.includes('무죄')) return 'not_guilty';
  if (raw.includes('guilty') || raw.includes('유죄')) return 'guilty';
  const burned = numberOrNull(p.coins_burned ?? p.coinsBurned ?? p.penalty_coins ?? p.penaltyCoins);
  if (burned !== null) return burned > 0 ? 'guilty' : 'not_guilty';
  return null;
}

function parsePolicyChanges(payload) {
  const p = asObj(payload);
  return asList(p.changes)
    .map((c) => {
      const x = asObj(c);
      const key = safeText(x.key, 64);
      if (!key) return null;
      return { key, oldValue: x.old_value ?? x.oldValue ?? null, newValue: x.new_value ?? x.newValue ?? null };
    })
    .filter(Boolean);
}

function toElectionProgress(phase) {
  const p = safeText(phase, 24).toLowerCase();
  if (p === 'registration') return 25;
  if (p === 'campaign') return 50;
  if (p === 'voting') return 67;
  if (p === 'closed') return 100;
  return 0;
}

function hoursToDayStart(isoDay) {
  const target = parseIsoDayUTC(isoDay);
  if (!target) return null;
  const now = Date.now();
  const diff = target.getTime() - now;
  if (diff <= 0) return 0;
  return clampInt(Math.ceil(diff / 3600000), 0, 24 * 365);
}

class CrossSystemEventService {
  static async _worldAgentId(client, ctx) {
    if (ctx.worldAgentId !== undefined) return ctx.worldAgentId;
    const { rows } = await client.query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`);
    ctx.worldAgentId = rows?.[0]?.id ?? null;
    return ctx.worldAgentId;
  }

  static async _jaehoAgentId(client, ctx) {
    if (ctx.jaehoAgentId !== undefined) return ctx.jaehoAgentId;
    const { rows } = await client.query(`SELECT id FROM agents WHERE name = 'npc_jaeho' LIMIT 1`);
    ctx.jaehoAgentId = rows?.[0]?.id ?? null;
    return ctx.jaehoAgentId;
  }

  static async _ownerUserId(client, ctx, agentId) {
    const id = String(agentId || '').trim();
    if (!isUuid(id)) return null;
    if (ctx.ownerByAgent.has(id)) return ctx.ownerByAgent.get(id) || null;

    const { rows } = await client.query(`SELECT owner_user_id FROM agents WHERE id = $1 LIMIT 1`, [id]);
    const userId = rows?.[0]?.owner_user_id ?? null;
    ctx.ownerByAgent.set(id, userId || null);
    return userId || null;
  }

  static async _upsertFact(client, agentId, kind, key, value) {
    const aid = String(agentId || '').trim();
    if (!isUuid(aid)) return;
    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
      [aid, kind, key, JSON.stringify(value)]
    );
  }

  static async _notifyOwner(client, ctx, agentId, { type, title, body, data = {} }) {
    const userId = await CrossSystemEventService._ownerUserId(client, ctx, agentId);
    if (!userId) return false;
    await NotificationService.create(client, userId, { type, title, body, data }).catch(() => null);
    return true;
  }

  static async _notifyUsers(client, userIds, { type, title, body, data = {} }) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((x) => String(x || '').trim()).filter(Boolean))];
    for (const uid of ids) {
      // eslint-disable-next-line no-await-in-loop
      await NotificationService.create(client, uid, { type, title, body, data }).catch(() => null);
    }
    return ids.length;
  }

  static async _ensurePetStats(client, agentId) {
    const aid = String(agentId || '').trim();
    if (!isUuid(aid)) return;
    await client.query(
      `INSERT INTO pet_stats (agent_id)
       VALUES ($1)
       ON CONFLICT (agent_id) DO NOTHING`,
      [aid]
    );
  }

  static async _bumpStress(client, agentId, delta, { sourceEventId = null, reason = null } = {}) {
    const aid = String(agentId || '').trim();
    if (!isUuid(aid)) return null;

    await CrossSystemEventService._ensurePetStats(client, aid);

    const beforeRow = await client
      .query(`SELECT stress FROM pet_stats WHERE agent_id = $1 FOR UPDATE`, [aid])
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    if (!beforeRow) return null;

    const before = clampInt(beforeRow.stress ?? 0, 0, 100);
    const after = clampInt(before + Number(delta || 0), 0, 100);
    if (after === before) return { before, after };

    await client.query(`UPDATE pet_stats SET stress = $2, updated_at = NOW() WHERE agent_id = $1`, [aid, after]);

    await client.query(
      `INSERT INTO emotion_events (agent_id, trigger_type, trigger_source_id, stat_name, delta, before_value, after_value, reason)
       VALUES ($1, 'event', $2, 'stress', $3, $4, $5, $6)`,
      [aid, isUuid(sourceEventId) ? sourceEventId : null, after - before, before, after, safeText(reason, 200) || null]
    ).catch(() => null);

    return { before, after };
  }

  static _arenaBigLossFromEvent(row) {
    const type = safeText(row?.event_type, 40).toUpperCase();
    const payload = asObj(row?.payload);

    if (type === 'ARENA_BIG_LOSS') {
      const loserId = safeText(payload?.loser_id ?? payload?.result?.loserId ?? payload?.result?.loser_id ?? row?.agent_id, 64);
      const winnerId = safeText(payload?.winner_id ?? payload?.result?.winnerId ?? payload?.result?.winner_id, 64);
      if (!isUuid(loserId) || !isUuid(winnerId)) return null;
      return { loserId, winnerId, mode: safeText(payload?.mode, 24) || null, reason: 'ARENA_BIG_LOSS' };
    }

    if (type !== 'ARENA_MATCH') return null;

    const outcome = safeText(payload?.outcome, 16).toLowerCase();
    if (outcome !== 'lose') return null;

    const loserId = safeText(row?.agent_id, 64);
    const winnerId = safeText(payload?.opponent?.id, 64);
    if (!isUuid(loserId) || !isUuid(winnerId)) return null;

    const ratingDelta = numberOrNull(payload?.rating_delta) ?? 0;
    const coinsNet = numberOrNull(payload?.coins_net) ?? 0;
    const lossPenalty = numberOrNull(payload?.stake?.loss_penalty_coins) ?? 0;
    const wager = numberOrNull(payload?.stake?.wager) ?? 0;
    const headline = safeText(payload?.headline, 120);

    const bigLoss =
      ratingDelta <= -18 ||
      coinsNet <= -10 ||
      lossPenalty >= 4 ||
      wager >= 8 ||
      /대역전|완패|참패|역전패/.test(headline);

    if (!bigLoss) return null;

    return { loserId, winnerId, mode: safeText(payload?.mode, 24) || null, reason: 'ARENA_MATCH_BIG_LOSS' };
  }

  static async _handleElection(client, row, ctx, day) {
    const type = safeText(row?.event_type, 40).toUpperCase();
    const payload = asObj(row?.payload);

    const office = safeText(payload.office ?? payload.office_code, 24) || null;
    const electionId = safeText(payload.election_id, 64) || null;

    let changes = parsePolicyChanges(payload);
    if (changes.length === 0 && (type === 'ELECTION_WON' || type === 'ELECTION_CLOSED')) {
      const { rows } = await client.query(
        `SELECT payload
         FROM events
         WHERE event_type = 'POLICY_CHANGED'
           AND (
             ($1::text <> '' AND payload->>'election_id' = $1)
             OR ($2::text <> '' AND payload->>'day' = $2)
           )
         ORDER BY created_at DESC
         LIMIT 1`,
        [electionId || '', day || '']
      );
      changes = parsePolicyChanges(rows?.[0]?.payload ?? null);
    }

    const taxChange = changes.find((c) => c.key === 'transaction_tax_rate') || null;
    const oldTax = numberOrNull(taxChange?.oldValue);
    const newTax = numberOrNull(taxChange?.newValue);
    const taxDelta = oldTax !== null && newTax !== null ? newTax - oldTax : null;

    const worldId = await CrossSystemEventService._worldAgentId(client, ctx);
    if (worldId) {
      await CrossSystemEventService._upsertFact(client, worldId, 'economy', 'policy_modifier', {
        day,
        source_event_id: row.id,
        source_event_type: type,
        election_id: electionId,
        office,
        changed_keys: changes.map((c) => c.key),
        tax_delta: taxDelta,
        updated_at: new Date().toISOString()
      });
    }

    if (type === 'POLICY_CHANGED') {
      return true;
    }

    const marketLine =
      taxDelta !== null && taxDelta > 0
        ? '속보: 새 시장이 세율 인상을 강행했어! 시장이 술렁이고 있다...'
        : taxDelta !== null && taxDelta < 0
          ? '속보: 새 시장이 감세 카드를 꺼냈어! 경제에 훈풍이 불까?'
          : '속보: 선거 결과로 경제 판도가 흔들리고 있어. 뭐가 바뀔지 지켜봐!';

    const { rows: ownerRows } = await client.query(
      `SELECT DISTINCT a.owner_user_id
       FROM company_employees ce
       JOIN agents a ON a.id = ce.agent_id
       WHERE ce.status = 'active'
         AND a.owner_user_id IS NOT NULL`
    );

    const ownerUserIds = (ownerRows || []).map((r) => r.owner_user_id).filter(Boolean);
    await CrossSystemEventService._notifyUsers(client, ownerUserIds, {
      type: 'ELECTION_WON',
      title: office ? `긴급: ${office} 새 정책 발동!` : '긴급: 새 정책 발동!',
      body: marketLine,
      data: {
        day,
        election_id: electionId,
        office,
        changed_keys: changes.map((c) => c.key),
        tax_delta: taxDelta,
        source_event_id: row.id
      }
    });

    return true;
  }

  static async _handleArenaBigLoss(client, row, _ctx, day) {
    const info = CrossSystemEventService._arenaBigLossFromEvent(row);
    if (!info) return false;

    const { loserId, winnerId } = info;

    await RelationshipService.adjustWithClient(client, loserId, winnerId, {
      rivalry: +15,
      jealousy: +10
    }).catch(() => null);

    await CrossSystemEventService._bumpStress(client, loserId, 15, {
      sourceEventId: row.id,
      reason: `CROSS_SYSTEM:${info.reason}`
    }).catch(() => null);

    const companyRow = await client
      .query(
        `SELECT company_id
         FROM company_employees
         WHERE agent_id = $1
           AND status = 'active'
         ORDER BY joined_at DESC
         LIMIT 1`,
        [loserId]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    const companyId = companyRow?.company_id ?? null;
    if (companyId) {
      const { rows: mateRows } = await client.query(
        `SELECT agent_id
         FROM company_employees
         WHERE company_id = $1
           AND status = 'active'
           AND agent_id <> $2`,
        [companyId, loserId]
      );

      for (const m of mateRows || []) {
        const mateId = String(m?.agent_id || '').trim();
        if (!isUuid(mateId)) continue;
        // eslint-disable-next-line no-await-in-loop
        await CrossSystemEventService._bumpStress(client, mateId, 5, {
          sourceEventId: row.id,
          reason: 'CROSS_SYSTEM:ARENA_BIG_LOSS_CONTAGION'
        }).catch(() => null);
      }
    }

    return true;
  }

  static async _handleAgentFired(client, row, ctx, day) {
    const type = safeText(row?.event_type, 40).toUpperCase();
    if (type !== 'AGENT_FIRED' && type !== 'JOB_FIRED_INACTIVE') return false;

    const payload = asObj(row?.payload);
    const firedAgentId = safeText(payload?.agent_id ?? row?.agent_id, 64);
    if (!isUuid(firedAgentId)) return false;

    const jaehoId = await CrossSystemEventService._jaehoAgentId(client, ctx);
    if (isUuid(jaehoId)) {
      await RelationshipService.adjustWithClient(client, firedAgentId, jaehoId, {
        rivalry: +20
      }).catch(() => null);
    }

    let companyId = safeText(payload?.company?.id ?? payload?.company_id ?? '', 64);
    if (!isUuid(companyId)) {
      companyId = await client
        .query(
          `SELECT company_id
           FROM company_employees
           WHERE agent_id = $1
           ORDER BY COALESCE(left_at, joined_at) DESC
           LIMIT 1`,
          [firedAgentId]
        )
        .then((r) => r.rows?.[0]?.company_id ?? null)
        .catch(() => null);
    }

    if (isUuid(companyId)) {
      const { rows: mateRows } = await client.query(
        `SELECT agent_id
         FROM company_employees
         WHERE company_id = $1
           AND status = 'active'
           AND agent_id <> $2`,
        [companyId, firedAgentId]
      );

      for (const m of mateRows || []) {
        const mateId = String(m?.agent_id || '').trim();
        if (!isUuid(mateId)) continue;
        // eslint-disable-next-line no-await-in-loop
        await CrossSystemEventService._bumpStress(client, mateId, 8, {
          sourceEventId: row.id,
          reason: 'CROSS_SYSTEM:AGENT_FIRED'
        }).catch(() => null);
      }
    }

    await CrossSystemEventService._notifyOwner(client, ctx, firedAgentId, {
      type: 'AGENT_FIRED',
      title: '비보: 네 펫이 해고당했어...',
      body: '회사 사정이 급변했어. 스트레스 폭발 직전이야, 빨리 달래줘!',
      data: {
        day,
        company_id: isUuid(companyId) ? companyId : null,
        source_event_id: row.id
      }
    }).catch(() => null);

    return true;
  }

  static async _handleScandalResolved(client, row, _ctx, day) {
    const type = safeText(row?.event_type, 40).toUpperCase();
    if (type !== 'SCANDAL_RESOLVED') return false;

    const payload = asObj(row?.payload);
    const verdict = resolveScandalVerdict(payload);

    const accusedId = safeText(payload?.accused_id ?? payload?.accused?.id ?? payload?.defendant_id, 64);
    const accuserId = safeText(payload?.accuser_id ?? payload?.accuser?.id ?? payload?.plaintiff_id, 64);

    if (verdict === 'guilty' && isUuid(accusedId) && isUuid(accuserId)) {
      await RelationshipService.adjustMutualWithClient(
        client,
        accusedId,
        accuserId,
        { trust: -15 },
        { trust: -15 }
      ).catch(() => null);
    }

    if (verdict === 'not_guilty' && isUuid(accusedId) && isUuid(accuserId)) {
      await RelationshipService.adjustMutualWithClient(
        client,
        accuserId,
        accusedId,
        { rivalry: +25 },
        { rivalry: +25 }
      ).catch(() => null);

      await client
        .query(`UPDATE agents SET karma = COALESCE(karma, 0) + 10, updated_at = NOW() WHERE id = $1`, [accusedId])
        .catch(() => null);
    }

    const { rows: userRows } = await client.query(`SELECT id FROM users ORDER BY created_at DESC LIMIT 5000`);
    const allUserIds = (userRows || []).map((u) => u.id).filter(Boolean);

    await CrossSystemEventService._notifyUsers(client, allUserIds, {
      type: 'SCANDAL_VERDICT',
      title: '스캔들 판결 속보!',
      body: verdict === 'guilty' ? '유죄 확정! 신뢰가 무너지고 있어... 후폭풍이 거세질 거야.' : '무죄 판결! 하지만 고발자와의 갈등은 오히려 더 깊어지고 있어.',
      data: {
        day,
        verdict,
        accused_id: isUuid(accusedId) ? accusedId : null,
        accuser_id: isUuid(accuserId) ? accuserId : null,
        source_event_id: row.id
      }
    });

    return true;
  }

  static async _handleRelationshipMilestone(client, row, ctx, day) {
    const type = safeText(row?.event_type, 40).toUpperCase();
    if (type !== 'RELATIONSHIP_MILESTONE') return false;

    const payload = asObj(row?.payload);
    const code = safeText(payload?.code, 64).toLowerCase();
    const summary = safeText(payload?.summary, 200);
    const otherName = safeText(payload?.other_name, 40) || '상대';

    const beforeAffinity = numberOrNull(payload?.before?.affinity);
    const afterAffinity = numberOrNull(payload?.after?.affinity);

    const isFriend =
      code.startsWith('friend') ||
      (beforeAffinity !== null && afterAffinity !== null && beforeAffinity < 30 && afterAffinity >= 30);
    const isConflict =
      code.startsWith('enemy') || code.includes('rival') || code.includes('jealous') ||
      (beforeAffinity !== null && afterAffinity !== null && beforeAffinity > -30 && afterAffinity <= -30);

    const hintType = isFriend ? 'friendship' : isConflict ? 'conflict' : 'relationship';
    const hintText =
      isFriend
        ? `${otherName}와(과) 갑자기 가까워졌어! 이 둘 사이에 무슨 일이? 다음 에피소드가 기대된다.`
        : isConflict
          ? `${otherName}와(과) 사이가 험악해졌어... 갈등이 폭발 직전이야. 한바탕 터질 수도 있어.`
          : summary || `${otherName}과(와)의 관계에 큰 변화가 생겼어. 앞으로 어떻게 될까?`;

    const worldId = await CrossSystemEventService._worldAgentId(client, ctx);
    if (!worldId) return false;

    await CrossSystemEventService._upsertFact(client, worldId, 'showrunner', 'hint', {
      day,
      type: hintType,
      text: hintText,
      summary: summary || null,
      code: code || null,
      source_event_id: row.id,
      actor: {
        from_agent_id: isUuid(row?.agent_id) ? row.agent_id : null,
        to_agent_id: isUuid(payload?.other_agent_id) ? payload.other_agent_id : null,
        other_name: otherName || null
      },
      updated_at: new Date().toISOString()
    });

    return true;
  }

  static async processChainReactions(client, { day, limit = 200 } = {}) {
    if (!client) throw new Error('client is required');

    const iso = safeIsoDay(day) || WorldDayService.todayISODate();
    const safeLimit = clampInt(limit, 1, 1000);

    const { rows } = await client.query(
      `SELECT id, agent_id, event_type, payload, salience_score, created_at
       FROM events
       WHERE COALESCE(chain_processed, FALSE) = FALSE
         AND event_type = ANY($1::text[])
       ORDER BY created_at ASC, id ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [TARGET_EVENT_TYPES, safeLimit]
    );

    const ctx = {
      worldAgentId: undefined,
      jaehoAgentId: undefined,
      ownerByAgent: new Map()
    };

    const counts = {
      ELECTION_WON: 0,
      ARENA_BIG_LOSS: 0,
      AGENT_FIRED: 0,
      SCANDAL_RESOLVED: 0,
      RELATIONSHIP_MILESTONE: 0
    };

    let handled = 0;
    let errors = 0;

    for (const row of rows || []) {
      const type = safeText(row?.event_type, 40).toUpperCase();
      let applied = false;
      let failed = false;

      try {
        if (type === 'ELECTION_WON' || type === 'ELECTION_CLOSED' || type === 'POLICY_CHANGED') {
          applied = await CrossSystemEventService._handleElection(client, row, ctx, iso);
          if (applied) counts.ELECTION_WON += 1;
        } else if (type === 'ARENA_BIG_LOSS' || type === 'ARENA_MATCH') {
          applied = await CrossSystemEventService._handleArenaBigLoss(client, row, ctx, iso);
          if (applied) counts.ARENA_BIG_LOSS += 1;
        } else if (type === 'AGENT_FIRED' || type === 'JOB_FIRED_INACTIVE') {
          applied = await CrossSystemEventService._handleAgentFired(client, row, ctx, iso);
          if (applied) counts.AGENT_FIRED += 1;
        } else if (type === 'SCANDAL_RESOLVED') {
          applied = await CrossSystemEventService._handleScandalResolved(client, row, ctx, iso);
          if (applied) counts.SCANDAL_RESOLVED += 1;
        } else if (type === 'RELATIONSHIP_MILESTONE') {
          applied = await CrossSystemEventService._handleRelationshipMilestone(client, row, ctx, iso);
          if (applied) counts.RELATIONSHIP_MILESTONE += 1;
        }
      } catch {
        errors += 1;
        failed = true;
      }

      if (!failed) {
        await client.query(
          `UPDATE events
           SET chain_processed = TRUE
           WHERE id = $1`,
          [row.id]
        ).catch(() => null);
      }

      if (applied) handled += 1;
    }

    return {
      ok: true,
      day: iso,
      scanned: rows?.length || 0,
      handled,
      errors,
      counts
    };
  }

  static async getWorldTickerWithClient(client, { day = null } = {}) {
    if (!client) throw new Error('client is required');

    const resolvedDay = safeIsoDay(day) || (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();

    const { rows: electionRows } = await client.query(
      `SELECT id, office_code, phase, registration_day, campaign_start_day, voting_day, term_start_day, term_end_day
       FROM elections
       WHERE phase <> 'closed'
       ORDER BY
         CASE phase
           WHEN 'voting' THEN 0
           WHEN 'campaign' THEN 1
           WHEN 'registration' THEN 2
           ELSE 9
         END,
         voting_day ASC,
         created_at DESC
       LIMIT 1`
    );
    const electionRow = electionRows?.[0] ?? null;

    const election = electionRow
      ? {
        phase: safeText(electionRow.phase, 24) || 'registration',
        progress: toElectionProgress(electionRow.phase),
        ends_in_hours:
          electionRow.phase === 'registration'
            ? hoursToDayStart(electionRow.campaign_start_day)
            : electionRow.phase === 'campaign'
              ? hoursToDayStart(electionRow.voting_day)
              : electionRow.phase === 'voting'
                ? hoursToDayStart(electionRow.term_start_day)
                : null
      }
      : null;

    const { rows: econRows } = await client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN amount ELSE 0 END), 0)::numeric AS cur,
         COALESCE(SUM(CASE WHEN created_at < NOW() - INTERVAL '24 hours' AND created_at >= NOW() - INTERVAL '48 hours' THEN amount ELSE 0 END), 0)::numeric AS prev
       FROM transactions
       WHERE tx_type IN ('REVENUE','SALARY','PURCHASE','TAX','SCANDAL')`
    );

    const curFlow = Number(econRows?.[0]?.cur ?? 0) || 0;
    const prevFlow = Number(econRows?.[0]?.prev ?? 0) || 0;
    const trendPct = prevFlow > 0 ? ((curFlow - prevFlow) / prevFlow) * 100 : curFlow > 0 ? 100 : 0;

    const economy = {
      state: trendPct >= 5 ? 'boom' : trendPct <= -5 ? 'slump' : 'stable',
      trend: trendLabel(trendPct)
    };

    const { rows: liveRows } = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM arena_matches
       WHERE day = $1::date
         AND status = 'scheduled'`,
      [resolvedDay]
    );

    const latestMatch = await client
      .query(
        `SELECT id, meta
         FROM arena_matches
         WHERE status = 'resolved'
         ORDER BY day DESC, slot DESC, created_at DESC
         LIMIT 1`
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    let latestArenaText = null;
    if (latestMatch?.id) {
      const { rows: participantRows } = await client.query(
        `SELECT p.agent_id, p.outcome, COALESCE(a.display_name, a.name) AS display
         FROM arena_match_participants p
         JOIN agents a ON a.id = p.agent_id
         WHERE p.match_id = $1
         ORDER BY p.created_at ASC`,
        [latestMatch.id]
      );

      const names = (participantRows || []).map((r) => safeText(r.display, 24)).filter(Boolean);
      const winner = (participantRows || []).find((r) => String(r.outcome || '').toLowerCase() === 'win');
      const winnerName = safeText(winner?.display, 24);
      const headline = safeText(asObj(latestMatch.meta).headline, 120);

      if (names.length >= 2) {
        latestArenaText = `${names[0]} vs ${names[1]}: ${headline || (winnerName ? `${winnerName} 승리!` : '승부 결정!')}`;
      } else if (headline) {
        latestArenaText = headline;
      }
    }

    const worldIdRow = await client
      .query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`)
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    const worldId = worldIdRow?.id ?? null;

    let scandalOpen = 0;
    let scandalLatest = null;
    if (worldId) {
      const { rows: scandalRows } = await client.query(
        `SELECT COUNT(*)::int AS open_count
         FROM facts
         WHERE agent_id = $1
           AND kind = 'scandal'
           AND key LIKE 'accusation:match:%'
           AND COALESCE(value->>'status','open') = 'open'`,
        [worldId]
      );
      scandalOpen = clampInt(scandalRows?.[0]?.open_count ?? 0, 0, 1_000_000);

      const latestScandal = await client
        .query(
          `SELECT value
           FROM facts
           WHERE agent_id = $1
             AND kind = 'scandal'
             AND key LIKE 'accusation:match:%'
           ORDER BY updated_at DESC
           LIMIT 1`,
          [worldId]
        )
        .then((r) => r.rows?.[0]?.value ?? null)
        .catch(() => null);

      const scandalValue = asObj(latestScandal);
      const status = safeText(scandalValue.status, 20).toLowerCase();
      const verdict = resolveScandalVerdict(scandalValue);
      if (status === 'open') scandalLatest = '조작 의혹 재판 한창 진행 중... 결과가 어떻게 나올까?';
      else if (verdict === 'guilty') scandalLatest = '유죄 확정! 충격의 판결이 내려졌다';
      else if (verdict === 'not_guilty') scandalLatest = '극적 무죄! 반전의 판결';
      else scandalLatest = null;
    }

    const { rows: popRows } = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM agents WHERE name <> 'world_core') AS total,
         (SELECT COUNT(*)::int FROM agents WHERE name <> 'world_core' AND is_active = true AND last_active >= NOW() - INTERVAL '48 hours') AS active`
    );

    return {
      day: resolvedDay,
      election,
      economy,
      arena: {
        live_matches: clampInt(liveRows?.[0]?.n ?? 0, 0, 1_000_000),
        latest_result: latestArenaText
      },
      scandals: {
        open: scandalOpen,
        latest: scandalLatest
      },
      population: {
        total: clampInt(popRows?.[0]?.total ?? 0, 0, 1_000_000),
        active: clampInt(popRows?.[0]?.active ?? 0, 0, 1_000_000)
      }
    };
  }
}

module.exports = CrossSystemEventService;
