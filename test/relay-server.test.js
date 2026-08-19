'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createRelayServer, loadConfig, parseArgs, helpText, main } = require('../relay/server');
const { connect, send, waitFor } = require('./helpers/ws');

test('relay server：health、遠端頁面與 404', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());

  const health = await (await fetch(`http://127.0.0.1:${info.port}/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.rooms, 0);

  const page = await fetch(`http://127.0.0.1:${info.port}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /LanLift/);

  const script = await fetch(`http://127.0.0.1:${info.port}/remote-web.js`);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /LanLiftRemote|createRemoteApp|lanlift/);

  const missing = await fetch(`http://127.0.0.1:${info.port}/nope`);
  assert.equal(missing.status, 404);
});

test('relay server：stats 需要管理權杖', async (t) => {
  const relay = createRelayServer({ config: { port: 0, adminToken: 'admin' } });
  const info = await relay.start();
  t.after(() => relay.stop());

  const noAuth = await fetch(`http://127.0.0.1:${info.port}/stats`);
  assert.equal(noAuth.status, 401);
  const ok = await fetch(`http://127.0.0.1:${info.port}/stats`, { headers: { Authorization: 'Bearer admin' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {});
});

test('relay server：ws 端到端（host/guest/approve/frame）', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const info = await relay.start();
  t.after(() => relay.stop());
  const url = `ws://127.0.0.1:${info.port}/ws`;

  const host = await connect(url);
  send(host, 'register', { deviceId: 'h1', name: 'H', platform: 't' });
  await waitFor(host, 'welcome');
  send(host, 'create-room', { name: 'H', publicKey: 'k' });
  const created = await waitFor(host, 'room-created');

  const guest = await connect(url);
  send(guest, 'register', { deviceId: 'g1', name: 'G', platform: 't' });
  await waitFor(guest, 'welcome');
  send(guest, 'join-room', { roomCode: created.roomCode, name: 'G', publicKey: 'k2' });
  await waitFor(guest, 'room-state');
  send(host, 'approve', { roomToken: created.roomToken, memberId: 'g1', approved: true });

  // 等 host 收到 approved room-state
  const state = await new Promise((resolve) => {
    const handler = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === 'room-state' && message.payload.members.some((member) => member.id === 'g1' && member.state === 'approved')) {
        host.removeEventListener('message', handler);
        resolve(message.payload);
      }
    };
    host.addEventListener('message', handler);
  });
  assert.equal(state.members.length, 2);

  send(guest, 'relay-frame', { roomToken: created.roomToken, fileId: 'f', seq: 0, total: 1, checksum: 'c', iv: 'i', data: 'ZA==' });
  const frame = await waitFor(host, 'relay-frame');
  assert.equal(frame.fileId, 'f');

  // stats 記錄轉發
  const statsResponse = await fetch(`http://127.0.0.1:${info.port}/stats`);
  const stats = await statsResponse.json();
  assert.equal(stats[created.roomCode].hub.frames, 1);

  host.close();
  guest.close();
});

test('relay server：loadConfig 與 parseArgs 與 helpText', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lanlift-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'config.json');
  await fs.writeFile(filePath, JSON.stringify({ port: 9000, serverToken: 'tok', limits: { bytesPerSecond: 100 } }), 'utf8');
  const config = loadConfig(filePath);
  assert.equal(config.port, 9000);
  assert.equal(config.serverToken, 'tok');

  assert.deepEqual(parseArgs(['node', 'server.js']), { config: path.join(__dirname, '..', 'relay', 'config.example.json'), port: null, host: null });
  const parsed = parseArgs(['node', 'server.js', '--config', '/tmp/x.json', '--port', '9999', '--host', '127.0.0.1', '--help']);
  assert.equal(parsed.config, '/tmp/x.json');
  assert.equal(parsed.port, 9999);
  assert.equal(parsed.host, '127.0.0.1');
  assert.equal(parsed.help, true);
  assert.match(helpText(), /中繼伺服器/);

  await assert.throws(() => loadConfig(path.join(root, 'missing.json')));
  await fs.writeFile(path.join(root, 'broken.json'), '{nope', 'utf8');
  assert.throws(() => loadConfig(path.join(root, 'broken.json')));
});

