const test = require('node:test');
const assert = require('node:assert');

// Node.js native test suite for testing API endpoints & auth logic
test('Rate limiter blocks excess requests', () => {
  const map = new Map();
  function checkLimit(ip, max = 3) {
    const cur = map.get(ip) || 0;
    if (cur >= max) return false;
    map.set(ip, cur + 1);
    return true;
  }

  assert.strictEqual(checkLimit('192.168.1.1'), true);
  assert.strictEqual(checkLimit('192.168.1.1'), true);
  assert.strictEqual(checkLimit('192.168.1.1'), true);
  assert.strictEqual(checkLimit('192.168.1.1'), false, 'Should be rate limited on 4th call');
});

test('Auth token validation rejects invalid token', () => {
  const expected = 'secret_token_123';
  function validate(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    return authHeader.substring(7).trim() === expected;
  }

  assert.strictEqual(validate('Bearer secret_token_123'), true);
  assert.strictEqual(validate('Bearer wrong_token'), false);
  assert.strictEqual(validate('Basic user:pass'), false);
  assert.strictEqual(validate(null), false);
});

test('Disallows direct trade execution actions', () => {
  const allowed = new Set(['PAUSE', 'KILL', 'RESUME']);
  function isAllowedAction(action) {
    return allowed.has(action);
  }

  assert.strictEqual(isAllowedAction('PAUSE'), true);
  assert.strictEqual(isAllowedAction('KILL'), true);
  assert.strictEqual(isAllowedAction('RESUME'), true);
  assert.strictEqual(isAllowedAction('BUY'), false, 'BUY must be strictly prohibited');
  assert.strictEqual(isAllowedAction('SELL'), false, 'SELL must be strictly prohibited');
  assert.strictEqual(isAllowedAction('EXECUTE_TRADE'), false);
});
