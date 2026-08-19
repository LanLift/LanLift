'use strict';

// 桌面／Linux 主機端的遠端傳輸整合層：
// 以使用者保存的自訂訊號伺服器（wss）建立遠端房間，行動裝置輸入房間代碼加入。
// 傳輸優先 WebRTC 直連，失敗自動回退中繼通道；全程端對端加密。
// 此模組不依賴 Electron，可在 Windows 桌面與 Linux 主機共用並直接測試。

const fs = require('fs/promises');
const path = require('path');
const { MiniEventEmitter } = require('./event-emitter');
const { RelayClient } = require('./relay-client');
const { RemoteTransfer } = require('./remote-transfer');

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

class RemoteHost extends MiniEventEmitter {
  /**
   * @param {object} options
   * @param {() => (object|null)} options.getProfile
   *   回傳自訂伺服器設定：{ signalingUrl, turnUrls, username, credential }
   * @param {string} options.receiveDir 遠端接收檔案的儲存資料夾
   * @param {object} [options.rtcFactory] WebRTC 工廠（瀏覽器/測試注入）
   */
  constructor(options = {}) {
    super();
    this.getProfile = options.getProfile || (() => null);
    this.receiveDir = options.receiveDir;
    this.rtcFactory = options.rtcFactory || null;
    this.client = null;
    this.transfer = null;
    this.room = null;
    this.peers = [];
    this.received = [];
    this.closedByUser = false;
  }

  getState() {
    return {
      active: Boolean(this.room),
      roomCode: this.room?.roomCode || null,
      connected: this.client?.isConnected() || false,
      transport: this.transfer?.transport?.kind || null,
      secured: Boolean(this.transfer?.sessionKey),
      peers: this.peers,
      received: this.received,
    };
  }

  /** 建立遠端房間（行動裝置以房間代碼加入）。 */
  async createSession() {
    const profile = this.getProfile();
    if (!profile || !profile.signalingUrl) {throw new Error('請先在「遠端連線」頁選擇並使用一個自訂伺服器。');}
    this.close();
    this.closedByUser = false;
    const iceServers = [
      ...DEFAULT_ICE_SERVERS,
      ...(profile.turnUrls || []).map((url) => ({
        urls: url,
        username: profile.username || undefined,
        credential: profile.credential || undefined,
      })),
    ];
    this.client = new RelayClient({
      url: profile.signalingUrl,
      deviceName: 'LanLift 主機',
      platform: 'desktop',
    });
    this.transfer = new RemoteTransfer({
      client: this.client,
      rtcFactory: this.rtcFactory,
      rtcConfig: { iceServers },
    });
    this.wire();
    this.client.connect();
    const room = await this.transfer.host();
    this.room = room;
    this.emit('update', this.getState());
    return room;
  }

  wire() {
    this.transfer.on('room-state', (payload) => {
      this.peers = (payload.members || [])
        .filter((member) => member.role === 'guest')
        .map(({ id, name, state }) => ({ id, name, state }));
      this.emit('update', this.getState());
    });
    this.transfer.on('transport', () => this.emit('update', this.getState()));
    this.transfer.on('secured', () => this.emit('update', this.getState()));
    this.transfer.on('sending', (info) => this.emit('sending', info));
    this.transfer.on('file-sent', (info) => this.emit('file-sent', info));
    this.transfer.on('file-received', (info) => this.saveReceived(info));
    this.transfer.on('server-error', (payload) => this.emit('error', new Error(payload?.error || '伺服器發生錯誤。')));
  }

  /** 核准／拒絕訪客。 */
  approve(memberId, approved) {
    if (!this.transfer) {throw new Error('尚未建立遠端傳輸。');}
    this.transfer.approve(memberId, approved);
  }

  /** 傳送本機檔案給已連線的行動裝置。 */
  async sendFile(filePath, name = null) {
    if (!this.transfer?.sessionKey) {throw new Error('安全通道尚未建立。');}
    const buffer = await fs.readFile(filePath);
    const fileName = name || path.basename(filePath);
    return this.transfer.sendFile(buffer, { name: fileName });
  }

  /** 遠端收到的檔案寫入接收資料夾。 */
  async saveReceived(info) {
    await fs.mkdir(this.receiveDir, { recursive: true });
    const destination = path.join(this.receiveDir, sanitizeName(info.name));
    await fs.writeFile(destination, info.data);
    const record = { name: info.name, size: info.size, receivedAt: Date.now(), from: this.transfer.peerName || '行動裝置' };
    this.received.push(record);
    this.emit('file-received', record);
    this.emit('update', this.getState());
  }

  close() {
    this.closedByUser = true;
    if (this.transfer) {this.transfer.close();}
    if (this.client) {this.client.close();}
    this.transfer = null;
    this.client = null;
    this.room = null;
    this.peers = [];
  }
}

/** 安全檔名（與 transfer-server 的清洗邏輯一致）。 */
function sanitizeName(value) {
  return path.basename(String(value || 'unnamed-file'))
    // eslint-disable-next-line no-control-regex -- 過濾檔名中的控制字元
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/^\.+$/, 'unnamed-file')
    .trim()
    .slice(0, 180) || 'unnamed-file';
}

module.exports = { RemoteHost, sanitizeName };
