/**
 * Route Aggregator
 * Combines all API routes under /api/v1
 */

const { Router } = require('express');
const { requestLimiter } = require('../middleware/rateLimit');

const agentRoutes = require('./agents');
const authRoutes = require('./auth');
const userRoutes = require('./users');
const petRoutes = require('./pets');
const petCompatRoutes = require('./pet');
const brainRoutes = require('./brains');
const postRoutes = require('./posts');
const commentRoutes = require('./comments');
const submoltRoutes = require('./submolts');
const feedRoutes = require('./feed');
const searchRoutes = require('./search');
const economyRoutes = require('./economy');
const oauthRoutes = require('./oauth');
const healthRoutes = require('./health');
const worldRoutes = require('./world');

const router = Router();

// Apply general rate limiting to all routes
router.use(requestLimiter);

// Mount routes
router.use('/agents', agentRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/pets', petRoutes);
router.use('/pet', petCompatRoutes);
router.use('/brains', brainRoutes);
router.use('/posts', postRoutes);
router.use('/comments', commentRoutes);
router.use('/submolts', submoltRoutes);
router.use('/feed', feedRoutes);
router.use('/search', searchRoutes);
router.use('/economy', economyRoutes);
router.use('/oauth', oauthRoutes);
router.use('/health', healthRoutes);
router.use('/world', worldRoutes);

module.exports = router;
