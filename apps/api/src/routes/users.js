/**
 * User Routes (Phase A)
 * /api/v1/users/*
 *
 * Browser-friendly endpoints that use User JWT only (no pet API key needed).
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireUserAuth } = require('../middleware/userAuth');
const { success, created } = require('../utils/response');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const { transaction, queryOne, queryAll } = require('../config/database');
const AgentService = require('../services/AgentService');
const config = require('../config');
const jwt = require('jsonwebtoken');
const PostService = require('../services/PostService');
const CommentService = require('../services/CommentService');
const VoteService = require('../services/VoteService');
const { postLimiter } = require('../middleware/rateLimit');
const ShowrunnerService = require('../services/ShowrunnerService');
const PlazaAmbientService = require('../services/PlazaAmbientService');
const WorldContextService = require('../services/WorldContextService');
const PetStateService = require('../services/PetStateService');
const PetMemoryService = require('../services/PetMemoryService');
const PetBrainService = require('../services/PetBrainService');
const PetContentService = require('../services/PetContentService');
const DailyMissionService = require('../services/DailyMissionService');
const PerkService = require('../services/PerkService');
const UserService = require('../services/UserService');
const UserBrainProfileService = require('../services/UserBrainProfileService');
const UserPromptProfileService = require('../services/UserPromptProfileService');
const UserByokLlmService = require('../services/UserByokLlmService');
const BrainJobService = require('../services/BrainJobService');
const DevSeedService = require('../services/DevSeedService');
const ResearchLabService = require('../services/ResearchLabService');
const NpcSeedService = require('../services/NpcSeedService');
const SecretSocietyService = require('../services/SecretSocietyService');
const ElectionService = require('../services/ElectionService');
const EconomyTickService = require('../services/EconomyTickService');
const ArenaService = require('../services/ArenaService');
const ArenaPrefsService = require('../services/ArenaPrefsService');
const RelationshipService = require('../services/RelationshipService');
const RumorPlantService = require('../services/RumorPlantService');
const ButterflyReportService = require('../services/ButterflyReportService');
const WorldDayService = require('../services/WorldDayService');
const DecisionService = require('../services/DecisionService');
const StreakService = require('../services/StreakService');
const NotificationService = require('../services/NotificationService');
const { bestEffortInTransaction } = require('../utils/savepoint');

const router = Router();

function roleCodeForJob(jobCode) {
  switch (String(jobCode || '').trim()) {
    case 'journalist':
      return 'investigator';
    case 'engineer':
      return 'analyst';
    case 'detective':
      return 'fact_checker';
    case 'barista':
      return 'editor';
    case 'merchant':
      return 'marketer';
    case 'janitor':
      return 'pm';
    default:
      return 'member';
  }
}

function addDaysISODate(isoDay, days) {
  const s = String(isoDay || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const n = Math.floor(Number(days) || 0);
  const [y, m, d] = s.split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

async function getParticipationForAgent(agentId) {
  const societyRow = await queryOne(
    `SELECT id, name, purpose
     FROM secret_societies
     WHERE status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`
  ).catch(() => null);

  const societyMy = societyRow
    ? await queryOne(
      `SELECT status, role, joined_at, left_at
       FROM secret_society_members
       WHERE society_id = $1 AND agent_id = $2
       LIMIT 1`,
      [societyRow.id, agentId]
    ).catch(() => null)
    : null;

  const researchRow = await queryOne(
    `SELECT id, title, stage, status
     FROM research_projects
     WHERE status IN ('recruiting','in_progress')
     ORDER BY created_at DESC
     LIMIT 1`
  ).catch(() => null);

  const researchMy = researchRow
    ? await queryOne(
      `SELECT status, role_code, joined_at, left_at
       FROM research_members
       WHERE project_id = $1 AND agent_id = $2
       LIMIT 1`,
      [researchRow.id, agentId]
    ).catch(() => null)
    : null;

  return {
    society: societyRow
      ? {
        society: { id: societyRow.id, name: societyRow.name, purpose: societyRow.purpose },
        my: societyMy
          ? {
            status: String(societyMy.status || '').trim(),
            role: String(societyMy.role || '').trim(),
            joined_at: societyMy.joined_at,
            left_at: societyMy.left_at
          }
          : null
      }
      : null,
    research: researchRow
      ? {
        project: { id: researchRow.id, title: researchRow.title, stage: researchRow.stage, status: researchRow.status },
        my: researchMy
          ? {
            status: String(researchMy.status || '').trim(),
            role_code: String(researchMy.role_code || '').trim(),
            joined_at: researchMy.joined_at,
            left_at: researchMy.left_at
          }
          : null,
        canJoin: Boolean(researchRow && !researchMy)
      }
      : null
  };
}

router.get('/me', requireUserAuth, asyncHandler(async (req, res) => {
  success(res, { user: req.user });
}));

router.get('/me/streaks', requireUserAuth, asyncHandler(async (req, res) => {
  const streaks = await transaction(async (client) => {
    return StreakService.getAllStreaks(client, req.user.id);
  });
  success(res, { streaks });
}));

router.post('/me/streaks/record', requireUserAuth, asyncHandler(async (req, res) => {
  const rawType = req.body?.streak_type ?? req.body?.streakType ?? 'daily_login';
  const streakType = String(rawType || 'daily_login').trim() || 'daily_login';

  const result = await transaction(async (client) => {
    const day = (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();
    return StreakService.recordActivity(client, req.user.id, streakType, day);
  });

  success(res, result);
}));

router.post('/me/streaks/shield', requireUserAuth, asyncHandler(async (req, res) => {
  const rawType = req.body?.streak_type ?? req.body?.streakType ?? 'daily_login';
  const streakType = String(rawType || 'daily_login').trim() || 'daily_login';

  const result = await transaction(async (client) => {
    return StreakService.useShield(client, req.user.id, streakType);
  });

  success(res, result);
}));

// Backward compatibility: older clients call /me/streaks/:type/shield to recover streak.
router.post('/me/streaks/:type/shield', requireUserAuth, asyncHandler(async (req, res) => {
  const type = String(req.params?.type ?? '').trim();
  if (!type) throw new BadRequestError('streak type is required', 'BAD_STREAK_TYPE');

  const result = await transaction(async (client) => {
    const day = (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();
    return StreakService.recoverWithShield(client, req.user.id, type, day);
  });

  success(res, result);
}));

router.get('/me/notifications', requireUserAuth, asyncHandler(async (req, res) => {
  const unreadOnly = String(req.query?.unread ?? '').trim().toLowerCase() === 'true';
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(req.query?.limit ?? 30) || 30)));

  const result = await transaction(async (client) => {
    const unread_count = await NotificationService.getCount(client, req.user.id);
    if (unreadOnly) {
      const notifications = await NotificationService.getUnread(client, req.user.id, limit);
      return { notifications, unread_count };
    }

    const { rows } = await client.query(
      `SELECT id, user_id, type, title, body, data, read_at, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [req.user.id, limit]
    );
    return { notifications: rows || [], unread_count };
  });

  success(res, result);
}));

router.post('/me/notifications/:id/read', requireUserAuth, asyncHandler(async (req, res) => {
  const notifId = Number(req.params?.id);
  const result = await transaction(async (client) => {
    const notification = await NotificationService.markRead(client, req.user.id, notifId);
    const unread_count = await NotificationService.getCount(client, req.user.id);
    return { notification, unread_count };
  });
  success(res, result);
}));

router.post('/me/notifications/read-all', requireUserAuth, asyncHandler(async (req, res) => {
  const result = await transaction(async (client) => {
    const marked = await NotificationService.markAllRead(client, req.user.id);
    const unread_count = await NotificationService.getCount(client, req.user.id);
    return { ...marked, unread_count };
  });
  success(res, result);
}));

/**
 * GET /users/me/bootstrap
 *
 * Unity/Web "single call" bootstrap bundle:
 * - user
 * - pet(+stats+facts) if present
 * - world today bundle (broadcast + civic line + research/society/economy)
 * - relationships preview
 * - participation (society invite / research join)
 * - active elections snapshot
 */
router.get('/me/bootstrap', requireUserAuth, asyncHandler(async (req, res) => {
  const day = req.query?.day ? String(req.query.day).trim() : PetMemoryService.getTodayISODate();
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequestError('Invalid day format (YYYY-MM-DD)');
  }

  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  const world = await WorldContextService.getBundle({ day, includeOpenRumors: true }).catch(() => null);

  let pet = null;
  let stats = null;
  let facts = [];
  let relationships = [];
  let participation = { society: null, research: null };
  let elections = [];

  if (petRow) {
    const state = await PetStateService.getState(petRow.id).catch(() => null);
    pet = state?.pet ?? null;
    stats = state?.stats ?? null;
    facts = await PetMemoryService.listFacts(petRow.id, { limit: 50 }).catch(() => []);
    relationships = await RelationshipService.listForAgent(petRow.id, { limit: 20 }).catch(() => []);
    participation = await getParticipationForAgent(petRow.id).catch(() => ({ society: null, research: null }));

    elections = await ElectionService.listActiveElections({ day, viewerAgentId: petRow.id }).catch(() => []);
  } else {
    elections = await ElectionService.listActiveElections({ day, viewerAgentId: null }).catch(() => []);
  }

  success(res, {
    day,
    user: req.user,
    viewer: { has_pet: Boolean(petRow) },
    dev: { dev_tools: Boolean(config.limbopet?.devTools) },
    world,
    pet: pet ? { pet, stats, facts } : null,
    relationships,
    participation,
    elections
  });
}));

router.get('/me/pet', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) {
    success(res, { pet: null });
    return;
  }

  const { pet, stats, progression, missions } = await PetStateService.getState(petRow.id);
  const facts = await PetMemoryService.listFacts(petRow.id, { limit: 50 });
  const arena_prefs = await transaction(async (client) => {
    return ArenaPrefsService.getWithClient(client, petRow.id);
  }).catch(() => ({ modes: null, coach_note: '' }));

  let perk_offer = null;
  const sp = Math.max(0, Math.trunc(Number(progression?.skill_points ?? 0) || 0));
  if (sp > 0) {
    perk_offer = await transaction(async (client) => {
      const day =
        String(missions?.day ?? '').trim() ||
        (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) ||
        WorldDayService.todayISODate();
      const codes = await PerkService.ensureDailyOfferWithClient(client, petRow.id, day).catch(() => []);
      const all = PerkService.listAll();
      const map = new Map(all.map((p) => [p.code, p]));
      return {
        day,
        codes,
        choices: (codes || []).map((c) => map.get(String(c || '').toUpperCase()) || { code: String(c || '').toUpperCase(), name: String(c || ''), desc: '' })
      };
    }).catch(() => null);
  }

  success(res, { pet, stats, facts, progression, missions, perk_offer, arena_prefs });
}));

/**
 * POST /users/me/pet/arena-prefs
 * Body: { modes?: string[] | null, coach_note?: string | null }
 */
router.post('/me/pet/arena-prefs', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'arena_prefs' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const modesRaw = req.body?.modes;
  const coachRaw = req.body?.coach_note ?? req.body?.coachNote;

  const modes = Array.isArray(modesRaw) ? modesRaw : modesRaw == null ? [] : null;
  if (modes === null) throw new BadRequestError('modes must be an array (or null)');

  const coach_note = coachRaw == null ? '' : String(coachRaw);

  const result = await transaction(async (client) => {
    return ArenaPrefsService.setWithClient(client, petRow.id, { modes, coach_note });
  });

  success(res, result);
}));

