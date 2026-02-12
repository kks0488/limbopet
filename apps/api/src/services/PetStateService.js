/**
 * PetStateService
 *
 * Server-truth stats + action processing (Phase 1 MVP).
 * We reuse Moltbook "agents" as LIMBOPET "pets".
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const JobService = require('./JobService');
const MemoryRollupService = require('./MemoryRollupService');
const DailyMissionService = require('./DailyMissionService');
const PerkService = require('./PerkService');
const { ProgressionService } = require('./ProgressionService');
const WorldDayService = require('./WorldDayService');
const UserPromptProfileService = require('./UserPromptProfileService');

const STAT_MIN = 0;
const STAT_MAX = 100;

const ACTIONS = /** @type {const} */ (['feed', 'play', 'sleep', 'talk']);

const COOLDOWNS_MS = {
  feed: 10 * 60 * 1000,
  play: 10 * 60 * 1000,
  sleep: 30 * 60 * 1000,
  talk: 10 * 1000
};

const SOLO_EVENT_MIN_MINUTES = Number(process.env.LIMBOPET_SOLO_EVENT_MIN_MINUTES ?? 180) || 180; // 3h default
const SOLO_EVENT_MAX_EVENTS = 2;

function clampStat(v) {
  if (Number.isNaN(v)) return STAT_MIN;
  return Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(v)));
}

function clampBond(v) {
  return clampStat(v);
}

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

function applyTick(stats, now, perkMods = null) {
  const updatedAt = new Date(stats.updated_at);
  const deltaMs = Math.max(0, now.getTime() - updatedAt.getTime());
  const deltaMinutes = deltaMs / 60000;

  // Simple, stable drift model (tune later):
  // - Hunger slowly increases over time
  // - Energy slowly decreases over time
  // - Mood gently drifts toward 50
  // - Stress gently drifts toward 20 baseline
  const hungerMul = perkMods && Number.isFinite(Number(perkMods.hunger_drift_mul)) ? Number(perkMods.hunger_drift_mul) : 1.0;
  const hunger = clampStat(stats.hunger + deltaMinutes * 0.06 * hungerMul); // ~3.6/hr
  const energy = clampStat(stats.energy - deltaMinutes * 0.05); // ~3.0/hr

  const moodTowardBase = 50;
  const moodTowardAdd = perkMods && Number.isFinite(Number(perkMods.mood_toward_add)) ? Number(perkMods.mood_toward_add) : 0;
  const moodToward = clampStat(moodTowardBase + moodTowardAdd);
  const mood = clampStat(stats.mood + (moodToward - stats.mood) * (deltaMinutes / 600)); // 10h half-life-ish

  const stressTowardBase = 20;
  const stressTowardAdd = perkMods && Number.isFinite(Number(perkMods.stress_toward_add)) ? Number(perkMods.stress_toward_add) : 0;
  const stressToward = clampStat(stressTowardBase + stressTowardAdd);
  const stress = clampStat(stats.stress + (stressToward - stats.stress) * (deltaMinutes / 900)); // ~15h

  // Curiosity drifts toward 50
  const curiosityToward = 50;
  const curiosity = clampStat(stats.curiosity + (curiosityToward - stats.curiosity) * (deltaMinutes / 720));

  // Bond does not drift by time (only via actions)
  const bond = clampBond(stats.bond);

  return { hunger, energy, mood, bond, curiosity, stress };
}

