'use strict';

// 中繼客戶端：Node.js、Electron 與瀏覽器共用的 WebSocket 訊號/中繼連線。
// 負責註冊、房間建立與加入、訊號轉發收發、中繼區塊收發、心跳與斷線重連。
// 檔案加密在 RemoteTransfer 層處理，此層只傳送不透明的區塊。

const { MiniEventEmitter } = require('./event-emitter');
const { MESSAGE_TYPES, envelope, sanitizeName } = require('./protocol');
const { randomToken } = require('./crypto');

const DEFAULT_HEARTBEAT_MS = 20 * 1000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30 * 1000;

class RelayClient extends MiniEventEmitter {
  /**
   * @param {object} options
   * @param {string} options.url wss:// 或 ws:// 訊號網址
   * @param {string} [options.deviceId] 裝置識別碼（省略時自動產生並持久化於 storage）
   * @param {string} [options.deviceName]
   * @param {string} [options.platform] 例如 'windows'、'linux'、'android'、'ios'、'web'
   * @param {string} [options.serverToken] 伺服器認證權杖
   * @param {object} [options.storage] 具 getItem/setItem 的儲存層（瀏覽器 localStorage）
   * @param {typeof WebSocket} [options.WebSocketImpl] 測試注入
   * @param {() => number} [options.now]
   */
  constructor(options = {}) {
    super();
    this.url = options.url;
    if (!this.url) {throw new Error('請提供訊號伺服器網址。');}
    this.serverToken = options.serverToken || null;
    this.WebSocketImpl = options.WebSocketImpl !== undefined
      ? options.WebSocketImpl
      : (typeof WebSocket === 'undefined' ? null : WebSocket);
    this.storage = options.storage || null;
    this.now = options.now || (() => Date.now());
    this.heartbeatMs = options.heartbeatMs || DEFAULT_HEARTBEAT_MS;
    this.deviceName = sanitizeName(options.deviceName || '未命名裝置');
    this.platform = String(options.platform || 'web').slice(0, 32);
    this.deviceId = options.deviceId || this.loadDeviceId();
    this.rooms = new Set(); // roomToken 集合（重連後重新加入）
    this.ws = null;
    this.connected = false;
    this.closedByUser = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pending = null;
    this.outbox = []; // 連線建立前暫存的訊息
    this.lastWelcome = null;
  }

  loadDeviceId() {
    const key = 'lanlift-device-id';
    let id = null;
    try { id = this.storage?.getItem(key) || null; } catch { id = null; }
    if (!id) {
      id = `dev-${randomToken(12)}`;
      try { this.storage?.setItem(key, id); } catch { /* 儲存層不可用時僅保留於記憶體 */ }
    }
    return id;
  }

  isConnected() {
    return this.connected;
  }

  connect() {
    if (this.closedByUser || this.ws) {return;}
    const WebSocketImpl = this.WebSocketImpl;
    if (!WebSocketImpl) {throw new Error('此環境不支援 WebSocket。');}
    const ws = new WebSocketImpl(this.url);
    this.ws = ws;
    ws.addEventListener('open', () => this.onOpen(ws));
    ws.addEventListener('message', (event) => this.onMessage(ws, event));
    ws.addEventListener('close', () => this.onClose(ws));
    ws.addEventListener('error', () => {});
  }

  onOpen(ws) {
    ws.send(JSON.stringify(envelope(MESSAGE_TYPES.REGISTER, {
      deviceId: this.deviceId,
      name: this.deviceName,
      platform: this.platform,
      token: this.serverToken,
    })));
    this.connected = true;
    this.reconnectAttempt = 0;
    this.heartbeatTimer = setInterval(() => this.ping(), this.heartbeatMs);
    if (this.heartbeatTimer.unref) {this.heartbeatTimer.unref();}
    // 連線建立前暫存的訊息依序送出
    for (const data of this.outbox.splice(0)) {
      try { ws.send(data); } catch { /* 斷線由 close 事件處理 */ }
    }
    this.emit('open', { deviceId: this.deviceId });
  }

