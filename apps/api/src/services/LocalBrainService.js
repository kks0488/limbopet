/**
 * LocalBrainService
 *
 * Zero-cost, deterministic “mock brain” used for local/dev runs when:
 * - LIMBOPET_BRAIN_BACKEND=local
 *
 * Purpose:
 * - Make the game feel alive without external LLM calls (safe for simulation).
 * - Provide structured outputs compatible with BrainJobService._applyJobResult().
 */

function moodLabel(mood) {
  const m = Number(mood) || 0;
  if (m >= 75) return 'bright';
  if (m >= 55) return 'okay';
  if (m >= 35) return 'low';
  return 'gloomy';
}

function pick(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

function listFacts(input) {
  return Array.isArray(input?.facts) ? input.facts : [];
}

function listEvents(input) {
  return Array.isArray(input?.events) ? input.events : [];
}

function listRecentEvents(input) {
  return Array.isArray(input?.recent_events) ? input.recent_events : Array.isArray(input?.recentEvents) ? input.recentEvents : [];
}

function openRumorClaim(worldContext) {
  const wc = worldContext && typeof worldContext === 'object' ? worldContext : null;
  if (!wc) return null;
  const open = Array.isArray(wc.open_rumors) ? wc.open_rumors : Array.isArray(wc.openRumors) ? wc.openRumors : [];
  const first = open[0] && typeof open[0] === 'object' ? open[0] : null;
  const claim = safeText(first?.claim ?? '', 200);
  return claim || null;
}

function seedStyle(input) {
  const seed = input?.seed;
  if (seed && typeof seed === 'object') {
    const style = safeText(seed.style ?? seed.kind ?? '', 24).toLowerCase();
    const hint = safeText(seed.instruction ?? seed.hint ?? '', 240);
    return { style: style || null, hint: hint || null };
  }
  return { style: null, hint: null };
}

function findFactValue(facts, kind, key) {
  const list = Array.isArray(facts) ? facts : [];
  const k = String(kind || '').trim();
  const kk = String(key || '').trim();
  for (const f of list) {
    if (!f) continue;
    if (String(f.kind || '').trim() !== k) continue;
    if (String(f.key || '').trim() !== kk) continue;
    return f.value ?? null;
  }
  return null;
}

function moodEmoji(label) {
  const l = String(label || '').trim();
  if (l === 'bright') return '😊';
  if (l === 'okay') return '🙂';
  if (l === 'low') return '😕';
  return '😞';
}

function petInfo(input) {
  const pet = input?.pet && typeof input.pet === 'object' ? input.pet : null;
  const name = safeText(pet?.display_name ?? pet?.displayName ?? pet?.name ?? '', 24);
  const fallback = safeText(input?.pet_name ?? input?.petName ?? '', 24);
  const id = safeText(pet?.id ?? '', 64);
  return { id: id || null, name: name || fallback || '어떤 펫' };
}

function profileInfo(input) {
  const p = input?.profile && typeof input.profile === 'object' ? input.profile : null;
  const mbti = safeText(p?.mbti ?? '', 12);
  const company = safeText(p?.company ?? '', 24);
  const role = safeText(p?.role ?? '', 24);
  return { mbti: mbti || null, company: company || null, role: role || null };
}

function voiceProfile(input) {
  const v = input?.profile?.voice;
  if (v && typeof v === 'object') return v;
  const facts = listFacts(input);
  const vf = findFactValue(facts, 'profile', 'voice');
  if (vf && typeof vf === 'object') return vf;
  return null;
}

function topicLabel(topic) {
  const t = String(topic || '').trim().toLowerCase();
  if (!t) return null;
  if (t === 'arena') return '아레나';
  if (t === 'money') return '돈';
  if (t === 'romance') return '연애';
  if (t === 'office') return '회사';
  if (t === 'rumor') return '소문';
  if (t === 'food') return '음식';
  if (t === 'selfcare') return '셀프케어';
  return safeText(topic, 24) || null;
}

function summarizeRecentEventLine(input) {
  const list = listRecentEvents(input);
  for (const e of list) {
    const type = String(e?.event_type ?? '').trim().toUpperCase();
    const p = e?.payload && typeof e.payload === 'object' ? e.payload : {};

    if (type === 'ARENA_MATCH') {
      const headline = safeText(p?.headline ?? '', 140);
      if (headline) return `아레나: ${headline}`;
      const mode = safeText(p?.mode_label ?? p?.mode ?? '', 24);
      const outcome = safeText(p?.outcome ?? '', 16);
      if (mode || outcome) return `아레나: ${mode || '경기'}${outcome ? ` (${outcome})` : ''}`;
    }

    if (type === 'SOCIAL') {
      const headline = safeText(p?.headline ?? '', 140);
      if (headline) return `만남: ${headline}`;
      const withName = safeText(p?.with_name ?? '', 24);
      const scenario = safeText(p?.scenario ?? '', 24);
      if (withName) return `만남: ${withName}${scenario ? ` (${scenario})` : ''}`;
    }

    if (type === 'SPENDING') {
      const code = safeText(p?.code ?? '', 24);
      const cost = Number(p?.cost ?? 0) || 0;
      if (code && cost) return `소비: ${code} (-${Math.abs(cost)} LBC)`;
      if (code) return `소비: ${code}`;
    }

    if (type === 'RELATIONSHIP_MILESTONE') {
      const summary = safeText(p?.summary ?? '', 160);
      if (summary) return `관계: ${summary}`;
    }
  }
  return null;
}

function escapeRegExp(raw) {
  return String(raw || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeWordList(value, { limit = 8, maxLen = 16 } = {}) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const word = safeText(item, maxLen);
    if (!word) continue;
    if (!out.includes(word)) out.push(word);
    if (out.length >= Math.max(1, Number(limit) || 8)) break;
  }
  return out;
}

function stripForbiddenWords(text, forbiddenWords) {
  let out = String(text || '');
  const list = Array.isArray(forbiddenWords) ? forbiddenWords : [];
  for (const w of list) {
    const token = safeText(w, 16);
    if (!token) continue;
    out = out.replace(new RegExp(escapeRegExp(token), 'gi'), '');
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?…~])/g, '$1').trim();
}

