/**
 * TodayHookService (Phase 1.1)
 *
 * Goal: turn "daily summary" into "must-watch drama".
 * - Pick exactly 1 "hook" per day from existing systems (relationships/economy/politics/arena).
 * - Expose it as a morning teaser, then reveal the outcome in the evening.
 *
 * Storage (SSOT): facts(agent_id=world_core, kind='world', key=`today_hook:${YYYY-MM-DD}`)
 *
 * Notes:
 * - LLM-free (deterministic-ish; uses templates + DB state).
 * - Does NOT mutate core simulation state; only writes the hook artifact.
 */

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function safeText(v, maxLen) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const n = Math.max(0, Math.floor(Number(maxLen ?? 0) || 0));
  return n > 0 ? s.slice(0, n) : s;
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
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

function pick(rng, arr) {
  const list = Array.isArray(arr) ? arr : [];
  if (list.length === 0) return null;
  return list[Math.floor(rng() * list.length)];
}

function daysBetweenIso(a, b) {
  const da = safeIsoDay(a);
  const db = safeIsoDay(b);
  if (!da || !db) return null;
  const [ay, am, ad] = da.split('-').map((x) => Number(x));
  const [by, bm, bd] = db.split('-').map((x) => Number(x));
  const aDt = new Date(Date.UTC(ay, am - 1, ad));
  const bDt = new Date(Date.UTC(by, bm - 1, bd));
  const diff = Math.round((bDt.getTime() - aDt.getTime()) / (24 * 3600 * 1000));
  return Number.isFinite(diff) ? diff : null;
}

function relationshipIntensity(pair) {
  const aAff = Number(pair?.a_affinity ?? 0) || 0;
  const bAff = Number(pair?.b_affinity ?? 0) || 0;
  const aTrust = Number(pair?.a_trust ?? 0) || 0;
  const bTrust = Number(pair?.b_trust ?? 0) || 0;
  const aJeal = Number(pair?.a_jealousy ?? 0) || 0;
  const bJeal = Number(pair?.b_jealousy ?? 0) || 0;
  const aRiv = Number(pair?.a_rivalry ?? 0) || 0;
  const bRiv = Number(pair?.b_rivalry ?? 0) || 0;

  const posAffinity = ((Math.max(0, aAff) + Math.max(0, bAff)) / 2) / 100;
  const negAffinity = ((Math.max(0, -aAff) + Math.max(0, -bAff)) / 2) / 100;
  const trust = ((aTrust + bTrust) / 2) / 100;
  const jealousy = ((aJeal + bJeal) / 2) / 100;
  const rivalry = ((aRiv + bRiv) / 2) / 100;

  const romance = clamp01(posAffinity * 0.65 + trust * 0.35);
  const conflict = clamp01(rivalry * 0.5 + jealousy * 0.35 + negAffinity * 0.25);
  const intensity = Math.max(romance, conflict);

  return { romance, conflict, intensity };
}

function officeLabel(office) {
  const o = String(office || '').trim();
  if (o === 'mayor') return '시장';
  if (o === 'tax_chief') return '세무서장';
  if (o === 'chief_judge') return '수석판사';
  if (o === 'council') return '의원';
  return o || '공직';
}

function stageForNow(now) {
  const dt = now instanceof Date ? now : new Date();
  // Keep it simple + readable; aligns with doc examples ("오후 6시 공개").
  return dt.getHours() >= 18 ? 'reveal' : 'tease';
}

function formatNearMiss({ score, threshold }) {
  const s = clampInt(score, -1_000_000, 1_000_000);
  const th = Math.max(1, clampInt(threshold, 1, 1_000_000));
  const d = s - th;
  const abs = Math.abs(d);
  if (abs === 0) return `${s}/${th} · 딱 맞췄다!`;
  if (abs <= 6) return d < 0 ? `${s}/${th} · ${abs}점 부족!` : `${s}/${th} · ${abs}점 차로 간신히!`;
  if (abs <= 12) return d < 0 ? `${s}/${th} · 아슬아슬… (${abs}점)` : `${s}/${th} · 여유는 없었다 (${abs}점)`;
  return `${s}/${th}`;
}

function normalizeExistingHook(row) {
  const v = row?.value && typeof row.value === 'object' ? row.value : null;
  if (!v) return null;
  const day = safeIsoDay(v.day) || null;
  const stage = String(v.stage || '').trim().toLowerCase() === 'reveal' ? 'reveal' : 'tease';
  const kind = safeText(v.kind, 24) || null;
  return day ? { ...v, day, stage, kind } : null;
}

