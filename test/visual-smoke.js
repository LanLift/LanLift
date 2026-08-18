'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { app, BrowserWindow } = require('electron');

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 759,
    height: 580,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await window.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const metrics = await window.webContents.executeJavaScript(`
    (() => {
      document.getElementById('idleView').classList.add('hidden');
      document.getElementById('activeView').classList.remove('hidden');
      const active = document.getElementById('activeView').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.right-column > .panel')].map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
      });
      return { viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, active, cards };
    })()
  `);
  assert.ok(metrics.scrollWidth <= metrics.viewport, `窄視窗仍出現水平溢出：${metrics.scrollWidth}px > ${metrics.viewport}px`);
  assert.equal(metrics.cards.length, 2);
  for (const card of metrics.cards) {
    assert.ok(card.left >= 0 && card.right <= metrics.viewport, `右欄卡片超出可視範圍：${JSON.stringify(card)}`);
  }
  assert.ok(metrics.cards[1].top >= metrics.cards[0].bottom, '右欄兩張卡片不應重疊。');
  const image = await window.webContents.capturePage();
  await fs.writeFile(path.join(__dirname, 'narrow-window-layout.png'), image.toPNG());
  console.log('PASS: LanLift 759px 窄視窗沒有水平溢出，且右欄卡片不重疊。');
  await window.close();
  app.quit();
}

run().catch((error) => { console.error(error); app.exit(1); });