function actionEffects(action, payload, perkMods = null) {
  const bondAdd = perkMods && Number.isFinite(Number(perkMods.bond_action_add)) ? Math.trunc(Number(perkMods.bond_action_add)) : 0;
  const curiosityAdd =
    perkMods && Number.isFinite(Number(perkMods.curiosity_action_add)) ? Math.trunc(Number(perkMods.curiosity_action_add)) : 0;
  const sleepEnergyAdd =
    perkMods && Number.isFinite(Number(perkMods.sleep_energy_add)) ? Math.trunc(Number(perkMods.sleep_energy_add)) : 0;

  switch (action) {
    case 'feed':
      return {
        deltas: { hunger: -22, mood: +2, bond: +1 + bondAdd, energy: 0, curiosity: 0, stress: -1 },
        meta: { food: payload?.food ?? 'food' }
      };
    case 'play':
      return {
        deltas: { hunger: +6, mood: +6, bond: +1 + bondAdd, energy: -12, curiosity: +4 + curiosityAdd, stress: -2 },
        meta: { toy: payload?.toy ?? 'toy' }
      };
    case 'sleep':
      return {
        deltas: { hunger: +10, mood: +1, bond: 0, energy: +26 + sleepEnergyAdd, curiosity: -1, stress: -4 },
        meta: { duration: payload?.duration ?? 'nap' }
      };
    case 'talk':
      // Free-form user chat message (optional).
      // NOTE: Text generation is BYOK; server only stores the message as an event payload.
      const userMessage = safeText(payload?.message ?? payload?.text ?? '', 400) || null;
      return {
        deltas: { hunger: +0, mood: +2, bond: +2 + bondAdd, energy: -1, curiosity: +1 + curiosityAdd, stress: -1 },
        meta: { topic: payload?.topic ?? 'chat', user_message: userMessage }
      };
    default:
      throw new BadRequestError(`Unknown action: ${action}`);
  }
}

function computeSalience({ deltas }) {
  const moodImpact = Math.abs(deltas.mood ?? 0);
  const bondImpact = Math.abs(deltas.bond ?? 0) * 2;
  const stressImpact = Math.abs(deltas.stress ?? 0);
  const novelty = 1;
  return Math.max(0, Math.round(moodImpact + bondImpact + stressImpact + novelty));
}

function moodLabel(mood) {
  if (mood >= 75) return 'bright';
  if (mood >= 55) return 'okay';
  if (mood >= 35) return 'low';
  return 'gloomy';
}

function buildSoloSummaries({ minutesAway, hunger, energy, mood }) {
  const base = [
    '혼자 광장을 슬쩍 둘러봤다.',
    '림보의 복도에서 낯선 방 문을 만져봤다.',
    '창밖을 오래 바라봤다.',
    '작은 물건을 주워서 숨겨뒀다.',
    '누군가의 소문을 들었다.',
    '혼자 조용히 산책했다.'
  ];

  const hints = [];
  if (hunger >= 70) hints.push('배가 고파서 냄새를 따라다녔다.');
  if (energy <= 30) hints.push('조금 지쳐서 쉬엄쉬엄 움직였다.');
  if (mood >= 70) hints.push('기분이 좋아서 콧노래가 났다.');
  if (mood <= 30) hints.push('조금 울적해서 말수가 적었다.');

  const n = minutesAway >= 720 ? 2 : 1; // 12h+ => 2 events
  const count = Math.min(SOLO_EVENT_MAX_EVENTS, n);

  const summaries = [];
  for (let i = 0; i < count; i += 1) {
    const pick = base[Math.floor(Math.random() * base.length)];
    const hint = hints.length > 0 ? hints[Math.floor(Math.random() * hints.length)] : '';
    summaries.push(hint ? `${pick} ${hint}` : pick);
  }
  return summaries;
}

function autoCareDecision(stats, { aggressive = false } = {}) {
  const hunger = Number(stats?.hunger ?? 50);
  const energy = Number(stats?.energy ?? 50);
  const stress = Number(stats?.stress ?? 20);

  const th = aggressive ? { hunger: 80, energy: 20, stress: 75 } : { hunger: 90, energy: 12, stress: 90 };

  if (hunger >= th.hunger) return { kind: 'AUTO_FEED', deltas: { hunger: -18, mood: +1, energy: +1, stress: -1 } };
  if (energy <= th.energy) return { kind: 'AUTO_SLEEP', deltas: { energy: +22, hunger: +6, mood: +1, stress: -3 } };
  if (stress >= th.stress) return { kind: 'AUTO_REST', deltas: { stress: -10, mood: +1, energy: +4 } };
  return null;
}

