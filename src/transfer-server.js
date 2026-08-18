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
const { adminHtml } = require('./admin-page');

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;
const SESSION_MS = 10 * 60 * 1000;
const SESSION_MODES = ['host', 'peer'];

function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function safeFileName(value) {
  const name = path.basename(String(value || 'unnamed-file'))
    // eslint-disable-next-line no-control-regex -- 過濾檔名中的控制字元（v0.2.2 既有行為）
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
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(serialized);
}

function text(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
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
    this.adminToken = options.adminToken || null;
    this.qrDataUrlProvider = options.qrDataUrlProvider || null; // async (url) => dataUrl
    this.listenPort = options.port ?? 0;      // 0 = 自動分配
    this.listenHost = options.host || '0.0.0.0';
    this.server = null;
    this.port = null;
    this.address = null;
    this.session = null;
    this.expiryTimer = null;
  }

  async start() {
    if (this.server) {return this.getServerInfo();}
    await Promise.all([
      fsp.mkdir(this.receiveDir, { recursive: true }),
      fsp.mkdir(this.archiveDir, { recursive: true }),
    ]);
    this.server = http.createServer((req, res) => {
      this.route(req, res).catch((error) => {
        console.error('LanLift request failed:', error);
        if (!res.headersSent) {json(res, 500, { error: '伺服器處理失敗。' });}
        else {res.destroy();}
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.listenPort, this.listenHost, () => {
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
    if (!this.server) {return;}
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    this.port = null;
  }

  setReceiveDir(directory) {
    this.receiveDir = directory;
    this.emitUpdate();
  }

  createSession(options = {}) {
    if (!this.server) {throw new Error('傳輸服務尚未啟動。');}
    const mode = SESSION_MODES.includes(options.mode) ? options.mode : 'host';
    this.endSession('建立新的傳輸工作階段');
    const token = randomId(32);
    const expiresAt = Date.now() + SESSION_MS;
    this.session = {
      token,
      expiresAt,
      mode, // 'host'：主機與單一行動裝置；'peer'：多台行動裝置互傳
      clients: new Map(),
      files: [],
      received: [],
      createdAt: Date.now(),
    };
    this.expiryTimer = setTimeout(() => this.endSession('工作階段已逾時'), SESSION_MS + 50);
    this.emitUpdate();
    return this.getSessionSummary();
  }

  endSession(reason = '已由使用者結束') {
    if (this.expiryTimer) {clearTimeout(this.expiryTimer);}
    this.expiryTimer = null;
    if (!this.session) {return;}
    const endedSession = this.session;
    this.session = null;
    this.cleanupGeneratedFiles(endedSession).catch((error) => console.warn('LanLift archive cleanup failed:', error));
    this.emit('ended', { reason });
    this.emitUpdate();
  }

  getSessionSummary() {
    const s = this.session;
    if (!s) {return { active: false, receiveDir: this.receiveDir, server: this.getServerInfo() };}
    return {
      active: true,
      token: s.token,
      mode: s.mode,
      expiresAt: s.expiresAt,
      remainingMs: Math.max(0, s.expiresAt - Date.now()),
      url: `http://${this.address}:${this.port}/s/${s.token}`,
      files: s.files.map(({ id, name, size, generated, sourceName, from, to }) => ({
        id,
        name,
        size,
        generated: Boolean(generated),
        sourceName,
        from: from || null,
        to: to || null,
      })),
      received: s.received,
      clients: [...s.clients.values()].map((client) => ({
        id: client.id,
        name: client.name,
        state: client.state,
        ip: client.ip,
        pairedAt: client.pairedAt,
      })),
      receiveDir: this.receiveDir,
      server: this.getServerInfo(),
    };
  }

  addFileToSession(filePath, options = {}) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {return null;}
    const item = {
      id: randomId(10),
      name: safeFileName(options.name || path.basename(filePath)),
      size: stat.size,
      filePath,
      generated: Boolean(options.generated),
      sourceName: options.sourceName || null,
      from: options.from || null, // 分享來源裝置 id（null = 主機分享）
      to: options.to || null,      // 目標裝置 id（null = 主機）
    };
    this.session.files.push(item);
    return {
      id: item.id,
      name: item.name,
      size: item.size,
      generated: item.generated,
      sourceName: item.sourceName,
      from: item.from,
      to: item.to,
    };
  }

  addFiles(filePaths) {
    if (!this.session) {throw new Error('請先建立傳輸。');}
    const added = [];
    for (const filePath of filePaths || []) {
      const item = this.addFileToSession(filePath);
      if (item) {added.push(item);}
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
        if (settled) {return;}
        settled = true;
        output.destroy();
        fs.rm(destination, { force: true }, () => reject(error));
      };
      output.once('close', () => { if (!settled) { settled = true; resolve(); } });
      output.once('error', fail);
      archive.once('error', fail);
      archive.on('warning', (error) => { if (error.code !== 'ENOENT') {fail(error);} });
      archive.pipe(output);
      archive.directory(directory, sourceName);
      archive.finalize().catch(fail);
    });
    return { path: destination, sourceName };
  }

  async addPaths(paths) {
    if (!this.session) {throw new Error('請先建立傳輸。');}
    const added = [];
    for (const filePath of paths || []) {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        const item = this.addFileToSession(filePath);
        if (item) {added.push(item);}
      } else if (stat.isDirectory()) {
        const archive = await this.archiveDirectory(filePath);
        const item = this.addFileToSession(archive.path, { generated: true, sourceName: archive.sourceName, name: `${archive.sourceName}.zip` });
        if (item) {added.push(item);}
      }
    }
    this.emitUpdate();
    return added;
  }

  async cleanupGeneratedFiles(session) {
    const generated = (session?.files || [])
      .filter((file) => file.generated)
      .map((file) => file.filePath);
    await Promise.all(generated.map((filePath) => fsp.rm(filePath, { force: true })));
  }

  removeFile(id) {
    if (!this.session) {return;}
    const item = this.session.files.find((file) => file.id === id);
    this.session.files = this.session.files.filter((file) => file.id !== id);
    if (item?.generated) {fsp.rm(item.filePath, { force: true }).catch((error) => console.warn('LanLift archive removal failed:', error));}
    this.emitUpdate();
  }

  approveClient(id, approved) {
    if (!this.session) {throw new Error('傳輸工作階段已結束。');}
    const client = this.session.clients.get(id);
    if (!client) {throw new Error('找不到此裝置。');}
    if (approved) {
      // host 模式維持 v0.2.2 語意：同一時間只核准一台裝置。
      // peer 模式（行動互傳）允許多台已核准裝置互相傳檔。
      if (this.session.mode === 'host') {
        for (const other of this.session.clients.values()) {
          if (other.id !== id && other.state === 'approved') {other.state = 'rejected';}
        }
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
    if (!this.session || this.session.token !== token || Date.now() >= this.session.expiresAt) {
      return null;
    }
    return this.session;
  }

  getClient(session, clientId, requireApproval = true) {
    const client = session.clients.get(clientId);
    if (!client) {return null;}
    return requireApproval && client.state !== 'approved' ? null : client;
  }

  isLocalRequest(req) {
    const remote = req.socket.remoteAddress || '';
    return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  }

  async route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/health') {return json(res, 200, { ok: true });}
    // Linux 主機管理介面（僅限本機迴路，選用管理權杖）
    if (url.pathname === '/admin' && req.method === 'GET') {
      if (!this.isLocalRequest(req)) {return text(res, 403, '管理介面僅限本機存取。');}
      const html = adminHtml({ adminToken: this.adminToken });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      return res.end(html);
    }
    if (parts[0] === 'api' && parts[1] === 'admin') {return this.routeAdmin(req, res, parts);}
    if (parts[0] === 's' && parts.length === 2 && req.method === 'GET') {return this.servePortal(res, parts[1]);}
    if (parts[0] !== 'api' || parts[1] !== 's' || parts.length < 4) {return text(res, 404, 'Not found');}

    const token = parts[2];
    const session = this.activeSession(token);
    if (!session) {return json(res, 410, { error: '此傳輸已結束或已過期。' });}
    const action = parts[3];

    if (action === 'pair' && req.method === 'POST') {return this.pair(req, res, session);}
    if (action === 'info' && req.method === 'GET') {return this.info(res, session, url.searchParams.get('client'));}
    if (action === 'upload' && req.method === 'POST') {return this.upload(req, res, session, url.searchParams.get('client'), url.searchParams.get('to'));}
    if (action === 'download' && parts.length === 5 && req.method === 'GET') {return this.download(req, res, session, url.searchParams.get('client'), parts[4]);}
    return text(res, 404, 'Not found');
  }

  async routeAdmin(req, res, parts) {
    if (!this.isLocalRequest(req)) {return json(res, 403, { error: '管理介面僅限本機存取。' });}
    if (this.adminToken && req.headers['x-lanlift-admin'] !== this.adminToken) {return json(res, 401, { error: '管理權杖錯誤。' });}
    const action = parts[2];
    try {
      if (action === 'state' && req.method === 'GET') {return this.adminState(res);}
      if (action === 'session' && parts[3] === 'end' && req.method === 'POST') {
        this.endSession('管理介面結束傳輸');
        return json(res, 200, await this.adminSummary(this.getSessionSummary()));
      }
      if (action === 'session' && req.method === 'POST') {
        const body = await this.readJson(req);
        const summary = this.createSession({ mode: body.mode === 'peer' ? 'peer' : 'host' });
        return json(res, 200, await this.adminSummary(summary));
      }
      if (action === 'approve' && req.method === 'POST') {
        const body = await this.readJson(req);
        const summary = this.approveClient(body.clientId, Boolean(body.approved));
        return json(res, 200, await this.adminSummary(summary));
      }
      if (action === 'remove-file' && req.method === 'POST') {
        const body = await this.readJson(req);
        this.removeFile(body.id);
        return json(res, 200, await this.adminSummary(this.getSessionSummary()));
      }
      if (action === 'files' && req.method === 'POST') {
        const body = await this.readJson(req);
        await this.addPaths(body.paths || []);
        return json(res, 200, await this.adminSummary(this.getSessionSummary()));
      }
      if (action === 'receive-dir' && req.method === 'POST') {
        const body = await this.readJson(req);
        const directory = String(body.directory || '').trim();
        if (!directory) {throw new Error('請輸入接收資料夾路徑。');}
        this.setReceiveDir(directory);
        return json(res, 200, await this.adminSummary(this.getSessionSummary()));
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      return json(res, 400, { error: error.message || '請求失敗。' });
    }
  }

  async adminState(res) {
    return json(res, 200, await this.adminSummary(this.getSessionSummary()));
  }

  async adminSummary(summary) {
    const result = { ...summary };
    if (summary.active && this.qrDataUrlProvider) {
      try {
        result.qrDataUrl = await this.qrDataUrlProvider(summary.url);
      } catch (error) {
        console.warn('LanLift QR generation failed:', error);
      }
    }
    return result;
  }

  servePortal(res, token) {
    const session = this.activeSession(token);
    if (!session) {return text(res, 410, '這個傳輸連結已失效。請在 Windows 上建立新的傳輸。');}
    const html = portalHtml(token);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(html);
  }

  async readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16 * 1024) {throw new Error('請求資料過大。');}
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
    if (!client) {return json(res, 401, { error: '請先建立連線。' });}
    if (client.state !== 'approved') {return json(res, 200, { state: client.state, expiresAt: session.expiresAt });}
    const files = session.files
      // 主機分享（from=null）所有已核准裝置皆可下載；裝置互傳僅目標與主機可下載
      .filter((file) => !file.from || file.to === clientId)
      .map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size,
        from: file.from || null,
        to: file.to || null,
      }));
    const peers = [...session.clients.values()]
      .filter((candidate) => candidate.id !== clientId && candidate.state === 'approved')
      .map(({ id, name }) => ({ id, name }));
    json(res, 200, {
      state: 'approved',
      mode: session.mode,
      expiresAt: session.expiresAt,
      files,
      received: session.received.map(({ name, size, receivedAt }) => ({ name, size, receivedAt })),
      peers, // 其他已核准裝置（行動互傳目標清單）
    });
  }

  async upload(req, res, session, clientId, toId = null) {
    const client = this.getClient(session, clientId);
    if (!client) {return json(res, 403, { error: '尚未獲得主機端核准。' });}
    // 行動互傳：to 指定其他已核准裝置；未指定時傳送給主機（v0.2.2 相容行為）
    let target = null;
    if (toId) {
      if (session.mode !== 'peer') {return json(res, 400, { error: '此傳輸不支援裝置互傳。' });}
      target = this.getClient(session, toId);
      if (!target) {return json(res, 404, { error: '找不到目標裝置，或目標尚未核准。' });}
    }
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('multipart/form-data')) {return json(res, 415, { error: '請使用檔案上傳格式。' });}
    await fsp.mkdir(this.receiveDir, { recursive: true });
    const saved = [];
    const writes = [];
    let rejected = false;
    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 30 },
    });
    busboy.on('file', (_field, file, info) => {
      const destination = uniquePath(this.receiveDir, info.filename);
      let written = 0;
      file.on('data', (chunk) => { written += chunk.length; });
      file.on('limit', () => { rejected = true; });
      const write = pipeline(file, fs.createWriteStream(destination))
        .then(() => {
          if (target) {
            // 裝置互傳：加入分享佇列供目標裝置下載，主機亦可下載
            const item = this.addFileToSession(destination, {
              name: info.filename,
              from: clientId,
              to: target.id,
            });
            saved.push({
              name: item.name,
              size: written,
              receivedAt: Date.now(),
              from: client.name,
              to: target.name,
            });
          } else {
            saved.push({
              name: path.basename(destination),
              size: written,
              receivedAt: Date.now(),
              from: client.name,
            });
          }
        })
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
    if (rejected || !saved.length) {return json(res, 400, { error: '檔案上傳未完成，或超過 20 GB 限制。' });}
    if (!target) {session.received.push(...saved);}
    this.emitUpdate();
    json(res, 201, { ok: true, files: saved });
  }

  download(_req, res, session, clientId, id) {
    const client = this.getClient(session, clientId);
    if (!client) {return json(res, 403, { error: '尚未獲得主機端核准。' });}
    const item = session.files.find((file) => file.id === id);
    if (!item || !fs.existsSync(item.filePath)) {return json(res, 404, { error: '找不到分享檔案。' });}
    // 裝置互傳的檔案只開放給目標裝置下載（主機分享則開放給所有已核准裝置）
    if (item.from && item.to && item.to !== clientId) {return json(res, 403, { error: '此檔案不提供給你的裝置。' });}
    const encoded = encodeURIComponent(item.name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': item.size,
      'Content-Disposition': `attachment; filename="${safeFileName(item.name)}"; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(item.filePath).on('error', () => res.destroy()).pipe(res);
  }
}

module.exports = { TransferServer, getLanIPv4, safeFileName };
