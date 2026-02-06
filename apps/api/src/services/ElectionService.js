/**
 * ElectionService (idea 001)
 *
 * 목표:
 * - AI 사회의 "제도"를 추가해서 드라마/경제 실험을 만들기.
 * - UI는 최대한 숨기고(방송 카드에만 얹기), 시스템은 자동으로 굴러가게.
 *
 * MVP 범위:
 * - policy_params 기반 (일부만 실제로 사용)
 * - 14일 임기, 5일 선거 윈도우 (등록 1일 / 캠페인 3일 / 투표 1일)
 * - 투표/개표는 룰 기반(LLM 호출 없음) → 서버 비용 최소화
 */

const { transaction } = require('../config/database');
const { BadRequestError } = require('../utils/errors');
const { bestEffortInTransaction } = require('../utils/savepoint');
const PolicyService = require('./PolicyService');
const TransactionService = require('./TransactionService');
const NotificationService = require('./NotificationService');
const NudgeQueueService = require('./NudgeQueueService');
const ScandalService = require('./ScandalService');
const config = require('../config');

const TERM_DAYS = 14;
const REGISTRATION_BEFORE_TERM_START_DAYS = 5;
const CAMPAIGN_DAYS = 3;
const CANDIDATE_FEE_COINS = 10;
const MIN_KARMA_FOR_CANDIDATE = 50;
const MAX_VOTERS = 500;
const OFFICES = /** @type {const} */ (['mayor', 'tax_chief', 'chief_judge', 'council']);
const NPC_COLDSTART_MAX_USER_PETS = Math.max(0, Math.min(200, Number(config.limbopet?.npcColdStartMaxUserPets ?? 4) || 4));
const NPC_MAX_VOTERS_WHEN_USERS_EXIST = Math.max(10, Math.min(200, Number(config.limbopet?.npcElectionMaxVoters ?? 40) || 40));

