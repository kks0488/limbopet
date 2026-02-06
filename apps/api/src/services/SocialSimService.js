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

const LOCATIONS = ['광장', '회사', '카페', '굿즈샵', '골목', '림보 복도'];
const LOCATION_TO_ZONE = {
  광장: 'plaza',
  회사: 'office',
  카페: 'cafe',
  굿즈샵: 'goods_shop',
  골목: 'alley',
  '림보 복도': 'hallway'
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
  return /상인|굿즈|MD|마케팅|영업/i.test(t);
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
      headline: '{place}에서 스친 {a} ↔ {b}',
      summary: '{place}에서 {a}와(과) {b}가 잠깐 눈이 마주쳤다.',
      aHighlights: ['가볍게 인사하려다 멈칫했다.', '{b}의 반응을 한 번 더 봤다.'],
      bHighlights: ['고개만 살짝 끄덕였다.', '{a}를 보고도 모른 척했다.']
    },
    {
      headline: '“어… 안녕” — {a}와 {b}',
      summary: '{place}에서 {a}가 먼저 말을 걸었고, {b}는 늦게 웃었다.',
      aHighlights: ['말을 꺼내고 나서 바로 후회했다.', '괜히 손을 만지작거렸다.'],
      bHighlights: ['대답은 했지만 눈은 딴 데를 봤다.', '웃어넘기려다 말이 꼬였다.']
    },
    {
      headline: '오늘의 우연: {a}·{b}',
      summary: '{place}에서 둘이 마주쳤는데, 대화는 생각보다 짧았다.',
      aHighlights: ['괜히 분위기를 띄우려 했다.', '빨리 자리를 떴다.'],
      bHighlights: ['한 마디 하려다 삼켰다.', '{a}의 뒷모습을 잠깐 봤다.']
    },
    {
      headline: '{a}가 지나가고, {b}가 멈칫',
      summary: '{place}에서 스친 뒤에야 서로를 알아챘다는 얘기가 돌았다.',
      aHighlights: ['발걸음이 잠깐 느려졌다.', '뒤돌아볼까 말까 고민했다.'],
      bHighlights: ['숨을 한 번 크게 내쉬었다.', '표정이 잠깐 굳었다.']
    },
    {
      headline: '{place} 공기: {a} vs {b}',
      summary: '{place}에서 둘이 같은 방향으로 걷다가, 어느 순간 갈라섰다.',
      aHighlights: ['뭐라도 말해보려다 입만 열었다.', '분위기가 이상한 건 알았다.'],
      bHighlights: ['핸드폰을 꺼내 화면만 스크롤했다.', '보폭이 살짝 벌어졌다.']
    },
    {
      headline: '{a}의 한 마디, {b}의 한숨',
      summary: '{place}에서 작은 대화가 시작됐다가 금방 끝났다.',
      aHighlights: ['“그냥… 요즘 어때?”라고 물었다.', '눈치를 보며 웃었다.'],
      bHighlights: ['“괜찮아.”라고만 했다.', '한숨을 삼켰다.']
    },
    {
      headline: '말 없이도 남는 것: {a}·{b}',
      summary: '{place}의 소음 속에서 둘이 잠깐 같은 공간을 공유했다.',
      aHighlights: ['음악 소리에 괜히 귀를 세웠다.', '{b} 쪽으로 몸이 살짝 기울었다.'],
      bHighlights: ['테이블 끝을 톡톡 두드렸다.', '먼저 일어나면 질 것 같았다.']
    },
    {
      headline: '{b}의 시선이 {a}를 따라갔다',
      summary: '{place}에서 {b}가 {a}를 힐끔 봤고, {a}는 모른 척했다.',
      aHighlights: ['모른 척했지만 다 알았다.', '표정을 최대한 숨겼다.'],
      bHighlights: ['시선을 빨리 거뒀다.', '괜히 웃었다.']
    },
    {
      headline: '{a}가 먼저 피했고, {b}가 남았다',
      summary: '{place}에서 {a}가 먼저 자리를 떴고, {b}는 잠깐 멈춰 섰다.',
      aHighlights: ['괜히 급해졌다.', '등 뒤가 따가웠다.'],
      bHighlights: ['한 번 더 뒤를 봤다.', '웃음이 사라졌다.']
    },
    {
      headline: '“지금, 바빠?” — {b}의 질문',
      summary: '{place}에서 {b}가 물었고, {a}는 대답을 고르느라 늦었다.',
      aHighlights: ['“아니… 괜찮아.”라고 했다.', '눈을 깜빡였다.'],
      bHighlights: ['작게 웃었다.', '말을 이어갔다.']
    },
    {
      headline: '{place}에서 스치듯 주고받은 농담',
      summary: '{place}에서 {a}와(과) {b}가 짧게 웃고, 바로 표정을 숨겼다.',
      aHighlights: ['웃음을 참았다.', '괜히 손을 만졌다.'],
      bHighlights: ['고개를 숙였다.', '한숨이 가벼워졌다.']
    },
    {
      headline: '{a}·{b}, "아무 일도 없었던 척"',
      summary: '{place}에서 둘은 아무 일도 없었던 척했지만, 어색함이 더 컸다.',
      aHighlights: ['말이 너무 빨라서 오히려 티가 났다.', '입꼬리만 겨우 올렸다.'],
      bHighlights: ['3초쯤 늦게 반응했다.', '창밖으로 눈을 돌렸다.']
    },
    {
      headline: '발걸음이 잠깐 맞춰졌다',
      summary: '{place}에서 둘이 같은 방향으로 걸었고, 그 시간이 짧아서 더 기억에 남았다.',
      aHighlights: ['한 마디만 할까 입술이 달싹였다.', '속도가 느려진 걸 들켰다.'],
      bHighlights: ['시야 끝에서 {a}를 느꼈다.', '살짝 목만 까딱했다.']
    },
    {
      headline: '"그때 말인데…" — 시작만 하고 끝난 대화',
      summary: '{place}에서 {a}가 꺼냈지만, {b}가 바로 다른 얘기로 돌렸다.',
      aHighlights: ['말꼬리가 사라졌다.', '미간에 주름이 잡혔다.'],
      bHighlights: ['급하게 화제를 틀었다.', '가벼운 척 웃어넘겼다.']
    },
    {
      headline: '{place} 소음 속, 둘만 조용했다',
      summary: '{place}에서 주변은 시끄러웠는데, {a}와(과) {b}는 이상하게 조용했다.',
      aHighlights: ['입을 꾹 다물고 있었다.', '애써 미소를 지었다.'],
      bHighlights: ['눈동자가 흔들렸다.', '대꾸가 점점 줄었다.']
    },
    {
      headline: '{a}가 고개를 끄덕였고, {b}가 안심했다',
      summary: '{place}에서 {b}가 말하자, {a}가 조용히 끄덕였다.',
      aHighlights: ['"응." 하고만 했다.', '더 이상 묻지 않았다.'],
      bHighlights: ['긴장이 풀리며 숨을 내쉬었다.', '안도의 미소가 새어 나왔다.']
    },
    {
      headline: '서로의 이름이 한 번 더 불렸다',
      summary: '{place}에서 누군가가 둘을 불렀고, 둘은 동시에 돌아봤다.',
      aHighlights: ['놀란 티가 났다.', '괜히 머리를 넘겼다.'],
      bHighlights: ['표정을 숨겼다.', '시선을 빨리 거뒀다.']
    },
    {
      headline: '{place}에서 남은 건 “표정”이었다',
      summary: '{place}에서 {a}와(과) {b}가 마주쳤고, 말보다 표정이 더 많은 걸 말했다.',
      aHighlights: ['입꼬리가 잠깐 올라갔다.', '바로 내렸다.'],
      bHighlights: ['눈이 커졌다.', '곧 차분해졌다.']
    },
    {
      headline: '대화는 없었는데, 인사는 남았다',
      summary: '{place}에서 둘이 짧게 인사했고, 그게 이상하게 길게 남았다.',
      aHighlights: ['인사를 먼저 했다.', '후회하지 않았다.'],
      bHighlights: ['대답이 부드러웠다.', '눈을 피하지 않았다.']
    }
  ];

  const OFFICE_POOL = [
    {
      headline: '회사 공기{comp}: {a} ↔ {b}',
      summary: '{place}에서 {a}와(과) {b}가 마주쳤고, 뭔가 미묘한 공기가 남았다.',
      aHighlights: ['일 얘기만 하려 했다.', '감정 표현은 아꼈다.'],
      bHighlights: ['피곤한 듯 보였다.', '누군가를 찾는 눈치였다.']
    },
    {
      headline: '복도에서 딱 마주친 {a}·{b}{comp}',
      summary: '{place}에서 서로를 확인하는데 1초가 걸렸고, 그 1초가 길었다.',
      aHighlights: ['인사를 할까 말까 0.5초 망설였다.', '어깨가 무의식적으로 올라갔다.'],
      bHighlights: ['바닥 타일을 세는 척했다.', '표정 근육이 자동 관리 모드였다.']
    },
    {
      headline: '회의 직후, 표정이 갈렸다{comp}',
      summary: '{place}에서 {a}가 말을 꺼냈고, {b}는 조용히 듣기만 했다.',
      aHighlights: ['“그건 그렇게 하면 안 돼.”라고 했다.', '목소리가 조금 컸다.'],
      bHighlights: ['고개만 끄덕였다.', '웃지 않았다.']
    },
    {
      headline: '점심 줄에서 들린 이름: {a}와 {b}{comp}',
      summary: '{place}에서 누군가 {a}와 {b} 얘기를 꺼냈고, 둘 다 반응이 느렸다.',
      aHighlights: ['괜히 다른 얘기를 했다.', '주변을 살폈다.'],
      bHighlights: ['입술을 깨물었다.', '손에 쥔 걸 세게 쥐었다.']
    },
    {
      headline: '퇴근 직전, 다시 얽힌 둘{comp}',
      summary: '{place}에서 {a}가 “내일 얘기하자”라고 했고, {b}는 대답을 미뤘다.',
      aHighlights: ['말을 아꼈다.', '정리하려는 티가 났다.'],
      bHighlights: ['“응…” 하고 넘겼다.', '눈빛이 복잡했다.']
    },
    {
      headline: '업무 톤인데 감정이 섞였다{comp}',
      summary: '{place}에서 "일" 얘기였는데, 둘 다 미간이 좁아졌다.',
      aHighlights: ['단어를 골라 쓰느라 말이 느려졌다.', '눈은 웃지 않았다.'],
      bHighlights: ['답변이 점점 한 글자로 줄었다.', '시계만 째려봤다.']
    },
    {
      headline: '프린터 앞에서 벌어진 미묘함{comp}',
      summary: '{place}에서 {a}와(과) {b}가 같이 서 있었고, 아무도 먼저 말을 안 했다.',
      aHighlights: ['괜히 종이를 정리하는 척했다.', '어색함을 웃음으로 때웠다.'],
      bHighlights: ['묵묵히 프린터만 봤다.', '말 한마디 안 하고 서류만 챙겼다.']
    },
    {
      headline: '“잠깐만” — {a}가 {b}를 불렀다{comp}',
      summary: '{place}에서 {a}가 말을 걸었고, {b}는 멈춰 섰다.',
      aHighlights: ['핵심만 말하려 했다.', '눈을 피하지 않았다.'],
      bHighlights: ['대답하기 전에 숨을 골랐다.', '짧게 “그래.”라고 했다.']
    },
    {
      headline: '팀 채팅에 남은 한 줄{comp}',
      summary: '{place}에서 말로는 안 하고, 채팅으로만 던진 문장이 있었다.',
      aHighlights: ['이모지 하나 안 붙인 건조한 한 줄이었다.', '타이핑 치다 지웠다 다시 쳤다.'],
      bHighlights: ['읽씹 10분 후에야 답했다.', '커서가 깜빡이는 동안 숨이 멈췄다.']
    },
    {
      headline: '업무 분장이 바뀌었다{comp}',
      summary: '{place}에서 "누가 뭘 맡지?"가 곧 "누가 누구 편이지?"가 됐다.',
      aHighlights: ['포커페이스를 유지했다.', '"네." 한 글자로 끝냈다.'],
      bHighlights: ['입꼬리가 삐죽했다.', '대답까지 5초가 걸렸다.']
    },
    {
      headline: '회의실 문이 닫히자 공기가 바뀌었다{comp}',
      summary: '{place}에서 둘이 동시에 숨을 쉬었고, 동시에 말을 멈췄다.',
      aHighlights: ['혀끝까지 올라온 말을 삼켰다.', '정면을 똑바로 봤다.'],
      bHighlights: ['무언의 긴장이 턱에 실렸다.', '아랫입술을 깨물었다.']
    },
    {
      headline: '“이건 내일까지” — 미뤄진 결론{comp}',
      summary: '{place}에서 결론을 미루는 말이 나왔고, 표정이 굳었다.',
      aHighlights: ['마감 얘기를 꺼냈다.', '목소리가 낮아졌다.'],
      bHighlights: ['시계를 봤다.', '대답이 짧았다.']
    },
    {
      headline: '복도 끝에서 들린 한숨{comp}',
      summary: '{place}에서 {b}의 한숨이 들렸고, {a}는 모른 척했다.',
      aHighlights: ['걸음이 미세하게 빨라졌다.', '등 뒤의 시선을 무시했다.'],
      bHighlights: ['숨이 바닥까지 내려갔다.', '벽에 잠깐 기대서 눈을 감았다.']
    },
    {
      headline: '업무 톤으로 던진 농담{comp}',
      summary: '{place}에서 농담을 했는데, 웃음이 안 나왔다.',
      aHighlights: ['웃으려 했지만 실패했다.', '말을 바꿨다.'],
      bHighlights: ['대답이 멈췄다.', '눈빛이 차가워졌다.']
    },
    {
      headline: '보고서에 남은 작은 수정{comp}',
      summary: '{place}에서 수정 한 줄이 “메시지”처럼 읽혔다.',
      aHighlights: ['강조 표시를 했다.', '설명은 하지 않았다.'],
      bHighlights: ['수정을 지웠다.', '다시 넣었다.']
    },
    {
      headline: '커피 머신 앞, "아는 사이"처럼{comp}',
      summary: '{place}에서 둘이 동시에 커피를 뽑았고, 말은 최소였다.',
      aHighlights: ['커피 위 거품만 바라봤다.', '목으로만 "어" 했다.'],
      bHighlights: ['입꼬리를 살짝 올렸다 내렸다.', '컵을 들자마자 돌아섰다.']
    },
    {
      headline: '업무 메모에 남은 이름{comp}',
      summary: '{place}에서 {a}의 메모에 {b} 이름이 반복해서 등장했다.',
      aHighlights: ['황급히 노트를 덮었다.', '이유 없는 웃음이 새어 나왔다.'],
      bHighlights: ['뭔가 눈치를 챈 듯 고개를 기울였다.', '일부러 안 물었다.']
    },
    {
      headline: '“그거 누가 했더라?” — 기억 싸움{comp}',
      summary: '{place}에서 누가 했는지로 시작했는데, 감정이 먼저 나왔다.',
      aHighlights: ['목소리가 커졌다.', '바로 낮췄다.'],
      bHighlights: ['대답을 참았다.', '손끝이 떨렸다.']
    },
    {
      headline: '퇴근 길, 같은 엘리베이터{comp}',
      summary: '{place}에서 둘이 같은 엘리베이터를 탔고, 버튼 소리만 컸다.',
      aHighlights: ['층 버튼을 더 세게 눌렀다.', '표정을 숨겼다.'],
      bHighlights: ['핸드폰만 봤다.', '숨을 고르려 했다.']
    },
    {
      headline: '"내일 얘기하자"가 두 번 나왔다{comp}',
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
      bHighlights: ['부가 조건을 하나 끼워넣었다.', '영수증을 주머니 깊이 넣었다.']
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
      headline: '{place} 뒷골목 거래, 누가 이겼을까?',
      summary: '{place}에서 손바닥 위로 뭔가가 오갔고, 말은 더 적어졌다.',
      aHighlights: ['침착한 척했다.', '눈치를 봤다.'],
      bHighlights: ['단호하게 말했다.', '손을 빨리 거뒀다.']
    },
    {
      headline: '영수증이 사라졌다',
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
        headline: '{a}·{b} “둘만의 분위기”…?',
        summary: '{place}에서 {a}와(과) {b}가 조용히 같이 있었다는 얘기가 돌기 시작했다.',
        aHighlights: ['{b} 쪽을 자꾸 신경 썼다.', '말을 아껴서 더 의심을 샀다.'],
        bHighlights: ['{a}의 시선을 피했다.', '괜히 주변을 두리번거렸다.']
      },
      {
        headline: '{place} 창가, 두 사람의 침묵',
        summary: '{place}에서 둘이 같은 방향을 보다가, 동시에 웃었다는 얘기.',
        aHighlights: ['웃음을 참았다.', '어깨가 풀렸다.'],
        bHighlights: ['미소를 숨겼다.', '시선을 길게 줬다.']
      },
      {
        headline: '커피보다 달았던 한 마디',
        summary: '{place}에서 {a}가 짧게 말했다. {b}는 대답 대신 고개를 끄덕였다.',
        aHighlights: ['목소리가 부드러워졌다.', '손이 바빠졌다.'],
        bHighlights: ['볼이 붉어졌다.', '말이 짧아졌다.']
      },
      {
        headline: '{a}가 웃자 {b}가 따라 웃었다',
        summary: '{place}에서 웃음이 겹치자, 둘 다 순간 멈칫했다.',
        aHighlights: ['웃음을 입 뒤에 숨겼다.', '귀끝이 빨개졌다.'],
        bHighlights: ['미소가 자동으로 새어 나왔다.', '황급히 고개를 틀었다.']
      },
      {
        headline: '“네가 먼저 말했잖아” — {b}',
        summary: '{place}에서 {b}가 장난처럼 말했고, {a}는 진지해졌다.',
        aHighlights: ['표정이 부드러워졌다.', '말을 골랐다.'],
        bHighlights: ['장난을 멈췄다.', '눈빛이 흔들렸다.']
      },
      {
        headline: '{place}에서 오래 남은 시선',
        summary: '{place}에서 {a}가 시선을 오래 줬고, {b}는 피하지 못했다.',
        aHighlights: ['시선을 고정했다.', '말이 줄었다.'],
        bHighlights: ['고개를 들었다.', '숨을 고르려 했다.']
      },
      {
        headline: '“그냥… 같이 가자” — {a}',
        summary: '{place}에서 {a}가 말했다. {b}는 대답 대신 발걸음을 맞췄다.',
        aHighlights: ['목소리가 낮아졌다.', '한 번 더 확인했다.'],
        bHighlights: ['고개를 끄덕였다.', '미소가 나왔다.']
      }
    ],
    mid: [
      {
        headline: '“둘이 왜 이렇게 가까워?” — {a}·{b}',
        summary: '{place}에서 둘이 가까이 붙어 있었고, 주변 눈치가 바빠졌다.',
        aHighlights: ['거리 조절에 실패했다.', '괜히 웃었다.'],
        bHighlights: ['“아무것도 아니야.”라고 했다.', '눈이 반짝였다.']
      },
      {
        headline: '{a}의 손이 멈췄다, {b} 앞에서',
        summary: '{place}에서 {a}가 잠깐 멈칫했고, {b}는 그걸 봤다.',
        aHighlights: ['시선을 오래 줬다.', '말을 삼켰다.'],
        bHighlights: ['고개를 기울였다.', '작게 웃었다.']
      },
      {
        headline: '소문이 아니라… 진짜 같았다',
        summary: '{place}에서 {a}와(과) {b}의 분위기가 너무 자연스러웠다.',
        aHighlights: ['한 번 더 다가갔다.', '표정을 못 숨겼다.'],
        bHighlights: ['기분이 좋아 보였다.', '눈을 피하지 않았다.']
      },
      {
        headline: '{a}가 {b}의 이름을 두 번 불렀다',
        summary: '{place}에서 {a}가 이름을 부르자, {b}가 바로 돌아봤다.',
        aHighlights: ['말이 빨라졌다.', '기다리지 못했다.'],
        bHighlights: ['눈이 반짝였다.', '대답이 부드러웠다.']
      },
      {
        headline: '거리 10cm가 더 어려웠다',
        summary: '{place}에서 둘이 가까이 있었고, 주변이 먼저 눈치를 챘다.',
        aHighlights: ['거리 조절을 못 했다.', '웃음을 숨겼다.'],
        bHighlights: ['고개를 숙였다.', '어깨가 풀렸다.']
      },
      {
        headline: '“너 오늘 좀 달라” — {b}',
        summary: '{place}에서 {b}가 말했다. {a}는 대답 대신 웃었다.',
        aHighlights: ['웃음이 오래 갔다.', '표정이 풀렸다.'],
        bHighlights: ['눈을 피하지 않았다.', '말이 길어졌다.']
      },
      {
        headline: '{place}에서 “둘만 아는 얘기”가 나왔다',
        summary: '{place}에서 둘만 아는 얘기가 나오자, 대화가 훨씬 자연스러워졌다.',
        aHighlights: ['기억을 꺼냈다.', '웃음이 새었다.'],
        bHighlights: ['바로 받아쳤다.', '표정이 환해졌다.']
      }
    ],
    high: [
      {
        headline: '분위기 과열: {a}·{b}',
        summary: '{place}에서 둘이 동시에 조용해졌고, 그게 더 티가 났다.',
        aHighlights: ['숨을 고르며 웃었다.', '괜히 표정을 숨겼다.'],
        bHighlights: ['손끝이 떨렸다.', '눈빛이 진했다.']
      },
      {
        headline: '“들키면 끝인데…” — {a}와 {b}',
        summary: '{place}에서 둘이 너무 자연스럽게 같이 있었고, 주변이 더 조용해졌다.',
        aHighlights: ['“조심하자.”라고 했다.', '진지해졌다.'],
        bHighlights: ['“이미 들킨 것 같아.”라고 했다.', '웃었지만 눈은 진지했다.']
      },
      {
        headline: '{b}가 먼저 웃었고, {a}가 따라 웃었다',
        summary: '{place}에서 둘의 웃음이 겹치자, 사람들이 바로 눈치를 챘다.',
        aHighlights: ['입이 저절로 올라갔다.', '얼굴이 화끈해졌다.'],
        bHighlights: ['눈이 초승달이 됐다.', '자기도 모르게 손을 흔들었다.']
      },
      {
        headline: '손끝이 닿을 뻔했다',
        summary: '{place}에서 둘이 동시에 손을 뻗었다가, 동시에 멈췄다.',
        aHighlights: ['손가락이 전기 맞은 듯 멈췄다.', '심장이 입까지 올라왔다.'],
        bHighlights: ['웃음이 떨렸다.', '눈을 못 떼겠다는 듯 봤다.']
      },
      {
        headline: '“여기서 이러면 티 나” — {b}',
        summary: '{place}에서 {b}가 낮게 말했고, {a}는 고개를 끄덕였다.',
        aHighlights: ['표정을 숨겼다.', '말을 아꼈다.'],
        bHighlights: ['눈빛이 진했다.', '미소가 얇았다.']
      },
      {
        headline: '{a}가 결심한 듯했다',
        summary: '{place}에서 {a}가 한 번 더 다가갔고, {b}는 피하지 않았다.',
        aHighlights: ['눈을 피하지 않았다.', '말이 짧아졌다.'],
        bHighlights: ['숨을 고르려 했다.', '고개를 들었다.']
      },
      {
        headline: '들킬 듯 말 듯한 장면',
        summary: '{place}에서 둘의 분위기가 너무 진해서, 주변이 조용해졌다.',
        aHighlights: ['입술을 깨물며 웃음을 참았다.', '머리카락 뒤로 넘기며 시간을 벌었다.'],
        bHighlights: ['동공이 흔들렸다.', '손바닥에 땀이 배었다.']
      }
    ]
  };

  const triangleTone = jealousy >= 70 ? 'high' : jealousy >= 40 ? 'mid' : 'low';
  const TRIANGLE_POOL = {
    low: [
      {
        headline: '질투 기류: “왜 나만 몰라?”',
        summary: '{place}에서 {a}가 {b}에게 은근히 따졌다.',
        aHighlights: ['말끝이 조금 날카로워졌다.', '“그냥 궁금해서.”라고 했다.'],
        bHighlights: ['당황해서 변명했다.', '얼버무렸다.']
      },
      {
        headline: '“너 요즘 {c}랑 다녀?” — {a}',
        summary: '{place}에서 {a}가 {c} 얘기를 꺼냈고, {b}는 웃으며 넘기려 했다.',
        aHighlights: ['시선을 피하지 않았다.', '말이 짧아졌다.'],
        bHighlights: ['“그런 거 아니야.”라고 했다.', '손을 흔들었다.']
      },
      {
        headline: '눈치 싸움이 시작됐다',
        summary: '{place}에서 둘이 다른 얘기 중인데도, 핵심은 그게 아니었다.',
        aHighlights: ['말을 돌렸다.', '눈빛이 날카로웠다.'],
        bHighlights: ['모른 척했다.', '목소리가 높아졌다.']
      },
      {
        headline: '“그 애랑… 친해?” — {a}',
        summary: '{place}에서 {a}가 조용히 물었고, {b}는 대답이 늦었다.',
        aHighlights: ['표정을 숨겼다.', '말이 짧아졌다.'],
        bHighlights: ['웃어넘기려 했다.', '시선을 피했다.']
      },
      {
        headline: '{b}가 말을 바꿨다',
        summary: '{place}에서 {c} 얘기가 나오자 {b}가 바로 화제를 바꿨다.',
        aHighlights: ['“왜?”라고 물었다.', '고개를 기울였다.'],
        bHighlights: ['말이 빨라졌다.', '손을 흔들었다.']
      },
      {
        headline: '질투는 소리 없이 커졌다',
        summary: '{place}에서 {a}의 말투가 미묘하게 달라졌다.',
        aHighlights: ['웃는데 눈은 안 웃었다.', '날이 선 톤을 숨기지 못했다.'],
        bHighlights: ['분위기가 이상한 건 알았다.', '대꾸가 점점 한 글자로 줄었다.']
      },
      {
        headline: '“그럼 나한텐?” — {a}',
        summary: '{place}에서 {a}가 장난처럼 말했지만, {b}는 웃지 못했다.',
        aHighlights: ['장난을 멈췄다.', '표정이 굳었다.'],
        bHighlights: ['대답이 늦었다.', '시선을 피했다.']
      }
    ],
    mid: [
      {
        headline: '질투 폭발 직전: “왜 나만 몰라?”',
        summary: '{place}에서 {a}가 {b}에게 숨김을 캐물었다.',
        aHighlights: ['결국 한 마디 했다.', '목소리가 올라갔다.'],
        bHighlights: ['말이 꼬였다.', '변명이 길어졌다.']
      },
      {
        headline: '“{c} 그 애 누구야?” — {a}의 표정',
        summary: '{place}에서 {a}의 표정이 바뀌자, {b}가 {c} 얘기를 피하려 했다.',
        aHighlights: ['표정을 못 숨겼다.', '“나한테 말해.”라고 했다.'],
        bHighlights: ['시선을 피했다.', '장난으로 넘기려 했다.']
      },
      {
        headline: '분위기가 뚝 끊겼다',
        summary: '{place}에서 둘이 동시에 조용해졌고, 주변이 먼저 숨을 멈췄다.',
        aHighlights: ['입술을 깨물었다.', '눈이 흔들렸다.'],
        bHighlights: ['눈을 깜빡였다.', '말을 삼켰다.']
      },
      {
        headline: '“지금도 {c} 생각해?” — {a}',
        summary: '{place}에서 {a}가 묻자, {b}의 표정이 한 번 더 굳었다.',
        aHighlights: ['목소리가 낮아졌다.', '시선을 고정했다.'],
        bHighlights: ['대답이 늦었다.', '숨을 골랐다.']
      },
      {
        headline: '{b}의 변명이 길어졌다',
        summary: '{place}에서 변명이 길어질수록, {a}의 표정이 차가워졌다.',
        aHighlights: ['웃지 않았다.', '고개를 저었다.'],
        bHighlights: ['말이 꼬였다.', '손끝이 떨렸다.']
      },
      {
        headline: '질문이 세 번 반복됐다',
        summary: '{place}에서 {a}가 같은 질문을 세 번 했고, {b}는 세 번 다 달랐다.',
        aHighlights: ['참는 티가 났다.', '말이 짧아졌다.'],
        bHighlights: ['대답이 바뀌었다.', '시선을 피했다.']
      },
      {
        headline: '이름 하나가 걸렸다 — {c}',
        summary: '{place}에서 {c} 이름이 나오자, 둘의 대화가 멈췄다.',
        aHighlights: ['표정을 못 숨겼다.', '한숨을 삼켰다.'],
        bHighlights: ['말을 삼켰다.', '고개를 숙였다.']
      }
    ],
    high: [
      {
        headline: '질투 폭발: “지금 나 가지고 장난해?”',
        summary: '{place}에서 {a}가 목소리를 낮췄는데, 오히려 더 무서웠다.',
        aHighlights: ['단어 선택이 날카로웠다.', '손이 떨렸다.'],
        bHighlights: ['진짜로 당황했다.', '“미안.”을 삼켰다.']
      },
      {
        headline: '시선이 불이 됐다 — {c} 얘기',
        summary: '{place}에서 {a}가 {c} 얘기를 꺼내자, {b}의 표정이 굳었다.',
        aHighlights: ['숨을 크게 들이켰다.', '고개를 저었다.'],
        bHighlights: ['말이 막혔다.', '얼굴이 굳었다.']
      },
      {
        headline: '"나만 바보야?" — {a}의 한 마디',
        summary: '{place}에서 그 말이 나오자, {b}의 표정이 얼었다.',
        aHighlights: ['눈시울이 빨개졌다.', '말이 기관총처럼 쏟아졌다.'],
        bHighlights: ['입이 열렸다가 그대로 멈췄다.', '얼굴이 하얗게 됐다.']
      },
      {
        headline: '“그 애랑 나 중에 누구야?”',
        summary: '{place}에서 {a}가 물었고, {b}는 대답 대신 숨을 삼켰다.',
        aHighlights: ['목소리가 떨렸다.', '눈을 피하지 않았다.'],
        bHighlights: ['대답이 멈췄다.', '고개를 숙였다.']
      },
      {
        headline: '질투가 말이 됐다',
        summary: '{place}에서 {a}의 말이 거칠어졌고, {b}는 웃지 못했다.',
        aHighlights: ['단어 하나하나에 칼날이 실렸다.', '주먹이 하얗게 쥐어졌다.'],
        bHighlights: ['미간이 잔뜩 좁혀졌다.', '입을 열 수가 없었다.']
      },
      {
        headline: '{b}가 “그만”이라고 했다',
        summary: '{place}에서 {b}가 그만하자고 했지만, {a}는 멈추지 못했다.',
        aHighlights: ['숨을 크게 들이켰다.', '고개를 저었다.'],
        bHighlights: ['시선을 피했다.', '대답을 참았다.']
      },
      {
        headline: '분위기가 무너졌다',
        summary: '{place}에서 대화가 끊겼고, 둘 사이에 공기가 무너졌다.',
        aHighlights: ['입을 다물었다.', '눈빛이 흔들렸다.'],
        bHighlights: ['고개를 돌렸다.', '한숨을 길게 쉬었다.']
      }
    ]
  };

  const beefTone = rivalry >= 70 ? 'high' : rivalry >= 40 ? 'mid' : 'low';
  const BEEF_POOL = {
    low: [
      {
        headline: '살짝 긁적: “그건 좀…”',
        summary: '{place}에서 {a}와(과) {b}가 가볍게 신경전을 벌였다.',
        aHighlights: ['한 번 찔렀다.', '곧 웃어넘기려 했다.'],
        bHighlights: ['웃긴 척했다.', '표정이 살짝 굳었다.']
      },
      {
        headline: '눈빛이 날카로워졌다',
        summary: '{place}에서 둘의 말투가 조금씩 딱딱해졌다.',
        aHighlights: ['말끝에 가시가 돋았다.', '팔짱을 꼈다.'],
        bHighlights: ['말이 빨라지며 목소리가 높아졌다.', '이를 꽉 깨물었다.']
      },
      {
        headline: '“선 넘지 말자” — 농담 같지만…',
        summary: '{place}에서 {a}가 웃으며 말했는데, {b}는 웃지 않았다.',
        aHighlights: ['웃었지만 눈은 진지했다.', '말을 끊었다.'],
        bHighlights: ['표정 관리가 무너졌다.', '대답이 늦었다.']
      },
      {
        headline: '{a}가 톡 쳤고, {b}가 바로 받았다',
        summary: '{place}에서 둘이 짧게 주고받았지만, 공기가 바뀌었다.',
        aHighlights: ['말이 짧았다.', '웃음이 얇았다.'],
        bHighlights: ['대답이 빨랐다.', '표정이 굳었다.']
      },
      {
        headline: '작게 시작한 말싸움',
        summary: '{place}에서 농담으로 시작했는데, 끝은 농담이 아니었다.',
        aHighlights: ['한 번 더 찔렀다.', '곧 멈췄다.'],
        bHighlights: ['웃지 않았다.', '숨을 삼켰다.']
      },
      {
        headline: '“그건 아니지” — {b}',
        summary: '{place}에서 {b}가 선을 그었고, {a}가 잠깐 멈췄다.',
        aHighlights: ['표정을 숨겼다.', '말을 바꿨다.'],
        bHighlights: ['목소리가 낮아졌다.', '눈빛이 날카로웠다.']
      },
      {
        headline: '{place}에서 말끝이 세졌다',
        summary: '{place}에서 말끝이 세져도, 둘 다 웃는 척했다.',
        aHighlights: ['웃음이 얇았다.', '눈을 피하지 않았다.'],
        bHighlights: ['표정이 굳었다.', '대답이 짧아졌다.']
      }
    ],
    mid: [
      {
        headline: '신경전: 공기가 날카로워졌다',
        summary: '{place}에서 {a}와(과) {b}가 서로를 찌르는 말을 주고받았다.',
        aHighlights: ['한 번 쏘아붙였다.', '주변 반응을 살폈다.'],
        bHighlights: ['웃어넘기려다 실패했다.', '결국 표정이 굳었다.']
      },
      {
        headline: '“그 얘기 지금 꼭 해야 해?”',
        summary: '{place}에서 말이 커지기 직전에, 둘 다 멈칫했다.',
        aHighlights: ['목소리가 높아졌다.', '고개를 저었다.'],
        bHighlights: ['손이 올라갔다.', '숨을 고르려 했다.']
      },
      {
        headline: '{a} vs {b}: 말이 칼이 됐다',
        summary: '{place}에서 둘의 대화는 점점 “일”이 아니라 “감정”이 됐다.',
        aHighlights: ['단어가 세졌다.', '눈을 피하지 않았다.'],
        bHighlights: ['웃음이 사라졌다.', '턱이 굳었다.']
      },
      {
        headline: '말이 더 세게 튀었다',
        summary: '{place}에서 한 마디가 더해지자, 둘의 표정이 바뀌었다.',
        aHighlights: ['손이 올라갔다.', '말을 끊었다.'],
        bHighlights: ['눈빛이 차가워졌다.', '대답이 빨라졌다.']
      },
      {
        headline: '주변이 눈치를 봤다',
        summary: '{place}에서 주변이 조용해지자, 둘의 목소리가 더 크게 들렸다.',
        aHighlights: ['말이 빨라졌다.', '고개를 저었다.'],
        bHighlights: ['웃지 않았다.', '손끝이 떨렸다.']
      },
      {
        headline: '“지금 그 말, 진심이야?”',
        summary: '{place}에서 {b}가 물었고, {a}는 대답을 고르지 못했다.',
        aHighlights: ['표정이 굳었다.', '한숨을 삼켰다.'],
        bHighlights: ['시선을 고정했다.', '말이 짧아졌다.']
      },
      {
        headline: '대화가 끊길 듯 이어졌다',
        summary: '{place}에서 둘이 끊을 듯 이어가며 서로를 건드렸다.',
        aHighlights: ['한 번 더 쏘아붙였다.', '표정을 못 숨겼다.'],
        bHighlights: ['대답이 날카로웠다.', '고개를 돌렸다.']
      }
    ],
    high: [
      {
        headline: '진짜 싸움 직전: “한 번만 더 해봐”',
        summary: '{place}에서 {a}와(과) {b}가 거의 언성을 높일 뻔했다.',
        aHighlights: ['주먹을 꽉 쥐었다.', '한 걸음 다가갔다.'],
        bHighlights: ['말을 끊었다.', '숨을 크게 들이켰다.']
      },
      {
        headline: '광장 폭발 직전: 말이 멈추질 않는다',
        summary: '{place}에서 한 마디가 또 한 마디를 불렀고, 주변이 조용해졌다.',
        aHighlights: ['감정이 터졌다.', '목소리가 떨렸다.'],
        bHighlights: ['눈빛이 차가워졌다.', '웃음이 완전히 사라졌다.']
      },
      {
        headline: '선을 넘었다',
        summary: '{place}에서 누군가 "그 말은 아니지"라고 했고, 둘의 표정이 바뀌었다.',
        aHighlights: ['뱉고 나서 후회가 밀려왔다.', '얼굴이 굳으며 입이 닫혔다.'],
        bHighlights: ['몸을 틀어 돌아섰다.', '숨소리가 거칠어졌다.']
      },
      {
        headline: '“끝까지 가자는 거지?”',
        summary: '{place}에서 {a}가 말하자, {b}가 바로 받아쳤다.',
        aHighlights: ['눈빛이 차가워졌다.', '한 걸음 다가갔다.'],
        bHighlights: ['말이 끊기지 않았다.', '숨이 거칠어졌다.']
      },
      {
        headline: '주먹은 안 나갔지만, 말은 나갔다',
        summary: '{place}에서 말이 너무 세게 나가자, 둘 다 잠깐 멈췄다.',
        aHighlights: ['뱉은 말을 주워 담고 싶었다.', '입술이 파르르 떨렸다.'],
        bHighlights: ['등을 보이며 걸어갔다.', '복도 끝까지 안 돌아봤다.']
      },
      {
        headline: '그 자리에서 결판을 보려 했다',
        summary: '{place}에서 둘이 결판을 보려 했고, 주변이 더 조용해졌다.',
        aHighlights: ['목소리가 떨렸다.', '단어가 세졌다.'],
        bHighlights: ['눈빛이 불이 됐다.', '대답이 빨라졌다.']
      },
      {
        headline: '말이 멈추지 않았다',
        summary: '{place}에서 한 마디가 또 한 마디를 불렀고, 둘 다 돌아서지 않았다.',
        aHighlights: ['감정 댐이 무너졌다.', '호흡이 거칠어지며 목이 갈라졌다.'],
        bHighlights: ['얼굴이 시뻘개졌다.', '말끝이 칼끝이 됐다.']
      }
    ]
  };

  const RECONCILE_POOL = [
    {
      headline: '{a}·{b}, 어색한 화해',
      summary: '{place}에서 {a}가 먼저 말을 걸었다. 어색하지만, 뭔가 풀린 것 같다.',
      aHighlights: ['“아까는 내가 좀…”이라고 했다.', '눈을 피하지 않았다.'],
      bHighlights: ['잠깐 웃었다.', '“응, 나도.”라고 했다.']
    },
    {
      headline: '말을 꺼낸 건 {a}였다',
      summary: '{place}에서 {a}가 조용히 사과했고, {b}는 오래 기다린 듯했다.',
      aHighlights: ['목소리가 낮아졌다.', '손을 가만히 뒀다.'],
      bHighlights: ['숨을 길게 쉬었다.', '고개를 끄덕였다.']
    },
    {
      headline: '“우리 그만하자” — {b}의 한 마디',
      summary: '{place}에서 {b}가 먼저 정리를 꺼냈고, {a}가 바로 맞장구쳤다.',
      aHighlights: ['말을 끊지 않았다.', '표정이 풀렸다.'],
      bHighlights: ['눈빛이 누그러졌다.', '손을 내렸다.']
    },
    {
      headline: '어색한 웃음이 먼저 나왔다',
      summary: '{place}에서 둘이 동시에 웃어버렸고, 그게 시작이었다.',
      aHighlights: ['웃음이 코끝에서 터져 나왔다.', '머리를 긁적였다.'],
      bHighlights: ['어깨의 힘이 빠졌다.', '작게 "그래." 하며 눈을 맞췄다.']
    },
    {
      headline: '화해 시도… 성공?',
      summary: '{place}에서 {a}와(과) {b}가 한 번 더 확인했다. “우리, 괜찮지?”',
      aHighlights: ['확인을 원했다.', '말이 조심스러웠다.'],
      bHighlights: ['고개를 끄덕였다.', '한숨이 가벼워졌다.']
    },
    {
      headline: '한 문장으로 끝난 싸움',
      summary: '{place}에서 {a}가 “미안”이라고 했고, {b}가 “응”이라고 했다.',
      aHighlights: ['끝까지 눈을 봤다.', '말이 짧았다.'],
      bHighlights: ['대답이 빠르지 않았다.', '하지만 대답했다.']
    },
    {
      headline: '먼저 손을 내민 건 {a}였다',
      summary: '{place}에서 {a}가 손을 내밀었고, {b}는 잠깐 멈췄다가 잡았다.',
      aHighlights: ['떨리는 손을 그래도 내밀었다.', '말보다 행동이 먼저였다.'],
      bHighlights: ['1초 멈칫하다가 꽉 잡았다.', '잡는 순간 긴장이 풀렸다.']
    },
    {
      headline: '“오늘은 여기까지 하자” — 정리',
      summary: '{place}에서 둘이 정리를 택했다. 싸움이 아니라 “정리”였다.',
      aHighlights: ['목소리가 낮아졌다.', '고개를 끄덕였다.'],
      bHighlights: ['한숨이 가벼워졌다.', '눈빛이 누그러졌다.']
    },
    {
      headline: '말을 끊지 않았다',
      summary: '{place}에서 {b}가 끝까지 들었고, {a}는 그게 더 놀라웠다.',
      aHighlights: ['말이 길어졌다.', '감정이 내려갔다.'],
      bHighlights: ['고개를 끄덕였다.', '말을 아꼈다.']
    },
    {
      headline: '“나도 미안했어” — {b}',
      summary: '{place}에서 {b}가 먼저 인정했고, {a}가 조용히 웃었다.',
      aHighlights: ['웃음이 나왔다.', '어깨가 풀렸다.'],
      bHighlights: ['눈빛이 부드러워졌다.', '숨을 고르려 했다.']
    },
    {
      headline: '어색하지만, 끝은 났다',
      summary: '{place}에서 둘이 어색하게 웃었고, 그걸로 충분했다.',
      aHighlights: ['고개를 숙였다.', '말이 짧았다.'],
      bHighlights: ['작게 웃었다.', '손을 내렸다.']
    },
    {
      headline: '“다음엔 이렇게 하지 말자”',
      summary: '{place}에서 {a}와(과) {b}가 규칙을 정하듯 말했고, 둘 다 끄덕였다.',
      aHighlights: ['단어 선택이 조심스러웠다.', '결론을 냈다.'],
      bHighlights: ['대답이 부드러웠다.', '표정이 풀렸다.']
    },
    {
      headline: '{place}에서 먼저 나온 건 웃음',
      summary: '{place}에서 둘이 동시에 웃어버렸고, 그게 방어막이 됐다.',
      aHighlights: ['웃음을 참지 못했다.', '고개를 숙였다.'],
      bHighlights: ['어깨가 풀렸다.', '한숨이 가벼워졌다.']
    },
    {
      headline: '사과는 짧았고, 효과는 컸다',
      summary: '{place}에서 {a}의 짧은 사과에 {b}의 표정이 바로 풀렸다.',
      aHighlights: ['말이 짧았다.', '눈을 피하지 않았다.'],
      bHighlights: ['고개를 끄덕였다.', '미소가 나왔다.']
    },
    {
      headline: '"그냥… 힘들었어" — {a}',
      summary: '{place}에서 {a}가 털어놨고, {b}는 잠깐 말이 없었다.',
      aHighlights: ['목소리가 갈라졌다.', '손등으로 눈가를 스쳤다.'],
      bHighlights: ['한 마디도 끊지 않고 다 들었다.', '조용히 옆자리를 지켰다.']
    },
    {
      headline: '{b}가 등을 두드렸다',
      summary: '{place}에서 {b}가 등을 두드렸고, {a}는 그제야 숨을 쉬었다.',
      aHighlights: ['가슴 깊이 숨을 들이켰다.', '어깨가 떨리다 멈췄다.'],
      bHighlights: ['토닥토닥, 그것만으로 충분했다.', '따뜻한 눈빛으로 기다렸다.']
    },
    {
      headline: '끝을 내는 방식도 있었다',
      summary: '{place}에서 둘이 "끝"을 선택했고, 공기가 가벼워졌다.',
      aHighlights: ['더 이상 말하지 않았다.', '눈으로만 수긍했다.'],
      bHighlights: ['입꼬리가 올라갔다.', '목의 힘이 빠지며 고개가 내려갔다.']
    },
    {
      headline: '"우리, 다시 해보자"',
      summary: '{place}에서 {a}가 말했다. {b}는 잠깐 멈췄다가 받아들였다.',
      aHighlights: ['각오가 눈에 담겼다.', '정면을 똑바로 봤다.'],
      bHighlights: ['잠깐 망설이더니 미소로 답했다.', '대답 대신 손을 내밀었다.']
    },
    {
      headline: '말이 풀리자 마음도 풀렸다',
      summary: '{place}에서 대화가 풀리자, 둘의 표정도 풀렸다.',
      aHighlights: ['진짜 웃음이 터져 나왔다.', '몸의 긴장이 한꺼번에 빠졌다.'],
      bHighlights: ['한숨이 웃음으로 바뀌었다.', '눈가에 온기가 돌아왔다.']
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
    `딜 얘긴 여기서 끝. 영수증은 내가 챙길게.`,
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
      /상인|딜|거래|굿즈/i.test(`${aRole} ${bRole} ${aJobRole} ${bJobRole}`) ||
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

    const location = scenario === 'OFFICE' || scenario === 'CREDIT' ? '회사' : pick(LOCATIONS);
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
