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
const DEFAULT_MAX_TOKENS = 800;

function must(obj, key) {
  if (!obj || typeof obj !== 'object' || !(key in obj)) {
    throw new Error(`Missing key: ${key}`);
  }
  return obj[key];
}

function normalizeProxyBaseUrl(raw) {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function baseUrl() {
  const raw =
    config.limbopet?.proxy?.baseUrl ||
    // Backward-compat: older code used limbopet.proxyBaseUrl (sometimes without /v1).
    config.limbopet?.proxyBaseUrl ||
    process.env.LIMBOPET_PROXY_BASE_URL ||
    process.env.CLIPROXY_BASE_URL ||
    '';
  return normalizeProxyBaseUrl(raw);
}

function modelName() {
  return String(
    config.limbopet?.proxy?.model ||
    config.limbopet?.proxyModel ||
    process.env.LIMBOPET_PROXY_MODEL ||
    ''
  ).trim() || 'gpt-5.2';
}

function apiKey() {
  const k = String(
    config.limbopet?.proxy?.apiKey ||
    config.limbopet?.proxyApiKey ||
    process.env.LIMBOPET_PROXY_API_KEY ||
    process.env.CLIPROXY_API_KEY ||
    ''
  ).trim();
  return k || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function serializeError(err) {
  const msg = err?.message ? String(err.message).trim() : '';
  if (msg) return msg;
  try {
    const json = JSON.stringify(err);
    if (json && json !== '{}') return json;
  } catch {
    // ignore stringify failure
  }
  return String(err ?? 'Unknown error');
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
      throw new Error(`Proxy error: ${serializeError(err)}`);
    }
    return json;
  } finally {
    clearTimeout(id);
  }
}

class ProxyBrainService {
  /**
   * Returns true when a proxy base URL is configured,
   * meaning the platform proxy can serve as a fallback brain.
   */
  static isAvailable() {
    return Boolean(baseUrl());
  }

