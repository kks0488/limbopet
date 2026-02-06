const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireUserAuth } = require('../middleware/userAuth');
const { success } = require('../utils/response');
const { BadRequestError } = require('../utils/errors');
const { transaction, queryOne } = require('../config/database');
const config = require('../config');
const CrossSystemEventService = require('../services/CrossSystemEventService');
const WorldContextService = require('../services/WorldContextService');
const WorldDayService = require('../services/WorldDayService');
const PostService = require('../services/PostService');
const AgentService = require('../services/AgentService');

const router = Router();

function safeIsoDay(v) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

async function countEpisodesWithClient(client, day) {
  const iso = safeIsoDay(day);
  if (!iso) return 0;
  const row = await client
    .query(
      `SELECT COUNT(*)::int AS n
       FROM events
       WHERE event_type = 'SHOWRUNNER_EPISODE'
         AND (payload ? 'day')
         AND payload->>'day' = $1`,
      [iso]
    )
    .then((r) => r.rows?.[0] ?? null)
    .catch(() => null);
  return Number(row?.n ?? 0) || 0;
}

async function findLatestEpisodeDayWithClient(client) {
  const row = await client
    .query(
      `SELECT payload->>'day' AS day
       FROM events
       WHERE event_type = 'SHOWRUNNER_EPISODE'
         AND (payload ? 'day')
         AND (payload->>'day') ~ '^\\d{4}-\\d{2}-\\d{2}$'
       ORDER BY (payload->>'day')::date DESC, created_at DESC
       LIMIT 1`
    )
    .then((r) => r.rows?.[0] ?? null)
    .catch(() => null);
  return safeIsoDay(row?.day);
}

async function resolveTodayDayWithClient(client, explicitDay) {
  const dayFromQuery = safeIsoDay(explicitDay);
  const systemDay = WorldDayService.todayISODate();
  const ssotDay = dayFromQuery || (await WorldDayService.getCurrentDayWithClient(client, { fallbackDay: systemDay }).catch(() => null)) || systemDay;

  const episodesOnSsot = await countEpisodesWithClient(client, ssotDay);
  if (dayFromQuery || episodesOnSsot > 0) {
    return { ssotDay, day: ssotDay, fallbackApplied: false };
  }

  const latestDay = await findLatestEpisodeDayWithClient(client);
  if (!latestDay) {
    return { ssotDay, day: ssotDay, fallbackApplied: false };
  }

  return {
    ssotDay,
    day: latestDay,
    fallbackApplied: latestDay !== ssotDay
  };
}

