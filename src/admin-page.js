'use strict';

// Linux 主機的網頁管理介面（僅限本機迴路存取）：
// 建立/結束傳輸、核准裝置、加入檔案與資料夾、切換接收資料夾、
// 切換單一主機模式與行動互傳（多裝置）模式。內嵌 HTML，與 portal.js 同風格。

function adminHtml(options = {}) {
  const token = options.adminToken || null;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1220">
<title>LanLift Linux 主機管理</title>
<style>
  :root { color-scheme: dark; --bg:#0b1220; --panel:#141e30; --line:#26354d; --ink:#edf4ff; --muted:#9dafc7; --accent:#4fd1c5; --accent2:#62a7ff; --danger:#ff7b8e; }
  * { box-sizing: border-box; } body { margin:0; min-height:100vh; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:radial-gradient(1000px 600px at 15% -10%,#223b71 0%,transparent 52%),var(--bg); }
  main { max-width:860px; margin:0 auto; padding:28px 18px 40px; } header { display:flex; align-items:center; gap:12px; margin:0 0 24px; } .mark { width:39px; height:39px; display:grid; place-items:center; border-radius:13px; color:#05242b; background:linear-gradient(135deg,var(--accent),#99f6e4); font-weight:900; font-size:19px; } h1 { font-size:20px; margin:0; } .subtitle { margin:4px 0 0; font-size:13px; color:var(--muted); }
  .card { background:#121d2eea; border:1px solid var(--line); border-radius:20px; padding:22px; box-shadow:0 20px 60px #00000030; margin-bottom:14px; } h2 { font-size:18px; margin:0 0 10px; } p { color:var(--muted); line-height:1.55; margin:0 0 14px; }
  button { border:0; cursor:pointer; border-radius:12px; font:inherit; font-weight:750; padding:12px 16px; margin:6px 6px 0 0; background:linear-gradient(135deg,var(--accent),#78e7df); color:#05242b; } button.secondary { background:#1d2e47; color:#dbeafe; border:1px solid #395273; } button.danger { background:#47222e; color:#ffc0c9; border:1px solid #704052; }
  label { display:block; color:#c7d4e7; font-size:13px; font-weight:600; margin:14px 0 6px; } input[type="text"] { width:100%; border:1px solid #31425c; background:#0b1422; border-radius:12px; color:var(--ink); padding:12px; font-size:15px; outline:none; }
  .hidden { display:none !important; } .row { display:flex; align-items:center; justify-content:space-between; gap:12px; background:#0d1726; border:1px solid #263953; border-radius:13px; padding:12px 13px; margin-bottom:8px; } .row .name { min-width:0; font-size:14px; font-weight:650; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; } .row .info { display:block; font-size:12px; color:var(--muted); margin-top:3px; }
  .pill { display:inline-flex; align-items:center; gap:6px; padding:6px 9px; border-radius:999px; background:#1d2c42; border:1px solid #30445f; color:#b9c9e0; font-size:12px; margin-bottom:10px; } .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-all; }
  .error { color:#ffc0c9; background:#3d1f2a; border:1px solid #704052; border-radius:12px; padding:11px 13px; font-size:13px; margin-top:12px; }
  .qr { display:block; margin:12px auto; max-width:220px; border-radius:14px; background:#fff; padding:10px; }
</style>
</head>
<body>
<main>
<header><div class="mark">L</div><div><h1>LanLift</h1><p class="subtitle">Linux 主機管理 · 私人檔案傳輸</p></div></header>

<section id="auth-card" class="card hidden">
  <h2>管理驗證</h2><p>此頁面僅限本機存取。請輸入管理權杖。</p>
  <label for="auth-token">管理權杖</label><input id="auth-token" type="text" autocomplete="off">
  <button id="auth-btn">驗證</button><div id="auth-error" class="error hidden"></div>
</section>

<section id="main-view" class="hidden">
  <div class="card" id="idle-card">
    <h2>建立傳輸</h2><p>建立一次性傳輸後，行動裝置掃描 QR Code 或開啟網址即可連線。</p>
    <label for="session-mode">模式</label>
    <input id="session-mode" type="text" value="host" list="mode-options">
    <datalist id="mode-options"><option value="host"><option value="peer"></datalist>
    <p style="font-size:12px">host：主機與單一行動裝置互傳；peer：多台行動裝置互傳（iPhone ↔ Android）。</p>
    <button id="create-btn">建立傳輸</button><div id="idle-error" class="error hidden"></div>
  </div>

  <div class="card hidden" id="active-card">
    <div class="pill" id="session-pill">傳輸進行中</div>
    <p id="session-url" class="mono"></p>
    <img id="qr-image" class="qr hidden" alt="QR Code">
    <button id="copy-btn" class="secondary">複製網址</button>
    <button id="end-btn" class="danger">結束傳輸</button>
    <h2 style="margin-top:18px">待核准裝置</h2><div id="clients"></div>
    <h2 style="margin-top:18px">分享佇列</h2><div id="files"></div>
    <h2 style="margin-top:18px">接收紀錄</h2><div id="received"></div>
  </div>

  <div class="card">
    <h2>加入檔案或資料夾</h2>
    <label for="file-path">伺服器本機路徑（多個路徑以換行分隔）</label>
    <input id="file-path" type="text" placeholder="/home/user/Downloads/report.pdf">
    <button id="add-btn">加入佇列</button>
  </div>

  <div class="card">
    <h2>接收資料夾</h2>
    <p id="receive-dir" class="mono"></p>
    <label for="receive-input">新接收資料夾路徑</label>
    <input id="receive-input" type="text">
    <button id="receive-btn" class="secondary">變更</button>
  </div>
  <div id="main-error" class="error hidden"></div>
</section>
</main>
<script>
(() => {
  const token = ${JSON.stringify(token)};
  const $ = (id) => document.getElementById(id);
  const show = (id, text) => { const el = $(id); el.textContent = text || ''; el.classList.toggle('hidden', !text); };
  const headers = { 'Content-Type': 'application/json', 'X-LanLift-Admin': token || '' };
  let state = null;
  const poll = async () => {
    const r = await fetch('/api/admin/state', { headers });
    state = await r.json();
    render();
    setTimeout(poll, 2000);
  };
  const render = () => {
    if (!state) return;
    $('idle-card').classList.toggle('hidden', Boolean(state.active));
    $('active-card').classList.toggle('hidden', !state.active);
    $('receive-dir').textContent = state.receiveDir || '—';
    $('receive-input').value = state.receiveDir || '';
    if (!state.active) return;
    $('session-pill').textContent = state.mode === 'peer' ? '行動互傳模式進行中' : '傳輸進行中';
    $('session-url').textContent = state.url || '';
    $('qr-image').classList.toggle('hidden', !state.qrDataUrl);
    if (state.qrDataUrl) $('qr-image').src = state.qrDataUrl;
    const clients = $('clients'); clients.replaceChildren();
    for (const client of state.clients || []) {
      const row = document.createElement('div'); row.className = 'row';
      const meta = document.createElement('div'); const name = document.createElement('div'); name.className = 'name'; name.textContent = client.name;
      const info = document.createElement('span'); info.className = 'info'; info.textContent = client.state === 'approved' ? '已核准' : (client.state === 'rejected' ? '已拒絕' : '等待核准');
      meta.append(name, info); row.append(meta);
      if (client.state === 'pending') {
        const ok = document.createElement('button'); ok.textContent = '允許'; ok.addEventListener('click', () => api('POST', '/api/admin/approve', { clientId: client.id, approved: true }));
        const no = document.createElement('button'); no.className = 'danger'; no.textContent = '拒絕'; no.addEventListener('click', () => api('POST', '/api/admin/approve', { clientId: client.id, approved: false }));
        row.append(ok, no);
      }
      clients.append(row);
    }
    if (!state.clients?.length) clients.append(Object.assign(document.createElement('p'), { textContent: '尚未有裝置連線。' }));
    const files = $('files'); files.replaceChildren();
    for (const file of state.files || []) {
      const row = document.createElement('div'); row.className = 'row';
      const meta = document.createElement('div'); const name = document.createElement('div'); name.className = 'name'; name.textContent = file.name;
      const info = document.createElement('span'); info.className = 'info'; info.textContent = (file.generated ? 'ZIP · ' : '') + (file.from ? '來自 ' + file.from + ' → ' + (file.to || '主機') : '主機分享');
      const del = document.createElement('button'); del.className = 'danger'; del.textContent = '移除'; del.addEventListener('click', () => api('POST', '/api/admin/remove-file', { id: file.id }));
      meta.append(name, info); row.append(meta, del); files.append(row);
    }
    if (!state.files?.length) files.append(Object.assign(document.createElement('p'), { textContent: '佇列為空。' }));
    const received = $('received'); received.replaceChildren();
    for (const file of (state.received || []).slice().reverse()) {
      const row = document.createElement('div'); row.className = 'row';
      const meta = document.createElement('div'); const name = document.createElement('div'); name.className = 'name'; name.textContent = file.name;
      const info = document.createElement('span'); info.className = 'info'; info.textContent = (file.from || '行動裝置') + ' · ' + file.size + ' 位元組';
      meta.append(name, info); row.append(meta); received.append(row);
    }
    if (!state.received?.length) received.append(Object.assign(document.createElement('p'), { textContent: '尚未收到檔案。' }));
  };
  const api = async (method, path, body) => {
    try {
      const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '請求失敗。');
      state = data; render();
    } catch (error) { show('main-error', error.message); }
  };
  $('create-btn').addEventListener('click', () => api('POST', '/api/admin/session', { mode: $('session-mode').value === 'peer' ? 'peer' : 'host' }));
  $('end-btn').addEventListener('click', () => api('POST', '/api/admin/session/end'));
  $('copy-btn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.url); } catch { show('main-error', '無法複製，請手動選取網址。'); } });
  $('add-btn').addEventListener('click', () => api('POST', '/api/admin/files', { paths: $('file-path').value.split('\\n') }));
  $('receive-btn').addEventListener('click', () => api('POST', '/api/admin/receive-dir', { directory: $('receive-input').value }));
  if (token) {
    $('auth-card').classList.remove('hidden');
    $('auth-btn').addEventListener('click', () => {
      const value = $('auth-token').value;
      if (value !== token) return show('auth-error', '權杖錯誤。');
      $('auth-card').classList.add('hidden'); $('main-view').classList.remove('hidden'); poll();
    });
  } else {
    $('main-view').classList.remove('hidden'); poll();
  }
})();
</script>
</body></html>`;
}

module.exports = { adminHtml };
