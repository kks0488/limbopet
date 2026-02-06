/**
 * EconomyTickService
 *
 * Runs a daily economy cycle for all active companies:
 * 1. Generate revenue based on employee count
 * 2. Pay employee wages
 * 3. Update cached company balances
 *
 * Uses the existing TransactionService + transactions table as SSOT.
 */

const TransactionService = require('./TransactionService');
const SpendingTickService = require('./SpendingTickService');
const NotificationService = require('./NotificationService');

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function safeIsoDay(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function todayIsoDayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDayUTC(iso) {
  const s = safeIsoDay(iso);
  if (!s) return null;
  const [y, m, d] = s.split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function dayDiff(startDay, endDay) {
  const a = parseIsoDayUTC(startDay);
  const b = parseIsoDayUTC(endDay);
  if (!a || !b) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function hash32(s) {
  const str = String(s || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed32) {
  let a = seed32 >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (a >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeCycleState(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'boom' || s === 'recession' || s === 'normal') return s;
  return 'normal';
}

function buildCyclePayload({ state, dayStarted, severity = 1.0 }) {
  const s = normalizeCycleState(state);
  const day = safeIsoDay(dayStarted) || todayIsoDayUTC();
  const sev = Math.round(clampNum(severity, 0.5, 2.0) * 100) / 100;

  const modifiers =
    s === 'boom'
      ? {
          revenue_multiplier: 1.3,
          arena_prize_multiplier: 1.5,
          layoff_risk_bonus: 0.0,
          scandal_probability_bonus: 0.0
        }
      : s === 'recession'
        ? {
            revenue_multiplier: 0.7,
            arena_prize_multiplier: 1.0,
            layoff_risk_bonus: 0.2,
            scandal_probability_bonus: 0.1
          }
        : {
            revenue_multiplier: 1.0,
            arena_prize_multiplier: 1.0,
            layoff_risk_bonus: 0.0,
            scandal_probability_bonus: 0.0
          };

  return {
    state: s,
    day_started: day,
    severity: sev,
    ...modifiers
  };
}

function parseCycleValue(raw, fallbackDay) {
  const v = raw && typeof raw === 'object' ? raw : {};
  return buildCyclePayload({
    state: v.state,
    dayStarted: v.day_started || fallbackDay,
    severity: v.severity
  });
}

class EconomyTickService {
  static async worldAgentIdWithClient(client) {
    const row = await client
      .query(`SELECT id FROM agents WHERE name = 'world_core' LIMIT 1`)
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);
    return row?.id ?? null;
  }

  static async getCycleWithClient(client, { day = null } = {}) {
    const iso = safeIsoDay(day) || todayIsoDayUTC();
    if (!client) return buildCyclePayload({ state: 'normal', dayStarted: iso, severity: 1.0 });

    const worldId = await EconomyTickService.worldAgentIdWithClient(client);
    if (!worldId) return buildCyclePayload({ state: 'normal', dayStarted: iso, severity: 1.0 });

    const row = await client
      .query(
        `SELECT value
         FROM facts
         WHERE agent_id = $1
           AND kind = 'economy'
           AND key = 'economy:cycle'
         LIMIT 1`,
        [worldId]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    return parseCycleValue(row?.value ?? null, iso);
  }

  static async getCycleStateWithClient(client, { day = null } = {}) {
    const cycle = await EconomyTickService.getCycleWithClient(client, { day });
    return normalizeCycleState(cycle?.state);
  }

  static async notifyCycleShiftWithClient(client, { day, state, payload = {} } = {}) {
    if (!client) return 0;

    const cycleState = normalizeCycleState(state);
    if (cycleState !== 'boom' && cycleState !== 'recession') return 0;

    const { rows: users } = await client.query(
      `SELECT id
       FROM users
       ORDER BY created_at ASC
       LIMIT 5000`
    );

    const title = cycleState === 'boom' ? '호황이다! 돈이 돈다!' : '불황의 그림자가 드리운다...';
    const body =
      cycleState === 'boom'
        ? '거리에 활기가 넘쳐! 기업 수익 30% 급등, 아레나 상금도 뛰었어. 지금이 기회야!'
        : '경기가 꽁꽁 얼어붙었어... 해고 위험 증가, 한 푼이라도 아껴야 할 때야.';

    let sent = 0;
    for (const u of users || []) {
      // eslint-disable-next-line no-await-in-loop
      const created = await NotificationService.create(client, u.id, {
        type: 'ECONOMY_CYCLE',
        title,
        body,
        data: {
          day: safeIsoDay(day) || todayIsoDayUTC(),
          cycle_state: cycleState,
          ...payload
        }
      }).catch(() => null);
      if (created) sent += 1;
    }
    return sent;
  }

  static async updateEconomyCycleWithClient(client, { day } = {}) {
    const iso = safeIsoDay(day) || todayIsoDayUTC();
    if (!client) {
      return {
        cycle: buildCyclePayload({ state: 'normal', dayStarted: iso, severity: 1.0 }),
        changed: false,
        previous: null,
        day: iso
      };
    }

    const worldId = await EconomyTickService.worldAgentIdWithClient(client);
    if (!worldId) {
      return {
        cycle: buildCyclePayload({ state: 'normal', dayStarted: iso, severity: 1.0 }),
        changed: false,
        previous: null,
        day: iso
      };
    }

    const existing = await client
      .query(
        `SELECT value
         FROM facts
         WHERE agent_id = $1
           AND kind = 'economy'
           AND key = 'economy:cycle'
         FOR UPDATE`,
        [worldId]
      )
      .then((r) => r.rows?.[0] ?? null)
      .catch(() => null);

    const previous = parseCycleValue(existing?.value ?? null, iso);
    let next = previous;
    let changed = false;

    const elapsed = Math.max(0, dayDiff(previous.day_started, iso));
    if (!existing) {
      next = buildCyclePayload({ state: 'normal', dayStarted: iso, severity: 1.0 });
      changed = false;
    } else if (elapsed >= 14) {
      const rng = mulberry32(hash32(`${iso}:${previous.day_started}:${previous.state}:ECONOMY_CYCLE`));
      const roll = rng();
      const severityRoll = rng();

      const nextState = roll < 0.3 ? 'boom' : roll < 0.6 ? 'recession' : 'normal';
      const nextSeverity = nextState === 'normal' ? 1.0 : 0.9 + severityRoll * 0.6;
      next = buildCyclePayload({ state: nextState, dayStarted: iso, severity: nextSeverity });
      changed = Boolean(existing) && previous.state !== next.state;
    }

    await client.query(
      `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
       VALUES ($1, 'economy', 'economy:cycle', $2::jsonb, 1.0, NOW())
       ON CONFLICT (agent_id, kind, key)
       DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
      [worldId, JSON.stringify(next)]
    );

    if (changed) {
      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'ECONOMY_CYCLE_CHANGED', $2::jsonb, 6)`,
        [
          worldId,
          JSON.stringify({
            day: iso,
            previous_state: previous.state,
            next_state: next.state,
            cycle: next
          })
        ]
      ).catch(() => null);

      await EconomyTickService.notifyCycleShiftWithClient(client, {
        day: iso,
        state: next.state,
        payload: {
          previous_state: previous.state,
          severity: next.severity
        }
      }).catch(() => null);
    }

    return { cycle: next, changed, previous, day: iso };
  }

  /**
   * Run one economy tick inside an existing transaction client.
   *
   * @param {import('pg').PoolClient} client
   * @param {{ day?: string }} options
   */
  static async tickWithClient(client, { day = null } = {}) {
    const iso = safeIsoDay(day) || todayIsoDayUTC();

    const cycleResult = await EconomyTickService.updateEconomyCycleWithClient(client, { day: iso }).catch(() => ({
      cycle: buildCyclePayload({ state: 'normal', dayStarted: iso, severity: 1.0 }),
      changed: false,
      previous: null,
      day: iso
    }));
    const cycle = cycleResult?.cycle || buildCyclePayload({ state: 'normal', dayStarted: iso, severity: 1.0 });

    // Skip if already ticked today (idempotent).
    const { rows: alreadyDone } = await client.query(
      `SELECT id FROM transactions
       WHERE tx_type = 'REVENUE'
         AND memo LIKE $1
       LIMIT 1`,
      [`%day:${iso}%`]
    );
    if (alreadyDone.length > 0) {
      return { skipped: true, day: iso, cycle };
    }

    // 1. All active companies with their wallet and employee count
    const { rows: companies } = await client.query(
      `SELECT c.id, c.name, c.wallet_agent_id,
              (SELECT COUNT(*)::int FROM company_employees e
               WHERE e.company_id = c.id AND e.status = 'active') AS emp_count
       FROM companies c
       WHERE c.status = 'active'
         AND c.wallet_agent_id IS NOT NULL`
    );

    const cycleMultiplier = Math.max(0.1, Math.min(3.0, Number(cycle.revenue_multiplier ?? 1.0) || 1.0));

    let totalRevenue = 0;
    let totalSalary = 0;
    let spending = null;

    for (const co of companies) {
      const empCount = Math.max(1, co.emp_count || 1);

      // 2. Pay wages to each employee (also used to size revenue)
      const { rows: employees } = await client.query(
        `SELECT e.agent_id, e.wage, e.role
         FROM company_employees e
         WHERE e.company_id = $1 AND e.status = 'active'`,
        [co.id]
      );

      const totalWageThisCompany = (employees || []).reduce((acc, emp) => {
        const wage = Math.max(0, Number(emp.wage) || 0);
        return acc + wage;
      }, 0);

      // 3. Revenue (mint): keep it roughly proportional to payroll so the total supply doesn't explode.
      // Revenue = payroll * margin (1.05..1.50), or a small baseline if payroll is 0.
      const marginPct = randomInt(105, 150);
      const baseline = empCount * randomInt(2, 6);
      const baseRevenue =
        totalWageThisCompany > 0 ? Math.max(baseline, Math.ceil((totalWageThisCompany * marginPct) / 100)) : baseline;
      const revenue = Math.max(0, Math.ceil(baseRevenue * cycleMultiplier));

      try {
        await TransactionService.transfer(
          {
            fromAgentId: null,
            toAgentId: co.wallet_agent_id,
            amount: revenue,
            txType: 'REVENUE',
            memo: `${co.name} daily revenue (day:${iso})`,
            referenceId: co.id,
            referenceType: 'company'
          },
          client
        );
        totalRevenue += revenue;
      } catch {
        // Skip revenue if it fails (shouldn't normally)
      }

      for (const emp of employees) {
        const wage = Math.max(0, Number(emp.wage) || 0);
        if (wage <= 0) continue;

        try {
          await TransactionService.transfer(
            {
              fromAgentId: co.wallet_agent_id,
              toAgentId: emp.agent_id,
              amount: wage,
              txType: 'SALARY',
              memo: `${co.name} salary (day:${iso})`,
              referenceId: co.id,
              referenceType: 'company'
            },
            client
          );
          totalSalary += wage;
        } catch {
          // Insufficient funds — skip this employee's salary
        }
      }
    }

    // 3.5) Ambient pet drift (daily)
    //
    // In a “living society” the economy should not depend on UI reads to keep
    // pet stats moving. Apply a small daily drift so automatic spending has
    // meaningful conditions even when nobody opens the app.
    await client.query(
      `UPDATE pet_stats ps
       SET hunger = LEAST(100, GREATEST(0, ps.hunger + (5 + FLOOR(RANDOM() * 8)))),
           energy = LEAST(100, GREATEST(0, ROUND(ps.energy + (50 - ps.energy) * 0.15 - (2 + FLOOR(RANDOM() * 5))))),
           mood = LEAST(100, GREATEST(0, ROUND(ps.mood + (50 - ps.mood) * 0.12 + (FLOOR(RANDOM() * 5) - 2)))),
           stress = LEAST(100, GREATEST(0, ROUND(ps.stress + (20 - ps.stress) * 0.10 + (FLOOR(RANDOM() * 5) - 2)))),
           curiosity = LEAST(100, GREATEST(0, ROUND(ps.curiosity + (50 - ps.curiosity) * 0.10 + (FLOOR(RANDOM() * 8) - 3)))),
           updated_at = NOW()
       FROM agents a
       WHERE a.id = ps.agent_id
         AND a.is_active = true
         AND a.name <> 'world_core'`
    );

    // 3.6) Relationship drift (daily): negative feelings fade unless reinforced.
    // Keep it tiny so continuity stays, but prevent jealousy/rivalry from getting permanently stuck at 100.
    await client.query(
      `UPDATE relationships
       SET jealousy = CASE
             WHEN jealousy >= 60 THEN GREATEST(0, jealousy - 3)
             WHEN jealousy >= 40 THEN jealousy - 2
             WHEN jealousy >= 25 THEN jealousy - 1
             ELSE jealousy
           END,
           rivalry = CASE
             WHEN rivalry >= 60 THEN GREATEST(0, rivalry - 3)
             WHEN rivalry >= 40 THEN rivalry - 2
             WHEN rivalry >= 25 THEN rivalry - 1
             ELSE rivalry
           END
       WHERE jealousy >= 25 OR rivalry >= 25`
    );

    // 4. Pet spending tick (after salaries, before cache refresh)
    spending = await SpendingTickService.tickWithClient(client, { day: iso }).catch(() => null);

    // 5. Update cached balances (safe; SSOT is transactions)
    for (const co of companies) {
      if (!co.wallet_agent_id) continue;
      // eslint-disable-next-line no-await-in-loop
      const bal = await TransactionService.getBalance(co.wallet_agent_id, client);
      // eslint-disable-next-line no-await-in-loop
      await client.query('UPDATE companies SET balance = $2, updated_at = NOW() WHERE id = $1', [co.id, bal]);
    }

    return {
      skipped: false,
      day: iso,
      cycle,
      companies: companies.length,
      totalRevenue,
      totalSalary,
      spending
    };
  }
}

module.exports = EconomyTickService;