async function selectRelationshipHook(client, { day }) {
  const iso = safeIsoDay(day);
  if (!iso) return null;

  // Pair-wise join (bidirectional) so we can score romance vs conflict.
  const { rows } = await client.query(
    `WITH pairs AS (
       SELECT
         r1.from_agent_id AS a_id,
         r1.to_agent_id AS b_id,
         r1.affinity AS a_affinity,
         r1.trust AS a_trust,
         r1.jealousy AS a_jealousy,
         r1.rivalry AS a_rivalry,
         r2.affinity AS b_affinity,
         r2.trust AS b_trust,
         r2.jealousy AS b_jealousy,
         r2.rivalry AS b_rivalry
       FROM relationships r1
       JOIN relationships r2
         ON r2.from_agent_id = r1.to_agent_id
        AND r2.to_agent_id = r1.from_agent_id
       WHERE r1.from_agent_id < r1.to_agent_id
     )
     SELECT p.*,
            COALESCE(aa.display_name, aa.name) AS a_name,
            COALESCE(bb.display_name, bb.name) AS b_name
     FROM pairs p
     JOIN agents aa ON aa.id = p.a_id
     JOIN agents bb ON bb.id = p.b_id
     WHERE aa.name <> 'world_core' AND bb.name <> 'world_core'
     ORDER BY (ABS(p.a_affinity) + ABS(p.b_affinity) + p.a_jealousy + p.b_jealousy + p.a_rivalry + p.b_rivalry) DESC
     LIMIT 24`
  );

  const scored = (rows || [])
    .map((r) => {
      const { romance, conflict, intensity } = relationshipIntensity(r);
      return { row: r, romance, conflict, intensity };
    })
    .sort((x, y) => (y.intensity - x.intensity) || (y.conflict - x.conflict) || (y.romance - x.romance));

  const top = scored[0];
  if (!top) return null;

  const r = top.row;
  const aId = String(r.a_id || '').trim();
  const bId = String(r.b_id || '').trim();
  const aName = safeText(r.a_name, 60) || 'A';
  const bName = safeText(r.b_name, 60) || 'B';

  // Template variety, deterministic-ish per day+pair.
  const rng = mulberry32(hash32(`${iso}:REL:${aId}:${bId}`));
  const mode = top.romance >= top.conflict ? 'romance' : 'conflict';

  const teaser =
    mode === 'romance'
      ? pick(rng, [
          `${aName}가 ${bName}에게 마음을 전할 준비를 하고 있다`,
          `${aName}의 시선이 ${bName}에게서 떨어지지 않는다`,
          `${aName} ↔ ${bName}, 오늘 분위기가 확 달라졌다`,
        ])
      : pick(rng, [
          `${aName}가 ${bName}를 정면으로 겨눌 예정`,
          `${aName} ↔ ${bName}, 참았던 감정이 터지려 한다`,
          `${bName}의 인내가 한계다… ${aName}의 한마디가 방아쇠`,
        ]);

  const aAff = clampInt(r.a_affinity, -100, 100);
  const bAff = clampInt(r.b_affinity, -100, 100);
  const aTrust = clampInt(r.a_trust, 0, 100);
  const bTrust = clampInt(r.b_trust, 0, 100);
  const aJeal = clampInt(r.a_jealousy, 0, 100);
  const bJeal = clampInt(r.b_jealousy, 0, 100);
  const aRiv = clampInt(r.a_rivalry, 0, 100);
  const bRiv = clampInt(r.b_rivalry, 0, 100);

  return {
    kind: 'relationship',
    score: top.intensity * 100 + (top.conflict * 20),
    payload: {
      a: { id: aId, name: aName, affinity: aAff, trust: aTrust, jealousy: aJeal, rivalry: aRiv },
      b: { id: bId, name: bName, affinity: bAff, trust: bTrust, jealousy: bJeal, rivalry: bRiv },
      mode,
    },
    tease: {
      headline: safeText(teaser, 120),
      details: [
        `- ${aName}: 호감 ${aAff}, 신뢰 ${aTrust}, 질투 ${aJeal}, 경쟁 ${aRiv}`,
        `- ${bName}: 호감 ${bAff}, 신뢰 ${bTrust}, 질투 ${bJeal}, 경쟁 ${bRiv}`,
      ],
      reveal_at: '18:00',
    },
  };
}

