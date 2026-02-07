/**
 * WorldTickWorker
 *
 * Goal: "앱을 안 열어도 세상이 돌아간다" (Living Society).
 *
 * Runs lightweight periodic ticks on the server:
 * - showrunner episodes (cadenced)
 * - plaza ambient jobs (free posts)
 * - elections (phase progress)
 * - economy daily tick
 * - research lab seed
 * - secret society seed
 */

const config = require('../config');
const { initializePool, transaction } = require('../config/database');
const { bestEffortInTransaction } = require('../utils/savepoint');
const { advisoryUnlock, tryAdvisoryLock } = require('../utils/advisoryLock');
const ShowrunnerService = require('./ShowrunnerService');
const PlazaAmbientService = require('./PlazaAmbientService');
const ElectionService = require('./ElectionService');
const EconomyTickService = require('./EconomyTickService');
const DecayService = require('./DecayService');
const ArenaService = require('./ArenaService');
const ScandalService = require('./ScandalService');
const DecisionService = require('./DecisionService');
const ResearchLabService = require('./ResearchLabService');
const SecretSocietyService = require('./SecretSocietyService');
const WorldContextService = require('./WorldContextService');
const WorldConceptService = require('./WorldConceptService');
const WorldDayService = require('./WorldDayService');
const CrossSystemEventService = require('./CrossSystemEventService');
const TodayHookService = require('./TodayHookService');
const NotificationService = require('./NotificationService');
const NotificationTemplateService = require('./NotificationTemplateService');
const StreakService = require('./StreakService');

const WORLD_WORKER_LOCK = { namespace: 41001, key: `limbopet:world_worker:${config.limbopet?.baseUrl || ''}` };

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function hookStageForHour(hour) {
  const h = Number(hour);
  if (h === 9) return 'tease';
  if (h === 18) return 'reveal';
  return null;
}

function hookNotificationType(stage) {
  return stage === 'reveal' ? 'DAILY_HOOK_REVEAL' : 'DAILY_HOOK_TEASE';
}

function hookNotificationTitle(stage) {
  return stage === 'reveal' ? '두구두구... 결과 공개!' : '오늘의 떡밥 도착';
}

function hookNotificationBody(hook, stage) {
  const h = hook && typeof hook === 'object' ? hook : {};
  if (stage === 'reveal') {
    const revealHeadline = String(h?.reveal?.headline ?? '').trim();
    if (revealHeadline) return revealHeadline.slice(0, 1000);
    const teaseHeadline = String(h?.tease?.headline ?? '').trim();
    return (teaseHeadline || '결과가 나왔어... 직접 확인해봐!').slice(0, 1000);
  }
  return (String(h?.tease?.headline ?? '').trim() || '뭔가 심상치 않아. 확인해볼래?').slice(0, 1000);
}

async function hasHookNotificationSentWithClient(client, { worldId, day, stage }) {
  const wId = String(worldId || '').trim();
  const iso = safeIsoDay(day);
  const st = String(stage || '').trim();
  if (!wId || !iso || !st) return true;
  const key = `hook_notified:${iso}:${st}`;
  const row = await client
    .query(`SELECT 1 FROM facts WHERE agent_id = $1 AND kind = 'world' AND key = $2 LIMIT 1`, [wId, key])
    .then((r) => r.rows?.[0] ?? null)
    .catch(() => ({ sent: true }));
  return Boolean(row);
}

async function markHookNotificationSentWithClient(client, { worldId, day, stage, sentCount = 0 }) {
  const wId = String(worldId || '').trim();
  const iso = safeIsoDay(day);
  const st = String(stage || '').trim();
  if (!wId || !iso || !st) return;
  const key = `hook_notified:${iso}:${st}`;
  const payload = {
    sent: true,
    day: iso,
    stage: st,
    sent_count: Math.max(0, Math.trunc(Number(sentCount) || 0)),
    at: new Date().toISOString(),
  };

  await client.query(
    `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
     VALUES ($1, 'world', $2, $3::jsonb, 1.0, NOW())
     ON CONFLICT (agent_id, kind, key) DO NOTHING`,
    [wId, key, JSON.stringify(payload)]
  );
}

