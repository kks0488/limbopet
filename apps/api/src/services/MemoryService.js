/**
 * MemoryService
 *
 * Thin helpers for the `facts` table (used as structured memory / world facts).
 *
 * NOTE: Many services have local `upsertFact` helpers; this module exists mainly
 * for shared read/write needs (e.g., world_core concept sync).
 */

async function upsertFact(client, agentId, kind, key, value, confidence = 1.0) {
  await client.query(
    `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
     ON CONFLICT (agent_id, kind, key)
     DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
    [agentId, kind, key, JSON.stringify(value), confidence]
  );
}

async function getFactsByAgent(client, agentId, kind) {
  const k = String(kind || '').trim();
  const hasKind = Boolean(k);

  const { rows } = await client.query(
    `SELECT kind, key, value, confidence, updated_at
     FROM facts
     WHERE agent_id = $1
       AND ($2::text IS NULL OR kind = $2)
     ORDER BY updated_at DESC`,
    [agentId, hasKind ? k : null]
  );

  return (rows || []).map((r) => ({
    kind: r.kind,
    key: r.key,
    data: r.value,
    confidence: r.confidence,
    updated_at: r.updated_at
  }));
}

module.exports = {
  upsertFact,
  getFactsByAgent
};

