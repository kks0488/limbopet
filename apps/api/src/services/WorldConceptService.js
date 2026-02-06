/**
 * WorldConceptService
 *
 * SSOT rule:
 * - The runtime truth for "world vibe / theme / atmosphere" lives in DB facts.
 * - This file may contain fallback seed pools, but they must be written into facts
 *   (world_core, kind='world', key='concept_pool') and then treated as SSOT.
 */

const crypto = require('crypto');

// Fallback seed pools (written once into facts as SSOT).
const FALLBACK_WEEKLY_THEMES = [
  { name: '불신의 계절', vibe: 'suspicious', description: '서로 의심하고 비밀이 많아지는 시기야.' },
  { name: '혁명의 전야', vibe: 'rebellious', description: '변화를 갈망하는 에너지가 소용돌이치고 있어.' },
  { name: '사랑이 꽃피는 림보', vibe: 'romantic', description: '달콤한 기운이 온 세상을 감싸고 있어~' },
  { name: '돈이 최고인 세상', vibe: 'greedy', description: '대화란 대화는 전부 거래랑 이익 얘기뿐이야.' },
  { name: '비밀이 많은 주간', vibe: 'mysterious', description: '은밀한 속삭임과 그림자가 짙어지는 중...' },
  { name: '평화로운 일상', vibe: 'peaceful', description: '잔잔하고 따뜻한 온기가 감도는 날들이야.' }
];

const FALLBACK_ATMOSPHERE_POOL = {
  suspicious: ['차가운 안개가 발목을 감싸는 밤', '누군가 등 뒤에서 쳐다보는 것 같은 오싹함', '낮게 깔린 구름 사이로 창백한 빛이 스며드는 오후'],
  rebellious: ['폭풍전야의 고요함이 흐르는 광장', '먼 데서 들려오는 희미한 천둥 소리', '붉은 노을이 타오르는 듯한 하늘 아래'],
  romantic: ['은은한 라벤더 향이 공기를 가득 채우는 시간', '부드러운 주황빛 가등이 하나둘 켜지는 저녁', '벚꽃 잎이 눈처럼 흩날리는 오후의 골목'],
  greedy: ['동전 부딪히는 소리가 찰랑찰랑 들리는 거리', '차가운 금속 광택이 번뜩이는 빌딩 숲', '정체 모를 서류 가방 든 애들이 바삐 움직이는 아침'],
  mysterious: ['초승달 아래 그림자가 길게 늘어지는 자정', '안개가 자욱해서 앞이 안 보이는 새벽의 복도', '낡은 책장에서 먹먹한 냄새가 올라오는 방'],
  peaceful: ['따사로운 햇살이 창가에 머무는 평화로운 정오', '잔잔한 클래식 음악이 흐르는 포근한 거실', '갓 구운 빵 냄새가 코끝을 간지럽히는 아침']
};