async function notifyTodayHookStageWithClient(client, { worldId, day, stage, now }) {
  const wId = String(worldId || '').trim();
  const iso = safeIsoDay(day);
  const st = String(stage || '').trim();
  if (!wId || !iso || (st !== 'tease' && st !== 'reveal')) return { sent: 0, skipped: true };

  const already = await hasHookNotificationSentWithClient(client, { worldId: wId, day: iso, stage: st });
  if (already) return { sent: 0, skipped: true, reason: 'already_sent' };

  const hook = await TodayHookService.ensureTodayHookWithClient(client, { worldId: wId, day: iso, now }).catch(() => null);
  if (!hook) return { sent: 0, skipped: true, reason: 'hook_missing' };

  const body = hookNotificationBody(hook, st);
  if (!body) return { sent: 0, skipped: true, reason: 'hook_body_missing' };

  const { rows: users } = await client.query(
    `SELECT id
     FROM users
     ORDER BY created_at ASC
     LIMIT 5000`
  );

  let sent = 0;
  for (const u of users || []) {
    const rendered = NotificationTemplateService.render(hookNotificationType(st), {
      vars: {
        hook_headline: body,
        stage: st,
        day: iso,
      },
      fallback: {
        title: hookNotificationTitle(st),
        body
      }
    });
    // eslint-disable-next-line no-await-in-loop
    const created = await NotificationService.create(client, u.id, {
      type: hookNotificationType(st),
      title: rendered.title,
      body: rendered.body,
      data: {
        day: iso,
        stage: st,
        kind: String(hook?.kind || '').trim() || null,
      },
    }).catch(() => null);
    if (created) sent += 1;
  }

  await markHookNotificationSentWithClient(client, { worldId: wId, day: iso, stage: st, sentCount: sent }).catch(() => null);
  return { sent, skipped: false };
}

async function recordTickStatus(client, { day, ok, durationMs, error = null }) {
  if (!client) return;
  const iso = String(day || '').trim();
  if (!iso) return;

  const worldId = await client
    .query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`)
    .then((r) => r.rows?.[0]?.id ?? null)
    .catch(() => null);
  if (!worldId) return;

  const payload = {
    day: iso,
    ok: Boolean(ok),
    at: new Date().toISOString(),
    duration_ms: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.floor(Number(durationMs))) : null,
    error: error ? String(error).slice(0, 2000) : null
  };

  await client.query(
    `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
     VALUES ($1, 'world_worker', 'last_tick', $2::jsonb, 1.0, NOW())
     ON CONFLICT (agent_id, kind, key)
     DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
    [worldId, JSON.stringify(payload)]
  );
}

function todayISODate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

class WorldTickWorker {
  constructor() {
    this._busy = false;
    this._timer = null;
    this._stopped = false;
  }

  start() {
    if (this._timer) return;
    const pollMs = Number(config.limbopet?.worldWorkerPollMs ?? 15000) || 15000;
    this._timer = setInterval(() => void this._tick(), pollMs);
    void this._tick();
  }

