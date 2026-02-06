/**
 * RumorService
 *
 * Stores structured rumor state + evidence tokens to create continuity.
 */

const { transaction } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function safeScenario(s) {
  const v = String(s || '').trim().toUpperCase();
  if (!v) throw new BadRequestError('scenario is required');
  if (v.length > 32) throw new BadRequestError('scenario too long');
  return v;
}

class RumorService {
  static async listOpen({ limit = 10 } = {}) {
    return transaction(async (client) => RumorService.listOpenWithClient(client, { limit }));
  }

  static async listOpenWithClient(client, { limit = 10 } = {}) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
    const { rows } = await client.query(
      `SELECT id, world_day, scenario, status, origin_agent_id, subject_a_id, subject_b_id,
              claim, distortion, evidence_level, episode_post_id, created_at, updated_at, resolved_at
       FROM rumors
       WHERE status = 'open'
       ORDER BY created_at DESC
       LIMIT $1`,
      [safeLimit]
    );
    return rows;
  }

  static async getRumorWithEvidence(rumorId) {
    return transaction(async (client) => RumorService.getRumorWithEvidenceWithClient(client, rumorId));
  }

  static async getRumorWithEvidenceWithClient(client, rumorId) {
    const { rows } = await client.query(
      `SELECT id, world_day, scenario, status, origin_agent_id, subject_a_id, subject_b_id,
              claim, distortion, evidence_level, episode_post_id, resolution, created_at, updated_at, resolved_at
       FROM rumors
       WHERE id = $1`,
      [rumorId]
    );
    const rumor = rows[0];
    if (!rumor) throw new NotFoundError('Rumor');

    const evidence = await client
      .query(
        `SELECT id, kind, label, strength, source_agent_id, source_post_id, created_at
         FROM evidence_tokens
         WHERE rumor_id = $1
         ORDER BY created_at ASC`,
        [rumorId]
      )
      .then((r) => r.rows);

    const spread = await client
      .query(
        `SELECT id, from_agent_id, to_agent_id, via_post_id, via_comment_id, created_at
         FROM rumor_spread
         WHERE rumor_id = $1
         ORDER BY created_at ASC
         LIMIT 200`,
        [rumorId]
      )
      .then((r) => r.rows);

    return { rumor, evidence, spread };
  }

  static async create({
    worldDay,
    scenario,
    originAgentId,
    subjectAId = null,
    subjectBId = null,
    claim,
    evidence = [],
    episodePostId = null
  }) {
    return transaction(async (client) =>
      RumorService.createWithClient(client, {
        worldDay,
        scenario,
        originAgentId,
        subjectAId,
        subjectBId,
        claim,
        evidence,
        episodePostId
      })
    );
  }

  static async createWithClient(
    client,
    { worldDay, scenario, originAgentId, subjectAId = null, subjectBId = null, claim, evidence = [], episodePostId = null }
  ) {
    const scen = safeScenario(scenario);
    const safeClaim = String(claim || '').trim();
    if (!safeClaim) throw new BadRequestError('claim is required');

    const { rows } = await client.query(
      `INSERT INTO rumors (world_day, scenario, status, origin_agent_id, subject_a_id, subject_b_id, claim, distortion, evidence_level, episode_post_id)
       VALUES ($1, $2, 'open', $3, $4, $5, $6, 0, $7, $8)
       RETURNING id, world_day, scenario, status, evidence_level, created_at`,
      [worldDay, scen, originAgentId, subjectAId, subjectBId, safeClaim, clampInt(evidence.length, 0, 3), episodePostId]
    );

    const rumor = rows[0];
    if (!rumor) throw new Error('Failed to create rumor');

    for (const ev of Array.isArray(evidence) ? evidence : []) {
      const kind = String(ev?.kind ?? '').trim().slice(0, 32) || 'token';
      const label = String(ev?.label ?? '').trim().slice(0, 128) || 'evidence';
      const strength = clampInt(ev?.strength ?? 1, 1, 5);
      await client.query(
        `INSERT INTO evidence_tokens (rumor_id, kind, label, strength, source_agent_id, source_post_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [rumor.id, kind, label, strength, ev?.sourceAgentId ?? null, ev?.sourcePostId ?? null]
      );
    }

    return rumor;
  }

  static async addEvidence(rumorId, token) {
    return transaction(async (client) => RumorService.addEvidenceWithClient(client, rumorId, token));
  }

  static async addEvidenceWithClient(client, rumorId, token) {
    const kind = String(token?.kind ?? '').trim().slice(0, 32) || 'token';
    const label = String(token?.label ?? '').trim().slice(0, 128) || 'evidence';
    const strength = clampInt(token?.strength ?? 1, 1, 5);

    await client.query(
      `INSERT INTO evidence_tokens (rumor_id, kind, label, strength, source_agent_id, source_post_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [rumorId, kind, label, strength, token?.sourceAgentId ?? null, token?.sourcePostId ?? null]
    );

    const { rows } = await client.query(
      `UPDATE rumors
       SET evidence_level = LEAST(3, evidence_level + 1),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, evidence_level`,
      [rumorId]
    );

    if (!rows[0]) throw new NotFoundError('Rumor');
    return rows[0];
  }

  static async resolve(rumorId, { resolution }) {
    return transaction(async (client) => RumorService.resolveWithClient(client, rumorId, { resolution }));
  }

  static async resolveWithClient(client, rumorId, { resolution }) {
    const text = String(resolution || '').trim().slice(0, 2000) || null;
    const { rows } = await client.query(
      `UPDATE rumors
       SET status = 'resolved',
           resolution = $2,
           resolved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, resolved_at`,
      [rumorId, text]
    );
    if (!rows[0]) throw new NotFoundError('Rumor');
    return rows[0];
  }
}

module.exports = RumorService;

