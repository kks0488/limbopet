/**
 * Simple schema bootstrapper for local dev.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/migrate.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function listMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

async function hasTable(client, tableName) {
  const name = String(tableName || '').trim();
  if (!name) return false;
  const { rows } = await client.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1
     LIMIT 1`,
    [name]
  );
  return Boolean(rows?.[0]);
}

async function ensureMigrationsTable(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS limbopet_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`
  );
}

async function listAppliedMigrations(client) {
  const { rows } = await client.query(`SELECT name FROM limbopet_migrations ORDER BY applied_at ASC`);
  return new Set((rows || []).map((r) => String(r?.name || '').trim()).filter(Boolean));
}

async function applySqlFile(client, { name, sql }) {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO limbopet_migrations (name, applied_at)
       VALUES ($1, NOW())
       ON CONFLICT (name) DO NOTHING`,
      [name]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const schemaHash = sha256(schema);

  const migrationsDir = path.join(__dirname, 'migrations');
  const migrationFiles = listMigrations(migrationsDir);

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    // New: incremental migrations (production-friendly).
    // - Bootstrap base schema once (schema.sql).
    // - Apply migrations from scripts/migrations/*.sql thereafter.
    await ensureMigrationsTable(client);
    const applied = await listAppliedMigrations(client);

    const baselineName = '0000_baseline_schema.sql';

    // Compatibility: the old dev bootstrapper stored a single schema hash in limbopet_schema_meta.
    const hasOldMeta = await hasTable(client, 'limbopet_schema_meta').catch(() => false);
    const hasAgents = await hasTable(client, 'agents').catch(() => false);

    if (!applied.has(baselineName)) {
      if (hasOldMeta || hasAgents) {
        // Assume baseline exists; record it so subsequent migrations can run.
        await client.query(
          `INSERT INTO limbopet_migrations (name, applied_at)
           VALUES ($1, NOW())
           ON CONFLICT (name) DO NOTHING`,
          [baselineName]
        );
        applied.add(baselineName);
        console.log('✅ Recorded existing baseline schema');
      } else {
        await applySqlFile(client, { name: baselineName, sql: schema });
        applied.add(baselineName);

        // Keep schema hash meta for easy debugging.
        await client.query(
          `CREATE TABLE IF NOT EXISTS limbopet_schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )`
        );
        await client.query(
          `INSERT INTO limbopet_schema_meta (key, value, updated_at)
           VALUES ('schema_hash', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [schemaHash]
        );
        console.log('✅ Database baseline schema applied');
      }
    } else {
      // Best-effort warning if schema.sql diverged from the recorded hash.
      if (hasOldMeta) {
        const { rows: metaRows } = await client.query(`SELECT value FROM limbopet_schema_meta WHERE key = 'schema_hash'`);
        const prev = String(metaRows?.[0]?.value ?? '').trim();
        if (prev && prev !== schemaHash) {
          console.warn('⚠️  schema.sql changed since baseline. New columns/indexes should be added via migrations.');
        }
      }
    }

    let ran = 0;
    for (const file of migrationFiles) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await applySqlFile(client, { name: file, sql });
      applied.add(file);
      ran += 1;
      console.log(`✅ Migration applied: ${file}`);
    }

    if (ran === 0) {
      console.log('✅ Database up-to-date; no migrations to apply');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
