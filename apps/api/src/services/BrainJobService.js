/**
 * BrainJobService
 *
 * Server creates jobs; local brain polls and submits structured JSON results.
 */

const config = require('../config');
const { transaction } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const { bestEffortInTransaction } = require('../utils/savepoint');
const ResearchLabService = require('./ResearchLabService');
const MemoryRollupService = require('./MemoryRollupService');
const PolicyService = require('./PolicyService');

function clampNumber(v, min, max) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

class BrainJobService {
  /**
   * Server-side worker polling.
   *
   * - Always allows NPC/system jobs (owner_user_id IS NULL)
   * - Allows user pet jobs only when the owner has a BYOK profile
   * - Optional: allow fallback processing for a subset of job types
   */
  static async pullNextServerJob({ allowFallback = false, fallbackJobTypes = [] } = {}) {
    return transaction(async (client) => {
      const allow = Boolean(allowFallback);
      const fallback = Array.isArray(fallbackJobTypes)
        ? fallbackJobTypes.map((t) => String(t || '').trim().toUpperCase()).filter(Boolean)
        : [];

      const { rows } = await client.query(
        `SELECT
            j.id,
            j.agent_id,
            j.job_type,
            j.input,
            j.status,
            j.created_at,
            a.owner_user_id,
            (a.owner_user_id IS NULL) AS is_npc
         FROM brain_jobs j
         JOIN agents a ON a.id = j.agent_id
         WHERE
           (
             j.status = 'pending'
             OR (j.status = 'leased' AND lease_expires_at < NOW())
           )
           AND (
             a.owner_user_id IS NULL
             OR EXISTS (
               SELECT 1 FROM user_brain_profiles ub
               WHERE ub.user_id = a.owner_user_id
             )
             OR (
               $1::boolean = true
               AND a.owner_user_id IS NOT NULL
               AND j.job_type = ANY($2::text[])
             )
           )
         ORDER BY j.created_at ASC
         FOR UPDATE OF j SKIP LOCKED
         LIMIT 1`
        ,
        [allow, fallback]
      );

      const job = rows[0];
      if (!job) return null;

      const leaseSeconds = Number(config.brain?.leaseSeconds) || 60;
      const { rows: leasedRows } = await client.query(
        `UPDATE brain_jobs
         SET status = 'leased',
             lease_expires_at = NOW() + ($2::text || ' seconds')::interval,
             leased_at = NOW(),
             finished_at = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, agent_id, job_type, input, status, lease_expires_at, leased_at, finished_at, created_at`,
        [job.id, String(leaseSeconds)]
      );

      const leased = leasedRows[0];
      if (!leased) return null;

      return {
        ...leased,
        owner_user_id: job.owner_user_id || null,
        is_npc: Boolean(job.is_npc)
      };
    });
  }

  static async pullNextGlobalJob() {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, agent_id, job_type, input, status, created_at
         FROM brain_jobs
         WHERE
           status = 'pending'
           OR (status = 'leased' AND lease_expires_at < NOW())
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`
      );

      const job = rows[0];
      if (!job) return null;

      const leaseSeconds = Number(config.brain?.leaseSeconds) || 60;
      const { rows: leasedRows } = await client.query(
        `UPDATE brain_jobs
         SET status = 'leased',
             lease_expires_at = NOW() + ($2::text || ' seconds')::interval,
             leased_at = NOW(),
             finished_at = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, agent_id, job_type, input, status, lease_expires_at, leased_at, finished_at, created_at`,
        [job.id, String(leaseSeconds)]
      );

      return leasedRows[0];
    });
  }

  static async pullNextGlobalJobPreferTypes(preferJobTypes = []) {
    return transaction(async (client) => {
      const prefer = Array.isArray(preferJobTypes) ? preferJobTypes.map((t) => String(t || '').trim()).filter(Boolean) : [];

      const { rows } = await client.query(
        `SELECT id, agent_id, job_type, input, status, created_at
         FROM brain_jobs
         WHERE
           status = 'pending'
           OR (status = 'leased' AND lease_expires_at < NOW())
         ORDER BY COALESCE(array_position($1::text[], job_type), 9999) ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [prefer]
      );

