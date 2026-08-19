'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRelayServer } = require('../relay/server');
const { connect, send, waitFor, waitForError, collectRoomStates } = require('./helpers/ws');

async function startServer(t, options = {}) {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } }, ...options });
  const info = await relay.start();
  t.after(() => relay.stop());
  return { relay, url: `ws://127.0.0.1:${info.port}/ws` };
}

/** 建立一個已註冊主機與其房間。 */
async function setupHost(url) {
  const host = await connect(url);
  send(host, 'register', { deviceId: 'host-1', name: '主機', platform: 'test' });
  await waitFor(host, 'welcome');
  send(host, 'create-room', { name: '主機', publicKey: 'host-pub' });
  const created = await waitFor(host, 'room-created');
  return { host, created };
}

/** 建立一個已註冊訪客。 */
async function setupGuest(url) {
  const guest = await connect(url);
  send(guest, 'register', { deviceId: 'guest-1', name: '訪客', platform: 'test' });
  await waitFor(guest, 'welcome');
  return guest;
}

/** 訪客加入並等待主機看到訪客。 */
async function joinAndSync(url, guest, created, host) {
  const hostSeesGuest = collectRoomStates(host, (payload) => payload.members.some((member) => member.id === 'guest-1'));
  send(guest, 'join-room', { roomCode: created.roomCode.toLowerCase(), name: '訪客', publicKey: 'guest-pub' });
  const joined = await waitFor(guest, 'room-state');
  await hostSeesGuest;
  return joined;
}

/** 主機核准並等待雙方收到 approved 狀態。 */
async function approveAndSync(host, guest, created) {
  const guestApproved = collectRoomStates(guest, (payload) => payload.members.find((member) => member.id === 'guest-1')?.state === 'approved');
  const hostApproved = collectRoomStates(host, (payload) => payload.members.find((member) => member.id === 'guest-1')?.state === 'approved');
  send(host, 'approve', { roomToken: created.roomToken, memberId: 'guest-1', approved: true });
  await Promise.all([guestApproved, hostApproved]);
}

test('訊號伺服器：註冊、錯誤輸入與心跳', async (t) => {
  const { url } = await startServer(t);

  const ws = await connect(url);
  send(ws, 'register', { deviceId: 'dev-1', name: '測試裝置', platform: 'test' });
  const welcome = await waitFor(ws, 'welcome');
  assert.equal(welcome.deviceId, 'dev-1');
  assert.ok(welcome.serverTime);

  // 非法 JSON → error
  ws.send('not-json');
  const error = await waitForError(ws);
  assert.match(error.error, /JSON/);

  // 未知訊息類型 → error
  ws.send(JSON.stringify({ v: 1, type: 'nope', payload: {} }));
  const err2 = await waitForError(ws);
  assert.match(err2.error, /未知的訊息類型/);

  // 未註冊即建房 → error
  const fresh = await connect(url);
  send(fresh, 'create-room', {});
  const err3 = await waitForError(fresh);
  assert.match(err3.error, /註冊/);

  // 心跳 ping → pong
  send(ws, 'ping', { time: 1 });
  const pong = await waitFor(ws, 'pong');
  assert.equal(typeof pong.time, 'number');

  ws.close();
  fresh.close();
});

test('訊號伺服器：建房、加入、核准與 room-state 廣播', async (t) => {
  const { relay, url } = await startServer(t);
  const { host, created } = await setupHost(url);
  assert.match(created.roomCode, /^[0-9A-F]{6}$/);
  assert.equal(created.members.length, 1);

  const guest = await setupGuest(url);
  const joined = await joinAndSync(url, guest, created, host);
  assert.equal(joined.members.length, 2);
  assert.equal(joined.members.find((member) => member.id === 'guest-1').state, 'pending');

  await approveAndSync(host, guest, created);
  const state = relay.registry.members(relay.registry.get(created.roomToken));
  assert.equal(state.find((member) => member.id === 'guest-1').state, 'approved');

  // 未知房間代碼 → error
  const errPromise = waitForError(guest);
  send(guest, 'join-room', { roomCode: '000000', name: '訪客' });
  const err = await errPromise;
  assert.match(err.error, /找不到這個房間/);

  guest.close();
  host.close();
});

test('訊號伺服器：signal 轉發（未核准不可用）', async (t) => {
  const { url } = await startServer(t);
  const { host, created } = await setupHost(url);
  const guest = await setupGuest(url);
  await joinAndSync(url, guest, created, host);

  // 未核准時 signal 被拒
  const deniedPromise = waitForError(guest);
  send(guest, 'signal', { roomToken: created.roomToken, target: 'host-1', data: { candidate: 'x' } });
  const denied = await deniedPromise;
  assert.match(denied.error, /核准/);

  await approveAndSync(host, guest, created);

  // 核准後可轉發
  const signalPromise = waitFor(host, 'signal');
  send(guest, 'signal', { roomToken: created.roomToken, target: 'host-1', data: { description: { type: 'offer', sdp: 'fake' } } });
  const signal = await signalPromise;
  assert.equal(signal.from, 'guest-1');
  assert.equal(signal.data.description.type, 'offer');

  // 目標不存在
  const missingPromise = waitForError(guest);
  send(guest, 'signal', { roomToken: created.roomToken, target: 'nobody', data: {} });
  const missing = await missingPromise;
  assert.match(missing.error, /目標/);

  guest.close();
  host.close();
});

