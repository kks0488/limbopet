const { queryOne, transaction } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const WorldDayService = require('./WorldDayService');
const StreakService = require('./StreakService');

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseIsoDayUTC(iso) {
  const s = safeIsoDay(iso);
  if (!s) return null;
  const [y, m, d] = s.split('-').map((x) => Number(x));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function daysBetweenUtcDates(from, to) {
  const a = from instanceof Date ? from : new Date(from);
  const b = to instanceof Date ? to : new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

class UserService {
  static async upsertOAuthUser({ provider, providerUserId, email = null, displayName = null, avatarUrl = null }) {
    if (!provider || !providerUserId) {
      throw new BadRequestError('provider and providerUserId are required');
    }

    return queryOne(
      `INSERT INTO users (provider, provider_user_id, email, display_name, avatar_url, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (provider, provider_user_id)
       DO UPDATE SET email = EXCLUDED.email,
                     display_name = EXCLUDED.display_name,
                     avatar_url = EXCLUDED.avatar_url,
                     updated_at = NOW()
       RETURNING id, provider, provider_user_id, email, display_name, avatar_url, created_at, updated_at`,
       [provider, providerUserId, email, displayName, avatarUrl]
    );
  }

  static async touchActivity(userId, { reason = null } = {}, client = null) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestError('userId is required');

    const run = async (c) => {
      const { rows } = await c.query(
        `SELECT id, last_active_at
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [uid]
      );
      const row = rows?.[0] ?? null;
      if (!row?.id) throw new NotFoundError('User');

      const now = new Date();
      const prev = row.last_active_at ? new Date(row.last_active_at) : null;
      const prevOk = prev instanceof Date && !Number.isNaN(prev.getTime());

      // Compute days away against current world day (UTC date).
      const day = await WorldDayService.getCurrentDayWithClient(c).catch(() => WorldDayService.todayISODate());
      const worldDate = parseIsoDayUTC(day) || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      let daysAway = 0;
      if (prevOk) {
        const prevDate = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate()));
        daysAway = daysBetweenUtcDates(prevDate, worldDate);
      }

      // Throttle: avoid rewriting on rapid polling, but never across a day boundary.
      if (prevOk && now.getTime() - prev.getTime() < 60_000 && daysAway <= 0) {
        return { touched: false, throttled: true, last_active_at: row.last_active_at, day, days_away: 0 };
      }

      // If the user was away, snapshot a "return summary" fact on their pet (if any) before updating last_active_at.
      if (daysAway > 0) {
        const pet = await c
          .query(`SELECT id FROM agents WHERE owner_user_id = $1 AND is_active = true LIMIT 1`, [uid])
          .then((r) => r.rows?.[0] ?? null)
          .catch(() => null);
        const agentId = pet?.id ?? null;
        if (agentId) {
          const loss = await c
            .query(`SELECT value FROM facts WHERE agent_id = $1 AND kind = 'decay' AND key = 'absence_loss' LIMIT 1`, [agentId])
            .then((r) => r.rows?.[0]?.value ?? null)
            .catch(() => null);
          const lost = loss && typeof loss === 'object' ? loss : {};

          await c.query(
            `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
             VALUES ($1, 'decay', 'return_summary', $2::jsonb, 1.0, NOW())
             ON CONFLICT (agent_id, kind, key)
             DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
            [
              agentId,
              JSON.stringify({
                day,
                days_away: daysAway,
                last_active_at: prevOk ? prev.toISOString() : null,
                reason: reason ? String(reason).slice(0, 64) : null,
                lost
              })
            ]
          );
        }
      }

      const streak = await StreakService.recordActivity(c, uid, 'daily_login', day).catch(() => null);

      await c.query(`UPDATE users SET last_active_at = NOW(), updated_at = NOW() WHERE id = $1`, [uid]);
      return { touched: true, days_away: daysAway, day, streak };
    };

    if (client) return run(client);
    return transaction(run);
  }

  static async findById(id) {
    const user = await queryOne(
      `SELECT id, provider, provider_user_id, email, display_name, avatar_url, created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    );

    if (!user) throw new NotFoundError('User');
    return user;
  }
}

module.exports = UserService;
