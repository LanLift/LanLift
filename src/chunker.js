'use strict';

// 檔案分塊傳輸層：將串流切成固定大小區塊、計算 SHA-256 校驗、接收端重組，
// 並以序號 ACK 驅動逾時重傳。中繼通道只需按序號透明轉發區塊。
// 使用 WebCrypto 與 Uint8Array，Node.js 與瀏覽器皆可執行。

const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64 KiB
const MAX_RETRIES = 8;

/** SHA-256（hex）— WebCrypto 非同步實作。 */
async function sha256(data) {
  const source = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', source));
  let hex = '';
  for (const byte of digest) {hex += byte.toString(16).padStart(2, '0');}
  return hex;
}

/** 隨機識別碼（跨端）。 */
function randomId(bytes = 16) {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 將 Uint8Array 切成固定大小區塊，附上 SHA-256 校驗與元資料（非同步）。 */
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
      data,
    });
  }
  return { fileId, total, chunks };
}

/** 組裝器：按序號收集區塊、驗證校驗，支援要求重傳遺失區塊。 */
class ChunkAssembler {
  constructor(options = {}) {
    this.fileId = null;
    this.total = options.total || 0;
    this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
    this.chunks = new Map();
    this.received = 0;
    this.bytes = 0;
    this.done = false;
  }

  /** 接收一個區塊；校驗失敗回傳 'bad-checksum'，重複區塊回傳 'duplicate'。 */
  async accept(frame) {
    if (this.done) {return 'duplicate';}
    if (this.fileId && frame.fileId !== this.fileId) {throw new Error('區塊的檔案識別碼不一致。');}
    if (!this.fileId) {
      this.fileId = frame.fileId;
      this.total = frame.total || this.total;
    }
    if (!Number.isInteger(frame.seq) || frame.seq < 0 || frame.seq >= this.total) {throw new Error('區塊序號超出範圍。');}
    const data = frame.data instanceof Uint8Array ? frame.data : new Uint8Array(frame.data || []);
    if (await sha256(data) !== frame.checksum) {return 'bad-checksum';}
    if (this.chunks.has(frame.seq)) {return 'duplicate';}
    this.chunks.set(frame.seq, data);
    this.received += 1;
    this.bytes += data.length;
    if (this.received >= this.total) {this.done = true;}
    return 'ok';
  }

  /** 回傳尚未收到的序號（供重傳要求）。 */
  missingSeqs() {
    const missing = [];
    for (let seq = 0; seq < this.total; seq += 1) {if (!this.chunks.has(seq)) {missing.push(seq);}}
    return missing;
  }

  /** 組合成完整 Uint8Array；未收齊時擲出錯誤。 */
  assemble() {
    if (!this.done) {throw new Error(`檔案尚未接收完成（${this.received}/${this.total}）。`);}
    let size = 0;
    const ordered = [...this.chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, data]) => data);
    for (const chunk of ordered) {size += chunk.length;}
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of ordered) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}

/** 重試排程：指數退避（1s 起，上限 30s），超過次數回傳 null。 */
function retryDelay(attempt) {
  return Math.min(1000 * (2 ** Math.min(attempt, 5)), 30000);
}

/** 傳送器狀態機：送出區塊並等待 ACK，依指數退避逾時重傳。 */
class ChunkSender {
  constructor({ fileId, total, onDone, now } = {}) {
    this.fileId = fileId;
    this.total = total;
    this.onDone = onDone || (() => {});
    this.now = now || (() => Date.now());
    this.acked = new Set();
    this.attempts = new Map(); // seq → 重試次數（初次送出不算重試）
    this.lastSent = new Map(); // seq → 最近送出時間
    this.completed = false;
  }

  isCompleted() {
    return this.completed;
  }

  /** 接收 ACK；全部確認後觸發完成。 */
  acknowledge(seq) {
    if (this.completed) {return;}
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
    for (let seq = 0; seq < this.total; seq += 1) {if (!this.acked.has(seq)) {list.push(seq);}}
    return list;
  }

  /** 該區塊現在是否應該重試（已達退避時間且未超過次數上限）。 */
  shouldRetry(seq) {
    if (this.exhausted(seq)) {return false;}
    const attempts = this.attempts.get(seq) || 0;
    const last = this.lastSent.get(seq) || 0;
    return this.now() - last >= retryDelay(attempts + 1);
  }

  /** 該序號是否已超過最大重試次數。 */
  exhausted(seq) {
    return (this.attempts.get(seq) || 0) >= MAX_RETRIES;
  }
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  MAX_RETRIES,
  chunkBuffer,
  ChunkAssembler,
  ChunkSender,
  retryDelay,
  sha256,
  randomId,
};
