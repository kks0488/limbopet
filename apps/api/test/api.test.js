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

const { signUser, verifyUserToken } = require('../src/utils/jwt');

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

// Run
runTests();
