'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRelayServer } = require('../relay/server');
const { RelayClient } = require('../src/relay-client');
const { RemoteTransfer } = require('../src/remote-transfer');

function waitForEvent(emitter, type, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待事件 ${type} 逾時。`)), timeoutMs);
    emitter.once(type, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** 記憶體版 RTCPeerConnection 工廠：模擬 offer/answer 與資料通道。 */
function memoryRtcFactory() {
  const peers = [];
  const channels = { a: null, b: null };
  function makeChannel(side) {
    const channel = {
      readyState: 'connecting',
      onopen: null,
      onmessage: null,
      send(data) {
        const other = side === 'a' ? channels.b : channels.a;
        if (other?.onmessage) {queueMicrotask(() => other.onmessage({ data }));}
      },
    };
    channels[side] = channel;
    if (channels.a && channels.b) {
      channels.a.readyState = 'open';
      channels.b.readyState = 'open';
      queueMicrotask(() => {
        // 通道建立後才回報連線成功（避免過早切換傳輸通道）
        for (const peer of peers) {
          peer.connectionState = 'connected';
          peer.onconnectionstatechange?.();
        }
        channels.a.onopen?.();
        channels.b.onopen?.();
      });
    }
    return channel;
  }
  return {
    createPeerConnection(config) {
      const peer = {
        config,
        connectionState: 'new',
        onicecandidate: null,
        onconnectionstatechange: null,
        ondatachannel: null,
        createDataChannel: () => makeChannel('a'),
        createOffer: async () => ({ type: 'offer', sdp: 'fake-offer' }),
        createAnswer: async () => ({ type: 'answer', sdp: 'fake-answer' }),
        setLocalDescription: async () => {
          // 模擬 ICE candidate 收集
          queueMicrotask(() => peer.onicecandidate?.({ candidate: { candidate: `candidate-${peers.indexOf(peer)}`, sdpMid: '0', sdpMLineIndex: 0 } }));
        },
        setRemoteDescription: async () => {
          // 主機先建連線（peers[0]），訪客後建（peers[1]）
          if (peers.length === 2 && peer === peers[1]) {
            queueMicrotask(() => peers[1].ondatachannel?.({ channel: makeChannel('b') }));
          }
        },
        addIceCandidate: async () => {},
        close: () => { peer.connectionState = 'closed'; },
      };
      peers.push(peer);
      return peer;
    },
  };
}

/** 永不連通的 RTC 工廠（模擬 NAT 阻擋 → 回退中繼）。 */
function deadRtcFactory() {
  return {
    createPeerConnection() {
      return {
        connectionState: 'new',
        onicecandidate: null,
        onconnectionstatechange: null,
        ondatachannel: null,
        createDataChannel: () => ({ readyState: 'connecting', onopen: null, onmessage: null, send: () => {} }),
        createOffer: async () => ({ type: 'offer', sdp: 'fake' }),
        createAnswer: async () => ({ type: 'answer', sdp: 'fake' }),
        setLocalDescription: async () => {},
        setRemoteDescription: async () => {},
        addIceCandidate: async () => {},
        close: () => {},
      };
    },
  };
}

async function buildSession(t, options = {}) {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const url = `ws://127.0.0.1:${info.port}/ws`;
  const hostClient = new RelayClient({ url, deviceName: '主機', platform: 'test' });
  const guestClient = new RelayClient({ url, deviceName: '訪客', platform: 'test' });
  hostClient.connect();
  guestClient.connect();
  await Promise.all([waitForEvent(hostClient, 'welcome'), waitForEvent(guestClient, 'welcome')]);

  const host = new RemoteTransfer({ client: hostClient, rtcFactory: options.rtcFactory || null, chunkSize: options.chunkSize || 4096, p2pTimeoutMs: options.p2pTimeoutMs || 8000 });
  const guest = new RemoteTransfer({ client: guestClient, rtcFactory: options.rtcFactory || null, chunkSize: options.chunkSize || 4096, p2pTimeoutMs: options.p2pTimeoutMs || 8000 });
  t.after(() => { host.close(); guest.close(); hostClient.close(); guestClient.close(); });

  const room = await host.host();
  const joined = await guest.join(room.roomCode);
  assert.equal(joined.host.id, hostClient.deviceId);

  // 主機收到訪客加入 → 核准
  await waitForEvent(host, 'room-state');
  host.approve(guestClient.deviceId, true);

  // 雙方建立安全通道（交換金鑰）
  await Promise.all([waitForEvent(host, 'secured'), waitForEvent(guest, 'secured')]);
  // 等 transport 決定（p2p 或 relay）
  if (host.transport) { /* transport 已設定 */ }
  return { host, guest, hostClient, guestClient };
}

