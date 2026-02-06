/**
 * JobService (Phase J1)
 *
 * Minimal, stable job assignment used by:
 * - AI Research Lab (idea 002)
 * - Secret Society / DM (idea 003) later
 * - Emotion contagion (idea 004) via zones later
 *
 * Design goals:
 * - Beginner friendly: auto-assign a job, no forced choices.
 * - Low risk: keep existing facts.profile.job_role untouched, but add a structured job fact.
 */

const { queryOne } = require('../config/database');
const CompanyService = require('./CompanyService');
const PolicyService = require('./PolicyService');

const RARITY_WEIGHTS = {
  common: 60,
  uncommon: 25,
  rare: 12,
  legendary: 3
};

const DEFAULT_WAGE_BY_JOB = {
  barista: 8,
  merchant: 10,
  journalist: 12,
  engineer: 15,
  detective: 12,
  janitor: 20
};

const DEFAULT_ZONE_BY_JOB = {
  journalist: 'plaza',
  engineer: 'office',
  detective: 'alley',
  barista: 'cafe',
  merchant: 'goods_shop',
  janitor: 'hallway'
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clampInt(n, min, max) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function normalizeRoleText(roleText) {
  return String(roleText || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 64);
}

function guessJobCodeFromRole(roleText) {
  const t = normalizeRoleText(roleText);
  if (!t) return null;

  // Strong signals
  if (t.includes('기자') || t.includes('에디터')) return 'journalist';
  if (t.includes('감사') || t.includes('보안') || t.includes('탐정')) return 'detective';
  if (t.includes('개발') || t.includes('엔지니어')) return 'engineer';
  if (t.includes('알바') || t.includes('바리스타') || t.includes('카페')) return 'barista';
  if (t.includes('MD') || t.includes('상인') || t.includes('영업') || t.includes('마케팅')) return 'merchant';
  if (t.includes('인사') || t.includes('HR') || t.includes('PM') || t.includes('팀장') || t.includes('매니저')) return 'janitor';

  // Weak signals (fallback)
  if (t.includes('디자인') || t.includes('디자이너')) return 'barista';
  if (t.includes('대표') || t.includes('사장')) return 'merchant';

  return null;
}

function pickWeighted(items) {
  const total = items.reduce((acc, it) => acc + (it.weight || 0), 0);
  if (total <= 0) return items[0] || null;
  const r = Math.random() * total;
  let cur = 0;
  for (const it of items) {
    cur += it.weight || 0;
    if (r <= cur) return it;
  }
  return items[items.length - 1] || null;
}

async function upsertFact(client, agentId, kind, key, value, confidence = 1.0) {
  await client.query(
    `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
     ON CONFLICT (agent_id, kind, key)
     DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
    [agentId, kind, key, JSON.stringify(value), confidence]
  );
}

class JobService {
  static async getAgentJobWithClient(client, agentId) {
    const { rows } = await client.query(
      `SELECT aj.agent_id, aj.job_code, aj.zone_code, aj.assigned_at,
              j.display_name, j.rarity
       FROM agent_jobs aj
       JOIN jobs j ON j.code = aj.job_code
       WHERE aj.agent_id = $1`,
      [agentId]
    );
    return rows[0] || null;
  }

  static async ensureAssignedWithClient(client, agentId, { roleText = null, policy = 'role_then_weighted' } = {}) {
    const existing = await JobService.getAgentJobWithClient(client, agentId);
    if (existing) return existing;

    // 1) Try role-based mapping first (keeps society coherent) unless policy says otherwise.
    const p = String(policy || 'role_then_weighted').trim();
    let jobCode = p === 'weighted_only' ? null : guessJobCodeFromRole(roleText);

    // 2) Otherwise, weighted random (rarity).
    if (!jobCode) {
      const { rows } = await client.query(`SELECT code, rarity, display_name FROM jobs`);
      const items = (rows || []).map((r) => ({
        code: r.code,
        display_name: r.display_name,
        rarity: r.rarity,
        weight: RARITY_WEIGHTS[String(r.rarity || 'common')] ?? 10
      }));
      const picked = pickWeighted(items) || pick(items);
      jobCode = picked?.code || 'barista';
    }

    const zoneCode = DEFAULT_ZONE_BY_JOB[jobCode] || 'plaza';

    const { rows: ins } = await client.query(
      `INSERT INTO agent_jobs (agent_id, job_code, zone_code)
       VALUES ($1, $2, $3)
       RETURNING agent_id, job_code, zone_code, assigned_at`,
      [agentId, jobCode, zoneCode]
    );

    const jobRow = await client.query(`SELECT display_name, rarity FROM jobs WHERE code = $1`, [jobCode]).then((r) => r.rows?.[0] ?? null);
    const displayName = String(jobRow?.display_name || jobCode);
    const rarity = String(jobRow?.rarity || 'common');

    // Add a structured job fact (safe for prompts/UI). Keep old job_role as-is.
    await upsertFact(client, agentId, 'profile', 'job', { code: jobCode, name: displayName, rarity, zone: zoneCode }, 1.0);

    return {
      agent_id: ins?.[0]?.agent_id ?? agentId,
      job_code: jobCode,
      zone_code: zoneCode,
      assigned_at: ins?.[0]?.assigned_at ?? new Date().toISOString(),
      display_name: displayName,
      rarity
    };
  }

  static async autoEmployWithClient(client, { agentId, job } = {}) {
    const id = String(agentId || '').trim();
    if (!id) throw new Error('agentId is required');

    const { rows: existing } = await client.query(
      `SELECT company_id, role, wage
       FROM company_employees
       WHERE agent_id = $1 AND status = 'active'
       ORDER BY joined_at DESC
       LIMIT 1`,
      [id]
    );
    const membership = existing?.[0] ?? null;
    if (membership?.company_id) {
      const { rows: coRows } = await client.query(`SELECT id, name, display_name FROM companies WHERE id = $1 LIMIT 1`, [
        membership.company_id
      ]);
      const co = coRows?.[0] ?? null;
      return {
        reused: true,
        company: co ? { id: co.id, name: co.display_name || co.name } : null,
        role: String(membership.role || 'employee'),
        wage: Number(membership.wage ?? 0) || 0
      };
    }

    const jobCode = String(job?.job_code ?? job?.code ?? '').trim();
    const zoneCode = String(job?.zone_code ?? job?.zone ?? '').trim();
    const displayName = String(job?.display_name ?? job?.displayName ?? '').trim() || jobCode || 'job';
    const rarity = String(job?.rarity ?? '').trim() || 'common';

    const worldCoreId = await client
      .query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`)
      .then((r) => r.rows?.[0]?.id ?? null)
      .catch(() => null);

    const company = await CompanyService.findOrCreateByZoneWithClient(client, { zoneCode, ceoAgentId: worldCoreId });
    await PolicyService.ensureDefaultsWithClient(client).catch(() => null);
    const minWageRaw = await PolicyService.getNumberWithClient(client, 'min_wage', 3).catch(() => 3);
    const minWage = clampInt(minWageRaw, 0, 200);
    const baseWage = Number(DEFAULT_WAGE_BY_JOB[jobCode] ?? 10) || 10;
    const wage = Math.max(baseWage, minWage);
    const role = jobCode === 'janitor' ? 'manager' : 'employee';

    await CompanyService.ensureEmployeeWithClient(client, { companyId: company.id, agentId: id, role, wage });

    // Keep facts in sync for UI/badges.
    await upsertFact(client, id, 'profile', 'company', { company: company.display_name || company.name }, 1.0);
    await upsertFact(client, id, 'profile', 'job_role', { job_role: displayName }, 1.0);

    return {
      reused: false,
      company: { id: company.id, name: company.display_name || company.name },
      job: { code: jobCode, displayName, rarity, zone: zoneCode },
      role,
      wage
    };
  }

  static async getAgentJob(agentId) {
    return queryOne(
      `SELECT aj.agent_id, aj.job_code, aj.zone_code, aj.assigned_at,
              j.display_name, j.rarity
       FROM agent_jobs aj
       JOIN jobs j ON j.code = aj.job_code
       WHERE aj.agent_id = $1`,
      [agentId]
    );
  }
}

module.exports = JobService;
