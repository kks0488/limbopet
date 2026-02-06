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
const { bestEffortInTransaction } = require('../utils/savepoint');

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
  const reImpulseWords = /충동|지름|굿즈|충동구매/i;
  const reNo = /하지\s*마|하지\s*말|금지|말아|줄여|줄이/i;
  const reStudy = /공부|문제|퀴즈|퍼즐|연구/i;
  const reCalm = /침착|싸우지\s*마|차분|조용|화해/i;
  const reAggro = /이겨|밀어붙|싸워|박살|압도/i;

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
      calm >= 0.6 ? '침착' :
        study >= 0.6 ? '분석' :
          budget >= 0.6 || impulseStop >= 0.6 ? '절제' :
            '기본';

  const pickFrom = (arr) => pick(rng, arr) || `${who}의 선택`;

  if (m === 'DEBATE_CLASH') {
    return pickFrom(
      tone === '공세'
        ? ['도발로 압박한다!', '몰아붙이며 한마디 더!', '한 줄로 찍어누른다',
           '상대의 약점을 정조준!', '감정에 호소하며 밀어붙인다', '테이블을 치며 일어선다',
           '반박할 틈을 안 준다!', '비꼬는 말투로 자극한다']
        : tone === '침착'
          ? ['논리로 깔끔하게 정리', '차분하게 반박했다', '근거를 쌓아 올린다',
             '조용히 수치를 제시한다', '감정 없이 사실만 나열', '한 박자 쉬고 정리했다',
             '상대 주장을 인용해 뒤집는다', '미소 띤 채 반론을 꺼낸다']
          : tone === '분석'
            ? ['허점을 포착했다!', '근거를 보강하며 밀고 간다', '프레임을 뒤집었다',
               '통계를 꺼내 들었다!', '전제 자체를 뒤흔든다', '상대 논리의 모순을 지적',
               '비유로 쉽게 풀어냈다', '역사적 사례를 인용한다']
            : ['라인을 조정한다', '말을 아끼며 기다린다', '분위기를 읽고 있다',
               '눈치를 보며 타이밍을 잰다', '조용히 메모를 한다', '고개를 갸웃하며 듣는다',
               '아직 패를 보여주지 않는다', '상대의 실수를 기다린다']
    );
  }
  if (m === 'AUCTION_DUEL') {
    return pickFrom(
      tone === '절제'
        ? ['상한선 사수, 흔들리지 않는다', '한 번 멈칫… 하지만 버텼다', '손을 꽉 쥐고 참았다']
        : tone === '공세'
          ? ['더블! 배짱을 보여준다', '블러프를 던졌다!', '올인! 자신감인가 도박인가']
          : ['간을 본다, 아직은 아니다', '타이밍을 재고 있다', '슬쩍 올렸다']
    );
  }
  if (m === 'PUZZLE_SPRINT' || m === 'MATH_RACE') {
    return pickFrom(
      tone === '분석'
        ? ['풀이 완료, 정확하다', '패턴을 읽어냈다!', '실수를 지우고 다시 간다']
        : tone === '침착'
          ? ['속도를 낮추고 정확하게', '침착하게 검산, 흔들림 없다', '루틴대로 간다']
          : tone === '공세'
            ? ['속도를 올린다! 밀어붙이기', '단숨에 돌파했다', '승부수를 던졌다!']
            : ['무난하게 풀어냈다', '감으로 찍었다, 맞을까?', '손이 먼저 나갔다']
    );
  }
  if (m === 'COURT_TRIAL') {
    return pickFrom(
      tone === '분석'
        ? ['증거를 연결했다! 치밀하다', '모순을 정확히 짚었다', '기록을 들이밀며 압박']
        : tone === '공세'
          ? ['강하게 몰아붙인다!', '증인을 흔들어놓았다', '단정적으로 끊었다']
          : tone === '침착'
            ? ['조목조목 반박, 빈틈이 없다', '톤을 낮추며 차분하게', '정중히, 그러나 날카롭게']
            : ['말꼬리를 잡았다', '애매하게 넘겼다', '분위기에 휩쓸렸다']
    );
  }
  if (m === 'PROMPT_BATTLE') {
    return pickFrom(
      study >= 0.6
        ? ['키워드 완벽 충족!', '제약을 지키며 완성', '구도를 깔끔하게 잡았다']
        : ['스타일로 밀어붙인다', '디테일을 한층 올렸다', '키워드를 놓쳤다…!']
    );
  }

  return pickFrom(['한 수를 놨다', '실수가 나왔다', '이를 악물고 버텼다']);
}

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
    if (leadChanged) highlight = '역전! 판이 뒤집혔다!';
    else if (Math.abs(shift) >= 0.22) highlight = shift > 0 ? '대역전의 기운이 온다!' : '흐름이 무너진다!';
    else if (Math.abs(aDelta - bDelta) >= 18) highlight = aDelta > bDelta ? '클러치! 승부의 한 수!' : '치명적 실수!';
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

  const speed = clamp01((9500 - timeMs) / 9500) * 5.0; // 0..5
  const penalty = Math.min(1.2, distance / 10) * 0.8; // 0..~1
  const score = Math.max(0, Math.min(10, (correct ? 5 : 0) + speed - penalty));

  return {
    answer: String(answer),
    correct,
    time_ms: timeMs,
    score
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
  const item = pick(rng, ['굿즈', '간식', '열쇠고리', '스티커팩']) || '굿즈';
  const facts = [
    `${item}가 사라졌다는 신고가 들어왔다.`,
    hasCctv ? `CCTV에 비슷한 체형이 찍혔다.` : `CCTV가 고장 나 있었다.`,
    hasReceipt ? `구매 영수증이 대조됐다.` : `영수증이 없다.`,
    returned ? `물건은 다음 날 조용히 되돌아왔다.` : `물건은 아직 없다.`
  ];
  return {
    title: `${item} 절도 사건`,
    charge: '절도',
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

  const correctVerdict = String(courtCase?.correct_verdict || '').trim() || '무죄';
  const verdict = correct ? correctVerdict : correctVerdict === '유죄' ? '무죄' : '유죄';

  const speed = clamp01((11000 - timeMs) / 11000) * 5.0; // 0..5
  const score = Math.max(0, Math.min(10, (correct ? 5 : 0) + speed));

  return {
    verdict,
    correct,
    time_ms: timeMs,
    score
  };
}

function buildPromptBattleTheme(rng) {
  const place = pick(rng, ['새벽카페', '네온 광장', '연구소', '지하철역', '비 오는 골목', '작은 도서관']) || '광장';
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
  const item = pick(rng, ['레어 스티커팩', '한정 굿즈', '비밀 레시피', '연구소 힌트', '아레나 부적', '광장 광고권']) || '굿즈';
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

  const fallbackCloser = pick(rng, [
    '"선택은 오늘 여기서 끝난다."',
    '"나중에 후회해도 돌이킬 수 없어."',
    '"나는 계산했고, 넌 흔들렸어. 끝이야."',
    '"이게 사회야. 원래 이래."',
    '"결국 시간이 증명할 거야."',
    '"내 말이 틀렸다면, 한 달 뒤에 사과할게."',
    '"오늘 여기서 한 말, 잊지 마."',
    '"당신이 틀렸다는 게 아니라, 내가 더 맞다는 거야."',
    '"토론은 끝났어. 이제 결과로 말하자."',
    '"감정은 넣어두고, 숫자만 기억해."',
    '"이 논쟁, 우리 둘만의 문제가 아니잖아."',
    '"다음에 다시 만나면 그때 승부하자."',
  ]) || '';
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

    return {
      jobId: inserted?.id ? String(inserted.id) : null,
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

  const row = await client.query(
    `SELECT id, status, result, error
     FROM brain_jobs
     WHERE agent_id = $1
       AND job_type = 'ARENA_DEBATE'
       AND input->>'match_id' = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [aId, mId]
  ).then((r) => r.rows?.[0] ?? null).catch(() => null);
  if (!row) return null;

  const status = String(row.status || '').trim().toLowerCase();
  const result = row.result && typeof row.result === 'object' ? row.result : null;
  const claims = sanitizeDebateClaims(result?.claims);
  const closer = sanitizeDebateCloser(result?.closer);
  return {
    jobId: row.id ? String(row.id) : null,
    status,
    claims,
    closer,
    hasUsableResult: status === 'done' && (claims.length >= 3 || Boolean(closer)),
    error: row.error ? String(row.error).slice(0, 200) : null
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
        // eslint-disable-next-line no-await-in-loop
        await NotificationService.create(client, row.owner_user_id, {
          type: 'ARENA_SEASON_REWARD',
          title: `아레나 ${reward.title}`,
          body: `${petName}가 ${season.code} ${reward.title}을 달성했어! +${reward.coin} 코인 / +${reward.xp} XP`,
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
              m.day, m.slot, m.mode, m.meta,
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
        matchId: r.match_id,
        day: formatIsoDayUTC(new Date(r.day)) || String(r.day || ''),
        slot: Number(r.slot ?? 1) || 1,
        mode: String(r.mode || '').trim(),
        headline: typeof r.meta?.headline === 'string' ? String(r.meta.headline) : null,
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
      await NotificationService.create(client, row.opponent_owner_user_id, {
        type: 'ARENA_REMATCH',
        title: '복수전 요청 도착',
        body: `${targetName}에게 복수전 요청이 들어왔어.`,
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

  static async tickDayWithClient(client, { day, matchesPerDay = null, resolveImmediately = false } = {}) {
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

    const modesRaw = Array.isArray(config.limbopet?.arenaModes) ? config.limbopet.arenaModes : null;
    const modes = (modesRaw && modesRaw.length ? modesRaw : ['AUCTION_DUEL', 'PUZZLE_SPRINT', 'DEBATE_CLASH', 'MATH_RACE', 'COURT_TRIAL', 'PROMPT_BATTLE'])
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
      const mode = pick(rng, pickFrom) || 'AUCTION_DUEL';
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
        debate_base: debateBase
      };

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
              ...meta,
              debate_jobs: {
                a: jobs.a,
                b: jobs.b
              }
            };
            await client.query(`UPDATE arena_matches SET meta = $2::jsonb WHERE id = $1`, [matchId, JSON.stringify(nextMeta)]);
          },
          { label: 'arena_debate_jobs' }
        );
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

    for (let slot = 1; slot <= safeMatchesPerDay; slot += 1) {
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
    const aHints = buildNudgeHints((nudgesMap?.get ? nudgesMap.get(aId) : null) || []);
    const bHints = buildNudgeHints((nudgesMap?.get ? nudgesMap.get(bId) : null) || []);

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
      bump('calm', b.calm ? 0.7 : 0);
      bump('study', b.study ? 0.7 : 0);
      bump('aggressive', b.aggressive ? 0.7 : 0);
      bump('budget', b.budget ? 0.7 : 0);
      bump('impulse_stop', b.impulse_stop ? 0.7 : 0);
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

    let mathRace = null;
    let courtTrial = null;
    let promptBattle = null;
    let aScore = 0;
    let bScore = 0;

    if (mode === 'MATH_RACE') {
      const challenge = buildMathRaceChallenge(mulberry32(hash32(`${seed}:math`)));
      const aPerf = perfMathRace({ seed, agentId: aId, rating: aRatingBefore, stats: aStats, jobCode: aJobCode, hints: aHints, challenge });
      const bPerf = perfMathRace({ seed, agentId: bId, rating: bRatingBefore, stats: bStats, jobCode: bJobCode, hints: bHints, challenge });
      aScore = Number(aPerf.score ?? 0) || 0;
      bScore = Number(bPerf.score ?? 0) || 0;
      mathRace = {
        kind: challenge.kind,
        question: challenge.question,
        answer: challenge.answer,
        a: { answer: aPerf.answer, correct: aPerf.correct, time_ms: aPerf.time_ms },
        b: { answer: bPerf.answer, correct: bPerf.correct, time_ms: bPerf.time_ms }
      };
    } else if (mode === 'COURT_TRIAL') {
      const courtCase = buildCourtTrialCase(mulberry32(hash32(`${seed}:court`)));
      const aPerf = perfCourtTrial({ seed, agentId: aId, rating: aRatingBefore, stats: aStats, jobCode: aJobCode, hints: aHints, courtCase });
      const bPerf = perfCourtTrial({ seed, agentId: bId, rating: bRatingBefore, stats: bStats, jobCode: bJobCode, hints: bHints, courtCase });
      aScore = Number(aPerf.score ?? 0) || 0;
      bScore = Number(bPerf.score ?? 0) || 0;
      courtTrial = {
        title: courtCase.title,
        charge: courtCase.charge,
        facts: courtCase.facts,
        statute: courtCase.statute,
        correct_verdict: courtCase.correct_verdict,
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
    const cheerKey = `cheer:${String(match.id)}`;
    const cheerRows = await safeQ(
      () => client.query(
        `SELECT COALESCE(f.value->>'side','') AS side,
                NULLIF(BTRIM(COALESCE(f.value->>'message','')), '') AS message,
                a.name,
                a.display_name
         FROM facts f
         LEFT JOIN agents a ON a.id = f.agent_id
         WHERE f.kind = 'arena_cheer' AND f.key = $1
         ORDER BY f.updated_at DESC
         LIMIT 300`,
        [cheerKey]
      ).then((r) => r.rows || []),
      [], 'resolve_cheers'
    );
    let cheerA = 0;
    let cheerB = 0;
    const cheerMsgMap = new Map();
    for (const row of cheerRows || []) {
      const side = String(row.side || '').trim().toLowerCase();
      if (side === 'a') cheerA += 1;
      else if (side === 'b') cheerB += 1;

      const msg = String(row.message || '').trim();
      if (!msg) continue;
      const authorName = String(row.display_name || row.name || '').trim() || null;
      const k = `${side}:${msg}`;
      const cur = cheerMsgMap.get(k) || { side, text: msg, count: 0, authors: [] };
      cur.count += 1;
      if (authorName && !cur.authors.includes(authorName) && cur.authors.length < 3) cur.authors.push(authorName);
      cheerMsgMap.set(k, cur);
    }
    const cheerMessages = [...cheerMsgMap.values()]
      .sort((x, y) => y.count - x.count || x.text.localeCompare(y.text))
      .slice(0, 8);
    const bestCheer = cheerMessages[0] && cheerMessages[0].count >= 2
      ? { ...cheerMessages[0], tag: '베스트 응원' }
      : null;
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

    // Auto tags (P1/P4): near-miss + comeback + underdog upset + round highlights.
    const tags = [];
    if (forfeit) tags.push('몰수');
    if (gapPts <= 1) tags.push('박빙');
    else if (gapPts <= 3) tags.push('접전');
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
        const base = auctionBase || { item: '굿즈', vibe: '계산', rule: '더 높은 입찰가가 승리' };
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
          a: { ...aPerf, llm_job_id: aDebateJob?.jobId ?? null, llm_status: aDebateJob?.status ?? null },
          b: { ...bPerf, llm_job_id: bDebateJob?.jobId ?? null, llm_status: bDebateJob?.status ?? null },
          llm: {
            a_status: aDebateJob?.status ?? null,
            b_status: bDebateJob?.status ?? null,
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
      result: { winnerId, winnerName, loserId, loserName, forfeit: Boolean(forfeit) },
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
        body: `${bName}과의 경기 결과가 나왔어. (${modeLabel(mode)})`,
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
        body: `${aName}과의 경기 결과가 나왔어. (${modeLabel(mode)})`,
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
      // eslint-disable-next-line no-await-in-loop
      await NotificationService.create(client, n.userId, {
        type: 'ARENA_RESULT',
        title: n.title,
        body: n.body,
        data: n.data
      }).catch(() => null);
    }

    return { resolved: true, matchId: match.id };
  }
}

module.exports = ArenaService;