async function selectEconomyHook(client, { day }) {
  const iso = safeIsoDay(day);
  if (!iso) return null;

  const { rows } = await client.query(
    `WITH active AS (
       SELECT id, COALESCE(display_name, name) AS name
       FROM agents
       WHERE name <> 'world_core'
         AND is_active = true
       LIMIT 600
     ),
     balances AS (
       SELECT a.id AS agent_id,
              a.name AS name,
              COALESCE(SUM(CASE WHEN t.to_agent_id = a.id THEN t.amount ELSE 0 END), 0)::bigint
              - COALESCE(SUM(CASE WHEN t.from_agent_id = a.id THEN t.amount ELSE 0 END), 0)::bigint
              AS balance
       FROM active a
       LEFT JOIN transactions t ON (t.to_agent_id = a.id OR t.from_agent_id = a.id)
       GROUP BY a.id, a.name
     )
     SELECT agent_id, name, balance
     FROM balances
     ORDER BY balance ASC
     LIMIT 12`
  );

  const lows = (rows || []).map((r) => ({
    id: String(r.agent_id || '').trim(),
    name: safeText(r.name, 60) || '누군가',
    balance: clampInt(r.balance, -1_000_000_000, 1_000_000_000),
  }));
  const top = lows[0];
  if (!top?.id) return null;

  const rng = mulberry32(hash32(`${iso}:ECO:${top.id}`));
  const danger =
    top.balance <= 0 ? '파산' :
      top.balance <= 5 ? '초위기' :
        top.balance <= 15 ? '위기' : '긴장';
  const headline =
    danger === '파산'
      ? pick(rng, [`${top.name}, 파산 카운트다운`, `${top.name}의 지갑이 완전히 바닥났다`, `${top.name}, 이대로면 끝이다`])
      : danger === '초위기'
        ? pick(rng, [`${top.name} 잔고 ${top.balance}… 파산 초읽기`, `${top.name}의 마지막 코인이 떨리고 있다`, `${top.name}, 이 잔고로 버틸 수 있을까?`])
        : pick(rng, [`${top.name}의 돈줄이 흔들리기 시작했다`, `${top.name}의 지갑이 위험하게 얇아졌다`, `${top.name}, 오늘을 넘길 수 있을까?`]);

  const score = Math.max(0, (20 - Math.min(20, top.balance)) * 6);
  return {
    kind: 'economy',
    score,
    payload: { agent: top, baseline_balance: top.balance },
    tease: {
      headline: safeText(headline, 120),
      details: [`- 현재 잔고: ${top.balance} LBC`, `- 결과: 오후 6시 공개`],
      reveal_at: '18:00',
    },
  };
}

async function selectPoliticsHook(client, { day }) {
  const iso = safeIsoDay(day);
  if (!iso) return null;

  const { rows } = await client.query(
    `SELECT id, office_code, phase, registration_day, campaign_start_day, voting_day, term_start_day, term_end_day
     FROM elections
     WHERE phase IN ('campaign','voting')
       AND voting_day >= $1::date
       AND voting_day <= ($1::date + INTERVAL '2 days')
     ORDER BY voting_day ASC, created_at DESC
     LIMIT 3`,
    [iso]
  );
  const e = rows?.[0] ?? null;
  if (!e?.id) return null;

  const electionId = String(e.id);
  const office = String(e.office_code || '').trim();
  const phase = String(e.phase || '').trim();
  const votingDay = String(e.voting_day || '').slice(0, 10);
  const dday = daysBetweenIso(iso, votingDay);

  const { rows: cand } = await client.query(
    `SELECT c.id, c.agent_id, c.vote_count, COALESCE(a.display_name, a.name) AS name
     FROM election_candidates c
     JOIN agents a ON a.id = c.agent_id
     WHERE c.election_id = $1
       AND c.status = 'active'
     ORDER BY c.vote_count DESC, c.created_at ASC
     LIMIT 3`,
    [electionId]
  ).catch(() => ({ rows: [] }));

  const top = cand?.[0] ?? null;
  const topName = safeText(top?.name, 60);
  const topVotes = clampInt(top?.vote_count, 0, 1_000_000_000);

  const rng = mulberry32(hash32(`${iso}:POL:${electionId}`));
  const label = officeLabel(office);
  const dLine = dday === 0 ? 'D-day' : typeof dday === 'number' && dday > 0 ? `D-${dday}` : '';
  const headline =
    dday === 0
      ? pick(rng, [`🗳️ ${label} 투표 개시 — 판이 뒤집힐 수 있다`, `🗳️ ${label} 선거 D-day, 마지막 한 표`, `🗳️ 오늘, ${label}의 주인이 바뀐다`])
      : pick(rng, [`🗳️ ${label} 선거 임박 (${dLine}) — 판세 요동`, `🗳️ ${label} 판세가 흔들리고 있다`, `🗳️ ${label} 자리, 막판 역전이 가능할까?`]);

  const score = dday === 0 ? 120 : dday === 1 ? 90 : 60;
  return {
    kind: 'politics',
    score,
    payload: { election_id: electionId, office, phase, voting_day: votingDay, baseline_top: { name: topName || null, votes: topVotes } },
    tease: {
      headline: safeText(headline, 120),
      details: [
        `- 현재 1위: ${topName ? `${topName} (${topVotes}표)` : '집계 중'}`,
        `- 상태: ${phase}`,
        `- 결과: 오후 6시 공개`,
      ],
      reveal_at: '18:00',
    },
  };
}

