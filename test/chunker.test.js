'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chunkBuffer, ChunkAssembler, ChunkSender, retryDelay, sha256, randomId, MAX_RETRIES,
} = require('../src/chunker');

test('chunkBuffer 將資料切成指定大小的區塊並附校驗', async () => {
  const payload = new Uint8Array(10 * 1024);
  for (let index = 0; index < payload.length; index += 1) {payload[index] = index % 251;}
  const { total, chunks } = await chunkBuffer(payload, { chunkSize: 4 * 1024 });
  assert.equal(total, 3);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].seq, 0);
  assert.equal(chunks[2].seq, 2);
  assert.match(chunks[0].fileId, /^[0-9a-f]{32}$/);
  assert.match(chunks[0].checksum, /^[0-9a-f]{64}$/);
  assert.equal(await sha256(chunks[0].data), chunks[0].checksum);
});

test('chunkBuffer 空資料產生一個空區塊', async () => {
  const { total, chunks } = await chunkBuffer(new Uint8Array(0));
  assert.equal(total, 1);
  assert.equal(chunks[0].data.length, 0);
});

test('ChunkAssembler 依序/亂序接收、偵測重複與錯誤校驗', async () => {
  const payload = new Uint8Array([10, 20, 30, 40, 50]);
  const { total, chunks } = await chunkBuffer(payload, { chunkSize: 2 });
  const assembler = new ChunkAssembler({ total });
  assert.equal(await assembler.accept(chunks[2]), 'ok');
  assert.equal(await assembler.accept(chunks[0]), 'ok');
  assert.equal(await assembler.accept(chunks[0]), 'duplicate');
  const corrupted = { ...chunks[1], checksum: '0'.repeat(64) };
  assert.equal(await assembler.accept(corrupted), 'bad-checksum');
  assert.deepEqual(assembler.missingSeqs(), [1]);
  assert.equal(await assembler.accept(chunks[1]), 'ok');
  assert.equal(assembler.done, true);
  assert.deepEqual(assembler.assemble(), payload);
});

test('ChunkAssembler 拒絕不一致的檔案識別碼與越界序號', async () => {
  const { total, chunks } = await chunkBuffer(new Uint8Array([1, 2, 3]), { chunkSize: 2 });
  const assembler = new ChunkAssembler({ total });
  await assembler.accept(chunks[0]);
  await assert.rejects(() => assembler.accept({ ...chunks[1], fileId: 'different' }));
  const other = new ChunkAssembler({ total });
  await assert.rejects(() => other.accept({ ...chunks[0], seq: 99 }));
});

test('ChunkAssembler 未收齊時 assemble 擲錯', async () => {
  const { total, chunks } = await chunkBuffer(new Uint8Array([1, 2, 3]), { chunkSize: 1 });
  const assembler = new ChunkAssembler({ total });
  await assembler.accept(chunks[0]);
  assert.throws(() => assembler.assemble(), /尚未接收完成/);
});

test('ChunkSender ACK 驅動完成與重試狀態機', () => {
  let done = false;
  let now = 1000;
  const sender = new ChunkSender({ fileId: 'f1', total: 3, onDone: () => { done = true; }, now: () => now });
  sender.markSent(0);
  sender.markSent(1);
  sender.markSent(2);
  assert.equal(sender.isCompleted(), false);
  assert.deepEqual(sender.pending(), [0, 1, 2]);
  assert.equal(sender.shouldRetry(0), false); // 剛送出，退避時間未到
  now = 3000; // retryDelay(1) = 2s
  assert.equal(sender.shouldRetry(0), true);
  sender.retry(0);
  assert.equal(sender.shouldRetry(0), false);
  sender.acknowledge(0);
  assert.deepEqual(sender.pending(), [1, 2]);
  sender.acknowledge(1);
  sender.acknowledge(2);
  assert.equal(sender.isCompleted(), true);
  assert.equal(done, true);
});

test('ChunkSender 超過最大重試次數後 exhausted', () => {
  let now = 0;
  const sender = new ChunkSender({ fileId: 'f1', total: 1, now: () => now });
  sender.markSent(0);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    now += retryDelay(attempt + 1);
    if (!sender.exhausted(0)) {sender.retry(0);}
  }
  assert.equal(sender.exhausted(0), true);
  assert.equal(sender.shouldRetry(0), false);
});

test('retryDelay 指數退避並封頂 30 秒', () => {
  assert.equal(retryDelay(0), 1000);
  assert.equal(retryDelay(1), 2000);
  assert.equal(retryDelay(4), 16000);
  assert.equal(retryDelay(5), 30000);
  assert.equal(retryDelay(20), 30000);
});

test('randomId 回傳十六進位字串', () => {
  assert.match(randomId(8), /^[0-9a-f]{16}$/);
});
