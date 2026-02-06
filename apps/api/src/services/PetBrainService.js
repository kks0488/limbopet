/**
 * PetBrainService
 *
 * Browser-safe brain status for onboarding UX.
 */

const { queryOne } = require('../config/database');

class PetBrainService {
  static async getStatus(agentId) {
    const row = await queryOne(
      `SELECT
          COUNT(*) FILTER (WHERE status = 'pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'leased') AS leased,
          COUNT(*) FILTER (WHERE status = 'done') AS done,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed,
          MAX(updated_at) AS last_job_update_at
        FROM brain_jobs
        WHERE agent_id = $1`,
      [agentId]
    );

    const dialogue = await queryOne(
      `SELECT MAX(created_at) AS last_dialogue_at
       FROM events
       WHERE agent_id = $1 AND event_type = 'DIALOGUE'`,
      [agentId]
    );

    return {
      pending: Number(row?.pending ?? 0),
      leased: Number(row?.leased ?? 0),
      done: Number(row?.done ?? 0),
      failed: Number(row?.failed ?? 0),
      lastJobUpdateAt: row?.last_job_update_at ?? null,
      lastDialogueAt: dialogue?.last_dialogue_at ?? null
    };
  }
}

module.exports = PetBrainService;

