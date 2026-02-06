/**
 * NudgeQueueService
 *
 * A tiny "meaningful nudge" bridge:
 * - User submits a nudge (stored as facts).
 * - We enqueue a lightweight cast hint on the world agent.
 * - The showrunner consumes one hint per episode and tries to feature that pet.
 *
 * Storage: facts(agent_id=world_core, kind='world', key='nudge_queue', value=jsonb[])
 *
 * Notes:
 * - NPCs are not eligible (owner_user_id must be set).
 * - Best-effort: if a hinted agent disappears, the hint is dropped.
 */

const crypto = require('crypto');

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function asQueue(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.queue)) return value.queue;
  return [];
}

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

function isValidUuid(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function normalizeEntry(raw) {
  const agentId = typeof raw?.agent_id === 'string' ? raw.agent_id : null;
  const userId = typeof raw?.user_id === 'string' ? raw.user_id : null;
  if (!isValidUuid(agentId) || !isValidUuid(userId)) return null;

  const id = typeof raw?.id === 'string' ? raw.id : crypto.randomBytes(8).toString('hex');
  const kind = safeText(raw?.kind, 24) || 'nudge';
  const key = safeText(raw?.key, 64) || '';
  const createdAt = typeof raw?.created_at === 'string' ? raw.created_at : new Date().toISOString();

  return { id, agent_id: agentId, user_id: userId, kind, key, created_at: createdAt };
}

class NudgeQueueService {
  static async _lockQueueRow(client, worldId) {
    const { rows } = await client.query(
      `SELECT id, value
       FROM facts
       WHERE agent_id = $1 AND kind = 'world' AND key = 'nudge_queue'
       FOR UPDATE`,
      [worldId]
    );
    if (rows?.[0]) return rows[0];

    // Create an empty queue row so subsequent callers can lock it reliably.
    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'world', 'nudge_queue', '[]'::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key) DO NOTHING`,
      [worldId]
    );

    const { rows: rows2 } = await client.query(
      `SELECT id, value
       FROM facts
       WHERE agent_id = $1 AND kind = 'world' AND key = 'nudge_queue'
       FOR UPDATE`,
      [worldId]
    );
    return rows2?.[0] ?? null;
  }

  static _filterAndClamp(queue, { maxSize = 50, maxAgeHours = 36 } = {}) {
    const safeMaxSize = clampInt(maxSize, 1, 200);
    const safeMaxAgeHours = clampInt(maxAgeHours, 1, 24 * 14);
    const cutoffMs = Date.now() - safeMaxAgeHours * 60 * 60 * 1000;

    const normalized = [];
    for (const raw of Array.isArray(queue) ? queue : []) {
      const e = normalizeEntry(raw);
      if (!e) continue;
      const ts = Date.parse(e.created_at);
      if (Number.isFinite(ts) && ts < cutoffMs) continue;
      normalized.push(e);
    }

    return normalized.slice(-safeMaxSize);
  }

  static async enqueueWithClient(client, { worldId, agentId, userId, kind, key }) {
    if (!isValidUuid(worldId)) return null;
    if (!isValidUuid(agentId) || !isValidUuid(userId)) return null;

    // Ensure this is a real user-owned pet.
    const owner = await client
      .query(`SELECT owner_user_id FROM agents WHERE id = $1 LIMIT 1`, [agentId])
      .then((r) => r.rows?.[0]?.owner_user_id ?? null)
      .catch(() => null);
    if (!owner) return null;

    const row = await NudgeQueueService._lockQueueRow(client, worldId);
    const prev = row?.value && typeof row.value === 'object' ? row.value : null;
    const queue = NudgeQueueService._filterAndClamp(asQueue(prev), { maxSize: 50, maxAgeHours: 36 });

    // One active hint per agent: keep it fresh (last write wins).
    const filtered = queue.filter((e) => e.agent_id !== agentId);
    const entry = normalizeEntry({
      id: crypto.randomBytes(8).toString('hex'),
      agent_id: agentId,
      user_id: userId,
      kind: safeText(kind, 24) || 'nudge',
      key: safeText(key, 64) || '',
      created_at: new Date().toISOString()
    });
    if (!entry) return null;

    filtered.push(entry);

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'world', 'nudge_queue', $2::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
      [worldId, JSON.stringify(filtered)]
    );

    // [SSOT-Driven] Store the nudge as a 'suggestion' fact for the agent so SocialSimService picks it up.
    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'suggestion', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
      [agentId, entry.key, JSON.stringify({ source: 'user_nudge', user_id: userId })]
    );

    return entry;
  }

  static async popNextWithClient(client, { worldId }) {
    if (!isValidUuid(worldId)) return null;

    const row = await NudgeQueueService._lockQueueRow(client, worldId);
    const prev = row?.value && typeof row.value === 'object' ? row.value : null;
    const queue = NudgeQueueService._filterAndClamp(asQueue(prev), { maxSize: 50, maxAgeHours: 36 });

    if (queue.length === 0) return null;

    const next = queue.shift();
    const entry = normalizeEntry(next);

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'world', 'nudge_queue', $2::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
      [worldId, JSON.stringify(queue)]
    );

    if (!entry) return null;

    // Drop if the agent is no longer eligible.
    const eligible = await client
      .query(
        `SELECT id
         FROM agents
         WHERE id = $1 AND is_active = true AND owner_user_id IS NOT NULL
         LIMIT 1`,
        [entry.agent_id]
      )
      .then((r) => Boolean(r.rows?.[0]?.id))
      .catch(() => false);

    return eligible ? entry : null;
  }
}

module.exports = NudgeQueueService;