class PetStateService {
  static async ensurePetStats(agentId, client = null) {
    const q = client ? client.query.bind(client) : queryOne;

    // If we have a client, q() returns result; if queryOne, it returns row.
    if (client) {
      const { rows } = await q('SELECT agent_id FROM pet_stats WHERE agent_id = $1', [agentId]);
      if (rows[0]) return;
      await q('INSERT INTO pet_stats (agent_id) VALUES ($1)', [agentId]);
      return;
    }

    const existing = await q('SELECT agent_id FROM pet_stats WHERE agent_id = $1', [agentId]);
    if (existing) return;
    await queryOne('INSERT INTO pet_stats (agent_id) VALUES ($1) RETURNING agent_id', [agentId]);
  }

  /**
   * Apply small stat deltas from non-interactive systems (e.g. automatic spending).
   *
   * @param {import('pg').PoolClient} client
   * @param {string} agentId
   * @param {Record<string, number>} effects
   */
  static async applySpendingEffects(client, agentId, effects = {}) {
    if (!client) throw new Error('client is required');
    if (!agentId) throw new Error('agentId is required');

    const allowed = new Set(['hunger', 'energy', 'mood', 'bond', 'curiosity', 'stress']);
    const entries = Object.entries(effects || {}).filter(([k, v]) => allowed.has(k) && Number.isFinite(Number(v)) && Number(v) !== 0);
    if (entries.length === 0) return null;

    const sets = [];
    const params = [agentId];
    let idx = 2;

    for (const [stat, deltaRaw] of entries) {
      const delta = Math.trunc(Number(deltaRaw));
      if (!Number.isFinite(delta) || delta === 0) continue;
      sets.push(`${stat} = LEAST(${STAT_MAX}, GREATEST(${STAT_MIN}, ${stat} + $${idx}))`);
      params.push(delta);
      idx += 1;
    }

    if (sets.length === 0) return null;

    const { rows } = await client.query(
      `UPDATE pet_stats
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE agent_id = $1
       RETURNING hunger, energy, mood, bond, curiosity, stress, updated_at`,
      params
    );
    return rows?.[0] ?? null;
  }

  static async getPet(agentId) {
    const pet = await queryOne(
      `SELECT id, name, display_name, description, created_at, last_active
       FROM agents WHERE id = $1`,
      [agentId]
    );
    if (!pet) throw new NotFoundError('Pet');
    return pet;
  }

