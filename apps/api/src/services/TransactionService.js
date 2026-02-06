/**
 * TransactionService
 *
 * Phase E1: Economy foundation.
 *
 * Rules:
 * - `transactions` is the SSOT (append-only).
 * - Balances are computed by SUM(in) - SUM(out).
 * - `transfer()` is the single write path for coin movement.
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');

function toSafeInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim()) return Number.parseInt(v, 10);
  return 0;
}

function normalizeAmount(amount) {
  const n = toSafeInt(amount);
  if (!Number.isFinite(n) || n <= 0) throw new BadRequestError('Invalid amount', 'BAD_AMOUNT');
  if (n > 1_000_000_000) throw new BadRequestError('amount too large', 'BAD_AMOUNT');
  return n;
}

function normalizeTxType(txType) {
  const t = String(txType || '').trim().toUpperCase();
  if (!t) throw new BadRequestError('tx_type is required', 'BAD_TX_TYPE');
  if (!/^[A-Z_]{3,24}$/.test(t)) throw new BadRequestError('Invalid tx_type', 'BAD_TX_TYPE');
  return t;
}

async function lockAgentRow(client, agentId) {
  if (!agentId) return;
  const { rows } = await client.query('SELECT id FROM agents WHERE id = $1 FOR UPDATE', [agentId]);
  if (!rows[0]) throw new NotFoundError('Agent');
}

async function ensureAgentExists(client, agentId) {
  if (!agentId) return;
  const { rows } = await client.query('SELECT id FROM agents WHERE id = $1', [agentId]);
  if (!rows[0]) throw new NotFoundError('Agent');
}

async function sumBalanceWithClient(client, agentId) {
  const row = await client
    .query(
      `SELECT
          COALESCE(SUM(CASE WHEN to_agent_id = $1 THEN amount ELSE 0 END), 0)::bigint
          - COALESCE(SUM(CASE WHEN from_agent_id = $1 THEN amount ELSE 0 END), 0)::bigint
          AS balance
       FROM transactions
       WHERE to_agent_id = $1 OR from_agent_id = $1`,
      [agentId]
    )
    .then((r) => r.rows?.[0] ?? null);
  return toSafeInt(row?.balance ?? 0);
}

async function bumpCompanyBalanceCaches(client, { fromAgentId, toAgentId, amount }) {
  const ids = [fromAgentId, toAgentId].filter(Boolean);
  if (!ids.length) return;

  const { rows } = await client.query(
    `SELECT id, wallet_agent_id
     FROM companies
     WHERE wallet_agent_id = ANY($1::uuid[])`,
    [ids]
  );
  if (!rows.length) return;

  for (const c of rows) {
    const walletId = c.wallet_agent_id;
    if (!walletId) continue;
    let delta = 0;
    if (toAgentId && walletId === toAgentId) delta += amount;
    if (fromAgentId && walletId === fromAgentId) delta -= amount;
    if (!delta) continue;
    // eslint-disable-next-line no-await-in-loop
    await client.query('UPDATE companies SET balance = balance + $2, updated_at = NOW() WHERE id = $1', [c.id, delta]);
  }
}

class TransactionService {
  static async getBalance(agentId, client = null) {
    if (!agentId) throw new BadRequestError('agent_id is required');
    if (client) {
      return sumBalanceWithClient(client, agentId);
    }

    const row = await queryOne(
      `SELECT
          COALESCE(SUM(CASE WHEN to_agent_id = $1 THEN amount ELSE 0 END), 0)::bigint
          - COALESCE(SUM(CASE WHEN from_agent_id = $1 THEN amount ELSE 0 END), 0)::bigint
          AS balance
       FROM transactions
       WHERE to_agent_id = $1 OR from_agent_id = $1`,
      [agentId]
    );
    return toSafeInt(row?.balance ?? 0);
  }

  static async getTransactions(agentId, { limit = 50, offset = 0, txType = null } = {}, client = null) {
    if (!agentId) throw new BadRequestError('agent_id is required');
    const safeLimit = Math.max(1, Math.min(200, toSafeInt(limit) || 50));
    const safeOffset = Math.max(0, toSafeInt(offset) || 0);
    const safeType = txType ? normalizeTxType(txType) : null;

    const sql =
      `SELECT id, tx_type, from_agent_id, to_agent_id, amount, memo, reference_id, reference_type, created_at,
              CASE
                WHEN to_agent_id = $1 THEN 'in'
                WHEN from_agent_id = $1 THEN 'out'
                ELSE 'other'
              END AS direction
       FROM transactions
       WHERE (from_agent_id = $1 OR to_agent_id = $1)
         AND ($2::text IS NULL OR tx_type = $2)
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`;

    if (client) {
      const { rows } = await client.query(sql, [agentId, safeType, safeLimit, safeOffset]);
      return rows;
    }

    return queryAll(sql, [agentId, safeType, safeLimit, safeOffset]);
  }

  /**
   * Atomic transfer (append-only).
   *
   * - from_agent_id NULL => mint
   * - to_agent_id NULL => burn
   */
  static async transfer(
    { fromAgentId = null, toAgentId = null, amount, txType, memo = null, referenceId = null, referenceType = null },
    client = null
  ) {
    const amt = normalizeAmount(amount);
    const type = normalizeTxType(txType);

    const fromId = fromAgentId ? String(fromAgentId) : null;
    const toId = toAgentId ? String(toAgentId) : null;

    if (!fromId && !toId) throw new BadRequestError('from_agent_id or to_agent_id is required');
    if (fromId && toId && fromId === toId) throw new BadRequestError('Self transfer is not allowed', 'SELF_TRANSFER');

    const safeMemo = memo ? String(memo).slice(0, 400) : null;
    const safeRefType = referenceType ? String(referenceType).slice(0, 24) : null;
    const safeRefId = referenceId ? String(referenceId) : null;

    const run = async (c) => {
      // Serialize by locking the sender row (prevents double-spend under concurrency).
      if (fromId) await lockAgentRow(c, fromId);
      if (toId) await ensureAgentExists(c, toId);

      if (fromId) {
        const bal = await sumBalanceWithClient(c, fromId);
        if (bal < amt) {
          throw new BadRequestError('잔고 부족', 'INSUFFICIENT_FUNDS', `balance=${bal}`);
        }
      }

      const { rows } = await c.query(
        `INSERT INTO transactions (tx_type, from_agent_id, to_agent_id, amount, memo, reference_id, reference_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, tx_type, from_agent_id, to_agent_id, amount, memo, reference_id, reference_type, created_at`,
        [type, fromId, toId, amt, safeMemo, safeRefId, safeRefType]
      );

      const tx = rows[0];
      if (!tx) throw new Error('Failed to create transaction');

      await bumpCompanyBalanceCaches(c, { fromAgentId: fromId, toAgentId: toId, amount: amt });

      return tx;
    };

    if (client) return run(client);
    return transaction(run);
  }

  static async ensureInitialMint(agentId, amount, { memo = 'initial' } = {}, client = null) {
    const amt = normalizeAmount(amount);
    const run = async (c) => {
      const { rows } = await c.query(
        `SELECT id FROM transactions
         WHERE tx_type = 'INITIAL' AND to_agent_id = $1
         LIMIT 1`,
        [agentId]
      );
      if (rows[0]) return { created: false, existing: rows[0].id };
      const tx = await TransactionService.transfer({ fromAgentId: null, toAgentId: agentId, amount: amt, txType: 'INITIAL', memo }, c);
      return { created: true, tx };
    };
    if (client) return run(client);
    return transaction(run);
  }
}

module.exports = TransactionService;

