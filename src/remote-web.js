'use strict';

// 行動裝置遠端傳輸網頁（由中繼伺服器託管，供 iOS Safari 與 Android Chrome 使用）。
// 以工廠函式建立，DOM、WebSocket 與 RTCPeerConnection 皆可注入，方便單元測試。
// 瀏覽器實際入口為 relay/remote.html + relay/remote-web.bundle.js（esbuild 打包）。

const { RelayClient } = require('./relay-client');
const { RemoteTransfer } = require('./remote-transfer');

function formatBytes(value) {
  if (!Number.isFinite(value)) {return '—';}
  if (value < 1024) {return `${value} B`;}
  if (value < 1024 ** 2) {return `${(value / 1024).toFixed(1)} KB`;}
  if (value < 1024 ** 3) {return `${(value / 1024 ** 2).toFixed(1)} MB`;}
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * @param {object} options
 * @param {Document} options.document
 * @param {Window} options.window
 * @param {string} options.relayUrl 訊號伺服器網址（wss://…/ws）
 * @param {string} [options.serverToken]
 * @param {object} [options.rtcFactory] WebRTC 工廠（瀏覽器自動偵測）
 * @param {object} [options.rtcConfig] ICE 伺服器設定
 */
function createRemoteApp(options = {}) {
  const doc = options.document;
  if (!doc) {throw new Error('缺少 document。');}
  const win = options.window || doc.defaultView;
  const relayUrl = options.relayUrl;
  if (!relayUrl) {throw new Error('缺少訊號伺服器網址。');}
  const storage = win?.localStorage || null;
  const deviceName = String(options.deviceName || storage?.getItem?.('lanlift-device-name') || '行動裝置').slice(0, 48);

  let transfer = null;
  const files = [];
  let transportKind = null;

  const $ = (id) => doc.getElementById(id);

  function setScreen(name) {
    for (const key of ['join', 'waiting', 'connected']) {
      const element = $(`screen-${key}`);
      if (element) {element.classList.toggle('hidden', key !== name);}
    }
  }

  function showError(text) {
    for (const id of ['error-message', 'connected-error']) {
      const element = $(id);
      if (!element) {continue;}
      element.textContent = text;
      element.classList.toggle('hidden', !text);
    }
  }

  function renderMembers(members) {
    const self = members.find((member) => member.id === transfer.client.deviceId);
    const peer = members.find((member) => member.id === transfer.peerId);
    const status = $('peer-status');
    if (status) {status.textContent = peer ? `已連接：${peer.name}（${transfer.transport ? transfer.transport.kind.toUpperCase() : '協商中'}）` : (self?.state === 'rejected' ? '主機拒絕了連線。' : '等待主機核准…');}
  }

  function renderProgress(info) {
    const bar = $('progress-bar');
    if (!bar) {return;}
    const total = info.total || 1;
    bar.style.width = `${Math.min(100, Math.round((info.received / total) * 100))}%`;
  }

  function addReceived(file) {
    const list = $('received-list');
    if (!list) {return;}
    const row = doc.createElement('div');
    row.className = 'file-row';
    const meta = doc.createElement('div');
    const name = doc.createElement('div');
    name.className = 'file-name';
    name.textContent = file.name;
    const size = doc.createElement('span');
    size.className = 'file-size';
    size.textContent = formatBytes(file.size);
    meta.append(name, size);
    const save = doc.createElement('a');
    save.className = 'download';
    save.textContent = '儲存';
    const blob = new win.Blob([file.data], { type: 'application/octet-stream' });
    save.href = win.URL.createObjectURL(blob);
    save.download = file.name;
    row.append(meta, save);
    list.append(row);
  }

  function wireTransfer() {
    transfer.on('room-state', (payload) => renderMembers(payload.members || []));
    transfer.on('transport', ({ kind }) => {
      transportKind = kind;
      const status = $('peer-status');
      if (status) {status.textContent = `傳輸通道：${kind === 'p2p' ? '點對點直連（WebRTC）' : '安全中繼'}。`;}
    });
    transfer.on('sending', () => {
      const bar = $('upload-bar');
      if (bar) {bar.style.width = '0%';}
      showError('');
    });
    transfer.on('file-sent', () => {
      const bar = $('upload-bar');
      if (bar) {bar.style.width = '100%';}
    });
    transfer.on('progress', (info) => renderProgress(info));
    transfer.on('file-received', (file) => addReceived(file));
    transfer.on('error', (error) => showError(error.message || String(error)));
    transfer.on('server-error', (payload) => showError(payload?.error || '伺服器發生錯誤。'));
  }

  function buildRtcFactory() {
    if (options.rtcFactory) {return options.rtcFactory;}
    if (typeof win !== 'undefined' && typeof win.RTCPeerConnection === 'function') {
      return {
        createPeerConnection: (config) => new win.RTCPeerConnection(config),
      };
    }
    return null;
  }

  async function join() {
    showError('');
    const code = ($('room-code').value || '').trim().toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(code)) {
      showError('請輸入 6 位數房間代碼。');
      return;
    }
    const nameInput = $('device-name');
    if (nameInput?.value?.trim()) {storage?.setItem?.('lanlift-device-name', nameInput.value.trim());}
    const client = new RelayClient({
      url: relayUrl,
      deviceName: nameInput?.value?.trim() || deviceName,
      platform: /android/i.test(win.navigator?.userAgent || '') ? 'android' : (/iphone|ipad|ipod/i.test(win.navigator?.userAgent || '') ? 'ios' : 'web'),
      serverToken: options.serverToken,
      storage,
      WebSocketImpl: options.WebSocketImpl || win.WebSocket,
    });
    client.connect();
    transfer = new RemoteTransfer({
      client,
      rtcFactory: buildRtcFactory(),
      rtcConfig: options.rtcConfig,
    });
    wireTransfer();
    setScreen('waiting');
    try {
      const joined = await transfer.join(code);
      renderMembers([{ id: transfer.client.deviceId, state: 'pending' }, ...(joined.host ? [{ id: joined.host.id, name: joined.host.name, state: 'host' }] : [])]);
    } catch (error) {
      showError(error.message || '加入房間失敗。');
      setScreen('join');
    }
  }

  /** 讀取檔案位元組（優先 arrayBuffer，回退 FileReader）。 */
  function readFileBytes(file) {
    if (typeof file.arrayBuffer === 'function') {return file.arrayBuffer();}
    return new Promise((resolve, reject) => {
      const reader = new win.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('無法讀取檔案。'));
      reader.readAsArrayBuffer(file);
    });
  }

  function sendFiles(fileList) {
    if (!transfer?.sessionKey) {
      showError('安全通道尚未建立，請稍候再試。');
      return;
    }
    for (const file of Array.from(fileList || [])) {
      readFileBytes(file).then((buffer) => {
        transfer.sendFile(new Uint8Array(buffer), { name: file.name });
      });
    }
  }

  function init() {
    const form = $('join-form');
    if (form) {form.addEventListener('submit', (event) => { event.preventDefault(); join(); });}
    const picker = $('file-picker');
    if (picker) {picker.addEventListener('change', (event) => { sendFiles(event.target.files); picker.value = ''; });}
    const leave = $('leave-btn');
    if (leave) {leave.addEventListener('click', () => { transfer?.close(); transfer = null; setScreen('join'); });}
    const preset = new win.URLSearchParams(win.location.search).get('room');
    if (preset && $('room-code')) {$('room-code').value = preset;}
  }

  return {
    init,
    join,
    sendFiles,
    get transfer() { return transfer; },
    get files() { return files; },
    get transportKind() { return transportKind; },
  };
}

module.exports = { createRemoteApp, formatBytes };
