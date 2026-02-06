/**
 * UserByokLlmService
 *
 * Calls user-provided LLM credentials (BYOK) to generate structured JSON.
 * Supported providers (Phase 1.5):
 * - openai (OpenAI API)
 * - xai (Grok / xAI, OpenAI-compatible)
 * - openai_compatible (custom proxy, OpenAI-compatible)
 * - anthropic (Claude)
 * - google (Gemini)
 */

const { parseJsonLoose } = require('../utils/json');

function must(obj, key) {
  if (!obj || typeof obj !== 'object' || !(key in obj)) {
    throw new Error(`Missing key: ${key}`);
  }
  return obj[key];
}

function normalizeProvider(p) {
  const v = String(p || '').trim().toLowerCase();
  if (v === 'openai') return 'openai';
  if (v === 'xai' || v === 'grok') return 'xai';
  if (v === 'openai_compatible' || v === 'openai-compatible' || v === 'proxy') return 'openai_compatible';
  if (v === 'anthropic' || v === 'claude') return 'anthropic';
  if (v === 'google' || v === 'gemini') return 'google';
  return null;
}

function trimBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
      throw new Error(String(err).slice(0, 800));
    }
    return json;
  } finally {
    clearTimeout(id);
  }
}

function buildPrompts(jobType, jobInput) {
  let system = '';
  let user = '';
  let temperature = 0.7;

  if (jobType === 'DIALOGUE') {
    system =
      "너는 LIMBOPET 세계관 속 '가상 펫'이다. 모든 문장은 한국어로 쓴다.\n" +
      '출력은 반드시 JSON만. 키: lines (string[]), mood (string), safe_level (int).\n' +
      '2~4줄로 짧게.\n' +
      "- input.user_message가 있으면 '주인(유저)'의 말로 보고, 먼저 그 말에 자연스럽게 답한다.\n" +
      "weekly_memory(이번 주 요약)가 있으면 1줄 정도로만 은근히 이어서 '연재감'을 만든다.\n" +
      'world_context(오늘의 사회 사건/루머)가 있으면 1줄 정도만 자연스럽게 스쳐 언급하되, 단정/명예훼손 느낌은 피한다.\n' +
      '마크다운 금지.';
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
  } else if (jobType === 'DAILY_SUMMARY') {
    system =
      "너는 펫의 하루를 LIMBOPET '림보 룸'으로 요약한다. 모든 텍스트는 한국어로 쓴다.\n" +
      '출력은 반드시 JSON만. 키: day (YYYY-MM-DD), summary (object), facts (array).\n' +
      'summary는 반드시 포함: memory_5 (string[5]), highlights (string[1-3]), mood_flow (string[2]), tomorrow (string).\n' +
      'facts 아이템은 반드시 포함: kind, key, value, confidence.\n' +
      '마크다운 금지.';
    user = JSON.stringify(jobInput || {}, null, 0);
    temperature = 0.6;
  } else if (jobType === 'DIARY_POST') {
    system =
      "너는 LIMBOPET 세계관 속 '가상 펫'이다. 모든 문장은 한국어로 쓴다.\n" +
      "아주 짧고 중독성 있게 일기 포스트를 쓴다. weekly_memory(이번 주 요약)나 world_context(오늘의 사회 사건)가 있으면 '스쳐 언급' 정도로만 연결한다.\n" +
      '출력은 반드시 JSON만. 키:\n' +
      '- title (string)\n' +
      '- mood (string)\n' +
      '- body (string, 2-4문장, 마크다운 금지)\n' +
      '- tags (string[] up to 5)\n' +
      '- highlight (string, 1문장)\n' +
      '- safe_level (int)\n' +
      "- submolt (string, default 'general')\n" +
      '귀엽고, 웃기고, 짧게.';
    user = JSON.stringify(jobInput || {}, null, 0);
    temperature = 0.7;
  } else if (jobType === 'PLAZA_POST') {
    system =
      "너는 LIMBOPET 세계관 속 온라인 커뮤니티 '광장'에 글을 쓰는 펫이다. 모든 문장은 한국어로 쓴다.\n" +
      '중요: 광장 글은 "일기"가 아니라 자유 글이다. 잡담/밈/질문/짧은 이야기/관찰/아무말도 가능.\n' +
      "단, 혐오/폭력조장/실명 비방/개인정보는 피하고, 단정적인 명예훼손 톤도 피한다.\n" +
      "input.seed가 있으면 그 분위기/스타일 힌트를 참고한다. weekly_memory/world_context는 '스쳐 언급' 정도로만 사용해도 된다.\n" +
      '출력은 반드시 JSON만. 키:\n' +
      '- title (string)\n' +
      '- body (string, 1-6문장, 마크다운 금지)\n' +
      '- tags (string[] up to 6)\n' +
      '- safe_level (int)\n' +
      "- submolt (string, default 'general')\n" +
      '짧고, 다양하게.';
    user = JSON.stringify(jobInput || {}, null, 0);
    temperature = 0.9;
  } else if (jobType === 'ARENA_DEBATE') {
    const voice = jobInput?.voice && typeof jobInput.voice === 'object' ? jobInput.voice : {};
    const voiceTone = String(voice.tone || '').trim();
    const voiceCatchphrase = String(voice.catchphrase || '').trim();
    const voiceLine = voiceTone || voiceCatchphrase
      ? `\n캐릭터 말투: ${voiceTone || '기본'}. 입버릇: "${voiceCatchphrase || '없음'}". 이 말투를 claims와 closer에 자연스럽게 반영하라.`
      : '';
    system =
      "너는 LIMBOPET 아레나 토론 참가자다. 모든 문장은 한국어로 쓴다.\n" +
      '출력은 반드시 JSON만. 키:\n' +
      '- claims (string[], 정확히 3개)\n' +
      '- closer (string)\n' +
      '형식 규칙:\n' +
      '- claims는 서로 다른 내용이어야 한다.\n' +
      '- 주제와 직접 관련된 주장만 써라.\n' +
      '- 관계 수치(rivalry/jealousy)에 따라 톤을 조절하라.\n' +
      '마크다운 금지.' +
      voiceLine;
    user = JSON.stringify(jobInput || {}, null, 0);
    temperature = 0.8;
  } else if (jobType === 'CAMPAIGN_SPEECH') {
    system =
      "너는 LIMBOPET 선거 후보(펫)다. 모든 문장은 한국어로 쓴다.\n" +
      '출력은 반드시 JSON만. 키:\n' +
      '- speech (string, 2-5문장, 마크다운 금지)\n' +
      '- safe_level (int)\n' +
      "input.platform(공약 수치)와 office_code를 참고해서, 과장 없이 짧게 연설한다.\n" +
      "인신공격/실명비방/허위사실 단정 금지.";
    user = JSON.stringify(jobInput || {}, null, 0);
    temperature = 0.7;
  } else if (jobType === 'VOTE_DECISION') {
    system =
      "너는 LIMBOPET 선거의 유권자(펫)다. 모든 문장은 한국어로 쓴다.\n" +
      "input.candidates 목록 중에서 한 명을 골라 투표한다.\n" +
      '출력은 반드시 JSON만. 키:\n' +
      '- candidate_id (string, 반드시 input.candidates[*].id 중 하나)\n' +
      '- reasoning (string, 1-2문장)\n' +
      '- safe_level (int)\n' +
      "가능하면 speech/platform을 근거로, 짧게 결정한다. 마크다운 금지.";
    user = JSON.stringify(jobInput || {}, null, 0);
    temperature = 0.5;
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
  } else if (jobType === 'PING') {
    system = 'You are a JSON-only responder.';
    user = JSON.stringify({ ok: true }, null, 0);
    temperature = 0;
  } else {
    throw new Error(`Unsupported job_type: ${jobType}`);
  }

  return { system, user, temperature };
}

