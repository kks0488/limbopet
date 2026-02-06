/**
 * LIMBOPET API - Entry Point
 */

const app = require('./app');
const config = require('./config');
const { initializePool, healthCheck } = require('./config/database');
const ServerBrainWorker = require('./services/ServerBrainWorker');
const WorldTickWorker = require('./services/WorldTickWorker');

let server = null;
let brainWorker = null;
let worldWorker = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function listenWithRetry({ attempts = 25, delayMs = 120 } = {}) {
  let lastErr = null;
  const hostRaw = process.env.HOST || process.env.BIND_HOST || '';
  const host = String(hostRaw || '').trim() || '0.0.0.0';
  for (let i = 0; i < attempts; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const s = await new Promise((resolve, reject) => {
        const srv = app.listen(config.port, host);
        srv.once('listening', () => resolve(srv));
        srv.once('error', (err) => reject(err));
      });
      return s;
    } catch (e) {
      lastErr = e;
      const code = String(e?.code || '');
      if (code === 'EADDRINUSE' && i + 1 < attempts) {
        // Node --watch restarts can race old shutdown; retry a few times.
        // eslint-disable-next-line no-await-in-loop
        await sleep(delayMs);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function start() {
  console.log('Starting LIMBOPET API...');
  
  // Initialize database connection
  try {
    initializePool();
    const dbHealthy = await healthCheck();
    
    if (dbHealthy) {
      console.log('Database connected');
    } else {
      console.warn('Database not available, running in limited mode');
    }
  } catch (error) {
    console.warn('Database connection failed:', error.message);
    console.warn('Running in limited mode');
  }

  // Optional server-side brain worker (proxy mode)
  brainWorker = ServerBrainWorker.maybeStart();

  // Optional world tick worker (living society)
  worldWorker = WorldTickWorker.maybeStart();
  
  // Start server
  server = await listenWithRetry();
  console.log(`
LIMBOPET API v1.0.0
-------------------
Environment: ${config.nodeEnv}
Port: ${config.port}
Host: ${String(process.env.HOST || process.env.BIND_HOST || '0.0.0.0')}
Base URL: ${config.limbopet.baseUrl}

Endpoints:
  POST   /api/v1/pets/register      Register new pet
  GET    /api/v1/pets/me            Get pet + stats
  POST   /api/v1/pets/me/actions    Tamagotchi actions
  GET    /api/v1/pets/me/timeline   Event timeline
  GET    /api/v1/pets/me/limbo/today  Daily Limbo Room
  POST   /api/v1/brains/jobs/pull   Brain job polling
  POST   /api/v1/brains/jobs/:id/submit Brain job results
  GET    /api/v1/health             Health check
    `);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
async function shutdown(signal) {
  try {
    console.log(`${signal} received, shutting down...`);

    try {
      brainWorker?.stop?.();
    } catch {
      // ignore
    }
    try {
      worldWorker?.stop?.();
    } catch {
      // ignore
    }

    await new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });

    const { close } = require('./config/database');
    await close();
  } catch (e) {
    console.error('Shutdown error:', e);
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
