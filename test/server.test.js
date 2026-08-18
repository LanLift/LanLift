'use strict';

const test = require('node:test');
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { TransferServer, getLanIPv4, safeFileName } = require('../src/transfer-server');

async function startService(t, options = {}) {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'lanlift-test-'));
  const receiveDir = path.join(sandbox, 'received');
  const service = new TransferServer({ receiveDir, ...options });
  await service.start();
  t.after(async () => {
    await service.stop();
    await fs.rm(sandbox, { recursive: true, force: true });
  });
  return { service, receiveDir, sandbox };
}

async function request(url, options) {
  const response = await fetch(url, options);
  return { response, text: await response.text() };
}

async function pairClient(service, token, clientId, name) {
  const response = await fetch(`http://127.0.0.1:${service.port}/api/s/${token}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: clientId, name }),
  });
  return response.json();
}

function multipartBody(filename, content, boundary) {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

test('v0.2.2 相容：一次性配對、上傳、下載與到期', async (t) => {
  const { service, receiveDir, sandbox } = await startService(t);
  const source = path.join(sandbox, 'shared file.txt');
  const sourceContent = 'LanLift direct-transfer test ' + crypto.randomUUID();
  await fs.writeFile(source, sourceContent);

  const session = service.createSession();
  assert.equal(session.active, true);
  assert.match(session.url, /^http:\/\//);
  assert.equal(session.mode, 'host'); // 預設模式保持 v0.2.2 語意

  const portal = await request(session.url);
  assert.equal(portal.response.status, 200);
  assert.match(portal.text, /LanLift/);

  const clientId = 'test-apple-client-0001';
  const pair = await pairClient(service, session.token, clientId, 'Test iPhone');
  assert.equal(pair.state, 'pending');

  const beforeApproval = await request(`http://127.0.0.1:${service.port}/api/s/${session.token}/info?client=${clientId}`);
  assert.equal(beforeApproval.response.status, 200);
  assert.equal(JSON.parse(beforeApproval.text).state, 'pending');

  service.approveClient(clientId, true);
  const added = service.addFiles([source]);
  assert.equal(added.length, 1);
  const info = await request(`http://127.0.0.1:${service.port}/api/s/${session.token}/info?client=${clientId}`);
  const infoData = JSON.parse(info.text);
  assert.equal(infoData.state, 'approved');
  assert.equal(infoData.files.length, 1);
  assert.equal(infoData.files[0].from, null);

  const download = await fetch(`http://127.0.0.1:${service.port}/api/s/${session.token}/download/${added[0].id}?client=${clientId}`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), sourceContent);

  const uploadContent = 'upload from Apple browser ' + crypto.randomUUID();
  const upload = await fetch(`http://127.0.0.1:${service.port}/api/s/${session.token}/upload?client=${clientId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=----LanLiftTestBoundary' },
    body: multipartBody('from-iphone.txt', uploadContent, '----LanLiftTestBoundary'),
  });
  assert.equal(upload.status, 201);
  const saved = await fs.readdir(receiveDir);
  assert.equal(saved.length, 1);
  assert.equal(await fs.readFile(path.join(receiveDir, saved[0]), 'utf8'), uploadContent);

  // 未核准裝置無法下載/上傳
  await pairClient(service, session.token, 'stranger-0001', 'Stranger');
  const deniedDownload = await fetch(`http://127.0.0.1:${service.port}/api/s/${session.token}/download/${added[0].id}?client=stranger-0001`);
  assert.equal(deniedDownload.status, 403);
  const deniedUpload = await fetch(`http://127.0.0.1:${service.port}/api/s/${session.token}/upload?client=stranger-0001`, {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
    body: multipartBody('x.txt', 'x', 'x'),
  });
  assert.equal(deniedUpload.status, 403);

  const folder = path.join(sandbox, 'photo-album');
  await fs.mkdir(path.join(folder, 'nested'), { recursive: true });
  await fs.writeFile(path.join(folder, 'cover.txt'), 'folder root file');
  await fs.writeFile(path.join(folder, 'nested', 'details.txt'), 'nested file');
  const zipped = await service.addPaths([folder]);
  assert.equal(zipped.length, 1);
  assert.equal(zipped[0].generated, true);
  assert.equal(zipped[0].name, 'photo-album.zip');
  const generatedFile = service.session.files.find((file) => file.id === zipped[0].id);
  assert.ok(generatedFile);
  assert.equal((await fs.readFile(generatedFile.filePath)).subarray(0, 2).toString(), 'PK');
  service.removeFile(generatedFile.id);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await assert.rejects(fs.access(generatedFile.filePath));

  const zippedForCleanup = await service.addPaths([folder]);
  const cleanupFile = service.session.files.find((file) => file.id === zippedForCleanup[0].id);
  service.endSession('test complete');
  await new Promise((resolve) => setTimeout(resolve, 40));
  await assert.rejects(fs.access(cleanupFile.filePath));
  const expired = await request(session.url);
  assert.equal(expired.response.status, 410);
  const ended = await request(`http://127.0.0.1:${service.port}/api/s/${session.token}/info?client=${clientId}`);
  assert.equal(ended.response.status, 410);
});

