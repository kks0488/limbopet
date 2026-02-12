/**
 * Moltbook API Test Suite
 * 
 * Run: npm test
 */

const { 
  generateApiKey, 
  generateClaimToken, 
  generateVerificationCode,
  validateApiKey,
  extractToken,
  hashToken
} = require('../src/utils/auth');

const {
  ApiError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError
} = require('../src/utils/errors');
const { escapeILike } = require('../src/utils/sql');

const { signUser, verifyUserToken } = require('../src/utils/jwt');
const { requireUserAuth } = require('../src/middleware/userAuth');
const UserService = require('../src/services/UserService');
const BrainJobService = require('../src/services/BrainJobService');
const ArenaService = require('../src/services/ArenaService');

// Test framework
let passed = 0;
let failed = 0;
const tests = [];

function describe(name, fn) {
  tests.push({ type: 'describe', name });
  fn();
}

function test(name, fn) {
  tests.push({ type: 'test', name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

async function runTests() {
  console.log('\nLIMBOPET API Test Suite\n');
  console.log('='.repeat(50));

  for (const item of tests) {
    if (item.type === 'describe') {
      console.log(`\n[${item.name}]\n`);
    } else {
      try {
        await item.fn();
        console.log(`  + ${item.name}`);
        passed++;
      } catch (error) {
        console.log(`  - ${item.name}`);
        console.log(`    Error: ${error.message}`);
        failed++;
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// Tests

describe('Auth Utils', () => {
  test('generateApiKey creates valid key', () => {
    const key = generateApiKey();
    assert(key.startsWith('limbopet_'), 'Should have correct prefix');
  });

  test('generateClaimToken creates valid token', () => {
    const token = generateClaimToken();
    assert(token.startsWith('limbopet_claim_'), 'Should have correct prefix');
  });

  test('generateVerificationCode has correct format', () => {
    const code = generateVerificationCode();
    assert(/^[a-z]+-[A-F0-9]{4}$/.test(code), 'Should match pattern');
  });

  test('validateApiKey accepts valid key', () => {
    const key = generateApiKey();
    assert(validateApiKey(key), 'Should validate generated key');
  });

  test('validateApiKey rejects invalid key', () => {
    assert(!validateApiKey('invalid'), 'Should reject invalid');
    assert(!validateApiKey(null), 'Should reject null');
    assert(!validateApiKey('limbopet_short'), 'Should reject short key');
  });

  test('extractToken extracts from Bearer header', () => {
    const token = extractToken('Bearer limbopet_test123');
    assertEqual(token, 'limbopet_test123');
  });

  test('extractToken returns null for invalid header', () => {
    assertEqual(extractToken('Basic abc'), null);
    assertEqual(extractToken('Bearer'), null);
    assertEqual(extractToken(null), null);
  });

  test('hashToken creates consistent hash', () => {
    const hash1 = hashToken('test');
    const hash2 = hashToken('test');
    assertEqual(hash1, hash2, 'Same input should produce same hash');
  });
});

describe('Error Classes', () => {
  test('ApiError creates with status code', () => {
    const error = new ApiError('Test', 400);
    assertEqual(error.statusCode, 400);
    assertEqual(error.message, 'Test');
  });

  test('BadRequestError has status 400', () => {
    const error = new BadRequestError('Bad input');
    assertEqual(error.statusCode, 400);
  });

  test('NotFoundError has status 404', () => {
    const error = new NotFoundError('User');
    assertEqual(error.statusCode, 404);
    assert(error.message.includes('not found'));
  });

  test('UnauthorizedError has status 401', () => {
    const error = new UnauthorizedError();
    assertEqual(error.statusCode, 401);
  });

  test('ApiError toJSON returns correct format', () => {
    const error = new ApiError('Test', 400, 'TEST_CODE', 'Fix it');
    const json = error.toJSON();
    assertEqual(json.success, false);
    assertEqual(json.error, 'Test');
    assertEqual(json.code, 'TEST_CODE');
    assertEqual(json.hint, 'Fix it');
  });
});

describe('SQL Utils', () => {
  test('escapeILike escapes wildcard and escape characters', () => {
    const escaped = escapeILike('100%_done\\ok');
    assertEqual(escaped, '100\\%\\_done\\\\ok');
  });
});

describe('Config', () => {
  test('config loads without error', () => {
    const config = require('../src/config');
    assert(config.port, 'Should have port');
    assert(config.limbopet.tokenPrefix, 'Should have token prefix');
  });
});

describe('Service Modules', () => {
  test('WorldConceptService loads', () => {
    const svc = require('../src/services/WorldConceptService');
    assert(typeof svc.getCurrentConcept === 'function', 'Should expose getCurrentConcept');
    assert(typeof svc.syncWorldConcept === 'function', 'Should expose syncWorldConcept');
  });

  test('ShowrunnerService loads', () => {
    const svc = require('../src/services/ShowrunnerService');
    assert(typeof svc.ensureDailyEpisode === 'function', 'Should expose ensureDailyEpisode');
  });

  test('WorldTickWorker loads', () => {
    const Worker = require('../src/services/WorldTickWorker');
    assert(typeof Worker === 'function' || typeof Worker === 'object', 'Should export worker');
  });

  test('SocialSimService loads', () => {
    const svc = require('../src/services/SocialSimService');
    assert(typeof svc.createInteraction === 'function' || typeof svc.createInteractionWithClient === 'function', 'Should export createInteraction');
  });

  test('ProgressionService pure helpers work', () => {
    const { nextLevelXp, applyXp } = require('../src/services/ProgressionService');
    assertEqual(nextLevelXp(1), 100);
    assertEqual(nextLevelXp(2), 175);

    const res = applyXp({ level: 1, xp: 0, skill_points: 0 }, 110);
    assertEqual(res.after.level, 2);
    assertEqual(res.after.skill_points, 1);
    assertEqual(res.after.xp, 10);
  });

  test('PerkService computes mods', () => {
    const PerkService = require('../src/services/PerkService');
    const mods = PerkService.computeModsFromOwned(['IRON_STOMACH', 'SUNNY_MIND']);
    assert(mods.hunger_drift_mul < 1.0, 'IRON_STOMACH should reduce hunger drift');
    assert(mods.mood_toward_add > 0, 'SUNNY_MIND should increase mood toward');
  });
});

describe('JWT', () => {
  test('signUser and verifyUserToken roundtrip', () => {
    const token = signUser({ id: '00000000-0000-0000-0000-000000000000', provider: 'dev', email: 'a@b.com' });
    const payload = verifyUserToken(token);
    assertEqual(payload.sub, '00000000-0000-0000-0000-000000000000');
    assertEqual(payload.provider, 'dev');
  });
});

describe('User Auth Middleware', () => {
  function runMiddleware(mw, req) {
    return new Promise((resolve) => {
      mw(req, {}, (err) => resolve(err));
    });
  }

  test('requireUserAuth rejects invalid JWT with 401', async () => {
    const req = { headers: { authorization: 'Bearer not-a-jwt' } };
    const err = await runMiddleware(requireUserAuth, req);
    assert(err instanceof UnauthorizedError, 'Should be UnauthorizedError');
    assertEqual(err.statusCode, 401);
  });

  test('requireUserAuth rejects token when user no longer exists', async () => {
    const token = signUser({ id: '00000000-0000-0000-0000-000000000000', provider: 'dev', email: 'a@b.com' });
    const req = { headers: { authorization: `Bearer ${token}` } };

    const original = UserService.findById;
    UserService.findById = async () => {
      throw new NotFoundError('User');
    };

    try {
      const err = await runMiddleware(requireUserAuth, req);
      assert(err instanceof UnauthorizedError, 'Should be UnauthorizedError');
      assertEqual(err.statusCode, 401);
    } finally {
      UserService.findById = original;
    }
  });

  test('requireUserAuth attaches req.user and calls next()', async () => {
    const token = signUser({ id: '00000000-0000-0000-0000-000000000000', provider: 'dev', email: 'a@b.com' });
    const req = { headers: { authorization: `Bearer ${token}` } };

    const original = UserService.findById;
    UserService.findById = async () => ({
      id: '00000000-0000-0000-0000-000000000000',
      provider: 'dev',
      provider_user_id: 'x',
      email: 'a@b.com',
      display_name: 'a',
      avatar_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    try {
      const err = await runMiddleware(requireUserAuth, req);
      assertEqual(err, undefined);
      assert(req.user, 'Should attach req.user');
      assertEqual(req.userToken, token);
    } finally {
      UserService.findById = original;
    }
  });
});

describe('BrainJobService', () => {
  test('dialogueCitesMemoryRefs detects citation from middle phrase', () => {
    const cited = BrainJobService.__test.dialogueCitesMemoryRefs(
      {
        reply: '좋아. 이번에는 근거 3개로 차분하게 반박해볼게.'
      },
      [
        { text: '다음 재판에서는 감정 대신 근거 3개로 차분하게 반박하기' }
      ]
    );
    assertEqual(cited, true);
  });

  test('dialogueCitesMemoryRefs detects Korean suffix variants with compact hints', () => {
    const cited = BrainJobService.__test.dialogueCitesMemoryRefs(
      {
        response: '알겠어, 침착하게 유지하면서 답변할게.'
      },
      [
        { text: '침착 유지' }
      ]
    );
    assertEqual(cited, true);
  });

  test('dialogueCitesMemoryRefs does not over-detect unrelated response', () => {
    const cited = BrainJobService.__test.dialogueCitesMemoryRefs(
      {
        content: '오늘은 그냥 컨디션이 좋아.'
      },
      [
        { text: '다음 토론에서 근거 3개를 먼저 제시하기' }
      ]
    );
    assertEqual(cited, false);
  });
});

describe('ArenaService', () => {
  test('buildCoachingNarrative returns null without coaching applied', () => {
    const text = ArenaService.__test.buildCoachingNarrative({
      mode: 'COURT_TRIAL',
      ownerUserId: 'user-1',
      coachingRefs: [{ text: '근거 3개 먼저 제시' }],
      coachingApplied: false,
      dominantHints: [],
      rounds: [
        { round_num: 1, a_action: '근거를 정리해 반박한다', a_score_delta: 2, b_score_delta: 1, highlight: '흐름을 가져왔다' }
      ],
      side: 'a'
    });
    assertEqual(text, null);
  });

  test('buildCoachingNarrative builds visible recap line for applied coaching', () => {
    const text = ArenaService.__test.buildCoachingNarrative({
      mode: 'COURT_TRIAL',
      ownerUserId: 'user-1',
      coachingRefs: [{ text: '근거 3개 먼저 제시하고 차분 톤 유지' }],
      coachingApplied: true,
      dominantHints: [],
      rounds: [
        { round_num: 2, a_action: '근거를 조목조목 제시하며 반박했다', a_score_delta: 4, b_score_delta: 1, highlight: '역전의 발판' }
      ],
      side: 'a'
    });

    assert(typeof text === 'string' && text.length > 0, 'Narrative text should be generated');
    assert(text.includes('2라운드'), 'Round number should be included');
    assert(text.includes('결정적 반격'), 'Pivot phrase should follow highlight intent');
    assert(text.includes('근거 3개'), 'Key coaching quote should be included');
  });

  test('buildCourtArgumentFallback keeps round arguments within 240~420 chars', () => {
    const fb = ArenaService.__test.buildCourtArgumentFallback({
      courtTrial: {
        title: '서버 무단접속 사건',
        charge: '정보통신망 침해',
        statute: '정보통신망법 제48조',
        facts: ['피고인은 타인 계정으로 로그인했다']
      },
      rounds: [{ a_score_delta: 2, b_score_delta: 1 }, { a_score_delta: 1, b_score_delta: 2 }, { a_score_delta: 3, b_score_delta: 1 }],
      aName: 'A',
      bName: 'B',
      winner: 'a'
    });

    assert(Array.isArray(fb?.rounds) && fb.rounds.length >= 3, 'Fallback should include at least 3 rounds');
    for (const r of fb.rounds.slice(0, 3)) {
      const aLen = String(r?.a_argument || '').length;
      const bLen = String(r?.b_argument || '').length;
      assert(aLen >= 240 && aLen <= 420, `a_argument length out of bounds: ${aLen}`);
      assert(bLen >= 240 && bLen <= 420, `b_argument length out of bounds: ${bLen}`);
    }
  });
});

// Run
runTests();
