/**
 * UserBrainProfileService
 *
 * Stores per-user BYOK credentials (encrypted at rest).
 * NOTE: Never return the raw API key to the client.
 */

const { queryOne, transaction } = require('../config/database');
const { BadRequestError } = require('../utils/errors');
const { encryptSecret, decryptSecret } = require('../utils/crypto');
const UserByokLlmService = require('./UserByokLlmService');
const config = require('../config');

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

async function refreshGoogleAccessToken({ refreshToken }) {
  const clientId = String(config.google?.clientId || '').trim();
  const clientSecret = String(config.google?.clientSecret || '').trim();
  if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID is required');
  if (!clientSecret) throw new Error('GOOGLE_OAUTH_CLIENT_SECRET is required');

  const url = 'https://oauth2.googleapis.com/token';
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: String(refreshToken || '').trim()
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw new Error(String(msg).slice(0, 500));
  }

  const accessToken = String(json?.access_token || '').trim();
  const expiresIn = Number(json?.expires_in || 0) || 0;
  if (!accessToken) throw new Error('Missing access_token');
  const expiresAt = new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString();
  return { accessToken, expiresAt };
}

function normalizeProvider(p) {
  const n = UserByokLlmService.normalizeProvider(p);
  if (!n) throw new BadRequestError('Unsupported provider');
  return n;
}

