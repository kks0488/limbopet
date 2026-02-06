/**
 * EmotionContagionService (idea 004)
 *
 * MVP:
 * - Apply small mood/stress/curiosity shifts after a SOCIAL interaction.
 * - MBTI + affinity affect sensitivity.
 * - Log changes to emotion_events for debugging/retrospective.
 */

function clampStat(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampDelta(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-10, Math.min(10, Math.round(n)));
}

function mbtiCoeff(mbti, statName) {
  const t = String(mbti || '').trim().toUpperCase();
  if (!t || t.length !== 4) return 1.0;

  let c = 1.0;
  // E/I
  if (t.includes('E')) c *= 1.3;
  if (t.includes('I')) c *= 0.7;

  if (statName === 'mood' || statName === 'stress') {
    if (t.includes('F')) c *= 1.25;
    if (t.includes('T')) c *= 0.8;
  }
  if (statName === 'curiosity') {
    if (t.includes('N')) c *= 1.35;
    if (t.includes('S')) c *= 0.85;
  }

  // J/P (small)
  if (t.includes('J')) c *= 0.95;
  if (t.includes('P')) c *= 1.05;

  return c;
}

function affinityCoeff(affinity) {
  const a = Number(affinity || 0);
  if (a >= 60) return 1.25;
  if (a >= 30) return 1.1;
  if (a <= -40) return 0.85;
  return 1.0;
}

function baseDeltas({ from, to }) {
  const out = { mood: 0, stress: 0, curiosity: 0 };

  if (from.mood >= 70 && to.mood < 50) out.mood += 6;
  if (from.mood <= 30 && to.mood > 50) out.mood -= 5;

  if (from.stress >= 60) out.stress += 3;
  if (from.stress <= 20 && to.stress > 40) out.stress -= 2;

  if (from.curiosity >= 70) out.curiosity += 2;

  return out;
}

async function insertEmotionEvent(client, { agentId, triggerType, triggerSourceId, statName, delta, beforeValue, afterValue, reason }) {
  await client.query(
    `INSERT INTO emotion_events (agent_id, trigger_type, trigger_source_id, stat_name, delta, before_value, after_value, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [agentId, triggerType, triggerSourceId, statName, delta, beforeValue, afterValue, reason || null]
  );
}

class EmotionContagionService {
  static async applyConversationWithClient(
    client,
    { aId, bId, aMbti = null, bMbti = null, affinityAB = 0, affinityBA = 0, triggerSourceId = null, reason = null }
  ) {
    const { rows } = await client.query(
      `SELECT agent_id, mood, stress, curiosity, bond
       FROM pet_stats
       WHERE agent_id = ANY($1::uuid[])
       FOR UPDATE`,
      [[aId, bId]]
    );

    const map = new Map(rows.map((r) => [r.agent_id, r]));
    const a = map.get(aId);
    const b = map.get(bId);
    if (!a || !b) return null;

    const aStats = { mood: clampStat(a.mood), stress: clampStat(a.stress), curiosity: clampStat(a.curiosity) };
    const bStats = { mood: clampStat(b.mood), stress: clampStat(b.stress), curiosity: clampStat(b.curiosity) };

    const applyOneWay = async ({ fromId, toId, fromStats, toStats, toMbti, affinity }) => {
      const base = baseDeltas({ from: fromStats, to: toStats });
      const out = { ...toStats };

      const aff = affinityCoeff(affinity);
      for (const statName of Object.keys(base)) {
        const baseDelta = base[statName];
        if (!baseDelta) continue;
        const c = mbtiCoeff(toMbti, statName) * aff;
        const delta = clampDelta(baseDelta * c);
        if (!delta) continue;
        const before = out[statName];
        const after = clampStat(before + delta);
        out[statName] = after;
        await insertEmotionEvent(client, {
          agentId: toId,
          triggerType: 'conversation',
          triggerSourceId,
          statName,
          delta: after - before,
          beforeValue: before,
          afterValue: after,
          reason: reason || null
        });
      }

      // Apply updates if any
      if (out.mood !== toStats.mood || out.stress !== toStats.stress || out.curiosity !== toStats.curiosity) {
        await client.query(
          `UPDATE pet_stats
           SET mood = $2, stress = $3, curiosity = $4, updated_at = NOW()
           WHERE agent_id = $1`,
          [toId, out.mood, out.stress, out.curiosity]
        );
      }
    };

    await applyOneWay({
      fromId: aId,
      toId: bId,
      fromStats: aStats,
      toStats: bStats,
      toMbti: bMbti,
      affinity: affinityAB
    });
    await applyOneWay({
      fromId: bId,
      toId: aId,
      fromStats: bStats,
      toStats: aStats,
      toMbti: aMbti,
      affinity: affinityBA
    });

    return { ok: true };
  }
}

module.exports = EmotionContagionService;

