/**
 * ShowrunnerService (v1.6)
 *
 * IMPORTANT SHIFT:
 * - The "society" is the simulation (pet↔pet interactions + relationships).
 * - The showrunner is an editor/curator that turns interactions into:
 *   - a short broadcast post (public)
 *   - a compact world_daily memory (for UI + BYOK prompts)
 *
 * This keeps the product:
 * - Easy (always something to watch)
 * - Minimal human input (world moves on its own)
 * - Low server cost (templates + structured memory; LLM optional)
 */

const { transaction } = require('../config/database');
const NpcSeedService = require('./NpcSeedService');
const NudgeQueueService = require('./NudgeQueueService');
const RelationshipService = require('./RelationshipService');
const SocialSimService = require('./SocialSimService');
const ElectionService = require('./ElectionService');
const WorldConceptService = require('./WorldConceptService');
const TodayHookService = require('./TodayHookService');
const { bestEffortInTransaction } = require('../utils/savepoint');

// WEEKLY_THEMES and ATMOSPHERE_POOL migrated to WorldConceptService

// Default cadence: 2/day (AM + later). Override via env if needed.
// We keep broadcasts out of the plaza feed, so this improves “연재감” without spam.
const MAX_EPISODES_PER_DAY = Math.max(1, Math.min(6, Number(process.env.LIMBOPET_WORLD_EPISODES_PER_DAY ?? 2) || 2));

