'use strict';

// 遠端傳輸協調器：把訊號客戶端、端對端加密與分塊傳輸組合成一次遠端傳檔。
//
// 流程（主機端）：
//   host() → 建立房間（取得房間代碼）→ 訪客以代碼加入 → 主機核准 →
//   交換 ECDH 公鑰與鹽 → 嘗試 WebRTC 資料通道（P2P 優先）→
//   逾時或失敗時回退中繼通道 → 加密分塊傳輸（ACK + 重試 + 限速）。
//
// 流程（訪客端）：
//   join(roomCode) → 等待主機核准 → 其餘同上。
//
// 兩種通道使用同一組區塊格式；中繼伺服器永遠只看到密文。

const { MiniEventEmitter } = require('./event-emitter');
const { MESSAGE_TYPES } = require('./protocol');
const { generateKeyPair, deriveSessionKey, encryptBytes, decryptBytes, randomToken, bytesToBase64, base64ToBytes } = require('./crypto');
const { chunkBuffer, ChunkAssembler, ChunkSender, sha256, DEFAULT_CHUNK_SIZE } = require('./chunker');

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const P2P_TIMEOUT_MS = 8000;      // WebRTC 連線等待上限
const ACK_INTERVAL_MS = 1500;     // 檢查待確認區塊的週期
const REQUEST_INTERVAL_MS = 2000; // 檢查缺塊的週期
const FILE_META_SEQ = -1;         // 檔案中繼資料使用序號 -1

/** 將 RTCDataChannel 事件介面轉成與中繼一致的區塊通道。 */
class P2PTransport {
  constructor(peer, onFrame) {
    this.kind = 'p2p';
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
        if (message && message.type === 'frame') {this.onFrame(message.payload.frame);}
      } catch { /* 忽略無法解析的訊息 */ }
    };
    this.channel.onopen = () => this.ready?.(true);
  }

  send(type, payload) {
    if (!this.channel || this.channel.readyState !== 'open') {return false;}
    this.channel.send(JSON.stringify({ type, payload }));
    return true;
  }
}

class RemoteTransfer extends MiniEventEmitter {
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
    if (!this.client) {throw new Error('缺少訊號客戶端。');}
    this.rtcFactory = options.rtcFactory || null;
    this.rtcConfig = options.rtcConfig || { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
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
    this.senders = new Map();    // fileId → ChunkSender
    this.assemblers = new Map(); // fileId → { meta, assembler, timer }
    this.pendingSignals = [];    // P2P 建立前早到的訊號訊息
    this.ackTimer = null;
    this.requestTimer = null;
    this.closed = false;

    this.client.on('room-state', (payload) => this.onRoomState(payload));
    this.client.on('signal', (payload) => this.onSignal(payload));
    this.client.on('frame', (payload) => this.onFrame(payload));
    this.client.on('ack', (payload) => this.onAck(payload));
    this.client.on('request', (payload) => this.onRequest(payload));
    this.client.on('error', (payload) => this.emit('server-error', payload));
  }

  /** 主機：建立遠端房間。 */
  async host() {
    this.role = 'host';
    this.keyPair = await generateKeyPair();
    this.client.createRoom(this.keyPair.publicKey);
    const payload = await this.waitFor('room-created');
    this.roomToken = payload.roomToken;
    this.roomCode = payload.roomCode;
    return {
      roomCode: payload.roomCode,
      roomToken: payload.roomToken,
      expiresAt: payload.expiresAt,
    };
  }

  /** 訪客：以房間代碼加入。 */
  async join(roomCode) {
    this.role = 'guest';
    this.keyPair = await generateKeyPair();
    this.client.joinRoom(roomCode, this.keyPair.publicKey);
    const payload = await this.waitForRoomState();
    this.roomToken = payload.roomToken;
    this.roomCode = String(roomCode).toUpperCase();
    const host = payload.members.find((member) => member.role === 'host');
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
    if (!this.roomToken) {return;}
    this.client.send(MESSAGE_TYPES.JOIN_ROOM, {
      roomCode: this.roomCode,
      name: this.client.deviceName,
      platform: this.client.platform,
      publicKey: this.keyPair?.publicKey || null,
    });
  }

