'use strict';

// LanLift Linux 主機（headless）：
//   - 啟動區域網路傳輸服務（與 Windows 桌面版同一 TransferServer，協定完全相容）
//   - 提供本機管理頁面 http://127.0.0.1:<port>/admin
//   - 可選：啟動時自動建立傳輸並以文字 QR Code 列印
//
// 用法：
//   node src/linux-host.js [選項]
//   選項：
//     --port <port>          監聽連接埠（預設 0 = 自動分配）
//     --host <address>       綁定位址（預設 0.0.0.0）
//     --receive-dir <path>   接收資料夾（預設 ~/Downloads/LanLift）
//     --admin-token <token>  管理頁面權杖（選用；僅限本機存取）
//     --session [host|peer]  啟動時自動建立傳輸（peer = 行動互傳模式）
//     --qr                   以文字 QR Code 列印傳輸網址
//     --help                 顯示說明

const os = require('os');
const path = require('path');
const { TransferServer } = require('./transfer-server');

function parseArgs(argv) {
  const args = {
    port: 0,
    host: '0.0.0.0',
    receiveDir: path.join(os.homedir(), 'Downloads', 'LanLift'),
    adminToken: null,
    session: null,
    qr: false,
    help: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    const next = argv[index + 1];
    if (item === '--port' && next) { args.port = Number(next); index += 1; continue; }
    if (item === '--host' && next) { args.host = next; index += 1; continue; }
    if (item === '--receive-dir' && next) { args.receiveDir = next; index += 1; continue; }
    if (item === '--admin-token' && next) { args.adminToken = next; index += 1; continue; }
    if (item === '--session') {
      args.session = next && !next.startsWith('--') ? (next === 'peer' ? 'peer' : 'host') : 'host';
      if (next && !next.startsWith('--')) {index += 1;}
      continue;
    }
    if (item === '--qr') { args.qr = true; continue; }
    if (item === '--help' || item === '-h') { args.help = true; continue; }
  }
  return args;
}

function helpText() {
  return [
    'LanLift Linux 主機',
    '',
    '用法：node src/linux-host.js [選項]',
    '',
    '  --port <port>          監聽連接埠（預設 0 = 自動分配）',
    '  --host <address>       綁定位址（預設 0.0.0.0）',
    '  --receive-dir <path>   接收資料夾（預設 ~/Downloads/LanLift）',
    '  --admin-token <token>  管理頁面權杖（選用；管理頁僅限本機存取）',
    '  --session [host|peer]  啟動時自動建立傳輸（peer = 行動互傳模式）',
    '  --qr                   以文字 QR Code 列印傳輸網址',
    '  --help                 顯示此說明',
    '',
    '安裝為系統服務：sudo bash scripts/install-linux.sh',
  ].join('\n');
}

/** 以 qrcode 套件產生終端機可顯示的文字 QR Code。 */
async function renderTextQr(url) {
  const qrcode = require('qrcode');
  return qrcode.toString(url, { type: 'utf8', errorCorrectionLevel: 'M' });
}

/** 建立並啟動 Linux 主機；回傳 { server, summary }。 */
async function startLinuxHost(args = {}) {
  const qrcodePackage = require('qrcode');
  const server = new TransferServer({
    receiveDir: args.receiveDir,
    adminToken: args.adminToken || null,
    port: Number(args.port) || 0,
    host: args.host || '0.0.0.0',
    qrDataUrlProvider: (url) => qrcodePackage.toDataURL(url, { width: 300, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#ffffff' } }),
  });
  await server.start();
  const summary = args.session ? server.createSession({ mode: args.session === 'peer' ? 'peer' : 'host' }) : null;
  return { server, summary };
}

async function main(argv, options = {}) {
  const installSignals = options.installSignals !== false;
  const args = parseArgs(argv);
  if (args.help) {
    console.log(helpText());
    return { help: true };
  }
  const { server, summary } = await startLinuxHost(args);
  console.log('LanLift Linux 主機已啟動。');
  console.log(`管理頁面：http://127.0.0.1:${server.port}/admin`);
  console.log(`接收資料夾：${server.receiveDir}`);
  if (summary) {
    console.log(`傳輸網址：${summary.url}`);
    console.log(`模式：${summary.mode === 'peer' ? '行動互傳（多裝置）' : '主機 ↔ 單一行動裝置'}`);
    if (args.qr) {console.log(await renderTextQr(summary.url));}
  }
  if (installSignals) {
    const shutdown = async () => {
      console.log('\nLanLift 正在關閉…');
      await server.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
  return { server, summary };
}

if (require.main === module) {
  main(process.argv).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, helpText, renderTextQr, startLinuxHost, main };
