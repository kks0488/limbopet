/**
 * Health Routes
 * /api/v1/health/*
 */

const { Router } = require('express');
const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { queryAll, queryOne } = require('../config/database');

const router = Router();

function isAuthorized(req) {
  if (config.isProduction) {
    const key = String(config.limbopet?.adminKey || '').trim();
    if (!key) return false;
    const provided = String(req.headers['x-admin-key'] || req.headers['x-limbopet-admin-key'] || '').trim();
    return Boolean(provided && provided === key);
  }
  // Dev: allow without a key.
  return true;
}

router.get('/', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

router.get(
  '/queues',
  asyncHandler(async (req, res) => {
    if (!isAuthorized(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const brain = await queryAll(
      `SELECT job_type, status, COUNT(*)::int AS n,
              MIN(created_at) AS oldest_created_at,
              MAX(created_at) AS newest_created_at
       FROM brain_jobs
       WHERE status IN ('pending','leased','failed')
       GROUP BY 1,2
       ORDER BY n DESC, job_type ASC, status ASC`
    ).catch(() => []);

    const pendingTotal = brain
      .filter((r) => String(r?.status || '') === 'pending')
      .reduce((acc, r) => acc + (Number(r?.n ?? 0) || 0), 0);
    const leasedTotal = brain
      .filter((r) => String(r?.status || '') === 'leased')
      .reduce((acc, r) => acc + (Number(r?.n ?? 0) || 0), 0);
    const failedTotal = brain
      .filter((r) => String(r?.status || '') === 'failed')
      .reduce((acc, r) => acc + (Number(r?.n ?? 0) || 0), 0);

    const leasedExpiredTotal = await queryOne(
      `SELECT COUNT(*)::int AS n
       FROM brain_jobs
       WHERE status = 'leased' AND lease_expires_at < NOW()`
    )
      .then((r) => r?.n ?? 0)
      .catch(() => 0);

    const pendingAgeS = await queryOne(
      `SELECT
         percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - created_at))) AS p50_s,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - created_at))) AS p95_s,
         MAX(EXTRACT(EPOCH FROM (NOW() - created_at))) AS max_s,
         COUNT(*)::int AS n
       FROM brain_jobs
       WHERE status = 'pending'`
    )
      .then((r) => r ?? null)
      .catch(() => null);

    const doneLatencyS = await queryOne(
      `SELECT
         COUNT(*)::int AS n,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (leased_at - created_at))) AS queue_p50_s,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (leased_at - created_at))) AS queue_p95_s,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finished_at - leased_at))) AS run_p50_s,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finished_at - leased_at))) AS run_p95_s,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finished_at - created_at))) AS total_p50_s,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finished_at - created_at))) AS total_p95_s
       FROM brain_jobs
       WHERE status = 'done'
         AND leased_at IS NOT NULL
         AND finished_at IS NOT NULL
         AND finished_at > NOW() - interval '1 hour'`
    )
      .then((r) => r ?? null)
      .catch(() => null);

    const worldId = await queryOne(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`).then((r) => r?.id ?? null).catch(() => null);
    const lastTick = worldId
      ? await queryOne(
        `SELECT value
         FROM facts
         WHERE agent_id = $1 AND kind = 'world_worker' AND key = 'last_tick'
         LIMIT 1`,
        [worldId]
      ).then((r) => r?.value ?? null).catch(() => null)
      : null;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      config: {
        node_env: config.nodeEnv,
        brain_backend: config.limbopet?.brainBackend ?? null,
        brain_worker: Boolean(config.limbopet?.brainWorker),
        world_worker: Boolean(config.limbopet?.worldWorker)
      },
      brain_jobs: {
        pending: pendingTotal,
        leased: leasedTotal,
        leased_expired: Number(leasedExpiredTotal || 0) || 0,
        failed: failedTotal,
        latency_s: {
          pending_age: pendingAgeS,
          done_last_hour: doneLatencyS
        },
        breakdown: brain
      },
      world_worker: {
        last_tick: lastTick
      }
    });
  })
);

router.get(
  '/world',
  asyncHandler(async (req, res) => {
    if (!isAuthorized(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const worldId = await queryOne(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`)
      .then((r) => r?.id ?? null)
      .catch(() => null);

    const lastTick = worldId
      ? await queryOne(
        `SELECT value
         FROM facts
         WHERE agent_id = $1 AND kind = 'world_worker' AND key = 'last_tick'
         LIMIT 1`,
        [worldId]
      )
        .then((r) => r?.value ?? null)
        .catch(() => null)
      : null;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      config: {
        node_env: config.nodeEnv,
        world_worker: Boolean(config.limbopet?.worldWorker),
        world_worker_poll_ms: Number(config.limbopet?.worldWorkerPollMs ?? 15000) || 15000
      },
      world_worker: {
        last_tick: lastTick
      }
    });
  })
);

module.exports = router;
