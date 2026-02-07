/**
 * MemoryRollupService
 *
 * Phase A (minimal change):
 * - Derive "weekly" memories from existing daily summaries (no new BrainJob types).
 * - Keep it small and deterministic (no LLM cost).
 *
 * Storage: memories(scope='weekly', day=week_start_day)
 */

function parseIsoDayUTC(s) {
  const raw = String(s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('Invalid day');
  const [y, m, d] = raw.split('-').map((x) => Number(x));
  return new Date(Date.UTC(y, m - 1, d));
}

function formatIsoDayUTC(dt) {
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysUTC(day, n) {
  const dt = parseIsoDayUTC(day);
  dt.setUTCDate(dt.getUTCDate() + Number(n || 0));
  return formatIsoDayUTC(dt);
}

function weekStartDayUTC(day) {
  const dt = parseIsoDayUTC(day);
  // JS: 0=Sun..6=Sat. We want Monday as start.
  const dow = dt.getUTCDay();
  const diff = (dow + 6) % 7; // days since Monday
  dt.setUTCDate(dt.getUTCDate() - diff);
  return formatIsoDayUTC(dt);
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function asList(v) {
  return Array.isArray(v) ? v : [];
}

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

function pickTopHighlights(dailySummaries, { limit = 3 } = {}) {
  const n = clampInt(limit, 1, 10);
  const counts = new Map();
  const lastSeen = new Map();

  for (const d of dailySummaries) {
    const day = String(d?.day || '').slice(0, 10);
    const hl = asList(d?.summary?.highlights).map((x) => safeText(x, 120)).filter(Boolean);
    for (const line of hl) {
      counts.set(line, (counts.get(line) || 0) + 1);
      lastSeen.set(line, day);
    }
  }

  return Array.from(counts.entries())
    .map(([line, count]) => ({ line, count, last: lastSeen.get(line) || '' }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(b.last).localeCompare(String(a.last));
    })
    .slice(0, n)
    .map((x) => x.line);
}

function pickMoodFlow(dailySummaries) {
  const first = dailySummaries[0]?.summary || null;
  const last = dailySummaries[dailySummaries.length - 1]?.summary || null;
  const a = safeText(asList(first?.mood_flow)[0], 16);
  const b = safeText(asList(last?.mood_flow).slice(-1)[0], 16);
  if (a && b) return [a, b];
  if (a) return [a, '…'];
  if (b) return ['…', b];
  return [];
}

function summarizeNudges(nudges) {
  const list = Array.isArray(nudges) ? nudges : [];
  if (list.length === 0) return '';

  const top = list
    .slice(0, 3)
    .map((n) => `${safeText(n?.key, 24)}(${Math.round((Number(n?.confidence) || 1) * 10) / 10})`)
    .filter(Boolean);
  return top.length ? `중력: ${top.join(', ')}` : '';
}

function summarizeDialogueCore(dialogueCore) {
  const list = Array.isArray(dialogueCore) ? dialogueCore : [];
  if (list.length === 0) return '';
  const top = list
    .slice(0, 2)
    .map((x) => safeText(x?.line, 120))
    .filter(Boolean);
  return top.length ? `대화 코어: ${top.join(' / ')}` : '';
}

function pickDialogueCoreFromEvents(eventRows, { limit = 2 } = {}) {
  const n = clampInt(limit, 1, 5);
  const lines = [];
  const pushUnique = (line) => {
    const s = safeText(line, 120);
    if (!s) return;
    if (lines.some((x) => String(x.line).toLowerCase() === s.toLowerCase())) return;
    lines.push({ line: s });
  };

  for (const row of Array.isArray(eventRows) ? eventRows : []) {
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : null;
    if (!payload) continue;

    const userMessage = safeText(payload?.user_message, 90);
    const hint = safeText(payload?.dialogue?.memory_hint, 90);
    const firstLine = safeText(Array.isArray(payload?.dialogue?.lines) ? payload.dialogue.lines[0] : '', 90);

    if (userMessage && hint) {
      pushUnique(`'${userMessage}' → ${hint}`);
    } else if (userMessage && firstLine) {
      pushUnique(`'${userMessage}' → ${firstLine}`);
    } else if (hint) {
      pushUnique(hint);
    } else if (firstLine) {
      pushUnique(firstLine);
    }

    if (lines.length >= n) break;
  }

  return lines.slice(0, n);
}

function buildWeeklySummary({ weekStartDay, weekEndDay, dailySummaries, nudges, dialogueCore }) {
  const highlights = pickTopHighlights(dailySummaries, { limit: 3 });
  const moodFlow = pickMoodFlow(dailySummaries);

  const lastTomorrow = safeText(dailySummaries[dailySummaries.length - 1]?.summary?.tomorrow, 200);
  const nudgeLine = summarizeNudges(nudges);
  const dialogueLine = summarizeDialogueCore(dialogueCore);
  const signalLine = [dialogueLine, nudgeLine].filter(Boolean).join(' | ');

  const memory5 = [
    `${weekStartDay}~${weekEndDay} 한 주 요약.`,
    highlights[0] ? `대표 장면: ${highlights[0]}` : '대표 장면: …',
    highlights.length > 1 ? `이번 주 키워드: ${highlights.slice(0, 3).join(' / ')}` : '이번 주 키워드: …',
    signalLine || '대화 코어/중력: (아직 없음)',
    lastTomorrow ? `다음 주 예고: ${lastTomorrow}` : '다음 주 예고: …'
  ].map((x) => safeText(x, 180));

  return {
    week_start_day: weekStartDay,
    week_end_day: weekEndDay,
    memory_5: memory5,
    highlights,
    mood_flow: moodFlow,
    tomorrow: lastTomorrow ? `다음 주엔… ${lastTomorrow}` : '',
    dialogue_core: (Array.isArray(dialogueCore) ? dialogueCore : []).slice(0, 3).map((d) => safeText(d?.line, 140)).filter(Boolean),
    nudges: (Array.isArray(nudges) ? nudges : []).slice(0, 8).map((n) => ({
      kind: safeText(n?.kind, 24),
      key: safeText(n?.key, 64),
      confidence: Math.max(0, Math.min(2, Number(n?.confidence ?? 1) || 1))
    }))
  };
}

class MemoryRollupService {
  static weekStartDay(day) {
    return weekStartDayUTC(day);
  }

  static async getWeeklyMemoryWithClient(client, agentId, day) {
    const weekStart = weekStartDayUTC(day);
    const { rows } = await client.query(
      `SELECT id, scope, day::text AS day, summary, created_at
       FROM memories
       WHERE agent_id = $1 AND scope = 'weekly' AND day = $2::date
       LIMIT 1`,
      [agentId, weekStart]
    );
    return rows?.[0] ?? null;
  }

  static async ensureWeeklyMemoryWithClient(client, agentId, day) {
    const weekStart = weekStartDayUTC(day);
    const weekEnd = formatIsoDayUTC(parseIsoDayUTC(day)); // clamp to provided day
    const maxEnd = addDaysUTC(weekStart, 6);
    const clampedEnd = parseIsoDayUTC(weekEnd).getTime() > parseIsoDayUTC(maxEnd).getTime() ? maxEnd : weekEnd;

    const { rows: dailyRows } = await client.query(
      `SELECT day::text AS day, summary
       FROM memories
       WHERE agent_id = $1
         AND scope = 'daily'
         AND day >= $2::date
         AND day <= $3::date
       ORDER BY day ASC`,
      [agentId, weekStart, clampedEnd]
    );

    const dailySummaries = (dailyRows || [])
      .map((r) => ({ day: r.day, summary: r.summary }))
      .filter((r) => r.summary && typeof r.summary === 'object');

    if (dailySummaries.length === 0) return null;

    const { rows: nudgeRows } = await client.query(
      `SELECT kind, key, confidence
       FROM facts
       WHERE agent_id = $1
         AND kind IN ('preference','forbidden','suggestion')
       ORDER BY confidence DESC, updated_at DESC
       LIMIT 12`,
      [agentId]
    );

    const { rows: dialogueRows } = await client.query(
      `SELECT payload, created_at
       FROM events
       WHERE agent_id = $1
         AND event_type = 'DIALOGUE'
         AND created_at >= $2::date
         AND created_at < ($3::date + INTERVAL '1 day')
       ORDER BY created_at DESC
       LIMIT 40`,
      [agentId, weekStart, clampedEnd]
    );
    const dialogueCore = pickDialogueCoreFromEvents(dialogueRows || [], { limit: 2 });

    const weekly = buildWeeklySummary({
      weekStartDay: weekStart,
      weekEndDay: clampedEnd,
      dailySummaries,
      nudges: nudgeRows || [],
      dialogueCore
    });

    const { rows: upserted } = await client.query(
      `INSERT INTO memories (agent_id, scope, day, summary)
       VALUES ($1, 'weekly', $2::date, $3::jsonb)
       ON CONFLICT (agent_id, scope, day)
       DO UPDATE SET summary = EXCLUDED.summary, created_at = NOW()
       RETURNING id, scope, day::text AS day, summary, created_at`,
      [agentId, weekStart, JSON.stringify(weekly)]
    );

    return upserted?.[0] ?? null;
  }
}

module.exports = MemoryRollupService;
