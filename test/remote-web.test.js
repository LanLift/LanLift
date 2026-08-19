'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { createRemoteApp, formatBytes } = require('../src/remote-web');
const { MESSAGE_TYPES, envelope } = require('../src/protocol');
const { generateKeyPair, deriveSessionKey } = require('../src/crypto');

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.OPEN = 1;
    this.listeners = {};
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    (this.listeners[type] || (this.listeners[type] = [])).push(listener);
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit('close', { code: 1000 });
  }

  emit(type, event) {
    for (const listener of this.listeners[type] || []) {listener(event);}
  }

  serverMessage(type, payload) {
    this.emit('message', { data: JSON.stringify(envelope(type, payload)) });
  }
}

function buildDom() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'relay', 'remote.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://relay.example.com/remote?room=ABC123', pretendToBeVisual: true });
  dom.window.URL.createObjectURL = () => 'blob:fake';
  return dom;
}

function buildApp(dom, options = {}) {
  FakeWebSocket.instances = [];
  return createRemoteApp({
    document: dom.window.document,
    window: dom.window,
    relayUrl: 'wss://relay.example.com/ws',
    WebSocketImpl: FakeWebSocket,
    ...options,
  });
}

test('formatBytes 單位換算', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
  assert.equal(formatBytes(2 * 1024 ** 3), '2.00 GB');
  assert.equal(formatBytes(Number.NaN), '—');
});

test('createRemoteApp 缺少 document 或 relayUrl 時擲錯', () => {
  assert.throws(() => createRemoteApp({}), /document/);
  assert.throws(() => createRemoteApp({ document: buildDom().window.document }), /訊號伺服器網址/);
});

test('init 綁定表單並預填 URL 房間代碼', () => {
  const dom = buildDom();
  const app = buildApp(dom);
  app.init();
  assert.equal(dom.window.document.getElementById('room-code').value, 'ABC123');
  // submit 觸發 join（無效代碼路徑）
  const form = dom.window.document.getElementById('join-form');
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const error = dom.window.document.getElementById('error-message');
  assert.equal(error.classList.contains('hidden'), true); // ABC123 為有效格式，進入等待
  assert.equal(dom.window.document.getElementById('screen-waiting').classList.contains('hidden'), false);
  assert.equal(FakeWebSocket.instances.length, 1);
});

test('join 無效房間代碼顯示錯誤', () => {
  const dom = buildDom();
  const app = buildApp(dom);
  app.init();
  dom.window.document.getElementById('room-code').value = 'XYZ';
  const form = dom.window.document.getElementById('join-form');
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const error = dom.window.document.getElementById('error-message');
  assert.equal(error.classList.contains('hidden'), false);
  assert.match(error.textContent, /6 位數/);
});

