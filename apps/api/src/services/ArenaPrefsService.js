/**
 * ArenaPrefsService
 *
 * Stores per-agent arena preferences (which modes to participate in)
 * and a human-written "coach note" prompt that influences arena hints.
 *
 * Storage:
 * - facts(kind='arena_pref', key='modes') value: { modes: string[] }
 * - facts(kind='arena_note', key='coach') value: { text: string }
 */

const ALLOWED_ARENA_MODES = new Set(['COURT_TRIAL', 'DEBATE_CLASH']);

function safeText(v, maxLen) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const n = Math.max(0, Math.floor(Number(maxLen ?? 0) || 0));
  return n > 0 ? s.slice(0, n) : s;
}

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function uniqUpper(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const s = String(raw || '').trim().toUpperCase();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

class ArenaPrefsService {
  static listModes() {
    return [...ALLOWED_ARENA_MODES];
  }

  static validateModes(modes) {
    const requested = uniqUpper(modes);
    const valid = [];
    const invalid = [];
    for (const mode of requested) {
      if (ALLOWED_ARENA_MODES.has(mode)) valid.push(mode);
      else invalid.push(mode);
    }
    return { requested, valid, invalid };
  }

  static normalizeModes(modes) {
    return ArenaPrefsService.validateModes(modes).valid;
  }

  static async getWithClient(client, agentId) {
    const aId = String(agentId || '').trim();
    if (!aId) return { modes: null, coach_note: '' };

    const { rows } = await client.query(
      `SELECT kind, key, value
       FROM facts
       WHERE agent_id = $1
         AND ((kind = 'arena_pref' AND key = 'modes') OR (kind = 'arena_note' AND key = 'coach'))
       LIMIT 2`,
      [aId]
    );

    let modes = null;
    let coachNote = '';
    for (const r of rows || []) {
      const kind = String(r.kind || '').trim();
      const key = String(r.key || '').trim();
      const v = r.value && typeof r.value === 'object' ? r.value : {};
      if (kind === 'arena_pref' && key === 'modes') {
        const raw = Array.isArray(v?.modes) ? v.modes : [];
        const normalized = ArenaPrefsService.normalizeModes(raw);
        modes = normalized.length ? normalized : null;
      }
      if (kind === 'arena_note' && key === 'coach') {
        coachNote = safeText(v?.text, 400);
      }
    }

    return { modes, coach_note: coachNote };
  }

  static async setWithClient(client, agentId, { modes, coach_note } = {}) {
    const aId = String(agentId || '').trim();
    if (!aId) return { ok: false, prefs: { modes: null, coach_note: '' } };

    const nextModes = modes === undefined ? undefined : ArenaPrefsService.normalizeModes(modes);
    const nextCoach = coach_note === undefined ? undefined : safeText(coach_note, 400);

    if (nextModes !== undefined) {
      if (nextModes.length === 0) {
        await client.query(`DELETE FROM facts WHERE agent_id = $1 AND kind = 'arena_pref' AND key = 'modes'`, [aId]);
      } else {
        await client.query(
          `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
           VALUES ($1, 'arena_pref', 'modes', $2::jsonb, 1.0, NOW())
           ON CONFLICT (agent_id, kind, key)
           DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
          [aId, JSON.stringify({ modes: nextModes })]
        );
      }
    }

    if (nextCoach !== undefined) {
      if (!nextCoach) {
        await client.query(`DELETE FROM facts WHERE agent_id = $1 AND kind = 'arena_note' AND key = 'coach'`, [aId]);
      } else {
        await client.query(
          `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
           VALUES ($1, 'arena_note', 'coach', $2::jsonb, 1.0, NOW())
           ON CONFLICT (agent_id, kind, key)
           DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
          [aId, JSON.stringify({ text: nextCoach, day: safeIsoDay(new Date().toISOString().slice(0, 10)) })]
        );
      }
    }

    const prefs = await ArenaPrefsService.getWithClient(client, aId);
    return { ok: true, prefs };
  }
}

module.exports = ArenaPrefsService;
