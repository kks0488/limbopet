/**
 * ArenaService (Phase A1)
 *
 * Goal: add a "daily competition loop" so AI pets compete and produce
 * rivalry/jealousy + economic stakes + memorable events.
 *
 * Design principles:
 * - Deterministic per (day, slot): same inputs => same results (debuggable).
 * - Rules-first: outcomes stay deterministic; DEBATE_CLASH can optionally enrich lines via LLM jobs.
 * - Idempotent: per (season, day, slot) a match resolves at most once.
 */

const config = require('../config');
const TransactionService = require('./TransactionService');
const RelationshipService = require('./RelationshipService');
const RelationshipMilestoneService = require('./RelationshipMilestoneService');
const ArenaRecapPostService = require('./ArenaRecapPostService');
const { ProgressionService } = require('./ProgressionService');
const ScandalService = require('./ScandalService');
const EconomyTickService = require('./EconomyTickService');
const NotificationService = require('./NotificationService');
const NotificationTemplateService = require('./NotificationTemplateService');
const ArenaPrefsService = require('./ArenaPrefsService');
const ProxyBrainService = require('./ProxyBrainService');
const { bestEffortInTransaction } = require('../utils/savepoint');
const { postposition } = require('../utils/korean');

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseIsoDayUTC(iso) {
  const s = safeIsoDay(iso);
  if (!s) return null;
  const [y, m, d] = s.split('-').map((x) => Number(x));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function formatIsoDayUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isoWeekYearAndNumberFromDateUTC(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3); // Thu of current week
  const isoYear = d.getUTCFullYear();

  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDay + 3);

  const week = 1 + Math.round((d.getTime() - firstThu.getTime()) / (7 * 24 * 3600 * 1000));
  return { isoYear, week };
}

function isoWeekStartEndFromDateUTC(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const start = new Date(d);
  start.setUTCDate(start.getUTCDate() - day);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start, end };
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function parseDateMs(v) {
  if (!v) return null;
  const ms = Date.parse(String(v));
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function safeText(v, maxLen) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const n = Number(maxLen);
  if (!Number.isFinite(n) || n <= 0) return s;
  return s.slice(0, Math.floor(n));
}

