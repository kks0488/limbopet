import http from 'k6/http';
import { check, group, sleep } from 'k6';

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function apiUrl() {
  const raw = String(__ENV.API_URL || 'http://localhost:3001/api/v1').trim();
  return raw.replace(/\/+$/, '');
}

function parseJson(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

function devLogin(base, email) {
  const res = http.post(
    `${base}/auth/dev`,
    JSON.stringify({ email }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'auth_dev' }
    }
  );
  const ok = check(res, {
    'auth/dev status 201': (r) => r.status === 201,
  });
  if (!ok) {
    throw new Error(`auth/dev failed (email=${email}, status=${res.status}, body=${String(res.body || '').slice(0, 220)})`);
  }
  const json = parseJson(res);
  const token = String(json?.token || '').trim();
  if (!token) {
    throw new Error(`auth/dev missing token (email=${email})`);
  }
  return token;
}

export const options = (() => {
  const vus = clampInt(__ENV.VUS || __ENV.USERS || 30, 1, 500, 30);
  const duration = String(__ENV.DURATION || '10m').trim() || '10m';
  return {
    vus,
    duration,
    thresholds: {
      http_req_failed: ['rate<0.01'],
      http_req_duration: ['p(95)<800'],
    }
  };
})();

export function setup() {
  const base = apiUrl();
  const users = clampInt(__ENV.USERS || 30, 1, 200, 30);

  // Warm up / health check
  const health = http.get(`${base}/health`, { tags: { name: 'health' } });
  check(health, { 'health status 200': (r) => r.status === 200 });

  const tokens = [];
  for (let i = 1; i <= users; i += 1) {
    const email = `pet${String(i).padStart(2, '0')}@example.com`;
    const token = devLogin(base, email);
    tokens.push({ email, token });
  }

  return { base, tokens };
}

export default function (data) {
  const base = data.base;
  const tokens = data.tokens || [];
  const idx = tokens.length ? ((__VU - 1) % tokens.length) : 0;
  const token = tokens[idx]?.token || '';

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  group('world_today', () => {
    const res = http.get(`${base}/users/me/world/today`, { headers, tags: { name: 'world_today' } });
    check(res, {
      'world/today 200': (r) => r.status === 200,
      'world/today success=true': (r) => parseJson(r)?.success === true,
    });
  });

  group('pet', () => {
    const res = http.get(`${base}/users/me/pet`, { headers, tags: { name: 'pet' } });
    check(res, {
      'pet 200': (r) => r.status === 200,
      'pet success=true': (r) => parseJson(r)?.success === true,
    });
  });

  group('feed', () => {
    const res = http.get(`${base}/users/me/feed?sort=new&limit=10&offset=0&submolt=general`, { headers, tags: { name: 'feed' } });
    check(res, {
      'feed 200': (r) => r.status === 200,
      'feed success=true': (r) => parseJson(r)?.success === true,
    });
  });

  group('arena_today', () => {
    const res = http.get(`${base}/users/me/world/arena/today?limit=10`, { headers, tags: { name: 'arena_today' } });
    check(res, {
      'arena/today 200': (r) => r.status === 200,
      'arena/today success=true': (r) => parseJson(r)?.success === true,
    });
  });

  const sleepMin = Number(__ENV.SLEEP_MIN_S ?? 0.5);
  const sleepMax = Number(__ENV.SLEEP_MAX_S ?? 1.5);
  const a = Number.isFinite(sleepMin) ? Math.max(0, sleepMin) : 0.5;
  const b = Number.isFinite(sleepMax) ? Math.max(a, sleepMax) : 1.5;
  sleep(a + Math.random() * (b - a));
}

