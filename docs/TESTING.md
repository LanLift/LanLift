# 測試計畫與執行方式

LanLift 使用 Node.js 內建測試執行器（`node:test`）與覆蓋率工具
（`--experimental-test-coverage`）。全部 118 個測試案例，行覆蓋率 ≥ 95%。

## 1. 執行方式

```bash
pnpm install
pnpm test             # 全部測試
pnpm test:coverage    # 測試 + 覆蓋率報告（行/分支/函數）
pnpm lint             # ESLint（0 錯誤 0 警告）
pnpm check            # lint + 覆蓋率一次完成
```

## 2. 測試檔案

| 檔案 | 涵蓋範圍 |
|---|---|
| `test/server.test.js` | LAN 傳輸服務：v0.2.2 相容流程（配對/上傳/下載/到期）、行動互傳（peer）、管理 API、權限 |
| `test/server-profiles.test.js` | 自訂伺服器設定：加密保存、編輯、刪除、模式切換、輸入驗證 |
| `test/crypto.test.js` | ECDH 金鑰協商、AES-GCM 往返、錯誤金鑰拒絕、base64 編碼 |
| `test/chunker.test.js` | 分塊、SHA-256、亂序組裝、重複/壞塊、ACK 重試狀態機 |
| `test/protocol.test.js` | 訊息信封驗證、房間註冊表（加入/核准/過期/清掃） |
| `test/bandwidth.test.js` | 令牌桶：限速、突發、延遲、非法值 |
| `test/relay-hub.test.js` | 中繼資料面：核准檢查、大小/流量上限、限速、統計 |
| `test/signaling.test.js` | 訊號伺服器（真 WebSocket）：註冊、建房、核准、signal/peer-key 轉發、心跳、斷線 |
| `test/relay-client.test.js` | 中繼客戶端：重連、排隊補送、裝置 ID 持久化、bye |
| `test/relay-server.test.js` | 中繼伺服器入口：health/stats/靜態頁面、TLS、設定檔、子程序訊號處理 |
| `test/remote-transfer.test.js` | 遠端傳輸端到端：中繼通道、雙向、P2P 模擬、回退、丟塊重試、壞塊、加密 |
| `test/remote-host.test.js` | 桌面/Linux 主機遠端整合：建房、核准、雙向傳檔、錯誤處理 |
| `test/remote-web.test.js` | 行動遠端頁面（jsdom）：join 驗證、安全通道、加密送出、接收渲染 |
| `test/linux-host.test.js` | Linux 主機 CLI：參數、QR、管理頁、自動傳輸、子程序訊號 |
| `test/portal.test.js` | LAN 行動頁面 HTML（含互傳 UI） |
| `test/event-emitter.test.js` | 跨端 EventEmitter |

## 3. 驗收測試案例

### 3.1 Linux 服務端啟動與連線

- [x] `startLinuxHost` 啟動服務、`/health` 回 `ok`、管理頁可載入、自動建立傳輸
- [x] 指定連接埠、peer 模式、`--qr` 文字 QR、SIGTERM 優雅關閉（子程序）
- [x] 管理 API：建立/結束傳輸、核准、加入檔案路徑、變更接收資料夾、權杖驗證

### 3.2 行動端互傳（iPhone → Android、Android → Android）

- [x] peer 模式下兩台裝置同時維持 approved
- [x] `upload?to=<B>` 後，B 的 `info` 可見 `{ from: A, to: B }` 檔案並可下載
- [x] 非目標裝置（含上傳者自己）下載互傳檔案 → 403
- [x] 反向傳輸（Android → iPhone）
- [x] host 模式使用 `to` 參數 → 400（v0.2.2 語意不變）

### 3.3 公網傳輸（中繼與穿透流程）

- [x] 中繼通道端到端傳檔（多區塊、內容逐位元組一致）
- [x] WebRTC P2P 優先：模擬握手成功後傳輸通道切換為 `p2p`
- [x] WebRTC 失敗回退：永不連通的 RTC → 傳輸仍經中繼完成
- [x] 丟失區塊經 `relay-request`／重傳恢復
- [x] 壞校驗與解密失敗區塊觸發重傳要求
- [x] 中繼伺服器限速：超限區塊拒絕並回 `retryable`
- [x] 伺服器權杖認證：錯誤權杖拒絕註冊

### 3.4 安全性

- [x] 錯誤金鑰無法解密（AES-GCM 認證失敗）
- [x] 中繼只看到密文（測試斷言線上資料不含明文）
- [x] 未核准成員的區塊被丟棄、signal/peer-key 被拒
- [x] 房間過期、斷線移除、bye 移除

## 4. 覆蓋率要求

- 整體行覆蓋率 ≥ 95%（目前 98%+）；所有被測試載入的模組皆納入統計。
- 僅 Electron 殼層（`main.js`／`preload.js`／`renderer.js`／HTML）因依賴桌面
  執行環境而未由測試載入；其邏輯盡量下放至可測模組（`remote-host.js`、
  `transfer-server.js`、`remote-web.js`）。
- CI（`.github/workflows/ci.yml`）會執行 `pnpm check` 並把覆蓋率門檻設為 95%。

## 5. 手動測試清單（真機）

發行前建議在真實裝置上執行：

1. Windows 10/11 安裝程式：建立傳輸 → iPhone Safari 掃描 → 核准 → 雙向傳檔。
2. Ubuntu/Kali：安裝腳本 → 管理頁建立 peer 傳輸 → iPhone 與 Android 互傳。
3. VPS 中繼：`wss://` 設定 + 桌面端建立遠端傳輸 → 手機輸入房間代碼 → 傳檔；
   斷開手機 Wi-Fi 切換行動網路驗證中繼兜底。
4. 大檔（≥ 1 GiB）：確認分塊、進度與重試；限速設定生效（`/stats` 檢視）。
