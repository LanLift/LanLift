'use strict';

const assert = require('assert/strict');
const path = require('path');
const { app, BrowserWindow } = require('electron');

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'mock-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const visible = (id) => !document.getElementById(id).classList.contains('hidden');
      document.getElementById('serverNavBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const remote = { remoteVisible: visible('remotePage'), directVisible: visible('directPage'), title: document.getElementById('pageHeading').textContent };
      document.getElementById('directNavBtn').click();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const direct = { remoteVisible: visible('remotePage'), directVisible: visible('directPage'), title: document.getElementById('pageHeading').textContent };
      return { remote, direct, labels: [...document.querySelectorAll('.side-nav-btn span:last-child')].map((el) => el.textContent) };
    })()
  `);
  assert.deepEqual(result.labels, ['直接連線', '遠端連線']);
  assert.equal(result.remote.remoteVisible, true);
  assert.equal(result.remote.directVisible, false);
  assert.match(result.remote.title, /遠端連線/);
  assert.equal(result.direct.directVisible, true);
  assert.equal(result.direct.remoteVisible, false);
  assert.match(result.direct.title, /快速傳送/);
  console.log('PASS: LanLift side navigation switches between direct and remote main pages.');
  await window.close();
  app.quit();
}

run().catch((error) => { console.error(error); app.exit(1); });