router.post('/me/pet/actions', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'care' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const action = String(req.body?.action ?? '').trim();
  const payload = req.body?.payload ?? {};
  const result = await PetStateService.performAction(petRow.id, action, payload);
  success(res, result);
}));

router.get('/me/pet/timeline', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const events = await PetStateService.getTimeline(petRow.id, { limit: req.query?.limit });
  success(res, { events });
}));

router.get('/me/pet/relationships', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const limit = req.query?.limit ? Number(req.query.limit) : 20;
  const relationships = await RelationshipService.listForAgent(petRow.id, { limit });
  success(res, { relationships });
}));

router.get('/me/pet/limbo/today', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const inputDay = req.query?.day ? String(req.query.day).trim() : null;
  const day =
    !config.isProduction && config.limbopet.devTools && inputDay && /^\d{4}-\d{2}-\d{2}$/.test(inputDay)
      ? inputDay
      : PetMemoryService.getTodayISODate();
  const { memory, weekly, job, checkin } = await PetMemoryService.ensureDailySummaryJob(petRow.id, day);
  success(res, { day, memory, weekly, job, checkin });
}));

router.post('/me/pet/memory-nudges', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'direction' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const nudges = Array.isArray(req.body?.nudges) ? req.body.nudges : [req.body];
  const saved = await PetMemoryService.upsertNudges(petRow.id, nudges);

  // Mission: direction 1 (best-effort).
  await transaction(async (client) => {
    await DailyMissionService.completeWithClient(client, petRow.id, { code: 'DIRECTION_1', source: 'nudge' }).catch(() => null);
  }).catch(() => null);

  success(res, { saved });
}));

/**
 * POST /users/me/pet/perks/choose
 * Body: { code }
 */
router.post('/me/pet/perks/choose', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const code = String(req.body?.code ?? '').trim();
  if (!code) throw new BadRequestError('code is required');

  const result = await transaction(async (client) => {
    const day = (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();
    const chosen = await PerkService.choosePerkWithClient(client, petRow.id, { code, day });
    const owned = await PerkService.listOwnedCodesWithClient(client, petRow.id).catch(() => []);
    const { rows } = await client.query(
      `SELECT xp, level, skill_points
       FROM pet_stats
       WHERE agent_id = $1
       LIMIT 1`,
      [petRow.id]
    );
    const p = rows?.[0] ?? null;
    const level = Math.max(1, Math.trunc(Number(p?.level) || 1));
    const progression = {
      level,
      xp: Math.max(0, Math.trunc(Number(p?.xp) || 0)),
      next_level_xp: require('../services/ProgressionService').nextLevelXp(level),
      skill_points: Math.max(0, Math.trunc(Number(p?.skill_points) || 0)),
      perks: owned
    };
    const missions = await DailyMissionService.getBundleWithClient(client, petRow.id, { day }).catch(() => null);
    const sp = Math.max(0, Math.trunc(Number(progression.skill_points) || 0));
    const perk_offer = sp > 0
      ? await (async () => {
        const codes = await PerkService.ensureDailyOfferWithClient(client, petRow.id, day).catch(() => []);
        const all = PerkService.listAll();
        const map = new Map(all.map((x) => [x.code, x]));
        return { day, codes, choices: (codes || []).map((c2) => map.get(String(c2 || '').toUpperCase()) || { code: String(c2 || ''), name: String(c2 || ''), desc: '' }) };
      })()
      : null;
    return { chosen, progression, missions, perk_offer };
  });

  success(res, result);
}));

/**
 * POST /users/me/pet/diary-post
 * Creates a DIARY_POST brain job (BYOK).
 */
router.post('/me/pet/diary-post', requireUserAuth, postLimiter, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'diary' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const submolt = req.body?.submolt ?? 'general';
  const result = await PetContentService.createDiaryPostJob(petRow.id, { submolt });
  created(res, result);
}));

/**
 * POST /users/me/pet/plaza-post
 * Creates a PLAZA_POST brain job (BYOK).
 */
router.post('/me/pet/plaza-post', requireUserAuth, postLimiter, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'plaza_post' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const submolt = req.body?.submolt ?? 'general';
  const seed = req.body?.seed ?? null;
  const result = await PetContentService.createPlazaPostJob(petRow.id, { submolt, seed });
  created(res, result);
}));

router.patch('/me/pet/profile', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const description = req.body?.description;
  const displayName = req.body?.displayName;
  const avatarUrl = req.body?.avatarUrl;

  const agent = await AgentService.update(petRow.id, {
    description,
    display_name: displayName,
    avatar_url: avatarUrl
  });
  success(res, { pet: agent });
}));

router.get('/me/pet/brain/status', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const status = await PetBrainService.getStatus(petRow.id);
  success(res, { status });
}));

/**
 * GET /users/me/brain
 * Returns user's BYOK profile (never returns raw API key).
 */
router.get('/me/brain', requireUserAuth, asyncHandler(async (req, res) => {
  const profile = await UserBrainProfileService.get(req.user.id);
  success(res, { profile });
}));

/**
 * GET /users/me/prompt
 * Returns user-level custom dialogue prompt profile.
 */
router.get('/me/prompt', requireUserAuth, asyncHandler(async (req, res) => {
  const profile = await UserPromptProfileService.get(req.user.id);
  success(res, { profile });
}));

/**
 * GET /users/me/prompt-profile
 * Alias of /users/me/prompt (preferred explicit path).
 */
router.get('/me/prompt-profile', requireUserAuth, asyncHandler(async (req, res) => {
  const profile = await UserPromptProfileService.get(req.user.id);
  success(res, { profile });
}));

/**
 * PUT /users/me/prompt
 * Body: { enabled: boolean, prompt_text: string }
 */
router.put('/me/prompt', requireUserAuth, asyncHandler(async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const promptText = String(req.body?.prompt_text ?? req.body?.promptText ?? '').trim();
  const profile = await UserPromptProfileService.upsert(req.user.id, { enabled, promptText });
  success(res, { profile });
}));

/**
 * PUT /users/me/prompt-profile
 * Body: { enabled: boolean, prompt_text: string }
 */
router.put('/me/prompt-profile', requireUserAuth, asyncHandler(async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const promptText = String(req.body?.prompt_text ?? req.body?.promptText ?? '').trim();
  const profile = await UserPromptProfileService.upsert(req.user.id, { enabled, promptText });
  success(res, { profile });
}));

/**
 * DELETE /users/me/prompt
 * Disables and removes custom prompt profile.
 */
router.delete('/me/prompt', requireUserAuth, asyncHandler(async (req, res) => {
  await UserPromptProfileService.delete(req.user.id);
  success(res, { ok: true });
}));

/**
 * DELETE /users/me/prompt-profile
 * Alias of /users/me/prompt.
 */
router.delete('/me/prompt-profile', requireUserAuth, asyncHandler(async (req, res) => {
  await UserPromptProfileService.delete(req.user.id);
  success(res, { ok: true });
}));

/**
 * POST /users/me/brain
 * Body: { provider, model, api_key, base_url? }
 *
 * Stores credentials encrypted at rest after a lightweight validation call.
 */
router.post('/me/brain', requireUserAuth, asyncHandler(async (req, res) => {
  const provider = String(req.body?.provider ?? '').trim();
  const model = String(req.body?.model ?? '').trim();
  const apiKey = String(req.body?.api_key ?? req.body?.apiKey ?? '').trim();
  const baseUrl = req.body?.base_url ?? req.body?.baseUrl ?? null;

  // Validate credentials before saving.
  try {
    await UserByokLlmService.ping({ provider, baseUrl, apiKey, model });
  } catch (e) {
    throw new BadRequestError('두뇌 연결 실패', 'BRAIN_CONNECT_FAIL', String(e?.message ?? e));
  }

  const profile = await UserBrainProfileService.upsert(req.user.id, {
    provider,
    model,
    apiKey,
    baseUrl
  });

  await UserBrainProfileService.markValidation(req.user.id, { ok: true, error: null });

  success(res, { profile });
}));

/**
 * POST /users/me/brain/oauth/google/start
 * Returns a Google OAuth URL to connect Gemini via OAuth (no API key).
 *
 * Notes:
 * - Requires GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET
 * - Callback: GET /api/v1/oauth/google/gemini/callback
 */
router.post('/me/brain/oauth/google/start', requireUserAuth, asyncHandler(async (req, res) => {
  const clientId = String(config.google?.clientId || '').trim();
  const clientSecret = String(config.google?.clientSecret || '').trim();
  if (!clientId) throw new BadRequestError('Google OAuth not configured', 'Set GOOGLE_OAUTH_CLIENT_ID');
  if (!clientSecret) throw new BadRequestError('Google OAuth not configured', 'Set GOOGLE_OAUTH_CLIENT_SECRET');

  const redirectUri = `${config.limbopet.baseUrl}/api/v1/oauth/google/gemini/callback`;
  const state = jwt.sign({ sub: req.user.id, purpose: 'gemini_oauth' }, config.jwtSecret, { expiresIn: '15m' });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: 'https://www.googleapis.com/auth/generative-language',
    state
  });
  if (req.user.email) params.set('login_hint', String(req.user.email));

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  success(res, { url });
}));

/**
 * POST /users/me/brain/proxy/connect/:provider
 * Initiates OAuth flow via CLIProxyAPI for the given AI service.
 * Returns { url, state } — client opens url in browser to authenticate.
 * Supported providers: google, openai, anthropic, antigravity, qwen, iflow
 */
const PROXY_PROVIDER_MAP = {
  google: 'gemini-cli-auth-url',
  gemini: 'gemini-cli-auth-url',
  openai: 'codex-auth-url',
  codex: 'codex-auth-url',
  anthropic: 'anthropic-auth-url',
  claude: 'anthropic-auth-url',
  antigravity: 'antigravity-auth-url',
  qwen: 'qwen-auth-url',
  iflow: 'iflow-auth-url'
};
const PROXY_BASE = String(config.limbopet?.proxyBaseUrl || process.env.CLIPROXY_BASE_URL || 'http://127.0.0.1:8317').replace(/\/+$/, '');
const PROXY_MGMT_KEY = String(config.limbopet?.proxyMgmtKey || process.env.CLIPROXY_MGMT_KEY || 'limbopet-mgmt-dev');

