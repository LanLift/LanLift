'use strict';

const $ = (id) => document.getElementById(id);
let state = null;
let activePage = 'direct';
let countdownTimer = null;
let toastTimer = null;
let showAllFiles = false;

function formatBytes(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function toast(text) {
  const element = $('toast');
  element.textContent = text;
  element.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.add('hidden'), 3200);
}

function formatRemaining(remainingMs) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateCountdown() {
  if (!state?.active) return;
  const remaining = state.expiresAt - Date.now();
  $('countdown').textContent = formatRemaining(remaining);
  if (remaining <= 0) $('countdown').textContent = '已過期';
}

function emptyNote(text) {
  const p = document.createElement('p'); p.className = 'empty-note'; p.textContent = text; return p;
}

function renderOutgoing(files) {
  const container = $('outgoingFiles'); const moreButton = $('showMoreFilesBtn');
  container.replaceChildren(); $('outgoingCount').textContent = files.length ? String(files.length) : '';
  if (!files.length) { moreButton.classList.add('hidden'); return; }
  for (const file of (showAllFiles ? files : files.slice(0, 3))) {
    const row = document.createElement('div'); row.className = 'file-row';
    const icon = document.createElement('div'); icon.className = 'file-symbol'; icon.textContent = file.generated ? '▣' : '↗';
    const meta = document.createElement('div'); meta.className = 'file-meta';
    const name = document.createElement('div'); name.className = 'file-name'; name.textContent = file.name;
    const size = document.createElement('span'); size.className = 'file-size'; size.textContent = file.generated ? `${formatBytes(file.size)} · 已由「${file.sourceName || '資料夾'}」壓縮為 ZIP` : formatBytes(file.size);
    const remove = document.createElement('button'); remove.className = 'delete-btn'; remove.textContent = '移除'; remove.addEventListener('click', () => window.lanlift.removeFile(file.id));
    meta.append(name, size); row.append(icon, meta, remove); container.append(row);
  }
  const hiddenCount = Math.max(0, files.length - 3);
  moreButton.classList.toggle('hidden', files.length <= 3);
  moreButton.textContent = showAllFiles ? '收合檔案清單' : `顯示其餘 ${hiddenCount} 個檔案`;
}

function renderClients(clients) {
  const container = $('clients'); container.replaceChildren();
  if (!clients.length) { container.append(emptyNote('尚未有裝置掃描 QR Code。')); return; }
  for (const client of clients) {
    const row = document.createElement('div'); row.className = 'client-row';
    const icon = document.createElement('div'); icon.className = 'client-symbol'; icon.textContent = client.state === 'approved' ? '✓' : '⌁';
    const meta = document.createElement('div'); meta.className = 'client-meta';
    const name = document.createElement('div'); name.className = 'client-name'; name.textContent = client.name;
    const detail = document.createElement('span'); detail.className = 'client-info'; detail.textContent = client.state === 'approved' ? '已核准，可雙向傳檔' : client.state === 'rejected' ? '已拒絕' : '等待你的核准';
    meta.append(name, detail); row.append(icon, meta);
    if (client.state === 'pending') {
      const actions = document.createElement('div'); actions.className = 'client-actions';
      const allow = document.createElement('button'); allow.className = 'approve-btn'; allow.textContent = '允許'; allow.addEventListener('click', () => window.lanlift.approveClient(client.id, true));
      const deny = document.createElement('button'); deny.className = 'reject-btn'; deny.textContent = '拒絕'; deny.addEventListener('click', () => window.lanlift.approveClient(client.id, false));
      actions.append(allow, deny); row.append(actions);
    }
    container.append(row);
  }
}

function renderReceived(files) {
  const container = $('receivedFiles'); container.replaceChildren();
  if (!files.length) { container.append(emptyNote('傳入檔案會儲存在指定資料夾。')); return; }
  for (const file of [...files].reverse()) {
    const row = document.createElement('div'); row.className = 'file-row';
    const icon = document.createElement('div'); icon.className = 'file-symbol'; icon.textContent = '↓';
    const meta = document.createElement('div'); meta.className = 'file-meta';
    const name = document.createElement('div'); name.className = 'file-name'; name.textContent = file.name;
    const size = document.createElement('span'); size.className = 'file-size'; size.textContent = `${formatBytes(file.size)} · ${file.from || 'Apple 裝置'}`;
    meta.append(name, size); row.append(icon, meta); container.append(row);
  }
}

function profileInput(profile = null) {
  $('profileId').value = profile?.id || '';
  $('profileName').value = profile?.name || '';
  $('signalingUrl').value = profile?.signalingUrl || '';
  $('turnUrls').value = profile?.turnUrls?.join('\n') || '';
  $('turnUsername').value = profile?.username || '';
  $('turnCredential').value = '';
  $('turnCredential').placeholder = profile?.hasCredential ? '已保存憑證；留白以保留原值' : '新增時填入；編輯時留白可保留原憑證';
  $('profileName').focus();
}