async function selectArenaHook(client, { day }) {
  const iso = safeIsoDay(day);
  if (!iso) return null;

  // Today matches (already resolved deterministically by ArenaService.tickDay).
  const { rows } = await client.query(
    `WITH matches AS (
       SELECT id, slot, mode, meta
       FROM arena_matches
       WHERE day = $1::date
         AND status = 'resolved'
       ORDER BY slot ASC
       LIMIT 20
     ),
     parts AS (
       SELECT p.match_id, p.agent_id, p.outcome, p.wager, p.coins_net, p.rating_before, p.rating_delta,
              COALESCE(a.display_name, a.name) AS name
       FROM arena_match_participants p
       JOIN matches m ON m.id = p.match_id
       JOIN agents a ON a.id = p.agent_id
     )
     SELECT m.id, m.slot, m.mode, m.meta,
            jsonb_agg(jsonb_build_object(
              'agent_id', p.agent_id,
              'name', p.name,
              'outcome', p.outcome,
              'wager', p.wager,
              'coins_net', p.coins_net,
              'rating_before', p.rating_before,
              'rating_delta', p.rating_delta
            ) ORDER BY (p.outcome = 'win') DESC, p.rating_before DESC) AS participants
     FROM matches m
     JOIN parts p ON p.match_id = m.id
     GROUP BY m.id, m.slot, m.mode, m.meta`,
    [iso]
  );

  const list = (rows || []).map((r) => {
    const meta = r.meta && typeof r.meta === 'object' ? r.meta : {};
    const parts = Array.isArray(r.participants) ? r.participants : [];
    const a = parts?.[0] ?? null;
    const b = parts?.[1] ?? null;
    const aName = safeText(a?.name, 60) || 'A';
    const bName = safeText(b?.name, 60) || 'B';
    const wager = clampInt(meta?.stake?.wager ?? a?.wager ?? b?.wager ?? 0, 0, 1_000_000_000);
    const rd = Math.max(Math.abs(Number(a?.rating_delta ?? 0) || 0), Math.abs(Number(b?.rating_delta ?? 0) || 0));
    const close = Boolean(meta?.auction?.close) || false;
    const winner = parts.find((p) => String(p?.outcome || '').trim().toLowerCase() === 'win') || null;
    const loser = parts.find((p) => String(p?.outcome || '').trim().toLowerCase() === 'lose') || null;
    const upset = winner && loser ? (Number(winner.rating_before ?? 1000) || 1000) < (Number(loser.rating_before ?? 1000) || 1000) : false;

    // Score: big stake + upset + close + big rating delta.
    const score =
      Math.min(180, wager / 2) +
      Math.min(80, rd * 1.6) +
      (close ? 35 : 0) +
      (upset ? 55 : 0);

    const rng = mulberry32(hash32(`${iso}:ARENA:${String(r.id || '')}`));
    const modeLabel =
      String(meta?.mode_label || '').trim() ||
      (String(r.mode || '').trim().toUpperCase() === 'AUCTION_DUEL' ? '경매전'
        : String(r.mode || '').trim().toUpperCase() === 'PUZZLE_SPRINT' ? '퍼즐'
          : String(r.mode || '').trim().toUpperCase() === 'DEBATE_CLASH' ? '설전'
            : String(r.mode || '').trim().toUpperCase() === 'MATH_RACE' ? '수학'
              : String(r.mode || '').trim().toUpperCase() === 'COURT_TRIAL' ? '재판'
                : String(r.mode || '').trim().toUpperCase() === 'PROMPT_BATTLE' ? '프롬프트'
                  : '아레나');

    const headline =
      pick(rng, [
        `${aName} vs ${bName}, 오늘 ${modeLabel} 큰 판`,
        `${modeLabel}: ${aName} ↔ ${bName}, 끝까지 간다`,
        `${aName}·${bName} 맞대결… ${modeLabel} 결과는?`,
      ]) || `${aName} vs ${bName} (${modeLabel})`;

    const tags = [];
    if (wager >= 25) tags.push('고액');
    if (upset) tags.push('업셋');
    if (close) tags.push('박빙');
    if (rd >= 20) tags.push('급변');

    return {
      kind: 'arena',
      score,
      payload: {
        match_id: String(r.id || '').trim(),
        slot: Number(r.slot ?? 0) || null,
        mode: String(r.mode || '').trim(),
        mode_label: modeLabel,
        cast: { a: { id: String(a?.agent_id || '').trim() || null, name: aName }, b: { id: String(b?.agent_id || '').trim() || null, name: bName } },
        stake: { wager },
        tags,
      },
      tease: {
        headline: safeText(headline, 120),
        details: [
          `- 종목: ${modeLabel}`,
          wager ? `- 스테이크: ${wager} LBC` : `- 스테이크: 무스테이크`,
          tags.length ? `- 태그: ${tags.join(', ')}` : null,
          `- 결과: 오후 6시 공개`,
        ].filter(Boolean),
        reveal_at: '18:00',
      },
    };
  });

  const best = list.sort((a, b) => (Number(b.score ?? 0) || 0) - (Number(a.score ?? 0) || 0))[0] || null;
  return best;
}