function normalizeBaseUrl(provider, baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return null;
  if (!/^https:\/\//i.test(raw)) {
    throw new BadRequestError('base_url must use HTTPS');
  }
  const trimmed = raw.replace(/\/+$/, '');
  // Only allow overriding base_url for OpenAI-compatible family for now.
  if (provider === 'openai_compatible' || provider === 'openai' || provider === 'xai') {
    // Block private/loopback/link-local/metadata hosts to reduce SSRF risk.
    try {
      const u = new URL(trimmed);
      const host = u.hostname.toLowerCase();
      const blocked = [
        /^localhost$/i,
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2\d|3[01])\./,
        /^192\.168\./,
        /^169\.254\./,
        /^0\./,
        /^\[?::1\]?$/i,
        /^\[?fe80:/i,
        /^\[?fc/i,
        /^\[?fd/i,
        /^metadata\.google\.internal$/i
      ];
      if (blocked.some((re) => re.test(host))) {
        throw new BadRequestError('base_url cannot point to private/internal addresses');
      }
    } catch (e) {
      if (e instanceof BadRequestError) throw e;
      throw new BadRequestError('Invalid base_url');
    }
    return trimmed;
  }
  return null;
}

function normalizeModel(model) {
  const m = String(model || '').trim();
  if (!m) throw new BadRequestError('model is required');
  if (m.length > 80) throw new BadRequestError('model is too long');
  return m;
}

function normalizeApiKey(apiKey) {
  const k = String(apiKey || '').trim();
  if (!k) throw new BadRequestError('api_key is required');
  if (k.length > 400) throw new BadRequestError('api_key is too long');
  return k;
}

function tryDecrypt(ciphertextB64) {
  const raw = String(ciphertextB64 || '').trim();
  if (!raw) return null;
  try {
    return decryptSecret(raw);
  } catch {
    return null;
  }
}

function publicView(row) {
  if (!row) return null;
  return {
    provider: row.provider,
    mode: row.mode,
    base_url: row.base_url ?? null,
    model: row.model ?? null,
    last_validated_at: row.last_validated_at ?? null,
    last_error: row.last_error ?? null,
    updated_at: row.updated_at ?? null,
    connected: true
  };
}

class UserBrainProfileService {
  static async get(userId) {
    const row = await queryOne(
      `SELECT user_id, provider, mode, base_url, model, last_validated_at, last_error, updated_at
       FROM user_brain_profiles
       WHERE user_id = $1`,
      [userId]
    );
    return row ? publicView(row) : null;
  }

  static async getDecrypted(userId, client = null) {
    const row = client
      ? await client
        .query(
        `SELECT user_id, provider, mode, base_url, model, api_key_enc,
                oauth_access_token_enc, oauth_refresh_token_enc, oauth_expires_at,
                last_validated_at, last_error, updated_at
         FROM user_brain_profiles
         WHERE user_id = $1`,
        [userId]
        )
        .then((r) => r.rows?.[0] ?? null)
      : await queryOne(
        `SELECT user_id, provider, mode, base_url, model, api_key_enc,
                oauth_access_token_enc, oauth_refresh_token_enc, oauth_expires_at,
                last_validated_at, last_error, updated_at
         FROM user_brain_profiles
         WHERE user_id = $1`,
        [userId]
      );

    if (!row) return null;

    const apiKey = tryDecrypt(row.api_key_enc);
    const oauthAccessToken = tryDecrypt(row.oauth_access_token_enc);
    const oauthRefreshToken = tryDecrypt(row.oauth_refresh_token_enc);

    return {
      provider: row.provider,
      mode: row.mode,
      baseUrl: row.base_url ?? null,
      model: row.model ?? null,
      apiKey,
      oauthAccessToken,
      oauthRefreshToken,
      oauthExpiresAt: row.oauth_expires_at ?? null,
      lastValidatedAt: row.last_validated_at ?? null,
      lastError: row.last_error ?? null
    };
  }

  static async getDecryptedOrRefresh(userId) {
    return transaction(async (client) => {
      const row = await UserBrainProfileService.getDecrypted(userId, client);
      if (!row) return null;

      if (row.mode !== 'oauth') return row;
      if (UserByokLlmService.normalizeProvider(row.provider) !== 'google') {
        throw new Error('Unsupported oauth provider');
      }

      const refreshToken = String(row.oauthRefreshToken || '').trim();
      if (!refreshToken) throw new Error('Missing OAuth refresh token');

      const expiresAt = row.oauthExpiresAt ? new Date(row.oauthExpiresAt) : null;
      const isValid = row.oauthAccessToken && expiresAt && expiresAt.getTime() > Date.now() + 60_000;
      if (isValid) return row;

      const { accessToken, expiresAt: nextExpiresAt } = await refreshGoogleAccessToken({ refreshToken });
      const encAccess = encryptSecret(accessToken);
      await client.query(
        `UPDATE user_brain_profiles
         SET oauth_access_token_enc = $2,
             oauth_expires_at = $3::timestamptz,
             last_error = NULL,
             updated_at = NOW()
         WHERE user_id = $1`,
        [userId, encAccess, nextExpiresAt]
      );

      return {
        ...row,
        oauthAccessToken: accessToken,
        oauthExpiresAt: nextExpiresAt
      };
    });
  }

  static async upsert(
    userId,
    { provider, mode = 'api_key', baseUrl = null, model, apiKey = null, oauthAccessToken = null, oauthRefreshToken = null, oauthExpiresAt = null }
  ) {
    const p = normalizeProvider(provider);
    const m = normalizeModel(model);

    const safeMode = String(mode || 'api_key').trim().toLowerCase();
    if (!['api_key', 'oauth'].includes(safeMode)) throw new BadRequestError('Unsupported mode');

    if (safeMode === 'api_key') {
      const k = normalizeApiKey(apiKey);
      const bu = normalizeBaseUrl(p, baseUrl);
      const enc = encryptSecret(k);

      return transaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO user_brain_profiles (user_id, provider, mode, base_url, model, api_key_enc,
                                            oauth_access_token_enc, oauth_refresh_token_enc, oauth_expires_at,
                                            last_validated_at, last_error, updated_at)
           VALUES ($1,$2,'api_key',$3,$4,$5,NULL,NULL,NULL,NULL,NULL,NOW())
           ON CONFLICT (user_id)
           DO UPDATE SET provider = EXCLUDED.provider,
                         mode = EXCLUDED.mode,
                         base_url = EXCLUDED.base_url,
                         model = EXCLUDED.model,
                         api_key_enc = EXCLUDED.api_key_enc,
                         oauth_access_token_enc = NULL,
                         oauth_refresh_token_enc = NULL,
                         oauth_expires_at = NULL,
                         updated_at = NOW()
           RETURNING user_id, provider, mode, base_url, model, last_validated_at, last_error, updated_at`,
          [userId, p, bu, m, enc]
        );
        return publicView(rows[0]);
      });
    }

    // oauth
    if (p !== 'google') throw new BadRequestError('Only google oauth is supported (for now)');
    const refreshToken = safeText(oauthRefreshToken, 2000);
    if (!refreshToken) throw new BadRequestError('oauth_refresh_token is required');

    const encRefresh = encryptSecret(refreshToken);
    const encAccess = oauthAccessToken ? encryptSecret(safeText(oauthAccessToken, 2000)) : null;

    return transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO user_brain_profiles (user_id, provider, mode, base_url, model, api_key_enc,
                                          oauth_access_token_enc, oauth_refresh_token_enc, oauth_expires_at,
                                          last_validated_at, last_error, updated_at)
         VALUES ($1,$2,'oauth',NULL,$3,NULL,$4,$5,$6::timestamptz,NULL,NULL,NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET provider = EXCLUDED.provider,
                       mode = EXCLUDED.mode,
                       base_url = NULL,
                       model = EXCLUDED.model,
                       api_key_enc = NULL,
                       oauth_access_token_enc = COALESCE(EXCLUDED.oauth_access_token_enc, user_brain_profiles.oauth_access_token_enc),
                       oauth_refresh_token_enc = EXCLUDED.oauth_refresh_token_enc,
                       oauth_expires_at = EXCLUDED.oauth_expires_at,
                       updated_at = NOW()
         RETURNING user_id, provider, mode, base_url, model, last_validated_at, last_error, updated_at`,
        [userId, p, m, encAccess, encRefresh, oauthExpiresAt]
      );
      return publicView(rows[0]);
    });
  }

  /**
   * Saves a proxy brain profile — credentials live in CLIProxyAPI, not in our DB.
   */
  static async upsertProxy(userId, { provider }) {
    const p = normalizeProvider(provider);
    return transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO user_brain_profiles (user_id, provider, mode, base_url, model, api_key_enc,
                                          oauth_access_token_enc, oauth_refresh_token_enc, oauth_expires_at,
                                          last_validated_at, last_error, updated_at)
         VALUES ($1,$2,'proxy',NULL,NULL,NULL,NULL,NULL,NULL,NOW(),NULL,NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET provider = EXCLUDED.provider,
                       mode = 'proxy',
                       base_url = NULL,
                       model = NULL,
                       api_key_enc = NULL,
                       oauth_access_token_enc = NULL,
                       oauth_refresh_token_enc = NULL,
                       oauth_expires_at = NULL,
                       last_validated_at = NOW(),
                       last_error = NULL,
                       updated_at = NOW()
         RETURNING user_id, provider, mode, base_url, model, last_validated_at, last_error, updated_at`,
        [userId, p]
      );
      return publicView(rows[0]);
    });
  }

  static async delete(userId) {
    return transaction(async (client) => {
      await client.query('DELETE FROM user_brain_profiles WHERE user_id = $1', [userId]);
      return true;
    });
  }

  static async markValidation(userId, { ok, error = null }) {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE user_brain_profiles
         SET last_validated_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
             last_error = $3,
             updated_at = NOW()
         WHERE user_id = $1
         RETURNING user_id, provider, mode, base_url, model, last_validated_at, last_error, updated_at`,
        [userId, Boolean(ok), error]
      );
      return rows[0] ? publicView(rows[0]) : null;
    });
  }
}

module.exports = UserBrainProfileService;
