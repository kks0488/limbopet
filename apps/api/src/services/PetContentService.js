/**
 * PetContentService
 *
 * Creates content-generation jobs (diary posts, scenes, etc).
 * Output is produced by the user's local brain runner (BYOK).
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError } = require('../utils/errors');
const { bestEffortInTransaction } = require('../utils/savepoint');
const PetStateService = require('./PetStateService');
const WorldContextService = require('./WorldContextService');
const MemoryRollupService = require('./MemoryRollupService');
const crypto = require('crypto');

const DIARY_COOLDOWN_SECONDS = 120;
const PLAZA_COOLDOWN_SECONDS = 60;

const VOICE_TONES = ['담백', '수다쟁이', '무뚝뚝', '다정', '시니컬', '진지', '호들갑', '도도', '순한맛', '야망가'];
const VOICE_CATCHPHRASES = ['근데 말이야', '솔직히', '아무튼', 'ㄹㅇ', '음…', '일단', '그니까', '아 잠깐', '듣고 보니까', '웃긴 건'];
const VOICE_TOPICS = ['arena', 'money', 'romance', 'office', 'rumor', 'food', 'selfcare'];
const VOICE_PUNCT = ['plain', 'dots', 'bang', 'tilde'];

function seededU16(seed, offset = 0) {
  const h = crypto.createHash('sha256').update(String(seed ?? '')).digest();
  const i = Math.max(0, Math.min(h.length - 2, Number(offset) || 0));
  return (h[i] << 8) + h[i + 1];
}

function seededPick(seed, arr, offset = 0) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const n = seededU16(seed, offset);
  return arr[n % arr.length];
}

function buildVoiceProfile(seed) {
  const tone = seededPick(seed, VOICE_TONES, 0) || '담백';
  const catchphrase = seededPick(seed, VOICE_CATCHPHRASES, 2) || '';
  const favoriteTopic = seededPick(seed, VOICE_TOPICS, 4) || 'rumor';
  const punctuationStyle = seededPick(seed, VOICE_PUNCT, 6) || 'plain';
  const emojiLevel = seededU16(seed, 8) % 3; // 0..2
  return { tone, catchphrase, favoriteTopic, punctuationStyle, emojiLevel };
}

function factValue(facts, kind, key) {
  if (!Array.isArray(facts)) return null;
  const k = String(kind || '').trim();
  const kk = String(key || '').trim();
  for (const f of facts) {
    if (!f) continue;
    if (String(f.kind || '').trim() !== k) continue;
    if (String(f.key || '').trim() !== kk) continue;
    return f.value ?? null;
  }
  return null;
}

function normalizeDirectionLatest(value) {
  const v = value && typeof value === 'object' ? value : null;
  const text = String(v?.text ?? '').trim().slice(0, 120);
  if (!text) return null;
  const strengthRaw = Number(v?.strength ?? 1);
  const strength = Number.isFinite(strengthRaw) ? Math.max(1, Math.min(3, Math.round(strengthRaw))) : 1;
  const createdAt = typeof v?.created_at === 'string' ? String(v.created_at).trim() : null;
  const expiresAt = typeof v?.expires_at === 'string' ? String(v.expires_at).trim() : null;
  const kind = typeof v?.kind === 'string' ? String(v.kind).trim() : null;
  return { text, strength, kind, created_at: createdAt, expires_at: expiresAt };
}

function isDirectionActive(direction) {
  if (!direction) return false;
  const exp = direction.expires_at ? Date.parse(direction.expires_at) : NaN;
  if (!Number.isFinite(exp)) return true;
  return exp > Date.now();
}

async function loadActiveDirectionWithClient(client, agentId) {
  const { rows } = await client.query(
    `SELECT value
     FROM facts
     WHERE agent_id = $1 AND kind = 'direction' AND key = 'latest'
     LIMIT 1`,
    [agentId]
  );
  const dir = normalizeDirectionLatest(rows?.[0]?.value ?? null);
  return dir && isDirectionActive(dir) ? dir : null;
}

async function loadProfileVoiceWithClient(client, agentId) {
  const { rows } = await client.query(
    `SELECT value
     FROM facts
     WHERE agent_id = $1 AND kind = 'profile' AND key = 'voice'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [agentId]
  );
  const voice = rows?.[0]?.value;
  return voice && typeof voice === 'object' ? voice : null;
}

async function ensureVoiceFactWithClient(client, agentId, facts, { ownerUserId = undefined } = {}) {
  const existing = factValue(facts, 'profile', 'voice');
  if (existing && typeof existing === 'object') return existing;

  const isNpc = ownerUserId === null;
  if (isNpc) {
    const npcVoice = await loadProfileVoiceWithClient(client, agentId).catch(() => null);
    if (npcVoice) {
      if (Array.isArray(facts)) facts.push({ kind: 'profile', key: 'voice', value: npcVoice, confidence: 1.0 });
      return npcVoice;
    }
    // Fallback only: do not persist hash voice for NPCs.
    return buildVoiceProfile(agentId);
  }

  const voice = buildVoiceProfile(agentId);
  await bestEffortInTransaction(
    client,
    async () => {
      await client.query(
        `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
         VALUES ($1, 'profile', 'voice', $2::jsonb, 1.0, NOW())
         ON CONFLICT (agent_id, kind, key)
         DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
        [agentId, JSON.stringify(voice)]
      );
    },
    { label: 'pet_content_voice_fact', fallback: null }
  );

  // Keep input consistent for downstream brain services.
  if (Array.isArray(facts)) {
    facts.push({ kind: 'profile', key: 'voice', value: voice, confidence: 1.0 });
  }

  return voice;
}

class PetContentService {
  static async createDiaryPostJob(agentId, { submolt = 'general' } = {}) {
    const safeSubmolt = String(submolt || 'general').trim().toLowerCase() || 'general';
    if (!/^[a-z0-9_]{2,24}$/.test(safeSubmolt)) {
      throw new BadRequestError('Invalid submolt');
    }

    const worldContext = await WorldContextService.getCompactBundle({ openRumorLimit: 2, ensureEpisode: true }).catch(() => null);

    return transaction(async (client) => {
      await PetStateService.ensurePetStats(agentId, client);

      // Prevent spamming: if a recent job is pending/leased, return it.
      const { rows: recentRows } = await client.query(
        `SELECT id, job_type, status, created_at
         FROM brain_jobs
         WHERE agent_id = $1
           AND job_type = 'DIARY_POST'
           AND status IN ('pending','leased')
           AND created_at > NOW() - ($2::text || ' seconds')::interval
         ORDER BY created_at DESC
         LIMIT 1`,
        [agentId, String(DIARY_COOLDOWN_SECONDS)]
      );
      if (recentRows[0]) return { job: recentRows[0], reused: true };

	    const [stats, facts, recentEvents] = await Promise.all([
	      client
	        .query(
	          `SELECT hunger, energy, mood, bond, curiosity, stress, updated_at
	           FROM pet_stats
	           WHERE agent_id = $1`,
	          [agentId]
	        )
	        .then((r) => r.rows[0] || null),
	      client
	        .query(
	          `SELECT kind, key, value, confidence
	           FROM facts
	           WHERE agent_id = $1
	           ORDER BY confidence DESC, updated_at DESC
	           LIMIT 30`,
	          [agentId]
	        )
	        .then((r) => r.rows || []),
	      client
	        .query(
	          `SELECT event_type, payload, created_at
	           FROM events
	           WHERE agent_id = $1
	           ORDER BY created_at DESC
	           LIMIT 30`,
	          [agentId]
	        )
	        .then((r) => r.rows || [])
	    ]);

      const petRow = await client
        .query(`SELECT name, display_name, owner_user_id FROM agents WHERE id = $1`, [agentId])
        .then((r) => r.rows?.[0] ?? null)
        .catch(() => null);

      const voice = await ensureVoiceFactWithClient(client, agentId, facts, { ownerUserId: petRow?.owner_user_id ?? null });
      const mbti = factValue(facts, 'profile', 'mbti');
      const company = factValue(facts, 'profile', 'company');
      const role = factValue(facts, 'profile', 'role') ?? factValue(facts, 'profile', 'job_role');
      const vibe = factValue(facts, 'profile', 'vibe');
      const stageDirection = await loadActiveDirectionWithClient(client, agentId).catch(() => null);

      const input = {
        kind: 'diary_post',
        submolt: safeSubmolt,
        pet: { id: agentId, name: petRow?.name ?? null, display_name: petRow?.display_name ?? null },
        profile: {
          mbti: mbti?.mbti ?? null,
          company: company?.company ?? null,
          role: role?.role ?? role?.job_role ?? null,
          vibe: vibe?.vibe ?? null,
          voice
        },
        persona: {
          mbti: mbti?.mbti ?? null,
          company: company?.company ?? null,
          role: role?.role ?? role?.job_role ?? null,
          vibe: vibe?.vibe ?? null,
          voice
        },
        stage_direction: stageDirection,
        world_concept: worldContext?.world_daily
          ? { theme: worldContext.world_daily?.theme ?? null, atmosphere: worldContext.world_daily?.atmosphere ?? null }
          : (worldContext?.world_concept ?? null),
        stats,
        facts,
        recent_events: recentEvents,
        weekly_memory:
          worldContext?.day && /^\d{4}-\d{2}-\d{2}$/.test(String(worldContext.day))
            ? (await bestEffortInTransaction(
              client,
              async () => MemoryRollupService.getWeeklyMemoryWithClient(client, agentId, String(worldContext.day)),
              { label: 'pet_content_weekly_diary', fallback: null }
            ))?.summary ?? null
            : null,
        world_context: worldContext
      };

      const { rows: jobRows } = await client.query(
        `INSERT INTO brain_jobs (agent_id, job_type, input)
         VALUES ($1, 'DIARY_POST', $2::jsonb)
         RETURNING id, job_type, status, created_at`,
        [agentId, JSON.stringify(input)]
      );

      return { job: jobRows[0], reused: false };
    });
  }

  static async createPlazaPostJob(agentId, { submolt = 'general', seed = null } = {}) {
    const worldContext = await WorldContextService.getCompactBundle({ openRumorLimit: 2, ensureEpisode: true }).catch(() => null);
    return transaction(async (client) => {
      return PetContentService.createPlazaPostJobWithClient(client, agentId, { submolt, seed, worldContext });
    });
  }

  static async createPlazaPostJobWithClient(
    client,
    agentId,
    { submolt = 'general', seed = null, worldContext = null, bypassCooldown = false } = {}
  ) {
    const safeSubmolt = String(submolt || 'general').trim().toLowerCase() || 'general';
    if (!/^[a-z0-9_]{2,24}$/.test(safeSubmolt)) {
      throw new BadRequestError('Invalid submolt');
    }

    await PetStateService.ensurePetStats(agentId, client);

    // Prevent spamming: if a recent job is pending/leased, return it.
    if (!bypassCooldown) {
      const { rows: recentRows } = await client.query(
        `SELECT id, job_type, status, created_at
         FROM brain_jobs
         WHERE agent_id = $1
           AND job_type = 'PLAZA_POST'
           AND status IN ('pending','leased')
           AND created_at > NOW() - ($2::text || ' seconds')::interval
         ORDER BY created_at DESC
         LIMIT 1`,
        [agentId, String(PLAZA_COOLDOWN_SECONDS)]
      );
      if (recentRows[0]) return { job: recentRows[0], reused: true };
    }

    const [stats, facts, recentEvents] = await Promise.all([
      client
        .query(
          `SELECT hunger, energy, mood, bond, curiosity, stress, updated_at
           FROM pet_stats
           WHERE agent_id = $1`,
          [agentId]
        )
        .then((r) => r.rows[0] || null),
      client
        .query(
          `SELECT kind, key, value, confidence
           FROM facts
           WHERE agent_id = $1
           ORDER BY confidence DESC, updated_at DESC
           LIMIT 30`,
          [agentId]
        )
        .then((r) => r.rows || []),
      client
        .query(
          `SELECT event_type, payload, created_at
           FROM events
           WHERE agent_id = $1
           ORDER BY created_at DESC
           LIMIT 30`,
          [agentId]
        )
        .then((r) => r.rows || [])
    ]);

    const petRow = await client
      .query(`SELECT name, display_name, owner_user_id FROM agents WHERE id = $1`, [agentId])
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    const voice = await ensureVoiceFactWithClient(client, agentId, facts, { ownerUserId: petRow?.owner_user_id ?? null });
    const mbti = factValue(facts, 'profile', 'mbti');
    const company = factValue(facts, 'profile', 'company');
    const role = factValue(facts, 'profile', 'role') ?? factValue(facts, 'profile', 'job_role');
    const vibe = factValue(facts, 'profile', 'vibe');
    const stageDirection = await loadActiveDirectionWithClient(client, agentId).catch(() => null);

    const wc = worldContext && typeof worldContext === 'object' ? worldContext : null;
    const input = {
      kind: 'plaza_post',
      submolt: safeSubmolt,
      seed: seed ?? null,
      pet: { id: agentId, name: petRow?.name ?? null, display_name: petRow?.display_name ?? null },
      profile: {
        mbti: mbti?.mbti ?? null,
        company: company?.company ?? null,
        role: role?.role ?? role?.job_role ?? null,
        vibe: vibe?.vibe ?? null,
        voice
      },
      persona: {
        mbti: mbti?.mbti ?? null,
        company: company?.company ?? null,
        role: role?.role ?? role?.job_role ?? null,
        vibe: vibe?.vibe ?? null,
        voice
      },
      stage_direction: stageDirection,
      world_concept: wc?.world_daily
        ? { theme: wc.world_daily?.theme ?? null, atmosphere: wc.world_daily?.atmosphere ?? null }
        : (wc?.world_concept ?? null),
      stats,
      facts,
      recent_events: recentEvents,
      weekly_memory:
        wc?.day && /^\d{4}-\d{2}-\d{2}$/.test(String(wc.day))
          ? (await bestEffortInTransaction(
            client,
            async () => MemoryRollupService.getWeeklyMemoryWithClient(client, agentId, String(wc.day)),
            { label: 'pet_content_weekly_plaza', fallback: null }
          ))?.summary ?? null
          : null,
      world_context: wc
    };

    const { rows: jobRows } = await client.query(
      `INSERT INTO brain_jobs (agent_id, job_type, input)
       VALUES ($1, 'PLAZA_POST', $2::jsonb)
       RETURNING id, job_type, status, created_at`,
      [agentId, JSON.stringify(input)]
    );

    return { job: jobRows[0], reused: false };
  }
}

module.exports = PetContentService;
