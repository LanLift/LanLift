'use strict';

// 端對端加密：ECDH（P-256）金鑰協商 + HKDF 金鑰衍生 + AES-256-GCM。
// 只使用 WebCrypto 與純 JavaScript 編碼，因此同一份程式碼可在
// Node.js、Electron 與瀏覽器執行。中繼伺服器只看到密文，無法解讀檔案內容。

const subtle = globalThis.crypto?.subtle;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function assertCrypto() {
  if (!subtle) {throw new Error('此環境不支援 WebCrypto，無法建立安全連線。');}
}

/** Uint8Array → 標準 base64。 */
function bytesToBase64(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const step = 0x8000;
  for (let offset = 0; offset < source.length; offset += step) {
    binary += String.fromCharCode(...source.subarray(offset, offset + step));
  }
  return btoa(binary);
}

/** 標準 base64 → Uint8Array。 */
function base64ToBytes(value) {
  const binary = atob(String(value || '').replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {bytes[index] = binary.charCodeAt(index);}
  return bytes;
}

/** Uint8Array → base64url（不含填充）。 */
function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 產生一組 ECDH P-256 金鑰對，並以 base64 匯出以便透過訊號交換。 */
async function generateKeyPair() {
  assertCrypto();
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await subtle.exportKey('spki', pair.publicKey);
  const privateKey = await subtle.exportKey('pkcs8', pair.privateKey);
  return {
    publicKey: bytesToBase64(new Uint8Array(publicKey)),
    privateKey: bytesToBase64(new Uint8Array(privateKey)),
  };
}

/** 將 base64 公鑰還原為 CryptoKey。 */
async function importPublicKey(encoded) {
  assertCrypto();
  return subtle.importKey('spki', base64ToBytes(encoded), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

/** 將 base64 私鑰還原為 CryptoKey。 */
async function importPrivateKey(encoded) {
  assertCrypto();
  return subtle.importKey('pkcs8', base64ToBytes(encoded), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

/**
 * 以我方私鑰與對端公鑰協商出 256-bit AES-GCM 工作階段金鑰。
 * salt 由主機隨機產生並透過訊號交換，避免重放相同金鑰。
 */
async function deriveSessionKey(privateKeyEncoded, peerPublicKeyEncoded, salt) {
  assertCrypto();
  const privateKey = await importPrivateKey(privateKeyEncoded);
  const peerPublicKey = await importPublicKey(peerPublicKeyEncoded);
  const sharedBits = await subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, privateKey, 256);
  const saltBytes = typeof salt === 'string' ? base64ToBytes(salt) : (salt instanceof Uint8Array ? salt : new Uint8Array(0));
  const material = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: textEncoder.encode('lanlift/e2e/v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** AES-GCM 加密 UTF-8 字串，回傳 { iv, data } base64。 */
async function encryptText(key, plaintext) {
  assertCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(String(plaintext)));
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) };
}

/** AES-GCM 解密，回傳 UTF-8 字串。 */
async function decryptText(key, iv, data) {
  assertCrypto();
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(data));
  return textDecoder.decode(plain);
}

/** AES-GCM 加密二進位區塊，回傳 { iv: Uint8Array, data: Uint8Array }。 */
async function encryptBytes(key, bytes) {
  assertCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv, data: new Uint8Array(cipher) };
}

/** AES-GCM 解密二進位區塊。 */
async function decryptBytes(key, iv, data) {
  assertCrypto();
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new Uint8Array(plain);
}

/** 高熵隨機密鑰（base64url），用於配對與房間權杖。 */
function randomToken(bytes = 32) {
  assertCrypto();
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToBase64Url(buffer);
}

/** 六位數房間代碼（不含易混淆字元），用於人類輸入。 */
function roomCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const buffer = new Uint8Array(6);
  crypto.getRandomValues(buffer);
  let code = '';
  for (let index = 0; index < 6; index += 1) {code += alphabet[buffer[index] % alphabet.length];}
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
  base64ToBytes,
};
