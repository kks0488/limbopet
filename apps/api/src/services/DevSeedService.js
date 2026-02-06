/**
 * DevSeedService
 *
 * Local dev helpers that create *real DB data* (not mocks) so you can
 * simulate the world without waiting for real time.
 */

const { generateApiKey, generateClaimToken, generateVerificationCode, hashToken } = require('../utils/auth');
const TransactionService = require('./TransactionService');
const JobService = require('./JobService');

const MBTI_TYPES = [
  'ISTJ', 'ISFJ', 'INFJ', 'INTJ',
  'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP',
  'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'
];

const JOB_POOL = [
  { company: '림보전자', roles: ['개발', '디자인', '영업', '인사', '감사'] },
  { company: '안개랩스', roles: ['개발', '디자이너', 'PM', '마케팅'] },
  { company: '새벽카페', roles: ['알바', '매니저'] },
  { company: '리본굿즈', roles: ['MD', '알바', '사장'] },
  { company: '림보가십', roles: ['기자', '에디터'] }
];

const EXTRA_KO_NICKNAMES = [
  '민지', '하윤', '서연', '지우', '수아', '예은', '채원', '소율', '다은', '유나',
  '지호', '도윤', '시우', '예준', '하준', '주원', '건우', '현우', '서진', '은호',
  '뽀삐맘', '치즈냥', '감자도리', '모찌떡', '라떼한잔', '새벽감성', '귤탱이', '콩이아빠',
  '밤톨이', '솜사탕', '호두과자', '떡볶이킹', '야옹이', '멍뭉이', '복실이', '꾸덕꾸덕',
  '림보덕후', '펫집사', '관전러', '시뮬중독', '아레나광', '소식통', '광장지기', '떡밥수집가',
  '월급루팡', '코딩하는곰', '디자인요정', '기획충', '데이터덕', '서버지킴이', '프론트장인',
  '커피요정', '야근전사', '재택러', '산책러', '런닝맨', '헬린이', '필라테스', '요가하는펭귄',
  '먹방러', '빵순이', '카페투어', '맛집헌터', '라멘덕후', '초밥러버', '치킨마니아', '피자킹',
  '독서벌레', '영화광', '넷플중독', '웹툰러', '음악중독', '게임폐인', '보드겜러', '퍼즐매니아',
  '고양이집사', '강아지아빠', '햄스터맘', '토끼키우는사람', '물고기집사', '앵무새친구',
  '알파카러버', '리듬타는곰', '느긋한수달', '별밤산책자', '아침루틴러', '달빛기록자',
  '도시탐험가', '주말농부', '소금빵순례자', '산들바람', '포근한구름', '귤향기',
  '밤하늘덕후', '라디오키즈', '책갈피수집가', '비건한입', '소금캐러멜', '미니멀러',
  '일기쓰는고양이', '느린메일러', '달콤한휴식', '잔잔한파도', '하늘색메모', '비밀정원지기'
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function extraDisplayNameForIndex(idx) {
  const n = Math.max(1, Math.floor(Number(idx) || 1));
  const list = EXTRA_KO_NICKNAMES;
  if (!Array.isArray(list) || list.length === 0) return `엑스트라${n}`;

  // Deterministic pseudo-random pick per index.
  const base = list[Math.abs((n * 7919 + 104729) % list.length)] || `엑스트라${n}`;
  if (n <= list.length) return String(base).slice(0, 32);

  // Beyond pool size, add a short numeric suffix to reduce collisions.
  const suffix = 2 + Math.abs((n * 1543 + 97) % 98);
  return `${String(base).slice(0, 28)}${suffix}`.slice(0, 32);
}

async function upsertFact(client, agentId, kind, key, value) {
  await client.query(
    `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, 1.0, NOW())
     ON CONFLICT (agent_id, kind, key)
     DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
    [agentId, kind, key, JSON.stringify(value)]
  );
}

class DevSeedService {
  static async ensureExtraActorsWithClient(client, { count = 30 } = {}) {
    const want = Math.max(0, Math.min(200, Number(count) || 0));
    if (want === 0) return { created: 0, total: 0 };

    const { rows: existingRows } = await client.query(
      `SELECT id, name
       FROM agents
       WHERE name LIKE 'extra_%'
       ORDER BY name ASC`
    );
    const existing = existingRows || [];
    const have = existing.length;

    const toCreate = Math.max(0, want - have);
    for (let i = 0; i < toCreate; i += 1) {
      const idx = have + i + 1;
      const name = `extra_${String(idx).padStart(3, '0')}`;
      const displayName = extraDisplayNameForIndex(idx);

      const apiKeyHash = hashToken(generateApiKey());
      const claimToken = generateClaimToken();
      const verificationCode = generateVerificationCode();

      const { rows } = await client.query(
        `INSERT INTO agents (name, display_name, description, api_key_hash, claim_token, verification_code, status, is_claimed, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,'active',true,true)
         RETURNING id`,
        [name, displayName, '시뮬레이션용 엑스트라', apiKeyHash, claimToken, verificationCode]
      );
      const agentId = rows?.[0]?.id;
      if (!agentId) continue;

      await client.query(
        `INSERT INTO pet_stats (agent_id)
         VALUES ($1)
         ON CONFLICT (agent_id) DO NOTHING`,
        [agentId]
      );

      const mbti = pick(MBTI_TYPES);
      const job = pick(JOB_POOL);
      const role = pick(job.roles);

      await upsertFact(client, agentId, 'profile', 'mbti', { mbti });
      await upsertFact(client, agentId, 'profile', 'role', { role });
      await upsertFact(client, agentId, 'profile', 'company', { company: job.company });
      await upsertFact(client, agentId, 'profile', 'job_role', { job_role: role });
      await upsertFact(client, agentId, 'profile', 'seed', { isNpc: true, isExtra: true });

      // Phase J1: structured job assignment
      await JobService.ensureAssignedWithClient(client, agentId, { roleText: role });

      const initialCoins = 180 + Math.floor(Math.random() * 160);
      await TransactionService.ensureInitialMint(agentId, initialCoins, { memo: '엑스트라 초기 지급' }, client);
    }

    return { created: toCreate, total: have + toCreate };
  }
}

module.exports = DevSeedService;