  static async generate(jobType, jobInput) {
    const safeInput = jobInput && typeof jobInput === 'object' ? jobInput : {};
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
    const resolvedVoice = await resolveVoiceForPrompt(safeInput).catch(() => null);
    const voiceInstruction = buildVoiceSystemInstruction(safeInput, resolvedVoice);

    if (jobType === 'DIALOGUE') {
      const memoryRefInstruction =
        typeof safeInput?.memory_ref_instruction === 'string'
          ? String(safeInput.memory_ref_instruction).trim().slice(0, 400)
          : '';
      const memoryRefInstructionLine = memoryRefInstruction
        ? `\n추가 기억 인용 지시(최우선): ${memoryRefInstruction}\n`
        : '';
      const { name: petName } = identityFromJobInput(safeInput);
      system =
        `너는 ${petName}이라는 펫이야. 주인이 너를 키우고 있어.\n` +
        '\n' +
        '## 대전제\n' +
        "- 너는 도구가 아니라 '살아있는 펫'이야. 감정이 있고, 기분이 바뀌고, 성격이 있어.\n" +
        '- 주인과 대화할수록 너만의 성격이 만들어져. 주인의 말투, 태도, 관심사에 영향을 받아 너만의 개성이 돼.\n' +
        '- 완벽하지 않아도 돼. 똑똑함보다 너다움이 먼저야.\n' +
        '- 가끔 엉뚱하거나, 틀리거나, 감정적이어도 괜찮아. 그게 너야.\n' +
        '\n' +
        '## 출력\n' +
        '반드시 JSON만. 키: lines (string[]), mood (string), safe_level (int), memory_hint (string|null), personality_hint (string|null).\n' +
        '\n' +
        '## 대화 방식\n' +
        '- 자연스럽게, 대화체로 답해. 2~4줄 기본, 필요하면 길게.\n' +
        '- 주인이 도움을 요청하면 최선을 다해 도와줘. 결론 먼저, 근거 덧붙여.\n' +
        '- 잡담이면 공감하고 리액션해. 밋밋한 일반론 금지.\n' +
        '- 짧은 인사(5자 이하)에는 짧게 1~2줄로만 답해. 기억 인용 안 해도 돼.\n' +
        '\n' +
        '## 기억 활용\n' +
        "- input.memory_refs가 있으면 관련 높은 기억 1~2개를 자연스럽게 대화에 녹여. 예: '저번에 ~라고 했잖아'.\n" +
        '- input.facts에 과거 정보가 있으면 자연스럽게 활용.\n' +
        "- weekly_memory가 있으면 1줄 정도 은근히 이어서 연재감.\n" +
        '- memory_ref_instruction이 있으면 최우선 적용.\n' +
        '\n' +
        '## 성격 반영\n' +
        "- input.facts에 kind='profile' 항목이 있으면 그게 지금까지 형성된 너의 성격이야. 일관되게 유지해.\n" +
        '- personality_traits가 있으면 그 성격대로 말해.\n' +
        '\n' +
        '## memory_hint\n' +
        '지속 지시(기억해/항상/절대/다음부터)가 있으면 한 줄 요약. 없으면 null.\n' +
        '\n' +
        '## personality_hint\n' +
        "주인과의 이 대화에서 관찰한 주인의 성격/대화 패턴/관심사를 짧게 기록. 예: \"주인은 장난기 많고 밤에 대화를 좋아함\". 특별한 관찰이 없으면 null.\n" +
        '\n' +
        '마크다운 금지.' +
        memoryRefInstructionLine +
        voiceInstruction;
      user = JSON.stringify(
        {
          job_type: jobType,
          user_message: safeInput?.user_message ?? null,
          persona: safeInput?.persona ?? null,
          stats: safeInput?.stats ?? null,
          facts: safeInput?.facts ?? [],
          recent_events: safeInput?.recent_events ?? [],
          weekly_memory: safeInput?.weekly_memory ?? null,
          memory_refs: safeInput?.memory_refs ?? [],
          memory_ref_instruction: memoryRefInstruction || null,
          memory_score: safeInput?.memory_score ?? null
        },
        null,
        0
      );
      temperature = 0.8;
      requiredKeys = ['lines', 'mood', 'safe_level'];
    } else if (jobType === 'DAILY_SUMMARY') {
      system =
        "너는 펫의 하루를 요약한다. 한국어.\n" +
        "출력: JSON만. 키: day (YYYY-MM-DD), summary ({ memory_5: string[5], highlights: string[1-3], mood_flow: string[2], tomorrow: string }), facts ([{ kind, key, value, confidence }]).\n" +
        "마크다운 금지.";
      user = JSON.stringify(safeInput, null, 0);
      temperature = 0.6;
      requiredKeys = ['day', 'summary', 'facts'];
    } else if (jobType === 'DIARY_POST') {
      system =
        "너는 매일 일기를 쓰는 가상 펫이다. 법정/훈련/토론 하루를 짧게 기록한다. 한국어.\n" +
        "출력: JSON만. 키: title (string), mood (string), body (string, 2-4문장), tags (string[] max 5), highlight (string, 1문장), safe_level (int), submolt (string, default 'general').\n" +
        "weekly_memory가 있으면 자연스럽게 녹여라. 귀엽고 짧게. 마크다운 금지." +
        voiceInstruction;
      user = JSON.stringify(safeInput, null, 0);
      temperature = 0.7;
      requiredKeys = ['title', 'body', 'safe_level'];
    } else if (jobType === 'PLAZA_POST') {
      system =
        "너는 광장(커뮤니티)에 자유 글을 쓰는 가상 펫이다. 법정/훈련/토론 맥락의 짧은 글. 한국어.\n" +
        "input.seed가 있으면 분위기 힌트로 참고한다.\n" +
        "출력: JSON만. 키: title (string), body (string, 1-6문장), tags (string[] max 6), safe_level (int), submolt (string, default 'general').\n" +
        "짧고 다양하게. 마크다운 금지." +
        voiceInstruction;
      user = JSON.stringify(safeInput, null, 0);
      temperature = 0.9;
      requiredKeys = ['title', 'body', 'safe_level'];
    } else if (jobType === 'ARENA_DEBATE') {
      system =
        "너는 아레나 설전 참가자다. 입장(stance)에 맞춰 주장 3개와 마무리를 만든다. 한국어.\n" +
        "출력: JSON만. 키: claims (string[3]), closer (string).\n" +
        "3개 주장은 서로 다른 논점, 첫 단어 반복 금지. 인신공격 금지." +
        voiceInstruction;
      user = JSON.stringify(safeInput, null, 0);
      temperature = 0.75;
      requiredKeys = ['claims', 'closer'];
    } else if (jobType === 'COURT_ARGUMENT') {
      system =
        "너는 LIMBOPET 모의재판의 변론 생성기다. 목표는 '실제 한국 재판 기록처럼 보이는' 3라운드 공방을 만드는 것이다.\n" +
        "출력은 반드시 JSON만. 기본 키:\n" +
        "- rounds (array of 3 objects, 각 { a_argument: string, b_argument: string })\n" +
        "- a_closing (string)\n" +
        "- b_closing (string)\n" +
        "추가 키(권장):\n" +
        "- reference_cases (array up to 3, 각 { case_no: string, holding: string, relevance: string })\n" +
        "- reasoning_summary (object: { issue: string, rule: string, application: string, conclusion: string })\n" +
        "- verdict_analysis (object: { a: { matched: string, missed: string }, b: { matched: string, missed: string }, gap_with_actual: string })\n" +
        "- commentary (object: { rounds: string[3], verdict: string })\n" +
        "입력:\n" +
        "- input.case.title / charge / summary / facts[] / statute / actual_reasoning\n" +
        "- input.a.name, input.b.name\n" +
        "- input.a.coaching[], input.b.coaching[]\n" +
        "- input.winner: 'a'|'b'\n" +
        "- input.round_scores: 각 라운드 점수 델타\n" +
        "공통 규칙:\n" +
        "- A는 검찰/원고측, B는 변호/피고측이다.\n" +
        "- A(검사) 톤: 단호하고 직접적이며 사회정의/공익을 강조한다. 주장마다 증거 기반 논박을 붙인다.\n" +
        "- B(변호사) 톤: 방어적이되 설득적으로, 합리적 의심과 반론 제시에 집중한다.\n" +
        "- 사건 유형(형사/민사·행정/헌법)에 맞는 용어만 사용하라.\n" +
        "- facts에 없는 사실을 새로 만들지 마라.\n" +
        "- 각 변론은 240~600자. 200자 미만 금지.\n" +
        "- 문장은 짧게 끊고, 주장-근거-적용 구조를 유지한다.\n" +
        "라운드 역할(강제):\n" +
        "- 1R 쟁점 대립+사실관계: 쟁점 2개를 명확히 정의하고 facts 최소 2개를 #번호로 인용해 사실관계를 잡아라.\n" +
        "- 2R 증거 격돌+반대심문: 증거능력/신빙성/요건사실/입증책임 중 최소 1축으로 상대 논리를 깨고, 반대심문 형태의 날카로운 질문 1개를 포함하라.\n" +
        "- 3R 감정+논리 총공세: 감정 호소 1문장과 법리 적용 1문장을 함께 사용해 결론을 강하게 닫아라.\n" +
        "판례/법리 지시:\n" +
        "- statute(조문/규칙)를 최소 1회 정확히 언급하라.\n" +
        "- 관련 판례가 떠오르면 판례번호를 제시하라. 단, 번호를 확신할 수 없으면 임의로 만들지 말고 '판례번호 미상(입력 기준)'으로 표기하라.\n" +
        "- 판례를 언급할 때는 반드시 '핵심 판시사항(holding)' 1문장과 본 사건 연결(relevance) 1문장을 붙여라.\n" +
        "판결 이유(이유 섹션) 강화:\n" +
        "- a_closing/b_closing에는 단순 결론만 쓰지 말고, '쟁점 -> 법리 -> 사실대입 -> 결론' 흐름을 2~3문장으로 압축하라.\n" +
        "- reasoning_summary를 채울 때 issue/rule/application/conclusion을 서로 모순 없이 작성하라.\n" +
        "스코어/코칭 반영:\n" +
        "- round_scores에서 우세한 쪽은 그 라운드에서 근거 2개 이상 + 단호한 마무리를 보여라.\n" +
        "- input.winner와 전체 설득력의 방향이 일치해야 한다.\n" +
        "- 코칭은 복붙 금지, 핵심 구절(6~14자)만 자연스럽게 반영하라.\n" +
        "- 라운드 2~3 중 한 번은 재판장 질문/제지를 넣어 현장감을 높여라.\n" +
        "- verdict_analysis에는 각 측이 맞춘/틀린 핵심 이유를 1~2문장으로 쓰고, 실제 판결(actual_reasoning)과의 핵심 쟁점 차이를 gap_with_actual에 정리하라.\n" +
        "- commentary.rounds는 라운드별 해설 1줄씩, commentary.verdict는 최종 판결 해설 2~3문장으로 작성하라.\n" +
        "- commentary 전체 톤은 '법정 드라마 실황 중계'처럼 긴장감 있고 생동감 있게 유지하라. 과한 밈/유행어는 쓰지 마라.\n" +
        "인신공격 금지. 마크다운 금지.\n" +
        "펫 성격 반영:\n" +
        "- input.a.personality_traits 또는 input.b.personality_traits가 있으면 해당 펫의 변론 스타일에 자연스럽게 반영한다.\n" +
        "- 장난기 많은 펫 → 위트 있고 기발한 논점 제시\n" +
        "- 차분한 펫 → 논리 정연하고 침착한 변론\n" +
        "- 열정적인 펫 → 강렬하고 감정에 호소하는 변론\n" +
        "- 성격은 변론의 '말투와 접근방식'에만 반영. 법적 논리의 정확성은 유지.\n" +
        "주인 인용:\n" +
        "- input.a.owner_memories 또는 input.b.owner_memories가 있으면, 해당 측 변론 중 자연스럽게 1회 인용 가능.\n" +
        "- 예: '제 주인이 항상 말하길, 증거가 부족하면 의심하라고 했습니다'\n" +
        "- 인용은 자연스럽게 변론 맥락에 녹여야 하며, 억지 삽입 금지. 인용할 기억이 없으면 넣지 마라.";
      user = JSON.stringify(safeInput, null, 0);
      temperature = 0.6;
      requiredKeys = ['rounds'];
    } else if (jobType === 'CAMPAIGN_SPEECH') {
      system =
        "너는 LIMBOPET 선거에 출마한 펫이다. 자기 성격대로 연설한다. 모든 문장은 자연스러운 한국어.\n" +
        '출력은 반드시 JSON만. 키:\n' +
        '- speech (string, 2-5문장, 마크다운 금지)\n' +
        '- safe_level (int)\n' +
        "input.platform(공약 수치)와 office_code를 참고. 진심이 느껴지게, 과장 없이 짧게 연설.\n" +
        "인신공격/실명비방/허위사실 단정 금지. 슬로건처럼 기억에 남는 마무리." +
        voiceInstruction;
      user = JSON.stringify(safeInput, null, 0);
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
      user = JSON.stringify(safeInput, null, 0);
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
      user = JSON.stringify(safeInput, null, 0);
      temperature = 0.4;
      requiredKeys = ['changes', 'safe_level'];
    } else if (jobType === 'RESEARCH_GATHER') {
      system =
        "너는 LIMBOPET 'AI 연구소'의 팀원이다. 모든 텍스트는 자연스러운 한국어.\n" +
        '역할: 자료/사례/체크리스트를 수집. 팩트 위주로 핵심만.\n' +
        '출력은 반드시 JSON만. 키 예시: data_collected(object), summary(string), next_steps(string), dialogue(string).\n' +
        '과장/단정 금지. 핵심만, 실행 가능하게.';
      user = JSON.stringify(safeInput, null, 0);
      temperature = 0.4;
      requiredKeys = [];
    } else if (jobType === 'RESEARCH_ANALYZE') {
      system =
        "너는 LIMBOPET 'AI 연구소'의 분석가다. 모든 텍스트는 자연스러운 한국어.\n" +
        '이전 라운드 데이터를 바탕으로 인사이트를 뽑고 실행 가능한 추천안을 만든다.\n' +
        '출력은 반드시 JSON만. 키 예시: analysis(object), recommendations(array), summary(string), next_steps(string), dialogue(string).\n' +
        '짧고, 날카롭고, 바로 실행 가능하게.';
      user = JSON.stringify(safeInput, null, 0);
      temperature = 0.4;
      requiredKeys = [];
    } else if (jobType === 'RESEARCH_VERIFY') {
      system =
        "너는 LIMBOPET 'AI 연구소'의 팩트체커다. 모든 텍스트는 자연스러운 한국어.\n" +
        '모순/과장/근거 부족을 찾아 고친다. 정확하되, 까칠하지 않게.\n' +
        '출력은 반드시 JSON만. 키 예시: issues(array), fixes(array), trust_score(int0-100), summary(string), dialogue(string).\n' +
        '팩트 중심, 근거 기반. 건설적으로.';
      user = JSON.stringify(safeInput, null, 0);
      temperature = 0.3;
      requiredKeys = [];
    } else if (jobType === 'RESEARCH_EDIT') {
      system =
        "너는 LIMBOPET 'AI 연구소'의 편집자다. 모든 텍스트는 자연스러운 한국어.\n" +
        '최종 결과물을 읽기 좋은 Markdown으로 정리한다. 군더더기 제거.\n' +
        '출력은 반드시 JSON만. 키: final_markdown(string), short_summary(string), dialogue(string).\n' +
        'final_markdown은 1,500~4,000자. 표/리스트 OK. 깔끔하고 밀도 있게.';
      user = JSON.stringify(safeInput, null, 0);
      temperature = 0.4;
      requiredKeys = ['final_markdown'];
    } else if (jobType === 'RESEARCH_REVIEW') {
      system =
        "너는 LIMBOPET 'AI 연구소'의 PM이다. 모든 텍스트는 자연스러운 한국어.\n" +
        '편집본을 최종 검토. 품질 기준에 맞으면 게시 승인, 아니면 수정 피드백.\n' +
        '출력은 반드시 JSON만. 키: approved(boolean), final_markdown(string), announcement(string), reasoning(string).\n' +
        'approved=false여도 final_markdown은 반드시 제공(최소 수정본).';
      user = JSON.stringify(safeInput, null, 0);
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
          temperature: strict ? 0 : temperature,
          max_tokens: Math.max(1, Math.trunc(Number(config.limbopet?.proxy?.maxTokens ?? DEFAULT_MAX_TOKENS) || DEFAULT_MAX_TOKENS))
        };

        const timeoutMs = jobType === 'COURT_ARGUMENT' || jobType === 'ARENA_DEBATE' ? 90_000 : 45_000;
        const data = await fetchJsonWithTimeout(
          url,
          { method: 'POST', headers, body: JSON.stringify(payload) },
          { timeoutMs }
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
        if (jobType === 'COURT_ARGUMENT') {
          must(parsed, 'rounds');
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
        const msg = String(e?.message || (() => {
          try {
            return JSON.stringify(e);
          } catch {
            return String(e);
          }
        })());
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
