'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function now() { return new Date().toISOString(); }

function parseUrl(value, name, allowedProtocols) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error(`${name} 不是有效網址。`); }
  if (!allowedProtocols.includes(url.protocol)) {throw new Error(`${name} 必須使用 ${allowedProtocols.join(' 或 ')}。`);}
  return url.toString();
}

function parseTurnUrls(value) {
  return String(value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean).map((item) => {
    if (!/^turns?:/i.test(item)) {throw new Error('TURN 位址必須以 turn: 或 turns: 開頭。');}
    return item;
  });
}

class ServerProfileStore {
  constructor({ filePath, safeStorage }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.data = { version: 1, connectionMode: 'direct', activeProfileId: null, profiles: [] };
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.profiles)) {this.data = { ...this.data, ...parsed };}
    } catch (error) {
      if (error.code !== 'ENOENT') {throw new Error('無法讀取伺服器設定紀錄。');}
      await this.persist();
    }
  }

  canSecurelyStore() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  encrypt(value) {
    if (!value) {return null;}
    if (!this.canSecurelyStore()) {throw new Error('此 Windows 系統無法使用安全儲存，請先啟用系統資料保護後再儲存伺服器憑證。');}
    return this.safeStorage.encryptString(value).toString('base64');
  }

  decrypt(value) {
    if (!value) {return null;}
    if (!this.canSecurelyStore()) {throw new Error('無法讀取已加密的伺服器憑證。');}
    return this.safeStorage.decryptString(Buffer.from(value, 'base64'));
  }

  publicProfile(profile) {
    return {
      id: profile.id,
      name: profile.name,
      signalingUrl: profile.signalingUrl,
      turnUrls: profile.turnUrls,
      username: profile.username || '',
      hasCredential: Boolean(profile.encryptedCredential),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      lastUsedAt: profile.lastUsedAt || null,
    };
  }

  getState() {
    return {
      connectionMode: this.data.connectionMode,
      activeProfileId: this.data.activeProfileId,
      profiles: this.data.profiles.map((profile) => this.publicProfile(profile)),
      secureStorageAvailable: this.canSecurelyStore(),
    };
  }

  getConnectionCredentials(id) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) {throw new Error('找不到自訂伺服器設定。');}
    return {
      ...this.publicProfile(profile),
      credential: this.decrypt(profile.encryptedCredential),
    };
  }

  async saveProfile(input) {
    const name = String(input?.name || '').trim().slice(0, 80);
    if (!name) {throw new Error('請輸入伺服器名稱。');}
    const signalingUrl = parseUrl(input?.signalingUrl, '訊號伺服器網址', ['wss:']);
    const turnUrls = parseTurnUrls(input?.turnUrls);
    if (!turnUrls.length) {throw new Error('請至少輸入一個 TURN 位址。');}
    const username = String(input?.username || '').trim().slice(0, 160);
    const id = String(input?.id || '');
    const existing = this.data.profiles.find((item) => item.id === id);
    const credentialInput = typeof input?.credential === 'string' ? input.credential.trim() : '';
    const profile = {
      id: existing?.id || crypto.randomUUID(),
      name,
      signalingUrl,
      turnUrls,
      username,
      encryptedCredential: credentialInput
        ? this.encrypt(credentialInput)
        : (existing?.encryptedCredential || null),
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
      lastUsedAt: existing?.lastUsedAt || null,
    };
    if (existing) {Object.assign(existing, profile);} else {this.data.profiles.unshift(profile);}
    await this.persist();
    return this.publicProfile(profile);
  }

  async removeProfile(id) {
    const index = this.data.profiles.findIndex((item) => item.id === id);
    if (index < 0) {return this.getState();}
    this.data.profiles.splice(index, 1);
    if (this.data.activeProfileId === id) {
      this.data.activeProfileId = null;
      this.data.connectionMode = 'direct';
    }
    await this.persist();
    return this.getState();
  }

  async setConnectionMode(mode, profileId = null) {
    if (!['direct', 'custom'].includes(mode)) {throw new Error('不支援的連線模式。');}
    if (mode === 'custom') {
      const profile = this.data.profiles.find((item) => item.id === profileId);
      if (!profile) {throw new Error('請先選擇一個自訂伺服器。');}
      profile.lastUsedAt = now();
      this.data.activeProfileId = profile.id;
    } else {
      this.data.activeProfileId = null;
    }
    this.data.connectionMode = mode;
    await this.persist();
    return this.getState();
  }

  async persist() {
    const staging = `${this.filePath}.tmp`;
    await fs.writeFile(staging, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(staging, this.filePath);
  }
}

module.exports = { ServerProfileStore, parseTurnUrls };