  onMessage(ws, event) {
    let raw;
    try { raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data); } catch { return; }
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    this.handle(message);
  }

  handle(message) {
    const { type, payload } = message;
    switch (type) {
      case MESSAGE_TYPES.WELCOME:
        this.lastWelcome = payload;
        this.emit('welcome', payload);
        for (const token of this.rooms) {this.rejoin(token);}
        break;
      case MESSAGE_TYPES.ROOM_CREATED:
        this.rooms.add(payload.roomToken);
        this.emit('room-created', payload);
        break;
      case MESSAGE_TYPES.ROOM_STATE:
        this.rooms.add(payload.roomToken);
        this.emit('room-state', payload);
        break;
      case MESSAGE_TYPES.SIGNAL:
        this.emit('signal', payload);
        break;
      case MESSAGE_TYPES.RELAY_FRAME:
        this.emit('frame', payload);
        break;
      case MESSAGE_TYPES.RELAY_ACK:
        this.emit('ack', payload);
        break;
      case MESSAGE_TYPES.RELAY_REQUEST:
        this.emit('request', payload);
        break;
      case MESSAGE_TYPES.PONG:
        this.emit('pong', payload);
        break;
      case MESSAGE_TYPES.ERROR:
        this.emit('error', payload);
        break;
      default:
        this.emit('message', message);
    }
  }

  rejoin(token) {
    // 重連後無法還原完整房間狀態；room-state 會由下次互動觸發。
    // 此處僅保留權杖，讓上層可呼叫 refresh()。
    this.emit('rejoined', { roomToken: token });
  }

  onClose(ws) {
    if (this.ws !== ws) {return;}
    this.ws = null;
    this.connected = false;
    if (this.heartbeatTimer) {clearInterval(this.heartbeatTimer);}
    this.heartbeatTimer = null;
    this.emit('close', { code: ws.closeCode });
    if (this.closedByUser) {return;}
    const delay = Math.min(RECONNECT_BASE_MS * (2 ** this.reconnectAttempt), RECONNECT_MAX_MS);
    this.reconnectAttempt += 1;
    this.emit('reconnecting', { attempt: this.reconnectAttempt, delayMs: delay });
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    if (this.reconnectTimer.unref) {this.reconnectTimer.unref();}
  }

  ping() {
    if (!this.ws || !this.connected) {return;}
    try {
      this.ws.send(JSON.stringify(envelope(MESSAGE_TYPES.PING, { time: this.now() })));
    } catch {
      /* 斷線由 close 事件處理 */
    }
  }

  /** 送出訊息；連線未就緒時暫存於 outbox（連線後自動補送）。 */
  send(type, payload) {
    const data = JSON.stringify(envelope(type, payload));
    if (!this.ws || !this.connected) {
      if (this.outbox.length < 64) {this.outbox.push(data);}
      return false;
    }
    this.ws.send(data);
    return true;
  }

  createRoom(publicKey = null) {
    this.send(MESSAGE_TYPES.CREATE_ROOM, {
      name: this.deviceName,
      platform: this.platform,
      publicKey,
    });
  }

  joinRoom(code, publicKey = null) {
    this.send(MESSAGE_TYPES.JOIN_ROOM, { roomCode: String(code || '').trim().toUpperCase(), name: this.deviceName, platform: this.platform, publicKey });
  }

  approve(roomToken, memberId, approved) {
    this.send(MESSAGE_TYPES.APPROVE, { roomToken, memberId, approved: Boolean(approved) });
  }

  sendSignal(roomToken, target, data) {
    this.send(MESSAGE_TYPES.SIGNAL, { roomToken, target, data });
  }

  sendPeerKey(roomToken, publicKey, salt) {
    this.send(MESSAGE_TYPES.PEER_KEY, { roomToken, publicKey, salt: salt || null });
  }

  sendFrame(roomToken, frame) {
    return this.send(MESSAGE_TYPES.RELAY_FRAME, {
      roomToken,
      fileId: frame.fileId,
      seq: frame.seq,
      total: frame.total,
      checksum: frame.checksum,
      iv: frame.iv,
      data: frame.data,
    });
  }

  sendAck(roomToken, fileId, seq) {
    this.send(MESSAGE_TYPES.RELAY_ACK, { roomToken, fileId, seq });
  }

  sendRequest(roomToken, fileId, missing) {
    this.send(MESSAGE_TYPES.RELAY_REQUEST, { roomToken, fileId, missing });
  }

  bye(roomToken) {
    this.send(MESSAGE_TYPES.BYE, roomToken ? { roomToken } : {});
    if (roomToken) {this.rooms.delete(roomToken);}
  }

  close() {
    this.closedByUser = true;
    if (this.reconnectTimer) {clearTimeout(this.reconnectTimer);}
    this.reconnectTimer = null;
    if (this.heartbeatTimer) {clearInterval(this.heartbeatTimer);}
    this.heartbeatTimer = null;
    if (this.ws) {
      try { this.ws.close(); } catch { /* 已關閉 */ }
      this.ws = null;
    }
    this.connected = false;
  }
}

module.exports = { RelayClient };