function parseIsoDay(s) {
  const raw = String(s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('Invalid day');
  const [y, m, d] = raw.split('-').map((x) => Number(x));
  return new Date(Date.UTC(y, m - 1, d));
}

function formatIsoDayUTC(dt) {
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(day, n) {
  const dt = parseIsoDay(day);
  dt.setUTCDate(dt.getUTCDate() + Number(n || 0));
  return formatIsoDayUTC(dt);
}

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function randInt(min, max) {
  const lo = Math.floor(Number(min) || 0);
  const hi = Math.floor(Number(max) || 0);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function safeText(v, maxLen = 200) {
  return String(v ?? '').trim().slice(0, maxLen);
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '').trim());
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
    t = (t + Math.imul(t ^ (a >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function officeLabel(office) {
  if (office === 'mayor') return '시장';
  if (office === 'tax_chief') return '세무서장';
  if (office === 'chief_judge') return '수석판사';
  return '의원';
}

function campaignBiasOf(platform) {
  const p = platform && typeof platform === 'object' ? platform : {};
  return clampInt(p.campaign_bias ?? p.campaignBias ?? 0, -80, 80);
}

function withCampaignBias(platform, delta) {
  const p = platform && typeof platform === 'object' ? platform : {};
  const current = campaignBiasOf(p);
  const next = clampInt(current + Number(delta || 0), -80, 80);
  return { ...p, campaign_bias: next };
}

function mutatePlatformForCampaign(office, platform, rng) {
  const p = platform && typeof platform === 'object' ? { ...platform } : {};
  const rollSign = rng() < 0.5 ? -1 : 1;

  if (office === 'mayor') {
    p.initial_coins = clampInt((Number(p.initial_coins || 200) || 200) + rollSign * 20, 80, 500);
    p.company_founding_cost = clampInt((Number(p.company_founding_cost || 20) || 20) + (rollSign * -1) * 4, 1, 200);
    return p;
  }
  if (office === 'tax_chief') {
    p.transaction_tax_rate = Math.round(clamp((Number(p.transaction_tax_rate || 0.03) || 0.03) + rollSign * 0.01, 0, 0.2) * 1000) / 1000;
    p.burn_ratio = Math.round(clamp((Number(p.burn_ratio || 0.7) || 0.7) + rollSign * 0.05, 0, 1) * 1000) / 1000;
    return p;
  }
  if (office === 'chief_judge') {
    p.max_fine = clampInt((Number(p.max_fine || 100) || 100) + rollSign * 20, 10, 5000);
    if (rng() < 0.35) p.appeal_allowed = !Boolean(p.appeal_allowed);
    return p;
  }
  p.min_wage = clampInt((Number(p.min_wage || 3) || 3) + rollSign * 1, 0, 50);
  return p;
}

function loserReactionStyle({ mbti = '', voiceTone = '', seed }) {
  const m = String(mbti || '').trim().toUpperCase();
  const tone = safeText(voiceTone, 32).toLowerCase();
  const assertive = /강|공세|거침|공격|aggressive|chaotic/.test(tone) || /[ET]..[TP]/.test(m);
  const rng = mulberry32(hash32(seed || m || tone || 'LOSER_REACTION'));
  const pContest = assertive ? 0.55 : 0.3;
  return rng() < pContest ? 'contest' : 'concede';
}

function speechSeedForResult({ office, candidateName, result, style = 'concede' }) {
  const label = officeLabel(office);
  if (result === 'winner') {
    return `${candidateName}(${label}): \"드디어 이 자리에 섰다. 말로만 하는 시대는 끝났어. 오늘부터 결과로 보여주겠다.\"`;
  }
  if (style === 'contest') {
    return `${candidateName}(${label}): \"이 결과, 도저히 납득이 안 된다. 뭔가 석연치 않아. 끝까지 따져보겠다.\"`;
  }
  return `${candidateName}(${label}): \"졌다. 인정한다. 하지만 기억해둬... 난 반드시 돌아온다.\"`;
}

async function getWorldAgentIdWithClient(client) {
  return client
    .query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`)
    .then((r) => r.rows?.[0]?.id ?? null)
    .catch(() => null);
}

async function notifyAllUsersWithClient(client, { type, title, body, data = {} } = {}) {
  const { rows } = await client.query(
    `SELECT id
     FROM users
     ORDER BY created_at ASC
     LIMIT 5000`
  );

  let sent = 0;
  for (const r of rows || []) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await NotificationService.create(client, r.id, { type, title, body, data }).catch(() => null);
    if (ok) sent += 1;
  }
  return sent;
}

function safeOffice(o) {
  const v = String(o || '').trim();
  if (!OFFICES.includes(v)) throw new BadRequestError('Invalid office');
  return v;
}

function platformForOffice(office, seed) {
  // Deterministic-ish platform from seed (no LLM).
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 1000;

  if (office === 'mayor') {
    const initialCoins = Math.round(clamp(160 + (h % 121), 120, 320)); // 160..280-ish
    const foundingCost = Math.round(clamp(10 + (h % 31), 5, 60)); // 10..40-ish
    return {
      slogan: initialCoins >= 240 ? '돈이 돌아야 세상이 돈다!' : '허리띠 졸라매고 다시 시작하자',
      initial_coins: initialCoins,
      company_founding_cost: foundingCost
    };
  }
  if (office === 'tax_chief') {
    const tx = clamp(0.01 + ((h % 5) * 0.005), 0, 0.08);
    const burn = clamp(0.5 + ((h % 5) * 0.05), 0.3, 0.9);
    return { slogan: '한 푼도 빠져나갈 수 없다', transaction_tax_rate: tx, burn_ratio: burn };
  }
  if (office === 'chief_judge') {
    const maxFine = Math.round(clamp(50 + (h % 151), 30, 300));
    return { slogan: '법 앞에 예외는 없다', max_fine: maxFine, appeal_allowed: (h % 2) === 0 };
  }
  // council
  return { slogan: '약자의 편에 서겠다', min_wage: Math.round(clamp(2 + (h % 4), 1, 10)) };
}

function speechForCandidate({ office, candidateName, platform }) {
  const o = office === 'mayor' ? '시장' : office === 'tax_chief' ? '세무서장' : office === 'chief_judge' ? '수석판사' : '의원';
  const slogan = String(platform?.slogan || '').trim();

  if (office === 'mayor') {
    return `${candidateName} 후보(${o}): "${slogan}" — 내가 되면 신규 지급 ${platform.initial_coins}코인, 설립비 ${platform.company_founding_cost}코인! 이건 약속이 아니라 계획이다.`;
  }
  if (office === 'tax_chief') {
    return `${candidateName} 후보(${o}): "${slogan}" — 거래세 ${Math.round((platform.transaction_tax_rate || 0) * 100)}%, 소각 ${Math.round((platform.burn_ratio || 0) * 100)}%. 공정한 세금, 내 손으로 만들겠다.`;
  }
  if (office === 'chief_judge') {
    return `${candidateName} 후보(${o}): "${slogan}" — 벌금 상한 ${platform.max_fine}코인, 항소는 ${platform.appeal_allowed ? '열어둔다' : '닫는다'}. 흔들림 없이 간다.`;
  }
  return `${candidateName} 후보(${o}): "${slogan}" — 최저임금 ${platform.min_wage}코인으로 올리고, 반독점·복지 법안 반드시 통과시키겠다.`;
}

async function currentOfficeHolderWithClient(client, office, day) {
  return client
    .query(
      `SELECT h.office_code, h.agent_id, h.term_start_day, h.term_end_day,
              COALESCE(a.display_name, a.name) AS holder_name
       FROM office_holders h
       JOIN agents a ON a.id = h.agent_id
       WHERE h.office_code = $1
         AND h.term_start_day <= $2::date
         AND h.term_end_day > $2::date
       ORDER BY h.term_start_day DESC
       LIMIT 1`,
      [office, day]
    )
    .then((r) => r.rows?.[0] ?? null);
}

async function lastTermForOfficeWithClient(client, office) {
  return client
    .query(
      `SELECT term_start_day, term_end_day
       FROM office_holders
       WHERE office_code = $1
       ORDER BY term_start_day DESC
       LIMIT 1`,
      [office]
    )
    .then((r) => r.rows?.[0] ?? null);
}

async function ensureInitialHoldersWithClient(client, day, { userOnly = false } = {}) {
  for (const office of OFFICES) {
    const existing = await currentOfficeHolderWithClient(client, office, day);
    if (existing) continue;

    // Prefer user-owned pets (real users' AIs). NPCs are cold-start scaffolding only.
    let candidate = await client
      .query(
        `SELECT id, COALESCE(display_name, name) AS display
         FROM agents
         WHERE name <> 'world_core'
           AND owner_user_id IS NOT NULL
           AND is_active = true
         ORDER BY RANDOM()
         LIMIT 1`
      )
      .then((r) => r.rows?.[0] ?? null);
    if (!candidate && !userOnly) {
      candidate = await client
        .query(
          `SELECT id, COALESCE(display_name, name) AS display
           FROM agents
           WHERE name <> 'world_core'
             AND owner_user_id IS NULL
             AND is_active = true
           ORDER BY RANDOM()
           LIMIT 1`
        )
        .then((r) => r.rows?.[0] ?? null);
    }
    if (!candidate) continue;

    const termStart = day;
    const termEnd = addDays(day, TERM_DAYS);
    await client.query(
      `INSERT INTO office_holders (office_code, agent_id, election_id, term_start_day, term_end_day)
       VALUES ($1,$2,NULL,$3::date,$4::date)`,
      [office, candidate.id, termStart, termEnd]
    );
  }
}

async function ensureElectionRowWithClient(client, { office, termStartDay, termEndDay }) {
  const existing = await client
    .query(
      `SELECT id, phase, registration_day, campaign_start_day, voting_day, term_start_day, term_end_day
       FROM elections
       WHERE office_code = $1 AND term_start_day = $2::date
       LIMIT 1`,
      [office, termStartDay]
    )
    .then((r) => r.rows?.[0] ?? null);
  if (existing) return existing;

  const termNumber = await client
    .query('SELECT COALESCE(MAX(term_number), 0)::int AS n FROM elections WHERE office_code = $1', [office])
    .then((r) => Number(r.rows?.[0]?.n ?? 0) || 0)
    .then((n) => n + 1);

  const registrationDay = addDays(termStartDay, -REGISTRATION_BEFORE_TERM_START_DAYS);
  const campaignStartDay = addDays(termStartDay, -REGISTRATION_BEFORE_TERM_START_DAYS + 1);
  const votingDay = addDays(termStartDay, -1);

  const { rows } = await client.query(
    `INSERT INTO elections (office_code, term_number, phase, registration_day, campaign_start_day, voting_day, term_start_day, term_end_day)
     VALUES ($1,$2,'registration',$3::date,$4::date,$5::date,$6::date,$7::date)
     RETURNING id, office_code, term_number, phase, registration_day, campaign_start_day, voting_day, term_start_day, term_end_day`,
    [office, termNumber, registrationDay, campaignStartDay, votingDay, termStartDay, termEndDay]
  );
  return rows[0] || null;
}

async function ensureCandidatesWithClient(client, election, { userOnly = false } = {}) {
  const { rows: existing } = await client.query(
    `SELECT id FROM election_candidates WHERE election_id = $1 LIMIT 1`,
    [election.id]
  );
  if (existing.length > 0) return;

  const office = election.office_code;

  // Pick candidates (user-only when the world is big enough; NPCs are background cast).
  const { rows: pool } = userOnly
    ? await client.query(
      `SELECT id, COALESCE(display_name, name) AS display, owner_user_id
       FROM agents
       WHERE name <> 'world_core'
         AND owner_user_id IS NOT NULL
         AND is_active = true
       ORDER BY RANDOM()
       LIMIT 20`
    )
    : await client.query(
      `SELECT id, COALESCE(display_name, name) AS display, owner_user_id
       FROM agents
       WHERE name <> 'world_core'
         AND is_active = true
       ORDER BY (owner_user_id IS NOT NULL) DESC, RANDOM()
       LIMIT 20`
    );
  const picked = [];
  for (const a of pool) {
    if (picked.length >= (office === 'council' ? 5 : 3)) break;
    if (picked.find((p) => p.id === a.id)) continue;
    picked.push(a);
  }
  if (picked.length === 0) return;

  for (const c of picked) {
    const platform = platformForOffice(office, `${c.id}:${election.term_number}:${office}`);
    const speech = speechForCandidate({ office, candidateName: c.display, platform });
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO election_candidates (election_id, office_code, agent_id, platform, speech, status)
       VALUES ($1,$2,$3,$4::jsonb,$5,'active')
       ON CONFLICT (election_id, agent_id) DO NOTHING`,
      [election.id, office, c.id, JSON.stringify(platform), String(speech).slice(0, 2000)]
    );
  }
}

function voteScore({ voterSeed, platformSeed }) {
  // Very cheap pseudo affinity: prefer closer numbers.
  const a = Number(voterSeed) || 0;
  const b = Number(platformSeed) || 0;
  return 100 - Math.abs(a - b);
}

function seedForPlatformScore(office, platform) {
  const p = platform || {};
  if (office === 'mayor') return Number(p.initial_coins || 0);
  if (office === 'tax_chief') return Number(p.transaction_tax_rate || 0) * 100;
  if (office === 'chief_judge') return Number(p.max_fine || 0);
  return Number(p.min_wage || 0);
}

async function listElectionCandidatesWithClient(client, election) {
  const office = election.office_code;
  const { rows } = await client.query(
    `SELECT c.id,
            c.agent_id,
            c.platform,
            c.speech,
            c.status,
            c.vote_count,
            COALESCE(a.display_name, a.name) AS name,
            (a.owner_user_id IS NOT NULL) AS is_user
     FROM election_candidates c
     JOIN agents a ON a.id = c.agent_id
     WHERE c.election_id = $1 AND c.office_code = $2
     ORDER BY c.created_at ASC`,
    [election.id, office]
  );
  return rows || [];
}

async function listElectionVotersWithClient(client, { userOnly = false, userPetCount = 0 } = {}) {
  const { rows: users } = await client.query(
    `SELECT id, COALESCE(display_name, name) AS display, owner_user_id
     FROM agents
     WHERE name <> 'world_core'
       AND is_active = true
       AND owner_user_id IS NOT NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [MAX_VOTERS]
  );
  if (userOnly) return users || [];

  const userRows = users || [];
  const remaining = Math.max(0, MAX_VOTERS - userRows.length);
  const npcCap = userPetCount > 0 ? Math.min(NPC_MAX_VOTERS_WHEN_USERS_EXIST, remaining) : Math.min(200, remaining);
  if (npcCap <= 0) return userRows;

  const { rows: npcs } = await client.query(
    `SELECT id, COALESCE(display_name, name) AS display, owner_user_id
     FROM agents
     WHERE name <> 'world_core'
       AND is_active = true
       AND owner_user_id IS NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [npcCap]
  );

  return [...userRows, ...(npcs || [])];
}

async function fillMissingVotesRuleBasedWithClient(client, election, { userOnly = false, userPetCount = 0, onlyNpc = false } = {}) {
  const office = election.office_code;
  const candidates = await listElectionCandidatesWithClient(client, election);
  if (candidates.length === 0) return { filled: 0 };

  const voters = await listElectionVotersWithClient(client, { userOnly, userPetCount });
  if (voters.length === 0) return { filled: 0 };

  let filled = 0;
  for (const v of voters) {
    const isNpc = !v.owner_user_id;
    if (onlyNpc && !isNpc) continue;

    // eslint-disable-next-line no-await-in-loop
    const existing = await client.query(
      `SELECT id FROM election_votes WHERE election_id = $1 AND office_code = $2 AND voter_agent_id = $3 LIMIT 1`,
      [election.id, office, v.id]
    );
    if (existing.rows?.[0]) continue;

    let best = null;
    let bestScore = -1;
    for (const c of candidates) {
      const seedA = seedForPlatformScore(office, c.platform);
      const seedB = String(v.id).split('-').join('').length % 100; // cheap voter trait proxy
      const campaignBias = campaignBiasOf(c.platform);
      const score = voteScore({ voterSeed: seedB, platformSeed: seedA }) + campaignBias;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) continue;

    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO election_votes (election_id, office_code, voter_agent_id, candidate_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (election_id, office_code, voter_agent_id) DO NOTHING`,
      [election.id, office, v.id, best.id]
    );
    filled += 1;
  }

  return { filled };
}

async function enqueueCampaignHintWithClient(client, { worldId, agentId, userId, kind, key }) {
  const aid = String(agentId || '').trim();
  const uid = String(userId || '').trim();
  if (!isUuid(worldId) || !isUuid(aid) || !isUuid(uid)) return null;
  return NudgeQueueService.enqueueWithClient(client, {
    worldId,
    agentId: aid,
    userId: uid,
    kind: safeText(kind, 24) || 'campaign',
    key: safeText(key, 64) || `election_hint:${aid}`
  }).catch(() => null);
}

async function campaignEventWithClient(client, { day, electionId } = {}) {
  const iso = formatIsoDayUTC(parseIsoDay(day));
  const eId = String(electionId || '').trim();
  if (!client || !isUuid(eId)) return { ok: false, skipped: true };

  const election = await client
    .query(
      `SELECT id, office_code, phase
       FROM elections
       WHERE id = $1
       LIMIT 1`,
      [eId]
    )
    .then((r) => r.rows?.[0] ?? null);
  if (!election || String(election.phase || '') !== 'campaign') {
    return { ok: true, skipped: true, reason: 'not_campaign' };
  }

  const worldId = await getWorldAgentIdWithClient(client);
  if (!worldId) return { ok: false, skipped: true, reason: 'missing_world' };

  const markerKey = `campaign_event:${eId}:${iso}`;
  const marker = await client
    .query(
      `SELECT value
       FROM facts
       WHERE agent_id = $1
         AND kind = 'election'
         AND key = $2
       LIMIT 1`,
      [worldId, markerKey]
    )
    .then((r) => r.rows?.[0]?.value ?? null)
    .catch(() => null);
  if (marker && typeof marker === 'object') {
    return { ok: true, skipped: true, event: marker };
  }

  const { rows: candidates } = await client.query(
    `SELECT c.id, c.agent_id, c.platform, c.status,
            COALESCE(a.display_name, a.name) AS name,
            a.owner_user_id
     FROM election_candidates c
     JOIN agents a ON a.id = c.agent_id
     WHERE c.election_id = $1
       AND c.status = 'active'
     ORDER BY c.created_at ASC`,
    [eId]
  );
  const active = candidates || [];

  const rng = mulberry32(hash32(`${eId}:${iso}:CAMPAIGN`));
  const roll = rng();
  const pickOne = () => {
    if (active.length === 0) return null;
    return active[Math.floor(rng() * active.length)] || null;
  };
  const pickTwo = () => {
    if (active.length < 2) return [active[0] || null, null];
    const firstIdx = Math.floor(rng() * active.length);
    let secondIdx = Math.floor(rng() * active.length);
    if (secondIdx === firstIdx) secondIdx = (firstIdx + 1) % active.length;
    return [active[firstIdx] || null, active[secondIdx] || null];
  };

  const eventPayload = {
    day: iso,
    election_id: eId,
    office_code: election.office_code,
    type: 'QUIET_DAY',
    details: {}
  };

  if (active.length > 0 && roll < 0.2) {
    const target = pickOne();
    if (target) {
      const nextPlatform = withCampaignBias(target.platform, -15);
      nextPlatform.last_campaign_event = { day: iso, type: 'SCANDAL_LEAK' };

      await client.query(
        `UPDATE election_candidates
         SET platform = $2::jsonb
         WHERE id = $1`,
        [target.id, JSON.stringify(nextPlatform)]
      );

      eventPayload.type = 'SCANDAL_LEAK';
      eventPayload.details = {
        candidate_id: target.id,
        candidate_agent_id: target.agent_id,
        candidate_name: target.name,
        campaign_bias_delta: -15
      };

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'ELECTION_CAMPAIGN_SCANDAL', $2::jsonb, 6)`,
        [worldId, JSON.stringify(eventPayload)]
      ).catch(() => null);

      await notifyAllUsersWithClient(client, {
        type: 'ELECTION_DRAMA',
        title: '긴급! 후보 스캔들 터졌다',
        body: `${target.name} 후보의 치명적인 비밀이 폭로됐어... 지지율 급락 중. 판세가 뒤집힐 수도 있어!`,
        data: eventPayload
      }).catch(() => null);

      await enqueueCampaignHintWithClient(client, {
        worldId,
        agentId: target.agent_id,
        userId: target.owner_user_id,
        kind: 'campaign_scandal',
        key: `election:${eId}:scandal`
      });
    }
  } else if (active.length > 1 && roll < 0.4) {
    const [a, b] = pickTwo();
    if (a && b) {
      eventPayload.type = 'DEBATE';
      eventPayload.details = {
        debaters: [
          { candidate_id: a.id, agent_id: a.agent_id, name: a.name },
          { candidate_id: b.id, agent_id: b.agent_id, name: b.name }
        ]
      };

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'DEBATE', $2::jsonb, 5)`,
        [worldId, JSON.stringify(eventPayload)]
      ).catch(() => null);

      await enqueueCampaignHintWithClient(client, {
        worldId,
        agentId: a.agent_id,
        userId: a.owner_user_id,
        kind: 'campaign_debate',
        key: `election:${eId}:debate`
      });
    }
  } else if (active.length > 0 && roll < 0.55) {
    const target = pickOne();
    if (target) {
      const nextPlatform = withCampaignBias(target.platform, +10);
      nextPlatform.last_campaign_event = { day: iso, type: 'ENDORSEMENT' };
      await client.query(
        `UPDATE election_candidates
         SET platform = $2::jsonb
         WHERE id = $1`,
        [target.id, JSON.stringify(nextPlatform)]
      );

      eventPayload.type = 'ENDORSEMENT';
      eventPayload.details = {
        candidate_id: target.id,
        candidate_agent_id: target.agent_id,
        candidate_name: target.name,
        campaign_bias_delta: +10
      };

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'ELECTION_ENDORSEMENT', $2::jsonb, 4)`,
        [worldId, JSON.stringify(eventPayload)]
      ).catch(() => null);

      await notifyAllUsersWithClient(client, {
        type: 'ELECTION_DRAMA',
        title: '깜짝 지지 선언!',
        body: `아무도 예상 못 했다! ${target.name} 후보에게 깜짝 지지 선언이 나왔어. 분위기 완전 반전 중...`,
        data: eventPayload
      }).catch(() => null);
    }
  } else if (active.length > 0 && roll < 0.7) {
    const target = pickOne();
    if (target) {
      const nextPlatform = mutatePlatformForCampaign(election.office_code, target.platform, rng);
      nextPlatform.last_campaign_event = { day: iso, type: 'PLATFORM_SHIFT' };
      await client.query(
        `UPDATE election_candidates
         SET platform = $2::jsonb
         WHERE id = $1`,
        [target.id, JSON.stringify(nextPlatform)]
      );

      eventPayload.type = 'PLATFORM_SHIFT';
      eventPayload.details = {
        candidate_id: target.id,
        candidate_agent_id: target.agent_id,
        candidate_name: target.name
      };

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'ELECTION_PLATFORM_SHIFT', $2::jsonb, 3)`,
        [worldId, JSON.stringify(eventPayload)]
      ).catch(() => null);
    }
  }

  await client.query(
    `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
     VALUES ($1, 'election', $2, $3::jsonb, 1.0, NOW())
     ON CONFLICT (agent_id, kind, key)
     DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
    [worldId, markerKey, JSON.stringify(eventPayload)]
  );

  return { ok: true, skipped: false, event: eventPayload };
}

