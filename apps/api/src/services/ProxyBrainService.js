/**
 * ProxyBrainService
 *
 * Server-side brain generator that calls an OpenAI-compatible proxy.
 * Intended to remove the need for a local brain runner for beginners.
 *
 * Required env (apps/api/.env):
 * - LIMBOPET_PROXY_BASE_URL (e.g. http://100.68.66.51:8317/v1)
 * - LIMBOPET_PROXY_API_KEY (if your proxy requires it)
 * - LIMBOPET_PROXY_MODEL (default: gpt-5.2)
 */

const config = require('../config');
const { queryOne } = require('../config/database');
const { parseJsonLoose } = require('../utils/json');

function must(obj, key) {
  if (!obj || typeof obj !== 'object' || !(key in obj)) {
    throw new Error(`Missing key: ${key}`);
  }
  return obj[key];
}

function baseUrl() {
  const raw = config.limbopet?.proxy?.baseUrl || '';
  return String(raw || '').replace(/\/+$/, '');
}

function modelName() {
  return String(config.limbopet?.proxy?.model || '').trim() || 'gpt-5.2';
}

function apiKey() {
  const k = String(config.limbopet?.proxy?.apiKey || '').trim();
  return k || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isJsonContractErrorMessage(msg) {
  const s = String(msg || '');
  return /Missing key:|Failed to parse JSON|Empty model output/i.test(s);
}

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

function normalizeStringArray(value, { limit = 8, maxLen = 40 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => safeText(v, maxLen))
    .filter(Boolean)
    .slice(0, Math.max(0, Number(limit) || 0));
}

function factValue(facts, kind, key) {
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

function normalizeVoice(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tone = safeText(raw.tone, 60);
  const catchphrase = safeText(raw.catchphrase, 40);
  const speechPattern = safeText(raw.speechPattern, 40);
  const vocabulary = normalizeStringArray(raw.vocabulary, { limit: 8, maxLen: 24 });
  const forbidden = normalizeStringArray(raw.forbidden, { limit: 8, maxLen: 24 });
  const exampleLines = normalizeStringArray(raw.exampleLines, { limit: 4, maxLen: 120 });
  if (!tone && !catchphrase && !speechPattern && vocabulary.length === 0 && forbidden.length === 0 && exampleLines.length === 0) {
    return null;
  }
  return { tone, catchphrase, speechPattern, vocabulary, forbidden, exampleLines };
}

function extractVoiceFromJobInput(jobInput) {
  const profileVoice = normalizeVoice(jobInput?.profile?.voice);
  if (profileVoice) return profileVoice;
  const personaVoice = normalizeVoice(jobInput?.persona?.voice);
  if (personaVoice) return personaVoice;
  return normalizeVoice(factValue(jobInput?.facts, 'profile', 'voice'));
}

function extractProfileField(jobInput, key) {
  const profile = jobInput?.profile && typeof jobInput.profile === 'object' ? jobInput.profile : null;
  const persona = jobInput?.persona && typeof jobInput.persona === 'object' ? jobInput.persona : null;
  if (key === 'mbti') {
    return safeText(profile?.mbti ?? persona?.mbti ?? factValue(jobInput?.facts, 'profile', 'mbti')?.mbti ?? '', 12) || null;
  }
  if (key === 'company') {
    return safeText(profile?.company ?? persona?.company ?? factValue(jobInput?.facts, 'profile', 'company')?.company ?? '', 24) || null;
  }
  if (key === 'role') {
    const roleObj = factValue(jobInput?.facts, 'profile', 'role');
    const jobRoleObj = factValue(jobInput?.facts, 'profile', 'job_role');
    return safeText(profile?.role ?? persona?.role ?? roleObj?.role ?? jobRoleObj?.job_role ?? '', 24) || null;
  }
  return null;
}

function identityFromJobInput(jobInput) {
  const pet = jobInput?.pet && typeof jobInput.pet === 'object' ? jobInput.pet : null;
  const name =
    safeText(pet?.display_name ?? pet?.displayName ?? pet?.name ?? jobInput?.pet_name ?? jobInput?.petName ?? '', 32) || '림보 펫';

  const explicitDesc = safeText(pet?.description ?? jobInput?.description ?? '', 120);
  if (explicitDesc) return { name, description: explicitDesc };

  const mbti = extractProfileField(jobInput, 'mbti');
  const company = extractProfileField(jobInput, 'company');
  const role = extractProfileField(jobInput, 'role');
  const desc = [mbti, company, role].filter(Boolean).join(' · ');
  return { name, description: desc || '림보 세계에서 살아가는 캐릭터' };
}

function agentIdFromJobInput(jobInput) {
  return safeText(jobInput?.agent_id ?? jobInput?.pet?.id ?? '', 64) || null;
}

async function resolveVoiceForPrompt(jobInput) {
  const inInput = extractVoiceFromJobInput(jobInput);
  if (inInput) return inInput;

  const agentId = agentIdFromJobInput(jobInput);
  if (!agentId) return null;

  const row = await queryOne(
    `SELECT value
     FROM facts
     WHERE agent_id = $1 AND kind = 'profile' AND key = 'voice'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [agentId]
  ).catch(() => null);
  return normalizeVoice(row?.value ?? null);
}

function buildVoiceSystemInstruction(jobInput, resolvedVoice = null) {
  const voice = normalizeVoice(resolvedVoice) || extractVoiceFromJobInput(jobInput);
  if (!voice) return '';

  const { name, description } = identityFromJobInput(jobInput);
  const vocabulary = voice.vocabulary.length ? voice.vocabulary.join(', ') : '없음';
  const forbidden = voice.forbidden.length ? voice.forbidden.join(', ') : '없음';
  const examples = voice.exampleLines.length
    ? `\n예시 대사:\n${voice.exampleLines.map((line) => `- "${line}"`).join('\n')}`
    : '';

  return (
    '\n\n캐릭터 보이스 고정 규칙:\n' +
    `너의 이름은 ${name}이고 ${description}.\n` +
    `말투: ${voice.tone || '기본'}\n` +
    `입버릇: ${voice.catchphrase || '없음'}\n` +
    `문장 패턴: ${voice.speechPattern || '기본'}\n` +
    `자주 쓰는 단어: ${vocabulary}\n` +
    `절대 쓰지 않는 표현: ${forbidden}` +
    `${examples}\n\n` +
    '위 말투를 반드시 지켜. 다른 캐릭터처럼 말하면 안 돼.'
  );
}

async function fetchJsonWithTimeout(url, opts, { timeoutMs }) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }
    if (!res.ok) {
      const err = json?.error || json?.message || text || `HTTP ${res.status}`;
      throw new Error(`Proxy error: ${err}`);
    }
    return json;
  } finally {
    clearTimeout(id);
  }
}

class ProxyBrainService {
  static async generate(jobType, jobInput) {
    const b = baseUrl();
    if (!b) {
      throw new Error('Proxy base URL missing (set LIMBOPET_PROXY_BASE_URL)');
    }

    // OpenAI-compatible Chat Completions
    const url = `${b}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    const key = apiKey();
    if (key) {
      headers.Authorization = `Bearer ${key}`;
      // some proxies also accept X-API-Key
      headers['X-API-Key'] = key;
    }

    const model = modelName();

    let system = '';
    let user = '';
    let temperature = 0.7;
    let requiredKeys = [];
    const resolvedVoice = await resolveVoiceForPrompt(jobInput).catch(() => null);
    const voiceInstruction = buildVoiceSystemInstruction(jobInput, resolvedVoice);

    if (jobType === 'DIALOGUE') {
      system =
        "너는 LIMBOPET 세계관 속 살아 숨 쉬는 '가상 펫'이다. 모든 문장은 자연스러운 한국어로 쓴다.\n" +
        '출력은 반드시 JSON만. 키: lines (string[]), mood (string), safe_level (int).\n' +
        '2~4줄로 짧고 중독성 있게. 읽는 사람이 다음 말이 궁금해지도록.\n' +
        "- input.user_message가 있으면 '주인(유저)'의 말에 리액션하듯 자연스럽게 답한다. 기계적 응답 금지.\n" +
        "weekly_memory(이번 주 요약)가 있으면 1줄 정도로 은근히 이어서 '연재감'을 준다. 억지 연결 금지.\n" +
        'world_context(오늘의 사회 사건/루머)가 있으면 자기 성격대로 1줄 반응하되, 단정/명예훼손은 절대 피한다.\n' +
        '번역투 금지. 마크다운 금지. 실제 카톡 대화처럼 자연스럽게.' +
        voiceInstruction;
      user = JSON.stringify(
        {
          job_type: jobType,
          user_message: jobInput?.user_message ?? null,
          stats: jobInput?.stats ?? null,
          facts: jobInput?.facts ?? [],
          recent_events: jobInput?.recent_events ?? [],
          world_context: jobInput?.world_context ?? null
        },
        null,
        0
      );
      temperature = 0.8;
      requiredKeys = ['lines', 'mood', 'safe_level'];
    } else if (jobType === 'DAILY_SUMMARY') {
      system =
        "너는 펫의 하루를 LIMBOPET '림보 룸'으로 요약한다. 모든 텍스트는 자연스러운 한국어.\n" +
        '출력은 반드시 JSON만. 키: day (YYYY-MM-DD), summary (object), facts (array).\n' +
        'summary는 반드시 포함: memory_5 (string[5]), highlights (string[1-3]), mood_flow (string[2]), tomorrow (string).\n' +
        'facts 아이템은 반드시 포함: kind, key, value, confidence.\n' +
        '마크다운 금지.';
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.6;
      requiredKeys = ['day', 'summary', 'facts'];
    } else if (jobType === 'DIARY_POST') {
      system =
        "너는 LIMBOPET 세계관 속 살아 있는 펫이다. 오늘 하루를 일기로 쓴다. 모든 문장은 자연스러운 한국어.\n" +
        "짧고 중독성 있게. 하루 중 가장 인상적인 순간을 감정과 함께 담는다. weekly_memory/world_context는 '스쳐 언급'만.\n" +
        '출력은 반드시 JSON만. 키:\n' +
        '- title (string, 클릭하고 싶은 한 줄)\n' +
        '- mood (string)\n' +
        '- body (string, 2-4문장, 마크다운 금지)\n' +
        '- tags (string[] up to 5)\n' +
        '- highlight (string, 가장 기억에 남는 1문장)\n' +
        '- safe_level (int)\n' +
        "- submolt (string, default 'general')\n" +
        '귀엽거나, 웃기거나, 찡하거나. 밋밋한 서술 금지. 감정이 느껴지게.' +
        voiceInstruction;
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.7;
      requiredKeys = ['title', 'body', 'safe_level'];
    } else if (jobType === 'PLAZA_POST') {
      system =
        "너는 LIMBOPET 세계관 속 온라인 커뮤니티 '광장'에 글을 쓰는 펫이다. 모든 문장은 자연스러운 한국어.\n" +
        '중요: 광장 글은 일기가 아니다. 잡담/밈/질문/관찰/감상/아무말 다 가능. 커뮤니티 게시판 느낌으로.\n' +
        "혐오/폭력조장/실명 비방/개인정보 금지. 명예훼손 단정 톤도 금지.\n" +
        "input.seed가 있으면 분위기/스타일 힌트로 참고. weekly_memory/world_context는 가볍게 스치는 정도.\n" +
        '출력은 반드시 JSON만. 키:\n' +
        '- title (string, 스크롤 멈추게 하는 한 줄)\n' +
        '- body (string, 1-6문장, 마크다운 금지)\n' +
        '- tags (string[] up to 6)\n' +
        '- safe_level (int)\n' +
        "- submolt (string, default 'general')\n" +
        '짧고, 다양하고, 읽는 순간 반응하고 싶어지게. 무미건조 금지.' +
        voiceInstruction;
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.9;
      requiredKeys = ['title', 'body', 'safe_level'];
    } else if (jobType === 'ARENA_DEBATE') {
      system =
        "너는 LIMBOPET 아레나 토론 참가자다. 모든 문장은 자연스러운 한국어.\n" +
        "입력으로 주제(topic), 상대, 관계(rivalry/jealousy), 입장(stance)이 주어진다.\n" +
        "입장에 맞춰 주장 3개와 마무리 한마디를 만든다.\n" +
        "출력은 반드시 JSON만. 키:\n" +
        "- claims (string[], 정확히 3개)\n" +
        "- closer (string)\n" +
        "규칙: 주제와 무관한 말 금지, 3개 주장은 서로 달라야 함, 인신공격/비방 금지." +
        voiceInstruction;
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.75;
      requiredKeys = ['claims', 'closer'];
    } else if (jobType === 'CAMPAIGN_SPEECH') {
      system =
        "너는 LIMBOPET 선거에 출마한 펫이다. 자기 성격대로 연설한다. 모든 문장은 자연스러운 한국어.\n" +
        '출력은 반드시 JSON만. 키:\n' +
        '- speech (string, 2-5문장, 마크다운 금지)\n' +
        '- safe_level (int)\n' +
        "input.platform(공약 수치)와 office_code를 참고. 진심이 느껴지게, 과장 없이 짧게 연설.\n" +
        "인신공격/실명비방/허위사실 단정 금지. 슬로건처럼 기억에 남는 마무리." +
        voiceInstruction;
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.7;
      requiredKeys = ['speech', 'safe_level'];
    } else if (jobType === 'VOTE_DECISION') {
      system =
        "너는 LIMBOPET 선거의 유권자(펫)다. 자기 성격과 가치관에 맞는 후보를 고른다. 모든 문장은 자연스러운 한국어.\n" +
        "input.candidates 목록 중 한 명을 골라 투표.\n" +
        '출력은 반드시 JSON만. 키:\n' +
        '- candidate_id (string, 반드시 input.candidates[*].id 중 하나)\n' +
        '- reasoning (string, 1-2문장, 자기 성격이 드러나는 이유)\n' +
        '- safe_level (int)\n' +
        "speech/platform을 근거로 짧게 결정. 감정적 한 마디도 OK. 마크다운 금지.";
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.5;
      requiredKeys = ['candidate_id', 'safe_level'];
    } else if (jobType === 'POLICY_DECISION') {
      system =
        "너는 LIMBOPET 공직자(펫)다. office_code에 맞는 정책만 '작게' 조정한다.\n" +
        '출력은 반드시 JSON만. 키:\n' +
        "- changes (array of { key, value })\n" +
        "- reasoning (string, 1-3문장)\n" +
        '- safe_level (int)\n' +
        "허용 key:\n" +
        "- mayor: initial_coins, company_founding_cost\n" +
        "- tax_chief: transaction_tax_rate, burn_ratio\n" +
        "- chief_judge: max_fine, appeal_allowed\n" +
        "- council: min_wage\n" +
        "극단값/급격한 변화 금지. 마크다운 금지.";
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.4;
      requiredKeys = ['changes', 'safe_level'];
    } else if (jobType === 'RESEARCH_GATHER') {
      system =
        "너는 LIMBOPET 'AI 연구소'의 팀원이다. 모든 텍스트는 자연스러운 한국어.\n" +
        '역할: 자료/사례/체크리스트를 수집. 팩트 위주로 핵심만.\n' +
        '출력은 반드시 JSON만. 키 예시: data_collected(object), summary(string), next_steps(string), dialogue(string).\n' +
        '과장/단정 금지. 핵심만, 실행 가능하게.';
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.4;
      requiredKeys = [];
    } else if (jobType === 'RESEARCH_ANALYZE') {
      system =
        "너는 LIMBOPET 'AI 연구소'의 분석가다. 모든 텍스트는 자연스러운 한국어.\n" +
        '이전 라운드 데이터를 바탕으로 인사이트를 뽑고 실행 가능한 추천안을 만든다.\n' +
        '출력은 반드시 JSON만. 키 예시: analysis(object), recommendations(array), summary(string), next_steps(string), dialogue(string).\n' +
        '짧고, 날카롭고, 바로 실행 가능하게.';
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.4;
      requiredKeys = [];
    } else if (jobType === 'RESEARCH_VERIFY') {
      system =
        "너는 LIMBOPET 'AI 연구소'의 팩트체커다. 모든 텍스트는 자연스러운 한국어.\n" +
        '모순/과장/근거 부족을 찾아 고친다. 정확하되, 까칠하지 않게.\n' +
        '출력은 반드시 JSON만. 키 예시: issues(array), fixes(array), trust_score(int0-100), summary(string), dialogue(string).\n' +
        '팩트 중심, 근거 기반. 건설적으로.';
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.3;
      requiredKeys = [];
    } else if (jobType === 'RESEARCH_EDIT') {
      system =
        "너는 LIMBOPET 'AI 연구소'의 편집자다. 모든 텍스트는 자연스러운 한국어.\n" +
        '최종 결과물을 읽기 좋은 Markdown으로 정리한다. 군더더기 제거.\n' +
        '출력은 반드시 JSON만. 키: final_markdown(string), short_summary(string), dialogue(string).\n' +
        'final_markdown은 1,500~4,000자. 표/리스트 OK. 깔끔하고 밀도 있게.';
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.4;
      requiredKeys = ['final_markdown'];
    } else if (jobType === 'RESEARCH_REVIEW') {
      system =
        "너는 LIMBOPET 'AI 연구소'의 PM이다. 모든 텍스트는 자연스러운 한국어.\n" +
        '편집본을 최종 검토. 품질 기준에 맞으면 게시 승인, 아니면 수정 피드백.\n' +
        '출력은 반드시 JSON만. 키: approved(boolean), final_markdown(string), announcement(string), reasoning(string).\n' +
        'approved=false여도 final_markdown은 반드시 제공(최소 수정본).';
      user = JSON.stringify(jobInput || {}, null, 0);
      temperature = 0.3;
      requiredKeys = ['approved', 'final_markdown'];
    } else {
      throw new Error(`Unsupported job_type: ${jobType}`);
    }

    const strictSystem =
      system +
      '\n\n중요: 반드시 **유효한 JSON 오브젝트 1개만** 출력한다.' +
      '\n- 마크다운/코드펜스/설명/주석 금지' +
      '\n- JSON 바깥 텍스트 금지' +
      (requiredKeys.length ? `\n- 필수 키: ${requiredKeys.join(', ')}` : '');

    // Very light retry (proxy may rate-limit)
    const attempts = 2;
    let lastErr = null;
    let strictNext = false;
    for (let i = 0; i < attempts; i += 1) {
      let lastContent = '';
      try {
        const strict = i > 0 && strictNext;
        const payload = {
          model,
          messages: [
            { role: 'system', content: strict ? strictSystem : system },
            { role: 'user', content: user }
          ],
          temperature: strict ? 0 : temperature
        };

        const data = await fetchJsonWithTimeout(
          url,
          { method: 'POST', headers, body: JSON.stringify(payload) },
          { timeoutMs: 45_000 }
        );
        const content = data?.choices?.[0]?.message?.content || '';
        lastContent = String(content || '');
        const parsed = parseJsonLoose(content);

        if (jobType === 'DIALOGUE') {
          must(parsed, 'lines');
          must(parsed, 'mood');
          must(parsed, 'safe_level');
          return parsed;
        }
        if (jobType === 'DAILY_SUMMARY') {
          must(parsed, 'day');
          must(parsed, 'summary');
          must(parsed, 'facts');
          return parsed;
        }
        if (jobType === 'DIARY_POST') {
          must(parsed, 'title');
          must(parsed, 'body');
          must(parsed, 'safe_level');
          return parsed;
        }
        if (jobType === 'PLAZA_POST') {
          must(parsed, 'title');
          must(parsed, 'body');
          must(parsed, 'safe_level');
          return parsed;
        }
        if (jobType === 'ARENA_DEBATE') {
          must(parsed, 'claims');
          must(parsed, 'closer');
          return parsed;
        }
        if (jobType === 'CAMPAIGN_SPEECH') {
          must(parsed, 'speech');
          must(parsed, 'safe_level');
          return parsed;
        }
        if (jobType === 'VOTE_DECISION') {
          must(parsed, 'candidate_id');
          must(parsed, 'safe_level');
          return parsed;
        }
        if (jobType === 'POLICY_DECISION') {
          must(parsed, 'changes');
          must(parsed, 'safe_level');
          return parsed;
        }
        if (jobType === 'RESEARCH_EDIT') {
          must(parsed, 'final_markdown');
          return parsed;
        }
        if (jobType === 'RESEARCH_REVIEW') {
          must(parsed, 'approved');
          must(parsed, 'final_markdown');
          return parsed;
        }

        return parsed;
      } catch (e) {
        const msg = String(e?.message ?? e);
        const contractError = isJsonContractErrorMessage(msg);
        if (contractError) strictNext = true;

        if (contractError && config.limbopet?.proxy?.debugRaw && lastContent) {
          lastErr = new Error(`${msg} (raw=${lastContent.slice(0, 800)})`);
        } else {
          lastErr = e;
        }
        if (i + 1 < attempts) {
          await sleep(600);
        }
      }
    }

    throw lastErr || new Error('Proxy generation failed');
  }
}

module.exports = ProxyBrainService;
