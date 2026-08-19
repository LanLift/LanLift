'use strict';

// LanLift 公網中繼伺服器入口：
//   - HTTP(S) 伺服器（可選 TLS，讀取 PEM 憑證）
//   - /ws   WebSocket 訊號與中繼（SignalingServer）
//   - /health 健康檢查
//   - /stats  轉發統計（可選管理權杖保護）
//   - /     遠端傳輸網頁（供行動裝置輸入房間代碼）
//
// 用法：
//   node relay/server.js --config relay/config.example.json
//   環境變數：LANLIFT_PORT、LANLIFT_TLS_CERT、LANLIFT_TLS_KEY、LANLIFT_SERVER_TOKEN

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { RoomRegistry } = require('../src/protocol');
const { RelayHub } = require('./relay-hub');
const { SignalingServer } = require('./signaling');

const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.example.json');
const REMOTE_HTML_PATH = path.join(__dirname, 'remote.html');
const REMOTE_WEB_PATH = path.join(__dirname, 'remote-web.js');

function loadConfig(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const config = JSON.parse(raw);
  if (!config || typeof config !== 'object') {throw new Error('設定檔格式錯誤。');}
  return config;
}

function parseArgs(argv) {
  const args = { config: DEFAULT_CONFIG_PATH, port: null, host: null };
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--config' && argv[index + 1]) { args.config = argv[++index]; continue; }
    if (item === '--port' && argv[index + 1]) { args.port = Number(argv[++index]); continue; }
    if (item === '--host' && argv[index + 1]) { args.host = argv[++index]; continue; }
    if (item === '--help' || item === '-h') { args.help = true; continue; }
  }
  return args;
}

function helpText() {
  return [
    'LanLift 公網中繼伺服器',
    '',
    '用法：node relay/server.js [選項]',
    '',
    '  --config <path>   設定檔路徑（預設 relay/config.example.json）',
    '  --port <port>     覆寫設定檔的連接埠',
    '  --host <address>  覆寫綁定位址',
    '  --help            顯示此說明',
    '',
    '環境變數：LANLIFT_PORT、LANLIFT_TLS_CERT、LANLIFT_TLS_KEY、LANLIFT_SERVER_TOKEN',
  ].join('\n');
}

function sendJson(res, code, body) {
  const serialized = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(serialized),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(serialized);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('無法載入網頁資源。');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

/**
 * 建立中繼伺服器。回傳 { start, stop, registry, hub, signaling, server }。
 */
function createRelayServer(options = {}) {
  const config = options.config || {};
  const port = Number(options.port ?? config.port ?? 8443);
  const host = options.host ?? config.host ?? '0.0.0.0';
  const serverToken = options.serverToken
    ?? process.env.LANLIFT_SERVER_TOKEN
    ?? config.serverToken
    ?? null;
  const tls = options.tls ?? (config.tls && config.tls.cert && config.tls.key ? config.tls : null);
  const adminToken = options.adminToken ?? config.adminToken ?? null;
  const remoteHtmlPath = options.remoteHtmlPath || REMOTE_HTML_PATH;
  const remoteWebPath = options.remoteWebPath || REMOTE_WEB_PATH;

  const registry = new RoomRegistry();
  const hub = new RelayHub({
    bytesPerSecond: config.limits?.bytesPerSecond,
    burstFactor: config.limits?.burstFactor,
    maxChunkBytes: config.limits?.maxChunkBytes,
    maxSessionBytes: config.limits?.maxSessionBytes,
  });
  const signaling = new SignalingServer({
    registry,
    hub,
    serverToken,
    heartbeatMs: config.heartbeatMs,
  });

  let server;
  if (tls) {
    server = https.createServer({
      cert: fs.readFileSync(tls.cert),
      key: fs.readFileSync(tls.key),
    });
  } else {
    server = http.createServer();
  }

  server.on('request', (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') {return sendJson(res, 200, { ok: true, rooms: registry.size(), uptimeMs: process.uptime() * 1000 });}
    if (url.pathname === '/stats') {
      if (adminToken && req.headers.authorization !== `Bearer ${adminToken}`) {return sendJson(res, 401, { error: '需要管理權杖。' });}
      const stats = {};
      for (const [token, room] of registry.rooms) {
        stats[room.roomCode] = {
          hub: hub.stats(token),
          members: registry.members(room).length,
        };
      }
      return sendJson(res, 200, stats);
    }
    if (url.pathname === '/remote-web.js') {return sendFile(res, remoteWebPath, 'application/javascript; charset=utf-8');}
    if (url.pathname === '/' || url.pathname === '/remote') {return sendFile(res, remoteHtmlPath, 'text/html; charset=utf-8');}
    return sendJson(res, 404, { error: 'Not found' });
  });

  signaling.start({ server, path: '/ws' });

  return {
    registry,
    hub,
    signaling,
    server,
    start: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve({ port: server.address().port, host, tls: Boolean(tls) });
      });
    }),
    stop: async () => {
      await signaling.stop();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function main(argv, options = {}) {
  const installSignals = options.installSignals !== false;
  const args = parseArgs(argv);
  if (args.help) {
    console.log(helpText());
    return { help: true };
  }
  let config = {};
  if (fs.existsSync(args.config)) {config = loadConfig(args.config);}
  const relay = createRelayServer({
    config,
    port: args.port ?? process.env.LANLIFT_PORT ?? undefined,
    host: args.host ?? undefined,
    tls: process.env.LANLIFT_TLS_CERT && process.env.LANLIFT_TLS_KEY
      ? { cert: process.env.LANLIFT_TLS_CERT, key: process.env.LANLIFT_TLS_KEY }
      : undefined,
  });
  const info = await relay.start();
  const scheme = info.tls ? 'wss' : 'ws';
  console.log(`LanLift 中繼伺服器已啟動：${scheme}://${info.host}:${info.port}/ws`);
  console.log(`遠端傳輸頁面：${info.tls ? 'https' : 'http'}://${info.host}:${info.port}/`);
  if (installSignals) {
    const shutdown = async () => {
      await relay.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
  return relay;
}

if (require.main === module) {
  main(process.argv).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { createRelayServer, loadConfig, parseArgs, helpText, main };