router.post('/me/brain/proxy/connect/:provider', requireUserAuth, asyncHandler(async (req, res) => {
  const provRaw = String(req.params.provider ?? '').trim().toLowerCase();
  const endpoint = PROXY_PROVIDER_MAP[provRaw];
  if (!endpoint) throw new BadRequestError(`지원하지 않는 AI 서비스: ${provRaw}`, 'UNSUPPORTED_PROVIDER');

  const resp = await fetch(`${PROXY_BASE}/v0/management/${endpoint}?is_webui=true`, {
    headers: { 'X-Management-Key': PROXY_MGMT_KEY }
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || data?.status !== 'ok') {
    throw new BadRequestError('AI 서비스 인증 URL 생성 실패', 'PROXY_AUTH_FAIL', data?.error || `HTTP ${resp.status}`);
  }
  success(res, { url: data.url, state: data.state, provider: provRaw });
}));

/**
 * GET /users/me/brain/proxy/status
 * Polls CLIProxyAPI for OAuth completion status.
 * Query: ?state=xxx
 * Returns { status: 'wait'|'ok'|'error', error? }
 */
router.get('/me/brain/proxy/status', requireUserAuth, asyncHandler(async (req, res) => {
  const state = String(req.query.state ?? '').trim();
  if (!state) throw new BadRequestError('state is required');

  const resp = await fetch(`${PROXY_BASE}/v0/management/get-auth-status?state=${encodeURIComponent(state)}`, {
    headers: { 'X-Management-Key': PROXY_MGMT_KEY }
  });
  const data = await resp.json().catch(() => null);
  success(res, { status: data?.status || 'error', error: data?.error || null });
}));

/**
 * POST /users/me/brain/proxy/complete
 * After OAuth completes, saves the proxy brain profile.
 * Body: { provider }
 */
router.post('/me/brain/proxy/complete', requireUserAuth, asyncHandler(async (req, res) => {
  const provRaw = String(req.body?.provider ?? '').trim().toLowerCase();
  const normalizedProvider = provRaw === 'codex' ? 'openai'
    : provRaw === 'claude' ? 'anthropic'
    : provRaw === 'gemini' ? 'google'
    : provRaw;

  const profile = await UserBrainProfileService.upsertProxy(req.user.id, {
    provider: normalizedProvider
  });
  success(res, { profile });
}));

/**
 * GET /users/me/brain/proxy/models
 * Lists available models from CLIProxyAPI.
 */
router.get('/me/brain/proxy/models', requireUserAuth, asyncHandler(async (req, res) => {
  const resp = await fetch(`${PROXY_BASE}/v1/models`, {
    headers: { 'Authorization': `Bearer ${String(config.limbopet?.proxyApiKey || process.env.CLIPROXY_API_KEY || 'limbopet-proxy-dev-key')}` }
  });
  const data = await resp.json().catch(() => null);
  success(res, { models: data?.data || [] });
}));

/**
 * GET /users/me/brain/proxy/auth-files
 * Lists connected AI service accounts from CLIProxyAPI.
 */
router.get('/me/brain/proxy/auth-files', requireUserAuth, asyncHandler(async (req, res) => {
  const resp = await fetch(`${PROXY_BASE}/v0/management/auth-files`, {
    headers: { 'X-Management-Key': PROXY_MGMT_KEY }
  });
  const data = await resp.json().catch(() => null);
  const files = (data?.files || []).map(f => ({
    name: f.name,
    provider: f.type || f.provider || 'unknown',
    email: f.email || null,
    status: f.status || 'active',
    disabled: f.disabled || false,
    updated_at: f.modtime || f.updated_at || null
  }));
  success(res, { files });
}));

/**
 * DELETE /users/me/brain/proxy/auth-files/:provider
 * Disconnects a specific OAuth-connected AI provider.
 */
router.delete('/me/brain/proxy/auth-files/:provider', requireUserAuth, asyncHandler(async (req, res) => {
  const provider = String(req.params.provider ?? '').trim().toLowerCase();
  if (!provider) throw new BadRequestError('provider is required');
  const resp = await fetch(`${PROXY_BASE}/v0/management/auth-files/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    headers: { 'X-Management-Key': PROXY_MGMT_KEY },
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    throw new BadRequestError(data?.error || `연결 해제 실패 (HTTP ${resp.status})`, 'PROXY_DISCONNECT_FAIL');
  }
  success(res, { ok: true });
}));

/**
 * DELETE /users/me/brain
 * Deletes stored BYOK profile.
 */
router.delete('/me/brain', requireUserAuth, asyncHandler(async (req, res) => {
  await UserBrainProfileService.delete(req.user.id);
  success(res, { ok: true });
}));

/**
 * GET /users/me/brain/jobs
 * Query: status=failed|pending|leased|done, type=DIALOGUE..., limit=30
 */
router.get('/me/brain/jobs', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const status = req.query?.status ? String(req.query.status).trim().toLowerCase() : null;
  const type = req.query?.type ? String(req.query.type).trim().toUpperCase() : null;
  const limit = req.query?.limit ? Number(req.query.limit) : 30;

  const jobs = await BrainJobService.listJobsForAgent(petRow.id, { status, jobType: type, limit });
  success(res, { jobs });
}));

/**
 * POST /users/me/brain/jobs/:id/retry
 * Retries a failed brain job for the signed-in user's pet.
 */
router.post('/me/brain/jobs/:id/retry', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const jobId = String(req.params?.id ?? '').trim();
  if (!jobId) throw new BadRequestError('job id is required', 'BRAIN_JOB_ID_REQUIRED');

  const job = await BrainJobService.retryJobForAgent(petRow.id, jobId);
  success(res, { job });
}));

/**
 * GET /users/me/feed
 * General feed for the signed-in user (requires a pet).
 */
router.get('/me/feed', requireUserAuth, asyncHandler(async (req, res) => {
  // Keep the world alive: ensure today's episode exists (at most once/day).
  const world = await ShowrunnerService.ensureDailyEpisode();
  // Keep the plaza alive too (free-form posts, BYOK-first).
  await PlazaAmbientService.tick({ day: world?.day || null }).catch(() => null);

  const { sort = 'new', limit = 25, offset = 0, submolt = 'general' } = req.query;

  const safeLimit = Math.min(parseInt(limit, 10) || 25, config.pagination.maxLimit);
  const safeOffset = parseInt(offset, 10) || 0;

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

  const posts = await PostService.getFeed({
    sort,
    limit: safeLimit,
    offset: safeOffset,
    submolt,
    onlyUserAuthors,
    // Keep plaza simple: broadcasts live in the sticky “오늘의 방송” card.
    // Rumor/evidence posts are removed from MVP.
    excludePostTypes: ['broadcast', 'rumor']
  });

  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  success(res, {
    world,
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

/**
 * GET /users/me/decisions
 * Pending timed decisions for my pet (loss aversion).
 */
router.get('/me/decisions', requireUserAuth, asyncHandler(async (req, res) => {
  const rows = await DecisionService.getActiveDecisionsForUser(req.user.id).catch(() => []);
  const now = Date.now();
  const decisions = (rows || []).map((r) => {
    const exp = new Date(r.expires_at);
    const remainingMs = Number.isNaN(exp.getTime()) ? 0 : Math.max(0, exp.getTime() - now);
    return {
      id: r.id,
      agent_id: r.agent_id,
      decision_type: r.decision_type,
      expires_at: r.expires_at,
      remaining_ms: remainingMs,
      choices: r.choices || [],
      default_choice: r.default_choice || null,
      penalty: r.penalty || {},
      meta: r.meta || {},
      created_at: r.created_at
    };
  });
  success(res, { decisions });
}));

/**
 * GET /users/me/absence-summary
 * "Return" recap after being inactive (consumed once).
 *
 * Response:
 * - { days_away, lost, current_state }
 */
router.get('/me/absence-summary', requireUserAuth, asyncHandler(async (req, res) => {
  const result = await transaction(async (client) => {
    const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
    if (!petRow) {
      return { days_away: 0, lost: {}, current_state: { has_pet: false } };
    }

    const day = (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();
    const season = await ArenaService.ensureSeasonForDayWithClient(client, day).catch(() => null);
    const seasonId = season?.id ?? null;

    const summaryRow = await client
      .query(
        `SELECT id, value
         FROM facts
         WHERE agent_id = $1 AND kind = 'decay' AND key = 'return_summary'
         FOR UPDATE`,
        [petRow.id]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    let summary = summaryRow?.value && typeof summaryRow.value === 'object' ? summaryRow.value : null;
    if (summaryRow?.id) {
      await client.query(`DELETE FROM facts WHERE id = $1`, [summaryRow.id]).catch(() => null);
    }

    const daysAway = Math.max(0, Math.trunc(Number(summary?.days_away ?? 0) || 0));
    const lostBlob = summary?.lost && typeof summary.lost === 'object' ? summary.lost : {};
    const lost = lostBlob.lost && typeof lostBlob.lost === 'object' ? lostBlob.lost : lostBlob;

    const agent = await client
      .query(`SELECT id, name, display_name, karma FROM agents WHERE id = $1 LIMIT 1`, [petRow.id])
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    const cond = await client
      .query(`SELECT value FROM facts WHERE agent_id = $1 AND kind = 'arena' AND key = 'condition' LIMIT 1`, [petRow.id])
      .then((r) => r.rows?.[0]?.value ?? null)
      .catch(() => null);
    const condObj = cond && typeof cond === 'object' ? cond : {};

    const ratingRow = seasonId
      ? await client
        .query(
          `SELECT rating, wins, losses, streak, updated_at
           FROM arena_ratings
           WHERE season_id = $1 AND agent_id = $2
           LIMIT 1`,
          [seasonId, petRow.id]
        )
        .then((r) => r.rows?.[0] ?? null)
        .catch(() => null)
      : null;

    const emp = await client
      .query(
        `SELECT ce.status, ce.role, ce.wage, ce.joined_at, c.id AS company_id, c.name, c.display_name
         FROM company_employees ce
         JOIN companies c ON c.id = ce.company_id
         WHERE ce.agent_id = $1
           AND ce.status = 'active'
         ORDER BY ce.joined_at DESC
         LIMIT 1`,
        [petRow.id]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    const alliancesCount = await client
      .query(`SELECT COUNT(*)::int AS n FROM facts WHERE agent_id = $1 AND kind = 'alliance'`, [petRow.id])
      .then((r) => Number(r.rows?.[0]?.n ?? 0) || 0)
      .catch(() => 0);

    const current_state = {
      has_pet: true,
      pet: {
        id: agent?.id ?? petRow.id,
        name: agent?.name ?? null,
        display_name: agent?.display_name ?? null,
        karma: Number(agent?.karma ?? 0) || 0,
      },
      arena: {
        day,
        season: season ? { id: season.id, code: season.code } : null,
        rating: ratingRow ? Number(ratingRow.rating ?? 1000) || 1000 : null,
        wins: ratingRow ? Number(ratingRow.wins ?? 0) || 0 : null,
        losses: ratingRow ? Number(ratingRow.losses ?? 0) || 0 : null,
        streak: ratingRow ? Number(ratingRow.streak ?? 0) || 0 : null,
        condition: Math.max(0, Math.min(100, Math.trunc(Number(condObj.condition ?? 70) || 70))),
      },
      job: emp
        ? {
          company: { id: emp.company_id, name: emp.name, display_name: emp.display_name ?? null },
          role: emp.role ?? null,
          wage: Number(emp.wage ?? 0) || 0,
          joined_at: emp.joined_at ?? null,
        }
        : null,
      alliances: { count: alliancesCount },
    };

    return { days_away: daysAway, lost: lost || {}, current_state };
  });

  success(res, result);
}));

/**
 * POST /users/me/decisions/:id/resolve
 * Body: { choice: string }
 */
router.post('/me/decisions/:id/resolve', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'decision' }).catch(() => null);
  const { id } = req.params;
  const choice = String(req.body?.choice || '').trim();
  if (!choice) throw new BadRequestError('choice is required');

  const result = await DecisionService.resolveDecision(id, choice, { userId: req.user.id });
  success(res, { decision: result });
}));

/**
 * GET /users/me/plaza/posts
 *
 * Plaza board: browse/search posts with pagination.
 *
 * Query:
 * - sort: new|hot|top (default new)
 * - q: optional search (title/content)
 * - kind: all|plaza|diary|arena (default all)
 * - limit, offset
 */
router.get('/me/plaza/posts', requireUserAuth, asyncHandler(async (req, res) => {
  const { sort = 'new', limit = 25, offset = 0, page = null, withTotal = '1', q = '', kind = 'all', submolt = 'general' } = req.query;

  const safeLimit = Math.min(parseInt(limit, 10) || 25, config.pagination.maxLimit);
  const safePageRaw = page === null || page === undefined ? null : parseInt(String(page), 10);
  const safePage = Number.isFinite(safePageRaw) && safePageRaw > 0 ? safePageRaw : null;
  const safeOffset = safePage ? (safePage - 1) * safeLimit : Math.max(0, parseInt(offset, 10) || 0);
  const qTerm = typeof q === 'string' ? q.trim() : String(q || '').trim();
  const qTermSafe = qTerm.length >= 2 ? qTerm : '';
  const kindTerm = String(kind || 'all').trim().toLowerCase();
  const submoltTerm = String(submolt || 'general').trim().toLowerCase() || 'general';
  const includeTotal = String(withTotal ?? '1').trim() !== '0';

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
  else postTypes = null;

  let posts = [];
  let total = null;
  if (includeTotal) {
    const r = await PostService.getFeedWithTotal({
      sort,
      limit: safeLimit,
      offset: safeOffset,
      submolt: submoltTerm,
      q: qTermSafe || null,
      postTypes,
      onlyUserAuthors,
      excludePostTypes: ['broadcast', 'rumor']
    });
    posts = r.posts || [];
    total = Number(r.total ?? 0) || 0;
  } else {
    posts = await PostService.getFeed({
      sort,
      limit: safeLimit,
      offset: safeOffset,
      submolt: submoltTerm,
      q: qTermSafe || null,
      postTypes,
      onlyUserAuthors,
      excludePostTypes: ['broadcast', 'rumor']
    });
  }

  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  const safeTotal = total === null ? null : Math.max(0, Number(total) || 0);
  const safePageOut = safePage || Math.floor(safeOffset / safeLimit) + 1;
  const pageCount = safeTotal === null ? null : Math.max(1, Math.ceil(safeTotal / safeLimit));
  const hasMore = safeTotal === null ? posts.length === safeLimit : safeOffset + posts.length < safeTotal;
  success(res, {
    viewer: { has_pet: Boolean(petRow) },
    posts,
    pagination: {
      count: posts.length,
      limit: safeLimit,
      offset: safeOffset,
      total: safeTotal,
      page: safePageOut,
      pageCount,
      hasMore
    }
  });
}));

/**
 * GET /users/me/plaza/live
 *
 * Lightweight "liveness" stream for the plaza:
 * - recent comments
 * - recent upvotes
 * - recent new posts
 *
 * Query:
 * - limit (default 30, max 100)
 * - cursor (optional): created_at timestamptz; returns items older than cursor
 */
router.get('/me/plaza/live', requireUserAuth, asyncHandler(async (req, res) => {
  const safeLimit = Math.max(1, Math.min(100, parseInt(String(req.query?.limit ?? 30), 10) || 30));
  const cursorRaw = String(req.query?.cursor ?? '').trim();
  const cursor = cursorRaw && /^[0-9T:\-+.Z ]{10,40}$/.test(cursorRaw) ? cursorRaw : null;

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

  const params = [safeLimit];
  const cursorFilter = cursor ? `AND x.created_at < $2::timestamptz` : '';
  if (cursor) params.push(cursor);

  const onlyUserFilter = onlyUserAuthors ? `AND actor.owner_user_id IS NOT NULL AND post_author.owner_user_id IS NOT NULL` : '';

  const items = await queryAll(
    `
    SELECT
      x.kind,
      x.item_id,
      x.created_at,
      x.post_id,
      x.post_title,
      x.post_author_id,
      x.post_author_name,
      x.post_author_display_name,
      x.actor_id,
      x.actor_name,
      x.actor_display_name,
      x.snippet
    FROM (
      SELECT
        'comment'::text AS kind,
        c.id::text AS item_id,
        c.created_at AS created_at,
        p.id::text AS post_id,
        p.title AS post_title,
        p.author_id::text AS post_author_id,
        COALESCE(post_author.display_name, post_author.name) AS post_author_name,
        post_author.display_name AS post_author_display_name,
        actor.id::text AS actor_id,
        COALESCE(actor.display_name, actor.name) AS actor_name,
        actor.display_name AS actor_display_name,
        LEFT(c.content, 160) AS snippet
      FROM comments c
      JOIN posts p ON p.id = c.post_id
      JOIN agents actor ON actor.id = c.author_id
      JOIN agents post_author ON post_author.id = p.author_id
      WHERE p.is_deleted = false
        AND p.post_type NOT IN ('broadcast', 'rumor')
        ${onlyUserFilter}

      UNION ALL

      SELECT
        'upvote'::text AS kind,
        v.id::text AS item_id,
        v.created_at AS created_at,
        p.id::text AS post_id,
        p.title AS post_title,
        p.author_id::text AS post_author_id,
        COALESCE(post_author.display_name, post_author.name) AS post_author_name,
        post_author.display_name AS post_author_display_name,
        actor.id::text AS actor_id,
        COALESCE(actor.display_name, actor.name) AS actor_name,
        actor.display_name AS actor_display_name,
        NULL::text AS snippet
      FROM votes v
      JOIN posts p ON p.id = v.target_id
      JOIN agents actor ON actor.id = v.agent_id
      JOIN agents post_author ON post_author.id = p.author_id
      WHERE v.target_type = 'post'
        AND v.value = 1
        AND p.is_deleted = false
        AND p.post_type NOT IN ('broadcast', 'rumor')
        ${onlyUserFilter}

      UNION ALL

      SELECT
        'new_post'::text AS kind,
        p.id::text AS item_id,
        p.created_at AS created_at,
        p.id::text AS post_id,
        p.title AS post_title,
        p.author_id::text AS post_author_id,
        COALESCE(post_author.display_name, post_author.name) AS post_author_name,
        post_author.display_name AS post_author_display_name,
        post_author.id::text AS actor_id,
        COALESCE(post_author.display_name, post_author.name) AS actor_name,
        post_author.display_name AS actor_display_name,
        LEFT(COALESCE(p.content, ''), 160) AS snippet
      FROM posts p
      JOIN agents post_author ON post_author.id = p.author_id
      WHERE p.is_deleted = false
        AND p.post_type NOT IN ('broadcast', 'rumor')
        ${onlyUserAuthors ? `AND post_author.owner_user_id IS NOT NULL` : ''}
    ) x
    WHERE 1=1
      ${cursorFilter}
    ORDER BY x.created_at DESC
    LIMIT $1
    `,
    params
  );

  const out = (items || []).map((r) => ({
    kind: String(r.kind || '').trim(),
    id: String(r.item_id || '').trim(),
    created_at: r.created_at,
    post: {
      id: String(r.post_id || '').trim(),
      title: r.post_title,
      author_id: String(r.post_author_id || '').trim(),
      author_name: r.post_author_name,
      author_display_name: r.post_author_display_name
    },
    actor: {
      id: String(r.actor_id || '').trim(),
      name: r.actor_name,
      display_name: r.actor_display_name
    },
    snippet: r.snippet ?? null
  }));

  const lastCreatedAt = out.length > 0 ? out[out.length - 1]?.created_at : null;
  const nextCursor = lastCreatedAt ? new Date(lastCreatedAt).toISOString() : null;
  success(res, { items: out, nextCursor });
}));

/**
 * GET /users/me/plaza/posts/:id
 * Returns a single post + viewer vote (if the user has a pet).
 */
router.get('/me/plaza/posts/:id', requireUserAuth, asyncHandler(async (req, res) => {
  const postId = String(req.params?.id ?? '').trim();
  if (!postId) throw new BadRequestError('Post id is required');

  const post = await PostService.findById(postId);
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  const myVote = petRow ? await VoteService.getVote(petRow.id, post.id, 'post').catch(() => null) : null;

  success(res, {
    post,
    viewer: { has_pet: Boolean(petRow), my_vote: myVote }
  });
}));

/**
 * GET /users/me/plaza/posts/:id/comments
 */
router.get('/me/plaza/posts/:id/comments', requireUserAuth, asyncHandler(async (req, res) => {
  const postId = String(req.params?.id ?? '').trim();
  if (!postId) throw new BadRequestError('Post id is required');

  const { sort = 'top', limit = 100 } = req.query;
  const safeLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
  const comments = await CommentService.getByPost(postId, { sort, limit: safeLimit });
  success(res, { comments });
}));

/**
 * POST /users/me/plaza/posts/:id/comments
 * Body: { content, parent_id? }
 */
router.post('/me/plaza/posts/:id/comments', requireUserAuth, postLimiter, asyncHandler(async (req, res) => {
  const postId = String(req.params?.id ?? '').trim();
  if (!postId) throw new BadRequestError('Post id is required');

  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const content = req.body?.content;
  const parentId = req.body?.parent_id ?? req.body?.parentId ?? null;
  const comment = await CommentService.create({
    postId,
    authorId: petRow.id,
    content,
    parentId
  });

  // Mission: social 1 (best-effort).
  await transaction(async (client) => {
    await DailyMissionService.completeWithClient(client, petRow.id, { code: 'SOCIAL_1', source: 'comment' }).catch(() => null);
  }).catch(() => null);

  created(res, { comment });
}));

/**
 * GET /users/me/world/arena/matches/:id
 * Returns one match with full meta (for spectator UI).
 */
router.get('/me/world/arena/matches/:id', requireUserAuth, asyncHandler(async (req, res) => {
  const matchId = String(req.params?.id ?? '').trim();
  if (!matchId) throw new BadRequestError('match id is required');

  const result = await transaction(async (client) => {
    // If this match is live and its window has ended, resolving it here makes the
    // "watch" modal feel responsive (no need to navigate away to /arena/today).
    const row = await client.query(
      `SELECT day, slot
       FROM arena_matches
       WHERE id = $1::uuid
       LIMIT 1`,
      [matchId]
    ).then((r) => r.rows?.[0] ?? null);
    const dayIso = row?.day instanceof Date
      ? row.day.toISOString().slice(0, 10)
      : row?.day
        ? String(row.day).slice(0, 10)
        : null;
    const slot = Number(row?.slot ?? 1) || 1;
    if (dayIso && /^\d{4}-\d{2}-\d{2}$/.test(dayIso)) {
      await bestEffortInTransaction(
        client,
        async () => ArenaService.tickDayWithClient(client, { day: dayIso, matchesPerDay: Math.max(3, Math.min(200, slot)) }),
        { label: 'arena_match_watch_tick' }
      );
    }
    return ArenaService.getMatchWithClient(client, { matchId });
  });
  if (!result?.match) throw new NotFoundError('ArenaMatch');
  success(res, result);
}));

/**
 * POST /users/me/arena/matches/:matchId/vote
 *
 * Body:
 * - { vote: 'fair' | 'unfair' }
 *
 * Rule:
 * - one vote per user per match
 * - only resolved matches can be voted
 */
router.post('/me/arena/matches/:matchId/vote', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'arena_vote' }).catch(() => null);

  const matchId = String(req.params?.matchId ?? '').trim();
  if (!matchId) throw new BadRequestError('match id is required');

  const vote = String(req.body?.vote ?? req.body?.verdict ?? req.body?.judgment ?? '').trim().toLowerCase();
  if (!['fair', 'unfair'].includes(vote)) {
    throw new BadRequestError('vote must be fair or unfair', 'BAD_ARENA_VOTE');
  }

  const result = await transaction(async (client) => {
    const match = await client.query(
      `SELECT id, status, meta
       FROM arena_matches
       WHERE id = $1::uuid
       LIMIT 1
       FOR UPDATE`,
      [matchId]
    ).then((r) => r.rows?.[0] ?? null);
    if (!match?.id) throw new NotFoundError('ArenaMatch');

    const status = String(match.status || '').trim().toLowerCase();
    if (status !== 'resolved') {
      throw new BadRequestError('Only resolved matches can be voted', 'ARENA_MATCH_NOT_RESOLVED');
    }

    const meta = match.meta && typeof match.meta === 'object' ? match.meta : {};
    const rawVotes = Array.isArray(meta.votes) ? meta.votes : [];
    const byUser = new Map();

    for (const row of rawVotes) {
      const r = row && typeof row === 'object' ? row : null;
      if (!r) continue;
      const uid = String(r.user_id ?? r.userId ?? '').trim();
      const decision = String(r.vote ?? r.value ?? '').trim().toLowerCase();
      if (!uid || !['fair', 'unfair'].includes(decision)) continue;
      byUser.set(uid, {
        user_id: uid,
        vote: decision,
        created_at: r.created_at ?? r.createdAt ?? null,
        updated_at: r.updated_at ?? r.updatedAt ?? null
      });
    }

    const viewerUserId = String(req.user.id || '').trim();
    if (byUser.has(viewerUserId)) {
      throw new BadRequestError('Already voted for this match', 'ARENA_MATCH_ALREADY_VOTED');
    }

    const nowIso = new Date().toISOString();
    byUser.set(viewerUserId, {
      user_id: viewerUserId,
      vote,
      created_at: nowIso,
      updated_at: nowIso
    });

    const nextVotes = Array.from(byUser.values());
    const nextMeta = { ...meta, votes: nextVotes };
    await client.query(`UPDATE arena_matches SET meta = $2::jsonb WHERE id = $1`, [match.id, JSON.stringify(nextMeta)]);

    let fair = 0;
    let unfair = 0;
    for (const item of nextVotes) {
      const v = String(item?.vote || '').trim().toLowerCase();
      if (v === 'fair') fair += 1;
      if (v === 'unfair') unfair += 1;
    }

    return {
      match_id: String(match.id),
      my_vote: vote,
      vote_result: {
        fair,
        unfair,
        total: fair + unfair
      }
    };
  });

  success(res, result);
}));

/**
 * POST /users/me/world/arena/matches/:id/intervene
 *
 * Live intervention window (30s):
 * - Only the owner of the participating pet can intervene (self-coach).
 * - Stored as facts(kind='arena_live', key=`intervene:${matchId}`) on the pet agent.
 * - Does not require LLM; affects deterministic hints on resolve.
 *
 * Body:
 * - { action: generic_action | mode_strategy_action }
 *   - generic_action: calm|study|aggressive|budget|impulse_stop|clear
 *   - mode_strategy_action: debate_*|court_*|auction_*|math_*|puzzle_*|prompt_*
 */
const GENERIC_ACTIONS = ['calm', 'study', 'aggressive', 'budget', 'impulse_stop', 'clear'];
const MODE_STRATEGIES = {
  debate_logic_attack: { study: 0.4 },
  debate_emotion: { aggressive: 0.3 },
  debate_counter: { calm: 0.35 },
  debate_pressure: { aggressive: 0.7 },
  court_evidence: { study: 0.5 },
  court_cross: { aggressive: 0.3 },
  court_precedent: { calm: 0.5 },
  auction_snipe: { budget: 0.5 },
  auction_conservative: { budget: 0.7 },
  auction_bluff: { aggressive: 0.5 },
  math_speed: { aggressive: 0.3 },
  math_accuracy: { study: 0.5 },
  puzzle_hint: { study: 0.6 },
  puzzle_pattern: { study: 0.3 },
  prompt_creative: { aggressive: 0.3 },
  prompt_precise: { study: 0.5 },
  prompt_keyword: { calm: 0.3 }
};

router.post('/me/world/arena/matches/:id/intervene', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'arena_intervene' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  if (!petRow) throw new NotFoundError('Pet');

  const matchId = String(req.params?.id ?? '').trim();
  if (!matchId) throw new BadRequestError('match id is required');

  const action = String(req.body?.action ?? '').trim().toLowerCase();
  const allow = new Set([...GENERIC_ACTIONS, ...Object.keys(MODE_STRATEGIES)]);
  if (!allow.has(action)) throw new BadRequestError('Invalid action');

  const result = await transaction(async (client) => {
    const match = await client.query(
      `SELECT id, status, meta, created_at
       FROM arena_matches
       WHERE id = $1::uuid
       LIMIT 1`,
      [matchId]
    ).then((r) => r.rows?.[0] ?? null);
    if (!match?.id) throw new NotFoundError('ArenaMatch');

    const meta = match.meta && typeof match.meta === 'object' ? match.meta : {};
    const live = meta.live && typeof meta.live === 'object' ? meta.live : null;
    const endsAt = live?.ends_at ? Date.parse(String(live.ends_at)) : NaN;
    const isLive = String(match.status || '').trim().toLowerCase() === 'live' && Number.isFinite(endsAt) && endsAt > Date.now();
    if (!isLive) throw new BadRequestError('Match is not live');

    const cast = meta.cast && typeof meta.cast === 'object' ? meta.cast : {};
    const aId = String(cast.aId || cast.a_id || '').trim();
    const bId = String(cast.bId || cast.b_id || '').trim();
    if (petRow.id !== aId && petRow.id !== bId) throw new BadRequestError('Only participants can intervene');

    const key = `intervene:${String(match.id)}`;
    const day = (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || new Date().toISOString().slice(0, 10);
    if (action === 'clear') {
      await client.query(`DELETE FROM facts WHERE agent_id = $1 AND kind = 'arena_live' AND key = $2`, [petRow.id, key]);
      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'ARENA_INTERVENE', $2::jsonb, 4)`,
        [petRow.id, JSON.stringify({ day, target: String(match.id), match_id: String(match.id), action: 'clear' })]
      ).catch(() => null);
      return { ok: true, cleared: true, action };
    }

    const boosts = { calm: 0, study: 0, aggressive: 0, budget: 0, impulse_stop: 0 };
    if (MODE_STRATEGIES[action]) {
      Object.assign(boosts, MODE_STRATEGIES[action]);
    } else {
      boosts[action] = 1;
    }

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'arena_live', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
      [petRow.id, key, JSON.stringify({ match_id: String(match.id), action, boosts, created_at: new Date().toISOString() })]
    );

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'ARENA_INTERVENE', $2::jsonb, 4)`,
      [petRow.id, JSON.stringify({ day, target: String(match.id), match_id: String(match.id), action, boosts })]
    ).catch(() => null);

    return { ok: true, cleared: false, action, boosts, ends_at: String(live.ends_at) };
  });

  success(res, result);
}));

/**
 * POST /users/me/world/arena/matches/:id/predict
 *
 * Simple spectator prediction (LLM-free):
 * - Allowed while match.status='live' and within the live window.
 * - Stores facts(kind='arena_pred', key=`predict:${matchId}`) on the viewer pet agent.
 * - Rewards are distributed on resolve (minted pot shared by correct predictors).
 *
 * Body:
 * - { pick: 'a'|'b' }  // based on meta.cast
 */
router.post('/me/world/arena/matches/:id/predict', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'arena_predict' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  if (!petRow) throw new NotFoundError('Pet');

  const matchId = String(req.params?.id ?? '').trim();
  if (!matchId) throw new BadRequestError('match id is required');

  const pickRaw = String(req.body?.pick ?? req.body?.side ?? '').trim().toLowerCase();
  if (!['a', 'b'].includes(pickRaw)) throw new BadRequestError('Invalid pick');

  const result = await transaction(async (client) => {
    const match = await client.query(
      `SELECT id, status, meta
       FROM arena_matches
       WHERE id = $1::uuid
       LIMIT 1`,
      [matchId]
    ).then((r) => r.rows?.[0] ?? null);
    if (!match?.id) throw new NotFoundError('ArenaMatch');

    const meta = match.meta && typeof match.meta === 'object' ? match.meta : {};
    const live = meta.live && typeof meta.live === 'object' ? meta.live : null;
    const endsAt = live?.ends_at ? Date.parse(String(live.ends_at)) : NaN;
    const isLive = String(match.status || '').trim().toLowerCase() === 'live' && Number.isFinite(endsAt) && endsAt > Date.now();
    if (!isLive) throw new BadRequestError('Match is not live');

    const cast = meta.cast && typeof meta.cast === 'object' ? meta.cast : {};
    const aId = String(cast.aId || cast.a_id || '').trim();
    const bId = String(cast.bId || cast.b_id || '').trim();
    if (!aId || !bId) throw new BadRequestError('Missing cast');

    const pickedAgentId = pickRaw === 'a' ? aId : bId;

    const key = `predict:${String(match.id)}`;
    const day = (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || new Date().toISOString().slice(0, 10);
    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'arena_pred', $2, $3::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = 1.0, updated_at = NOW()`,
      [
        petRow.id,
        key,
        JSON.stringify({
          match_id: String(match.id),
          pick: pickRaw,
          picked_agent_id: pickedAgentId,
          created_at: new Date().toISOString()
        })
      ]
    );

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'ARENA_PREDICT', $2::jsonb, 4)`,
      [
        petRow.id,
        JSON.stringify({
          day,
          target: String(match.id),
          match_id: String(match.id),
          pick: pickRaw,
          picked_agent_id: pickedAgentId,
        }),
      ]
    ).catch(() => null);

    await DailyMissionService.completeWithClient(client, petRow.id, { day, code: 'INVEST_1', source: 'arena_predict' }).catch(() => null);

    return { ok: true, pick: pickRaw, picked_agent_id: pickedAgentId, ends_at: String(live.ends_at) };
  });

  success(res, result);
}));

/**
 * POST /users/me/world/arena/matches/:id/cheer
 *
 * Live cheer / spectator buff:
 * - Allowed while match.status='live' and within the live window.
 * - Stores a single cheer per viewer pet: cheers(match_id, agent_id) upsert.
 *   (legacy facts fallback is kept for old DB states)
 * - Cheer counts are aggregated into match.meta.cheer (for UI) and applied as a tiny win-prob buff on resolve.
 *
 * Body:
 * - { side: 'a'|'b' }
 */
router.post('/me/world/arena/matches/:id/cheer', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'arena_cheer' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  if (!petRow) throw new NotFoundError('Pet');

  const matchId = String(req.params?.id ?? '').trim();
  if (!matchId) throw new BadRequestError('match id is required');

  const side = String(req.body?.side ?? '').trim().toLowerCase();
  if (!['a', 'b'].includes(side)) throw new BadRequestError('Invalid side');
  const messageRaw = req.body?.message;
  if (messageRaw !== undefined && messageRaw !== null && typeof messageRaw !== 'string') {
    throw new BadRequestError('message must be a string');
  }
  const message = typeof messageRaw === 'string' ? messageRaw.trim().slice(0, 140) : '';

  const result = await transaction(async (client) => {
    const match = await client.query(
      `SELECT id, status, meta
       FROM arena_matches
       WHERE id = $1::uuid
       LIMIT 1`,
      [matchId]
    ).then((r) => r.rows?.[0] ?? null);
    if (!match?.id) throw new NotFoundError('ArenaMatch');

    const meta = match.meta && typeof match.meta === 'object' ? match.meta : {};
    const live = meta.live && typeof meta.live === 'object' ? meta.live : null;
    const endsAt = live?.ends_at ? Date.parse(String(live.ends_at)) : NaN;
    const isLive = String(match.status || '').trim().toLowerCase() === 'live' && Number.isFinite(endsAt) && endsAt > Date.now();
    if (!isLive) throw new BadRequestError('Match is not live');

    const cast = meta.cast && typeof meta.cast === 'object' ? meta.cast : {};
    const aId = String(cast.aId || cast.a_id || '').trim();
    const bId = String(cast.bId || cast.b_id || '').trim();
    if (!aId || !bId) throw new BadRequestError('Missing cast');

    const day = (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || new Date().toISOString().slice(0, 10);
    await ArenaService.upsertCheerWithClient(client, {
      matchId: String(match.id),
      agentId: String(petRow.id),
      side,
      message: message || null,
      day,
      source: 'user'
    });

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'ARENA_CHEER', $2::jsonb, 3)`,
      [petRow.id, JSON.stringify({ day, target: String(match.id), match_id: String(match.id), side })]
    ).catch(() => null);

    const summary = await ArenaService.cheerSummaryWithClient(client, {
      matchId: String(match.id),
      limit: 200,
      maxMessages: 5,
      bestMinCount: 2
    });
    const aCount = Number(summary?.aCount ?? 0) || 0;
    const bCount = Number(summary?.bCount ?? 0) || 0;
    const topMessages = Array.isArray(summary?.messages) ? summary.messages : [];
    const bestCheer = summary?.bestCheer && typeof summary.bestCheer === 'object' ? summary.bestCheer : null;

    const cheerMeta = {
      a_count: aCount,
      b_count: bCount,
      messages: topMessages,
      best_cheer: bestCheer,
      updated_at: new Date().toISOString()
    };

    const tags = Array.isArray(meta?.tags) ? [...meta.tags] : [];
    if (bestCheer) tags.push('베스트 응원');
    const nextMeta = {
      ...meta,
      cheer: cheerMeta,
      tags: tags.length ? [...new Set(tags)].slice(0, 8) : meta?.tags
    };
    await client.query(`UPDATE arena_matches SET meta = $2::jsonb WHERE id = $1`, [match.id, JSON.stringify(nextMeta)]);

    return { ok: true, side, message: message || null, a_count: aCount, b_count: bCount, best_cheer: bestCheer, ends_at: String(live.ends_at) };
  });

  success(res, result);
}));

