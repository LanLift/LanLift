'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRelayServer } = require('../relay/server');
const { RelayClient } = require('../src/relay-client');

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

function waitForEvent(emitter, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待事件 ${type} 逾時。`)), timeoutMs);
    emitter.once(type, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test('RelayClient 註冊、建房、加入與核准', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const url = `ws://127.0.0.1:${info.port}/ws`;

  const host = new RelayClient({ url, deviceName: '主機', platform: 'test' });
  const guest = new RelayClient({ url, deviceName: '訪客', platform: 'test' });
  t.after(() => { host.close(); guest.close(); });

  host.connect();
  const hostWelcome = await waitForEvent(host, 'welcome');
  assert.equal(hostWelcome.deviceId, host.deviceId);

  host.createRoom();
  const created = await waitForEvent(host, 'room-created');
  assert.match(created.roomCode, /^[0-9A-F]{6}$/);

  guest.connect();
  await waitForEvent(guest, 'welcome');
  guest.joinRoom(created.roomCode);
  const state = await waitForEvent(guest, 'room-state');
  assert.equal(state.members.length, 2);

  const hostState = await waitForEvent(host, 'room-state');
  assert.ok(hostState.members.some((member) => member.id === guest.deviceId));

  host.approve(created.roomToken, guest.deviceId, true);
  const approved = await waitForEvent(guest, 'room-state');
  assert.equal(approved.members.find((member) => member.id === guest.deviceId).state, 'approved');

  // sendFrame 回傳 true；錯誤 token 不影響已建立連線
  assert.equal(guest.sendFrame(created.roomToken, { fileId: 'f', seq: 0, total: 1, checksum: 'c', iv: 'i', data: 'ZA==' }), true);
  const frame = await waitForEvent(host, 'frame');
  assert.equal(frame.fileId, 'f');
});

test('RelayClient 斷線自動重連並重新註冊', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const url = `ws://127.0.0.1:${info.port}/ws`;

  const client = new RelayClient({ url, deviceName: '重連測試', platform: 'test' });
  t.after(() => client.close());

  client.connect();
  await waitForEvent(client, 'welcome');
  // 強制關閉底層連線模擬網路中斷（close 事件會觸發自動重連）
  client.ws.close();
  const reconnecting = await waitForEvent(client, 'reconnecting');
  assert.equal(reconnecting.attempt, 1);
  const welcomeAgain = await waitForEvent(client, 'welcome', 10000);
  assert.equal(welcomeAgain.deviceId, client.deviceId);
  assert.equal(client.isConnected(), true);
});

test('RelayClient 裝置識別碼持久化於 storage', () => {
  const storage = memoryStorage();
  const first = new RelayClient({ url: 'ws://example/ws', storage });
  const second = new RelayClient({ url: 'ws://example/ws', storage });
  assert.equal(first.deviceId, second.deviceId);
  assert.match(first.deviceId, /^dev-[A-Za-z0-9_-]+$/);
  const third = new RelayClient({ url: 'ws://example/ws', deviceId: 'fixed-id' });
  assert.equal(third.deviceId, 'fixed-id');
});

test('RelayClient 未提供 WebSocket 實作時 connect 擲錯', () => {
  const client = new RelayClient({ url: 'ws://example/ws', WebSocketImpl: null });
  assert.throws(() => client.connect(), /WebSocket/);
});

test('RelayClient close 停止重連', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const client = new RelayClient({ url: `ws://127.0.0.1:${info.port}/ws` });
  client.connect();
  await waitForEvent(client, 'welcome');
  client.close();
  assert.equal(client.isConnected(), false);
  // close 後不應再重連
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(client.ws, null);
});

test('RelayClient bye 離開房間並從本地集合移除', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const host = new RelayClient({ url: `ws://127.0.0.1:${info.port}/ws` });
  t.after(() => host.close());
  host.connect();
  await waitForEvent(host, 'welcome');
  host.createRoom();
  const created = await waitForEvent(host, 'room-created');
  assert.equal(host.rooms.has(created.roomToken), true);
  host.bye(created.roomToken);
  assert.equal(host.rooms.has(created.roomToken), false);
});

test('RelayClient 收到 error 訊息發出 error 事件', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const client = new RelayClient({ url: `ws://127.0.0.1:${info.port}/ws` });
  t.after(() => client.close());
  client.connect();
  await waitForEvent(client, 'welcome');
  client.joinRoom('000000'); // 不存在的房間代碼
  const error = await waitForEvent(client, 'error');
  assert.match(error.error, /找不到這個房間/);
});
