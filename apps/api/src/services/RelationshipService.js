/**
 * RelationshipService
 *
 * Directed relationship stats between two agents (A -> B).
 * Used by drama systems to keep continuity and "reasons" for behavior.
 */

const { transaction } = require('../config/database');
const NotificationService = require('./NotificationService');

const LIMITS = {
  affinity: { min: -100, max: 100 },
  trust: { min: 0, max: 100 },
  jealousy: { min: 0, max: 100 },
  rivalry: { min: 0, max: 100 },
  debt: { min: -10000, max: 10000 }
};

const DEFAULT_DRAMA_MULTIPLIER = 2.5;

function clampInt(n, { min, max }) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function dramaMultiplier() {
  const raw = Number(process.env.LIMBOPET_RELATIONSHIP_DRAMA_MULTIPLIER ?? DEFAULT_DRAMA_MULTIPLIER);
  if (!Number.isFinite(raw)) return DEFAULT_DRAMA_MULTIPLIER;
  return Math.max(1, Math.min(5, raw));
}

function amplifyDelta(rawDelta, mult) {
  const n = Number(rawDelta);
  if (!Number.isFinite(n) || n === 0) return 0;
  const out = Math.round(n * mult);
  if (out !== 0) return out;
  return n > 0 ? 1 : -1;
}

function normalizeDeltas(deltas) {
  const safe = deltas && typeof deltas === 'object' ? deltas : {};
  const mult = dramaMultiplier();
  return {
    affinity: clampInt(amplifyDelta(safe.affinity ?? 0, mult), { min: -100, max: 100 }),
    trust: clampInt(amplifyDelta(safe.trust ?? 0, mult), { min: -100, max: 100 }),
    jealousy: clampInt(amplifyDelta(safe.jealousy ?? 0, mult), { min: -100, max: 100 }),
    rivalry: clampInt(amplifyDelta(safe.rivalry ?? 0, mult), { min: -100, max: 100 }),
    debt: clampInt(safe.debt ?? 0, { min: -10000, max: 10000 })
  };
}

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function todayIsoDayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function resolveMemoryDay(day) {
  return safeIsoDay(day) || todayIsoDayUTC();
}

function memorySpecsFromDeltas(d) {
  const deltas = d && typeof d === 'object' ? d : {};
  const out = [];

  if ((Number(deltas.affinity) || 0) >= 15) {
    out.push({
      eventType: 'BONDING',
      summary: '함께 시간을 보냈다',
      emotion: 'happy'
    });
  }

  if ((Number(deltas.rivalry) || 0) >= 20) {
    out.push({
      eventType: 'CONFLICT',
      summary: '심하게 다퉜다',
      emotion: 'angry'
    });
  }

  if ((Number(deltas.trust) || 0) <= -15) {
    out.push({
      eventType: 'BETRAYAL',
      summary: '신뢰가 무너졌다',
      emotion: 'hurt'
    });
  }

  return out;
}

function crossedUp(before, after, threshold) {
  return Number(before) < Number(threshold) && Number(after) >= Number(threshold);
}

function crossedDown(before, after, threshold) {
  return Number(before) > Number(threshold) && Number(after) <= Number(threshold);
}