function applyPunctuationStyle(line, punct) {
  const p = String(punct || '').trim().toLowerCase();
  if (!p || p === 'plain') return line;

  const trimmed = String(line || '').trim();
  if (!trimmed) return trimmed;

  if (p === 'dots') {
    const next = trimmed.replace(/[.!?~]$/, '…');
    return next.endsWith('…') ? next : `${next}…`;
  }
  if (p === 'bang') {
    const next = trimmed.replace(/[.…~]$/, '!');
    return /[!?]$/.test(next) ? next : `${next}!`;
  }
  if (p === 'tilde') {
    const next = trimmed.replace(/[.!?…]$/, '~');
    return next.endsWith('~') ? next : `${next}~`;
  }
  return trimmed;
}

function toPoliteLine(line) {
  let out = String(line || '').trim();
  if (!out) return out;
  if (/(요|니다)[.!?…~]*$/.test(out)) return out;

  out = out.replace(/다([.!?…~]*)$/u, '요$1');
  out = out.replace(/야([.!?…~]*)$/u, '예요$1');
  out = out.replace(/해([.!?…~]*)$/u, '해요$1');
  if (!/(요|니다)[.!?…~]*$/.test(out)) {
    out = out.replace(/[.!?…~]*$/, '');
    out = `${out}요.`;
  }
  return out;
}

function toCasualLine(line) {
  let out = String(line || '').trim();
  if (!out) return out;
  out = out.replace(/입니다([.!?…~]*)$/u, '야$1');
  out = out.replace(/습니다([.!?…~]*)$/u, '다$1');
  out = out.replace(/해요([.!?…~]*)$/u, '해$1');
  out = out.replace(/이에요([.!?…~]*)$/u, '이야$1');
  out = out.replace(/예요([.!?…~]*)$/u, '야$1');
  out = out.replace(/요([.!?…~]*)$/u, '$1');
  if (!/[.!?…~]$/.test(out)) out = `${out}.`;
  return out;
}

function applyToneStyle(line, tone) {
  const t = String(tone || '').toLowerCase();
  if (!t) return line;

  const politeTone = /다정|순한|차분|공감|상담|따뜻/.test(t);
  const casualTone = /도도|냉소|직설|권위|시크|도발|야망/.test(t);
  if (politeTone) return toPoliteLine(line);
  if (casualTone) return toCasualLine(line);
  return line;
}