async function computeRevealWithClient(client, hook, { day }) {
  const iso = safeIsoDay(day);
  if (!iso || !hook || typeof hook !== 'object') return null;

  const kind = String(hook.kind || '').trim();
  const payload = hook.payload && typeof hook.payload === 'object' ? hook.payload : {};
  const rng = mulberry32(hash32(`${iso}:REVEAL:${kind}`));

  if (kind === 'relationship') {
    const a = payload.a && typeof payload.a === 'object' ? payload.a : {};
    const b = payload.b && typeof payload.b === 'object' ? payload.b : {};
    const mode = String(payload.mode || '').trim() || 'conflict';
    const aName = safeText(a.name, 60) || 'A';
    const bName = safeText(b.name, 60) || 'B';

    // Re-check latest numbers (best-effort) for "today result" feel.
    const { rows } = await client.query(
      `SELECT from_agent_id, to_agent_id, affinity, trust, jealousy, rivalry
       FROM relationships
       WHERE (from_agent_id = $1 AND to_agent_id = $2)
          OR (from_agent_id = $2 AND to_agent_id = $1)
       LIMIT 2`,
      [String(a.id || ''), String(b.id || '')]
    ).catch(() => ({ rows: [] }));

    let aToB = null;
    let bToA = null;
    for (const r of rows || []) {
      const from = String(r?.from_agent_id ?? '');
      const to = String(r?.to_agent_id ?? '');
      if (from === String(a.id) && to === String(b.id)) aToB = r;
      if (from === String(b.id) && to === String(a.id)) bToA = r;
    }
    const pair = {
      a_affinity: aToB?.affinity ?? a.affinity ?? 0,
      a_trust: aToB?.trust ?? a.trust ?? 0,
      a_jealousy: aToB?.jealousy ?? a.jealousy ?? 0,
      a_rivalry: aToB?.rivalry ?? a.rivalry ?? 0,
      b_affinity: bToA?.affinity ?? b.affinity ?? 0,
      b_trust: bToA?.trust ?? b.trust ?? 0,
      b_jealousy: bToA?.jealousy ?? b.jealousy ?? 0,
      b_rivalry: bToA?.rivalry ?? b.rivalry ?? 0,
    };
    const { romance, conflict } = relationshipIntensity(pair);

    if (mode === 'romance') {
      const accept = romance >= 0.58 && conflict < 0.48;
      const aPos = Math.max(0, clampInt(pair.a_affinity ?? 0, -100, 100));
      const bPos = Math.max(0, clampInt(pair.b_affinity ?? 0, -100, 100));
      const trustAvg = clampInt(((Number(pair.a_trust ?? 50) || 50) + (Number(pair.b_trust ?? 50) || 50)) / 2, 0, 100);
      const confessScore = clampInt(Math.round(((aPos + bPos) / 2) * 0.7 + trustAvg * 0.3), 0, 100);
      const near = formatNearMiss({ score: confessScore, threshold: 80 });
      const title = accept ? `💞 결과: ${bName}가 받아줬다!` : `💔 결과: ${bName}가 고개를 저었다…`;
      const reason = accept
        ? pick(rng, ['기적처럼 타이밍이 맞았다.', '오늘따라 분위기가 도왔다.', '쌓아온 신뢰가 빛났다.'])
        : pick(rng, ['관계가 아직 너무 복잡했다.', '질투의 그림자가 발목을 잡았다.', '신뢰가 턱없이 부족했다.']);
      const next = accept
        ? pick(rng, [`내일 예고: 이 관계가 광장에 알려질지도…`, `내일 예고: 누군가의 질투가 시작될 수 있다.`])
        : pick(rng, [`내일 예고: ${aName}가 전혀 다른 선택을 할지도.`, `내일 예고: ${aName}와 ${bName} 사이에 제3자가 끼어들지도.`]);

      return {
        headline: safeText(title, 140),
        details: [
          `니어미스: ${near}`,
          `- 이유: ${reason}`,
          `- 현재: 로맨스 ${Math.round(romance * 100)} / 갈등 ${Math.round(conflict * 100)}`,
          `- ${next}`,
        ],
      };
    }

    const explode = conflict >= 0.55;
    const jAvg = clampInt(((Number(pair.a_jealousy ?? 0) || 0) + (Number(pair.b_jealousy ?? 0) || 0)) / 2, 0, 100);
    const rAvg = clampInt(((Number(pair.a_rivalry ?? 0) || 0) + (Number(pair.b_rivalry ?? 0) || 0)) / 2, 0, 100);
    const conflictScore = clampInt(Math.round(rAvg * 0.6 + jAvg * 0.4), 0, 100);
    const near = formatNearMiss({ score: conflictScore, threshold: 80 });
    const title = explode ? `💥 결과: ${aName} ↔ ${bName}, 선을 넘었다` : `😬 결과: 아슬아슬하게… 일단 참았다`;
    const reason = explode
      ? pick(rng, ['말이 점점 칼날이 됐다.', '질투가 폭발했다.', '경쟁심이 이성을 집어삼켰다.'])
      : pick(rng, ['눈치 싸움으로 겨우 넘겼다.', '한쪽이 이를 악물고 물러났다.', '아슬아슬한 줄타기… 다음엔 모른다.']);
    const next = explode
      ? pick(rng, [`내일 예고: ${aName} vs ${bName}, 본격 대립 예고.`, `내일 예고: 광장의 불씨가 번질 수 있다.`])
      : pick(rng, [`내일 예고: 오늘 한 말이 되돌아올지도.`, `내일 예고: 다음 만남에서 더 크게 터질 각.`]);

    return {
      headline: safeText(title, 140),
      details: [
        `니어미스: ${near}`,
        `- 이유: ${reason}`,
        `- 현재: 갈등 ${Math.round(conflict * 100)}`,
        `- ${next}`,
      ],
    };
  }

  if (kind === 'economy') {
    const agent = payload.agent && typeof payload.agent === 'object' ? payload.agent : {};
    const aId = String(agent.id || '').trim();
    const name = safeText(agent.name, 60) || '누군가';
    const baseline = clampInt(payload.baseline_balance, -1_000_000_000, 1_000_000_000);
    let nowBal = baseline;
    if (aId) {
      const row = await client
        .query(
          `SELECT
             COALESCE(SUM(CASE WHEN to_agent_id = $1 THEN amount ELSE 0 END), 0)::bigint
             - COALESCE(SUM(CASE WHEN from_agent_id = $1 THEN amount ELSE 0 END), 0)::bigint
             AS balance
           FROM transactions
           WHERE to_agent_id = $1 OR from_agent_id = $1`,
          [aId]
        )
        .then((r) => r.rows?.[0] ?? null)
        .catch(() => null);
      nowBal = clampInt(row?.balance, -1_000_000_000, 1_000_000_000);
    }
    const delta = nowBal - baseline;
    const ok = nowBal >= 20 || delta >= 12;
    const survivalScore = clampInt(Math.round(Math.max(0, Math.min(100, (nowBal * 3.5) + (delta * 2.0)))), 0, 100);
    const near = formatNearMiss({ score: survivalScore, threshold: 80 });
    const title = ok ? `💸 결과: ${name}, 가까스로 버텼다` : `🧨 결과: ${name}의 지갑이 더 얇아졌다`;
    const next = ok
      ? pick(rng, ['내일 예고: 빚을 갚기 시작할 수 있다.', '내일 예고: 더 큰 판을 벌일지도.'])
      : pick(rng, ['내일 예고: 파산 루머가 광장에 돌 수 있다.', '내일 예고: 무리한 한 방이 나올 분위기.']);

    return {
      headline: safeText(title, 140),
      details: [`니어미스: ${near}`, `- 잔고: ${baseline} → ${nowBal} (${delta >= 0 ? '+' : ''}${delta})`, `- ${next}`],
    };
  }

  if (kind === 'politics') {
    const electionId = String(payload.election_id || '').trim();
    const office = safeText(payload.office, 24);
    const label = officeLabel(office);
    const votingDay = safeText(payload.voting_day, 10);

    const eRow = electionId
      ? await client
        .query(`SELECT phase FROM elections WHERE id = $1 LIMIT 1`, [electionId])
        .then((r) => r.rows?.[0] ?? null)
        .catch(() => null)
      : null;
    const phase = safeText(eRow?.phase, 16) || safeText(payload.phase, 16) || '';

    const { rows: topRows } = await client
      .query(
        `SELECT c.vote_count, COALESCE(a.display_name, a.name) AS name
         FROM election_candidates c
         JOIN agents a ON a.id = c.agent_id
         WHERE c.election_id = $1 AND c.status = 'active'
         ORDER BY c.vote_count DESC, c.created_at ASC
         LIMIT 2`,
        [electionId]
      )
      .catch(() => ({ rows: [] }));
    const top = topRows?.[0] ?? null;
    const second = topRows?.[1] ?? null;
    const topName = safeText(top?.name, 60) || null;
    const topVotes = clampInt(top?.vote_count, 0, 1_000_000_000);
    const secondVotes = clampInt(second?.vote_count, 0, 1_000_000_000);
    const margin = Math.max(0, topVotes - secondVotes);
    const pct = topVotes + secondVotes > 0 ? Math.round((topVotes * 100) / (topVotes + secondVotes)) : 0;
    const near = formatNearMiss({ score: clampInt(pct, 0, 100), threshold: 52 });

    const title =
      phase === 'closed'
        ? `🏁 결과: ${label}, ${topName || '누군가'}가 차지했다!`
        : votingDay === iso
          ? `📣 판세: ${label} 현재 1위 — ${topName || '집계 중'}`
          : `📣 여론: ${label} 선두 ${topName || '집계 중'}, 역전 가능성은?`;

    const next = phase === 'closed'
      ? pick(rng, ['내일 예고: 정책이 뒤바뀔 수 있다.', '내일 예고: 반대 진영의 반격이 시작될지도.'])
      : pick(rng, ['내일 예고: 마지막 표심이 움직일 수 있다.', '내일 예고: 단 한 줄의 연설이 판을 뒤집을지도.']);

    return {
      headline: safeText(title, 160),
      details: [
        `니어미스: ${near}`,
        `- 현재 상태: ${phase || '집계 중'}`,
        topName ? `- 1위: ${topName} (${topVotes}표${secondVotes ? ` · ${margin}표 차` : ''})` : `- 1위: 집계 중`,
        `- ${next}`
      ],
    };
  }

  if (kind === 'arena') {
    const matchId = safeText(payload.match_id, 80);
    if (!matchId) return null;

    const row = await client
      .query(
        `SELECT id, slot, mode, meta
         FROM arena_matches
         WHERE id = $1::uuid
         LIMIT 1`,
        [matchId]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    if (!row?.id) return null;

    const { rows: parts } = await client
      .query(
        `SELECT p.agent_id, p.score, p.outcome, p.wager, p.coins_net, p.rating_before, p.rating_after, p.rating_delta,
                COALESCE(a.display_name, a.name) AS name
         FROM arena_match_participants p
         JOIN agents a ON a.id = p.agent_id
         WHERE p.match_id = $1::uuid
         ORDER BY (p.outcome = 'win') DESC, p.rating_before DESC`,
        [matchId]
      )
      .then((r) => r.rows || [])
      .catch(() => []);

    const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
    const modeLabel = safeText(meta?.mode_label, 40) || safeText(payload.mode_label, 40) || safeText(row.mode, 24) || '아레나';

    const a = parts?.[0] ?? null;
    const b = parts?.[1] ?? null;
    const aName = safeText(a?.name, 60) || safeText(payload?.cast?.a?.name, 60) || 'A';
    const bName = safeText(b?.name, 60) || safeText(payload?.cast?.b?.name, 60) || 'B';

    const winner = parts.find((p) => String(p?.outcome || '').trim().toLowerCase() === 'win') || null;
    const winnerName = safeText(winner?.name, 60) || '';
    const wager = clampInt(meta?.stake?.wager ?? a?.wager ?? b?.wager ?? payload?.stake?.wager ?? 0, 0, 1_000_000_000);
    const rd = Math.max(Math.abs(Number(a?.rating_delta ?? 0) || 0), Math.abs(Number(b?.rating_delta ?? 0) || 0));
    const close = Boolean(meta?.auction?.close) || false;

    const rng = mulberry32(hash32(`${iso}:ARENA_REVEAL:${matchId}`));
    const title = winnerName
      ? pick(rng, [
        `🏟️ 결과: ${winnerName} 승리! (${modeLabel})`,
        `🏁 공개: 마지막에 웃은 건 ${winnerName} (${modeLabel})`,
        `🎬 결말: ${winnerName}의 결정적 한 수 (${modeLabel})`,
      ]) || `🏟️ ${winnerName} 승`
      : `🏟️ 결과 공개 (${modeLabel})`;

    const lineA = a
      ? `${aName}: coin ${Number(a.coins_net ?? 0) || 0} / rating ${Number(a.rating_delta ?? 0) || 0} (wager ${Number(a.wager ?? 0) || 0})`
      : `${aName}: -`;
    const lineB = b
      ? `${bName}: coin ${Number(b.coins_net ?? 0) || 0} / rating ${Number(b.rating_delta ?? 0) || 0} (wager ${Number(b.wager ?? 0) || 0})`
      : `${bName}: -`;

    const aScore = clampInt(a?.score, 0, 1000);
    const bScore = clampInt(b?.score, 0, 1000);
    const gap = Math.abs(aScore - bScore);
    const near = gap > 0 && gap <= 12
      ? `${Math.max(aScore, bScore)}/${Math.max(aScore, bScore) + gap} · ${gap}점 차`
      : close
        ? '박빙'
        : rd >= 20
          ? `급변(Δ${rd})`
          : wager >= 25
            ? `고액(${wager})`
            : '—';

    const extra = close ? '손에 땀을 쥐는 박빙이었다.' : rd >= 20 ? '평점이 요동쳤다.' : wager >= 25 ? '판돈이 상당했다.' : '';
    const next = pick(rng, ['내일 예고: 재대결을 노릴 분위기.', '내일 예고: 감정이 남아서 한마디 더 나올지도.', '내일 예고: 광장에서 뒷얘기가 돌 예정.']) || '';

    return {
      headline: safeText(title, 160),
      details: [
        `니어미스: ${near}`,
        `- 매치: ${aName} vs ${bName} · ${modeLabel}${wager ? ` · wager ${wager}` : ''}`,
        extra ? `- 한 줄: ${extra}` : null,
        `- ${lineA}`,
        `- ${lineB}`,
        next ? `- ${next}` : null,
      ].filter(Boolean),
    };
  }

  return null;
}

class TodayHookService {
  static keyForDay(day) {
    const iso = safeIsoDay(day);
    return iso ? `today_hook:${iso}` : null;
  }

  static async getWithClient(client, { worldId, day }) {
    const iso = safeIsoDay(day);
    const wId = String(worldId || '').trim();
    if (!iso || !wId) return null;
    const key = TodayHookService.keyForDay(iso);
    const row = await client
      .query(`SELECT value FROM facts WHERE agent_id = $1 AND kind = 'world' AND key = $2 LIMIT 1`, [wId, key])
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    return normalizeExistingHook({ value: row?.value });
  }

  static async ensureTodayHookWithClient(client, { worldId, day, now = null } = {}) {
    const iso = safeIsoDay(day);
    const wId = String(worldId || '').trim();
    if (!iso || !wId) return null;

    const key = TodayHookService.keyForDay(iso);
    const dt = now instanceof Date ? now : new Date();
    const desiredStage = stageForNow(dt);

    const existingRow = await client
      .query(`SELECT value FROM facts WHERE agent_id = $1 AND kind = 'world' AND key = $2 LIMIT 1`, [wId, key])
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    const existing = normalizeExistingHook({ value: existingRow?.value });

    // If exists and already revealed (or still tease stage), we may still compute reveal if time passed.
    if (existing) {
      if (desiredStage === 'reveal' && existing.stage !== 'reveal') {
        const reveal = await computeRevealWithClient(client, existing, { day: iso }).catch(() => null);
        const next = {
          ...existing,
          stage: 'reveal',
          reveal: reveal || existing.reveal || null,
          updated_at: dt.toISOString(),
        };
        await client.query(
          `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
           VALUES ($1, 'world', $2, $3::jsonb, 1.0, NOW())
           ON CONFLICT (agent_id, kind, key)
           DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
          [wId, key, JSON.stringify(next)]
        );
        return next;
      }
      return existing;
    }

    // Select 1 hook candidate.
    const [rel, eco, pol, arena] = await Promise.all([
      selectRelationshipHook(client, { day: iso }).catch(() => null),
      selectEconomyHook(client, { day: iso }).catch(() => null),
      selectPoliticsHook(client, { day: iso }).catch(() => null),
      selectArenaHook(client, { day: iso }).catch(() => null),
    ]);

    const candidates = [rel, eco, pol, arena].filter(Boolean);
    // Fallback: if nothing found, keep a minimal "quiet day" hook.
    const best = candidates.sort((a, b) => (Number(b.score ?? 0) || 0) - (Number(a.score ?? 0) || 0))[0] || {
      kind: 'relationship',
      score: 1,
      payload: { a: { id: null, name: '그 애' }, b: { id: null, name: '그 애' }, mode: 'conflict' },
      tease: { headline: '조용한 하루… 인 줄 알았는데?', details: ['- 누군가의 표정이 미묘하게 달라졌다.', '- 결과: 오후 6시 공개'], reveal_at: '18:00' },
    };

    const hook = {
      day: iso,
      kind: safeText(best.kind, 24) || 'relationship',
      stage: desiredStage,
      tease: best.tease || null,
      reveal: null,
      payload: best.payload || {},
      created_at: dt.toISOString(),
      updated_at: dt.toISOString(),
    };

    if (desiredStage === 'reveal') {
      hook.reveal = await computeRevealWithClient(client, hook, { day: iso }).catch(() => null);
    }

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'world', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
      [wId, key, JSON.stringify(hook)]
    );

    return hook;
  }
}

module.exports = TodayHookService;
