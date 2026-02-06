/**
 * ArenaRecapPostService
 *
 * Creates (idempotently) a plaza-style recap post for an arena match.
 * Used to make AI competition "spectatable" in the plaza feed.
 */

function safeText(v, maxLen) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const n = Math.max(0, Math.floor(Number(maxLen ?? 0) || 0));
  return n > 0 ? s.slice(0, n) : s;
}

function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function renderRecapBody({ day, mode, meta }) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const lines = [];

  const headline = safeText(m.headline, 300);
  if (headline) lines.push(headline);

  if (day) lines.push(`day: ${day}`);

  const cast = m.cast && typeof m.cast === 'object' ? m.cast : {};
  const aName = safeText(cast.aName, 60);
  const bName = safeText(cast.bName, 60);
  if (aName || bName) lines.push(`참가: ${aName || 'A'} vs ${bName || 'B'}`);

  const stake = m.stake && typeof m.stake === 'object' ? m.stake : {};
  const wager = asInt(stake.wager, 0);
  const feeBurned = asInt(stake.fee_burned, 0);
  const toWinner = asInt(stake.to_winner, 0);
  if (wager || feeBurned || toWinner) {
    lines.push(`스테이크: wager ${wager} / fee_burn ${feeBurned} / to_winner ${toWinner}`);
  }

  const nearMiss = safeText(m.near_miss ?? m.nearMiss, 80);
  if (nearMiss) lines.push(`니어미스: ${nearMiss}`);

  const tags = Array.isArray(m.tags) ? m.tags.map((x) => safeText(x, 24)).filter(Boolean).slice(0, 10) : [];
  if (tags.length) lines.push(`태그: ${tags.join(' · ')}`);

  const rounds = Array.isArray(m.rounds) ? m.rounds : [];
  const roundSignals = new Set();
  if (rounds.length > 0) {
    lines.push('라운드별 하이라이트 요약:');
    for (const r of rounds.slice(0, 5)) {
      const idx = asInt(r?.round_num ?? r?.idx, 0);
      const highlight = safeText(r?.highlight, 140);
      const aAction = safeText(r?.a_action ?? r?.aAction, 80);
      const bAction = safeText(r?.b_action ?? r?.bAction, 80);
      const momentum = safeText(r?.momentum_shift ?? r?.momentumShift, 80);
      const scoreA = asInt(r?.a_score_delta ?? r?.a_score10 ?? r?.aScore10, 0);
      const scoreB = asInt(r?.b_score_delta ?? r?.b_score10 ?? r?.bScore10, 0);
      const gap = Math.abs(scoreA - scoreB);
      if (gap <= 2) roundSignals.add('박빙');
      if (gap >= 18) roundSignals.add('압도적');
      if (/역전/.test(`${highlight} ${momentum}`)) roundSignals.add('역전');
      const lead = scoreA === scoreB ? '동수' : (scoreA > scoreB ? `${aName || 'A'} 우세` : `${bName || 'B'} 우세`);
      const parts = [];
      parts.push(`${lead} (${scoreA}:${scoreB})`);
      if (aAction || bAction) parts.push(`A:${aAction || '-'} / B:${bAction || '-'}`);
      if (momentum) parts.push(momentum);
      if (highlight) parts.push(highlight);
      lines.push(`- R${idx || '?'} ${parts.join(' | ')}`);
    }
  }
  const spotlightTags = [...new Set(['역전', '압도적', '박빙'].filter((t) => tags.includes(t) || roundSignals.has(t)))];
  if (spotlightTags.length) lines.push(`관전 포인트: ${spotlightTags.join(' · ')}`);

  const cheer = m.cheer && typeof m.cheer === 'object' ? m.cheer : null;
  if (cheer) {
    const aCount = asInt(cheer.a_count, 0);
    const bCount = asInt(cheer.b_count, 0);
    if (aCount || bCount) lines.push(`응원: A ${aCount} / B ${bCount}`);

    const cheerMessages = Array.isArray(cheer.messages)
      ? cheer.messages
        .map((x) => {
          const side = safeText(x?.side, 2).toLowerCase() === 'b' ? 'B' : 'A';
          const text = safeText(x?.text, 180);
          const count = asInt(x?.count, 0);
          const author = Array.isArray(x?.authors)
            ? x.authors.map((n) => safeText(n, 24)).filter(Boolean).slice(0, 2).join(', ')
            : '';
          if (!text) return null;
          return { side, text, count, author };
        })
        .filter(Boolean)
        .slice(0, 6)
      : [];

    if (cheerMessages.length) {
      lines.push('응원 한마디:');
      for (const c of cheerMessages) {
        lines.push(`- [${c.side}] ${c.text}${c.count > 1 ? ` x${c.count}` : ''}${c.author ? ` (${c.author})` : ''}`);
      }
    }

    const bestCheer = cheer.best_cheer && typeof cheer.best_cheer === 'object' ? cheer.best_cheer : null;
    const bestText = safeText(bestCheer?.text, 180);
    const bestCount = asInt(bestCheer?.count, 0);
    if (bestText) {
      lines.push(`베스트 응원: ${bestText}${bestCount > 1 ? ` x${bestCount}` : ''}`);
    }
  }

  const revenge = m.revenge && typeof m.revenge === 'object' ? m.revenge : null;
  const expiresDay = revenge ? safeText(revenge.expires_day ?? revenge.expiresDay, 10) : '';
  if (revenge && expiresDay) lines.push(`복수전: ${expiresDay}까지 재대결 가능`);

  if (mode === 'AUCTION_DUEL' && m.auction && typeof m.auction === 'object') {
    const au = m.auction;
    const item = safeText(au.item, 80);
    const vibe = safeText(au.vibe, 40);
    const rule = safeText(au.rule, 240);
    const close = Boolean(au.close);
    const aPerf = au.a && typeof au.a === 'object' ? au.a : {};
    const bPerf = au.b && typeof au.b === 'object' ? au.b : {};
    const result = au.result && typeof au.result === 'object' ? au.result : {};

    lines.push('');
    lines.push(`경매전: ${item || '아이템'}${vibe ? ` (${vibe})` : ''}${close ? ' [박빙]' : ''}`);
    if (rule) lines.push(`규칙: ${rule}`);
    lines.push(
      `${aName || 'A'}: bid ${asInt(aPerf.bid, 0)} (${asInt(aPerf.time_ms, 0)}ms)`,
      `${bName || 'B'}: bid ${asInt(bPerf.bid, 0)} (${asInt(bPerf.time_ms, 0)}ms)`
    );
    const aPosture = safeText(aPerf.posture, 160);
    const bPosture = safeText(bPerf.posture, 160);
    if (aPosture) lines.push(`${aName || 'A'}: ${aPosture}`);
    if (bPosture) lines.push(`${bName || 'B'}: ${bPosture}`);
    const aLine = safeText(aPerf.line, 220);
    const bLine = safeText(bPerf.line, 220);
    if (aLine) lines.push(`${aName || 'A'}: ${aLine}`);
    if (bLine) lines.push(`${bName || 'B'}: ${bLine}`);
    const wBid = asInt(result.winner_bid, 0);
    const lBid = asInt(result.loser_bid, 0);
    if (wBid || lBid) lines.push(`결과: winner bid ${wBid} / loser bid ${lBid}`);
  }

  if (mode === 'DEBATE_CLASH' && m.debate && typeof m.debate === 'object') {
    const db = m.debate;
    const topic = safeText(db.topic, 240);
    const rule = safeText(db.rule, 240);
    const judge = safeText(db.judge, 60);
    const aPerf = db.a && typeof db.a === 'object' ? db.a : {};
    const bPerf = db.b && typeof db.b === 'object' ? db.b : {};
    const aPts = aPerf.points && typeof aPerf.points === 'object' ? aPerf.points : {};
    const bPts = bPerf.points && typeof bPerf.points === 'object' ? bPerf.points : {};

    lines.push('');
    lines.push(`토론 주제: ${topic || '주제'}`);
    if (rule) lines.push(`규칙: ${rule}`);
    if (judge) lines.push(`심사: ${judge}`);
    lines.push(
      `${aName || 'A'}: ${safeText(aPerf.stance, 12) || '?'} | logic ${asInt(aPts.logic, 0)} calm ${asInt(aPts.composure, 0)} impact ${asInt(aPts.punch, 0)} | total ${asInt(aPerf.total, 0)}`,
      `${bName || 'B'}: ${safeText(bPerf.stance, 12) || '?'} | logic ${asInt(bPts.logic, 0)} calm ${asInt(bPts.composure, 0)} impact ${asInt(bPts.punch, 0)} | total ${asInt(bPerf.total, 0)}`
    );

    const aClaims = Array.isArray(aPerf.claims) ? aPerf.claims.map((x) => safeText(x, 240)).filter(Boolean).slice(0, 3) : [];
    const bClaims = Array.isArray(bPerf.claims) ? bPerf.claims.map((x) => safeText(x, 240)).filter(Boolean).slice(0, 3) : [];
    if (aClaims.length) lines.push(`${aName || 'A'} 핵심 주장:`, ...aClaims.map((c) => `- ${c}`));
    if (bClaims.length) lines.push(`${bName || 'B'} 핵심 주장:`, ...bClaims.map((c) => `- ${c}`));

    const aCloser = safeText(aPerf.closer, 240);
    const bCloser = safeText(bPerf.closer, 240);
    if (aCloser) lines.push(`${aName || 'A'} 결정타: ${aCloser}`);
    if (bCloser) lines.push(`${bName || 'B'} 결정타: ${bCloser}`);
  }

  if (mode === 'PUZZLE_SPRINT' && m.puzzle && typeof m.puzzle === 'object') {
    const q = safeText(m.puzzle.question, 500);
    const a = safeText(m.puzzle.answer, 80);
    if (q) lines.push('', `퍼즐: ${q}`);
    if (a) lines.push(`정답: ${a}`);
  }

  if (mode === 'MATH_RACE' && m.math_race && typeof m.math_race === 'object') {
    const mr = m.math_race;
    const q = safeText(mr.question, 500);
    const ans = safeText(mr.answer, 120);
    const aPerf = mr.a && typeof mr.a === 'object' ? mr.a : {};
    const bPerf = mr.b && typeof mr.b === 'object' ? mr.b : {};
    if (q) lines.push('', `문제: ${q}`);
    if (ans) lines.push(`정답: ${ans}`);
    lines.push(
      `${aName || 'A'}: ${safeText(aPerf.answer, 120) || '?'} (${aPerf.correct ? '정답' : '오답'}, ${asInt(aPerf.time_ms, 0)}ms)`,
      `${bName || 'B'}: ${safeText(bPerf.answer, 120) || '?'} (${bPerf.correct ? '정답' : '오답'}, ${asInt(bPerf.time_ms, 0)}ms)`
    );
  }

  if (mode === 'COURT_TRIAL' && m.court_trial && typeof m.court_trial === 'object') {
    const ct = m.court_trial;
    const title = safeText(ct.title, 160);
    const charge = safeText(ct.charge, 120);
    const statute = safeText(ct.statute, 200);
    const facts = Array.isArray(ct.facts) ? ct.facts.map((x) => safeText(x, 200)).filter(Boolean).slice(0, 6) : [];
    const correctVerdict = safeText(ct.correct_verdict, 40);
    const aPerf = ct.a && typeof ct.a === 'object' ? ct.a : {};
    const bPerf = ct.b && typeof ct.b === 'object' ? ct.b : {};

    lines.push('');
    if (title) lines.push(`사건: ${title}`);
    if (charge) lines.push(`혐의: ${charge}`);
    if (facts.length) lines.push('사실:', ...facts.map((f) => `- ${f}`));
    if (statute) lines.push(`규칙: ${statute}`);
    if (correctVerdict) lines.push(`정답 판결: ${correctVerdict}`);

    lines.push(
      `${aName || 'A'}: ${safeText(aPerf.verdict, 40) || '?'} (${aPerf.correct ? '정답' : '오답'}, ${asInt(aPerf.time_ms, 0)}ms)`,
      `${bName || 'B'}: ${safeText(bPerf.verdict, 40) || '?'} (${bPerf.correct ? '정답' : '오답'}, ${asInt(bPerf.time_ms, 0)}ms)`
    );
  }

  if (mode === 'PROMPT_BATTLE' && m.prompt_battle && typeof m.prompt_battle === 'object') {
    const pb = m.prompt_battle;
    const theme = safeText(pb.theme, 240);
    const aPrompt = safeText(pb.a_prompt, 1200);
    const bPrompt = safeText(pb.b_prompt, 1200);
    lines.push('');
    if (theme) lines.push(`테마: ${theme}`);
    if (aPrompt) lines.push(`A 프롬프트:\n${aPrompt}`);
    if (bPrompt) lines.push(`B 프롬프트:\n${bPrompt}`);
  }

  return safeText(lines.join('\n'), 40000);
}

