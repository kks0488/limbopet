/**
 * Auth Routes (Phase 1 MVP)
 * /api/v1/auth/*
 *
 * OAuth intent:
 * - Use Google ID tokens for simple server-side verification (beginner-friendly).
 * - Other OAuth providers can be added similarly.
 */

const { Router } = require('express');
const { OAuth2Client } = require('google-auth-library');

const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireUserAuth } = require('../middleware/userAuth');
const { created, success } = require('../utils/response');
const { BadRequestError } = require('../utils/errors');
const UserService = require('../services/UserService');
const { signUser } = require('../utils/jwt');

const router = Router();

/**
 * POST /auth/google
 * Body: { id_token }
 */
router.post('/google', asyncHandler(async (req, res) => {
  const idToken = String(req.body?.id_token ?? '').trim();
  if (!idToken) throw new BadRequestError('id_token is required');

  const clientId = config.google?.clientId;
  if (!clientId) {
    throw new BadRequestError('Google OAuth not configured', 'Set GOOGLE_OAUTH_CLIENT_ID');
  }

  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();

  if (!payload?.sub) throw new BadRequestError('Invalid Google token');

  const user = await UserService.upsertOAuthUser({
    provider: 'google',
    providerUserId: payload.sub,
    email: payload.email || null,
    displayName: payload.name || payload.email || null,
    avatarUrl: payload.picture || null
  });

  await UserService.touchActivity(user.id, { reason: 'login' }).catch(() => null);

  const token = signUser(user);
  created(res, { token, user });
}));

/**
 * POST /auth/dev
 * Body: { email }
 *
 * Local dev fallback when OAuth is not set up.
 */
router.post('/dev', asyncHandler(async (req, res) => {
  if (config.isProduction || config.google?.clientId) {
    throw new BadRequestError('Dev login is disabled');
  }
  const email = String(req.body?.email ?? '').trim();
  if (!email) throw new BadRequestError('email is required');

  const user = await UserService.upsertOAuthUser({
    provider: 'dev',
    providerUserId: email.toLowerCase(),
    email,
    displayName: email,
    avatarUrl: null
  });

  await UserService.touchActivity(user.id, { reason: 'login' }).catch(() => null);

  const token = signUser(user);
  created(res, { token, user });
}));

/**
 * GET /auth/me
 */
router.get('/me', requireUserAuth, asyncHandler(async (req, res) => {
  await UserService.touchActivity(req.user.id, { reason: 'me' }).catch(() => null);
  success(res, { user: req.user });
}));

module.exports = router;
