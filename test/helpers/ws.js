'use strict';

// 測試輔助：真實 WebSocket 連線與訊息等待工具（Node 22 內建 WebSocket）。

const { envelope } = require('../../src/protocol');

/** 連線並等待 open，回傳 ws。 */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', (event) => reject(new Error(`WebSocket 連線失敗：${event.message || url}`)));
  });
}

/** 送出訊息。 */
function send(ws, type, payload) {
  ws.send(JSON.stringify(envelope(type, payload)));
}

/** 等待特定類型的訊息，回傳 payload；逾時擲錯。 */
function waitFor(ws, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`等待訊息 ${type} 逾時。`));
    }, timeoutMs);
    const handler = (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      if (message.type === type) {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve(message.payload);
      }
    };
    ws.addEventListener('message', handler);
  });
}

/** 收集直到條件滿足為止的所有 room-state。 */
function collectRoomStates(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const states = [];
    const timer = setTimeout(() => reject(new Error('等待 room-state 逾時。')), timeoutMs);
    const handler = (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      if (message.type !== 'room-state') {return;}
      states.push(message.payload);
      if (predicate(message.payload)) {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve(states);
      }
    };
    ws.addEventListener('message', handler);
  });
}

/** 等待任一 error 訊息。 */
function waitForError(ws, timeoutMs = 5000) {
  return waitFor(ws, 'error', timeoutMs);
}

module.exports = { connect, send, waitFor, waitForError, collectRoomStates };