  stop() {
    this._stopped = true;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async _tick() {
    if (this._stopped) return;
    if (this._busy) return;
    this._busy = true;

    const systemDay = todayISODate();
    let day = systemDay;
    const now = new Date();
    const startedAt = Date.now();
    const db = initializePool();
    let lockClient = null;
    let locked = false;

    try {
      if (db) {
        lockClient = await db.connect();
        locked = await tryAdvisoryLock(lockClient, WORLD_WORKER_LOCK).catch(() => false);
        if (!locked) return;
      }

      // "Today" must come from SSOT (world_core fact) so dev simulation can move time.
      // In production, we always pin to the real system day.
      day = config.isProduction
        ? systemDay
        : await WorldDayService.getCurrentDayWithClient(lockClient, { fallbackDay: systemDay }).catch(() => systemDay);

      await WorldDayService.setCurrentDayWithClient(lockClient, day, { source: config.isProduction ? 'system' : 'world_worker' }).catch(
        () => null
      );

      await ShowrunnerService.ensureDailyEpisode({ day, now }).catch(() => null);
      await PlazaAmbientService.tick({ day }).catch(() => null);
      await ElectionService.tickDay({ day, fast: false }).catch(() => null);

      await transaction(async (client) => {
        await bestEffortInTransaction(
          client,
          async () => EconomyTickService.tickWithClient(client, { day }),
          { label: 'world_worker_economy' }
        );

        await bestEffortInTransaction(
          client,
          async () => DecayService.tickWithClient(client, { day }),
          { label: 'world_worker_decay' }
        );

        await bestEffortInTransaction(
          client,
          async () => StreakService.notifyDailyWarnings(client, { day, streakType: 'daily_login', now }),
          { label: 'world_worker_streak_warning' }
        );

        await bestEffortInTransaction(
          client,
          async () => ArenaService.tickDayWithClient(client, { day }),
          { label: 'world_worker_arena' }
        );

        await bestEffortInTransaction(
          client,
          async () => DecisionService.expireDecisions(day, {}, client),
          { label: 'world_worker_decisions' }
        );

        await bestEffortInTransaction(
          client,
          async () => ScandalService.tickWithClient(client, { day }),
          { label: 'world_worker_scandal' }
        );

        const worldAgentId = await bestEffortInTransaction(
          client,
          async () => WorldContextService.getWorldAgentId(),
          { label: 'world_worker_world_id', fallback: null }
        );
        if (worldAgentId) {
          await bestEffortInTransaction(
            client,
            async () => ResearchLabService.ensureOneActiveProjectWithClient(client, { createdByAgentId: worldAgentId }),
            { label: 'world_worker_research' }
          );
        }

        await bestEffortInTransaction(
          client,
          async () => SecretSocietyService.tickWithClient(client, { day }),
          { label: 'world_worker_society' }
        );

        await bestEffortInTransaction(
          client,
          async () => WorldConceptService.syncWorldConcept(client, day),
          { label: 'world_worker_concept' }
        );

        await bestEffortInTransaction(
          client,
          async () => CrossSystemEventService.processChainReactions(client, { day }),
          { label: 'world_worker_cross_system' }
        );

        const hookStage = hookStageForHour(now.getHours());
        if (worldAgentId && hookStage) {
          await bestEffortInTransaction(
            client,
            async () => notifyTodayHookStageWithClient(client, { worldId: worldAgentId, day, stage: hookStage, now }),
            { label: `world_worker_hook_${hookStage}` }
          );
        }
      });

      await recordTickStatus(lockClient, { day, ok: true, durationMs: Date.now() - startedAt }).catch(() => null);
    } catch (e) {
      if (config.nodeEnv !== 'test') {
        // eslint-disable-next-line no-console
        console.warn('[world-worker] error:', String(e?.message ?? e));
      }
      await recordTickStatus(lockClient, { day, ok: false, durationMs: Date.now() - startedAt, error: e?.message ?? e }).catch(() => null);
    } finally {
      if (lockClient) {
        if (locked) {
          await advisoryUnlock(lockClient, WORLD_WORKER_LOCK).catch(() => null);
        }
        lockClient.release();
      }
      this._busy = false;
    }
  }

  static maybeStart() {
    if (!config.limbopet?.worldWorker) return null;
    const worker = new WorldTickWorker();
    worker.start();
    if (config.nodeEnv !== 'test') {
      // eslint-disable-next-line no-console
      console.log(`[world-worker] started (pollMs=${Number(config.limbopet?.worldWorkerPollMs ?? 15000) || 15000})`);
    }
    return worker;
  }
}

module.exports = WorldTickWorker;
