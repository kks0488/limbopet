/**
 * Database connection and query helpers
 */

const { Pool, types } = require('pg');
const config = require('./index');

let pool = null;

// Ensure DATE columns are returned as "YYYY-MM-DD" strings.
// Some environments parse DATE into JS Date objects, which breaks our UI expectations.
if (types?.builtins?.DATE) {
  types.setTypeParser(types.builtins.DATE, (v) => v);
}

/**
 * Initialize database connection pool
 */
function initializePool() {
  if (pool) return pool;
  
  if (!config.database.url) {
    console.warn('DATABASE_URL not set, using mock database');
    return null;
  }
  
  pool = new Pool({
    connectionString: config.database.url,
    ssl: config.database.ssl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  });
  
  pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
  });
  
  return pool;
}

/**
 * Execute a query
 * 
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
  const db = initializePool();
  
  if (!db) {
    throw new Error('Database not configured');
  }
  
  const start = Date.now();
  const result = await db.query(text, params);
  const duration = Date.now() - start;
  
  if (config.nodeEnv === 'development' && process.env.LIMBOPET_DB_LOG === '1') {
    console.log('Query executed', { text: text.substring(0, 50), duration, rows: result.rowCount });
  }
  
  return result;
}

/**
 * Execute a query and return first row
 * 
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object|null>} First row or null
 */
async function queryOne(text, params) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

/**
 * Execute a query and return all rows
 * 
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} All rows
 */
async function queryAll(text, params) {
  const result = await query(text, params);
  return result.rows;
}

/**
 * Execute multiple queries in a transaction
 * 
 * @param {Function} callback - Function receiving client
 * @returns {Promise<any>} Transaction result
 */
async function transaction(callback) {
  const db = initializePool();
  
  if (!db) {
    throw new Error('Database not configured');
  }
  
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check database connection
 * 
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  try {
    const db = initializePool();
    if (!db) return false;
    
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Close database connections
 */
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * SAVEPOINT wrapper for optional operations inside a transaction.
 * Use instead of `.catch(() => null)` when the operation runs SQL
 * that could fail and poison the surrounding transaction.
 *
 * Usage:
 *   const result = await safeCatch(client, () => SomeService.doStuff(client, id));
 *   // result is null if the operation failed; the transaction stays healthy.
 */
let _spCounter = 0;
async function safeCatch(client, fn, fallback = null) {
  const sp = `sp_${++_spCounter}_${Date.now()}`;
  try {
    await client.query(`SAVEPOINT ${sp}`);
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return result;
  } catch {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
    return fallback;
  }
}

module.exports = {
  initializePool,
  query,
  queryOne,
  queryAll,
  transaction,
  safeCatch,
  healthCheck,
  close,
  getPool: () => pool
};
