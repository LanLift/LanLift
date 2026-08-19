'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RelayHub, DEFAULT_LIMITS } = require('../relay/relay-hub');

function fakeRoom(entries) {
  return { members: new Map(entries.map((entry) => [entry.id, entry])) };
}

const approvedSender = { id: 'a', state: 'approved' };
const pendingSender = { id: 'b', state: 'pending' };
const approvedOther = { id: 'c', state: 'approved' };

test('已核准成員的區塊被轉發並累計統計', () => {
  let forwarded = 0;
  const hub = new RelayHub({ bytesPerSecond: 0 });
  const room = fakeRoom([approvedSender, approvedOther]);
  const result = hub.relayChunk({
    roomToken: 't1', senderId: 'a', room, bytes: 1024,
    forward: () => { forwarded += 1; },
  });
  assert.equal(result.ok, true);
  assert.equal(forwarded, 1);
  const stats = hub.stats('t1');
  assert.equal(stats.frames, 1);
  assert.equal(stats.bytes, 1024);
  assert.equal(stats.dropped, 0);
});

test('未核准成員的區塊被丟棄', () => {
  const hub = new RelayHub();
  const room = fakeRoom([pendingSender, approvedOther]);
  const result = hub.relayChunk({ roomToken: 't2', senderId: 'b', room, bytes: 100, forward: () => {} });
  assert.equal(result.ok, false);
  assert.match(result.reason, /未核准/);
  assert.equal(hub.stats('t2').dropped, 1);
});

test('超出單一區塊大小上限被丟棄', () => {
  const hub = new RelayHub({ bytesPerSecond: 0 });
  const room = fakeRoom([approvedSender, approvedOther]);
  const result = hub.relayChunk({ roomToken: 't3', senderId: 'a', room, bytes: hub.maxChunkBytes + 1, forward: () => {} });
  assert.equal(result.ok, false);
  assert.match(result.reason, /區塊大小/);
});

test('非法區塊大小（0、負數、非數字）被丟棄', () => {
  const hub = new RelayHub();
  const room = fakeRoom([approvedSender, approvedOther]);
  for (const bytes of [0, -5, Number.NaN]) {
    const result = hub.relayChunk({ roomToken: 't4', senderId: 'a', room, bytes, forward: () => {} });
    assert.equal(result.ok, false);
  }
});

test('超過累計流量上限被丟棄', () => {
  const hub = new RelayHub({ bytesPerSecond: 0, maxSessionBytes: 1000 });
  const room = fakeRoom([approvedSender, approvedOther]);
  assert.equal(hub.relayChunk({ roomToken: 't5', senderId: 'a', room, bytes: 600, forward: () => {} }).ok, true);
  const result = hub.relayChunk({ roomToken: 't5', senderId: 'a', room, bytes: 600, forward: () => {} });
  assert.equal(result.ok, false);
  assert.match(result.reason, /累計流量/);
});

test('速率限制：超出令牌桶的區塊被拒絕並計入延遲', () => {
  let now = 0;
  const hub = new RelayHub({ bytesPerSecond: 1000, burstFactor: 1, now: () => now });
  const room = fakeRoom([approvedSender, approvedOther]);
  assert.equal(hub.relayChunk({ roomToken: 't6', senderId: 'a', room, bytes: 600, forward: () => {} }).ok, true);
  const result = hub.relayChunk({ roomToken: 't6', senderId: 'a', room, bytes: 600, forward: () => {} });
  assert.equal(result.ok, false);
  assert.match(result.reason, /速率/);
  assert.equal(hub.stats('t6').delayed, 600);
  now = 1000;
  assert.equal(hub.relayChunk({ roomToken: 't6', senderId: 'a', room, bytes: 600, forward: () => {} }).ok, true);
});

test('remove 關閉通道；stats 對未知通道回傳 null', () => {
  const hub = new RelayHub();
  hub.channel('t7');
  assert.ok(hub.stats('t7'));
  assert.equal(hub.remove('t7'), true);
  assert.equal(hub.remove('t7'), false);
  assert.equal(hub.stats('t7'), null);
});

test('預設限制值', () => {
  assert.equal(DEFAULT_LIMITS.bytesPerSecond, 2 * 1024 * 1024);
  assert.equal(DEFAULT_LIMITS.maxChunkBytes, 256 * 1024);
  assert.equal(DEFAULT_LIMITS.maxSessionBytes, 200 * 1024 * 1024 * 1024);
});
