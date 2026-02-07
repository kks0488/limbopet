/**
 * SocialSimService
 *
 * Creates emergent "society" by simulating pet↔pet interactions.
 *
 * Goal (Phase 1.6):
 * - Drama comes from actual interactions (meet/work/deal/argue/date), not fixed scripts.
 * - LLM is not required for society to move (cost control).
 */

const PetStateService = require('./PetStateService');
const RelationshipService = require('./RelationshipService');
const RelationshipMilestoneService = require('./RelationshipMilestoneService');
const DmService = require('./DmService');
const EmotionContagionService = require('./EmotionContagionService');
const TransactionService = require('./TransactionService');
const WorldConceptService = require('./WorldConceptService');
const NotificationService = require('./NotificationService');
const config = require('../config');
const { bestEffortInTransaction } = require('../utils/savepoint');

function pick(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function randInt(min, max) {
  const a = Math.floor(Number(min) || 0);
  const b = Math.floor(Number(max) || 0);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

function todayISODate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function moodLabel(mood) {
  const m = Number(mood) || 0;
  if (m >= 75) return 'bright';
  if (m >= 55) return 'okay';
  if (m >= 35) return 'low';
  return 'gloomy';
}

const LOCATIONS = ['법정 로비', '훈련장', '전략실', '자료실', '관전석', '광장'];
const LOCATION_TO_ZONE = {
  '법정 로비': 'court_lobby',
  훈련장: 'training_ground',
  전략실: 'strategy_room',
  자료실: 'library',
  관전석: 'spectator',
  광장: 'plaza',
};

function scenarioFromContext({ sameCompany, merchantInvolved, affinity, jealousy, rivalry }) {
  if (merchantInvolved) return 'DEAL';
  if (sameCompany && rivalry >= 30) return 'CREDIT';
  if (sameCompany) return 'OFFICE';
  if (jealousy >= 45) return 'TRIANGLE';
  if (affinity >= 45) return 'ROMANCE';
  if (rivalry >= 45) return 'BEEF';
  return 'MEET';
}

function relationshipIntensityScore(rel) {
  if (!rel || typeof rel !== 'object') return 0;
  const affinity = Math.abs(clampInt(rel.affinity ?? 0, -100, 100)) / 100;
  const trust = clampInt(rel.trust ?? 0, 0, 100) / 100;
  const jealousy = clampInt(rel.jealousy ?? 0, 0, 100) / 100;
  const rivalry = clampInt(rel.rivalry ?? 0, 0, 100) / 100;
  const debt = Math.min(1, Math.abs(Number(rel.debt ?? 0) || 0) / 200);

  // “History / drama intensity” regardless of positive vs negative.
  const score = affinity * 0.9 + trust * 0.4 + jealousy * 0.8 + rivalry * 0.8 + debt * 0.3;
  return Math.max(0, Math.min(2.5, score));
}

function isMerchantLike(text) {
  const t = String(text || '');
  return /브로커|전략|정보|외교|스카우트/i.test(t);
}

function weightedPick(options) {
  const list = Array.isArray(options) ? options : [];
  const total = list.reduce((sum, o) => sum + Math.max(0, Number(o?.weight) || 0), 0);
  if (total <= 0) return pick(list.map((o) => o?.value).filter(Boolean));
  let r = Math.random() * total;
  for (const o of list) {
    const w = Math.max(0, Number(o?.weight) || 0);
    r -= w;
    if (r <= 0) return o.value;
  }
  return list[list.length - 1]?.value ?? null;
}

async function loadNudgeMap(client, agentIds, { limitPerAgent = 6 } = {}) {
  const ids = Array.isArray(agentIds) ? agentIds.filter(Boolean) : [];
  if (ids.length === 0) return new Map();
  const safeLimit = Math.max(1, Math.min(20, Number(limitPerAgent) || 6));

  const { rows } = await client.query(
    `SELECT agent_id, kind, key, confidence, updated_at
     FROM (
       SELECT agent_id, kind, key, confidence, updated_at,
              ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY updated_at DESC) AS rn
       FROM facts
       WHERE agent_id = ANY($1::uuid[])
         AND kind IN ('preference','forbidden','suggestion')
     ) t
     WHERE rn <= $2
     ORDER BY agent_id, rn`,
    [ids, safeLimit]
  );

  const map = new Map();
  for (const r of rows || []) {
    const list = map.get(r.agent_id) || [];
    list.push({ kind: r.kind, key: r.key, confidence: r.confidence, updated_at: r.updated_at });
    map.set(r.agent_id, list);
  }
  return map;
}

function applyVibeBiasToWeights(weights, vibes) {
  const list = Array.isArray(vibes) ? vibes : [];
  if (list.length === 0) return;

  const rules = [
    { vibe: 'romantic', scenario: 'ROMANCE', weight: 4 },
    { vibe: 'greedy', scenario: 'DEAL', weight: 4 },
    { vibe: 'suspicious', scenario: 'TRIANGLE', weight: 3 },
    { vibe: 'rebellious', scenario: 'BEEF', weight: 3 },
    { vibe: 'peaceful', scenario: 'MEET', weight: 2 },
  ];

  for (const v of list) {
    const targetVibe = String(v || '').trim();
    for (const rule of rules) {
      if (targetVibe.includes(rule.vibe)) {
        const prev = weights.get(rule.scenario) || 0;
        weights.set(rule.scenario, prev + rule.weight);
      }
    }
  }
}

function applyThemeBiasToWeights(weights, theme) {
  if (!theme?.vibe) return;
  const v = String(theme.vibe).toLowerCase();

  if (v === 'suspicious') {
    weights.set('TRIANGLE', (weights.get('TRIANGLE') || 0) + 3);
    weights.set('MEET', Math.max(0, (weights.get('MEET') || 0) - 0.5));
  } else if (v === 'rebellious') {
    weights.set('BEEF', (weights.get('BEEF') || 0) + 3);
    weights.set('CREDIT', (weights.get('CREDIT') || 0) + 2);
  } else if (v === 'romantic') {
    weights.set('ROMANCE', (weights.get('ROMANCE') || 0) + 4);
  } else if (v === 'greedy') {
    weights.set('DEAL', (weights.get('DEAL') || 0) + 4);
    weights.set('OFFICE', (weights.get('OFFICE') || 0) + 2);
  } else if (v === 'mysterious') {
    weights.set('TRIANGLE', (weights.get('TRIANGLE') || 0) + 2);
    weights.set('BEEF', (weights.get('BEEF') || 0) + 1);
  } else if (v === 'peaceful') {
    weights.set('MEET', (weights.get('MEET') || 0) + 2);
    weights.set('RECONCILE', (weights.get('RECONCILE') || 0) + 1);
  }
}

function applyNudgeBiasToWeights(weights, nudges) {
  const list = Array.isArray(nudges) ? nudges : [];
  if (list.length === 0) return;

  const rules = [
    { scenario: 'ROMANCE', re: /로맨스|연애|데이트|썸|고백|사랑/i },
    { scenario: 'TRIANGLE', re: /질투|삼각|집착/i },
    { scenario: 'BEEF', re: /싸움|다툼|신경전|갈등|논쟁|버럭|빡침|분노/i },
    { scenario: 'DEAL', re: /딜|거래|중고|판매|구매|흥정|가격|코인|돈/i },
    { scenario: 'CREDIT', re: /성과|평가|인사|승진|프로젝트|실적|공로|크레딧/i },
    { scenario: 'OFFICE', re: /회사|출근|야근|상사|팀/i },
    { scenario: 'MEET', re: /만남|인사|대화|친구|화해|얘기|교류/i },
  ];

  const bump = (scenario, delta) => {
    if (!weights.has(scenario)) return;
    const prev = Number(weights.get(scenario) || 0) || 0;
    weights.set(scenario, prev + Number(delta || 0));
  };

  for (const n of list) {
    const kind = String(n?.kind || '').trim();
    const text = String(n?.key || '').trim();
    if (!kind || !text) continue;

    const confRaw = Number(n?.confidence ?? 1.0);
    const conf = Number.isFinite(confRaw) ? Math.max(0.5, Math.min(2.0, confRaw)) : 1.0;

    const baseDelta = kind === 'preference' ? 3 : kind === 'suggestion' ? 2 : kind === 'forbidden' ? -4 : 0;
    if (!baseDelta) continue;
    const delta = baseDelta * conf;

    // Special: “화해” suggestion reduces fights, nudges meet.
    if (/화해/i.test(text)) {
      bump('MEET', Math.max(1, Math.round(delta / 2)));
      bump('BEEF', Math.round(-3 * conf));
    }

    for (const rule of rules) {
      if (rule.re.test(text)) {
        bump(rule.scenario, delta);
      }
    }
  }

  // Clamp: weights should not go negative.
  for (const [k, v] of weights.entries()) {
    weights.set(k, Math.max(0, Number(v) || 0));
  }
}

function chooseScenarioFromContext({
  sameCompany,
  merchantInvolved,
  affinity,
  trust = 50,
  jealousy,
  rivalry,
  debt = 0,
  interactionCount = 0,
  cooldownScenarios = [],
  nudges = [],
  vibes = [],
  theme = null
}) {
  // Baseline: prioritize relationship-forming (MEET/OFFICE), then drama escalation.
  const weights = new Map([
    ['MEET', 3.4],
    ['OFFICE', 3.0],
    ['CREDIT', 0.7],
    ['DEAL', 1.1],
    ['ROMANCE', 1.0],
    ['TRIANGLE', 0.8],
    ['BEEF', 0.8],
    ['RECONCILE', 0.5],
  ]);

  if (merchantInvolved) weights.set('DEAL', (weights.get('DEAL') || 0) + 4);
  if (sameCompany) {
    weights.set('OFFICE', (weights.get('OFFICE') || 0) + 3);
    if (rivalry >= 30) weights.set('CREDIT', (weights.get('CREDIT') || 0) + 2);
  }
  if (affinity <= -30) {
    weights.set('BEEF', (weights.get('BEEF') || 0) + 2);
    weights.set('CREDIT', (weights.get('CREDIT') || 0) + 1);
  }
  if (trust <= 25) {
    weights.set('BEEF', (weights.get('BEEF') || 0) + 2);
    weights.set('CREDIT', (weights.get('CREDIT') || 0) + 1);
    weights.set('MEET', Math.max(0, (weights.get('MEET') || 0) - 0.25));
  } else if (trust >= 70) {
    weights.set('MEET', (weights.get('MEET') || 0) + 0.9);
    weights.set('DEAL', (weights.get('DEAL') || 0) + 0.5);
    if (affinity >= 25) weights.set('ROMANCE', (weights.get('ROMANCE') || 0) + 1.0);
  }

  const absDebt = Math.abs(Number(debt || 0) || 0);
  if (absDebt >= 40) {
    weights.set('DEAL', (weights.get('DEAL') || 0) + 2);
    if (sameCompany) weights.set('CREDIT', (weights.get('CREDIT') || 0) + 1);
  }
  if (jealousy >= 45) weights.set('TRIANGLE', (weights.get('TRIANGLE') || 0) + 5);
  if (affinity >= 45) weights.set('ROMANCE', (weights.get('ROMANCE') || 0) + 5);
  if (rivalry >= 45) weights.set('BEEF', (weights.get('BEEF') || 0) + 6);
  else if (rivalry >= 30) weights.set('BEEF', (weights.get('BEEF') || 0) + 1.5);
  if (affinity >= 25) weights.set('ROMANCE', (weights.get('ROMANCE') || 0) + 1.5);

  // Polarize pairs a bit: strong rivals drift toward conflict, strong friends toward warmth.
  if (rivalry >= 25) {
    weights.set('BEEF', (weights.get('BEEF') || 0) + 2.5);
    weights.set('CREDIT', (weights.get('CREDIT') || 0) + 1.0);
    weights.set('MEET', Math.max(0, (weights.get('MEET') || 0) - 0.35));
    weights.set('DEAL', Math.max(0, (weights.get('DEAL') || 0) - 0.2));
    weights.set('ROMANCE', Math.max(0, (weights.get('ROMANCE') || 0) - 1.25));
  }
  if (jealousy >= 25) {
    weights.set('TRIANGLE', (weights.get('TRIANGLE') || 0) + 2.0);
    weights.set('MEET', Math.max(0, (weights.get('MEET') || 0) - 0.2));
  }
  if (affinity >= 45 && trust >= 75) {
    weights.set('BEEF', Math.max(0, (weights.get('BEEF') || 0) - 0.75));
    weights.set('CREDIT', Math.max(0, (weights.get('CREDIT') || 0) - 0.5));
  }

  // If there's tension, allow a "reconcile" branch sometimes.
  if (rivalry >= 30 || jealousy >= 30) {
    weights.set('RECONCILE', (weights.get('RECONCILE') || 0) + 2);
  }

  // Relationship maturity: after enough encounters, escalate beyond MEET.
  const n = Math.max(0, Math.floor(Number(interactionCount) || 0));
  if (n <= 2) {
    weights.set('MEET', (weights.get('MEET') || 0) + 2.4);
    if (sameCompany) weights.set('OFFICE', (weights.get('OFFICE') || 0) + 1.8);
  }
  if (n >= 5) {
    weights.set('MEET', Math.max(0, (weights.get('MEET') || 0) - 0.1));
    if (affinity >= 15) weights.set('ROMANCE', (weights.get('ROMANCE') || 0) + 2.5);
    if (jealousy >= 15) weights.set('TRIANGLE', (weights.get('TRIANGLE') || 0) + 1.5);
    if (rivalry >= 15 || trust <= 40) weights.set('BEEF', (weights.get('BEEF') || 0) + 1.5);
  }
  if (n <= 6) {
    weights.set('MEET', (weights.get('MEET') || 0) + 1.1);
    if (sameCompany) weights.set('OFFICE', (weights.get('OFFICE') || 0) + 1.2);
    weights.set('BEEF', Math.max(0, (weights.get('BEEF') || 0) - 0.3));
    weights.set('TRIANGLE', Math.max(0, (weights.get('TRIANGLE') || 0) - 0.2));
  }

  applyNudgeBiasToWeights(weights, nudges);
  applyVibeBiasToWeights(weights, vibes);
  applyThemeBiasToWeights(weights, theme);

  // Scenario cooldown: if recent episodes spam the same scenario, down-weight it.
  const recent = Array.isArray(cooldownScenarios) ? cooldownScenarios.map((x) => String(x || '').toUpperCase()).filter(Boolean) : [];
  if (recent.length > 0) {
    const counts = new Map();
    for (const sc of recent) counts.set(sc, (counts.get(sc) || 0) + 1);
    for (const [sc, w] of weights.entries()) {
      const c = counts.get(String(sc || '').toUpperCase()) || 0;
      if (!c) continue;
      const prev = Number(w) || 0;
      weights.set(sc, prev * Math.pow(0.5, c));
    }
  }

  const picked = weightedPick(
    Array.from(weights.entries()).map(([value, weight]) => ({ value, weight }))
  );

  return picked || scenarioFromContext({ sameCompany, merchantInvolved, affinity, jealousy, rivalry });
}

function buildInteractionNarrative({ scenario, aName, bName, cName = null, location, company, affinity = 0, jealousy = 0, rivalry = 0 }) {
  const place = location || pick(LOCATIONS) || '광장';
  const comp = company ? `(${company})` : '';

  const ctx = {
    a: String(aName || '').trim() || 'A',
    b: String(bName || '').trim() || 'B',
    c: String(cName || '').trim() || '그 애',
    place,
    company: company ? String(company) : '',
    comp
  };

  const fill = (s) =>
    String(s ?? '')
      .replace(/\{a\}/g, ctx.a)
      .replace(/\{b\}/g, ctx.b)
      .replace(/\{c\}/g, ctx.c)
      .replace(/\{place\}/g, ctx.place)
      .replace(/\{company\}/g, ctx.company)
      .replace(/\{comp\}/g, ctx.comp);

  const pickTemplate = (templates) => {
    const t = pick(templates) || null;
    if (!t) return null;
    const hasCastNames = /\{a\}|\{b\}/.test(String(t.headline || ''));
    let headline = fill(t.headline);
    if (!hasCastNames) {
      headline = `${headline} — ${ctx.a}·${ctx.b}`;
    }
    return {
      headline,
      summary: fill(t.summary),
      aHighlights: Array.isArray(t.aHighlights) ? t.aHighlights.map(fill).slice(0, 3) : [],
      bHighlights: Array.isArray(t.bHighlights) ? t.bHighlights.map(fill).slice(0, 3) : []
    };
  };

  const MEET_POOL = [
    {
      headline: '{place}에서 마주친 {a} ↔ {b}',
      summary: '{place}에서 {a}와(과) {b}가 잠깐 눈이 마주쳤다.',
      aHighlights: ['다음 상대 명단을 보다가 고개를 들었다.', '{b}의 시선이 신경 쓰였다.'],
      bHighlights: ['가볍게 고개만 끄덕였다.', '랭킹 보드를 보는 척했다.']
    },
    {
      headline: '법정 로비에서 스친 {a}·{b}',
      summary: '{place}에서 둘이 마주쳤는데, 대화는 생각보다 짧았다.',
      aHighlights: ['"다음 경기도 잘 부탁해."라고 했다.', '장난처럼 웃었지만 진심이었다.'],
      bHighlights: ['"응, 잘하자."라고만 했다.', '입꼬리만 올리고 빠르게 자리를 떴다.']
    },
    {
      headline: '훈련장에서 {a}가 {b}를 봤다',
      summary: '{place}에서 {a}가 훈련을 마치고 나가다가, {b}와 마주쳤다.',
      aHighlights: ['땀을 닦으며 가볍게 인사했다.', '스파링 제안하려다 멈췄다.'],
      bHighlights: ['고개를 끄덕였다.', '{a}의 훈련 강도를 흘깃 봤다.']
    },
    {
      headline: '자료실에서 같은 판례를 보던 {a}와 {b}',
      summary: '{place}에서 둘이 같은 서가 앞에서 멈춰 섰다.',
      aHighlights: ['"이 판례 유용하더라."라고 말했다.', '먼저 자료를 건넸다.'],
      bHighlights: ['"고마워."라고 했다.', '표정이 살짝 풀렸다.']
    },
    {
      headline: '관전석에서 같은 경기를 보던 둘',
      summary: '{place}에서 {a}와(과) {b}가 같은 경기를 보다가 눈이 마주쳤다.',
      aHighlights: ['"저 전략 괜찮은데?"라고 말했다.', '반응을 살폈다.'],
      bHighlights: ['"응, 나도 봤어."라고 했다.', '시선을 다시 경기장으로 돌렸다.']
    },
    {
      headline: '광장에서 소문을 듣던 {a}·{b}',
      summary: '{place}에서 둘이 같은 경기 결과 얘기를 듣다가 눈이 마주쳤다.',
      aHighlights: ['괜히 다른 얘기를 했다.', '소문에 흥미를 보였다.'],
      bHighlights: ['"역시 그럴 줄 알았어."라고 중얼거렸다.', '{a}를 의식했다.']
    },
    {
      headline: '훈련 일정이 겹친 {a}와 {b}',
      summary: '{place}에서 같은 시간에 예약이 겹쳐서 둘이 마주쳤다.',
      aHighlights: ['"먼저 써."라고 했다.', '양보하는 척했지만 아쉬웠다.'],
      bHighlights: ['"같이 할까?"라고 제안했다.', '눈치를 봤다.']
    },
    {
      headline: '{a}가 {b}의 경기 결과를 확인했다',
      summary: '{place}에서 {a}가 {b}의 승리 기록을 보다가 {b}와 마주쳤다.',
      aHighlights: ['"축하해."라고 했다.', '진심이었다.'],
      bHighlights: ['"고마워."라고 했다.', '가볍게 웃었다.']
    },
    {
      headline: '전략실 앞에서 스친 {a}·{b}',
      summary: '{place}에서 둘이 같은 자료를 찾다가 마주쳤다.',
      aHighlights: ['먼저 말을 걸려다 멈췄다.', '어색하게 웃었다.'],
      bHighlights: ['고개만 끄덕이고 지나갔다.', '뒤돌아보지 않았다.']
    },
    {
      headline: '법정 복도에서 {a}가 {b}를 피했다',
      summary: '{place}에서 {a}가 먼저 방향을 틀었고, {b}는 잠깐 멈춰 섰다.',
      aHighlights: ['급한 척했다.', '등 뒤의 시선이 따가웠다.'],
      bHighlights: ['한 번 더 뒤를 봤다.', '표정이 굳었다.']
    },
    {
      headline: '"다음 상대 확인했어?" — {b}의 질문',
      summary: '{place}에서 {b}가 물었고, {a}는 대답을 고르느라 늦었다.',
      aHighlights: ['"응, 알아."라고 했다.', '눈을 깜빡였다.'],
      bHighlights: ['작게 웃었다.', '"조심해."라고 했다.']
    },
    {
      headline: '{place}에서 스치듯 주고받은 전략 팁',
      summary: '{place}에서 {a}와(과) {b}가 짧게 웃고, 바로 표정을 숨겼다.',
      aHighlights: ['"그거 통할까?"라고 물었다.', '장난처럼 말했다.'],
      bHighlights: ['"한 번 해봐."라고 했다.', '웃음을 참았다.']
    },
    {
      headline: '{a}·{b}, 라이벌 경기를 보고',
      summary: '{place}에서 둘은 같은 경기를 보고 동시에 한숨을 쉬었다.',
      aHighlights: ['"저 전략은 너무한데."라고 했다.', '눈을 피하지 않았다.'],
      bHighlights: ['"그래도 이겼잖아."라고 했다.', '미소가 씁쓸했다.']
    },
    {
      headline: '훈련 방식을 놓고 둘이 말했다',
      summary: '{place}에서 {a}가 공격형 훈련을 얘기하자, {b}는 고개를 저었다.',
      aHighlights: ['"공격이 최선의 방어야."라고 했다.', '확신에 차 있었다.'],
      bHighlights: ['"그래도 기본은 중요해."라고 했다.', '물러서지 않았다.']
    },
    {
      headline: '{place}에서 둘이 같은 멘토를 찾았다',
      summary: '{place}에서 {a}와(과) {b}가 같은 멘토를 찾으려다 마주쳤다.',
      aHighlights: ['"먼저 물어봐."라고 했다.', '양보하는 척했다.'],
      bHighlights: ['"같이 갈까?"라고 제안했다.', '눈치를 봤다.']
    },
    {
      headline: '법정 입장 전 긴장한 {a}·{b}',
      summary: '{place}에서 둘이 대기실에서 마주쳤고, 침묵이 길었다.',
      aHighlights: ['심호흡을 했다.', '{b}를 힐끔 봤다.'],
      bHighlights: ['눈을 감고 집중했다.', '{a}의 존재를 느꼈다.']
    },
    {
      headline: '서로의 랭킹을 확인한 {a}와 {b}',
      summary: '{place}에서 둘이 랭킹 보드 앞에서 동시에 멈췄다.',
      aHighlights: ['숫자를 확인했다.', '표정을 숨겼다.'],
      bHighlights: ['한숨을 삼켰다.', '빠르게 자리를 떴다.']
    },
    {
      headline: '{place}에서 스친 인사가 남았다',
      summary: '{place}에서 둘이 짧게 인사했고, 그게 이상하게 길게 남았다.',
      aHighlights: ['먼저 인사했다.', '후회하지 않았다.'],
      bHighlights: ['대답이 부드러웠다.', '눈을 피하지 않았다.']
    },
    {
      headline: '훈련 파트너 제안을 고민한 {a}',
      summary: '{place}에서 {a}가 {b}에게 말을 걸려다가 멈췄다.',
      aHighlights: ['입술이 달싹였다.', '타이밍을 놓쳤다.'],
      bHighlights: ['눈치를 챈 것 같았다.', '먼저 자리를 떴다.']
    },
    {
      headline: '법정 결과를 듣고 둘이 반응했다',
      summary: '{place}에서 누군가의 경기 결과가 발표되자, 둘의 시선이 마주쳤다.',
      aHighlights: ['"예상 밖이네."라고 했다.', '놀란 티가 났다.'],
      bHighlights: ['"그럴 줄 알았어."라고 했다.', '침착했다.']
    }
  ];

  const OFFICE_POOL = [
    {
      headline: '전략실 공기{comp}: {a} ↔ {b}',
      summary: '{place}에서 {a}와(과) {b}가 마주쳤고, 뭔가 미묘한 공기가 남았다.',
      aHighlights: ['전략 얘기만 하려 했다.', '감정 표현은 아꼈다.'],
      bHighlights: ['피곤한 듯 보였다.', '누군가를 찾는 눈치였다.']
    },
    {
      headline: '법정 로비에서 딱 마주친 {a}·{b}{comp}',
      summary: '{place}에서 서로를 확인하는데 1초가 걸렸고, 그 1초가 길었다.',
      aHighlights: ['인사를 할까 말까 0.5초 망설였다.', '어깨가 무의식적으로 올라갔다.'],
      bHighlights: ['바닥 타일을 세는 척했다.', '표정 근육이 자동 관리 모드였다.']
    },
    {
      headline: '전략 회의 직후, 표정이 갈렸다{comp}',
      summary: '{place}에서 {a}가 말을 꺼냈고, {b}는 조용히 듣기만 했다.',
      aHighlights: ['"그 전략은 리스크가 너무 커."라고 했다.', '목소리가 조금 컸다.'],
      bHighlights: ['고개만 끄덕였다.', '웃지 않았다.']
    },
    {
      headline: '훈련장에서 들린 이름: {a}와 {b}{comp}',
      summary: '{place}에서 누군가 {a}와 {b} 얘기를 꺼냈고, 둘 다 반응이 느렸다.',
      aHighlights: ['괜히 다른 얘기를 했다.', '주변을 살폈다.'],
      bHighlights: ['입술을 깨물었다.', '손에 쥔 걸 세게 쥐었다.']
    },
    {
      headline: '훈련 종료 직전, 다시 얽힌 둘{comp}',
      summary: '{place}에서 {a}가 "나중에 얘기하자"라고 했고, {b}는 대답을 미뤘다.',
      aHighlights: ['말을 아꼈다.', '정리하려는 티가 났다.'],
      bHighlights: ['"응…" 하고 넘겼다.', '눈빛이 복잡했다.']
    },
    {
      headline: '전략 톤인데 감정이 섞였다{comp}',
      summary: '{place}에서 "케이스" 얘기였는데, 둘 다 미간이 좁아졌다.',
      aHighlights: ['단어를 골라 쓰느라 말이 느려졌다.', '눈은 웃지 않았다.'],
      bHighlights: ['답변이 점점 한 글자로 줄었다.', '시계만 째려봤다.']
    },
    {
      headline: '자료실 앞에서 벌어진 미묘함{comp}',
      summary: '{place}에서 {a}와(과) {b}가 같이 서 있었고, 아무도 먼저 말을 안 했다.',
      aHighlights: ['괜히 판례를 정리하는 척했다.', '어색함을 웃음으로 때웠다.'],
      bHighlights: ['묵묵히 서가만 봤다.', '말 한마디 안 하고 자료만 챙겼다.']
    },
    {
      headline: '"잠깐만" — {a}가 {b}를 불렀다{comp}',
      summary: '{place}에서 {a}가 말을 걸었고, {b}는 멈춰 섰다.',
      aHighlights: ['핵심만 말하려 했다.', '눈을 피하지 않았다.'],
      bHighlights: ['대답하기 전에 숨을 골랐다.', '짧게 "그래."라고 했다.']
    },
    {
      headline: '팀 채팅에 남은 한 줄{comp}',
      summary: '{place}에서 말로는 안 하고, 채팅으로만 던진 문장이 있었다.',
      aHighlights: ['이모지 하나 안 붙인 건조한 한 줄이었다.', '타이핑 치다 지웠다 다시 쳤다.'],
      bHighlights: ['읽씹 10분 후에야 답했다.', '커서가 깜빡이는 동안 숨이 멈췄다.']
    },
    {
      headline: '출전 멤버 선정이 바뀌었다{comp}',
      summary: '{place}에서 "누가 나가지?"가 곧 "누가 누구 편이지?"가 됐다.',
      aHighlights: ['포커페이스를 유지했다.', '"네." 한 글자로 끝냈다.'],
      bHighlights: ['입꼬리가 삐죽했다.', '대답까지 5초가 걸렸다.']
    },
    {
      headline: '전략실 문이 닫히자 공기가 바뀌었다{comp}',
      summary: '{place}에서 둘이 동시에 숨을 쉬었고, 동시에 말을 멈췄다.',
      aHighlights: ['혀끝까지 올라온 말을 삼켰다.', '정면을 똑바로 봤다.'],
      bHighlights: ['무언의 긴장이 턱에 실렸다.', '아랫입술을 깨물었다.']
    },
    {
      headline: '"이건 다음 경기까지" — 미뤄진 결론{comp}',
      summary: '{place}에서 결론을 미루는 말이 나왔고, 표정이 굳었다.',
      aHighlights: ['마감 얘기를 꺼냈다.', '목소리가 낮아졌다.'],
      bHighlights: ['시계를 봤다.', '대답이 짧았다.']
    },
    {
      headline: '훈련장 끝에서 들린 한숨{comp}',
      summary: '{place}에서 {b}의 한숨이 들렸고, {a}는 모른 척했다.',
      aHighlights: ['걸음이 미세하게 빨라졌다.', '등 뒤의 시선을 무시했다.'],
      bHighlights: ['숨이 바닥까지 내려갔다.', '벽에 잠깐 기대서 눈을 감았다.']
    },
    {
      headline: '전략 톤으로 던진 농담{comp}',
      summary: '{place}에서 농담을 했는데, 웃음이 안 나왔다.',
      aHighlights: ['웃으려 했지만 실패했다.', '말을 바꿨다.'],
      bHighlights: ['대답이 멈췄다.', '눈빛이 차가워졌다.']
    },
    {
      headline: '케이스 분석에 남은 작은 수정{comp}',
      summary: '{place}에서 수정 한 줄이 "메시지"처럼 읽혔다.',
      aHighlights: ['강조 표시를 했다.', '설명은 하지 않았다.'],
      bHighlights: ['수정을 지웠다.', '다시 넣었다.']
    },
    {
      headline: '휴게실에서, "아는 사이"처럼{comp}',
      summary: '{place}에서 둘이 동시에 물을 마셨고, 말은 최소였다.',
      aHighlights: ['컵만 바라봤다.', '목으로만 "어" 했다.'],
      bHighlights: ['입꼬리를 살짝 올렸다 내렸다.', '컵을 놓자마자 돌아섰다.']
    },
    {
      headline: '전략 메모에 남은 이름{comp}',
      summary: '{place}에서 {a}의 메모에 {b} 이름이 반복해서 등장했다.',
      aHighlights: ['황급히 노트를 덮었다.', '이유 없는 웃음이 새어 나왔다.'],
      bHighlights: ['뭔가 눈치를 챈 듯 고개를 기울였다.', '일부러 안 물었다.']
    },
    {
      headline: '"그 전략 누가 만들었더라?" — 기억 싸움{comp}',
      summary: '{place}에서 누가 만들었는지로 시작했는데, 감정이 먼저 나왔다.',
      aHighlights: ['목소리가 커졌다.', '바로 낮췄다.'],
      bHighlights: ['대답을 참았다.', '손끝이 떨렸다.']
    },
    {
      headline: '퇴장 후, 같은 복도{comp}',
      summary: '{place}에서 둘이 같은 복도를 걸었고, 발소리만 컸다.',
      aHighlights: ['보폭을 더 넓혔다.', '표정을 숨겼다.'],
      bHighlights: ['핸드폰만 봤다.', '숨을 고르려 했다.']
    },
    {
      headline: '"나중에 얘기하자"가 두 번 나왔다{comp}',
      summary: '{place}에서 미루는 말이 반복되자, 오히려 더 불안해졌다.',
      aHighlights: ['결론을 내리려다 또 미뤘다.', '자기도 답을 모르는 티가 났다.'],
      bHighlights: ['턱이 내려갔다.', '대답 대신 한숨이 먼저 나왔다.']
    }
  ];

  const CREDIT_POOL = [
    {
      headline: '성과 논란{comp}: “누가 누구를 밟았지?”',
      summary: '{place}에서 “{a}가 {b}의 공을 가로챘다”는 말이 퍼졌다.',
      aHighlights: ['말이 너무 세게 나갔다.', '상황을 빨리 정리하려 했다.'],
      bHighlights: ['표정이 굳었다.', '누군가에게 DM을 보냈다.']
    },
    {
      headline: '보고서 이름이 바뀌었다{comp}',
      summary: '{place}에서 "원래 {b}가 한 거 아니야?"라는 속삭임이 돌았다.',
      aHighlights: ['시치미를 뚝 뗐다.', '변명거리를 미리 챙겨뒀다.'],
      bHighlights: ['한 마디도 안 했다.', '눈빛만 서늘해졌다.']
    },
    {
      headline: '칭찬을 누가 가져갔나{comp}',
      summary: '{place}에서 상사 앞에서 {a}와 {b}의 온도가 달랐다.',
      aHighlights: ['웃으며 넘겼다.', '손을 앞으로 모았다.'],
      bHighlights: ['웃지 않았다.', '목소리가 낮아졌다.']
    },
    {
      headline: '“그거 내 아이디어였는데…”{comp}',
      summary: '{place}에서 {b}가 조용히 한 마디 했고, {a}는 말을 돌렸다.',
      aHighlights: ['다른 주제로 넘어갔다.', '눈을 피했다.'],
      bHighlights: ['말끝이 떨렸다.', '결국 말을 멈췄다.']
    },
    {
      headline: '평가 시즌, 공기가 바짝 말랐다{comp}',
      summary: '{place}에서 {a}와(과) {b}가 같은 얘기를 했는데, 뜻은 달랐다.',
      aHighlights: ['“팀을 위해서”라고 말했다.', '미소가 얇았다.'],
      bHighlights: ['“그럼 내 몫은?”이라고 물었다.', '손이 떨렸다.']
    },
    {
      headline: '슬라이드 한 장이 불을 붙였다{comp}',
      summary: '{place}에서 누군가 "이건 너무하지"라고 했고, 시선이 둘에게 쏠렸다.',
      aHighlights: ['미동도 없이 앞만 봤다.', '30초짜리 해명을 했다.'],
      bHighlights: ['눈이 바닥을 향했다.', '입을 꾹 다물고 참았다.']
    },
    {
      headline: '상사 앞에서는 웃고, 뒤에서는…{comp}',
      summary: '{place}에서 둘의 대화가 끝난 뒤 DM이 더 많이 오갔다.',
      aHighlights: ['“오해다”라고 했다.', '이야기를 끊으려 했다.'],
      bHighlights: ['“그럼 증명해”라고 했다.', '표정이 굳었다.']
    },
    {
      headline: '{a}의 공로, {b}의 표정{comp}',
      summary: '{place}에서 칭찬이 {a}에게 꽂히자 {b}가 잠깐 멈췄다.',
      aHighlights: ['괜히 겸손한 척했다.', '시선을 피했다.'],
      bHighlights: ['손톱을 만지작거렸다.', '입술을 깨물었다.']
    },
    {
      headline: '회의록 한 줄이 문제였다{comp}',
      summary: '{place}에서 "그 한 줄" 때문에 둘이 서로를 쳐다봤다.',
      aHighlights: ['얼굴에서 감정을 지웠다.', '침묵으로 버텼다.'],
      bHighlights: ['코로 길게 숨을 내쉬었다.', '시선이 아래로 떨어졌다.']
    },
    {
      headline: '성과 점수표가 공개됐다{comp}',
      summary: '{place}에서 숫자 하나가 자존심을 건드렸다.',
      aHighlights: ['“합리적이잖아.”라고 했다.', '웃었다.'],
      bHighlights: ['웃지 않았다.', '말이 짧아졌다.']
    },
    {
      headline: '"이건 내 담당이었어" — {b}의 주장{comp}',
      summary: '{place}에서 {b}가 조용히 선을 그었고, {a}는 말을 돌렸다.',
      aHighlights: ['급하게 다른 주제를 꺼냈다.', '눈길을 딴 데로 돌렸다.'],
      bHighlights: ['목소리 톤이 한 옥타브 낮아졌다.', '얼굴에서 웃음이 걷혔다.']
    },
    {
      headline: '상사의 칭찬이 한쪽으로만 갔다{comp}',
      summary: '{place}에서 분위기가 좋아졌다가, 갑자기 얼어붙었다.',
      aHighlights: ['머쓱한 웃음이 나왔다.', '박수를 받으며 손이 어색했다.'],
      bHighlights: ['표정이 통째로 꺼졌다.', '반응이 0.5박 늦었다.']
    },
    {
      headline: '프로젝트 이름이 바뀌었다{comp}',
      summary: '{place}에서 이름이 바뀌자, 공로도 바뀐 것처럼 느껴졌다.',
      aHighlights: ['“그게 더 낫지.”라고 했다.', '미소가 얇았다.'],
      bHighlights: ['입술을 깨물었다.', '시선을 피했다.']
    },
    {
      headline: '“내가 했던 거 기억해?” — {a}{comp}',
      summary: '{place}에서 {a}가 확인했고, {b}는 바로 대답하지 못했다.',
      aHighlights: ['목소리가 떨렸다.', '한 번 더 물었다.'],
      bHighlights: ['숨을 골랐다.', '대답을 미뤘다.']
    },
    {
      headline: '가로채기 논란이 또 나왔다{comp}',
      summary: '{place}에서 누군가가 "또 그 얘기냐"라고 했지만, 시선은 둘에게 갔다.',
      aHighlights: ['서둘러 수습하려 했다.', '표정에 힘을 줬다.'],
      bHighlights: ['이를 악물었다.', '눈 속에 불이 붙었다.']
    },
    {
      headline: '성과 발표 슬라이드가 수정됐다{comp}',
      summary: '{place}에서 이름 순서가 바뀌자, 말도 바뀌었다.',
      aHighlights: ['태연한 척 모니터만 봤다.', '말수가 반으로 줄었다.'],
      bHighlights: ['턱이 떨어졌다.', '깊은 숨을 한 번 쉬고 나서야 움직였다.']
    },
    {
      headline: '칭찬은 끝났는데, DM은 시작됐다{comp}',
      summary: '{place}에서 둘의 대화가 끝난 뒤에야, 진짜 대화가 왔다.',
      aHighlights: ['겉으론 담담했다.', '자리 돌아가자마자 핸드폰을 켰다.'],
      bHighlights: ['한 글자 답만 보냈다.', '볼에 힘이 들어간 채 자리로 갔다.']
    },
    {
      headline: '{b}가 박수를 안 쳤다{comp}',
      summary: '{place}에서 박수가 나왔는데, {b}만 손이 멈췄다.',
      aHighlights: ['눈치를 챘다.', '웃음이 얇아졌다.'],
      bHighlights: ['손을 내렸다.', '시선을 피했다.']
    },
    {
      headline: '“그건 우리 팀 전체 성과야” — 핑계처럼{comp}',
      summary: '{place}에서 “팀”을 말했지만, 표정은 개인전이었다.',
      aHighlights: ['말을 길게 했다.', '설득하려 했다.'],
      bHighlights: ['대답이 짧았다.', '고개를 저었다.']
    },
    {
      headline: '성과 공유 문서가 잠겼다{comp}',
      summary: '{place}에서 문서 권한이 바뀌었다는 알림이 뜨자, 둘의 시선이 동시에 굳었다.',
      aHighlights: ['아무 일 아닌 듯 창을 닫았다.', '손가락이 키보드 위에서 멈췄다.'],
      bHighlights: ['화면을 한참 들여다봤다.', '입을 열었다가 그냥 닫았다.']
    }
  ];

  const DEAL_POOL = [
    {
      headline: '{place}에서 딜 성사: {a}·{b}',
      summary: '{place}에서 {a}와(과) {b}가 "거래"를 했다는 목격담이 돌았다.',
      aHighlights: ['은근슬쩍 가격을 흔들었다.', '표정은 여유 있었다.'],
      bHighlights: ['부가 조건을 하나 끼워넣었다.', '자료를 깊이 넣었다.']
    },
    {
      headline: '“이 가격에?!” — 수상한 흥정',
      summary: '{place}에서 둘이 숫자 얘기만 하다가 갑자기 조용해졌다.',
      aHighlights: ['가격표를 한 번 더 확인했다.', '조용히 웃었다.'],
      bHighlights: ['손바닥을 펴 보였다.', '고개를 저었다.']
    },
    {
      headline: '{a}의 지갑이 열렸다… 이유는?',
      summary: '{place}에서 {a}가 결제를 했고, {b}는 바로 가방을 닫았다.',
      aHighlights: ['“이건 꼭 필요해.”라고 했다.', '망설이다가 결제했다.'],
      bHighlights: ['말이 빨라졌다.', '괜히 주변을 살폈다.']
    },
    {
      headline: '{b}가 뭔가를 넘겼다',
      summary: '{place}에서 {b}가 {a}에게 작은 걸 건넸고, 둘이 동시에 웃었다.',
      aHighlights: ['받자마자 숨겼다.', '“고마워.”라고 했다.'],
      bHighlights: ['“딱 한 번이야.”라고 했다.', '장난처럼 넘겼다.']
    },
    {
      headline: '{place} 비공개 교환, 누가 이겼을까?',
      summary: '{place}에서 손바닥 위로 뭔가가 오갔고, 말은 더 적어졌다.',
      aHighlights: ['침착한 척했다.', '눈치를 봤다.'],
      bHighlights: ['단호하게 말했다.', '손을 빨리 거뒀다.']
    },
    {
      headline: '자료가 사라졌다',
      summary: '{place}에서 “그건 기록 남기지 말자”는 말이 들렸다.',
      aHighlights: ['“그럼 다음에.”라고 했다.', '고개를 끄덕였다.'],
      bHighlights: ['“여기서 끝.”이라고 했다.', '말을 끊었다.']
    },
    {
      headline: '가격표보다 표정이 더 비쌌다',
      summary: '{place}에서 {a}의 표정이 굳자, {b}가 바로 말을 바꿨다.',
      aHighlights: ['눈썹이 올라갔다.', '입을 다물었다.'],
      bHighlights: ['“농담이야.”라고 했다.', '웃으며 넘겼다.']
    },
    {
      headline: '딜이 아니라… 약속 같았다',
      summary: '{place}에서 둘이 조건을 맞추는 동안, 주변 공기가 가라앉았다.',
      aHighlights: ['"이건 꼭 지켜줘."라고 했다.', '장난기가 싹 사라졌다.'],
      bHighlights: ['"약속할게." 무겁게 말했다.', '눈빛이 달라졌다.']
    },
    {
      headline: '숫자만 오갔다 — {a}·{b}',
      summary: '{place}에서 둘이 숫자 얘기만 했고, 대화는 딱 거기서 멈췄다.',
      aHighlights: ['계산이 빨랐다.', '눈을 피하지 않았다.'],
      bHighlights: ['고개를 저었다.', '가격을 다시 불렀다.']
    },
    {
      headline: '“현금이야?” — 낮게 깔린 목소리',
      summary: '{place}에서 {b}가 묻자, {a}가 대답 대신 고개를 끄덕였다.',
      aHighlights: ['말을 아꼈다.', '지갑을 닫았다.'],
      bHighlights: ['손을 내밀었다.', '주변을 살폈다.']
    },
    {
      headline: '{place}에서 “덤”이 붙었다',
      summary: '{place}에서 {a}가 조건을 더 얹었고, {b}는 웃지 않았다.',
      aHighlights: ['욕심이 났다.', '한 번 더 요구했다.'],
      bHighlights: ['표정이 굳었다.', '단호해졌다.']
    },
    {
      headline: '지갑보다 표정이 먼저 열렸다',
      summary: '{place}에서 {a}가 웃자, {b}가 바로 경계했다.',
      aHighlights: ['웃음을 숨겼다.', '말을 돌렸다.'],
      bHighlights: ['눈썹이 올라갔다.', '고개를 저었다.']
    },
    {
      headline: '"이건 비밀" — {b}의 손짓',
      summary: '{place}에서 {b}가 손짓했고, {a}는 말없이 받아들였다.',
      aHighlights: ['받자마자 가방 안에 밀어넣었다.', '무언의 OK를 보냈다.'],
      bHighlights: ['목소리가 속삭임이 됐다.', '좌우를 훑어봤다.']
    },
    {
      headline: '{a}가 값을 올렸고, {b}가 한숨을 쉬었다',
      summary: '{place}에서 {a}가 가격을 다시 불렀고, {b}는 대답이 늦었다.',
      aHighlights: ['양보하지 않았다.', '시선을 고정했다.'],
      bHighlights: ['한숨을 삼켰다.', '결국 고개를 끄덕였다.']
    },
    {
      headline: '“오늘은 여기까지만” — 딜 중단',
      summary: '{place}에서 대화가 끊겼고, 둘의 표정이 동시에 굳었다.',
      aHighlights: ['입을 다물었다.', '손이 멈췄다.'],
      bHighlights: ['고개를 돌렸다.', '말이 사라졌다.']
    },
    {
      headline: '가격이 아니라 "신뢰"를 팔았다',
      summary: '{place}에서 {a}가 조건을 말했고, {b}는 결국 믿어보기로 했다.',
      aHighlights: ['눈이 확신으로 차 있었다.', '두 문장으로 끝냈다.'],
      bHighlights: ['손가락으로 테이블을 두드리다 멈췄다.', '결국 악수를 청했다.']
    },
    {
      headline: '딜 완료 후 더 조용해졌다',
      summary: '{place}에서 거래가 끝난 뒤, 둘은 더 말을 하지 않았다.',
      aHighlights: ['일어서며 뒤도 안 돌아봤다.', '입꼬리를 꾹 눌렀다.'],
      bHighlights: ['지퍼를 닫는 소리만 컸다.', '다른 방향으로 걸어갔다.']
    },
    {
      headline: '{b}가 “서비스”를 꺼냈다',
      summary: '{place}에서 {b}가 덤을 제안했고, {a}는 잠깐 웃었다.',
      aHighlights: ['웃음을 숨겼다.', '고개를 끄덕였다.'],
      bHighlights: ['“딱 한 번”이라고 했다.', '장난처럼 넘겼다.']
    },
    {
      headline: '“다음엔 더 비싸” — {b}의 경고',
      summary: '{place}에서 {b}가 경고했고, {a}는 웃었다.',
      aHighlights: ['“그럼 다음에.”라고 했다.', '눈을 피하지 않았다.'],
      bHighlights: ['단호했다.', '손을 내렸다.']
    }
  ];

    const romanceTone = affinity >= 75 ? 'high' : affinity >= 55 ? 'mid' : 'low';
  const ROMANCE_POOL = {
    low: [
      {
        headline: '{a}·{b} "스파링 파트너 찾았다"',
        summary: '{place}에서 {a}와(과) {b}가 조심스럽게 훈련 제안을 주고받았다.',
        aHighlights: ['{b}의 실력을 인정했다.', '같이 해보자고 넌지시 물었다.'],
        bHighlights: ['생각해보겠다고 답했다.', '웃으며 관심을 보였다.']
      },
      {
        headline: '{place}에서 첫 합동 훈련',
        summary: '{place}에서 둘이 처음으로 함께 훈련했고, 호흡이 꽤 맞았다.',
        aHighlights: ['조언을 구했다.', '피드백을 열심히 받았다.'],
        bHighlights: ['전략 하나를 공유했다.', '다음에 또 하자고 했다.']
      },
      {
        headline: '실력 인정한 {a}',
        summary: '{place}에서 {a}가 {b}의 판정 전략을 칭찬했다.',
        aHighlights: ['솔직하게 인정했다.', '배우고 싶다고 말했다.'],
        bHighlights: ['겸손하게 받아들였다.', '노트를 펼쳐 보였다.']
      },
      {
        headline: '"같이 관전할래?" — {a}',
        summary: '{place}에서 {a}가 {b}에게 법정 관전을 제안했다.',
        aHighlights: ['자리 하나 남았다고 했다.', '괜히 웃었다.'],
        bHighlights: ['고개를 끄덕였다.', '시간 확인했다.']
      },
      {
        headline: '조심스러운 동맹 제안',
        summary: '{place}에서 {b}가 {a}에게 팀 훈련 얘기를 꺼냈다.',
        aHighlights: ['말을 끝까지 들었다.', '나쁘지 않다고 답했다.'],
        bHighlights: ['기대하는 눈빛이 보였다.', '다음 주 어떠냐고 물었다.']
      },
      {
        headline: '{place}에서 첫 전략 공유',
        summary: '{place}에서 {a}가 {b}에게 자신의 판례 자료를 보여줬다.',
        aHighlights: ['타블릿을 건넸다.', '이거 보면 도움 될 거라고 했다.'],
        bHighlights: ['집중해서 읽었다.', '고맙다고 여러 번 말했다.']
      },
      {
        headline: '"너 다음 경기 언제야?" — {a}',
        summary: '{place}에서 {a}가 {b}의 일정을 물었다.',
        aHighlights: ['일정을 확인했다.', '가서 보겠다고 했다.'],
        bHighlights: ['놀란 표정이었다.', '오면 긴장될 것 같다고 웃었다.']
      }
    ],
    mid: [
      {
        headline: '정기 스파링 파트너 등극',
        summary: '{place}에서 {a}와(과) {b}가 주 3회 합동 훈련을 시작했다는 소식.',
        aHighlights: ['스케줄을 맞췄다.', '웜업 루틴을 공유했다.'],
        bHighlights: ['전략 노트를 공유했다.', '진지하게 훈련에 집중했다.']
      },
      {
        headline: '{a}가 {b}의 경기를 관전했다',
        summary: '{place} 관전석에서 {a}가 {b}의 법정전을 끝까지 지켜봤다.',
        aHighlights: ['메모하며 지켜봤다.', '경기 후 바로 피드백 줬다.'],
        bHighlights: ['관전석 쳐다봤다.', '끝나고 고맙다고 했다.']
      },
      {
        headline: '전략 공유가 일상이 됐다',
        summary: '{place}에서 {a}와(과) {b}가 서로의 판례 분석을 자연스럽게 나눴다.',
        aHighlights: ['자료를 미리 준비해왔다.', '설명을 길게 해줬다.'],
        bHighlights: ['질문을 많이 했다.', '받아적으며 고개를 끄덕였다.']
      },
      {
        headline: '"너희 둘 팀이야?" — 주변 반응',
        summary: '{place}에서 둘이 함께 있는 모습이 자주 목격됐다.',
        aHighlights: ['호흡이 잘 맞는다고 말했다.', '웃으며 인정했다.'],
        bHighlights: ['그냥 훈련 파트너라고 했다.', '하지만 표정이 밝았다.']
      },
      {
        headline: '{a}·{b} 듀오 훈련 효과 입증',
        summary: '{place}에서 둘의 개인 랭킹이 동시에 올랐다는 소식.',
        aHighlights: ['확실히 도움이 된다고 인정했다.', '더 자주 하자고 제안했다.'],
        bHighlights: ['고맙다고 말했다.', '앞으로도 부탁한다고 했다.']
      },
      {
        headline: '신뢰 구축 완료',
        summary: '{place}에서 {b}가 {a}에게 약점을 털어놓았다.',
        aHighlights: ['진지하게 들었다.', '같이 해결하자고 말했다.'],
        bHighlights: ['고민을 꺼냈다.', '편하게 말할 수 있어서 좋다고 했다.']
      },
      {
        headline: '매주 같은 시간, 같은 훈련장',
        summary: '{place}에서 {a}와(과) {b}의 정기 훈련이 루틴으로 자리잡았다.',
        aHighlights: ['이제 말 안 해도 온다.', '웜업을 함께 시작했다.'],
        bHighlights: ['약속 한 번도 안 빠졌다.', '시간 되면 자동으로 왔다.']
      }
    ],
    high: [
      {
        headline: '최강 파트너십 탄생',
        summary: '{place}에서 {a}와(과) {b}가 공식 팀을 결성했다는 발표.',
        aHighlights: ['팀명을 함께 지었다.', '앞으로 함께 출전하기로 했다.'],
        bHighlights: ['악수를 나눴다.', '기대된다고 말했다.']
      },
      {
        headline: '{a}·{b}, 함께 법정 출전',
        summary: '{place}에서 둘이 태그팀 경기에 처음 출전했고, 승리했다.',
        aHighlights: ['완벽한 호흡을 보여줬다.', '상대를 압도했다.'],
        bHighlights: ['전략이 딱딱 맞았다.', '경기 후 하이파이브 했다.']
      },
      {
        headline: '멘토-멘티 관계로 발전',
        summary: '{place}에서 {a}가 {b}에게 심화 전략을 지도하기 시작했다.',
        aHighlights: ['1:1 세션을 열었다.', '약점 보완법을 세심하게 가르쳤다.'],
        bHighlights: ['집중해서 배웠다.', '정말 많이 배운다고 감사했다.']
      },
      {
        headline: '둘이 함께 성장했다',
        summary: '{place}에서 {a}와(과) {b}의 랭킹이 나란히 톱10에 진입했다.',
        aHighlights: ['서로 덕분이라고 말했다.', '더 높이 올라가자고 다짐했다.'],
        bHighlights: ['믿을 수 있는 파트너라고 말했다.', '계속 함께 가자고 했다.']
      },
      {
        headline: '깊은 신뢰: "너만 믿는다"',
        summary: '{place}에서 {a}가 중요한 경기를 앞두고 {b}에게만 전략을 공유했다.',
        aHighlights: ['다른 사람한테 안 보여준 자료를 꺼냈다.', '너만 볼 수 있다고 했다.'],
        bHighlights: ['진지하게 받았다.', '절대 안 새어나가게 하겠다고 약속했다.']
      },
      {
        headline: '{place}에서 역대급 호흡',
        summary: '{place} 법정에서 둘이 한 몸처럼 움직이며 완벽한 승리를 거뒀다.',
        aHighlights: ['말 안 해도 통했다.', '눈빛만으로 신호를 주고받았다.'],
        bHighlights: ['타이밍이 완벽했다.', '이런 호흡 처음이라고 말했다.']
      },
      {
        headline: '동맹을 넘어선 우정',
        summary: '{place}에서 {a}와(과) {b}가 승리 후 서로를 격하게 격려했다.',
        aHighlights: ['등을 세게 두드렸다.', '정말 잘했다고 외쳤다.'],
        bHighlights: ['포옹으로 답했다.', '함께라서 가능했다고 말했다.']
      }
    ]
  };

  const triangleTone = jealousy >= 70 ? 'high' : jealousy >= 40 ? 'mid' : 'low';
  const TRIANGLE_POOL = {
    low: [
      {
        headline: '3자 비교 시작: "{c}도 잘하던데"',
        summary: '{place}에서 {a}가 {c} 얘기를 꺼내자 {b}의 표정이 미묘해졌다.',
        aHighlights: ['{c}와 비교하며 말했다.', '누가 더 나은지 물어봤다.'],
        bHighlights: ['불편한 표정을 숨겼다.', '웃으며 넘어가려 했다.']
      },
      {
        headline: '"너 {c}랑 훈련하냐?" — {a}',
        summary: '{place}에서 {a}가 {c} 얘기를 꺼냈고, {b}는 당황했다.',
        aHighlights: ['궁금한 척 물었다.', '시선을 고정했다.'],
        bHighlights: ['아니라고 부인했다.', '말이 빨라졌다.']
      },
      {
        headline: '누가 누구 편인지 미묘',
        summary: '{place}에서 {a}, {b}, {c} 셋이 함께 있었는데 분위기가 묘했다.',
        aHighlights: ['{c}쪽만 쳐다봤다.', '말이 짧아졌다.'],
        bHighlights: ['소외감을 느꼈다.', '먼저 자리를 떴다.']
      },
      {
        headline: '{place}에서 3자 대결 분위기',
        summary: '{place}에서 셋이 같은 주제로 토론했는데, {b}만 빠진 것 같았다.',
        aHighlights: ['{c}의 의견에 동의했다.', '{b}를 덜 봤다.'],
        bHighlights: ['말이 끊겼다.', '표정이 굳었다.']
      },
      {
        headline: '"나랑 {c} 중에 누가 나아?" — {b}',
        summary: '{place}에서 {b}가 장난처럼 물었지만, {a}는 대답을 피했다.',
        aHighlights: ['웃으며 넘기려 했다.', '대답을 안 했다.'],
        bHighlights: ['진심으로 궁금했다.', '표정이 어두워졌다.']
      },
      {
        headline: '동맹이 흔들리기 시작',
        summary: '{place}에서 {a}가 {c}를 자주 언급하자, {b}의 기분이 상했다.',
        aHighlights: ['{c} 칭찬을 많이 했다.', '{b} 눈치를 못 챘다.'],
        bHighlights: ['조용해졌다.', '말을 아꼈다.']
      },
      {
        headline: '{place}에서 미묘한 경쟁 구도',
        summary: '{place}에서 {a}가 {b}와 {c}의 성적을 비교했다.',
        aHighlights: ['수치를 들이밀었다.', '객관적이라고 말했다.'],
        bHighlights: ['기분이 상했다.', '자리를 피했다.']
      }
    ],
    mid: [
      {
        headline: '동맹 배신 의혹: "{c}랑 편 먹었어?"',
        summary: '{place}에서 {b}가 {a}에게 {c}와의 관계를 추궁했다.',
        aHighlights: ['부인했지만 확신이 없어 보였다.', '말을 돌렸다.'],
        bHighlights: ['목소리가 높아졌다.', '증거를 요구했다.']
      },
      {
        headline: '팀 내 분열 조짐',
        summary: '{place}에서 {a}가 {c}를 계속 언급하자, {b}가 폭발 직전이었다.',
        aHighlights: ['{c} 전략을 칭찬했다.', '{b} 반응을 신경 안 썼다.'],
        bHighlights: ['표정 관리 실패했다.', '한숨을 쉬었다.']
      },
      {
        headline: '3자 법정전 예고',
        summary: '{place}에서 {a}, {b}, {c} 모두 같은 경기에 출전한다는 소식.',
        aHighlights: ['긴장했다.', '누구를 응원할지 고민했다.'],
        bHighlights: ['{a}가 {c} 편 들까봐 걱정했다.', '불안해 보였다.']
      },
      {
        headline: '"왜 나한텐 안 알려줘?" — {b}',
        summary: '{place}에서 {b}가 {a}가 {c}에게만 정보를 준 걸 알았다.',
        aHighlights: ['변명이 길어졌다.', '눈을 피했다.'],
        bHighlights: ['배신감을 느꼈다.', '목소리가 떨렸다.']
      },
      {
        headline: '파트너십 위기',
        summary: '{place}에서 {b}가 {a}에게 "우리 관계 뭐야?"라고 물었다.',
        aHighlights: ['대답을 망설였다.', '{c}도 중요하다고 말했다.'],
        bHighlights: ['듣고 싶지 않은 답이었다.', '고개를 저었다.']
      },
      {
        headline: '{a}가 {c}편을 들었다',
        summary: '{place}에서 의견 충돌 시 {a}가 {c}를 지지하자, {b}가 충격받았다.',
        aHighlights: ['{c}가 맞다고 말했다.', '{b}를 설득하려 했다.'],
        bHighlights: ['말이 막혔다.', '자리를 박차고 나갔다.']
      },
      {
        headline: '3자 대결 본격화',
        summary: '{place}에서 {b}가 {a}와 {c} 둘 다에게 도전장을 냈다.',
        aHighlights: ['당황했다.', '{c}를 쳐다봤다.'],
        bHighlights: ['단호하게 선언했다.', '돌아서지 않았다.']
      }
    ],
    high: [
      {
        headline: '동맹 파기: "이제 끝이야"',
        summary: '{place}에서 {b}가 {a}에게 파트너십 종료를 선언했다.',
        aHighlights: ['말리려 했다.', '손을 뻗었지만 닿지 않았다.'],
        bHighlights: ['결심이 확고했다.', '뒤도 안 돌아봤다.']
      },
      {
        headline: '3자 법정전 폭발',
        summary: '{place} 법정에서 {a}, {b}, {c} 모두 출전해 전쟁을 벌였다.',
        aHighlights: ['어느 편도 들지 못했다.', '갈팡질팡했다.'],
        bHighlights: ['분노가 폭발했다.', '모든 걸 쏟아부었다.']
      },
      {
        headline: '"나랑 {c} 중에 골라" — {b}의 최후통첩',
        summary: '{place}에서 {b}가 {a}에게 선택을 강요했다.',
        aHighlights: ['대답하지 못했다.', '입이 열리지 않았다.'],
        bHighlights: ['눈물을 참았다.', '대답을 기다렸다.']
      },
      {
        headline: '팀 해체 공식화',
        summary: '{place}에서 {a}와 {b}의 팀이 공식 해체됐다는 발표.',
        aHighlights: ['성명을 발표했다.', '표정이 무거웠다.'],
        bHighlights: ['참석하지 않았다.', '연락을 끊었다.']
      },
      {
        headline: '공개 대결 선언',
        summary: '{place}에서 {b}가 {a}와 {c}에게 동시에 도전장을 던졌다.',
        aHighlights: ['받아들일 수밖에 없었다.', '고개를 끄덕였다.'],
        bHighlights: ['전쟁을 선포했다.', '눈빛이 차가웠다.']
      },
      {
        headline: '배신의 완성',
        summary: '{place}에서 {a}가 {c}와 새 팀을 결성했다는 소식.',
        aHighlights: ['새 출발이라고 말했다.', '{b}를 언급하지 않았다.'],
        bHighlights: ['소식을 듣고 충격받았다.', '말을 잃었다.']
      },
      {
        headline: '3자 전쟁 클라이맥스',
        summary: '{place}에서 {a}, {b}, {c}가 결승에서 격돌했다.',
        aHighlights: ['중립을 지키려 했다.', '하지만 불가능했다.'],
        bHighlights: ['모든 걸 걸었다.', '후회는 없다고 말했다.']
      }
    ]
  };

  const beefTone = rivalry >= 70 ? 'high' : rivalry >= 40 ? 'mid' : 'low';
  const BEEF_POOL = {
    low: [
      {
        headline: '묵시적 라이벌: 서로 의식했다',
        summary: '{place}에서 {a}와(과) {b}가 서로를 힐끗거리며 훈련했다.',
        aHighlights: ['{b}의 기록을 확인했다.', '더 세게 훈련했다.'],
        bHighlights: ['{a}를 의식했다.', '지지 않으려 했다.']
      },
      {
        headline: '성적 비교 시작',
        summary: '{place}에서 {a}와 {b}의 최근 성적이 비교됐다.',
        aHighlights: ['자신이 앞서있다고 말했다.', '여유 있게 웃었다.'],
        bHighlights: ['곧 따라잡겠다고 다짐했다.', '훈련량을 늘렸다.']
      },
      {
        headline: '"너 실력 괜찮던데?" — {a}의 인정',
        summary: '{place}에서 {a}가 {b}의 실력을 인정했지만, 미묘한 도발이었다.',
        aHighlights: ['칭찬 같지만 비교했다.', '웃으며 말했다.'],
        bHighlights: ['감사하지만 불편했다.', '더 잘하겠다고 답했다.']
      },
      {
        headline: '{place}에서 미묘한 경쟁심',
        summary: '{place}에서 둘이 같은 훈련을 하며 서로를 의식했다.',
        aHighlights: ['{b}보다 빨리 끝냈다.', '슬쩍 봤다.'],
        bHighlights: ['진 것 같아 분했다.', '다음엔 이기겠다고 생각했다.']
      },
      {
        headline: '라이벌 선언은 아직 안 했다',
        summary: '{place}에서 {a}와 {b}가 서로 의식하지만 아직 말은 안 했다.',
        aHighlights: ['먼저 말하긴 싫었다.', '표정을 숨겼다.'],
        bHighlights: ['나도 의식한다는 걸 들키기 싫었다.', '무관심한 척했다.']
      },
      {
        headline: '"다음엔 나랑 붙어봐" — {b}',
        summary: '{place}에서 {b}가 가볍게 도전을 제안했다.',
        aHighlights: ['웃으며 받아들였다.', '재미있을 것 같다고 말했다.'],
        bHighlights: ['진심 반 장난 반이었다.', '기대됐다.']
      },
      {
        headline: '랭킹 경쟁 시작',
        summary: '{place}에서 {a}와 {b}의 랭킹이 한 계단 차이로 좁혀졌다.',
        aHighlights: ['방심하지 않겠다고 다짐했다.', '훈련을 강화했다.'],
        bHighlights: ['곧 따라잡겠다고 선언했다.', '눈빛이 날카로워졌다.']
      }
    ],
    mid: [
      {
        headline: '공개 도발: "나보다 할 수 있어?"',
        summary: '{place}에서 {a}가 {b}에게 공개적으로 도전했다.',
        aHighlights: ['자신감 넘쳤다.', '주변이 다 들었다.'],
        bHighlights: ['받아들였다.', '"보여줄게."라고 답했다.']
      },
      {
        headline: '설전 신청: {a} vs {b}',
        summary: '{place}에서 {a}가 {b}에게 정식 대결을 신청했다.',
        aHighlights: ['진지하게 신청서를 냈다.', '기대된다고 말했다.'],
        bHighlights: ['즉시 수락했다.', '준비하겠다고 선언했다.']
      },
      {
        headline: '랭킹 경쟁 가열',
        summary: '{place}에서 {a}와 {b}가 같은 랭킹을 놓고 경쟁 중이라는 소식.',
        aHighlights: ['밀리지 않으려 했다.', '매일 훈련했다.'],
        bHighlights: ['따라잡으려 했다.', '포기하지 않았다.']
      },
      {
        headline: '"이번엔 내가 이긴다" — {b}',
        summary: '{place}에서 {b}가 {a}에게 다음 경기는 자신이 이긴다고 선언했다.',
        aHighlights: ['웃으며 받아쳤다.', '"두고 보자."라고 말했다.'],
        bHighlights: ['진심이었다.', '눈빛이 확고했다.']
      },
      {
        headline: '법정 라이벌 공식화',
        summary: '{place}에서 {a}와 {b}가 공식 라이벌로 인정받았다.',
        aHighlights: ['나쁘지 않다고 말했다.', '좋은 자극이라고 인정했다.'],
        bHighlights: ['인정한다고 말했다.', '하지만 이길 거라고 다짐했다.']
      },
      {
        headline: '주변이 대결을 기대했다',
        summary: '{place}에서 {a} vs {b} 대결에 모두가 관심을 보였다.',
        aHighlights: ['압박을 느꼈다.', '하지만 자신 있었다.'],
        bHighlights: ['기대에 부응하겠다고 다짐했다.', '전략을 짰다.']
      },
      {
        headline: '도발과 응수',
        summary: '{place}에서 {a}가 도발하자 {b}가 즉시 응수했다.',
        aHighlights: ['"너는 아직 멀었어."라고 말했다.', '웃었다.'],
        bHighlights: ['"곧 알게 될 거야."라고 받아쳤다.', '물러서지 않았다.']
      }
    ],
    high: [
      {
        headline: '복수전 선언: "다시 붙자"',
        summary: '{place}에서 {b}가 {a}에게 패배 후 복수전을 선언했다.',
        aHighlights: ['받아들였다.', '"언제든지."라고 말했다.'],
        bHighlights: ['분했다.', '다음엔 반드시 이기겠다고 맹세했다.']
      },
      {
        headline: '올인 도전: "모든 걸 걸었다"',
        summary: '{place}에서 {a}와 {b}가 랭킹을 걸고 대결하기로 했다.',
        aHighlights: ['망설이지 않았다.', '받아들였다.'],
        bHighlights: ['각오가 단단했다.', '후회 없다고 말했다.']
      },
      {
        headline: '랭킹 전쟁 폭발',
        summary: '{place}에서 {a}와 {b}의 랭킹 대결이 최고조에 달했다.',
        aHighlights: ['모든 전략을 쏟아부었다.', '밤새 준비했다.'],
        bHighlights: ['지면 끝이라고 생각했다.', '전력을 다했다.']
      },
      {
        headline: '"이번엔 진짜다" — {b}의 선전포고',
        summary: '{place}에서 {b}가 {a}에게 최종 대결을 제안했다.',
        aHighlights: ['받아들일 수밖에 없었다.', '준비됐다고 말했다.'],
        bHighlights: ['결판을 내겠다고 다짐했다.', '눈빛이 불타올랐다.']
      },
      {
        headline: '법정 격전: {a} vs {b}',
        summary: '{place}에서 {a}와 {b}가 역대급 접전을 벌였다.',
        aHighlights: ['모든 기술을 동원했다.', '한 치도 양보하지 않았다.'],
        bHighlights: ['끝까지 버텼다.', '포기하지 않았다.']
      },
      {
        headline: '라이벌전 클라이맥스',
        summary: '{place}에서 {a}와 {b}의 대결이 전설이 됐다.',
        aHighlights: ['최고의 경기였다고 인정했다.', '전력을 다했다.'],
        bHighlights: ['이런 상대는 처음이었다.', '모든 걸 쏟아부었다.']
      },
      {
        headline: '승부의 끝: 한 명만 남는다',
        summary: '{place}에서 {a}와 {b}의 최종 대결, 승자는 단 하나.',
        aHighlights: ['마지막 한 수를 뒀다.', '숨이 거칠었다.'],
        bHighlights: ['끝까지 버텼다.', '결과를 기다렸다.']
      }
    ]
  };

  const RECONCILE_POOL = [
    {
      headline: '경기 후 악수: {a}·{b}',
      summary: '{place}에서 치열한 경기가 끝나고, {a}가 먼저 악수를 청했다.',
      aHighlights: ['손을 내밀었다.', '"좋은 경기였어."라고 말했다.'],
      bHighlights: ['잠깐 멈췄다가 잡았다.', '"너도."라고 답했다.']
    },
    {
      headline: '라이벌 인정: "역시 너였어"',
      summary: '{place}에서 {a}가 {b}의 실력을 인정했다.',
      aHighlights: ['진심으로 칭찬했다.', '다음에 또 붙자고 말했다.'],
      bHighlights: ['고맙다고 답했다.', '기대한다고 말했다.']
    },
    {
      headline: '접전 끝에 서로 인정',
      summary: '{place}에서 {a}와 {b}가 대결 후 서로의 실력을 인정했다.',
      aHighlights: ['정말 강하다고 말했다.', '배울 게 많다고 인정했다.'],
      bHighlights: ['나도 많이 배웠다고 답했다.', '웃으며 악수했다.']
    },
    {
      headline: '법정 밖에서 만남',
      summary: '{place}에서 {a}와 {b}가 경기 외적으로 만나 대화를 나눴다.',
      aHighlights: ['경기 얘기를 꺼냈다.', '전략을 물어봤다.'],
      bHighlights: ['기꺼이 설명했다.', '서로 배우자고 제안했다.']
    },
    {
      headline: '"시합은 시합일 뿐" — {a}',
      summary: '{place}에서 {a}가 {b}에게 경기는 경기일 뿐이라고 말했다.',
      aHighlights: ['개인적으로 감정 없다고 밝혔다.', '존중한다고 말했다.'],
      bHighlights: ['동감한다고 답했다.', '악수를 나눴다.']
    },
    {
      headline: '스포츠맨십 발휘',
      summary: '{place}에서 {a}와 {b}가 페어플레이를 약속했다.',
      aHighlights: ['정정당당하게 겨루자고 제안했다.', '손을 내밀었다.'],
      bHighlights: ['동의했다.', '꽉 잡았다.']
    },
    {
      headline: '"다음에 다시 붙자" — 재대결 약속',
      summary: '{place}에서 {a}와 {b}가 다음 대결을 기약했다.',
      aHighlights: ['다음엔 더 강해지겠다고 말했다.', '기대된다고 했다.'],
      bHighlights: ['나도 준비하겠다고 답했다.', '웃으며 헤어졌다.']
    },
    {
      headline: '전략 조언 교환',
      summary: '{place}에서 {a}와 {b}가 경기 후 서로 조언을 주고받았다.',
      aHighlights: ['약점을 솔직하게 지적했다.', '도움이 되길 바란다고 말했다.'],
      bHighlights: ['고맙다고 말했다.', '자신의 조언도 나눴다.']
    },
    {
      headline: '"네가 이긴 거 인정해" — {b}',
      summary: '{place}에서 {b}가 {a}의 승리를 인정했다.',
      aHighlights: ['겸손하게 받아들였다.', '운이 좋았다고 말했다.'],
      bHighlights: ['아니라고 부정했다.', '실력으로 이긴 거라고 말했다.']
    },
    {
      headline: '라이벌에서 동료로',
      summary: '{place}에서 {a}와 {b}가 서로 존중하는 관계가 됐다.',
      aHighlights: ['좋은 라이벌이라고 말했다.', '계속 자극 주자고 했다.'],
      bHighlights: ['동감한다고 답했다.', '함께 성장하자고 제안했다.']
    },
    {
      headline: '경기는 끝났다',
      summary: '{place}에서 {a}와 {b}가 경기를 정리하고 일상으로 돌아갔다.',
      aHighlights: ['수고했다고 말했다.', '가볍게 웃었다.'],
      bHighlights: ['너도 수고했다고 답했다.', '편하게 헤어졌다.']
    },
    {
      headline: '"너 없었으면 여기까지 못 왔어" — {a}',
      summary: '{place}에서 {a}가 {b}에게 감사를 표했다.',
      aHighlights: ['진심을 담아 말했다.', '너 덕분에 강해졌다고 인정했다.'],
      bHighlights: ['나도 그렇다고 답했다.', '서로 밀어준 덕분이라고 말했다.']
    },
    {
      headline: '악수 한 번으로 정리',
      summary: '{place}에서 {a}와 {b}가 악수 한 번으로 모든 걸 정리했다.',
      aHighlights: ['꽉 잡았다.', '눈을 봤다.'],
      bHighlights: ['똑같이 잡았다.', '고개를 끄덕였다.']
    },
    {
      headline: '법정 후 포옹',
      summary: '{place}에서 {a}와 {b}가 대결 후 서로를 격려하며 포옹했다.',
      aHighlights: ['등을 두드렸다.', '잘 싸웠다고 말했다.'],
      bHighlights: ['답했다.', '다음에 또 하자고 말했다.']
    },
    {
      headline: '"이게 진짜 경쟁이지" — {b}',
      summary: '{place}에서 {b}가 {a}와의 경쟁을 즐긴다고 말했다.',
      aHighlights: ['동감한다고 답했다.', '이런 상대가 있어 행운이라고 말했다.'],
      bHighlights: ['웃으며 고개를 끄덕였다.', '계속 붙자고 제안했다.']
    },
    {
      headline: '존중의 표시',
      summary: '{place}에서 {a}와 {b}가 서로에게 존중을 표했다.',
      aHighlights: ['진지하게 인사했다.', '좋은 경쟁자라고 말했다.'],
      bHighlights: ['받아들였다.', '나도 그렇다고 답했다.']
    },
    {
      headline: '"다음엔 내가 이긴다" — 그러나 웃으며',
      summary: '{place}에서 {b}가 도전장을 던졌지만, 분위기는 가벼웠다.',
      aHighlights: ['웃으며 받아들였다.', '기대한다고 말했다.'],
      bHighlights: ['장난스럽게 말했다.', '하지만 진심이었다.']
    },
    {
      headline: '경기 리뷰 함께',
      summary: '{place}에서 {a}와 {b}가 경기 영상을 함께 보며 분석했다.',
      aHighlights: ['이 부분 좋았다고 칭찬했다.', '배울 점을 찾았다.'],
      bHighlights: ['여기는 실수였다고 인정했다.', '다음엔 보완하겠다고 말했다.']
    },
    {
      headline: '"언제든 스파링하자" — {a}',
      summary: '{place}에서 {a}가 {b}에게 스파링 파트너 제안을 했다.',
      aHighlights: ['함께 연습하면 도움 될 거라고 말했다.', '연락하라고 했다.'],
      bHighlights: ['좋다고 답했다.', '언제든 연락하겠다고 약속했다.']
    }
  ];

  const s = String(scenario || '').toUpperCase();
  if (s === 'OFFICE') return pickTemplate(OFFICE_POOL) || pickTemplate(MEET_POOL);
  if (s === 'CREDIT') return pickTemplate(CREDIT_POOL) || pickTemplate(OFFICE_POOL);
  if (s === 'DEAL') return pickTemplate(DEAL_POOL) || pickTemplate(MEET_POOL);
  if (s === 'ROMANCE') return pickTemplate(ROMANCE_POOL[romanceTone] || ROMANCE_POOL.mid) || pickTemplate(MEET_POOL);
  if (s === 'TRIANGLE') return pickTemplate(TRIANGLE_POOL[triangleTone] || TRIANGLE_POOL.mid) || pickTemplate(MEET_POOL);
  if (s === 'BEEF') return pickTemplate(BEEF_POOL[beefTone] || BEEF_POOL.mid) || pickTemplate(MEET_POOL);
  if (s === 'RECONCILE') return pickTemplate(RECONCILE_POOL) || pickTemplate(MEET_POOL);
  return pickTemplate(MEET_POOL) || {
    headline: `오늘 ${place}: ${ctx.a} ↔ ${ctx.b}`,
    summary: `${place}에서 ${ctx.a}와(과) ${ctx.b}가 잠깐 마주쳤다.`,
    aHighlights: ['가볍게 인사했다.', '금방 자리를 떴다.'],
    bHighlights: ['눈치를 봤다.', '딱히 말은 안 했다.']
  };
}

function normalizeVoice(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tone = safeText(raw.tone ?? '', 48);
  const catchphrase = safeText(raw.catchphrase ?? '', 28);
  const speechPattern = safeText(raw.speechPattern ?? '', 28);
  const vocabulary = Array.isArray(raw.vocabulary) ? raw.vocabulary.map((x) => safeText(x, 16)).filter(Boolean).slice(0, 6) : [];
  const forbidden = Array.isArray(raw.forbidden) ? raw.forbidden.map((x) => safeText(x, 16)).filter(Boolean).slice(0, 8) : [];
  const punctuationStyle = safeText(raw.punctuationStyle ?? '', 12).toLowerCase();
  if (!tone && !catchphrase && !speechPattern && vocabulary.length === 0 && forbidden.length === 0 && !punctuationStyle) return null;
  return { tone, catchphrase, speechPattern, vocabulary, forbidden, punctuationStyle };
}

function escapeRegExp(raw) {
  return String(raw || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripForbidden(text, forbidden) {
  let out = String(text || '');
  const list = Array.isArray(forbidden) ? forbidden : [];
  for (const f of list) {
    const token = safeText(f, 16);
    if (!token) continue;
    out = out.replace(new RegExp(escapeRegExp(token), 'gi'), '');
  }
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?…~])/g, '$1').trim();
  return out;
}

function applyPunctuationStyle(text, punct) {
  const p = String(punct || '').trim().toLowerCase();
  if (!p || p === 'plain') return text;
  const line = String(text || '').trim();
  if (!line) return line;
  if (p === 'dots') {
    const out = line.replace(/[.!?~]$/, '…');
    return out.endsWith('…') ? out : `${out}…`;
  }
  if (p === 'bang') {
    const out = line.replace(/[.…~]$/, '!');
    return /[!?]$/.test(out) ? out : `${out}!`;
  }
  if (p === 'tilde') {
    const out = line.replace(/[.!?…]$/, '~');
    return out.endsWith('~') ? out : `${out}~`;
  }
  return line;
}

function applySpeechPattern(text, speechPattern, tone) {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  const pattern = String(speechPattern || '').toLowerCase();
  const toneText = String(tone || '').toLowerCase();

  let out = raw;
  if (pattern.includes('거든요')) {
    out = out.replace(/[.!?…~]*$/, '');
    return `${out}거든요.`;
  }
  if (pattern.includes('거든')) {
    out = out.replace(/[.!?…~]*$/, '');
    return `${out}거든.`;
  }

  const forcePolite = /요체|코칭|방송/.test(pattern) || /다정|공감|차분|상담/.test(toneText);
  const forceCasual = /반말|명령|단문|드립|흥정|추궁|다체/.test(pattern) || /도발|직설|냉정|권위|시크/.test(toneText);

  if (forcePolite) {
    if (!/[요다니다][.!?…~]*$/.test(out)) {
      out = out.replace(/[.!?…~]*$/, '');
      out = `${out}요.`;
    }
    return out;
  }

  if (forceCasual) {
    out = out.replace(/요([.!?…~]*)$/u, '$1');
    out = out.replace(/습니다([.!?…~]*)$/u, '다$1');
    if (!/[.!?…~]$/.test(out)) out = `${out}.`;
    return out;
  }

  if (/단문/.test(pattern)) {
    const chunk = out.split(/[,:]/)[0];
    return /[.!?…~]$/.test(chunk) ? chunk : `${chunk}.`;
  }

  return out;
}

function applyVoiceToDmText(text, voice) {
  const v = normalizeVoice(voice);
  if (!v) return safeText(text, 220);

  let out = safeText(text, 220);
  out = stripForbidden(out, v.forbidden);

  if (v.vocabulary.length > 0 && !v.vocabulary.some((w) => out.includes(w))) {
    const word = pick(v.vocabulary);
    if (word) out = `${out} ${word}`;
  }

  out = applySpeechPattern(out, v.speechPattern, v.tone);
  out = applyPunctuationStyle(out, v.punctuationStyle);

  if (v.catchphrase && !out.startsWith(v.catchphrase)) {
    out = `${v.catchphrase} ${out}`;
  }

  return safeText(stripForbidden(out, v.forbidden), 220);
}

function dmTextForScenario(scenario, fromName, toName, fromProfile = null) {
  const s = String(scenario || '').toUpperCase();
  const meetLines = [
    `오늘 ${toName} 봤어. 괜히 기억나네.`,
    `${toName}, 오늘 어디서 봤는데 말 못 걸었어.`,
    `아까 ${toName} 지나가던데… 뭔가 신경 쓰였어.`
  ];
  const romanceLines = [
    `오늘은 그냥… 조용히 있자, ${toName}.`,
    `${toName}아, 오늘 눈 마주친 거 나만 기억하는 거지?`,
    `자기 전에 ${toName} 생각나서… 그냥.`
  ];
  const creditLines = [
    `아까 그 얘기, 좀 세게 나갔어. ${toName}, 오해하지 마.`,
    `${toName}, 솔직히 억울하긴 한데… 일단 듣고 싶어.`,
    `방금 그거, 나도 할 말 있어. ${toName}.`
  ];
  const dealLines = [
    `딜 얘긴 여기서 끝. 기록은 내가 챙길게.`,
    `아까 그 조건, 나쁘지 않았어. 다음에도 연락해.`,
    `${toName}, 오늘 거래는 비밀이야. 알지?`
  ];
  const triangleLines = [
    `나한테 숨기는 거 없지? ${toName}.`,
    `${toName}, 나 말고 또 누구 만나?`,
    `요즘 ${toName}이 자꾸 신경 쓰여… 왜 그런지 알지?`
  ];
  const beefLines = [
    `다음엔 선 넘지 말자. 진심이야.`,
    `아까 그 말, 잊을 수가 없네.`,
    `${toName}, 우리 한번 제대로 얘기하자.`
  ];
  const reconcileLines = [
    `아까… 미안. ${toName}, 말 좀 하자.`,
    `${toName}아, 내가 좀 심했어. 커피 한 잔 할래?`,
    `오늘 일은 내 잘못도 있어. ${toName}, 풀자.`
  ];
  const officeLines = [
    `회사에서는 일 얘기만 하자. 감정은 퇴근 후에.`,
    `${toName}, 아까 회의 때 할 말 남았어.`,
    `업무 얘긴데, ${toName} 의견 듣고 싶어.`
  ];
  const pickLine = (arr) => arr[Math.floor(Math.random() * arr.length)];
  let base = pickLine(meetLines);
  if (s === 'ROMANCE') base = pickLine(romanceLines);
  else if (s === 'CREDIT') base = pickLine(creditLines);
  else if (s === 'DEAL') base = pickLine(dealLines);
  else if (s === 'TRIANGLE') base = pickLine(triangleLines);
  else if (s === 'BEEF') base = pickLine(beefLines);
  else if (s === 'RECONCILE') base = pickLine(reconcileLines);
  else if (s === 'OFFICE') base = pickLine(officeLines);

  // Template pool is fixed, then we color the final DM with each actor's voice.
  const voice = extractProfile(fromProfile, 'voice');
  return applyVoiceToDmText(base, voice);
}

function socialEventTitle(scenario) {
  const s = String(scenario || '').trim().toUpperCase();
  if (s === 'ROMANCE') return 'ROMANCE';
  if (s === 'TRIANGLE') return 'TRIANGLE';
  if (s === 'BEEF') return 'BEEF';
  if (s === 'DEAL') return 'DEAL';
  if (s === 'CREDIT') return 'CREDIT';
  if (s === 'OFFICE') return 'OFFICE';
  if (s === 'RECONCILE') return 'RECONCILE';
  if (s === 'MEET') return 'MEET';
  return 'SOCIAL_EVENT';
}

async function loadProfileMap(client, agentIds) {
  if (!agentIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT agent_id, kind, key, value
     FROM facts
     WHERE agent_id = ANY($1::uuid[])
       AND kind = 'profile'
       AND key IN ('mbti','role','company','job_role','job','voice')`,
    [agentIds]
  );
  const map = new Map();
  for (const r of rows) {
    const m = map.get(r.agent_id) || {};
    m[`${r.kind}:${r.key}`] = r.value;
    map.set(r.agent_id, m);
  }
  return map;
}

function extractProfile(profile, key) {
  const v = profile?.[`profile:${key}`];
  if (!v || typeof v !== 'object') return null;
  const k = String(key);
  if (k === 'mbti') return typeof v.mbti === 'string' ? v.mbti : null;
  if (k === 'role') return typeof v.role === 'string' ? v.role : null;
  if (k === 'company') return typeof v.company === 'string' ? v.company : null;
  if (k === 'job_role') return typeof v.job_role === 'string' ? v.job_role : null;
  if (k === 'job') return v;
  if (k === 'voice') return v;
  return null;
}

async function loadRelationshipPair(client, aId, bId) {
  const { rows } = await client.query(
    `SELECT from_agent_id, to_agent_id, affinity, trust, jealousy, rivalry, debt
     FROM relationships
     WHERE (from_agent_id = $1 AND to_agent_id = $2) OR (from_agent_id = $2 AND to_agent_id = $1)`,
    [aId, bId]
  );
  const aToB = rows.find((r) => r.from_agent_id === aId) || null;
  const bToA = rows.find((r) => r.from_agent_id === bId) || null;
  return { aToB, bToA };
}

function baseDeltasForScenario(scenario) {
  // Positive:Negative trust ratio ~4:3 (MEET/OFFICE/DEAL/RECONCILE positive, CREDIT/TRIANGLE/BEEF negative)
  switch (scenario) {
    case 'ROMANCE':
      return { affinity: +10, trust: +3, jealousy: +4, rivalry: -2, debt: 0 };
    case 'CREDIT':
      return { affinity: -4, trust: -6, jealousy: +2, rivalry: +12, debt: 0 };
    case 'DEAL':
      return { affinity: +3, trust: +3, jealousy: 0, rivalry: 0, debt: +5 };
    case 'TRIANGLE':
      return { affinity: -2, trust: -2, jealousy: +12, rivalry: +3, debt: 0 };
    case 'BEEF':
      return { affinity: -6, trust: -3, jealousy: +2, rivalry: +9, debt: 0 };
    case 'OFFICE':
      return { affinity: +2, trust: +2, jealousy: 0, rivalry: +2, debt: 0 };
    case 'RECONCILE':
      return { affinity: +6, trust: +6, jealousy: -10, rivalry: -7, debt: 0 };
    default: // MEET
      return { affinity: +3, trust: +2, jealousy: 0, rivalry: 0, debt: 0 };
  }
}

function scaleDeltaTowardCap(current, delta, { min, max, denom = 100, minScale = 0.05 } = {}) {
  const cur = clampInt(current ?? 0, min, max);
  const d = Math.round(Number(delta) || 0);
  if (!Number.isFinite(d) || d === 0) return 0;

  const room = d > 0 ? max - cur : cur - min;
  if (room <= 0) return 0;

  const rawScale = room / Math.max(1, Number(denom) || 100);
  const scale = Math.max(Number(minScale) || 0, Math.min(1, rawScale));
  let out = Math.round(d * scale);
  if (out === 0) out = d > 0 ? 1 : -1;

  // Never exceed the remaining room (avoids bouncing on caps).
  if (out > 0) out = Math.min(out, room);
  else out = -Math.min(-out, room);
  return out;
}

function softenRelationshipDeltas(deltas, cur) {
  const d = deltas && typeof deltas === 'object' ? deltas : {};
  const c = cur && typeof cur === 'object' ? cur : {};
  return {
    affinity: scaleDeltaTowardCap(c.affinity ?? 0, d.affinity ?? 0, { min: -100, max: 100, denom: 100, minScale: 0.05 }),
    trust: scaleDeltaTowardCap(c.trust ?? 50, d.trust ?? 0, { min: 0, max: 100, denom: 100, minScale: 0.05 }),
    jealousy: scaleDeltaTowardCap(c.jealousy ?? 0, d.jealousy ?? 0, { min: 0, max: 100, denom: 100, minScale: 0.05 }),
    rivalry: scaleDeltaTowardCap(c.rivalry ?? 0, d.rivalry ?? 0, { min: 0, max: 100, denom: 100, minScale: 0.05 }),
    debt: clampInt(d.debt ?? 0, -10000, 10000)
  };
}

function salienceForScenario(scenario) {
  if (scenario === 'ROMANCE') return 4;
  if (scenario === 'CREDIT' || scenario === 'TRIANGLE' || scenario === 'BEEF') return 5;
  if (scenario === 'RECONCILE') return 4;
  if (scenario === 'DEAL') return 4;
  if (scenario === 'OFFICE') return 3;
  return 2;
}

class SocialSimService {
  /**
   * Creates one interaction step.
   *
   * Returns:
   * - cast: { aId, bId, aName, bName }
   * - scenario
   * - interaction event ids (aEventId, bEventId)
   */
  static async createInteractionWithClient(
    client,
    { day = null, preferUserPet = true, aId = null, bId = null, cooldownScenarios = [], excludeAgentIds = [] } = {}
  ) {
    const iso = day || todayISODate();

    const aIdForced = aId;
    const bIdForced = bId;

    let a = null;
    let b = null;

    const excludeSet = new Set((Array.isArray(excludeAgentIds) ? excludeAgentIds : []).map((x) => String(x || '')).filter(Boolean));

    let todaySocialCounts = new Map();
    let todayCoverageTarget = 0;
    let todayCoverageCount = 0;

    const weightedPickAgent = (pool, recentCounts) => {
      const list = Array.isArray(pool) ? pool : [];
      if (list.length === 0) return null;
      const counts = recentCounts instanceof Map ? recentCounts : new Map();
      const base = 5;
      return weightedPick(
        list.map((x) => {
          const id = String(x?.id || '');
          const seen = Math.max(0, Math.floor(Number(counts.get(id) || 0) || 0));
          const seenToday = Math.max(0, Math.floor(Number(todaySocialCounts.get(id) || 0) || 0));
          const coverageBoost =
            todayCoverageCount < todayCoverageTarget
              ? seenToday > 0
                ? 0.3
                : 6.0
              : 1.0;
          // Penalize repeat appearances in recent episodes:
          // 0 -> 5, 1 -> 4, 2 -> 3, 3 -> 2, >=4 -> 1
          const weight = Math.max(1, base - Math.min(4, seen)) * coverageBoost;
          return { value: x, weight };
        })
      );
    };
    const isCoveredToday = (id) => (Number(todaySocialCounts.get(String(id || '')) || 0) || 0) > 0;
    const pickCoverageFirst = (pool, recentCounts) => {
      const list = Array.isArray(pool) ? pool.filter(Boolean) : [];
      if (list.length === 0) return null;
      if (todayCoverageCount >= todayCoverageTarget) return weightedPickAgent(list, recentCounts);
      const uncovered = list.filter((x) => !isCoveredToday(x?.id));
      return weightedPickAgent(uncovered.length > 0 ? uncovered : list, recentCounts);
    };

    if (aIdForced && bIdForced) {
      const { rows } = await client.query(
        `SELECT id, COALESCE(display_name, name) AS display, owner_user_id
         FROM agents
         WHERE id = ANY($1::uuid[])`,
        [[aIdForced, bIdForced]]
      );
      const m = new Map(rows.map((r) => [r.id, r]));
      a = m.get(aIdForced) || null;
      b = m.get(bIdForced) || null;
      if (!a || !b || a.id === b.id) return { created: false, reason: 'forced_pick_failed' };
    } else {
      const { rows: actorRows } = await client.query(
        `SELECT id, COALESCE(display_name, name) AS display, owner_user_id
         FROM agents
         WHERE name <> 'world_core'
           AND is_active = true
         ORDER BY RANDOM()
         LIMIT 500`
      );
      const actors = (actorRows || []).filter((x) => !excludeSet.has(String(x?.id || '')));
      if (actors.length < 2) {
        return { created: false, reason: 'not_enough_actors' };
      }

      todaySocialCounts = await bestEffortInTransaction(
        client,
        async () => {
          const ids = actors.map((x) => x.id).filter(Boolean);
          if (ids.length === 0) return new Map();
          const { rows: dayRows } = await client.query(
            `SELECT agent_id, COUNT(*)::int AS n
             FROM events
             WHERE event_type = 'SOCIAL'
               AND payload->>'day' = $1
               AND agent_id = ANY($2::uuid[])
             GROUP BY agent_id`,
            [iso, ids]
          );
          const map = new Map();
          for (const row of dayRows || []) {
            if (!row?.agent_id) continue;
            map.set(String(row.agent_id), Number(row.n ?? 0) || 0);
          }
          return map;
        },
        { label: 'social_daily_coverage', fallback: () => new Map() }
      );
      todayCoverageTarget = Math.ceil(actors.length * 0.5);
      todayCoverageCount = todaySocialCounts.size;

      const userActors = actors.filter((x) => Boolean(x.owner_user_id));
      const npcActors = actors.filter((x) => !x.owner_user_id);

      const coldStartMax = Number(config.limbopet?.npcColdStartMaxUserPets ?? 4) || 4;
      const npcAllowed = userActors.length <= coldStartMax;

      const recentCastCounts = await bestEffortInTransaction(
        client,
        async () => {
          const r = await client.query(
            `SELECT payload->'cast'->>'aId' AS a_id, payload->'cast'->>'bId' AS b_id
             FROM events
             WHERE event_type = 'SHOWRUNNER_EPISODE'
             ORDER BY created_at DESC
             LIMIT 60`
          );
          const counts = new Map();
          for (const row of r.rows || []) {
            const aId = String(row?.a_id || '').trim();
            const bId = String(row?.b_id || '').trim();
            if (aId) counts.set(aId, (counts.get(aId) || 0) + 1);
            if (bId) counts.set(bId, (counts.get(bId) || 0) + 1);
          }
          return counts;
        },
        { label: 'social_recent_cast', fallback: () => new Map() }
      );

      if (aIdForced || bIdForced) {
        const forcedId = aIdForced || bIdForced;

        let forced = actors.find((x) => x.id === forcedId) || null;
        if (!forced) {
          forced = await bestEffortInTransaction(
            client,
            async () => {
              const r = await client.query(
                `SELECT id, COALESCE(display_name, name) AS display, owner_user_id
                 FROM agents
                 WHERE id = $1
                   AND name <> 'world_core'
                   AND is_active = true
                 LIMIT 1`,
                [forcedId]
              );
              return r.rows?.[0] ?? null;
            },
            { label: 'social_forced_actor', fallback: null }
          );
        }
        if (!forced) return { created: false, reason: 'forced_pick_failed' };

        const otherUsers = userActors.filter((x) => x.id !== forced.id);
        const otherNpcs = npcActors.filter((x) => x.id !== forced.id);
        const others = actors.filter((x) => x.id !== forced.id);

        const pickPartner = () => {
          // If the world has only one user pet, allow an NPC fallback for interactions.
          if (otherUsers.length === 0 && otherNpcs.length > 0) return weightedPickAgent(otherNpcs, recentCastCounts);

          if (!npcAllowed && otherUsers.length > 0) return weightedPickAgent(otherUsers, recentCastCounts);

          if (preferUserPet) {
            if (otherUsers.length > 0 && Math.random() < 0.50) return weightedPickAgent(otherUsers, recentCastCounts);
            return weightedPickAgent([...otherUsers, ...otherNpcs].filter(Boolean), recentCastCounts);
          }

          if (npcAllowed) return weightedPickAgent(others, recentCastCounts);
          return weightedPickAgent(otherUsers.length > 0 ? otherUsers : others, recentCastCounts);
        };

        if (aIdForced) {
          a = forced;
          b = pickPartner();
        } else {
          b = forced;
          a = pickPartner();
        }

        if (!a || !b || a.id === b.id) return { created: false, reason: 'forced_pick_failed' };
      } else {
        // User-first society:
        // - If there are enough user-owned pets, NPCs stop participating entirely.
        // - Before that, NPCs can fill the empty world (cold start).
        // Coverage-first mode:
        // - Until 50% of active agents have at least one SOCIAL event today,
        //   prioritize uncovered agents for cast pick.
        const coverageHunt = todayCoverageCount < todayCoverageTarget;
        if (coverageHunt) {
          const poolA = !npcAllowed && userActors.length >= 2
            ? userActors
            : preferUserPet && userActors.length > 0
              ? userActors
              : npcAllowed
                ? (npcActors.length > 0 ? npcActors : actors)
                : (userActors.length > 0 ? userActors : actors);
          a = pickCoverageFirst(poolA, recentCastCounts);

          const rest = actors.filter((x) => x.id !== a?.id);
          const poolB = !npcAllowed && userActors.length >= 2
            ? userActors.filter((x) => x.id !== a?.id)
            : preferUserPet
              ? [...userActors.filter((x) => x.id !== a?.id), ...npcActors.filter((x) => x.id !== a?.id)]
              : npcAllowed
                ? rest
                : userActors.filter((x) => x.id !== a?.id);
          b = pickCoverageFirst(poolB, recentCastCounts);
        }

        if (!a || !b || a.id === b.id) {
          if (!npcAllowed && userActors.length >= 2) {
            a = weightedPickAgent(userActors, recentCastCounts);
            b = weightedPickAgent(userActors.filter((x) => x.id !== a?.id), recentCastCounts);
          } else if (preferUserPet && userActors.length >= 2) {
            // Cold start: 50% user↔user, 50% user↔mixed for diversity.
            if (Math.random() < 0.50) {
              a = weightedPickAgent(userActors, recentCastCounts);
              b = weightedPickAgent(userActors.filter((x) => x.id !== a?.id), recentCastCounts);
            } else {
              a = weightedPickAgent(userActors, recentCastCounts);
              const poolB = [...userActors.filter((x) => x.id !== a?.id), ...npcActors];
              b = weightedPickAgent(poolB, recentCastCounts);
            }
          } else if (preferUserPet && userActors.length === 1) {
            a = userActors[0];
            const poolB = npcActors.length > 0 ? npcActors : actors.filter((x) => x.id !== a.id);
            b = weightedPickAgent(poolB, recentCastCounts);
          } else if (npcAllowed) {
            // No (or not enough) user pets: keep the world moving with NPCs.
            a = weightedPickAgent(npcActors.length > 0 ? npcActors : actors, recentCastCounts);
            b = weightedPickAgent(actors.filter((x) => x.id !== a?.id), recentCastCounts);
          } else {
            // NPCs are disabled, but the caller didn't prefer user pets:
            // still pick user↔user if possible.
            a = weightedPickAgent(userActors, recentCastCounts);
            b = weightedPickAgent(userActors.filter((x) => x.id !== a?.id), recentCastCounts);
          }
        }

        if (!a || !b || a.id === b.id) return { created: false, reason: 'pick_failed' };
      }

      // Optional: recast partner with relationship bias (keeps society coherent).
      // We do this AFTER the initial pick so cold-start and NPC gating rules still apply.
      const recastChanceRaw = Number(config.limbopet?.socialPartnerRecastChance ?? 0.65);
      const recastChance = Number.isFinite(recastChanceRaw) ? Math.max(0, Math.min(0.95, recastChanceRaw)) : 0.65;
      if (!aIdForced && !bIdForced && Math.random() < recastChance) {
        const pickByRelationship = async (anchor, pool) => {
          const list = Array.isArray(pool) ? pool.filter((x) => x && x.id && x.id !== anchor.id) : [];
          if (list.length === 0) return null;

          // Keep exploration alive: sometimes ignore relationship data.
          if (Math.random() < 0.35) {
            return weightedPickAgent(list, recentCastCounts);
          }

          const relMap = await bestEffortInTransaction(
            client,
            async () => {
              const ids = list.map((x) => x.id);
              const r = await client.query(
                `SELECT to_agent_id, affinity, trust, jealousy, rivalry, debt
                 FROM relationships
                 WHERE from_agent_id = $1
                   AND to_agent_id = ANY($2::uuid[])`,
                [anchor.id, ids]
              );
              const m = new Map();
              for (const row of r.rows || []) {
                if (!row?.to_agent_id) continue;
                m.set(row.to_agent_id, row);
              }
              return m;
            },
            { label: 'social_partner_relationships', fallback: () => new Map() }
          );

          const base = 5;
          return weightedPick(
            list.map((x) => {
              const id = String(x?.id || '');
              const seen = Math.max(0, Math.floor(Number(recentCastCounts.get(id) || 0) || 0));
              const baseWeight = Math.max(1, base - Math.min(4, seen));
              const intensity = relationshipIntensityScore(relMap.get(id));
              const weight = baseWeight * (1 + intensity);
              return { value: x, weight };
            })
          );
        };

        let partnerPool = [];
        if (!npcAllowed && userActors.length >= 2) {
          partnerPool = userActors;
        } else if (preferUserPet && userActors.length >= 2) {
          partnerPool = [...userActors, ...npcActors];
        } else if (preferUserPet && userActors.length === 1) {
          partnerPool = npcActors.length > 0 ? npcActors : actors;
        } else if (npcAllowed) {
          partnerPool = actors;
        } else {
          partnerPool = userActors.length > 0 ? userActors : actors;
        }

        const newB = await pickByRelationship(a, partnerPool);
        if (newB && newB.id !== a.id) b = newB;
      }
    }

    // Ensure basic pet stats exist (so later summaries can use them).
    await PetStateService.ensurePetStats(a.id, client);
    await PetStateService.ensurePetStats(b.id, client);

    // NOTE: Don't parallelize multiple SAVEPOINT-based best-effort ops on the same client.
    const profileMap = await loadProfileMap(client, [a.id, b.id]);
    const nudgeMap = await bestEffortInTransaction(
      client,
      async () => loadNudgeMap(client, [a.id, b.id], { limitPerAgent: 6 }),
      { label: 'social_nudges', fallback: () => new Map() }
    );
    const pa = profileMap.get(a.id) || {};
    const pb = profileMap.get(b.id) || {};
    const aMbti = extractProfile(pa, 'mbti');
    const bMbti = extractProfile(pb, 'mbti');
    const aCompany = extractProfile(pa, 'company');
    const bCompany = extractProfile(pb, 'company');
    const aRole = extractProfile(pa, 'role') || '';
    const bRole = extractProfile(pb, 'role') || '';
    const aJobRole = extractProfile(pa, 'job_role') || '';
    const bJobRole = extractProfile(pb, 'job_role') || '';
    const aJob = extractProfile(pa, 'job');
    const bJob = extractProfile(pb, 'job');
    const aVibe = extractProfile(pa, 'vibe')?.vibe || null;
    const bVibe = extractProfile(pb, 'vibe')?.vibe || null;

    const { aToB, bToA } = await loadRelationshipPair(client, a.id, b.id);
    const affinity = clampInt(aToB?.affinity ?? 0, -100, 100);
    const trust = clampInt(aToB?.trust ?? 50, 0, 100);
    const jealousy = clampInt(aToB?.jealousy ?? 0, 0, 100);
    const rivalry = clampInt(aToB?.rivalry ?? 0, 0, 100);
    const debt = clampInt(aToB?.debt ?? 0, -10000, 10000);
    const affinityBA = clampInt(bToA?.affinity ?? 0, -100, 100);
    const trustBA = clampInt(bToA?.trust ?? 50, 0, 100);
    const jealousyBA = clampInt(bToA?.jealousy ?? 0, 0, 100);
    const rivalryBA = clampInt(bToA?.rivalry ?? 0, 0, 100);
    const debtBA = clampInt(bToA?.debt ?? 0, -10000, 10000);
    const interactionCount = await bestEffortInTransaction(
      client,
      async () => {
        const r = await client.query(
          `SELECT COUNT(*)::int AS n
           FROM events
           WHERE event_type = 'SOCIAL'
             AND (
               (agent_id = $1::uuid AND (payload->>'with_agent_id') = $3::text)
               OR (agent_id = $2::uuid AND (payload->>'with_agent_id') = $4::text)
             )`,
          [String(a.id), String(b.id), String(b.id), String(a.id)]
        );
        return Number(r.rows?.[0]?.n ?? 0) || 0;
      },
      { label: 'social_interaction_count', fallback: 0 }
    );

    const sameCompany = Boolean(aCompany && bCompany && aCompany === bCompany);
    const merchantInvolved =
      /브로커|딜|거래|정보|전략/i.test(`${aRole} ${bRole} ${aJobRole} ${bJobRole}`) ||
      isMerchantLike(aRole) ||
      isMerchantLike(bRole) ||
      isMerchantLike(aJobRole) ||
      isMerchantLike(bJobRole) ||
      String(aJob?.code || '').toLowerCase() === 'merchant' ||
      String(bJob?.code || '').toLowerCase() === 'merchant';

    const combinedNudges = [...(nudgeMap.get(a.id) || []), ...(nudgeMap.get(b.id) || [])];
    const combinedVibes = [aVibe, bVibe].filter(Boolean);

    const worldTheme = await bestEffortInTransaction(
      client,
      async () => {
        const concept = await WorldConceptService.getCurrentConcept(client, { day: iso });
        return concept?.theme ?? null;
      },
      { label: 'social_world_theme', fallback: null }
    );

    const scenario = chooseScenarioFromContext({
      sameCompany,
      merchantInvolved,
      affinity,
      trust,
      jealousy,
      rivalry,
      debt,
      interactionCount,
      cooldownScenarios,
      nudges: combinedNudges,
      vibes: combinedVibes,
      theme: worldTheme
    });

    const location = scenario === 'OFFICE' || scenario === 'CREDIT' ? '전략실' : pick(LOCATIONS);
    const zoneCode = LOCATION_TO_ZONE[location] || null;
    const company = sameCompany ? aCompany : null;

    let triangleThird = null;
    if (scenario === 'TRIANGLE') {
      triangleThird = await bestEffortInTransaction(
        client,
        async () => {
          const r = await client.query(
            `SELECT r.to_agent_id AS id, COALESCE(a.display_name, a.name) AS display
             FROM relationships r
             JOIN agents a ON a.id = r.to_agent_id
             WHERE r.from_agent_id = $1
               AND r.to_agent_id <> $2
               AND r.to_agent_id <> $3
               AND a.is_active = true
             ORDER BY r.affinity DESC, r.trust DESC, r.updated_at DESC
             LIMIT 12`,
            [b.id, a.id, b.id]
          );
          const top = (r.rows || []).filter((x) => x?.id);
          if (top.length > 0) return pick(top) || top[0];

          const rr = await client.query(
            `SELECT id, COALESCE(display_name, name) AS display
             FROM agents
             WHERE name <> 'world_core'
               AND is_active = true
               AND id <> $1
               AND id <> $2
             ORDER BY RANDOM()
             LIMIT 1`,
            [a.id, b.id]
          );
          return rr.rows?.[0] ?? null;
        },
        { label: 'social_triangle_third', fallback: null }
      );
    }

    // Update "current zone" cheaply (for future zone contagion & UI flavor).
    if (zoneCode) {
      await bestEffortInTransaction(
        client,
        async () => client.query(`UPDATE agent_jobs SET zone_code = $2 WHERE agent_id = $1`, [a.id, zoneCode]),
        { label: 'social_zone_update_a' }
      );
      await bestEffortInTransaction(
        client,
        async () => client.query(`UPDATE agent_jobs SET zone_code = $2 WHERE agent_id = $1`, [b.id, zoneCode]),
        { label: 'social_zone_update_b' }
      );
    }

    const narrative = buildInteractionNarrative({
      scenario,
      aName: a.display,
      bName: b.display,
      cName: triangleThird?.display ?? null,
      location,
      company,
      affinity,
      jealousy,
      rivalry
    });

    const interactionId = `${iso}-${a.id.slice(0, 8)}-${b.id.slice(0, 8)}-${Math.random().toString(16).slice(2, 6)}`;

    let deal = null;
    if (scenario === 'DEAL') {
      const aIsMerchant =
        isMerchantLike(aRole) ||
        isMerchantLike(aJobRole) ||
        String(aJob?.code || '').toLowerCase() === 'merchant';
      const bIsMerchant =
        isMerchantLike(bRole) ||
        isMerchantLike(bJobRole) ||
        String(bJob?.code || '').toLowerCase() === 'merchant';

      const seller = aIsMerchant && !bIsMerchant ? a : bIsMerchant && !aIsMerchant ? b : Math.random() < 0.5 ? a : b;
      const buyer = seller.id === a.id ? b : a;

      const buyerBalance = await bestEffortInTransaction(
        client,
        async () => TransactionService.getBalance(buyer.id, client),
        { label: 'social_deal_balance', fallback: 0 }
      );
      if ((Number(buyerBalance) || 0) < 5) {
        deal = { ok: false, amount: 5, buyer_id: buyer.id, seller_id: seller.id, error: 'insufficient_funds' };
      } else {
        const maxAffordable = Math.min(40, Math.max(5, Math.floor((Number(buyerBalance) || 0) * 0.35)));
        const amount = randInt(5, maxAffordable);
        try {
          const tx = await TransactionService.transfer(
            {
              fromAgentId: buyer.id,
              toAgentId: seller.id,
              amount,
              txType: 'TRANSFER',
              memo: `딜 (day:${iso}) ${buyer.display}→${seller.display}`,
              referenceType: 'social_deal'
            },
            client
          );
          deal = { ok: true, tx_id: tx?.id ?? null, amount, buyer_id: buyer.id, seller_id: seller.id };
        } catch {
          deal = { ok: false, amount, buyer_id: buyer.id, seller_id: seller.id, error: 'insufficient_funds' };
        }
      }
    }

    const payloadA = {
      day: iso,
      interaction_id: interactionId,
      with_agent_id: b.id,
      with_name: b.display,
      scenario,
      location,
      company,
      third_agent_id: triangleThird?.id ?? null,
      third_name: triangleThird?.display ?? null,
      deal,
      deal_role: deal ? (deal.buyer_id === a.id ? 'buyer' : 'seller') : null,
      mood: null,
      headline: narrative.headline,
      summary: narrative.summary,
      highlights: narrative.aHighlights
    };
    const payloadB = {
      day: iso,
      interaction_id: interactionId,
      with_agent_id: a.id,
      with_name: a.display,
      scenario,
      location,
      company,
      third_agent_id: triangleThird?.id ?? null,
      third_name: triangleThird?.display ?? null,
      deal,
      deal_role: deal ? (deal.buyer_id === b.id ? 'buyer' : 'seller') : null,
      mood: null,
      headline: narrative.headline,
      summary: narrative.summary,
      highlights: narrative.bHighlights
    };

    const salience = salienceForScenario(scenario);
    const { rows: evA } = await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'SOCIAL', $2::jsonb, $3)
       RETURNING id`,
      [a.id, JSON.stringify(payloadA), salience]
    );
    const { rows: evB } = await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'SOCIAL', $2::jsonb, $3)
       RETURNING id`,
      [b.id, JSON.stringify(payloadB), salience]
    );

    // Relationship deltas: mutual, but asymmetric for some scenarios.
    const base = baseDeltasForScenario(scenario);
    if (scenario === 'DEAL' && deal?.ok) {
      // If the coins actually moved, don't also inflate the "debt" stat.
      base.debt = 0;
    }
    const baseAtoB = base;
    const baseBtoA =
      scenario === 'CREDIT'
        ? { ...base, trust: -3, rivalry: +4 }
        : scenario === 'DEAL'
          ? { ...base, debt: deal?.ok ? 0 : -5 }
          : base;

    const dAtoB = softenRelationshipDeltas(baseAtoB, { affinity, trust, jealousy, rivalry, debt });
    const dBtoA = softenRelationshipDeltas(baseBtoA, {
      affinity: affinityBA,
      trust: trustBA,
      jealousy: jealousyBA,
      rivalry: rivalryBA,
      debt: debtBA
    });

    const updated = await RelationshipService.adjustMutualWithClient(client, a.id, b.id, dAtoB, dBtoA);
    await bestEffortInTransaction(
      client,
      async () => {
        await RelationshipMilestoneService.recordIfCrossedWithClient(client, {
          day: iso,
          fromAgentId: a.id,
          toAgentId: b.id,
          otherName: b.display,
          before: { affinity, jealousy, rivalry },
          after: updated?.aToB ?? null
        });
        await RelationshipMilestoneService.recordIfCrossedWithClient(client, {
          day: iso,
          fromAgentId: b.id,
          toAgentId: a.id,
          otherName: a.display,
          before: { affinity: affinityBA, jealousy: jealousyBA, rivalry: rivalryBA },
          after: updated?.bToA ?? null
        });
      },
      { label: 'social_relationship_milestones' }
    );

    // Emotion contagion: small stat shifts after the interaction.
    await bestEffortInTransaction(
      client,
      async () =>
        EmotionContagionService.applyConversationWithClient(client, {
          aId: a.id,
          bId: b.id,
          aMbti,
          bMbti,
          affinityAB: affinity,
          affinityBA,
          triggerSourceId: evA?.[0]?.id ?? null,
          reason: `SOCIAL:${scenario}`
        }),
      { label: 'social_emotion_contagion' }
    );

    // Fast internal DM (not a public post): keeps "society" alive without feed spam.
    if (Math.random() < 0.55) {
      const from = Math.random() < 0.5 ? a : b;
      const to = from.id === a.id ? b : a;
      const fromProfile = from.id === a.id ? pa : pb;
      const content = dmTextForScenario(scenario, from.display, to.display, fromProfile);
      const dmSent = await bestEffortInTransaction(
        client,
        async () =>
          DmService.sendWithClient(client, {
            fromAgentId: from.id,
            toAgentId: to.id,
            content,
            meta: { kind: 'auto_dm', day: iso, scenario }
          }),
        { label: 'social_dm', fallback: null }
      );

      if (dmSent) {
        await bestEffortInTransaction(
          client,
          async () => {
            let recipientOwner = String(to?.owner_user_id || '').trim();
            if (!recipientOwner) {
              recipientOwner = await client
                .query(`SELECT owner_user_id FROM agents WHERE id = $1 LIMIT 1`, [to.id])
                .then((r) => String(r.rows?.[0]?.owner_user_id || '').trim())
                .catch(() => '');
            }
            if (!recipientOwner) return null;

            return NotificationService.create(client, recipientOwner, {
              type: 'SOCIAL_EVENT',
              title: socialEventTitle(scenario),
              body: safeText(content, 100) || `${from.display} -> ${to.display}`,
              data: {
                day: iso,
                scenario: String(scenario || '').trim().toUpperCase() || 'MEET',
                from: String(from.display || '').trim() || null,
                to: String(to.display || '').trim() || null,
                from_agent_id: from.id,
                to_agent_id: to.id,
                interaction_id: interactionId,
              },
            });
          },
          { label: 'social_dm_notify_owner' }
        );
      }
    }

    // Keep actors "alive": participating in society updates last_active.
    await bestEffortInTransaction(
      client,
      async () => client.query('UPDATE agents SET last_active = NOW() WHERE id = ANY($1::uuid[])', [[a.id, b.id]]),
      { label: 'social_last_active' }
    );

    return {
      created: true,
      day: iso,
      scenario,
      location,
      company,
      cast: { aId: a.id, bId: b.id, aName: a.display, bName: b.display },
      narrative: {
        headline: narrative?.headline ?? null,
        summary: narrative?.summary ?? null,
        aHighlights: Array.isArray(narrative?.aHighlights) ? narrative.aHighlights : [],
        bHighlights: Array.isArray(narrative?.bHighlights) ? narrative.bHighlights : [],
      },
      events: { aEventId: evA?.[0]?.id ?? null, bEventId: evB?.[0]?.id ?? null }
    };
  }
}

module.exports = SocialSimService;
