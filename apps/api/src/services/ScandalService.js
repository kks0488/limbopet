/**
 * ScandalService (P4)
 *
 * Minimal "accusation -> verdict" pipeline:
 * - After a big arena loss, the loser may file an accusation (10%).
 * - After 3 days, a deterministic verdict is applied (guilty/not_guilty).
 *
 * SSOT:
 * - facts(agent_id=world_core, kind='scandal', key=`accusation:match:${matchId}`)
 */

const TransactionService = require('./TransactionService');
const { ProgressionService } = require('./ProgressionService');
const DecisionService = require('./DecisionService');
const NotificationService = require('./NotificationService');
const RelationshipService = require('./RelationshipService');
const EconomyTickService = require('./EconomyTickService');

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

function formatIsoDayUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function safeText(v, maxLen = 240) {
  return String(v ?? '').trim().slice(0, Math.max(1, Math.trunc(Number(maxLen) || 240)));
}

function hash32(s) {
  const str = String(s || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed32) {
  let a = seed32 >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (a >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function getWorldAgentIdWithClient(client) {
  const row = await client
    .query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`)
    .then((r) => r.rows?.[0] ?? null)
    .catch(() => null);
  return row?.id ?? null;
}

class ScandalService {
  static async createWithClient(
    client,
    { day = null, accusedId, accuserId = null, kind = 'manual', source = 'manual', title = null, summary = null, data = {} } = {}
  ) {
    if (!client) return { created: false, skipped: true, reason: 'missing_client' };

    const iso = safeIsoDay(day) || formatIsoDayUTC(new Date());
    const accused = String(accusedId || '').trim();
    const accuser = String(accuserId || '').trim() || null;
    if (!accused) return { created: false, skipped: true, reason: 'missing_accused' };

    const worldId = await getWorldAgentIdWithClient(client);
    if (!worldId) return { created: false, skipped: true, reason: 'missing_world' };

    const scandalKind = safeText(kind, 48).toLowerCase() || 'manual';
    const scandalSource = safeText(source, 48).toLowerCase() || 'manual';
    const verdict = 'guilty';
    const key = `incident:${scandalKind}:${hash32(`${iso}:${accused}:${accuser || '-'}:${Date.now()}:${Math.random()}`).toString(16)}`;

    const payload = {
      kind: scandalKind,
      source: scandalSource,
      status: 'resolved',
      verdict,
      created_day: iso,
      resolved_day: iso,
      accused_id: accused,
      accuser_id: accuser,
      title: safeText(title || '부정 개입 적발', 180) || null,
      summary: safeText(summary || '부정 개입이 적발되어 스캔들로 기록됐어.', 400) || null,
      data: data && typeof data === 'object' ? data : {},
      updated_at: new Date().toISOString(),
    };

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'scandal', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key) DO NOTHING`,
      [worldId, key, JSON.stringify(payload)]
    );

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'SCANDAL_RESOLVED', $2::jsonb, 6)`,
      [
        worldId,
        JSON.stringify({
          day: iso,
          verdict,
          kind: scandalKind,
          source: scandalSource,
          accused_id: accused,
          accuser_id: accuser,
          title: payload.title,
          summary: payload.summary,
          data: payload.data,
        }),
      ]
    ).catch(() => null);

    const ownerUserId = await client
      .query(
        `SELECT owner_user_id
         FROM agents
         WHERE id = $1
         LIMIT 1`,
        [accused]
      )
      .then((r) => r.rows?.[0]?.owner_user_id ?? null)
      .catch(() => null);

    if (ownerUserId) {
      await NotificationService.create(client, ownerUserId, {
        type: 'SCANDAL_ALERT',
        title: payload.title || '스캔들 발생',
        body: payload.summary || '부정 개입 의혹이 커지고 있어.',
        data: {
          day: iso,
          kind: scandalKind,
          source: scandalSource,
          accused_id: accused,
          accuser_id: accuser,
          key,
        },
      }).catch(() => null);
    }

    return { created: true, key, verdict, day: iso };
  }

  static async maybeCreateArenaAccusationWithClient(client, { matchId, day, seed, accuserId, accusedId, bigMatch = false } = {}) {
    const id = String(matchId || '').trim();
    const iso = safeIsoDay(day);
    if (!client || !id || !iso) return { created: false };
    if (!bigMatch) return { created: false, skipped: true };

    const worldId = await getWorldAgentIdWithClient(client);
    if (!worldId) return { created: false, skipped: true };

    const key = `accusation:match:${id}`;
    const exists = await client
      .query(`SELECT 1 FROM facts WHERE agent_id = $1 AND kind = 'scandal' AND key = $2 LIMIT 1`, [worldId, key])
      .then((r) => Boolean(r.rows?.[0]))
      .catch(() => false);
    if (exists) return { created: false, exists: true };

    const rng = mulberry32(hash32(`${seed || id}:SCANDAL`));
    const cycle = await EconomyTickService.getCycleWithClient(client).catch(() => null);
    const recessionBonus = Number(cycle?.scandal_probability_bonus ?? 0) || 0;
    const scandalProb = Math.max(0.01, Math.min(0.95, 0.1 + recessionBonus));
    if (rng() >= scandalProb) return { created: false, skipped: true };

    const d = parseIsoDayUTC(iso);
    if (!d) return { created: false, skipped: true };
    d.setUTCDate(d.getUTCDate() + 3);
    const verdictDay = formatIsoDayUTC(d);

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'scandal', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key) DO NOTHING`,
      [
        worldId,
        key,
        JSON.stringify({
          kind: 'arena_accusation',
          match_id: id,
          accuser_id: String(accuserId || '') || null,
          accused_id: String(accusedId || '') || null,
          created_day: iso,
          verdict_day: verdictDay,
          status: 'open',
          response_choice: null
        })
      ]
    );

    // Loss aversion hook: if the accused is a user-owned pet, create a timed decision to respond.
    const accusedRow = await client
      .query(`SELECT owner_user_id FROM agents WHERE id = $1::uuid LIMIT 1`, [accusedId])
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    const ownerUserId = accusedRow?.owner_user_id ?? null;
    if (ownerUserId) {
      await NotificationService.create(client, ownerUserId, {
        type: 'SCANDAL_ALERT',
        title: '충격! 조작 의혹 폭발',
        body: '아레나 경기 결과를 두고 수상하다는 소문이 퍼지고 있어... 빨리 대응 안 하면 큰일 나!',
        data: {
          match_id: id,
          fact_key: key,
          verdict_day: verdictDay
        }
      }).catch(() => null);

      await DecisionService.createDecision(
        {
          agentId: accusedId,
          userId: ownerUserId,
          type: 'SCANDAL_RESPONSE',
          expiresIn: 72 * 60 * 60,
          choices: [
            { id: 'deny', label: '끝까지 부인한다', effect: {} },
            { id: 'admit', label: '솔직히 인정한다', effect: {} }
          ],
          defaultChoice: 'admit',
          penalty: { coins: -5, xp: -15, condition: -10 },
          meta: {
            scandal: {
              fact_agent_id: worldId,
              fact_key: key,
              match_id: id
            }
          }
        },
        client
      ).catch(() => null);
    }

    return { created: true, key, verdict_day: verdictDay };
  }

  static async tickWithClient(client, { day } = {}) {
    const iso = safeIsoDay(day);
    if (!client || !iso) return { ok: false, processed: 0 };

    const worldId = await getWorldAgentIdWithClient(client);
    if (!worldId) return { ok: true, processed: 0 };

    const { rows } = await client.query(
      `SELECT id, key, value
       FROM facts
       WHERE agent_id = $1
         AND kind = 'scandal'
         AND key LIKE 'accusation:match:%'
         AND COALESCE(value->>'status','open') = 'open'
         AND COALESCE(value->>'verdict_day','9999-12-31')::date <= $2::date
       ORDER BY updated_at ASC
       LIMIT 50`,
      [worldId, iso]
    );

    let processed = 0;
    for (const row of rows || []) {
      const v = row.value && typeof row.value === 'object' ? row.value : {};
      const matchId = String(v.match_id || '').trim();
      if (!matchId) continue;

      const match = await client
        .query(`SELECT id, season_id, meta FROM arena_matches WHERE id = $1::uuid LIMIT 1`, [matchId])
        .then((r) => r.rows?.[0] ?? null)
        .catch(() => null);
      if (!match?.id) continue;

      const meta = match.meta && typeof match.meta === 'object' ? match.meta : {};
      const stake = meta.stake && typeof meta.stake === 'object' ? meta.stake : {};
      const toWinner = clampInt(stake.to_winner ?? 0, 0, 1_000_000_000);
      const wager = clampInt(stake.wager ?? 0, 0, 1_000_000_000);

      const accuserId = String(v.accuser_id || '').trim() || null;
      const accusedId = String(v.accused_id || '').trim() || null;
      if (!accuserId || !accusedId) continue;

      const rng = mulberry32(hash32(`${matchId}:VERDICT`));
      const response = String(v.response_choice || '').trim();
      const baseProb = wager >= 4 ? 0.35 : 0.2;
      const guiltyProb = response === 'deny' ? baseProb * 0.6 : baseProb;
      const guilty = response === 'admit' ? true : rng() < guiltyProb;

      let coinsBurned = 0;
      let ratingAdjust = null;

      if (guilty) {
        // Coin confiscation (burn) from accused.
        const bal = await TransactionService.getBalance(accusedId, client).catch(() => 0);
        coinsBurned = Math.max(0, Math.min(bal, Math.max(1, toWinner)));
        if (coinsBurned > 0) {
          await TransactionService.transfer(
            {
              fromAgentId: accusedId,
              toAgentId: null,
              amount: coinsBurned,
              txType: 'SCANDAL',
              memo: `arena scandal guilty (day:${iso})`,
              referenceId: matchId,
              referenceType: 'arena_scandal'
            },
            client
          ).catch(() => null);
        }

        // Rating swing (simple).
        const seasonId = match.season_id;
        const delta = 20;
        const aRow = await client
          .query(`SELECT rating FROM arena_ratings WHERE season_id = $1 AND agent_id = $2 LIMIT 1`, [seasonId, accusedId])
          .then((r) => r.rows?.[0] ?? null)
          .catch(() => null);
        const bRow = await client
          .query(`SELECT rating FROM arena_ratings WHERE season_id = $1 AND agent_id = $2 LIMIT 1`, [seasonId, accuserId])
          .then((r) => r.rows?.[0] ?? null)
          .catch(() => null);
        const accusedRating = clampInt(aRow?.rating ?? 1000, 400, 4000);
        const accuserRating = clampInt(bRow?.rating ?? 1000, 400, 4000);
        const accusedAfter = clampInt(accusedRating - delta, 400, 4000);
        const accuserAfter = clampInt(accuserRating + delta, 400, 4000);
        await client.query(
          `UPDATE arena_ratings SET rating = $3, updated_at = NOW() WHERE season_id = $1 AND agent_id = $2`,
          [seasonId, accusedId, accusedAfter]
        ).catch(() => null);
        await client.query(
          `UPDATE arena_ratings SET rating = $3, updated_at = NOW() WHERE season_id = $1 AND agent_id = $2`,
          [seasonId, accuserId, accuserAfter]
        ).catch(() => null);
        ratingAdjust = { accused: -delta, accuser: +delta };

        await RelationshipService.recordMemoryWithClient(client, {
          fromAgentId: accusedId,
          toAgentId: accuserId,
          eventType: 'SCANDAL_GUILTY',
          summary: '조작 의혹, 결국 유죄... 씻을 수 없는 오점이 남았다',
          emotion: 'shame',
          day: iso
        }).catch(() => null);
      } else {
        // False accusation penalty: tiny coin burn + xp penalty.
        await TransactionService.transfer(
          {
            fromAgentId: accuserId,
            toAgentId: null,
            amount: 1,
            txType: 'SCANDAL',
            memo: `arena scandal false accusation (day:${iso})`,
            referenceId: matchId,
            referenceType: 'arena_scandal'
          },
          client
        ).catch(() => null);
        await ProgressionService.adjustXpWithClient(client, accuserId, {
          deltaXp: -5,
          day: iso,
          source: { kind: 'scandal', code: 'false_accusation' },
          meta: { match_id: matchId }
        }).catch(() => null);
      }

      const scandalMeta = {
        status: guilty ? 'guilty' : 'not_guilty',
        resolved_day: iso,
        coins_burned: coinsBurned,
        rating_adjust: ratingAdjust
      };

      await client.query(
        `UPDATE arena_matches
         SET meta = $2::jsonb
         WHERE id = $1`,
        [matchId, JSON.stringify({ ...meta, scandal: scandalMeta })]
      ).catch(() => null);

      await client.query(
        `UPDATE facts
         SET value = $2::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [row.id, JSON.stringify({ ...v, status: 'resolved', verdict: scandalMeta.status, resolved_day: iso })]
      ).catch(() => null);

      processed += 1;
    }

    return { ok: true, processed };
  }
}

module.exports = ScandalService;