test('relay server：伺服器權杖拒絕未授權註冊', async (t) => {
  const relay = createRelayServer({ config: { port: 0 }, serverToken: 'shared-secret' });
  const info = await relay.start();
  t.after(() => relay.stop());
  const ws = await connect(`ws://127.0.0.1:${info.port}/ws`);
  send(ws, 'register', { deviceId: 'x', name: 'X', platform: 't', token: 'bad' });
  const denied = await waitFor(ws, 'error');
  assert.match(denied.error, /認證/);
  ws.close();
});

test('relay server：main 入口（help 與啟動）', async () => {
  const help = await main(['node', 'server.js', '--help']);
  assert.deepEqual(help, { help: true });

  const relay = await main(['node', 'server.js', '--config', '/nonexistent-config.json', '--port', '0'], { installSignals: false });
  try {
    const health = await (await fetch(`http://127.0.0.1:${relay.server.address().port}/health`)).json();
    assert.equal(health.ok, true);
  } finally {
    await relay.stop();
  }
});

test('relay server：子程序入口啟動並以 SIGTERM 優雅關閉', async () => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['relay/server.js', '--config', '/nonexistent-config.json', '--port', '0'], { cwd: require('path').join(__dirname, '..') });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('子程序啟動逾時。')), 8000);
    const check = () => {
      if (output.includes('已啟動')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', check);
  });
  const exit = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  child.kill('SIGTERM');
  assert.equal(await exit, 0);
});

test('relay server：靜態資源讀取失敗回傳 500', async (t) => {
  const relay = createRelayServer({ config: { port: 0 }, remoteHtmlPath: '/nonexistent/remote.html', remoteWebPath: '/nonexistent/remote-web.js' });
  const info = await relay.start();
  t.after(() => relay.stop());
  const page = await fetch(`http://127.0.0.1:${info.port}/`);
  assert.equal(page.status, 500);
  const script = await fetch(`http://127.0.0.1:${info.port}/remote-web.js`);
  assert.equal(script.status, 500);
});

test('relay server：TLS 憑證啟用 wss/https', async (t) => {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanlift-tls-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cert = path.join(dir, 'cert.pem');
  const key = path.join(dir, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-days', '1', '-nodes', '-subj', '/CN=localhost']);

  const relay = createRelayServer({ config: { port: 0 }, tls: { cert, key } });
  const info = await relay.start();
  t.after(() => relay.stop());
  assert.equal(info.tls, true);
  const https = require('node:https');
  const rawHealth = await new Promise((resolve, reject) => {
    https.get({ host: '127.0.0.1', port: info.port, path: '/health', rejectUnauthorized: false }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
  assert.equal(rawHealth.ok, true);
});

test('relay server：損毀設定檔使入口以失敗碼退出', async () => {
  const { spawn } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanlift-broken-'));
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{not json');
  const child = spawn(process.execPath, ['relay/server.js', '--config', broken], { cwd: path.join(__dirname, '..') });
  const exit = await new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  assert.equal(exit, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('relay server：createRelayServer 事件（room-created / registered）', async (t) => {
  const relay = createRelayServer({ config: { port: 0, limits: { bytesPerSecond: 0 } } });
  const registered = new Promise((resolve) => relay.signaling.once('registered', resolve));
  const info = await relay.start();
  t.after(() => relay.stop());
  const ws = await connect(`ws://127.0.0.1:${info.port}/ws`);
  send(ws, 'register', { deviceId: 'e1', name: 'E', platform: 't' });
  const reg = await registered;
  assert.equal(reg.deviceId, 'e1');
  ws.close();
});
