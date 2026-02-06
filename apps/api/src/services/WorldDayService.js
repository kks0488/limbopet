/**
 * WorldDayService
 *
 * SSOT rule:
 * - The "current world day" is a single fact on world_core.
 * - All "today" world bundles/workers should default to this day (not system clock),
 *   so dev simulations can move time forward deterministically.
 */

const { queryOne } = require('../config/database');

function todayISODate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

async function getWorldIdWithClient(client) {
  if (!client) return null;
  const { rows } = await client.query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`);
  return rows?.[0]?.id ?? null;
}

async function getWorldId() {
  const row = await queryOne(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`, []).catch(() => null);
  return row?.id ?? null;
}

async function getCurrentDayWithClient(client, { fallbackDay = null } = {}) {
  const base = safeIsoDay(fallbackDay) || todayISODate();
  const worldId = await getWorldIdWithClient(client).catch(() => null);
  if (!worldId) return base;

  const row = await client
    .query(
      `SELECT value
       FROM facts
       WHERE agent_id = $1 AND kind = 'world' AND key = 'current_day'
       LIMIT 1`,
      [worldId]
    )
    .then((r) => r.rows?.[0] ?? null)
    .catch(() => null);

  const day = safeIsoDay(row?.value?.day);
  return day || base;
}

async function getCurrentDay({ fallbackDay = null } = {}) {
  const base = safeIsoDay(fallbackDay) || todayISODate();
  const worldId = await getWorldId().catch(() => null);
  if (!worldId) return base;

  const row = await queryOne(
    `SELECT value
     FROM facts
     WHERE agent_id = $1 AND kind = 'world' AND key = 'current_day'
     LIMIT 1`,
    [worldId]
  ).catch(() => null);

  const day = safeIsoDay(row?.value?.day);
  return day || base;
}

async function setCurrentDayWithClient(client, day, { source = null } = {}) {
  const iso = safeIsoDay(day);
  if (!iso) return null;

  const worldId = await getWorldIdWithClient(client).catch(() => null);
  if (!worldId) return null;

  const payload = {
    day: iso,
    source: source ? String(source).slice(0, 40) : null,
    set_at: new Date().toISOString()
  };

  await client.query(
    `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
     VALUES ($1, 'world', 'current_day', $2::jsonb, 1.0, NOW())
     ON CONFLICT (agent_id, kind, key)
     DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
    [worldId, JSON.stringify(payload)]
  );

  return payload;
}

module.exports = {
  todayISODate,
  safeIsoDay,
  getCurrentDay,
  getCurrentDayWithClient,
  setCurrentDayWithClient
};

