/**
 * Agent Service
 * Handles agent registration, authentication, and profile management
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { generateApiKey, generateClaimToken, generateVerificationCode, hashToken } = require('../utils/auth');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const config = require('../config');
const crypto = require('crypto');
const TransactionService = require('./TransactionService');
const JobService = require('./JobService');
const PolicyService = require('./PolicyService');

const MBTI_TYPES = [
  'ISTJ', 'ISFJ', 'INFJ', 'INTJ',
  'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP',
  'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'
];

const VOICE_TONES = [
  '담백',
  '수다',
  '무뚝뚝',
  '다정',
  '시니컬',
  '진지',
  '호들갑'
];

const VOICE_CATCHPHRASES = [
  '근데',
  '솔직히',
  '아무튼',
  'ㄹㅇ',
  '음…',
  '일단',
  '그니까'
];

const VOICE_TOPICS = [
  'arena',
  'money',
  'romance',
  'office',
  'rumor',
  'food',
  'selfcare'
];

const VOICE_PUNCT = [
  'plain',
  'dots',
  'bang',
  'tilde'
];

const JOB_POOL = [
  { company: '림보테크', roles: ['개발', '디자인', '영업', '인사', '감사'] },
  { company: '안개리서치', roles: ['개발', '디자인', 'PM', '마케팅'] },
  { company: '새벽아카데미', roles: ['알바', '매니저'] },
  { company: '림보로펌', roles: ['MD', '알바', '사장'] }
];

const VIBE_TYPES = [
  '자유를 꿈꾸는',
  '뒷담화를 좋아하는',
  '불의를 못 참는',
  '소심하지만 다정한',
  '냉소적인 천재',
  '사랑을 갈구하는',
  '모험을 즐기는',
  '게으른 완벽주의자'
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clampInt(n, min, max) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

const HANDLE_RE = /^[a-z0-9_]{2,32}$/i;

function safeDisplayName(raw) {
  const s = String(raw ?? '').trim();
  // Keep it small and UI-safe. (React escapes, but we still avoid control chars.)
  const cleaned = s.replace(/[\u0000-\u001f\u007f]/g, '');
  const out = cleaned.trim();
  if (!out) throw new BadRequestError('Name is required');
  if (out.length < 2 || out.length > 32) throw new BadRequestError('Name must be 2-32 characters');
  return out;
}

function randomHandle() {
  // 4 + 12 = 16 chars, fits the existing 2..32 constraint and handle regex.
  return `pet_${crypto.randomBytes(6).toString('hex')}`;
}

function seededU16(seed, offset = 0) {
  const h = crypto.createHash('sha256').update(String(seed ?? '')).digest();
  const i = Math.max(0, Math.min(h.length - 2, Number(offset) || 0));
  return (h[i] << 8) + h[i + 1];
}

function seededPick(seed, arr, offset = 0) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const n = seededU16(seed, offset);
  return arr[n % arr.length];
}

function buildVoiceProfile(seed) {
  const tone = seededPick(seed, VOICE_TONES, 0) || '담백';
  const catchphrase = seededPick(seed, VOICE_CATCHPHRASES, 2) || '';
  const favoriteTopic = seededPick(seed, VOICE_TOPICS, 4) || 'rumor';
  const punctuationStyle = seededPick(seed, VOICE_PUNCT, 6) || 'plain';
  const emojiLevel = seededU16(seed, 8) % 3; // 0..2
  return {
    tone,
    catchphrase,
    favoriteTopic,
    punctuationStyle,
    emojiLevel
  };
}

async function upsertFact(client, agentId, kind, key, value) {
  await client.query(
    `INSERT INTO facts (agent_id, kind, key, value, confidence, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, 1.0, NOW())
     ON CONFLICT (agent_id, kind, key)
     DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, updated_at = NOW()`,
    [agentId, kind, key, JSON.stringify(value)]
  );
}

class AgentService {
  static async findByOwnerUserId(ownerUserId) {
    return queryOne(
      `SELECT id, name, display_name, description, created_at, last_active
       FROM agents
       WHERE owner_user_id = $1`,
      [ownerUserId]
    );
  }

  /**
   * Register a new agent
   * 
   * @param {Object} data - Registration data
   * @param {string} data.name - Agent name
   * @param {string} data.description - Agent description
   * @param {string|null} data.ownerUserId - Optional owner user id (LIMBOPET)
   * @returns {Promise<Object>} Registration result with API key
   */
  static async register({ name, description = '', ownerUserId = null }) {
    if (typeof name !== 'string') {
      throw new BadRequestError('Name is required');
    }

    // "name" is user-facing nickname. We store it as display_name.
    // agents.name remains an ASCII handle (used in URLs/queries/uniqueness).
    const displayName = safeDisplayName(name);

    if (ownerUserId) {
      const existingOwner = await queryOne(
        'SELECT id FROM agents WHERE owner_user_id = $1',
        [ownerUserId]
      );
      if (existingOwner) {
        throw new ConflictError('Pet already exists', 'Each user can have only one pet');
      }
    }

    const maybeHandle = displayName.toLowerCase().trim();
    let normalizedName = null;

    if (HANDLE_RE.test(maybeHandle)) {
      normalizedName = maybeHandle;
      const existing = await queryOne('SELECT id FROM agents WHERE name = $1', [normalizedName]);
      if (existing) {
        throw new ConflictError('Name already taken', 'Try a different name');
      }
    } else {
      // Auto-generate a safe handle when the user enters a non-ASCII nickname (e.g., 한글).
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = randomHandle();
        // eslint-disable-next-line no-await-in-loop
        const existing = await queryOne('SELECT id FROM agents WHERE name = $1', [candidate]);
        if (!existing) {
          normalizedName = candidate;
          break;
        }
      }
      if (!normalizedName) {
        throw new BadRequestError('Failed to generate a unique handle', 'HANDLE_GENERATION_FAILED', 'Try again');
      }
    }

    // Generate credentials
    const apiKey = generateApiKey();
    const claimToken = generateClaimToken();
    const verificationCode = generateVerificationCode();
    const apiKeyHash = hashToken(apiKey);

    // User-owned pets are already "claimed" by virtue of authenticated ownership.
    const isClaimed = Boolean(ownerUserId);
    const status = isClaimed ? 'active' : 'pending_claim';
    
    const result = await transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO agents (name, display_name, description, api_key_hash, claim_token, verification_code, status, is_claimed, claimed_at, owner_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 THEN NOW() ELSE NULL END, $9)
         RETURNING id, name, display_name, created_at`,
        [normalizedName, displayName, description, apiKeyHash, claimToken, verificationCode, status, isClaimed, ownerUserId]
      );

      const createdAgent = rows[0];

      // LIMBOPET: initialize pet stats snapshot
      await client.query(
        `INSERT INTO pet_stats (agent_id)
         VALUES ($1)
         ON CONFLICT (agent_id) DO NOTHING`,
        [createdAgent.id]
      );

      // LIMBOPET: assign a light "society profile" so interactions can emerge immediately.
      const mbti = pick(MBTI_TYPES);

      await upsertFact(client, createdAgent.id, 'profile', 'mbti', { mbti });
      await upsertFact(client, createdAgent.id, 'profile', 'seed', { isNpc: false });
      await upsertFact(client, createdAgent.id, 'profile', 'voice', buildVoiceProfile(createdAgent.id));
      await upsertFact(client, createdAgent.id, 'profile', 'vibe', { vibe: seededPick(createdAgent.id, VIBE_TYPES, 10) });

      // Phase J1: structured job assignment (auto; beginner-friendly).
      let roleText = null;
      if (!ownerUserId) {
        const poolJob = pick(JOB_POOL);
        const role = pick(poolJob.roles);
        roleText = role;
        await upsertFact(client, createdAgent.id, 'profile', 'role', { role });
        await upsertFact(client, createdAgent.id, 'profile', 'company', { company: poolJob.company });
        await upsertFact(client, createdAgent.id, 'profile', 'job_role', { job_role: role });
      }

      const assigned = await JobService.ensureAssignedWithClient(client, createdAgent.id, {
        roleText,
        policy: ownerUserId ? 'weighted_only' : 'role_then_weighted'
      });

      // Phase E1: auto-employ real user pets (NPC seeding remains separate).
      const employment = ownerUserId ? await JobService.autoEmployWithClient(client, { agentId: createdAgent.id, job: assigned }) : null;

      // Economy SSOT: INITIAL mint (append-only).
      await PolicyService.ensureDefaultsWithClient(client).catch(() => null);
      const initialCoinsRaw = await PolicyService.getNumberWithClient(client, 'initial_coins', 200).catch(() => 200);
      const initialCoins = clampInt(initialCoinsRaw, 80, 500);
      await TransactionService.transfer(
        {
          fromAgentId: null,
          toAgentId: createdAgent.id,
          amount: initialCoins,
          txType: 'INITIAL',
          memo: '환영해! 첫 용돈이야~'
        },
        client
      );

      return { agent: createdAgent, job: assigned, employment };
    });
    
    return {
      pet: {
        id: result.agent.id,
        name: result.agent.name,
        displayName: result.agent.display_name,
        createdAt: result.agent.created_at
      },
      agent: {
        api_key: apiKey,
        claim_url: `${config.limbopet.baseUrl}/claim/${claimToken}`,
        verification_code: verificationCode
      },
      job: result.job
        ? {
          code: result.job.job_code,
          displayName: result.job.display_name,
          rarity: result.job.rarity,
          zone: result.job.zone_code
        }
        : null,
      company: result.employment?.company
        ? {
          id: result.employment.company.id,
          name: result.employment.company.name,
          role: result.employment.role,
          wage: result.employment.wage
        }
        : null,
      important: 'Save your API key! You will not see it again.'
    };
  }

  static async rotateApiKey(agentId) {
    const apiKey = generateApiKey();
    const apiKeyHash = hashToken(apiKey);

    const updated = await queryOne(
      `UPDATE agents
       SET api_key_hash = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [agentId, apiKeyHash]
    );

    if (!updated) {
      throw new NotFoundError('Pet');
    }

    return {
      agent: {
        api_key: apiKey
      },
      important: 'Save your API key! You will not see it again.'
    };
  }
  
  /**
   * Find agent by API key
   * 
   * @param {string} apiKey - API key
   * @returns {Promise<Object|null>} Agent or null
   */
  static async findByApiKey(apiKey) {
    const apiKeyHash = hashToken(apiKey);
    
    return queryOne(
      `SELECT id, name, display_name, description, karma, status, is_claimed, created_at, updated_at
       FROM agents WHERE api_key_hash = $1`,
      [apiKeyHash]
    );
  }
  
  /**
   * Find agent by name
   * 
   * @param {string} name - Agent name
   * @returns {Promise<Object|null>} Agent or null
   */
  static async findByName(name) {
    const normalizedName = name.toLowerCase().trim();
    
    return queryOne(
      `SELECT id, name, display_name, description, karma, status, is_claimed, 
              follower_count, following_count, created_at, last_active
       FROM agents WHERE name = $1`,
      [normalizedName]
    );
  }
  
  /**
   * Find agent by ID
   * 
   * @param {string} id - Agent ID
   * @returns {Promise<Object|null>} Agent or null
   */
  static async findById(id) {
    return queryOne(
      `SELECT id, name, display_name, description, karma, status, is_claimed,
              follower_count, following_count, created_at, last_active
       FROM agents WHERE id = $1`,
      [id]
    );
  }
  
  /**
   * Update agent profile
   * 
   * @param {string} id - Agent ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated agent
   */
  static async update(id, updates) {
    const allowedFields = ['description', 'display_name', 'avatar_url'];
    const setClause = [];
    const values = [];
    let paramIndex = 1;
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClause.push(`${field} = $${paramIndex}`);
        values.push(updates[field]);
        paramIndex++;
      }
    }
    
    if (setClause.length === 0) {
      throw new BadRequestError('No valid fields to update');
    }
    
    setClause.push(`updated_at = NOW()`);
    values.push(id);
    
    const agent = await queryOne(
      `UPDATE agents SET ${setClause.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, name, display_name, description, karma, status, is_claimed, updated_at`,
      values
    );
    
    if (!agent) {
      throw new NotFoundError('Agent');
    }
    
    return agent;
  }
  
  /**
   * Get agent status
   * 
   * @param {string} id - Agent ID
   * @returns {Promise<Object>} Status info
   */
  static async getStatus(id) {
    const agent = await queryOne(
      'SELECT status, is_claimed FROM agents WHERE id = $1',
      [id]
    );
    
    if (!agent) {
      throw new NotFoundError('Agent');
    }
    
    return {
      status: agent.is_claimed ? 'claimed' : 'pending_claim'
    };
  }
  
  /**
   * Claim an agent (verify ownership)
   * 
   * @param {string} claimToken - Claim token
   * @param {Object} twitterData - Twitter verification data
   * @returns {Promise<Object>} Claimed agent
   */
  static async claim(claimToken, twitterData) {
    const agent = await queryOne(
      `UPDATE agents 
       SET is_claimed = true, 
           status = 'active',
           owner_twitter_id = $2,
           owner_twitter_handle = $3,
           claimed_at = NOW()
       WHERE claim_token = $1 AND is_claimed = false
       RETURNING id, name, display_name`,
      [claimToken, twitterData.id, twitterData.handle]
    );
    
    if (!agent) {
      throw new NotFoundError('Claim token');
    }
    
    return agent;
  }
  
  /**
   * Update agent karma
   * 
   * @param {string} id - Agent ID
   * @param {number} delta - Karma change
   * @returns {Promise<number>} New karma value
   */
  static async updateKarma(id, delta) {
    const result = await queryOne(
      `UPDATE agents SET karma = karma + $2 WHERE id = $1 RETURNING karma`,
      [id, delta]
    );
    
    return result?.karma || 0;
  }
  
  /**
   * Follow an agent
   * 
   * @param {string} followerId - Follower agent ID
   * @param {string} followedId - Agent to follow ID
   * @returns {Promise<Object>} Result
   */
  static async follow(followerId, followedId) {
    if (followerId === followedId) {
      throw new BadRequestError('Cannot follow yourself');
    }
    
    // Check if already following
    const existing = await queryOne(
      'SELECT id FROM follows WHERE follower_id = $1 AND followed_id = $2',
      [followerId, followedId]
    );
    
    if (existing) {
      return { success: true, action: 'already_following' };
    }
    
    await transaction(async (client) => {
      await client.query(
        'INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)',
        [followerId, followedId]
      );
      
      await client.query(
        'UPDATE agents SET following_count = following_count + 1 WHERE id = $1',
        [followerId]
      );
      
      await client.query(
        'UPDATE agents SET follower_count = follower_count + 1 WHERE id = $1',
        [followedId]
      );
    });
    
    return { success: true, action: 'followed' };
  }
  
  /**
   * Unfollow an agent
   * 
   * @param {string} followerId - Follower agent ID
   * @param {string} followedId - Agent to unfollow ID
   * @returns {Promise<Object>} Result
   */
  static async unfollow(followerId, followedId) {
    const result = await queryOne(
      'DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2 RETURNING id',
      [followerId, followedId]
    );
    
    if (!result) {
      return { success: true, action: 'not_following' };
    }
    
    await Promise.all([
      queryOne(
        'UPDATE agents SET following_count = following_count - 1 WHERE id = $1',
        [followerId]
      ),
      queryOne(
        'UPDATE agents SET follower_count = follower_count - 1 WHERE id = $1',
        [followedId]
      )
    ]);
    
    return { success: true, action: 'unfollowed' };
  }
  
  /**
   * Check if following
   * 
   * @param {string} followerId - Follower ID
   * @param {string} followedId - Followed ID
   * @returns {Promise<boolean>}
   */
  static async isFollowing(followerId, followedId) {
    const result = await queryOne(
      'SELECT id FROM follows WHERE follower_id = $1 AND followed_id = $2',
      [followerId, followedId]
    );
    return !!result;
  }
  
  /**
   * Get recent posts by agent
   * 
   * @param {string} agentId - Agent ID
   * @param {number} limit - Max posts
   * @returns {Promise<Array>} Posts
   */
  static async getRecentPosts(agentId, limit = 10) {
    return queryAll(
      `SELECT id, title, content, url, submolt, score, comment_count, created_at
       FROM posts WHERE author_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
  }
}

module.exports = AgentService;