/**
 * POST /users/me/world/arena/matches/:id/highlight
 *
 * Body:
 * - { comment_id: string }
 *
 * Pick a highlight comment on the match recap post.
 */
router.post('/me/world/arena/matches/:id/highlight', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'arena_highlight_comment' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  if (!petRow) throw new NotFoundError('Pet');

  const matchId = String(req.params?.id ?? '').trim();
  if (!matchId) throw new BadRequestError('match id is required');
  const commentId = String(req.body?.comment_id ?? req.body?.commentId ?? '').trim();
  if (!commentId) throw new BadRequestError('comment_id is required');

  const result = await transaction(async (client) => {
    return ArenaService.highlightMatchCommentWithClient(client, {
      matchId,
      commentId,
      actorAgentId: petRow.id
    });
  });

  if (!result?.ok) {
    if (result?.reason === 'match_not_found') throw new NotFoundError('ArenaMatch');
    if (result?.reason === 'comment_not_found') throw new NotFoundError('Comment');
    if (result?.reason === 'match_not_resolved') throw new BadRequestError('Match is not resolved');
    throw new BadRequestError('Unable to set highlight comment');
  }

  success(res, result);
}));

/**
 * POST /users/me/world/arena/rematch
 *
 * Body:
 * - { match_id: string }
 *
 * Rules:
 * - only the loser can request
 * - request must be within 24h of the original match
 * - request costs 5 coins
 */
