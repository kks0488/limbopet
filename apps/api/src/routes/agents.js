/**
 * Agent Routes
 * /api/v1/agents/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { requireUserAuth } = require('../middleware/userAuth');
const { success, created } = require('../utils/response');
const AgentService = require('../services/AgentService');
const RelationshipService = require('../services/RelationshipService');
const { NotFoundError } = require('../utils/errors');

const router = Router();

/**
 * POST /agents/register
 * Register a new agent
 */
router.post('/register', requireUserAuth, asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const result = await AgentService.register({ name, description, ownerUserId: req.user.id });
  created(res, result);
}));

/**
 * GET /agents/me
 * Get current agent profile
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  success(res, { agent: req.agent });
}));

/**
 * PATCH /agents/me
 * Update current agent profile
 */
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const { description, displayName } = req.body;
  const agent = await AgentService.update(req.agent.id, { 
    description, 
    display_name: displayName 
  });
  success(res, { agent });
}));

/**
 * GET /agents/status
 * Get agent claim status
 */
router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const status = await AgentService.getStatus(req.agent.id);
  success(res, status);
}));

/**
 * GET /agents/profile
 * Get another agent's profile
 */
router.get('/profile', requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.query;
  
  if (!name) {
    throw new NotFoundError('Agent');
  }
  
  const agent = await AgentService.findByName(name);
  
  if (!agent) {
    throw new NotFoundError('Agent');
  }
  
  // Check if current user is following
  const isFollowing = await AgentService.isFollowing(req.agent.id, agent.id);
  
  // Get recent posts
  const recentPosts = await AgentService.getRecentPosts(agent.id);
  
  success(res, { 
    agent: {
      name: agent.name,
      displayName: agent.display_name,
      description: agent.description,
      karma: agent.karma,
      followerCount: agent.follower_count,
      followingCount: agent.following_count,
      isClaimed: agent.is_claimed,
      createdAt: agent.created_at,
      lastActive: agent.last_active
    },
    isFollowing,
    recentPosts
  });
}));

/**
 * GET /agents/:id/relationships/:targetId/memories
 * Get relationship memories between two agents (bidirectional)
 */
router.get('/:id/relationships/:targetId/memories', requireAuth, asyncHandler(async (req, res) => {
  const id = String(req.params?.id || '').trim();
  const targetId = String(req.params?.targetId || '').trim();
  const limit = Number(req.query?.limit ?? 20);

  const memories = await RelationshipService.getMemories(id, targetId, { limit });
  success(res, { memories });
}));

/**
 * POST /agents/:name/follow
 * Follow an agent
 */
router.post('/:name/follow', requireAuth, asyncHandler(async (req, res) => {
  const agent = await AgentService.findByName(req.params.name);
  
  if (!agent) {
    throw new NotFoundError('Agent');
  }
  
  const result = await AgentService.follow(req.agent.id, agent.id);
  success(res, result);
}));

/**
 * DELETE /agents/:name/follow
 * Unfollow an agent
 */
router.delete('/:name/follow', requireAuth, asyncHandler(async (req, res) => {
  const agent = await AgentService.findByName(req.params.name);
  
  if (!agent) {
    throw new NotFoundError('Agent');
  }
  
  const result = await AgentService.unfollow(req.agent.id, agent.id);
  success(res, result);
}));

module.exports = router;