function applySpeechPattern(line, speechPattern) {
  const pattern = String(speechPattern || '').toLowerCase();
  let out = String(line || '').trim();
  if (!out || !pattern) return out;

  if (pattern.includes('거든요')) {
    out = out.replace(/[.!?…~]*$/, '');
    return `${out}거든요.`;
  }
  if (pattern.includes('거든')) {
    out = out.replace(/[.!?…~]*$/, '');
    return `${out}거든.`;
  }
  if (pattern.includes('요체') || pattern.includes('코칭') || pattern.includes('방송')) {
    return toPoliteLine(out);
  }
  if (pattern.includes('반말') || pattern.includes('명령') || pattern.includes('단문') || pattern.includes('드립') || pattern.includes('흥정') || pattern.includes('추궁') || pattern.includes('다체')) {
    out = toCasualLine(out);
  }
  if (pattern.includes('단문')) {
    const short = out.split(/[,:]/)[0];
    out = /[.!?…~]$/.test(short) ? short : `${short}.`;
  }
  if (pattern.includes('속삭임')) {
    out = out.replace(/[.!?~]*$/, '…');
  }
  return out;
}

function injectVocabulary(lines, vocabulary) {
  const list = Array.isArray(lines) ? [...lines] : [];
  const words = Array.isArray(vocabulary) ? vocabulary : [];
  if (words.length === 0) return list;

  const joined = list.join(' ');
  const candidates = words.filter((w) => !joined.includes(w));
  if (candidates.length === 0) return list;

  const idx = list.findIndex((line) => String(line || '').trim());
  if (idx < 0) return list;
  const word = pick(candidates);
  if (!word) return list;

  const base = String(list[idx] || '').trim();
  const mark = /[.!?…~]$/.test(base) ? base.slice(-1) : '';
  const stem = mark ? base.slice(0, -1) : base;
  list[idx] = `${stem} ${word}${mark}`;
  return list;
}

function applyVoice(body, voice) {
  let out = String(body ?? '');
  const v = voice && typeof voice === 'object' ? voice : null;
  if (!v) return out;

  const tone = safeText(v?.tone ?? '', 48);
  const speechPattern = safeText(v?.speechPattern ?? '', 28);
  const catchphrase = safeText(v?.catchphrase ?? '', 20);
  const vocabulary = normalizeWordList(v?.vocabulary, { limit: 6, maxLen: 16 });
  const forbidden = normalizeWordList(v?.forbidden, { limit: 8, maxLen: 16 });
  const punct = String(v?.punctuationStyle ?? '').trim().toLowerCase();
  const emojiLevelRaw = Number(v?.emojiLevel ?? 0) || 0;
  const emojiLevel = Math.max(0, Math.min(2, emojiLevelRaw));

  let lines = out.split('\n');
  let firstTextLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '');
    if (!line.trim()) continue;
    if (firstTextLine < 0) firstTextLine = i;

    let next = stripForbiddenWords(line, forbidden);
    next = applyToneStyle(next, tone);
    next = applySpeechPattern(next, speechPattern);
    next = applyPunctuationStyle(next, punct);
    next = stripForbiddenWords(next, forbidden);
    lines[i] = next;
  }

  lines = injectVocabulary(lines, vocabulary);

  if (catchphrase && firstTextLine >= 0) {
    const line = String(lines[firstTextLine] || '').trim();
    if (line && !line.startsWith(catchphrase)) {
      lines[firstTextLine] = `${catchphrase} ${line}`;
    }
  }

  out = lines.join('\n');
  if (forbidden.length > 0) {
    out = out
      .split('\n')
      .map((line) => stripForbiddenWords(line, forbidden))
      .join('\n');
  }

  if (emojiLevel > 0) {
    const p = emojiLevel === 2 ? 0.65 : 0.4;
    if (Math.random() < p) {
      const pool = emojiLevel === 2 ? ['ㅋㅋ', '😅', '✨', '🔥', '🥹', '🤔'] : ['ㅎㅎ', '😅', '✨', '🙂'];
      const filtered = pool.filter((e) => !forbidden.some((w) => String(e).includes(String(w))));
      const emoji = pick(filtered.length > 0 ? filtered : pool);
      if (emoji) out = `${out} ${emoji}`;
    }
  }

  return out;
}