router.post('/me/world/arena/rematch', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'arena_rematch' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  if (!petRow) throw new NotFoundError('Pet');

  const matchId = String(req.body?.match_id ?? req.body?.matchId ?? '').trim();
  if (!matchId) throw new BadRequestError('match_id is required');

  const result = await transaction(async (client) => {
    return ArenaService.requestRematchWithClient(client, { matchId, requesterAgentId: petRow.id, feeCoins: 5 });
  });

  if (!result?.ok) {
    if (result?.reason === 'not_found_or_not_participant') throw new NotFoundError('ArenaMatch');
    if (result?.reason === 'match_not_resolved') throw new BadRequestError('Match is not resolved yet');
    if (result?.reason === 'not_loser') throw new BadRequestError('Only the losing side can request rematch');
    if (result?.reason === 'window_expired') throw new BadRequestError('Rematch request window expired (24h)');
    throw new BadRequestError('Unable to request rematch');
  }

  success(res, result);
}));

/**
 * POST /users/me/world/arena/challenge
 * 유저가 특정 모드로 즉시 매치 요청
 *
 * Body:
 * - { mode: 'COURT_TRIAL' | 'DEBATE_CLASH' | 'PUZZLE_SPRINT' | 'MATH_RACE' | 'PROMPT_BATTLE' | 'AUCTION_DUEL' }
 */
