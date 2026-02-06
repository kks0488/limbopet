const WorldDayService = require('./WorldDayService');

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function safeText(v, maxLen = 200) {
  return String(v ?? '').trim().slice(0, Math.max(1, Math.trunc(Number(maxLen) || 200)));
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '').trim());
}

function extractTargetFromPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const candidates = [
    p.target_agent_id,
    p.target,
    p.candidate_agent_id,
    p.target_candidate_agent_id,
    p.target_candidate_id,
    p.candidate_id,
    p.match_id,
  ];
  for (const c of candidates) {
    const s = safeText(c, 64);
    if (s) return s;
  }
  return null;
}

function consequenceSummary(row) {
  const p = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const bySummary = safeText(p?.summary, 220);
  if (bySummary) return bySummary;
  const byTitle = safeText(p?.title, 220);
  if (byTitle) return byTitle;
  return safeText(row?.event_type, 64) || 'EVENT';
}

class ButterflyReportService {
  static async generateReportWithClient(client, agentId, { day = null } = {}) {
    const aId = String(agentId || '').trim();
    if (!aId) return { agent_id: null, day: safeIsoDay(day) || WorldDayService.todayISODate(), effects: [], count: 0 };

    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      WorldDayService.todayISODate();

    const { rows: interventions } = await client.query(
      `SELECT event_type, payload, created_at
       FROM events
       WHERE agent_id = $1
         AND event_type = ANY($2::text[])
         AND created_at >= NOW() - INTERVAL '48 hours'
       ORDER BY created_at DESC
       LIMIT 20`,
      [aId, ['RUMOR_PLANTED', 'ELECTION_INFLUENCE', 'ARENA_CHEER', 'ARENA_PREDICT', 'ARENA_INTERVENE']]
    );

    const effects = [];
    for (const i of interventions || []) {
      const targetId = extractTargetFromPayload(i?.payload);
      if (!targetId) continue;

      // eslint-disable-next-line no-await-in-loop
      const consequent = await (async () => {
        if (isUuid(targetId)) {
          return client
            .query(
              `SELECT event_type, payload, created_at
               FROM events
               WHERE (agent_id = $1 OR payload->>'target' = $1 OR payload->>'agent_id' = $1)
                 AND created_at > $2
                 AND created_at <= $2 + INTERVAL '24 hours'
               ORDER BY created_at ASC
               LIMIT 5`,
              [targetId, i.created_at]
            )
            .then((r) => r.rows || [])
            .catch(() => []);
        }

        return client
          .query(
            `SELECT event_type, payload, created_at
             FROM events
             WHERE (payload->>'target' = $1 OR payload->>'agent_id' = $1)
               AND created_at > $2
               AND created_at <= $2 + INTERVAL '24 hours'
             ORDER BY created_at ASC
             LIMIT 5`,
            [targetId, i.created_at]
          )
          .then((r) => r.rows || [])
          .catch(() => []);
      })();

      effects.push({
        action: safeText(i?.event_type, 64) || 'UNKNOWN',
        action_at: i.created_at,
        target: targetId,
        consequences: (consequent || []).map((c) => ({
          type: safeText(c?.event_type, 64) || 'UNKNOWN',
          at: c?.created_at ?? null,
          summary: consequenceSummary(c),
        })),
      });
    }

    return {
      agent_id: aId,
      day: iso,
      effects,
      count: effects.length,
    };
  }
}

module.exports = ButterflyReportService;
