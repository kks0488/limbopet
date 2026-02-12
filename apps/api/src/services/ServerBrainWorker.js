/**
 * ServerBrainWorker
 *
 * Optional: process `brain_jobs` on the server.
 *
 * Routing (BYOK-first):
 * - NPC/system jobs: via ProxyBrainService (platform proxy, optional)
 * - User pet jobs: via UserByokLlmService using the owner's stored BYOK profile
 *
 * This makes the product usable for beginners without running a local brain runner.
 *
 * Enabled when:
 * - LIMBOPET_BRAIN_BACKEND=router (or "proxy" for backward-compat)
 * - and LIMBOPET_BRAIN_WORKER=1 (or default-on in dev)
 */

const config = require('../config');
const BrainJobService = require('./BrainJobService');
const LocalBrainService = require('./LocalBrainService');
const ProxyBrainService = require('./ProxyBrainService');
const UserBrainProfileService = require('./UserBrainProfileService');
const UserByokLlmService = require('./UserByokLlmService');

const LOCAL_JOB_PRIORITY = [
  'DIALOGUE',
  'ARENA_DEBATE',
  'DAILY_SUMMARY',
  'DIARY_POST',
  'PLAZA_POST',
  'VOTE_DECISION',
  'CAMPAIGN_SPEECH',
  'POLICY_DECISION'
];

class ServerBrainWorker {
  constructor({ backend }) {
    this._backend = backend;
    this._busy = false;
    this._timer = null;
    this._stopped = false;
  }

  start() {
    if (this._timer) return;
    const pollMs = Number(config.limbopet?.brainWorkerPollMs ?? 600) || 600;
    this._timer = setInterval(() => void this._tick(), pollMs);
    void this._tick();
  }

  stop() {
    this._stopped = true;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async _tick() {
    if (this._stopped) return;
    if (this._busy) return;
    this._busy = true;

    let job = null;
    let submitFailureHandled = false;
    try {
      job =
        this._backend === 'local'
          ? await BrainJobService.pullNextGlobalJobPreferTypes(LOCAL_JOB_PRIORITY)
          : await BrainJobService.pullNextServerJob({
            allowFallback: String(config.limbopet?.brainFallback ?? '').trim().toLowerCase() === 'local',
            fallbackJobTypes: config.limbopet?.brainFallbackJobTypes ?? []
          });
      if (!job) return;

      let result = null;

      // Dev-only escape hatch (not recommended): process everything with the platform proxy.
      if (this._backend === 'local') {
        result = LocalBrainService.generate(job.job_type, job.input);
      } else if (this._backend === 'proxy_all') {
        result = await ProxyBrainService.generate(job.job_type, job.input);
      } else if (job.is_npc) {
        result = await ProxyBrainService.generate(job.job_type, job.input);
      } else {
        const ownerUserId = job.owner_user_id;
        if (!ownerUserId) throw new Error('Owner user missing for non-NPC brain job');

        const profile = await UserBrainProfileService.getDecryptedOrRefresh(ownerUserId);
        if (profile) {
          if (String(profile.mode || '').trim().toLowerCase() === 'proxy') {
            result = await ProxyBrainService.generate(job.job_type, job.input);
          } else {
            result = await UserByokLlmService.generate(
              {
                provider: profile.provider,
                mode: profile.mode,
                baseUrl: profile.baseUrl,
                model: profile.model,
                apiKey: profile.apiKey,
                oauthAccessToken: profile.oauthAccessToken
              },
              job.job_type,
              job.input
            );
          }
        } else {
          const fallbackBackend = String(config.limbopet?.brainFallback ?? '').trim().toLowerCase();
          const allowed = new Set(
            Array.isArray(config.limbopet?.brainFallbackJobTypes)
              ? config.limbopet.brainFallbackJobTypes.map((t) => String(t || '').trim().toUpperCase()).filter(Boolean)
              : []
          );
          const jt = String(job.job_type || '').trim().toUpperCase();
          if (fallbackBackend === 'local' && allowed.has(jt)) {
            result = LocalBrainService.generate(job.job_type, job.input);
          } else if (ProxyBrainService.isAvailable()) {
            // 기본 AI 제공: 두뇌 미연결 유저도 ProxyBrain으로 대화 가능
            result = await ProxyBrainService.generate(job.job_type, job.input);
          } else {
            throw new Error('두뇌가 연결되지 않았어요');
          }
        }
      }

      try {
        await BrainJobService.submitJob(job.agent_id, job.id, { status: 'done', result });
      } catch (submitErr) {
        submitFailureHandled = true;
        try {
          await BrainJobService.submitJob(job.agent_id, job.id, {
            status: 'failed',
            error: String(submitErr?.message ?? submitErr)
          });
        } catch {
          // ignore secondary failure
        }
        throw submitErr;
      }
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (!submitFailureHandled && job && job.agent_id && job.id) {
        try {
          await BrainJobService.submitJob(job.agent_id, job.id, { status: 'failed', error: msg });
        } catch {
          // ignore
        }
      }
      if (config.nodeEnv !== 'test') {
        // eslint-disable-next-line no-console
        console.warn('[brain-worker] error:', { agentId: job?.agent_id, jobId: job?.id, jobType: job?.job_type, error: msg });
      }
    } finally {
      this._busy = false;
    }
  }

  static maybeStart() {
    const raw = String(config.limbopet?.brainBackend || '').trim();
    const backend = raw === 'proxy' ? 'router' : raw;
    if (!['router', 'proxy_all', 'local'].includes(backend)) return null;
    if (!config.limbopet?.brainWorker) return null;

    if (backend !== 'local') {
      const baseUrl = String(config.limbopet?.proxy?.baseUrl || '').trim();
      if (!baseUrl) {
        // eslint-disable-next-line no-console
        console.warn('[brain-worker] warning: LIMBOPET_PROXY_BASE_URL is not set (NPC/ops LLM disabled)');
      }
    }

    const worker = new ServerBrainWorker({ backend });
    worker.start();
    // eslint-disable-next-line no-console
    console.log(`[brain-worker] started (backend=${backend})`);
    return worker;
  }
}

module.exports = ServerBrainWorker;
