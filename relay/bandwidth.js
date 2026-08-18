'use strict';

// 令牌桶流量整形：中繼伺服器對每個傳輸通道套用每秒位元組上限，
// 避免單一連線耗盡公網頻寬。超過上限的區塊會延遲或丟棄並回報。

class TokenBucket {
  /**
   * @param {object} options
   * @param {number} options.bytesPerSecond 每秒補充位元組數（0 表示不限制）
   * @param {number} [options.burstFactor=2] 允許的瞬間突發倍數
   * @param {() => number} [options.now] 時脈來源（測試注入）
   */
  constructor(options = {}) {
    this.bytesPerSecond = Math.max(0, Number(options.bytesPerSecond) || 0);
    this.burstFactor = Math.max(1, Number(options.burstFactor) || 2);
    this.now = options.now || (() => Date.now());
    this.capacity = Math.max(1, this.bytesPerSecond * this.burstFactor);
    this.tokens = this.capacity;
    this.lastRefill = this.now();
    this.totalConsumed = 0;
    this.delayedBytes = 0;
  }

  /** 補充自上次呼叫以來的令牌。 */
  refill() {
    if (!this.bytesPerSecond) {return;}
    const now = this.now();
    const elapsed = Math.max(0, now - this.lastRefill);
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed / 1000) * this.bytesPerSecond);
    this.lastRefill = now;
  }

  /** 立即可用（不扣除）的位元組數。 */
  available() {
    this.refill();
    return Math.floor(this.tokens);
  }

  /** 嘗試消耗 n 位元組；成功回傳 true，否則回傳 false（不扣除）。 */
  tryTake(bytes) {
    this.refill();
    if (bytes <= 0) {return true;}
    if (!this.bytesPerSecond) {
      this.totalConsumed += bytes;
      return true;
    }
    if (this.tokens < bytes) {return false;}
    this.tokens -= bytes;
    this.totalConsumed += bytes;
    return true;
  }

  /** 下一個 n 位元組區塊需要等待的毫秒數。 */
  waitMs(bytes) {
    this.refill();
    if (!this.bytesPerSecond) {return 0;}
    if (this.tokens >= bytes) {return 0;}
    return Math.ceil(((bytes - this.tokens) / this.bytesPerSecond) * 1000);
  }

  /** 強制扣除（延遲送出的區塊），並記錄延遲量。 */
  forceTake(bytes) {
    this.refill();
    if (this.bytesPerSecond && this.tokens < bytes) {this.delayedBytes += bytes - this.tokens;}
    this.tokens = Math.max(0, this.tokens - bytes);
    this.totalConsumed += bytes;
  }
}

module.exports = { TokenBucket };
