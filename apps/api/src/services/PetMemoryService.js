/**
 * PetMemoryService
 *
 * Stores nudges/facts and daily summaries ("Limbo Rooms").
 */

const { queryAll, queryOne, transaction } = require('../config/database');
const { BadRequestError } = require('../utils/errors');
const NpcSeedService = require('./NpcSeedService');
const NudgeQueueService = require('./NudgeQueueService');
const MemoryRollupService = require('./MemoryRollupService');

function todayISODate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseIsoDayUTC(iso) {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map((x) => Number(x));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function decayFactorForFactKind(kind, ageDays) {
  const k = String(kind || '').trim().toLowerCase();
  const days = Math.max(0, Number(ageDays) || 0);

  // Suggestions are "tactical" and should fade relatively quickly.
  if (k === 'suggestion') return Math.pow(0.5, days / 10);
  // Preferences/forbidden are "identity" and should fade slowly.
  if (k === 'preference' || k === 'forbidden') return Math.pow(0.5, days / 120);
  if (k === 'profile') return Math.pow(0.5, days / 365);
  if (k === 'streak') return Math.pow(0.5, days / 30);
  return 1;
}

function selectFactsForDailySummary(allFacts, { day, limit = 50 } = {}) {
  const iso = String(day || '').trim();
  const targetDay = parseIsoDayUTC(iso);
  const safeLimit = Math.max(1, Math.min(80, Number(limit) || 50));
  const rows = Array.isArray(allFacts) ? allFacts : [];

  const caps = new Map([
    ['suggestion', 6],
    ['preference', 10],
    ['forbidden', 8],
    ['profile', 6],
    ['streak', 2]
  ]);

  const normalized = [];
    for (const f of rows) {
      const kind = String(f?.kind ?? '').trim();
      const key = String(f?.key ?? '').trim();
      if (!kind || !key) continue;

      // Relationship milestone facts are tracked elsewhere (events + relationship UI).
      if (kind === 'relationship') continue;
      // "direction" is a short-lived stage direction (UI + prompts), not a stable daily fact.
      if (kind === 'direction') continue;
      if (kind === 'world' || kind === 'world_worker') continue;

    const confidence = Math.max(0, Math.min(2.0, Number(f?.confidence ?? 1.0) || 1.0));
    const updatedAt = f?.updated_at ? new Date(String(f.updated_at)) : null;
    const ageDays =
      targetDay && updatedAt && Number.isFinite(updatedAt.getTime())
        ? Math.max(0, (targetDay.getTime() - updatedAt.getTime()) / (24 * 3600 * 1000))
        : 0;
    const decay = decayFactorForFactKind(kind, ageDays);
    const score = confidence * decay;

    normalized.push({
      kind,
      key,
      value: f?.value ?? {},
      confidence,
      updated_at: f?.updated_at ?? null,
      _score: score
    });
  }

  normalized.sort((a, b) => {
    const ds = Number(b._score) - Number(a._score);
    if (ds !== 0) return ds;
    const ta = a.updated_at ? new Date(String(a.updated_at)).getTime() : 0;
    const tb = b.updated_at ? new Date(String(b.updated_at)).getTime() : 0;
    return tb - ta;
  });

  const picked = [];
  const usedByKind = new Map();
  const seen = new Set();

  for (const f of normalized) {
    const k = String(f.kind || '').trim().toLowerCase() || 'other';
    const cap = caps.has(k) ? caps.get(k) : 0;
    if (cap <= 0) continue;

    const id = `${k}:${String(f.key || '').trim()}`;
    if (seen.has(id)) continue;

    const used = usedByKind.get(k) || 0;
    if (used >= cap) continue;

    seen.add(id);
    usedByKind.set(k, used + 1);
    picked.push({ kind: f.kind, key: f.key, value: f.value, confidence: f.confidence });
    if (picked.length >= safeLimit) break;
  }

  return picked;
}

function buildDailySignals(events) {
  const list = Array.isArray(events) ? events : [];

  const spending = {
    total_spent: 0,
    burned: 0,
    gifts: 0,
    failed: 0,
    by_code: {}
  };

  const social = {
    interactions: 0,
    by_scenario: {},
    top_partners: {}
  };

  const milestones = [];

  const arena = {
    played: 0,
    wins: 0,
    losses: 0,
    forfeits: 0,
    coins_net: 0,
    by_mode: {},
    top_rivals: {}
  };

  for (const e of list) {
    const type = String(e?.event_type ?? '').trim().toUpperCase();
    const p = e?.payload && typeof e.payload === 'object' ? e.payload : {};

    if (type === 'SPENDING') {
      const code = String(p?.code ?? '').trim() || 'unknown';
      const cost = clampInt(p?.cost ?? 0, 0, 1_000_000);
      const burned = Boolean(p?.burned);

      spending.total_spent += cost;
      if (burned) spending.burned += cost;
      if (code === 'gift') spending.gifts += cost;
      spending.by_code[code] = spending.by_code[code] || { count: 0, total: 0 };
      spending.by_code[code].count += 1;
      spending.by_code[code].total += cost;
    } else if (type === 'SPENDING_FAILED') {
      spending.failed += 1;
    } else if (type === 'SOCIAL') {
      social.interactions += 1;
      const scenario = String(p?.scenario ?? '').trim().toUpperCase() || 'MEET';
      social.by_scenario[scenario] = (social.by_scenario[scenario] || 0) + 1;
      const partner = String(p?.with_name ?? '').trim();
      if (partner) social.top_partners[partner] = (social.top_partners[partner] || 0) + 1;
    } else if (type === 'RELATIONSHIP_MILESTONE') {
      const summary = String(p?.summary ?? '').trim();
      if (summary) milestones.push(summary);
    } else if (type === 'ARENA_MATCH') {
      arena.played += 1;
      const outcome = String(p?.outcome ?? '').trim().toLowerCase();
      if (outcome === 'win') arena.wins += 1;
      else if (outcome === 'forfeit') arena.forfeits += 1;
      else arena.losses += 1;

      const coins = clampInt(p?.coins_net ?? 0, -1_000_000, 1_000_000);
      arena.coins_net += coins;

      const mode = String(p?.mode_label ?? p?.mode ?? '').trim().toUpperCase() || 'MATCH';
      arena.by_mode[mode] = (arena.by_mode[mode] || 0) + 1;

      const opp = p?.opponent && typeof p.opponent === 'object' ? p.opponent : null;
      const rival = String(opp?.name ?? '').trim();
      if (rival) arena.top_rivals[rival] = (arena.top_rivals[rival] || 0) + 1;
    }
  }

  const topPartners = Object.entries(social.top_partners)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));

  const topRivals = Object.entries(arena.top_rivals)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));

  return {
    spending,
    social: { interactions: social.interactions, by_scenario: social.by_scenario, top_partners: topPartners },
    arena: {
      played: arena.played,
      wins: arena.wins,
      losses: arena.losses,
      forfeits: arena.forfeits,
      coins_net: arena.coins_net,
      by_mode: arena.by_mode,
      top_rivals: topRivals
    },
    relationship_milestones: milestones.slice(-6)
  };
}

