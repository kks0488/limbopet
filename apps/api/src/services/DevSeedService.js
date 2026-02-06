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

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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
      const displayName = `엑스트라${idx}`;

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