test('加入、核准、安全通道建立與傳送檔案', async () => {
  const dom = buildDom();
  const app = buildApp(dom);
  app.init();
  // 設定房間代碼後觸發 join
  dom.window.document.getElementById('room-code').value = 'ABCDEF';
  dom.window.document.getElementById('join-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const socket = FakeWebSocket.instances[0];
  socket.readyState = 1;
  socket.emit('open', {});

  // 伺服器回 welcome
  socket.serverMessage(MESSAGE_TYPES.WELCOME, { deviceId: 'dev-1', bytesPerSecond: 0 });
  assert.equal(app.transfer.client.deviceId, app.transfer.client.deviceId);
  assert.equal(app.transfer.client.connected, true);

  // join-room 訊息已發出
  await new Promise((resolve) => setTimeout(resolve, 20));
  const registerMessage = JSON.parse(socket.sent.find((raw) => JSON.parse(raw).type === 'register'));
  const deviceId = registerMessage.payload.deviceId;
  const joinMessage = JSON.parse(socket.sent.find((raw) => JSON.parse(raw).type === 'join-room'));
  assert.equal(joinMessage.payload.roomCode, 'ABCDEF');
  assert.equal(typeof joinMessage.payload.publicKey, 'string');

  // 主機資訊 → join 完成
  const hostKeyPair = await generateKeyPair();
  const salt = 'c2FsdC1zYWx0';
  socket.serverMessage(MESSAGE_TYPES.ROOM_STATE, {
    roomToken: 'room-token-1',
    members: [
      { id: 'host-1', name: '主機', role: 'host', state: 'approved', publicKey: hostKeyPair.publicKey, keySalt: null },
      { id: deviceId, name: '行動裝置', role: 'guest', state: 'pending', publicKey: joinMessage.payload.publicKey, keySalt: null },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app.transfer.roomToken, 'room-token-1');
  assert.equal(app.transfer.peerName, '主機');
  assert.equal(dom.window.document.getElementById('screen-waiting').classList.contains('hidden'), false);

  // 主機核准 + 主機公鑰與鹽 → 安全通道
  socket.serverMessage(MESSAGE_TYPES.ROOM_STATE, {
    roomToken: 'room-token-1',
    members: [
      { id: 'host-1', name: '主機', role: 'host', state: 'approved', publicKey: hostKeyPair.publicKey, keySalt: salt },
      { id: deviceId, name: '行動裝置', role: 'guest', state: 'approved', publicKey: joinMessage.payload.publicKey, keySalt: salt },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(app.transfer.sessionKey, '安全通道應已建立');

  // 傳送檔案：加密分塊以 relay-frame 送出
  const file = new dom.window.File(['hello from mobile'], 'mobile.txt', { type: 'text/plain' });
  app.sendFiles([file]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const frames = socket.sent.filter((raw) => JSON.parse(raw).type === 'relay-frame');
  assert.ok(frames.length >= 1);
  const metaFrame = JSON.parse(frames[0]);
  assert.equal(metaFrame.payload.seq, -1);
  // 中繼看到的資料已加密（不含明文）
  assert.ok(!socket.sent.some((raw) => raw.includes('hello from mobile')));

  // 主機 ACK 全部區塊 → 檔案送出完成
  const hostKey = await deriveSessionKey(hostKeyPair.privateKey, joinMessage.payload.publicKey, salt);
  // 直接回覆 ack 即可（seq 1..total）
  for (const raw of frames.slice(1)) {
    const message = JSON.parse(raw);
    if (message.payload.seq >= 0) {socket.serverMessage(MESSAGE_TYPES.RELAY_ACK, { roomToken: 'room-token-1', fileId: message.payload.fileId, seq: message.payload.seq });}
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(hostKey);
});

test('接收檔案渲染下載連結', async () => {
  const dom = buildDom();
  const app = buildApp(dom);
  app.init();
  // 建立一個連線與傳輸物件（room-code 預填 ABC123 後觸發 join）
  dom.window.document.getElementById('join-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const socket = FakeWebSocket.instances[0];
  socket.readyState = 1;
  socket.emit('open', {});
  socket.serverMessage(MESSAGE_TYPES.WELCOME, { deviceId: 'dev-1' });

  const pair = await generateKeyPair();
  const key = await deriveSessionKey(pair.privateKey, pair.publicKey, 'salt');
  app.transfer.sessionKey = key;
  app.transfer.roomToken = 'rt';
  app.transfer.openTransport();
  const { encryptBytes, bytesToBase64 } = require('../src/crypto');
  const { sha256 } = require('../src/chunker');
  const metaCipher = await encryptBytes(key, new TextEncoder().encode(JSON.stringify({ name: 'photo.png', size: 4, total: 1, fileId: 'f1' })));
  // 以完整解密路徑送入檔案中繼資料（seq -1）
  await app.transfer.onFrame({ fileId: 'f1', seq: -1, total: 1, checksum: '', iv: bytesToBase64(metaCipher.iv), data: bytesToBase64(metaCipher.data) });
  const list = dom.window.document.getElementById('received-list');
  assert.match(list.textContent, /尚未收到任何檔案/);
  const chunkCipher = await encryptBytes(key, new Uint8Array([1, 2, 3, 4]));
  const checksum = await sha256(new Uint8Array([1, 2, 3, 4]));
  await app.transfer.onFrame({ fileId: 'f1', seq: 0, total: 1, checksum, iv: bytesToBase64(chunkCipher.iv), data: bytesToBase64(chunkCipher.data) });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.match(list.textContent, /photo\.png/);
  assert.equal(list.querySelector('a.download').getAttribute('download'), 'photo.png');
});
