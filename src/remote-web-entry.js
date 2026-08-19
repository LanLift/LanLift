'use strict';

// 瀏覽器入口：esbuild 打包後以 IIFE 形式在 relay/remote.html 中自動執行。
// 訊號伺服器網址可由 ?server=wss://…/ws 覆寫，否則依頁面通訊協定推導。

const { createRemoteApp } = require('./remote-web');

const params = new URLSearchParams(window.location.search);
const relayUrl = params.get('server')
  || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

createRemoteApp({
  document: window.document,
  window,
  relayUrl,
}).init();
