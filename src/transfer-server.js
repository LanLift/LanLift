'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const archiver = require('archiver');
const Busboy = require('busboy');
const { pipeline } = require('stream/promises');
const { portalHtml } = require('./portal');

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;
const SESSION_MS = 10 * 60 * 1000;

function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function safeFileName(value) {
  const name = path.basename(String(value || 'unnamed-file'))
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/^\.+$/, 'unnamed-file')
    .trim();
  return name.slice(0, 180) || 'unnamed-file';
}

function getLanIPv4() {
  const networks = os.networkInterfaces();
  for (const list of Object.values(networks)) {
    for (const candidate of list || []) {
      if (candidate.family === 'IPv4' && !candidate.internal && !candidate.address.startsWith('169.254.')) {
        return candidate.address;
      }
    }
  }
  return '127.0.0.1';
}

function json(res, code, body) {
  const serialized = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(serialized),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(serialized);
}

function text(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function uniquePath(directory, rawName) {
  const fileName = safeFileName(rawName);
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  const suffix = crypto.randomBytes(4).toString('hex');
  return path.join(directory, `${stem}-${suffix}${extension}`);
}

class TransferServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.receiveDir = options.receiveDir || path.join(os.homedir(), 'Downloads', 'LanLift');
    this.archiveDir = options.archiveDir || path.join(os.tmpdir(), 'LanLift', 'archives');
    this.server = null;
    this.port = null;
    this.address = null;
    this.session = null;
    this.expiryTimer = null;
  }

  async start() {
    if (this.server) return this.getServerInfo();
    await Promise.all([
      fsp.mkdir(this.receiveDir, { recursive: true }),
      fsp.mkdir(this.archiveDir, { recursive: true })
    ]);
    this.server = http.createServer((req, res) => {
      this.route(req, res).catch((error) => {
        console.error('LanLift request failed:', error);
        if (!res.headersSent) json(res, 500, { error: '伺服器處理失敗。' });
        else res.destroy();
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '0.0.0.0', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.port = this.server.address().port;
    this.address = getLanIPv4();
    return this.getServerInfo();
  }

  getServerInfo() {
    return { port: this.port, address: this.address, receiveDir: this.receiveDir };
  }

  async stop() {
    this.endSession('應用程式已關閉');
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    this.port = null;
  }

  setReceiveDir(directory) {
    this.receiveDir = directory;
    this.emitUpdate();
  }

  createSession() {
    if (!this.server) throw new Error('傳輸服務尚未啟動。');
    this.endSession('建立新的傳輸工作階段');
    const token = randomId(32);
    const expiresAt = Date.now() + SESSION_MS;
    this.session = {
      token,
      expiresAt,
      clients: new Map(),
      files: [],
      received: [],
      createdAt: Date.now()
    };
    this.expiryTimer = setTimeout(() => this.endSession('工作階段已逾時'), SESSION_MS + 50);
    this.emitUpdate();
    return this.getSessionSummary();
  }

  endSession(reason = '已由使用者結束') {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (!this.session) return;
    const endedSession = this.session;
    this.session = null;
    this.cleanupGeneratedFiles(endedSession).catch((error) => console.warn('LanLift archive cleanup failed:', error));
    this.emit('ended', { reason });
    this.emitUpdate();
  }

  getSessionSummary() {
    const s = this.session;
    if (!s) return { active: false, receiveDir: this.receiveDir, server: this.getServerInfo() };
    return {
      active: true,
      token: s.token,
      expiresAt: s.expiresAt,
      remainingMs: Math.max(0, s.expiresAt - Date.now()),
      url: `http://${this.address}:${this.port}/s/${s.token}`,
      files: s.files.map(({ id, name, size, generated, sourceName }) => ({ id, name, size, generated: Boolean(generated), sourceName })),
      received: s.received,
      clients: [...s.clients.values()].map(({ id, name, state, ip, pairedAt }) => ({ id, name, state, ip, pairedAt })),
      receiveDir: this.receiveDir,
      server: this.getServerInfo()
    };
  }

  addFileToSession(filePath, options = {}) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const item = {
      id: randomId(10),
      name: safeFileName(options.name || path.basename(filePath)),
      size: stat.size,
      filePath,
      generated: Boolean(options.generated),
      sourceName: options.sourceName || null
    };
    this.session.files.push(item);
    return { id: item.id, name: item.name, size: item.size, generated: item.generated, sourceName: item.sourceName };
  }

  addFiles(filePaths) {
    if (!this.session) throw new Error('請先建立傳輸。');
    const added = [];
    for (const filePath of filePaths || []) {
      const item = this.addFileToSession(filePath);
      if (item) added.push(item);
    }
    this.emitUpdate();
    return added;
  }

  async archiveDirectory(directory) {
    await fsp.mkdir(this.archiveDir, { recursive: true });
    const sourceName = safeFileName(path.basename(directory));
    const destination = path.join(this.archiveDir, `${sourceName}-${Date.now()}-${randomId(5)}.zip`);
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(destination, { flags: 'wx' });
      const archive = archiver('zip', { zlib: { level: 6 } });
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        output.destroy();
        fs.rm(destination, { force: true }, () => reject(error));
      };
      output.once('close', () => { if (!settled) { settled = true; resolve(); } });
      output.once('error', fail);
      archive.once('error', fail);
      archive.on('warning', (error) => { if (error.code !== 'ENOENT') fail(error); });
      archive.pipe(output);
      archive.directory(directory, sourceName);
      archive.finalize().catch(fail);
    });
    return { path: destination, sourceName };
  }

  async addPaths(paths) {
    if (!this.session) throw new Error('請先建立傳輸。');
    const added = [];
    for (const filePath of paths || []) {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        const item = this.addFileToSession(filePath);
        if (item) added.push(item);
      } else if (stat.isDirectory()) {
        const archive = await this.archiveDirectory(filePath);
        const item = this.addFileToSession(archive.path, { generated: true, sourceName: archive.sourceName, name: `${archive.sourceName}.zip` });
        if (item) added.push(item);
      }
    }
    this.emitUpdate();
    return added;
  }

  async cleanupGeneratedFiles(session) {
    const generated = (session?.files || []).filter((file) => file.generated).map((file) => file.filePath);
    await Promise.all(generated.map((filePath) => fsp.rm(filePath, { force: true })));
  }

  removeFile(id) {
    if (!this.session) return;
    const item = this.session.files.find((file) => file.id === id);
    this.session.files = this.session.files.filter((file) => file.id !== id);
    if (item?.generated) fsp.rm(item.filePath, { force: true }).catch((error) => console.warn('LanLift archive removal failed:', error));
    this.emitUpdate();
  }

  approveClient(id, approved) {
    if (!this.session) throw new Error('傳輸工作階段已結束。');
    const client = this.session.clients.get(id);
    if (!client) throw new Error('找不到此裝置。');
    if (approved) {
      for (const other of this.session.clients.values()) {
        if (other.id !== id && other.state === 'approved') other.state = 'rejected';
      }
      client.state = 'approved';
      client.pairedAt = Date.now();
    } else {
      client.state = 'rejected';
    }
    this.emitUpdate();
    return this.getSessionSummary();
  }

  emitUpdate() {
    this.emit('update', this.getSessionSummary());
  }

  activeSession(token) {
    if (!this.session || this.session.token !== token || Date.now() >= this.session.expiresAt) return null;
    return this.session;
  }

  getClient(session, clientId, requireApproval = true) {
    const client = session.clients.get(clientId);
    if (!client) return null;
    return requireApproval && client.state !== 'approved' ? null : client;
  }

  async route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (parts[0] === 's' && parts.length === 2 && req.method === 'GET') return this.servePortal(res, parts[1]);
    if (parts[0] !== 'api' || parts[1] !== 's' || parts.length < 4) return text(res, 404, 'Not found');

    const token = parts[2];
    const session = this.activeSession(token);
    if (!session) return json(res, 410, { error: '此傳輸已結束或已過期。' });
    const action = parts[3];

    if (action === 'pair' && req.method === 'POST') return this.pair(req, res, session);
    if (action === 'info' && req.method === 'GET') return this.info(res, session, url.searchParams.get('client'));
    if (action === 'upload' && req.method === 'POST') return this.upload(req, res, session, url.searchParams.get('client'));
    if (action === 'download' && parts.length === 5 && req.method === 'GET') return this.download(req, res, session, url.searchParams.get('client'), parts[4]);
    return text(res, 404, 'Not found');
  }

  servePortal(res, token) {
    const session = this.activeSession(token);
    if (!session) return text(res, 410, '這個傳輸連結已失效。請在 Windows 上建立新的傳輸。');
    const html = portalHtml(token);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    res.end(html);
  }

  async readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16 * 1024) throw new Error('請求資料過大。');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
  }

  async pair(req, res, session) {
    const body = await this.readJson(req);
    const id = typeof body.id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(body.id) ? body.id : randomId(12);
    const name = String(body.name || 'Apple 裝置').trim().slice(0, 48) || 'Apple 裝置';
    let client = session.clients.get(id);
    if (!client) {
      client = { id, name, state: 'pending', ip: req.socket.remoteAddress || '', requestedAt: Date.now(), pairedAt: null };
      session.clients.set(id, client);
      this.emitUpdate();
    }
    json(res, 200, { id, state: client.state, expiresAt: session.expiresAt });
  }

  info(res, session, clientId) {
    const client = session.clients.get(clientId);
    if (!client) return json(res, 401, { error: '請先建立連線。' });
    if (client.state !== 'approved') return json(res, 200, { state: client.state, expiresAt: session.expiresAt });
    json(res, 200, {
      state: 'approved',
      expiresAt: session.expiresAt,
      files: session.files.map(({ id, name, size }) => ({ id, name, size })),
      received: session.received.map(({ name, size, receivedAt }) => ({ name, size, receivedAt }))
    });
  }

  async upload(req, res, session, clientId) {
    const client = this.getClient(session, clientId);
    if (!client) return json(res, 403, { error: '尚未獲得 Windows 端核准。' });
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('multipart/form-data')) return json(res, 415, { error: '請使用檔案上傳格式。' });
    await fsp.mkdir(this.receiveDir, { recursive: true });
    const saved = [];
    const writes = [];
    let rejected = false;
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD_BYTES, files: 30 } });
    busboy.on('file', (_field, file, info) => {
      const destination = uniquePath(this.receiveDir, info.filename);
      let written = 0;
      file.on('data', (chunk) => { written += chunk.length; });
      file.on('limit', () => { rejected = true; });
      const write = pipeline(file, fs.createWriteStream(destination))
        .then(() => saved.push({ name: path.basename(destination), size: written, receivedAt: Date.now(), from: client.name }))
        .catch(() => { rejected = true; });
      writes.push(write);
    });
    const parsed = new Promise((resolve, reject) => {
      busboy.once('error', reject);
      busboy.once('finish', resolve);
    });
    req.pipe(busboy);
    await parsed;
    await Promise.all(writes);
    if (rejected || !saved.length) return json(res, 400, { error: '檔案上傳未完成，或超過 20 GB 限制。' });
    session.received.push(...saved);
    this.emitUpdate();
    json(res, 201, { ok: true, files: saved });
  }

  download(_req, res, session, clientId, id) {
    const client = this.getClient(session, clientId);
    if (!client) return json(res, 403, { error: '尚未獲得 Windows 端核准。' });
    const item = session.files.find((file) => file.id === id);
    if (!item || !fs.existsSync(item.filePath)) return json(res, 404, { error: '找不到分享檔案。' });
    const encoded = encodeURIComponent(item.name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': item.size,
      'Content-Disposition': `attachment; filename="${safeFileName(item.name)}"; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(item.filePath).on('error', () => res.destroy()).pipe(res);
  }
}

module.exports = { TransferServer, getLanIPv4, safeFileName };
