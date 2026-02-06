const { BadRequestError, NotFoundError } = require('../utils/errors');

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeUserId(userId) {
  const uid = String(userId || '').trim();
  if (!uid) throw new BadRequestError('user_id is required');
  return uid;
}

function normalizeType(type) {
  const t = String(type || '').trim().toUpperCase();
  if (!t) throw new BadRequestError('notification type is required', 'BAD_NOTIFICATION_TYPE');
  if (!/^[A-Z0-9_]{3,64}$/.test(t)) {
    throw new BadRequestError('Invalid notification type', 'BAD_NOTIFICATION_TYPE');
  }
  return t;
}

function normalizeText(v, field, maxLen = 300) {
  const s = String(v || '').trim();
  if (!s) throw new BadRequestError(`${field} is required`, 'BAD_NOTIFICATION');
  return s.slice(0, Math.max(1, Math.trunc(Number(maxLen) || 300)));
}

function safeData(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return v;
}

function normalizeId(v) {
  const id = clampInt(v, 0, 2147483647);
  if (!id) throw new BadRequestError('Invalid notification id', 'BAD_NOTIFICATION_ID');
  return id;
}

class NotificationService {
  static async create(client, userId, { type, title, body, data = {} } = {}) {
    if (!client) throw new Error('client is required');
    const uid = normalizeUserId(userId);
    const nType = normalizeType(type);
    const nTitle = normalizeText(title, 'title', 180);
    const nBody = normalizeText(body, 'body', 1000);
    const nData = safeData(data);

    const { rows } = await client.query(
      `INSERT INTO notifications (user_id, type, title, body, data, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
       RETURNING id, user_id, type, title, body, data, read_at, created_at`,
      [uid, nType, nTitle, nBody, JSON.stringify(nData)]
    );
    return rows?.[0] ?? null;
  }

  static async getUnread(client, userId, limit = 20) {
    if (!client) throw new Error('client is required');
    const uid = normalizeUserId(userId);
    const lim = clampInt(limit, 1, 100);

    const { rows } = await client.query(
      `SELECT id, user_id, type, title, body, data, read_at, created_at
       FROM notifications
       WHERE user_id = $1
         AND read_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [uid, lim]
    );
    return rows || [];
  }

  static async markRead(client, userId, notifId) {
    if (!client) throw new Error('client is required');
    const uid = normalizeUserId(userId);
    const id = normalizeId(notifId);

    const { rows } = await client.query(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1
         AND user_id = $2
       RETURNING id, user_id, type, title, body, data, read_at, created_at`,
      [id, uid]
    );
    const row = rows?.[0] ?? null;
    if (!row) throw new NotFoundError('Notification');
    return row;
  }

  static async markAllRead(client, userId) {
    if (!client) throw new Error('client is required');
    const uid = normalizeUserId(userId);

    const { rowCount } = await client.query(
      `UPDATE notifications
       SET read_at = NOW()
       WHERE user_id = $1
         AND read_at IS NULL`,
      [uid]
    );
    return { marked: clampInt(rowCount, 0, 1_000_000) };
  }

  static async getCount(client, userId) {
    if (!client) throw new Error('client is required');
    const uid = normalizeUserId(userId);
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS unread_count
       FROM notifications
       WHERE user_id = $1
         AND read_at IS NULL`,
      [uid]
    );
    return clampInt(rows?.[0]?.unread_count, 0, 1_000_000);
  }
}

module.exports = NotificationService;
