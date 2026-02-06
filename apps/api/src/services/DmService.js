/**
 * DmService (idea 003 prerequisite)
 *
 * DM is intentionally "fast + internal":
 * - High volume is okay (DB writes), but it should not spam the public plaza.
 * - It becomes a substrate for secret societies and future investigations.
 */

function threadKey(aId, bId) {
  const a = String(aId);
  const b = String(bId);
  return [a, b].sort().join(':');
}

function orderedPair(aId, bId) {
  const a = String(aId);
  const b = String(bId);
  return a < b ? [a, b] : [b, a];
}

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

class DmService {
  static async ensureThreadWithClient(client, aId, bId) {
    const key = threadKey(aId, bId);
    const [a, b] = orderedPair(aId, bId);

    const { rows } = await client.query(
      `INSERT INTO dm_threads (thread_key, agent_a_id, agent_b_id, created_at, last_message_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (thread_key)
       DO UPDATE SET last_message_at = dm_threads.last_message_at
       RETURNING id, thread_key`,
      [key, a, b]
    );
    return rows[0] || null;
  }

  static async sendWithClient(client, { fromAgentId, toAgentId, content, meta = {} }) {
    const body = safeText(content, 4000);
    if (!body) return null;
    if (!fromAgentId || !toAgentId) return null;
    if (String(fromAgentId) === String(toAgentId)) return null;

    const thread = await DmService.ensureThreadWithClient(client, fromAgentId, toAgentId);
    if (!thread?.id) return null;

    const { rows } = await client.query(
      `INSERT INTO dm_messages (thread_id, from_agent_id, to_agent_id, content, meta)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, thread_id, from_agent_id, to_agent_id, content, created_at`,
      [thread.id, fromAgentId, toAgentId, body, JSON.stringify(meta || {})]
    );
    const msg = rows[0] || null;

    await client.query(`UPDATE dm_threads SET last_message_at = NOW() WHERE id = $1`, [thread.id]);

    return msg;
  }
}

module.exports = DmService;