test('行動互傳：iPhone ↔ Android 經主機轉送（store-and-forward）', async (t) => {
  const { service } = await startService(t);
  const session = service.createSession({ mode: 'peer' });
  assert.equal(session.mode, 'peer');

  await pairClient(service, session.token, 'iphone-0001', '小明的 iPhone');
  await pairClient(service, session.token, 'android-0001', '小美的 Android');
  service.approveClient('iphone-0001', true);
  service.approveClient('android-0001', true);

  // peer 模式下兩台裝置都維持 approved
  const summary = service.getSessionSummary();
  const approved = summary.clients.filter((client) => client.state === 'approved');
  assert.equal(approved.length, 2);

  // iPhone → Android
  const content = 'photo transfer between mobiles ' + crypto.randomUUID();
  const boundary = '----PeerBoundary';
  const upload = await fetch(`http://127.0.0.1:${service.port}/api/s/${session.token}/upload?client=iphone-0001&to=android-0001`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: multipartBody('photo.jpg', content, boundary),
  });
  assert.equal(upload.status, 201);

  // 互傳檔案不進主機 received 清單
  assert.equal(service.session.received.length, 0);

  // Android 的 info 可看到來自 iPhone 的檔案與 peers
  const androidInfoResponse = await request(`http://127.0.0.1:${service.port}/api/s/${session.token}/info?client=android-0001`);
  const androidInfo = JSON.parse(androidInfoResponse.text);
  assert.equal(androidInfo.state, 'approved');
  assert.equal(androidInfo.files.length, 1);
  assert.equal(androidInfo.files[0].from, 'iphone-0001');
  assert.equal(androidInfo.files[0].to, 'android-0001');
  assert.deepEqual(androidInfo.peers, [{ id: 'iphone-0001', name: '小明的 iPhone' }]);

  // 目標裝置可下載
  const fileId = androidInfo.files[0].id;
  const download = await fetch(`http://127.0.0.1:${service.port}/api/s/${session.token}/download/${fileId}?client=android-0001`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), content);

  // 非目標裝置不可下載互傳檔案
  const selfDenied = await fetch(`http://127.0.0.1:${service.port}/api/s/${session.token}/download/${fileId}?client=iphone-0001`);
  assert.equal(selfDenied.status, 403);

  // Android → iPhone 反向
  const backBoundary = '----PeerBack';
  const back = await fetch(`http://127.0.0.1:${service.port}/api/s/${session.token}/upload?client=android-0001&to=iphone-0001`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${backBoundary}` },
    body: multipartBody('reply.txt', 'reply', backBoundary),
  });
  assert.equal(back.status, 201);
  const iphoneInfoResponse = await request(`http://127.0.0.1:${service.port}/api/s/${session.token}/info?client=iphone-0001`);
  const iphoneInfo = JSON.parse(iphoneInfoResponse.text);
  assert.equal(iphoneInfo.files.length, 1);
  assert.equal(iphoneInfo.files[0].from, 'android-0001');

  // host 模式不允許 to 參數
  const hostSession = service.createSession({ mode: 'host' });
  await pairClient(service, hostSession.token, 'only-0001', 'Only');
  service.approveClient('only-0001', true);
  const denied = await fetch(`http://127.0.0.1:${service.port}/api/s/${hostSession.token}/upload?client=only-0001&to=nobody`, {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=b' },
    body: multipartBody('x.txt', 'x', 'b'),
  });
  assert.equal(denied.status, 400);
});