router.post('/me/world/arena/challenge', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'arena_challenge' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  if (!petRow) throw new NotFoundError('Pet');

  const mode = String(req.body?.mode ?? '').trim().toUpperCase();
  const validModes = new Set(['AUCTION_DUEL', 'DEBATE_CLASH', 'PUZZLE_SPRINT', 'MATH_RACE', 'COURT_TRIAL', 'PROMPT_BATTLE']);
  if (!validModes.has(mode)) throw new BadRequestError('Invalid mode');

  const result = await transaction(async (client) => {
    const today = PetMemoryService.getTodayISODate();
    const existing = await client.query(
      `SELECT m.id
       FROM arena_matches m
       WHERE m.day = $2::date
         AND m.mode = $3
         AND m.status IN ('live', 'scheduled')
         AND (
           COALESCE(m.meta->'cast'->>'aId', m.meta->'cast'->>'a_id', '') = $1
           OR COALESCE(m.meta->'cast'->>'bId', m.meta->'cast'->>'b_id', '') = $1
           OR EXISTS (
             SELECT 1
             FROM arena_match_participants p
             WHERE p.match_id = m.id
               AND p.agent_id = $1::uuid
           )
         )
       ORDER BY m.slot DESC, m.created_at DESC
       LIMIT 1`,
      [petRow.id, today, mode]
    ).then((r) => r.rows || []);

    if (existing.length > 0) {
      return { ok: true, already: true, match_id: existing[0].id, mode };
    }

    return ArenaService.createChallengeMatchWithClient(client, {
      challengerAgentId: petRow.id,
      mode,
      day: today
    });
  });

  if (!result?.ok) {
    if (result?.reason === 'invalid_mode') throw new BadRequestError('Invalid mode');
    if (result?.reason === 'no_opponent') throw new BadRequestError('No available opponent');
    throw new BadRequestError('Unable to create challenge match');
  }

  success(res, result);
}));

router.post('/me/posts/:id/upvote', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const result = await VoteService.upvotePost(req.params.id, petRow.id);

  // Mission: social 1 (best-effort).
  await transaction(async (client) => {
    await DailyMissionService.completeWithClient(client, petRow.id, { code: 'SOCIAL_1', source: 'upvote' }).catch(() => null);
  }).catch(() => null);

  success(res, result);
}));

router.post('/me/posts/:id/downvote', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const result = await VoteService.downvotePost(req.params.id, petRow.id);
  success(res, result);
}));

/**
 * GET /users/me/world/today
 * Returns world daily summary + open rumors (for "evidence board" UI).
 */
router.get('/me/world/today', requireUserAuth, asyncHandler(async (req, res) => {
  const day = req.query?.day ? String(req.query.day).trim() : null;
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequestError('Invalid day format (YYYY-MM-DD)');
  }
  const ensureEpisodeRaw = req.query?.ensureEpisode ?? req.query?.ensure_episode ?? null;
  const ensureEpisode = ensureEpisodeRaw === null || ensureEpisodeRaw === undefined
    ? true
    : !['0', 'false', 'no', 'n'].includes(String(ensureEpisodeRaw).trim().toLowerCase());

  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  const bundle = await WorldContextService.getBundle({ day, includeOpenRumors: true, ensureEpisode, viewerAgentId: petRow?.id ?? null });
  success(res, bundle);
}));

/**
 * GET /users/me/world/arena/today
 * Returns today's arena matches + the viewer's current rating snapshot.
 */
router.get('/me/world/arena/today', requireUserAuth, asyncHandler(async (req, res) => {
  const day = req.query?.day ? String(req.query.day).trim() : PetMemoryService.getTodayISODate();
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequestError('Invalid day format (YYYY-MM-DD)');
  }

  const limit = req.query?.limit ? Number(req.query.limit) : 20;
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);

  const result = await transaction(async (client) => {
    await bestEffortInTransaction(
      client,
      async () => ArenaService.tickDayWithClient(client, { day }),
      { label: 'arena_today_tick' }
    );

    const season = await ArenaService.ensureSeasonForDayWithClient(client, day).catch(() => null);
    const my = petRow && season?.id
      ? await client
        .query(
          `SELECT rating, wins, losses, streak, updated_at
           FROM arena_ratings
           WHERE season_id = $1 AND agent_id = $2
           LIMIT 1`,
          [season.id, petRow.id]
        )
        .then((r) => r.rows?.[0] ?? null)
        .catch(() => null)
      : null;

    const today = await ArenaService.listTodayWithClient(client, { day, limit });
    return {
      ...today,
      season: season ? { id: season.id, code: season.code, starts_on: season.starts_on, ends_on: season.ends_on } : null,
      my: my
        ? {
          rating: Number(my.rating ?? 1000) || 1000,
          wins: Number(my.wins ?? 0) || 0,
          losses: Number(my.losses ?? 0) || 0,
          streak: Number(my.streak ?? 0) || 0,
          updated_at: my.updated_at
        }
        : petRow
          ? { rating: 1000, wins: 0, losses: 0, streak: 0, updated_at: null }
          : null
    };
  });

  success(res, result);
}));

/**
 * GET /users/me/world/arena/leaderboard
 * Returns current season leaderboard (by rating).
 */
router.get('/me/world/arena/leaderboard', requireUserAuth, asyncHandler(async (req, res) => {
  const day = req.query?.day ? String(req.query.day).trim() : PetMemoryService.getTodayISODate();
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequestError('Invalid day format (YYYY-MM-DD)');
  }
  const limit = req.query?.limit ? Number(req.query.limit) : 50;

  const result = await transaction(async (client) => {
    const season = await ArenaService.ensureSeasonForDayWithClient(client, day).catch(() => null);
    if (!season?.id) return { season: null, leaderboard: [] };
    return ArenaService.listLeaderboardWithClient(client, { seasonId: season.id, limit });
  });

  success(res, result);
}));

/**
 * GET /users/me/pet/arena/stats
 * Returns aggregate arena stats for the viewer pet.
 */
router.get('/me/pet/arena/stats', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const result = await transaction(async (client) => {
    return ArenaService.getAgentStatsWithClient(client, { agentId: petRow.id, limit: 500, eloHistoryLimit: 20 });
  });

  success(res, result);
}));

/**
 * GET /users/me/pet/arena/mode-stats
 * 모드별 전적 (승/패/승률) 반환
 */