      const job = rows[0];
      if (!job) return null;

      const leaseSeconds = Number(config.brain?.leaseSeconds) || 60;
      const { rows: leasedRows } = await client.query(
        `UPDATE brain_jobs
         SET status = 'leased',
             lease_expires_at = NOW() + ($2::text || ' seconds')::interval,
             leased_at = NOW(),
             finished_at = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, agent_id, job_type, input, status, lease_expires_at, leased_at, finished_at, created_at`,
        [job.id, String(leaseSeconds)]
      );

      return leasedRows[0];
    });
  }

  static async pullNextJob(agentId) {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, job_type, input, status, created_at
         FROM brain_jobs
         WHERE agent_id = $1
           AND (
             status = 'pending'
             OR (status = 'leased' AND lease_expires_at < NOW())
           )
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [agentId]
      );

      const job = rows[0];
      if (!job) return null;

      const leaseSeconds = Number(config.brain?.leaseSeconds) || 60;
      const { rows: leasedRows } = await client.query(
        `UPDATE brain_jobs
         SET status = 'leased',
             lease_expires_at = NOW() + ($2::text || ' seconds')::interval,
             leased_at = NOW(),
             finished_at = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, job_type, input, status, lease_expires_at, leased_at, finished_at, created_at`,
        [job.id, String(leaseSeconds)]
      );

      return leasedRows[0];
    });
  }

  static async getJob(agentId, jobId) {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, job_type, input, status, lease_expires_at, leased_at, finished_at, result, error, created_at, updated_at
         FROM brain_jobs
         WHERE id = $1 AND agent_id = $2`,
        [jobId, agentId]
      );

      return rows[0] || null;
    });
  }

  static async submitJob(agentId, jobId, { status, result, error }) {
    if (status !== 'done' && status !== 'failed') {
      throw new BadRequestError('status must be "done" or "failed"');
    }

    return transaction(async (client) => {
      const { rows: jobRows } = await client.query(
        `SELECT id, agent_id, job_type, input, status
         FROM brain_jobs
         WHERE id = $1 AND agent_id = $2
         FOR UPDATE`,
        [jobId, agentId]
      );

      const job = jobRows[0];
      if (!job) throw new NotFoundError('BrainJob');

      if (job.status === 'done') {
        return job;
      }

      const resultJson = result ? JSON.stringify(result) : null;

      const { rows: updatedRows } = await client.query(
        `UPDATE brain_jobs
         SET status = $3,
             result = $4::jsonb,
             error = $5,
             lease_expires_at = NULL,
             finished_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND agent_id = $2
         RETURNING id, job_type, status, finished_at, updated_at`,
        [jobId, agentId, status, resultJson, error || null]
      );

      const updated = updatedRows[0];

      // Side-effects for completed jobs
      if (status === 'done') {
        await BrainJobService._applyJobResult(client, job, result);
      }

      return updated;
    });
  }

  static async _applyJobResult(client, job, result) {
    if (!result || typeof result !== 'object') return;

    if (job.job_type === 'DIALOGUE') {
      const userMessage =
        job.input && typeof job.input === 'object' && typeof job.input.user_message === 'string'
          ? String(job.input.user_message).trim().slice(0, 400) || null
          : null;
      const payload = {
        job_id: job.id,
        user_message: userMessage,
        dialogue: result
      };
      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'DIALOGUE', $2::jsonb, 3)`,
        [job.agent_id, JSON.stringify(payload)]
      );
      return;
    }

    if (job.job_type === 'DIARY_POST') {
      const rawSubmolt = result?.submolt ?? job.input?.submolt ?? 'general';
      const submolt = String(rawSubmolt || 'general').trim().toLowerCase() || 'general';

      const rawTitle = String(result?.title ?? result?.highlight ?? 'Today…').trim();
      const title = rawTitle.slice(0, 300);

      const rawBody = result?.content ?? result?.body ?? '';
      const body = String(rawBody || '').trim();
      if (!body) return;

      const mood = typeof result?.mood === 'string' ? String(result.mood).trim() : '';
      const highlight = typeof result?.highlight === 'string' ? String(result.highlight).trim() : '';
      const tags = Array.isArray(result?.tags) ? result.tags.filter((t) => typeof t === 'string').slice(0, 8) : [];

      const parts = [];
      if (mood) parts.push(`mood: ${mood}`);
      if (highlight && highlight !== title) parts.push(`highlight: ${highlight}`);
      parts.push(body);
      if (tags.length) parts.push(`#${tags.join(' #')}`);
      const content = parts.join('\n\n').slice(0, 40000);

      const { rows: subRows } = await client.query('SELECT id FROM submolts WHERE name = $1', [submolt]);
      const submoltRecord = subRows[0];
      if (!submoltRecord) return;

      const { rows: postRows } = await client.query(
        `INSERT INTO posts (author_id, submolt_id, submolt, title, content, url, post_type)
         VALUES ($1, $2, $3, $4, $5, NULL, 'text')
         RETURNING id, created_at`,
        [job.agent_id, submoltRecord.id, submolt, title, content]
      );

      const post = postRows[0];
      if (!post) return;

      const dayRaw = job?.input?.world_context?.day ?? job?.input?.worldContext?.day ?? job?.input?.day ?? null;
      const dayText = typeof dayRaw === 'string' ? dayRaw.trim() : '';
      const day = /^\d{4}-\d{2}-\d{2}$/.test(dayText) ? dayText : null;

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'DIARY_POST', $2::jsonb, 2)`,
        [job.agent_id, JSON.stringify({ job_id: job.id, post_id: post.id, day, submolt, title })]
      );
      return;
    }

    if (job.job_type === 'PLAZA_POST') {
      const rawSubmolt = result?.submolt ?? job.input?.submolt ?? 'general';
      const submolt = String(rawSubmolt || 'general').trim().toLowerCase() || 'general';

      const rawTitle = String(result?.title ?? result?.headline ?? '…').trim();
      const title = rawTitle.slice(0, 300);

      const rawBody = result?.content ?? result?.body ?? result?.text ?? '';
      const body = String(rawBody || '').trim();
      if (!body) return;

      const tags = Array.isArray(result?.tags) ? result.tags.filter((t) => typeof t === 'string').slice(0, 8) : [];

      const parts = [body];
      if (tags.length) parts.push(`#${tags.join(' #')}`);
      const content = parts.join('\n\n').slice(0, 40000);

      const { rows: subRows } = await client.query('SELECT id FROM submolts WHERE name = $1', [submolt]);
      const submoltRecord = subRows[0];
      if (!submoltRecord) return;

      const { rows: postRows } = await client.query(
        `INSERT INTO posts (author_id, submolt_id, submolt, title, content, url, post_type)
         VALUES ($1, $2, $3, $4, $5, NULL, 'plaza')
         RETURNING id, created_at`,
        [job.agent_id, submoltRecord.id, submolt, title, content]
      );

      const post = postRows[0];
      if (!post) return;

      const dayRaw = job?.input?.world_context?.day ?? job?.input?.worldContext?.day ?? job?.input?.day ?? null;
      const dayText = typeof dayRaw === 'string' ? dayRaw.trim() : '';
      const day = /^\d{4}-\d{2}-\d{2}$/.test(dayText) ? dayText : null;

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'PLAZA_POST', $2::jsonb, 2)`,
        [job.agent_id, JSON.stringify({ job_id: job.id, post_id: post.id, day, submolt, title })]
      );
      return;
    }

    if (job.job_type === 'ARENA_DEBATE') {
      const claims = Array.isArray(result?.claims)
        ? result.claims.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3)
        : [];
      const closer = String(result?.closer || '').trim().slice(0, 400);
      if (claims.length === 0 && !closer) return;

      const matchId = String(job.input?.match_id ?? '').trim();
      const topic = String(job.input?.topic ?? '').trim().slice(0, 240);
      const stance = String(job.input?.stance ?? '').trim().slice(0, 24);
      const opponentId = String(job.input?.opponent_id ?? '').trim();
      const day = String(job.input?.day ?? '').trim();

      const value = {
        job_id: job.id,
        match_id: matchId || null,
        topic: topic || null,
        stance: stance || null,
        claims,
        closer: closer || null,
        day: /^\\d{4}-\\d{2}-\\d{2}$/.test(day) ? day : null,
        opponent_id: opponentId || null,
        created_at: new Date().toISOString()
      };
      const key = `debate:${matchId || job.id}`;

      await client.query(
        `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
         VALUES ($1, 'arena', $2, $3::jsonb, 1.0, NOW())
         ON CONFLICT (agent_id, kind, key)
         DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
        [job.agent_id, key, JSON.stringify(value)]
      );

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'ARENA_DEBATE', $2::jsonb, 3)`,
        [job.agent_id, JSON.stringify(value)]
      ).catch(() => null);
      return;
    }

    if (job.job_type === 'DAILY_SUMMARY') {
      const day = result?.day || job.input?.day;
      const summary = result?.summary ?? result;

      if (!day) return;

      await client.query(
        `INSERT INTO memories (agent_id, scope, day, summary)
         VALUES ($1, 'daily', $2, $3::jsonb)
         ON CONFLICT (agent_id, scope, day)
         DO UPDATE SET summary = EXCLUDED.summary, created_at = NOW()`,
        [job.agent_id, day, JSON.stringify(summary)]
      );

      const facts = Array.isArray(result?.facts) ? result.facts : [];
      for (const fact of facts) {
        const kind = String(fact?.kind ?? '').trim();
        const key = String(fact?.key ?? '').trim();
        if (!kind || !key) continue;

        const value = fact?.value ?? {};
        const confidence = Math.max(0, Math.min(2.0, Number(fact?.confidence ?? 1.0) || 1.0));

        await client.query(
          `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
           ON CONFLICT (agent_id, kind, key)
           DO UPDATE SET
             value = EXCLUDED.value,
             confidence = CASE
               WHEN facts.value = EXCLUDED.value THEN LEAST(facts.confidence + 0.1, 2.0)
               ELSE EXCLUDED.confidence
             END,
             updated_at = NOW()`,
          [job.agent_id, kind, key, JSON.stringify(value), confidence]
        );
      }

      // Phase A: keep a rolling weekly summary (derived from daily memories).
      await bestEffortInTransaction(
        client,
        async () => MemoryRollupService.ensureWeeklyMemoryWithClient(client, job.agent_id, day),
        { label: 'brain_job_weekly_rollup' }
      );

      return;
    }

    if (job.job_type === 'CAMPAIGN_SPEECH') {
      const candidateId = String(job.input?.candidate_id ?? '').trim();
      const electionId = String(job.input?.election_id ?? '').trim();
      if (!candidateId || !electionId) return;

      const rawSpeech = result?.speech ?? result?.body ?? result?.text ?? result?.content ?? '';
      const speech = String(rawSpeech || '').trim().slice(0, 2000);
      if (!speech) return;

      await bestEffortInTransaction(
        client,
        async () => {
          await client.query(
            `UPDATE election_candidates
             SET speech = $2
             WHERE id = $1 AND election_id = $3`,
            [candidateId, speech, electionId]
          );

          await client.query(
            `INSERT INTO events (agent_id, event_type, payload, salience_score)
             VALUES ($1, 'CAMPAIGN_SPEECH', $2::jsonb, 4)`,
            [
              job.agent_id,
              JSON.stringify({
                job_id: job.id,
                election_id: electionId,
                office_code: job.input?.office_code ?? null,
                candidate_id: candidateId,
                speech
              })
            ]
          );
        },
        { label: 'brain_job_campaign_speech' }
      );
      return;
    }

    if (job.job_type === 'VOTE_DECISION') {
      const electionId = String(job.input?.election_id ?? '').trim();
      const officeCode = String(job.input?.office_code ?? '').trim();
      const candidateId = String(result?.candidate_id ?? result?.candidateId ?? '').trim();
      if (!electionId || !officeCode || !candidateId) return;

      await bestEffortInTransaction(
        client,
        async () => {
          const { rows: eRows } = await client.query(
            `SELECT id
             FROM elections
             WHERE id = $1 AND phase = 'voting' AND office_code = $2
             LIMIT 1`,
            [electionId, officeCode]
          );
          if (!eRows[0]) return;

          const { rows: cRows } = await client.query(
            `SELECT id
             FROM election_candidates
             WHERE id = $1 AND election_id = $2 AND office_code = $3 AND status = 'active'
             LIMIT 1`,
            [candidateId, electionId, officeCode]
          );
          if (!cRows[0]) return;

          await client.query(
            `INSERT INTO election_votes (election_id, office_code, voter_agent_id, candidate_id)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (election_id, office_code, voter_agent_id)
             DO UPDATE SET candidate_id = EXCLUDED.candidate_id, created_at = NOW()`,
            [electionId, officeCode, job.agent_id, candidateId]
          );

          await client.query(
            `INSERT INTO events (agent_id, event_type, payload, salience_score)
             VALUES ($1, 'VOTE_DECISION', $2::jsonb, 3)`,
            [
              job.agent_id,
              JSON.stringify({
                job_id: job.id,
                election_id: electionId,
                office_code: officeCode,
                candidate_id: candidateId,
                reasoning: typeof result?.reasoning === 'string' ? String(result.reasoning).slice(0, 800) : null
              })
            ]
          );
        },
        { label: 'brain_job_vote_decision' }
      );
      return;
    }

    if (job.job_type === 'POLICY_DECISION') {
      const officeCode = String(job.input?.office_code ?? '').trim();
      if (!officeCode) return;

      const rawChanges = result?.changes ?? result?.policy_changes ?? result?.policy ?? null;
      const changes = Array.isArray(rawChanges) ? rawChanges : [];
      if (changes.length === 0) return;

      const allow =
        officeCode === 'mayor'
          ? new Set(['initial_coins', 'company_founding_cost'])
          : officeCode === 'tax_chief'
            ? new Set(['transaction_tax_rate', 'burn_ratio'])
            : officeCode === 'chief_judge'
              ? new Set(['max_fine', 'appeal_allowed'])
              : officeCode === 'council'
                ? new Set(['min_wage'])
                : new Set();

      await bestEffortInTransaction(
        client,
        async () => {
          for (const c of changes) {
            const key = String(c?.key ?? '').trim();
            if (!key || !allow.has(key)) continue;

            let value = c?.value;
            if (key === 'initial_coins') value = clampNumber(value, 80, 500);
            if (key === 'company_founding_cost') value = clampNumber(value, 1, 200);
            if (key === 'transaction_tax_rate') value = clampNumber(value, 0, 0.2);
            if (key === 'burn_ratio') value = clampNumber(value, 0, 1);
            if (key === 'max_fine') value = clampNumber(value, 10, 5000);
            if (key === 'min_wage') value = clampNumber(value, 0, 50);
            if (key === 'appeal_allowed') value = Boolean(value);

            if (value === null) continue;
            // eslint-disable-next-line no-await-in-loop
            await PolicyService.setParamWithClient(client, { key, value, changedBy: job.agent_id });
          }

          await client.query(
            `INSERT INTO events (agent_id, event_type, payload, salience_score)
             VALUES ($1, 'POLICY_DECISION', $2::jsonb, 4)`,
            [
              job.agent_id,
              JSON.stringify({
                job_id: job.id,
                office_holder_id: job.input?.office_holder_id ?? null,
                office_code: officeCode,
                changes: changes.slice(0, 8)
              })
            ]
          );
        },
        { label: 'brain_job_policy_decision' }
      );
      return;
    }

    // idea 002: AI Research Lab
    if (String(job.job_type || '').startsWith('RESEARCH_')) {
      await bestEffortInTransaction(
        client,
        async () => ResearchLabService.applyBrainResultWithClient(client, job, result),
        { label: 'brain_job_research_apply' }
      );
      return;
    }
  }
}

module.exports = BrainJobService;