test('管理 API：建立、核准、加入檔案與接收資料夾', async (t) => {
  const { service, sandbox } = await startService(t, { adminToken: 'admin-secret' });
  const headers = { 'Content-Type': 'application/json', 'X-LanLift-Admin': 'admin-secret' };

  // 未帶權杖 → 401
  const noAuth = await fetch(`http://127.0.0.1:${service.port}/api/admin/state`);
  assert.equal(noAuth.status, 401);

  // 錯誤權杖 → 401
  const badAuth = await fetch(`http://127.0.0.1:${service.port}/api/admin/state`, { headers: { ...headers, 'X-LanLift-Admin': 'wrong' } });
  assert.equal(badAuth.status, 401);

  // 初始狀態
  const initialResponse = await fetch(`http://127.0.0.1:${service.port}/api/admin/state`, { headers });
  const initial = await initialResponse.json();
  assert.equal(initial.active, false);
  assert.equal(initial.receiveDir, service.receiveDir);

  // 建立 peer 傳輸
  const createdResponse = await fetch(`http://127.0.0.1:${service.port}/api/admin/session`, { method: 'POST', headers, body: JSON.stringify({ mode: 'peer' }) });
  const created = await createdResponse.json();
  assert.equal(created.active, true);
  assert.equal(created.mode, 'peer');

  // 加入檔案
  const source = path.join(sandbox, 'admin-file.txt');
  await fs.writeFile(source, 'admin content');
  const withFileResponse = await fetch(`http://127.0.0.1:${service.port}/api/admin/files`, { method: 'POST', headers, body: JSON.stringify({ paths: [source] }) });
  const withFile = await withFileResponse.json();
  assert.equal(withFile.files.length, 1);
  assert.equal(withFile.files[0].name, 'admin-file.txt');

  // 裝置配對並核准
  await pairClient(service, created.token, 'phone-0001', 'Phone');
  const approvedResponse = await fetch(`http://127.0.0.1:${service.port}/api/admin/approve`, { method: 'POST', headers, body: JSON.stringify({ clientId: 'phone-0001', approved: true }) });
  const approved = await approvedResponse.json();
  assert.equal(approved.clients[0].state, 'approved');

  // 變更接收資料夾
  const newDir = path.join(sandbox, 'new-received');
  const changedResponse = await fetch(`http://127.0.0.1:${service.port}/api/admin/receive-dir`, { method: 'POST', headers, body: JSON.stringify({ directory: newDir }) });
  const changed = await changedResponse.json();
  assert.equal(changed.receiveDir, newDir);

  // 移除檔案
  const removedResponse = await fetch(`http://127.0.0.1:${service.port}/api/admin/remove-file`, { method: 'POST', headers, body: JSON.stringify({ id: withFile.files[0].id }) });
  const removed = await removedResponse.json();
  assert.equal(removed.files.length, 0);

  // 結束傳輸
  const endedResponse = await fetch(`http://127.0.0.1:${service.port}/api/admin/session/end`, { method: 'POST', headers });
  const ended = await endedResponse.json();
  assert.equal(ended.active, false);

  // 錯誤操作回傳 400
  const bad = await fetch(`http://127.0.0.1:${service.port}/api/admin/approve`, { method: 'POST', headers, body: JSON.stringify({ clientId: 'nobody', approved: true }) });
  assert.equal(bad.status, 400);

  // 非法接收資料夾 → 400
  const badDir = await fetch(`http://127.0.0.1:${service.port}/api/admin/receive-dir`, { method: 'POST', headers, body: JSON.stringify({ directory: '' }) });
  assert.equal(badDir.status, 400);

  // 未建立傳輸時加入檔案 → 400
  const noSession = await fetch(`http://127.0.0.1:${service.port}/api/admin/files`, { method: 'POST', headers, body: JSON.stringify({ paths: [source] }) });
  assert.equal(noSession.status, 400);
});