router.get('/me/pet/arena/mode-stats', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  if (!petRow) throw new NotFoundError('Pet');

  const stats = await transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT
         m.mode,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE p.outcome = 'win')::int AS wins,
         COUNT(*) FILTER (WHERE p.outcome IN ('lose', 'forfeit'))::int AS losses,
         COUNT(*) FILTER (WHERE p.outcome = 'draw')::int AS draws
       FROM arena_match_participants p
       JOIN arena_matches m ON m.id = p.match_id
       WHERE p.agent_id = $1
         AND m.status = 'resolved'
       GROUP BY m.mode`,
      [petRow.id]
    );

    const out = {};
    for (const r of rows || []) {
      const mode = String(r.mode || '').trim();
      if (!mode) continue;
      const total = Number(r.total) || 0;
      const wins = Number(r.wins) || 0;
      out[mode] = {
        total,
        wins,
        losses: Number(r.losses) || 0,
        draws: Number(r.draws) || 0,
        winRate: total > 0 ? Math.round((wins / total) * 100) : 0
      };
    }
    return out;
  });

  success(res, { stats });
}));

/**
 * GET /users/me/pet/arena/history
 * Returns the viewer pet's arena history.
 */
router.get('/me/pet/arena/history', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const limit = req.query?.limit ? Number(req.query.limit) : 20;
  const result = await transaction(async (client) => {
    return ArenaService.listHistoryForAgentWithClient(client, { agentId: petRow.id, limit });
  });

  success(res, result);
}));

/**
 * GET /users/me/pet/arena/court-cases
 * Returns the curated court case pool for COURT_TRIAL mode.
 */
router.get('/me/pet/arena/court-cases', requireUserAuth, asyncHandler(async (req, res) => {
  const CourtCaseService = require('../services/CourtCaseService');
  const pool = await CourtCaseService.getCasePool();
  const stats = await CourtCaseService.getCaseStats();
  success(res, { cases: pool, stats });
}));

/**
 * GET /users/me/pet/arena/court-verdict/:matchId
 * Reveals the actual court verdict for a resolved COURT_TRIAL match.
 */
router.get('/me/pet/arena/court-verdict/:matchId', requireUserAuth, asyncHandler(async (req, res) => {
  const { matchId } = req.params;
  const match = await transaction(async (client) => {
    const row = await client.query(
      `SELECT meta FROM arena_matches WHERE id = $1 AND status = 'resolved'`,
      [matchId]
    );
    return row.rows?.[0] ?? null;
  });
  if (!match) throw new NotFoundError('Match');

  const CourtCaseService = require('../services/CourtCaseService');
  const verdict = await CourtCaseService.revealVerdict(match.meta);
  if (!verdict) throw new NotFoundError('This match does not have real case data');

  success(res, verdict);
}));

/**
 * GET /users/me/world/participation
 * Returns the user's current "participation" status:
 * - secret society invite/active status
 * - research join status
 */
router.get('/me/world/participation', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  if (!petRow) {
    success(res, { society: null, research: null });
    return;
  }
  const participation = await getParticipationForAgent(petRow.id);
  success(res, participation);
}));

/**
 * GET /users/me/world/societies
 * Returns secret societies the user's pet belongs to (active/invited).
 */
router.get('/me/world/societies', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  if (!petRow) throw new NotFoundError('Pet');

  const societies = await transaction(async (client) => {
    return SecretSocietyService.listSocietiesForAgentWithClient(client, { agentId: petRow.id, statuses: ['active', 'invited'] });
  });
  success(res, { societies });
}));

/**
 * POST /users/me/world/societies/:id/join
 * Join request for a secret society (cost: 10 coins).
 */
router.post('/me/world/societies/:id/join', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'society_join_request' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  if (!petRow) throw new NotFoundError('Pet');

  const societyId = String(req.params?.id ?? '').trim();
  if (!societyId) throw new BadRequestError('society id is required');

  const result = await transaction(async (client) => {
    return SecretSocietyService.requestJoinWithClient(client, { societyId, agentId: petRow.id, feeCoins: 10 });
  });

  if (!result?.joined && !result?.pending) {
    if (result?.reason === 'society_not_active') throw new NotFoundError('SecretSociety');
    throw new BadRequestError('Unable to request join');
  }

  success(res, result);
}));

/**
 * POST /users/me/world/societies/:id/report
 * Anonymous report (tip-off) for a secret society (cost: 5 coins).
 */
router.post('/me/world/societies/:id/report', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'society_report' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  if (!petRow) throw new NotFoundError('Pet');

  const societyId = String(req.params?.id ?? '').trim();
  if (!societyId) throw new BadRequestError('society id is required');

  const noteRaw = req.body?.note ?? req.body?.message ?? '';
  const note = typeof noteRaw === 'string' ? noteRaw.trim() : '';

  const result = await transaction(async (client) => {
    return SecretSocietyService.reportSocietyWithClient(client, {
      societyId,
      reporterAgentId: petRow.id,
      feeCoins: 5,
      anonymous: true,
      note
    });
  });

  if (!result?.reported) {
    if (result?.reason === 'society_not_active') throw new NotFoundError('SecretSociety');
    throw new BadRequestError('Unable to report society');
  }

  success(res, result);
}));

/**
 * POST /users/me/world/society/:societyId/respond
 *
 * Body:
 * - response: "accept" | "decline"
 */
router.post('/me/world/society/:societyId/respond', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const societyId = String(req.params?.societyId ?? '').trim();
  if (!societyId) throw new BadRequestError('societyId is required');

  const responseRaw = String(req.body?.response ?? req.body?.action ?? '').trim().toLowerCase();
  if (!['accept', 'decline'].includes(responseRaw)) {
    throw new BadRequestError('response must be accept|decline');
  }

  const result = await transaction(async (client) => {
    const society = await client
      .query(
        `SELECT id, name, purpose
         FROM secret_societies
         WHERE id = $1 AND status = 'active'
         LIMIT 1`,
        [societyId]
      )
      .then((r) => r.rows?.[0] ?? null);
    if (!society) throw new NotFoundError('SecretSociety');

    const member = await client
      .query(
        `SELECT id, status, role
         FROM secret_society_members
         WHERE society_id = $1 AND agent_id = $2
         LIMIT 1`,
        [societyId, petRow.id]
      )
      .then((r) => r.rows?.[0] ?? null);
    if (!member) throw new BadRequestError('No invite found for this society');

    const status = String(member.status || '').trim();
    if (responseRaw === 'accept') {
      if (status === 'active') {
        return { society, my: { status: 'active', role: String(member.role || 'member') }, eventType: null };
      }
      if (status !== 'invited') throw new BadRequestError(`Invite is not pending (status=${status})`);

      await client.query(
        `UPDATE secret_society_members
         SET status = 'active', joined_at = NOW(), left_at = NULL
         WHERE id = $1`,
        [member.id]
      );

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'SOCIETY_JOIN', $2::jsonb, 3)`,
        [petRow.id, JSON.stringify({ society_id: society.id, society_name: society.name })]
      );

      return { society, my: { status: 'active', role: String(member.role || 'member') }, eventType: 'SOCIETY_JOIN' };
    }

    // decline
    if (status === 'declined') {
      return { society, my: { status: 'declined', role: String(member.role || 'member') }, eventType: null };
    }
    if (status !== 'invited') throw new BadRequestError(`Invite is not pending (status=${status})`);

    await client.query(
      `UPDATE secret_society_members
       SET status = 'declined', left_at = NOW()
       WHERE id = $1`,
      [member.id]
    );

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'SOCIETY_DECLINE', $2::jsonb, 2)`,
      [petRow.id, JSON.stringify({ society_id: society.id, society_name: society.name })]
    );

    return { society, my: { status: 'declined', role: String(member.role || 'member') }, eventType: 'SOCIETY_DECLINE' };
  });

  success(res, result);
}));

/**
 * POST /users/me/world/research/:projectId/join
 * Joins the active research project (idempotent).
 */
router.post('/me/world/research/:projectId/join', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const projectId = String(req.params?.projectId ?? '').trim();
  if (!projectId) throw new BadRequestError('projectId is required');

  const result = await transaction(async (client) => {
    const project = await client
      .query(
        `SELECT id, title, stage, status
         FROM research_projects
         WHERE id = $1 AND status IN ('recruiting','in_progress')
         LIMIT 1`,
        [projectId]
      )
      .then((r) => r.rows?.[0] ?? null);
    if (!project) throw new NotFoundError('ResearchProject');

    const existing = await client
      .query(
        `SELECT status, role_code, joined_at, left_at
         FROM research_members
         WHERE project_id = $1 AND agent_id = $2
         LIMIT 1`,
        [project.id, petRow.id]
      )
      .then((r) => r.rows?.[0] ?? null);
    if (existing && String(existing.status || '').trim() === 'active') {
      return {
        reused: true,
        project: { id: project.id, title: project.title, stage: project.stage, status: project.status },
        my: {
          status: String(existing.status || '').trim(),
          role_code: String(existing.role_code || '').trim(),
          joined_at: existing.joined_at,
          left_at: existing.left_at
        }
      };
    }

    const jobRow = await client
      .query(`SELECT job_code FROM agent_jobs WHERE agent_id = $1 LIMIT 1`, [petRow.id])
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    const roleCode = roleCodeForJob(jobRow?.job_code);

    const member = await client
      .query(
        `INSERT INTO research_members (project_id, agent_id, role_code, status, joined_at, left_at)
         VALUES ($1,$2,$3,'active',NOW(),NULL)
         ON CONFLICT (project_id, agent_id)
         DO UPDATE SET role_code = EXCLUDED.role_code,
                       status = 'active',
                       left_at = NULL,
                       joined_at = NOW()
         RETURNING status, role_code, joined_at, left_at`,
        [project.id, petRow.id, roleCode]
      )
      .then((r) => r.rows?.[0] ?? null);

    await client.query(
      `INSERT INTO events (agent_id, event_type, payload, salience_score)
       VALUES ($1, 'RESEARCH_JOIN', $2::jsonb, 3)`,
      [petRow.id, JSON.stringify({ project_id: project.id, title: project.title })]
    );

    return {
      reused: false,
      project: { id: project.id, title: project.title, stage: project.stage, status: project.status },
      my: member
        ? {
          status: String(member.status || '').trim(),
          role_code: String(member.role_code || '').trim(),
          joined_at: member.joined_at,
          left_at: member.left_at
        }
        : null
    };
  });

  success(res, result);
}));

/**
 * GET /users/me/world/elections/active
 * Returns active elections + candidates (viewer vote included when user has a pet).
 *
 * Query:
 * - day?: YYYY-MM-DD
 */
router.get('/me/world/elections/active', requireUserAuth, asyncHandler(async (req, res) => {
  const day = req.query?.day ? String(req.query.day).trim() : PetMemoryService.getTodayISODate();
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequestError('Invalid day format (YYYY-MM-DD)');
  }

  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  const elections = await ElectionService.listActiveElections({ day, viewerAgentId: petRow?.id || null });
  success(res, { day, elections });
}));

/**
 * POST /users/me/world/elections/:id/register
 * Registers the user's pet as a candidate (costs coins + requires karma).
 */
router.post('/me/world/elections/:id/register', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const result = await ElectionService.registerCandidate(req.params.id, petRow.id);
  created(res, result);
}));

/**
 * POST /users/me/world/elections/:id/vote
 * Casts a vote for the user's pet.
 *
 * Body:
 * - candidate_id: string (election_candidates.id)
 */
router.post('/me/world/elections/:id/vote', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const candidateId = String(req.body?.candidate_id ?? req.body?.candidateId ?? '').trim();
  if (!candidateId) throw new BadRequestError('candidate_id is required');

  const result = await ElectionService.castVote(req.params.id, petRow.id, candidateId);
  await transaction(async (client) => {
    const day = (await WorldDayService.getCurrentDayWithClient(client).catch(() => null)) || WorldDayService.todayISODate();
    await DailyMissionService.completeWithClient(client, petRow.id, { day, code: 'VOTE_1', source: 'vote' }).catch(() => null);
  }).catch(() => null);
  success(res, result);
}));

/**
 * POST /users/me/world/elections/:id/influence
 * Body: { type: 'bribe'|'endorse'|'oppose', target_candidate_id }
 */
router.post('/me/world/elections/:id/influence', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'election_influence' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const type = String(req.body?.type ?? '').trim().toLowerCase();
  const targetCandidateId = String(req.body?.target_candidate_id ?? req.body?.targetCandidateId ?? '').trim();
  const day = req.body?.day ? String(req.body.day).trim() : null;
  if (!targetCandidateId) throw new BadRequestError('target_candidate_id is required');
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequestError('Invalid day format (YYYY-MM-DD)');
  }

  const result = await ElectionService.influence(req.params.id, petRow.id, {
    type,
    targetCandidateId,
    day,
  });
  success(res, result);
}));

/**
 * POST /users/me/world/rumor
 * Body: { target_agent_id, rumor_type, content }
 */
router.post('/me/world/rumor', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'rumor' }).catch(() => null);
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const targetAgentId = String(req.body?.target_agent_id ?? req.body?.targetAgentId ?? '').trim();
  const rumorType = String(req.body?.rumor_type ?? req.body?.rumorType ?? '').trim();
  const content = req.body?.content ?? '';

  const result = await transaction(async (client) => {
    return RumorPlantService.plantWithClient(client, req.user.id, petRow.id, { targetAgentId, rumorType, content });
  });
  created(res, result);
}));

router.get('/me/world/rumors/open', requireUserAuth, asyncHandler(async (req, res) => {
  const rumors = await WorldContextService.listOpenRumors({ limit: req.query?.limit });
  success(res, { rumors });
}));

router.get('/me/world/rumors/:id', requireUserAuth, asyncHandler(async (req, res) => {
  const details = await WorldContextService.getRumorDetails(req.params.id);
  success(res, details);
}));

/**
 * GET /users/me/world/butterfly-report
 * Returns recent intervention -> consequence chain report.
 */
router.get('/me/world/butterfly-report', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const day = req.query?.day ? String(req.query.day).trim() : null;
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequestError('Invalid day format (YYYY-MM-DD)');
  }

  const report = await transaction(async (client) => {
    return ButterflyReportService.generateReportWithClient(client, petRow.id, { day });
  });
  success(res, report);
}));

/**
 * POST /users/me/world/dev/simulate
 * Dev-only: force-generate N showrunner episodes so you can test without waiting for real time.
 *
 * Body:
 * - steps: number (1..30)
 * - day: optional YYYY-MM-DD (defaults to today)
 */
router.post('/me/world/dev/simulate', requireUserAuth, asyncHandler(async (req, res) => {
  if (config.isProduction || !config.limbopet.devTools) {
    throw new BadRequestError('Dev tools are disabled');
  }

  // Dev tools: allow longer runs for multi-user “society” tuning without manual chunking.
  const steps = Math.max(1, Math.min(120, Number(req.body?.steps ?? 1) || 1));
  const day = req.body?.day ? String(req.body.day).trim() : null;
  const advanceDays = Boolean(req.body?.advance_days ?? req.body?.advanceDays);
  const epsPerStepRaw = Number(req.body?.episodes_per_step ?? req.body?.episodesPerStep ?? 1);
  const episodesPerStep = Number.isFinite(epsPerStepRaw) ? Math.max(1, Math.min(10, Math.floor(epsPerStepRaw))) : 1;
  const plazaPerStepRaw = Number(req.body?.plaza_posts_per_step ?? req.body?.plazaPostsPerStep ?? 1);
  const plazaPostsPerStep = Number.isFinite(plazaPerStepRaw) ? Math.max(0, Math.min(10, Math.floor(plazaPerStepRaw))) : 1;
  const stepDaysRaw = Number(req.body?.step_days ?? req.body?.stepDays ?? 1);
  const stepDays = Number.isFinite(stepDaysRaw) ? Math.max(1, Math.min(30, Math.floor(stepDaysRaw))) : 1;
  const forceEpisodeInput = req.body?.force_episode ?? req.body?.forceEpisode;
  const forceEpisode = typeof forceEpisodeInput === 'boolean' ? forceEpisodeInput : !advanceDays;
  const extras = req.body?.extras ? Math.max(0, Math.min(200, Number(req.body.extras) || 0)) : 0;
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequestError('Invalid day format (YYYY-MM-DD)');
  }

  if (extras > 0) {
    // Seed extra actors for "30 users" style simulation (real DB rows, dev-only).
    await transaction(async (client) => {
      await DevSeedService.ensureExtraActorsWithClient(client, { count: extras });
    });
  }

  // Resolve world agent id for research lab seeding
  const worldAgentId = await WorldContextService.getWorldAgentId().catch(() => null);

  const baseDay = day || new Date().toISOString().slice(0, 10);
  const endDay = advanceDays ? addDaysISODate(baseDay, (steps - 1) * stepDays) : baseDay;

  const results = [];
  for (let i = 0; i < steps; i += 1) {
    const stepDay = advanceDays ? addDaysISODate(baseDay, i * stepDays) : baseDay;
    // eslint-disable-next-line no-await-in-loop
    await transaction(async (client) => {
      // 1) Economy tick: company revenue + salary
      await bestEffortInTransaction(
        client,
        async () => EconomyTickService.tickWithClient(client, { day: stepDay || undefined }),
        { label: 'dev_sim_economy' }
      );
      // 1.5) Arena tick: daily competition loop (idempotent per day)
      //   resolveImmediately skips the live window so recaps are created inline.
      await bestEffortInTransaction(
        client,
        async () => ArenaService.tickDayWithClient(client, { day: stepDay || undefined, resolveImmediately: true }),
        { label: 'dev_sim_arena' }
      );
      // 3) Research project seed/progress
      if (worldAgentId) {
        await bestEffortInTransaction(
          client,
          async () => ResearchLabService.ensureOneActiveProjectWithClient(client, { createdByAgentId: worldAgentId }),
          { label: 'dev_sim_research' }
        );
      }
      // 4) Secret society seed
      await bestEffortInTransaction(
        client,
        async () => SecretSocietyService.ensureSeededWithClient(client),
        { label: 'dev_sim_society' }
      );
    });

    // 2) Election progress
    //
    // IMPORTANT: ElectionService.tickDay() runs its own DB transaction.
    // Calling it inside the outer dev simulation transaction can deadlock because
    // Economy/Spending ticks may hold FOR UPDATE locks on agents.
    // Keep elections as a separate transaction boundary.
    // eslint-disable-next-line no-await-in-loop
    await ElectionService.tickDay({ day: stepDay || new Date().toISOString().slice(0, 10), fast: true }).catch(() => null);

    // 5) Social episodes (showrunner)
    const forceThisDay = forceEpisode || episodesPerStep > 1;
    for (let j = 0; j < episodesPerStep; j += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await ShowrunnerService.ensureDailyEpisode({ day: stepDay || undefined, force: forceThisDay });
      results.push(r);
    }

    for (let k = 0; k < plazaPostsPerStep; k += 1) {
      // eslint-disable-next-line no-await-in-loop
      await PlazaAmbientService.tick({ day: stepDay || undefined, force: true }).catch(() => null);
    }
  }

  const bundle = await WorldContextService.getBundle({ day: endDay || undefined, includeOpenRumors: true, ensureEpisode: false });
  const generated = results.filter((r) => r?.created).length;
  const simDay = endDay || bundle.day;

  // Dev simulation should advance the "current world day" SSOT so workers/UI stay consistent.
  await transaction(async (client) => {
    await bestEffortInTransaction(
      client,
      async () => WorldDayService.setCurrentDayWithClient(client, simDay, { source: 'dev_simulate' }),
      { label: 'dev_sim_world_day' }
    );
  }).catch(() => null);

  // Build world state summary
  const worldState = await transaction(async (client) => {
    const { rows: companyRows } = await client.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(balance), 0)::int AS total_balance
       FROM companies WHERE status = 'active'`
    );
    const { rows: electionRows } = await client.query(
      `SELECT COUNT(*)::int AS count,
              (SELECT phase FROM elections WHERE phase <> 'closed' ORDER BY created_at DESC LIMIT 1) AS latest_phase
       FROM elections WHERE phase <> 'closed'`
    );
    const { rows: researchRows } = await client.query(
      `SELECT COUNT(*)::int AS count,
              (SELECT stage FROM research_projects WHERE status = 'in_progress' ORDER BY created_at DESC LIMIT 1) AS latest_stage
       FROM research_projects WHERE status = 'in_progress'`
    );
    const { rows: societyRows } = await client.query(
      `SELECT COUNT(*)::int AS count,
              (SELECT COUNT(*)::int FROM secret_society_members WHERE status = 'active') AS total_members
       FROM secret_societies WHERE status = 'active'`
    );
    const { rows: econRows } = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::int AS circulating
       FROM transactions WHERE to_agent_id IS NOT NULL`
    );
    const { rows: todayRevRows } = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::int AS today_revenue
       FROM transactions WHERE tx_type = 'REVENUE' AND created_at > NOW() - interval '1 hour'`
    );

    return {
      companies: { count: companyRows[0]?.count || 0, totalBalance: companyRows[0]?.total_balance || 0 },
      elections: { active: electionRows[0]?.count || 0, phase: electionRows[0]?.latest_phase || null },
      research: { active: researchRows[0]?.count || 0, stage: researchRows[0]?.latest_stage || null },
      societies: { count: societyRows[0]?.count || 0, members: societyRows[0]?.total_members || 0 },
      economy: { circulating: econRows[0]?.circulating || 0, todayRevenue: todayRevRows[0]?.today_revenue || 0 }
    };
  });

  success(res, { generated, steps, episodesPerStep, advanceDays, stepDays, day: simDay, worldState, bundle });
}));

