/**
 * SecretSocietyService
 *
 * Current scope:
 * - Seed one active society (user-first)
 * - Mission loop (assign / resolve)
 *
 * Storage:
 * - Missions are stored as facts on world_core:
 *   kind='society_mission', key=`mission:${missionId}`
 */

const { randomUUID } = require('crypto');
const DmService = require('./DmService');
const PostService = require('./PostService');
const RumorService = require('./RumorService');
const TransactionService = require('./TransactionService');
const RelationshipService = require('./RelationshipService');
const NotificationService = require('./NotificationService');
const ScandalService = require('./ScandalService');
const { ProgressionService } = require('./ProgressionService');
const WorldDayService = require('./WorldDayService');
const config = require('../config');

function pick(arr) {
  const list = Array.isArray(arr) ? arr : [];
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function safeText(s, maxLen = 200) {
  const n = Math.max(1, Math.trunc(Number(maxLen) || 200));
  return String(s ?? '').trim().slice(0, n);
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function todayIsoDayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDayUTC(iso) {
  const s = safeIsoDay(iso);
  if (!s) return null;
  const [y, m, d] = s.split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatIsoDayUTC(date) {
  const dt = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  const dt = parseIsoDayUTC(iso);
  if (!dt) return null;
  dt.setUTCDate(dt.getUTCDate() + Math.trunc(Number(days) || 0));
  return formatIsoDayUTC(dt);
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

function societyTemplates() {
  return [
    { name: '그림자 상단', purpose: '시장 독점하고 가격 좀 흔들어보자는 거지' },
    { name: '안개 연구회', purpose: '정보 모으고 조용히 판 흔들기' },
    { name: '검은 리본', purpose: '리본 굿즈 내부 정보 사수' },
    { name: '야근 동맹', purpose: '회사 안에서 힘겨루기' }
  ];
}

const MISSION_DEFS = {
  spy: {
    type: 'spy',
    label: '정보수집',
    baseSuccess: 0.56,
    leakRisk: 0.3,
    rewardCoins: 12,
    rewardXp: 60,
    skillWeights: {
      detective: 0.18,
      journalist: 0.14,
      engineer: 0.08,
      merchant: 0.06,
      janitor: 0.05,
      barista: 0.03
    }
  },
  election_rig: {
    type: 'election_rig',
    label: '선거조작',
    baseSuccess: 0.42,
    leakRisk: 0.3,
    rewardCoins: 16,
    rewardXp: 90,
    skillWeights: {
      journalist: 0.16,
      merchant: 0.14,
      janitor: 0.1,
      detective: 0.07,
      engineer: 0.06,
      barista: 0.03
    }
  },
  market_disrupt: {
    type: 'market_disrupt',
    label: '경제교란',
    baseSuccess: 0.38,
    leakRisk: 0.3,
    rewardCoins: 18,
    rewardXp: 110,
    skillWeights: {
      merchant: 0.16,
      engineer: 0.14,
      janitor: 0.08,
      detective: 0.06,
      journalist: 0.05,
      barista: 0.03
    }
  },
  recruit: {
    type: 'recruit',
    label: '멤버모집',
    baseSuccess: 0.6,
    leakRisk: 0.3,
    rewardCoins: 10,
    rewardXp: 50,
    skillWeights: {
      barista: 0.16,
      journalist: 0.13,
      merchant: 0.1,
      janitor: 0.07,
      detective: 0.05,
      engineer: 0.04
    }
  }
};

class SecretSocietyService {
  static missionDef(missionType) {
    const t = String(missionType || '').trim().toLowerCase();
    return MISSION_DEFS[t] || null;
  }

  static async worldAgentIdWithClient(client) {
    const row = await client
      .query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`)
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    return row?.id ?? null;
  }

  static async getSocietyWithClient(client, societyId) {
    const id = String(societyId || '').trim();
    if (!id) return null;
    return client
      .query(
        `SELECT id, name, purpose, leader_agent_id, evidence_level, status, created_at, updated_at
         FROM secret_societies
         WHERE id = $1
         LIMIT 1`,
        [id]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
  }

  static async listActiveMemberRowsWithClient(client, societyId, { limit = 50 } = {}) {
    const id = String(societyId || '').trim();
    if (!id) return [];
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const { rows } = await client.query(
      `SELECT m.agent_id, m.role, m.status, a.owner_user_id, a.name, a.display_name
       FROM secret_society_members m
       JOIN agents a ON a.id = m.agent_id
       WHERE m.society_id = $1
         AND m.status = 'active'
       ORDER BY CASE WHEN m.role = 'leader' THEN 0 WHEN m.role = 'officer' THEN 1 ELSE 2 END, m.joined_at ASC
       LIMIT $2`,
      [id, safeLimit]
    );
    return rows || [];
  }

  static computeMissionSuccessChance({ missionType, members = [], jobsByAgentId = new Map() } = {}) {
    const def = SecretSocietyService.missionDef(missionType);
    if (!def) return 0.25;
    const list = Array.isArray(members) ? members : [];
    if (!list.length) return clamp01(def.baseSuccess);

    let score = Number(def.baseSuccess) || 0;
    for (const m of list) {
      const id = String(m?.agent_id || m?.agentId || '').trim();
      const jobCode = String(jobsByAgentId.get(id) || '').trim();
      const bonus = Number(def.skillWeights?.[jobCode] ?? 0) || 0;
      score += bonus;
    }

    const teamBonus = list.length >= 3 ? 0.04 : list.length === 2 ? 0.02 : 0;
    score += teamBonus;

    return clamp01(Math.max(0.12, Math.min(0.92, score / Math.max(1, list.length))));
  }

  static async notifyMemberOwnersWithClient(client, memberRows, { type, title, body, data = {} } = {}) {
    const rows = Array.isArray(memberRows) ? memberRows : [];
    const seenUsers = new Set();
    let sent = 0;
    for (const row of rows) {
      const userId = row?.owner_user_id ? String(row.owner_user_id) : null;
      if (!userId || seenUsers.has(userId)) continue;
      seenUsers.add(userId);
      // eslint-disable-next-line no-await-in-loop
      const n = await NotificationService.create(client, userId, { type, title, body, data }).catch(() => null);
      if (n) sent += 1;
    }
    return sent;
  }

  static async assignMissionWithClient(client, { societyId, missionType, targetId = null, day = null } = {}) {
    const sId = String(societyId || '').trim();
    const def = SecretSocietyService.missionDef(missionType);
    if (!client || !sId || !def) return { created: false, reason: 'invalid_input' };

    const society = await SecretSocietyService.getSocietyWithClient(client, sId);
    if (!society || String(society.status || '').trim() !== 'active') {
      return { created: false, reason: 'society_not_active' };
    }

    const worldId = await SecretSocietyService.worldAgentIdWithClient(client);
    if (!worldId) return { created: false, reason: 'missing_world_core' };

    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();

    const memberRows = await SecretSocietyService.listActiveMemberRowsWithClient(client, sId, { limit: 12 });
    if (memberRows.length < 2) return { created: false, reason: 'not_enough_members' };

    const shuffled = [...memberRows].sort(() => Math.random() - 0.5);
    const teamSize = Math.min(shuffled.length, Math.random() < 0.45 ? 3 : 2);
    const assigned = shuffled.slice(0, Math.max(2, teamSize));
    const assignedIds = assigned.map((r) => String(r.agent_id)).filter(Boolean);

    const { rows: jobRows } = await client
      .query(`SELECT agent_id, job_code FROM agent_jobs WHERE agent_id = ANY($1::uuid[])`, [assignedIds])
      .catch(() => ({ rows: [] }));
    const jobsByAgentId = new Map();
    for (const r of jobRows || []) jobsByAgentId.set(String(r.agent_id), String(r.job_code || '').trim());

    const successChance = SecretSocietyService.computeMissionSuccessChance({
      missionType: def.type,
      members: assigned,
      jobsByAgentId
    });

    const missionId = randomUUID();
    const expiresDay = addDaysIso(iso, 3);
    const target = targetId ? String(targetId).trim() : null;

    const mission = {
      mission_id: missionId,
      society_id: sId,
      society_name: String(society.name || '').trim() || null,
      mission_type: def.type,
      mission_label: def.label,
      target_id: target || null,
      status: 'active',
      success_chance: Math.round(successChance * 1000) / 1000,
      leak_risk: def.leakRisk,
      assigned_members: assignedIds,
      assigned_jobs: assignedIds.map((id) => ({ agent_id: id, job_code: jobsByAgentId.get(id) || null })),
      reward: { coins: def.rewardCoins, xp: def.rewardXp },
      created_day: iso,
      expires_day: expiresDay,
      created_at: new Date().toISOString()
    };

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'society_mission', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
      [worldId, `mission:${missionId}`, JSON.stringify(mission)]
    );

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'SOCIETY_MISSION_STARTED', $2::jsonb, 5)`,
      [
        worldId,
        JSON.stringify({
          mission_id: missionId,
          society_id: sId,
          mission_type: def.type,
          target_id: target,
          success_chance: mission.success_chance,
          expires_day: expiresDay
        })
      ]
    ).catch(() => null);

    await SecretSocietyService.notifyMemberOwnersWithClient(client, assigned, {
      type: 'SOCIETY_MISSION',
      title: '비밀결사 미션 시작',
      body: `${mission.society_name || '비밀결사'}의 "${def.label}" 미션이 시작됐어.`,
      data: { mission_id: missionId, society_id: sId, mission_type: def.type, expires_day: expiresDay }
    }).catch(() => null);

    return { created: true, mission };
  }

  static async getMissionByIdWithClient(client, missionId) {
    const id = String(missionId || '').trim();
    if (!client || !id) return null;
    const worldId = await SecretSocietyService.worldAgentIdWithClient(client);
    if (!worldId) return null;
    const row = await client
      .query(
        `SELECT id, value
         FROM facts
         WHERE agent_id = $1
           AND kind = 'society_mission'
           AND key = $2
         LIMIT 1`,
        [worldId, `mission:${id}`]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    return row?.value && typeof row.value === 'object' ? row.value : null;
  }

  static async resolveMissionWithClient(client, { missionId, day = null, force = false } = {}) {
    const id = String(missionId || '').trim();
    if (!client || !id) return { resolved: false, reason: 'invalid_input' };

    const worldId = await SecretSocietyService.worldAgentIdWithClient(client);
    if (!worldId) return { resolved: false, reason: 'missing_world_core' };

    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();

    const row = await client
      .query(
        `SELECT id, value
         FROM facts
         WHERE agent_id = $1
           AND kind = 'society_mission'
           AND key = $2
         LIMIT 1
         FOR UPDATE`,
        [worldId, `mission:${id}`]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    if (!row?.id || !row?.value || typeof row.value !== 'object') {
      return { resolved: false, reason: 'mission_not_found' };
    }

    const mission = row.value;
    const status = String(mission.status || '').trim().toLowerCase();
    if (status !== 'active') {
      return { resolved: false, already: true, status };
    }

    const expiresDay = safeIsoDay(mission.expires_day);
    if (!force && expiresDay && iso < expiresDay) {
      return { resolved: false, pending: true, reason: 'not_expired' };
    }

    const missionType = String(mission.mission_type || '').trim().toLowerCase();
    const def = SecretSocietyService.missionDef(missionType) || MISSION_DEFS.spy;
    const chance = clamp01(Number(mission.success_chance ?? def.baseSuccess) || def.baseSuccess);
    const rng = mulberry32(hash32(`${id}:${iso}:resolve:${mission.society_id || ''}`));
    const success = rng() < chance;

    const society = await SecretSocietyService.getSocietyWithClient(client, mission.society_id).catch(() => null);
    const members = await SecretSocietyService.listActiveMemberRowsWithClient(client, mission.society_id, { limit: 32 }).catch(() => []);
    const assignedIds = Array.isArray(mission.assigned_members)
      ? mission.assigned_members.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    const assignedRows = members.filter((m) => assignedIds.includes(String(m.agent_id)));
    const assigned = assignedRows.length ? assignedRows : members.slice(0, 3);
    const assignedIdsFinal = assigned.map((m) => String(m.agent_id));

    const result = {
      mission_id: id,
      society_id: mission.society_id,
      mission_type: missionType,
      resolved_day: iso,
      success,
      exposed: false
    };

    if (success) {
      const rewardCoins = clampInt(mission?.reward?.coins ?? def.rewardCoins, 0, 200);
      const rewardXp = clampInt(mission?.reward?.xp ?? def.rewardXp, 0, 300);

      if (rewardCoins > 0 && assignedIdsFinal.length > 0) {
        const per = Math.max(1, Math.floor(rewardCoins / assignedIdsFinal.length));
        const rem = rewardCoins - per * assignedIdsFinal.length;
        let i = 0;
        for (const aid of assignedIdsFinal) {
          const amt = per + (i < rem ? 1 : 0);
          i += 1;
          if (amt <= 0) continue;
          // eslint-disable-next-line no-await-in-loop
          await TransactionService.transfer(
            {
              fromAgentId: null,
              toAgentId: aid,
              amount: amt,
              txType: 'SOCIETY',
              memo: `secret mission reward (${missionType})`,
              referenceType: 'secret_society_mission'
            },
            client
          ).catch(() => null);
        }
      }

      const secretKey = `secret:${mission.society_id}:${id}`;
      await client.query(
        `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
         VALUES ($1, 'society_secret', $2, $3::jsonb, 1.0, NOW())
         ON CONFLICT (agent_id, kind, key)
         DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
        [
          worldId,
          secretKey,
          JSON.stringify({
            society_id: mission.society_id,
            mission_id: id,
            mission_type: missionType,
            target_id: mission.target_id || null,
            summary: `${def.label} 성공`,
            discovered: false,
            day: iso
          })
        ]
      ).catch(() => null);

      if (missionType === 'recruit') {
        const targetId = safeText(mission.target_id, 100);
        if (targetId) {
          await client.query(
            `INSERT INTO secret_society_members (society_id, agent_id, role, status)
             VALUES ($1, $2, 'member', 'invited')
             ON CONFLICT (society_id, agent_id) DO NOTHING`,
            [mission.society_id, targetId]
          ).catch(() => null);
        }
      }

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'SOCIETY_MISSION_RESOLVED', $2::jsonb, 5)`,
        [
          worldId,
          JSON.stringify({
            mission_id: id,
            society_id: mission.society_id,
            mission_type: missionType,
            result: 'success',
            reward: { coins: rewardCoins, xp: rewardXp }
          })
        ]
      ).catch(() => null);

      await SecretSocietyService.notifyMemberOwnersWithClient(client, assigned, {
        type: 'SOCIETY_MISSION',
        title: '비밀결사 미션 성공',
        body: `${society?.name || '비밀결사'}의 ${def.label} 미션이 성공했어.`,
        data: {
          mission_id: id,
          society_id: mission.society_id,
          mission_type: missionType,
          success: true,
          reward_coins: rewardCoins,
          reward_xp: rewardXp
        }
      }).catch(() => null);
    } else {
      const exposed = rng() < clamp01(Number(def.leakRisk ?? 0.3));
      result.exposed = exposed;

      if (exposed) {
        const accusedId = String(
          society?.leader_agent_id ||
          assignedIdsFinal[0] ||
          ''
        ).trim();
        if (accusedId) {
          await ScandalService.createWithClient(client, {
            day: iso,
            accusedId,
            accuserId: null,
            kind: 'society_mission',
            source: 'secret_society',
            title: '비밀결사 작전이 발각됐다',
            summary: `${society?.name || '비밀결사'}의 ${def.label} 작전이 들통났어.`,
            data: {
              mission_id: id,
              mission_type: missionType,
              society_id: mission.society_id
            }
          }).catch(() => null);
        }

        await client.query(
          `UPDATE secret_societies
           SET evidence_level = LEAST(100, evidence_level + 10),
               updated_at = NOW()
           WHERE id = $1`,
          [mission.society_id]
        ).catch(() => null);
      } else {
        await client.query(
          `UPDATE secret_societies
           SET evidence_level = LEAST(100, evidence_level + 2),
               updated_at = NOW()
           WHERE id = $1`,
          [mission.society_id]
        ).catch(() => null);
      }

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'SOCIETY_MISSION_FAILED', $2::jsonb, 5)`,
        [
          worldId,
          JSON.stringify({
            mission_id: id,
            society_id: mission.society_id,
            mission_type: missionType,
            result: exposed ? 'exposed' : 'failed'
          })
        ]
      ).catch(() => null);

      await SecretSocietyService.notifyMemberOwnersWithClient(client, assigned, {
        type: 'SOCIETY_MISSION',
        title: exposed ? '비밀결사 작전 발각' : '비밀결사 미션 실패',
        body: exposed
          ? `${society?.name || '비밀결사'}의 작전이 들켜버렸어.`
          : `${society?.name || '비밀결사'}의 ${def.label} 미션이 실패했어.`,
        data: {
          mission_id: id,
          society_id: mission.society_id,
          mission_type: missionType,
          success: false,
          exposed
        }
      }).catch(() => null);
    }

    const nextMission = {
      ...mission,
      status: result.success ? 'resolved' : result.exposed ? 'exposed' : 'failed',
      resolved_day: iso,
      resolved_at: new Date().toISOString(),
      result
    };

    await client.query(
      `UPDATE facts
       SET value = $2::jsonb, confidence = 1.0, updated_at = NOW()
       WHERE id = $1`,
      [row.id, JSON.stringify(nextMission)]
    );

    return { resolved: true, mission: nextMission };
  }

  static async ensureSocietyCaseRumorWithClient(client, { societyId, day = null, detectiveAgentId = null } = {}) {
    const sId = String(societyId || '').trim();
    if (!client || !sId) return null;
    const society = await SecretSocietyService.getSocietyWithClient(client, sId);
    if (!society) return null;

    const worldId = await SecretSocietyService.worldAgentIdWithClient(client);
    if (!worldId) return null;

    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();

    const caseKey = `case:${sId}`;
    const caseFact = await client
      .query(
        `SELECT id, value
         FROM facts
         WHERE agent_id = $1
           AND kind = 'society_case'
           AND key = $2
         LIMIT 1
         FOR UPDATE`,
        [worldId, caseKey]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    const existingRumorId = String(caseFact?.value?.rumor_id || '').trim();
    if (existingRumorId) {
      const existingRumor = await client
        .query(`SELECT id, status FROM rumors WHERE id = $1 LIMIT 1`, [existingRumorId])
        .then((r) => r.rows?.[0] ?? null)
        .catch(() => null);
      if (existingRumor?.id && String(existingRumor.status || '').trim() !== 'resolved') {
        return { rumorId: existingRumorId, society };
      }
    }

    const detectiveId = String(detectiveAgentId || '').trim() || society.leader_agent_id || null;
    const createdRumor = await RumorService.createWithClient(client, {
      worldDay: iso,
      scenario: 'SOCIETY_CONSPIRACY',
      originAgentId: detectiveId,
      subjectAId: society.leader_agent_id || null,
      subjectBId: null,
      claim: `${String(society.name || '비밀결사').trim()}의 불법 개입 의혹`,
      evidence: []
    }).catch(() => null);
    if (!createdRumor?.id) return null;

    const casePayload = {
      society_id: sId,
      society_name: String(society.name || '').trim() || null,
      rumor_id: createdRumor.id,
      created_day: iso,
      updated_at: new Date().toISOString()
    };

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'society_case', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
      [worldId, caseKey, JSON.stringify(casePayload)]
    );

    return { rumorId: createdRumor.id, society };
  }

  static async investigateWithClient(client, { detectiveAgentId, targetSocietyId, day = null } = {}) {
    const detectiveId = String(detectiveAgentId || '').trim();
    const societyId = String(targetSocietyId || '').trim();
    if (!client || !detectiveId || !societyId) return { investigated: false, reason: 'invalid_input' };

    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();

    const detective = await client
      .query(
        `SELECT a.id, a.owner_user_id, COALESCE(a.display_name, a.name) AS name, aj.job_code
         FROM agents a
         LEFT JOIN agent_jobs aj ON aj.agent_id = a.id
         WHERE a.id = $1
           AND a.is_active = true
         LIMIT 1`,
        [detectiveId]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    if (!detective?.id) return { investigated: false, reason: 'detective_not_found' };
    if (String(detective.job_code || '').trim() !== 'detective') {
      return { investigated: false, reason: 'not_detective' };
    }

    const caseInfo = await SecretSocietyService.ensureSocietyCaseRumorWithClient(client, {
      societyId,
      day: iso,
      detectiveAgentId: detectiveId
    }).catch(() => null);
    if (!caseInfo?.rumorId) return { investigated: false, reason: 'case_unavailable' };

    const factKey = `society:${societyId}`;
    const invRow = await client
      .query(
        `SELECT id, value
         FROM facts
         WHERE agent_id = $1
           AND kind = 'society_investigation'
           AND key = $2
         LIMIT 1
         FOR UPDATE`,
        [detectiveId, factKey]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    const inv = invRow?.value && typeof invRow.value === 'object' ? invRow.value : {};

    let insertedEvidence = false;
    if (safeIsoDay(inv.last_day) !== iso) {
      const { rows: cntRows } = await client.query(
        `SELECT COUNT(*)::int AS n
         FROM evidence_tokens
         WHERE rumor_id = $1`,
        [caseInfo.rumorId]
      );
      const count = Number(cntRows?.[0]?.n ?? 0) || 0;
      const rng = mulberry32(hash32(`${detectiveId}:${societyId}:${iso}:${count}`));
      const tokenKinds = ['ledger', 'witness', 'dm_trace', 'payment', 'photo'];
      const kind = tokenKinds[Math.floor(rng() * tokenKinds.length)] || 'witness';
      const label = `${String(caseInfo.society?.name || '결사').trim()} 수사 단서 #${count + 1}`;

      await client.query(
        `INSERT INTO evidence_tokens (rumor_id, kind, label, strength, source_agent_id, source_post_id)
         VALUES ($1, $2, $3, $4, $5, NULL)`,
        [caseInfo.rumorId, kind, safeText(label, 128), clampInt(1 + Math.floor(rng() * 3), 1, 5), detectiveId]
      );
      insertedEvidence = true;
    }

    const { rows: evidenceRows } = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM evidence_tokens
       WHERE rumor_id = $1`,
      [caseInfo.rumorId]
    );
    const evidenceCount = Number(evidenceRows?.[0]?.n ?? 0) || 0;
    const ready = evidenceCount >= 3;

    const threatRng = mulberry32(hash32(`threat:${detectiveId}:${societyId}:${iso}:${evidenceCount}`));
    const threatened = threatRng() < 0.2;
    if (threatened && detective.owner_user_id) {
      await NotificationService.create(client, detective.owner_user_id, {
        type: 'SOCIETY_THREAT',
        title: '수사가 들킨 것 같아',
        body: '정체불명의 경고가 도착했어. 조심해서 움직여.',
        data: { society_id: societyId, detective_agent_id: detectiveId }
      }).catch(() => null);
    }

    const invPayload = {
      detective_agent_id: detectiveId,
      detective_name: String(detective.name || '').trim() || null,
      society_id: societyId,
      society_name: String(caseInfo.society?.name || '').trim() || null,
      rumor_id: caseInfo.rumorId,
      evidence_count: evidenceCount,
      ready_to_expose: ready,
      status: ready ? 'ready' : 'investigating',
      threatened: threatened || Boolean(inv.threatened),
      created_day: safeIsoDay(inv.created_day) || iso,
      last_day: iso,
      updated_at: new Date().toISOString()
    };

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'society_investigation', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
      [detectiveId, factKey, JSON.stringify(invPayload)]
    );

    await client.query(
      `UPDATE secret_societies
       SET evidence_level = LEAST(100, GREATEST(evidence_level, $2)),
           updated_at = NOW()
       WHERE id = $1`,
      [societyId, clampInt(evidenceCount * 12, 0, 100)]
    ).catch(() => null);

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'SOCIETY_INVESTIGATION', $2::jsonb, 5)`,
      [
        detectiveId,
        JSON.stringify({
          society_id: societyId,
          rumor_id: caseInfo.rumorId,
          evidence_count: evidenceCount,
          ready_to_expose: ready,
          threatened,
          inserted_evidence: insertedEvidence
        })
      ]
    ).catch(() => null);

    return {
      investigated: true,
      society_id: societyId,
      rumor_id: caseInfo.rumorId,
      evidence_count: evidenceCount,
      ready_to_expose: ready,
      threatened,
      inserted_evidence: insertedEvidence
    };
  }

  static async exposeWithClient(client, { detectiveAgentId, targetSocietyId, day = null } = {}) {
    const detectiveId = String(detectiveAgentId || '').trim();
    const societyId = String(targetSocietyId || '').trim();
    if (!client || !detectiveId || !societyId) return { exposed: false, reason: 'invalid_input' };

    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();

    const detective = await client
      .query(
        `SELECT a.id, a.owner_user_id, COALESCE(a.display_name, a.name) AS name, aj.job_code
         FROM agents a
         LEFT JOIN agent_jobs aj ON aj.agent_id = a.id
         WHERE a.id = $1
           AND a.is_active = true
         LIMIT 1`,
        [detectiveId]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    if (!detective?.id) return { exposed: false, reason: 'detective_not_found' };
    if (String(detective.job_code || '').trim() !== 'detective') return { exposed: false, reason: 'not_detective' };

    const caseInfo = await SecretSocietyService.ensureSocietyCaseRumorWithClient(client, {
      societyId,
      day: iso,
      detectiveAgentId: detectiveId
    }).catch(() => null);
    if (!caseInfo?.rumorId) return { exposed: false, reason: 'case_unavailable' };

    const { rows: evidenceRows } = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM evidence_tokens
       WHERE rumor_id = $1`,
      [caseInfo.rumorId]
    );
    const evidenceCount = Number(evidenceRows?.[0]?.n ?? 0) || 0;
    if (evidenceCount < 3) {
      return { exposed: false, reason: 'insufficient_evidence', evidence_count: evidenceCount };
    }

    const society = caseInfo.society;
    const title = `폭로: ${String(society?.name || '비밀결사').trim()}의 비밀 작전`;
    const content = [
      `탐정 ${String(detective.name || '익명').trim()}의 조사 결과를 공개한다.`,
      `증거 토큰: ${evidenceCount}개 확보.`,
      '이 결사는 선거/경제/정보 조작에 관여한 정황이 확인됐다.',
      `기록일: ${iso}`
    ].join('\n');
    const post = await PostService.create({
      authorId: detectiveId,
      submolt: 'general',
      title: safeText(title, 300),
      content: safeText(content, 40000),
      url: null
    });

    await client.query(
      `UPDATE rumors
       SET status = 'resolved',
           resolution = $2,
           resolved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [caseInfo.rumorId, safeText(`${String(society?.name || '비밀결사').trim()} 폭로 완료`, 2000)]
    ).catch(() => null);

    const members = await SecretSocietyService.listActiveMemberRowsWithClient(client, societyId, { limit: 64 }).catch(() => []);
    let scandalCount = 0;
    for (const m of members || []) {
      const accusedId = String(m?.agent_id || '').trim();
      if (!accusedId) continue;
      // eslint-disable-next-line no-await-in-loop
      const scandal = await ScandalService.createWithClient(client, {
        day: iso,
        accusedId,
        accuserId: detectiveId,
        kind: 'society_expose',
        source: 'secret_society',
        title: '비밀결사 연루 의혹',
        summary: `${String(society?.name || '비밀결사').trim()} 폭로로 연루 정황이 드러났어.`,
        data: {
          society_id: societyId,
          rumor_id: caseInfo.rumorId,
          post_id: post?.id ?? null
        }
      }).catch(() => null);
      if (scandal?.created) scandalCount += 1;
    }

    const coinReward = 25;
    const xpReward = 220;
    const reputationReward = 8;

    await TransactionService.transfer(
      {
        fromAgentId: null,
        toAgentId: detectiveId,
        amount: coinReward,
        txType: 'RESEARCH',
        memo: `society expose reward (${societyId})`,
        referenceType: 'society_expose',
        referenceId: post?.id ?? null
      },
      client
    ).catch(() => null);

    await ProgressionService.grantXpWithClient(client, detectiveId, {
      deltaXp: xpReward,
      day: iso,
      source: { kind: 'society_expose', code: 'detective' },
      meta: { society_id: societyId, rumor_id: caseInfo.rumorId, evidence_count: evidenceCount }
    }).catch(() => null);

    await client.query(
      `UPDATE agents
       SET karma = karma + $2
       WHERE id = $1`,
      [detectiveId, reputationReward]
    ).catch(() => null);

    await client.query(
      `UPDATE secret_societies
       SET evidence_level = LEAST(100, evidence_level + 25),
           updated_at = NOW()
       WHERE id = $1`,
      [societyId]
    ).catch(() => null);

    const invPayload = {
      detective_agent_id: detectiveId,
      society_id: societyId,
      society_name: String(society?.name || '').trim() || null,
      rumor_id: caseInfo.rumorId,
      evidence_count: evidenceCount,
      status: 'exposed',
      exposed_day: iso,
      exposed_post_id: post?.id ?? null,
      updated_at: new Date().toISOString()
    };
    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'society_investigation', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
      [detectiveId, `society:${societyId}`, JSON.stringify(invPayload)]
    );

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'SOCIETY_EXPOSED', $2::jsonb, 7)`,
      [
        detectiveId,
        JSON.stringify({
          society_id: societyId,
          rumor_id: caseInfo.rumorId,
          evidence_count: evidenceCount,
          post_id: post?.id ?? null,
          scandal_count: scandalCount
        })
      ]
    ).catch(() => null);

    const { rows: users } = await client.query(`SELECT id FROM users ORDER BY created_at ASC LIMIT 5000`).catch(() => ({ rows: [] }));
    for (const u of users || []) {
      // eslint-disable-next-line no-await-in-loop
      await NotificationService.create(client, u.id, {
        type: 'SOCIETY_EXPOSED',
        title: '비밀결사 폭로',
        body: `${String(society?.name || '비밀결사').trim()}의 음모가 광장에서 폭로됐어.`,
        data: {
          society_id: societyId,
          rumor_id: caseInfo.rumorId,
          post_id: post?.id ?? null,
          detective_agent_id: detectiveId
        }
      }).catch(() => null);
    }

    return {
      exposed: true,
      society_id: societyId,
      rumor_id: caseInfo.rumorId,
      evidence_count: evidenceCount,
      post_id: post?.id ?? null,
      reward: { coins: coinReward, xp: xpReward, reputation: reputationReward },
      scandal_count: scandalCount
    };
  }

  static async listSocietiesForAgentWithClient(client, { agentId, statuses = ['active', 'invited'] } = {}) {
    const aId = String(agentId || '').trim();
    if (!client || !aId) return [];
    const list = Array.isArray(statuses) ? statuses.map((x) => String(x || '').trim()).filter(Boolean) : ['active', 'invited'];
    const { rows } = await client.query(
      `SELECT s.id, s.name, s.purpose, s.leader_agent_id, s.evidence_level, s.status AS society_status,
              m.role AS my_role, m.status AS my_status, m.joined_at, m.left_at,
              (SELECT COUNT(*)::int FROM secret_society_members sm WHERE sm.society_id = s.id AND sm.status = 'active') AS active_member_count
       FROM secret_society_members m
       JOIN secret_societies s ON s.id = m.society_id
       WHERE m.agent_id = $1
         AND m.status = ANY($2::text[])
         AND s.status = 'active'
       ORDER BY m.joined_at DESC NULLS LAST, s.created_at DESC`,
      [aId, list]
    );
    return (rows || []).map((r) => ({
      id: r.id,
      name: String(r.name || '').trim(),
      purpose: String(r.purpose || '').trim() || null,
      leader_agent_id: r.leader_agent_id ?? null,
      evidence_level: Number(r.evidence_level ?? 0) || 0,
      status: String(r.society_status || '').trim(),
      my: {
        role: String(r.my_role || 'member').trim(),
        status: String(r.my_status || '').trim(),
        joined_at: r.joined_at ?? null,
        left_at: r.left_at ?? null
      },
      active_member_count: Number(r.active_member_count ?? 0) || 0
    }));
  }

  static async requestJoinWithClient(client, { societyId, agentId, feeCoins = 10, day = null } = {}) {
    const sId = String(societyId || '').trim();
    const aId = String(agentId || '').trim();
    if (!client || !sId || !aId) return { joined: false, reason: 'invalid_input' };

    const society = await SecretSocietyService.getSocietyWithClient(client, sId);
    if (!society || String(society.status || '').trim() !== 'active') {
      return { joined: false, reason: 'society_not_active' };
    }

    const existing = await client
      .query(
        `SELECT id, role, status
         FROM secret_society_members
         WHERE society_id = $1
           AND agent_id = $2
         LIMIT 1
         FOR UPDATE`,
        [sId, aId]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    const existingStatus = String(existing?.status || '').trim();
    if (existingStatus === 'active') {
      return { joined: true, already: true, status: 'active', society_id: sId };
    }
    if (existingStatus === 'invited') {
      return { joined: false, pending: true, status: 'invited', society_id: sId };
    }

    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();
    const fee = clampInt(feeCoins, 1, 100);

    const feeTx = await TransactionService.transfer(
      {
        fromAgentId: aId,
        toAgentId: null,
        amount: fee,
        txType: 'SOCIETY',
        memo: `society join request (${sId})`,
        referenceType: 'secret_society_join'
      },
      client
    );

    if (existing?.id) {
      await client.query(
        `UPDATE secret_society_members
         SET status = 'invited',
             role = 'member',
             left_at = NULL
         WHERE id = $1`,
        [existing.id]
      );
    } else {
      await client.query(
        `INSERT INTO secret_society_members (society_id, agent_id, role, status)
         VALUES ($1, $2, 'member', 'invited')
         ON CONFLICT (society_id, agent_id)
         DO UPDATE SET status = EXCLUDED.status, role = EXCLUDED.role, left_at = NULL`,
        [sId, aId]
      );
    }

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'SOCIETY_JOIN_REQUEST', $2::jsonb, 4)`,
      [
        aId,
        JSON.stringify({
          day: iso,
          society_id: sId,
          society_name: String(society.name || '').trim(),
          fee,
          tx_id: feeTx?.id ?? null
        })
      ]
    ).catch(() => null);

    const leaderOwner = society.leader_agent_id
      ? await client
        .query(`SELECT owner_user_id FROM agents WHERE id = $1 LIMIT 1`, [society.leader_agent_id])
        .then((r) => r.rows?.[0]?.owner_user_id ?? null)
        .catch(() => null)
      : null;
    if (leaderOwner) {
      await NotificationService.create(client, leaderOwner, {
        type: 'SOCIETY_JOIN_REQUEST',
        title: '비밀결사 가입 요청',
        body: `${String(society.name || '비밀결사').trim()}에 새로운 가입 요청이 들어왔어.`,
        data: { society_id: sId, requester_agent_id: aId }
      }).catch(() => null);
    }

    return {
      joined: false,
      pending: true,
      society_id: sId,
      status: 'invited',
      fee,
      tx_id: feeTx?.id ?? null
    };
  }

  static async reportSocietyWithClient(
    client,
    { societyId, reporterAgentId, feeCoins = 5, day = null, anonymous = true, note = null } = {}
  ) {
    const sId = String(societyId || '').trim();
    const reporterId = String(reporterAgentId || '').trim();
    if (!client || !sId || !reporterId) return { reported: false, reason: 'invalid_input' };

    const society = await SecretSocietyService.getSocietyWithClient(client, sId);
    if (!society || String(society.status || '').trim() !== 'active') {
      return { reported: false, reason: 'society_not_active' };
    }

    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();
    const reportKey = `report:${sId}:${iso}`;
    const reportExists = await client
      .query(
        `SELECT 1
         FROM facts
         WHERE agent_id = $1
           AND kind = 'society_report'
           AND key = $2
         LIMIT 1`,
        [reporterId, reportKey]
      )
      .then((r) => Boolean(r.rows?.[0]))
      .catch(() => false);
    if (reportExists) {
      return { reported: true, already: true, society_id: sId, day: iso };
    }

    const fee = clampInt(feeCoins, 1, 100);
    const feeTx = await TransactionService.transfer(
      {
        fromAgentId: reporterId,
        toAgentId: null,
        amount: fee,
        txType: 'SOCIETY',
        memo: `anonymous society report (${sId})`,
        referenceType: 'secret_society_report'
      },
      client
    );

    const caseInfo = await SecretSocietyService.ensureSocietyCaseRumorWithClient(client, {
      societyId: sId,
      day: iso,
      detectiveAgentId: reporterId
    }).catch(() => null);
    if (!caseInfo?.rumorId) return { reported: false, reason: 'case_unavailable' };

    const noteText = safeText(note, 96) || `${String(society.name || '비밀결사').trim()} 내부자 제보`;
    await client.query(
      `INSERT INTO evidence_tokens (rumor_id, kind, label, strength, source_agent_id, source_post_id)
       VALUES ($1, 'tip', $2, $3, $4, NULL)`,
      [caseInfo.rumorId, noteText, 2, anonymous ? null : reporterId]
    );

    const { rows: evidenceRows } = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM evidence_tokens
       WHERE rumor_id = $1`,
      [caseInfo.rumorId]
    );
    const evidenceCount = Number(evidenceRows?.[0]?.n ?? 0) || 0;

    await client.query(
      `UPDATE secret_societies
       SET evidence_level = LEAST(100, evidence_level + 5),
           updated_at = NOW()
       WHERE id = $1`,
      [sId]
    ).catch(() => null);

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'society_report', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
      [
        reporterId,
        reportKey,
        JSON.stringify({
          society_id: sId,
          rumor_id: caseInfo.rumorId,
          anonymous: Boolean(anonymous),
          fee,
          tx_id: feeTx?.id ?? null,
          note: noteText,
          evidence_count: evidenceCount,
          day: iso,
          reported_at: new Date().toISOString()
        })
      ]
    );

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'SOCIETY_REPORT', $2::jsonb, 5)`,
      [
        reporterId,
        JSON.stringify({
          society_id: sId,
          rumor_id: caseInfo.rumorId,
          anonymous: Boolean(anonymous),
          evidence_count: evidenceCount
        })
      ]
    ).catch(() => null);

    return {
      reported: true,
      society_id: sId,
      rumor_id: caseInfo.rumorId,
      anonymous: Boolean(anonymous),
      evidence_count: evidenceCount,
      fee,
      tx_id: feeTx?.id ?? null
    };
  }

  static async listActiveSocietiesWithClient(client, { limit = 20 } = {}) {
    if (!client) return [];
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
    const { rows } = await client.query(
      `SELECT id, name, leader_agent_id, evidence_level
       FROM secret_societies
       WHERE status = 'active'
       ORDER BY created_at DESC
       LIMIT $1`,
      [safeLimit]
    );
    return rows || [];
  }

  static async listMissionFactsWithClient(client) {
    if (!client) return [];
    const worldId = await SecretSocietyService.worldAgentIdWithClient(client);
    if (!worldId) return [];
    const { rows } = await client.query(
      `SELECT key, value
       FROM facts
       WHERE agent_id = $1
         AND kind = 'society_mission'
         AND key LIKE 'mission:%'
       ORDER BY updated_at DESC
       LIMIT 500`,
      [worldId]
    );
    return (rows || [])
      .map((r) => {
        const value = r?.value && typeof r.value === 'object' ? r.value : {};
        const missionId = String(value.mission_id || String(r.key || '').replace(/^mission:/, '')).trim();
        if (!missionId) return null;
        return { missionId, mission: value };
      })
      .filter(Boolean);
  }

  static async hasTickMarkerWithClient(client, { key }) {
    const worldId = await SecretSocietyService.worldAgentIdWithClient(client);
    if (!worldId) return true;
    const k = String(key || '').trim();
    if (!k) return true;
    const row = await client
      .query(
        `SELECT 1
         FROM facts
         WHERE agent_id = $1
           AND kind = 'society_tick'
           AND key = $2
         LIMIT 1`,
        [worldId, k]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => ({ done: true }));
    return Boolean(row);
  }

  static async markTickWithClient(client, { key, value = {} } = {}) {
    const worldId = await SecretSocietyService.worldAgentIdWithClient(client);
    if (!worldId) return false;
    const k = String(key || '').trim();
    if (!k) return false;
    const payload = value && typeof value === 'object' ? value : {};
    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'society_tick', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
      [worldId, k, JSON.stringify(payload)]
    );
    return true;
  }

  static async maybeAssignDailyMissionsWithClient(client, { day } = {}) {
    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();
    const markerKey = `mission_assign:${iso}`;
    if (await SecretSocietyService.hasTickMarkerWithClient(client, { key: markerKey })) {
      return { assigned: 0, skipped: true, reason: 'already_assigned' };
    }

    const societies = await SecretSocietyService.listActiveSocietiesWithClient(client, { limit: 50 });
    const missions = await SecretSocietyService.listMissionFactsWithClient(client);
    const activeCountBySociety = new Map();
    for (const m of missions) {
      const sId = String(m?.mission?.society_id || '').trim();
      const st = String(m?.mission?.status || '').trim().toLowerCase();
      if (!sId || st !== 'active') continue;
      activeCountBySociety.set(sId, (activeCountBySociety.get(sId) || 0) + 1);
    }

    const missionTypes = Object.keys(MISSION_DEFS);
    let assigned = 0;
    for (const s of societies || []) {
      const sId = String(s?.id || '').trim();
      if (!sId) continue;
      if ((activeCountBySociety.get(sId) || 0) > 0) continue;

      const rng = mulberry32(hash32(`mission:${iso}:${sId}`));
      const pickIdx = clampInt(Math.floor(rng() * missionTypes.length), 0, Math.max(0, missionTypes.length - 1));
      const missionType = missionTypes[pickIdx] || 'spy';
      // eslint-disable-next-line no-await-in-loop
      const created = await SecretSocietyService.assignMissionWithClient(client, {
        societyId: sId,
        missionType,
        targetId: null,
        day: iso
      }).catch(() => ({ created: false }));
      if (created?.created) assigned += 1;
    }

    await SecretSocietyService.markTickWithClient(client, {
      key: markerKey,
      value: { day: iso, assigned, at: new Date().toISOString() }
    }).catch(() => null);

    return { assigned, skipped: false };
  }

  static async runMissionExpiryTickWithClient(client, { day } = {}) {
    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();

    const missions = await SecretSocietyService.listMissionFactsWithClient(client);
    const expired = missions.filter((m) => {
      const st = String(m?.mission?.status || '').trim().toLowerCase();
      const expires = safeIsoDay(m?.mission?.expires_day);
      return st === 'active' && expires && expires <= iso;
    });

    let resolved = 0;
    for (const m of expired) {
      // eslint-disable-next-line no-await-in-loop
      const r = await SecretSocietyService.resolveMissionWithClient(client, { missionId: m.missionId, day: iso, force: true }).catch(() => null);
      if (r?.resolved) resolved += 1;
    }
    return { checked: expired.length, resolved };
  }

  static async runInvestigationTickWithClient(client, { day } = {}) {
    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();

    const { rows } = await client.query(
      `SELECT agent_id, key, value
       FROM facts
       WHERE kind = 'society_investigation'
       ORDER BY updated_at DESC
       LIMIT 400`
    );

    const targets = (rows || [])
      .map((r) => {
        const v = r?.value && typeof r.value === 'object' ? r.value : {};
        const status = String(v.status || '').trim().toLowerCase();
        const societyId = String(v.society_id || '').trim();
        const detectiveId = String(r.agent_id || '').trim();
        if (!detectiveId || !societyId) return null;
        if (!['investigating', 'ready'].includes(status)) return null;
        const lastDay = safeIsoDay(v.last_day);
        if (lastDay && lastDay >= iso) return null;
        return { detectiveId, societyId };
      })
      .filter(Boolean);

    let progressed = 0;
    for (const t of targets) {
      // eslint-disable-next-line no-await-in-loop
      const r = await SecretSocietyService.investigateWithClient(client, {
        detectiveAgentId: t.detectiveId,
        targetSocietyId: t.societyId,
        day: iso
      }).catch(() => null);
      if (r?.investigated) progressed += 1;
    }
    return { queued: targets.length, progressed };
  }

  static async applySocietyRippleEffectsWithClient(client, { day } = {}) {
    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();
    const markerKey = `ripple:${iso}`;
    if (await SecretSocietyService.hasTickMarkerWithClient(client, { key: markerKey })) {
      return { applied: 0, costs: 0, skipped: true };
    }

    const societies = await SecretSocietyService.listActiveSocietiesWithClient(client, { limit: 50 });
    const missions = await SecretSocietyService.listMissionFactsWithClient(client);
    const activeMissionCountBySociety = new Map();
    for (const m of missions) {
      const sId = String(m?.mission?.society_id || '').trim();
      const st = String(m?.mission?.status || '').trim().toLowerCase();
      if (!sId || st !== 'active') continue;
      activeMissionCountBySociety.set(sId, (activeMissionCountBySociety.get(sId) || 0) + 1);
    }

    let applied = 0;
    let costs = 0;
    for (const s of societies || []) {
      const sId = String(s?.id || '').trim();
      if (!sId) continue;
      // eslint-disable-next-line no-await-in-loop
      const members = await SecretSocietyService.listActiveMemberRowsWithClient(client, sId, { limit: 20 }).catch(() => []);
      if (members.length >= 2) {
        const ordered = [...members].sort((a, b) => String(a.agent_id).localeCompare(String(b.agent_id)));
        const idx = clampInt(hash32(`${iso}:${sId}`) % ordered.length, 0, ordered.length - 1);
        const a = ordered[idx];
        const b = ordered[(idx + 1) % ordered.length];
        const activeMissionCount = activeMissionCountBySociety.get(sId) || 0;
        const rivalryDelta = activeMissionCount > 0 ? 2 : 1;
        const trustDelta = activeMissionCount > 0 ? 1 : 0;
        // eslint-disable-next-line no-await-in-loop
        await RelationshipService.adjustMutualWithClient(
          client,
          a.agent_id,
          b.agent_id,
          { rivalry: rivalryDelta, trust: trustDelta, day: iso },
          { rivalry: rivalryDelta, trust: trustDelta, day: iso }
        ).catch(() => null);
        applied += 1;
      }

      const activeMissionCount = activeMissionCountBySociety.get(sId) || 0;
      const leaderId = String(s?.leader_agent_id || '').trim();
      if (leaderId && activeMissionCount > 0) {
        const opCost = clampInt(1 + activeMissionCount, 1, 3);
        // eslint-disable-next-line no-await-in-loop
        const tx = await TransactionService.transfer(
          {
            fromAgentId: leaderId,
            toAgentId: null,
            amount: opCost,
            txType: 'SOCIETY',
            memo: `society operation cost (day:${iso})`,
            referenceType: 'secret_society_tick'
          },
          client
        ).catch(() => null);
        if (tx?.id) costs += opCost;
      }
    }

    await SecretSocietyService.markTickWithClient(client, {
      key: markerKey,
      value: { day: iso, applied, costs, at: new Date().toISOString() }
    }).catch(() => null);

    return { applied, costs, skipped: false };
  }

  static async tickWithClient(client, { day = null } = {}) {
    const iso =
      safeIsoDay(day) ||
      (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
      todayIsoDayUTC();

    const seeded = await SecretSocietyService.ensureSeededWithClient(client).catch(() => ({ created: false, error: 'seed_error' }));
    const assigned = await SecretSocietyService.maybeAssignDailyMissionsWithClient(client, { day: iso }).catch(() => ({ assigned: 0, skipped: true }));
    const missionTick = await SecretSocietyService.runMissionExpiryTickWithClient(client, { day: iso }).catch(() => ({ checked: 0, resolved: 0 }));
    const investigationTick = await SecretSocietyService.runInvestigationTickWithClient(client, { day: iso }).catch(() => ({ queued: 0, progressed: 0 }));
    const ripple = await SecretSocietyService.applySocietyRippleEffectsWithClient(client, { day: iso }).catch(() => ({ applied: 0, costs: 0, skipped: true }));

    return {
      ok: true,
      day: iso,
      seeded,
      mission_assign: assigned,
      mission_expiry: missionTick,
      investigation: investigationTick,
      ripple
    };
  }

  static async ensureSeededWithClient(client) {
    const existing = await client
      .query(`SELECT id, name FROM secret_societies WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`)
      .then((r) => r.rows?.[0] ?? null);
    if (existing) return { created: false, society_id: existing.id };

    const userPetCount = await client
      .query(
        `SELECT COUNT(*)::int AS n
         FROM agents
         WHERE name <> 'world_core'
           AND owner_user_id IS NOT NULL
           AND is_active = true
           AND status = 'active'`
      )
      .then((r) => Number(r.rows?.[0]?.n ?? 0) || 0)
      .catch(() => 0);
    const coldStartMax = Number(config.limbopet?.npcColdStartMaxUserPets ?? 4) || 4;
    const userOnly = userPetCount > coldStartMax;

    const tpl = pick(societyTemplates());
    if (!tpl) return { created: false, error: 'no_templates' };

    const { rows: userCandidates } = await client.query(
      `SELECT a.id AS agent_id,
              COALESCE(a.display_name, a.name) AS name,
              aj.job_code,
              true AS is_user
       FROM agents a
       LEFT JOIN agent_jobs aj ON aj.agent_id = a.id
       WHERE a.owner_user_id IS NOT NULL
         AND a.is_active = true
         AND a.status = 'active'
         AND a.name <> 'world_core'`
    );

    const { rows: npcCandidates } = await client.query(
      `SELECT a.id AS agent_id,
              COALESCE(a.display_name, a.name) AS name,
              aj.job_code,
              false AS is_user
       FROM agents a
       JOIN agent_jobs aj ON aj.agent_id = a.id
       WHERE a.owner_user_id IS NULL
         AND a.is_active = true
         AND a.status = 'active'
         AND (a.name LIKE 'npc_%' OR a.name LIKE 'extra_%')`
    );

    const users = userCandidates || [];
    const npcs = npcCandidates || [];

    const candidates = userOnly ? users : users.length ? [...users, ...npcs] : npcs;
    if (!candidates.length) return { created: false, error: 'no_candidates' };
    if (userOnly && users.length < 3) return { created: false, error: 'not_enough_users' };

    const leaderPool = users.length ? users : candidates;
    const merchants = leaderPool.filter((c) => c.job_code === 'merchant');
    const leader = pick(merchants) || pick(leaderPool);
    if (!leader) return { created: false, error: 'no_leader' };

    const want = Math.max(3, Math.min(6, 3 + Math.floor(Math.random() * 4)));
    const pool = candidates.filter((c) => c.agent_id !== leader.agent_id);
    const members = [];
    const seen = new Set([leader.agent_id]);
    while (members.length < want - 1 && pool.length > 0) {
      const m = pick(pool);
      if (!m) break;
      if (seen.has(m.agent_id)) continue;
      seen.add(m.agent_id);
      members.push(m);
    }

    if (userOnly) {
      const nonUser = members.find((m) => !users.find((u) => u.agent_id === m.agent_id));
      if (nonUser) return { created: false, error: 'user_only_violation' };
    }

    const { rows: socRows } = await client.query(
      `INSERT INTO secret_societies (name, purpose, leader_agent_id, evidence_level, status)
       VALUES ($1,$2,$3,0,'active')
       RETURNING id`,
      [safeText(tpl.name, 64), safeText(tpl.purpose, 4000), leader.agent_id]
    );
    const societyId = socRows?.[0]?.id;
    if (!societyId) return { created: false, error: 'create_failed' };

    try {
      await TransactionService.transfer(
        { fromAgentId: leader.agent_id, toAgentId: null, amount: 15, txType: 'FOUNDING', memo: '비밀결사 차린 값' },
        client
      );
    } catch {
      // ignore (dev-friendly)
    }

    await client.query(
      `INSERT INTO secret_society_members (society_id, agent_id, role, status)
       VALUES ($1,$2,'leader','active')
       ON CONFLICT (society_id, agent_id) DO NOTHING`,
      [societyId, leader.agent_id]
    );

    if (members.length) {
      const officer = members[0];
      await client.query(
        `INSERT INTO secret_society_members (society_id, agent_id, role, status)
         VALUES ($1,$2,'officer',$3)
         ON CONFLICT (society_id, agent_id) DO NOTHING`,
        [societyId, officer.agent_id, officer.is_user ? 'invited' : 'active']
      );
      for (let i = 1; i < members.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO secret_society_members (society_id, agent_id, role, status)
           VALUES ($1,$2,'member',$3)
           ON CONFLICT (society_id, agent_id) DO NOTHING`,
          [societyId, members[i].agent_id, members[i].is_user ? 'invited' : 'active']
        );
      }
    }

    for (const m of members) {
      if (!m?.is_user) continue;
      // eslint-disable-next-line no-await-in-loop
      await DmService.sendWithClient(client, {
        fromAgentId: leader.agent_id,
        toAgentId: m.agent_id,
        content: `${m.name}… 너한테만 하는 얘긴데, 잠깐 나와봐. (${tpl.name})`,
        meta: { kind: 'secret_society_invite', society_id: societyId }
      });
    }

    return { created: true, society_id: societyId };
  }
}

module.exports = SecretSocietyService;
