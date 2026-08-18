'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MESSAGE_TYPES, createRoomCredentials, envelope, validateEnvelope, sanitizeName, RoomRegistry,
} = require('../src/protocol');

test('envelope 與 validateEnvelope 驗證訊息格式', () => {
  assert.deepEqual(envelope(MESSAGE_TYPES.PING, { time: 1 }), { v: 1, type: 'ping', payload: { time: 1 } });
  assert.equal(validateEnvelope(envelope(MESSAGE_TYPES.PING, {})), null);
  assert.match(validateEnvelope(null), /JSON 物件/);
  assert.match(validateEnvelope({ v: 2, type: 'ping', payload: {} }), /協定版本/);
  assert.match(validateEnvelope({ v: 1, type: 'nope', payload: {} }), /未知的訊息類型/);
  assert.match(validateEnvelope({ v: 1, type: 'ping' }), /payload/);
  assert.match(validateEnvelope('字串'), /JSON 物件/);
  assert.match(validateEnvelope([]), /JSON 物件/);
});

test('createRoomCredentials 產生 6 位十六進位代碼與高熵權杖', () => {
  const first = createRoomCredentials();
  const second = createRoomCredentials();
  assert.match(first.roomCode, /^[0-9A-F]{6}$/);
  assert.match(first.roomToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.roomCode, second.roomCode);
  assert.notEqual(first.roomToken, second.roomToken);
});

test('sanitizeName 截斷過長名稱並提供預設值', () => {
  assert.equal(sanitizeName('  小明  '), '小明');
  assert.equal(sanitizeName(''), '未命名裝置');
  assert.equal(sanitizeName(null), '未命名裝置');
  assert.equal(sanitizeName('x'.repeat(100)).length, 48);
});

test('RoomRegistry 建立、加入、核准與成員清單', () => {
  const registry = new RoomRegistry();
  const credentials = createRoomCredentials();
  const room = registry.create({ ...credentials, hostId: 'host-1', hostName: '主機', hostKey: 'host-key' });
  assert.equal(registry.size(), 1);
  assert.equal(registry.get(credentials.roomToken), room);
  assert.equal(registry.byCode(credentials.roomCode.toLowerCase()), room); // 大小寫不敏感

  const member = registry.join(room, { id: 'guest-1', name: '訪客', publicKey: 'guest-key' });
  assert.equal(member.state, 'pending');
  assert.equal(registry.join(room, { id: 'guest-1', name: '重複加入' }), member);

  const state = registry.members(room);
  assert.equal(state.length, 2);
  assert.equal(state.find((item) => item.id === 'host-1').role, 'host');
  assert.equal(state.find((item) => item.id === 'host-1').state, 'approved');

  registry.approve(room, 'host-1', 'guest-1', true);
  assert.equal(registry.members(room).find((item) => item.id === 'guest-1').state, 'approved');
  assert.equal(registry.approvedCount(room), 2);

  registry.approve(room, 'host-1', 'guest-1', false);
  assert.equal(registry.members(room).find((item) => item.id === 'guest-1').state, 'rejected');
});

test('RoomRegistry 核准權限與錯誤處理', () => {
  const registry = new RoomRegistry();
  const room = registry.create({ roomCode: 'ABCDEF', roomToken: 't1', hostId: 'host-1', hostName: 'H' });
  registry.join(room, { id: 'guest-1', name: 'G' });
  assert.throws(() => registry.approve(room, 'guest-1', 'guest-2', true), /只有主機/);
  assert.throws(() => registry.approve(room, 'host-1', '不存在', true), /找不到此裝置/);
  assert.throws(() => registry.approve(room, 'host-1', 'host-1', true), /主機本身/);
});

test('RoomRegistry 公鑰與鹽的交換', () => {
  const registry = new RoomRegistry();
  const room = registry.create({ roomCode: 'ABCDEF', roomToken: 't1', hostId: 'h', hostName: 'H' });
  registry.join(room, { id: 'g', name: 'G' });
  assert.equal(registry.setPeerKey(room, 'g', 'pub-key', 'salt-1'), true);
  assert.equal(registry.setPeerKey(room, 'nobody', 'x', 'y'), false);
  const guest = registry.members(room).find((item) => item.id === 'g');
  assert.equal(guest.publicKey, 'pub-key');
  assert.equal(guest.keySalt, 'salt-1');
});

test('RoomRegistry 到期、移除與清掃', () => {
  let now = 0;
  const registry = new RoomRegistry({ now: () => now });
  registry.create({ roomCode: '111111', roomToken: 't1', hostId: 'h', hostName: 'H' });
  registry.create({ roomCode: '222222', roomToken: 't2', hostId: 'h2', hostName: 'H2' });
  assert.equal(registry.size(), 2);
  now = 2 * 60 * 60 * 1000; // 未到期
  assert.equal(registry.get('t1') !== null, true);
  assert.equal(registry.byCode('222222') !== null, true);
  now = 25 * 60 * 60 * 1000; // 超過 24 小時
  assert.equal(registry.get('t1'), null); // get 時即移除過期房間
  assert.equal(registry.byCode('222222'), null);
  assert.equal(registry.sweep(), 0); // 已被移除
  assert.equal(registry.size(), 0);
});

test('RoomRegistry sweep 主動移除過期房間', () => {
  let now = 0;
  const registry = new RoomRegistry({ now: () => now });
  registry.create({ roomCode: '333333', roomToken: 't3', hostId: 'h', hostName: 'H' });
  registry.create({ roomCode: '444444', roomToken: 't4', hostId: 'h2', hostName: 'H2' });
  now = 25 * 60 * 60 * 1000;
  assert.equal(registry.sweep(), 2);
  assert.equal(registry.size(), 0);
});

test('RoomRegistry removeMember 清空房間時移除房間', () => {
  const registry = new RoomRegistry();
  const room = registry.create({ roomCode: '333333', roomToken: 't3', hostId: 'h', hostName: 'H' });
  registry.join(room, { id: 'g', name: 'G' });
  assert.equal(registry.removeMember(room, 'g'), true);
  assert.equal(registry.removeMember(room, 'h'), true);
  assert.equal(registry.size(), 0);
  assert.equal(registry.remove('t4'), false);
});