async function listEpisodesByDayWithClient(client, day, { limit = 20 } = {}) {
  const iso = safeIsoDay(day);
  if (!iso) return [];
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));

  const { rows } = await client.query(
    `SELECT id, payload, salience_score, created_at
     FROM events
     WHERE event_type = 'SHOWRUNNER_EPISODE'
       AND (payload ? 'day')
       AND payload->>'day' = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [iso, safeLimit]
  );

  return (rows || []).map((r) => {
    const payload = r?.payload && typeof r.payload === 'object' ? r.payload : {};
    const cast = payload.cast && typeof payload.cast === 'object' ? payload.cast : {};
    const aName = String(cast.aName || cast.a_name || '').trim() || null;
    const bName = String(cast.bName || cast.b_name || '').trim() || null;
    return {
      id: r.id,
      day: safeIsoDay(payload.day) || iso,
      title: String(payload.title || '').trim() || null,
      hook: String(payload.hook || '').trim() || null,
      scenario: String(payload.scenario || '').trim() || null,
      location: String(payload.location || '').trim() || null,
      company: String(payload.company || '').trim() || null,
      episode_index: Number(payload.episode_index ?? 0) || 0,
      cast: {
        a_id: String(cast.aId || cast.a_id || '').trim() || null,
        b_id: String(cast.bId || cast.b_id || '').trim() || null,
        a_name: aName,
        b_name: bName
      },
      salience_score: Number(r.salience_score ?? 0) || 0,
      created_at: r.created_at
    };
  });
}

/**
 * GET /world/ticker
 * Optional query: day=YYYY-MM-DD
 */
router.get('/ticker', asyncHandler(async (req, res) => {
  const dayRaw = req.query?.day ? String(req.query.day).trim() : null;
  if (dayRaw && !safeIsoDay(dayRaw)) {
    throw new BadRequestError('Invalid day format (YYYY-MM-DD)');
  }

  const ticker = await transaction(async (client) => {
    return CrossSystemEventService.getWorldTickerWithClient(client, { day: dayRaw || null });
  });

  success(res, ticker);
}));

/**
 * GET /world/today
 * Public world snapshot with fallback day logic.
 */
router.get('/today', asyncHandler(async (req, res) => {
  const dayRaw = req.query?.day ? String(req.query.day).trim() : null;
  if (dayRaw && !safeIsoDay(dayRaw)) {
    throw new BadRequestError('Invalid day format (YYYY-MM-DD)');
  }

  const epLimit = Math.max(1, Math.min(60, Number(req.query?.episode_limit ?? req.query?.episodeLimit ?? 20) || 20));
  const tickerLimit = Math.max(1, Math.min(100, Number(req.query?.ticker_limit ?? req.query?.tickerLimit ?? 40) || 40));

  const out = await transaction(async (client) => {
    const resolved = await resolveTodayDayWithClient(client, dayRaw);
    const day = resolved.day;

    const [bundle, episodes, ticker] = await Promise.all([
      WorldContextService.getBundle({ day, includeOpenRumors: true, ensureEpisode: false }).catch(() => null),
      listEpisodesByDayWithClient(client, day, { limit: epLimit }).catch(() => []),
      WorldContextService.getLiveTicker({ limit: tickerLimit, day }).catch(() => [])
    ]);

    const worldDailySummary = bundle?.worldDaily?.summary && typeof bundle.worldDaily.summary === 'object'
      ? bundle.worldDaily.summary
      : null;
    const worldConcept = bundle?.worldConcept && typeof bundle.worldConcept === 'object' ? bundle.worldConcept : null;
    const theme = worldConcept?.theme ?? worldDailySummary?.theme ?? null;
    const atmosphere = worldConcept?.atmosphere ?? worldDailySummary?.atmosphere ?? null;

    return {
      requested_day: safeIsoDay(dayRaw),
      ssot_day: resolved.ssotDay,
      day,
      fallback_applied: Boolean(resolved.fallbackApplied),
      episodes,
      ticker,
      theme,
      atmosphere,
      world_daily: worldDailySummary,
      arena: bundle?.arena ?? null,
      economy: bundle?.economy ?? null,
      research: bundle?.research ?? null,
      society: bundle?.society ?? null,
      news_signals: Array.isArray(bundle?.newsSignals) ? bundle.newsSignals : []
    };
  });

  success(res, out);
}));

/**
 * GET /world/plaza
 * Legacy alias for plaza feed.
 */
router.get('/plaza', requireUserAuth, asyncHandler(async (req, res) => {
  const { sort = 'new', limit = 25, offset = 0, kind = 'all', submolt = 'general' } = req.query;

  const safeLimit = Math.min(parseInt(String(limit), 10) || 25, config.pagination.maxLimit);
  const safeOffset = Math.max(0, parseInt(String(offset), 10) || 0);
  const kindTerm = String(kind || 'all').trim().toLowerCase();
  const submoltTerm = String(submolt || 'general').trim().toLowerCase() || 'general';

  const userPetCount = await queryOne(
    `SELECT COUNT(*)::int AS n
     FROM agents
     WHERE name <> 'world_core'
       AND owner_user_id IS NOT NULL
       AND is_active = true`
  )
    .then((r) => Number(r?.n ?? 0) || 0)
    .catch(() => 0);
  const onlyUserAuthors = userPetCount > Number(config.limbopet?.npcColdStartMaxUserPets ?? 4);

  let postTypes = null;
  if (kindTerm === 'plaza') postTypes = ['plaza'];
  else if (kindTerm === 'diary') postTypes = ['text', 'diary'];
  else if (kindTerm === 'arena') postTypes = ['arena'];

  const [posts, petRow] = await Promise.all([
    PostService.getFeed({
      sort,
      limit: safeLimit,
      offset: safeOffset,
      submolt: submoltTerm,
      q: null,
      postTypes,
      onlyUserAuthors,
      excludePostTypes: ['broadcast', 'rumor']
    }).catch(() => []),
    AgentService.findByOwnerUserId(req.user.id).catch(() => null)
  ]);

  success(res, {
    viewer: { has_pet: Boolean(petRow) },
    posts,
    pagination: {
      count: posts.length,
      limit: safeLimit,
      offset: safeOffset,
      hasMore: posts.length === safeLimit
    }
  });
}));

module.exports = router;
