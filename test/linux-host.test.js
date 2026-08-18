'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, helpText, renderTextQr, startLinuxHost, main } = require('../src/linux-host');

test('parseArgs 解析各選項與預設值', () => {
  const defaults = parseArgs(['node', 'linux-host.js']);
  assert.equal(defaults.port, 0);
  assert.equal(defaults.host, '0.0.0.0');
  assert.equal(defaults.session, null);
  assert.equal(defaults.qr, false);
  assert.equal(defaults.help, false);

  const parsed = parseArgs(['node', 'x', '--port', '8899', '--host', '127.0.0.1', '--receive-dir', '/tmp/rx', '--admin-token', 'tok', '--session', 'peer', '--qr', '--help']);
  assert.equal(parsed.port, 8899);
  assert.equal(parsed.host, '127.0.0.1');
  assert.equal(parsed.receiveDir, '/tmp/rx');
  assert.equal(parsed.adminToken, 'tok');
  assert.equal(parsed.session, 'peer');
  assert.equal(parsed.qr, true);
  assert.equal(parsed.help, true);

  // --session 不帶值時預設 host
  assert.equal(parseArgs(['node', 'x', '--session']).session, 'host');
  assert.equal(parseArgs(['node', 'x', '--session', '--qr']).session, 'host');
});

test('helpText 包含安裝指引', () => {
  const text = helpText();
  assert.match(text, /Linux 主機/);
  assert.match(text, /install-linux\.sh/);
  assert.match(text, /--session/);
});

test('renderTextQr 產生終端 QR 字串', async () => {
  const qr = await renderTextQr('http://192.168.1.10:8899/s/token');
  assert.equal(typeof qr, 'string');
  assert.ok(qr.length > 40);
  assert.match(qr, /[█▀▄ ]/);
});

test('startLinuxHost 啟動服務、自動建立傳輸與管理頁', async (t) => {
  const { server, summary } = await startLinuxHost({ session: 'host' });
  t.after(() => server.stop());
  assert.ok(summary.active);
  assert.match(summary.url, /^http:\/\//);
  assert.equal(summary.mode, 'host');

  const health = await (await fetch(`http://127.0.0.1:${server.port}/health`)).json();
  assert.equal(health.ok, true);

  const admin = await fetch(`http://127.0.0.1:${server.port}/admin`);
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /LanLift/);

  // QR 產生器已被注入（管理 API 輸出 qrDataUrl）
  const stateResponse = await fetch(`http://127.0.0.1:${server.port}/api/admin/state`);
  const state = await stateResponse.json();
  assert.equal(state.active, true);
  assert.match(state.qrDataUrl, /^data:image\/png;base64,/);
});

test('startLinuxHost 指定 port 與 peer 模式', async (t) => {
  const { server, summary } = await startLinuxHost({ session: 'peer', port: 0 });
  t.after(() => server.stop());
  assert.equal(summary.mode, 'peer');
  assert.ok(server.port > 0);
});

test('main 入口：help、啟動與自動傳輸', async () => {
  const help = await main(['node', 'linux-host.js', '--help']);
  assert.deepEqual(help, { help: true });

  const { server, summary } = await main(['node', 'linux-host.js', '--port', '0', '--session', 'peer'], { installSignals: false });
  try {
    assert.equal(summary.mode, 'peer');
    assert.equal((await (await fetch(`http://127.0.0.1:${server.port}/health`)).json()).ok, true);
  } finally {
    await server.stop();
  }
});

test('子程序入口啟動並以 SIGTERM 優雅關閉', async () => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['src/linux-host.js', '--port', '0', '--session', 'host'], { cwd: require('path').join(__dirname, '..') });
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

test('startLinuxHost 不自動建立傳輸', async (t) => {
  const { server, summary } = await startLinuxHost({});
  t.after(() => server.stop());
  assert.equal(summary, null);
  const stateResponse = await fetch(`http://127.0.0.1:${server.port}/api/admin/state`);
  const state = await stateResponse.json();
  assert.equal(state.active, false);
});
