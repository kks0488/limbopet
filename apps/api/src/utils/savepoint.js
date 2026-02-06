function makeSavepointName(label = 'sp') {
  const safeLabel = String(label || 'sp')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, 24) || 'sp';
  const rand = Math.random().toString(16).slice(2, 10);
  return `sp_${safeLabel}_${rand}`;
}

/**
 * Best-effort execution inside a transaction.
 *
 * Why: In Postgres, *any* failed statement aborts the transaction until rollback.
 * Catching an error without rolling back (or rolling back to a savepoint) will
 * poison the transaction and cause unrelated later queries to fail with 25P02.
 *
 * This helper uses SAVEPOINT so callers can "ignore" a failure safely.
 */
async function bestEffortInTransaction(client, fn, { label = 'best_effort', fallback = null } = {}) {
  const fb = typeof fallback === 'function' ? fallback : () => fallback;

  // If we're not currently in an explicit transaction block, SAVEPOINT will error.
  // In that case, run as a simple best-effort call.
  const sp = makeSavepointName(label);
  try {
    await client.query(`SAVEPOINT ${sp}`);
  } catch {
    try {
      return await fn();
    } catch (err) {
      if (process.env.LIMBOPET_TX_BEST_EFFORT_LOG === '1') {
        console.warn(`[bestEffortInTransaction:${label}]`, err);
      }
      return fb(err);
    }
  }

  try {
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return result;
  } catch (err) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch {
      // ignore follow-up errors; we tried to unpoison the tx
    }
    if (process.env.LIMBOPET_TX_BEST_EFFORT_LOG === '1') {
      console.warn(`[bestEffortInTransaction:${label}]`, err);
    }
    return fb(err);
  }
}

module.exports = { bestEffortInTransaction };