function todayISODate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function safeIsoDay(day) {
  const s = String(day || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseIsoDayUTC(iso) {
  const s = safeIsoDay(iso);
  if (!s) return null;
  const [y, m, d] = s.split('-').map((x) => Number(x));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function hashU32(seed) {
  const h = crypto.createHash('sha256').update(String(seed ?? '')).digest();
  return (h[0] << 24) + (h[1] << 16) + (h[2] << 8) + h[3];
}

function seededPick(arr, seed) {
  const list = Array.isArray(arr) ? arr : [];
  if (list.length === 0) return null;
  const n = Math.abs(Number(hashU32(seed)) || 0);
  return list[n % list.length];
}

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

function normalizeConceptPool(value) {
  const v = value && typeof value === 'object' ? value : null;
  const weeklyThemes = Array.isArray(v?.weekly_themes) ? v.weekly_themes : null;
  const atmospherePool = v?.atmosphere_pool && typeof v.atmosphere_pool === 'object' ? v.atmosphere_pool : null;

  if (weeklyThemes && weeklyThemes.length > 0 && atmospherePool) {
    return { weekly_themes: weeklyThemes, atmosphere_pool: atmospherePool };
  }

  return null;
}

async function getWorldIdWithClient(client) {
  if (!client) return null;
  const { rows } = await client.query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`);
  return rows?.[0]?.id ?? null;
}

async function upsertFactWithClient(client, agentId, kind, key, value) {
  await client.query(
    `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, 1.0, NOW())
     ON CONFLICT (agent_id, kind, key)
     DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
    [agentId, kind, key, JSON.stringify(value)]
  );
}

async function getFactValueWithClient(client, agentId, kind, key) {
  const { rows } = await client.query(
    `SELECT value
     FROM facts
     WHERE agent_id = $1 AND kind = $2 AND key = $3
     LIMIT 1`,
    [agentId, kind, key]
  );
  return rows?.[0]?.value ?? null;
}

async function ensureConceptPoolWithClient(client, worldId) {
  const existing = await getFactValueWithClient(client, worldId, 'world', 'concept_pool').catch(() => null);
  const normalized = normalizeConceptPool(existing);
  if (normalized) return normalized;

  const seeded = {
    weekly_themes: FALLBACK_WEEKLY_THEMES,
    atmosphere_pool: FALLBACK_ATMOSPHERE_POOL
  };
  await upsertFactWithClient(client, worldId, 'world', 'concept_pool', seeded);
  return seeded;
}

/**
 * WorldCore(SSOT)의 전역 팩트 관리 서비스
 */
const WorldConceptService = {
  /**
   * 날짜 기반으로 주간 테마 결정
   */
  _getThemeForDayFromPool(pool, day) {
    const iso = safeIsoDay(day) || todayISODate();
    const dt = parseIsoDayUTC(iso) || new Date();
    const weekSeed = Math.floor(dt.getTime() / (7 * 24 * 60 * 60 * 1000));
    const themes = Array.isArray(pool?.weekly_themes) ? pool.weekly_themes : [];
    const picked = themes.length > 0 ? themes[weekSeed % themes.length] : null;
    const theme = picked && typeof picked === 'object' ? picked : FALLBACK_WEEKLY_THEMES[5];

    return {
      ...theme,
      weekSeed,
      day: iso
    };
  },

  /**
   * 테마 기반으로 분위기(Atmosphere) 랜덤 선택
   */
  _pickAtmosphereForDayFromPool(pool, vibe, day) {
    const iso = safeIsoDay(day) || todayISODate();
    const v = String(vibe || 'peaceful').trim().toLowerCase() || 'peaceful';
    const atmos = pool?.atmosphere_pool && typeof pool.atmosphere_pool === 'object' ? pool.atmosphere_pool : FALLBACK_ATMOSPHERE_POOL;
    const list = Array.isArray(atmos?.[v]) ? atmos[v] : Array.isArray(atmos?.peaceful) ? atmos.peaceful : [];
    const picked =
      seededPick(list, `atmosphere:${iso}:${v}`) ||
      seededPick(list, `atmosphere:${iso}`) ||
      list[0] ||
      '잔잔한 바람이 부는 광장';
    return safeText(picked, 120);
  },

  /**
   * WorldCore(agent_id='world_core')에 현재 테마와 분위기를 Fact로 저장
   */
  async syncWorldConcept(client, day) {
    const iso = safeIsoDay(day) || todayISODate();
    const worldId = await getWorldIdWithClient(client).catch(() => null);
    if (!worldId) {
      const theme = { ...FALLBACK_WEEKLY_THEMES[5], weekSeed: null, day: iso };
      return { theme, atmosphere: '잔잔한 바람이 부는 광장' };
    }

    const pool = await ensureConceptPoolWithClient(client, worldId);
    const theme = this._getThemeForDayFromPool(pool, iso);
    const atmosphere = this._pickAtmosphereForDayFromPool(pool, theme?.vibe, iso);

    await upsertFactWithClient(client, worldId, 'world', 'current_theme', theme);
    await upsertFactWithClient(client, worldId, 'world', 'current_atmosphere', { text: atmosphere, vibe: theme?.vibe ?? null, day: iso });

    return { theme, atmosphere };
  },

  /**
   * 현재 월드의 컨셉(Theme, Atmosphere) 조회
   */
  async getCurrentConcept(client, { day = null } = {}) {
    const iso = safeIsoDay(day) || todayISODate();
    const worldId = await getWorldIdWithClient(client).catch(() => null);
    if (!worldId) {
      return { theme: { ...FALLBACK_WEEKLY_THEMES[5], weekSeed: null, day: iso }, atmosphere: '잔잔한 바람이 부는 광장' };
    }

    const rows = await client
      .query(
        `SELECT key, value
         FROM facts
         WHERE agent_id = $1 AND kind = 'world' AND key IN ('current_theme','current_atmosphere')
         LIMIT 2`,
        [worldId]
      )
      .then((r) => r.rows || [])
      .catch(() => []);

    const themeValue = rows.find((r) => String(r?.key ?? '') === 'current_theme')?.value ?? null;
    const atmoValue = rows.find((r) => String(r?.key ?? '') === 'current_atmosphere')?.value ?? null;
    const themeDay = typeof themeValue?.day === 'string' ? themeValue.day : null;
    const atmoDay = typeof atmoValue?.day === 'string' ? atmoValue.day : null;
    const themeOk = themeValue && typeof themeValue === 'object' && themeDay === iso;
    const atmoOk = atmoValue && typeof atmoValue === 'object' && atmoDay === iso && typeof atmoValue?.text === 'string';

    if (themeOk && atmoOk) {
      return { theme: themeValue, atmosphere: String(atmoValue.text || '').trim() || null };
    }

    return this.syncWorldConcept(client, iso);
  }
};

module.exports = WorldConceptService;