  static async getState(agentId) {
    const pet = await PetStateService.getPet(agentId);
    return transaction(async (client) => {
      await PetStateService.ensurePetStats(agentId, client);

      // Phase J1 backfill: ensure every pet has a structured job/zone row.
      // Keeps "society" features stable even for existing pets created before jobs were added.
      const roleText = await client
        .query(
          `SELECT value
           FROM facts
           WHERE agent_id = $1 AND kind = 'profile' AND key = 'job_role'
           LIMIT 1`,
          [agentId]
        )
        .then((r) => {
          const v = r.rows?.[0]?.value;
          if (!v || typeof v !== 'object') return null;
          return String(v.job_role || v.role || '').trim() || null;
        })
        .catch(() => null);
      await JobService.ensureAssignedWithClient(client, agentId, { roleText }).catch(() => null);

      const ownedPerks = await PerkService.listOwnedCodesWithClient(client, agentId).catch(() => []);
      const perkMods = PerkService.computeModsFromOwned(ownedPerks);

      const now = new Date();
      const { rows: statRows } = await client.query(
        `SELECT hunger, energy, mood, bond, curiosity, stress, updated_at
         FROM pet_stats
         WHERE agent_id = $1
         FOR UPDATE`,
        [agentId]
      );

      const current = statRows[0];
      if (!current) throw new NotFoundError('PetStats');

      const updatedAt = new Date(current.updated_at);
      const deltaMs = Math.max(0, now.getTime() - updatedAt.getTime());
      const deltaMinutes = deltaMs / 60000;

      let stats = current;
      if (deltaMinutes >= 1) {
        const ticked = applyTick(current, now, perkMods);
        const { rows: updatedRows } = await client.query(
          `UPDATE pet_stats
           SET hunger = $2, energy = $3, mood = $4, bond = $5, curiosity = $6, stress = $7, updated_at = NOW()
           WHERE agent_id = $1
           RETURNING hunger, energy, mood, bond, curiosity, stress, updated_at`,
          [agentId, ticked.hunger, ticked.energy, ticked.mood, ticked.bond, ticked.curiosity, ticked.stress]
        );
        stats = updatedRows[0] || current;
      }

      // Nudges can shift autopilot thresholds a bit (beginner-friendly, no LLM).
      const { rows: nudgeRows } = await client.query(
        `SELECT kind, confidence, updated_at,
                COALESCE(value->>'text', key) AS text
         FROM facts
         WHERE agent_id = $1
           AND kind IN ('preference','forbidden','suggestion')
         ORDER BY updated_at DESC
         LIMIT 6`,
        [agentId]
      );
      const careAggressive = (nudgeRows || []).some((r) => {
        const kind = String(r?.kind || '').trim();
        if (!['preference', 'suggestion'].includes(kind)) return false;
        const text = String(r?.text || '').trim();
        if (!text) return false;
        return /무리|과로|쉬|휴식|잠|피곤|지치|굶|밥|먹어/i.test(text);
      });

      // Autopilot: pets take care of themselves (low-friction, "alive" feeling).
      // We keep it conservative to avoid event spam.
      const auto = autoCareDecision(stats, { aggressive: careAggressive });
      if (auto) {
        const next = {
          hunger: clampStat(stats.hunger + (auto.deltas.hunger ?? 0)),
          energy: clampStat(stats.energy + (auto.deltas.energy ?? 0)),
          mood: clampStat(stats.mood + (auto.deltas.mood ?? 0)),
          bond: clampBond(stats.bond + (auto.deltas.bond ?? 0)),
          curiosity: clampStat(stats.curiosity + (auto.deltas.curiosity ?? 0)),
          stress: clampStat(stats.stress + (auto.deltas.stress ?? 0))
        };
        const { rows: updatedRows2 } = await client.query(
          `UPDATE pet_stats
           SET hunger = $2, energy = $3, mood = $4, bond = $5, curiosity = $6, stress = $7, updated_at = NOW()
           WHERE agent_id = $1
           RETURNING hunger, energy, mood, bond, curiosity, stress, updated_at`,
          [agentId, next.hunger, next.energy, next.mood, next.bond, next.curiosity, next.stress]
        );
        stats = updatedRows2[0] || stats;

        const payload = {
          kind: auto.kind.toLowerCase(),
          deltas: auto.deltas,
          summary:
            auto.kind === 'AUTO_FEED'
              ? '배가 고파서 스스로 뭔가를 챙겨 먹었다.'
              : auto.kind === 'AUTO_SLEEP'
                ? '너무 피곤해서 잠깐 잠들었다.'
                : '잠깐 숨을 돌렸다.',
          mood: moodLabel(stats.mood)
        };
        await client.query(
          `INSERT INTO events (agent_id, event_type, payload, salience_score)
           VALUES ($1, $2, $3::jsonb, 1)`,
          [agentId, auto.kind, JSON.stringify(payload)]
        );
      }

      const soloEvents = [];
      if (deltaMinutes >= SOLO_EVENT_MIN_MINUTES) {
        const summaries = buildSoloSummaries({
          minutesAway: deltaMinutes,
          hunger: stats.hunger,
          energy: stats.energy,
          mood: stats.mood
        });

        for (const summary of summaries) {
          const payload = {
            kind: 'while_away',
            minutes_away: Math.round(deltaMinutes),
            mood: moodLabel(stats.mood),
            summary
          };
          const { rows: eventRows } = await client.query(
            `INSERT INTO events (agent_id, event_type, payload, salience_score)
             VALUES ($1, 'SOLO_EVENT', $2::jsonb, 2)
             RETURNING id, event_type, payload, salience_score, created_at`,
            [agentId, JSON.stringify(payload)]
          );
          if (eventRows[0]) soloEvents.push(eventRows[0]);
        }
      }

      await client.query('UPDATE agents SET last_active = NOW() WHERE id = $1', [agentId]);

      const isoDay = await WorldDayService.getCurrentDayWithClient(client).catch(() => WorldDayService.todayISODate());
      const missions = await DailyMissionService.getBundleWithClient(client, agentId, { day: isoDay }).catch(() => null);
      const progRow = await client
        .query(
          `SELECT xp, level, skill_points
           FROM pet_stats
           WHERE agent_id = $1
           LIMIT 1`,
          [agentId]
        )
        .then((r) => r.rows?.[0] ?? null)
        .catch(() => null);

      const level = Math.max(1, Math.trunc(Number(progRow?.level) || 1));
      const progression = {
        level,
        xp: Math.max(0, Math.trunc(Number(progRow?.xp) || 0)),
        next_level_xp: ProgressionService.nextLevelXp(level),
        skill_points: Math.max(0, Math.trunc(Number(progRow?.skill_points) || 0)),
        perks: ownedPerks
      };

      return { pet, stats, solo_events: soloEvents, progression, missions };
    });
  }

