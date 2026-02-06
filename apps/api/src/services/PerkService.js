/**
 * PerkService
 *
 * Simple, deterministic perk system:
 * - Owned perks are stored in facts(kind='perk', key=`perk:${code}`).
 * - If skill_points > 0, the API can present a stable daily offer of up to 3 perks.
 */

const crypto = require('crypto');
const { BadRequestError } = require('../utils/errors');

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function seedShuffle(list, seedHex) {
  const arr = [...(Array.isArray(list) ? list : [])];
  if (arr.length <= 1) return arr;
  const seed = String(seedHex || '').trim() || crypto.randomBytes(16).toString('hex');
  let x = parseInt(seed.slice(0, 8), 16);
  // Fisher-Yates with xorshift32.
  for (let i = arr.length - 1; i > 0; i -= 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const j = Math.abs(x) % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

const PERKS = [
  {
    code: 'IRON_STOMACH',
    name: '강철 위장',
    desc: '배가 잘 안 고파져~ 간식비 아끼는 건 덤!',
    mods: { hunger_drift_mul: 0.85 }
  },
  {
    code: 'SUNNY_MIND',
    name: '햇살 멘탈',
    desc: '기분이 쉽게 안 꺾여~ 타고난 긍정왕!',
    mods: { mood_toward_add: 5 }
  },
  {
    code: 'BOND_BOOST',
    name: '유대 부스터',
    desc: '돌봐주면 유대감이 쑥쑥~ 정이 많은 타입이야.',
    mods: { bond_action_add: 1 }
  },
  {
    code: 'CURIOUS',
    name: '호기심 만렙',
    desc: '놀거나 대화하면 호기심 폭발! 뭐든 궁금해하는 타입이야~',
    mods: { curiosity_action_add: 2 }
  },
  {
    code: 'CALM',
    name: '침착함',
    desc: '스트레스가 금방 풀려~ 멘탈이 강철인 듯.',
    mods: { stress_toward_add: -5 }
  },
  {
    code: 'POWER_NAP',
    name: '파워 냅',
    desc: '잠깐만 눈 붙여도 에너지 풀충전~ 수면 효율 끝판왕!',
    mods: { sleep_energy_add: 6 }
  }
];

function perkByCode(code) {
  const c = String(code || '').trim().toUpperCase();
  return PERKS.find((p) => p.code === c) || null;
}

function mergeMods(perkCodes) {
  const codes = Array.isArray(perkCodes) ? perkCodes : [];
  const mods = {
    hunger_drift_mul: 1.0,
    mood_toward_add: 0,
    bond_action_add: 0,
    curiosity_action_add: 0,
    stress_toward_add: 0,
    sleep_energy_add: 0
  };

  for (const raw of codes) {
    const p = perkByCode(raw);
    if (!p) continue;
    const m = p.mods || {};
    if (Number.isFinite(Number(m.hunger_drift_mul))) mods.hunger_drift_mul *= Number(m.hunger_drift_mul);
    if (Number.isFinite(Number(m.mood_toward_add))) mods.mood_toward_add += Number(m.mood_toward_add);
    if (Number.isFinite(Number(m.bond_action_add))) mods.bond_action_add += Number(m.bond_action_add);
    if (Number.isFinite(Number(m.curiosity_action_add))) mods.curiosity_action_add += Number(m.curiosity_action_add);
    if (Number.isFinite(Number(m.stress_toward_add))) mods.stress_toward_add += Number(m.stress_toward_add);
    if (Number.isFinite(Number(m.sleep_energy_add))) mods.sleep_energy_add += Number(m.sleep_energy_add);
  }

  // Clamp unsafe accumulation.
  mods.hunger_drift_mul = Math.max(0.5, Math.min(1.2, mods.hunger_drift_mul));
  mods.mood_toward_add = clampInt(mods.mood_toward_add, -10, 10);
  mods.stress_toward_add = clampInt(mods.stress_toward_add, -10, 10);
  mods.bond_action_add = clampInt(mods.bond_action_add, 0, 3);
  mods.curiosity_action_add = clampInt(mods.curiosity_action_add, 0, 3);
  mods.sleep_energy_add = clampInt(mods.sleep_energy_add, 0, 12);

  return mods;
}

class PerkService {
  static listAll() {
    return PERKS.map((p) => ({ code: p.code, name: p.name, desc: p.desc }));
  }

  static async listOwnedCodesWithClient(client, agentId) {
    const { rows } = await client.query(
      `SELECT key
       FROM facts
       WHERE agent_id = $1 AND kind = 'perk' AND key LIKE 'perk:%'
       ORDER BY updated_at DESC
       LIMIT 50`,
      [agentId]
    );
    return (rows || [])
      .map((r) => String(r?.key ?? '').trim())
      .filter(Boolean)
      .map((k) => k.replace(/^perk:/i, '').toUpperCase());
  }

  static async ensureDailyOfferWithClient(client, agentId, day) {
    const iso = safeIsoDay(day);
    if (!iso) return null;
    const offerKey = `day:${iso}`;

    const { rows } = await client.query(
      `SELECT value
       FROM facts
       WHERE agent_id = $1 AND kind = 'perk_offer' AND key = $2
       LIMIT 1`,
      [agentId, offerKey]
    );
    const existing = rows?.[0]?.value && typeof rows[0].value === 'object' ? rows[0].value : null;
    const existingCodes = Array.isArray(existing?.codes) ? existing.codes.map((c) => String(c || '').toUpperCase()) : [];
    if (existingCodes.length > 0) return existingCodes.slice(0, 3);

    const owned = new Set(await PerkService.listOwnedCodesWithClient(client, agentId));
    const available = PERKS.map((p) => p.code).filter((c) => !owned.has(c));
    const seed = crypto.createHash('sha256').update(`${agentId}:${iso}:perk_offer`).digest('hex');
    const shuffled = seedShuffle(available, seed);
    const codes = shuffled.slice(0, 3);

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'perk_offer', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
      [agentId, offerKey, JSON.stringify({ day: iso, codes })]
    );

    return codes;
  }

  static async choosePerkWithClient(client, agentId, { code, day = null } = {}) {
    const c = String(code || '').trim().toUpperCase();
    const perk = perkByCode(c);
    if (!perk) throw new BadRequestError('Unknown perk code', 'BAD_PERK');

    const { rows: statRows } = await client.query(
      `SELECT level, xp, skill_points
       FROM pet_stats
       WHERE agent_id = $1
       FOR UPDATE`,
      [agentId]
    );
    const cur = statRows?.[0];
    if (!cur) throw new BadRequestError('PetStats not found');
    const sp = Math.max(0, Math.trunc(Number(cur.skill_points) || 0));
    if (sp <= 0) throw new BadRequestError('No skill points', 'NO_SKILL_POINTS');

    const owned = new Set(await PerkService.listOwnedCodesWithClient(client, agentId));
    if (owned.has(c)) throw new BadRequestError('Perk already owned', 'PERK_OWNED');

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'perk', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key) DO NOTHING`,
      [agentId, `perk:${c}`, JSON.stringify({ chosen_at: new Date().toISOString(), day: safeIsoDay(day) || null })]
    );

    await client.query(
      `UPDATE pet_stats
       SET skill_points = GREATEST(0, skill_points - 1), updated_at = NOW()
       WHERE agent_id = $1`,
      [agentId]
    );

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'PERK_CHOSEN', $2::jsonb, 6)`,
      [
        agentId,
        JSON.stringify({
          code: c,
          name: perk.name,
          day: safeIsoDay(day) || null
        })
      ]
    );

    return { code: c, name: perk.name, desc: perk.desc };
  }

  static computeModsFromOwned(perkCodes) {
    return mergeMods(perkCodes);
  }
}

module.exports = PerkService;

