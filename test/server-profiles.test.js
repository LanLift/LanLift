'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { ServerProfileStore } = require('../src/server-profiles');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^protected:/, '')
};

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lanlift-profiles-'));
  const filePath = path.join(root, 'server-profiles.json');
  const store = new ServerProfileStore({ filePath, safeStorage });
  await store.init();
  assert.equal(store.getState().profiles.length, 0);

  const profile = await store.saveProfile({
    name: '公司中繼',
    signalingUrl: 'wss://relay.example.com',
    turnUrls: 'turns:relay.example.com:5349?transport=tcp\nturn:relay.example.com:3478',
    username: 'lanlift-user',
    credential: 'very-secret-token'
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
  await fs.rm(root, { recursive: true, force: true });
  console.log('PASS: LanLift custom server profiles are encrypted, persisted, selected, and removed safely.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
