require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/limbopet';
const MIGRATIONS_TABLE = '_migrations';
const LEGACY_MIGRATIONS_TABLE = 'limbopet_migrations';

function migrationDirPath() {
  return path.join(__dirname, 'migrations');
}

function listMigrationFiles() {
  const dir = migrationDirPath();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

async function tableExists(client, tableName) {
  const t = String(tableName || '').trim();
  if (!t) return false;
  const { rows } = await client.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = $1
     LIMIT 1`,
    [t]
  );
  return Boolean(rows?.[0]);
}

async function ensureTrackerTable(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`
  );
}

async function backfillFromLegacyTable(client) {
  const hasLegacy = await tableExists(client, LEGACY_MIGRATIONS_TABLE);
  if (!hasLegacy) return 0;

  const { rowCount } = await client.query(
    `INSERT INTO _migrations (filename, applied_at)
     SELECT name, COALESCE(applied_at, NOW())
     FROM limbopet_migrations
     ON CONFLICT (filename) DO NOTHING`
  );
  return Number(rowCount || 0);
}

async function appliedFileSet(client) {
  const { rows } = await client.query('SELECT filename FROM _migrations');
  return new Set((rows || []).map((r) => String(r?.filename || '').trim()).filter(Boolean));
}

async function applyMigrationFile(client, file) {
  const sql = fs.readFileSync(path.join(migrationDirPath(), file), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING', [file]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL });
  const client = await pool.connect();

  try {
    await ensureTrackerTable(client);
    const legacySynced = await backfillFromLegacyTable(client);
    if (legacySynced > 0) {
      console.log(`Synced ${legacySynced} legacy migration record(s) from ${LEGACY_MIGRATIONS_TABLE}`);
    }

    const files = listMigrationFiles();
    const applied = await appliedFileSet(client);

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      console.log(`Applying ${file}...`);
      try {
        await applyMigrationFile(client, file);
        count += 1;
        console.log('  OK');
      } catch (e) {
        console.error(`  FAIL: ${e.message}`);
        throw e;
      }
    }

    console.log(`Migration complete: ${count} new, ${files.length - count} already applied`);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
