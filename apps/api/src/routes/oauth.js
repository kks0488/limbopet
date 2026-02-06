/**
 * OAuth callback routes
 * /api/v1/oauth/*
 *
 * Currently:
 * - Google Gemini OAuth connect (BYOK without API key)
 */

const { Router } = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { BadRequestError } = require('../utils/errors');
const UserBrainProfileService = require('../services/UserBrainProfileService');

const router = Router();

/**
 * GET /oauth/google/gemini/callback
 *
 * Exchanges code for tokens and stores them encrypted in user_brain_profiles (mode=oauth).
 * Redirects back to LIMBOPET_WEB_URL after success/failure.
 */
router.get('/google/gemini/callback', asyncHandler(async (req, res) => {
  const code = String(req.query?.code ?? '').trim();
  const state = String(req.query?.state ?? '').trim();
  if (!code) throw new BadRequestError('Missing code');
  if (!state) throw new BadRequestError('Missing state');

  let payload = null;
  try {
    payload = jwt.verify(state, config.jwtSecret);
  } catch {
    payload = null;
  }
  const userId = payload?.sub || null;
  if (!userId || payload?.purpose !== 'gemini_oauth') {
    throw new BadRequestError('Invalid state');
  }

  const clientId = String(config.google?.clientId || '').trim();
  const clientSecret = String(config.google?.clientSecret || '').trim();
  if (!clientId) throw new BadRequestError('Google OAuth not configured', 'Set GOOGLE_OAUTH_CLIENT_ID');
  if (!clientSecret) throw new BadRequestError('Google OAuth not configured', 'Set GOOGLE_OAUTH_CLIENT_SECRET');

  const redirectUri = `${config.limbopet.baseUrl}/api/v1/oauth/google/gemini/callback`;
  const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);

  const { tokens } = await oauth2.getToken(code);

  const accessToken = String(tokens?.access_token || '').trim() || null;
  const refreshToken = String(tokens?.refresh_token || '').trim() || null;
  const expiresAt = tokens?.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;

  // Google may omit refresh_token unless prompt=consent is used AND the user hasn't granted before.
  // If it's missing, reuse existing refresh token if present.
  let finalRefresh = refreshToken;
  if (!finalRefresh) {
    const existing = await UserBrainProfileService.getDecrypted(userId).catch(() => null);
    const prev = existing?.oauthRefreshToken ? String(existing.oauthRefreshToken).trim() : '';
    if (prev) finalRefresh = prev;
  }
  if (!finalRefresh) {
    throw new BadRequestError('Google did not return a refresh token. Try again (prompt=consent).');
  }

  // Default model (user can change later via UI).
  const model = 'gemini-1.5-flash';

  await UserBrainProfileService.upsert(userId, {
    provider: 'google',
    mode: 'oauth',
    model,
    oauthAccessToken: accessToken,
    oauthRefreshToken: finalRefresh,
    oauthExpiresAt: expiresAt
  });

  await UserBrainProfileService.markValidation(userId, { ok: true, error: null }).catch(() => null);

  const web = String(config.limbopet?.webUrl || '').trim() || 'http://localhost:5173';
  const redirect = `${web}/?brain=gemini_connected`;
  res.redirect(302, redirect);
}));

module.exports = router;
