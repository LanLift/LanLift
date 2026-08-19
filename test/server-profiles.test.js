'use strict';

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { ServerProfileStore, parseTurnUrls } = require('../src/server-profiles');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^protected:/, ''),
};

async function makeStore(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lanlift-profiles-'));
  const filePath = path.join(root, 'server-profiles.json');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { filePath, root };
}

test('儲存、加密保存、重載與刪除', async (t) => {
  const { filePath } = await makeStore(t);
  const store = new ServerProfileStore({ filePath, safeStorage });
  await store.init();
  assert.equal(store.getState().profiles.length, 0);
  assert.equal(store.getState().secureStorageAvailable, true);

  const profile = await store.saveProfile({
    name: '公司中繼',
    signalingUrl: 'wss://relay.example.com',
    turnUrls: 'turns:relay.example.com:5349?transport=tcp\nturn:relay.example.com:3478',
    username: 'lanlift-user',
    credential: 'very-secret-token',
  });
  assert.equal(profile.name, '公司中繼');
  assert.equal(profile.hasCredential, true);
  assert.equal(profile.turnUrls.length, 2);
  const raw = await fs.readFile(filePath, 'utf8');
  assert.ok(!raw.includes('very-secret-token'));

  await store.setConnectionMode('custom', profile.id);
  const second = new ServerProfileStore({ filePath, safeStorage });
  await second.init();
  const loaded = second.getState();
  assert.equal(loaded.connectionMode, 'custom');
  assert.equal(loaded.activeProfileId, profile.id);
  assert.equal(loaded.profiles.length, 1);
  assert.equal(second.getConnectionCredentials(profile.id).credential, 'very-secret-token');

  await second.removeProfile(profile.id);
  const afterRemoval = second.getState();
  assert.equal(afterRemoval.connectionMode, 'direct');
  assert.equal(afterRemoval.profiles.length, 0);
});

test('編輯既有設定：留白憑證保留原值', async (t) => {
  const { filePath } = await makeStore(t);
  const store = new ServerProfileStore({ filePath, safeStorage });
  await store.init();
  const created = await store.saveProfile({
    name: '原始名稱',
    signalingUrl: 'wss://relay.example.com',
    turnUrls: 'turn:relay.example.com:3478',
    username: 'u',
    credential: 'original-secret',
  });
  const updated = await store.saveProfile({
    id: created.id,
    name: '新名稱',
    signalingUrl: 'wss://relay2.example.com',
    turnUrls: 'turn:relay2.example.com:3478',
    username: 'u2',
    credential: '',
  });
  assert.equal(updated.name, '新名稱');
  assert.equal(updated.hasCredential, true);
  assert.equal(store.getConnectionCredentials(created.id).credential, 'original-secret');
  assert.equal(store.getState().profiles.length, 1);
});

test('驗證輸入：名稱、訊號網址與 TURN 位址', async (t) => {
  const { filePath } = await makeStore(t);
  const store = new ServerProfileStore({ filePath, safeStorage });
  await store.init();
  await assert.rejects(() => store.saveProfile({ name: '', signalingUrl: 'wss://x', turnUrls: 'turn:x:3478' }), /名稱/);
  await assert.rejects(() => store.saveProfile({ name: 'n', signalingUrl: 'http://x', turnUrls: 'turn:x:3478' }), /必須使用 wss/);
  await assert.rejects(() => store.saveProfile({ name: 'n', signalingUrl: 'wss://x', turnUrls: 'not-a-turn' }), /TURN 位址/);
  await assert.rejects(() => store.saveProfile({ name: 'n', signalingUrl: 'wss://x', turnUrls: '' }), /至少輸入一個 TURN/);
  assert.throws(() => parseTurnUrls('stun:x:3478'), /TURN/);
});

test('無安全儲存時憑證加密失敗', async (t) => {
  const { filePath } = await makeStore(t);
  const store = new ServerProfileStore({ filePath, safeStorage: { isEncryptionAvailable: () => false } });
  await store.init();
  assert.equal(store.getState().secureStorageAvailable, false);
  await assert.rejects(() => store.saveProfile({ name: 'n', signalingUrl: 'wss://x', turnUrls: 'turn:x:3478', credential: 'secret' }), /安全儲存/);
  // 不帶憑證仍可儲存
  const saved = await store.saveProfile({ name: 'n', signalingUrl: 'wss://x', turnUrls: 'turn:x:3478' });
  assert.equal(saved.hasCredential, false);
});

test('連線模式切換驗證', async (t) => {
  const { filePath } = await makeStore(t);
  const store = new ServerProfileStore({ filePath, safeStorage });
  await store.init();
  const profile = await store.saveProfile({ name: 'p', signalingUrl: 'wss://x', turnUrls: 'turn:x:3478' });
  await assert.rejects(() => store.setConnectionMode('invalid'), /連線模式/);
  await assert.rejects(() => store.setConnectionMode('custom', 'missing-id'), /自訂伺服器/);
  await store.setConnectionMode('custom', profile.id);
  assert.equal(store.getState().activeProfileId, profile.id);
  await store.setConnectionMode('direct');
  assert.equal(store.getState().activeProfileId, null);
  assert.throws(() => store.getConnectionCredentials('missing-id'), /找不到/);
});

test('損毀設定檔重新初始化', async (t) => {
  const { filePath } = await makeStore(t);
  await fs.writeFile(filePath, '{broken json', 'utf8');
  const store = new ServerProfileStore({ filePath, safeStorage });
  await assert.rejects(() => store.init(), /無法讀取/);
});

test('不存在時建立新檔', async (t) => {
  const { filePath } = await makeStore(t);
  const store = new ServerProfileStore({ filePath, safeStorage });
  await store.init();
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(raw.version, 1);
  assert.deepEqual(raw.profiles, []);
});