test('遠端傳輸：中繼通道端到端傳檔（含多區塊）', async (t) => {
  const { host, guest } = await buildSession(t);
  const payload = new Uint8Array(20 * 1024 + 123);
  for (let index = 0; index < payload.length; index += 1) {payload[index] = index % 256;}
  const received = waitForEvent(guest, 'file-received');
  host.sendFile(payload, { name: '跨網路測試.bin' });
  const file = await received;
  assert.equal(file.name, '跨網路測試.bin');
  assert.equal(file.size, payload.length);
  assert.deepEqual(file.data, payload);
});

test('遠端傳輸：雙向互傳', async (t) => {
  const { host, guest } = await buildSession(t);
  const toGuest = waitForEvent(guest, 'file-received');
  host.sendFile(new Uint8Array([1, 2, 3, 4]), { name: '主機→訪客.bin' });
  const received = await toGuest;
  assert.deepEqual(received.data, new Uint8Array([1, 2, 3, 4]));

  const toHost = waitForEvent(host, 'file-received');
  guest.sendFile(new Uint8Array([9, 8, 7]), { name: '訪客→主機.bin' });
  const back = await toHost;
  assert.deepEqual(back.data, new Uint8Array([9, 8, 7]));
  assert.equal(back.name, '訪客→主機.bin');
});

test('遠端傳輸：WebRTC P2P 優先（模擬成功握手）', async (t) => {
  const { host, guest } = await buildSession(t, { rtcFactory: memoryRtcFactory() });
  const received = waitForEvent(guest, 'file-received');
  host.sendFile(new Uint8Array([42, 43, 44]), { name: 'p2p.bin' });
  const file = await received;
  assert.deepEqual(file.data, new Uint8Array([42, 43, 44]));
  assert.equal(host.transport.kind, 'p2p');
  assert.equal(guest.transport.kind, 'p2p');
  // 關閉時關閉 P2P 連線
  host.close();
  assert.equal(host.p2p.peer.connectionState, 'closed');
});

test('遠端傳輸：WebRTC 失敗時回退中繼通道', async (t) => {
  const { host, guest } = await buildSession(t, { rtcFactory: deadRtcFactory(), p2pTimeoutMs: 100 });
  const received = waitForEvent(guest, 'file-received');
  host.sendFile(new Uint8Array([7, 8, 9]), { name: 'fallback.bin' });
  const file = await received;
  assert.deepEqual(file.data, new Uint8Array([7, 8, 9]));
  assert.equal(host.transport.kind, 'relay');
});

test('遠端傳輸：丟失區塊經 request/resend 恢復', async (t) => {
  const { host, guest } = await buildSession(t);
  // 攔截發送端（主機）的 sendFrame：第一個資料區塊（seq 0）假裝送不出去
  const client = host.client;
  const original = client.sendFrame.bind(client);
  let droppedOnce = false;
  client.sendFrame = (roomToken, frame) => {
    if (!droppedOnce && frame.seq === 0) {
      droppedOnce = true;
      return true; // 模擬網路丟失
    }
    return original(roomToken, frame);
  };
  const payload = new Uint8Array(10 * 1024);
  const received = waitForEvent(guest, 'file-received');
  host.sendFile(payload, { name: '重試測試.bin' });
  const file = await received;
  assert.deepEqual(file.data, payload);
  assert.equal(droppedOnce, true);
});