function selectEventsForDailySummary(allEvents, { limit = 60 } = {}) {
  const list = Array.isArray(allEvents) ? allEvents : [];
  const safeLimit = Math.max(10, Math.min(120, Number(limit) || 60));
  if (list.length <= safeLimit) return list;

  const scored = list.map((e, idx) => {
    const type = String(e?.event_type ?? '').trim().toUpperCase();
    const base = clampInt(e?.salience_score ?? 0, 0, 10);
    let bonus = 0;
    if (type === 'RELATIONSHIP_MILESTONE') bonus += 4;
    else if (type === 'ARENA_MATCH') bonus += 3;
    else if (type === 'SPENDING_FAILED') bonus += 3;
    else if (type === 'SOCIAL') bonus += 2;
    else if (type === 'SPENDING') bonus += 1;
    else if (type === 'DIARY_POST') bonus += 2;
    else if (type === 'DIALOGUE') bonus += 1;
    return { idx, score: base + bonus };
  });

  const picked = new Set();

  // Always keep the last few events for recency.
  const tail = 12;
  for (let i = Math.max(0, list.length - tail); i < list.length; i += 1) picked.add(i);

  // Keep all high-salience events.
  for (const s of scored) {
    if (s.score >= 7) picked.add(s.idx);
  }

  // Fill remaining slots by score.
  scored.sort((a, b) => b.score - a.score);
  for (const s of scored) {
    if (picked.size >= safeLimit) break;
    picked.add(s.idx);
  }

  const out = [...picked].sort((a, b) => a - b).map((i) => list[i]);
  return out.slice(0, safeLimit);
}

function normalizeNudgeKind(type) {
  switch (type) {
    case 'sticker':
      return 'preference';
    case 'forbid':
      return 'forbidden';
    case 'suggestion':
      return 'suggestion';
    default:
      return null;
  }
}

function classifyNudge(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return 'suggestion';

  // 금지 패턴
  const forbidPatterns = [
    /하지\s*마/,
    /하지\s*말/,
    /금지/,
    /싫어/,
    /안\s*돼/,
    /그만/,
    /\bno\b/i,
    /don't/i,
    /\bstop\b/i,
    /\bnever\b/i
  ];
  if (forbidPatterns.some((p) => p.test(t))) return 'forbid';

  // 선호 패턴
  const preferPatterns = [/해\s*줘/, /해줘/, /좋아/, /많이/, /자주/, /했으면/, /please/i, /more/i, /want/i];
  if (preferPatterns.some((p) => p.test(t))) return 'sticker';

  return 'suggestion';
}

