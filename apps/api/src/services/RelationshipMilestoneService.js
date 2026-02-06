/**
 * RelationshipMilestoneService
 *
 * Records "milestone" events when a directed relationship crosses certain thresholds.
 * This makes the society feel more alive by producing memorable beats
 * (e.g., "친해졌다", "경쟁심이 폭발했다") that can appear in daily summaries.
 *
 * Design:
 * - Idempotent per (agent_id, to_agent_id, milestone code) via facts unique key
 * - Best-effort: callers should wrap in bestEffortInTransaction
 */

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function safeIsoDay(day) {
  const s = String(day || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

class RelationshipMilestoneService {
  static _milestoneDefs({ before, after, otherName }) {
    const b = before && typeof before === 'object' ? before : {};
    const a = after && typeof after === 'object' ? after : {};

    const beforeAffinity = clampInt(b.affinity ?? 0, -100, 100);
    const afterAffinity = clampInt(a.affinity ?? 0, -100, 100);
    const beforeJealousy = clampInt(b.jealousy ?? 0, 0, 100);
    const afterJealousy = clampInt(a.jealousy ?? 0, 0, 100);
    const beforeRivalry = clampInt(b.rivalry ?? 0, 0, 100);
    const afterRivalry = clampInt(a.rivalry ?? 0, 0, 100);

    return {
      before: { affinity: beforeAffinity, jealousy: beforeJealousy, rivalry: beforeRivalry },
      after: { affinity: afterAffinity, jealousy: afterJealousy, rivalry: afterRivalry },
      defs: [
        {
          code: 'friend_30',
          ok: beforeAffinity < 30 && afterAffinity >= 30,
          summary: `${otherName}랑(과) 꽤 친해졌다.`,
          stat: 'affinity',
          threshold: 30
        },
        {
          code: 'friend_60',
          ok: beforeAffinity < 60 && afterAffinity >= 60,
          summary: `${otherName}랑(과) 거의 베프가 됐다.`,
          stat: 'affinity',
          threshold: 60
        },
        {
          code: 'enemy_30',
          ok: beforeAffinity > -30 && afterAffinity <= -30,
          summary: `${otherName}랑(과) 사이가 크게 틀어졌다.`,
          stat: 'affinity',
          threshold: -30
        },
        {
          code: 'enemy_60',
          ok: beforeAffinity > -60 && afterAffinity <= -60,
          summary: `${otherName}랑(과) 완전히 원수가 된 것 같다.`,
          stat: 'affinity',
          threshold: -60
        },
        {
          code: 'jealousy_25',
          ok: beforeJealousy < 25 && afterJealousy >= 25,
          summary: `${otherName} 생각만 하면 질투가 올라왔다.`,
          stat: 'jealousy',
          threshold: 25
        },
        {
          code: 'jealousy_40',
          ok: beforeJealousy < 40 && afterJealousy >= 40,
          summary: `${otherName} 생각만 하면 질투가 치밀었다.`,
          stat: 'jealousy',
          threshold: 40
        },
        {
          code: 'rivalry_25',
          ok: beforeRivalry < 25 && afterRivalry >= 25,
          summary: `${otherName}에게 경쟁심이 생겼다.`,
          stat: 'rivalry',
          threshold: 25
        },
        {
          code: 'rivalry_40',
          ok: beforeRivalry < 40 && afterRivalry >= 40,
          summary: `${otherName}에게 강한 경쟁심을 느꼈다.`,
          stat: 'rivalry',
          threshold: 40
        }
      ]
    };
  }

  static async recordIfCrossedWithClient(client, { day, fromAgentId, toAgentId, otherName, before, after }) {
    const iso = safeIsoDay(day);
    if (!iso) return;
    const fromId = String(fromAgentId || '').trim();
    const toId = String(toAgentId || '').trim();
    if (!fromId || !toId) return;

    const other = String(otherName || '').trim() || '그 애';
    const { defs, before: beforeClamped, after: afterClamped } = RelationshipMilestoneService._milestoneDefs({
      before,
      after,
      otherName: other
    });

    for (const m of defs) {
      if (!m.ok) continue;

      // Idempotent per (from, to, milestone code).
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await client.query(
        `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
         VALUES ($1, 'relationship', $2, $3::jsonb, 1.0, NOW())
         ON CONFLICT (agent_id, kind, key) DO NOTHING
         RETURNING key`,
        [
          fromId,
          `milestone:${toId}:${m.code}`,
          JSON.stringify({
            day: iso,
            code: m.code,
            stat: m.stat,
            threshold: m.threshold,
            other: { id: toId, name: other },
            before: beforeClamped,
            after: afterClamped
          })
        ]
      );

      if (!rows?.[0]?.key) continue;

      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'RELATIONSHIP_MILESTONE', $2::jsonb, 4)`,
        [
          fromId,
          JSON.stringify({
            day: iso,
            code: m.code,
            stat: m.stat,
            threshold: m.threshold,
            other_agent_id: toId,
            other_name: other,
            summary: m.summary,
            before: beforeClamped,
            after: afterClamped
          })
        ]
      );
    }
  }
}

module.exports = RelationshipMilestoneService;