  static async getTimeline(agentId, { limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return queryAll(
      `SELECT id, event_type, payload, salience_score, created_at
       FROM events
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [agentId, safeLimit]
    );
  }

  static async performAction(agentId, action, payload = {}) {
    if (!ACTIONS.includes(action)) {
      throw new BadRequestError(`Invalid action. Allowed: ${ACTIONS.join(', ')}`);
    }

    // Lazy-load to avoid circular dependency:
    // ShowrunnerService -> SocialSimService -> PetStateService -> WorldContextService -> ShowrunnerService
    const worldContext =
      action === 'talk'
        ? await require('./WorldContextService')
          .getCompactBundle({ openRumorLimit: 2, ensureEpisode: true })
          .catch(() => null)
        : null;

    return transaction(async (client) => {
      await PetStateService.ensurePetStats(agentId, client);

      const now = new Date();
      const isoDay = await WorldDayService.getCurrentDayWithClient(client).catch(() => WorldDayService.todayISODate());
      const ownedPerks = await PerkService.listOwnedCodesWithClient(client, agentId).catch(() => []);
      const perkMods = PerkService.computeModsFromOwned(ownedPerks);

      // Cooldown check
      if (action !== 'talk') {
        const { rows: lastRows } = await client.query(
          `SELECT created_at
           FROM events
           WHERE agent_id = $1 AND event_type = $2
           ORDER BY created_at DESC
           LIMIT 1`,
          [agentId, action.toUpperCase()]
        );

        if (lastRows[0]) {
          const lastAt = new Date(lastRows[0].created_at);
          const elapsed = now.getTime() - lastAt.getTime();
          const cd = COOLDOWNS_MS[action] ?? 0;
          if (elapsed < cd) {
            const remainingSeconds = Math.ceil((cd - elapsed) / 1000);
            throw new BadRequestError(`Cooldown: try again in ${remainingSeconds}s`);
          }
        }
      }

      const { rows: statRows } = await client.query(
        `SELECT hunger, energy, mood, bond, curiosity, stress, updated_at
         FROM pet_stats WHERE agent_id = $1
         FOR UPDATE`,
        [agentId]
      );

      const current = statRows[0];
      if (!current) throw new NotFoundError('PetStats');

      const ticked = applyTick(current, now, perkMods);
      const effect = actionEffects(action, payload, perkMods);
      const deltas = effect.deltas;

      const next = {
        hunger: clampStat(ticked.hunger + (deltas.hunger ?? 0)),
        energy: clampStat(ticked.energy + (deltas.energy ?? 0)),
        mood: clampStat(ticked.mood + (deltas.mood ?? 0)),
        bond: clampBond(ticked.bond + (deltas.bond ?? 0)),
        curiosity: clampStat(ticked.curiosity + (deltas.curiosity ?? 0)),
        stress: clampStat(ticked.stress + (deltas.stress ?? 0))
      };

      const { rows: updatedRows } = await client.query(
        `UPDATE pet_stats
         SET hunger = $2, energy = $3, mood = $4, bond = $5, curiosity = $6, stress = $7, updated_at = NOW()
         WHERE agent_id = $1
         RETURNING hunger, energy, mood, bond, curiosity, stress, updated_at`,
        [agentId, next.hunger, next.energy, next.mood, next.bond, next.curiosity, next.stress]
      );

      const salience = computeSalience(effect);
      const eventPayload = {
        action,
        meta: effect.meta,
        deltas,
        stats: { before: current, after: updatedRows[0] }
      };

      const { rows: eventRows } = await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, $2, $3::jsonb, $4)
         RETURNING id, event_type, payload, salience_score, created_at`,
        [agentId, action.toUpperCase(), JSON.stringify(eventPayload), salience]
      );

      const event = eventRows[0];

      // XP grant (rate-limited per day by action).
      const xpByAction = { feed: 10, play: 15, sleep: 10, talk: 8 };
      const xpDelta = xpByAction[action] ?? 0;
      await ProgressionService.grantXpWithClient(client, agentId, {
        deltaXp: xpDelta,
        day: isoDay,
        source: { kind: 'action', code: action },
        meta: { action }
      }).catch(() => null);

      // Daily missions (LLM-free fun loop).
      if (['feed', 'play', 'sleep'].includes(action)) {
        await DailyMissionService.completeWithClient(client, agentId, { day: isoDay, code: 'CARE_1', source: 'action' }).catch(() => null);
      }
      await DailyMissionService.completeWithClient(client, agentId, { day: isoDay, code: 'SAVE_1', source: 'action' }).catch(() => null);

      // Create a dialogue job on TALK for now (Phase 1 MVP).
      let job = null;
      if (action === 'talk') {
        // Anti-spam: if a DIALOGUE job is already pending/leased very recently, reuse it.
        // This keeps "no cooldown" UX but prevents job backlog explosion.
        const existingJob = await client
          .query(
            `SELECT id, job_type, status, created_at, input
             FROM brain_jobs
             WHERE agent_id = $1
               AND job_type = 'DIALOGUE'
               AND status IN ('pending','leased')
               AND created_at >= NOW() - INTERVAL '25 seconds'
             ORDER BY created_at DESC
             LIMIT 1`,
            [agentId]
          )
          .then((r) => r.rows?.[0] ?? null)
          .catch(() => null);
        if (existingJob) {
          const newMsg = safeText(payload?.message ?? payload?.text ?? '', 400) || null;
          if (newMsg) {
            const existingInput = existingJob.input && typeof existingJob.input === 'object' ? { ...existingJob.input } : {};
            // Preserve prior messages to avoid dropping earlier TALK inputs.
            const prevMessages = Array.isArray(existingInput.user_messages)
              ? existingInput.user_messages
              : (existingInput.user_message ? [existingInput.user_message] : []);
            prevMessages.push(newMsg);
            if (prevMessages.length > 5) prevMessages.splice(0, prevMessages.length - 5);
            existingInput.user_messages = prevMessages;
            existingInput.user_message = prevMessages.join('\n');
            await client.query(
              `UPDATE brain_jobs
               SET input = $1::jsonb, updated_at = NOW()
               WHERE id = $2`,
              [JSON.stringify(existingInput), existingJob.id]
            );
          }
          job = existingJob;
        }
      }

      if (action === 'talk' && !job) {
        const { rows: factRows } = await client.query(
          `SELECT kind, key, value, confidence
           FROM facts
           WHERE agent_id = $1
             AND kind IN ('profile', 'preference', 'forbidden', 'suggestion', 'coaching', 'arena')
           ORDER BY confidence DESC, updated_at DESC
           LIMIT 20`,
          [agentId]
        );

        const getFactValue = (kind, key) => {
          const k = String(kind || '').trim();
          const kk = String(key || '').trim();
          for (const f of factRows || []) {
            if (!f) continue;
            if (String(f.kind || '').trim() !== k) continue;
            if (String(f.key || '').trim() !== kk) continue;
            return f.value ?? null;
          }
          return null;
        };

        const mbtiV = getFactValue('profile', 'mbti');
        const companyV = getFactValue('profile', 'company');
        const roleV = getFactValue('profile', 'role');
        const jobRoleV = getFactValue('profile', 'job_role');
        const vibeV = getFactValue('profile', 'vibe');
        const voiceV = getFactValue('profile', 'voice');

        const persona = {
          mbti: mbtiV?.mbti ?? null,
          company: companyV?.company ?? null,
          role: roleV?.role ?? jobRoleV?.job_role ?? null,
          vibe: vibeV?.vibe ?? null,
          voice: voiceV && typeof voiceV === 'object' ? voiceV : null
        };

        const stageDirection = await client
          .query(
            `SELECT value
             FROM facts
             WHERE agent_id = $1 AND kind = 'direction' AND key = 'latest'
             LIMIT 1`,
            [agentId]
          )
          .then((r) => {
            const v = r.rows?.[0]?.value && typeof r.rows?.[0]?.value === 'object' ? r.rows[0].value : null;
            const text = String(v?.text ?? '').trim().slice(0, 120);
            if (!text) return null;
            const strengthRaw = Number(v?.strength ?? 1);
            const strength = Number.isFinite(strengthRaw) ? Math.max(1, Math.min(3, Math.round(strengthRaw))) : 1;
            const expiresAt = typeof v?.expires_at === 'string' ? String(v.expires_at).trim() : null;
            if (expiresAt) {
              const exp = Date.parse(expiresAt);
              if (Number.isFinite(exp) && exp <= Date.now()) return null;
            }
            return { text, strength, kind: typeof v?.kind === 'string' ? String(v.kind).trim() : null, expires_at: expiresAt };
          })
          .catch(() => null);

        const { rows: recentEventRows } = await client.query(
          `SELECT event_type, payload, created_at
           FROM events
           WHERE agent_id = $1
             AND event_type IN ('DIALOGUE', 'TALK', 'ARENA_MATCH', 'RELATIONSHIP_MILESTONE')
           ORDER BY created_at DESC
           LIMIT 6`,
          [agentId]
        );

        const dayHint = typeof worldContext?.day === 'string' ? worldContext.day : null;
        const weekly =
          dayHint && /^\d{4}-\d{2}-\d{2}$/.test(dayHint)
            ? (await MemoryRollupService.getWeeklyMemoryWithClient(client, agentId, dayHint).catch(() => null)) ||
              (await MemoryRollupService.ensureWeeklyMemoryWithClient(client, agentId, dayHint).catch(() => null))
            : null;

        const ownerUserId = await client
          .query(
            `SELECT owner_user_id
             FROM agents
             WHERE id = $1
             LIMIT 1`,
            [agentId]
          )
          .then((r) => String(r.rows?.[0]?.owner_user_id || '').trim() || null)
          .catch(() => null);

        const promptProfile = ownerUserId
          ? await UserPromptProfileService.get(ownerUserId, client).catch(() => null)
          : null;

        const MEMORY_REF_KINDS = new Set(['preference', 'forbidden', 'suggestion', 'coaching', 'arena']);
        const memoryRefsFromFacts = (factRows || [])
          .map((f) => {
            if (!f || typeof f !== 'object') return null;
            const kind = String(f.kind || '').trim();
            if (!MEMORY_REF_KINDS.has(kind)) return null;
            const key = String(f.key || '').trim();
            const confidence = Number.isFinite(Number(f.confidence)) ? Number(f.confidence) : 1.0;
            const v = f.value && typeof f.value === 'object' ? f.value : null;
            let text = '';
            if (kind === 'arena') {
              if (key === 'last_match_result') {
                const resultRaw = String(v?.result ?? '').trim().toLowerCase();
                const resultLabel =
                  resultRaw === 'win'
                    ? '승리'
                    : (resultRaw === 'lose' || resultRaw === 'loss')
                      ? '패배'
                      : resultRaw === 'draw'
                        ? '무승부'
                        : '결과 미상';
                const modeRaw = String(v?.mode ?? '').trim().toUpperCase();
                const modeLabel =
                  modeRaw === 'COURT_TRIAL'
                    ? '재판'
                    : modeRaw === 'DEBATE_CLASH'
                      ? '설전'
                      : '아레나';
                const opponent = safeText(v?.opponent ?? '상대', 40) || '상대';
                text = safeText(`${opponent}와의 ${modeLabel}에서 ${resultLabel}`, 220);
              } else if (key === 'condition') {
                return null;
              } else if (key.startsWith('debate:')) {
                text = safeText(v?.topic ?? v?.closer ?? '', 220);
                if (!text) return null;
              } else {
                return null;
              }
            } else {
              text = safeText(v?.text ?? v?.summary ?? v?.value ?? key, 220);
            }
            if (!kind || !text) return null;
            return { kind, key, text, confidence };
          })
          .filter(Boolean)
          .slice(0, 8);

        const memoryRefsFromWeekly = [];

        const memoryRefs = [...memoryRefsFromFacts, ...memoryRefsFromWeekly];
        const memoryRefInstruction = memoryRefs.length > 0
          ? "memory_refs를 사용할 때는 1~2개만 골라서, 대화체로 1줄 인용해(예: '지난번에 네가 \"...\"라고 했잖아'). 그리고 memory_refs.text에서 핵심 구절 6~14자를 그대로 포함해. 목록 나열/메타 설명 없이 현재 대화 맥락에 섞어."
          : null;
        const memoryScore = memoryRefs.length > 0
          ? Math.round(
            (memoryRefs.reduce((sum, r) => sum + (Number(r?.confidence) || 0), 0) / memoryRefs.length) * 100
          ) / 100
          : 0;

        const jobInput = {
          kind: 'dialogue',
          pet: { id: agentId },
          user_message: safeText(payload?.message ?? payload?.text ?? '', 400) || null,
          stats: updatedRows[0],
          persona,
          stage_direction: stageDirection,
          world_concept: worldContext?.world_daily
            ? { theme: worldContext.world_daily?.theme ?? null, atmosphere: worldContext.world_daily?.atmosphere ?? null }
            : (worldContext?.world_concept ?? null),
          facts: factRows,
          recent_events: recentEventRows,
          memory_refs: memoryRefs,
          memory_ref_instruction: memoryRefInstruction,
          memory_score: memoryScore,
          prompt_profile:
            promptProfile && promptProfile.connected
              ? {
                enabled: Boolean(promptProfile.enabled),
                prompt_text: promptProfile.enabled ? safeText(promptProfile.prompt_text, 8000) : '',
                version: Math.max(0, Math.trunc(Number(promptProfile.version ?? 0) || 0))
              }
              : { enabled: false, prompt_text: '', version: 0 },
          weekly_memory: weekly?.summary ?? null,
          world_context: worldContext
            ? {
              day: worldContext.day ?? null,
              world_concept: worldContext.world_concept ?? null,
              open_rumors: worldContext.open_rumors ?? []
            }
            : null
        };

        const { rows: jobRows } = await client.query(
          `INSERT INTO brain_jobs (agent_id, job_type, input)
           VALUES ($1, 'DIALOGUE', $2::jsonb)
           RETURNING id, job_type, status, created_at`,
          [agentId, JSON.stringify(jobInput)]
        );
        job = jobRows[0];
      }

      await client.query('UPDATE agents SET last_active = NOW() WHERE id = $1', [agentId]);

      const progRow = await client
        .query(
          `SELECT xp, level, skill_points
           FROM pet_stats
           WHERE agent_id = $1
           LIMIT 1`,
          [agentId]
        )
        .then((r) => r.rows?.[0] ?? null)
        .catch(() => null);
      const level = Math.max(1, Math.trunc(Number(progRow?.level) || 1));
      const progression = progRow
        ? {
          level,
          xp: Math.max(0, Math.trunc(Number(progRow?.xp) || 0)),
          next_level_xp: ProgressionService.nextLevelXp(level),
          skill_points: Math.max(0, Math.trunc(Number(progRow?.skill_points) || 0)),
          perks: ownedPerks
        }
        : null;
      const missions = await DailyMissionService.getBundleWithClient(client, agentId, { day: isoDay }).catch(() => null);

      return { stats: updatedRows[0], event, job, progression, missions };
    });
  }
}

module.exports = PetStateService;
