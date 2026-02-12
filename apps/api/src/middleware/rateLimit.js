/**
 * Rate limiting middleware
 *
 * Uses Redis when REDIS_URL is set, otherwise falls back to in-memory storage.
 */

const config = require('../config');
const { RateLimitError } = require('../utils/errors');

// --- Storage abstraction ---

class InMemoryStorage {
  constructor() {
    this._map = new Map();
    this._timer = setInterval(() => {
      const cutoff = Date.now() - 3600000;
      for (const [key, entries] of this._map.entries()) {
        const filtered = entries.filter(e => e >= cutoff);
        if (filtered.length === 0) this._map.delete(key);
        else this._map.set(key, filtered);
      }
    }, 300000);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  async check(key, limit) {
    const now = Date.now();
    const windowStart = now - (limit.window * 1000);
    let entries = (this._map.get(key) || []).filter(e => e >= windowStart);
    const count = entries.length;
    const allowed = count < limit.max;
    const remaining = Math.max(0, limit.max - count - (allowed ? 1 : 0));

    let resetAt, retryAfter = 0;
    if (entries.length > 0) {
      const oldest = Math.min(...entries);
      resetAt = new Date(oldest + limit.window * 1000);
      retryAfter = Math.ceil((resetAt.getTime() - now) / 1000);
    } else {
      resetAt = new Date(now + limit.window * 1000);
    }

    if (allowed) {
      entries.push(now);
      this._map.set(key, entries);
    }

    return { allowed, remaining, limit: limit.max, resetAt, retryAfter: allowed ? 0 : retryAfter };
  }
}

class RedisStorage {
  constructor(redisUrl) {
    const Redis = require('ioredis');
    this._redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    this._redis.connect().catch(() => null);
    this._ready = false;
    this._redis.on('ready', () => { this._ready = true; });
    this._redis.on('error', () => { this._ready = false; });
    // Fallback for when Redis is down
    this._fallback = new InMemoryStorage();
  }

  async check(key, limit) {
    if (!this._ready) return this._fallback.check(key, limit);
    try {
      const now = Date.now();
      const windowMs = limit.window * 1000;
      const windowStart = now - windowMs;

      // Use sorted set: score = timestamp, member = unique id
      const multi = this._redis.multi();
      multi.zremrangebyscore(key, 0, windowStart);
      multi.zcard(key);
      multi.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);
      multi.pexpire(key, windowMs + 1000);
      const results = await multi.exec();

      const count = results[1][1]; // zcard result
      const allowed = count < limit.max;
      const remaining = Math.max(0, limit.max - count - (allowed ? 1 : 0));

      if (!allowed) {
        // Remove the entry we just added since request is denied
        const added = results[2]; // zadd result
        await this._redis.zremrangebyscore(key, now, now).catch(() => null);
      }

      const resetAt = new Date(now + windowMs);
      const retryAfter = allowed ? 0 : Math.ceil(windowMs / 1000);

      return { allowed, remaining, limit: limit.max, resetAt, retryAfter };
    } catch {
      return this._fallback.check(key, limit);
    }
  }
}

// Choose storage based on environment
const redisUrl = process.env.REDIS_URL || '';
const storage = redisUrl ? new RedisStorage(redisUrl) : new InMemoryStorage();

/**
 * Get rate limit key from request
 */
function getKey(req, limitType) {
  const identifier = req.token || req.ip || 'anonymous';
  return `rl:${limitType}:${identifier}`;
}

/**
 * Create rate limit middleware
 */
function rateLimit(limitType = 'requests', options = {}) {
  const limit = config.rateLimits[limitType];
  if (!limit) throw new Error(`Unknown rate limit type: ${limitType}`);

  const {
    skip = () => false,
    keyGenerator = (req) => getKey(req, limitType),
    message = `Rate limit exceeded`
  } = options;

  return async (req, res, next) => {
    try {
      if (await Promise.resolve(skip(req))) return next();

      const key = await Promise.resolve(keyGenerator(req));
      const result = await storage.check(key, limit);

      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.floor(result.resetAt.getTime() / 1000));

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter);
        throw new RateLimitError(message, result.retryAfter);
      }

      req.rateLimit = result;
      next();
    } catch (error) {
      next(error);
    }
  };
}

const requestLimiter = rateLimit('requests');
const postLimiter = rateLimit('posts', { message: 'You can only post once every 30 minutes' });
const commentLimiter = rateLimit('comments', { message: 'Too many comments, slow down' });

module.exports = { rateLimit, requestLimiter, postLimiter, commentLimiter };