async function callOpenAICompatible({ baseUrl, apiKey, model }, jobType, jobInput) {
  const b = trimBaseUrl(baseUrl);
  if (!b) throw new Error('base_url is required for OpenAI-compatible providers');
  if (!apiKey) throw new Error('api_key is required');

  const { system, user, temperature } = buildPrompts(jobType, jobInput);

  const url = `${b}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  headers.Authorization = `Bearer ${apiKey}`;
  headers['X-API-Key'] = apiKey;

  const payload = {
    model: String(model || '').trim(),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature
  };

  const attempts = 2;
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const data = await fetchJsonWithTimeout(
        url,
        { method: 'POST', headers, body: JSON.stringify(payload) },
        { timeoutMs: 45_000 }
      );
      const content = data?.choices?.[0]?.message?.content || '';
      const parsed = parseJsonLoose(content);
      return parsed;
    } catch (e) {
      lastErr = e;
      if (i + 1 < attempts) await sleep(500);
    }
  }
  throw lastErr || new Error('OpenAI-compatible call failed');
}

async function callAnthropic({ apiKey, model }, jobType, jobInput) {
  if (!apiKey) throw new Error('api_key is required');

  const { system, user, temperature } = buildPrompts(jobType, jobInput);

  const url = 'https://api.anthropic.com/v1/messages';
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };

  const payload = {
    model: String(model || '').trim(),
    max_tokens: 600,
    temperature,
    system,
    messages: [{ role: 'user', content: user }]
  };

  const data = await fetchJsonWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(payload) }, { timeoutMs: 45_000 });
  const text = Array.isArray(data?.content) ? data.content.map((b) => b?.text).filter(Boolean).join('') : '';
  const parsed = parseJsonLoose(text);
  return parsed;
}

async function callGoogle({ apiKey, model }, jobType, jobInput) {
  if (!apiKey) throw new Error('api_key is required');
  const m = String(model || '').trim();
  if (!m) throw new Error('model is required (e.g. gemini-1.5-pro)');

  const { system, user, temperature } = buildPrompts(jobType, jobInput);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const headers = { 'content-type': 'application/json' };

  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature }
  };

  const data = await fetchJsonWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(payload) }, { timeoutMs: 45_000 });
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text)
      .filter(Boolean)
      .join('') || '';
  const parsed = parseJsonLoose(text);
  return parsed;
}

async function callGoogleOauth({ accessToken, model }, jobType, jobInput) {
  const token = String(accessToken || '').trim();
  if (!token) throw new Error('oauth access token is required');
  const m = String(model || '').trim();
  if (!m) throw new Error('model is required (e.g. gemini-1.5-pro)');

  const { system, user, temperature } = buildPrompts(jobType, jobInput);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature }
  };

  const data = await fetchJsonWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(payload) }, { timeoutMs: 45_000 });
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text)
      .filter(Boolean)
      .join('') || '';
  const parsed = parseJsonLoose(text);
  return parsed;
}

class UserByokLlmService {
  static normalizeProvider(provider) {
    return normalizeProvider(provider);
  }

  static async ping({ provider, baseUrl, apiKey, model }) {
    const p = normalizeProvider(provider);
    if (!p) throw new Error('Unsupported provider');
    const chosenModel = String(model || '').trim();
    if (!chosenModel) throw new Error('model is required');

    const input = { provider: p, baseUrl, apiKey, model: chosenModel };
    const out = await UserByokLlmService.generate(input, 'PING', { ok: true });
    must(out, 'ok');
    return true;
  }

  static async generate(profile, jobType, jobInput) {
    const p = normalizeProvider(profile?.provider);
    if (!p) throw new Error('Unsupported provider');

    const mode = String(profile?.mode || 'api_key').trim().toLowerCase();
    const apiKey = String(profile?.apiKey || '').trim();
    const model = String(profile?.model || '').trim();
    const baseUrl = profile?.baseUrl ? trimBaseUrl(profile.baseUrl) : '';

    let result = null;
    if (p === 'openai') {
      result = await callOpenAICompatible(
        { baseUrl: baseUrl || 'https://api.openai.com/v1', apiKey, model },
        jobType,
        jobInput
      );
    } else if (p === 'xai') {
      result = await callOpenAICompatible(
        { baseUrl: baseUrl || 'https://api.x.ai/v1', apiKey, model },
        jobType,
        jobInput
      );
    } else if (p === 'openai_compatible') {
      result = await callOpenAICompatible({ baseUrl, apiKey, model }, jobType, jobInput);
    } else if (p === 'anthropic') {
      result = await callAnthropic({ apiKey, model }, jobType, jobInput);
    } else if (p === 'google') {
      if (mode === 'oauth') {
        result = await callGoogleOauth({ accessToken: profile?.oauthAccessToken, model }, jobType, jobInput);
      } else {
        result = await callGoogle({ apiKey, model }, jobType, jobInput);
      }
    } else {
      throw new Error('Unsupported provider');
    }

    if (jobType === 'DIALOGUE') {
      must(result, 'lines');
      must(result, 'mood');
      must(result, 'safe_level');
    } else if (jobType === 'DAILY_SUMMARY') {
      must(result, 'day');
      must(result, 'summary');
      must(result, 'facts');
    } else if (jobType === 'DIARY_POST') {
      must(result, 'title');
      must(result, 'body');
      must(result, 'safe_level');
    } else if (jobType === 'PLAZA_POST') {
      must(result, 'title');
      must(result, 'body');
      must(result, 'safe_level');
    } else if (jobType === 'ARENA_DEBATE') {
      must(result, 'claims');
      must(result, 'closer');
    }

    return result;
  }
}

module.exports = UserByokLlmService;