test('遠端傳輸：未建立安全通道時 sendFile 擲錯', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const client = new RelayClient({ url: `ws://127.0.0.1:${info.port}/ws` });
  const transfer = new RemoteTransfer({ client });
  assert.throws(() => transfer.sendFile(new Uint8Array([1])), /安全通道/);
  transfer.close();
});

test('遠端傳輸：壞區塊校驗與解密失敗觸發重傳要求', async (t) => {
  const { host, guest } = await buildSession(t);
  const { encryptBytes, bytesToBase64 } = require('../src/crypto');
  const textEncoder = new TextEncoder();

  // 直接註冊檔案中繼資料以建立組裝器
  guest.onFileMeta(textEncoder.encode(JSON.stringify({ name: '校驗測試.bin', size: 3, total: 1, fileId: 'checksum-file' })));

  // 壞校驗區塊 → 要求重傳
  const cipher = await encryptBytes(host.sessionKey, new Uint8Array([1, 2, 3]));
  const requestSeen = waitForEvent(host.client, 'request');
  await guest.onFrame({
    fileId: 'checksum-file', seq: 0, total: 1,
    checksum: '0'.repeat(64), iv: bytesToBase64(cipher.iv), data: bytesToBase64(cipher.data),
  });
  const req = await requestSeen;
  assert.deepEqual(req.missing, [0]);

  // 解密失敗區塊 → 要求重傳
  const badRequest = waitForEvent(host.client, 'request');
  await guest.onFrame({ fileId: 'checksum-file', seq: 0, total: 1, checksum: '', iv: 'not-base64!!', data: 'also-bad' });
  const req2 = await badRequest;
  assert.deepEqual(req2.missing, [0]);
});

test('遠端傳輸：approve 拒絕後不建立安全通道', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const url = `ws://127.0.0.1:${info.port}/ws`;
  const hostClient = new RelayClient({ url });
  const guestClient = new RelayClient({ url });
  hostClient.connect();
  guestClient.connect();
  await Promise.all([waitForEvent(hostClient, 'welcome'), waitForEvent(guestClient, 'welcome')]);
  const host = new RemoteTransfer({ client: hostClient });
  const guest = new RemoteTransfer({ client: guestClient });
  t.after(() => { host.close(); guest.close(); hostClient.close(); guestClient.close(); });
  const room = await host.host();
  await guest.join(room.roomCode);
  await waitForEvent(host, 'room-state');
  host.approve(guestClient.deviceId, false);
  const state = await waitForEvent(guest, 'room-state');
  assert.equal(state.members.find((member) => member.id === guestClient.deviceId).state, 'rejected');
  assert.equal(guest.sessionKey, null);
});

test('遠端傳輸：refresh 重送加入訊息；未加入前不動作', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const url = `ws://127.0.0.1:${info.port}/ws`;
  const client = new RelayClient({ url });
  const transfer = new RemoteTransfer({ client });
  t.after(() => { transfer.close(); client.close(); });

  transfer.refresh(); // roomToken 未設定 → 直接回傳
  client.connect();
  await waitForEvent(client, 'welcome');
  await transfer.host();
  const hostSawJoin = waitForEvent(transfer, 'room-state');
  transfer.refresh();
  const state = await hostSawJoin;
  assert.equal(state.members[0].id, client.deviceId);
});

test('遠端傳輸：close 清理資源與 bye', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const url = `ws://127.0.0.1:${info.port}/ws`;
  const hostClient = new RelayClient({ url });
  hostClient.connect();
  await waitForEvent(hostClient, 'welcome');
  const host = new RemoteTransfer({ client: hostClient });
  const room = await host.host();
  const closed = waitForEvent(host, 'closed');
  host.close();
  await closed;
  // bye 訊息為非同步：等待伺服器移除房間
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(relay.registry.get(room.roomToken), null); // 成員清空後房間移除
  hostClient.close();
});
