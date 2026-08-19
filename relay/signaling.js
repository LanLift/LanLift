'use strict';

// WebSocket 訊號伺服器：處理裝置註冊、遠端房間建立與加入、核准、
// WebRTC 協商轉發、ECDH 公鑰交換，以及中繼區塊與 ACK 的成員間轉發。
// 與 relay/relay-hub.js 搭配：資料面限速與核准檢查由 RelayHub 負責。

const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');
const { MESSAGE_TYPES, createRoomCredentials, envelope, validateEnvelope } = require('../src/protocol');
const { RelayHub } = require('./relay-hub');

const DEFAULT_HEARTBEAT_MS = 30 * 1000;
const DEFAULT_MAX_PAYLOAD = 512 * 1024;

function send(ws, type, payload) {
  if (ws.readyState === ws.OPEN) {ws.send(JSON.stringify(envelope(type, payload)));}
}

/** 向房間內每個已核准成員以外的成員廣播。 */
function broadcastExcept(server, room, senderId, type, payload) {
  for (const [memberId, socket] of server.sockets.entries()) {
    if (memberId === senderId) {continue;}
    if (!room.members.has(memberId)) {continue;}
    if (room.members.get(memberId).state !== 'approved') {continue;}
    send(socket, type, payload);
  }
}

class SignalingServer extends EventEmitter {
  /**
   * @param {object} options
   * @param {RoomRegistry} options.registry 房間註冊表
   * @param {RelayHub} [options.hub] 中繼資料面（限速與統計）
   * @param {string} [options.serverToken] 選用的伺服器認證權杖
   * @param {number} [options.heartbeatMs]
   * @param {number} [options.maxPayloadBytes]
   * @param {() => number} [options.now]
   */
  constructor(options = {}) {
    super();
    this.registry = options.registry;
    this.hub = options.hub || new RelayHub();
    this.serverToken = options.serverToken || null;
    this.heartbeatMs = options.heartbeatMs || DEFAULT_HEARTBEAT_MS;
    this.maxPayloadBytes = options.maxPayloadBytes || DEFAULT_MAX_PAYLOAD;
    this.sockets = new Map(); // deviceId → ws
    this.roomsBySocket = new Map(); // ws → Set<roomToken>
    this.heartbeatTimer = null;
    this.wss = null;
  }