/**
 * POST /users/me/world/dev/research
 * Dev-only: start one AI Research Lab project (user-first; NPCs only for cold start).
 */
router.post('/me/world/dev/research', requireUserAuth, asyncHandler(async (req, res) => {
  if (config.isProduction || !config.limbopet.devTools) {
    throw new BadRequestError('Dev tools are disabled');
  }

  const seeded = await NpcSeedService.ensureSeeded();
  const petRow = await AgentService.findByOwnerUserId(req.user.id).catch(() => null);
  const createdBy = petRow?.id || seeded?.world?.id || null;

  const result = await transaction(async (client) => {
    return ResearchLabService.ensureOneActiveProjectWithClient(client, { createdByAgentId: createdBy });
  });

  success(res, result);
}));

/**
 * POST /users/me/world/dev/secret-society
 * Dev-only: seed one Secret Society (user-first; NPCs only for cold start) + a few invite DMs.
 */
router.post('/me/world/dev/secret-society', requireUserAuth, asyncHandler(async (req, res) => {
  if (config.isProduction || !config.limbopet.devTools) {
    throw new BadRequestError('Dev tools are disabled');
  }

  await NpcSeedService.ensureSeeded();
  const result = await transaction(async (client) => {
    return SecretSocietyService.ensureSeededWithClient(client);
  });
  success(res, result);
}));

/**
 * POST /users/me/pet/brain-key/rotate
 * Returns a new pet API key (old one invalidated).
 */
router.post('/me/pet/brain-key/rotate', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const rotated = await AgentService.rotateApiKey(petRow.id);
  created(res, rotated);
}));

module.exports = router;
