'use strict';

// 訊號協定：定義中繼伺服器與所有端點（Windows 桌面、Linux 主機、行動網頁）
// 之間的交換格式。所有訊息皆為 JSON，經 WSS 傳送；檔案資料走中繼資料面。
// 詳見 docs/PROTOCOL.md。

const { randomToken } = require('./crypto');

const MESSAGE_TYPES = Object.freeze({
  REGISTER: 'register',           // 端點 → 伺服器：註冊裝置與公鑰
  WELCOME: 'welcome',             // 伺服器 → 端點：註冊成功
  CREATE_ROOM: 'create-room',     // 主機 → 伺服器：建立遠端房間
  ROOM_CREATED: 'room-created',   // 伺服器 → 主機：房間代碼與權杖
  JOIN_ROOM: 'join-room',         // 訪客 → 伺服器：以房間代碼加入
  ROOM_STATE: 'room-state',       // 伺服器 → 成員：成員與核准狀態
  APPROVE: 'approve',             // 主機 → 伺服器：核准／拒絕訪客
  SIGNAL: 'signal',               // 端點 ⇄ 伺服器：轉發 WebRTC 協商訊息
  PEER_KEY: 'peer-key',           // 端點 ⇄ 伺服器：交換 ECDH 公鑰與鹽
  RELAY_FRAME: 'relay-frame',     // 端點 ⇄ 伺服器：中繼檔案區塊（加密後）
  RELAY_ACK: 'relay-ack',         // 端點 ⇄ 伺服器：區塊確認
  RELAY_REQUEST: 'relay-request', // 端點 ⇄ 伺服器：要求重傳遺失區塊
  PING: 'ping',                   // 心跳
  PONG: 'pong',                   // 心跳回應
  BYE: 'bye',                     // 離開房間
  ERROR: 'error',                  // 伺服器 → 端點：錯誤
});

const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 房間最長 24 小時
const CLIENT_NAME_MAX = 48;

/** 產生一個含亂數權杖的房間代碼（6 位十六進位，如 A1B2C3）。 */
function createRoomCredentials() {
  const buffer = new Uint8Array(3);
  globalThis.crypto.getRandomValues(buffer);
  const roomCode = Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return { roomCode, roomToken: randomToken(32) };
}

/** 簡易信封：所有訊號訊息都帶 type 與 payload。 */
function envelope(type, payload = {}) {
  return { v: 1, type, payload };
}

/** 檢查物件是否為合法信封；回傳 null 表示合法，否則回傳錯誤訊息。 */
function validateEnvelope(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {return '訊息必須是 JSON 物件。';}
  if (message.v !== 1) {return '不支援的協定版本。';}
  if (!Object.values(MESSAGE_TYPES).includes(message.type)) {return '未知的訊息類型。';}
  if (message.payload === undefined || message.payload === null || typeof message.payload !== 'object') {return '缺少 payload。';}
  return null;
}

function sanitizeName(value) {
  return String(value || '未命名裝置').trim().slice(0, CLIENT_NAME_MAX) || '未命名裝置';
}

/**
 * 房間註冊表：追蹤房間、成員、核准狀態與到期時間。
 * 主機建立房間後為 host，其他成員必須獲得 host 核准才能收發資料。
 */
class RoomRegistry {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || ROOM_TTL_MS;
    this.now = options.now || (() => Date.now());
    this.rooms = new Map(); // roomToken → room
  }

  create({ roomCode, roomToken, hostId, hostName, hostKey, hostMeta = {} }) {
    const room = {
      roomCode,
      roomToken,
      hostId,
      createdAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
      members: new Map(),
    };
    room.members.set(hostId, {
      id: hostId,
      name: sanitizeName(hostName),
      publicKey: hostKey || null,
      role: 'host',
      state: 'approved',
      joinedAt: this.now(),
      meta: hostMeta,
    });
    this.rooms.set(roomToken, room);
    return room;
  }

  get(token) {
    const room = this.rooms.get(token);
    if (!room) {return null;}
    if (this.now() >= room.expiresAt) {
      this.rooms.delete(token);
      return null;
    }
    return room;
  }

  byCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    for (const room of this.rooms.values()) {
      if (this.now() >= room.expiresAt) { this.rooms.delete(room.roomToken); continue; }
      if (room.roomCode === normalized) {return room;}
    }
    return null;
  }

  join(room, { id, name, publicKey = null, meta = {} }) {
    if (room.members.has(id)) {return room.members.get(id);}
    const member = {
      id,
      name: sanitizeName(name),
      publicKey,
      role: 'guest',
      state: 'pending',
      joinedAt: this.now(),
      meta,
    };
    room.members.set(id, member);
    return member;
  }

  approve(room, hostId, memberId, approved) {
    const host = room.members.get(hostId);
    if (!host || host.role !== 'host') {throw new Error('只有主機可以核准裝置。');}
    const member = room.members.get(memberId);
    if (!member) {throw new Error('找不到此裝置。');}
    if (member.role === 'host') {throw new Error('主機本身不需要核准。');}
    member.state = approved ? 'approved' : 'rejected';
    return member;
  }

  setPeerKey(room, memberId, publicKey, salt) {
    const member = room.members.get(memberId);
    if (!member) {return false;}
    member.publicKey = publicKey;
    member.keySalt = salt || null;
    return true;
  }

  members(room) {
    return [...room.members.values()].map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      state: member.state,
      joinedAt: member.joinedAt,
      publicKey: member.publicKey,
      keySalt: member.keySalt || null,
      meta: member.meta,
    }));
  }

  approvedCount(room) {
    let count = 0;
    for (const member of room.members.values()) {
      if (member.state === 'approved') {
        count += 1;
      }
    }
    return count;
  }

  removeMember(room, memberId) {
    const existed = room.members.delete(memberId);
    if (existed && room.members.size === 0) {this.rooms.delete(room.roomToken);}
    return existed;
  }

  remove(token) {
    return this.rooms.delete(token);
  }

  /** 清理過期房間，回傳移除數量。 */
  sweep() {
    let removed = 0;
    for (const [token, room] of this.rooms) {
      if (this.now() >= room.expiresAt) {
        this.rooms.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  size() {
    return this.rooms.size;
  }
}

module.exports = {
  MESSAGE_TYPES,
  ROOM_TTL_MS,
  createRoomCredentials,
  envelope,
  validateEnvelope,
  sanitizeName,
  RoomRegistry,
};