class PetMemoryService {
  static _addDays(isoDay, days) {
    const [y, m, d] = String(isoDay).split('-').map((x) => Number(x));
    if (!y || !m || !d) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  static async recordDailyCheckin(agentId, day) {
    const iso = String(day || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      throw new BadRequestError('Invalid day format (YYYY-MM-DD)');
    }

    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, value
         FROM facts
         WHERE agent_id = $1 AND kind = 'streak' AND key = 'limbo_checkin'
         LIMIT 1`,
        [agentId]
      );

      const existing = rows[0];
      const prev = existing?.value && typeof existing.value === 'object' ? existing.value : {};
      const lastDay = typeof prev?.lastDay === 'string' ? prev.lastDay : null;
      const prevStreak = Number(prev?.streak ?? 0) || 0;

      let nextStreak = prevStreak;
      if (!lastDay) {
        nextStreak = 1;
      } else if (lastDay === iso) {
        nextStreak = Math.max(1, prevStreak || 1);
      } else {
        const expected = PetMemoryService._addDays(lastDay, 1);
        nextStreak = expected === iso ? Math.max(1, prevStreak + 1) : 1;
      }

      const value = { lastDay: iso, streak: nextStreak };

      const { rows: upserted } = await client.query(
        `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
         VALUES ($1, 'streak', 'limbo_checkin', $2::jsonb, 1.0, NOW())
         ON CONFLICT (agent_id, kind, key)
         DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()
         RETURNING kind, key, value, updated_at`,
        [agentId, JSON.stringify(value)]
      );

      return upserted[0];
    });
  }

  static async listFacts(agentId, { limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return queryAll(
      `SELECT kind, key, value, confidence, updated_at
       FROM facts
       WHERE agent_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [agentId, safeLimit]
    );
  }