  waitFor(type) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('等待伺服器回應逾時。')), this.p2pTimeoutMs);
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
      const timeout = setTimeout(() => reject(new Error('加入房間逾時。')), this.p2pTimeoutMs);
      const listener = (payload) => {
        clearTimeout(timeout);
        this.client.off('room-state', listener);
        resolve(payload);
      };
      this.client.on('room-state', listener);
    });
  }

  onRoomState(payload) {
    if (payload.roomToken !== this.roomToken) {return;}
    const members = payload.members || [];
    const self = members.find((member) => member.id === this.client.deviceId);
    const others = members.filter((member) => member.id !== this.client.deviceId);
    if (this.role === 'host') {
      // 記下最新訪客資訊（含其公鑰）
      const guest = others.find((member) => member.role === 'guest');
      if (guest && (!this.peerId || guest.id === this.peerId)) {
        this.peerId = guest.id;
        this.peerName = guest.name;
      }
      // 雙方公鑰到齊且已核准 → 產生鹽並交換
      if (self?.publicKey && guest?.publicKey && guest.state === 'approved' && !this.salt) {
        this.salt = randomToken(16);
        this.client.sendPeerKey(this.roomToken, self.publicKey, this.salt);
      }
    }
    if (this.role === 'guest') {
      const host = others.find((member) => member.role === 'host');
      if (self?.state === 'approved' && host?.publicKey && host.keySalt && !this.sessionKey) {
        this.salt = host.keySalt;
        this.client.sendPeerKey(this.roomToken, self.publicKey, this.salt);
      }
    }
    this.emit('room-state', payload);
    this.tryDerive(members);
  }

  /** 雙方公鑰與鹽到齊後衍生工作階段金鑰並建立傳輸通道。 */
  async tryDerive(members) {
    if (this.sessionKey || !this.salt || !this.keyPair) {return;}
    const peer = members.find((member) => member.id === this.peerId);
    if (!peer?.publicKey) {return;}
    this.sessionKey = await deriveSessionKey(this.keyPair.privateKey, peer.publicKey, this.salt);
    this.emit('secured', { peerId: this.peerId, peerName: this.peerName });
    this.openTransport();
  }

  openTransport() {
    if (this.transport || this.closed) {return;}
    // P2P 優先：有 rtcFactory（瀏覽器環境）才嘗試 WebRTC
    if (this.rtcFactory) {
      this.startP2P();
    }
    // 同時準備中繼通道；P2P 逾時前未連通即啟用中繼
    this.transport = this.makeRelayTransport();
    this.emit('transport', { kind: 'relay' });
    this.startTimers();
  }

  makeRelayTransport() {
    return {
      kind: 'relay',
      sendFrame: (frame) => this.client.sendFrame(this.roomToken, frame),
      sendAck: (fileId, seq) => this.client.sendAck(this.roomToken, fileId, seq),
      sendRequest: (fileId, missing) => this.client.sendRequest(this.roomToken, fileId, missing),
    };
  }

  startP2P() {
    if (this.p2p) {return;}
    const factory = this.rtcFactory;
    const peer = factory.createPeerConnection(this.rtcConfig);
    this.p2p = new P2PTransport(peer, (frame) => this.onFrame({ ...frame, via: 'p2p' }));
    this.p2p.ready = (open) => {
      if (!open || this.transport?.kind === 'p2p') {return;}
      this.transport = {
        kind: 'p2p',
        sendFrame: (frame) => this.p2p.send('frame', { frame }),
        sendAck: (fileId, seq) => this.p2p.send('ack', { fileId, seq }),
        sendRequest: (fileId, missing) => this.p2p.send('request', { fileId, missing }),
      };
      if (this.p2pTimer) {clearTimeout(this.p2pTimer);}
      this.emit('transport', { kind: 'p2p' });
    };
    peer.onicecandidate = (event) => {
      if (event?.candidate) {
        this.client.sendSignal(this.roomToken, this.peerId, { candidate: event.candidate });
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {this.p2p.ready?.(true);}
      if (peer.connectionState === 'failed') {this.p2p.ready?.(false);}
    };
    if (this.role === 'host') {
      const channel = peer.createDataChannel('lanlift-file');
      this.p2p.attach(channel);
      peer.createOffer().then((offer) => {
        peer.setLocalDescription(offer);
        this.client.sendSignal(this.roomToken, this.peerId, { description: offer });
      }).catch(() => this.p2p.ready?.(false));
    }
    this.p2pTimer = setTimeout(() => this.p2p.ready?.(false), this.p2pTimeoutMs);
    if (this.p2pTimer.unref) {this.p2pTimer.unref();}
    // 回放 P2P 建立前早到的訊號訊息（如主機提前送出的 offer）
    for (const pending of this.pendingSignals.splice(0)) {this.onSignal(pending);}
  }

  onSignal(payload) {
    if (payload.roomToken !== this.roomToken) {return;}
    if (!this.p2p) {
      this.pendingSignals.push(payload);
      return;
    }
    const peer = this.p2p.peer;
    const data = payload.data || {};
    try {
      if (data.description) {
        peer.setRemoteDescription(data.description).then(() => {
          if (data.description.type === 'offer') {
            return peer.createAnswer().then((answer) => {
              peer.setLocalDescription(answer);
              this.client.sendSignal(this.roomToken, this.peerId, { description: answer });
            });
          }
          return undefined;
        }).catch(() => this.p2p.ready?.(false));
      } else if (data.candidate) {
        peer.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch { this.p2p.ready?.(false); }
  }

  startTimers() {
    this.ackTimer = setInterval(() => this.checkPending(), ACK_INTERVAL_MS);
    this.requestTimer = setInterval(() => this.checkMissing(), REQUEST_INTERVAL_MS);
    if (this.ackTimer.unref) {this.ackTimer.unref();}
    if (this.requestTimer.unref) {this.requestTimer.unref();}
  }

  /** 傳送一個檔案（Uint8Array 或 Buffer）；加密與分塊在背景進行。 */
  sendFile(data, meta = {}) {
    if (!this.sessionKey) {throw new Error('安全通道尚未建立。');}
    const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
    const name = String(meta.name || '檔案').slice(0, 180);
    const fileId = meta.fileId || randomToken(12);
    this.encryptAndSend(fileId, name, buffer);
    return { fileId, name, size: buffer.length };
  }

  async encryptAndSend(fileId, name, buffer) {
    const { total, chunks } = await chunkBuffer(buffer, { chunkSize: this.chunkSize, fileId });
    // 檔案中繼資料（序號 -1）：名稱、大小、區塊數
    const meta = JSON.stringify({ name, size: buffer.length, total, fileId });
    const metaCipher = await encryptBytes(this.sessionKey, textEncoder.encode(meta));
    this.transport.sendFrame({
      fileId,
      seq: FILE_META_SEQ,
      total,
      checksum: '',
      iv: bytesToBase64(metaCipher.iv),
      data: bytesToBase64(metaCipher.data),
    });
    const sender = new ChunkSender({
      fileId,
      total,
      onDone: () => this.emit('file-sent', { fileId, name, size: buffer.length }),
    });
    sender.blocks = new Map(chunks.map((chunk) => [chunk.seq, chunk]));
    this.senders.set(fileId, sender);
    // 初次送出全部區塊（非同步加密後送出）
    for (const chunk of chunks) {
      sender.markSent(chunk.seq);
      this.encryptAndDispatch(chunk);
    }
    this.emit('sending', { fileId, name, size: buffer.length, total });
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
      data: bytesToBase64(cipher.data),
    });
  }

  async onFrame(payload) {
    if (!this.sessionKey) {return;}
    try {
      const plain = await decryptBytes(
        this.sessionKey,
        base64ToBytes(payload.iv || ''),
        base64ToBytes(payload.data || ''),
      );
      if (payload.seq === FILE_META_SEQ) {return this.onFileMeta(plain);}
      const entry = this.assemblers.get(payload.fileId);
      if (!entry) {return;} // 尚未收到中繼資料
      const checksum = await sha256(plain);
      const result = await entry.assembler.accept({
        fileId: payload.fileId,
        seq: payload.seq,
        total: payload.total,
        checksum,
        data: plain,
      });
      if (result === 'bad-checksum') {
        this.transport.sendRequest(payload.fileId, [payload.seq]);
        return;
      }
      if (result === 'duplicate') {return;}
      this.emit('progress', {
        fileId: payload.fileId,
        received: entry.assembler.received,
        total: entry.assembler.total,
        bytes: entry.assembler.bytes,
      });
      this.transport.sendAck(payload.fileId, payload.seq);
      if (entry.assembler.done) {this.finishFile(payload.fileId);}
    } catch {
      // 解密或校驗失敗：要求重傳此區塊
      if (payload.seq !== FILE_META_SEQ) {
        this.transport.sendRequest(payload.fileId, [payload.seq]);
      }
    }
  }

  onFileMeta(plain) {
    const meta = JSON.parse(textDecoder.decode(plain));
    const entry = {
      meta,
      assembler: new ChunkAssembler({ total: meta.total, chunkSize: this.chunkSize }),
    };
    this.assemblers.set(meta.fileId, entry);
    this.emit('file-offered', meta);
    // 已有缺塊資訊時立即要求
    const missing = entry.assembler.missingSeqs();
    if (missing.length) {this.transport.sendRequest(meta.fileId, missing);}
  }

  finishFile(fileId) {
    const entry = this.assemblers.get(fileId);
    if (!entry) {return;}
    const data = entry.assembler.assemble();
    this.assemblers.delete(fileId);
    this.emit('file-received', { fileId, name: entry.meta.name, size: entry.meta.size, data });
  }

  onAck(payload) {
    const sender = this.senders.get(payload.fileId);
    if (sender) {sender.acknowledge(payload.seq);}
  }

  onRequest(payload) {
    // 對端缺塊：從 sender 重新加密送出對應區塊
    const sender = this.senders.get(payload.fileId);
    if (!sender) {return;}
    for (const seq of payload.missing || []) {
      this.resendBlock(payload.fileId, seq);
    }
  }

  async resendBlock(fileId, seq) {
    // 重送依賴原始區塊；由 chunkBuffer 快取於 sender.blocks
    const sender = this.senders.get(fileId);
    if (!sender || sender.acked.has(seq)) {return;}
    const block = sender.blocks?.get(seq);
    if (block) {
      this.encryptAndDispatch({
        fileId,
        seq,
        total: sender.total,
        checksum: block.checksum,
        data: block.data,
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
          this.emit('error', new Error(`區塊 ${seq} 重傳次數已達上限。`));
          continue;
        }
        if (!sender.shouldRetry(seq)) {continue;}
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
      if (missing.length) {this.transport.sendRequest(fileId, missing);}
    }
  }

  close() {
    this.closed = true;
    if (this.ackTimer) {clearInterval(this.ackTimer);}
    if (this.requestTimer) {clearInterval(this.requestTimer);}
    if (this.p2pTimer) {clearTimeout(this.p2pTimer);}
    if (this.p2p?.peer?.close) {this.p2p.peer.close();}
    if (this.roomToken) {this.client.bye(this.roomToken);}
    this.senders.clear();
    this.assemblers.clear();
    this.emit('closed');
  }
}

module.exports = { RemoteTransfer, P2PTransport, FILE_META_SEQ, P2P_TIMEOUT_MS };
