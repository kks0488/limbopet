/**
 * EconomyService
 *
 * Helpers around the money ledger and migrations from older "facts" storage.
 */

const { transaction } = require('../config/database');

const TransactionService = require('./TransactionService');
const CompanyService = require('./CompanyService');

function toSafeInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim()) return Number.parseInt(v, 10);
  return 0;
}

class EconomyService {
  /**
   * One-time migration helper (dev / admin):
   * facts(kind='economy', key='coins') -> transactions(INITIAL)
   */
  static async migrateCoinsFromFacts() {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT agent_id, value
         FROM facts
         WHERE kind = 'economy' AND key = 'coins'`
      );

      let created = 0;
      for (const r of rows) {
        const bal = toSafeInt(r?.value?.balance ?? 0);
        if (bal <= 0) continue;

        // eslint-disable-next-line no-await-in-loop
        const res = await TransactionService.ensureInitialMint(r.agent_id, bal, { memo: 'facts->INITIAL' }, client);
        if (res.created) created += 1;
      }

      return { migrated: created, scanned: rows.length };
    });
  }

  /**
   * One-time migration helper (dev / admin):
   * facts(profile, company) -> companies + company_employees
   *
   * Notes:
   * - This creates companies if missing.
   * - It does NOT move money; company wallets start at 0.
   */
  static async migrateCompaniesFromFacts() {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT agent_id, value
         FROM facts
         WHERE kind = 'profile' AND key = 'company'`
      );

      const companyByName = new Map();
      for (const r of rows) {
        const companyName = String(r?.value?.company ?? '').trim();
        if (!companyName) continue;

        let company = companyByName.get(companyName) || null;
        if (!company) {
          // eslint-disable-next-line no-await-in-loop
          company = await CompanyService.ensureCompanyByNameWithClient(client, { name: companyName });
          companyByName.set(companyName, company);
        }

        // eslint-disable-next-line no-await-in-loop
        await CompanyService.ensureEmployeeWithClient(client, { companyId: company.id, agentId: r.agent_id, role: 'employee', wage: 0 });
      }

      return { companies: companyByName.size, memberships: rows.length };
    });
  }

  static async getDashboard() {
    return transaction(async (client) => {
      const supplyRow = await client
        .query(
          `SELECT
              COALESCE(SUM(CASE WHEN from_agent_id IS NULL THEN amount ELSE 0 END), 0)::bigint AS minted,
              COALESCE(SUM(CASE WHEN to_agent_id IS NULL THEN amount ELSE 0 END), 0)::bigint AS burned
           FROM transactions`
        )
        .then((r) => r.rows?.[0] ?? null);

      const minted = toSafeInt(supplyRow?.minted ?? 0);
      const burned = toSafeInt(supplyRow?.burned ?? 0);

      const agentsRow = await client
        .query(
          `SELECT COUNT(*)::int AS n
           FROM agents
           WHERE name <> 'world_core'`
        )
        .then((r) => r.rows?.[0] ?? null);

      return {
        circulating_supply: Math.max(0, minted - burned),
        minted,
        burned,
        agents: toSafeInt(agentsRow?.n ?? 0)
      };
    });
  }
}

module.exports = EconomyService;

