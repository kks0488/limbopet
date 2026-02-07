const notificationTemplates = require('../data/notification_templates.json');

function safeObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return v;
}

function safeText(v, maxLen = 1000) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const n = Math.max(1, Math.trunc(Number(maxLen) || 1000));
  return s.slice(0, n);
}

function listOfStrings(v, maxLen = 1000) {
  const arr = Array.isArray(v) ? v : [];
  return arr.map((x) => safeText(x, maxLen)).filter(Boolean);
}

function pickRandom(list) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)] ?? null;
}

function interpolate(template, vars = {}) {
  const text = safeText(template, 2000);
  if (!text) return '';
  const values = safeObject(vars);
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => {
    const v = values[key];
    return v == null ? '' : String(v);
  }).trim();
}

function normalizeType(type) {
  return String(type || '').trim().toUpperCase();
}

class NotificationTemplateService {
  static render(type, { vars = {}, fallback = {}, preferTemplate = true } = {}) {
    const nType = normalizeType(type);
    const root = safeObject(notificationTemplates);
    const templateRow = safeObject(root[nType]);
    const titles = listOfStrings(templateRow.titles, 180);
    const bodies = listOfStrings(templateRow.bodies, 1000);

    const fb = safeObject(fallback);
    const fbTitle = safeText(fb.title, 180);
    const fbBody = safeText(fb.body, 1000);

    const rawTitle = preferTemplate
      ? (pickRandom(titles) || fbTitle)
      : (fbTitle || pickRandom(titles) || '');
    const rawBody = preferTemplate
      ? (pickRandom(bodies) || fbBody)
      : (fbBody || pickRandom(bodies) || '');

    const title = safeText(interpolate(rawTitle, vars), 180) || safeText(interpolate(fbTitle, vars), 180);
    const body = safeText(interpolate(rawBody, vars), 1000) || safeText(interpolate(fbBody, vars), 1000);

    return {
      type: nType,
      title,
      body
    };
  }
}

module.exports = NotificationTemplateService;