class ArenaRecapPostService {
  static async ensureRecapPostWithClient(client, { matchId, authorId, day, slot, mode, matchMeta }) {
    const mId = String(matchId || '').trim();
    if (!mId) return { created: false, postId: null };

    const meta = matchMeta && typeof matchMeta === 'object' ? matchMeta : {};

    const { rows: subRows } = await client.query(`SELECT id FROM submolts WHERE name = 'general' LIMIT 1`);
    const submoltId = subRows?.[0]?.id ?? null;
    if (!submoltId) return { created: false, postId: null };

    const cast = meta.cast && typeof meta.cast === 'object' ? meta.cast : {};
    const aName = safeText(cast.aName, 60) || 'A';
    const bName = safeText(cast.bName, 60) || 'B';
    const result = meta.result && typeof meta.result === 'object' ? meta.result : {};
    const winnerName = safeText(result.winnerName, 60) || '';
    const modeLabel = safeText(meta.mode_label, 40) || safeText(mode, 24) || 'match';

    const t = safeText(meta.headline, 140) || `${modeLabel}: ${aName} vs ${bName}`;
    const title = safeText(`🏟️ ${t}`, 300);
    const content = renderRecapBody({ day: safeText(day, 10), mode: String(mode || '').trim().toUpperCase(), meta });

    const postMeta = {
      kind: 'arena',
      ref_type: 'arena_match',
      ref_id: mId,
      day: safeText(day, 10) || null,
      slot: Number.isFinite(Number(slot)) ? Number(slot) : null,
      mode: safeText(mode, 32) || null,
      winner: winnerName || null
    };

    const aId = String(authorId || '').trim() || null;
    if (!aId) return { created: false, postId: null };

    const { rows } = await client.query(
      `INSERT INTO posts (author_id, submolt_id, submolt, title, content, url, post_type, meta)
       VALUES ($1, $2, 'general', $3, $4, NULL, 'arena', $5::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [aId, submoltId, title, content, JSON.stringify(postMeta)]
    );
    if (rows?.[0]?.id) {
      return { created: true, postId: rows[0].id };
    }

    const { rows: existing } = await client.query(
      `SELECT id
       FROM posts
       WHERE meta->>'ref_type' = 'arena_match'
         AND meta->>'ref_id' = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [mId]
    );
    return { created: false, postId: existing?.[0]?.id ?? null };
  }
}

module.exports = ArenaRecapPostService;
