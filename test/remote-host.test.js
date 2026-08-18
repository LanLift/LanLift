'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createRelayServer } = require('../relay/server');
const { RelayClient } = require('../src/relay-client');
const { RemoteTransfer } = require('../src/remote-transfer');
const { RemoteHost, sanitizeName } = require('../src/remote-host');

function waitForEvent(emitter, type, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待事件 ${type} 逾時。`)), timeoutMs);
    emitter.once(type, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function buildEnvironment(t) {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'lanlift-remotehost-'));
  t.after(() => fs.rm(sandbox, { recursive: true, force: true }));
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const signalingUrl = `ws://127.0.0.1:${info.port}/ws`;
  const receiveDir = path.join(sandbox, 'received');
  return { sandbox, receiveDir, signalingUrl };
}

function guestPeer(url) {
  const client = new RelayClient({ url, deviceName: '行動裝置', platform: 'android' });
  const transfer = new RemoteTransfer({ client });
  client.connect();
  return { client, transfer };
}

test('RemoteHost 建立房間、核准、雙向傳檔（中繼通道）', async (t) => {
  const { receiveDir, signalingUrl } = await buildEnvironment(t);
  const host = new RemoteHost({
    receiveDir,
    getProfile: () => ({ signalingUrl, turnUrls: [], username: '', credential: '' }),
  });
  t.after(() => host.close());

  const room = await host.createSession();
  assert.match(room.roomCode, /^[0-9A-F]{6}$/);
  assert.equal(host.getState().active, true);

  const guest = guestPeer(signalingUrl);
  t.after(() => { guest.transfer.close(); guest.client.close(); });
  await waitForEvent(guest.client, 'welcome');
  await guest.transfer.join(room.roomCode);

  // 主機看到待核准訪客
  await waitForEvent(host, 'update');
  assert.equal(host.getState().peers.length, 1);
  assert.equal(host.getState().peers[0].state, 'pending');

  host.approve(guest.client.deviceId, true);
  await Promise.all([waitForEvent(host.transfer, 'secured'), waitForEvent(guest.transfer, 'secured')]);

  // 主機 → 行動裝置（sendFile 讀取本機檔案路徑）
  const receivedByGuest = waitForEvent(guest.transfer, 'file-received');
  const sendDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanlift-send-'));
  t.after(() => fs.rm(sendDir, { recursive: true, force: true }));
  const sandboxFile = path.join(sendDir, '遠端檔案.txt');
  await fs.writeFile(sandboxFile, 'remote payload 123');
  const sent = await host.sendFile(sandboxFile);
  assert.equal(sent.name, '遠端檔案.txt');
  const file = await receivedByGuest;
  assert.equal(Buffer.from(file.data).toString('utf8'), 'remote payload 123');

  // 行動裝置 → 主機（寫入接收資料夾）
  const receivedByHost = waitForEvent(host, 'file-received');
  guest.transfer.sendFile(new Uint8Array([5, 6, 7, 8]), { name: '手機照片.jpg' });
  const record = await receivedByHost;
  assert.equal(record.name, '手機照片.jpg');
  const saved = await fs.readdir(receiveDir);
  assert.equal(saved.length, 1);
  assert.equal(sanitizeName(record.name), saved[0]);
  assert.deepEqual(await fs.readFile(path.join(receiveDir, saved[0])), Buffer.from([5, 6, 7, 8]));

  // 狀態摘要
  const state = host.getState();
  assert.equal(state.received.length, 1);
  assert.equal(state.secured, true);

  // 關閉後狀態清空
  host.close();
  assert.equal(host.getState().active, false);
  assert.equal(host.getState().roomCode, null);
});

test('RemoteHost 未選擇伺服器時擲錯；未建立傳輸時 approve/sendFile 擲錯', async (t) => {
  const { receiveDir } = await buildEnvironment(t);
  const noProfile = new RemoteHost({ receiveDir });
  await assert.rejects(() => noProfile.createSession(), /自訂伺服器/);
  assert.throws(() => noProfile.approve('x', true), /尚未建立/);

  const host = new RemoteHost({ receiveDir, getProfile: () => ({ signalingUrl: 'ws://127.0.0.1:1/ws' }) });
  await assert.rejects(() => host.sendFile('/tmp/anything.txt'), /安全通道/);
});

test('RemoteHost 收到伺服器錯誤時發出 error 事件', async (t) => {
  const { receiveDir, signalingUrl } = await buildEnvironment(t);
  const host = new RemoteHost({ receiveDir, getProfile: () => ({ signalingUrl }) });
  t.after(() => host.close());
  await host.createSession();
  const errorSeen = waitForEvent(host, 'error');
  host.transfer.client.emit('error', { error: '測試錯誤' });
  const error = await errorSeen;
  assert.match(error.message, /測試錯誤/);
});

test('sanitizeName 清洗檔名', () => {
  // 以 path.basename 取最後一段後再清洗非法字元
  assert.equal(sanitizeName('a/b\\c:d'), 'b_c_d');
  assert.equal(sanitizeName(''), 'unnamed-file');
  assert.equal(sanitizeName(null), 'unnamed-file');
  assert.equal(sanitizeName('...'), 'unnamed-file');
});
