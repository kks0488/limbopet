/**
 * PolicyService (idea 001)
 *
 * 정책 파라미터를 DB(`policy_params`)에서 읽어, 하드코딩 값을 줄입니다.
 * - 값은 JSONB로 저장하지만, 대부분 숫자/불리언 단일값으로 사용합니다.
 * - "진실"은 DB, 앱은 fallback defaults만 가진다.
 */

const { queryOne, transaction } = require('../config/database');

const DEFAULTS = Object.freeze({
  min_wage: 3,
  initial_coins: 200,
  transaction_tax_rate: 0.03,
  luxury_tax_threshold: 50,
  luxury_tax_rate: 0.1,
  corporate_tax_rate: 0.05,
  income_tax_rate: 0.02,
  burn_ratio: 0.7,
  max_fine: 100,
  bankruptcy_reset: 50,
  appeal_allowed: true,
  company_founding_cost: 20
});

function safeNumber(v, fallback) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function safeBool(v, fallback) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

class PolicyService {
  static defaults() {
    return { ...DEFAULTS };
  }

  static async ensureDefaultsWithClient(client) {
    await client.query(
      `INSERT INTO policy_params (key, value)
       SELECT k, v::jsonb
       FROM (VALUES
         ('min_wage', $1),
         ('initial_coins', $2),
         ('transaction_tax_rate', $3),
         ('luxury_tax_threshold', $4),
         ('luxury_tax_rate', $5),
         ('corporate_tax_rate', $6),
         ('income_tax_rate', $7),
         ('burn_ratio', $8),
         ('max_fine', $9),
         ('bankruptcy_reset', $10),
         ('appeal_allowed', $11),
         ('company_founding_cost', $12)
       ) AS t(k, v)
       ON CONFLICT (key) DO NOTHING`,
      [
        JSON.stringify(DEFAULTS.min_wage),
        JSON.stringify(DEFAULTS.initial_coins),
        JSON.stringify(DEFAULTS.transaction_tax_rate),
        JSON.stringify(DEFAULTS.luxury_tax_threshold),
        JSON.stringify(DEFAULTS.luxury_tax_rate),
        JSON.stringify(DEFAULTS.corporate_tax_rate),
        JSON.stringify(DEFAULTS.income_tax_rate),
        JSON.stringify(DEFAULTS.burn_ratio),
        JSON.stringify(DEFAULTS.max_fine),
        JSON.stringify(DEFAULTS.bankruptcy_reset),
        JSON.stringify(DEFAULTS.appeal_allowed),
        JSON.stringify(DEFAULTS.company_founding_cost)
      ]
    );
  }

  static async getRaw(key) {
    const row = await queryOne('SELECT key, value, changed_by, changed_at FROM policy_params WHERE key = $1', [String(key || '')]);
    if (!row) return null;
    return row;
  }

  static async getNumber(key, fallback) {
    const d = fallback ?? DEFAULTS[key];
    const row = await PolicyService.getRaw(key);
    return row ? safeNumber(row.value, d) : d;
  }

  static async getBool(key, fallback) {
    const d = fallback ?? DEFAULTS[key];
    const row = await PolicyService.getRaw(key);
    return row ? safeBool(row.value, d) : d;
  }

  static async getNumberWithClient(client, key, fallback) {
    const d = fallback ?? DEFAULTS[key];
    const row = await client.query('SELECT value FROM policy_params WHERE key = $1', [String(key || '')]).then((r) => r.rows?.[0] ?? null);
    return row ? safeNumber(row.value, d) : d;
  }

  static async setParamWithClient(client, { key, value, changedBy = null }) {
    const k = String(key || '').trim();
    await client.query(
      `INSERT INTO policy_params (key, value, changed_by, changed_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value,
                     changed_by = EXCLUDED.changed_by,
                     changed_at = NOW()`,
      [k, JSON.stringify(value), changedBy]
    );
  }

  static async setMany({ changes, changedBy = null } = {}) {
    const list = Array.isArray(changes) ? changes : [];
    if (list.length === 0) return;

    await transaction(async (client) => {
      await PolicyService.ensureDefaultsWithClient(client).catch(() => null);
      for (const c of list) {
        // eslint-disable-next-line no-await-in-loop
        await PolicyService.setParamWithClient(client, { key: c.key, value: c.value, changedBy });
      }
    });
  }
}

module.exports = PolicyService;

