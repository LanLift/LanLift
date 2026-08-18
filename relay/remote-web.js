"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // src/event-emitter.js
  var require_event_emitter = __commonJS({
    "src/event-emitter.js"(exports, module) {
      "use strict";
      var MiniEventEmitter = class {
        constructor() {
          this.listeners = /* @__PURE__ */ new Map();
        }
        on(type, listener) {
          const set = this.listeners.get(type) || /* @__PURE__ */ new Set();
          set.add(listener);
          this.listeners.set(type, set);
          return this;
        }
        off(type, listener) {
          const set = this.listeners.get(type);
          if (!set) {
            return this;
          }
          set.delete(listener);
          if (set.size === 0) {
            this.listeners.delete(type);
          }
          return this;
        }
        once(type, listener) {
          const wrapper = (...args) => {
            this.off(type, wrapper);
            listener(...args);
          };
          return this.on(type, wrapper);
        }
        emit(type, ...args) {
          const set = this.listeners.get(type);
          if (!set) {
            return false;
          }
          for (const listener of [...set]) {
            listener(...args);
          }
          return true;
        }
        removeAllListeners(type) {
          if (type === void 0) {
            this.listeners.clear();
          } else {
            this.listeners.delete(type);
          }
          return this;
        }
      };
      module.exports = { MiniEventEmitter };
    }
  });

  // src/crypto.js
  var require_crypto = __commonJS({
    "src/crypto.js"(exports, module) {
      "use strict";
      var subtle = globalThis.crypto?.subtle;
      var textEncoder = new TextEncoder();
      var textDecoder = new TextDecoder();
      function assertCrypto() {
        if (!subtle) {
          throw new Error("\u6B64\u74B0\u5883\u4E0D\u652F\u63F4 WebCrypto\uFF0C\u7121\u6CD5\u5EFA\u7ACB\u5B89\u5168\u9023\u7DDA\u3002");
        }
      }
      function bytesToBase64(bytes) {
        const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let binary = "";
        const step = 32768;
        for (let offset = 0; offset < source.length; offset += step) {
          binary += String.fromCharCode(...source.subarray(offset, offset + step));
        }
        return btoa(binary);
      }
      function base64ToBytes(value) {
        const binary = atob(String(value || "").replace(/-/g, "+").replace(/_/g, "/"));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
      }
      function bytesToBase64Url(bytes) {
        return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      }
      async function generateKeyPair() {
        assertCrypto();
        const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
        const publicKey = await subtle.exportKey("spki", pair.publicKey);
        const privateKey = await subtle.exportKey("pkcs8", pair.privateKey);
        return {
          publicKey: bytesToBase64(new Uint8Array(publicKey)),
          privateKey: bytesToBase64(new Uint8Array(privateKey))
        };
      }
      async function importPublicKey(encoded) {
        assertCrypto();
        return subtle.importKey("spki", base64ToBytes(encoded), { name: "ECDH", namedCurve: "P-256" }, false, []);
      }
      async function importPrivateKey(encoded) {
        assertCrypto();
        return subtle.importKey("pkcs8", base64ToBytes(encoded), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
      }
      async function deriveSessionKey(privateKeyEncoded, peerPublicKeyEncoded, salt) {
        assertCrypto();
        const privateKey = await importPrivateKey(privateKeyEncoded);
        const peerPublicKey = await importPublicKey(peerPublicKeyEncoded);
        const sharedBits = await subtle.deriveBits({ name: "ECDH", public: peerPublicKey }, privateKey, 256);
        const saltBytes = typeof salt === "string" ? base64ToBytes(salt) : salt instanceof Uint8Array ? salt : new Uint8Array(0);
        const material = await subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
        return subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: saltBytes, info: textEncoder.encode("lanlift/e2e/v1") },
          material,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
      }
      async function encryptText(key, plaintext) {
        assertCrypto();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await subtle.encrypt({ name: "AES-GCM", iv }, key, textEncoder.encode(String(plaintext)));
        return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) };
      }
      async function decryptText(key, iv, data) {
        assertCrypto();
        const plain = await subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, key, base64ToBytes(data));
        return textDecoder.decode(plain);
      }
      async function encryptBytes(key, bytes) {
        assertCrypto();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
        return { iv, data: new Uint8Array(cipher) };
      }
      async function decryptBytes(key, iv, data) {
        assertCrypto();
        const plain = await subtle.decrypt({ name: "AES-GCM", iv }, key, data);
        return new Uint8Array(plain);
      }
      function randomToken(bytes = 32) {
        assertCrypto();
        const buffer = new Uint8Array(bytes);
        crypto.getRandomValues(buffer);
        return bytesToBase64Url(buffer);
      }
      function roomCode() {
        const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
        const buffer = new Uint8Array(6);
        crypto.getRandomValues(buffer);
        let code = "";
        for (let index = 0; index < 6; index += 1) {
          code += alphabet[buffer[index] % alphabet.length];
        }
        return code;
      }
      module.exports = {
        generateKeyPair,
        importPublicKey,
        importPrivateKey,
        deriveSessionKey,
        encryptText,
        decryptText,
        encryptBytes,
        decryptBytes,
        randomToken,
        roomCode,
        bytesToBase64,
        bytesToBase64Url,
        base64ToBytes
      };
    }
  });

  // src/protocol.js
  var require_protocol = __commonJS({
    "src/protocol.js"(exports, module) {
      "use strict";
      var { randomToken } = require_crypto();
      var MESSAGE_TYPES = Object.freeze({
        REGISTER: "register",
        // 端點 → 伺服器：註冊裝置與公鑰
        WELCOME: "welcome",
        // 伺服器 → 端點：註冊成功
        CREATE_ROOM: "create-room",
        // 主機 → 伺服器：建立遠端房間
        ROOM_CREATED: "room-created",
        // 伺服器 → 主機：房間代碼與權杖
        JOIN_ROOM: "join-room",
        // 訪客 → 伺服器：以房間代碼加入
        ROOM_STATE: "room-state",
        // 伺服器 → 成員：成員與核准狀態
        APPROVE: "approve",
        // 主機 → 伺服器：核准／拒絕訪客
        SIGNAL: "signal",
        // 端點 ⇄ 伺服器：轉發 WebRTC 協商訊息
        PEER_KEY: "peer-key",
        // 端點 ⇄ 伺服器：交換 ECDH 公鑰與鹽
        RELAY_FRAME: "relay-frame",
        // 端點 ⇄ 伺服器：中繼檔案區塊（加密後）
        RELAY_ACK: "relay-ack",
        // 端點 ⇄ 伺服器：區塊確認
        RELAY_REQUEST: "relay-request",
        // 端點 ⇄ 伺服器：要求重傳遺失區塊
        PING: "ping",
        // 心跳
        PONG: "pong",
        // 心跳回應
        BYE: "bye",
        // 離開房間
        ERROR: "error"
        // 伺服器 → 端點：錯誤
      });
      var ROOM_TTL_MS = 24 * 60 * 60 * 1e3;
      var CLIENT_NAME_MAX = 48;
      function createRoomCredentials() {
        const buffer = new Uint8Array(3);
        globalThis.crypto.getRandomValues(buffer);
        const roomCode = Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
        return { roomCode, roomToken: randomToken(32) };
      }
      function envelope(type, payload = {}) {
        return { v: 1, type, payload };
      }
      function validateEnvelope(message) {
        if (!message || typeof message !== "object" || Array.isArray(message)) {
          return "\u8A0A\u606F\u5FC5\u9808\u662F JSON \u7269\u4EF6\u3002";
        }
        if (message.v !== 1) {
          return "\u4E0D\u652F\u63F4\u7684\u5354\u5B9A\u7248\u672C\u3002";
        }
        if (!Object.values(MESSAGE_TYPES).includes(message.type)) {
          return "\u672A\u77E5\u7684\u8A0A\u606F\u985E\u578B\u3002";
        }
        if (message.payload === void 0 || message.payload === null || typeof message.payload !== "object") {
          return "\u7F3A\u5C11 payload\u3002";
        }
        return null;
      }
      function sanitizeName(value) {
        return String(value || "\u672A\u547D\u540D\u88DD\u7F6E").trim().slice(0, CLIENT_NAME_MAX) || "\u672A\u547D\u540D\u88DD\u7F6E";
      }
      var RoomRegistry = class {
        constructor(options = {}) {
          this.ttlMs = options.ttlMs || ROOM_TTL_MS;
          this.now = options.now || (() => Date.now());
          this.rooms = /* @__PURE__ */ new Map();
        }
        create({ roomCode, roomToken, hostId, hostName, hostKey, hostMeta = {} }) {
          const room = {
            roomCode,
            roomToken,
            hostId,
            createdAt: this.now(),
            expiresAt: this.now() + this.ttlMs,
            members: /* @__PURE__ */ new Map()
          };
          room.members.set(hostId, {
            id: hostId,
            name: sanitizeName(hostName),
            publicKey: hostKey || null,
            role: "host",
            state: "approved",
            joinedAt: this.now(),
            meta: hostMeta
          });
          this.rooms.set(roomToken, room);
          return room;
        }
        get(token) {
          const room = this.rooms.get(token);
          if (!room) {
            return null;
          }
          if (this.now() >= room.expiresAt) {
            this.rooms.delete(token);
            return null;
          }
          return room;
        }
        byCode(code) {
          const normalized = String(code || "").trim().toUpperCase();
          for (const room of this.rooms.values()) {
            if (this.now() >= room.expiresAt) {
              this.rooms.delete(room.roomToken);
              continue;
            }
            if (room.roomCode === normalized) {
              return room;
            }
          }
          return null;
        }
        join(room, { id, name, publicKey = null, meta = {} }) {
          if (room.members.has(id)) {
            return room.members.get(id);
          }
          const member = {
            id,
            name: sanitizeName(name),
            publicKey,
            role: "guest",
            state: "pending",
            joinedAt: this.now(),
            meta
          };
          room.members.set(id, member);
          return member;
        }
        approve(room, hostId, memberId, approved) {
          const host = room.members.get(hostId);
          if (!host || host.role !== "host") {
            throw new Error("\u53EA\u6709\u4E3B\u6A5F\u53EF\u4EE5\u6838\u51C6\u88DD\u7F6E\u3002");
          }
          const member = room.members.get(memberId);
          if (!member) {
            throw new Error("\u627E\u4E0D\u5230\u6B64\u88DD\u7F6E\u3002");
          }
          if (member.role === "host") {
            throw new Error("\u4E3B\u6A5F\u672C\u8EAB\u4E0D\u9700\u8981\u6838\u51C6\u3002");
          }
          member.state = approved ? "approved" : "rejected";
          return member;
        }
        setPeerKey(room, memberId, publicKey, salt) {
          const member = room.members.get(memberId);
          if (!member) {
            return false;
          }
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
            meta: member.meta
          }));
        }
        approvedCount(room) {
          let count = 0;
          for (const member of room.members.values()) {
            if (member.state === "approved") {
              count += 1;
            }
          }
          return count;
        }
        removeMember(room, memberId) {
          const existed = room.members.delete(memberId);
          if (existed && room.members.size === 0) {
            this.rooms.delete(room.roomToken);
          }
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
      };
      module.exports = {
        MESSAGE_TYPES,
        ROOM_TTL_MS,
        createRoomCredentials,
        envelope,
        validateEnvelope,
        sanitizeName,
        RoomRegistry
      };
    }
  });

  // src/relay-client.js
  var require_relay_client = __commonJS({
    "src/relay-client.js"(exports, module) {
      "use strict";
      var { MiniEventEmitter } = require_event_emitter();
      var { MESSAGE_TYPES, envelope, sanitizeName } = require_protocol();
      var { randomToken } = require_crypto();
      var DEFAULT_HEARTBEAT_MS = 20 * 1e3;
      var RECONNECT_BASE_MS = 1e3;
      var RECONNECT_MAX_MS = 30 * 1e3;
      var RelayClient = class extends MiniEventEmitter {
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
          if (!this.url) {
            throw new Error("\u8ACB\u63D0\u4F9B\u8A0A\u865F\u4F3A\u670D\u5668\u7DB2\u5740\u3002");
          }
          this.serverToken = options.serverToken || null;
          this.WebSocketImpl = options.WebSocketImpl !== void 0 ? options.WebSocketImpl : typeof WebSocket === "undefined" ? null : WebSocket;
          this.storage = options.storage || null;
          this.now = options.now || (() => Date.now());
          this.heartbeatMs = options.heartbeatMs || DEFAULT_HEARTBEAT_MS;
          this.deviceName = sanitizeName(options.deviceName || "\u672A\u547D\u540D\u88DD\u7F6E");
          this.platform = String(options.platform || "web").slice(0, 32);
          this.deviceId = options.deviceId || this.loadDeviceId();
          this.rooms = /* @__PURE__ */ new Set();
          this.ws = null;
          this.connected = false;
          this.closedByUser = false;
          this.reconnectAttempt = 0;
          this.reconnectTimer = null;
          this.heartbeatTimer = null;
          this.pending = null;
          this.outbox = [];
          this.lastWelcome = null;
        }
        loadDeviceId() {
          const key = "lanlift-device-id";
          let id = null;
          try {
            id = this.storage?.getItem(key) || null;
          } catch {
            id = null;
          }
          if (!id) {
            id = `dev-${randomToken(12)}`;
            try {
              this.storage?.setItem(key, id);
            } catch {
            }
          }
          return id;
        }
        isConnected() {
          return this.connected;
        }
        connect() {
          if (this.closedByUser || this.ws) {
            return;
          }
          const WebSocketImpl = this.WebSocketImpl;
          if (!WebSocketImpl) {
            throw new Error("\u6B64\u74B0\u5883\u4E0D\u652F\u63F4 WebSocket\u3002");
          }
          const ws = new WebSocketImpl(this.url);
          this.ws = ws;
          ws.addEventListener("open", () => this.onOpen(ws));
          ws.addEventListener("message", (event) => this.onMessage(ws, event));
          ws.addEventListener("close", () => this.onClose(ws));
          ws.addEventListener("error", () => {
          });
        }
        onOpen(ws) {
          ws.send(JSON.stringify(envelope(MESSAGE_TYPES.REGISTER, {
            deviceId: this.deviceId,
            name: this.deviceName,
            platform: this.platform,
            token: this.serverToken
          })));
          this.connected = true;
          this.reconnectAttempt = 0;
          this.heartbeatTimer = setInterval(() => this.ping(), this.heartbeatMs);
          if (this.heartbeatTimer.unref) {
            this.heartbeatTimer.unref();
          }
          for (const data of this.outbox.splice(0)) {
            try {
              ws.send(data);
            } catch {
            }
          }
          this.emit("open", { deviceId: this.deviceId });
        }
        onMessage(ws, event) {
          let raw;
          try {
            raw = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
          } catch {
            return;
          }
          let message;
          try {
            message = JSON.parse(raw);
          } catch {
            return;
          }
          this.handle(message);
        }
        handle(message) {
          const { type, payload } = message;
          switch (type) {
            case MESSAGE_TYPES.WELCOME:
              this.lastWelcome = payload;
              this.emit("welcome", payload);
              for (const token of this.rooms) {
                this.rejoin(token);
              }
              break;
            case MESSAGE_TYPES.ROOM_CREATED:
              this.rooms.add(payload.roomToken);
              this.emit("room-created", payload);
              break;
            case MESSAGE_TYPES.ROOM_STATE:
              this.rooms.add(payload.roomToken);
              this.emit("room-state", payload);
              break;
            case MESSAGE_TYPES.SIGNAL:
              this.emit("signal", payload);
              break;
            case MESSAGE_TYPES.RELAY_FRAME:
              this.emit("frame", payload);
              break;
            case MESSAGE_TYPES.RELAY_ACK:
              this.emit("ack", payload);
              break;
            case MESSAGE_TYPES.RELAY_REQUEST:
              this.emit("request", payload);
              break;
            case MESSAGE_TYPES.PONG:
              this.emit("pong", payload);
              break;
            case MESSAGE_TYPES.ERROR:
              this.emit("error", payload);
              break;
            default:
              this.emit("message", message);
          }
        }
        rejoin(token) {
          this.emit("rejoined", { roomToken: token });
        }
        onClose(ws) {
          if (this.ws !== ws) {
            return;
          }
          this.ws = null;
          this.connected = false;
          if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
          }
          this.heartbeatTimer = null;
          this.emit("close", { code: ws.closeCode });
          if (this.closedByUser) {
            return;
          }
          const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
          this.reconnectAttempt += 1;
          this.emit("reconnecting", { attempt: this.reconnectAttempt, delayMs: delay });
          this.reconnectTimer = setTimeout(() => this.connect(), delay);
          if (this.reconnectTimer.unref) {
            this.reconnectTimer.unref();
          }
        }
        ping() {
          if (!this.ws || !this.connected) {
            return;
          }
          try {
            this.ws.send(JSON.stringify(envelope(MESSAGE_TYPES.PING, { time: this.now() })));
          } catch {
          }
        }
        /** 送出訊息；連線未就緒時暫存於 outbox（連線後自動補送）。 */
        send(type, payload) {
          const data = JSON.stringify(envelope(type, payload));
          if (!this.ws || !this.connected) {
            if (this.outbox.length < 64) {
              this.outbox.push(data);
            }
            return false;
          }
          this.ws.send(data);
          return true;
        }
        createRoom(publicKey = null) {
          this.send(MESSAGE_TYPES.CREATE_ROOM, {
            name: this.deviceName,
            platform: this.platform,
            publicKey
          });
        }
        joinRoom(code, publicKey = null) {
          this.send(MESSAGE_TYPES.JOIN_ROOM, { roomCode: String(code || "").trim().toUpperCase(), name: this.deviceName, platform: this.platform, publicKey });
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
            data: frame.data
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
          if (roomToken) {
            this.rooms.delete(roomToken);
          }
        }
        close() {
          this.closedByUser = true;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
          }
          this.reconnectTimer = null;
          if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
          }
          this.heartbeatTimer = null;
          if (this.ws) {
            try {
              this.ws.close();
            } catch {
            }
            this.ws = null;
          }
          this.connected = false;
        }
      };
      module.exports = { RelayClient };
    }
  });

  // src/chunker.js
  var require_chunker = __commonJS({
    "src/chunker.js"(exports, module) {
      "use strict";
      var DEFAULT_CHUNK_SIZE = 64 * 1024;
      var MAX_RETRIES = 8;
      async function sha256(data) {
        const source = data instanceof Uint8Array ? data : new Uint8Array(data);
        const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", source));
        let hex = "";
        for (const byte of digest) {
          hex += byte.toString(16).padStart(2, "0");
        }
        return hex;
      }
      function randomId(bytes = 16) {
        const buffer = new Uint8Array(bytes);
        globalThis.crypto.getRandomValues(buffer);
        return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      async function chunkBuffer(buffer, options = {}) {
        const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
        const fileId = options.fileId || randomId();
        const source = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const chunks = [];
        const total = Math.ceil(source.length / chunkSize) || 1;
        for (let index = 0; index < total; index += 1) {
          const start = index * chunkSize;
          const end = Math.min(start + chunkSize, source.length);
          const data = source.subarray(start, end);
          chunks.push({
            fileId,
            seq: index,
            total,
            checksum: await sha256(data),
            data
          });
        }
        return { fileId, total, chunks };
      }
      var ChunkAssembler = class {
        constructor(options = {}) {
          this.fileId = null;
          this.total = options.total || 0;
          this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
          this.chunks = /* @__PURE__ */ new Map();
          this.received = 0;
          this.bytes = 0;
          this.done = false;
        }
        /** 接收一個區塊；校驗失敗回傳 'bad-checksum'，重複區塊回傳 'duplicate'。 */
        async accept(frame) {
          if (this.done) {
            return "duplicate";
          }
          if (this.fileId && frame.fileId !== this.fileId) {
            throw new Error("\u5340\u584A\u7684\u6A94\u6848\u8B58\u5225\u78BC\u4E0D\u4E00\u81F4\u3002");
          }
          if (!this.fileId) {
            this.fileId = frame.fileId;
            this.total = frame.total || this.total;
          }
          if (!Number.isInteger(frame.seq) || frame.seq < 0 || frame.seq >= this.total) {
            throw new Error("\u5340\u584A\u5E8F\u865F\u8D85\u51FA\u7BC4\u570D\u3002");
          }
          const data = frame.data instanceof Uint8Array ? frame.data : new Uint8Array(frame.data || []);
          if (await sha256(data) !== frame.checksum) {
            return "bad-checksum";
          }
          if (this.chunks.has(frame.seq)) {
            return "duplicate";
          }
          this.chunks.set(frame.seq, data);
          this.received += 1;
          this.bytes += data.length;
          if (this.received >= this.total) {
            this.done = true;
          }
          return "ok";
        }
        /** 回傳尚未收到的序號（供重傳要求）。 */
        missingSeqs() {
          const missing = [];
          for (let seq = 0; seq < this.total; seq += 1) {
            if (!this.chunks.has(seq)) {
              missing.push(seq);
            }
          }
          return missing;
        }
        /** 組合成完整 Uint8Array；未收齊時擲出錯誤。 */
        assemble() {
          if (!this.done) {
            throw new Error(`\u6A94\u6848\u5C1A\u672A\u63A5\u6536\u5B8C\u6210\uFF08${this.received}/${this.total}\uFF09\u3002`);
          }
          let size = 0;
          const ordered = [...this.chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, data]) => data);
          for (const chunk of ordered) {
            size += chunk.length;
          }
          const output = new Uint8Array(size);
          let offset = 0;
          for (const chunk of ordered) {
            output.set(chunk, offset);
            offset += chunk.length;
          }
          return output;
        }
      };
      function retryDelay(attempt) {
        return Math.min(1e3 * 2 ** Math.min(attempt, 5), 3e4);
      }
      var ChunkSender = class {
        constructor({ fileId, total, onDone, now } = {}) {
          this.fileId = fileId;
          this.total = total;
          this.onDone = onDone || (() => {
          });
          this.now = now || (() => Date.now());
          this.acked = /* @__PURE__ */ new Set();
          this.attempts = /* @__PURE__ */ new Map();
          this.lastSent = /* @__PURE__ */ new Map();
          this.completed = false;
        }
        isCompleted() {
          return this.completed;
        }
        /** 接收 ACK；全部確認後觸發完成。 */
        acknowledge(seq) {
          if (this.completed) {
            return;
          }
          this.acked.add(seq);
          if (this.acked.size >= this.total) {
            this.completed = true;
            this.onDone();
          }
        }
        /** 記錄一次送出（含初次與重試）。 */
        markSent(seq) {
          this.lastSent.set(seq, this.now());
        }
        /** 執行一次重試並回傳新重試次數。 */
        retry(seq) {
          const count = (this.attempts.get(seq) || 0) + 1;
          this.attempts.set(seq, count);
          this.markSent(seq);
          return count;
        }
        /** 尚未確認的區塊序號清單。 */
        pending() {
          const list = [];
          for (let seq = 0; seq < this.total; seq += 1) {
            if (!this.acked.has(seq)) {
              list.push(seq);
            }
          }
          return list;
        }
        /** 該區塊現在是否應該重試（已達退避時間且未超過次數上限）。 */
        shouldRetry(seq) {
          if (this.exhausted(seq)) {
            return false;
          }
          const attempts = this.attempts.get(seq) || 0;
          const last = this.lastSent.get(seq) || 0;
          return this.now() - last >= retryDelay(attempts + 1);
        }
        /** 該序號是否已超過最大重試次數。 */
        exhausted(seq) {
          return (this.attempts.get(seq) || 0) >= MAX_RETRIES;
        }
      };
      module.exports = {
        DEFAULT_CHUNK_SIZE,
        MAX_RETRIES,
        chunkBuffer,
        ChunkAssembler,
        ChunkSender,
        retryDelay,
        sha256,
        randomId
      };
    }
  });

  // src/remote-transfer.js
  var require_remote_transfer = __commonJS({
    "src/remote-transfer.js"(exports, module) {
      "use strict";
      var { MiniEventEmitter } = require_event_emitter();
      var { MESSAGE_TYPES } = require_protocol();
      var { generateKeyPair, deriveSessionKey, encryptBytes, decryptBytes, randomToken, bytesToBase64, base64ToBytes } = require_crypto();
      var { chunkBuffer, ChunkAssembler, ChunkSender, sha256, DEFAULT_CHUNK_SIZE } = require_chunker();
      var textEncoder = new TextEncoder();
      var textDecoder = new TextDecoder();
      var P2P_TIMEOUT_MS = 8e3;
      var ACK_INTERVAL_MS = 1500;
      var REQUEST_INTERVAL_MS = 2e3;
      var FILE_META_SEQ = -1;
      var P2PTransport = class {
        constructor(peer, onFrame) {
          this.kind = "p2p";
          this.peer = peer;
          this.onFrame = onFrame;
          this.channel = null;
          peer.ondatachannel = (event) => this.attach(event.channel);
          peer.ondata = null;
        }
        attach(channel) {
          this.channel = channel;
          channel.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              if (message && message.type === "frame") {
                this.onFrame(message.payload.frame);
              }
            } catch {
            }
          };
          this.channel.onopen = () => this.ready?.(true);
        }
        send(type, payload) {
          if (!this.channel || this.channel.readyState !== "open") {
            return false;
          }
          this.channel.send(JSON.stringify({ type, payload }));
          return true;
        }
      };
      var RemoteTransfer = class extends MiniEventEmitter {
        /**
         * @param {object} options
         * @param {RelayClient} options.client 訊號/中繼客戶端
         * @param {object} [options.rtcFactory] 具 createPeerConnection(config) 的工廠（瀏覽器注入）
         * @param {object} [options.rtcConfig] RTCPeerConnection 設定（STUN/TURN）
         * @param {number} [options.chunkSize]
         * @param {number} [options.p2pTimeoutMs]
         * @param {() => number} [options.now]
         */
        constructor(options = {}) {
          super();
          this.client = options.client;
          if (!this.client) {
            throw new Error("\u7F3A\u5C11\u8A0A\u865F\u5BA2\u6236\u7AEF\u3002");
          }
          this.rtcFactory = options.rtcFactory || null;
          this.rtcConfig = options.rtcConfig || { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
          this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
          this.p2pTimeoutMs = options.p2pTimeoutMs || P2P_TIMEOUT_MS;
          this.now = options.now || (() => Date.now());
          this.role = null;
          this.roomToken = null;
          this.roomCode = null;
          this.peerId = null;
          this.peerName = null;
          this.keyPair = null;
          this.sessionKey = null;
          this.salt = null;
          this.transport = null;
          this.p2p = null;
          this.p2pTimer = null;
          this.senders = /* @__PURE__ */ new Map();
          this.assemblers = /* @__PURE__ */ new Map();
          this.pendingSignals = [];
          this.ackTimer = null;
          this.requestTimer = null;
          this.closed = false;
          this.client.on("room-state", (payload) => this.onRoomState(payload));
          this.client.on("signal", (payload) => this.onSignal(payload));
          this.client.on("frame", (payload) => this.onFrame(payload));
          this.client.on("ack", (payload) => this.onAck(payload));
          this.client.on("request", (payload) => this.onRequest(payload));
          this.client.on("error", (payload) => this.emit("server-error", payload));
        }
        /** 主機：建立遠端房間。 */
        async host() {
          this.role = "host";
          this.keyPair = await generateKeyPair();
          this.client.createRoom(this.keyPair.publicKey);
          const payload = await this.waitFor("room-created");
          this.roomToken = payload.roomToken;
          this.roomCode = payload.roomCode;
          return {
            roomCode: payload.roomCode,
            roomToken: payload.roomToken,
            expiresAt: payload.expiresAt
          };
        }
        /** 訪客：以房間代碼加入。 */
        async join(roomCode) {
          this.role = "guest";
          this.keyPair = await generateKeyPair();
          this.client.joinRoom(roomCode, this.keyPair.publicKey);
          const payload = await this.waitForRoomState();
          this.roomToken = payload.roomToken;
          this.roomCode = String(roomCode).toUpperCase();
          const host = payload.members.find((member) => member.role === "host");
          this.peerId = host?.id || null;
          this.peerName = host?.name || null;
          return { roomToken: payload.roomToken, host: host ? { id: host.id, name: host.name } : null };
        }
        /** 主機核准／拒絕訪客。 */
        approve(memberId, approved) {
          this.client.approve(this.roomToken, memberId, approved);
        }
        /** 重連後由房間成員清單還原狀態。 */
        refresh() {
          if (!this.roomToken) {
            return;
          }
          this.client.send(MESSAGE_TYPES.JOIN_ROOM, {
            roomCode: this.roomCode,
            name: this.client.deviceName,
            platform: this.client.platform,
            publicKey: this.keyPair?.publicKey || null
          });
        }
        waitFor(type) {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("\u7B49\u5F85\u4F3A\u670D\u5668\u56DE\u61C9\u903E\u6642\u3002")), this.p2pTimeoutMs);
            const listener = (payload) => {
              clearTimeout(timeout);
              this.client.off(type, listener);
              resolve(payload);
            };
            this.client.on(type, listener);
          });
        }
        waitForRoomState() {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("\u52A0\u5165\u623F\u9593\u903E\u6642\u3002")), this.p2pTimeoutMs);
            const listener = (payload) => {
              clearTimeout(timeout);
              this.client.off("room-state", listener);
              resolve(payload);
            };
            this.client.on("room-state", listener);
          });
        }
        onRoomState(payload) {
          if (payload.roomToken !== this.roomToken) {
            return;
          }
          const members = payload.members || [];
          const self = members.find((member) => member.id === this.client.deviceId);
          const others = members.filter((member) => member.id !== this.client.deviceId);
          if (this.role === "host") {
            const guest = others.find((member) => member.role === "guest");
            if (guest && (!this.peerId || guest.id === this.peerId)) {
              this.peerId = guest.id;
              this.peerName = guest.name;
            }
            if (self?.publicKey && guest?.publicKey && guest.state === "approved" && !this.salt) {
              this.salt = randomToken(16);
              this.client.sendPeerKey(this.roomToken, self.publicKey, this.salt);
            }
          }
          if (this.role === "guest") {
            const host = others.find((member) => member.role === "host");
            if (self?.state === "approved" && host?.publicKey && host.keySalt && !this.sessionKey) {
              this.salt = host.keySalt;
              this.client.sendPeerKey(this.roomToken, self.publicKey, this.salt);
            }
          }
          this.emit("room-state", payload);
          this.tryDerive(members);
        }
        /** 雙方公鑰與鹽到齊後衍生工作階段金鑰並建立傳輸通道。 */
        async tryDerive(members) {
          if (this.sessionKey || !this.salt || !this.keyPair) {
            return;
          }
          const peer = members.find((member) => member.id === this.peerId);
          if (!peer?.publicKey) {
            return;
          }
          this.sessionKey = await deriveSessionKey(this.keyPair.privateKey, peer.publicKey, this.salt);
          this.emit("secured", { peerId: this.peerId, peerName: this.peerName });
          this.openTransport();
        }
        openTransport() {
          if (this.transport || this.closed) {
            return;
          }
          if (this.rtcFactory) {
            this.startP2P();
          }
          this.transport = this.makeRelayTransport();
          this.emit("transport", { kind: "relay" });
          this.startTimers();
        }
        makeRelayTransport() {
          return {
            kind: "relay",
            sendFrame: (frame) => this.client.sendFrame(this.roomToken, frame),
            sendAck: (fileId, seq) => this.client.sendAck(this.roomToken, fileId, seq),
            sendRequest: (fileId, missing) => this.client.sendRequest(this.roomToken, fileId, missing)
          };
        }
        startP2P() {
          if (this.p2p) {
            return;
          }
          const factory = this.rtcFactory;
          const peer = factory.createPeerConnection(this.rtcConfig);
          this.p2p = new P2PTransport(peer, (frame) => this.onFrame({ ...frame, via: "p2p" }));
          this.p2p.ready = (open) => {
            if (!open || this.transport?.kind === "p2p") {
              return;
            }
            this.transport = {
              kind: "p2p",
              sendFrame: (frame) => this.p2p.send("frame", { frame }),
              sendAck: (fileId, seq) => this.p2p.send("ack", { fileId, seq }),
              sendRequest: (fileId, missing) => this.p2p.send("request", { fileId, missing })
            };
            if (this.p2pTimer) {
              clearTimeout(this.p2pTimer);
            }
            this.emit("transport", { kind: "p2p" });
          };
          peer.onicecandidate = (event) => {
            if (event?.candidate) {
              this.client.sendSignal(this.roomToken, this.peerId, { candidate: event.candidate });
            }
          };
          peer.onconnectionstatechange = () => {
            if (peer.connectionState === "connected") {
              this.p2p.ready?.(true);
            }
            if (peer.connectionState === "failed") {
              this.p2p.ready?.(false);
            }
          };
          if (this.role === "host") {
            const channel = peer.createDataChannel("lanlift-file");
            this.p2p.attach(channel);
            peer.createOffer().then((offer) => {
              peer.setLocalDescription(offer);
              this.client.sendSignal(this.roomToken, this.peerId, { description: offer });
            }).catch(() => this.p2p.ready?.(false));
          }
          this.p2pTimer = setTimeout(() => this.p2p.ready?.(false), this.p2pTimeoutMs);
          if (this.p2pTimer.unref) {
            this.p2pTimer.unref();
          }
          for (const pending of this.pendingSignals.splice(0)) {
            this.onSignal(pending);
          }
        }
        onSignal(payload) {
          if (payload.roomToken !== this.roomToken) {
            return;
          }
          if (!this.p2p) {
            this.pendingSignals.push(payload);
            return;
          }
          const peer = this.p2p.peer;
          const data = payload.data || {};
          try {
            if (data.description) {
              peer.setRemoteDescription(data.description).then(() => {
                if (data.description.type === "offer") {
                  return peer.createAnswer().then((answer) => {
                    peer.setLocalDescription(answer);
                    this.client.sendSignal(this.roomToken, this.peerId, { description: answer });
                  });
                }
                return void 0;
              }).catch(() => this.p2p.ready?.(false));
            } else if (data.candidate) {
              peer.addIceCandidate(data.candidate).catch(() => {
              });
            }
          } catch {
            this.p2p.ready?.(false);
          }
        }
        startTimers() {
          this.ackTimer = setInterval(() => this.checkPending(), ACK_INTERVAL_MS);
          this.requestTimer = setInterval(() => this.checkMissing(), REQUEST_INTERVAL_MS);
          if (this.ackTimer.unref) {
            this.ackTimer.unref();
          }
          if (this.requestTimer.unref) {
            this.requestTimer.unref();
          }
        }
        /** 傳送一個檔案（Uint8Array 或 Buffer）；加密與分塊在背景進行。 */
        sendFile(data, meta = {}) {
          if (!this.sessionKey) {
            throw new Error("\u5B89\u5168\u901A\u9053\u5C1A\u672A\u5EFA\u7ACB\u3002");
          }
          const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
          const name = String(meta.name || "\u6A94\u6848").slice(0, 180);
          const fileId = meta.fileId || randomToken(12);
          this.encryptAndSend(fileId, name, buffer);
          return { fileId, name, size: buffer.length };
        }
        async encryptAndSend(fileId, name, buffer) {
          const { total, chunks } = await chunkBuffer(buffer, { chunkSize: this.chunkSize, fileId });
          const meta = JSON.stringify({ name, size: buffer.length, total, fileId });
          const metaCipher = await encryptBytes(this.sessionKey, textEncoder.encode(meta));
          this.transport.sendFrame({
            fileId,
            seq: FILE_META_SEQ,
            total,
            checksum: "",
            iv: bytesToBase64(metaCipher.iv),
            data: bytesToBase64(metaCipher.data)
          });
          const sender = new ChunkSender({
            fileId,
            total,
            onDone: () => this.emit("file-sent", { fileId, name, size: buffer.length })
          });
          sender.blocks = new Map(chunks.map((chunk) => [chunk.seq, chunk]));
          this.senders.set(fileId, sender);
          for (const chunk of chunks) {
            sender.markSent(chunk.seq);
            this.encryptAndDispatch(chunk);
          }
          this.emit("sending", { fileId, name, size: buffer.length, total });
          return { fileId, name, size: buffer.length, total };
        }
        async encryptAndDispatch(chunk) {
          const cipher = await encryptBytes(this.sessionKey, chunk.data);
          this.transport.sendFrame({
            fileId: chunk.fileId,
            seq: chunk.seq,
            total: chunk.total,
            checksum: chunk.checksum,
            iv: bytesToBase64(cipher.iv),
            data: bytesToBase64(cipher.data)
          });
        }
        async onFrame(payload) {
          if (!this.sessionKey) {
            return;
          }
          try {
            const plain = await decryptBytes(
              this.sessionKey,
              base64ToBytes(payload.iv || ""),
              base64ToBytes(payload.data || "")
            );
            if (payload.seq === FILE_META_SEQ) {
              return this.onFileMeta(plain);
            }
            const entry = this.assemblers.get(payload.fileId);
            if (!entry) {
              return;
            }
            const checksum = await sha256(plain);
            const result = await entry.assembler.accept({
              fileId: payload.fileId,
              seq: payload.seq,
              total: payload.total,
              checksum,
              data: plain
            });
            if (result === "bad-checksum") {
              this.transport.sendRequest(payload.fileId, [payload.seq]);
              return;
            }
            if (result === "duplicate") {
              return;
            }
            this.emit("progress", {
              fileId: payload.fileId,
              received: entry.assembler.received,
              total: entry.assembler.total,
              bytes: entry.assembler.bytes
            });
            this.transport.sendAck(payload.fileId, payload.seq);
            if (entry.assembler.done) {
              this.finishFile(payload.fileId);
            }
          } catch {
            if (payload.seq !== FILE_META_SEQ) {
              this.transport.sendRequest(payload.fileId, [payload.seq]);
            }
          }
        }
        onFileMeta(plain) {
          const meta = JSON.parse(textDecoder.decode(plain));
          const entry = {
            meta,
            assembler: new ChunkAssembler({ total: meta.total, chunkSize: this.chunkSize })
          };
          this.assemblers.set(meta.fileId, entry);
          this.emit("file-offered", meta);
          const missing = entry.assembler.missingSeqs();
          if (missing.length) {
            this.transport.sendRequest(meta.fileId, missing);
          }
        }
        finishFile(fileId) {
          const entry = this.assemblers.get(fileId);
          if (!entry) {
            return;
          }
          const data = entry.assembler.assemble();
          this.assemblers.delete(fileId);
          this.emit("file-received", { fileId, name: entry.meta.name, size: entry.meta.size, data });
        }
        onAck(payload) {
          const sender = this.senders.get(payload.fileId);
          if (sender) {
            sender.acknowledge(payload.seq);
          }
        }
        onRequest(payload) {
          const sender = this.senders.get(payload.fileId);
          if (!sender) {
            return;
          }
          for (const seq of payload.missing || []) {
            this.resendBlock(payload.fileId, seq);
          }
        }
        async resendBlock(fileId, seq) {
          const sender = this.senders.get(fileId);
          if (!sender || sender.acked.has(seq)) {
            return;
          }
          const block = sender.blocks?.get(seq);
          if (block) {
            this.encryptAndDispatch({
              fileId,
              seq,
              total: sender.total,
              checksum: block.checksum,
              data: block.data
            });
          }
        }
        checkPending() {
          for (const sender of this.senders.values()) {
            if (sender.isCompleted()) {
              continue;
            }
            for (const seq of sender.pending()) {
              if (sender.exhausted(seq)) {
                this.emit("error", new Error(`\u5340\u584A ${seq} \u91CD\u50B3\u6B21\u6578\u5DF2\u9054\u4E0A\u9650\u3002`));
                continue;
              }
              if (!sender.shouldRetry(seq)) {
                continue;
              }
              const block = sender.blocks?.get(seq);
              if (block) {
                sender.retry(seq);
                this.encryptAndDispatch(block);
              }
            }
          }
        }
        checkMissing() {
          for (const [fileId, entry] of this.assemblers) {
            const missing = entry.assembler.missingSeqs();
            if (missing.length) {
              this.transport.sendRequest(fileId, missing);
            }
          }
        }
        close() {
          this.closed = true;
          if (this.ackTimer) {
            clearInterval(this.ackTimer);
          }
          if (this.requestTimer) {
            clearInterval(this.requestTimer);
          }
          if (this.p2pTimer) {
            clearTimeout(this.p2pTimer);
          }
          if (this.p2p?.peer?.close) {
            this.p2p.peer.close();
          }
          if (this.roomToken) {
            this.client.bye(this.roomToken);
          }
          this.senders.clear();
          this.assemblers.clear();
          this.emit("closed");
        }
      };
      module.exports = { RemoteTransfer, P2PTransport, FILE_META_SEQ, P2P_TIMEOUT_MS };
    }
  });

  // src/remote-web.js
  var require_remote_web = __commonJS({
    "src/remote-web.js"(exports, module) {
      "use strict";
      var { RelayClient } = require_relay_client();
      var { RemoteTransfer } = require_remote_transfer();
      function formatBytes(value) {
        if (!Number.isFinite(value)) {
          return "\u2014";
        }
        if (value < 1024) {
          return `${value} B`;
        }
        if (value < 1024 ** 2) {
          return `${(value / 1024).toFixed(1)} KB`;
        }
        if (value < 1024 ** 3) {
          return `${(value / 1024 ** 2).toFixed(1)} MB`;
        }
        return `${(value / 1024 ** 3).toFixed(2)} GB`;
      }
      function createRemoteApp2(options = {}) {
        const doc = options.document;
        if (!doc) {
          throw new Error("\u7F3A\u5C11 document\u3002");
        }
        const win = options.window || doc.defaultView;
        const relayUrl2 = options.relayUrl;
        if (!relayUrl2) {
          throw new Error("\u7F3A\u5C11\u8A0A\u865F\u4F3A\u670D\u5668\u7DB2\u5740\u3002");
        }
        const storage = win?.localStorage || null;
        const deviceName = String(options.deviceName || storage?.getItem?.("lanlift-device-name") || "\u884C\u52D5\u88DD\u7F6E").slice(0, 48);
        let transfer = null;
        const files = [];
        let transportKind = null;
        const $ = (id) => doc.getElementById(id);
        function setScreen(name) {
          for (const key of ["join", "waiting", "connected"]) {
            const element = $(`screen-${key}`);
            if (element) {
              element.classList.toggle("hidden", key !== name);
            }
          }
        }
        function showError(text) {
          for (const id of ["error-message", "connected-error"]) {
            const element = $(id);
            if (!element) {
              continue;
            }
            element.textContent = text;
            element.classList.toggle("hidden", !text);
          }
        }
        function renderMembers(members) {
          const self = members.find((member) => member.id === transfer.client.deviceId);
          const peer = members.find((member) => member.id === transfer.peerId);
          const status = $("peer-status");
          if (status) {
            status.textContent = peer ? `\u5DF2\u9023\u63A5\uFF1A${peer.name}\uFF08${transfer.transport ? transfer.transport.kind.toUpperCase() : "\u5354\u5546\u4E2D"}\uFF09` : self?.state === "rejected" ? "\u4E3B\u6A5F\u62D2\u7D55\u4E86\u9023\u7DDA\u3002" : "\u7B49\u5F85\u4E3B\u6A5F\u6838\u51C6\u2026";
          }
        }
        function renderProgress(info) {
          const bar = $("progress-bar");
          if (!bar) {
            return;
          }
          const total = info.total || 1;
          bar.style.width = `${Math.min(100, Math.round(info.received / total * 100))}%`;
        }
        function addReceived(file) {
          const list = $("received-list");
          if (!list) {
            return;
          }
          const row = doc.createElement("div");
          row.className = "file-row";
          const meta = doc.createElement("div");
          const name = doc.createElement("div");
          name.className = "file-name";
          name.textContent = file.name;
          const size = doc.createElement("span");
          size.className = "file-size";
          size.textContent = formatBytes(file.size);
          meta.append(name, size);
          const save = doc.createElement("a");
          save.className = "download";
          save.textContent = "\u5132\u5B58";
          const blob = new win.Blob([file.data], { type: "application/octet-stream" });
          save.href = win.URL.createObjectURL(blob);
          save.download = file.name;
          row.append(meta, save);
          list.append(row);
        }
        function wireTransfer() {
          transfer.on("room-state", (payload) => renderMembers(payload.members || []));
          transfer.on("transport", ({ kind }) => {
            transportKind = kind;
            const status = $("peer-status");
            if (status) {
              status.textContent = `\u50B3\u8F38\u901A\u9053\uFF1A${kind === "p2p" ? "\u9EDE\u5C0D\u9EDE\u76F4\u9023\uFF08WebRTC\uFF09" : "\u5B89\u5168\u4E2D\u7E7C"}\u3002`;
            }
          });
          transfer.on("sending", () => {
            const bar = $("upload-bar");
            if (bar) {
              bar.style.width = "0%";
            }
            showError("");
          });
          transfer.on("file-sent", () => {
            const bar = $("upload-bar");
            if (bar) {
              bar.style.width = "100%";
            }
          });
          transfer.on("progress", (info) => renderProgress(info));
          transfer.on("file-received", (file) => addReceived(file));
          transfer.on("error", (error) => showError(error.message || String(error)));
          transfer.on("server-error", (payload) => showError(payload?.error || "\u4F3A\u670D\u5668\u767C\u751F\u932F\u8AA4\u3002"));
        }
        function buildRtcFactory() {
          if (options.rtcFactory) {
            return options.rtcFactory;
          }
          if (typeof win !== "undefined" && typeof win.RTCPeerConnection === "function") {
            return {
              createPeerConnection: (config) => new win.RTCPeerConnection(config)
            };
          }
          return null;
        }
        async function join() {
          showError("");
          const code = ($("room-code").value || "").trim().toUpperCase();
          if (!/^[0-9A-F]{6}$/.test(code)) {
            showError("\u8ACB\u8F38\u5165 6 \u4F4D\u6578\u623F\u9593\u4EE3\u78BC\u3002");
            return;
          }
          const nameInput = $("device-name");
          if (nameInput?.value?.trim()) {
            storage?.setItem?.("lanlift-device-name", nameInput.value.trim());
          }
          const client = new RelayClient({
            url: relayUrl2,
            deviceName: nameInput?.value?.trim() || deviceName,
            platform: /android/i.test(win.navigator?.userAgent || "") ? "android" : /iphone|ipad|ipod/i.test(win.navigator?.userAgent || "") ? "ios" : "web",
            serverToken: options.serverToken,
            storage,
            WebSocketImpl: options.WebSocketImpl || win.WebSocket
          });
          client.connect();
          transfer = new RemoteTransfer({
            client,
            rtcFactory: buildRtcFactory(),
            rtcConfig: options.rtcConfig
          });
          wireTransfer();
          setScreen("waiting");
          try {
            const joined = await transfer.join(code);
            renderMembers([{ id: transfer.client.deviceId, state: "pending" }, ...joined.host ? [{ id: joined.host.id, name: joined.host.name, state: "host" }] : []]);
          } catch (error) {
            showError(error.message || "\u52A0\u5165\u623F\u9593\u5931\u6557\u3002");
            setScreen("join");
          }
        }
        function readFileBytes(file) {
          if (typeof file.arrayBuffer === "function") {
            return file.arrayBuffer();
          }
          return new Promise((resolve, reject) => {
            const reader = new win.FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error("\u7121\u6CD5\u8B80\u53D6\u6A94\u6848\u3002"));
            reader.readAsArrayBuffer(file);
          });
        }
        function sendFiles(fileList) {
          if (!transfer?.sessionKey) {
            showError("\u5B89\u5168\u901A\u9053\u5C1A\u672A\u5EFA\u7ACB\uFF0C\u8ACB\u7A0D\u5019\u518D\u8A66\u3002");
            return;
          }
          for (const file of Array.from(fileList || [])) {
            readFileBytes(file).then((buffer) => {
              transfer.sendFile(new Uint8Array(buffer), { name: file.name });
            });
          }
        }
        function init() {
          const form = $("join-form");
          if (form) {
            form.addEventListener("submit", (event) => {
              event.preventDefault();
              join();
            });
          }
          const picker = $("file-picker");
          if (picker) {
            picker.addEventListener("change", (event) => {
              sendFiles(event.target.files);
              picker.value = "";
            });
          }
          const leave = $("leave-btn");
          if (leave) {
            leave.addEventListener("click", () => {
              transfer?.close();
              transfer = null;
              setScreen("join");
            });
          }
          const preset = new win.URLSearchParams(win.location.search).get("room");
          if (preset && $("room-code")) {
            $("room-code").value = preset;
          }
        }
        return {
          init,
          join,
          sendFiles,
          get transfer() {
            return transfer;
          },
          get files() {
            return files;
          },
          get transportKind() {
            return transportKind;
          }
        };
      }
      module.exports = { createRemoteApp: createRemoteApp2, formatBytes };
    }
  });

  // src/remote-web-entry.js
  var { createRemoteApp } = require_remote_web();
  var params = new URLSearchParams(window.location.search);
  var relayUrl = params.get("server") || `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
  createRemoteApp({
    document: window.document,
    window,
    relayUrl
  }).init();
})();