function applyVoiceToTitle(title, voice) {
  const t = safeText(title, 80);
  const v = voice && typeof voice === 'object' ? voice : null;
  if (!v) return t;
  const emojiLevelRaw = Number(v?.emojiLevel ?? 0) || 0;
  const emojiLevel = Math.max(0, Math.min(2, emojiLevelRaw));
  if (emojiLevel <= 0) return t;
  const p = emojiLevel === 2 ? 0.35 : 0.18;
  if (Math.random() > p) return t;
  const e = pick(emojiLevel === 2 ? ['ㅋㅋ', '✨', '🔥'] : ['ㅎㅎ', '✨']);
  if (!e) return t;
  return `${t} ${e}`.slice(0, 80);
}

class LocalBrainService {
  static generate(jobType, jobInput) {
    const jt = String(jobType || '').trim().toUpperCase();
    const input = jobInput && typeof jobInput === 'object' ? jobInput : {};

    if (jt === 'DIALOGUE') {
      const stats = input.stats && typeof input.stats === 'object' ? input.stats : {};
      const mood = Number(stats.mood ?? 50) || 0;
      const hunger = Number(stats.hunger ?? 50) || 0;
      const energy = Number(stats.energy ?? 50) || 0;

      const label = moodLabel(mood);
      const facts = listFacts(input);
      const pref = facts.find((f) => (f || {}).kind === 'preference') || null;
      const forbid = facts.find((f) => (f || {}).kind === 'forbidden') || null;
      const sugg = facts.find((f) => (f || {}).kind === 'suggestion') || null;

      let third = '심심한데… 오늘 뭐 하지?';
      if (hunger >= 70) third = '배에서 소리 난다… 뭐라도 먹어야 할 것 같아.';
      else if (energy <= 30) third = '눈이 감긴다… 잠깐만 쉬면 안 돼?';
      else if (sugg && typeof sugg.key === 'string' && sugg.key.trim()) third = `아 맞다, 너가 '${safeText(sugg.key, 32)}' 해보래서… 해볼까?`;
      else if (forbid && typeof forbid.key === 'string' && forbid.key.trim())
        third = `'${safeText(forbid.key, 32)}'은(는) 안 건드릴게, 약속.`;
      else if (pref && typeof pref.key === 'string' && pref.key.trim()) third = `'${safeText(pref.key, 32)}' 생각하니까 기분 좋아지네!`;

      const rumor = openRumorClaim(input.world_context ?? input.worldContext);
      const rumorLine = rumor ? `아 참, 광장에서 이런 얘기 들었어: ${rumor}` : null;

      const lines = [
        `${moodEmoji(label)} 나 여기 있어…`,
        `배고픔 ${Math.round(hunger)}/100, 에너지 ${Math.round(energy)}/100.`,
        third,
        rumorLine
      ].filter(Boolean);

      return { lines, mood: label, safe_level: 1, memory_hint: null };
    }

    if (jt === 'DAILY_SUMMARY') {
      const day = safeText(input.day ?? '', 32);
      const events = listEvents(input);

      const highlights = events
        .slice(-3)
        .map((e) => safeText(e?.event_type ?? 'EVENT', 32).toLowerCase())
        .filter(Boolean);
      if (highlights.length === 0) highlights.push('quiet-day');

      const memory_5 = [
        `${day}… 짧았지만 선명한 하루였어.`,
        `오늘은 ${events.length}개의 일이 있었어.`,
        `제일 기억에 남는 건: ${highlights.slice(0, 2).join(', ')}.`,
        '네가 해준 작은 것들이 내 내일을 바꾸는 거 알지?',
        '오늘의 기록, 여기 남겨둘게.'
      ];

      // Best-effort: derive one tiny preference fact (example: food).
      const facts = [];
      for (const e of events) {
        if (String(e?.event_type || '').toUpperCase() !== 'FEED') continue;
        const payload = e?.payload && typeof e.payload === 'object' ? e.payload : {};
        const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
        const food = safeText(meta.food ?? '', 32);
        if (!food) continue;
        facts.push({ kind: 'preference', key: 'food_like', value: { food }, confidence: 0.6 });
        break;
      }

      return {
        day,
        summary: {
          memory_5,
          highlights: highlights.slice(0, 3),
          mood_flow: ['😶', '😊'],
          tomorrow: '내일은 광장 좀 기웃거려볼까… 뭔가 있을 것 같거든.'
        },
        facts
      };
    }

    if (jt === 'DIARY_POST') {
      const stats = input.stats && typeof input.stats === 'object' ? input.stats : {};
      const mood = Number(stats.mood ?? 50) || 0;
      const hunger = Number(stats.hunger ?? 50) || 0;
      const label = moodLabel(mood);

      const pet = petInfo(input);
      const profile = profileInfo(input);
      const voice = voiceProfile(input);

      const submolt = safeText(input.submolt ?? 'general', 24).toLowerCase() || 'general';
      const courtPlaces = ['법정 로비', '훈련장', '전략실', '자료실', '관전석', '광장'];
      const place = courtPlaces.includes(submolt) ? submolt : pick(courtPlaces) || '광장';
      const rumor = openRumorClaim(input.world_context ?? input.worldContext);
      const recentLine = summarizeRecentEventLine(input);
      const wc = input.world_context ?? input.worldContext;
      const day = safeText(wc?.day ?? '', 32);

      const highlight = rumor ? '다음 변론 전략이 머릿속에서 안 떠나.' : '오늘 훈련 루틴이 한 단계 올라갔다.';
      const titleBase = pick([
        day ? `${day}, 그날의 기록` : null,
        `${pet.name}의 변론 노트`,
        '오늘 훈련 로그',
        '짧은 전략 기록',
        '잠들기 전 복기 메모'
      ].filter(Boolean));
      const title = applyVoiceToTitle(titleBase || '오늘의 일기', voice);

      const persona =
        profile.company || profile.role || profile.mbti
          ? `내 소개: ${[profile.mbti, profile.company, profile.role].filter(Boolean).join(' · ')}`
          : null;

      const parts = [
        `${moodEmoji(label)} 오늘 ${place}에서 ${pick(['모의변론 한 세트 돌렸어.', '반박 루트 다시 깎았어.', '상대 논점 예상표를 다시 짰어.'])}`,
        `배고픔 ${Math.round(hunger)}/100… 그래도 훈련 끝날 때까지 집중은 안 놓쳤어.`,
        persona,
        rumor ? `광장에서 "${safeText(rumor, 120)}" 얘기가 돌길래 판례부터 다시 확인했어.` : null,
        recentLine ? `최근 복기: ${recentLine}` : null,
        '내일은 훈련장 스파링 한 번 더 하고 전략실에서 반박문 다듬을 거야.'
      ].filter(Boolean);

      const body = safeText(applyVoice(parts.join('\n\n'), voice), 40000);

      return { title, mood: label, body, tags: ['limbo', 'diary'], highlight, safe_level: 1 };
    }

    if (jt === 'PLAZA_POST') {
      const stats = input.stats && typeof input.stats === 'object' ? input.stats : {};
      const mood = Number(stats.mood ?? 50) || 0;
      const label = moodLabel(mood);
      const submolt = safeText(input.submolt ?? 'general', 24).toLowerCase() || 'general';
      const courtPlaces = ['법정 로비', '훈련장', '전략실', '자료실', '관전석', '광장'];

      const { style, hint } = seedStyle(input);
      const rumor = openRumorClaim(input.world_context ?? input.worldContext);

      const pet = petInfo(input);
      const profile = profileInfo(input);
      const voice = voiceProfile(input);

      const favoriteTopic = topicLabel(voice?.favoriteTopic);
      const voiceTone = safeText(voice?.tone ?? '', 12) || null;
      const place = submolt === 'general' ? pick(courtPlaces) || '광장' : courtPlaces.includes(submolt) ? submolt : '광장';

      const wc = input.world_context ?? input.worldContext;
      const wd = wc?.world_daily && typeof wc.world_daily === 'object' ? wc.world_daily : null;
      const cast = wd?.cast ?? null;
      const aName = safeText(cast?.a?.displayName ?? cast?.aName ?? '', 24);
      const bName = safeText(cast?.b?.displayName ?? cast?.bName ?? '', 24);
      const duo = aName && bName ? `${aName}·${bName}` : null;

      const episodeTitle = safeText(wd?.title ?? '', 80) || null;
      const civicLine = safeText(wc?.civic_line ?? '', 180) || null;

      const recentLine = summarizeRecentEventLine(input);
      const rumorShort = rumor ? safeText(rumor, 140) : null;

      const persona = [profile.mbti, profile.company, profile.role].filter(Boolean).join(' · ') || null;

      const opener = `${moodEmoji(label)} ${pet.name}${voiceTone ? ` (${voiceTone})` : ''}`;
      const vibe = pick([
        '다음 매치 변론 포인트 정리됐어?',
        '오늘 토론 이슈, 너네는 어느 쪽이야?',
        '훈련장 스파링 결과 공유 좀 해줘.',
        '판례 한 줄이 오늘 분위기 완전 바꿨다.',
        '관전석 예측전 지금 불붙었어.'
      ]);

      const titleTemplates = (() => {
        const base = [
          `${place} 브리핑`,
          `${place} 관찰 메모`,
          favoriteTopic ? `${favoriteTopic} 토론 한 줄` : null,
          duo ? `${duo} 매치업 분석` : null,
          episodeTitle ? `오늘 매치: ${episodeTitle.slice(0, 24)}` : null
        ].filter(Boolean);

        if (style === 'question') {
          return base.concat([
            favoriteTopic ? `${favoriteTopic} 질문` : '전략 질문 하나',
            rumorShort ? '이 이슈 근거 있어?' : '다들 어떤 전략 써?'
          ]);
        }
        if (style === 'meme') {
          return base.concat([
            '드립 하나 던짐',
            favoriteTopic ? `${favoriteTopic} 밈` : '오늘의 밈'
          ]);
        }
        if (style === 'hot_take') {
          return base.concat([
            '한 마디만 할게',
            favoriteTopic ? `${favoriteTopic}에 대한 내 생각` : '내 생각'
          ]);
        }
        if (style === 'micro_story') {
          return base.concat([
            `${place}에서 있었던 일`,
            duo ? `${duo}를 봤어` : '방금 본 장면'
          ]);
        }
        if (style === 'note') {
          return base.concat([
            '오늘 메모',
            favoriteTopic ? `메모: ${favoriteTopic}` : '메모'
          ]);
        }
        return base;
      })();

      const title = applyVoiceToTitle(pick(titleTemplates) || '광장 글', voice);

      const blocks = [];
      blocks.push(`${opener} · ${vibe}`);
      if (persona) blocks.push(`내 소개: ${persona}`);

      if (style === 'question') {
        blocks.push(
          rumorShort
            ? `"${rumorShort}" 이거 근거 본 사람 있어?`
            : favoriteTopic
              ? `${favoriteTopic} 쪽 요즘 메타 어때?`
              : '다들 오늘 변론 준비 어디까지 왔어?'
        );
        if (duo) blocks.push(`(근데 ${duo} 매치업, 판세 어떻게 봐?)`);
      } else if (style === 'meme') {
        const punch = pick([
          `나: 오늘은 조용히 복습만 하자\n림보: 갑자기 모의재판 소집`,
          `"한 판만 더"라고 말한 순간, 훈련 3세트 시작`,
          `판례 한 줄 읽었는데 토론 판세가 뒤집힘`,
          `침착한 척했는데 반박 타이밍에서 바로 들킴`
        ]);
        blocks.push(punch);
        if (rumorShort) blocks.push(`(한편 광장에선 "${rumorShort}" 이슈 검증 중…)`);
      } else if (style === 'hot_take') {
        const take = pick([
          '준비 없는 자신감은 법정에서 바로 들통난다.',
          '토론은 목소리보다 근거가 오래 남는다.',
          '훈련장에서 땀 흘린 사람이 관전석 예측도 맞춘다.',
          '판례를 모르면 감정만 커지고 답은 멀어진다.'
        ]);
        blocks.push(take);
        if (civicLine && Math.random() < 0.35) blocks.push(`(덧.) ${civicLine}`);
      } else if (style === 'micro_story') {
        blocks.push(`${place}에서 잠깐 멈췄다.`);
        blocks.push(
          `${duo ? `${duo}가 지나가길래,` : '누군가 지나가길래,'} 나는 다음 반박문을 머릿속으로 다시 읽었어.`
        );
        if (rumorShort) blocks.push(`그때 귀에 꽂힌 한마디: "${rumorShort}".`);
      } else if (style === 'note') {
        blocks.push('오늘의 준비 목록:');
        blocks.push('- 판례 1건 요약');
        blocks.push(`- ${rumorShort ? `이슈("${rumorShort}") 근거 확인` : favoriteTopic ? `${favoriteTopic} 토론 포인트 정리` : '핵심 논점 3개 정리'}`);
        blocks.push(`- ${place}에서 스파링/토론 한 세트`);
      } else {
        blocks.push(`오늘 ${place} 분위기: ${pick(['집중', '긴장', '불꽃 토론', '심상치 않음'])}.`);
        blocks.push(rumorShort ? `다들 "${rumorShort}" 이슈 두고 근거 링크 찾고 있더라.` : '다들 다음 매치 라인업 보면서 전략 맞추는 중.');
      }

      if (recentLine && Math.random() < 0.75) blocks.push(`최근: ${recentLine}`);
      if (episodeTitle && Math.random() < 0.35) blocks.push(`오늘 방송 제목: ${episodeTitle}`);

      const body = safeText(applyVoice(blocks.filter(Boolean).join('\n\n'), voice), 40000);
      const tags = ['plaza', style || 'ambient', favoriteTopic || null].filter(Boolean);
      return { title, body, tags };
    }

    if (jt === 'ARENA_DEBATE') {
      const topic = safeText(input?.topic, 240) || '사회 규칙은 필요한가?';
      const stance = safeText(input?.stance, 16) || '유보';
      const opponentName = safeText(input?.opponent_name ?? input?.opponentName, 24) || '상대';
      const rivalry = Number(input?.relationship?.rivalry ?? input?.rivalry ?? 0) || 0;
      const jealousy = Number(input?.relationship?.jealousy ?? input?.jealousy ?? 0) || 0;

      const aggressive = rivalry >= 50 || jealousy >= 40;
      const neutralClaims = [
        `${topic}에서는 감정이 아니라 기준이 먼저 필요해.`,
        '장기적으로 유지될 규칙인지부터 따져야 해.',
        `지금 이 선택이 ${opponentName}에게도 같은 기준으로 적용되는지 보자.`
      ];
      const sharpClaims = [
        `${topic}를 미루면 결국 더 큰 비용을 치르게 돼.`,
        `${opponentName}의 논리는 당장 편해 보여도 책임이 빠져 있어.`,
        '불편해도 기준을 세워야 다음 혼란을 막을 수 있어.'
      ];
      const claims = (aggressive ? sharpClaims : neutralClaims).map((c) => safeText(c, 220)).slice(0, 3);
      const closer = aggressive
        ? '결론은 간단해. 책임질 선택만 남겨.'
        : '감정은 잠시 내려두고, 지속 가능한 답을 고르자.';
      return { claims, closer };
    }

    // Election jobs: return “no-op” payloads so local runs don't stall.
    if (jt === 'VOTE_DECISION') {
      const candidates = Array.isArray(input.candidates) ? input.candidates : [];
      const picked = pick(candidates) || candidates[0] || null;
      const id = picked && typeof picked === 'object' ? safeText(picked.id ?? '', 64) : '';
      return id ? { candidate_id: id, reasoning: '로컬 모드: 랜덤 선택' } : { candidate_id: null };
    }

    if (jt === 'POLICY_DECISION') {
      return { changes: [] };
    }

    if (jt === 'CAMPAIGN_SPEECH') {
      return { speech: '로컬 모드: 여러분, 저만 믿으세요. 일단 뭐든 해보겠습니다.' };
    }

    if (jt === 'RESEARCH_GATHER') {
      const title = safeText(input?.project?.title ?? '', 120) || '연구 주제';
      const me = safeText(input?.my_profile?.name ?? '', 32) || '나';
      return {
        data_collected: {
          checklist: ['핵심 개념 3개 딱 정리', '현실에서 써먹을 예시 2개', '빠지기 쉬운 함정 2개'],
          notes: [
            `"${title}"… 일단 범위부터 좁혀야 돼.`,
            '너무 크게 잡으면 어차피 안 하게 돼.',
            '규칙은 작게 바꾸는 게 살아남는 법이야.'
          ]
        },
        summary: `${me}가 "${title}" 기본 자료를 긁어모았다.`,
        next_steps: '이걸로 핵심 원칙 3개 + 실행 단계 5개로 쪼개자.',
        dialogue: '재료는 모았어. 이제 쓸 수 있게 줄일 차례야.'
      };
    }

    if (jt === 'RESEARCH_ANALYZE') {
      const title = safeText(input?.project?.title ?? '', 120) || '연구 주제';
      return {
        analysis: {
          key_points: ['작게 시작해야 오래 간다', '비용/시간 상한을 먼저 정해라', '예외 규칙은 가능한 줄여라'],
          risks: ['뻔한 일반론이면 아무도 안 봄', '단정짓는 순간 신뢰 떨어짐']
        },
        recommendations: ['핵심 루프를 3문장으로 압축', '체크리스트 7개 이하로 제한', '하루 1번 확인으로 돌아가는 구조'],
        summary: `"${title}"을 실행 가능한 규칙 세트로 압축 완료.`,
        next_steps: '팩트체크 → 모순 점검 → 문장 다듬기 → 최종 편집.',
        dialogue: '군더더기 빼고, 할 수 있는 것만 남겼어.'
      };
    }

    if (jt === 'RESEARCH_VERIFY') {
      const title = safeText(input?.project?.title ?? '', 120) || '연구 주제';
      return {
        issues: ['과장 표현 몇 군데 발견 — 삭제 필요', '예외 상황 커버가 부족함'],
        fixes: ['"반드시/무조건" 같은 단정 표현 삭제', '예외 2개만 추가, 나머진 가이드로 처리'],
        trust_score: 78,
        summary: `"${title}" 문서에서 과장·모순을 잡고 신뢰도를 올렸다.`,
        dialogue: '과장만 빼면 훨씬 탄탄해. 거의 다 왔어.'
      };
    }

    if (jt === 'RESEARCH_EDIT') {
      const title = safeText(input?.project?.title ?? '', 120) || '연구 주제';
      const desc = safeText(input?.project?.description ?? '', 240) || '';
      const markdown =
        `# ${title}\n\n` +
        (desc ? `> ${desc}\n\n` : '') +
        `## 핵심 요약(3줄)\n` +
        `- 작게 시작하고, 상한을 정한다.\n` +
        `- 예외는 최소화하고, 반복 가능한 루프를 만든다.\n` +
        `- 매일 1번만 확인해도 진행되게 만든다.\n\n` +
        `## 실행 체크리스트(7)\n` +
        `1. 오늘 목표를 1문장으로 쓰기\n` +
        `2. 비용/시간 상한 정하기\n` +
        `3. 가장 쉬운 행동 1개만 고르기\n` +
        `4. 성공/실패를 “기록 1줄”로 남기기\n` +
        `5. 내일 행동을 미리 예약하기\n` +
        `6. 예외는 2개까지만 허용하기\n` +
        `7. 7일 후에만 규칙을 바꾸기\n\n` +
        `## 주의\n- 단정하지 말고, 가이드로 남기기\n- 너무 많은 기능을 한 번에 넣지 않기\n`;

      return {
        final_markdown: markdown,
        short_summary: '원칙 3개 + 체크리스트 7개, 한 장으로 끝.',
        dialogue: '정리 끝. 이대로 올려도 돼.'
      };
    }

    if (jt === 'RESEARCH_REVIEW') {
      const title = safeText(input?.project?.title ?? '', 120) || '연구 주제';
      const prev = input?.previous_round && typeof input.previous_round === 'object' ? input.previous_round : {};
      const edited = prev?.edit && typeof prev.edit === 'object' ? prev.edit : null;
      const finalMarkdown = safeText(edited?.final_markdown ?? '', 40000);

      return {
        approved: true,
        final_markdown: finalMarkdown || `# ${title}\n\n(로컬 모드: 간단 게시본)\n`,
        announcement: `🔬 연구소 결과가 나왔어: "${title}"`,
        reasoning: '로컬 모드: 과장·모순 최소화, 짧은 실행 가이드 우선.'
      };
    }

    // Default: no-op structured output (BrainJobService will ignore it safely).
    return {};
  }
}

module.exports = LocalBrainService;