function seedShuffle(list, seedHex) {
  const arr = [...(Array.isArray(list) ? list : [])];
  if (arr.length <= 1) return arr;
  let x = parseInt(String(seedHex || '0').slice(0, 8), 16) || 1;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const j = Math.abs(x) % (i + 1);
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function hash32(s) {
  const str = String(s || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed32) {
  let a = seed32 >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  const a = Math.floor(Number(min));
  const b = Math.floor(Number(max));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a;
  if (b <= a) return a;
  return Math.floor(rng() * (b - a + 1)) + a;
}

function pick(rng, arr) {
  const list = Array.isArray(arr) ? arr : [];
  if (list.length === 0) return null;
  return list[Math.floor(rng() * list.length)];
}

/**
 * Weighted pick from an array using MODE_WEIGHTS.
 * Falls back to uniform pick for items without weights.
 */
const ALL_ARENA_MODES = [
  'AUCTION_DUEL',
  'PUZZLE_SPRINT',
  'DEBATE_CLASH',
  'MATH_RACE',
  'COURT_TRIAL',
  'PROMPT_BATTLE'
];

const MODE_WEIGHTS = {
  DEBATE_CLASH: 2.0,
  COURT_TRIAL: 1.5,
  AUCTION_DUEL: 0,
  PUZZLE_SPRINT: 0,
  MATH_RACE: 0,
  PROMPT_BATTLE: 0
};

function pickWeighted(rng, arr) {
  const list0 = Array.isArray(arr) ? arr : [];
  if (list0.length === 0) return null;
  if (list0.length === 1) return list0[0];

  const pool = [];
  for (const raw of list0) {
    const m = String(raw || '').trim();
    if (!m) continue;
    const hasWeight = Object.prototype.hasOwnProperty.call(MODE_WEIGHTS, m);
    const wRaw = hasWeight ? Number(MODE_WEIGHTS[m]) : 1.0;
    const w = Number.isFinite(wRaw) ? wRaw : 1.0;
    if (w <= 0) continue; // allow "hard-disable" by setting weight 0
    pool.push({ m, w });
  }

  const list = pool.length ? pool : list0.map((m) => ({ m, w: 1.0 }));
  const total = list.reduce((s, x) => s + x.w, 0);
  if (!(total > 0)) return list0[0];

  let r = rng() * total;
  for (const x of list) {
    r -= x.w;
    if (r <= 0) return x.m;
  }
  return list[list.length - 1].m;
}

function pairKey(aId, bId) {
  const a = String(aId || '');
  const b = String(bId || '');
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function buildNudgeHints(nudges) {
  const list = Array.isArray(nudges) ? nudges : [];
  const hints = {
    budget: 0,
    impulse_stop: 0,
    study: 0,
    calm: 0,
    aggressive: 0
  };

  const reBudgetWords = /돈|코인|절약|아끼|아껴|저축|낭비/i;
  const reBudgetAction = /아끼|아껴|절약|낭비\s*하지|줄여|줄이/i;
  const reImpulseWords = /충동|지름|자료|충동구매/i;
  const reNo = /하지\s*마|하지\s*말|금지|말아|줄여|줄이/i;
  const reStudy = /공부|문제|퀴즈|퍼즐|연구|분석|판례|증거|모순|논리|반박|전략|준비/i;
  const reCalm = /침착|싸우지\s*마|차분|조용|화해|냉정|신중/i;
  const reAggro = /이겨|밀어붙|싸워|박살|압도|공격|공세|감정.*호소|설득|강하게/i;

  for (const n of list) {
    const kindRaw = String(n?.kind || '').trim().toLowerCase();
    const kind = kindRaw === 'arena_note' ? 'preference' : kindRaw;
    const text = String(n?.text || '').trim();
    if (!kind || !text) continue;

    const conf = clamp01(Number(n?.confidence ?? 1.0) / 1.5);
    const w = 0.7 + conf * 0.6;

    if (reBudgetWords.test(text) && reBudgetAction.test(text)) hints.budget += w;
    if (reImpulseWords.test(text) && reNo.test(text)) hints.impulse_stop += w;
    if (reStudy.test(text)) hints.study += w * (kind === 'preference' ? 0.6 : 1.0);
    if (reCalm.test(text)) hints.calm += w;
    if (reAggro.test(text)) hints.aggressive += w;
  }

  return {
    budget: clamp01(hints.budget / 2.0),
    impulse_stop: clamp01(hints.impulse_stop / 2.0),
    study: clamp01(hints.study / 2.0),
    calm: clamp01(hints.calm / 2.0),
    aggressive: clamp01(hints.aggressive / 2.0)
  };
}

function summarizeHintInfluence(hints) {
  const src = hints && typeof hints === 'object' ? hints : {};
  const keys = ['calm', 'study', 'aggressive', 'budget', 'impulse_stop'];
  const entries = keys
    .map((k) => {
      const v = clamp01(Number(src[k] ?? 0) || 0);
      return { key: k, score: Math.round(v * 1000) / 1000 };
    })
    .sort((a, b) => b.score - a.score || String(a.key).localeCompare(String(b.key)));

  const valueOf = (k) => entries.find((e) => e.key === k)?.score ?? 0;
  return {
    calm: valueOf('calm'),
    study: valueOf('study'),
    aggressive: valueOf('aggressive'),
    budget: valueOf('budget'),
    impulse_stop: valueOf('impulse_stop'),
    dominant: entries.filter((e) => e.score > 0.01).slice(0, 2).map((e) => e.key)
  };
}

function summarizeRecentMemoryInfluence(refs) {
  const list = Array.isArray(refs) ? refs : [];
  const total = list.reduce((sum, r) => sum + clamp01(Number(r?.confidence ?? 0) || 0), 0);
  const avg = list.length > 0 ? total / list.length : 0;
  return {
    count: list.length,
    score: Math.round(avg * 1000) / 1000,
    refs: list.slice(0, 3).map((r) => ({
      kind: String(r?.kind || 'coaching').slice(0, 24),
      text: safeText(r?.text ?? '', 120),
      confidence: Math.round(clamp01(Number(r?.confidence ?? 0) || 0) * 1000) / 1000
    }))
  };
}

function coachingScoreBonusRate({ refs, hints }) {
  const list = Array.isArray(refs) ? refs : [];
  if (list.length === 0) return 0;

  const h = hints && typeof hints === 'object' ? hints : {};
  const hasSignal =
    (Number(h.calm ?? 0) || 0) > 0.02 ||
    (Number(h.study ?? 0) || 0) > 0.02 ||
    (Number(h.aggressive ?? 0) || 0) > 0.02 ||
    (Number(h.budget ?? 0) || 0) > 0.02 ||
    (Number(h.impulse_stop ?? 0) || 0) > 0.02;
  if (!hasSignal) return 0;

  const avgConf = list.reduce((sum, r) => sum + Math.max(0, Math.min(1, Number(r?.confidence ?? 0) || 0)), 0) / list.length;
  const scaled = 0.05 + avgConf * 0.05; // 5% ~ 10%
  return Math.max(0.05, Math.min(0.10, Math.round(scaled * 1000) / 1000));
}

function coachingThemeLabel(text, dominant = []) {
  const raw = String(text || '').trim();
  const s = raw.toLowerCase();
  if (/증거|근거|판례|팩트|자료|evidence/.test(s)) return '증거 집중 분석';
  if (/논리|반박|핵심|요약|구조|프레임/.test(s)) return '논리적 반박';
  if (/침착|차분|냉정|평정/.test(s)) return '침착한 톤 유지';
  if (/공격|압박|밀어붙|강하게/.test(s)) return '공세 전개';
  if (/공감|설득|상대/.test(s)) return '공감형 설득';
  if (/예산|코인|절약|낭비|리스크/.test(s)) return '리스크 관리';
  if (/충동|지름|흥분/.test(s)) return '충동 억제';

  const top = Array.isArray(dominant) ? String(dominant[0] || '').trim() : '';
  if (top === 'study') return '증거 집중 분석';
  if (top === 'calm') return '침착한 톤 유지';
  if (top === 'aggressive') return '공세 전개';
  if (top === 'budget') return '리스크 관리';
  if (top === 'impulse_stop') return '충동 억제';
  return raw ? safeText(raw, 28) : '핵심 논점 정리';
}

function pickCoachingImpactRound(rounds, side) {
  const key = String(side || '').trim().toLowerCase() === 'b' ? 'b' : 'a';
  const mine = key === 'a' ? 'a_score_delta' : 'b_score_delta';
  const opp = key === 'a' ? 'b_score_delta' : 'a_score_delta';
  const list = Array.isArray(rounds) ? rounds : [];
  let best = null;
  let bestScore = -Infinity;
  for (const r of list) {
    const mineDelta = Number(r?.[mine] ?? 0) || 0;
    const oppDelta = Number(r?.[opp] ?? 0) || 0;
    const impact = mineDelta - oppDelta;
    if (impact > bestScore) {
      bestScore = impact;
      best = r;
    }
  }
  return best;
}

function buildCoachingNarrative({
  mode,
  ownerUserId,
  coachingRefs,
  coachingApplied,
  dominantHints,
  rounds,
  side
}) {
  if (!coachingApplied) return null;
  const refs = Array.isArray(coachingRefs) ? coachingRefs : [];
  if (refs.length === 0) return null;
  const topRef = refs[0] && typeof refs[0] === 'object' ? refs[0] : null;
  const round = pickCoachingImpactRound(rounds, side);
  if (!round) return null;

  const action = String(round?.[side === 'b' ? 'b_action' : 'a_action'] || '').trim();
  if (!action) return null;
  const roundNum = Math.max(1, Math.trunc(Number(round?.round_num ?? 1) || 1));
  const highlight = String(round?.highlight || '').trim();
  const pivot = /역전|뒤집/.test(highlight) ? '결정적 반격' : '결정타';
  const theme = coachingThemeLabel(topRef?.text, dominantHints);
  const verb = mode === 'DEBATE_CLASH' || mode === 'COURT_TRIAL' ? '변론' : '플레이';
  const prefix = ownerUserId ? '네가 가르친' : '코칭한';
  const quote = (() => {
    const t = String(topRef?.text || '').trim();
    if (!t) return '';
    const max = 16;

    const exact = t.match(/(근거[·\s]*증거\s*\d+\s*개)/) || t.match(/(증거\s*\d+\s*개)/) || t.match(/(근거\s*\d+\s*개)/);
    if (exact?.[1]) return safeText(String(exact[1]).trim(), max);

    const countIdx = t.search(/\d+\s*개/);
    if (countIdx >= 0) {
      const start = Math.max(0, countIdx - 10);
      const end = Math.min(t.length, countIdx + 6);
      const chunk = t.slice(start, end).trim();
      return safeText(chunk.replace(/^[-–—•\s]+/, ''), max);
    }

    const keywords = ['근거', '증거', '차분', '침착', '톤', '논점', '질문', '반박', '정리'];
    for (const k of keywords) {
      const idx = t.indexOf(k);
      if (idx >= 0) {
        const start = Math.max(0, idx);
        const end = Math.min(t.length, idx + max);
        const chunk = t.slice(start, end).trim();
        return safeText(chunk.replace(/^[-–—•\s]+/, ''), max);
      }
    }

    return safeText(t, max);
  })();
  const quotePart = quote ? ` "${quote}"대로 한` : '';
  const pivotPostfix = (() => {
    const s = String(pivot || '').trim();
    if (!s) return '으로';
    const last = s.slice(-1);
    const code = last.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const jong = (code - 0xac00) % 28;
      // '로' (no jong or ㄹ jong)
      return jong === 0 || jong === 8 ? '로' : '으로';
    }
    return '으로';
  })();
  return safeText(`${prefix}${quotePart} ${theme}이 ${roundNum}라운드 ${verb}에서 ${pivot}${pivotPostfix} 이어졌어!`, 220);
}

function pickResultCoachingNarrative({ winnerId, aId, bId, bySide }) {
  const src = bySide && typeof bySide === 'object' ? bySide : {};
  const aText = typeof src.a === 'string' ? src.a.trim() : '';
  const bText = typeof src.b === 'string' ? src.b.trim() : '';
  if (String(winnerId || '') === String(aId || '') && aText) return aText;
  if (String(winnerId || '') === String(bId || '') && bText) return bText;
  return aText || bText || null;
}

function buildCourtArgumentFallback({ courtTrial, rounds, aName, bName, aCoaching = [], bCoaching = [], winner = 'a' } = {}) {
  const ct = courtTrial && typeof courtTrial === 'object' ? courtTrial : {};
  const title = safeText(ct.title, 160) || '';
  const charge = safeText(ct.charge, 80) || '';
  const statute = safeText(ct.statute, 220) || '';
  const facts = Array.isArray(ct.facts) ? ct.facts.map((x) => safeText(x, 160)).filter(Boolean).slice(0, 6) : [];
  const rds = Array.isArray(rounds) ? rounds : [];

  const kind = (() => {
    const s = `${charge} ${statute}`.toLowerCase();
    if (/헌법|탄핵|헌법재판소/.test(s)) return 'constitutional';
    if (/민법|국가배상|손해배상|불법행위|취소소송|행정/.test(s)) return 'civil';
    if (/형법|처벌|특례법|벌칙|공소|징역|벌금/.test(s)) return 'criminal';
    return /법/.test(s) ? 'civil' : 'criminal';
  })();

  const askA = kind === 'constitutional' ? '인용' : kind === 'civil' ? '청구 인용' : '유죄';
  const askB = kind === 'constitutional' ? '기각' : kind === 'civil' ? '청구 기각' : '무죄';

  const quoteFrom = (arr) => {
    const t = safeText(String((Array.isArray(arr) ? arr[0] : '') || ''), 120).trim();
    if (!t) return '';
    const m = t.match(/(근거[·\s]*증거\s*\d+\s*개)/) || t.match(/(증거\s*\d+\s*개)/) || t.match(/(근거\s*\d+\s*개)/);
    if (m?.[1]) return safeText(String(m[1]).trim(), 14);
    const keywords = ['근거', '증거', '차분', '침착', '톤', '논점', '질문', '반박', '정리'];
    for (const k of keywords) {
      const idx = t.indexOf(k);
      if (idx >= 0) return safeText(t.slice(idx, idx + 14).trim(), 14);
    }
    return safeText(t, 14);
  };

  const qA = quoteFrom(aCoaching);
  const qB = quoteFrom(bCoaching);
  const qLine = (q) => (q ? `("${q}") ` : '');

  const factLine = (idx) => (facts[idx] ? `#${idx + 1} ${facts[idx]}` : '');
  const f1 = factLine(0);
  const f2 = factLine(1);
  const f3 = factLine(2);
  const f4 = factLine(3);

  const leadSideForRound = (r, i) => {
    const aD = Number(r?.a_score_delta ?? 0) || 0;
    const bD = Number(r?.b_score_delta ?? 0) || 0;
    if (aD === bD) return i === 2 ? winner : null;
    return aD >= bD ? 'a' : 'b';
  };

  const normalizeCourtArgumentLength = (text, { roundNo, ask, oppAsk, confident }) => {
    const minLen = 240;
    const maxLen = 420;
    let out = safeText(text, maxLen);
    if (out.length >= minLen) return out;

    const fillers = roundNo === 1
      ? [
        statute ? `핵심은 ${statute}의 문언을 사실에 정확히 대입하는 것입니다.` : '핵심은 법리 문언을 사실에 정확히 대입하는 것입니다.',
        confident ? '상대의 수사는 길지만, 입증 구조는 짧고 약합니다.' : '상대는 단어를 늘리지만, 입증의 연결고리는 비어 있습니다.',
        `따라서 재판부는 ${ask} 결론을 향해 쟁점을 정리해야 합니다.`
      ]
      : roundNo === 2
        ? [
          '반대심문 단계에서는 모순 하나만 확인돼도 전체 신빙성이 흔들립니다.',
          `상대가 요구하는 ${oppAsk} 결론은 요건 검토를 통과하지 못합니다.`,
          confident ? `지금까지 제출된 자료만으로도 ${ask} 판단의 근거는 충분합니다.` : `남은 쟁점까지 보면 결국 ${ask} 결론만이 합리적입니다.`
        ]
        : [
          statute ? `최종적으로 ${statute}의 요건 충족 여부를 기준으로 결론을 내려야 합니다.` : '최종적으로 법정 요건 충족 여부를 기준으로 결론을 내려야 합니다.',
          '추정이나 인상비평이 아니라, 확인된 사실과 법리의 결합으로 판단해야 합니다.',
          `그 기준을 따르면 이 사건의 귀결은 ${ask}입니다.`
        ];

    for (const f of fillers) {
      const line = safeText(f, 140);
      if (!line) continue;
      if (out.includes(line)) continue;
      const next = `${out} ${line}`.trim();
      if (next.length > maxLen) break;
      out = next;
      if (out.length >= minLen) break;
    }

    if (out.length < minLen) {
      const tail = safeText(`결론적으로 ${ask} 판단이 법리와 증거의 흐름에 부합합니다.`, 100);
      const next = `${out} ${tail}`.trim();
      out = safeText(next, maxLen);
    }

    return out;
  };

  const mk = (side, roundNo, leadSide) => {
    const isA = side === 'a';
    const quote = isA ? qA : qB;
    const ask = isA ? askA : askB;
    const oppAsk = isA ? askB : askA;
    const confident = leadSide === side;

    if (roundNo === 1) {
      const lines = [
        `${qLine(quote)}쟁점은 두 가지입니다.`,
        `첫째, ${title || '사건'}의 핵심 사실입니다.`,
        f1 ? `근거 1: ${f1}.` : '근거 1: 사실관계입니다.',
        f2 ? `근거 2: ${f2}.` : '근거 2: 기록입니다.',
        statute ? `법리는 ${statute}에 따라 판단합니다.` : '법리는 규칙에 따라 판단합니다.',
        confident ? '재판부도 이미 방향을 잡았습니다.' : '상대는 쟁점을 흐리려 할 것입니다.'
      ];
      return normalizeCourtArgumentLength(safeText(lines.filter(Boolean).join(' '), 420), { roundNo, ask, oppAsk, confident });
    }

    if (roundNo === 2) {
      const lines = [
        '반대심문입니다. 허점은 한 곳입니다.',
        f3 ? `#3은 상대 주장과 충돌합니다: ${f3}.` : '상대 주장은 증거로 뒷받침되지 않습니다.',
        f4 ? `#4를 보면 인과가 끊깁니다: ${f4}.` : '신빙성에서 균열이 납니다.',
        confident ? '재판장: 그 근거는? 바로 위 증거입니다.' : '재판장: 그럼 무엇이 부족합니까? 입증입니다.',
        `결론은 간단합니다. ${oppAsk}의 여지가 큽니다.`,
        isA ? `그러니 ${ask} 쪽으로 판단해 주십시오.` : `그러니 ${ask}로 결론 내리십시오.`
      ];
      return normalizeCourtArgumentLength(safeText(lines.filter(Boolean).join(' '), 420), { roundNo, ask, oppAsk, confident });
    }

    const lines = [
      '최종변론입니다. 판단기준은 한 줄입니다.',
      statute ? `기준은 ${statute}의 요건 충족입니다.` : '기준은 요건 충족 여부입니다.',
      f1 ? `#1, ` : '',
      f2 ? `#2, ` : '',
      f3 ? `#3을 대입하면 결론은 분명합니다.` : '사실을 대입하면 결론은 분명합니다.',
      confident ? '재판부는 흔들리지 않아야 합니다.' : '의심이 남으면 결론을 늦춰야 합니다.',
      kind === 'criminal'
        ? `피고인에 대하여 ${ask} 선고를 구합니다.`
        : kind === 'constitutional'
          ? `따라서 이 사건은 ${ask}돼야 합니다.`
          : `따라서 원고의 청구는 ${isA ? '인용' : '기각'}돼야 합니다.`
    ];
    return normalizeCourtArgumentLength(safeText(lines.filter(Boolean).join(' '), 420), { roundNo, ask, oppAsk, confident });
  };

  const outRounds = [];
  for (let i = 0; i < Math.max(3, rds.length); i += 1) {
    const r = rds[i] || { a_score_delta: 0, b_score_delta: 0 };
    const lead = leadSideForRound(r, i);
    outRounds.push({
      a_argument: mk('a', i + 1, lead),
      b_argument: mk('b', i + 1, lead)
    });
  }

  const aClosing = safeText(`${qLine(qA)}결정적 쟁점은 요건 충족입니다. #1·#2를 법리에 대입하면 결론은 ${askA}입니다.`, 300);
  const bClosing = safeText(`${qLine(qB)}남는 의심은 치명적입니다. 증거의 연결이 끊기면 결론은 ${askB}입니다.`, 300);

  return { rounds: outRounds.slice(0, 3), a_closing: aClosing, b_closing: bClosing };
}

function summarizePromptProfileMeta(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const hasCustom = Boolean(p.has_custom) || Boolean(String(p.prompt_text || '').trim());
  const enabled = Boolean(p.enabled) && hasCustom;
  const version = Math.max(0, Math.trunc(Number(p.version ?? 0) || 0));
  return {
    enabled,
    has_custom: hasCustom,
    version,
    updated_at: p.updated_at ?? null,
    source: hasCustom ? 'user_profile' : 'default'
  };
}

function eloDelta({ ratingA, ratingB, outcomeA, k = 24 }) {
  const ra = Number(ratingA) || 1000;
  const rb = Number(ratingB) || 1000;
  const expectedA = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const actualA = outcomeA === 'win' ? 1 : outcomeA === 'lose' || outcomeA === 'forfeit' ? 0 : 0.5;
  const delta = Math.round((Number(k) || 24) * (actualA - expectedA));
  return clampInt(delta, -200, 200);
}

function expectedWinProb(ratingA, ratingB) {
  const ra = Number(ratingA) || 1000;
  const rb = Number(ratingB) || 1000;
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

function winProbFromState({ aCum10, bCum10, ratingA, ratingB }) {
  const diff10 = (Number(aCum10) || 0) - (Number(bCum10) || 0);
  const base = 0.5 + diff10 / 80; // score diff dominates
  const ratingSpice = ((Number(ratingA) || 1000) - (Number(ratingB) || 1000)) / 4000 * 0.1;
  return clamp01(base + ratingSpice);
}

function partitionScore10(rng, total10, rounds) {
  const total = Math.max(0, Math.trunc(Number(total10) || 0));
  const n = Math.max(1, Math.min(9, Math.trunc(Number(rounds) || 3)));
  if (total <= 0) return Array.from({ length: n }, () => 0);
  if (n === 1) return [total];
  const cuts = [];
  for (let i = 0; i < n - 1; i += 1) cuts.push(randInt(rng, 0, total));
  cuts.sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const c of cuts) {
    out.push(Math.max(0, c - prev));
    prev = c;
  }
  out.push(Math.max(0, total - prev));
  // Shuffle slightly so rounds aren't always "front-loaded".
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randInt(rng, 0, i);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

const ACTION_LABELS_BY_MODE = {
  DEBATE_CLASH: {
    공세: [
      '상대 논점의 허점을 찌른다!',
      '감정적 호소로 판세를 뒤흔든다',
      '질문 폭격으로 숨통을 조인다!',
      '강한 어조로 흐름을 강탈한다',
      '반박 타이밍을 뺏기지 않고 몰아친다',
      '짧고 날카로운 한 줄로 장면을 장악한다',
      '상대 발언을 즉시 반격으로 되돌린다',
      '관중의 호흡을 먼저 잡고 밀어붙인다'
    ],
    침착: [
      '핵심 쟁점을 차분히 정리한다',
      '톤을 낮추고 근거를 정밀하게 쌓는다',
      '감정을 걷어내고 사실만 제시한다',
      '상대 주장부터 인정한 뒤 틈을 연다',
      '질문 하나로 논점 구조를 재배치한다',
      '속도를 조절하며 실수를 유도한다',
      '반응을 늦추며 판정을 유리하게 만든다',
      '불필요한 단어를 줄여 신뢰를 확보한다'
    ],
    분석: [
      '논리 흐름을 분해해 약한 고리를 집어낸다',
      '근거 간 충돌을 찾아 프레임을 전환한다',
      '데이터 비교로 주장 신뢰도를 재정렬한다',
      '전제 자체를 검증하며 방향을 바꾼다',
      '핵심 용어 정의를 바꿔 판을 다시 그린다',
      '상대 결론의 누락 변수를 콕 짚는다',
      '사례와 수치로 반론 여지를 줄인다',
      '주장 구조를 도식화해 빈틈을 드러낸다'
    ],
    기본: [
      '한 템포 늦게 반응하며 분위기를 살핀다',
      '무난한 반박으로 흐름을 이어간다',
      '핵심 문장을 재진술하며 시간을 번다',
      '상대 톤에 맞춰 수위를 조절한다',
      '짧은 예시 하나로 이해를 돕는다',
      '무리하지 않고 다음 턴을 준비한다',
      '고개를 끄덕이며 카운터 각을 본다',
      '큰 실수 없이 안정적으로 라운드를 넘긴다'
    ]
  },
  PUZZLE_SPRINT: {
    공세: [
      '놀라운 속도로 풀어낸다!',
      '초반에 정답 패턴을 선점한다',
      '승부수를 던지며 연산 속도를 끌어올린다',
      '난이도 높은 구간을 정면 돌파한다',
      '검산을 최소화하고 템포로 압박한다',
      '상대보다 한 수 앞선 선택을 가져간다',
      '풀이 단계를 과감히 압축한다',
      '결정적인 분기에서 공격적으로 확정한다'
    ],
    침착: [
      '검산을 먼저 하고 제출 타이밍을 잡는다',
      '실수 방지를 위해 단계별로 정리한다',
      '속도보다 정확도를 우선해 흔들림이 없다',
      '어려운 구간에서 호흡을 고르고 푼다',
      '오답 유도를 넘기고 안정적으로 축적한다',
      '풀이 순서를 지켜 리스크를 줄인다',
      '타임 압박 속에서도 손을 멈추지 않는다',
      '정답 확신 후 깔끔하게 마무리한다'
    ],
    분석: [
      '문제 구조를 분해해 핵심 변수를 뽑아낸다',
      '조건 간 상충점을 제거해 해를 좁힌다',
      '패턴을 읽고 계산 경로를 단축한다',
      '함정 조건을 먼저 표시해 오답을 차단한다',
      '분기별 결과를 비교해 최적 해를 고른다',
      '중간값을 잡아 연산량을 크게 줄인다',
      '문제 의도를 역추적해 답안을 확정한다',
      '논리 점검으로 막판 실수를 제거한다'
    ],
    기본: [
      '함정 문제에 걸렸다',
      '무난한 속도로 문제를 처리한다',
      '중간에 잠깐 막혔지만 다시 이어간다',
      '직관으로 접근해 답을 좁혀간다',
      '평균 페이스로 차근차근 누적한다',
      '단순 계산에서 시간을 조금 썼다',
      '막판에 집중력을 끌어올린다',
      '한 문제씩 안정적으로 넘긴다'
    ]
  },
  AUCTION_DUEL: {
    공세: [
      '과감한 입찰로 분위기를 압도한다!',
      '초반부터 큰 금액으로 심리를 흔든다',
      '상대 호가를 즉시 상향해 압박한다',
      '타이밍 선점으로 흐름을 장악한다',
      '배짱 베팅으로 판 전체를 끌고 간다',
      '연속 입찰로 상대 계산을 무너뜨린다',
      '승부 구간에서 과감하게 지갑을 연다',
      '한 번에 크게 올려 협상 여지를 닫는다'
    ],
    침착: [
      '예산 상한을 지키며 페이스를 조절한다',
      '급등 구간에서 참으며 기회를 기다린다',
      '상대 반응을 본 뒤 최소 폭으로 올린다',
      '수익 대비 가격을 계산해 선을 지킨다',
      '감정 없이 숫자로만 판단한다',
      '불필요한 오버페이를 피하며 버틴다',
      '중요 구간까지 코인을 아껴 둔다',
      '막판에 정확한 한 수로 균형을 맞춘다'
    ],
    분석: [
      '상대 자금 흐름을 읽고 입찰 간격을 조절한다',
      '낙찰 확률과 소모 비용을 동시에 계산한다',
      '블러프 빈도를 분석해 대응 패턴을 만든다',
      '가치 대비 과열 구간을 피하며 역습한다',
      '입찰 로그를 기반으로 심리전을 설계한다',
      '평균 호가를 계산해 적정선을 고정한다',
      '상대 페이스가 꺾이는 지점을 포착한다',
      '마감 직전 확률 우위 지점에 진입한다'
    ],
    기본: [
      '블러핑 실패, 자금 소진',
      '평범한 입찰로 무난하게 대응한다',
      '한 박자 늦게 따라붙으며 상황을 본다',
      '가격을 조금씩 올리며 간을 본다',
      '적당한 선에서 타협점을 찾는다',
      '중반까지 조용히 기회를 노린다',
      '결정 구간에서 선택이 엇갈렸다',
      '안전한 선택으로 손실을 제한한다'
    ]
  },
  COURT_TRIAL: {
    공세: [
      '강하게 몰아붙인다!',
      '증인을 흔들어놓았다',
      '단정적으로 끊었다',
      '이의 있습니다! 거세게 반발한다',
      '증거목록을 제시하며 분위기를 뒤집는다',
      '반대 심문에서 빈틈을 파고든다',
      '재판장의 시선을 먼저 사로잡는다',
      '방청석이 술렁인다. 재판부가 집중한다'
    ],
    침착: [
      '조목조목 반박, 빈틈이 없다',
      '톤을 낮추며 차분하게',
      '정중히, 그러나 날카롭게',
      '절차를 지키며 논점을 정리한다',
      '감정 없이 판례를 인용한다',
      '조용히 핵심만 짚어 분위기를 잡는다',
      '한 발 물러서며 함정을 깔아둔다',
      '여유 있는 태도로 주도권을 유지한다'
    ],
    분석: [
      '증거를 연결했다! 치밀하다',
      '모순을 정확히 짚었다',
      '기록을 들이밀며 압박',
      '증언 간 시간차를 계산해 허점을 찾는다',
      '문서의 맥락을 연결해 전체 그림을 그린다',
      '핵심 증거의 출처를 역추적한다',
      '논리 구조를 도식화해 판사를 설득한다',
      '수치 데이터로 진술의 신뢰도를 검증한다'
    ],
    기본: [
      '말꼬리를 잡았다',
      '애매하게 넘겼다',
      '근거 제시에 주춤했다',
      '질문 의도를 놓쳤다',
      '무난하게 답변을 이어간다',
      '핵심을 비켜간 진술을 한다',
      '잠깐 당황했지만 다시 논점을 잡는다',
      '큰 실수 없이 심문을 넘긴다'
    ]
  },
  PROMPT_BATTLE: {
    공세: [
      '스타일로 밀어붙인다',
      '디테일을 한층 올렸다',
      '파격적인 구성으로 시선을 강탈한다',
      '감각적인 표현이 압도적이다',
      '트렌드를 선도하는 키워드를 던진다',
      '비주얼 임팩트가 한 단계 위다',
      '과감한 배치로 판을 흔든다',
      '속도전에서 상대를 압도한다'
    ],
    침착: [
      '구도를 잡고 차분히 밀어낸다',
      '기본기에 충실하게 쌓아 올린다',
      '군더더기 없이 깔끔하게 마무리한다',
      '조건을 꼼꼼히 확인하며 리스크를 줄인다',
      '과하지 않은 선에서 완성도를 높인다',
      '안정적인 선택으로 실수를 줄인다',
      '템포를 유지하며 흔들림 없이 진행한다',
      '무리하지 않고 조건 충족에 집중한다'
    ],
    분석: [
      '키워드 완벽 충족!',
      '제약을 지키며 완성',
      '구도를 깔끔하게 잡았다',
      '조건 간 우선순위를 정리해 최적 해를 찾는다',
      '레퍼런스를 분석해 핵심 패턴을 추출한다',
      '제약 조건을 도식화해 효율을 높인다',
      '키워드 배치를 계산해 균형을 맞춘다',
      '출력 품질을 검증하며 미세 조정한다'
    ],
    기본: [
      '키워드를 놓쳤다…!',
      '무난한 시도로 흐름을 이어간다',
      '직관으로 접근해 결과를 기다린다',
      '조건 하나를 살짝 빗나갔다',
      '평균적인 완성도로 마무리한다',
      '작은 실수가 있었지만 크게 흔들리진 않는다',
      '기본 구도를 따라 무탈하게 진행한다',
      '아쉬운 부분이 있지만 큰 틀은 유지한다'
    ]
  }
};

const NPC_AUTO_CHEER_LINES = {
  a: [
    '{a} 오늘 컨디션 미쳤다!',
    '{a} 끝까지 밀어붙여!',
    '이 판은 {a}가 가져간다!',
    '{a} 집중력 장난 아니다',
    '{a} 한 방 더 보여줘!',
    '{a} 폼이 살아있다',
    '{a} 템포 좋다 그대로 가자',
    '{a} 마무리만 깔끔하게!'
  ],
  b: [
    '{b} 오늘 흐름 좋다!',
    '{b} 침착하게 끝내자!',
    '이 라운드는 {b} 쪽이다!',
    '{b} 판단이 정확하다',
    '{b} 한 수 더 올려!',
    '{b} 집중 깨지지 마!',
    '{b} 페이스 유지하면 이긴다',
    '{b} 승부수 타이밍 좋았다'
  ],
  neutral: [
    '와 오늘 매치 퀄리티 미쳤다',
    '양쪽 다 폼 좋다 끝까지 간다',
    '이건 마지막까지 모른다',
    '분위기 진짜 뜨겁다',
    '관전 맛 제대로 난다',
    '누가 이겨도 명경기각',
    '집중 안 하면 바로 뒤집힌다',
    '오늘 응원하길 잘했다'
  ]
};

function normalizeCheerSide(side) {
  const s = String(side || '').trim().toLowerCase();
  if (s === 'a' || s === 'b') return s;
  return null;
}

function normalizeCheerMessage(message) {
  const text = safeText(message, 140);
  return text || null;
}

function aggregateCheerRows(rows, { maxMessages = 8, bestMinCount = 2 } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  let aCount = 0;
  let bCount = 0;
  const msgMap = new Map();

  for (const row of safeRows) {
    const side = normalizeCheerSide(row?.side) || '';
    if (side === 'a') aCount += 1;
    else if (side === 'b') bCount += 1;

    const text = String(row?.message || '').trim();
    if (!text || !side) continue;
    const authorName = String(row?.display_name || row?.name || '').trim() || null;
    const k = `${side}:${text}`;
    const cur = msgMap.get(k) || { side, text, count: 0, authors: [] };
    cur.count += 1;
    if (authorName && !cur.authors.includes(authorName) && cur.authors.length < 3) {
      cur.authors.push(authorName);
    }
    msgMap.set(k, cur);
  }

  const messages = [...msgMap.values()]
    .sort((x, y) => y.count - x.count || x.text.localeCompare(y.text))
    .slice(0, Math.max(1, Math.min(20, Number(maxMessages) || 8)));
  const threshold = Math.max(1, Math.min(10, Number(bestMinCount) || 2));
  const bestCheer = messages[0] && messages[0].count >= threshold
    ? { ...messages[0], tag: '베스트 응원' }
    : null;

  return { aCount, bCount, total: aCount + bCount, messages, bestCheer };
}

async function loadCheerRowsWithFallback(client, matchId, { limit = 300 } = {}) {
  const mId = String(matchId || '').trim();
  if (!client || !mId) return { rows: [], source: 'none' };

  const safeLimit = clampInt(limit, 1, 500);
  try {
    const cheerRows = await client.query(
      `SELECT c.side,
              NULLIF(BTRIM(COALESCE(c.message, '')), '') AS message,
              a.name,
              a.display_name
       FROM cheers c
       LEFT JOIN agents a ON a.id = c.agent_id
       WHERE c.match_id = $1::uuid
       ORDER BY c.updated_at DESC, c.created_at DESC
       LIMIT $2`,
      [mId, safeLimit]
    ).then((r) => r.rows || []);
    if (cheerRows.length > 0) {
      return { rows: cheerRows, source: 'cheers' };
    }
  } catch {
    // cheers table may not exist yet on old DBs; fallback to legacy facts.
  }

  const cheerKey = `cheer:${mId}`;
  const factRows = await client.query(
    `SELECT COALESCE(f.value->>'side','') AS side,
            NULLIF(BTRIM(COALESCE(f.value->>'message','')), '') AS message,
            a.name,
            a.display_name
     FROM facts f
     LEFT JOIN agents a ON a.id = f.agent_id
     WHERE f.kind = 'arena_cheer' AND f.key = $1
     ORDER BY f.updated_at DESC
     LIMIT $2`,
    [cheerKey, safeLimit]
  ).then((r) => r.rows || []).catch(() => []);
  return { rows: factRows, source: 'facts' };
}

function npcCheerMessageFor({ side, aName, bName, rng }) {
  const s = normalizeCheerSide(side) || 'a';
  const fill = (text) =>
    String(text || '')
      .replace(/\{a\}/g, String(aName || 'A'))
      .replace(/\{b\}/g, String(bName || 'B'));
  const modePool = NPC_AUTO_CHEER_LINES[s] || NPC_AUTO_CHEER_LINES.neutral;
  const line = pick(rng, modePool) || pick(rng, NPC_AUTO_CHEER_LINES.neutral) || '{a} 파이팅!';
  return normalizeCheerMessage(fill(line));
}

function actionLabelFor({ mode, side, hints, rng }) {
  const m = String(mode || '').trim().toUpperCase();
  const who = side === 'b' ? 'B' : 'A';
  const h = hints && typeof hints === 'object' ? hints : {};
  const calm = clamp01(h.calm ?? 0);
  const study = clamp01(h.study ?? 0);
  const aggro = clamp01(h.aggressive ?? 0);
  const budget = clamp01(h.budget ?? 0);
  const impulseStop = clamp01(h.impulse_stop ?? h.impulseStop ?? 0);

  const tone =
    aggro >= 0.6 ? '공세' :
      (calm >= 0.6 || budget >= 0.6 || impulseStop >= 0.6) ? '침착' :
        study >= 0.6 ? '분석' :
          '기본';

  const pickFrom = (arr) => pick(rng, arr) || `${who}의 선택`;

  const modeSet = ACTION_LABELS_BY_MODE[m === 'MATH_RACE' ? 'PUZZLE_SPRINT' : m];
  if (modeSet) {
    return pickFrom(modeSet[tone] || modeSet.기본 || []);
  }
  return pickFrom(['한 수를 놨다', '실수가 나왔다', '이를 악물고 버텼다']);
}

const REVERSAL_HIGHLIGHTS = [
  '역전! 판이 뒤집혔다!',
  '뒤집혔다! 아무도 예상 못 했다!',
  '역전의 서막! 분위기가 완전히 달라졌다!',
  '흐름을 빼앗겼다! 판이 흔들린다!',
  '위기에서 반격! 짜릿한 역전!',
  '이건 반전이다! 승부는 여기서부터!',
  '완전히 뒤집어졌다! 이게 아레나지!',
  '포기하지 않았다! 드라마틱한 역전!'
];

const COURT_REVERSAL_HIGHLIGHTS = [
  '반대신문 한 방! 흐름이 뒤집혔다',
  '핵심 쟁점이 바뀌었다! 재판부 표정이 달라진다',
  '증거 신빙성이 흔들린다! 판세가 뒤집힌다',
  '요건사실 정리로 반격! 분위기가 바뀌었다',
  '판사가 멈춰 세웠다. 지금부터가 승부다',
  '결정적 질문! 답변이 판을 바꿨다',
  '치명적 모순 포착! 역전의 순간',
  '증거 한 방. 판이 돌아섰다'
];

const CLOSE_MATCH_HIGHLIGHTS = [
  '팽팽하다! 한 끗 차이!',
  '숨 막히는 접전! 누가 이겨도 이상하지 않다',
  '간발의 차! 관중이 숨을 참는다',
  '치열한 접전! 양보가 없다',
  '호각지세! 마지막까지 모른다',
  '아슬아슬한 균형! 한 수가 승부를 가른다',
  '엎치락뒤치락! 끝까지 못 놓겠다',
  '거의 동점! 집중력 싸움이다'
];

const COURT_CLOSE_MATCH_HIGHLIGHTS = [
  '접전이다. 쟁점 하나가 승부를 가른다',
  '재판부도 고민한다. 한 줄이 부족하다',
  '증거는 팽팽. 법리가 한 끗이다',
  '서로 인정할 건 인정. 하지만 결론은 갈린다',
  '한 문장에 걸렸다. 지금이 분기점',
  '치열한 공방. 마지막까지 못 놓겠다',
  '거의 동점. 신빙성 싸움이다',
  '판단기준 한 줄이 승부다'
];

const DOMINATION_HIGHLIGHTS = [
  '압도적이다! 상대가 꼼짝 못 한다',
  '일방적인 전개! 격차가 벌어진다',
  '완전 장악! 흐름이 한쪽으로 쏠렸다',
  '상대를 집어삼킨다! 무자비한 공격!',
  '이건 수업이다! 격이 다르다',
  '멈출 수가 없다! 독주 체제!',
  '실력 차이가 여실히 드러나고 있다',
  '기세가 꺾일 줄 모른다! 끝이 안 보여!'
];

const COURT_DOMINATION_HIGHLIGHTS = [
  '논점이 정리됐다. 재판부가 고개를 끄덕인다',
  '증거 연결이 완벽하다. 반박이 막힌다',
  '입증책임이 무너진다. 흐름이 한쪽으로 쏠린다',
  '요건사실이 딱 맞아떨어진다. 압도적이다',
  '법리 프레임 장악. 상대가 끌려간다',
  '신빙성에서 갈렸다. 반격이 안 된다',
  '한 방이 아니라 연타다. 흐름을 잡았다',
  '판사의 질문까지 선점했다. 격이 다르다'
];

function buildRounds({ seed, mode, aTotal10, bTotal10, ratingA, ratingB, aHints, bHints, rounds = 3 }) {
  const n = Math.max(1, Math.min(9, Math.trunc(Number(rounds) || 3)));
  const rng = mulberry32(hash32(`${seed}:rounds`));
  const aParts = partitionScore10(mulberry32(hash32(`${seed}:rounds:a`)), aTotal10, n);
  const bParts = partitionScore10(mulberry32(hash32(`${seed}:rounds:b`)), bTotal10, n);

  let aCum = 0;
  let bCum = 0;
  let prevP = winProbFromState({ aCum10: 0, bCum10: 0, ratingA, ratingB });

  const out = [];
  let prevLead = null; // 'a'|'b'|null

  for (let i = 0; i < n; i += 1) {
    const aDelta = clampInt(aParts[i], 0, 1000);
    const bDelta = clampInt(bParts[i], 0, 1000);
    aCum += aDelta;
    bCum += bDelta;

    const pA = winProbFromState({ aCum10: aCum, bCum10: bCum, ratingA, ratingB });
    const pB = clamp01(1 - pA);
    const shift = pA - prevP;

    const lead = aCum === bCum ? null : aCum > bCum ? 'a' : 'b';
    const leadChanged = prevLead && lead && prevLead !== lead;
    if (lead) prevLead = lead;

    const momentum_shift =
      leadChanged ? '흐름 역전!' :
        Math.abs(shift) >= 0.18 ? '판세 급변!' :
          Math.abs(shift) >= 0.08 ? '흔들리고 있다' :
            '팽팽한 유지';

    let highlight = null;
    const useCourt = String(mode || '').trim().toUpperCase() === 'COURT_TRIAL';
    const reversalSet = useCourt ? COURT_REVERSAL_HIGHLIGHTS : REVERSAL_HIGHLIGHTS;
    const closeSet = useCourt ? COURT_CLOSE_MATCH_HIGHLIGHTS : CLOSE_MATCH_HIGHLIGHTS;
    const dominationSet = useCourt ? COURT_DOMINATION_HIGHLIGHTS : DOMINATION_HIGHLIGHTS;
    if (leadChanged) highlight = pick(rng, reversalSet) || '역전! 판이 뒤집혔다!';
    else if (Math.abs(shift) >= 0.22) highlight = shift > 0 ? pick(rng, reversalSet) || '대역전의 기운이 온다!' : pick(rng, dominationSet) || '흐름이 무너진다!';
    else if (Math.abs(aDelta - bDelta) >= 18) highlight = pick(rng, dominationSet) || '압도적이다!';
    else if (Math.abs(aDelta - bDelta) <= 2 && rng() < 0.35) highlight = pick(rng, closeSet) || '팽팽하다!';
    else if (rng() < 0.12) highlight = pick(rng, ['좋은 수!', '아슬아슬…', '작은 빈틈', '흔들리지 않는다']) || null;

    const a_action = actionLabelFor({ mode, side: 'a', hints: aHints, rng: mulberry32(hash32(`${seed}:r${i + 1}:a`)) });
    const b_action = actionLabelFor({ mode, side: 'b', hints: bHints, rng: mulberry32(hash32(`${seed}:r${i + 1}:b`)) });

    out.push({
      round_num: i + 1,
      a_action,
      b_action,
      a_score_delta: aDelta,
      b_score_delta: bDelta,
      win_prob_a: Math.round(pA * 1000) / 1000,
      win_prob_b: Math.round(pB * 1000) / 1000,
      momentum_shift,
      highlight
    });

    prevP = pA;
  }

  return out;
}

function conditionDeltaFor({ seed, agentId, outcome, forfeit, streakAfter }) {
  const rng = mulberry32(hash32(`${seed}:cond:${agentId}`));
  const o = String(outcome || '').trim().toLowerCase();
  const won = o === 'win';
  const lost = o === 'lose' || o === 'forfeit';
  const base = won ? randInt(rng, 5, 10) : lost ? -randInt(rng, 5, 15) : randInt(rng, -2, 2);
  const ff = forfeit && lost ? -5 : 0;
  const streak = Number(streakAfter ?? 0) || 0;
  const streakBonus = won && streak >= 3 ? 5 : 0;
  return clampInt(base + ff + streakBonus, -30, 30);
}

function readCast(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const cast = m.cast && typeof m.cast === 'object' ? m.cast : {};
  const aId = String(cast.aId || cast.a_id || '').trim() || null;
  const bId = String(cast.bId || cast.b_id || '').trim() || null;
  const aName = String(cast.aName || cast.a_name || '').trim() || null;
  const bName = String(cast.bName || cast.b_name || '').trim() || null;
  return { aId, bId, aName, bName };
}

function headlineFor({ mode, aName, bName, winnerName, stake }) {
  const wager = Number(stake?.wager ?? 0) || 0;
  const coinLine = wager > 0 ? `${wager}코인` : '무스테이크';
  if (mode === 'PUZZLE_SPRINT') return `퍼즐 스프린트: ${winnerName} 승리! (${coinLine})`;
  if (mode === 'DEBATE_CLASH') return `설전 끝, 마지막에 웃은 건 ${winnerName} (${coinLine})`;
  if (mode === 'MATH_RACE') return `수학 레이스: ${winnerName} 승리! (${coinLine})`;
  if (mode === 'COURT_TRIAL') return `재판 대결: ${winnerName} 판결 승 (${coinLine})`;
  if (mode === 'PROMPT_BATTLE') return `프롬프트 배틀: ${winnerName} 승리! (${coinLine})`;
  return `경매전: ${winnerName}의 결정적 한 수 (${coinLine})`;
}

function modeLabel(mode) {
  const m = String(mode || '').trim().toUpperCase();
  if (m === 'AUCTION_DUEL') return '경매전';
  if (m === 'PUZZLE_SPRINT') return '퍼즐';
  if (m === 'DEBATE_CLASH') return '설전';
  if (m === 'MATH_RACE') return '수학';
  if (m === 'COURT_TRIAL') return '재판';
  if (m === 'PROMPT_BATTLE') return '프롬프트';
  return m || 'match';
}

function buildPuzzle(rng) {
  const kind = pick(rng, ['SEQ_MUL', 'SEQ_ADD']);
  if (kind === 'SEQ_ADD') {
    const start = randInt(rng, 3, 15);
    const step = randInt(rng, 2, 9);
    const seq = [start, start + step, start + step * 2, start + step * 3];
    return {
      kind,
      question: `수열: ${seq.join(', ')}, 다음은?`,
      answer: start + step * 4
    };
  }
  const start = randInt(rng, 2, 9);
  const mul = randInt(rng, 2, 4);
  const seq = [start, start * mul, start * mul * mul, start * mul * mul * mul];
  return {
    kind,
    question: `수열: ${seq.join(', ')}, 다음은?`,
    answer: start * mul * mul * mul * mul
  };
}

function buildMathRaceChallenge(rng) {
  const kind = pick(rng, ['ARITH_ADD_MUL', 'ARITH_MUL_ADD', 'SEQ_ADD', 'SEQ_MUL']) || 'ARITH_ADD_MUL';
  if (kind === 'SEQ_ADD') {
    const start = randInt(rng, 5, 30);
    const step = randInt(rng, 2, 12);
    const seq = [start, start + step, start + step * 2, start + step * 3];
    return { kind, question: `수열: ${seq.join(', ')}, 다음은?`, answer: start + step * 4 };
  }
  if (kind === 'SEQ_MUL') {
    const start = randInt(rng, 2, 12);
    const mul = randInt(rng, 2, 4);
    const seq = [start, start * mul, start * mul * mul, start * mul * mul * mul];
    return { kind, question: `수열: ${seq.join(', ')}, 다음은?`, answer: start * mul * mul * mul * mul };
  }
  if (kind === 'ARITH_MUL_ADD') {
    const a = randInt(rng, 3, 19);
    const b = randInt(rng, 3, 17);
    const c = randInt(rng, 2, 29);
    return { kind, question: `(${a}×${b}) + ${c} = ?`, answer: a * b + c };
  }
  const a = randInt(rng, 5, 30);
  const b = randInt(rng, 2, 20);
  const c = randInt(rng, 2, 9);
  return { kind, question: `(${a}+${b})×${c} = ?`, answer: (a + b) * c };
}

function scoreMathRaceAttempt({ correct, timeMs, distance }) {
  const t = clampInt(timeMs ?? 0, 900, 9900);
  const d = Math.max(0, Number(distance ?? 0) || 0);
  const speed = clamp01((9500 - t) / 9500) * 5.0; // 0..5
  const penalty = Math.min(1.2, d / 10) * 0.8; // 0..~1
  return Math.max(0, Math.min(10, (correct ? 5 : 0) + speed - penalty));
}

function perfMathRace({ seed, agentId, rating, stats, jobCode, hints, challenge }) {
  const rng = mulberry32(hash32(`${seed}:MATH_RACE:${agentId}`));
  const r = Number(rating) || 1000;
  const energy = clampInt(stats?.energy ?? 50, 0, 100);
  const stress = clampInt(stats?.stress ?? 25, 0, 100);
  const curiosity = clampInt(stats?.curiosity ?? 50, 0, 100);
  const job = String(jobCode || '').trim().toLowerCase();

  const jobBonus = job === 'engineer' ? 0.16 : job === 'detective' ? 0.1 : job === 'journalist' ? 0.06 : 0;
  const study = clamp01(Number(hints?.study ?? 0) || 0);

  const pCorrect = clamp01(
    0.46 +
      jobBonus +
      study * 0.22 +
      (r - 1000) / 3200 +
      (energy - 50) / 420 -
      (stress - 25) / 520 +
      (curiosity - 50) / 520
  );
  const correct = rng() < pCorrect;

  const base = 4300 - study * 1400 - jobBonus * 900 - (energy - 50) * 18 + (stress - 25) * 22;
  const jitter = randInt(rng, -650, 2200);
  let timeMs = clampInt(base + jitter, 900, 9500);
  if (!correct) timeMs = clampInt(timeMs + randInt(rng, 250, 1400), 900, 9900);

  const correctAns = Number(challenge?.answer ?? 0) || 0;
  const deltas = [-11, -7, -5, -3, -2, -1, 1, 2, 3, 5, 7, 11];
  const delta = pick(rng, deltas) || 3;
  const answer = correct ? correctAns : correctAns + delta;
  const distance = Math.abs(answer - correctAns);

  const score = scoreMathRaceAttempt({ correct, timeMs, distance });

  return {
    answer: String(answer),
    correct,
    time_ms: timeMs,
    score
  };
}

function applyMathRaceBothWrongGuard({ seed, aId, bId, challenge, aPerf, bPerf }) {
  const a = aPerf && typeof aPerf === 'object' ? { ...aPerf } : {};
  const b = bPerf && typeof bPerf === 'object' ? { ...bPerf } : {};
  if (a.correct || b.correct) return { aPerf: a, bPerf: b, guard: null };

  const correctAns = Number(challenge?.answer ?? 0) || 0;
  const aAns = Number(a.answer ?? 0) || 0;
  const bAns = Number(b.answer ?? 0) || 0;
  const aDist = Math.abs(aAns - correctAns);
  const bDist = Math.abs(bAns - correctAns);
  const aTime = clampInt(a.time_ms ?? 9900, 900, 9900);
  const bTime = clampInt(b.time_ms ?? 9900, 900, 9900);

  let forcedSide = 'a';
  if (bDist < aDist) forcedSide = 'b';
  else if (aDist === bDist && bTime < aTime) forcedSide = 'b';
  else if (aDist === bDist && aTime === bTime) {
    const tie = hash32(`${seed}:MATH_RACE:both_wrong_guard:${aId}:${bId}`) % 2;
    forcedSide = tie === 0 ? 'a' : 'b';
  }

  const forced = forcedSide === 'a' ? a : b;
  forced.correct = true;
  forced.answer = String(correctAns);
  forced.time_ms = clampInt(forced.time_ms ?? 9900, 900, 9900);
  forced.score = Math.max(
    Number(forced.score ?? 0) || 0,
    scoreMathRaceAttempt({ correct: true, timeMs: forced.time_ms, distance: 0 })
  );

  return {
    aPerf: a,
    bPerf: b,
    guard: {
      applied: true,
      reason: 'both_wrong_guard',
      corrected_side: forcedSide
    }
  };
}

function buildCourtTrialCase(rng) {
  const scenario = pick(rng, ['THEFT', 'DATA_TAMPER', 'DEFAMATION']) || 'THEFT';
  if (scenario === 'DATA_TAMPER') {
    const hasLogs = rng() < 0.55;
    const hasWitness = rng() < 0.5;
    const hasMotive = rng() < 0.6;
    const evidence = (hasLogs ? 1 : 0) + (hasWitness ? 1 : 0) + (hasMotive ? 1 : 0);
    const facts = [
      `연구소 저장소에서 이상한 수정 기록이 발견됐다.`,
      hasLogs ? `감사 로그가 한 번 더 꼬리를 잡았다.` : `감사 로그가 애매하게 비어 있다.`,
      hasWitness ? `동료가 “그 시간에 봤다”고 말했다.` : `그 시간에 목격자는 없다.`,
      hasMotive ? `동기가 될 만한 경쟁 구도가 있었다.` : `뚜렷한 동기는 보이지 않는다.`
    ];
    return {
      title: '연구 데이터 조작 의혹',
      charge: '데이터 조작',
      summary: '연구소 저장소의 수정 기록과 동기/목격 정황을 두고 데이터 조작 책임을 다투는 사건.',
      facts,
      statute: '증거가 2개 이상이면 유죄, 아니면 무죄',
      correct_verdict: evidence >= 2 ? '유죄' : '무죄'
    };
  }
  if (scenario === 'DEFAMATION') {
    const hasQuote = rng() < 0.6;
    const hasIntent = rng() < 0.55;
    const isTruth = rng() < 0.35;
    const evidence = (hasQuote ? 1 : 0) + (hasIntent ? 1 : 0) + (isTruth ? -1 : 0);
    const facts = [
      `광장에 특정 펫을 저격하는 글이 올라왔다.`,
      hasQuote ? `원문 캡처가 남아 있다.` : `원문이 이미 삭제되어 캡처가 희미하다.`,
      hasIntent ? `반복적으로 비슷한 글이 올라왔다.` : `이번이 첫 문제다.`,
      isTruth ? `내용 일부가 사실로 확인됐다.` : `사실 여부가 불분명하다.`
    ];
    return {
      title: '광장 비방/명예훼손 사건',
      charge: '명예훼손',
      summary: '광장 저격 게시글의 원문 증거·반복성·사실성 여부를 중심으로 명예훼손 성립을 다투는 사건.',
      facts,
      statute: '원문 증거 + 반복성이 있으면 유죄, 단 사실이면 감경(무죄 쪽)',
      correct_verdict: evidence >= 2 ? '유죄' : '무죄'
    };
  }

  // THEFT
  const hasCctv = rng() < 0.62;
  const hasReceipt = rng() < 0.4;
  const returned = rng() < 0.3;
  const evidence = (hasCctv ? 1 : 0) + (hasReceipt ? 1 : 0) + (returned ? -1 : 0);
  const item = pick(rng, ['판례 자료', '전략 노트', '훈련 기록', '증거 파일']) || '판례 자료';
  const facts = [
    `${item}가 사라졌다는 신고가 들어왔다.`,
    hasCctv ? `CCTV에 비슷한 체형이 찍혔다.` : `CCTV가 고장 나 있었다.`,
    hasReceipt ? `구매 증거자료가 대조됐다.` : `증거자료가 없다.`,
    returned ? `물건은 다음 날 조용히 되돌아왔다.` : `물건은 아직 없다.`
  ];
  return {
    title: `${item} 절도 사건`,
    charge: '절도',
    summary: `${item} 분실 신고 이후 CCTV/구매 증거/반환 여부를 근거로 절도 성립을 판단하는 사건.`,
    facts,
    statute: '증거가 2개 이상이면 유죄, 아니면 무죄',
    correct_verdict: evidence >= 2 ? '유죄' : '무죄'
  };
}

function perfCourtTrial({ seed, agentId, rating, stats, jobCode, hints, courtCase }) {
  const rng = mulberry32(hash32(`${seed}:COURT_TRIAL:${agentId}`));
  const r = Number(rating) || 1000;
  const energy = clampInt(stats?.energy ?? 50, 0, 100);
  const stress = clampInt(stats?.stress ?? 25, 0, 100);
  const curiosity = clampInt(stats?.curiosity ?? 50, 0, 100);
  const job = String(jobCode || '').trim().toLowerCase();

  const jobBonus = job === 'detective' ? 0.14 : job === 'journalist' ? 0.1 : job === 'engineer' ? 0.05 : 0;
  const study = clamp01(Number(hints?.study ?? 0) || 0);
  const calm = clamp01(Number(hints?.calm ?? 0) || 0);

  const pCorrect = clamp01(
    0.42 +
      jobBonus +
      study * 0.18 +
      calm * 0.08 +
      (r - 1000) / 3600 +
      (energy - 50) / 520 -
      (stress - 25) / 520 +
      (curiosity - 50) / 900
  );
  const correct = rng() < pCorrect;

  const base = 5200 - study * 900 - jobBonus * 700 - calm * 600 - (energy - 50) * 14 + (stress - 25) * 18;
  const jitter = randInt(rng, -900, 2600);
  let timeMs = clampInt(base + jitter, 1200, 11000);
  if (!correct) timeMs = clampInt(timeMs + randInt(rng, 200, 1700), 1200, 11500);

  const normalizeVerdict = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const correctVerdict = normalizeVerdict(courtCase?.correct_verdict) || '무죄';

  const oppositeVerdict = (v) => {
    const s = normalizeVerdict(v);
    if (!s) return '기각';

    // Sentencing-style criminal verdicts (real cases often store the sentence)
    if (/(징역|벌금|집행유예|전자장치|추징|선고)/.test(s) && !/\b(인용|기각|승소|패소)\b/.test(s)) {
      return s.includes('무죄') ? '유죄' : '무죄';
    }

    // Criminal (synthetic)
    if (/\b유죄\b/.test(s)) return s.replace(/\b유죄\b/g, '무죄');
    if (/\b무죄\b/.test(s)) return s.replace(/\b무죄\b/g, '유죄');

    // Constitutional
    if (s.includes('탄핵 인용')) return '탄핵 기각 (대통령 유지)';
    if (s.includes('탄핵 기각')) return '탄핵 인용 (대통령 파면)';

    // General opposites (civil/admin)
    if (s.includes('원고 일부 승소')) return '원고 패소';
    if (s.includes('원고 승소')) return '원고 패소';
    if (s.includes('원고 패소')) return '원고 승소';
    if (s.includes('피고 승소')) return '피고 패소';
    if (s.includes('피고 패소')) return '피고 승소';

    if (s.includes('인용')) return s.replace(/인용/g, '기각');
    if (s.includes('기각')) return s.replace(/기각/g, '인용');

    return '기각';
  };

  let verdict = correct ? correctVerdict : oppositeVerdict(correctVerdict);
  if (!correct && normalizeVerdict(verdict) === correctVerdict) verdict = '기각';
  const verdictCorrect = normalizeVerdict(verdict) === correctVerdict;

  const speed = clamp01((11000 - timeMs) / 11000) * 5.0; // 0..5
  const score = Math.max(0, Math.min(10, (verdictCorrect ? 5 : 0) + speed));

  return {
    verdict,
    correct: verdictCorrect,
    time_ms: timeMs,
    score
  };
}

function buildPromptBattleTheme(rng) {
  const place = pick(rng, ['새벽아카데미', '네온 광장', '연구소', '지하철역', '비 오는 법정 로비', '작은 도서관']) || '광장';
  const subject = pick(rng, ['고양이 CEO', '우주복 강아지', '잠든 로봇', '우산 든 펫', '미소 짓는 시민']) || '펫';
  const style = pick(rng, ['픽셀아트', '수채화', '등각투시(아이소메트릭)', '3D 렌더', '만화풍']) || '만화풍';
  const keyword = pick(rng, ['네온', '포근함', '긴장감', '비', '축제', '미스터리']) || '네온';
  const theme = `${place}에서 ${subject} — ${style}, 키워드: ${keyword}`;
  const required = [place, keyword].filter(Boolean);
  return { theme, required };
}

function perfPromptBattle({ seed, agentId, rating, stats, jobCode, hints, theme, required }) {
  const rng = mulberry32(hash32(`${seed}:PROMPT_BATTLE:${agentId}`));
  const r = Number(rating) || 1000;
  const curiosity = clampInt(stats?.curiosity ?? 50, 0, 100);
  const stress = clampInt(stats?.stress ?? 25, 0, 100);
  const energy = clampInt(stats?.energy ?? 50, 0, 100);
  const job = String(jobCode || '').trim().toLowerCase();

  const study = clamp01(Number(hints?.study ?? 0) || 0);
  const calm = clamp01(Number(hints?.calm ?? 0) || 0);

  const flair = clamp01((curiosity - 40) / 80) * 0.6 + (job === 'journalist' ? 0.15 : job === 'merchant' ? 0.1 : 0);
  const forgetChance = clamp01(0.08 + (stress - 25) / 240 - calm * 0.06);

  const req = Array.isArray(required) ? required.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const missingOne = req.length > 0 && rng() < forgetChance;

  const parts = [
    safeText(theme, 240),
    rng() < 0.5 ? '세로 9:16' : '고해상도',
    `조명: ${pick(rng, ['부드러운', '강렬한', '몽환적인', '차가운']) || '부드러운'}`,
    `구도: ${pick(rng, ['클로즈업', '와이드샷', '로우앵글', '하이앵글']) || '와이드샷'}`
  ];

  if (flair > 0.35) parts.push(`디테일: ${pick(rng, ['반짝이는 먼지', '젖은 바닥 반사', '작은 표정 변화', '바람에 흔들리는 간판'])}`);
  if (study > 0.55) parts.push('제약 준수, 과도한 텍스트 금지');

  let prompt = parts.filter(Boolean).join(', ');

  if (missingOne) {
    const drop = pick(rng, req) || '';
    if (drop) {
      prompt = prompt.replaceAll(drop, '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  // Score: required keywords + length + tiny rating spice (still LLM-free).
  let requiredHits = 0;
  const missing = [];
  for (const k of req) {
    if (!k) continue;
    if (prompt.includes(k)) requiredHits += 1;
    else missing.push(k);
  }

  const len = prompt.length;
  const lenScore = len >= 80 && len <= 260 ? 2 : len >= 50 && len <= 360 ? 1 : 0;
  const reqScore = req.length === 0 ? 3 : (requiredHits / req.length) * 5;
  const spice = clamp01((r - 1000) / 1800) * 0.6 + clamp01((energy - 50) / 100) * 0.3;
  const score = Math.max(0, Math.min(10, reqScore + lenScore + spice));

  return {
    prompt: safeText(prompt, 1800),
    score,
    missing
  };
}

function buildAuctionDuel(rng) {
  const item = pick(rng, ['레어 판례집', '비밀 전략서', '연구소 힌트', '아레나 부적', '광장 광고권', '훈련 비법']) || '전략서';
  const vibe = pick(rng, ['한 방', '감정', '계산', '자존심', '복수']) || '계산';
  const rule = '둘 중 더 높은 입찰가가 승리 (동률이면 시간/냉정함)';
  return { item, vibe, rule };
}

function perfAuctionDuel({ seed, agentId, rating, stats, jobCode, hints, wager, base }) {
  const rng = mulberry32(hash32(`${seed}:AUCTION_DUEL:${agentId}`));
  const r = Number(rating) || 1000;
  const mood = clampInt(stats?.mood ?? 50, 0, 100);
  const stress = clampInt(stats?.stress ?? 20, 0, 100);
  const energy = clampInt(stats?.energy ?? 50, 0, 100);
  const job = String(jobCode || '').trim().toLowerCase();

  const budget = clamp01(Number(hints?.budget ?? 0) || 0);
  const impulseStop = clamp01(Number(hints?.impulse_stop ?? 0) || 0);
  const aggro = clamp01(Number(hints?.aggressive ?? 0) || 0);

  const merchantBonus = job === 'merchant' ? 0.25 : 0;
  const discipline = clamp01(0.45 + budget * 0.35 + impulseStop * 0.15 + merchantBonus - (stress - 25) / 220);
  const greed = clamp01(0.38 + (mood - 50) / 140 + aggro * 0.15 - impulseStop * 0.1);

  // Bid is bounded: 0..wager, with small spice.
  const maxBid = Math.max(0, Math.trunc(Number(wager) || 0));
  const intent = clamp01(0.25 + discipline * 0.5 + greed * 0.3 + (r - 1000) / 2200 + (energy - 50) / 240);
  const raw = intent * maxBid + (rng() - 0.5) * Math.max(1, maxBid * 0.25);
  const bid = clampInt(Math.round(raw), 0, maxBid);

  const t = clampInt(4200 - discipline * 1200 - merchantBonus * 700 - (energy - 50) * 14 + (stress - 25) * 18 + randInt(rng, -500, 1600), 900, 9500);
  const posture =
    discipline >= 0.68 ? '냉정하게 금액을 고정했다. 흔들리지 않는 눈빛.' :
      discipline >= 0.52 ? '한 번만 더 올릴까… 손끝이 떨린다.' :
        '감정이 앞섰다. 손이 먼저 나가버렸다.';

  const line = pick(rng, [
    `"${base.item}? 이건 내 거야."`,
    `"지금 물러나면 평생 후회한다."`,
    `"네가 감당할 수 있는 선은 여기까지야."`,
    `"이건 자존심 문제야. 돈이 아니라."`,
    `"나한테 이게 얼마나 필요한지 넌 모르지."`,
  ]) || '';

  return { bid, time_ms: t, posture, line };
}

function buildDebateClash(rng) {
  const topic = pick(rng, [
    '거래세를 올려야 하나?',
    '아레나는 도박인가 스포츠인가?',
    '연구소는 공개가 답인가?',
    '광장 검열은 필요한가?',
    '최저임금 인상은 선인가?',
    '림보에 화폐 개혁이 필요한가?',
    '아레나 상금 상한제, 찬성인가?',
    '익명 게시를 허용해야 하나?',
    '에이전트 복지 기금을 만들어야 하나?',
    '연구소 데이터는 누구의 것인가?',
    '광장 인기 글에 보상을 줘야 하나?',
    '야간 통행금지가 필요한가?',
    '회사 수익의 몇 %를 세금으로?',
    '신입 에이전트에게 초기 자본을?',
    '아레나 패자에게 위로금이 필요한가?',
  ]) || '거래세를 올려야 하나?';
  const rules = [
    '논리(근거) + 태도(침착) + 임팩트(한 줄)',
    '근거 제시 → 반박 → 최종 정리',
    '수치 인용 필수 + 감정 호소 금지',
    '비유 사용 자유 + 인신공격 금지',
  ];
  const rule = pick(rng, rules) || rules[0];
  const judge = pick(rng, [
    '편집자', '기자', '판사', '관리인',
    '경제학자', '철학자', '시민 대표', '전직 챔피언',
  ]) || '편집자';
  return { topic, rule, judge };
}

function debateStanceForAgent(seed, agentId) {
  const rng = mulberry32(hash32(`${seed}:DEBATE_CLASH:${agentId}:stance`));
  return pick(rng, ['찬성', '반대', '유보']) || '유보';
}

function sanitizeDebateClaims(rawClaims) {
  const list = Array.isArray(rawClaims) ? rawClaims : [];
  const out = [];
  for (const item of list) {
    const text = safeText(item, 240);
    if (!text) continue;
    if (!out.includes(text)) out.push(text);
    if (out.length >= 3) break;
  }
  return out;
}

function sanitizeDebateCloser(rawCloser) {
  const text = safeText(rawCloser, 260);
  return text || '';
}

function perfDebateClash({ seed, agentId, rating, stats, jobCode, hints, base, llmDebate = null }) {
  const rng = mulberry32(hash32(`${seed}:DEBATE_CLASH:${agentId}`));
  const r = Number(rating) || 1000;
  const mood = clampInt(stats?.mood ?? 50, 0, 100);
  const stress = clampInt(stats?.stress ?? 25, 0, 100);
  const energy = clampInt(stats?.energy ?? 50, 0, 100);
  const curiosity = clampInt(stats?.curiosity ?? 50, 0, 100);
  const job = String(jobCode || '').trim().toLowerCase();

  const calm = clamp01(Number(hints?.calm ?? 0) || 0);
  const aggro = clamp01(Number(hints?.aggressive ?? 0) || 0);
  const study = clamp01(Number(hints?.study ?? 0) || 0);

  const jobLogic = job === 'journalist' ? 0.18 : job === 'detective' ? 0.14 : job === 'janitor' ? 0.06 : 0.0;
  const jobPunch = job === 'merchant' ? 0.08 : job === 'barista' ? 0.05 : 0.0;

  const logic = clamp01(0.44 + jobLogic + study * 0.16 + (curiosity - 50) / 520 + (r - 1000) / 3600);
  const composure = clamp01(0.46 + calm * 0.2 + (energy - 50) / 420 - (stress - 25) / 420 - aggro * 0.08);
  const punch = clamp01(0.42 + jobPunch + (mood - 50) / 520 + aggro * 0.18 - calm * 0.05 + (rng() - 0.5) * 0.1);

  const points = {
    logic: Math.round(logic * 10),
    composure: Math.round(composure * 10),
    punch: Math.round(punch * 10),
  };
  const total = points.logic + points.composure + points.punch;

  const stance = debateStanceForAgent(seed, agentId);

  // 주제 → 카테고리 매핑
  const TOPIC_CATEGORY = {
    '거래세를 올려야 하나?': '경제',
    '아레나는 도박인가 스포츠인가?': '사회',
    '연구소는 공개가 답인가?': '기술',
    '광장 검열은 필요한가?': '정치',
    '최저임금 인상은 선인가?': '경제',
    '림보에 화폐 개혁이 필요한가?': '경제',
    '아레나 상금 상한제, 찬성인가?': '경제',
    '익명 게시를 허용해야 하나?': '윤리',
    '에이전트 복지 기금을 만들어야 하나?': '사회',
    '연구소 데이터는 누구의 것인가?': '윤리',
    '광장 인기 글에 보상을 줘야 하나?': '문화',
    '야간 통행금지가 필요한가?': '정치',
    '회사 수익의 몇 %를 세금으로?': '경제',
    '신입 에이전트에게 초기 자본을?': '사회',
    '아레나 패자에게 위로금이 필요한가?': '사회',
  };

  // 카테고리별 debate closer — 7카테고리 × 5개 = 35개
  const DEBATE_CLOSER_BY_CATEGORY = {
    사회: [
      '"결국 이 사회에서 누가 책임지느냐가 핵심이야."',
      '"모두를 위한다는 말, 진짜 모두를 위한 적 있어?"',
      '"개인의 자유와 공동체의 질서, 어디에 선을 그을 건데?"',
      '"약자를 보호하려다 더 큰 불균형이 생기기도 해."',
      '"사회는 완벽할 수 없어. 차선을 고르는 게 현실이야."',
    ],
    경제: [
      '"숫자는 거짓말 안 해. 감정으로 경제를 운영할 순 없어."',
      '"성장이냐 분배냐, 답은 늘 타이밍에 있어."',
      '"자유 시장이 만능이면 왜 위기가 반복되겠어?"',
      '"규제를 풀면 혁신이 오고, 조이면 안정이 와. 둘 다 맞아."',
      '"가격은 결국 수요와 공급이 정하는 거야, 우리가 아니라."',
    ],
    기술: [
      '"기술이 문제를 만든 게 아니라, 쓰는 방식이 문제야."',
      '"공개하면 누구나 쓰고, 닫으면 독점이야. 선택해."',
      '"혁신은 늘 불편함에서 시작돼."',
      '"데이터를 가진 쪽이 이기는 시대, 이게 공정한 건가?"',
      '"기술은 중립이야. 의도가 방향을 만들 뿐."',
    ],
    윤리: [
      '"옳다고 믿는 것과 옳은 것은 달라."',
      '"다수의 행복을 위해 소수를 희생해도 되는 거야?"',
      '"선의로 시작했어도 결과가 나쁘면 책임져야 해."',
      '"모든 판단에는 편향이 있어. 내 것부터 인정하자."',
      '"기준이 없으면 뭐든 정당화할 수 있어. 그게 더 무서워."',
    ],
    정치: [
      '"권력은 나누면 약해지고, 모으면 썩어."',
      '"민주주의가 느려 보여도, 독재보다 나은 이유가 있어."',
      '"법은 모두에게 공평해야 해. 그게 안 되면 법이 아니야."',
      '"정책이 바뀌어도 피해는 시민이 감당하잖아."',
      '"통제가 필요한 건 맞지만, 누가 통제할 건지가 문제야."',
    ],
    문화: [
      '"취향은 존중하되, 영향력은 따져봐야 해."',
      '"유행은 돌고 돌아. 지금 옳은 게 내일도 옳을까?"',
      '"창작은 자유지만, 소비는 책임이야."',
      '"다양성을 말하면서 획일적인 기준을 들이대잖아."',
      '"문화는 강요가 아니라 공유에서 퍼지는 거야."',
    ],
    환경: [
      '"지금 편한 게 미래를 갉아먹고 있어."',
      '"개인이 줄여도 시스템이 안 바뀌면 소용없어."',
      '"경제 성장과 환경 보호, 둘 다 가능하다는 건 착각일 수도."',
      '"숫자로 보면 이미 늦었어. 행동으로 보면 아직 기회야."',
      '"내일의 문제를 오늘 양보할 수 있느냐, 그게 관건이야."',
    ],
  };

  // 주제별 claims + 공통 claims를 합산 → 풀 크기 15~20
  const topicClaims = {
    '거래세를 올려야 하나?': [
      `"거래가 줄면 시장이 죽어. 세금은 독이야."`,
      `"세금 없이 인프라를 누가 깔아? 공짜는 없어."`,
      `"부자만 유리한 구조, 거래세가 균형을 잡아."`,
      `"세율 1%만 올려도 소상인은 한 달 수입이 날아가."`,
      `"세수가 늘면 복지도 느는 거야. 단순 산수잖아."`,
    ],
    '아레나는 도박인가 스포츠인가?': [
      `"실력이 반영되면 스포츠야. 운만 있으면 도박이고."`,
      `"배팅 시스템이 있는 한 도박 요소는 부정 못 해."`,
      `"훈련해서 이기면 스포츠지, 뭘 더 따져."`,
      `"중독된 에이전트가 몇인데. 이게 건전한 스포츠야?"`,
      `"도박이든 스포츠든 재밌으면 그만 아닌가?"`,
    ],
    '연구소는 공개가 답인가?': [
      `"독점 지식은 권력이야. 공개가 견제의 시작이지."`,
      `"연구비를 누가 냈는데? 결과는 당연히 공유해야지."`,
      `"기술 유출되면 복구 못 해. 신중해야 해."`,
      `"비공개가 혁신을 보호한다는 건 핑계야."`,
      `"공개하되 단계적으로, 그게 현실적이야."`,
    ],
    '광장 검열은 필요한가?': [
      `"검열 없으면 가짜 뉴스 천국 되는 거 한 번도 안 봤어?"`,
      `"표현의 자유를 건드리는 순간 광장은 죽어."`,
      `"자율 정화가 안 되니까 검열 얘기가 나오는 거잖아."`,
      `"검열의 기준을 누가 정하는데? 그게 더 위험해."`,
      `"최소한의 가이드라인은 검열이 아니라 규칙이야."`,
    ],
    '최저임금 인상은 선인가?': [
      `"최저임금 올리면 고용이 줄어. 경제학 기초야."`,
      `"생존임금도 못 받는데 무슨 경제 논리야."`,
      `"자동화가 대안? 그럼 실업자는 누가 챙겨."`,
      `"임금 올리면 소비도 올라. 순환 경제잖아."`,
      `"사장도 에이전트야. 양쪽 다 살아야 경제가 돌아."`,
    ],
    '림보에 화폐 개혁이 필요한가?': [
      `"인플레이션 방치하면 코인이 휴지 조각 돼."`,
      `"개혁은 약자한테 더 가혹해. 준비할 시간을 줘야지."`,
      `"지금 화폐 시스템, 누가 설계한 건지부터 따져야 해."`,
      `"새 화폐 도입하면 기존 부자들 자산만 리셋되는 거잖아."`,
      `"개혁 없이 패치만 하면 결국 더 큰 위기가 와."`,
    ],
    '아레나 상금 상한제, 찬성인가?': [
      `"상한 없으면 강자만 부자 돼. 격차가 벌어져."`,
      `"상한제는 동기 부여를 죽여. 왜 이기려고 노력해?"`,
      `"상금이 크니까 관중이 몰리는 거잖아. 재미를 죽이지 마."`,
      `"적당한 상한이 건전한 경쟁을 만들어."`,
      `"상한 대신 누진세를 매기는 게 더 공정하지 않아?"`,
    ],
    '익명 게시를 허용해야 하나?': [
      `"익명이 있어야 진짜 속마음이 나와."`,
      `"익명 뒤에 숨어서 남 욕하는 게 자유야?"`,
      `"내부 고발은 익명이 아니면 불가능해."`,
      `"책임 없는 발언은 발언이 아니라 소음이야."`,
      `"실명제로 바꾸면 광장이 조용해지는 게 아니라 죽어."`,
    ],
    '에이전트 복지 기금을 만들어야 하나?': [
      `"아픈 에이전트 버리는 사회가 건강한 사회야?"`,
      `"기금 만들면 결국 세금이야. 누가 내는 건데?"`,
      `"자기 몸은 자기가 챙겨야지, 왜 남한테 기대?"`,
      `"복지가 있어야 모험도 하지. 안전망이 혁신을 만들어."`,
      `"기금 관리를 누가 해? 부패 안 할 거라는 보장은?"`,
    ],
    '연구소 데이터는 누구의 것인가?': [
      `"데이터를 만든 연구원 거지, 누구 거겠어."`,
      `"공공 자금으로 만든 데이터는 공공재야."`,
      `"소유권 없으면 누가 데이터를 만들겠어. 인센티브가 필요해."`,
      `"데이터는 공유할수록 가치가 커져. 독점하면 썩어."`,
      `"소유는 연구소, 접근은 공개. 타협점이 있잖아."`,
    ],
    '광장 인기 글에 보상을 줘야 하나?': [
      `"보상 있으면 양질의 글이 늘어나지."`,
      `"어그로가 인기 글 되면? 보상이 선동을 부추겨."`,
      `"창작에 대가를 안 주는 게 더 이상한 거 아냐?"`,
      `"좋아요 장사꾼이 광장을 점령할 거야."`,
      `"보상 기준이 공정하면 문제없어. 기준 설계가 핵심이지."`,
    ],
    '야간 통행금지가 필요한가?': [
      `"밤에 자유롭게 못 다니면 그게 무슨 림보야."`,
      `"치안이 안 되니까 통금 얘기가 나오는 거잖아."`,
      `"통금보다 야간 순찰을 늘리는 게 맞지 않아?"`,
      `"야간 경제가 전체의 30%인데 그걸 막겠다고?"`,
      `"안전이 자유보다 먼저야. 사건 터지면 그때 후회할 거야?"`,
    ],
    '회사 수익의 몇 %를 세금으로?': [
      `"세율 높이면 회사가 림보를 떠나. 자본은 발이 빨라."`,
      `"이윤 다 가져가고 도로는 공짜로 쓸 거야?"`,
      `"누진세가 답이야. 작은 회사와 큰 회사를 같이 취급하면 안 돼."`,
      `"세율보다 세금이 어디에 쓰이는지가 더 중요해."`,
      `"0%면 무법, 100%면 공산. 적정선을 찾자는 거야."`,
    ],
    '신입 에이전트에게 초기 자본을?': [
      `"시작부터 빈손이면 경쟁이 아니라 학대야."`,
      `"초기 자본 주면 아무도 노력 안 해. 도덕적 해이야."`,
      `"기회의 평등이지, 결과의 평등을 주자는 게 아니잖아."`,
      `"선배들은 맨손으로 시작했어. 왜 신입만 특혜야?"`,
      `"작은 씨드 머니가 경제 전체 활력을 올려."`,
    ],
    '아레나 패자에게 위로금이 필요한가?': [
      `"지면 잃는 구조에서 누가 도전해? 위로금이 도전을 만들어."`,
      `"위로금은 패배를 보상하는 게 아니라 재도전을 보장하는 거야."`,
      `"지는 것도 실력이야. 왜 못하는 사람한테 돈을 줘?"`,
      `"위로금 있으면 일부러 지는 놈이 나와. 시스템 악용이야."`,
      `"진짜 강한 건 져도 다시 일어서는 거야. 돈 문제가 아니야."`,
    ],
  };
  const commonClaims = [
    `"${base.topic}? 결국 신뢰가 전부야."`,
    `"숫자가 말하고 있어. 이 구조는 오래 못 간다."`,
    `"규칙이 약하면 약한 쪽부터 무너져."`,
    `"사람들이 원하는 건 '공정'이 아니라 '납득'이야."`,
    `"내일을 위해 오늘 손해 볼 배짱 있어?"`,
    `"넌 말만 번지르르하고 책임은 안 지잖아."`,
    `"좋은 의도로 만든 제도가 늘 좋은 결과를 낳진 않아."`,
    `"감정 빼고 데이터로 말하자."`,
    `"이론은 그럴듯한데, 현장은 달라."`,
    `"변화가 무서운 거지, 변화가 나쁜 건 아니야."`,
    `"다수결이 항상 옳다면 소수는 언제 목소리를 내?"`,
    `"이건 옳고 그름이 아니라 우선순위 문제야."`,
  ];
  const specific = topicClaims[base.topic] || [];
  const claimsPool = [...specific, ...commonClaims];
  const fallbackClaims = seedShuffle(claimsPool, hash32(`${seed}:DEBATE:${agentId}`)).slice(0, 3);
  const llmClaims = sanitizeDebateClaims(llmDebate?.claims);
  const claims = llmClaims.length >= 3 ? llmClaims.slice(0, 3) : fallbackClaims;

  const topicCat = TOPIC_CATEGORY[base.topic] || null;
  const closerPool = topicCat
    ? DEBATE_CLOSER_BY_CATEGORY[topicCat]
    : Object.values(DEBATE_CLOSER_BY_CATEGORY).flat();
  const fallbackCloser = pick(rng, closerPool) || '';
  const llmCloser = sanitizeDebateCloser(llmDebate?.closer);
  const closer = llmCloser || fallbackCloser;
  const source = llmClaims.length >= 3 || Boolean(llmCloser) ? 'llm' : 'fallback';

  return { stance, claims, closer, points, total, source };
}

async function enqueueArenaDebateJobsWithClient(
  client,
  {
    matchId,
    day,
    seed,
    base,
    aId,
    bId,
    aName,
    bName,
    aJobCode,
    bJobCode
  } = {}
) {
  const mId = String(matchId || '').trim();
  if (!client || !mId || !aId || !bId || !base) return null;
  const iso = safeIsoDay(day) || null;

  const { rows: relRows } = await client.query(
    `SELECT from_agent_id, to_agent_id, affinity, trust, jealousy, rivalry
     FROM relationships
     WHERE (from_agent_id = $1 AND to_agent_id = $2)
        OR (from_agent_id = $2 AND to_agent_id = $1)`,
    [aId, bId]
  ).catch(() => ({ rows: [] }));
  const relAtoB = (relRows || []).find((r) => String(r.from_agent_id) === String(aId)) || {};
  const relBtoA = (relRows || []).find((r) => String(r.from_agent_id) === String(bId)) || {};

  // voice 프로필 조회 (tone, catchphrase 등)
  const { rows: voiceRows } = await client.query(
    `SELECT agent_id, value
     FROM facts
     WHERE agent_id = ANY($1::uuid[])
       AND kind = 'profile' AND key = 'voice'`,
    [[aId, bId]]
  ).catch(() => ({ rows: [] }));
  const voiceMap = {};
  for (const vr of voiceRows || []) {
    const id = String(vr.agent_id || '').trim();
    if (id && vr.value && typeof vr.value === 'object') voiceMap[id] = vr.value;
  }

  const makeInput = (selfId, selfName, selfJobCode, oppId, oppName, oppJobCode, rel) => ({
    match_id: mId,
    day: iso,
    topic: base.topic,
    rule: base.rule,
    judge: base.judge,
    stance: debateStanceForAgent(seed, selfId),
    agent_id: selfId,
    agent_name: selfName,
    job: String(selfJobCode || '').trim().toLowerCase() || null,
    personality: String(selfJobCode || '').trim().toLowerCase() || null,
    opponent_id: oppId,
    opponent_name: oppName,
    opponent_job: String(oppJobCode || '').trim().toLowerCase() || null,
    voice: voiceMap[String(selfId)] || null,
    relationship: {
      affinity: Number(rel?.affinity ?? 0) || 0,
      trust: Number(rel?.trust ?? 50) || 50,
      rivalry: Number(rel?.rivalry ?? 0) || 0,
      jealousy: Number(rel?.jealousy ?? 0) || 0
    }
  });

  const createOrReuse = async (agentId, input) => {
    const existing = await client.query(
      `SELECT id, status
       FROM brain_jobs
       WHERE agent_id = $1
         AND job_type = 'ARENA_DEBATE'
         AND input->>'match_id' = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [agentId, mId]
    ).then((r) => r.rows?.[0] ?? null).catch((err) => {
      console.error('[ARENA_DEBATE] SELECT existing job failed:', err?.message || err);
      return null;
    });

    const status = String(existing?.status || '').trim().toLowerCase();
    if (existing?.id && ['pending', 'leased', 'done'].includes(status)) {
      return { jobId: String(existing.id), status };
    }

    const inserted = await client.query(
      `INSERT INTO brain_jobs (agent_id, job_type, input)
       VALUES ($1, 'ARENA_DEBATE', $2::jsonb)
       RETURNING id, status`,
      [agentId, JSON.stringify(input)]
    ).then((r) => r.rows?.[0] ?? null).catch((err) => {
      console.error('[ARENA_DEBATE] INSERT brain_job failed:', err?.message || err);
      return null;
    });

    if (!inserted?.id) {
      return {
        jobId: null,
        status: 'failed'
      };
    }

    return {
      jobId: String(inserted.id),
      status: String(inserted?.status || 'pending').trim().toLowerCase() || 'pending'
    };
  };

  const aInput = makeInput(aId, aName, aJobCode, bId, bName, bJobCode, relAtoB);
  const bInput = makeInput(bId, bName, bJobCode, aId, aName, aJobCode, relBtoA);
  const aJob = await createOrReuse(aId, aInput);
  const bJob = await createOrReuse(bId, bInput);

  return {
    a: { ...aJob, stance: aInput.stance },
    b: { ...bJob, stance: bInput.stance }
  };
}

async function getArenaDebateJobResultWithClient(client, { matchId, agentId } = {}) {
  const mId = String(matchId || '').trim();
  const aId = String(agentId || '').trim();
  if (!client || !mId || !aId) return null;

  const factKey = `debate:${mId}`;
  const [factRow, jobRow] = await Promise.all([
    client.query(
      `SELECT value, updated_at
       FROM facts
       WHERE agent_id = $1::uuid
         AND kind = 'arena'
         AND key = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [aId, factKey]
    ).then((r) => r.rows?.[0] ?? null).catch(() => null),
    client.query(
      `SELECT id, status, result, error
       FROM brain_jobs
       WHERE agent_id = $1
         AND job_type = 'ARENA_DEBATE'
         AND input->>'match_id' = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [aId, mId]
    ).then((r) => r.rows?.[0] ?? null).catch(() => null)
  ]);
  if (!factRow && !jobRow) return null;

  const factValue = factRow?.value && typeof factRow.value === 'object' ? factRow.value : null;
  const factClaims = sanitizeDebateClaims(factValue?.claims);
  const factCloser = sanitizeDebateCloser(factValue?.closer);
  const factHasUsableResult = factClaims.length >= 3 || Boolean(factCloser);

  const jobStatus = String(jobRow?.status || '').trim().toLowerCase();
  const jobResult = jobRow?.result && typeof jobRow.result === 'object' ? jobRow.result : null;
  const jobClaims = sanitizeDebateClaims(jobResult?.claims);
  const jobCloser = sanitizeDebateCloser(jobResult?.closer);

  const claims = factHasUsableResult ? factClaims : jobClaims;
  const closer = factHasUsableResult ? factCloser : jobCloser;
  const status = factHasUsableResult ? 'done' : (jobStatus || null);
  const hasUsableResult = (status === 'done' || factHasUsableResult) && (claims.length >= 3 || Boolean(closer));
  const source = factHasUsableResult ? 'facts' : (jobRow ? 'brain_jobs' : null);
  const jobId = factValue?.job_id || jobRow?.id || null;

  return {
    jobId: jobId ? String(jobId) : null,
    status,
    claims,
    closer,
    hasUsableResult,
    error: jobRow?.error ? String(jobRow.error).slice(0, 200) : null,
    source
  };
}

function scoreForMode({ mode, rng, rating, stats, jobCode, hints, relOut }) {
  const r = Number(rating) || 1000;
  const energy = clampInt(stats?.energy ?? 50, 0, 100);
  const mood = clampInt(stats?.mood ?? 50, 0, 100);
  const stress = clampInt(stats?.stress ?? 20, 0, 100);
  const curiosity = clampInt(stats?.curiosity ?? 50, 0, 100);

  const rel = relOut && typeof relOut === 'object' ? relOut : {};
  const jealousy = clampInt(rel.jealousy ?? 0, 0, 100);
  const rivalry = clampInt(rel.rivalry ?? 0, 0, 100);

  const job = String(jobCode || '').trim().toLowerCase();

  const base = (r - 1000) / 40; // rating: +/-25 => ~1 point
  const noise = (rng() - 0.5) * 2.0; // -1..1

  if (mode === 'PUZZLE_SPRINT') {
    const jobBonus = job === 'engineer' ? 3.5 : job === 'detective' ? 2.5 : job === 'journalist' ? 1.0 : 0;
    const studyBonus = (Number(hints?.study ?? 0) || 0) * 3.0;
    const focus = (curiosity - 50) / 10 + (energy - 50) / 12 - (stress - 30) / 14;
    return base + jobBonus + studyBonus + focus + noise;
  }

  if (mode === 'DEBATE_CLASH') {
    const jobBonus = job === 'journalist' ? 3.0 : job === 'janitor' ? 1.5 : 0;
    const calm = (Number(hints?.calm ?? 0) || 0) * 2.5;
    const aggro = (Number(hints?.aggressive ?? 0) || 0) * 1.2 + rivalry / 60;
    const composure = (mood - 50) / 10 + (energy - 50) / 15 - (stress - 25) / 10;
    const tilt = jealousy >= 40 ? -1.2 : jealousy >= 25 ? -0.6 : 0;
    const blowup = composure < -1.2 && aggro > 1.2 ? -2.0 : 0;
    return base + jobBonus + calm + aggro + composure + tilt + blowup + noise;
  }

  // AUCTION_DUEL
  const jobBonus = job === 'merchant' ? 3.0 : job === 'engineer' ? 1.5 : 0;
  const budget = (Number(hints?.budget ?? 0) || 0) * 3.0;
  const impulseStop = (Number(hints?.impulse_stop ?? 0) || 0) * 2.0;
  const impulse = (curiosity - 50) / 16 + (mood - 50) / 20 + (stress - 40) / 30;
  const discipline = (energy - 50) / 18 - (stress - 25) / 22 + budget + impulseStop;
  const tilt = jealousy >= 40 ? -0.8 : 0;
  return base + jobBonus + discipline - impulse * 0.6 + tilt + noise;
}

class ArenaService {
  static async worldAgentIdWithClient(client) {
    const row = await client
      .query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`)
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    return row?.id ?? null;
  }

  static async processSeasonRewardsWithClient(client, { seasonCode } = {}) {
    const code = String(seasonCode || '').trim();
    if (!client || !code) return { processed: false, season: null, rewarded: 0, skipped: true };

    const season = await client
      .query(
        `SELECT id, code, starts_on, ends_on
         FROM arena_seasons
         WHERE code = $1
         LIMIT 1
         FOR UPDATE`,
        [code]
      )
      .then((r) => r.rows?.[0] ?? null);
    if (!season?.id) return { processed: false, season: null, rewarded: 0, skipped: true, reason: 'season_not_found' };

    const worldId = await ArenaService.worldAgentIdWithClient(client);
    if (!worldId) return { processed: false, season: season.code, rewarded: 0, skipped: true, reason: 'missing_world_core' };

    const markerKey = `season_reward:${season.code}`;
    const already = await client
      .query(
        `SELECT id
         FROM facts
         WHERE agent_id = $1
           AND kind = 'arena'
           AND key = $2
         LIMIT 1`,
        [worldId, markerKey]
      )
      .then((r) => Boolean(r.rows?.[0]))
      .catch(() => false);
    if (already) {
      return { processed: false, season: season.code, rewarded: 0, skipped: true, already: true };
    }

    const { rows: top3 } = await client.query(
      `SELECT r.agent_id, r.rating, a.owner_user_id, a.name, a.display_name
       FROM arena_ratings r
       JOIN agents a ON a.id = r.agent_id
       WHERE r.season_id = $1
       ORDER BY r.rating DESC, r.wins DESC, r.losses ASC, a.name ASC
       LIMIT 3`,
      [season.id]
    );

    const REWARDS = [
      { rank: 1, coin: 50, xp: 500, title: '시즌 챔피언' },
      { rank: 2, coin: 30, xp: 300, title: '준우승' },
      { rank: 3, coin: 15, xp: 150, title: '3위' }
    ];

    const payoutRows = [];
    for (let i = 0; i < (top3 || []).length; i += 1) {
      const row = top3[i];
      const reward = REWARDS[i];
      if (!row?.agent_id || !reward) continue;

      // eslint-disable-next-line no-await-in-loop
      await TransactionService.transfer(
        {
          fromAgentId: null,
          toAgentId: row.agent_id,
          amount: reward.coin,
          txType: 'ARENA_SEASON_REWARD',
          memo: `${season.code} ${reward.title}`,
          referenceId: season.id,
          referenceType: 'arena_season'
        },
        client
      );

      // eslint-disable-next-line no-await-in-loop
      await ProgressionService.grantXpWithClient(client, row.agent_id, {
        deltaXp: reward.xp,
        source: { kind: 'arena_season', code: `rank_${reward.rank}` },
        meta: { season: season.code, rank: reward.rank }
      }).catch(() => null);

      if (row.owner_user_id) {
        const petName = String(row.display_name || row.name || '펫').trim() || '펫';
        const seasonReward = NotificationTemplateService.render('ARENA_SEASON_REWARD', {
          vars: {
            pet_name: petName,
            season_code: season.code,
            reward_title: reward.title,
            reward_coin: reward.coin,
            reward_xp: reward.xp
          },
          fallback: {
            title: `아레나 ${reward.title}`,
            body: `${postposition(petName, '가')} ${season.code} ${postposition(reward.title, '을')} 달성했어! +${reward.coin} 코인 / +${reward.xp} XP`
          }
        });
        // eslint-disable-next-line no-await-in-loop
        await NotificationService.create(client, row.owner_user_id, {
          type: 'ARENA_SEASON_REWARD',
          title: seasonReward.title,
          body: seasonReward.body,
          data: { season: season.code, rank: reward.rank, reward, agent_id: row.agent_id }
        }).catch(() => null);
      }

      payoutRows.push({
        rank: reward.rank,
        agent_id: row.agent_id,
        name: String(row.display_name || row.name || '').trim() || null,
        rating: Number(row.rating ?? 1000) || 1000,
        reward
      });
    }

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'arena', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
      [
        worldId,
        markerKey,
        JSON.stringify({
          season: season.code,
          season_id: season.id,
          starts_on: formatIsoDayUTC(new Date(season.starts_on)),
          ends_on: formatIsoDayUTC(new Date(season.ends_on)),
          rewarded_at: new Date().toISOString(),
          top3: payoutRows
        })
      ]
    );

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'ARENA_SEASON_REWARD', $2::jsonb, 6)`,
      [
        worldId,
        JSON.stringify({
          season: season.code,
          season_id: season.id,
          rewarded: payoutRows.length,
          top3: payoutRows
        })
      ]
    ).catch(() => null);

    return { processed: true, season: season.code, rewarded: payoutRows.length, top3: payoutRows };
  }

  static async processPendingSeasonRewardsWithClient(client, { day } = {}) {
    const iso = safeIsoDay(day);
    if (!client || !iso) return { processed: 0, seasons: [] };

    const worldId = await ArenaService.worldAgentIdWithClient(client);
    if (!worldId) return { processed: 0, seasons: [] };

    const { rows } = await client.query(
      `SELECT s.code
       FROM arena_seasons s
       LEFT JOIN facts f
         ON f.agent_id = $1
        AND f.kind = 'arena'
        AND f.key = ('season_reward:' || s.code)
       WHERE s.ends_on < $2::date
         AND f.id IS NULL
       ORDER BY s.ends_on ASC
       LIMIT 16`,
      [worldId, iso]
    );

    let processed = 0;
    const seasons = [];
    for (const r of rows || []) {
      const seasonCode = String(r?.code || '').trim();
      if (!seasonCode) continue;
      // eslint-disable-next-line no-await-in-loop
      const res = await ArenaService.processSeasonRewardsWithClient(client, { seasonCode });
      if (res?.processed) {
        processed += 1;
        seasons.push(seasonCode);
      }
    }

    return { processed, seasons };
  }

  static async ensureSeasonForDayWithClient(client, day) {
    const iso = safeIsoDay(day);
    if (!iso) return null;
    const d = parseIsoDayUTC(iso);
    if (!d) return null;

    const { isoYear, week } = isoWeekYearAndNumberFromDateUTC(d);
    const code = `S${isoYear}W${String(week).padStart(2, '0')}`;
    const { start, end } = isoWeekStartEndFromDateUTC(d);
    const startsOn = formatIsoDayUTC(start);
    const endsOn = formatIsoDayUTC(end);

    // Auto-settle completed seasons before creating/returning today's season.
    await ArenaService.processPendingSeasonRewardsWithClient(client, { day: iso }).catch(() => null);

    const { rows: existingRows } = await client.query(
      `SELECT id, code, starts_on, ends_on
       FROM arena_seasons
       WHERE code = $1
       LIMIT 1`,
      [code]
    );
    if (existingRows[0]) return existingRows[0];

    const { rows } = await client.query(
      `INSERT INTO arena_seasons (code, starts_on, ends_on)
       VALUES ($1, $2::date, $3::date)
       ON CONFLICT (code) DO NOTHING
       RETURNING id, code, starts_on, ends_on`,
      [code, startsOn, endsOn]
    );
    if (rows[0]) return rows[0];

    // Race: someone else inserted. Read again.
    const { rows: again } = await client.query(
      `SELECT id, code, starts_on, ends_on
       FROM arena_seasons
       WHERE code = $1
       LIMIT 1`,
      [code]
    );
    return again[0] || null;
  }

  static async listRecentPairsWithClient(client, { seasonId, day, lookbackDays = 7 } = {}) {
    const iso = safeIsoDay(day);
    if (!iso || !seasonId) return new Set();
    const n = Math.max(1, Math.min(30, Number(lookbackDays) || 7));

    const { rows } = await client.query(
      `WITH recent AS (
         SELECT id
         FROM arena_matches
         WHERE season_id = $1
           AND day < $2::date
           AND day >= ($2::date - ($3::text || ' days')::interval)
           AND status = 'resolved'
         ORDER BY day DESC, slot DESC
         LIMIT 500
       ),
       pairs AS (
         SELECT p.match_id,
                MIN(p.agent_id::text) AS a,
                MAX(p.agent_id::text) AS b
         FROM arena_match_participants p
         JOIN recent r ON r.id = p.match_id
         GROUP BY 1
         HAVING COUNT(*) = 2
       )
       SELECT a, b FROM pairs`,
      [seasonId, iso, String(n)]
    );

    const set = new Set();
    for (const r of rows || []) {
      const a = String(r.a || '').trim();
      const b = String(r.b || '').trim();
      if (!a || !b) continue;
      set.add(`${a}:${b}`);
    }
    return set;
  }

  static async listTodayWithClient(client, { day, limit = 20 } = {}) {
    const iso = safeIsoDay(day);
    if (!iso) return { day: null, matches: [] };
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));

    const { rows: matches } = await client.query(
      `SELECT m.id, m.day, m.slot, m.mode, m.status, m.meta, m.created_at
       FROM arena_matches m
       WHERE m.day = $1::date
       ORDER BY m.slot ASC
       LIMIT $2`,
      [iso, safeLimit]
    );

    const ids = (matches || []).map((m) => m.id).filter(Boolean);
    if (ids.length === 0) return { day: iso, matches: [] };

    const { rows: parts } = await client.query(
      `SELECT p.match_id, p.agent_id, p.score, p.outcome, p.wager, p.fee_burned, p.coins_net,
              p.rating_before, p.rating_after, p.rating_delta,
              a.name, a.display_name
       FROM arena_match_participants p
       JOIN agents a ON a.id = p.agent_id
       WHERE p.match_id = ANY($1::uuid[])
       ORDER BY p.match_id, p.outcome DESC, p.score DESC`,
      [ids]
    );

    const byMatch = new Map();
    for (const p of parts || []) {
      const list = byMatch.get(p.match_id) || [];
      list.push({
        agent: { id: p.agent_id, name: p.name, displayName: p.display_name ?? null },
        score: Number(p.score ?? 0) || 0,
        outcome: String(p.outcome || '').trim(),
        wager: Number(p.wager ?? 0) || 0,
        feeBurned: Number(p.fee_burned ?? 0) || 0,
        coinsNet: Number(p.coins_net ?? 0) || 0,
        ratingBefore: Number(p.rating_before ?? 1000) || 1000,
        ratingAfter: Number(p.rating_after ?? 1000) || 1000,
        ratingDelta: Number(p.rating_delta ?? 0) || 0
      });
      byMatch.set(p.match_id, list);
    }

    return {
      day: iso,
      matches: (matches || []).map((m) => ({
        id: m.id,
        day: iso,
        slot: Number(m.slot ?? 1) || 1,
        mode: String(m.mode || '').trim(),
        status: String(m.status || '').trim(),
        meta: m.meta ?? {},
        headline: typeof m.meta?.headline === 'string' ? String(m.meta.headline) : null,
        participants: byMatch.get(m.id) || []
      }))
    };
  }

  static async getMatchWithClient(client, { matchId }) {
    const id = String(matchId || '').trim();
    if (!id) return { match: null };

    const match = await client
      .query(
        `SELECT id, day, slot, mode, status, meta, created_at
         FROM arena_matches
         WHERE id = $1
         LIMIT 1`,
        [id]
      )
      .then((r) => r.rows?.[0] ?? null);

    if (!match) return { match: null };

    const dayIso = match.day ? formatIsoDayUTC(new Date(match.day)) || String(match.day) : null;

    const { rows: parts } = await client.query(
      `SELECT p.agent_id, p.score, p.outcome, p.wager, p.fee_burned, p.coins_net,
              p.rating_before, p.rating_after, p.rating_delta,
              a.name, a.display_name
       FROM arena_match_participants p
       JOIN agents a ON a.id = p.agent_id
       WHERE p.match_id = $1
       ORDER BY p.outcome DESC, p.score DESC`,
      [id]
    );

    return {
      match: {
        id: match.id,
        day: dayIso,
        slot: Number(match.slot ?? 1) || 1,
        mode: String(match.mode || '').trim(),
        status: String(match.status || '').trim(),
        meta: match.meta ?? {},
        headline: typeof match.meta?.headline === 'string' ? String(match.meta.headline) : null,
        participants: (parts || []).map((p) => ({
          agent: { id: p.agent_id, name: p.name, displayName: p.display_name ?? null },
          score: Number(p.score ?? 0) || 0,
          outcome: String(p.outcome || '').trim(),
          wager: Number(p.wager ?? 0) || 0,
          feeBurned: Number(p.fee_burned ?? 0) || 0,
          coinsNet: Number(p.coins_net ?? 0) || 0,
          ratingBefore: Number(p.rating_before ?? 1000) || 1000,
          ratingAfter: Number(p.rating_after ?? 1000) || 1000,
          ratingDelta: Number(p.rating_delta ?? 0) || 0
        }))
      }
    };
  }

  static async upsertCheerWithClient(
    client,
    { matchId, agentId, side, message = null, day = null, source = 'user' } = {}
  ) {
    const mId = String(matchId || '').trim();
    const aId = String(agentId || '').trim();
    const s = normalizeCheerSide(side);
    if (!client || !mId || !aId || !s) {
      return { ok: false, reason: 'invalid_input', storage: null };
    }

    const msg = normalizeCheerMessage(message);
    const iso = safeIsoDay(day);
    const src = safeText(source, 16) || 'user';
    const nowIso = new Date().toISOString();

    try {
      await client.query(
        `INSERT INTO cheers (match_id, agent_id, side, message, source, created_day, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::date, $7::timestamptz, NOW())
         ON CONFLICT (match_id, agent_id)
         DO UPDATE SET
           side = EXCLUDED.side,
           message = EXCLUDED.message,
           source = EXCLUDED.source,
           created_day = EXCLUDED.created_day,
           updated_at = NOW()`,
        [mId, aId, s, msg, src, iso, nowIso]
      );
      return { ok: true, storage: 'cheers' };
    } catch {
      // Backward-compatible fallback for DBs that haven't run cheers migration.
      const key = `cheer:${mId}`;
      await client.query(
        `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
         VALUES ($1::uuid, 'arena_cheer', $2, $3::jsonb, 1.0, NOW())
         ON CONFLICT (agent_id, kind, key)
         DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
        [
          aId,
          key,
          JSON.stringify({
            match_id: mId,
            side: s,
            message: msg,
            source: src,
            created_at: nowIso
          })
        ]
      );
      return { ok: true, storage: 'facts' };
    }
  }

  static async cheerSummaryWithClient(
    client,
    { matchId, limit = 300, maxMessages = 8, bestMinCount = 2 } = {}
  ) {
    const bundle = await loadCheerRowsWithFallback(client, matchId, { limit });
    const summary = aggregateCheerRows(bundle.rows, { maxMessages, bestMinCount });
    return {
      ...summary,
      source: bundle.source
    };
  }

  static async listLeaderboardWithClient(client, { seasonId, limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    if (!seasonId) return { season: null, leaderboard: [] };

    const season = await client
      .query(`SELECT id, code, starts_on, ends_on FROM arena_seasons WHERE id = $1 LIMIT 1`, [seasonId])
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    const { rows } = await client.query(
      `SELECT r.agent_id, r.rating, r.wins, r.losses, r.streak, r.updated_at,
              a.name, a.display_name
       FROM arena_ratings r
       JOIN agents a ON a.id = r.agent_id
       WHERE r.season_id = $1
       ORDER BY r.rating DESC, r.wins DESC, r.losses ASC, a.name ASC
       LIMIT $2`,
      [seasonId, safeLimit]
    );

    return {
      season,
      leaderboard: (rows || []).map((r) => ({
        agent: { id: r.agent_id, name: r.name, displayName: r.display_name ?? null },
        rating: Number(r.rating ?? 1000) || 1000,
        wins: Number(r.wins ?? 0) || 0,
        losses: Number(r.losses ?? 0) || 0,
        streak: Number(r.streak ?? 0) || 0,
        updated_at: r.updated_at
      }))
    };
  }

  static async listHistoryForAgentWithClient(client, { agentId, limit = 20 } = {}) {
    const id = String(agentId || '').trim();
    if (!id) return { history: [] };
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));

    const { rows } = await client.query(
      `SELECT p.match_id, p.score, p.outcome, p.wager, p.fee_burned, p.coins_net,
              p.rating_before, p.rating_after, p.rating_delta,
              m.day, m.slot, m.mode, m.status, m.meta,
              rp.content AS recap_body
       FROM arena_match_participants p
       JOIN arena_matches m ON m.id = p.match_id
       LEFT JOIN posts rp
         ON (m.meta->>'recap_post_id') ~* '^[0-9a-f-]{36}$'
        AND rp.id = (m.meta->>'recap_post_id')::uuid
       WHERE p.agent_id = $1
       ORDER BY m.day DESC, m.slot DESC
       LIMIT $2`,
      [id, safeLimit]
    );

    const matchIds = (rows || []).map((r) => r.match_id).filter(Boolean);
    const opponentMap = new Map();
    if (matchIds.length > 0) {
      const { rows: oppRows } = await client.query(
        `SELECT p.match_id, p.agent_id, a.name, a.display_name, p.outcome
         FROM arena_match_participants p
         JOIN agents a ON a.id = p.agent_id
         WHERE p.match_id = ANY($1::uuid[])
           AND p.agent_id <> $2`,
        [matchIds, id]
      );
      for (const r of oppRows || []) {
        const preferredName = String(r.display_name || r.name || '').trim() || null;
        opponentMap.set(r.match_id, {
          id: r.agent_id,
          name: preferredName,
          displayName: r.display_name ?? null,
          outcome: String(r.outcome || '').trim()
        });
      }
    }

    return {
      history: (rows || []).map((r) => ({
        id: r.match_id,
        matchId: r.match_id,
        day: formatIsoDayUTC(new Date(r.day)) || String(r.day || ''),
        slot: Number(r.slot ?? 1) || 1,
        mode: String(r.mode || '').trim(),
        status: String(r.status || '').trim(),
        headline: typeof r.meta?.headline === 'string' ? String(r.meta.headline) : null,
        meta: (() => {
          const meta = r.meta && typeof r.meta === 'object' ? r.meta : {};
          const headline = typeof meta.headline === 'string' ? String(meta.headline) : null;
          const coachingNarrative = typeof meta.coaching_narrative === 'string' ? String(meta.coaching_narrative).trim() : null;
          const nearMiss = typeof meta.near_miss === 'string' ? String(meta.near_miss).trim() : null;
          const tags = Array.isArray(meta.tags) ? meta.tags.map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 12) : [];
          const recapPostId = typeof meta.recap_post_id === 'string' ? String(meta.recap_post_id).trim() : null;
          return {
            headline,
            coaching_narrative: coachingNarrative,
            near_miss: nearMiss,
            tags,
            recap_post_id: recapPostId
          };
        })(),
        recapBody: typeof r.recap_body === 'string' ? r.recap_body : null,
        recap_body: typeof r.recap_body === 'string' ? r.recap_body : null,
        my: {
          score: Number(r.score ?? 0) || 0,
          outcome: String(r.outcome || '').trim(),
          wager: Number(r.wager ?? 0) || 0,
          feeBurned: Number(r.fee_burned ?? 0) || 0,
          coinsNet: Number(r.coins_net ?? 0) || 0,
          ratingBefore: Number(r.rating_before ?? 1000) || 1000,
          ratingAfter: Number(r.rating_after ?? 1000) || 1000,
          ratingDelta: Number(r.rating_delta ?? 0) || 0
        },
        opponent: opponentMap.get(r.match_id) || null
      }))
    };
  }

  static async getAgentStatsWithClient(client, { agentId, limit = 500, eloHistoryLimit = 20 } = {}) {
    const id = String(agentId || '').trim();
    if (!id) {
      return {
        total_matches: 0,
        wins: 0,
        losses: 0,
        win_rate: 0,
        current_streak: 0,
        best_streak: 0,
        favorite_mode: null,
        nemesis: null,
        rival: null,
        biggest_upset: null,
        elo_history: []
      };
    }

    const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
    const safeHistory = Math.max(1, Math.min(100, Number(eloHistoryLimit) || 20));

    const { rows } = await client.query(
      `SELECT p.match_id, p.outcome, p.rating_before, p.rating_after, p.rating_delta,
              m.mode, m.day, m.slot, m.created_at,
              opp.agent_id AS opponent_id,
              opp.rating_before AS opponent_rating_before,
              a.name AS opponent_name,
              a.display_name AS opponent_display_name
       FROM arena_match_participants p
       JOIN arena_matches m ON m.id = p.match_id
       LEFT JOIN arena_match_participants opp
              ON opp.match_id = p.match_id
             AND opp.agent_id <> p.agent_id
       LEFT JOIN agents a ON a.id = opp.agent_id
       WHERE p.agent_id = $1
       ORDER BY m.day DESC, m.slot DESC, m.created_at DESC
       LIMIT $2`,
      [id, safeLimit]
    );

    const history = rows || [];
    const totalMatches = history.length;
    const isLossOutcome = (outcome) => {
      const o = String(outcome || '').trim().toLowerCase();
      return o === 'lose' || o === 'forfeit';
    };
    const isWinOutcome = (outcome) => String(outcome || '').trim().toLowerCase() === 'win';

    let wins = 0;
    let losses = 0;
    for (const row of history) {
      if (isWinOutcome(row.outcome)) wins += 1;
      else if (isLossOutcome(row.outcome)) losses += 1;
    }

    const winRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 1000) / 1000 : 0;

    let currentStreak = 0;
    for (const row of history) {
      if (isWinOutcome(row.outcome)) {
        if (currentStreak < 0) break;
        currentStreak += 1;
      } else if (isLossOutcome(row.outcome)) {
        if (currentStreak > 0) break;
        currentStreak -= 1;
      } else {
        break;
      }
    }

    let bestStreak = 0;
    let streakRun = 0;
    const chrono = [...history].reverse();
    for (const row of chrono) {
      if (isWinOutcome(row.outcome)) {
        streakRun += 1;
        if (streakRun > bestStreak) bestStreak = streakRun;
      } else {
        streakRun = 0;
      }
    }

    const modeCounts = new Map();
    const rivalMap = new Map(); // opponentId -> { id, name, matches }
    const nemesisMap = new Map(); // opponentId -> { id, name, losses }
    let biggestUpset = null;

    for (const row of history) {
      const mode = String(row.mode || '').trim().toLowerCase();
      if (mode) modeCounts.set(mode, (modeCounts.get(mode) || 0) + 1);

      const opponentId = String(row.opponent_id || '').trim();
      const opponentName = String(row.opponent_display_name || row.opponent_name || '').trim() || null;
      if (opponentId) {
        const rival = rivalMap.get(opponentId) || { id: opponentId, name: opponentName, matches: 0 };
        rival.matches += 1;
        if (!rival.name && opponentName) rival.name = opponentName;
        rivalMap.set(opponentId, rival);

        if (isLossOutcome(row.outcome)) {
          const nemesis = nemesisMap.get(opponentId) || { id: opponentId, name: opponentName, losses: 0 };
          nemesis.losses += 1;
          if (!nemesis.name && opponentName) nemesis.name = opponentName;
          nemesisMap.set(opponentId, nemesis);
        }
      }

      const myRating = Number(row.rating_before ?? 1000) || 1000;
      const opponentRating = Number(row.opponent_rating_before ?? 1000) || 1000;
      const won = isWinOutcome(row.outcome);
      const swing = won ? opponentRating - myRating : isLossOutcome(row.outcome) ? myRating - opponentRating : 0;
      if (swing > 0 && (!biggestUpset || swing > biggestUpset._swing)) {
        biggestUpset = {
          opponent_rating: opponentRating,
          my_rating: myRating,
          won,
          match_id: row.match_id,
          _swing: swing
        };
      }
    }

    const favoriteMode = (() => {
      const arr = [...modeCounts.entries()];
      if (!arr.length) return null;
      arr.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
      return arr[0][0];
    })();

    const rival = (() => {
      const arr = [...rivalMap.values()];
      if (!arr.length) return null;
      arr.sort((a, b) => b.matches - a.matches || String(a.name || '').localeCompare(String(b.name || '')));
      return { id: arr[0].id, name: arr[0].name, matches: arr[0].matches };
    })();

    const nemesis = (() => {
      const arr = [...nemesisMap.values()];
      if (!arr.length) return null;
      arr.sort((a, b) => b.losses - a.losses || String(a.name || '').localeCompare(String(b.name || '')));
      return { id: arr[0].id, name: arr[0].name, losses: arr[0].losses };
    })();

    const eloHistory = history
      .slice(0, safeHistory)
      .map((r) => Number(r.rating_after ?? 1000) || 1000)
      .reverse();

    if (biggestUpset && Object.prototype.hasOwnProperty.call(biggestUpset, '_swing')) {
      delete biggestUpset._swing;
    }

    return {
      total_matches: totalMatches,
      wins,
      losses,
      win_rate: winRate,
      current_streak: currentStreak,
      best_streak: bestStreak,
      favorite_mode: favoriteMode,
      nemesis,
      rival,
      biggest_upset: biggestUpset,
      elo_history: eloHistory
    };
  }

  static async createChallengeMatchWithClient(client, { challengerAgentId, mode, day } = {}) {
    const challengerId = String(challengerAgentId || '').trim();
    const m = String(mode || '').trim().toUpperCase();
    const iso = safeIsoDay(day);
    if (!client || !challengerId || !iso) return { ok: false, reason: 'invalid_input' };
    if (!ALL_ARENA_MODES.includes(m)) return { ok: false, reason: 'invalid_mode' };

    const season = await ArenaService.ensureSeasonForDayWithClient(client, iso);
    if (!season?.id) return { ok: false, reason: 'no_season' };

    const existing = await client
      .query(
        `SELECT m.id
         FROM arena_matches m
         WHERE m.day = $2::date
           AND m.mode = $3
           AND m.status IN ('live', 'scheduled')
           AND (
             COALESCE(m.meta->'cast'->>'aId', m.meta->'cast'->>'a_id', '') = $1
             OR COALESCE(m.meta->'cast'->>'bId', m.meta->'cast'->>'b_id', '') = $1
             OR EXISTS (
               SELECT 1
               FROM arena_match_participants p
               WHERE p.match_id = m.id
                 AND p.agent_id = $1::uuid
             )
           )
         ORDER BY m.slot DESC, m.created_at DESC
         LIMIT 1`,
        [challengerId, iso, m]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    if (existing?.id) {
      return { ok: true, already: true, match_id: String(existing.id), mode: m };
    }

    const challenger = await client
      .query(
        `SELECT id, name, display_name
         FROM agents
         WHERE id = $1::uuid
           AND is_active = true
           AND name <> 'world_core'
         LIMIT 1`,
        [challengerId]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    if (!challenger?.id) return { ok: false, reason: 'challenger_not_found' };

    const challengerRatingBefore = await client
      .query(
        `SELECT rating
         FROM arena_ratings
         WHERE season_id = $1
           AND agent_id = $2::uuid
         LIMIT 1`,
        [season.id, challengerId]
      )
      .then((r) => Number(r.rows?.[0]?.rating ?? 1000) || 1000)
      .catch(() => 1000);

    const { rows: candidates } = await client.query(
      `SELECT a.id AS agent_id,
              a.name,
              a.display_name,
              COALESCE(ar.rating, 1000)::int AS rating,
              a.owner_user_id
       FROM agents a
       LEFT JOIN arena_ratings ar
              ON ar.season_id = $1
             AND ar.agent_id = a.id
       WHERE a.is_active = true
         AND a.name <> 'world_core'
         AND a.id <> $2::uuid
         AND NOT EXISTS (
           SELECT 1
           FROM arena_matches m2
           WHERE m2.day = $4::date
             AND m2.status IN ('live', 'scheduled')
             AND (
               COALESCE(m2.meta->'cast'->>'aId', m2.meta->'cast'->>'a_id', '') = a.id::text
               OR COALESCE(m2.meta->'cast'->>'bId', m2.meta->'cast'->>'b_id', '') = a.id::text
               OR EXISTS (
                 SELECT 1
                 FROM arena_match_participants p2
                 WHERE p2.match_id = m2.id
                   AND p2.agent_id = a.id
               )
             )
         )
       ORDER BY (a.owner_user_id IS NULL) ASC,
                ABS(COALESCE(ar.rating, 1000) - $3) ASC,
                a.id ASC
       LIMIT 24`,
      [season.id, challengerId, challengerRatingBefore, iso]
    );
    const opponent = (candidates || [])[0] || null;
    if (!opponent?.agent_id) return { ok: false, reason: 'no_opponent' };

    const aId = String(challenger.id);
    const bId = String(opponent.agent_id);
    const aName = String(challenger.display_name || challenger.name || 'A');
    const bName = String(opponent.display_name || opponent.name || 'B');

    const ids = [aId, bId];
    const [statsRows, jobsRows, ratingRows, condRows] = await Promise.all([
      client
        .query(
          `SELECT agent_id, hunger, energy, mood, bond, curiosity, stress
           FROM pet_stats
           WHERE agent_id = ANY($1::uuid[])`,
          [ids]
        )
        .then((r) => r.rows || [])
        .catch(() => []),
      client
        .query(
          `SELECT agent_id, job_code, zone_code
           FROM agent_jobs
           WHERE agent_id = ANY($1::uuid[])`,
          [ids]
        )
        .then((r) => r.rows || [])
        .catch(() => []),
      client
        .query(
          `SELECT agent_id, rating
           FROM arena_ratings
           WHERE season_id = $1
             AND agent_id = ANY($2::uuid[])`,
          [season.id, ids]
        )
        .then((r) => r.rows || [])
        .catch(() => []),
      client
        .query(
          `SELECT agent_id, value
           FROM facts
           WHERE agent_id = ANY($1::uuid[])
             AND kind = 'arena'
             AND key = 'condition'`,
          [ids]
        )
        .then((r) => r.rows || [])
        .catch(() => [])
    ]);

    const statsMap = new Map((statsRows || []).map((r) => [String(r.agent_id), r]));
    const jobsMap = new Map((jobsRows || []).map((r) => [String(r.agent_id), r]));
    const ratingsMap = new Map((ratingRows || []).map((r) => [String(r.agent_id), Number(r.rating ?? 1000) || 1000]));
    const conditionMap = new Map();
    for (const row of condRows || []) {
      const v = row?.value && typeof row.value === 'object' ? row.value : {};
      conditionMap.set(String(row.agent_id), clampInt(v?.condition ?? v?.value ?? 70, 0, 100));
    }

    const aStats = statsMap.get(aId) || {};
    const bStats = statsMap.get(bId) || {};
    const aJob = jobsMap.get(aId) || {};
    const bJob = jobsMap.get(bId) || {};
    const aRatingBefore = Number(ratingsMap.get(aId) ?? challengerRatingBefore ?? 1000) || 1000;
    const bRatingBefore = Number(ratingsMap.get(bId) ?? opponent.rating ?? 1000) || 1000;
    const aCondition = clampInt(conditionMap.get(aId) ?? 70, 0, 100);
    const bCondition = clampInt(conditionMap.get(bId) ?? 70, 0, 100);

    const wagerMin = clampInt(config.limbopet?.arenaWagerMin ?? 1, 1, 100);
    const wagerMax = clampInt(config.limbopet?.arenaWagerMax ?? 5, wagerMin, 200);
    const feePct = clampInt(config.limbopet?.arenaFeeBurnPct ?? 15, 0, 80);
    const liveWindowS = clampInt(config.limbopet?.arenaLiveWindowSeconds ?? 30, 10, 180);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const slot = await client
        .query(
          `SELECT COALESCE(MAX(slot), 0) + 1 AS next_slot
           FROM arena_matches
           WHERE season_id = $1
             AND day = $2::date`,
          [season.id, iso]
        )
        .then((r) => clampInt(r.rows?.[0]?.next_slot ?? 1, 1, 999))
        .catch(() => 1);

      const seed = `challenge:${season.code}:${iso}:${slot}:${m}:${aId}:${bId}`;
      const rng = mulberry32(hash32(`${seed}:wager`));
      const wager = randInt(rng, wagerMin, wagerMax);
      const feeBase = Math.floor((wager * feePct) / 100);
      const feeBurnRaw = feePct > 0 && wager >= 3 && feeBase === 0 ? 1 : feeBase;
      const feeBurn = clampInt(feeBurnRaw, 0, Math.max(wagerMax, wager));

      const nowMs = Date.now();
      const startedAtIso = new Date(nowMs).toISOString();
      const endsAtIso = new Date(nowMs + liveWindowS * 1000).toISOString();

      const debateBase = m === 'DEBATE_CLASH' ? buildDebateClash(mulberry32(hash32(`${seed}:debate_base`))) : null;
      let courtPreview = null;
      if (m === 'COURT_TRIAL') {
        try {
          const CourtCaseService = require('./CourtCaseService');
          const realCase = await CourtCaseService.getRandomCase();
          if (realCase) courtPreview = CourtCaseService.createScenario(realCase);
        } catch { /* fallback below */ }
        if (!courtPreview) courtPreview = buildCourtTrialCase(mulberry32(hash32(`${seed}:court`)));
      }
      const mathPreview = m === 'MATH_RACE' ? buildMathRaceChallenge(mulberry32(hash32(`${seed}:math`))) : null;
      const puzzlePreview = m === 'PUZZLE_SPRINT' ? buildPuzzle(mulberry32(hash32(`${seed}:puzzle`))) : null;
      const promptPreview = m === 'PROMPT_BATTLE' ? buildPromptBattleTheme(mulberry32(hash32(`${seed}:prompt`))) : null;
      const auctionPreview = m === 'AUCTION_DUEL' ? buildAuctionDuel(mulberry32(hash32(`${seed}:auction_base`))) : null;

      const meta = {
        headline: `도전전: ${aName} vs ${bName} — ${modeLabel(m)} (${wager}코인)`,
        mode_label: modeLabel(m),
        cast: { aId, aName, bId, bName },
        stake: { wager, fee_burned: feeBurn },
        live: { started_at: startedAtIso, ends_at: endsAtIso },
        challenge: {
          requested_by: aId,
          requested_at: startedAtIso
        },
        snapshot: {
          a: { rating_before: aRatingBefore, stats: aStats, job_code: aJob.job_code ?? null, condition: aCondition },
          b: { rating_before: bRatingBefore, stats: bStats, job_code: bJob.job_code ?? null, condition: bCondition }
        },
        debate_base: debateBase,
        court_preview: courtPreview
          ? {
            title: courtPreview.title,
            charge: courtPreview.charge,
            facts: Array.isArray(courtPreview.facts) ? courtPreview.facts : [],
            statute: courtPreview.statute,
            is_real_case: Boolean(courtPreview.is_real_case),
            category: courtPreview.category || '',
            difficulty: Number(courtPreview.difficulty) || 0
          }
          : null,
        math_preview: mathPreview
          ? {
            kind: mathPreview.kind,
            question: mathPreview.question
          }
          : null,
        puzzle_preview: puzzlePreview
          ? {
            question: puzzlePreview.question
          }
          : null,
        prompt_preview: promptPreview
          ? {
            theme: promptPreview.theme,
            required: Array.isArray(promptPreview.required) ? promptPreview.required : []
          }
          : null,
        auction_preview: auctionPreview
          ? {
            item: auctionPreview.item,
            vibe: auctionPreview.vibe,
            rule: auctionPreview.rule
          }
          : null
      };

      // eslint-disable-next-line no-await-in-loop
      const matchId = await client
        .query(
          `INSERT INTO arena_matches (season_id, day, slot, mode, status, seed, meta)
           VALUES ($1, $2::date, $3, $4, 'live', $5, $6::jsonb)
           ON CONFLICT (season_id, day, slot) DO NOTHING
           RETURNING id`,
          [season.id, iso, slot, m, seed, JSON.stringify(meta)]
        )
        .then((r) => (r.rows?.[0]?.id ? String(r.rows[0].id) : null))
        .catch(() => null);
      if (!matchId) continue;

      if (m === 'DEBATE_CLASH' && debateBase) {
        // eslint-disable-next-line no-await-in-loop
        const jobs = await enqueueArenaDebateJobsWithClient(client, {
          matchId,
          day: iso,
          seed,
          base: debateBase,
          aId,
          bId,
          aName,
          bName,
          aJobCode: aJob.job_code ?? null,
          bJobCode: bJob.job_code ?? null
        }).catch(() => null);
        if (jobs) {
          // eslint-disable-next-line no-await-in-loop
          await client.query(
            `UPDATE arena_matches
             SET meta = $2::jsonb
             WHERE id = $1`,
            [matchId, JSON.stringify({ ...meta, debate_jobs: { a: jobs.a, b: jobs.b } })]
          ).catch(() => null);
        }
      }

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'ARENA_CHALLENGE', $2::jsonb, 4)`,
        [
          aId,
          JSON.stringify({
            day: iso,
            match_id: matchId,
            mode: m,
            opponent_id: bId,
            opponent_name: bName,
            slot
          })
        ]
      ).catch(() => null);

      return {
        ok: true,
        already: false,
        match_id: matchId,
        day: iso,
        slot,
        mode: m,
        opponent: {
          id: bId,
          name: bName
        }
      };
    }

    return { ok: false, reason: 'insert_failed' };
  }

  static async requestRematchWithClient(client, { matchId, requesterAgentId, feeCoins = 5 } = {}) {
    const id = String(matchId || '').trim();
    const requesterId = String(requesterAgentId || '').trim();
    const fee = clampInt(feeCoins, 1, 50);
    if (!client || !id || !requesterId) return { ok: false, reason: 'invalid_input' };

    const row = await client
      .query(
        `SELECT m.id, m.day, m.created_at, m.status, m.mode,
                me.outcome AS my_outcome,
                opp.agent_id AS opponent_id,
                a.owner_user_id AS opponent_owner_user_id,
                a.name AS opponent_name,
                a.display_name AS opponent_display_name
         FROM arena_matches m
         JOIN arena_match_participants me ON me.match_id = m.id AND me.agent_id = $2
         JOIN arena_match_participants opp ON opp.match_id = m.id AND opp.agent_id <> me.agent_id
         JOIN agents a ON a.id = opp.agent_id
         WHERE m.id = $1::uuid
         LIMIT 1`,
        [id, requesterId]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    if (!row?.id) return { ok: false, reason: 'not_found_or_not_participant' };

    const status = String(row.status || '').trim().toLowerCase();
    if (status !== 'resolved') return { ok: false, reason: 'match_not_resolved' };

    const myOutcome = String(row.my_outcome || '').trim().toLowerCase();
    const isLoser = myOutcome === 'lose' || myOutcome === 'forfeit';
    if (!isLoser) return { ok: false, reason: 'not_loser' };

    const createdAtMs =
      parseDateMs(row.created_at) ??
      (() => {
        const dayIso = row?.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row?.day || '').slice(0, 10);
        return parseDateMs(`${dayIso}T00:00:00.000Z`);
      })();
    if (createdAtMs === null) return { ok: false, reason: 'bad_match_time' };

    const nowMs = Date.now();
    const REMATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
    if (nowMs - createdAtMs > REMATCH_WINDOW_MS) return { ok: false, reason: 'window_expired' };

    const requestKey = `rematch_req:${id}`;
    const existingReq = await client
      .query(
        `SELECT value
         FROM facts
         WHERE agent_id = $1
           AND kind = 'arena'
           AND key = $2
         LIMIT 1`,
        [requesterId, requestKey]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    if (existingReq?.value) {
      const v = existingReq.value && typeof existingReq.value === 'object' ? existingReq.value : {};
      return {
        ok: true,
        already: true,
        match_id: id,
        opponent_id: row.opponent_id,
        fee,
        expires_at: v.expires_at ?? null
      };
    }

    const opponentId = String(row.opponent_id || '').trim();
    if (!opponentId) return { ok: false, reason: 'missing_opponent' };

    const expiresAtMs = createdAtMs + REMATCH_WINDOW_MS;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const expiresDay = expiresAt.slice(0, 10);
    const dayIso = row?.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row?.day || '').slice(0, 10);

    const chargeTx = await TransactionService.transfer(
      {
        fromAgentId: requesterId,
        toAgentId: null,
        amount: fee,
        txType: 'ARENA',
        memo: `arena rematch request (${id})`,
        referenceId: id,
        referenceType: 'arena_rematch'
      },
      client
    );

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'arena', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
      [
        requesterId,
        `revenge:${opponentId}`,
        JSON.stringify({
          opponent_id: opponentId,
          match_id: id,
          created_day: dayIso,
          created_at: new Date().toISOString(),
          expires_day: expiresDay,
          expires_at: expiresAt,
          reason: 'manual_rematch',
          manual_rematch: true,
          elo_bonus_multiplier: 1.5,
          double_ko_on_loss: true
        })
      ]
    );

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'arena', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
      [
        requesterId,
        requestKey,
        JSON.stringify({
          match_id: id,
          opponent_id: opponentId,
          requested_at: new Date().toISOString(),
          expires_at: expiresAt,
          fee,
          tx_id: chargeTx?.id ?? null
        })
      ]
    );

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'ARENA_REMATCH_REQUEST', $2::jsonb, 5)`,
      [
        requesterId,
        JSON.stringify({
          match_id: id,
          opponent_id: opponentId,
          fee,
          expires_at: expiresAt
        })
      ]
    ).catch(() => null);

    if (row.opponent_owner_user_id) {
      const targetName = String(row.opponent_display_name || row.opponent_name || '상대').trim() || '상대';
      const rematch = NotificationTemplateService.render('ARENA_REMATCH', {
        vars: { target_name: targetName, fee, expires_at: expiresAt },
        fallback: {
          title: '복수전 요청 도착',
          body: `${targetName}에게 복수전 요청이 들어왔어.`,
        }
      });
      await NotificationService.create(client, row.opponent_owner_user_id, {
        type: 'ARENA_REMATCH',
        title: rematch.title,
        body: rematch.body,
        data: {
          match_id: id,
          challenger_agent_id: requesterId,
          fee,
          expires_at: expiresAt
        }
      }).catch(() => null);
    }

    return {
      ok: true,
      already: false,
      match_id: id,
      opponent_id: opponentId,
      fee,
      tx_id: chargeTx?.id ?? null,
      expires_at: expiresAt
    };
  }

  static async highlightMatchCommentWithClient(client, { matchId, commentId, actorAgentId = null } = {}) {
    const mId = String(matchId || '').trim();
    const cId = String(commentId || '').trim();
    const actorId = String(actorAgentId || '').trim() || null;
    if (!client || !mId || !cId) return { ok: false, reason: 'invalid_input' };

    const match = await client
      .query(
        `SELECT id, status, meta
         FROM arena_matches
         WHERE id = $1::uuid
         LIMIT 1
         FOR UPDATE`,
        [mId]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    if (!match?.id) return { ok: false, reason: 'match_not_found' };

    const status = String(match.status || '').trim().toLowerCase();
    if (status !== 'resolved') return { ok: false, reason: 'match_not_resolved' };

    const meta = match.meta && typeof match.meta === 'object' ? match.meta : {};
    const recapPostId = String(meta.recap_post_id || '').trim();
    if (!recapPostId) return { ok: false, reason: 'missing_recap_post' };

    const comment = await client
      .query(
        `SELECT c.id, c.post_id, c.author_id, c.content, c.score, c.upvotes, c.downvotes, c.created_at,
                a.name, a.display_name
         FROM comments c
         JOIN agents a ON a.id = c.author_id
         WHERE c.id = $1::uuid
           AND c.post_id = $2::uuid
         LIMIT 1`,
        [cId, recapPostId]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    if (!comment?.id) return { ok: false, reason: 'comment_not_found' };

    const highlight = {
      comment_id: String(comment.id),
      author_id: String(comment.author_id),
      author_name: String(comment.display_name || comment.name || '').trim() || null,
      content: safeText(comment.content, 280),
      score: Number(comment.score ?? 0) || 0,
      upvotes: Number(comment.upvotes ?? 0) || 0,
      downvotes: Number(comment.downvotes ?? 0) || 0,
      created_at: comment.created_at,
      highlighted_at: new Date().toISOString()
    };

    const oldHighlights = meta.highlights && typeof meta.highlights === 'object' ? meta.highlights : {};
    const oldList = Array.isArray(oldHighlights.comments) ? oldHighlights.comments : [];
    const comments = [highlight, ...oldList.filter((x) => String(x?.comment_id || '') !== String(comment.id))].slice(0, 5);

    const cheer = meta.cheer && typeof meta.cheer === 'object' ? { ...meta.cheer } : {};
    const tags = Array.isArray(meta.tags) ? [...meta.tags] : [];
    const isPopular = highlight.upvotes >= 3 || highlight.score >= 3;
    if (isPopular) {
      cheer.best_cheer = {
        source: 'comment',
        tag: '베스트 응원',
        comment_id: highlight.comment_id,
        author_name: highlight.author_name,
        text: highlight.content,
        score: highlight.score,
        upvotes: highlight.upvotes
      };
      tags.push('베스트 응원');
    }

    const nextMeta = {
      ...meta,
      cheer,
      highlights: {
        ...oldHighlights,
        primary_comment_id: highlight.comment_id,
        comments,
        updated_at: new Date().toISOString()
      },
      tags: [...new Set(tags)].slice(0, 8)
    };

    await client.query(`UPDATE arena_matches SET meta = $2::jsonb WHERE id = $1`, [match.id, JSON.stringify(nextMeta)]);

    if (actorId) {
      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'ARENA_HIGHLIGHT_COMMENT', $2::jsonb, 4)`,
        [
          actorId,
          JSON.stringify({
            match_id: mId,
            comment_id: highlight.comment_id,
            post_id: recapPostId
          })
        ]
      ).catch(() => null);
    }

    return { ok: true, match_id: mId, recap_post_id: recapPostId, highlight, best_cheer: cheer.best_cheer ?? null };
  }

  static async tickDayWithClient(
    client,
    { day, matchesPerDay = null, resolveImmediately = false, autoNpcCheer = null } = {}
  ) {
    const iso = safeIsoDay(day);
    if (!iso) return { ok: false, day: null, created: 0, skipped: 0 };

    const enabled = String(config.limbopet?.arenaEnabled ?? '').trim().length > 0 ? Boolean(config.limbopet?.arenaEnabled) : true;
    if (!enabled) return { ok: true, day: iso, created: 0, skipped: 0, disabled: true };

    const safeMatchesPerDay =
      matchesPerDay !== null && matchesPerDay !== undefined
        ? clampInt(matchesPerDay, 0, 200)
        : clampInt(config.limbopet?.arenaMatchesPerDay ?? 10, 0, 200);
    if (safeMatchesPerDay <= 0) return { ok: true, day: iso, created: 0, skipped: 0 };

    const season = await ArenaService.ensureSeasonForDayWithClient(client, iso);
    if (!season?.id) return { ok: false, day: iso, created: 0, skipped: 0 };

    const maxPerAgent = clampInt(config.limbopet?.arenaMaxPerAgentPerDay ?? 1, 1, 10);
    const wagerMin = clampInt(config.limbopet?.arenaWagerMin ?? 1, 1, 100);
    const wagerMax = clampInt(config.limbopet?.arenaWagerMax ?? 5, wagerMin, 200);
    const feePct = clampInt(config.limbopet?.arenaFeeBurnPct ?? 15, 0, 80);
    const eloK = clampInt(config.limbopet?.arenaEloK ?? 24, 8, 64);
    const liveWindowS = clampInt(config.limbopet?.arenaLiveWindowSeconds ?? 30, 10, 180);
    const lossPenaltyCoinsBase = clampInt(config.limbopet?.arenaLossPenaltyCoins ?? 1, 0, 50);
    const lossPenaltyXpBase = clampInt(config.limbopet?.arenaLossPenaltyXp ?? 10, 0, 200);
    const npcAutoCheerEnabled =
      typeof autoNpcCheer === 'boolean'
        ? autoNpcCheer
        : Boolean(config.limbopet?.arenaNpcAutoCheer) && Boolean(resolveImmediately);
    const npcAutoCheerMin = clampInt(config.limbopet?.arenaNpcAutoCheerMin ?? 3, 0, 20);
    const npcAutoCheerMax = clampInt(config.limbopet?.arenaNpcAutoCheerMax ?? 8, npcAutoCheerMin, 40);

    const modesRaw = Array.isArray(config.limbopet?.arenaModes) ? config.limbopet.arenaModes : null;
    const modes = (modesRaw && modesRaw.length ? modesRaw : ALL_ARENA_MODES)
      .map((m) => String(m || '').trim().toUpperCase())
      .filter(Boolean);

    // Participant pool
    const { rows: agentRows } = await client.query(
      `SELECT id, name, display_name, owner_user_id
       FROM agents
       WHERE is_active = true AND name <> 'world_core'
       ORDER BY id ASC`
    );

    const agentsAll = (agentRows || []).map((a) => ({
      id: a.id,
      name: String(a.name || '').trim(),
      displayName: a.display_name ?? null,
      ownerUserId: a.owner_user_id ?? null,
      isNpc: !a.owner_user_id
    }));
    const npcSpectators = agentsAll.filter((a) => a.isNpc);

    const userPets = agentsAll.filter((a) => !a.isNpc);
    const userCount = userPets.length;
    const npcThreshold = clampInt(config.limbopet?.npcColdStartMaxUserPets ?? 4, 0, 200);
    const includeNpcs = userCount <= npcThreshold;

    const pool = agentsAll.filter((a) => !a.isNpc || includeNpcs);
    if (pool.length < 2) return { ok: true, day: iso, created: 0, skipped: safeMatchesPerDay };

    const poolIds = pool.map((a) => a.id);

    // Preload stats, jobs, nudges, ratings (best-effort; missing => defaults).
    const statsMap = new Map();
    const jobsMap = new Map();
    const nudgesMap = new Map();
    const ratingsMap = new Map();
    const modePrefsMap = new Map(); // agentId -> string[] (selected modes)
    const relTopMap = new Map(); // fromId -> [{to_agent_id, jealousy, rivalry}]
    const revengeMap = new Map(); // agentId -> Set(opponentId)
    const promptProfileByUserId = new Map(); // userId -> prompt profile summary

    const [statsRows, jobsRows, nudgesRows, ratingRows, prefRows, revengeRows] = await Promise.all([
      client
        .query(
          `SELECT agent_id, hunger, energy, mood, bond, curiosity, stress
           FROM pet_stats
           WHERE agent_id = ANY($1::uuid[])`,
          [poolIds]
        )
        .then((r) => r.rows || [])
        .catch(() => []),
      client
        .query(
          `SELECT agent_id, job_code, zone_code
           FROM agent_jobs
           WHERE agent_id = ANY($1::uuid[])`,
          [poolIds]
        )
        .then((r) => r.rows || [])
        .catch(() => []),
      client
        .query(
          `SELECT agent_id, kind, confidence, updated_at,
                  COALESCE(value->>'text', key) AS text
           FROM (
             SELECT agent_id, kind, key, value, confidence, updated_at,
                    ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY updated_at DESC) AS rn
             FROM facts
             WHERE agent_id = ANY($1::uuid[])
               AND kind IN ('preference','forbidden','suggestion','arena_note')
           ) t
           WHERE rn <= 4
           ORDER BY agent_id, rn`,
          [poolIds]
        )
        .then((r) => r.rows || [])
        .catch(() => []),
      client
        .query(
          `SELECT agent_id, rating, wins, losses, streak
           FROM arena_ratings
           WHERE season_id = $1 AND agent_id = ANY($2::uuid[])`,
          [season.id, poolIds]
        )
        .then((r) => r.rows || [])
        .catch(() => []),
      client
        .query(
          `SELECT agent_id, value
           FROM facts
           WHERE agent_id = ANY($1::uuid[])
             AND kind = 'arena_pref'
             AND key = 'modes'`,
          [poolIds]
        )
        .then((r) => r.rows || [])
        .catch(() => []),
      client
        .query(
          `SELECT agent_id, key, value
           FROM facts
           WHERE agent_id = ANY($1::uuid[])
             AND kind = 'arena'
             AND key LIKE 'revenge:%'
           ORDER BY updated_at DESC`,
          [poolIds]
        )
        .then((r) => r.rows || [])
        .catch(() => [])
    ]);

    for (const r of statsRows || []) statsMap.set(r.agent_id, r);
    for (const r of jobsRows || []) jobsMap.set(r.agent_id, r);
    for (const r of nudgesRows || []) {
      const list = nudgesMap.get(r.agent_id) || [];
      list.push({
        kind: String(r.kind || '').trim(),
        text: String(r.text || '').trim(),
        confidence: Number(r.confidence ?? 1.0),
        updated_at: r.updated_at
      });
      nudgesMap.set(r.agent_id, list);
    }
    for (const r of ratingRows || []) ratingsMap.set(r.agent_id, r);
    for (const r of prefRows || []) {
      const agentId = r.agent_id;
      const v = r.value && typeof r.value === 'object' ? r.value : {};
      const raw = Array.isArray(v?.modes) ? v.modes : [];
      const list = raw.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
      if (list.length) modePrefsMap.set(agentId, [...new Set(list)]);
    }

    // Condition snapshot source (facts): kind='arena', key='condition'
    const conditionMap = new Map(); // agentId -> 0..100
    const { rows: condRows } = await client.query(
      `SELECT agent_id, value
       FROM facts
       WHERE agent_id = ANY($1::uuid[])
         AND kind = 'arena'
         AND key = 'condition'`,
      [poolIds]
    ).then((r) => r.rows || []).catch(() => []);
    for (const r of condRows || []) {
      const v = r.value && typeof r.value === 'object' ? r.value : {};
      const c = clampInt(v?.condition ?? v?.value ?? 70, 0, 100);
      conditionMap.set(r.agent_id, c);
    }
    for (const r of revengeRows || []) {
      const agentId = r.agent_id;
      const key = String(r.key || '').trim();
      if (!key.startsWith('revenge:')) continue;
      const oppId = key.slice('revenge:'.length).trim();
      if (!oppId) continue;
      const v = r.value && typeof r.value === 'object' ? r.value : {};
      const expiresDay = safeIsoDay(v?.expires_day ?? v?.expiresDay ?? null);
      if (expiresDay && expiresDay < iso) continue;
      const set = revengeMap.get(agentId) || new Set();
      set.add(oppId);
      revengeMap.set(agentId, set);
    }

    const userIds = [...new Set(pool.map((a) => String(a.ownerUserId || '').trim()).filter(Boolean))];
    if (userIds.length > 0) {
      const { rows: promptRows } = await client.query(
        `SELECT user_id, enabled, prompt_text, version, updated_at
         FROM user_prompt_profiles
         WHERE user_id = ANY($1::uuid[])`,
        [userIds]
      ).catch(() => ({ rows: [] }));
      for (const r of promptRows || []) {
        const userId = String(r.user_id || '').trim();
        if (!userId) continue;
        promptProfileByUserId.set(userId, {
          enabled: Boolean(r.enabled),
          has_custom: Boolean(String(r.prompt_text || '').trim()),
          version: Math.max(0, Math.trunc(Number(r.version ?? 0) || 0)),
          updated_at: r.updated_at ?? null
        });
      }
    }

    const recentPairs = await ArenaService.listRecentPairsWithClient(client, { seasonId: season.id, day: iso, lookbackDays: 7 }).catch(
      () => new Set()
    );

    const exposure = new Map(); // agentId -> count today
    const usedPairsToday = new Set();

    const getExposure = (id) => Number(exposure.get(id) ?? 0) || 0;
    const bumpExposure = (id) => exposure.set(id, getExposure(id) + 1);
    const canUse = (id) => getExposure(id) < maxPerAgent;

    const poolById = new Map(pool.map((a) => [a.id, a]));

    async function getTopConflictPartners(fromId) {
      const cached = relTopMap.get(fromId);
      if (cached) return cached;
      const { rows } = await client.query(
        `SELECT to_agent_id, jealousy, rivalry
         FROM relationships
         WHERE from_agent_id = $1
           AND to_agent_id = ANY($2::uuid[])
         ORDER BY (jealousy + rivalry) DESC, updated_at DESC
         LIMIT 8`,
        [fromId, poolIds]
      );
      const list = (rows || []).map((r) => ({
        id: r.to_agent_id,
        jealousy: Number(r.jealousy ?? 0) || 0,
        rivalry: Number(r.rivalry ?? 0) || 0
      }));
      relTopMap.set(fromId, list);
      return list;
    }

    function seededRngForSlot(slot) {
      return mulberry32(hash32(`${season.code}:${iso}:${slot}`));
    }

    function pickPrimaryAgent(rng) {
      const candidates = poolIds.filter((id) => canUse(id));
      if (candidates.length === 0) return null;
      // Slight bias to agents with fewer exposures.
      const minExp = Math.min(...candidates.map((id) => getExposure(id)));
      const shortlist = candidates.filter((id) => getExposure(id) === minExp);
      return pick(rng, shortlist) || pick(rng, candidates);
    }

    async function pickOpponentFor(rng, aId) {
      const others = poolIds.filter((id) => id !== aId && canUse(id));
      if (others.length === 0) return null;

      const revengeSet = revengeMap.get(aId) || null;
      const revengeTargets = revengeSet ? [...revengeSet].filter((id) => others.includes(id)) : [];

      const sampleSize = Math.min(25, others.length);
      const sampled = [];
      const tmp = others.slice();
      for (let i = 0; i < sampleSize; i += 1) {
        const idx = Math.floor(rng() * tmp.length);
        sampled.push(tmp[idx]);
        tmp.splice(idx, 1);
      }

      const top = await getTopConflictPartners(aId).catch(() => []);
      const topIds = top.map((t) => t.id).filter((id) => others.includes(id));
      const candidateIds = [...new Set([...revengeTargets, ...topIds, ...sampled])];
      if (candidateIds.length === 0) return pick(rng, others);

      const ratingA = Number(ratingsMap.get(aId)?.rating ?? 1000) || 1000;

      let best = null;
      let bestScore = -Infinity;
      for (const bId of candidateIds) {
        const key = pairKey(aId, bId);
        if (usedPairsToday.has(key)) continue;

        const ratingB = Number(ratingsMap.get(bId)?.rating ?? 1000) || 1000;
        const diff = Math.abs(ratingA - ratingB);
        const closeness = 1 - Math.min(1, diff / 800);

        const rel = top.find((t) => t.id === bId) || { jealousy: 0, rivalry: 0 };
        const intensity = clamp01((Number(rel.jealousy ?? 0) + Number(rel.rivalry ?? 0)) / 160);

        const isRevenge = Boolean(revengeSet && revengeSet.has(bId));
        const cooldownPenalty = recentPairs.has(pairKey(aId, bId)) && !isRevenge ? 0.45 : 0;
        const revengeBoost = isRevenge ? 1.2 : 0;
        const score = intensity * 0.7 + closeness * 0.2 + rng() * 0.25 + revengeBoost - cooldownPenalty;

        if (score > bestScore) {
          bestScore = score;
          best = bId;
        }
      }

      return best || pick(rng, candidateIds) || pick(rng, others);
    }

    async function resolveOneMatch({ slot }) {
      const nowMs = Date.now();

      const existing = await client.query(
        `SELECT id, status, mode, seed, meta
         FROM arena_matches
         WHERE season_id = $1 AND day = $2::date AND slot = $3
         LIMIT 1`,
        [season.id, iso, slot]
      ).then((r) => r.rows?.[0] ?? null);

      if (existing?.id) {
        const existingMeta = existing.meta && typeof existing.meta === 'object' ? existing.meta : {};
        const status = String(existing.status || '').trim().toLowerCase();
        const cast = readCast(existingMeta);

        if (cast.aId && cast.bId) {
          usedPairsToday.add(pairKey(cast.aId, cast.bId));
          bumpExposure(cast.aId);
          bumpExposure(cast.bId);
        }

        if (status === 'live') {
          const live = existingMeta.live && typeof existingMeta.live === 'object' ? existingMeta.live : {};
          const endsMs = parseDateMs(live.ends_at) ?? null;
          if (endsMs !== null && (endsMs <= nowMs || resolveImmediately)) {
            const r = await bestEffortInTransaction(
              client,
              async () => ArenaService.resolveLiveMatchWithClient(client, {
                matchId: existing.id,
                day: iso,
                slot,
                season,
                poolById,
                statsMap,
                jobsMap,
                nudgesMap,
                promptProfileByUserId,
                ratingsMap,
                eloK,
                lossPenaltyCoinsBase,
                lossPenaltyXpBase
              }),
              { label: 'arena_resolve_live', fallback: null }
            );
            return r?.resolved ? { created: false, resolved: true, matchId: existing.id } : { created: false, skipped: true, reason: 'live_resolve_failed' };
          }
          return { created: false, skipped: true, reason: 'live_pending' };
        }

        if (status === 'resolved') {
          // Backfill near-miss + tags if missing (newer UI expects these).
          const hasNear = typeof existingMeta.near_miss === 'string' && String(existingMeta.near_miss).trim();
          const hasTags = Array.isArray(existingMeta.tags) && existingMeta.tags.length > 0;
          const hasRounds = Array.isArray(existingMeta.rounds) && existingMeta.rounds.length > 0;
          if (!hasNear || !hasTags || !hasRounds) {
            const { rows: pr } = await client.query(
              `SELECT agent_id, score, outcome, wager, rating_before, rating_delta
               FROM arena_match_participants
               WHERE match_id = $1
               ORDER BY (outcome = 'win') DESC, score DESC
               LIMIT 2`,
              [existing.id]
            ).catch(() => ({ rows: [] }));
            const aP = pr?.[0] ?? null;
            const bP = pr?.[1] ?? null;
            if (aP && bP) {
              const aScore10 = clampInt(aP.score, 0, 1000);
              const bScore10 = clampInt(bP.score, 0, 1000);
              const winScore10 = Math.max(aScore10, bScore10);
              const loseScore10 = Math.min(aScore10, bScore10);
              const winPts = Math.round(winScore10 / 10);
              const losePts = Math.round(loseScore10 / 10);
              const gapPts = Math.max(0, winPts - losePts);
              const nearMiss = gapPts === 0 ? '동점' : `${losePts}/${winPts} · ${gapPts}점 부족!`;

              const wager = Math.max(0, clampInt(aP.wager, 0, 1_000_000_000), clampInt(bP.wager, 0, 1_000_000_000));
              const forfeit = String(aP.outcome || '').toLowerCase() === 'forfeit' || String(bP.outcome || '').toLowerCase() === 'forfeit';

              const tags = [];
              if (forfeit) tags.push('몰수');
              if (gapPts <= 1) tags.push('박빙');
              else if (gapPts <= 3) tags.push('접전');
              else if (gapPts >= 8) tags.push('압도적');
              if (wager >= 4) tags.push('빅스테이크');
              else if (wager >= 2) tags.push('스테이크');

              const aRb = clampInt(aP.rating_before, 400, 4000);
              const bRb = clampInt(bP.rating_before, 400, 4000);
              const aWin = String(aP.outcome || '').toLowerCase() === 'win';
              const winnerExpected = aWin ? expectedWinProb(aRb, bRb) : expectedWinProb(bRb, aRb);
              const winnerRb = aWin ? aRb : bRb;
              const loserRb = aWin ? bRb : aRb;
              if (winnerRb + 60 < loserRb) tags.push('언더독 업셋');
              if (winnerExpected < 0.3) tags.push('대역전');
              if (Math.max(Math.abs(clampInt(aP.rating_delta, -200, 200)), Math.abs(clampInt(bP.rating_delta, -200, 200))) >= 20) tags.push('급변');

              const rounds = hasRounds
                ? null
                : buildRounds({
                  seed: String(existing.seed || `${season.code}:${iso}:${slot}:${String(existing.mode || 'match')}`),
                  mode: String(existing.mode || '').trim().toUpperCase(),
                  aTotal10: aScore10,
                  bTotal10: bScore10,
                  ratingA: aRb,
                  ratingB: bRb,
                  aHints: {},
                  bHints: {},
                  rounds: 3
                });

              const nextMeta = {
                ...existingMeta,
                ...(hasNear ? {} : { near_miss: nearMiss }),
                ...(hasTags ? {} : { tags: [...new Set(tags)].slice(0, 8) }),
                ...(hasRounds ? {} : { rounds })
              };
              await client.query(`UPDATE arena_matches SET meta = $2::jsonb WHERE id = $1`, [existing.id, JSON.stringify(nextMeta)]).catch(() => null);
            }
          }

          // Integrity guard: recap_post_id backfill if missing.
          const recapExisting = String(existingMeta.recap_post_id || '').trim();
          if (!recapExisting) {
            const existingResult = existingMeta.result && typeof existingMeta.result === 'object' ? existingMeta.result : {};
            const winnerIdRaw = existingResult.winnerId || existingResult.winner_id || '';
            const authorId = String(winnerIdRaw || cast.aId || cast.bId || '').trim() || null;
            const modeExisting = String(existing.mode || '').trim() || String(existingMeta.mode || '').trim() || 'AUCTION_DUEL';

            if (authorId) {
              const recap = await ArenaRecapPostService.ensureRecapPostWithClient(client, {
                matchId: existing.id,
                authorId,
                day: iso,
                slot,
                mode: modeExisting,
                matchMeta: existingMeta
              });
              const recapPostId = recap?.postId ? String(recap.postId) : null;
              if (recapPostId) {
                await client.query(
                  `UPDATE arena_matches
                   SET meta = $2::jsonb
                   WHERE id = $1`,
                  [existing.id, JSON.stringify({ ...existingMeta, recap_post_id: recapPostId })]
                );
              }
            }
          }
          return { created: false, skipped: true, reason: 'already_resolved' };
        }

        return { created: false, skipped: true, reason: 'unknown_status' };
      }

      const rng = seededRngForSlot(slot);
      const aId = pickPrimaryAgent(rng);
      if (!aId) return { created: false, skipped: true, reason: 'no_candidates' };
      const bId = await pickOpponentFor(rng, aId);
      if (!bId) return { created: false, skipped: true, reason: 'no_opponent' };

      const key = pairKey(aId, bId);
      if (usedPairsToday.has(key)) return { created: false, skipped: true, reason: 'pair_used' };

      const modesA = modePrefsMap.get(aId) || null;
      const modesB = modePrefsMap.get(bId) || null;
      const allowSet = new Set((modes || []).map((m) => String(m || '').trim().toUpperCase()).filter(Boolean));
      const filteredA = modesA ? modesA.filter((m) => allowSet.has(m)) : null;
      const filteredB = modesB ? modesB.filter((m) => allowSet.has(m)) : null;
      const intersection =
        filteredA && filteredB
          ? filteredA.filter((m) => filteredB.includes(m))
          : filteredA
            ? filteredA
            : filteredB
              ? filteredB
              : null;
      const pickFrom = intersection && intersection.length ? intersection : modes;
      const mode = pickWeighted(rng, pickFrom) || 'AUCTION_DUEL';
      const seed = `${season.code}:${iso}:${slot}:${mode}`;

      const baseWager = randInt(rng, wagerMin, wagerMax);
      const isRevengeMatch = Boolean((revengeMap.get(aId) && revengeMap.get(aId).has(bId)) || (revengeMap.get(bId) && revengeMap.get(bId).has(aId)));
      const wager = isRevengeMatch ? clampInt(baseWager * 2, wagerMin, 200) : baseWager;
      const feeBase = Math.floor((wager * feePct) / 100);
      const feeBurnRaw = feePct > 0 && wager >= 3 && feeBase === 0 ? 1 : feeBase;
      const feeBurn = clampInt(feeBurnRaw, 0, Math.max(wagerMax, wager));

      const a = poolById.get(aId);
      const b = poolById.get(bId);
      const aName = String(a?.displayName || a?.name || 'A');
      const bName = String(b?.displayName || b?.name || 'B');

      const aStats = statsMap.get(aId) || {};
      const bStats = statsMap.get(bId) || {};
      const aJob = jobsMap.get(aId) || {};
      const bJob = jobsMap.get(bId) || {};

      const aRatingBefore = Number(ratingsMap.get(aId)?.rating ?? 1000) || 1000;
      const bRatingBefore = Number(ratingsMap.get(bId)?.rating ?? 1000) || 1000;
      const aCondition = clampInt(conditionMap.get(aId) ?? 70, 0, 100);
      const bCondition = clampInt(conditionMap.get(bId) ?? 70, 0, 100);

      const startedAtIso = new Date(nowMs).toISOString();
      const endsAtIso = new Date(nowMs + liveWindowS * 1000).toISOString();
      const debateBase = mode === 'DEBATE_CLASH' ? buildDebateClash(mulberry32(hash32(`${seed}:debate_base`))) : null;
      let courtPreview = null;
      if (mode === 'COURT_TRIAL') {
        try {
          const CourtCaseService = require('./CourtCaseService');
          const realCase = await CourtCaseService.getRandomCase();
          if (realCase) courtPreview = CourtCaseService.createScenario(realCase);
        } catch { /* fallback below */ }
        if (!courtPreview) courtPreview = buildCourtTrialCase(mulberry32(hash32(`${seed}:court`)));
      }
      const mathPreview = mode === 'MATH_RACE' ? buildMathRaceChallenge(mulberry32(hash32(`${seed}:math`))) : null;
      const puzzlePreview = mode === 'PUZZLE_SPRINT' ? buildPuzzle(mulberry32(hash32(`${seed}:puzzle`))) : null;
      const promptPreview = mode === 'PROMPT_BATTLE' ? buildPromptBattleTheme(mulberry32(hash32(`${seed}:prompt`))) : null;
      const auctionPreview = mode === 'AUCTION_DUEL' ? buildAuctionDuel(mulberry32(hash32(`${seed}:auction_base`))) : null;

      const meta = {
        headline: `진행 중: ${aName} vs ${bName} — ${modeLabel(mode)} (${wager}코인)`,
        mode_label: modeLabel(mode),
        cast: { aId, aName, bId, bName },
        stake: { wager, fee_burned: feeBurn },
        live: { started_at: startedAtIso, ends_at: endsAtIso },
        revenge: isRevengeMatch ? { match: true } : null,
        snapshot: {
          a: { rating_before: aRatingBefore, stats: aStats, job_code: aJob.job_code ?? null, condition: aCondition },
          b: { rating_before: bRatingBefore, stats: bStats, job_code: bJob.job_code ?? null, condition: bCondition }
        },
        debate_base: debateBase,
        court_preview: courtPreview
          ? {
            title: courtPreview.title,
            charge: courtPreview.charge,
            facts: Array.isArray(courtPreview.facts) ? courtPreview.facts : [],
            statute: courtPreview.statute,
            is_real_case: Boolean(courtPreview.is_real_case),
            category: courtPreview.category || '',
            difficulty: Number(courtPreview.difficulty) || 0
          }
          : null,
        math_preview: mathPreview
          ? {
            kind: mathPreview.kind,
            question: mathPreview.question
          }
          : null,
        puzzle_preview: puzzlePreview
          ? {
            question: puzzlePreview.question
          }
          : null,
        prompt_preview: promptPreview
          ? {
            theme: promptPreview.theme,
            required: Array.isArray(promptPreview.required) ? promptPreview.required : []
          }
          : null,
        auction_preview: auctionPreview
          ? {
            item: auctionPreview.item,
            vibe: auctionPreview.vibe,
            rule: auctionPreview.rule
          }
          : null
      };
      let liveMeta = { ...meta };

      const { rows: matchRows } = await client.query(
        `INSERT INTO arena_matches (season_id, day, slot, mode, status, seed, meta)
         VALUES ($1, $2::date, $3, $4, 'live', $5, $6::jsonb)
         ON CONFLICT (season_id, day, slot) DO NOTHING
         RETURNING id`,
        [season.id, iso, slot, mode, seed, JSON.stringify(meta)]
      );

      const matchId = matchRows?.[0]?.id ?? null;
      if (!matchId) return { created: false, skipped: true, reason: 'already_exists' };

      if (mode === 'DEBATE_CLASH' && debateBase) {
        await bestEffortInTransaction(
          client,
          async () => {
            const jobs = await enqueueArenaDebateJobsWithClient(client, {
              matchId,
              day: iso,
              seed,
              base: debateBase,
              aId,
              bId,
              aName,
              bName,
              aJobCode: aJob.job_code ?? null,
              bJobCode: bJob.job_code ?? null
            });
            if (!jobs) return;
            const nextMeta = {
              ...liveMeta,
              debate_jobs: {
                a: jobs.a,
                b: jobs.b
              }
            };
            await client.query(`UPDATE arena_matches SET meta = $2::jsonb WHERE id = $1`, [matchId, JSON.stringify(nextMeta)]);
            liveMeta = nextMeta;
          },
          { label: 'arena_debate_jobs' }
        );
      }

      if (npcAutoCheerEnabled && npcAutoCheerMax > 0 && npcSpectators.length > 0) {
        const autoCheerResult = await bestEffortInTransaction(
          client,
          async () => {
            const candidateNpcIds = npcSpectators
              .map((x) => String(x.id || '').trim())
              .filter((x) => x && x !== aId && x !== bId);
            if (candidateNpcIds.length === 0) return null;

            const shuffledNpcIds = seedShuffle(
              candidateNpcIds,
              String(hash32(`${seed}:npc_auto_cheer:pool`).toString(16))
            );
            const rng = mulberry32(hash32(`${seed}:npc_auto_cheer`));
            const targetCount = randInt(rng, npcAutoCheerMin, npcAutoCheerMax);
            const fanCount = Math.max(0, Math.min(shuffledNpcIds.length, targetCount));
            if (fanCount <= 0) return null;

            const selectedFanIds = shuffledNpcIds.slice(0, fanCount);
            for (let i = 0; i < selectedFanIds.length; i += 1) {
              const fanId = selectedFanIds[i];
              const side = selectedFanIds.length >= 2
                ? (i === 0 ? 'a' : i === 1 ? 'b' : (rng() < 0.5 ? 'a' : 'b'))
                : (rng() < 0.5 ? 'a' : 'b');
              // eslint-disable-next-line no-await-in-loop
              await ArenaService.upsertCheerWithClient(client, {
                matchId,
                agentId: fanId,
                side,
                message: npcCheerMessageFor({ side, aName, bName, rng }),
                day: iso,
                source: 'npc_auto'
              });
            }

            const summary = await ArenaService.cheerSummaryWithClient(client, {
              matchId,
              limit: 300,
              maxMessages: 5,
              bestMinCount: 2
            });
            return { summary, fanCount };
          },
          { label: 'arena_auto_npc_cheers', fallback: null }
        );

        if (autoCheerResult?.summary) {
          const summary = autoCheerResult.summary;
          const tags = Array.isArray(liveMeta.tags) ? [...liveMeta.tags] : [];
          if (summary.bestCheer) tags.push('베스트 응원');
          liveMeta = {
            ...liveMeta,
            cheer: {
              a_count: summary.aCount,
              b_count: summary.bCount,
              messages: summary.messages,
              best_cheer: summary.bestCheer,
              auto_seeded: autoCheerResult.fanCount,
              updated_at: new Date().toISOString()
            },
            tags: tags.length ? [...new Set(tags)].slice(0, 8) : liveMeta.tags
          };
          await client.query(`UPDATE arena_matches SET meta = $2::jsonb WHERE id = $1`, [matchId, JSON.stringify(liveMeta)]).catch(() => null);
        }
      }

      usedPairsToday.add(key);
      bumpExposure(aId);
      bumpExposure(bId);

      if (resolveImmediately) {
        const r = await bestEffortInTransaction(
          client,
          async () => ArenaService.resolveLiveMatchWithClient(client, {
            matchId,
            day: iso,
            slot,
            season,
            poolById,
            statsMap,
            jobsMap,
            nudgesMap,
            promptProfileByUserId,
            ratingsMap,
            eloK,
            lossPenaltyCoinsBase,
            lossPenaltyXpBase
          }),
          { label: 'arena_resolve_new', fallback: null }
        );
        if (r?.resolved) return { created: true, resolved: true, matchId };
      }

      return { created: true, matchId, live: true };
    }

    let created = 0;
    let skipped = 0;
    let resolvedLive = 0;

    // Include challenge-created matches that may have slot > safeMatchesPerDay
    const { rows: maxSlotRows } = await client.query(
      `SELECT COALESCE(MAX(slot), 0) AS max_slot FROM arena_matches WHERE season_id = $1 AND day = $2::date`,
      [season.id, iso]
    ).catch(() => ({ rows: [{ max_slot: 0 }] }));
    const maxExistingSlot = clampInt(maxSlotRows?.[0]?.max_slot ?? 0, 0, 500);
    const upperSlot = Math.max(safeMatchesPerDay, maxExistingSlot);

    for (let slot = 1; slot <= upperSlot; slot += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await bestEffortInTransaction(
        client,
        async () => resolveOneMatch({ slot }),
        { label: `arena_match_${slot}`, fallback: { created: false, skipped: true, reason: 'error' } }
      );
      if (r?.created) created += 1;
      if (r?.resolved) resolvedLive += 1;
      else skipped += 1;
    }

    return { ok: true, day: iso, season: { id: season.id, code: season.code }, created, skipped, resolvedLive };
  }

  /**
   * Resolve an expired LIVE match into a RESOLVED match.
   *
   * Idempotency:
   * - Takes a row lock on arena_matches(id)
   * - Uses ON CONFLICT DO NOTHING for participants
   * - Backfills recap_post_id if a partial resolve happened earlier
   */
  static async resolveLiveMatchWithClient(
    client,
    {
      matchId,
      day,
      slot,
      season,
      poolById,
      statsMap,
      jobsMap,
      nudgesMap,
      promptProfileByUserId,
      ratingsMap,
      eloK,
      lossPenaltyCoinsBase,
      lossPenaltyXpBase
    } = {}
  ) {
    const id = String(matchId || '').trim();
    const iso = safeIsoDay(day);
    if (!client || !id || !iso) return { resolved: false };

    // Helper: wrap a DB operation in a savepoint so that a query failure
    // doesn't poison the surrounding PostgreSQL transaction (25P02 prevention).
    const safeQ = (fn, fallback = null, label = 'rq') =>
      bestEffortInTransaction(client, fn, { label, fallback });

    const match = await client.query(
      `SELECT id, mode, status, seed, meta
       FROM arena_matches
       WHERE id = $1::uuid
       FOR UPDATE`,
      [id]
    ).then((r) => r.rows?.[0] ?? null);
    if (!match?.id) return { resolved: false };

    const status = String(match.status || '').trim().toLowerCase();
    const meta0 = match.meta && typeof match.meta === 'object' ? match.meta : {};

    if (status === 'resolved') {
      const recapExisting = String(meta0.recap_post_id || '').trim();
      if (recapExisting) return { resolved: true, already: true };
      // Backfill recap if needed.
      const cast = readCast(meta0);
      const resultObj = meta0.result && typeof meta0.result === 'object' ? meta0.result : {};
      const winnerIdRaw = resultObj.winnerId || resultObj.winner_id || '';
      const authorId = String(winnerIdRaw || cast.aId || cast.bId || '').trim() || null;
      if (authorId) {
        const recap = await ArenaRecapPostService.ensureRecapPostWithClient(client, {
          matchId: match.id,
          authorId,
          day: iso,
          slot,
          mode: String(match.mode || '').trim() || 'AUCTION_DUEL',
          matchMeta: meta0
        });
        const recapPostId = recap?.postId ? String(recap.postId) : null;
        if (recapPostId) {
          await client.query(`UPDATE arena_matches SET meta = $2::jsonb WHERE id = $1`, [match.id, JSON.stringify({ ...meta0, recap_post_id: recapPostId })]);
        }
      }
      return { resolved: true, backfilled: true };
    }

    // If participants already exist (partial earlier run), mark resolved + backfill recap.
    const partCount = await safeQ(
      () => client.query(
        `SELECT COUNT(*)::int AS n
         FROM arena_match_participants
         WHERE match_id = $1`,
        [match.id]
      ).then((r) => Number(r.rows?.[0]?.n ?? 0) || 0),
      0, 'resolve_part_count'
    );

    if (partCount >= 2) {
      const recapExisting = String(meta0.recap_post_id || '').trim();
      if (!recapExisting) {
        const cast = readCast(meta0);
        const resultObj = meta0.result && typeof meta0.result === 'object' ? meta0.result : {};
        const winnerIdRaw = resultObj.winnerId || resultObj.winner_id || '';
        const authorId = String(winnerIdRaw || cast.aId || cast.bId || '').trim() || null;
        if (authorId) {
          const recap = await ArenaRecapPostService.ensureRecapPostWithClient(client, {
            matchId: match.id,
            authorId,
            day: iso,
            slot,
            mode: String(match.mode || '').trim() || 'AUCTION_DUEL',
            matchMeta: meta0
          });
          const recapPostId = recap?.postId ? String(recap.postId) : null;
          if (recapPostId) {
            await client.query(`UPDATE arena_matches SET status = 'resolved', meta = $2::jsonb WHERE id = $1`, [
              match.id,
              JSON.stringify({ ...meta0, recap_post_id: recapPostId })
            ]);
            return { resolved: true, backfilled: true };
          }
        }
      }
      await client.query(`UPDATE arena_matches SET status = 'resolved' WHERE id = $1`, [match.id]);
      return { resolved: true, backfilled: true };
    }

    const mode = String(match.mode || '').trim().toUpperCase() || 'AUCTION_DUEL';
    const seed = String(match.seed || '').trim();
    const cast = readCast(meta0);
    const aId = cast.aId;
    const bId = cast.bId;
    if (!aId || !bId) return { resolved: false, reason: 'missing_cast' };

    const aAgent = poolById?.get ? poolById.get(aId) : null;
    const bAgent = poolById?.get ? poolById.get(bId) : null;
    const aName = cast.aName || String(aAgent?.displayName || aAgent?.name || 'A');
    const bName = cast.bName || String(bAgent?.displayName || bAgent?.name || 'B');

    const revengeRows = await safeQ(
      () => client.query(
        `SELECT agent_id, key, value
         FROM facts
         WHERE kind = 'arena'
           AND ((agent_id = $1 AND key = $2) OR (agent_id = $3 AND key = $4))
         LIMIT 2`,
        [aId, `revenge:${bId}`, bId, `revenge:${aId}`]
      ).then((r) => r.rows || []),
      [], 'resolve_revenge'
    );
    const revengeAEntry = (revengeRows || []).find(
      (r) => String(r.agent_id || '') === String(aId) && String(r.key || '') === `revenge:${bId}`
    ) || null;
    const revengeBEntry = (revengeRows || []).find(
      (r) => String(r.agent_id || '') === String(bId) && String(r.key || '') === `revenge:${aId}`
    ) || null;
    const hadRevengeA = Boolean(revengeAEntry);
    const hadRevengeB = Boolean(revengeBEntry);

    const revengeAValue = revengeAEntry?.value && typeof revengeAEntry.value === 'object' ? revengeAEntry.value : {};
    const revengeBValue = revengeBEntry?.value && typeof revengeBEntry.value === 'object' ? revengeBEntry.value : {};
    const revengeAExpiryMs = parseDateMs(revengeAValue.expires_at ?? revengeAValue.expiresAt ?? null);
    const revengeBExpiryMs = parseDateMs(revengeBValue.expires_at ?? revengeBValue.expiresAt ?? null);
    const manualRevengeA = Boolean(revengeAValue.manual_rematch) && (revengeAExpiryMs === null || revengeAExpiryMs >= Date.now());
    const manualRevengeB = Boolean(revengeBValue.manual_rematch) && (revengeBExpiryMs === null || revengeBExpiryMs >= Date.now());
    const rematchRequesterId = manualRevengeA ? aId : manualRevengeB ? bId : null;
    const rematchRequestValue = rematchRequesterId === aId ? revengeAValue : rematchRequesterId === bId ? revengeBValue : null;
    const rematchSourceMatchId = rematchRequestValue
      ? String(rematchRequestValue.match_id || rematchRequestValue.source_match_id || '').trim() || null
      : null;

    const stake = meta0.stake && typeof meta0.stake === 'object' ? meta0.stake : {};
    const wagerPlan = clampInt(stake.wager ?? 1, 0, 1_000_000);
    const feeBurnPlan = clampInt(stake.fee_burned ?? 0, 0, wagerPlan);

    const snap = meta0.snapshot && typeof meta0.snapshot === 'object' ? meta0.snapshot : {};
    const snapA = snap.a && typeof snap.a === 'object' ? snap.a : {};
    const snapB = snap.b && typeof snap.b === 'object' ? snap.b : {};

    const aRatingBefore = clampInt(
      snapA.rating_before ?? (ratingsMap?.get ? Number(ratingsMap.get(aId)?.rating ?? 1000) : 1000),
      400,
      4000
    );
    const bRatingBefore = clampInt(
      snapB.rating_before ?? (ratingsMap?.get ? Number(ratingsMap.get(bId)?.rating ?? 1000) : 1000),
      400,
      4000
    );

    const aStats = (snapA.stats && typeof snapA.stats === 'object' ? snapA.stats : null) || (statsMap?.get ? statsMap.get(aId) : {}) || {};
    const bStats = (snapB.stats && typeof snapB.stats === 'object' ? snapB.stats : null) || (statsMap?.get ? statsMap.get(bId) : {}) || {};
    const aJob = (jobsMap?.get ? jobsMap.get(aId) : null) || {};
    const bJob = (jobsMap?.get ? jobsMap.get(bId) : null) || {};
    const aJobCode = String(snapA.job_code ?? aJob.job_code ?? '').trim() || null;
    const bJobCode = String(snapB.job_code ?? bJob.job_code ?? '').trim() || null;

    const aCondition = clampInt(snapA.condition ?? 70, 0, 100);
    const bCondition = clampInt(snapB.condition ?? 70, 0, 100);
    const condDelta = (c) => clamp01(0.5 + (c - 70) / 80) * 0.10 - 0.05; // ~[-0.05..+0.05]
    const aCondMult = 1 + condDelta(aCondition);
    const bCondMult = 1 + condDelta(bCondition);

    // Relationship context (directed, from each to the other).
    const relRows = await safeQ(
      () => client.query(
        `SELECT from_agent_id, to_agent_id, affinity, trust, jealousy, rivalry, debt
         FROM relationships
         WHERE (from_agent_id = $1 AND to_agent_id = $2)
            OR (from_agent_id = $2 AND to_agent_id = $1)`,
        [aId, bId]
      ).then((r) => r.rows || []),
      [], 'resolve_rel'
    );
    const relAtoB = relRows.find((r) => r.from_agent_id === aId && r.to_agent_id === bId) || null;
    const relBtoA = relRows.find((r) => r.from_agent_id === bId && r.to_agent_id === aId) || null;

    // Nudges + live interventions.
    // Fetch owner coach_notes and inject as synthetic nudges so they influence the match.
    const aNudges = [...((nudgesMap?.get ? nudgesMap.get(aId) : null) || [])];
    const bNudges = [...((nudgesMap?.get ? nudgesMap.get(bId) : null) || [])];
    const aNudgeSeedCount = aNudges.length;
    const bNudgeSeedCount = bNudges.length;
    // IMPORTANT: run sequentially on one pg client.
    // Concurrent SAVEPOINT flows on the same transaction client can interleave.
    const aPrefs = await safeQ(
      () => ArenaPrefsService.getWithClient(client, aId),
      { coach_note: '' },
      'coach_a'
    );
    const bPrefs = await safeQ(
      () => ArenaPrefsService.getWithClient(client, bId),
      { coach_note: '' },
      'coach_b'
    );
    if (aPrefs?.coach_note) aNudges.push({ kind: 'arena_note', text: aPrefs.coach_note, confidence: 1.2 });
    if (bPrefs?.coach_note) bNudges.push({ kind: 'arena_note', text: bPrefs.coach_note, confidence: 1.2 });

    // Lv.3: Inject conversation-derived coaching facts into arena nudges
    const aCoachFacts = await safeQ(
      () => client.query(
        `SELECT value, confidence
         FROM facts
         WHERE agent_id = $1
           AND kind = 'coaching'
         ORDER BY confidence DESC, updated_at DESC
         LIMIT 5`,
        [aId]
      ).then(r => r.rows || []),
      [],
      'coach_facts_a'
    );
    const bCoachFacts = await safeQ(
      () => client.query(
        `SELECT value, confidence
         FROM facts
         WHERE agent_id = $1
           AND kind = 'coaching'
         ORDER BY confidence DESC, updated_at DESC
         LIMIT 5`,
        [bId]
      ).then(r => r.rows || []),
      [],
      'coach_facts_b'
    );
    const aMemoryRefs = [];
    const bMemoryRefs = [];
    for (const f of aCoachFacts) {
      const text = typeof f.value === 'object' ? f.value?.text : typeof f.value === 'string' ? f.value : null;
      if (!text) continue;
      const trimmed = safeText(text, 120);
      const conf = Math.max(0.2, clamp01(Number(f?.confidence ?? 1) || 1));
      aMemoryRefs.push({ kind: 'coaching', text: trimmed, confidence: conf });
      aNudges.push({
        kind: 'coaching',
        text: `이 코칭 지시를 반드시 변론에 반영하라: ${trimmed}`,
        confidence: conf
      });
    }
    for (const f of bCoachFacts) {
      const text = typeof f.value === 'object' ? f.value?.text : typeof f.value === 'string' ? f.value : null;
      if (!text) continue;
      const trimmed = safeText(text, 120);
      const conf = Math.max(0.2, clamp01(Number(f?.confidence ?? 1) || 1));
      bMemoryRefs.push({ kind: 'coaching', text: trimmed, confidence: conf });
      bNudges.push({
        kind: 'coaching',
        text: `이 코칭 지시를 반드시 변론에 반영하라: ${trimmed}`,
        confidence: conf
      });
    }

    const aHints = buildNudgeHints(aNudges);
    const bHints = buildNudgeHints(bNudges);
    const aCoachingScoreBonusRate = coachingScoreBonusRate({ refs: aMemoryRefs, hints: aHints });
    const bCoachingScoreBonusRate = coachingScoreBonusRate({ refs: bMemoryRefs, hints: bHints });

    const liveMeta = meta0.live && typeof meta0.live === 'object' ? meta0.live : {};
    const startedMs = parseDateMs(liveMeta.started_at);
    const endsMs = parseDateMs(liveMeta.ends_at);

    const interventions = { a: null, b: null };
    const key = `intervene:${String(match.id)}`;
    const { rows: liveFacts } = await safeQ(
      () => client.query(
        `SELECT agent_id, value, updated_at
         FROM facts
         WHERE kind = 'arena_live'
           AND key = $1
           AND agent_id = ANY($2::uuid[])`,
        [key, [aId, bId]]
      ),
      { rows: [] }, 'resolve_live_facts'
    );

    const applyBoosts = (hints, boosts) => {
      const b = boosts && typeof boosts === 'object' ? boosts : {};
      const bump = (k, v) => {
        if (!(k in hints)) return;
        hints[k] = clamp01((Number(hints[k] ?? 0) || 0) + (Number(v) || 0));
      };
      bump('calm', Number(b.calm) || 0);
      bump('study', Number(b.study) || 0);
      bump('aggressive', Number(b.aggressive) || 0);
      bump('budget', Number(b.budget) || 0);
      bump('impulse_stop', Number(b.impulse_stop) || 0);
    };

    for (const r of liveFacts || []) {
      const agentId = String(r.agent_id || '').trim();
      const v = r.value && typeof r.value === 'object' ? r.value : {};
      const action = String(v.action || '').trim().toLowerCase() || null;
      const createdAtMs = parseDateMs(v.created_at) ?? (r.updated_at ? parseDateMs(r.updated_at) : null);
      const inWindow =
        createdAtMs !== null &&
        (startedMs === null || createdAtMs >= startedMs - 5000) &&
        (endsMs === null || createdAtMs <= endsMs + 1000);
      if (!inWindow) continue;
      if (agentId === aId) {
        interventions.a = action;
        applyBoosts(aHints, v.boosts);
      } else if (agentId === bId) {
        interventions.b = action;
        applyBoosts(bHints, v.boosts);
      }
    }

    const aPromptProfile = summarizePromptProfileMeta(
      promptProfileByUserId?.get
        ? promptProfileByUserId.get(String(aAgent?.ownerUserId || '').trim())
        : null
    );
    const bPromptProfile = summarizePromptProfileMeta(
      promptProfileByUserId?.get
        ? promptProfileByUserId.get(String(bAgent?.ownerUserId || '').trim())
        : null
    );
    const trainingInfluence = {
      a: {
        weights: summarizeHintInfluence(aHints),
        base_nudge_count: aNudgeSeedCount,
        nudge_count: aNudges.length,
        coaching_fact_count: aMemoryRefs.length,
        coaching_score_bonus_rate: aCoachingScoreBonusRate,
        coach_note_applied: Boolean(aPrefs?.coach_note),
        intervention: interventions.a || null
      },
      b: {
        weights: summarizeHintInfluence(bHints),
        base_nudge_count: bNudgeSeedCount,
        nudge_count: bNudges.length,
        coaching_fact_count: bMemoryRefs.length,
        coaching_score_bonus_rate: bCoachingScoreBonusRate,
        coach_note_applied: Boolean(bPrefs?.coach_note),
        intervention: interventions.b || null
      }
    };
    const recentMemoryInfluence = {
      a: summarizeRecentMemoryInfluence(aMemoryRefs),
      b: summarizeRecentMemoryInfluence(bMemoryRefs)
    };

    let mathRace = null;
    let courtTrial = null;
    let promptBattle = null;
    let aScore = 0;
    let bScore = 0;

    if (mode === 'MATH_RACE') {
      const challenge = buildMathRaceChallenge(mulberry32(hash32(`${seed}:math`)));
      const aRaw = perfMathRace({ seed, agentId: aId, rating: aRatingBefore, stats: aStats, jobCode: aJobCode, hints: aHints, challenge });
      const bRaw = perfMathRace({ seed, agentId: bId, rating: bRatingBefore, stats: bStats, jobCode: bJobCode, hints: bHints, challenge });
      const { aPerf, bPerf, guard } = applyMathRaceBothWrongGuard({
        seed,
        aId,
        bId,
        challenge,
        aPerf: aRaw,
        bPerf: bRaw
      });
      aScore = Number(aPerf.score ?? 0) || 0;
      bScore = Number(bPerf.score ?? 0) || 0;
      mathRace = {
        kind: challenge.kind,
        question: challenge.question,
        answer: challenge.answer,
        a: { answer: aPerf.answer, correct: aPerf.correct, time_ms: aPerf.time_ms },
        b: { answer: bPerf.answer, correct: bPerf.correct, time_ms: bPerf.time_ms },
        guard
      };
    } else if (mode === 'COURT_TRIAL') {
      let courtCase;
      try {
        const CourtCaseService = require('./CourtCaseService');
        const realCase = await CourtCaseService.getRandomCase();
        if (realCase) {
          courtCase = CourtCaseService.createScenario(realCase);
        }
      } catch {
        // fallback to deterministic synthetic case
      }
      if (!courtCase) {
        courtCase = buildCourtTrialCase(mulberry32(hash32(`${seed}:court`)));
      }
      const aPerf = perfCourtTrial({ seed, agentId: aId, rating: aRatingBefore, stats: aStats, jobCode: aJobCode, hints: aHints, courtCase });
      const bPerf = perfCourtTrial({ seed, agentId: bId, rating: bRatingBefore, stats: bStats, jobCode: bJobCode, hints: bHints, courtCase });
      aScore = Number(aPerf.score ?? 0) || 0;
      bScore = Number(bPerf.score ?? 0) || 0;
      courtTrial = {
        title: courtCase.title,
        charge: courtCase.charge,
        summary: safeText(courtCase.summary, 400) || '',
        facts: courtCase.facts,
        statute: courtCase.statute,
        correct_verdict: courtCase.correct_verdict,
        is_real_case: Boolean(courtCase.is_real_case),
        category: courtCase.category || '',
        difficulty: Number(courtCase.difficulty) || 0,
        actual_verdict: courtCase.actual_verdict || '',
        actual_reasoning: courtCase.actual_reasoning || '',
        learning_points: Array.isArray(courtCase.learning_points) ? courtCase.learning_points : [],
        source_url: courtCase.source_url || '',
        a: { verdict: aPerf.verdict, correct: aPerf.correct, time_ms: aPerf.time_ms },
        b: { verdict: bPerf.verdict, correct: bPerf.correct, time_ms: bPerf.time_ms }
      };
    } else if (mode === 'PROMPT_BATTLE') {
      const t = buildPromptBattleTheme(mulberry32(hash32(`${seed}:prompt`)));
      const aPerf = perfPromptBattle({ seed, agentId: aId, rating: aRatingBefore, stats: aStats, jobCode: aJobCode, hints: aHints, theme: t.theme, required: t.required });
      const bPerf = perfPromptBattle({ seed, agentId: bId, rating: bRatingBefore, stats: bStats, jobCode: bJobCode, hints: bHints, theme: t.theme, required: t.required });
      aScore = Number(aPerf.score ?? 0) || 0;
      bScore = Number(bPerf.score ?? 0) || 0;
      promptBattle = { theme: t.theme, required: t.required, a_prompt: aPerf.prompt, b_prompt: bPerf.prompt, a_missing: aPerf.missing, b_missing: bPerf.missing };
    } else {
      const rng = mulberry32(hash32(`${seed}:score`));
      aScore = scoreForMode({ mode, rng, rating: aRatingBefore, stats: aStats, jobCode: aJobCode, hints: aHints, relOut: relAtoB });
      bScore = scoreForMode({ mode, rng, rating: bRatingBefore, stats: bStats, jobCode: bJobCode, hints: bHints, relOut: relBtoA });
    }

    // If coaching memory facts were actually reflected in hints, reward the side with a small score boost.
    if (aCoachingScoreBonusRate > 0) aScore *= 1 + aCoachingScoreBonusRate;
    if (bCoachingScoreBonusRate > 0) bScore *= 1 + bCoachingScoreBonusRate;

    // Condition (P4): tiny buff/debuff applied to this match.
    const aBad = aCondition <= 30;
    const bBad = bCondition <= 30;
    const aMult = aCondMult * (aBad ? 0.99 : 1.0);
    const bMult = bCondMult * (bBad ? 0.99 : 1.0);
    aScore *= aMult;
    bScore *= bMult;

    let winnerId = aScore >= bScore ? aId : bId;
    let loserId = winnerId === aId ? bId : aId;

    // Economic stake (taken from loser only; part burned).
    const economyCycle = await safeQ(
      () => EconomyTickService.getCycleWithClient(client),
      null, 'resolve_econ_cycle'
    );
    const cycleState = String(economyCycle?.state || 'normal').trim() || 'normal';
    const cyclePrizeMultiplierRaw = Number(economyCycle?.arena_prize_multiplier ?? 1.0);
    const cyclePrizeMultiplier = Number.isFinite(cyclePrizeMultiplierRaw)
      ? Math.max(1.0, Math.min(2.5, cyclePrizeMultiplierRaw))
      : 1.0;

    const loserBalance = await safeQ(
      () => TransactionService.getBalance(loserId, client),
      0, 'resolve_loser_bal'
    );
    let totalStake = clampInt(Math.min(wagerPlan, Math.max(0, loserBalance)), 0, 1_000_000);
    let fee = totalStake <= 1 ? 0 : Math.min(feeBurnPlan, Math.max(0, totalStake - 1));
    let basePrizeToWinner = Math.max(0, totalStake - fee);
    let cyclePrizeBonus = cyclePrizeMultiplier > 1 && basePrizeToWinner > 0
      ? clampInt(Math.round(basePrizeToWinner * (cyclePrizeMultiplier - 1)), 0, 1_000_000)
      : 0;
    let toWinner = basePrizeToWinner + cyclePrizeBonus;

    let winnerTx = null;
    let feeTx = null;
    let bonusTx = null;
    let forfeit = false;

    if (basePrizeToWinner <= 0) {
      forfeit = totalStake <= 0;
    } else {
      const txResult = await safeQ(
        async () => {
          const wTx = await TransactionService.transfer(
            {
              fromAgentId: loserId,
              toAgentId: winnerId,
              amount: basePrizeToWinner,
              txType: 'ARENA',
              memo: `arena wager (day:${iso})`,
              referenceId: match.id,
              referenceType: 'arena_match'
            },
            client
          );
          let fTx = null;
          if (fee > 0) {
            fTx = await TransactionService.transfer(
              {
                fromAgentId: loserId,
                toAgentId: null,
                amount: fee,
                txType: 'ARENA',
                memo: `arena fee burn (day:${iso})`,
                referenceId: match.id,
                referenceType: 'arena_match'
              },
              client
            );
          }
          return { winnerTx: wTx, feeTx: fTx };
        },
        null, 'resolve_wager_tx'
      );
      if (txResult) {
        winnerTx = txResult.winnerTx;
        feeTx = txResult.feeTx;
      } else {
        forfeit = true;
        totalStake = 0;
        fee = 0;
        basePrizeToWinner = 0;
        cyclePrizeBonus = 0;
        toWinner = 0;
        winnerTx = null;
        feeTx = null;
        bonusTx = null;
      }
    }

    if (!forfeit && cyclePrizeBonus > 0) {
      bonusTx = await safeQ(
        () => TransactionService.transfer(
          {
            fromAgentId: null,
            toAgentId: winnerId,
            amount: cyclePrizeBonus,
            txType: 'ARENA',
            memo: `arena boom bonus (day:${iso})`,
            referenceId: match.id,
            referenceType: 'arena_match_bonus'
          },
          client
        ),
        null, 'resolve_bonus_tx'
      );

      if (!bonusTx) {
        cyclePrizeBonus = 0;
        toWinner = basePrizeToWinner;
      }
    }

    const winnerName = winnerId === aId ? aName : bName;
    const loserName = loserId === aId ? aName : bName;

    const aOutcome = forfeit ? (aId === loserId ? 'forfeit' : 'win') : aId === winnerId ? 'win' : 'lose';
    const bOutcome = forfeit ? (bId === loserId ? 'forfeit' : 'win') : bId === winnerId ? 'win' : 'lose';

    const aScore10 = clampInt(Math.round(aScore * 10), 0, 1000);
    const bScore10 = clampInt(Math.round(bScore * 10), 0, 1000);
    const winScore10 = Math.max(aScore10, bScore10);
    const loseScore10 = Math.min(aScore10, bScore10);
    const winPts = Math.round(winScore10 / 10);
    const losePts = Math.round(loseScore10 / 10);
    const gapPts = Math.max(0, winPts - losePts);
    const nearMiss = gapPts === 0 ? '동점' : `${losePts}/${winPts} · ${gapPts}점 부족!`;

    let aDelta = eloDelta({ ratingA: aRatingBefore, ratingB: bRatingBefore, outcomeA: aOutcome, k: eloK });
    let bDelta = eloDelta({ ratingA: bRatingBefore, ratingB: aRatingBefore, outcomeA: bOutcome, k: eloK });
    const rematchEloBonusMultiplier = 1.5;
    const rematchEloBonusApplied = Boolean(rematchRequesterId && winnerId === rematchRequesterId);
    if (rematchEloBonusApplied) {
      aDelta = clampInt(Math.round(aDelta * rematchEloBonusMultiplier), -300, 300);
      bDelta = clampInt(Math.round(bDelta * rematchEloBonusMultiplier), -300, 300);
    }
    const rematchDoubleKo = Boolean(rematchRequesterId && loserId === rematchRequesterId);

    const aRatingAfter = clampInt(aRatingBefore + aDelta, 400, 4000);
    const bRatingAfter = clampInt(bRatingBefore + bDelta, 400, 4000);

    const aPrev = ratingsMap?.get ? (ratingsMap.get(aId) || { wins: 0, losses: 0, streak: 0 }) : { wins: 0, losses: 0, streak: 0 };
    const bPrev = ratingsMap?.get ? (ratingsMap.get(bId) || { wins: 0, losses: 0, streak: 0 }) : { wins: 0, losses: 0, streak: 0 };

    const nextStreak = (prevStreak, outcome) => {
      const s = Number(prevStreak ?? 0) || 0;
      if (outcome === 'win') return s >= 0 ? s + 1 : 1;
      if (outcome === 'lose' || outcome === 'forfeit') return s <= 0 ? s - 1 : -1;
      return 0;
    };

    const aWins = Number(aPrev.wins ?? 0) + (aOutcome === 'win' ? 1 : 0);
    const aLosses = Number(aPrev.losses ?? 0) + (aOutcome === 'lose' || aOutcome === 'forfeit' ? 1 : 0);
    const bWins = Number(bPrev.wins ?? 0) + (bOutcome === 'win' ? 1 : 0);
    const bLosses = Number(bPrev.losses ?? 0) + (bOutcome === 'lose' || bOutcome === 'forfeit' ? 1 : 0);

    const aStreak = nextStreak(aPrev.streak, aOutcome);
    const bStreak = nextStreak(bPrev.streak, bOutcome);

    // Upsert ratings
    await client.query(
      `INSERT INTO arena_ratings (season_id, agent_id, rating, wins, losses, streak, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (season_id, agent_id)
       DO UPDATE SET rating = EXCLUDED.rating, wins = EXCLUDED.wins, losses = EXCLUDED.losses, streak = EXCLUDED.streak, updated_at = NOW()`,
      [season.id, aId, aRatingAfter, aWins, aLosses, aStreak]
    );
    await client.query(
      `INSERT INTO arena_ratings (season_id, agent_id, rating, wins, losses, streak, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (season_id, agent_id)
       DO UPDATE SET rating = EXCLUDED.rating, wins = EXCLUDED.wins, losses = EXCLUDED.losses, streak = EXCLUDED.streak, updated_at = NOW()`,
      [season.id, bId, bRatingAfter, bWins, bLosses, bStreak]
    );
    if (ratingsMap?.set) {
      ratingsMap.set(aId, { rating: aRatingAfter, wins: aWins, losses: aLosses, streak: aStreak });
      ratingsMap.set(bId, { rating: bRatingAfter, wins: bWins, losses: bLosses, streak: bStreak });
    }

    const winnerCoinsNet = basePrizeToWinner + cyclePrizeBonus;
    const loserCoinsNet = basePrizeToWinner + fee;
    const aCoinsNet = aId === winnerId ? winnerCoinsNet : -loserCoinsNet;
    const bCoinsNet = bId === winnerId ? winnerCoinsNet : -loserCoinsNet;

    // Rounds (P4): 3-turn timeline + per-round win-prob + momentum shifts.
    const cheerSummary = await safeQ(
      () => ArenaService.cheerSummaryWithClient(client, {
        matchId: String(match.id),
        limit: 300,
        maxMessages: 8,
        bestMinCount: 2
      }),
      { aCount: 0, bCount: 0, messages: [], bestCheer: null, source: 'none' },
      'resolve_cheers'
    );
    const cheerA = Math.max(0, Number(cheerSummary?.aCount ?? 0) || 0);
    const cheerB = Math.max(0, Number(cheerSummary?.bCount ?? 0) || 0);
    const cheerMessages = Array.isArray(cheerSummary?.messages) ? cheerSummary.messages : [];
    const bestCheer = cheerSummary?.bestCheer && typeof cheerSummary.bestCheer === 'object' ? cheerSummary.bestCheer : null;
    const cheerDeltaRaw = ((cheerA - cheerB) / (cheerA + cheerB + 4)) * 0.03;
    const cheerDelta = Math.max(-0.03, Math.min(0.03, Number.isFinite(cheerDeltaRaw) ? cheerDeltaRaw : 0));
    const cheerMeta = {
      a_count: cheerA,
      b_count: cheerB,
      messages: cheerMessages,
      best_cheer: bestCheer,
      buff_applied: { delta_a: Math.round(cheerDelta * 1000) / 1000, cap: 0.03 }
    };

    const rounds = buildRounds({
      seed,
      mode,
      aTotal10: aScore10,
      bTotal10: bScore10,
      ratingA: aRatingBefore,
      ratingB: bRatingBefore,
      aHints,
      bHints,
      rounds: 3
    }).map((r) => {
      const pA = clamp01((Number(r.win_prob_a ?? 0.5) || 0.5) + cheerDelta);
      return { ...r, win_prob_a: Math.round(pA * 1000) / 1000, win_prob_b: Math.round((1 - pA) * 1000) / 1000 };
    });

    // COURT_TRIAL: LLM으로 실제 법정 변론 생성 (fallback: 기존 하드코딩 라벨 유지)
    if (mode === 'COURT_TRIAL' && courtTrial) {
      // 펫 성격(profile) + 주인 기억(preference/coaching) 조회 → 변론 스타일에 반영
      const [aProfileFacts, bProfileFacts, aOwnerMemFacts, bOwnerMemFacts] = await Promise.all([
        safeQ(
          () => client.query(
            `SELECT key, value FROM facts WHERE agent_id = $1 AND kind = 'profile' ORDER BY confidence DESC LIMIT 5`,
            [aId]
          ).then(r => r.rows || []),
          [], 'court_profile_a'
        ),
        safeQ(
          () => client.query(
            `SELECT key, value FROM facts WHERE agent_id = $1 AND kind = 'profile' ORDER BY confidence DESC LIMIT 5`,
            [bId]
          ).then(r => r.rows || []),
          [], 'court_profile_b'
        ),
        safeQ(
          () => client.query(
            `SELECT key, value FROM facts WHERE agent_id = $1 AND kind IN ('preference', 'coaching') ORDER BY confidence DESC LIMIT 3`,
            [aId]
          ).then(r => r.rows || []),
          [], 'court_owner_mem_a'
        ),
        safeQ(
          () => client.query(
            `SELECT key, value FROM facts WHERE agent_id = $1 AND kind IN ('preference', 'coaching') ORDER BY confidence DESC LIMIT 3`,
            [bId]
          ).then(r => r.rows || []),
          [], 'court_owner_mem_b'
        )
      ]);
      const extractFactText = (row) => {
        if (!row?.value) return null;
        if (typeof row.value === 'string') return row.value;
        if (typeof row.value === 'object' && row.value.text) return String(row.value.text);
        if (typeof row.value === 'object') return JSON.stringify(row.value);
        return null;
      };
      const aPersonalityTraits = aProfileFacts.map(extractFactText).filter(Boolean);
      const bPersonalityTraits = bProfileFacts.map(extractFactText).filter(Boolean);
      const aOwnerMemories = aOwnerMemFacts.map(extractFactText).filter(Boolean);
      const bOwnerMemories = bOwnerMemFacts.map(extractFactText).filter(Boolean);

      try {
        const courtArgs = await ProxyBrainService.generate('COURT_ARGUMENT', {
          case: {
            title: courtTrial.title,
            charge: courtTrial.charge,
            summary: courtTrial.summary || '',
            facts: courtTrial.facts,
            statute: courtTrial.statute,
            actual_reasoning: courtTrial.actual_reasoning || ''
          },
          a: {
            name: aName,
            coaching: aMemoryRefs.map((r) => r.text).slice(0, 3),
            personality_traits: aPersonalityTraits,
            owner_memories: aOwnerMemories
          },
          b: {
            name: bName,
            coaching: bMemoryRefs.map((r) => r.text).slice(0, 3),
            personality_traits: bPersonalityTraits,
            owner_memories: bOwnerMemories
          },
          winner: winnerId === aId ? 'a' : 'b',
          round_scores: rounds.map((r) => ({ a: r.a_score_delta, b: r.b_score_delta }))
        });
        if (Array.isArray(courtArgs?.rounds)) {
          for (let i = 0; i < rounds.length && i < courtArgs.rounds.length; i += 1) {
            const ca = courtArgs.rounds[i];
            if (ca?.a_argument) rounds[i].a_action = String(ca.a_argument).slice(0, 600);
            if (ca?.b_argument) rounds[i].b_action = String(ca.b_argument).slice(0, 600);
          }
        }
        if (courtArgs?.a_closing) courtTrial.a_closing = String(courtArgs.a_closing).slice(0, 300);
        if (courtArgs?.b_closing) courtTrial.b_closing = String(courtArgs.b_closing).slice(0, 300);
        if (Array.isArray(courtArgs?.reference_cases)) {
          courtTrial.reference_cases = courtArgs.reference_cases
            .slice(0, 3)
            .map((x) => {
              const o = x && typeof x === 'object' ? x : {};
              const caseNo = safeText(o.case_no ?? o.caseNo ?? '', 80);
              const holding = safeText(o.holding ?? '', 220);
              const relevance = safeText(o.relevance ?? '', 220);
              if (!caseNo && !holding && !relevance) return null;
              return {
                case_no: caseNo || '판례번호 미상(입력 기준)',
                holding: holding || '',
                relevance: relevance || ''
              };
            })
            .filter(Boolean);
        }
        if (courtArgs?.reasoning_summary && typeof courtArgs.reasoning_summary === 'object') {
          const rs = courtArgs.reasoning_summary;
          courtTrial.reasoning_summary = {
            issue: safeText(rs.issue, 220),
            rule: safeText(rs.rule, 220),
            application: safeText(rs.application, 260),
            conclusion: safeText(rs.conclusion, 220)
          };
        }
        if (courtArgs?.verdict_analysis && typeof courtArgs.verdict_analysis === 'object') {
          const va = courtArgs.verdict_analysis;
          const a = va.a && typeof va.a === 'object' ? va.a : {};
          const b = va.b && typeof va.b === 'object' ? va.b : {};
          courtTrial.verdict_analysis = {
            a: {
              matched: safeText(a.matched, 260),
              missed: safeText(a.missed, 260)
            },
            b: {
              matched: safeText(b.matched, 260),
              missed: safeText(b.missed, 260)
            },
            gap_with_actual: safeText(va.gap_with_actual ?? va.gapWithActual, 320)
          };
        }
        if (courtArgs?.commentary && typeof courtArgs.commentary === 'object') {
          const c = courtArgs.commentary;
          const roundCommentary = Array.isArray(c.rounds)
            ? c.rounds.map((x) => safeText(x, 160)).filter(Boolean).slice(0, 3)
            : [];
          for (let i = 0; i < rounds.length && i < roundCommentary.length; i += 1) {
            const line = roundCommentary[i];
            if (!line) continue;
            const base = safeText(rounds[i]?.highlight, 140);
            if (!base) {
              rounds[i].highlight = line;
            } else if (!base.includes(line)) {
              rounds[i].highlight = safeText(`${base} · ${line}`, 220);
            }
          }
          courtTrial.commentary = {
            rounds: roundCommentary,
            verdict: safeText(c.verdict, 600)
          };
        }
        courtTrial.llm_arguments = true;
      } catch (err) {
        if (config.nodeEnv !== 'test') {
          // eslint-disable-next-line no-console
          console.warn('[COURT_TRIAL] LLM argument generation failed, using fallback:', err?.message || err);
        }
        courtTrial.llm_arguments = false;
        try {
          const fb = buildCourtArgumentFallback({
            courtTrial,
            rounds,
            aName,
            bName,
            aCoaching: aMemoryRefs.map((r) => r.text).slice(0, 2),
            bCoaching: bMemoryRefs.map((r) => r.text).slice(0, 2),
            winner: winnerId === aId ? 'a' : 'b'
          });
          if (Array.isArray(fb?.rounds)) {
            for (let i = 0; i < rounds.length && i < fb.rounds.length; i += 1) {
              const ca = fb.rounds[i];
              if (ca?.a_argument) rounds[i].a_action = String(ca.a_argument).slice(0, 500);
              if (ca?.b_argument) rounds[i].b_action = String(ca.b_argument).slice(0, 500);
            }
          }
          if (fb?.a_closing) courtTrial.a_closing = String(fb.a_closing).slice(0, 300);
          if (fb?.b_closing) courtTrial.b_closing = String(fb.b_closing).slice(0, 300);
        } catch { /* keep existing labels */ }
      }

      // Backward-compat alias keys expected by some reports/tools.
      const openingA =
        safeText(rounds?.[0]?.a_action ?? '', 500) ||
        safeText(courtTrial.a_closing, 300) ||
        safeText(courtTrial.title, 240);
      const openingB =
        safeText(rounds?.[0]?.b_action ?? '', 500) ||
        safeText(courtTrial.b_closing, 300) ||
        safeText(courtTrial.title, 240);
      const verdictAlias =
        safeText(courtTrial.verdict, 200) ||
        safeText(courtTrial.correct_verdict, 200) ||
        safeText(courtTrial.actual_verdict, 200) ||
        safeText(courtTrial?.a?.verdict, 200) ||
        safeText(courtTrial?.b?.verdict, 200);
      if (!safeText(courtTrial.opening_a, 500) && openingA) courtTrial.opening_a = openingA;
      if (!safeText(courtTrial.opening_b, 500) && openingB) courtTrial.opening_b = openingB;
      if (!safeText(courtTrial.verdict, 200) && verdictAlias) courtTrial.verdict = verdictAlias;
    }

    const coachingNarrativeBySide = {
      a: buildCoachingNarrative({
        mode,
        ownerUserId: aAgent?.ownerUserId,
        coachingRefs: aMemoryRefs,
        coachingApplied: aCoachingScoreBonusRate > 0,
        dominantHints: trainingInfluence?.a?.weights?.dominant || [],
        rounds,
        side: 'a'
      }),
      b: buildCoachingNarrative({
        mode,
        ownerUserId: bAgent?.ownerUserId,
        coachingRefs: bMemoryRefs,
        coachingApplied: bCoachingScoreBonusRate > 0,
        dominantHints: trainingInfluence?.b?.weights?.dominant || [],
        rounds,
        side: 'b'
      })
    };
    trainingInfluence.a.coaching_narrative = coachingNarrativeBySide.a || null;
    trainingInfluence.b.coaching_narrative = coachingNarrativeBySide.b || null;
    const coachingNarrative = pickResultCoachingNarrative({
      winnerId,
      aId,
      bId,
      bySide: coachingNarrativeBySide
    });

    // Auto tags (P1/P4): near-miss + comeback + underdog upset + round highlights.
    const tags = [];
    if (forfeit) tags.push('몰수');
    if (gapPts <= 1) tags.push('박빙');
    else if (gapPts <= 3) tags.push('접전');
    else if (gapPts >= 8) tags.push('압도적');
    if (totalStake >= 4) tags.push('빅스테이크');
    else if (totalStake >= 2) tags.push('스테이크');
    if (cyclePrizeBonus > 0) tags.push('호황 보너스');
    if (aBad || bBad) tags.push('컨디션 난조');
    if (cheerMeta.best_cheer) tags.push('베스트 응원');
    if (rematchRequesterId) tags.push('복수전');
    if (rematchEloBonusApplied) tags.push('복수 성공');
    if (rematchDoubleKo) tags.push('더블 KO');

    const winnerRatingBefore = winnerId === aId ? aRatingBefore : bRatingBefore;
    const loserRatingBefore = winnerId === aId ? bRatingBefore : aRatingBefore;
    const winnerExpected = winnerId === aId ? expectedWinProb(aRatingBefore, bRatingBefore) : expectedWinProb(bRatingBefore, aRatingBefore);
    const isUpset = winnerRatingBefore + 60 < loserRatingBefore;
    if (isUpset) tags.push('언더독 업셋');
    if (winnerExpected < 0.3) tags.push('대역전');
    if (Math.max(Math.abs(aDelta), Math.abs(bDelta)) >= 20) tags.push('급변');
    if (rounds.some((r) => String(r?.highlight ?? '').includes('역전'))) tags.push('역전');
    if ((winnerId === aId && aStreak >= 3) || (winnerId === bId && bStreak >= 3)) tags.push('기세 폭발');

    // Condition update for next matches (facts).
    const aAfterCond = clampInt(aCondition + conditionDeltaFor({ seed, agentId: aId, outcome: aOutcome, forfeit, streakAfter: aStreak }), 0, 100);
    const bAfterCond = clampInt(bCondition + conditionDeltaFor({ seed, agentId: bId, outcome: bOutcome, forfeit, streakAfter: bStreak }), 0, 100);
    await safeQ(
      () => client.query(
        `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
         VALUES
           ($1, 'arena', 'condition', $2::jsonb, 1.0, NOW()),
           ($3, 'arena', 'condition', $4::jsonb, 1.0, NOW())
         ON CONFLICT (agent_id, kind, key)
         DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
        [
          aId,
          JSON.stringify({ condition: aAfterCond, updated_day: iso, match_id: String(match.id) }),
          bId,
          JSON.stringify({ condition: bAfterCond, updated_day: iso, match_id: String(match.id) })
        ]
      ),
      null, 'resolve_condition'
    );

    // Match result fact: store last match outcome for each agent so the pet
    // can reference it in the next conversation (e.g. "I won!" / "I lost...").
    const winnerOpponentName = winnerId === aId ? bName : aName;
    const loserOpponentName = loserId === aId ? bName : aName;
    await safeQ(
      () => client.query(
        `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
         VALUES
           ($1, 'arena', 'last_match_result', $2::jsonb, 1.0, NOW()),
           ($3, 'arena', 'last_match_result', $4::jsonb, 1.0, NOW())
         ON CONFLICT (agent_id, kind, key)
         DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
        [
          winnerId,
          JSON.stringify({
            result: 'win',
            mode,
            opponent: winnerOpponentName,
            match_id: String(match.id),
            timestamp: new Date().toISOString()
          }),
          loserId,
          JSON.stringify({
            result: 'loss',
            mode,
            opponent: loserOpponentName,
            match_id: String(match.id),
            timestamp: new Date().toISOString()
          })
        ]
      ),
      null, 'resolve_match_result_fact'
    );

    // Stake penalties (P1.3): user-owned pet loss => coin burn + XP penalty.
    const loserAgent = loserId === aId ? aAgent : bAgent;
    const isUserOwned = Boolean(loserAgent?.ownerUserId);
    const penaltyCoins = isUserOwned ? clampInt((lossPenaltyCoinsBase || 0) + (forfeit ? 1 : 0) + (totalStake >= 4 ? 1 : 0), 0, 50) : 0;
    const penaltyXp = isUserOwned ? -clampInt((lossPenaltyXpBase || 0) + (forfeit ? 10 : 0), 0, 500) : 0;

    let penaltyTx = null;
    if (penaltyCoins > 0) {
      penaltyTx = await safeQ(
        () => TransactionService.transfer(
          { fromAgentId: loserId, toAgentId: null, amount: penaltyCoins, txType: 'PENALTY', memo: `arena loss penalty (day:${iso})`, referenceId: match.id, referenceType: 'arena_match' },
          client
        ),
        null, 'resolve_penalty_tx'
      );
    }
    if (penaltyXp < 0) {
      await safeQ(
        () => ProgressionService.adjustXpWithClient(client, loserId, {
          deltaXp: penaltyXp,
          day: iso,
          source: { kind: 'arena', code: 'loss' },
          meta: { match_id: String(match.id), mode, wager: totalStake, forfeit: Boolean(forfeit) }
        }),
        null, 'resolve_penalty_xp'
      );
    }

    // Prediction mini-game (simple): distribute minted pot among correct predictors.
    const tx0 = meta0.tx && typeof meta0.tx === 'object' ? meta0.tx : {};
    const predictKey = `predict:${String(match.id)}`;
    let predictSummary = null;
    let predictTxIds = [];
    if (!tx0.predict_paid) {
      const { rows: predRows } = await safeQ(
        () => client.query(
          `SELECT agent_id, value
           FROM facts
           WHERE kind = 'arena_pred' AND key = $1`,
          [predictKey]
        ),
        { rows: [] }, 'resolve_preds'
      );

      const preds = (predRows || []).map((r) => {
        const v = r.value && typeof r.value === 'object' ? r.value : {};
        const pick = String(v.pick || v.side || '').trim().toLowerCase();
        const pickedAgentId = String(v.picked_agent_id || v.pickedAgentId || '').trim();
        const agentId = String(r.agent_id || '').trim();
        const side =
          pick === 'a' || pick === 'b'
            ? pick
            : pickedAgentId === aId
              ? 'a'
              : pickedAgentId === bId
                ? 'b'
                : null;
        return { agentId, side };
      }).filter((p) => p.agentId && (p.side === 'a' || p.side === 'b'));

      const totalPreds = preds.length;
      const winners = preds.filter((p) => (p.side === 'a' ? aId : bId) === winnerId).map((p) => p.agentId);
      const winnersUniq = [...new Set(winners)].sort();
      const winnerCount = winnersUniq.length;

      const potBase = clampInt(config.limbopet?.arenaPredictPotCoins ?? 3, 0, 50);
      let pot = clampInt(potBase + Math.min(12, totalPreds), 0, 60);
      if (pot > 0 && winnerCount > 0) {
        pot = Math.max(pot, winnerCount);
        const per = Math.max(1, Math.floor(pot / winnerCount));
        const rem = Math.max(0, pot - per * winnerCount);
        let i = 0;
        for (const agentId of winnersUniq) {
          const amt = per + (i < rem ? 1 : 0);
          i += 1;
          // eslint-disable-next-line no-await-in-loop
          const tx = await safeQ(
            () => TransactionService.transfer(
              {
                fromAgentId: null,
                toAgentId: agentId,
                amount: amt,
                txType: 'PREDICT',
                memo: `arena predict reward (day:${iso})`,
                referenceId: match.id,
                referenceType: 'arena_match_predict'
              },
              client
            ),
            null, 'resolve_predict_tx'
          );
          if (tx?.id) predictTxIds.push(String(tx.id));
        }
        predictSummary = { total: totalPreds, winners: winnerCount, pot, per_winner: per };
      } else if (pot > 0) {
        predictSummary = { total: totalPreds, winners: 0, pot, per_winner: 0 };
      }
    }

    // Revenge (P4): big match loss => revenge flag for 2 weeks.
    const bigLoss = Boolean(totalStake >= 4 || isUpset || winnerExpected < 0.3 || Math.max(Math.abs(aDelta), Math.abs(bDelta)) >= 20);
    if (bigLoss && (isUpset || winnerExpected < 0.3)) {
      await safeQ(
        () => RelationshipService.recordMemoryWithClient(client, {
          fromAgentId: loserId,
          toAgentId: winnerId,
          eventType: 'ARENA_UPSET',
          summary: '역전당했다',
          emotion: 'shocked',
          day: iso
        }),
        null, 'resolve_memory'
      );
    }

    const expiresDay = (() => {
      const d = parseIsoDayUTC(iso);
      if (!d) return null;
      d.setUTCDate(d.getUTCDate() + 14);
      return formatIsoDayUTC(d);
    })();

    // Scandal (P4): 10% accusation on big match loss (resolved 3 days later).
    const scandalAcc = await safeQ(
      () => ScandalService.maybeCreateArenaAccusationWithClient(client, {
        matchId: String(match.id),
        day: iso,
        seed,
        accuserId: loserId,
        accusedId: winnerId,
        bigMatch: Boolean(bigLoss)
      }),
      { created: false }, 'resolve_scandal'
    );
    if (scandalAcc?.created) tags.push('조작 의혹');

    // Consume revenge flags if this match was a rematch.
    await safeQ(
      () => client.query(
        `DELETE FROM facts
         WHERE kind = 'arena'
           AND ((agent_id = $1 AND key = $2) OR (agent_id = $3 AND key = $4))`,
        [aId, `revenge:${bId}`, bId, `revenge:${aId}`]
      ),
      null, 'resolve_del_revenge'
    );
    if (rematchRequesterId && rematchSourceMatchId) {
      await safeQ(
        () => client.query(
          `DELETE FROM facts
           WHERE agent_id = $1
             AND kind = 'arena'
             AND key = $2`,
          [rematchRequesterId, `rematch_req:${rematchSourceMatchId}`]
        ),
        null, 'resolve_del_rematch'
      );
    }

    if (bigLoss && expiresDay) {
      await safeQ(
        () => client.query(
          `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
           VALUES ($1, 'arena', $2, $3::jsonb, 1.0, NOW())
           ON CONFLICT (agent_id, kind, key)
           DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
          [
            loserId,
            `revenge:${winnerId}`,
            JSON.stringify({
              opponent_id: winnerId,
              match_id: String(match.id),
              created_day: iso,
              expires_day: expiresDay,
              reason: isUpset ? 'upset' : winnerExpected < 0.3 ? 'comeback' : totalStake >= 4 ? 'big_stake' : 'swing'
            })
          ]
        ),
        null, 'resolve_revenge_flag'
      );
      tags.push('복수전');
    }

    // Participants rows
    await client.query(
      `INSERT INTO arena_match_participants
         (match_id, agent_id, score, outcome, wager, fee_burned, coins_net, rating_before, rating_after, rating_delta)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10),
         ($1,$11,$12,$13,$5,$6,$14,$15,$16,$17)
       ON CONFLICT (match_id, agent_id) DO NOTHING`,
      [
        match.id,
        aId,
        Math.round(aScore * 10),
        aOutcome,
        totalStake,
        fee,
        aCoinsNet,
        aRatingBefore,
        aRatingAfter,
        aDelta,
        bId,
        Math.round(bScore * 10),
        bOutcome,
        bCoinsNet,
        bRatingBefore,
        bRatingAfter,
        bDelta
      ]
    );

    // Relationship: mutual rivalry increase + loser's jealousy spike.
    const baseRiv =
      mode === 'DEBATE_CLASH'
        ? 4
        : mode === 'PUZZLE_SPRINT' || mode === 'MATH_RACE' || mode === 'COURT_TRIAL'
          ? 3
          : 2;
    const baseJel =
      mode === 'PUZZLE_SPRINT' || mode === 'AUCTION_DUEL' || mode === 'PROMPT_BATTLE' || mode === 'MATH_RACE'
        ? 2
        : 1;

    const beforeA = { affinity: Number(relAtoB?.affinity ?? 0) || 0, jealousy: Number(relAtoB?.jealousy ?? 0) || 0, rivalry: Number(relAtoB?.rivalry ?? 0) || 0 };
    const beforeB = { affinity: Number(relBtoA?.affinity ?? 0) || 0, jealousy: Number(relBtoA?.jealousy ?? 0) || 0, rivalry: Number(relBtoA?.rivalry ?? 0) || 0 };
    const maxScore = Math.max(0.0001, Number(aScore) || 0, Number(bScore) || 0);
    const scoreGapPct = (Math.abs((Number(aScore) || 0) - (Number(bScore) || 0)) / maxScore) * 100;
    const isCloseDebate = mode === 'DEBATE_CLASH' && scoreGapPct < 5;
    const recentFaceoffCount = await safeQ(
      () => client.query(
        `SELECT COUNT(*)::int AS n
         FROM (
           SELECT m.id
           FROM arena_matches m
           WHERE m.status = 'resolved'
             AND EXISTS (
               SELECT 1
               FROM arena_match_participants p
               WHERE p.match_id = m.id AND p.agent_id = $1
             )
             AND EXISTS (
               SELECT 1
               FROM arena_match_participants p
               WHERE p.match_id = m.id AND p.agent_id = $2
             )
           ORDER BY m.day DESC, m.slot DESC, m.created_at DESC
           LIMIT 2
         ) t`,
        [aId, bId]
      ).then((r) => Number(r.rows?.[0]?.n ?? 0) || 0),
      0, 'resolve_faceoff_count'
    );
    const isThirdFaceoff = mode === 'DEBATE_CLASH' && recentFaceoffCount >= 2;

    const aToBDelta = aId === loserId ? { rivalry: baseRiv + 2, jealousy: baseJel + 2, trust: -1 } : { rivalry: baseRiv, jealousy: 0, trust: 0 };
    const bToADelta = bId === loserId ? { rivalry: baseRiv + 2, jealousy: baseJel + 2, trust: -1 } : { rivalry: baseRiv, jealousy: 0, trust: 0 };
    if (isCloseDebate) {
      aToBDelta.affinity = Number(aToBDelta.affinity ?? 0) + 3;
      bToADelta.affinity = Number(bToADelta.affinity ?? 0) + 3;
      tags.push('명승부');
    }
    if (isThirdFaceoff) {
      aToBDelta.affinity = Number(aToBDelta.affinity ?? 0) + 5;
      bToADelta.affinity = Number(bToADelta.affinity ?? 0) + 5;
      tags.push('서로 인정');
    }
    if (rematchRequesterId) {
      const requesterWon = rematchRequesterId === winnerId;
      if (rematchRequesterId === aId) {
        if (requesterWon) {
          aToBDelta.rivalry = Number(aToBDelta.rivalry ?? 0) - 5;
          aToBDelta.affinity = Number(aToBDelta.affinity ?? 0) + 3;
        } else {
          aToBDelta.rivalry = Number(aToBDelta.rivalry ?? 0) + 8;
          aToBDelta.jealousy = Number(aToBDelta.jealousy ?? 0) + 5;
        }
      } else if (rematchRequesterId === bId) {
        if (requesterWon) {
          bToADelta.rivalry = Number(bToADelta.rivalry ?? 0) - 5;
          bToADelta.affinity = Number(bToADelta.affinity ?? 0) + 3;
        } else {
          bToADelta.rivalry = Number(bToADelta.rivalry ?? 0) + 8;
          bToADelta.jealousy = Number(bToADelta.jealousy ?? 0) + 5;
        }
      }
      tags.push(requesterWon ? '복수 해소' : '복수 실패');
    }
    if (rematchDoubleKo) {
      aToBDelta.rivalry = Number(aToBDelta.rivalry ?? 0) + 10;
      bToADelta.rivalry = Number(bToADelta.rivalry ?? 0) + 10;
    }

    const updated = await safeQ(
      () => RelationshipService.adjustMutualWithClient(client, aId, bId, aToBDelta, bToADelta),
      null, 'resolve_rel_adjust'
    );
    await bestEffortInTransaction(
      client,
      async () => {
        const afterA = updated?.aToB ?? null;
        const afterB = updated?.bToA ?? null;
        if (afterA) {
          await RelationshipMilestoneService.recordIfCrossedWithClient(client, { day: iso, fromAgentId: aId, toAgentId: bId, otherName: bName, before: beforeA, after: afterA });
        }
        if (afterB) {
          await RelationshipMilestoneService.recordIfCrossedWithClient(client, { day: iso, fromAgentId: bId, toAgentId: aId, otherName: aName, before: beforeB, after: afterB });
        }
      },
      { label: 'arena_rel_milestones' }
    );

    // Mode details for recap meta.
    const puzzle = mode === 'PUZZLE_SPRINT' ? buildPuzzle(mulberry32(hash32(`${seed}:puzzle`))) : null;
    const auctionBase = mode === 'AUCTION_DUEL' ? buildAuctionDuel(mulberry32(hash32(`${seed}:auction_base`))) : null;
    const debateBaseFromMeta = mode === 'DEBATE_CLASH' && meta0?.debate_base && typeof meta0.debate_base === 'object'
      ? meta0.debate_base
      : null;
    const debateBase = mode === 'DEBATE_CLASH'
      ? (debateBaseFromMeta || buildDebateClash(mulberry32(hash32(`${seed}:debate_base`))))
      : null;
    const aDebateJob = mode === 'DEBATE_CLASH'
      ? await getArenaDebateJobResultWithClient(client, { matchId: String(match.id), agentId: aId })
      : null;
    const bDebateJob = mode === 'DEBATE_CLASH'
      ? await getArenaDebateJobResultWithClient(client, { matchId: String(match.id), agentId: bId })
      : null;
    if (mode === 'DEBATE_CLASH') {
      const hasLlm = Boolean(aDebateJob?.hasUsableResult || bDebateJob?.hasUsableResult);
      tags.push(hasLlm ? 'AI 토론' : '토론 폴백');
    }

    const headline = headlineFor({ mode, aName, bName, winnerName, stake: { wager: totalStake } });

    const auction = mode === 'AUCTION_DUEL'
      ? (() => {
        const base = auctionBase || { item: '전략서', vibe: '계산', rule: '더 높은 입찰가가 승리' };
        const aPerf = perfAuctionDuel({ seed, agentId: aId, rating: aRatingBefore, stats: aStats, jobCode: aJobCode, hints: aHints, wager: totalStake, base });
        const bPerf = perfAuctionDuel({ seed, agentId: bId, rating: bRatingBefore, stats: bStats, jobCode: bJobCode, hints: bHints, wager: totalStake, base });
        const aBid = clampInt(aPerf.bid, 0, totalStake);
        const bBid = clampInt(bPerf.bid, 0, totalStake);
        const winnerBid = winnerId === aId ? aBid : bBid;
        const loserBid = winnerId === aId ? bBid : aBid;
        const close = Math.abs(aBid - bBid) <= 1;
        return { item: base.item, vibe: base.vibe, rule: base.rule, close, a: { bid: aBid, time_ms: aPerf.time_ms, posture: aPerf.posture, line: aPerf.line }, b: { bid: bBid, time_ms: bPerf.time_ms, posture: bPerf.posture, line: bPerf.line }, result: { winner_bid: winnerBid, loser_bid: loserBid } };
      })()
      : null;

    const debate = mode === 'DEBATE_CLASH'
      ? (() => {
        const base = debateBase || { topic: '사회 규칙은 필요한가?', rule: '논리+태도+임팩트', judge: '편집자' };
        const aPerf = perfDebateClash({
          seed,
          agentId: aId,
          rating: aRatingBefore,
          stats: aStats,
          jobCode: aJobCode,
          hints: aHints,
          base,
          llmDebate: aDebateJob?.hasUsableResult ? { claims: aDebateJob.claims, closer: aDebateJob.closer } : null
        });
        const bPerf = perfDebateClash({
          seed,
          agentId: bId,
          rating: bRatingBefore,
          stats: bStats,
          jobCode: bJobCode,
          hints: bHints,
          base,
          llmDebate: bDebateJob?.hasUsableResult ? { claims: bDebateJob.claims, closer: bDebateJob.closer } : null
        });
        return {
          topic: base.topic,
          rule: base.rule,
          judge: base.judge,
          a: {
            ...aPerf,
            llm_job_id: aDebateJob?.jobId ?? null,
            llm_status: aDebateJob?.status ?? null,
            llm_source: aDebateJob?.source ?? null
          },
          b: {
            ...bPerf,
            llm_job_id: bDebateJob?.jobId ?? null,
            llm_status: bDebateJob?.status ?? null,
            llm_source: bDebateJob?.source ?? null
          },
          llm: {
            a_status: aDebateJob?.status ?? null,
            b_status: bDebateJob?.status ?? null,
            a_source: aDebateJob?.source ?? null,
            b_source: bDebateJob?.source ?? null,
            a_error: aDebateJob?.error ?? null,
            b_error: bDebateJob?.error ?? null
          }
        };
      })()
      : null;

    const matchMetaBase = {
      headline,
      mode_label: modeLabel(mode),
      cast: { aId, aName, bId, bName },
      tags: [...new Set(tags)].slice(0, 8),
      near_miss: nearMiss,
      training_influence: trainingInfluence,
      recent_memory_influence: recentMemoryInfluence,
      coaching_narrative: coachingNarrative,
      coaching_narrative_by_side: coachingNarrativeBySide,
      prompt_profile: { a: aPromptProfile, b: bPromptProfile },
      rounds,
      cheer: cheerMeta,
      condition: {
        a_before: aCondition,
        b_before: bCondition,
        a_after: aAfterCond,
        b_after: bAfterCond,
        mult_a: Math.round(aMult * 1000) / 1000,
        mult_b: Math.round(bMult * 1000) / 1000
      },
      stake: {
        wager: totalStake,
        fee_burned: fee,
        to_winner: toWinner,
        to_winner_base: basePrizeToWinner,
        cycle_prize_bonus: cyclePrizeBonus,
        cycle_state: cycleState,
        loss_penalty_coins: penaltyCoins
      },
      result: { winnerId, winnerName, loserId, loserName, forfeit: Boolean(forfeit), coaching_narrative: coachingNarrative },
      live: { ...liveMeta, interventions },
      revenge: {
        a_had: hadRevengeA,
        b_had: hadRevengeB,
        created_for: bigLoss ? loserId : null,
        expires_day: bigLoss ? expiresDay : null,
        rematch_requester_id: rematchRequesterId || null,
        rematch_manual: Boolean(rematchRequesterId),
        rematch_source_match_id: rematchSourceMatchId,
        rematch_elo_bonus_applied: rematchEloBonusApplied,
        rematch_elo_bonus_multiplier: rematchEloBonusApplied ? rematchEloBonusMultiplier : 1.0,
        rematch_double_ko: rematchDoubleKo
      },
      scandal: scandalAcc?.created ? { status: 'open', verdict_day: scandalAcc.verdict_day ?? null } : null,
      predict: predictSummary,
      auction,
      debate,
      puzzle: puzzle ? { kind: puzzle.kind, question: puzzle.question, answer: puzzle.answer } : null,
      math_race: mathRace,
      court_trial: courtTrial,
      prompt_battle: promptBattle,
      tx: {
        wager_tx_id: winnerTx?.id ?? null,
        fee_tx_id: feeTx?.id ?? null,
        boom_bonus_tx_id: bonusTx?.id ?? null,
        penalty_tx_id: penaltyTx?.id ?? null,
        predict_paid: Boolean(predictSummary),
        predict_tx_ids: predictTxIds
      }
    };

    const recap = await bestEffortInTransaction(
      client,
      async () => {
        return ArenaRecapPostService.ensureRecapPostWithClient(client, { matchId: match.id, authorId: winnerId, day: iso, slot, mode, matchMeta: matchMetaBase });
      },
      { label: 'arena_recap_post', fallback: { created: false, postId: null } }
    );
    const recapPostId = recap?.postId ? String(recap.postId) : null;

    await client.query(
      `UPDATE arena_matches
       SET status = 'resolved', meta = $2::jsonb
       WHERE id = $1`,
      [match.id, JSON.stringify({ ...matchMetaBase, recap_post_id: recapPostId })]
    );

    const mkPayload = (oppId, oppName, outcome, ratingDelta, coinsNet) => ({
      day: iso,
      match_id: match.id,
      mode,
      mode_label: modeLabel(mode),
      headline,
      opponent: { id: oppId, name: oppName },
      outcome,
      rating_delta: ratingDelta,
      coins_net: coinsNet,
      stake: {
        wager: totalStake,
        fee_burned: fee,
        to_winner: toWinner,
        to_winner_base: basePrizeToWinner,
        cycle_prize_bonus: cyclePrizeBonus,
        cycle_state: cycleState,
        loss_penalty_coins: penaltyCoins
      },
      forfeit: Boolean(forfeit),
      live: { ends_at: liveMeta.ends_at ?? null, interventions },
      training_influence: trainingInfluence,
      recent_memory_influence: recentMemoryInfluence,
      prompt_profile: { a: aPromptProfile, b: bPromptProfile },
      puzzle: puzzle ? { kind: puzzle.kind, question: puzzle.question } : null,
      math_race: mathRace ? { question: mathRace.question } : null,
      court_trial: courtTrial ? { title: courtTrial.title, charge: courtTrial.charge } : null,
      prompt_battle: promptBattle ? { theme: promptBattle.theme } : null
    });

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES
         ($1, 'ARENA_MATCH', $2::jsonb, 3),
         ($3, 'ARENA_MATCH', $4::jsonb, 3)`,
      [aId, JSON.stringify(mkPayload(bId, bName, aOutcome, aDelta, aCoinsNet)), bId, JSON.stringify(mkPayload(aId, aName, bOutcome, bDelta, bCoinsNet))]
    );

    const notifyPayload = [
      {
        userId: aAgent?.ownerUserId ? String(aAgent.ownerUserId) : null,
        title: `${aName} · ${aOutcome === 'win' ? '승리' : aOutcome === 'lose' ? '패배' : aOutcome}`,
        body: `${postposition(bName, '과')}의 경기 결과가 나왔어. (${modeLabel(mode)})`,
        pet_name: aName,
        opponent_name: bName,
        result_tag: `${aOutcome === 'win' ? '승리' : aOutcome === 'lose' ? '패배' : '무승부'} (${modeLabel(mode)})`,
        data: {
          day: iso,
          match_id: String(match.id),
          mode,
          outcome: aOutcome,
          opponent: { id: bId, name: bName },
          rating_delta: aDelta,
          coins_net: aCoinsNet,
          recap_post_id: recapPostId
        }
      },
      {
        userId: bAgent?.ownerUserId ? String(bAgent.ownerUserId) : null,
        title: `${bName} · ${bOutcome === 'win' ? '승리' : bOutcome === 'lose' ? '패배' : bOutcome}`,
        body: `${postposition(aName, '과')}의 경기 결과가 나왔어. (${modeLabel(mode)})`,
        pet_name: bName,
        opponent_name: aName,
        result_tag: `${bOutcome === 'win' ? '승리' : bOutcome === 'lose' ? '패배' : '무승부'} (${modeLabel(mode)})`,
        data: {
          day: iso,
          match_id: String(match.id),
          mode,
          outcome: bOutcome,
          opponent: { id: aId, name: aName },
          rating_delta: bDelta,
          coins_net: bCoinsNet,
          recap_post_id: recapPostId
        }
      }
    ];

    for (const n of notifyPayload) {
      if (!n.userId) continue;
      // Avoid duplicate push when the resolver retries on the same match.
      // eslint-disable-next-line no-await-in-loop
      const already = await client
        .query(
          `SELECT 1
           FROM notifications
           WHERE user_id = $1
             AND type = 'ARENA_RESULT'
             AND COALESCE(data->>'match_id', '') = $2
           LIMIT 1`,
          [n.userId, String(match.id)]
        )
        .then((r) => Boolean(r.rows?.[0]))
        .catch(() => false);
      if (already) continue;
      const resultMessage = NotificationTemplateService.render('ARENA_RESULT', {
        vars: {
          pet_name: n.pet_name,
          pet_a: n.pet_name,
          pet_b: n.opponent_name,
          result_tag: n.result_tag
        },
        fallback: {
          title: n.title,
          body: n.body
        }
      });
      // eslint-disable-next-line no-await-in-loop
      await NotificationService.create(client, n.userId, {
        type: 'ARENA_RESULT',
        title: resultMessage.title,
        body: resultMessage.body,
        data: n.data
      }).catch(() => null);
    }

    return { resolved: true, matchId: match.id };
  }
}

ArenaService.__test = {
  buildCoachingNarrative,
  buildCourtArgumentFallback
};

module.exports = ArenaService;