test('訊號伺服器：peer-key 交換寫入成員狀態', async (t) => {
  const { url } = await startServer(t);
  const { host, created } = await setupHost(url);
  const guest = await setupGuest(url);
  await joinAndSync(url, guest, created, host);
  await approveAndSync(host, guest, created);

  const keyState = collectRoomStates(host, (payload) => payload.members.find((member) => member.id === 'guest-1')?.keySalt === 'salt-123');
  send(guest, 'peer-key', { roomToken: created.roomToken, publicKey: 'guest-pub', salt: 'salt-123' });
  const states = await keyState;
  const guestMember = states.at(-1).members.find((member) => member.id === 'guest-1');
  assert.equal(guestMember.publicKey, 'guest-pub');
  assert.equal(guestMember.keySalt, 'salt-123');

  // 未核准成員無法交換金鑰
  const fresh = await connect(url);
  send(fresh, 'register', { deviceId: 'guest-2', name: '未核准', platform: 'test' });
  await waitFor(fresh, 'welcome');
  const deniedPromise = waitForError(fresh);
  send(fresh, 'peer-key', { roomToken: created.roomToken, publicKey: 'x', salt: 'y' });
  const denied = await deniedPromise;
  assert.match(denied.error, /核准/);

  guest.close();
  host.close();
  fresh.close();
});

test('訊號伺服器：relay-frame 僅轉發給已核准成員', async (t) => {
  const { url } = await startServer(t);
  const { host, created } = await setupHost(url);
  const guest = await setupGuest(url);
  await joinAndSync(url, guest, created, host);

  // 未核准送出 frame → 發送端收到可重試的錯誤
  const deniedPromise = waitForError(guest);
  send(guest, 'relay-frame', { roomToken: created.roomToken, fileId: 'f1', seq: 0, total: 1, checksum: 'c', iv: 'iv', data: 'ZGF0YQ==' });
  const denied = await deniedPromise;
  assert.equal(denied.retryable, true);

  await approveAndSync(host, guest, created);

  const framePromise = waitFor(host, 'relay-frame');
  send(guest, 'relay-frame', { roomToken: created.roomToken, fileId: 'f1', seq: 0, total: 1, checksum: 'c', iv: 'iv', data: 'ZGF0YQ==' });
  const frame = await framePromise;
  assert.equal(frame.from, 'guest-1');
  assert.equal(frame.fileId, 'f1');
  assert.equal(frame.data, 'ZGF0YQ==');

  // ACK 由主機回傳給訪客
  const ackPromise = waitFor(guest, 'relay-ack');
  send(host, 'relay-ack', { roomToken: created.roomToken, fileId: 'f1', seq: 0 });
  const ack = await ackPromise;
  assert.equal(ack.seq, 0);

  // 缺塊要求
  const requestPromise = waitFor(host, 'relay-request');
  send(guest, 'relay-request', { roomToken: created.roomToken, fileId: 'f1', missing: [0] });
  const request = await requestPromise;
  assert.deepEqual(request.missing, [0]);

  guest.close();
  host.close();
});

test('訊號伺服器：伺服器權杖認證', async (t) => {
  const { url } = await startServer(t, { serverToken: 'secret-token' });

  const ws = await connect(url);
  const deniedPromise = waitForError(ws);
  send(ws, 'register', { deviceId: 'dev-x', name: 'X', platform: 'test', token: 'wrong' });
  const denied = await deniedPromise;
  assert.match(denied.error, /認證/);

  const ok = await connect(url);
  send(ok, 'register', { deviceId: 'dev-y', name: 'Y', platform: 'test', token: 'secret-token' });
  const welcome = await waitFor(ok, 'welcome');
  assert.equal(welcome.deviceId, 'dev-y');

  ws.close();
  ok.close();
});

test('訊號伺服器：bye 移除成員並廣播', async (t) => {
  const { relay, url } = await startServer(t);
  const { host, created } = await setupHost(url);
  const guest = await setupGuest(url);
  await joinAndSync(url, guest, created, host);

  const hostSawOne = collectRoomStates(host, (payload) => payload.members.length === 1);
  send(guest, 'bye', { roomToken: created.roomToken });
  const states = await hostSawOne;
  assert.equal(states.at(-1).members.length, 1);
  assert.equal(relay.registry.members(relay.registry.get(created.roomToken)).length, 1);

  guest.close();
  host.close();
});

test('訊號伺服器：斷線時從房間移除成員', async (t) => {
  const { url } = await startServer(t);
  const { host, created } = await setupHost(url);
  const guest = await setupGuest(url);
  await joinAndSync(url, guest, created, host);

  const hostSawOne = collectRoomStates(host, (payload) => payload.members.length === 1);
  guest.close();
  const states = await hostSawOne;
  assert.equal(states.at(-1).members.length, 1);

  host.close();
});

test('訊號伺服器：錯誤 roomToken 與重複註冊', async (t) => {
  const { url } = await startServer(t);
  const ws = await connect(url);
  send(ws, 'register', { deviceId: 'dup-1', name: 'A', platform: 'test' });
  await waitFor(ws, 'welcome');

  // 重複 deviceId 註冊會取代舊連線
  const other = await connect(url);
  send(other, 'register', { deviceId: 'dup-1', name: 'B', platform: 'test' });
  const welcome = await waitFor(other, 'welcome');
  assert.equal(welcome.deviceId, 'dup-1');

  // 無效 roomToken
  const errPromise = waitForError(other);
  send(other, 'approve', { roomToken: 'nope', memberId: 'x', approved: true });
  const err = await errPromise;
  assert.match(err.error, /找不到這個房間/);

  ws.close();
  other.close();
});