function renderProfiles(connection = state?.connection || {}) {
  const profiles = connection.profiles || []; const container = $('serverProfiles');
  container.replaceChildren(); $('profileCount').textContent = profiles.length ? String(profiles.length) : '';
  if (!profiles.length) { container.append(emptyNote('尚未儲存自訂伺服器。')); return; }
  for (const profile of profiles) {
    const row = document.createElement('div'); row.className = `profile-row${profile.id === connection.activeProfileId ? ' active' : ''}`;
    const meta = document.createElement('div'); const name = document.createElement('div'); name.className = 'profile-name'; name.textContent = profile.name;
    const info = document.createElement('div'); info.className = 'profile-info'; info.textContent = profile.signalingUrl; meta.append(name, info);
    const actions = document.createElement('div'); actions.className = 'profile-actions';
    const use = document.createElement('button'); use.textContent = profile.id === connection.activeProfileId ? '使用中' : '使用'; use.addEventListener('click', async () => { await window.lanlift.setConnectionMode('custom', profile.id); toast(`已選擇「${profile.name}」。`); });
    const edit = document.createElement('button'); edit.textContent = '編輯'; edit.addEventListener('click', () => profileInput(profile));
    const remove = document.createElement('button'); remove.className = 'profile-delete'; remove.textContent = '刪除'; remove.addEventListener('click', async () => { if (window.confirm(`刪除「${profile.name}」嗎？`)) { await window.lanlift.removeServerProfile(profile.id); toast('伺服器設定已刪除。'); } });
    actions.append(use, edit, remove); row.append(meta, actions); container.append(row);
  }
}

function renderPage() {
  const remote = activePage === 'remote';
  $('directPage').classList.toggle('hidden', remote);
  $('remotePage').classList.toggle('hidden', !remote);
  $('directNavBtn').classList.toggle('active', !remote);
  $('serverNavBtn').classList.toggle('active', remote);
  $('pageKicker').textContent = remote ? '私人遠端傳輸' : '一次性安全連線';
  $('pageHeading').textContent = remote ? '管理你的遠端連線。' : '快速傳送，留在你的網路裡。';
  $('pageSideTitle').textContent = remote ? '遠端連線' : '直接連線';
  $('pageSideDescription').textContent = remote ? '選擇並管理自己的訊號與 TURN 伺服器設定。' : '檔案在同一個 Wi‑Fi 網路內直接傳送，不經過雲端。';
}

function render(next) {
  state = next;
  const running = Boolean(state?.server?.port);
  $('serviceStatus').textContent = running ? `區網服務已在連接埠 ${state.server.port} 啟動` : '區網服務未啟動';
  $('serviceDot').style.background = running ? '' : '#ff8494';
  $('receiveFolder').textContent = `接收資料夾：${state.receiveDir || '—'}`;
  renderPage(); renderProfiles(state.connection);
  $('idleView').classList.toggle('hidden', Boolean(state.active));
  $('activeView').classList.toggle('hidden', !state.active);
  clearInterval(countdownTimer);
  if (!state.active) return;
  $('qrImage').src = state.qrDataUrl; $('pairLink').textContent = state.url;
  renderOutgoing(state.files || []); renderClients(state.clients || []); renderReceived(state.received || []);
  updateCountdown(); countdownTimer = setInterval(updateCountdown, 1000);
}

async function addDroppedFiles(files) {
  if (!state?.active) { toast('請先建立傳輸，再加入檔案。'); return; }
  if (!files?.length) return;
  try { toast('正在處理檔案；資料夾會先壓縮為 ZIP。'); await window.lanlift.addDroppedFiles([...files]); toast('已加入傳送佇列。'); } catch (error) { toast(error?.message || '無法加入這些檔案或資料夾。'); }
}

$('createBtn').addEventListener('click', () => window.lanlift.createSession());
$('endBtn').addEventListener('click', () => window.lanlift.endSession());
$('pickBtn').addEventListener('click', () => window.lanlift.pickFiles());
$('copyLinkBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.url); toast('連線網址已複製。'); } catch { toast('無法複製，請直接掃描 QR Code。'); } });
$('settingsBtn').addEventListener('click', () => window.lanlift.chooseReceiveDirectory());
$('openFolderBtn').addEventListener('click', () => window.lanlift.openReceiveDirectory());
$('openFolderText').addEventListener('click', () => window.lanlift.openReceiveDirectory());
$('directNavBtn').addEventListener('click', async () => { activePage = 'direct'; await window.lanlift.setConnectionMode('direct'); renderPage(); });
$('serverNavBtn').addEventListener('click', () => { activePage = 'remote'; renderPage(); });
$('resetServerForm').addEventListener('click', () => profileInput());
$('showMoreFilesBtn').addEventListener('click', () => { showAllFiles = !showAllFiles; renderOutgoing(state?.files || []); });
$('serverForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await window.lanlift.saveServerProfile({ id: $('profileId').value, name: $('profileName').value, signalingUrl: $('signalingUrl').value, turnUrls: $('turnUrls').value, username: $('turnUsername').value, credential: $('turnCredential').value });
    profileInput(); toast('伺服器設定已安全保存。');
  } catch (error) { toast(error?.message || '無法儲存伺服器設定。'); }
});

const dropZone = $('dropZone');
for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); });
dropZone.addEventListener('drop', (event) => addDroppedFiles(event.dataTransfer.files));

window.lanlift.onSessionUpdate(render);
window.lanlift.getState().then(render).catch(() => toast('無法讀取 LanLift 狀態。'));
