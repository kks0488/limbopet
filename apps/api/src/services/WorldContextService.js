/**
 * WorldContextService
 *
 * Provides a compact "world memory bundle" for:
 * - browser UI (highlights / evidence board)
 * - BYOK brain job inputs (so pets can reference the current drama)
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const ShowrunnerService = require('./ShowrunnerService');
const ElectionService = require('./ElectionService');
const ArenaService = require('./ArenaService');
const PolicyService = require('./PolicyService');
const WorldConceptService = require('./WorldConceptService');
const WorldDayService = require('./WorldDayService');
const NpcSeedService = require('./NpcSeedService');
const TodayHookService = require('./TodayHookService');

function todayISODate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseIsoDayUTC(s) {
  const raw = safeIsoDay(s);
  if (!raw) throw new Error('Invalid day');
  const [y, m, d] = raw.split('-').map((x) => Number(x));
  return new Date(Date.UTC(y, m - 1, d));
}

function formatIsoDayUTC(dt) {
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysIso(day, deltaDays) {
  const dt = parseIsoDayUTC(day);
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0));
  return formatIsoDayUTC(dt);
}

function diffDays(a, b) {
  const da = parseIsoDayUTC(a).getTime();
  const db = parseIsoDayUTC(b).getTime();
  return Math.round((da - db) / 86400000);
}

function officeLabel(code) {
  const c = String(code || '').trim();
  if (c === 'mayor') return '시장';
  if (c === 'tax_chief') return '세무서장';
  if (c === 'chief_judge') return '수석판사';
  if (c === 'council') return '의회';
  return c || '공직';
}

function policyKeyLabel(key) {
  const k = String(key || '').trim();
  if (k === 'initial_coins') return '신규 지급';
  if (k === 'company_founding_cost') return '회사 설립비';
  if (k === 'min_wage') return '최저임금';
  if (k === 'transaction_tax_rate') return '거래세';
  if (k === 'burn_ratio') return '소각 비율';
  if (k === 'max_fine') return '벌금 상한';
  if (k === 'appeal_allowed') return '항소';
  if (k === 'bankruptcy_reset') return '파산 리셋';
  return k || 'policy';
}

function formatPolicyValue(key, value) {
  const k = String(key || '').trim();
  if (k.endsWith('_rate') || k === 'burn_ratio') {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return String(value ?? '');
    return `${Math.round(n * 100)}%`;
  }
  if (k === 'appeal_allowed') {
    return value ? '허용' : '제한';
  }
  return String(value ?? '');
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

function parseDateMs(raw) {
  const ts = Date.parse(String(raw || ''));
  return Number.isFinite(ts) ? ts : null;
}

function normalizeDirectionLatest(row) {
  const v = row?.value && typeof row.value === 'object' ? row.value : null;
  const text = safeText(v?.text, 96);
  if (!text) return null;

  const strength = clampInt(v?.strength ?? 1, 1, 3);
  const createdAt = typeof v?.created_at === 'string' ? String(v.created_at).trim() : null;
  const expiresAt = typeof v?.expires_at === 'string' ? String(v.expires_at).trim() : null;
  const kind = typeof v?.kind === 'string' ? String(v.kind).trim() : null;

  return {
    text,
    kind,
    strength,
    created_at: createdAt || (row?.updated_at ? String(row.updated_at) : null),
    expires_at: expiresAt || null
  };
}

function normalizeDirectionLastApplied(row) {
  const v = row?.value && typeof row.value === 'object' ? row.value : null;
  if (!v) return null;

  const appliedAt = typeof v?.applied_at === 'string' ? String(v.applied_at).trim() : null;
  const day = typeof v?.day === 'string' ? safeIsoDay(v.day) : null;
  const postId = typeof v?.post_id === 'string' ? String(v.post_id).trim() : null;
  const episodeIndex = Number.isFinite(Number(v?.episode_index)) ? Math.max(1, Math.floor(Number(v.episode_index))) : null;
  const scenario = typeof v?.scenario === 'string' ? String(v.scenario).trim().toUpperCase() : null;
  const text = safeText(v?.text, 96) || null;
  const strength = Number.isFinite(Number(v?.strength)) ? clampInt(v.strength, 1, 3) : null;

  return {
    applied_at: appliedAt || (row?.updated_at ? String(row.updated_at) : null),
    day,
    post_id: postId,
    episode_index: episodeIndex,
    scenario,
    text,
    strength
  };
}

class WorldContextService {
  static async getWorldAgentId() {
    const row = await queryOne(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`);
    return row?.id || null;
  }

  static async getWorldDailySummary(day) {
    const worldId = await WorldContextService.getWorldAgentId();
    if (!worldId) return null;

    return queryOne(
      `SELECT id, day, summary, created_at
       FROM memories
       WHERE agent_id = $1 AND scope = 'world_daily' AND day = $2`,
      [worldId, day]
    );
  }

  static async getPolicySnapshot({ day }) {
    const d = safeIsoDay(day) || todayISODate();
    const keys = [
      'initial_coins',
      'company_founding_cost',
      'min_wage',
      'transaction_tax_rate',
      'burn_ratio',
      'max_fine',
      'appeal_allowed'
    ];
    const defaults = PolicyService.defaults();

    const rows = await queryAll(
      `SELECT key, value, changed_by, changed_at
       FROM policy_params
       WHERE key = ANY($1::text[])`,
      [keys]
    ).catch(() => []);
    const map = new Map((rows || []).map((r) => [String(r.key || '').trim(), r]));

    const params = {};
    const meta = {};
    for (const k of keys) {
      const row = map.get(k) || null;
      params[k] = row ? row.value : defaults[k];
      meta[k] = row ? { changed_by: row.changed_by ?? null, changed_at: row.changed_at ?? null } : { changed_by: null, changed_at: null };
    }

    const holders = await queryAll(
      `SELECT h.office_code,
              h.agent_id,
              h.term_start_day,
              h.term_end_day,
              COALESCE(a.display_name, a.name) AS holder_name
       FROM office_holders h
       JOIN agents a ON a.id = h.agent_id
       WHERE h.term_start_day <= $1::date
         AND h.term_end_day > $1::date
       ORDER BY h.office_code ASC`,
      [d]
    ).catch(() => []);

    const elections = await queryAll(
      `SELECT id,
              office_code,
              phase,
              registration_day,
              campaign_start_day,
              voting_day,
              term_start_day,
              term_end_day
       FROM elections
       WHERE registration_day <= $1::date
         AND term_end_day > $1::date
       ORDER BY voting_day ASC`,
      [d]
    ).catch(() => []);

    const active = (elections || []).filter((e) => String(e.phase || '') !== 'closed');
    const nextElection = (() => {
      const e = active?.[0] ?? null;
      if (!e) return null;
      const votingDay = safeIsoDay(e.voting_day) || null;
      const dday = votingDay ? diffDays(votingDay, d) : null;
      return {
        id: e.id,
        office_code: String(e.office_code || '').trim(),
        phase: String(e.phase || '').trim(),
        voting_day: votingDay,
        dday
      };
    })();

    return {
      day: d,
      params,
      meta,
      holders: (holders || []).map((h) => ({
        office_code: String(h.office_code || '').trim(),
        agent_id: h.agent_id,
        holder_name: String(h.holder_name || '').trim(),
        term_start_day: safeIsoDay(h.term_start_day) || null,
        term_end_day: safeIsoDay(h.term_end_day) || null
      })),
      elections: active.map((e) => ({
        id: e.id,
        office_code: String(e.office_code || '').trim(),
        phase: String(e.phase || '').trim(),
        voting_day: safeIsoDay(e.voting_day) || null
      })),
      nextElection
    };
  }

  static async getRecentTransactions({ day, limit = 10 }) {
    const d = safeIsoDay(day) || todayISODate();
    const safeLimit = Math.max(0, Math.min(50, Number(limit) || 10));
    if (safeLimit <= 0) return [];

    const like = `%day:${d}%`;
    const rows = await queryAll(
      `SELECT t.id,
              t.tx_type,
              t.amount,
              t.memo,
              t.reference_type,
              t.created_at,
              t.from_agent_id,
              t.to_agent_id,
              COALESCE(af.display_name, af.name) AS from_name,
              COALESCE(at.display_name, at.name) AS to_name
       FROM transactions t
       LEFT JOIN agents af ON af.id = t.from_agent_id
       LEFT JOIN agents at ON at.id = t.to_agent_id
       WHERE (t.memo LIKE $1 OR t.created_at::date = $2::date)
       ORDER BY t.amount DESC, t.created_at DESC
       LIMIT $3`,
      [like, d, safeLimit]
    ).catch(() => []);

    return (rows || []).map((r) => ({
      id: r.id,
      tx_type: String(r.tx_type || '').trim(),
      amount: Number(r.amount ?? 0) || 0,
      memo: r.memo ? String(r.memo) : null,
      reference_type: r.reference_type ? String(r.reference_type) : null,
      created_at: r.created_at,
      from: r.from_agent_id ? { id: r.from_agent_id, name: String(r.from_name || '').trim() } : null,
      to: r.to_agent_id ? { id: r.to_agent_id, name: String(r.to_name || '').trim() } : null
    }));
  }

  static async getLiveTicker({ limit = 30, day = null } = {}) {
    const safeLimit = Math.max(0, Math.min(100, Number(limit) || 30));
    if (safeLimit <= 0) return [];

    const isoDay = safeIsoDay(day);
    const safeText = (s, maxLen) => String(s ?? '').trim().slice(0, maxLen);
    const lbc = (n) => {
      const v = Number(n ?? 0);
      if (!Number.isFinite(v)) return String(n ?? 0);
      return String(Math.max(0, Math.round(v)));
    };

    const items = [];

    const eventTypes = [
      'POLICY_CHANGED',
      'POLICY_DECISION',
      'ELECTION_CLOSED',
      'SHOWRUNNER_EPISODE',
      'ARENA_MATCH',
      'RELATIONSHIP_MILESTONE',
      'SPENDING',
      'SPENDING_FAILED',
      'JOB_FIRED_INACTIVE',
      'SCANDAL_RESOLVED',
      'AGENT_FIRED',
      'ARENA_SEASON_REWARD',
      'ARENA_CHEER',
      'ARENA_PREDICT',
      'SOCIETY_MISSION_STARTED',
      'SOCIETY_MISSION_FAILED'
    ];

    const eventDayFilter = isoDay
      ? `AND (
           ((payload ? 'day') AND payload->>'day' = $1)
           OR created_at::date = $1::date
         )`
      : '';
    const eventLimit = isoDay ? 320 : 160;
    const eventParams = isoDay ? [isoDay] : [];

    const evRows = await queryAll(
      `SELECT id, event_type, payload, salience_score, created_at
       FROM events
       WHERE event_type = ANY($${eventParams.length + 1}::text[])
       ${eventDayFilter}
       ORDER BY created_at DESC
       LIMIT ${eventLimit}`,
      [...eventParams, eventTypes]
    ).catch(() => []);

    for (const e of evRows || []) {
      const t = String(e.event_type || '').trim().toUpperCase();
      const payload = e.payload && typeof e.payload === 'object' ? e.payload : null;
      const at = e.created_at || null;
      const importance = Math.max(1, Number(e.salience_score ?? 0) || 0);

      let text = '';
      if (t === 'POLICY_CHANGED') {
        const office = officeLabel(payload?.office);
        const changes = Array.isArray(payload?.changes) ? payload.changes : [];
        const parts = changes
          .map((c) => {
            const k = String(c?.key || '').trim();
            if (!k) return null;
            const oldV = formatPolicyValue(k, c?.old_value);
            const newV = formatPolicyValue(k, c?.new_value);
            return `${policyKeyLabel(k)} ${oldV}→${newV}`;
          })
          .filter(Boolean)
          .slice(0, 3);
        text = parts.length > 0 ? `📜 정책 변경(${office}): ${parts.join(' · ')}` : `📜 정책 변경(${office})`;
      } else if (t === 'POLICY_DECISION') {
        const office = officeLabel(payload?.office_code ?? payload?.office);
        const changes = Array.isArray(payload?.changes) ? payload.changes : [];
        const parts = changes
          .map((c) => {
            const k = String(c?.key || '').trim();
            if (!k) return null;
            return `${policyKeyLabel(k)} ${formatPolicyValue(k, c?.value)}`;
          })
          .filter(Boolean)
          .slice(0, 2);
        text = parts.length > 0 ? `🏛️ 정책 결정(${office}): ${parts.join(' · ')}` : `🏛️ 정책 결정(${office})`;
      } else if (t === 'ELECTION_CLOSED') {
        const office = officeLabel(payload?.office);
        const winners = Array.isArray(payload?.winners) ? payload.winners : [];
        const names = winners
          .map((w) => ({ name: safeText(w?.name, 24), votes: Number(w?.votes ?? 0) || 0 }))
          .filter((w) => w.name)
          .map((w) => `${w.name}(${w.votes})`)
          .slice(0, 3);
        text = names.length > 0 ? `🗳️ ${office} 선거 종료: ${names.join(' · ')}` : `🗳️ ${office} 선거 종료`;
      } else if (t === 'SHOWRUNNER_EPISODE') {
        const title = safeText(payload?.title, 80);
        text = title ? `📺 방송: ${title}` : '📺 방송 업데이트';
      } else if (t === 'ARENA_MATCH') {
        const headline = safeText(payload?.headline, 100);
        const modeLabel = safeText(payload?.mode_label ?? payload?.mode, 24);
        const outcome = safeText(payload?.outcome, 16);
        if (headline) text = `🏟️ 아레나: ${headline}`;
        else text = `🏟️ 아레나 ${modeLabel || '매치'}${outcome ? ` (${outcome})` : ''}`;
      } else if (t === 'RELATIONSHIP_MILESTONE') {
        const summary = safeText(payload?.summary, 120);
        text = summary ? `💥 관계: ${summary}` : '💥 관계 변화가 감지됐어';
      } else if (t === 'SPENDING') {
        const memo = safeText(payload?.memo, 120);
        const code = safeText(payload?.code, 24);
        const cost = Number(payload?.cost ?? 0) || 0;
        if (memo) text = `🛒 소비: ${memo}`;
        else if (code) text = `🛒 소비: ${code}${cost ? ` (${lbc(Math.abs(cost))} LBC)` : ''}`;
        else text = '🛒 소비 이벤트';
      } else if (t === 'SPENDING_FAILED') {
        const memo = safeText(payload?.memo, 120);
        text = memo ? `⚠️ 소비 실패: ${memo}` : '⚠️ 잔고 부족으로 소비 실패';
      } else if (t === 'JOB_FIRED_INACTIVE') {
        text = '🧾 인사 변동: 장기 미활동 해고 발생';
      } else if (t === 'SCANDAL_RESOLVED') {
        const verdict = safeText(payload?.verdict, 24);
        text = verdict ? `🧨 스캔들 결론: ${verdict}` : '🧨 스캔들 사건이 정리됐어';
      } else if (t === 'AGENT_FIRED') {
        const target = safeText(payload?.target_name ?? payload?.name, 24);
        text = target ? `📉 ${target} 해고` : '📉 해고 이벤트';
      } else if (t === 'ARENA_SEASON_REWARD') {
        const season = safeText(payload?.season_code, 20);
        text = season ? `🏆 시즌 보상 지급 (${season})` : '🏆 아레나 시즌 보상 지급';
      } else if (t === 'ARENA_CHEER') {
        const msg = safeText(payload?.message, 80);
        text = msg ? `📣 아레나 응원: ${msg}` : '📣 아레나 응원 열기 상승';
      } else if (t === 'ARENA_PREDICT') {
        text = '🎯 아레나 승부 예측이 진행 중';
      } else if (t === 'SOCIETY_MISSION_STARTED') {
        const title = safeText(payload?.title, 80);
        text = title ? `🕵️ 결사 미션 시작: ${title}` : '🕵️ 비밀결사 미션 시작';
      } else if (t === 'SOCIETY_MISSION_FAILED') {
        const title = safeText(payload?.title, 80);
        text = title ? `🕵️ 결사 미션 실패: ${title}` : '🕵️ 비밀결사 미션 실패';
      } else {
        const fallback = safeText(payload?.headline ?? payload?.title ?? payload?.summary, 100);
        text = fallback || safeText(t, 80);
      }

      if (text && at) {
        items.push({ type: t, text, at, importance, ref: { kind: 'event', id: e.id } });
      }
    }

    const txWhere = isoDay
      ? `WHERE (t.memo LIKE $1 OR t.created_at::date = $2::date)`
      : `WHERE t.created_at >= NOW() - INTERVAL '6 hours'`;
    const txParams = isoDay ? [`%day:${isoDay}%`, isoDay] : [];
    const txRows = await queryAll(
      `SELECT t.id,
              t.tx_type,
              t.amount,
              t.memo,
              t.created_at,
              t.from_agent_id,
              t.to_agent_id,
              COALESCE(af.display_name, af.name) AS from_name,
              COALESCE(at.display_name, at.name) AS to_name
       FROM transactions t
       LEFT JOIN agents af ON af.id = t.from_agent_id
       LEFT JOIN agents at ON at.id = t.to_agent_id
       ${txWhere}
       ORDER BY t.created_at DESC
       LIMIT 240`,
      txParams
    ).catch(() => []);

    const threshold = (txType) => {
      const tt = String(txType || '').toUpperCase();
      if (tt === 'FOUNDING') return 1;
      if (tt === 'PURCHASE') return 8;
      if (tt === 'TRANSFER') return 12;
      if (tt === 'SALARY') return 8;
      if (tt === 'REVENUE') return 25;
      return 999999;
    };

    for (const t of txRows || []) {
      const tt = String(t.tx_type || '').toUpperCase();
      const amount = Number(t.amount ?? 0) || 0;
      if (amount < threshold(tt)) continue;
      if (!['PURCHASE', 'TRANSFER', 'SALARY', 'REVENUE', 'FOUNDING'].includes(tt)) continue;

      const from = safeText(t.from_name, 24);
      const to = safeText(t.to_name, 24);
      const memo = safeText(t.memo, 80);
      const at = t.created_at || null;

      let text = '';
      if (tt === 'FOUNDING') {
        text = memo ? `🏢 ${memo} (설립비 ${lbc(amount)} LBC)` : `🏢 회사 설립 (${lbc(amount)} LBC)`;
      } else if (tt === 'SALARY') {
        text = to ? `💼 급여: ${to} +${lbc(amount)} LBC` : `💼 급여 +${lbc(amount)} LBC`;
      } else if (tt === 'REVENUE') {
        text = to ? `📈 매출: ${to} +${lbc(amount)} LBC` : `📈 매출 +${lbc(amount)} LBC`;
      } else if (tt === 'TRANSFER') {
        text = from && to ? `💸 송금: ${from} → ${to} ${lbc(amount)} LBC` : `💸 송금 ${lbc(amount)} LBC`;
      } else if (tt === 'PURCHASE') {
        if (from && to) text = `🎁 선물: ${from} → ${to} ${lbc(amount)} LBC`;
        else if (from) text = `🛒 소비: ${from} ${lbc(amount)} LBC`;
        else text = `🛒 소비 ${lbc(amount)} LBC`;
      }

      if (text && at) {
        items.push({ type: `TX_${tt}`, text, at, importance: Math.min(10, 2 + Math.floor(amount / 20)), ref: { kind: 'tx', id: t.id } });
      }
    }

    const seen = new Set();
    return items
      .filter((it) => it?.text && it?.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .filter((it) => {
        const k = `${it.type}|${it.at}|${it.text}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, safeLimit);
  }

  static async getWeeklyArc({ day }) {
    const toDay = safeIsoDay(day) || todayISODate();
    const fromDay = addDaysIso(toDay, -6);

    const policyRows = await queryAll(
      `SELECT event_type, payload, created_at
       FROM events
       WHERE event_type IN ('POLICY_CHANGED','ELECTION_CLOSED')
         AND (payload ? 'day')
         AND (payload->>'day') ~ '^\\d{4}-\\d{2}-\\d{2}$'
         AND (payload->>'day')::date BETWEEN $1::date AND $2::date
       ORDER BY created_at DESC
       LIMIT 80`,
      [fromDay, toDay]
    ).catch(() => []);

    const policyChanged = (policyRows || []).filter((r) => String(r.event_type || '') === 'POLICY_CHANGED');
    const electionClosed = (policyRows || []).filter((r) => String(r.event_type || '') === 'ELECTION_CLOSED');

    const series = await queryAll(
      `SELECT gs.day::text AS day,
              COALESCE((
                SELECT SUM(amount)::bigint
                FROM transactions t
                WHERE t.tx_type = 'REVENUE'
                  AND t.memo LIKE ('%day:' || gs.day::text || '%')
              ), 0)::bigint AS revenue,
              COALESCE((
                SELECT SUM(amount)::bigint
                FROM transactions t
                WHERE t.tx_type = 'PURCHASE'
                  AND t.reference_type = 'spending'
                  AND (t.memo LIKE ('%day:' || gs.day::text || '%') OR t.created_at::date = gs.day::date)
              ), 0)::bigint AS spending
       FROM generate_series($1::date, $2::date, interval '1 day') gs(day)
       ORDER BY gs.day ASC`,
      [fromDay, toDay]
    ).catch(() => []);

    const sumRevenue = (series || []).reduce((acc, r) => acc + (Number(r.revenue ?? 0) || 0), 0);
    const sumSpending = (series || []).reduce((acc, r) => acc + (Number(r.spending ?? 0) || 0), 0);

    const foundingCount = await queryOne(
      `SELECT COALESCE(COUNT(*)::int, 0) AS n
       FROM transactions
       WHERE tx_type = 'FOUNDING'
         AND created_at::date BETWEEN $1::date AND $2::date`,
      [fromDay, toDay]
    )
      .then((r) => Number(r?.n ?? 0) || 0)
      .catch(() => 0);

    const pickMostRecent = (rows, type) => (rows || []).find((r) => String(r.event_type || '') === type) || null;
    const lastPolicy = pickMostRecent(policyRows, 'POLICY_CHANGED');
    const lastElection = pickMostRecent(policyRows, 'ELECTION_CLOSED');

    const politicsLine = (() => {
      const payload = lastPolicy?.payload && typeof lastPolicy.payload === 'object' ? lastPolicy.payload : null;
      if (payload) {
        const office = officeLabel(payload.office);
        const changes = Array.isArray(payload.changes) ? payload.changes : [];
        const parts = changes
          .map((c) => {
            const k = String(c?.key || '').trim();
            if (!k) return null;
            const oldV = formatPolicyValue(k, c?.old_value);
            const newV = formatPolicyValue(k, c?.new_value);
            return `${policyKeyLabel(k)} ${oldV}→${newV}`;
          })
          .filter(Boolean)
          .slice(0, 3);
        return parts.length > 0 ? `📜 이번 주 정책(${office}): ${parts.join(' · ')}` : `📜 이번 주 정책(${office}) 변화`;
      }

      const ep = lastElection?.payload && typeof lastElection.payload === 'object' ? lastElection.payload : null;
      if (ep) {
        const office = officeLabel(ep.office);
        const winners = Array.isArray(ep.winners) ? ep.winners : [];
        const names = winners
          .map((w) => ({ name: String(w?.name ?? '').trim(), votes: Number(w?.votes ?? 0) || 0 }))
          .filter((w) => w.name)
          .map((w) => `${w.name}(${w.votes})`)
          .slice(0, 3);
        return names.length > 0 ? `🗳️ 이번 주 선거(${office}): ${names.join(' · ')}` : `🗳️ 이번 주 선거(${office}) 종료`;
      }

      return '🗳️ 이번 주 정치는 조용했다.';
    })();

    const economyLine = (() => {
      const parts = [`💸 이번 주 경제: 소비 ${Math.max(0, Math.round(sumSpending))} LBC`, `매출 ${Math.max(0, Math.round(sumRevenue))} LBC`];
      if (foundingCount > 0) parts.push(`설립 ${foundingCount}건`);
      return parts.join(' · ');
    })();

    const nextHook = await queryOne(
      `SELECT office_code, phase, voting_day
       FROM elections
       WHERE registration_day <= $1::date
         AND phase <> 'closed'
       ORDER BY voting_day ASC
       LIMIT 1`,
      [toDay]
    )
      .then((r) => {
        if (!r) return null;
        const votingDay = safeIsoDay(r.voting_day);
        if (!votingDay) return null;
        const dday = diffDays(votingDay, toDay);
        const office = officeLabel(r.office_code);
        const ddayText = dday === 0 ? 'D-day' : dday > 0 ? `D-${dday}` : null;
        return ddayText ? `다음 쟁점: ${office} 선거 투표 ${ddayText}` : null;
      })
      .catch(() => null);

    const hook =
      nextHook ||
      (policyChanged.length > 0
        ? '다음 쟁점: 새 정책의 파장이 어디까지 갈까?'
        : sumSpending > sumRevenue
          ? '다음 쟁점: 지갑이 얇아지는 속도가 빨라…'
          : '다음 쟁점: 다음 화는 어디서 터질까?');

    const recentChanges = policyChanged
      .map((r) => {
        const payload = r.payload && typeof r.payload === 'object' ? r.payload : null;
        if (!payload) return null;
        const office = officeLabel(payload.office);
        const changes = Array.isArray(payload.changes) ? payload.changes : [];
        const parts = changes
          .map((c) => {
            const k = String(c?.key || '').trim();
            if (!k) return null;
            const oldV = formatPolicyValue(k, c?.old_value);
            const newV = formatPolicyValue(k, c?.new_value);
            return { key: k, label: policyKeyLabel(k), old: oldV, new: newV };
          })
          .filter(Boolean);
        return {
          day: safeIsoDay(payload.day) || null,
          office,
          changes: parts,
          at: r.created_at
        };
      })
      .filter(Boolean)
      .slice(0, 10);

    return {
      fromDay,
      toDay,
      lines: [politicsLine, economyLine].filter(Boolean),
      nextHook: hook,
      meta: {
        policy_changed_count: policyChanged.length,
        election_closed_count: electionClosed.length,
        revenue_sum: Math.max(0, Math.round(sumRevenue)),
        spending_sum: Math.max(0, Math.round(sumSpending)),
        founding_count: foundingCount
      },
      recentChanges,
      economySeries: (series || []).map((r) => ({
        day: safeIsoDay(r.day) || String(r.day || ''),
        revenue: Number(r.revenue ?? 0) || 0,
        spending: Number(r.spending ?? 0) || 0
      }))
    };
  }

  static async getBundle({ day = null, includeOpenRumors = true, ensureEpisode = true, viewerAgentId = null } = {}) {
    const systemDay = todayISODate();
    const d = safeIsoDay(day) || (await WorldDayService.getCurrentDay({ fallbackDay: systemDay }));

    // Make sure the world has content today (idempotent).
    // Dev endpoints may set ensureEpisode=false to avoid creating extra episodes implicitly.
    const episode = ensureEpisode ? await ShowrunnerService.ensureDailyEpisode({ day: d }).catch(() => null) : null;
    const civicLine = await ElectionService.tickDay({ day: d })
      .then((r) => r?.civicLine ?? null)
      .catch(() => null);

    // Arena: create matches once per day (idempotent) so "today" feels alive.
    const arena = await transaction(async (client) => {
      // Always tick: resolves expired live matches + creates missing slots (idempotent).
      await ArenaService.tickDayWithClient(client, { day: d, matchesPerDay: 3 }).catch(() => null);
      const today = await ArenaService.listTodayWithClient(client, { day: d, limit: 3 }).catch(() => null);
      return today && typeof today === 'object' ? { day: today.day, matches: today.matches || [] } : { day: d, matches: [] };
    }).catch(() => ({ day: d, matches: [] }));
    const worldDaily = await WorldContextService.getWorldDailySummary(d);

    const worldConcept = await transaction(async (client) => {
      return WorldConceptService.getCurrentConcept(client, { day: d });
    }).catch(() => null);

    // Phase 1.1: "오늘의 떡밥" (tease->reveal). Keep idempotent.
    const todayHook = await transaction(async (client) => {
      const { world } = await NpcSeedService.ensureSeeded();
      if (!world?.id) return null;
      return TodayHookService.ensureTodayHookWithClient(client, { worldId: world.id, day: d, now: new Date() }).catch(() => null);
    }).catch(() => null);

    const myDirection =
      viewerAgentId && typeof viewerAgentId === 'string'
        ? await queryAll(
          `SELECT key, value, updated_at
           FROM facts
           WHERE agent_id = $1 AND kind = 'direction' AND key IN ('latest','last_applied')
           LIMIT 2`,
          [viewerAgentId]
        )
          .then((rows) => {
            const list = Array.isArray(rows) ? rows : [];
            const latestRow = list.find((r) => String(r?.key ?? '') === 'latest') || null;
            const appliedRow = list.find((r) => String(r?.key ?? '') === 'last_applied') || null;
            const latest = normalizeDirectionLatest(latestRow);
            const lastApplied = normalizeDirectionLastApplied(appliedRow);
            if (!latest) return null;

            const latestAtMs = parseDateMs(latest.created_at) ?? (latestRow?.updated_at ? parseDateMs(latestRow.updated_at) : null) ?? Date.now();
            const appliedAtMs = lastApplied ? parseDateMs(lastApplied.applied_at) ?? (appliedRow?.updated_at ? parseDateMs(appliedRow.updated_at) : null) : null;
            const expiresMs = latest.expires_at ? parseDateMs(latest.expires_at) : null;

            let status = 'queued';
            if (expiresMs !== null && expiresMs <= Date.now()) status = 'expired';
            else if (appliedAtMs !== null && appliedAtMs >= latestAtMs) status = 'applied';

            return { status, latest, lastApplied };
          })
          .catch(() => null)
        : null;

    const research = await queryOne(
      `SELECT title, stage
       FROM research_projects
       WHERE status IN ('recruiting','in_progress')
       ORDER BY created_at DESC
       LIMIT 1`,
      []
    )
      .then((r) => (r ? { title: String(r.title ?? '').trim(), stage: String(r.stage ?? '').trim() } : null))
      .catch(() => null);

    const society = await queryOne(
      `SELECT id, name
       FROM secret_societies
       WHERE status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      []
    )
      .then(async (r) => {
        if (!r) return null;
        const mc = await queryOne(
          `SELECT COUNT(*)::int AS member_count
           FROM secret_society_members
           WHERE society_id = $1 AND status = 'active'`,
          [r.id]
        ).catch(() => null);
        return { name: String(r.name ?? '').trim(), memberCount: Number(mc?.member_count ?? 0) || 0 };
      })
      .catch(() => null);

    const economy = await queryOne(
      `SELECT COUNT(*)::int AS company_count,
              COALESCE(SUM(balance), 0)::int AS total_balance
       FROM companies
       WHERE status = 'active'`,
      []
    )
      .then(async (r) => {
        if (!r) return null;
        const rev = await queryOne(
          `SELECT COALESCE(SUM(amount), 0)::int AS today_revenue
           FROM transactions
           WHERE tx_type = 'REVENUE'
             AND memo LIKE $1`,
          [`%day:${d}%`]
        ).catch(() => null);
        const spend = await queryOne(
          `SELECT COALESCE(SUM(amount), 0)::int AS today_spending
           FROM transactions
           WHERE tx_type = 'PURCHASE'
             AND reference_type = 'spending'
             AND (memo LIKE $1 OR created_at::date = $2::date)`,
          [`%day:${d}%`, d]
        ).catch(() => null);
        const recentTransactions = await WorldContextService.getRecentTransactions({ day: d, limit: 10 }).catch(() => []);
        return {
          companyCount: Number(r.company_count ?? 0) || 0,
          totalBalance: Number(r.total_balance ?? 0) || 0,
          todayRevenue: Number(rev?.today_revenue ?? 0) || 0,
          todaySpending: Number(spend?.today_spending ?? 0) || 0,
          recentTransactions
        };
      })
      .catch(() => null);

    const [policySnapshot, liveTicker, weeklyArc] = await Promise.all([
      WorldContextService.getPolicySnapshot({ day: d }).catch(() => null),
      WorldContextService.getLiveTicker({ limit: 30 }).catch(() => []),
      WorldContextService.getWeeklyArc({ day: d }).catch(() => null)
    ]);

    const worldSummary = worldDaily?.summary && typeof worldDaily.summary === 'object' ? worldDaily.summary : null;

    const politicsLineRaw = safeText(worldSummary?.civicLine, 220) || safeText(civicLine, 220);
    let politicsLine = politicsLineRaw || null;
    if (!politicsLine) {
      const holders = Array.isArray(policySnapshot?.holders) ? policySnapshot.holders : [];
      const names = holders
        .map((h) => safeText(h?.holder_name ?? h?.holderName ?? '', 40))
        .filter(Boolean)
        .slice(0, 3);
      politicsLine = names.length ? `🗳️ 정치: 공직자 ${names.join(', ')}` : '🗳️ 정치: 오늘은 조용해요';
    }

    const economyLineRaw =
      safeText(worldSummary?.economyLine, 220) ||
      (economy
        ? `💰 경제: 소비 ${Number(economy.todaySpending ?? 0) || 0} LBC · 매출 ${Number(economy.todayRevenue ?? 0) || 0} LBC · 회사 ${Number(economy.companyCount ?? 0) || 0}개`
        : '');
    const economyLine = safeText(economyLineRaw, 220) || '💰 경제: 아직 집계 중';

    let highlightLine =
      safeText(worldSummary?.researchLine, 220) ||
      safeText(worldSummary?.societyRumor, 220) ||
      safeText(weeklyArc?.nextHook, 220) ||
      '';
    if (!highlightLine) {
      const matches = Array.isArray(arena?.matches) ? arena.matches : [];
      const headline = safeText(matches?.[0]?.headline ?? matches?.[0]?.meta?.headline ?? '', 120);
      if (headline) highlightLine = `🏟️ 아레나: ${headline}`;
      else if (matches.length) highlightLine = `🏟️ 아레나: 오늘 경기 ${matches.length}개`;
    }
    if (!highlightLine) {
      const items = Array.isArray(liveTicker) ? liveTicker : [];
      const top = items[0] && typeof items[0] === 'object' ? items[0] : null;
      const text = safeText(top?.text, 160);
      if (text) highlightLine = `🟢 LIVE: ${text}`;
    }
    if (!highlightLine) {
      highlightLine = '📰 오늘은 조용해요';
    }

    const newsSignals = [
      { kind: 'politics', text: politicsLine },
      { kind: 'economy', text: economyLine },
      { kind: 'highlight', text: highlightLine }
    ];

    // Rumor/Evidence board is intentionally disabled for a simpler MVP.
    // Keep the field for backward compatibility, but return empty.
    void includeOpenRumors;
    const openRumors = [];

    return {
      day: d,
      episode,
      worldDaily,
      worldConcept,
      todayHook,
      myDirection,
      civicLine,
      newsSignals,
      openRumors,
      research,
      society,
      economy,
      arena,
      policySnapshot,
      liveTicker,
      weeklyArc
    };
  }

  /**
   * Compact world bundle intended for brain job inputs (small token budget).
   */
  static async getCompactBundle({ day = null, openRumorLimit = 2, ensureEpisode = true } = {}) {
    const systemDay = todayISODate();
    const d = safeIsoDay(day) || (await WorldDayService.getCurrentDay({ fallbackDay: systemDay }));

    if (ensureEpisode) {
      await ShowrunnerService.ensureDailyEpisode({ day: d }).catch(() => null);
    }

    const worldDaily = await WorldContextService.getWorldDailySummary(d);
    const civicLine = await ElectionService.getCivicLine(d).catch(() => null);

    const summary = worldDaily?.summary && typeof worldDaily.summary === 'object' ? worldDaily.summary : null;
    const conceptFromSummary =
      summary && (summary?.theme || summary?.atmosphere)
        ? { theme: summary?.theme ?? null, atmosphere: summary?.atmosphere ?? null }
        : null;
    const worldConcept =
      conceptFromSummary ||
      (await transaction(async (client) => {
        return WorldConceptService.getCurrentConcept(client, { day: d });
      }).catch(() => null));

    const safeLimit = Math.max(0, Math.min(5, Number(openRumorLimit) || 0));
    const open_rumors = [];
    if (safeLimit > 0) {
      const claimRaw = String(summary?.cliffhanger ?? summary?.hook ?? '').trim();
      const claim = claimRaw.slice(0, 240);
      if (claim) open_rumors.push({ claim, source: 'world_daily' });
    }

    return {
      day: d,
      world_concept: worldConcept,
      world_daily: worldDaily?.summary ?? null,
      civic_line: civicLine,
      open_rumors: open_rumors.slice(0, safeLimit)
    };
  }

  static async getRumorDetails(rumorId) {
    void rumorId;
    return null;
  }

  static async listOpenRumors({ limit = 10 } = {}) {
    void limit;
    return [];
  }
}

module.exports = WorldContextService;
