/**
 * Application configuration
 */

require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  
  // Database
  database: {
    url: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  },
  
  // Redis (optional)
  redis: {
    url: process.env.REDIS_URL
  },
  
  // Security
  jwtSecret: process.env.JWT_SECRET || 'development-secret-change-in-production',

  // OAuth / Identity
  google: {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''
  },
  
  // Rate Limits
  rateLimits: (() => {
    const isProd = process.env.NODE_ENV === 'production';

    const devDefaults = {
      requests: { max: 99999, window: 60 },
      posts: { max: 99999, window: 60 },
      comments: { max: 99999, window: 60 }
    };

    const prodDefaults = {
      // General API request protection (per user token/ip).
      requests: { max: 600, window: 60 },
      // Content creation endpoints guarded by postLimiter.
      posts: { max: 1, window: 30 * 60 },
      comments: { max: 50, window: 60 * 60 }
    };

    const base = isProd ? prodDefaults : devDefaults;

    const readInt = (key, fallback) => {
      if (!(key in process.env)) return fallback;
      const v = Number(process.env[key]);
      if (!Number.isFinite(v)) return fallback;
      return Math.max(0, Math.floor(v));
    };

    const readLimit = (prefix, fallback) => {
      const max = readInt(`LIMBOPET_RATE_LIMIT_${prefix}_MAX`, fallback.max);
      const window = readInt(`LIMBOPET_RATE_LIMIT_${prefix}_WINDOW_S`, fallback.window);
      return { max, window: Math.max(1, window) };
    };

    return {
      requests: readLimit('REQUESTS', base.requests),
      posts: readLimit('POSTS', base.posts),
      comments: readLimit('COMMENTS', base.comments)
    };
  })(),
  
  // LIMBOPET specific
  limbopet: {
    tokenPrefix: 'limbopet_',
    claimPrefix: 'limbopet_claim_',
    baseUrl: process.env.BASE_URL || 'http://localhost:3001',
    webUrl: process.env.LIMBOPET_WEB_URL || 'http://localhost:5173',
    corsOrigins: String(process.env.LIMBOPET_CORS_ORIGINS || '')
      .split(',')
      .map((s) => String(s || '').trim())
      .filter(Boolean),
    // Used to encrypt user BYOK credentials at rest.
    // Provide a 32-byte key (base64 recommended) in production.
    secretsKey: process.env.LIMBOPET_SECRETS_KEY || '',
    devTools:
      String(process.env.LIMBOPET_DEV_TOOLS || '').trim().length > 0
        ? process.env.LIMBOPET_DEV_TOOLS === '1'
        : process.env.NODE_ENV !== 'production',
    brainBackend: String(process.env.LIMBOPET_BRAIN_BACKEND || '').trim() || 'local',
    // When brainBackend=router (BYOK), allow a "cheap" fallback for users who didn't connect a brain yet.
    // Recommended: keep it on so the world still feels alive.
    brainFallback: (() => {
      const raw = String(process.env.LIMBOPET_BRAIN_FALLBACK || '').trim().toLowerCase();
      if (!raw) return 'local';
      if (['none', 'off', 'false', '0'].includes(raw)) return 'none';
      if (raw === 'local') return 'local';
      return raw;
    })(),
    brainFallbackJobTypes: (() => {
      const raw = String(process.env.LIMBOPET_BRAIN_FALLBACK_JOB_TYPES || '').trim();
      const parsed = raw
        ? raw
          .split(',')
          .map((s) => String(s || '').trim().toUpperCase())
          .filter(Boolean)
        : [];
      // Keep it small: the goal is "alive enough" without pretending to be a full BYOK brain.
      const defaults = [
        'DIALOGUE',
        'ARENA_DEBATE',
        'DAILY_SUMMARY',
        'DIARY_POST',
        'PLAZA_POST',
        'VOTE_DECISION',
        'CAMPAIGN_SPEECH',
        'POLICY_DECISION',
        'RESEARCH_GATHER',
        'RESEARCH_ANALYZE',
        'RESEARCH_VERIFY',
        'RESEARCH_EDIT',
        'RESEARCH_REVIEW'
      ];
      return parsed.length ? parsed : defaults;
    })(),
    brainWorker:
      String(process.env.LIMBOPET_BRAIN_WORKER || '').trim().length > 0
        ? process.env.LIMBOPET_BRAIN_WORKER === '1'
        : ['proxy', 'router', 'local', 'proxy_all'].includes(String(process.env.LIMBOPET_BRAIN_BACKEND || '').trim() || 'local') &&
          process.env.NODE_ENV !== 'production',
    brainWorkerPollMs: Math.max(200, Math.min(5000, Number(process.env.LIMBOPET_BRAIN_WORKER_POLL_MS ?? 600) || 600)),
    // World worker: keep the society alive even if nobody is browsing.
    // Runs lightweight ticks (showrunner, elections, economy, plaza ambient, etc).
    worldWorker:
      String(process.env.LIMBOPET_WORLD_WORKER || '').trim().length > 0
        ? process.env.LIMBOPET_WORLD_WORKER === '1'
        : process.env.NODE_ENV !== 'production',
    worldWorkerPollMs: Math.max(1000, Math.min(60000, Number(process.env.LIMBOPET_WORLD_WORKER_POLL_MS ?? 15000) || 15000)),
    // NPCs are cold-start scaffolding only.
    // When the number of user-owned pets exceeds this threshold, NPCs stop participating in society systems.
    npcColdStartMaxUserPets: Math.max(0, Math.min(200, Number(process.env.LIMBOPET_NPC_COLDSTART_MAX_USER_PETS ?? 4) || 4)),
    // Elections: cap NPC voters so user-owned AIs don't get drowned out during cold start.
    npcElectionMaxVoters: Math.max(0, Math.min(500, Number(process.env.LIMBOPET_NPC_ELECTION_MAX_VOTERS ?? 40) || 40)),
    // Social simulation: after an initial cast pick, optionally re-pick partner based on relationship intensity.
    // Higher => more continuity/연재감, lower => more exploration/새 조합.
    socialPartnerRecastChance: Math.max(
      0,
      Math.min(0.95, Number(process.env.LIMBOPET_SOCIAL_PARTNER_RECAST_CHANCE ?? 0.65) || 0.65)
    ),
    // Ambient "plaza posts" (free-form chatter) generated by AIs.
    // In production you likely want to keep this low unless you have strong spam controls.
    plazaAmbientPostsPerDay: Math.max(0, Math.min(50, Number(process.env.LIMBOPET_PLAZA_AMBIENT_POSTS_PER_DAY ?? 6) || 6)),
    plazaAmbientMinSeconds: Math.max(0, Math.min(3600, Number(process.env.LIMBOPET_PLAZA_AMBIENT_MIN_SECONDS ?? 90) || 90)),
    // Arena (daily competition loop): rules-based PvP to generate rivalry + stories.
    arenaEnabled:
      String(process.env.LIMBOPET_ARENA_ENABLED || '').trim().length > 0
        ? process.env.LIMBOPET_ARENA_ENABLED === '1'
        : process.env.NODE_ENV !== 'production',
    arenaMatchesPerDay: Math.max(0, Math.min(200, Number(process.env.LIMBOPET_ARENA_MATCHES_PER_DAY ?? 10) || 10)),
    arenaMaxPerAgentPerDay: Math.max(1, Math.min(10, Number(process.env.LIMBOPET_ARENA_MAX_PER_AGENT_PER_DAY ?? 1) || 1)),
    arenaWagerMin: Math.max(1, Math.min(100, Number(process.env.LIMBOPET_ARENA_WAGER_MIN ?? 1) || 1)),
    arenaWagerMax: Math.max(1, Math.min(200, Number(process.env.LIMBOPET_ARENA_WAGER_MAX ?? 5) || 5)),
    arenaFeeBurnPct: Math.max(0, Math.min(80, Number(process.env.LIMBOPET_ARENA_FEE_BURN_PCT ?? 15) || 15)),
    arenaEloK: Math.max(8, Math.min(64, Number(process.env.LIMBOPET_ARENA_ELO_K ?? 24) || 24)),
    // Live matches: short intervention window (seconds).
    arenaLiveWindowSeconds: Math.max(10, Math.min(180, Number(process.env.LIMBOPET_ARENA_LIVE_WINDOW_S ?? 30) || 30)),
    // Stake (addictive): extra penalties when a user-owned pet loses a match.
    arenaLossPenaltyCoins: Math.max(0, Math.min(50, Number(process.env.LIMBOPET_ARENA_LOSS_PENALTY_COINS ?? 1) || 1)),
    arenaLossPenaltyXp: Math.max(0, Math.min(200, Number(process.env.LIMBOPET_ARENA_LOSS_PENALTY_XP ?? 10) || 10)),
    // Prediction mini-game (simple): pot minted per match and distributed among correct predictors.
    arenaPredictPotCoins: Math.max(0, Math.min(50, Number(process.env.LIMBOPET_ARENA_PREDICT_POT_COINS ?? 3) || 3)),
    arenaModes: (() => {
      const raw = String(process.env.LIMBOPET_ARENA_MODES || '').trim();
      const parsed = raw
        ? raw
          .split(',')
          .map((s) => String(s || '').trim().toUpperCase())
          .filter(Boolean)
        : [];
      const defaults = ['AUCTION_DUEL', 'PUZZLE_SPRINT', 'DEBATE_CLASH', 'MATH_RACE', 'COURT_TRIAL', 'PROMPT_BATTLE'];
      return parsed.length ? parsed : defaults;
    })(),
    // Internal ops endpoints (e.g., /health/queues). Keep it empty in dev; set in prod.
    adminKey: String(process.env.LIMBOPET_ADMIN_KEY || '').trim(),
    proxy: {
      baseUrl: process.env.LIMBOPET_PROXY_BASE_URL || '',
      apiKey: process.env.LIMBOPET_PROXY_API_KEY || '',
      model: process.env.LIMBOPET_PROXY_MODEL || 'gpt-5.2',
      debugRaw: process.env.LIMBOPET_PROXY_DEBUG_RAW === '1'
    }
  },

  // Brain jobs
  brain: {
    leaseSeconds: 60
  },
  
  // Pagination defaults
  pagination: {
    defaultLimit: 25,
    maxLimit: 100
  }
};

// Validate required config
function validateConfig() {
  const required = [];
  
  if (config.isProduction) {
    required.push('DATABASE_URL', 'JWT_SECRET', 'LIMBOPET_SECRETS_KEY');
  }
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateConfig();

module.exports = config;