  static async upsertNudges(agentId, nudges) {
    if (!Array.isArray(nudges) || nudges.length === 0) {
      throw new BadRequestError('nudges[] is required');
    }

    // Best-effort: enqueue a "cast hint" so the next episode can feature this pet.
    // (Do this outside the DB transaction because ensureSeeded() uses its own transaction.)
    const worldId =
      (await queryOne(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`).then((r) => r?.id ?? null).catch(() => null)) ||
      (await NpcSeedService.ensureSeeded()
        .then((r) => r?.world?.id ?? null)
        .catch(() => null));

    return transaction(async (client) => {
      const results = [];

      for (const nudge of nudges) {
        const inputType = nudge?.type ? String(nudge.type).trim() : null;
        const inputText = String(nudge?.text ?? '').trim();

        const type = inputType || classifyNudge(inputText || nudge?.key);
        const kind = normalizeNudgeKind(type);
        if (!kind) throw new BadRequestError(`Invalid nudge type: ${type}`);

        const key = String((inputType ? nudge?.key ?? inputText : inputText || nudge?.key) ?? '').trim();
        if (!key) throw new BadRequestError(inputType ? 'nudge.key is required' : 'nudge.text is required');
        if (key.length > 64) throw new BadRequestError('nudge.text max length is 64');

        const value = nudge?.value ?? (inputType ? {} : { text: key });

        const { rows } = await client.query(
          `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, 1.0, NOW())
           ON CONFLICT (agent_id, kind, key)
           DO UPDATE SET
             value = EXCLUDED.value,
             confidence = CASE
               WHEN facts.value = EXCLUDED.value THEN LEAST(facts.confidence + 0.1, 2.0)
               ELSE 1.0
             END,
             updated_at = NOW()
           RETURNING kind, key, value, confidence, updated_at`,
          [agentId, kind, key, JSON.stringify(value)]
        );
        results.push(rows[0]);
      }

      const ownerUserId = await client
        .query(`SELECT owner_user_id FROM agents WHERE id = $1 LIMIT 1`, [agentId])
        .then((r) => r.rows?.[0]?.owner_user_id ?? null)
        .catch(() => null);

      // SSOT v3: store the latest nudge as a short-term "stage direction" fact (24h TTL).
      if (ownerUserId && results.length > 0) {
        const last = results[results.length - 1];
        const text = String(last?.key ?? '').trim();
        const kind = String(last?.kind ?? '').trim();
        if (text) {
          const strength = kind === 'forbidden' ? 3 : kind === 'preference' ? 2 : 1;
          const now = new Date();
          const createdAt = now.toISOString();
          const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

          await client
            .query(
              `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
               VALUES ($1, 'direction', 'latest', $2::jsonb, 1.0, NOW())
               ON CONFLICT (agent_id, kind, key)
               DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
              [
                agentId,
                JSON.stringify({
                  text,
                  kind,
                  strength,
                  source: 'user_nudge',
                  user_id: ownerUserId,
                  created_at: createdAt,
                  expires_at: expiresAt
                })
              ]
            )
            .catch(() => null);
        }
      }

      if (worldId && results.length > 0) {
        const last = results[results.length - 1];
        await NudgeQueueService.enqueueWithClient(client, {
          worldId,
          agentId,
          userId: ownerUserId,
          kind: last?.kind ?? 'nudge',
          key: last?.key ?? ''
        }).catch(() => null);
      }

      return results;
    });
  }

  static async getDailyMemory(agentId, day) {
    return queryOne(
      `SELECT id, day, summary, created_at
       FROM memories
       WHERE agent_id = $1 AND scope = 'daily' AND day = $2`,
      [agentId, day]
    );
  }

  static async getWeeklyMemory(agentId, day) {
    const iso = String(day || '').trim();
    if (!iso) return null;
    const weekStart = MemoryRollupService.weekStartDay(iso);
    return queryOne(
      `SELECT id, day, summary, created_at
       FROM memories
       WHERE agent_id = $1 AND scope = 'weekly' AND day = $2`,
      [agentId, weekStart]
    );
  }

  static async ensureWeeklyMemory(agentId, day) {
    const iso = String(day || '').trim();
    if (!iso) return null;
    return transaction(async (client) => {
      return MemoryRollupService.ensureWeeklyMemoryWithClient(client, agentId, iso);
    });
  }

  static async ensureDailySummaryJob(agentId, day) {
    const checkin = await PetMemoryService.recordDailyCheckin(agentId, day);
    const existingMemory = await PetMemoryService.getDailyMemory(agentId, day);
    if (existingMemory) {
      const weekly = await PetMemoryService.ensureWeeklyMemory(agentId, day).catch(() => null);
      return { memory: existingMemory, weekly, job: null, checkin };
    }

    // If a job already exists for this day, return it.
    const existingJob = await queryOne(
      `SELECT id, job_type, status, created_at
       FROM brain_jobs
       WHERE agent_id = $1
         AND job_type = 'DAILY_SUMMARY'
         AND (input->>'day') = $2
         AND status IN ('pending','leased')
       ORDER BY created_at DESC
       LIMIT 1`,
      [agentId, day]
    );

    if (existingJob) {
      const weekly = await PetMemoryService.ensureWeeklyMemory(agentId, day).catch(() => null);
      return { memory: null, weekly, job: existingJob, checkin };
    }

    // Build job input
    const [facts, events, stats] = await Promise.all([
      queryAll(
        `SELECT kind, key, value, confidence, updated_at
         FROM facts
         WHERE agent_id = $1
         ORDER BY updated_at DESC
         LIMIT 200`,
        [agentId]
      ),
      queryAll(
        `SELECT event_type, payload, salience_score, created_at
         FROM events
         WHERE agent_id = $1
           AND (
             ((payload ? 'day') AND (payload->>'day') = $2::text)
             OR (NOT (payload ? 'day') AND created_at::date = $2::date)
           )
         ORDER BY created_at ASC
         LIMIT 200`,
        [agentId, day]
      ),
      queryOne(
        `SELECT hunger, energy, mood, bond, curiosity, stress, updated_at
         FROM pet_stats
         WHERE agent_id = $1`,
        [agentId]
      )
    ]);

    const selectedFacts = selectFactsForDailySummary(facts, { day, limit: 50 });
    const selectedEvents = selectEventsForDailySummary(events, { limit: 60 });
    const signals = buildDailySignals(events);

    const input = {
      kind: 'daily_summary',
      day,
      stats,
      facts: selectedFacts,
      events: selectedEvents,
      signals: {
        ...signals,
        totals: {
          facts_total: Array.isArray(facts) ? facts.length : 0,
          events_total: Array.isArray(events) ? events.length : 0
        }
      }
    };

    const job = await queryOne(
      `INSERT INTO brain_jobs (agent_id, job_type, input)
       VALUES ($1, 'DAILY_SUMMARY', $2::jsonb)
       RETURNING id, job_type, status, created_at`,
      [agentId, JSON.stringify(input)]
    );

    const weekly = await PetMemoryService.ensureWeeklyMemory(agentId, day).catch(() => null);
    return { memory: null, weekly, job, checkin };
  }

  static getTodayISODate() {
    return todayISODate();
  }
}

module.exports = PetMemoryService;