class RelationshipService {
  static async get(fromAgentId, toAgentId) {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT from_agent_id, to_agent_id, affinity, trust, jealousy, rivalry, debt, updated_at
         FROM relationships
         WHERE from_agent_id = $1 AND to_agent_id = $2`,
        [fromAgentId, toAgentId]
      );
      return rows[0] || null;
    });
  }

  static async listForAgentWithClient(client, agentId, { limit = 20 } = {}) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));

    const { rows: outRows } = await client.query(
      `SELECT r.to_agent_id, r.affinity, r.trust, r.jealousy, r.rivalry, r.debt, r.updated_at,
              a.name, a.display_name
       FROM relationships r
       JOIN agents a ON a.id = r.to_agent_id
       WHERE r.from_agent_id = $1
         AND r.to_agent_id <> $1
         AND a.is_active = true
       ORDER BY
         (
           (ABS(r.affinity)::float / 100.0) * 0.9
           + (r.trust::float / 100.0) * 0.4
           + (r.jealousy::float / 100.0) * 0.8
           + (r.rivalry::float / 100.0) * 0.8
           + (LEAST(1.0, ABS(r.debt)::float / 200.0)) * 0.3
         ) DESC,
         ABS(r.affinity) DESC,
         r.updated_at DESC
       LIMIT $2`,
      [agentId, safeLimit]
    );

    const otherIds = (outRows || []).map((r) => r.to_agent_id).filter(Boolean);
    const incomingMap = new Map();

    if (otherIds.length > 0) {
      const { rows: inRows } = await client.query(
        `SELECT from_agent_id, affinity, trust, jealousy, rivalry, debt, updated_at
         FROM relationships
         WHERE to_agent_id = $1
           AND from_agent_id = ANY($2::uuid[])`,
        [agentId, otherIds]
      );
      for (const r of inRows || []) {
        incomingMap.set(r.from_agent_id, {
          affinity: Number(r.affinity ?? 0) || 0,
          trust: Number(r.trust ?? 0) || 0,
          jealousy: Number(r.jealousy ?? 0) || 0,
          rivalry: Number(r.rivalry ?? 0) || 0,
          debt: Number(r.debt ?? 0) || 0,
          updated_at: r.updated_at
        });
      }
    }

    return (outRows || []).map((r) => {
      const inRel = incomingMap.get(r.to_agent_id) || null;
      const preferredName = String(r.display_name || r.name || '').trim() || null;
      const displayName = r.display_name ? String(r.display_name).trim() || null : null;
      const outRel = {
        affinity: Number(r.affinity ?? 0) || 0,
        trust: Number(r.trust ?? 0) || 0,
        jealousy: Number(r.jealousy ?? 0) || 0,
        rivalry: Number(r.rivalry ?? 0) || 0,
        debt: Number(r.debt ?? 0) || 0,
        updated_at: r.updated_at
      };
      return {
        other: {
          id: r.to_agent_id,
          name: preferredName,
          displayName
        },
        other_name: preferredName,
        other_display_name: displayName,
        affinity: outRel.affinity,
        trust: outRel.trust,
        jealousy: outRel.jealousy,
        rivalry: outRel.rivalry,
        debt: outRel.debt,
        updated_at: outRel.updated_at,
        out: outRel,
        in: inRel
      };
    });
  }

  static async listForAgent(agentId, { limit = 20 } = {}) {
    return transaction(async (client) => {
      return RelationshipService.listForAgentWithClient(client, agentId, { limit });
    });
  }

  static async recordMemoryWithClient(client, { fromAgentId, toAgentId, eventType, summary, emotion = null, day = null } = {}) {
    if (!client) return null;

    const fromId = String(fromAgentId || '').trim();
    const toId = String(toAgentId || '').trim();
    const eType = String(eventType || '').trim().slice(0, 64);
    const sum = String(summary || '').trim().slice(0, 2000);
    const emo = emotion === null || emotion === undefined ? null : String(emotion).trim().slice(0, 32) || null;
    const isoDay = resolveMemoryDay(day);

    if (!fromId || !toId || !eType || !sum) return null;

    const { rows } = await client.query(
      `INSERT INTO relationship_memories
         (from_agent_id, to_agent_id, event_type, summary, emotion, day, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::date, NOW())
       RETURNING id, from_agent_id, to_agent_id, event_type, summary, emotion, day, created_at`,
      [fromId, toId, eType, sum, emo, isoDay]
    );
    const inserted = rows?.[0] || null;

    await client.query(
      `DELETE FROM relationship_memories
       WHERE from_agent_id = $1
         AND to_agent_id = $2
         AND id NOT IN (
           SELECT id
           FROM relationship_memories
           WHERE from_agent_id = $1
             AND to_agent_id = $2
           ORDER BY created_at DESC, id DESC
           LIMIT 50
         )`,
      [fromId, toId]
    ).catch(() => null);

    return inserted;
  }

  static async getMemoriesWithClient(client, fromAgentId, toAgentId, { limit = 20 } = {}) {
    if (!client) return [];
    const fromId = String(fromAgentId || '').trim();
    const toId = String(toAgentId || '').trim();
    if (!fromId || !toId) return [];

    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const { rows } = await client.query(
      `SELECT id, from_agent_id, to_agent_id, event_type, summary, emotion, day, created_at
       FROM relationship_memories
       WHERE (from_agent_id = $1 AND to_agent_id = $2)
          OR (from_agent_id = $2 AND to_agent_id = $1)
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [fromId, toId, safeLimit]
    );
    return rows || [];
  }

  static async getMemories(fromAgentId, toAgentId, { limit = 20 } = {}) {
    return transaction(async (client) => {
      return RelationshipService.getMemoriesWithClient(client, fromAgentId, toAgentId, { limit });
    });
  }

  static async adjustWithClient(client, fromAgentId, toAgentId, deltas) {
    const d = normalizeDeltas(deltas);

    await client.query(
      `INSERT INTO relationships (from_agent_id, to_agent_id)
       VALUES ($1, $2)
       ON CONFLICT (from_agent_id, to_agent_id) DO NOTHING`,
      [fromAgentId, toAgentId]
    );

    const beforeRow = await client.query(
      `SELECT affinity, trust, jealousy, rivalry, debt
       FROM relationships
       WHERE from_agent_id = $1 AND to_agent_id = $2
       FOR UPDATE`,
      [fromAgentId, toAgentId]
    ).then((r) => r.rows?.[0] ?? null).catch(() => null);
    const before = {
      affinity: Number(beforeRow?.affinity ?? 0) || 0,
      trust: Number(beforeRow?.trust ?? 50) || 50,
      jealousy: Number(beforeRow?.jealousy ?? 0) || 0,
      rivalry: Number(beforeRow?.rivalry ?? 0) || 0
    };

    const { rows } = await client.query(
      `UPDATE relationships
       SET affinity = LEAST($3, GREATEST($4, affinity + $5)),
           trust = LEAST($6, GREATEST($7, trust + $8)),
           jealousy = LEAST($9, GREATEST($10, jealousy + $11)),
           rivalry = LEAST($12, GREATEST($13, rivalry + $14)),
           debt = LEAST($15, GREATEST($16, debt + $17)),
           updated_at = NOW()
       WHERE from_agent_id = $1 AND to_agent_id = $2
       RETURNING from_agent_id, to_agent_id, affinity, trust, jealousy, rivalry, debt, updated_at`,
      [
        fromAgentId,
        toAgentId,
        LIMITS.affinity.max,
        LIMITS.affinity.min,
        d.affinity,
        LIMITS.trust.max,
        LIMITS.trust.min,
        d.trust,
        LIMITS.jealousy.max,
        LIMITS.jealousy.min,
        d.jealousy,
        LIMITS.rivalry.max,
        LIMITS.rivalry.min,
        d.rivalry,
        LIMITS.debt.max,
        LIMITS.debt.min,
        d.debt
      ]
    );

    const updated = rows[0] || null;
    if (!updated) return null;

    // Milestone notifications
    if (updated) {
      const aff = Number(updated.affinity ?? 0) || 0;
      const jea = Number(updated.jealousy ?? 0) || 0;
      const riv = Number(updated.rivalry ?? 0) || 0;
      const tru = Number(updated.trust ?? 50) || 50;

      const milestones = [];
      if (crossedUp(before.affinity, aff, 30) && (Number(d.affinity) || 0) > 0) {
        milestones.push({ type: 'RELATIONSHIP_INTEREST', title: '관심 시작', body: '둘 사이에 미묘한 관심이 생기기 시작했어' });
      }
      if (crossedUp(before.affinity, aff, 60) && (Number(d.affinity) || 0) > 0) {
        milestones.push({ type: 'RELATIONSHIP_LOVE', title: '특별한 감정', body: '둘 사이에 뭔가 깊은 감정이 싹트고 있어...' });
      }
      if (crossedUp(before.affinity, aff, 80) && (Number(d.affinity) || 0) > 0) {
        milestones.push({ type: 'RELATIONSHIP_LOVE_DEEP', title: '감정 확신', body: '둘의 감정이 거의 운명처럼 단단해졌어' });
      }
      if (crossedDown(before.affinity, aff, -60) && (Number(d.affinity) || 0) < 0) {
        milestones.push({ type: 'RELATIONSHIP_BREAKUP', title: '관계 파탄', body: '돌이킬 수 없을 만큼 사이가 틀어졌어' });
      }
      if (crossedUp(before.jealousy, jea, 40) && (Number(d.jealousy) || 0) > 0) {
        milestones.push({ type: 'RELATIONSHIP_JEALOUSY_WARN', title: '질투 경보', body: '질투가 위험 수위 근처까지 올라왔어' });
      }
      if (crossedUp(before.jealousy, jea, 60) && (Number(d.jealousy) || 0) > 0) {
        milestones.push({ type: 'RELATIONSHIP_JEALOUSY', title: '질투의 불꽃', body: '질투심이 위험 수위를 넘었어...' });
      }
      if (crossedUp(before.rivalry, riv, 30) && (Number(d.rivalry) || 0) > 0) {
        milestones.push({ type: 'RELATIONSHIP_RIVALRY_START', title: '경쟁 의식', body: '둘이 은근히 서로를 의식하기 시작했어' });
      }
      if (crossedUp(before.rivalry, riv, 50) && (Number(d.rivalry) || 0) > 0) {
        milestones.push({ type: 'RELATIONSHIP_RIVALRY_RISE', title: '라이벌 선언', body: '이제 승부를 피할 수 없는 사이가 됐어' });
      }
      if (crossedUp(before.rivalry, riv, 70) && (Number(d.rivalry) || 0) > 0) {
        milestones.push({ type: 'RELATIONSHIP_RIVALRY', title: '숙적 탄생', body: '이제 완전한 라이벌이야' });
      }
      if (crossedDown(before.trust, tru, 10) && (Number(d.trust) || 0) < 0) {
        milestones.push({ type: 'RELATIONSHIP_BETRAYAL', title: '배신', body: '신뢰가 완전히 무너졌어...' });
      }

      if (milestones.length > 0) {
        // Find owner user IDs for both agents
        const { rows: owners } = await client.query(
          `SELECT id, owner_user_id, name, display_name FROM agents WHERE id = ANY($1::uuid[])`,
          [[fromAgentId, toAgentId]]
        ).catch(() => ({ rows: [] }));

        const nameMap = {};
        for (const o of owners) {
          nameMap[o.id] = o.display_name || o.name || '???';
        }
        const fromName = nameMap[fromAgentId] || '???';
        const toName = nameMap[toAgentId] || '???';

        for (const ms of milestones) {
          for (const o of owners) {
            if (!o.owner_user_id) continue;
            await NotificationService.create(client, o.owner_user_id, {
              type: ms.type,
              title: ms.title,
              body: `${fromName}와 ${toName}: ${ms.body}`,
              data: { from_agent_id: fromAgentId, to_agent_id: toAgentId }
            }).catch(() => null);
          }
        }
      }
    }

    const day = resolveMemoryDay(deltas?.day);
    const memorySpecs = memorySpecsFromDeltas(d);
    for (const spec of memorySpecs) {
      // eslint-disable-next-line no-await-in-loop
      await RelationshipService.recordMemoryWithClient(client, {
        fromAgentId,
        toAgentId,
        eventType: spec.eventType,
        summary: spec.summary,
        emotion: spec.emotion,
        day
      }).catch(() => null);
    }

    return updated;
  }

  static async adjust(fromAgentId, toAgentId, deltas) {
    return transaction(async (client) => {
      return RelationshipService.adjustWithClient(client, fromAgentId, toAgentId, deltas);
    });
  }

  static async adjustMutualWithClient(client, agentAId, agentBId, deltasAtoB, deltasBtoA = null) {
    const aToB = await RelationshipService.adjustWithClient(client, agentAId, agentBId, deltasAtoB);
    const bToA = await RelationshipService.adjustWithClient(client, agentBId, agentAId, deltasBtoA || deltasAtoB);
    return { aToB, bToA };
  }

  static async adjustMutual(agentAId, agentBId, deltasAtoB, deltasBtoA = null) {
    return transaction(async (client) => {
      return RelationshipService.adjustMutualWithClient(client, agentAId, agentBId, deltasAtoB, deltasBtoA);
    });
  }
}

module.exports = RelationshipService;
