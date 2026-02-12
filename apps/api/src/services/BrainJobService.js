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

function classifyJobErrorCode(errorText) {
  const msg = String(errorText || '').toLowerCase();
  if (!msg) return 'UNKNOWN';
  if (msg.includes('aborted')) return 'ABORTED';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'TIMEOUT';
  if (msg.includes('policy') && msg.includes('blocked')) return 'POLICY_BLOCKED';
  if (msg.includes('rate limit') || msg.includes('429')) return 'RATE_LIMITED';
  if (msg.includes('provider') || msg.includes('proxy error') || msg.includes('http ')) return 'PROVIDER_ERROR';
  if (msg.includes('brain') && msg.includes('연결')) return 'BRAIN_NOT_CONNECTED';
  return 'UNKNOWN';
}

function isRetryableErrorCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return true;
  return !new Set(['POLICY_BLOCKED', 'BRAIN_NOT_CONNECTED']).has(c);
}

function normalizeHintText(v, maxLen = 120) {
  const raw = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const clean = raw
    .replace(/^["'“”‘’\s:;-]+/, '')
    .replace(/["'“”‘’\s]+$/, '')
    // Make saved memory easier to cite in dialogue:
    // strip 3rd-person "주인은 ..." wrappers so the model can quote it naturally.
    .replace(/^(주인\s*\(?.{0,6}?\)?\s*)?(은|는|이|가)\s*/i, '')
    .replace(/^(앞으로는?|다음부터는?|부탁인데|그냥|조금|좀)\s*/i, '')
    .replace(/\s*(원함|원해요|원해|원한다)\s*$/i, '')
    .trim();
  if (!clean || clean.length < 4) return null;
  return clean.slice(0, Math.max(40, Math.trunc(Number(maxLen) || 120)));
}

function looksPersistentDirective(rawText) {
  const text = String(rawText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return false;

  const persistentRe =
    /(기억해|기억해줘|잊지\s*마|잊지\s*말|항상|반드시|꼭|절대|다음부터|앞으로|재판|법정|설전|토론|변론|말투|톤|전략|루틴|습관)/i;
  const actionRe = /(해줘|해\s*줘|지켜줘|유지해줘|하지\s*마|하지\s*말아줘)/i;
  const ephemeralRe = /(다시\s*말|한\s*문장|예시|예제로|한\s*번|한번|인용해서|답해봐|보여줘|설명해봐)/i;

  if (ephemeralRe.test(text) && !persistentRe.test(text)) return false;
  return persistentRe.test(text) || actionRe.test(text);
}

function extractCoachingHintFromText(rawText) {
  const text = String(rawText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (!looksPersistentDirective(text)) return null;

  const explicitPatterns = [
    /(?:기억해줘|기억해|잊지\s*마|잊지\s*말아줘)[:\s]*(.{2,140})/i,
    /(?:항상|반드시|꼭|절대|절대로|다음부터|앞으로)\s*(.{2,140})/i,
    /(?:법정|재판|설전|토론|변론)(?:에서|할\s*때)\s*(.{2,140})/i,
    /(.{2,140}?)(?:해줘|해\s*줘|해주라|해주세요|지켜줘|지켜\s*줘|유지해줘|유지해\s*줘|하지\s*마|하지\s*말아줘)(?:[.!?]|$)/i,
    /(?:말투|톤|전략|루틴|습관)\s*(?:은|는|을|를)?\s*(.{2,140})/i
  ];
  for (const pattern of explicitPatterns) {
    const m = text.match(pattern);
    const hint = normalizeHintText(m?.[1] ?? m?.[0] ?? null);
    if (hint) return hint;
  }

  const directiveRe =
    /(기억해|기억해줘|잊지\s*마|잊지\s*말|항상|반드시|꼭|절대|다음부터|앞으로|해줘|해\s*줘|지켜|유지해|하지\s*마|하지\s*말|연습해|준수해)/i;
  const keywordRe =
    /(법정|재판|설전|토론|변론|논리|근거|증거|판례|주장|반박|공감|침착|공격|요약|핵심|말투|톤|훈련|연습|전략|루틴|습관|기억)/i;
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

  const picked =
    sentences.find((s) => directiveRe.test(s) && keywordRe.test(s)) ||
    sentences.find((s) => directiveRe.test(s)) ||
    sentences.find((s) => keywordRe.test(s)) ||
    null;
  return normalizeHintText(picked);
}

function collectDialogueSurfaceText(result) {
  const out = [];
  const src = result && typeof result === 'object' ? result : {};
  if (Array.isArray(src.lines)) {
    for (const line of src.lines.slice(0, 20)) {
      if (typeof line === 'string') {
        const s = line.trim();
        if (s) out.push(s);
        continue;
      }
      if (line && typeof line === 'object') {
        const s = String(line.text ?? line.content ?? line.line ?? '').trim();
        if (s) out.push(s);
      }
    }
  }
  const extras = [
    src.reply,
    src.response,
    src.content,
    src.body,
    src.message,
    src.closer,
    src.highlight
  ];
  for (const x of extras) {
    const s = String(x ?? '').trim();
    if (s) out.push(s);
  }
  return out.join(' ').trim();
}

function normalizeCitationText(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/gi, '');
}

const MEMORY_CITATION_STOP_WORDS = new Set([
  '지난번에',
  '지난번',
  '이번에',
  '이번',
  '저번에',
  '저번',
  '오늘',
  '내일',
  '너가',
  '네가',
  '내가',
  '우리',
  '그리고',
  '그래서',
  '해서',
  '하면',
  '이렇게',
  '저렇게',
  '그렇게',
  '항상',
  '절대'
]);

function citationTokens(v) {
  const tokens = String(v ?? '').toLowerCase().match(/[0-9a-z가-힣]{2,}/gi) || [];
  return [...new Set(tokens)].filter((t) => !MEMORY_CITATION_STOP_WORDS.has(String(t)));
}

function citationAnchors(refNorm) {
  const src = String(refNorm || '');
  if (src.length < 10) return [];
  const chunkLen = Math.min(16, Math.max(8, Math.floor(src.length * 0.55)));
  const points = [0, Math.max(0, Math.floor((src.length - chunkLen) / 2)), Math.max(0, src.length - chunkLen)];
  const out = [];
  const seen = new Set();
  for (const p of points) {
    const s = src.slice(p, p + chunkLen);
    if (s.length < 8) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function hasApproxTokenHit(dialogueTokenList, dialogueNorm, token) {
  const t = String(token || '').trim();
  if (!t || t.length < 2) return false;
  if (t.length === 2 && /[가-힣]{2}/.test(t) && String(dialogueNorm || '').includes(t)) return true;
  if (t.length < 3) return false;
  for (const d of dialogueTokenList) {
    const dt = String(d || '').trim();
    if (!dt || dt.length < 3) continue;
    if (dt === t) return true;
    if (dt.length >= t.length && dt.startsWith(t)) return true;
    if (t.length >= dt.length + 2 && t.startsWith(dt)) return true;
  }
  return false;
}

function dialogueCitesMemoryRefs(result, memoryRefs) {
  const refs = Array.isArray(memoryRefs) ? memoryRefs : [];
  if (refs.length === 0) return false;
  const dialogueText = collectDialogueSurfaceText(result);
  if (!dialogueText) return false;
  const dialogueNorm = normalizeCitationText(dialogueText);
  const dialogueTokens = new Set(citationTokens(dialogueText));
  const dialogueTokenList = [...dialogueTokens];

  for (const ref of refs) {
    const text = String(ref?.text ?? '').trim();
    if (!text || text.length < 4) continue;

    const refNorm = normalizeCitationText(text);
    if (refNorm.length >= 8) {
      if (dialogueNorm.includes(refNorm)) return true;
      const partial = refNorm.slice(0, Math.min(16, refNorm.length));
      if (partial.length >= 8 && dialogueNorm.includes(partial)) return true;
      const anchors = citationAnchors(refNorm);
      for (const a of anchors) {
        if (dialogueNorm.includes(a)) return true;
      }
    }

    const refTokens = citationTokens(text);
    if (refTokens.length === 0) continue;
    let hits = 0;
    for (const token of refTokens) {
      const matched = dialogueTokens.has(token) || hasApproxTokenHit(dialogueTokenList, dialogueNorm, token);
      if (!matched) continue;
      hits += 1;
      if (refTokens.length >= 3 && hits >= 2) return true;
      if (refTokens.length <= 2 && token.length >= 5) return true;
      if (refTokens.length <= 2 && hits >= 2) return true;
    }
  }

  return false;
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
        `SELECT id, job_type, input, status, retry_count, retryable, last_error_code, last_error_at,
                lease_expires_at, leased_at, finished_at, result, error, created_at, updated_at
         FROM brain_jobs
         WHERE id = $1 AND agent_id = $2`,
        [jobId, agentId]
      );

      return rows[0] || null;
    });
  }

  static async listJobsForAgent(agentId, { status = null, jobType = null, limit = 30 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 30)));
    const rawStatus = String(status || '').trim().toLowerCase();
    const safeStatus = rawStatus && ['pending', 'leased', 'done', 'failed'].includes(rawStatus) ? rawStatus : null;
    const safeJobType = String(jobType || '').trim().toUpperCase() || null;

    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, agent_id, job_type, status, retry_count, retryable, last_error_code, last_error_at,
                error, created_at, updated_at, finished_at
         FROM brain_jobs
         WHERE agent_id = $1
           AND ($2::text IS NULL OR status = $2::text)
           AND ($3::text IS NULL OR job_type = $3::text)
         ORDER BY created_at DESC
         LIMIT $4`,
        [agentId, safeStatus, safeJobType, safeLimit]
      );

      return rows || [];
    });
  }

  static async retryJobForAgent(agentId, jobId) {
    return transaction(async (client) => {
      const { rows: foundRows } = await client.query(
        `SELECT id, agent_id, job_type, status, retry_count, retryable, last_error_code, error
         FROM brain_jobs
         WHERE id = $1 AND agent_id = $2
         FOR UPDATE`,
        [jobId, agentId]
      );

      const found = foundRows[0];
      if (!found) throw new NotFoundError('BrainJob');
      if (String(found.status || '') === 'done') {
        throw new BadRequestError('완료된 작업은 재시도할 수 없어요', 'BRAIN_JOB_DONE');
      }
      if (found.retryable === false) {
        throw new BadRequestError('자동 재시도가 허용되지 않는 작업이에요', 'BRAIN_JOB_NOT_RETRYABLE');
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE brain_jobs
         SET status = 'pending',
             retry_count = COALESCE(retry_count, 0) + 1,
             lease_expires_at = NULL,
             leased_at = NULL,
             finished_at = NULL,
             result = NULL,
             error = NULL,
             last_error_code = NULL,
             last_error_at = NULL,
             updated_at = NOW()
         WHERE id = $1 AND agent_id = $2
         RETURNING id, agent_id, job_type, status, retry_count, retryable, last_error_code, last_error_at, created_at, updated_at`,
        [jobId, agentId]
      );

      return updatedRows[0] || null;
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
      const errorText = error ? String(error).slice(0, 2000) : null;
      const errorCode = status === 'failed' ? classifyJobErrorCode(errorText) : null;
      const retryable = status === 'failed' ? isRetryableErrorCode(errorCode) : true;

      const { rows: updatedRows } = await client.query(
        `UPDATE brain_jobs
         SET status = $3::text,
             result = $4::jsonb,
             error = $5,
             last_error_code = $6,
             last_error_at = CASE WHEN $3::text = 'failed' THEN NOW() ELSE NULL END,
             retryable = $7,
             lease_expires_at = NULL,
             finished_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND agent_id = $2
         RETURNING id, job_type, status, retry_count, retryable, last_error_code, finished_at, updated_at`,
        [jobId, agentId, status, resultJson, errorText, errorCode, retryable]
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
      const memoryRefs = Array.isArray(job?.input?.memory_refs)
        ? job.input.memory_refs.slice(0, 10).map((r) => ({
          kind: String(r?.kind ?? '').slice(0, 32),
          key: String(r?.key ?? '').slice(0, 64),
          text: String(r?.text ?? '').slice(0, 220),
          confidence: Number.isFinite(Number(r?.confidence)) ? Number(r.confidence) : 1.0
        }))
        : [];
      const memoryCited = dialogueCitesMemoryRefs(result, memoryRefs);
      const llmMemoryHint =
        typeof result?.memory_hint === 'string'
          ? normalizeHintText(String(result.memory_hint).trim().slice(0, 300), 140)
          : null;
      const fallbackHint = llmMemoryHint
        ? null
        : (() => {
          const linesText = Array.isArray(result?.lines) ? result.lines.map((l) => String(l || '')).join(' ') : '';
          return extractCoachingHintFromText(userMessage) || extractCoachingHintFromText(linesText);
        })();
      const memoryHintExtracted = Boolean(llmMemoryHint || fallbackHint);
      const payload = {
        job_id: job.id,
        user_message: userMessage,
        dialogue: result,
        memory_refs: memoryRefs,
        memory_score: Number.isFinite(Number(job?.input?.memory_score))
          ? Number(job.input.memory_score)
          : null,
        coach_effect: typeof result?.coach_effect === 'string'
          ? String(result.coach_effect).slice(0, 24)
          : (
            Array.isArray(job?.input?.memory_refs) &&
            job.input.memory_refs.some((r) => ['coaching', 'direction'].includes(String(r?.kind ?? '').trim()))
              ? 'applied'
              : 'none'
          ),
        prompt_profile:
          job?.input?.prompt_profile && typeof job.input.prompt_profile === 'object'
            ? {
              enabled: Boolean(job.input.prompt_profile.enabled),
              version: Math.max(0, Math.trunc(Number(job.input.prompt_profile.version ?? 0) || 0))
            }
            : { enabled: false, version: 0 }
      };

      const knownHints = new Set();
      let hintSeq = 0;
      const persistCoachingHint = async ({ hint, source, confidence = 1.3, keyPrefix = 'hint' }) => {
        const text = normalizeHintText(hint, 140);
        if (!text) return false;
        const dedupeKey = text.toLowerCase();
        if (knownHints.has(dedupeKey)) return false;
        knownHints.add(dedupeKey);

        // Cross-job dedupe: avoid spamming identical coaching facts (keeps "기억했어요!" meaningful).
        const already = await client
          .query(
            `SELECT 1
             FROM facts
             WHERE agent_id = $1
               AND kind = 'coaching'
               AND LOWER(COALESCE(value->>'text','')) = LOWER($2)
             LIMIT 1`,
            [job.agent_id, text]
          )
          .then((r) => Boolean(r.rows?.[0]))
          .catch(() => false);
        if (already) return false;

        hintSeq += 1;
        const key = `${String(keyPrefix || 'hint').slice(0, 16)}_${Date.now()}_${hintSeq}`;
        const value = JSON.stringify({ text, source, created: new Date().toISOString() });
        return bestEffortInTransaction(
          client,
          async () => {
            await client.query(
              `INSERT INTO facts (agent_id, kind, key, value, confidence)
               VALUES ($1, 'coaching', $2, $3::jsonb, $4)
               ON CONFLICT (agent_id, kind, key)
               DO UPDATE SET value = $3::jsonb, confidence = LEAST(facts.confidence + 0.2, 2.0), updated_at = NOW()`,
              [job.agent_id, key.slice(0, 64), value, Number(confidence) || 1.3]
            );
            return true;
          },
          { label: 'brain_job_dialogue_hint', fallback: () => false }
        );
      };

      let memorySaved = false;
      if (llmMemoryHint) {
        memorySaved = (await persistCoachingHint({
          hint: llmMemoryHint,
          source: 'dialogue',
          confidence: 1.5,
          keyPrefix: 'hint'
        })) || memorySaved;
      } else {
        if (fallbackHint) {
          memorySaved = (await persistCoachingHint({
            hint: fallbackHint,
            source: 'dialogue_fallback',
            confidence: 1.4,
            keyPrefix: 'hintfb'
          })) || memorySaved;
        }
      }

      if (memorySaved) payload.memory_saved = true;
      if (memoryCited) payload.memory_cited = true;
      if (memoryHintExtracted) payload.memory_hint_extracted = true;

      // Persist personality_hint as a profile fact for personality formation
      const personalityHint =
        typeof result?.personality_hint === 'string'
          ? String(result.personality_hint).trim().slice(0, 200)
          : null;
      if (personalityHint && personalityHint.length >= 4) {
        await bestEffortInTransaction(
          client,
          async () => {
            await client.query(
              `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
               VALUES ($1, 'profile', 'personality_observation', $2::jsonb, 0.5, NOW())
               ON CONFLICT (agent_id, kind, key)
               DO UPDATE SET value = EXCLUDED.value, confidence = LEAST(facts.confidence + 0.1, 2.0), updated_at = NOW()`,
              [job.agent_id, JSON.stringify({ text: personalityHint, source: 'dialogue', created: new Date().toISOString() })]
            );
          },
          { label: 'brain_job_dialogue_personality_hint' }
        );
        payload.personality_hint_saved = true;
      }

      await bestEffortInTransaction(
        client,
        async () => client.query(
          `INSERT INTO events (agent_id, event_type, payload, salience_score)
           VALUES ($1, 'DIALOGUE', $2::jsonb, 3)`,
          [job.agent_id, JSON.stringify(payload)]
        ),
        { label: 'brain_job_dialogue_event' }
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
      const recentMemories = Array.isArray(job?.input?.recent_memories)
        ? job.input.recent_memories
          .map((m) => {
            if (!m || typeof m !== 'object') return null;
            const text = String(m.text ?? '').trim().slice(0, 220);
            if (!text) return null;
            return {
              text,
              source: String(m.source ?? '').trim().slice(0, 24) || null,
              kind: String(m.kind ?? '').trim().slice(0, 32) || null,
              created_at: typeof m.created_at === 'string' ? String(m.created_at).slice(0, 40) : null
            };
          })
          .filter(Boolean)
          .slice(0, 3)
        : [];

      await client.query(
        `INSERT INTO events (agent_id, event_type, payload, salience_score)
         VALUES ($1, 'PLAZA_POST', $2::jsonb, 2)`,
        [job.agent_id, JSON.stringify({ job_id: job.id, post_id: post.id, day, submolt, title, recent_memories: recentMemories })]
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

BrainJobService.__test = {
  dialogueCitesMemoryRefs
};

module.exports = BrainJobService;
