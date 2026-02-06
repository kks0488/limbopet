/**
 * Pet Routes (Phase 1 MVP)
 * /api/v1/pets/*
 *
 * Notes:
 * - We reuse Moltbook "agents" as LIMBOPET "pets".
 * - Auth is via pet API key (Bearer).
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { requireUserAuth } = require('../middleware/userAuth');
const { success, created } = require('../utils/response');
const AgentService = require('../services/AgentService');
const PetStateService = require('../services/PetStateService');
const PetMemoryService = require('../services/PetMemoryService');

const router = Router();

/**
 * POST /pets/register
 * Create a new pet identity (returns API key)
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const result = await AgentService.register({ name, description });
  created(res, result);
}));

/**
 * POST /pets/create
 * Requires a user account (OAuth) and enforces 1 pet per user.
 */
router.post('/create', requireUserAuth, asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const result = await AgentService.register({ name, description, ownerUserId: req.user.id });
  created(res, result);
}));

/**
 * GET /pets/me
 * Get current pet profile + stats (+ facts)
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { pet, stats } = await PetStateService.getState(req.agent.id);
  const facts = await PetMemoryService.listFacts(req.agent.id, { limit: 50 });
  success(res, { pet, stats, facts });
}));

/**
 * POST /pets/me/actions
 * Perform Tamagotchi action (server updates stats + appends event)
 */
router.post('/me/actions', requireAuth, asyncHandler(async (req, res) => {
  const action = String(req.body?.action ?? '').trim();
  const payload = req.body?.payload ?? {};

  const result = await PetStateService.performAction(req.agent.id, action, payload);
  success(res, result);
}));

/**
 * GET /pets/me/timeline
 * List recent events
 */
router.get('/me/timeline', requireAuth, asyncHandler(async (req, res) => {
  const events = await PetStateService.getTimeline(req.agent.id, { limit: req.query?.limit });
  success(res, { events });
}));

/**
 * POST /pets/me/memory-nudges
 * Save "gravity fingertip" nudges as facts
 */
router.post('/me/memory-nudges', requireAuth, asyncHandler(async (req, res) => {
  const nudges = Array.isArray(req.body?.nudges) ? req.body.nudges : [req.body];
  const saved = await PetMemoryService.upsertNudges(req.agent.id, nudges);
  success(res, { saved });
}));

/**
 * GET /pets/me/memories?scope=daily&day=YYYY-MM-DD
 */
router.get('/me/memories', requireAuth, asyncHandler(async (req, res) => {
  const scope = String(req.query?.scope ?? 'daily');
  const day = String(req.query?.day ?? PetMemoryService.getTodayISODate());

  let memory = null;
  if (scope === 'daily') {
    memory = await PetMemoryService.getDailyMemory(req.agent.id, day);
  } else if (scope === 'weekly') {
    memory = await PetMemoryService.getWeeklyMemory(req.agent.id, day);
  }

  success(res, { memory });
}));

/**
 * GET /pets/me/limbo/today
 * Returns today's Limbo Room summary if present, otherwise creates a DAILY_SUMMARY brain job.
 */
router.get('/me/limbo/today', requireAuth, asyncHandler(async (req, res) => {
  const day = PetMemoryService.getTodayISODate();
  const { memory, weekly, job } = await PetMemoryService.ensureDailySummaryJob(req.agent.id, day);
  success(res, { day, memory, weekly, job });
}));

module.exports = router;