  /** 建立 WebSocketServer（可掛在既有 HTTP(S) server 上）。 */
  start({ server, path = '/ws' } = {}) {
    this.wss = new WebSocketServer({ server, path, maxPayload: this.maxPayloadBytes });
    this.wss.on('connection', (ws) => this.handleSocket(ws));
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatMs);
    if (this.heartbeatTimer.unref) {this.heartbeatTimer.unref();}
    return this.wss;
  }

  async stop() {
    if (this.heartbeatTimer) {clearInterval(this.heartbeatTimer);}
    this.heartbeatTimer = null;
    for (const ws of this.sockets.values()) {ws.terminate();}
    this.sockets.clear();
    this.roomsBySocket.clear();
    if (this.wss) {await new Promise((resolve) => this.wss.close(resolve));}
    this.wss = null;
  }

  heartbeat() {
    for (const [deviceId, ws] of this.sockets) {
      if (!ws.isAlive) {
        this.dropSocket(ws, deviceId);
        ws.terminate();
      } else {
        ws.isAlive = false;
        ws.ping();
      }
    }
  }

  /** 從所有房間移除該裝置並通知同房成員。 */
  dropSocket(ws, deviceId) {
    const roomTokens = this.roomsBySocket.get(ws);
    this.roomsBySocket.delete(ws);
    this.sockets.delete(deviceId);
    if (!roomTokens) {return;}
    for (const token of roomTokens) {
      const room = this.registry.get(token);
      if (!room) {continue;}
      this.registry.removeMember(room, deviceId);
      const payload = { roomToken: token, members: this.registry.members(room) };
      for (const [memberId, socket] of this.sockets) {
        if (room.members.has(memberId)) {send(socket, MESSAGE_TYPES.ROOM_STATE, payload);}
      }
      if (this.registry.size() === 0 || this.registry.members(room).length === 0) {
        this.hub.remove(token);
      }
    }
  }

  handleSocket(ws) {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => this.handleMessage(ws, raw));
    ws.on('close', () => this.dropSocket(ws, ws.deviceId));
    ws.on('error', () => {});
  }

  handleMessage(ws, raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return send(ws, MESSAGE_TYPES.ERROR, { error: '訊息不是有效的 JSON。' });
    }
    const invalid = validateEnvelope(message);
    if (invalid) {return send(ws, MESSAGE_TYPES.ERROR, { error: invalid });}
    const { type, payload } = message;
    try {
      this.dispatch(ws, type, payload);
    } catch (error) {
      send(ws, MESSAGE_TYPES.ERROR, { error: error.message || '伺服器處理失敗。' });
      // 'error' 是 EventEmitter 保留事件：僅在有人監聽時發出，避免未處理異常
      if (this.listenerCount('error') > 0) {this.emit('error', error);}
    }
  }

  requireDevice(ws) {
    if (!ws.deviceId) {throw new Error('請先註冊裝置。');}
  }

  dispatch(ws, type, payload) {
    switch (type) {
      case MESSAGE_TYPES.REGISTER: return this.onRegister(ws, payload);
      case MESSAGE_TYPES.CREATE_ROOM: this.requireDevice(ws); return this.onCreateRoom(ws, payload);
      case MESSAGE_TYPES.JOIN_ROOM: this.requireDevice(ws); return this.onJoinRoom(ws, payload);
      case MESSAGE_TYPES.APPROVE: this.requireDevice(ws); return this.onApprove(ws, payload);
      case MESSAGE_TYPES.SIGNAL: this.requireDevice(ws); return this.onSignal(ws, payload);
      case MESSAGE_TYPES.PEER_KEY: this.requireDevice(ws); return this.onPeerKey(ws, payload);
      case MESSAGE_TYPES.RELAY_FRAME: this.requireDevice(ws); return this.onRelayFrame(ws, payload);
      case MESSAGE_TYPES.RELAY_ACK: this.requireDevice(ws); return this.onRelayAck(ws, payload);
      case MESSAGE_TYPES.RELAY_REQUEST:
        this.requireDevice(ws);
        return this.onRelayRequest(ws, payload);
      case MESSAGE_TYPES.PING: return send(ws, MESSAGE_TYPES.PONG, { time: Date.now() });
      case MESSAGE_TYPES.BYE: this.requireDevice(ws); return this.onBye(ws, payload);
      default: throw new Error(`不支援的訊息類型：${type}`);
    }
  }

  onRegister(ws, payload) {
    if (this.serverToken && payload.token !== this.serverToken) {
      this.emit('rejected', { reason: 'bad-token' });
      return send(ws, MESSAGE_TYPES.ERROR, { error: '伺服器認證失敗。' });
    }
    const deviceId = String(payload.deviceId || '').trim().slice(0, 80);
    if (!deviceId) {throw new Error('缺少裝置識別碼。');}
    if (this.sockets.has(deviceId)) {
      const existing = this.sockets.get(deviceId);
      if (existing !== ws) {existing.terminate();}
    }
    ws.deviceId = deviceId;
    ws.name = String(payload.name || '未命名裝置').slice(0, 48);
    ws.platform = String(payload.platform || 'unknown').slice(0, 32);
    this.sockets.set(deviceId, ws);
    this.roomsBySocket.set(ws, new Set());
    this.emit('registered', { deviceId, name: ws.name, platform: ws.platform });
    send(ws, MESSAGE_TYPES.WELCOME, {
      deviceId,
      serverTime: Date.now(),
      relayChunkBytes: this.hub.maxChunkBytes,
      bytesPerSecond: this.hub.bytesPerSecond,
    });
  }

  onCreateRoom(ws, payload) {
    const credentials = createRoomCredentials();
    const hostKey = typeof payload.publicKey === 'string' ? payload.publicKey : null;
    const room = this.registry.create({
      roomCode: credentials.roomCode,
      roomToken: credentials.roomToken,
      hostId: ws.deviceId,
      hostName: payload.name || ws.name,
      hostKey,
      hostMeta: { platform: ws.platform },
    });
    this.roomsBySocket.get(ws).add(room.roomToken);
    this.emit('room-created', { roomCode: room.roomCode, hostId: ws.deviceId });
    send(ws, MESSAGE_TYPES.ROOM_CREATED, {
      roomCode: room.roomCode,
      roomToken: room.roomToken,
      expiresAt: room.expiresAt,
      members: this.registry.members(room),
    });
  }

  onJoinRoom(ws, payload) {
    const room = this.registry.byCode(payload.roomCode);
    if (!room) {throw new Error('找不到這個房間，或房間已過期。');}
    this.registry.join(room, {
      id: ws.deviceId,
      name: payload.name || ws.name,
      publicKey: typeof payload.publicKey === 'string' ? payload.publicKey : null,
      meta: { platform: ws.platform },
    });
    this.roomsBySocket.get(ws).add(room.roomToken);
    this.emit('room-joined', { roomCode: room.roomCode, deviceId: ws.deviceId });
    const state = { roomToken: room.roomToken, members: this.registry.members(room) };
    send(ws, MESSAGE_TYPES.ROOM_STATE, state);
    for (const [memberId, socket] of this.sockets) {
      if (memberId !== ws.deviceId && room.members.has(memberId)) {
        send(socket, MESSAGE_TYPES.ROOM_STATE, state);
      }
    }
  }

  onApprove(ws, payload) {
    const room = this.registry.get(payload.roomToken);
    if (!room) {throw new Error('找不到這個房間。');}
    const member = this.registry.approve(
      room,
      ws.deviceId,
      payload.memberId,
      Boolean(payload.approved),
    );
    this.emit('approved', { roomCode: room.roomCode, deviceId: member.id, approved: member.state === 'approved' });
    const state = { roomToken: room.roomToken, members: this.registry.members(room) };
    for (const [memberId, socket] of this.sockets) {
      if (room.members.has(memberId)) {send(socket, MESSAGE_TYPES.ROOM_STATE, state);}
    }
  }

  onSignal(ws, payload) {
    const room = this.registry.get(payload.roomToken);
    if (!room) {throw new Error('找不到這個房間。');}
    const sender = room.members.get(ws.deviceId);
    if (!sender || sender.state !== 'approved') {throw new Error('尚未獲得核准，無法交換連線資訊。');}
    const target = this.sockets.get(payload.target);
    if (!target || !room.members.has(payload.target)) {throw new Error('找不到目標裝置。');}
    send(target, MESSAGE_TYPES.SIGNAL, {
      roomToken: room.roomToken,
      from: ws.deviceId,
      data: payload.data,
    });
  }

  onPeerKey(ws, payload) {
    const room = this.registry.get(payload.roomToken);
    if (!room) {throw new Error('找不到這個房間。');}
    const sender = room.members.get(ws.deviceId);
    if (!sender || sender.state !== 'approved') {throw new Error('尚未獲得核准，無法交換金鑰。');}
    this.registry.setPeerKey(room, ws.deviceId, String(payload.publicKey || ''), payload.salt || null);
    const state = { roomToken: room.roomToken, members: this.registry.members(room) };
    for (const [memberId, socket] of this.sockets) {
      if (room.members.has(memberId)) {send(socket, MESSAGE_TYPES.ROOM_STATE, state);}
    }
  }

  onRelayFrame(ws, payload) {
    const room = this.registry.get(payload.roomToken);
    if (!room) {throw new Error('找不到這個房間。');}
    const size = Buffer.byteLength(String(payload.data || ''), 'base64');
    const result = this.hub.relayChunk({
      roomToken: room.roomToken,
      senderId: ws.deviceId,
      room,
      bytes: size,
      forward: () => broadcastExcept(this, room, ws.deviceId, MESSAGE_TYPES.RELAY_FRAME, {
        roomToken: room.roomToken,
        from: ws.deviceId,
        fileId: payload.fileId,
        seq: payload.seq,
        total: payload.total,
        checksum: payload.checksum,
        iv: payload.iv,
        data: payload.data,
      }),
    });
    if (!result.ok) {send(ws, MESSAGE_TYPES.ERROR, { error: result.reason, retryable: true });}
  }

  onRelayAck(ws, payload) {
    const room = this.registry.get(payload.roomToken);
    if (!room) {throw new Error('找不到這個房間。');}
    broadcastExcept(this, room, ws.deviceId, MESSAGE_TYPES.RELAY_ACK, {
      roomToken: room.roomToken,
      from: ws.deviceId,
      fileId: payload.fileId,
      seq: payload.seq,
    });
  }

  onRelayRequest(ws, payload) {
    const room = this.registry.get(payload.roomToken);
    if (!room) {throw new Error('找不到這個房間。');}
    broadcastExcept(this, room, ws.deviceId, MESSAGE_TYPES.RELAY_REQUEST, {
      roomToken: room.roomToken,
      from: ws.deviceId,
      fileId: payload.fileId,
      missing: payload.missing,
    });
  }

  onBye(ws, payload) {
    const roomTokens = payload?.roomToken
      ? [payload.roomToken]
      : [...(this.roomsBySocket.get(ws) || [])];
    for (const token of roomTokens) {
      const room = this.registry.get(token);
      if (!room) {continue;}
      this.registry.removeMember(room, ws.deviceId);
      this.roomsBySocket.get(ws).delete(token);
      const state = { roomToken: token, members: this.registry.members(room) };
      for (const [memberId, socket] of this.sockets) {
        if (room.members.has(memberId)) {send(socket, MESSAGE_TYPES.ROOM_STATE, state);}
      }
      if (this.registry.members(room).length === 0) {this.hub.remove(token);}
    }
  }
}

module.exports = { SignalingServer };
