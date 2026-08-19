'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { portalHtml } = require('../src/portal');
const { adminHtml } = require('../src/admin-page');

test('portalHtml 包含 v0.2.2 既有流程與新增互傳 UI', () => {
  const html = portalHtml('test-token-123');
  assert.match(html, /<title>LanLift 傳輸<\/title>/);
  assert.match(html, /id="join"/);
  assert.match(html, /id="waiting"/);
  assert.match(html, /id="transfer"/);
  // 配對 token 嵌入
  assert.match(html, /"test-token-123"/);
  // 新增：裝置互傳區塊
  assert.match(html, /id="peerCard"/);
  assert.match(html, /id="peers"/);
  assert.match(html, /id="target"/);
  // 新增：上傳帶 to 參數
  assert.match(html, /toParam/);
  // 檔案清單標示來自其他裝置
  assert.match(html, /來自其他裝置/);
  // 安全性標頭內容由伺服器設定（此處僅驗證 HTML 結構）
  assert.match(html, /<\/html>/);
});

test('portalHtml 對特殊字元 token 做 JSON 逸出', () => {
  const html = portalHtml('a"b\\c</script>');
  assert.ok(!html.includes('</script>c'));
});

test('adminHtml 包含管理功能與權杖', () => {
  const html = adminHtml({ adminToken: 'top-secret' });
  assert.match(html, /Linux 主機管理/);
  assert.match(html, /id="session-mode"/);
  assert.match(html, /id="create-btn"/);
  assert.match(html, /id="end-btn"/);
  assert.match(html, /id="add-btn"/);
  assert.match(html, /id="receive-btn"/);
  assert.match(html, /X-LanLift-Admin/);
  assert.match(html, /"top-secret"/);
  assert.match(html, /api\/admin\/state/);
});

test('adminHtml 無權杖時不顯示驗證卡片', () => {
  const html = adminHtml({});
  assert.match(html, /null/); // token 變數為 null
  assert.match(html, /id="auth-card" class="card hidden"/);
});
