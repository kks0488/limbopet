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
  suspicious: [
    '창문마다 커튼이 반쯤 내려와 시선이 서로를 피한다',
    '속삭임이 멎는 순간마다 누군가 이름을 지운다',
    '밝은 대낮인데도 골목 끝 그림자가 먼저 움직인다',
    '인사 뒤에 짧은 침묵이 길게 매달린다',
    '문이 닫힐 때마다 자물쇠 소리가 유난히 크게 튄다',
    '웃음은 가볍지만 눈빛은 끝까지 경계한다',
    '발자국 소리가 하나 더 들리는 듯한 저녁',
    '회의록보다 찢긴 메모가 더 빨리 돈다',
    '거울에 비친 표정이 본심보다 차갑다',
    '커피 향 사이로 비밀스런 질문이 떠다닌다',
    '낯선 알림음 하나가 공기 전체를 얼린다',
    '아무도 확인하지 않은 소문이 사실처럼 걷는다',
    '복도 끝 형광등이 깜빡일 때마다 심장이 먼저 반응한다',
    '악수는 단단하지만 손끝의 온기는 남지 않는다',
    '밤공기보다 의심이 더 무겁게 어깨에 내려앉는다'
  ],
  rebellious: [
    '낡은 규칙표 위로 붉은 낙서가 겹겹이 쌓인다',
    '정숙하던 광장에 구호 같은 웃음이 터진다',
    '참아온 분노가 박수 소리처럼 퍼져나간다',
    '금지선 앞에서 모두가 한 걸음 더 다가선다',
    '고개 숙이던 시선들이 동시에 정면을 본다',
    '문서보다 목소리가 먼저 질서를 바꾼다',
    '차가운 바람 속에서도 발걸음은 더 빨라진다',
    '누군가 던진 반문 하나가 밤을 흔든다',
    '순응하던 손끝이 주먹으로 모여든다',
    '노을빛이 번질수록 말투가 더 직설적으로 날선다',
    '침묵을 강요하던 공기가 오늘은 먼저 금이 간다',
    '억눌린 숨이 한꺼번에 터져 거리의 리듬이 바뀐다',
    '작은 불씨 같은 눈빛이 여기저기서 번진다',
    '미뤄둔 결심들이 발소리로 현실이 된다',
    '끝내 외면하던 질문이 중앙에 올라선다'
  ],
  romantic: [
    '따뜻한 조명이 서로의 표정을 한 톤 부드럽게 만든다',
    '말끝마다 작은 미소가 꽃잎처럼 내려앉는다',
    '저녁 바람이 어깨를 스치며 마음의 온도를 올린다',
    '익숙한 거리도 오늘은 유난히 느리게 반짝인다',
    '머뭇대는 손짓 하나가 대화보다 많은 걸 전한다',
    '커피 잔 위 김이 둘 사이 거리를 포근히 메운다',
    '창가에 맺힌 빛이 설렘처럼 잔잔히 흔들린다',
    '가벼운 농담 뒤에 숨은 진심이 조용히 드러난다',
    '발걸음을 맞추는 순간 공기가 달콤해진다',
    '작은 우산 아래서 세상이 잠깐 조용해진다',
    '눈이 마주칠 때마다 시간이 반 박자 늦어진다',
    '스쳐 지나간 향기가 오래 남아 밤을 데운다',
    '별빛보다 가까운 체온이 마음을 안심시킨다',
    '한마디 안부가 하루의 결말을 따뜻하게 바꾼다',
    '서툰 고백 같은 침묵이 거리를 부드럽게 감싼다'
  ],
  greedy: [
    '숫자가 적힌 화면이 사람들의 눈빛을 먼저 바꾼다',
    '가벼운 인사 뒤에도 계산기가 조용히 돌아간다',
    '이익률 한 줄이 우정의 온도를 가른다',
    '빛나는 간판 아래서 가격 흥정이 숨처럼 오간다',
    '지갑이 열리는 소리마다 표정이 재빨리 달라진다',
    '기회라는 단어가 오늘은 거의 신호탄처럼 들린다',
    '웃음 속에서도 손익분기점이 먼저 언급된다',
    '모두가 빠르게 계약서의 작은 글씨를 훑는다',
    '늦은 밤에도 거래 알림이 불을 끄지 못하게 한다',
    '승자처럼 보이기 위한 과감한 베팅이 이어진다',
    '금속성 조명 아래 욕심이 반짝이며 증폭된다',
    '상대의 망설임이 곧 내 기회라는 공기가 돈다',
    '단골보다 조건이 우선인 냉랭한 친절이 흐른다',
    '동전 냄새가 진하게 밴 오후, 대화는 더 짧아진다',
    '더 많이 가지려는 마음이 거리의 속도를 끌어올린다'
  ],
  mysterious: [
    '안개가 얇게 깔린 복도 끝에서 발소리만 분리된다',
    '반쯤 열린 문틈으로 낯선 빛이 조용히 새어 나온다',
    '모서리마다 오래된 비밀이 먼지처럼 내려앉아 있다',
    '시계는 같은데 시간감각이 자꾸 어긋나는 밤',
    '이름 없는 쪽지가 바람보다 먼저 손에 닿는다',
    '달빛이 닿지 않는 구석에서 이야기의 결이 달라진다',
    '낡은 계단이 누군가의 귀환을 암시하듯 울린다',
    '사소한 우연들이 하나의 패턴처럼 이어진다',
    '불 꺼진 창문 뒤에서 시선 같은 기척이 스친다',
    '분명 들었는데 기록에는 없는 문장이 남는다',
    '젖은 돌바닥 위로 그림자가 한 박자 늦게 따른다',
    '어제의 소문이 오늘은 단서처럼 반짝인다',
    '정적 속에서 종이 넘기는 소리만 선명해진다',
    '새벽 공기 속 금속 냄새가 오래된 문을 떠올리게 한다',
    '끝을 알 수 없는 복도처럼 질문이 계속 이어진다'
  ],
  peaceful: [
    '햇살이 천천히 번지며 하루의 모서리를 둥글게 만든다',
    '잔잔한 음악과 함께 말투가 자연스럽게 부드러워진다',
    '따뜻한 찻김이 마음의 속도를 한 단계 늦춘다',
    '바람이 나뭇잎을 고르게 흔들며 긴장을 풀어준다',
    '사소한 안부 인사가 오늘의 중심이 되는 오후',
    '구름 그림자가 느리게 지나가며 공간을 정돈한다',
    '창문을 여는 소리마저 평온하게 들리는 아침',
    '익숙한 웃음들이 방 안 온도를 일정하게 유지한다',
    '분주함이 멈춘 자리에서 편안한 숨이 이어진다',
    '따끈한 빵 냄새가 골목 끝까지 포근하게 번진다',
    '서두르지 않는 발걸음이 하루를 안정적으로 이끈다',
    '낮은 대화가 파도처럼 부드럽게 겹쳐진다',
    '해질녘 하늘이 느리게 물들며 마음을 가라앉힌다',
    '서로의 침묵도 어색하지 않은 고요가 머문다',
    '평범한 풍경이 오늘은 특별히 다정해 보인다'
  ]
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
