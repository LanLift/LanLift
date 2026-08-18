'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenBucket } = require('../relay/bandwidth');

test('無限速時不限制流量', () => {
  const bucket = new TokenBucket({ bytesPerSecond: 0 });
  assert.equal(bucket.tryTake(1024 * 1024 * 10), true);
  assert.equal(bucket.totalConsumed, 1024 * 1024 * 10);
  assert.equal(bucket.waitMs(999999), 0);
});

test('限速時超過容量的區塊被拒絕並回報等待時間', () => {
  let now = 0;
  const bucket = new TokenBucket({ bytesPerSecond: 1000, burstFactor: 1, now: () => now });
  assert.equal(bucket.available(), 1000);
  assert.equal(bucket.tryTake(600), true);
  assert.equal(bucket.tryTake(600), false); // 只剩 400
  assert.equal(bucket.waitMs(600), 200);
  now = 1000; // 經過 1 秒，補充 1000
  assert.equal(bucket.tryTake(1000), true);
});

test('突發倍數決定容量', () => {
  const bucket = new TokenBucket({ bytesPerSecond: 1000, burstFactor: 3 });
  assert.equal(bucket.capacity, 3000);
  assert.equal(bucket.tryTake(3000), true);
  assert.equal(bucket.tryTake(1), false);
});

test('forceTake 扣除並記錄延遲量', () => {
  const bucket = new TokenBucket({ bytesPerSecond: 1000, burstFactor: 1 });
  bucket.forceTake(1500);
  assert.equal(bucket.delayedBytes, 500);
  assert.equal(bucket.totalConsumed, 1500);
  assert.equal(bucket.tryTake(1), false);
});

test('非法數值的安全處理', () => {
  const bucket = new TokenBucket({ bytesPerSecond: -5, burstFactor: 0 });
  assert.equal(bucket.bytesPerSecond, 0);
  assert.equal(bucket.burstFactor, 2); // 非法值回退預設
  assert.equal(bucket.tryTake(-1), true);
  assert.equal(bucket.tryTake(0), true);
});
