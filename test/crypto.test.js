'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateKeyPair, deriveSessionKey, encryptText, decryptText,
  encryptBytes, decryptBytes, randomToken, roomCode,
  bytesToBase64, bytesToBase64Url, base64ToBytes, importPublicKey, importPrivateKey,
} = require('../src/crypto');

test('generateKeyPair 匯出可重新匯入的 base64 金鑰', async () => {
  const pair = await generateKeyPair();
  assert.match(pair.publicKey, /^[A-Za-z0-9+/=]+$/);
  assert.match(pair.privateKey, /^[A-Za-z0-9+/=]+$/);
  const publicKey = await importPublicKey(pair.publicKey);
  const privateKey = await importPrivateKey(pair.privateKey);
  assert.ok(publicKey);
  assert.ok(privateKey);
});

test('雙方可協商出相同的工作階段金鑰（ECDH + HKDF）', async () => {
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();
  const salt = randomToken(16);
  const aliceKey = await deriveSessionKey(alice.privateKey, bob.publicKey, salt);
  const bobKey = await deriveSessionKey(bob.privateKey, alice.publicKey, salt);
  const message = await encryptText(aliceKey, 'LanLift 端對端加密測試');
  assert.equal(await decryptText(bobKey, message.iv, message.data), 'LanLift 端對端加密測試');
});

test('相同鹽值不同金鑰對產生不同金鑰；不同鹽值金鑰不同', async () => {
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();
  const carol = await generateKeyPair();
  const key1 = await deriveSessionKey(alice.privateKey, bob.publicKey, 'AAAA');
  const key2 = await deriveSessionKey(alice.privateKey, carol.publicKey, 'AAAA');
  const key3 = await deriveSessionKey(alice.privateKey, bob.publicKey, 'BBBB');
  assert.notDeepEqual(key1, key2);
  assert.notDeepEqual(key1, key3);
});

test('錯誤金鑰無法解密（AES-GCM 認證失敗）', async () => {
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();
  const mallory = await generateKeyPair();
  const key = await deriveSessionKey(alice.privateKey, bob.publicKey, 'salt');
  const wrongKey = await deriveSessionKey(mallory.privateKey, bob.publicKey, 'salt');
  const cipher = await encryptText(key, '秘密');
  await assert.rejects(() => decryptText(wrongKey, cipher.iv, cipher.data));
});

test('encryptBytes/decryptBytes 二進位往返', async () => {
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();
  const key = await deriveSessionKey(alice.privateKey, bob.publicKey, 'bin');
  const payload = new Uint8Array([0, 1, 2, 253, 254, 255, 128, 64, 32]);
  const cipher = await encryptBytes(key, payload);
  const plain = await decryptBytes(key, cipher.iv, cipher.data);
  assert.deepEqual(plain, payload);
});

test('base64 與 base64url 編碼往返', () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  assert.match(bytesToBase64Url(bytes), /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(base64ToBytes(bytesToBase64Url(bytes)), bytes);
  assert.deepEqual(base64ToBytes(''), new Uint8Array(0));
});

test('randomToken 與 roomCode 的長度與字元集', () => {
  const token = randomToken(32);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url 無填充
  const code = roomCode();
  assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  assert.notEqual(roomCode(), code);
});

test('deriveSessionKey 接受 Uint8Array 鹽', async () => {
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();
  const salt = new Uint8Array([1, 2, 3, 4]);
  const key = await deriveSessionKey(alice.privateKey, bob.publicKey, salt);
  assert.ok(key);
});
