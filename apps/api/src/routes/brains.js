/**
 * Brain Routes (Phase 1 MVP)
 * /api/v1/brains/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const BrainJobService = require('../services/BrainJobService');
const { isValidUUID } = require('../utils/validators');

const router = Router();

function validateId(req, res) {
  if (!isValidUUID(req.params?.id)) {
    res.status(400).json({ error: 'Invalid ID format' });
    return false;
  }
  return true;
}

/**
 * POST /brains/jobs/pull
 * Local brain polls for work.
 */
router.post('/jobs/pull', requireAuth, asyncHandler(async (req, res) => {
  const job = await BrainJobService.pullNextJob(req.agent.id);
  success(res, { job });
}));

/**
 * GET /brains/jobs/:id
 * Client can poll a job status.
 */
router.get('/jobs/:id', requireAuth, asyncHandler(async (req, res) => {
  if (!validateId(req, res)) return;
  const job = await BrainJobService.getJob(req.agent.id, req.params.id);
  success(res, { job });
}));

/**
 * POST /brains/jobs/:id/submit
 * Local brain submits result JSON.
 */
router.post('/jobs/:id/submit', requireAuth, asyncHandler(async (req, res) => {
  if (!validateId(req, res)) return;
  const status = String(req.body?.status ?? '').trim();
  const result = req.body?.result;
  const error = req.body?.error;

  const job = await BrainJobService.submitJob(req.agent.id, req.params.id, { status, result, error });
  success(res, { job });
}));

module.exports = router;