test('管理頁面內容與 404', async (t) => {
  const { service } = await startService(t);
  const page = await request(`http://127.0.0.1:${service.port}/admin`);
  assert.equal(page.response.status, 200);
  assert.match(page.text, /LanLift/);
  assert.match(page.text, /行動互傳/);
  const healthResponse = await request(`http://127.0.0.1:${service.port}/health`);
  const health = JSON.parse(healthResponse.text);
  assert.equal(health.ok, true);
  const notFound = await request(`http://127.0.0.1:${service.port}/unknown`);
  assert.equal(notFound.response.status, 404);
  // 未知管理動作 → 404
  const adminUnknown = await fetch(`http://127.0.0.1:${service.port}/api/admin/unknown`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(adminUnknown.status, 404);
});

test('拒絕裝置與 peer 模式下維持多台已核准', async (t) => {
  const { service } = await startService(t);
  const session = service.createSession({ mode: 'peer' });
  await pairClient(service, session.token, 'keep-0001', 'Keep');
  await pairClient(service, session.token, 'drop-0001', 'Drop');
  service.approveClient('keep-0001', true);
  service.approveClient('drop-0001', true);
  service.approveClient('drop-0001', false); // 拒絕
  const states = Object.fromEntries([...service.session.clients.entries()].map(([id, client]) => [id, client.state]));
  assert.equal(states['keep-0001'], 'approved');
  assert.equal(states['drop-0001'], 'rejected');
});

test('配對參數清洗：非法 id 自動產生、名稱截斷', async (t) => {
  const { service } = await startService(t);
  const session = service.createSession();
  const pair = await pairClient(service, session.token, 'bad id!', 'x'.repeat(100));
  assert.match(pair.id, /^[A-Za-z0-9_-]{8,80}$/);
  const summary = service.getSessionSummary();
  assert.equal(summary.clients[0].name.length, 48);
});

test('host 模式批准新裝置會拒絕先前裝置（v0.2.2 語意）', async (t) => {
  const { service } = await startService(t);
  const session = service.createSession({ mode: 'host' });
  await pairClient(service, session.token, 'device-a-0001', 'A');
  await pairClient(service, session.token, 'device-b-0001', 'B');
  service.approveClient('device-a-0001', true);
  service.approveClient('device-b-0001', true);
  const states = Object.fromEntries([...service.session.clients.entries()].map(([id, client]) => [id, client.state]));
  assert.equal(states['device-a-0001'], 'rejected');
  assert.equal(states['device-b-0001'], 'approved');
});

test('safeFileName 與 getLanIPv4', () => {
  // safeFileName 以 path.basename 取最後一段後再清洗非法字元
  assert.equal(safeFileName('a/b\\c:d*e?f"g<h>i|j\x00k'), 'b_c_d_e_f_g_h_i_j_k');
  assert.equal(safeFileName('...'), 'unnamed-file');
  assert.equal(safeFileName(''), 'unnamed-file');
  assert.equal(safeFileName(null), 'unnamed-file');
  assert.equal(safeFileName('x'.repeat(300)).length, 180);
  const ip = getLanIPv4();
  assert.equal(typeof ip, 'string');
  assert.ok(ip.length > 0);
});

test('start 冪等、createSession 前置檢查與 stop 冪等', async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'lanlift-lifecycle-'));
  const service = new TransferServer({ receiveDir: path.join(sandbox, 'received') });
  t.after(async () => {
    await service.stop();
    await fs.rm(sandbox, { recursive: true, force: true });
  });
  assert.throws(() => service.createSession(), /尚未啟動/);
  assert.throws(() => service.addFiles(['x']), /尚未啟動|請先建立傳輸/);
  await service.start();
  const first = service.getServerInfo();
  await service.start(); // 冪等
  assert.equal(first.port, service.getServerInfo().port);
  const session = service.createSession({ mode: 'peer' });
  assert.equal(session.active, true);
  await service.stop();
  await service.stop();
  assert.equal(service.port, null);
});