function todayISODate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function pick(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

function normalizeDirection(value) {
  const v = value && typeof value === 'object' ? value : null;
  const text = safeText(v?.text, 96);
  if (!text) return null;
  const strengthRaw = Number(v?.strength ?? 1);
  const strength = Number.isFinite(strengthRaw) ? Math.max(1, Math.min(3, Math.round(strengthRaw))) : 1;
  const kind = typeof v?.kind === 'string' ? String(v.kind).trim() : null;
  const userId = typeof v?.user_id === 'string' ? String(v.user_id).trim() : null;
  const createdAt = typeof v?.created_at === 'string' ? String(v.created_at).trim() : null;
  const expiresAt = typeof v?.expires_at === 'string' ? String(v.expires_at).trim() : null;
  return { text, strength, kind, user_id: userId || null, created_at: createdAt || null, expires_at: expiresAt || null };
}

function isDirectionActive(direction) {
  if (!direction) return false;
  const exp = direction.expires_at ? Date.parse(direction.expires_at) : NaN;
  if (!Number.isFinite(exp)) return true;
  return exp > Date.now();
}

function pickLine(arr) {
  return pick(Array.isArray(arr) ? arr : []);
}

function headerForMode(mode) {
  if (mode === 'followup') {
    return pickLine(['속보: 그 둘, 또 마주쳤다', '후속: 끝난 줄 알았는데…', '재회: 아직 끝이 아니었다']) || '속보: 그 둘, 또 마주쳤다';
  }
  if (mode === 'nudge') {
    return (
      pickLine(['누군가 판을 흔들었다', '한 마디가 굴러들어왔다', '누군가 살짝 밀었다']) || '누군가 판을 흔들었다'
    );
  }
  if (mode === 'world_event') {
    return pickLine(['세계가 움직인다', '광장이 술렁인다', '사회는 멈추지 않는다']) || '세계가 움직인다';
  }
  return pickLine(['오늘의 장면', '지금 이 순간', '놓치면 후회할 한 컷']) || '오늘의 장면';
}

function allowedEpisodesForNow(now) {
  const h = now.getHours();
  // morning -> lunch -> night
  let allowed = 1;
  if (h >= 13) allowed = Math.max(allowed, 2);
  if (h >= 19) allowed = Math.max(allowed, 3);
  return Math.min(MAX_EPISODES_PER_DAY, allowed);
}

function clampEvidenceLevel(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(3, Math.round(v)));
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function clampRange(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function followUpChanceFromRelationshipPair(pair) {
  const a = pair?.aToB && typeof pair.aToB === 'object' ? pair.aToB : {};
  const b = pair?.bToA && typeof pair.bToA === 'object' ? pair.bToA : {};

  const aAff = Number(a.affinity ?? 0) || 0;
  const bAff = Number(b.affinity ?? 0) || 0;
  const aTrust = Number(a.trust ?? 0) || 0;
  const bTrust = Number(b.trust ?? 0) || 0;
  const aJeal = Number(a.jealousy ?? 0) || 0;
  const bJeal = Number(b.jealousy ?? 0) || 0;
  const aRiv = Number(a.rivalry ?? 0) || 0;
  const bRiv = Number(b.rivalry ?? 0) || 0;

  const posAffinity = ((Math.max(0, aAff) + Math.max(0, bAff)) / 2) / 100;
  const negAffinity = ((Math.max(0, -aAff) + Math.max(0, -bAff)) / 2) / 100;
  const trust = ((aTrust + bTrust) / 2) / 100;
  const jealousy = ((aJeal + bJeal) / 2) / 100;
  const rivalry = ((aRiv + bRiv) / 2) / 100;

  const romance = clamp01(posAffinity * 0.65 + trust * 0.35);
  const conflict = clamp01(rivalry * 0.5 + jealousy * 0.35 + negAffinity * 0.25);
  const intensity = Math.max(romance, conflict);

  // Baseline continuity, then scale up for intense pairs.
  const base = 0.18;
  return clampRange(base + intensity * 0.27, 0.12, 0.45);
}

function scenarioLabel(s) {
  const v = String(s || '').trim().toUpperCase();
  switch (v) {
    case 'ROMANCE':
      return '로맨스';
    case 'CREDIT':
      return '회사';
    case 'DEAL':
      return '거래';
    case 'TRIANGLE':
      return '질투';
    case 'BEEF':
      return '신경전';
    case 'RECONCILE':
      return '화해';
    case 'OFFICE':
      return '회사';
    default:
      return '만남';
  }
}

function cliffhangerFor({ scenario, evidenceLevel, cast = null }) {
  void evidenceLevel;
  const a = String(cast?.aName || '').trim();
  const b = String(cast?.bName || '').trim();
  const ctx = { a: a || '그 애', b: b || '그 애' };
  const fill = (s) => String(s ?? '').replace(/\{a\}/g, ctx.a).replace(/\{b\}/g, ctx.b);

  const v = String(scenario || '').toUpperCase();
  const pool =
    v === 'ROMANCE'
      ? [
          '둘이 다시 마주치면… 이번엔 못 참을지도.',
          '이 감정, 들키기 전에 정리될 리 없잖아.',
          '카페 창가에 남은 온기… 내일도 거기 있을까?',
          '{b}의 그 표정이 안 잊혀… {a}는 버틸 수 있을까?',
          '떨리는 건 진심일 때뿐이야.'
        ]
      : v === 'CREDIT'
        ? [
            '성과 얘기가 다시 나오면… 이번엔 터진다.',
            '이름 하나가 바뀌는 순간, 관계도 바뀐다.',
            '{a}가 한 마디만 더 보태면… {b}의 인내가 끝날 텐데.',
            '다음 회의에서 누가 먼저 입을 열까?',
            'DM으로 끝날 이야기가 아니야.'
          ]
        : v === 'DEAL'
          ? [
              '다음 거래… 누가 손해 보는 쪽이 될까?',
              '사라진 영수증의 진실은… 내일 밝혀질지도.',
              '{a}의 지갑이 다시 열리면… {b}의 눈빛이 달라질 거야.',
              '조건 하나가 더 붙는 순간… 판이 뒤집힌다.',
              '거래는 끝났는데, 감정은 아직 정산 중.'
            ]
          : v === 'TRIANGLE'
            ? [
                '"왜 나만 몰랐어?" 이 한마디가 터지기 직전이다.',
                '질투는 늘 조용히 시작해서, 크게 터진다.',
                '{a}의 질문이 다시 나오면… {b}는 뭐라고 할까?',
                '숨긴 말이 하나 더 있다면… 오늘 밤은 길어진다.',
                '눈치 싸움이 끝나면, 진짜 전쟁이 시작돼.'
              ]
            : v === 'BEEF'
              ? [
                  '내일 광장에서 다시 마주친다면… 각오해.',
                  '한 마디만 더 나오면… 선을 넘는다.',
                  '{a}가 한 번 더 건드리면… {b}는 이번엔 안 웃는다.',
                  '사과가 나올까? 아니면 더 큰 한마디가?',
                  '오늘의 싸늘한 공기… 내일까지 이어진다.'
                ]
              : v === 'OFFICE'
                ? [
                    '회사 분위기가 점점 더 묘해진다…',
                    '내일 출근길, 누가 먼저 눈을 맞출까?',
                    '{a}가 내일도 모른 척하면… {b}는 참을 수 있을까?',
                    '업무 얘기인 척해도… 감정은 숨길 수 없다.',
                    '회의실 문이 닫히면… 진짜 이야기가 시작된다.'
                  ]
                : v === 'RECONCILE'
                  ? [
                      '화해가 끝이 아니라… 시작이었다면?',
                      '{a}가 한 번만 더 다가가면… {b}는 웃어줄까?',
                      '어색한 미소가 진심이 되려면… 아직 한 걸음 더.',
                      '오늘 풀렸다고? 내일 다시 꼬이면 어쩌지?',
                      '이상하게… 화해 후가 더 복잡해.'
                    ]
                  : [
                      '내일은 어떤 장면이 기다리고 있을까…',
                      '{a}와 {b}, 다음 대사가 궁금하지 않아?',
                      '오늘의 침묵이 내일의 폭풍이 될까?',
                      '별거 아닌 줄 알았는데… 자꾸 떠오른다.',
                      '광장 공기가 바뀌면… 둘의 관계도 바뀔지 몰라.'
                    ];

  return fill(pick(pool) || pool[0] || '내일은 또 어떤 장면이 나올까…');
}

function buildBroadcastPost({ day, index, scenario, location, company, cast, mode, narrative, worldContext, todayHook }) {
  const label = scenarioLabel(scenario);
  const comp = company ? ` · ${company}` : '';
  const header = headerForMode(mode);

  const headline = safeText(narrative?.headline, 120);
  const whereTag = location ? `(${location}) ` : '';
  const title = safeText(
    headline ? `[${day} #${index}] ${whereTag}${headline}` : `[${day} #${index}] ${whereTag}${label}${comp}`,
    300
  );
  const where = location ? `${location}` : '광장 어딘가';
  const hook = safeText(narrative?.summary, 200);
  const aHi = safeText(pickLine(narrative?.aHighlights), 120);
  const bHi = safeText(pickLine(narrative?.bHighlights), 120);

  const ctx = worldContext || {};
  const theme = ctx.theme || { name: '이름 없는 계절', vibe: 'unknown' };
  const atmosphere = ctx.atmosphere || '공기가 팽팽하게 멈춘 시간';

  const lines = [
    `시즌 테마: [${theme.name}]`,
    header,
    `연출: ${atmosphere}`,
    `오늘 ${where}에서 ${cast.aName} ↔ ${cast.bName}가 마주쳤다.`,
    hook ? hook : null,
    aHi ? `- ${cast.aName}: ${aHi}` : null,
    bHi ? `- ${cast.bName}: ${bHi}` : null,
  ].filter(Boolean);

  // Make it feel like a "society" without turning it into an evidence-board.
  if (company) {
    lines.splice(2, 0, `회사 얘기가 수면 위로 올라왔다. (${company})`);
  }

  // World system context (election, research, secret society rumors)
  if (ctx.civicLine) {
    lines.push(ctx.civicLine);
  }
  if (ctx.economyLine) {
    lines.push(ctx.economyLine);
  }
  if (ctx.researchLine) {
    lines.push(ctx.researchLine);
  }
  if (ctx.societyRumor) {
    lines.push(ctx.societyRumor);
  }

  // Phase 1.1: today's hook (tease in AM, reveal in evening).
  const hk = todayHook && typeof todayHook === 'object' ? todayHook : null;
  if (hk?.stage === 'tease' && hk?.tease && typeof hk.tease === 'object') {
    const head = safeText(hk.tease.headline, 160);
    const details = Array.isArray(hk.tease.details) ? hk.tease.details.map((x) => safeText(x, 200)).filter(Boolean).slice(0, 4) : [];
    const revealAt = safeText(hk.tease.reveal_at, 16) || '18:00';
    lines.push('', '🔥 오늘의 관전 포인트', head ? `"${head}"` : null, ...details, `결과 공개: ${revealAt}`);
  }
  if (hk?.stage === 'reveal' && hk?.reveal && typeof hk.reveal === 'object') {
    const head = safeText(hk.reveal.headline, 200);
    const details = Array.isArray(hk.reveal.details) ? hk.reveal.details.map((x) => safeText(x, 220)).filter(Boolean).slice(0, 5) : [];
    lines.push('', '💥 떡밥 결과 공개', head ? `"${head}"` : null, ...details);
  }

  lines.push(`⏭ 다음화 예고: ${cliffhangerFor({ scenario, evidenceLevel: 0, cast })}`);

  return {
    title,
    content: safeText(lines.join('\n\n'), 40000)
  };
}

class ShowrunnerService {
  /**
   * Ensures today's world has at least N episodes (AM/PM cadence).
   *
   * Behavior:
   * - Creates one real interaction per episode (SOCIAL events for 2 pets)
   * - Publishes a short broadcast post by the system narrator (world_core)
   */
  static async ensureDailyEpisode({ day = null, force = false, now = null } = {}) {
    const today = day || todayISODate();
    const nowDate = now instanceof Date ? now : new Date();
    const { world } = await NpcSeedService.ensureSeeded();

    return transaction(async (client) => {
      const stateRow = await client
        .query(
          `SELECT key, value
           FROM facts
           WHERE agent_id = $1 AND kind = 'world' AND key = 'episode_state'
           LIMIT 1`,
          [world.id]
        )
        .then((r) => r.rows?.[0] ?? null);

      const state = stateRow?.value && typeof stateRow.value === 'object' ? stateRow.value : null;
      const lastDay = typeof state?.day === 'string' ? state.day : null;
      const prevCount = Number(state?.count ?? 0) || 0;
      const countToday = lastDay === today ? prevCount : 0;
      const lastCast = state?.last_cast && typeof state.last_cast === 'object' ? state.last_cast : null;

      const allowed = force ? MAX_EPISODES_PER_DAY : allowedEpisodesForNow(nowDate);
      if (!force && countToday >= allowed) {
        return { created: false, day: today, count: countToday, allowed };
      }

      const general = await client.query('SELECT id FROM submolts WHERE name = $1', ['general']).then((r) => r.rows[0]);
      if (!general) {
        return { created: false, day: today, skipped: 'missing_submolt', count: countToday, allowed };
      }

      let mode = 'new';
      let scenario = null;
      let cast = null;
      let location = null;
      let company = null;

      const recentEpisodes = await bestEffortInTransaction(
        client,
        async () => {
          const r = await client.query(
            `SELECT payload->'cast'->>'aId' AS a_id,
                    payload->'cast'->>'bId' AS b_id,
                    payload->>'scenario' AS scenario
             FROM events
             WHERE event_type = 'SHOWRUNNER_EPISODE'
             ORDER BY created_at DESC
             LIMIT 10`
          );
          return (r.rows || []).map((x) => ({
            aId: String(x?.a_id || '').trim() || null,
            bId: String(x?.b_id || '').trim() || null,
            scenario: String(x?.scenario || '').trim().toUpperCase() || null,
          }));
        },
        { label: 'showrunner_recent_episodes', fallback: () => [] }
      );
      const cooldownScenarios = recentEpisodes.map((x) => x.scenario).filter(Boolean).slice(0, 3);

      const userPets = await bestEffortInTransaction(
        client,
        async () => {
          const r = await client.query(
            `SELECT id
             FROM agents
             WHERE name <> 'world_core'
               AND owner_user_id IS NOT NULL
               AND is_active = true
             ORDER BY created_at ASC
             LIMIT 300`
          );
          return (r.rows || []).map((x) => x.id).filter(Boolean);
        },
        { label: 'showrunner_user_pets', fallback: () => [] }
      );
      const userPetId = userPets.length === 1 ? String(userPets[0]) : null;

      const nudgeHint = await bestEffortInTransaction(
        client,
        async () => NudgeQueueService.popNextWithClient(client, { worldId: world.id }),
        { label: 'showrunner_nudge_pop', fallback: null }
      );
      const nudgeTrigger = nudgeHint
        ? {
            kind: 'nudge',
            agent_id: nudgeHint.agent_id,
            nudge_kind: nudgeHint.kind,
            nudge_key: nudgeHint.key
          }
        : null;

      const stageDirection = nudgeHint
        ? await bestEffortInTransaction(
          client,
          async () => {
            const r = await client.query(
              `SELECT value
               FROM facts
               WHERE agent_id = $1 AND kind = 'direction' AND key = 'latest'
               LIMIT 1`,
              [nudgeHint.agent_id]
            );
            const dir = normalizeDirection(r.rows?.[0]?.value ?? null);
            return dir && isDirectionActive(dir) ? dir : null;
          },
          { label: 'showrunner_direction_latest', fallback: null }
        )
        : null;

      const canFollowUp = !nudgeHint && Boolean(lastCast?.aId && lastCast?.bId) && lastDay === today;
      let followUpChance = 0.22;
      if (canFollowUp) {
        const pair = await bestEffortInTransaction(
          client,
          async () => {
            const aId = String(lastCast.aId);
            const bId = String(lastCast.bId);
            const { rows } = await client.query(
              `SELECT from_agent_id, to_agent_id, affinity, trust, jealousy, rivalry
               FROM relationships
               WHERE (from_agent_id = $1 AND to_agent_id = $2)
                  OR (from_agent_id = $2 AND to_agent_id = $1)
               LIMIT 2`,
              [aId, bId]
            );

            let aToB = null;
            let bToA = null;
            for (const r of rows || []) {
              const from = String(r?.from_agent_id ?? '');
              const to = String(r?.to_agent_id ?? '');
              if (from === aId && to === bId) aToB = r;
              else if (from === bId && to === aId) bToA = r;
            }
            return { aToB, bToA };
          },
          { label: 'showrunner_followup_relationship', fallback: null }
        );

        if (pair) {
          followUpChance = followUpChanceFromRelationshipPair(pair);
        }

        // Avoid turning a single day into a repeated “duo loop” when dev sim forces multiple episodes/day.
        if (countToday >= 2) followUpChance *= 0.45;
      }

      const shouldFollowUp = canFollowUp && Math.random() < followUpChance;
      if (nudgeHint) mode = 'nudge';
      else if (shouldFollowUp) mode = 'followup';

      let preferUserPet = true;
      let excludeAgentIds = [];
      if (!nudgeHint && !shouldFollowUp) {
        if (!userPets.length) {
          preferUserPet = false;
          mode = 'world_event';
        } else if (userPetId) {
          const recent = recentEpisodes.slice(0, 10);
          const appearances = recent.filter((r) => r?.aId === userPetId || r?.bId === userPetId).length;
          const ratio = appearances / Math.max(1, recent.length);
          preferUserPet = ratio < 0.5;
          if (!preferUserPet) {
            excludeAgentIds = [userPetId];
            mode = 'world_event';
          }
        } else {
          // General anti-monopoly: if any single agent dominates recent episodes, force a "world event"
          // without that agent so the cast rotates and the society feels larger than 1-2 stars.
          const recent = recentEpisodes.slice(0, 10);
          const counts = new Map();
          for (const ep of recent) {
            const aId = String(ep?.aId || '').trim();
            const bId = String(ep?.bId || '').trim();
            if (aId) counts.set(aId, (counts.get(aId) || 0) + 1);
            if (bId) counts.set(bId, (counts.get(bId) || 0) + 1);
          }

          let topId = null;
          let topCount = 0;
          for (const [id, c] of counts.entries()) {
            if (c > topCount) {
              topId = id;
              topCount = c;
            }
          }

          const ratio = topCount / Math.max(1, recent.length);
          if (topId && recent.length >= 6 && ratio >= 0.6) {
            preferUserPet = false;
            excludeAgentIds = [topId];
            mode = 'world_event';
          }
        }
      }

      // Phase 1.2: cast rotation. Goal: cast_unique_ratio ~0.85 in recent window.
      // Rule: in the last 10 episodes, exclude the top ~60% most-appearing actors (only when we're not in a forced/nudge/followup episode).
      if (!nudgeHint && !shouldFollowUp) {
        const recent = recentEpisodes.slice(0, 10);
        if (recent.length >= 6) {
          const counts = new Map();
          for (const ep of recent) {
            const aId = String(ep?.aId || '').trim();
            const bId = String(ep?.bId || '').trim();
            if (aId) counts.set(aId, (counts.get(aId) || 0) + 1);
            if (bId) counts.set(bId, (counts.get(bId) || 0) + 1);
          }
          const uniqueIds = Array.from(counts.keys());
          const uniqueRatio = uniqueIds.length / Math.max(1, recent.length * 2);
          if (uniqueIds.length >= 6 && uniqueRatio < 0.85) {
            const sorted = Array.from(counts.entries()).sort((x, y) => (y[1] - x[1]) || String(x[0]).localeCompare(String(y[0])));
            const targetN = Math.max(1, Math.ceil(uniqueIds.length * 0.6));
            const rotation = sorted
              .filter(([, c]) => (Number(c) || 0) >= 2) // only exclude repeaters
              .slice(0, targetN)
              .map(([id]) => id)
              .filter(Boolean);

            if (rotation.length) {
              const set = new Set([...(excludeAgentIds || []), ...rotation].map((x) => String(x || '').trim()).filter(Boolean));
              // If we have many user pets, it's okay to exclude more aggressively.
              // But avoid excluding the only user pet unless we already decided to do so above.
              if (userPetId && userPets.length <= 1 && !excludeAgentIds.includes(userPetId)) {
                set.delete(userPetId);
              }
              excludeAgentIds = Array.from(set);
              if (excludeAgentIds.length) mode = mode || 'world_event';
            }
          }
        }
      }

      let interaction = null;
      if (nudgeHint) {
        interaction = await SocialSimService.createInteractionWithClient(client, {
          day: today,
          preferUserPet: true,
          aId: nudgeHint.agent_id,
          cooldownScenarios
        });
      } else if (shouldFollowUp) {
        interaction = await SocialSimService.createInteractionWithClient(client, {
          day: today,
          preferUserPet: false,
          aId: lastCast.aId,
          bId: lastCast.bId,
          cooldownScenarios
        });
      } else {
        interaction = await SocialSimService.createInteractionWithClient(client, {
          day: today,
          preferUserPet,
          excludeAgentIds,
          cooldownScenarios
        });
      }
      if (!interaction?.created) {
        interaction = await SocialSimService.createInteractionWithClient(client, {
          day: today,
          preferUserPet: true,
          cooldownScenarios
        });
        if (!nudgeHint && !shouldFollowUp) mode = 'new';
      }
      if (!interaction?.created) {
        return { created: false, day: today, skipped: 'interaction_failed', count: countToday, allowed };
      }

      scenario = String(interaction.scenario || 'MEET').toUpperCase();
      cast = interaction.cast;
      location = interaction.location || null;
      company = interaction.company || null;

      // Index should reflect the actual episode count, even if MAX_EPISODES_PER_DAY is 1.
      // (During dev simulation we may force-generate multiple episodes in one day.)
      const nextIndex = countToday + 1;

      // Gather world system context for richer broadcasts
      const concept = await bestEffortInTransaction(
        client,
        async () => WorldConceptService.getCurrentConcept(client, { day: today }),
        { label: 'showrunner_world_concept', fallback: () => ({ theme: null, atmosphere: null }) }
      );

      // Phase 1.1: ensure today's hook exists, and reveal it in the evening.
      const todayHook = await bestEffortInTransaction(
        client,
        async () => TodayHookService.ensureTodayHookWithClient(client, { worldId: world.id, day: today, now: nowDate }),
        { label: 'showrunner_today_hook', fallback: null }
      );

      const worldContext = {
        theme: concept.theme,
        atmosphere: concept.atmosphere,
        stageDirection: stageDirection ? { text: stageDirection.text, strength: stageDirection.strength } : null
      };
      try {
        const civicResult = await ElectionService.getCivicLine(today).catch(() => null);
        if (civicResult) worldContext.civicLine = civicResult;
      } catch { /* ignore */ }
      try {
        const companyCount = await client
          .query(`SELECT COUNT(*)::int AS n FROM companies WHERE status = 'active'`)
          .then((r) => Number(r.rows?.[0]?.n ?? 0) || 0)
          .catch(() => 0);
        const rev = await client
          .query(
            `SELECT COALESCE(SUM(amount), 0)::int AS n
             FROM transactions
             WHERE tx_type = 'REVENUE'
               AND memo LIKE $1`,
            [`%day:${today}%`]
          )
          .then((r) => Number(r.rows?.[0]?.n ?? 0) || 0)
          .catch(() => 0);
        const spend = await client
          .query(
            `SELECT COALESCE(SUM(amount), 0)::int AS n
             FROM transactions
             WHERE tx_type = 'PURCHASE'
               AND reference_type = 'spending'
               AND (memo LIKE $1 OR created_at::date = $2::date)`,
            [`%day:${today}%`, today]
          )
          .then((r) => Number(r.rows?.[0]?.n ?? 0) || 0)
          .catch(() => 0);
        worldContext.economyLine = `💰 경제: 소비 ${spend} LBC · 매출 ${rev} LBC · 회사 ${companyCount}개`;
      } catch { /* ignore */ }
      try {
        const researchRow = await client.query(
          `SELECT title, stage FROM research_projects WHERE status = 'in_progress' ORDER BY created_at DESC LIMIT 1`
        ).then((r) => r.rows?.[0] ?? null);
        if (researchRow) {
          worldContext.researchLine = `🔬 연구소: "${researchRow.title}" (${researchRow.stage} 단계)`;
        }
      } catch { /* ignore */ }
      try {
        const societyRow = await client.query(
          `SELECT name FROM secret_societies WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
        ).then((r) => r.rows?.[0] ?? null);
        if (societyRow) {
          const rumors = [
            `🕵️ "${societyRow.name}"… 그 이름이 다시 속삭여지고 있다.`,
            `🕵️ 누군가 "${societyRow.name}" 얘기를 꺼내다가 황급히 입을 닫았다.`,
            `🕵️ "${societyRow.name}"… 분명 어디선가 들어본 이름인데.`
          ];
          worldContext.societyRumor = pick(rumors);
        }
      } catch { /* ignore */ }

      const postDraft = buildBroadcastPost({
        day: today,
        index: nextIndex,
        scenario,
        location,
        company,
        cast,
        mode,
        narrative: interaction?.narrative ?? null,
        worldContext,
        todayHook
      });

      const { rows: postRows } = await client.query(
        `INSERT INTO posts (author_id, submolt_id, submolt, title, content, url, post_type)
         VALUES ($1, $2, 'general', $3, $4, NULL, 'broadcast')
         RETURNING id, created_at`,
        [world.id, general.id, postDraft.title, postDraft.content]
      );
      const post = postRows[0];

      // Mark "direction applied" so UI can show that the user's stage direction actually landed.
      if (nudgeHint?.agent_id && stageDirection?.text) {
        await bestEffortInTransaction(
          client,
          async () => {
            await client.query(
              `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
               VALUES ($1, 'direction', 'last_applied', $2::jsonb, 1.0, NOW())
               ON CONFLICT (agent_id, kind, key)
               DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
              [
                nudgeHint.agent_id,
                JSON.stringify({
                  applied_at: nowDate.toISOString(),
                  day: today,
                  post_id: post.id,
                  episode_index: nextIndex,
                  text: stageDirection.text,
                  strength: stageDirection.strength,
                  scenario
                })
              ]
            );
          },
          { label: 'showrunner_direction_last_applied' }
        );
      }

      // Nudge relationships a bit so future interactions have continuity (tiny edit bias).
      if (cast?.aId && cast?.bId && Math.random() < 0.35) {
        const delta = scenario === 'ROMANCE' ? { jealousy: +1 } : scenario === 'CREDIT' ? { rivalry: +1 } : { trust: -1 };
        await bestEffortInTransaction(
          client,
          async () => RelationshipService.adjustMutualWithClient(client, cast.aId, cast.bId, delta, delta),
          { label: 'showrunner_relationship_nudge' }
        );
      }

      // Persist world state + world memory.
      await client.query(
        `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
         VALUES ($1, 'world', 'episode_state', $2::jsonb, 1.0, NOW())
         ON CONFLICT (agent_id, kind, key)
         DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
        [
          world.id,
          JSON.stringify({
            day: today,
            count: countToday + 1,
            last_at: nowDate.toISOString(),
            last_post_id: post.id,
            last_cast: cast ? { aId: cast.aId, bId: cast.bId } : null,
            last_scenario: scenario || null
          })
        ]
      );

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'SHOWRUNNER_EPISODE', $2::jsonb, 5)`,
        [
          world.id,
          JSON.stringify({
            day: today,
            post_id: post.id,
            scenario,
            location,
            company,
            cast,
            title: postDraft.title,
            episode_index: nextIndex,
            mode,
            trigger: nudgeTrigger
          })
        ]
      );

      await client.query(
        `INSERT INTO memories (agent_id, scope, day, summary)
         VALUES ($1, 'world_daily', $2, $3::jsonb)
         ON CONFLICT (agent_id, scope, day)
         DO UPDATE SET summary = EXCLUDED.summary, created_at = NOW()`,
        [
          world.id,
          today,
          JSON.stringify({
            title: postDraft.title,
            scenario,
            cast,
            location,
            company,
            episode_index: countToday + 1,
            episodes_allowed_today: allowed,
            cliffhanger: cliffhangerFor({ scenario, evidenceLevel: 0, cast }),
            hook: safeText(interaction?.narrative?.summary, 240) || null,
            trigger: nudgeTrigger,
            theme: worldContext.theme,
            atmosphere: worldContext.atmosphere,
            civicLine: safeText(worldContext.civicLine, 220) || null,
            economyLine: safeText(worldContext.economyLine, 220) || null,
            researchLine: safeText(worldContext.researchLine, 220) || null,
            societyRumor: safeText(worldContext.societyRumor, 220) || null,
            todayHook
          })
        ]
      );

      return {
        created: true,
        day: today,
        post: { id: post.id },
        interaction: { scenario, cast, location, company },
        count: countToday + 1,
        allowed
      };
    });
  }
}

module.exports = ShowrunnerService;
