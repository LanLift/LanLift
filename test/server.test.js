'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { TransferServer } = require('../src/transfer-server');

async function request(url, options) {
  const response = await fetch(url, options);
  return { response, text: await response.text() };
}

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'lanlift-test-'));
  const receiveDir = path.join(sandbox, 'received');
  const source = path.join(sandbox, 'shared file.txt');
  const sourceContent = 'LanLift direct-transfer test ' + crypto.randomUUID();
  await fs.writeFile(source, sourceContent);

  const service = new TransferServer({ receiveDir });
  await service.start();
  const session = service.createSession();
  assert.equal(session.active, true);
  assert.match(session.url, /^http:\/\//);

  const portal = await request(session.url);
  assert.equal(portal.response.status, 200);
  assert.match(portal.text, /LanLift/);

  const clientId = 'test-apple-client-0001';
  const pair = await fetch(`http://127.0.0.1:${service.port}/api/s/${session.token}/pair`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: clientId, name: 'Test iPhone' })
  });
  assert.equal(pair.status, 200);
  assert.equal((await pair.json()).state, 'pending');

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

  const download = await fetch(`http://127.0.0.1:${service.port}/api/s/${session.token}/download/${added[0].id}?client=${clientId}`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), sourceContent);

  const uploadContent = 'upload from Apple browser ' + crypto.randomUUID();
  const boundary = '----LanLiftTestBoundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="from-iphone.txt"\r\nContent-Type: text/plain\r\n\r\n`),
    Buffer.from(uploadContent),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const upload = await fetch(`http://127.0.0.1:${service.port}/api/s/${session.token}/upload?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: payload
  });
  assert.equal(upload.status, 201);
  const saved = await fs.readdir(receiveDir);
  assert.equal(saved.length, 1);
  assert.equal(await fs.readFile(path.join(receiveDir, saved[0]), 'utf8'), uploadContent);

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
  await service.stop();
  await fs.rm(sandbox, { recursive: true, force: true });
  console.log('PASS: LanLift transfer service one-time pairing, upload, download, and expiry.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