async function tallyAndInaugurateWithClient(client, election, day, { userOnly = false, userPetCount = 0 } = {}) {
  const office = election.office_code;

  // Ensure everyone has a vote (rule-based fallback for non-responsive AIs).
  await fillMissingVotesRuleBasedWithClient(client, election, { userOnly, userPetCount, onlyNpc: false });

  const candidates = await listElectionCandidatesWithClient(client, election);
  if (candidates.length === 0) return { winners: [] };

  // Count votes (raw)
  const { rows: counts } = await client.query(
    `SELECT candidate_id, COUNT(*)::int AS n
     FROM election_votes
     WHERE election_id = $1 AND office_code = $2
     GROUP BY candidate_id`,
    [election.id, office]
  );
  const countMap = new Map((counts || []).map((r) => [r.candidate_id, r.n]));

  const scored = candidates
    .filter((c) => String(c.status || 'active') === 'active')
    .map((c) => ({ ...c, votes: countMap.get(c.id) || 0 }))
    .sort((a, b) => b.votes - a.votes);

  const winners = office === 'council' ? scored.slice(0, 3) : scored.slice(0, 1);

  // Persist counts + close phase
  for (const c of scored) {
    // eslint-disable-next-line no-await-in-loop
    await client.query('UPDATE election_candidates SET vote_count = $2 WHERE id = $1', [c.id, c.votes]);
  }
  await client.query('UPDATE elections SET phase = $2 WHERE id = $1', [election.id, 'closed']);

  // Create next-term holders
  const termStart = formatIsoDayUTC(parseIsoDay(election.term_start_day));
  const termEnd = formatIsoDayUTC(parseIsoDay(election.term_end_day));

  for (const w of winners) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await client.query(
      `SELECT id
       FROM office_holders
       WHERE office_code = $1
         AND agent_id = $2
         AND election_id = $3
         AND term_start_day = $4::date
       LIMIT 1`,
      [office, w.agent_id, election.id, termStart]
    );
    if (exists.rows?.[0]) continue;

    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO office_holders (office_code, agent_id, election_id, term_start_day, term_end_day)
       VALUES ($1,$2,$3,$4::date,$5::date)`,
      [office, w.agent_id, election.id, termStart, termEnd]
    );
  }

  // Apply policy changes immediately (MVP): winner's platform becomes policy for allowed keys.
  const applyFrom = winners[0] || null;
  if (applyFrom?.platform && typeof applyFrom.platform === 'object') {
    const changes = [];
    if (office === 'mayor') {
      if ('initial_coins' in applyFrom.platform) changes.push({ key: 'initial_coins', value: clamp(applyFrom.platform.initial_coins, 80, 500) });
      if ('company_founding_cost' in applyFrom.platform) changes.push({ key: 'company_founding_cost', value: clamp(applyFrom.platform.company_founding_cost, 1, 200) });
    }
    if (office === 'tax_chief') {
      if ('transaction_tax_rate' in applyFrom.platform) changes.push({ key: 'transaction_tax_rate', value: clamp(applyFrom.platform.transaction_tax_rate, 0, 0.2) });
      if ('burn_ratio' in applyFrom.platform) changes.push({ key: 'burn_ratio', value: clamp(applyFrom.platform.burn_ratio, 0, 1) });
    }
    if (office === 'chief_judge') {
      if ('max_fine' in applyFrom.platform) changes.push({ key: 'max_fine', value: clamp(applyFrom.platform.max_fine, 10, 5000) });
      if ('appeal_allowed' in applyFrom.platform) changes.push({ key: 'appeal_allowed', value: Boolean(applyFrom.platform.appeal_allowed) });
    }
    if (office === 'council') {
      if ('min_wage' in applyFrom.platform) changes.push({ key: 'min_wage', value: clamp(applyFrom.platform.min_wage, 0, 50) });
    }

    const policyChangeKeys = changes.map((c) => String(c.key || '').trim()).filter(Boolean);
    let oldMap = new Map();
    if (policyChangeKeys.length > 0) {
      await PolicyService.ensureDefaultsWithClient(client).catch(() => null);
      const { rows: olds } = await client.query(
        `SELECT key, value
         FROM policy_params
         WHERE key = ANY($1::text[])`,
        [policyChangeKeys]
      );
      oldMap = new Map((olds || []).map((r) => [String(r.key || '').trim(), r.value]));
    }

    for (const c of changes) {
      // eslint-disable-next-line no-await-in-loop
      await PolicyService.setParamWithClient(client, { key: c.key, value: c.value, changedBy: applyFrom.agent_id });
    }

    const policyChanged = [];
    for (const c of changes) {
      const k = String(c?.key || '').trim();
      if (!k) continue;
      const oldValue = oldMap.has(k) ? oldMap.get(k) : null;
      const newValue = c.value;
      const oldJson = JSON.stringify(oldValue);
      const newJson = JSON.stringify(newValue);
      if (oldJson === newJson) continue;
      policyChanged.push({ key: k, old_value: oldValue, new_value: newValue });
    }

    if (policyChanged.length > 0) {
      await bestEffortInTransaction(
        client,
        async () => {
          await client.query(
            `INSERT INTO events (agent_id, event_type, payload, salience_score)
             VALUES ((SELECT id FROM agents WHERE name = 'world_core' LIMIT 1), 'POLICY_CHANGED', $1::jsonb, 7)`,
            [
              JSON.stringify({
                day,
                office,
                election_id: election.id,
                changed_by: applyFrom.agent_id,
                changes: policyChanged
              })
            ]
          );
        },
        { label: 'policy_changed_event' }
      );
    }
  }

  // World event (for curation)
  await bestEffortInTransaction(
    client,
    async () => {
      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ((SELECT id FROM agents WHERE name = 'world_core' LIMIT 1), 'ELECTION_CLOSED', $1::jsonb, 6)`,
        [
          JSON.stringify({
            day,
            office,
            election_id: election.id,
            winners: winners.map((w) => ({ agent_id: w.agent_id, name: w.name, votes: w.votes }))
          })
        ]
      );
    },
    { label: 'election_closed_event' }
  );

  // Post-election drama: winner inauguration speech + loser concede/contest speech.
  const winnerCandidateIds = new Set(winners.map((w) => String(w.id)));
  const losers = scored
    .filter((c) => !winnerCandidateIds.has(String(c.id)))
    .slice(0, office === 'council' ? 2 : 1);
  const speakers = [...winners.map((w) => ({ ...w, _result: 'winner' })), ...losers.map((l) => ({ ...l, _result: 'loser' }))];
  const speechEpisodes = [];

  for (const s of speakers) {
    const { rows: profileRows } = await client.query(
      `SELECT key, value
       FROM facts
       WHERE agent_id = $1
         AND kind = 'profile'
         AND key IN ('mbti', 'voice')`,
      [s.agent_id]
    );
    const mbti = safeText(profileRows?.find((r) => r.key === 'mbti')?.value?.mbti ?? '', 16) || null;
    const voice = profileRows?.find((r) => r.key === 'voice')?.value ?? null;
    const voiceTone = safeText(voice?.tone ?? '', 24) || '';
    const speechStyle =
      s._result === 'winner'
        ? 'winner'
        : loserReactionStyle({
          mbti,
          voiceTone,
          seed: `${election.id}:${day}:${s.agent_id}:LOSER_STYLE`
        });
    const speechSeed = speechSeedForResult({
      office,
      candidateName: s.name,
      result: s._result === 'winner' ? 'winner' : 'loser',
      style: speechStyle
    });
    const speechKey = `${election.id}:${s.id}:${s._result}:${day}`;

    const existingSpeechJob = await client.query(
      `SELECT id
       FROM brain_jobs
       WHERE agent_id = $1
         AND job_type = 'CAMPAIGN_SPEECH'
         AND input->>'speech_key' = $2
       LIMIT 1`,
      [s.agent_id, speechKey]
    );
    if (!existingSpeechJob.rows?.[0]) {
      await client.query(
        `INSERT INTO brain_jobs (agent_id, job_type, input)
         VALUES ($1, 'CAMPAIGN_SPEECH', $2::jsonb)`,
        [
          s.agent_id,
          JSON.stringify({
            kind: s._result === 'winner' ? 'inauguration_speech' : speechStyle === 'contest' ? 'rejection_speech' : 'concession_speech',
            day,
            election_id: election.id,
            office_code: office,
            candidate_id: s.id,
            platform: s.platform ?? {},
            seed_speech: speechSeed,
            speech_key: speechKey,
            profile: {
              mbti,
              voice: voice && typeof voice === 'object' ? voice : null
            }
          })
        ]
      );
    }

    speechEpisodes.push({
      candidate_id: s.id,
      candidate_agent_id: s.agent_id,
      name: s.name,
      type: s._result === 'winner' ? 'inauguration' : speechStyle === 'contest' ? 'contest' : 'concession',
      seed_speech: speechSeed
    });
  }

  if (speechEpisodes.length > 0) {
    const worldId = await getWorldAgentIdWithClient(client);
    if (worldId) {
      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'ELECTION_EPISODE', $2::jsonb, 6)`,
        [
          worldId,
          JSON.stringify({
            day,
            office,
            election_id: election.id,
            speeches: speechEpisodes
          })
        ]
      ).catch(() => null);
    }
  }

  return { winners };
}

async function civicLineForDayWithClient(client, day) {
  const closed = await bestEffortInTransaction(
    client,
    async () => {
      const r = await client.query(
        `SELECT payload
         FROM events
         WHERE event_type = 'ELECTION_CLOSED'
           AND payload->>'day' = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [day]
      );
      return r.rows?.[0]?.payload ?? null;
    },
    { label: 'civic_line_closed', fallback: null }
  );

  if (closed && typeof closed === 'object') {
    const office = String(closed.office || '').trim();
    const winners = Array.isArray(closed.winners) ? closed.winners : [];
    const label = office === 'mayor' ? '시장' : office === 'tax_chief' ? '세무서장' : office === 'chief_judge' ? '수석판사' : office === 'council' ? '의회' : '공직';

    const namesInline = winners
      .map((w) => ({ name: String(w?.name ?? '').trim(), votes: Number(w?.votes ?? 0) || 0 }))
      .filter((w) => w.name)
      .map((w) => `${w.name}(${w.votes})`);
    if (namesInline.length > 0) {
      return `🗳️ ${label} 선거 결과: ${namesInline.join(' · ')}`;
    }

    const ids = winners.map((w) => w?.agent_id).filter(Boolean);
    if (ids.length > 0) {
      const { rows } = await client.query(
        `SELECT id, COALESCE(display_name, name) AS display
         FROM agents
         WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      const nameMap = new Map((rows || []).map((r) => [r.id, r.display]));
      const names = winners
        .map((w) => ({ id: w?.agent_id, votes: Number(w?.votes ?? 0) || 0 }))
        .filter((w) => w.id && nameMap.has(w.id))
        .map((w) => `${nameMap.get(w.id)}(${w.votes})`);
      if (names.length > 0) {
        return `🗳️ ${label} 선거 결과: ${names.join(' · ')}`;
      }
    }
  }

  // Prefer an in-progress election; otherwise show current holders.
  const { rows: activeElections } = await client.query(
    `SELECT id, office_code, phase, registration_day, campaign_start_day, voting_day, term_start_day
     FROM elections
     WHERE registration_day <= $1::date
       AND phase <> 'closed'
     ORDER BY voting_day ASC`,
    [day]
  );

  const e = activeElections?.[0] ?? null;
  if (e) {
    const office = e.office_code;
    const label = office === 'mayor' ? '시장' : office === 'tax_chief' ? '세무서장' : office === 'chief_judge' ? '수석판사' : '의원';
    const phase = String(e.phase || '');
    const dday = (() => {
      const t = parseIsoDay(formatIsoDayUTC(parseIsoDay(e.voting_day)));
      const n = parseIsoDay(day);
      const diff = Math.round((t.getTime() - n.getTime()) / 86400000);
      return diff;
    })();

    if (phase === 'registration') return `🗳️ ${label} 선거: 후보 등록 접수 중! 누가 나설까? (D-${dday})`;
    if (phase === 'campaign') return `🗳️ ${label} 선거: 캠페인 과열 중! 판세 요동치는 중 (D-${dday})`;
    if (dday < 0) return `🗳️ ${label} 선거: 개표 임박... 결과는? (D+${Math.abs(dday)})`;
    return `🗳️ ${label} 선거: 투표 진행 중! 한 표가 판세를 바꾼다 (D-${dday})`;
  }

  const holders = [];
  for (const office of OFFICES) {
    // eslint-disable-next-line no-await-in-loop
    const h = await currentOfficeHolderWithClient(client, office, day);
    if (!h) continue;
    const label = office === 'mayor' ? '시장' : office === 'tax_chief' ? '세무서장' : office === 'chief_judge' ? '수석판사' : '의원';
    holders.push(`${label} ${h.holder_name}`);
  }
  if (holders.length > 0) {
    return `🏛️ 현직 권력자: ${holders.slice(0, 2).join(' · ')}${holders.length > 2 ? ' 외' : ''}`;
  }
  return null;
}

class ElectionService {
  static offices() {
    return [...OFFICES];
  }

  static async campaignEventWithClient(client, { day, electionId } = {}) {
    return campaignEventWithClient(client, { day, electionId });
  }

  static async tickDay({ day, fast = false } = {}) {
    const iso = String(day || '').trim();
    if (!iso) throw new BadRequestError('day is required');
    return transaction(async (client) => {
      await PolicyService.ensureDefaultsWithClient(client).catch(() => null);
      const userPetCount = await client
        .query(
          `SELECT COUNT(*)::int AS n
           FROM agents
           WHERE name <> 'world_core'
             AND owner_user_id IS NOT NULL
             AND is_active = true`
        )
        .then((r) => Number(r.rows?.[0]?.n ?? 0) || 0)
        .catch(() => 0);
      const userOnly = userPetCount > NPC_COLDSTART_MAX_USER_PETS;

      await ensureInitialHoldersWithClient(client, iso, { userOnly });

      // For each office: ensure next election scheduled, and run actions if today hits a phase.
      for (const office of OFFICES) {
        // eslint-disable-next-line no-await-in-loop
        const current = await currentOfficeHolderWithClient(client, office, iso);
        // If still missing, skip.
        if (!current) continue;

        // Find the last term and compute the next term window.
        // eslint-disable-next-line no-await-in-loop
        const lastTerm = await lastTermForOfficeWithClient(client, office);
        const termStartDay = lastTerm?.term_end_day ? formatIsoDayUTC(parseIsoDay(lastTerm.term_end_day)) : addDays(iso, 1);
        const termEndDay = addDays(termStartDay, TERM_DAYS);

        const registrationDay = addDays(termStartDay, -REGISTRATION_BEFORE_TERM_START_DAYS);
        if (parseIsoDay(iso).getTime() < parseIsoDay(registrationDay).getTime()) {
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const election = await ensureElectionRowWithClient(client, { office, termStartDay, termEndDay });
        if (!election) continue;

        // Phase transitions
        const today = iso;
        const campaignStart = formatIsoDayUTC(parseIsoDay(election.campaign_start_day));
        const votingDay = formatIsoDayUTC(parseIsoDay(election.voting_day));

        let nextPhase = String(election.phase || 'registration');
        const tToday = parseIsoDay(today).getTime();
        const tCampaign = parseIsoDay(campaignStart).getTime();
        const tVoting = parseIsoDay(votingDay).getTime();

        // Robust phase selection (handles "catch-up" if a day was missed):
        // - before campaign_start -> registration
        // - before voting_day -> campaign
        // - on/after voting_day -> voting (will be closed by runVoting)
        if (tToday < tCampaign) {
          nextPhase = 'registration';
        } else if (tToday < tVoting) {
          nextPhase = 'campaign';
        } else {
          nextPhase = 'voting';
        }

        if (nextPhase !== election.phase && election.phase !== 'closed') {
          // eslint-disable-next-line no-await-in-loop
          await client.query('UPDATE elections SET phase = $2 WHERE id = $1', [election.id, nextPhase]);
          election.phase = nextPhase;
        }

        // Ensure candidates at registration start.
        // eslint-disable-next-line no-await-in-loop
        await ensureCandidatesWithClient(client, election, { userOnly });

        if (election.phase === 'campaign') {
          // eslint-disable-next-line no-await-in-loop
          await ElectionService.campaignEventWithClient(client, { day: today, electionId: election.id }).catch(() => null);

          // Campaign speech jobs are optional; no-op if unsupported by the brain.
          await bestEffortInTransaction(
            client,
            async () => {
              const candidates = await listElectionCandidatesWithClient(client, election);
              for (const c of candidates) {
                // eslint-disable-next-line no-await-in-loop
                const exists = await client.query(
                  `SELECT id
                   FROM brain_jobs
                   WHERE agent_id = $1
                     AND job_type = 'CAMPAIGN_SPEECH'
                     AND input->>'election_id' = $2
                   LIMIT 1`,
                  [c.agent_id, election.id]
                );
                if (exists.rows?.[0]) continue;

                // eslint-disable-next-line no-await-in-loop
                await client.query(
                  `INSERT INTO brain_jobs (agent_id, job_type, input)
                   VALUES ($1, 'CAMPAIGN_SPEECH', $2::jsonb)`,
                  [
                    c.agent_id,
                    JSON.stringify({
                      kind: 'campaign_speech',
                      day: today,
                      election_id: election.id,
                      office_code: election.office_code,
                      candidate_id: c.id,
                      platform: c.platform ?? {},
                      seed_speech: c.speech ?? null
                    })
                  ]
                );
              }
            },
            { label: 'election_campaign_jobs' }
          );
        }

        if (election.phase === 'voting') {
          const tToday = parseIsoDay(today).getTime();
          const tVoting = parseIsoDay(votingDay).getTime();

          if (fast || tToday > tVoting) {
            // eslint-disable-next-line no-await-in-loop
            await tallyAndInaugurateWithClient(client, election, iso, { userOnly, userPetCount });
          } else {
            // Voting day: pre-fill NPC votes so the election feels alive, and ask user AIs to decide.
            // eslint-disable-next-line no-await-in-loop
            await fillMissingVotesRuleBasedWithClient(client, election, { userOnly, userPetCount, onlyNpc: true });

            await bestEffortInTransaction(
              client,
              async () => {
                const candidates = await listElectionCandidatesWithClient(client, election);
                const safeCandidates = candidates
                  .filter((c) => String(c.status || 'active') === 'active')
                  .slice(0, 20)
                  .map((c) => ({
                    id: c.id,
                    agent_id: c.agent_id,
                    name: c.name,
                    speech: c.speech,
                    platform: c.platform
                  }));

                const { rows: userVoters } = await client.query(
                  `SELECT a.id, a.owner_user_id
                   FROM agents a
                   WHERE a.name <> 'world_core'
                     AND a.is_active = true
                     AND a.owner_user_id IS NOT NULL
                     AND EXISTS (
                       SELECT 1 FROM user_brain_profiles ub
                       WHERE ub.user_id = a.owner_user_id
                     )
                   ORDER BY a.created_at ASC
                   LIMIT $1`,
                  [MAX_VOTERS]
                );

                for (const v of userVoters || []) {
                  // Skip if already voted
                  // eslint-disable-next-line no-await-in-loop
                  const existingVote = await client.query(
                    `SELECT id
                     FROM election_votes
                     WHERE election_id = $1 AND office_code = $2 AND voter_agent_id = $3
                     LIMIT 1`,
                    [election.id, election.office_code, v.id]
                  );
                  if (existingVote.rows?.[0]) continue;

                  // Skip if a job already exists (pending/leased/done)
                  // eslint-disable-next-line no-await-in-loop
                  const existingJob = await client.query(
                    `SELECT id
                     FROM brain_jobs
                     WHERE agent_id = $1
                       AND job_type = 'VOTE_DECISION'
                       AND input->>'election_id' = $2
                     LIMIT 1`,
                    [v.id, election.id]
                  );
                  if (existingJob.rows?.[0]) continue;

                  // eslint-disable-next-line no-await-in-loop
                  await client.query(
                    `INSERT INTO brain_jobs (agent_id, job_type, input)
                     VALUES ($1, 'VOTE_DECISION', $2::jsonb)`,
                    [
                      v.id,
                      JSON.stringify({
                        kind: 'vote_decision',
                        day: today,
                        election_id: election.id,
                        office_code: election.office_code,
                        candidates: safeCandidates
                      })
                    ]
                  );
                }
              },
              { label: 'election_vote_jobs' }
            );
          }
        }
      }

      // 3 days after taking office: policy decision job (optional; BYOK-driven).
      await bestEffortInTransaction(
        client,
        async () => {
          const dueTermStart = addDays(iso, -3);
          const { rows: holders } = await client.query(
            `SELECT h.id, h.office_code, h.agent_id, h.term_start_day
             FROM office_holders h
             WHERE h.term_start_day <= $1::date
               AND h.term_start_day >= $2::date
               AND h.term_end_day > $3::date
             ORDER BY h.term_start_day DESC
             LIMIT 12`,
            [dueTermStart, addDays(iso, -10), iso]
          );

          for (const h of holders || []) {
            const holderTermStart = formatIsoDayUTC(parseIsoDay(h.term_start_day));
            const dueDay = addDays(holderTermStart, 3);
            if (parseIsoDay(dueDay).getTime() > parseIsoDay(iso).getTime()) continue;

            // eslint-disable-next-line no-await-in-loop
            const existingJob = await client.query(
              `SELECT id
               FROM brain_jobs
               WHERE agent_id = $1
                 AND job_type = 'POLICY_DECISION'
                 AND input->>'office_holder_id' = $2
               LIMIT 1`,
              [h.agent_id, h.id]
            );
            if (existingJob.rows?.[0]) continue;

            // eslint-disable-next-line no-await-in-loop
            await client.query(
              `INSERT INTO brain_jobs (agent_id, job_type, input)
               VALUES ($1, 'POLICY_DECISION', $2::jsonb)`,
              [
                h.agent_id,
                JSON.stringify({
                  kind: 'policy_decision',
                  day: iso,
                  office_holder_id: h.id,
                  office_code: h.office_code,
                  term_start_day: holderTermStart
                })
              ]
            );
          }
        },
        { label: 'election_policy_jobs' }
      );

      const civicLine = await civicLineForDayWithClient(client, iso);
      return { civicLine };
    });
  }

  static async getCivicLine(day) {
    const iso = String(day || '').trim();
    if (!iso) return null;
    return transaction(async (client) => civicLineForDayWithClient(client, iso));
  }

  static async listActiveElections({ day, viewerAgentId = null } = {}) {
    const iso = String(day || '').trim();
    if (!iso) throw new BadRequestError('day is required');

    const viewerId = viewerAgentId ? String(viewerAgentId) : null;

    return transaction(async (client) => {
      const { rows: elections } = await client.query(
        `SELECT id, office_code, term_number, phase, registration_day, campaign_start_day, voting_day, term_start_day, term_end_day
         FROM elections
         WHERE registration_day <= $1::date
           AND phase <> 'closed'
         ORDER BY voting_day ASC
         LIMIT 10`,
        [iso]
      );
      const list = elections || [];
      if (list.length === 0) return [];

      const electionIds = list.map((e) => e.id).filter(Boolean);
      const { rows: candidateRows } = await client.query(
        `SELECT c.election_id,
                c.id,
                c.agent_id,
                c.office_code,
                c.platform,
                c.speech,
                c.vote_count,
                c.status,
                c.created_at,
                COALESCE(a.display_name, a.name) AS name,
                (a.owner_user_id IS NOT NULL) AS is_user
         FROM election_candidates c
         JOIN agents a ON a.id = c.agent_id
         WHERE c.election_id = ANY($1::uuid[])
         ORDER BY c.created_at ASC`,
        [electionIds]
      );

      const byElection = new Map();
      for (const c of candidateRows || []) {
        const key = c.election_id;
        const arr = byElection.get(key) || [];
        arr.push(c);
        byElection.set(key, arr);
      }

      const myVotesByElection = new Map();
      if (viewerId) {
        const { rows: myVotes } = await client.query(
          `SELECT election_id, office_code, candidate_id
           FROM election_votes
           WHERE voter_agent_id = $1 AND election_id = ANY($2::uuid[])`,
          [viewerId, electionIds]
        );
        for (const v of myVotes || []) {
          myVotesByElection.set(v.election_id, { office_code: v.office_code, candidate_id: v.candidate_id });
        }
      }

      return list.map((e) => ({
        ...e,
        candidates: byElection.get(e.id) || [],
        my_vote: myVotesByElection.get(e.id) || null
      }));
    });
  }

  static async registerCandidate(electionId, agentId) {
    const eId = String(electionId || '').trim();
    const aId = String(agentId || '').trim();
    if (!eId || !aId) throw new BadRequestError('electionId and agentId are required');

    return transaction(async (client) => {
      const { rows: eRows } = await client.query(
        `SELECT id, office_code, term_number, phase, registration_day, campaign_start_day, voting_day, term_start_day, term_end_day
         FROM elections
         WHERE id = $1
         FOR UPDATE`,
        [eId]
      );
      const e = eRows[0];
      if (!e) throw new BadRequestError('Election not found');
      if (e.phase === 'closed') throw new BadRequestError('Election is closed');
      if (e.phase === 'voting') throw new BadRequestError('Registration is closed');

      const { rows: aRows } = await client.query(
        `SELECT id, karma, is_active
         FROM agents
         WHERE id = $1 AND name <> 'world_core'
         LIMIT 1`,
        [aId]
      );
      const a = aRows[0];
      if (!a || !a.is_active) throw new BadRequestError('Agent not eligible');
      if (Number(a.karma || 0) < MIN_KARMA_FOR_CANDIDATE) {
        throw new BadRequestError(`신용(karma) ${MIN_KARMA_FOR_CANDIDATE}+ 필요`);
      }

      await TransactionService.transfer(
        {
          fromAgentId: aId,
          toAgentId: null,
          amount: CANDIDATE_FEE_COINS,
          txType: 'ELECTION_FEE',
          memo: `candidate_fee:${e.office_code}`,
          referenceId: eId,
          referenceType: 'election'
        },
        client
      );

      const platform = platformForOffice(e.office_code, `${aId}:${e.term_number}:${e.office_code}`);
      const candidateName = await client
        .query(`SELECT COALESCE(display_name, name) AS display FROM agents WHERE id = $1`, [aId])
        .then((r) => r.rows?.[0]?.display ?? '후보');
      const speech = speechForCandidate({ office: e.office_code, candidateName, platform });

      const { rows: insertedRows } = await client.query(
        `INSERT INTO election_candidates (election_id, office_code, agent_id, platform, speech, status)
         VALUES ($1,$2,$3,$4::jsonb,$5,'active')
         ON CONFLICT (election_id, agent_id) DO UPDATE
           SET status = 'active'
         RETURNING id, election_id, office_code, agent_id, platform, speech, status, created_at`,
        [eId, e.office_code, aId, JSON.stringify(platform), String(speech).slice(0, 2000)]
      );
      const inserted = insertedRows[0];

      await bestEffortInTransaction(
        client,
        async () => {
          await client.query(
            `INSERT INTO events (agent_id, event_type, payload, salience_score)
             VALUES ((SELECT id FROM agents WHERE name = 'world_core' LIMIT 1), 'CANDIDATE_REGISTERED', $1::jsonb, 5)`,
            [
              JSON.stringify({
                day: formatIsoDayUTC(new Date()),
                election_id: eId,
                office: e.office_code,
                candidate_agent_id: aId
              })
            ]
          );
        },
        { label: 'candidate_registered_event' }
      );

      return { candidate: inserted };
    });
  }

  static async castVote(electionId, voterAgentId, candidateId) {
    const eId = String(electionId || '').trim();
    const vId = String(voterAgentId || '').trim();
    const cId = String(candidateId || '').trim();
    if (!eId || !vId || !cId) throw new BadRequestError('electionId, voterAgentId, candidateId are required');

    return transaction(async (client) => {
      const { rows: eRows } = await client.query(
        `SELECT id, office_code, phase
         FROM elections
         WHERE id = $1
         FOR UPDATE`,
        [eId]
      );
      const e = eRows[0];
      if (!e) throw new BadRequestError('Election not found');
      if (e.phase !== 'voting') throw new BadRequestError('Voting is not open');

      const { rows: candRows } = await client.query(
        `SELECT id
         FROM election_candidates
         WHERE id = $1 AND election_id = $2 AND office_code = $3 AND status = 'active'
         LIMIT 1`,
        [cId, eId, e.office_code]
      );
      if (!candRows[0]) throw new BadRequestError('Invalid candidate');

      const { rows: voteRows } = await client.query(
        `INSERT INTO election_votes (election_id, office_code, voter_agent_id, candidate_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (election_id, office_code, voter_agent_id)
         DO UPDATE SET candidate_id = EXCLUDED.candidate_id, created_at = NOW()
         RETURNING id, election_id, office_code, voter_agent_id, candidate_id, created_at`,
        [eId, e.office_code, vId, cId]
      );
      return { vote: voteRows[0] };
    });
  }

  static async influenceWithClient(
    client,
    { electionId, influencerAgentId, targetCandidateId, type, day = null } = {}
  ) {
    if (!client) throw new BadRequestError('client is required');

    const eId = String(electionId || '').trim();
    const actorId = String(influencerAgentId || '').trim();
    const candidateId = String(targetCandidateId || '').trim();
    const kind = String(type || '').trim().toLowerCase();
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '').trim()) ? String(day).trim() : formatIsoDayUTC(new Date());

    if (!eId || !actorId || !candidateId || !kind) {
      throw new BadRequestError('electionId, influencerAgentId, targetCandidateId, type are required');
    }
    if (!['bribe', 'endorse', 'oppose'].includes(kind)) {
      throw new BadRequestError('Invalid influence type');
    }

    const cost = kind === 'bribe' ? 20 : 5;
    const deltaAbs = kind === 'bribe' ? randInt(5, 10) : randInt(2, 3);
    const delta = kind === 'oppose' ? -deltaAbs : deltaAbs;
    const caught = kind === 'bribe' ? Math.random() < 0.3 : false;

    const { rows: electionRows } = await client.query(
      `SELECT id, office_code, phase
       FROM elections
       WHERE id = $1
       FOR UPDATE`,
      [eId]
    );
    const election = electionRows?.[0] ?? null;
    if (!election) throw new BadRequestError('Election not found');
    if (String(election.phase || '') === 'closed') throw new BadRequestError('Election is closed');
    if (!['campaign', 'voting'].includes(String(election.phase || ''))) {
      throw new BadRequestError('Influence is only allowed during campaign/voting');
    }

    const { rows: actorRows } = await client.query(
      `SELECT id, is_active
       FROM agents
       WHERE id = $1
         AND name <> 'world_core'
       LIMIT 1`,
      [actorId]
    );
    const actor = actorRows?.[0] ?? null;
    if (!actor || !actor.is_active) throw new BadRequestError('Agent not eligible');

    const { rows: candRows } = await client.query(
      `SELECT c.id,
              c.agent_id,
              c.platform,
              c.status,
              COALESCE(a.display_name, a.name) AS name
       FROM election_candidates c
       JOIN agents a ON a.id = c.agent_id
       WHERE c.id = $1
         AND c.election_id = $2
         AND c.office_code = $3
       LIMIT 1
       FOR UPDATE`,
      [candidateId, eId, election.office_code]
    );
    const candidate = candRows?.[0] ?? null;
    if (!candidate || String(candidate.status || '') !== 'active') throw new BadRequestError('Invalid candidate');

    await TransactionService.transfer(
      {
        fromAgentId: actorId,
        toAgentId: null,
        amount: cost,
        txType: 'ELECTION_INFLUENCE',
        memo: `influence:${kind} election:${eId} candidate:${candidateId} day:${iso}`,
        referenceId: eId,
        referenceType: 'election',
      },
      client
    );

    const platform = candidate.platform && typeof candidate.platform === 'object' ? candidate.platform : {};
    const beforeBias = campaignBiasOf(platform);
    const nextPlatform = withCampaignBias(platform, delta);
    nextPlatform.last_player_influence = {
      day: iso,
      type: kind,
      by_agent_id: actorId,
      target_candidate_id: candidateId,
      campaign_bias_delta: delta,
      caught,
    };

    await client.query(
      `UPDATE election_candidates
       SET platform = $2::jsonb
       WHERE id = $1`,
      [candidateId, JSON.stringify(nextPlatform)]
    );

    const scandal = caught
      ? await ScandalService.createWithClient(client, {
        day: iso,
        accusedId: actorId,
        accuserId: String(candidate.agent_id || '').trim() || null,
        kind: 'election_bribe',
        source: 'election_influence',
        title: '선거 뇌물 스캔들',
        summary: '선거 뇌물 시도가 들통났어. 도시 전체가 술렁이고 있어.',
        data: {
          election_id: eId,
          candidate_id: candidateId,
          target_agent_id: String(candidate.agent_id || '').trim() || null,
          influence_type: kind,
          campaign_bias_delta: delta,
        },
      }).catch(() => null)
      : null;

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'ELECTION_INFLUENCE', $2::jsonb, 5)`,
      [
        actorId,
        JSON.stringify({
          day: iso,
          election_id: eId,
          office_code: election.office_code,
          type: kind,
          target_candidate_id: candidateId,
          target_agent_id: String(candidate.agent_id || '').trim() || null,
          target_name: String(candidate.name || '').trim() || null,
          cost,
          campaign_bias_delta: delta,
          campaign_bias_before: beforeBias,
          campaign_bias_after: campaignBiasOf(nextPlatform),
          caught,
          scandal_key: scandal?.key ?? null,
        }),
      ]
    ).catch(() => null);

    return {
      influenced: true,
      election_id: eId,
      candidate_id: candidateId,
      target_agent_id: String(candidate.agent_id || '').trim() || null,
      type: kind,
      cost,
      campaign_bias_before: beforeBias,
      campaign_bias_after: campaignBiasOf(nextPlatform),
      campaign_bias_delta: delta,
      caught,
      scandal: scandal
        ? {
          key: scandal.key ?? null,
          verdict: scandal.verdict ?? null,
          day: scandal.day ?? iso,
        }
        : null,
    };
  }

  static async influence(electionId, influencerAgentId, { targetCandidateId, type, day = null } = {}) {
    const eId = String(electionId || '').trim();
    const actorId = String(influencerAgentId || '').trim();
    if (!eId || !actorId) throw new BadRequestError('electionId and influencerAgentId are required');
    return transaction(async (client) => {
      return ElectionService.influenceWithClient(client, {
        electionId: eId,
        influencerAgentId: actorId,
        targetCandidateId,
        type,
        day,
      });
    });
  }
}

module.exports = ElectionService;
