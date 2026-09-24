const assert = require('assert');
const { tick, BREAK } = require('./timer');

assert.strictEqual(tick(0, 0), 1, 'counts up while active');
assert.strictEqual(tick(59, BREAK - 1), 60, 'short idle does not reset');
assert.strictEqual(tick(3000, BREAK), 0, '5 min idle resets');
console.log('timer ok');
