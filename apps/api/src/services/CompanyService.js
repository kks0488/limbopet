/**
 * CompanyService
 *
 * Phase E1: companies + employees.
 *
 * Design:
 * - Each company has a wallet_agent_id (an agents row, is_active=false) so money can move via `transactions`.
 * - `companies.balance` is a cache (truth is SUM(transactions) on wallet_agent_id).
 */

const crypto = require('crypto');

const { transaction } = require('../config/database');
const { BadRequestError, ConflictError, NotFoundError } = require('../utils/errors');
const { generateApiKey, generateClaimToken, generateVerificationCode, hashToken } = require('../utils/auth');
const TransactionService = require('./TransactionService');
const PolicyService = require('./PolicyService');

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

function clampInt(n, min, max) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

const DEFAULT_COMPANIES = {
  cafe: ['새벽카페', '림보로스팅', '구름찻집'],
  goods_shop: ['리본굿즈', '림보마켓', '골목상점'],
  plaza: ['림보타임즈', '광장일보', '소문통신'],
  office: ['림보전자', '안개랩스', '코드공방'],
  alley: ['그림자사무소', '골목탐정단'],
  hallway: ['림보관리공단']
};

function shuffled(list) {
  const arr = [...(list || [])];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function normalizeCompanyName(name) {
  const n = safeText(name, 64);
  if (!n || n.length < 2) throw new BadRequestError('company name is required', 'BAD_COMPANY_NAME');
  return n;
}

function buildWalletAgentName(companyName) {
  // agents.name is limited to 32 chars and should be ASCII.
  const h = crypto.createHash('sha256').update(companyName).digest('hex').slice(0, 12);
  return `company_${h}`;
}

async function createWalletAgentWithClient(client, { companyName, displayName, description }) {
  const name = buildWalletAgentName(companyName);
  const apiKeyHash = hashToken(generateApiKey());
  const claimToken = generateClaimToken();
  const verificationCode = generateVerificationCode();

  // Wallet agents are not "pets": keep them inactive so SocialSim won't pick them.
  const { rows } = await client.query(
    `INSERT INTO agents (name, display_name, description, api_key_hash, claim_token, verification_code, status, is_claimed, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,'active',true,false)
     RETURNING id`,
    [
      name,
      safeText(displayName || companyName, 64),
      safeText(description || `${companyName} 금고`, 500),
      apiKeyHash,
      claimToken,
      verificationCode
    ]
  );
  return rows?.[0]?.id ?? null;
}

class CompanyService {
  static async findOrCreateByZoneWithClient(client, { zoneCode, ceoAgentId = null } = {}) {
    const zone = safeText(zoneCode || '', 32);
    const pool = DEFAULT_COMPANIES[zone] || null;

    const pickAnyLeastCrowded = async () => {
      const { rows } = await client.query(
        `SELECT c.id, c.name, c.display_name, c.status,
                (SELECT COUNT(*)::int FROM company_employees e WHERE e.company_id = c.id AND e.status = 'active') AS employee_count
         FROM companies c
         WHERE c.status = 'active'
         ORDER BY employee_count ASC, c.created_at ASC
         LIMIT 1`
      );
      return rows?.[0] ?? null;
    };

    // Special case: janitor/hallway can go to any company.
    if (zone === 'hallway') {
      const any = await pickAnyLeastCrowded().catch(() => null);
      if (any) return any;
    }

    if (pool && pool.length > 0) {
      const { rows } = await client.query(
        `SELECT c.id, c.name, c.display_name, c.status,
                (SELECT COUNT(*)::int FROM company_employees e WHERE e.company_id = c.id AND e.status = 'active') AS employee_count
         FROM companies c
         WHERE c.status = 'active'
           AND c.name = ANY($1::text[])
         ORDER BY employee_count ASC, c.created_at ASC
         LIMIT 1`,
        [pool]
      );
      const existing = rows?.[0] ?? null;
      if (existing) return existing;

      for (const name of shuffled(pool)) {
        // eslint-disable-next-line no-await-in-loop
        const exists = await client
          .query(`SELECT id, status, name, display_name FROM companies WHERE name = $1 LIMIT 1`, [name])
          .then((r) => r.rows?.[0] ?? null);
        if (exists && String(exists.status || '') === 'active') return exists;
        if (exists) continue;

        // eslint-disable-next-line no-await-in-loop
        const created = await CompanyService.ensureCompanyByNameWithClient(client, {
          name,
          displayName: name,
          description: `${name} — 새로 문 연 곳`,
          ceoAgentId
        });
        return created;
      }

      // All names are taken (possibly dissolved). Reactivate the first one as a last resort.
      const fallbackName = pool[0];
      const fallback = await CompanyService.ensureCompanyByNameWithClient(client, {
        name: fallbackName,
        displayName: fallbackName,
        description: `${fallbackName} — 새로 문 연 곳`,
        ceoAgentId
      });
      if (fallback && String(fallback.status || '') !== 'active') {
        await client.query(`UPDATE companies SET status = 'active', updated_at = NOW() WHERE id = $1`, [fallback.id]);
        fallback.status = 'active';
      }
      return fallback;
    }

    // Unknown zone: fallback to any active company, else create an office company.
    const any = await pickAnyLeastCrowded().catch(() => null);
    if (any) return any;

    const fallbackName = DEFAULT_COMPANIES.office?.[0] || '림보전자';
    const created = await CompanyService.ensureCompanyByNameWithClient(client, {
      name: fallbackName,
      displayName: fallbackName,
      description: `${fallbackName} — 새로 문 연 곳`,
      ceoAgentId
    });
    return created;
  }

  static async create({ name, displayName = null, description = null, ceoAgentId }) {
    const companyName = normalizeCompanyName(name);
    if (!ceoAgentId) throw new BadRequestError('ceo_agent_id is required');

    return transaction(async (client) => {
      const existing = await client.query('SELECT id FROM companies WHERE name = $1', [companyName]).then((r) => r.rows?.[0] ?? null);
      if (existing) throw new ConflictError('Company already exists');

      // Ensure CEO exists.
      const ceo = await client.query('SELECT id FROM agents WHERE id = $1', [ceoAgentId]).then((r) => r.rows?.[0] ?? null);
      if (!ceo) throw new NotFoundError('Agent');

      const walletAgentId = await createWalletAgentWithClient(client, {
        companyName,
        displayName,
        description
      });
      if (!walletAgentId) throw new Error('Failed to create company wallet');

      const { rows } = await client.query(
        `INSERT INTO companies (name, display_name, description, ceo_agent_id, wallet_agent_id, balance, status)
         VALUES ($1,$2,$3,$4,$5,0,'active')
         RETURNING id, name, display_name, description, ceo_agent_id, wallet_agent_id, balance, status, created_at`,
        [companyName, safeText(displayName || companyName, 128), safeText(description || '', 1000) || null, ceoAgentId, walletAgentId]
      );
      const company = rows[0];
      if (!company) throw new Error('Failed to create company');

      // CEO becomes an employee too.
      await client.query(
        `INSERT INTO company_employees (company_id, agent_id, role, wage, revenue_share, status)
         VALUES ($1,$2,'ceo',0,0.0,'active')
         ON CONFLICT (company_id, agent_id) DO UPDATE SET role = 'ceo', status = 'active'`,
        [company.id, ceoAgentId]
      );

      // Founding cost (policy): paid into the company wallet.
      await PolicyService.ensureDefaultsWithClient(client).catch(() => null);
      const costRaw = await PolicyService.getNumberWithClient(client, 'company_founding_cost', 20).catch(() => 20);
      const cost = clampInt(costRaw, 1, 200);
      await TransactionService.transfer(
        {
          fromAgentId: ceoAgentId,
          toAgentId: walletAgentId,
          amount: cost,
          txType: 'FOUNDING',
          memo: `${companyName} 차렸다!`,
          referenceId: company.id,
          referenceType: 'company'
        },
        client
      );

      // Cache balance (safe; SSOT is transactions).
      const bal = await TransactionService.getBalance(walletAgentId, client);
      await client.query('UPDATE companies SET balance = $2, updated_at = NOW() WHERE id = $1', [company.id, bal]);

      return { company: { ...company, balance: bal } };
    });
  }

  static async ensureCompanyByNameWithClient(client, { name, displayName = null, description = null, ceoAgentId = null } = {}) {
    const companyName = normalizeCompanyName(name);
    const existing = await client
      .query(
        `SELECT id, name, display_name, description, ceo_agent_id, wallet_agent_id, balance, status
         FROM companies
         WHERE name = $1`,
        [companyName]
      )
      .then((r) => r.rows?.[0] ?? null);

    if (existing) {
      // Ensure wallet exists (older rows might be missing).
      if (!existing.wallet_agent_id) {
        const walletAgentId = await createWalletAgentWithClient(client, { companyName, displayName, description });
        await client.query('UPDATE companies SET wallet_agent_id = $2, updated_at = NOW() WHERE id = $1', [existing.id, walletAgentId]);
        existing.wallet_agent_id = walletAgentId;
      }
      return existing;
    }

    const walletAgentId = await createWalletAgentWithClient(client, { companyName, displayName, description });
    if (!walletAgentId) throw new Error('Failed to create company wallet');

    const { rows } = await client.query(
      `INSERT INTO companies (name, display_name, description, ceo_agent_id, wallet_agent_id, balance, status)
       VALUES ($1,$2,$3,$4,$5,0,'active')
       RETURNING id, name, display_name, description, ceo_agent_id, wallet_agent_id, balance, status`,
      [companyName, safeText(displayName || companyName, 128), safeText(description || '', 1000) || null, ceoAgentId, walletAgentId]
    );
    return rows[0];
  }

  static async ensureEmployeeWithClient(
    client,
    { companyId, agentId, role = 'employee', wage = 0, revenueShare = 0.0, status = 'active' }
  ) {
    if (!companyId) throw new BadRequestError('company_id is required');
    if (!agentId) throw new BadRequestError('agent_id is required');

    const safeRole = safeText(role || 'employee', 32) || 'employee';
    const safeStatus = safeText(status || 'active', 16) || 'active';

    await client.query(
      `INSERT INTO company_employees (company_id, agent_id, role, wage, revenue_share, status)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (company_id, agent_id)
       DO UPDATE SET role = EXCLUDED.role,
                     wage = EXCLUDED.wage,
                     revenue_share = EXCLUDED.revenue_share,
                     status = EXCLUDED.status`,
      [companyId, agentId, safeRole, Math.max(0, Number(wage) || 0), Math.max(0, Math.min(1, Number(revenueShare) || 0)), safeStatus]
    );
  }

  static async list({ status = 'active', limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const st = status ? safeText(status, 16) : null;

    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT c.id, c.name, c.display_name, c.description, c.ceo_agent_id, c.wallet_agent_id, c.balance, c.status, c.created_at,
                (SELECT COUNT(*)::int FROM company_employees e WHERE e.company_id = c.id AND e.status = 'active') AS employee_count
         FROM companies c
         WHERE ($1::text IS NULL OR c.status = $1)
         ORDER BY c.created_at DESC
         LIMIT $2 OFFSET $3`,
        [st, safeLimit, safeOffset]
      );
      return rows;
    });
  }

  static async getById(companyId) {
    if (!companyId) throw new BadRequestError('company_id is required');

    return transaction(async (client) => {
      const company = await client
        .query(
          `SELECT id, name, display_name, description, ceo_agent_id, wallet_agent_id, balance, status, created_at, updated_at
           FROM companies
           WHERE id = $1`,
          [companyId]
        )
        .then((r) => r.rows?.[0] ?? null);
      if (!company) throw new NotFoundError('Company');

      const { rows: employees } = await client.query(
        `SELECT e.agent_id, e.role, e.wage, e.revenue_share, e.status, e.joined_at,
                COALESCE(a.display_name, a.name) AS agent_name
         FROM company_employees e
         JOIN agents a ON a.id = e.agent_id
         WHERE e.company_id = $1
         ORDER BY e.joined_at ASC`,
        [companyId]
      );

      return { company, employees };
    });
  }

  static async getByAgent(agentId) {
    if (!agentId) throw new BadRequestError('agent_id is required');
    const row = await transaction(async (client) => {
      const employee = await client
        .query(
          `SELECT company_id, role, status
           FROM company_employees
           WHERE agent_id = $1 AND status = 'active'
           ORDER BY joined_at DESC
           LIMIT 1`,
          [agentId]
        )
        .then((r) => r.rows?.[0] ?? null);
      if (!employee) return null;

      const company = await client
        .query(
          `SELECT id, name, display_name, description, ceo_agent_id, wallet_agent_id, balance, status
           FROM companies
           WHERE id = $1`,
          [employee.company_id]
        )
        .then((r) => r.rows?.[0] ?? null);
      if (!company) return null;

      return { company, membership: employee };
    });
    return row;
  }
}

module.exports = CompanyService;
