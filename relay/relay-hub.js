'use strict';

// 中繼資料面：在已核准的房間成員之間透明轉發加密區塊與 ACK。
// 伺服器不解密內容（端對端加密由端點負責），只執行：
//   - 成員核准檢查（未核准成員的資料一律丟棄）
//   - 每通道每秒位元組上限（令牌桶）
//   - 單一區塊與累計流量上限
//   - 轉發統計（供監控與測試）

const { EventEmitter } = require('events');
const { TokenBucket } = require('./bandwidth');

const DEFAULT_LIMITS = Object.freeze({
  bytesPerSecond: 2 * 1024 * 1024, // 每通道 2 MiB/s
  burstFactor: 3,
  maxChunkBytes: 256 * 1024,       // 單一區塊上限 256 KiB
  maxSessionBytes: 200 * 1024 * 1024 * 1024, // 每通道累計上限 200 GiB
});

class RelayHub extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.bytesPerSecond] 每通道速率上限
   * @param {number} [options.maxChunkBytes] 單一區塊大小上限
   * @param {number} [options.maxSessionBytes] 每通道累計上限
   * @param {() => number} [options.now]
   */
  constructor(options = {}) {
    super();
    this.bytesPerSecond = Number(options.bytesPerSecond ?? DEFAULT_LIMITS.bytesPerSecond);
    this.burstFactor = Number(options.burstFactor ?? DEFAULT_LIMITS.burstFactor);
    this.maxChunkBytes = Number(options.maxChunkBytes ?? DEFAULT_LIMITS.maxChunkBytes);
    this.maxSessionBytes = Number(options.maxSessionBytes ?? DEFAULT_LIMITS.maxSessionBytes);
    this.now = options.now || (() => Date.now());
    this.channels = new Map(); // roomToken → { bucket, stats }
  }

  channel(token) {
    let channel = this.channels.get(token);
    if (!channel) {
      channel = {
        bucket: new TokenBucket({
          bytesPerSecond: this.bytesPerSecond,
          burstFactor: this.burstFactor,
          now: this.now,
        }),
        stats: { frames: 0, bytes: 0, dropped: 0, delayed: 0 },
      };
      this.channels.set(token, channel);
    }
    return channel;
  }

  stats(token) {
    return this.channels.get(token)?.stats || null;
  }

  /**
   * 轉發一個區塊：回傳 { ok, reason?, stats }。
   * @param {object} args
   * @param {string} args.roomToken
   * @param {string} args.senderId
   * @param {object} args.room RoomRegistry 的房間物件（用於核准檢查）
   * @param {number} args.bytes 區塊位元組數
   * @param {() => void} args.forward 實際送出時的回呼
   */
  relayChunk({ roomToken, senderId, room, bytes, forward }) {
    const channel = this.channel(roomToken);
    const stats = channel.stats;
    const sender = room?.members?.get(senderId);
    if (!sender || sender.state !== 'approved') {
      stats.dropped += 1;
      return { ok: false, reason: '未核准的裝置無法傳送資料。', stats };
    }
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > this.maxChunkBytes) {
      stats.dropped += 1;
      return { ok: false, reason: `區塊大小超出限制（上限 ${this.maxChunkBytes} 位元組）。`, stats };
    }
    if (stats.bytes + bytes > this.maxSessionBytes) {
      stats.dropped += 1;
      return { ok: false, reason: '此傳輸已超過累計流量上限。', stats };
    }
    const accepted = channel.bucket.tryTake(bytes);
    if (!accepted) {
      stats.dropped += 1;
      stats.delayed += bytes;
      return { ok: false, reason: '傳輸速率超過上限，請稍後重試。', stats };
    }
    forward();
    stats.frames += 1;
    stats.bytes += bytes;
    this.emit('chunk', { roomToken, senderId, bytes, stats });
    return { ok: true, stats };
  }

  /** 關閉並釋放通道。 */
  remove(token) {
    const channel = this.channels.get(token);
    this.channels.delete(token);
    return Boolean(channel);
  }
}

module.exports = { RelayHub, DEFAULT_LIMITS };
