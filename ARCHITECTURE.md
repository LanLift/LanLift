# LanLift 架構（v0.3）

## 目標

LanLift 讓 Windows 桌面、Linux 主機（Ubuntu/Kali）與行動瀏覽器（iPhone/Android）
之間以一次性配對建立短暫傳輸空間：

- **同網**：主機（Windows/Linux）與行動裝置直接雙向傳檔。
- **行動互傳**：iPhone ↔ Android、Android ↔ Android（主機協調的儲存轉送）。
- **公網**：自架中繼伺服器（訊號 + 中繼 + WebRTC 協調），P2P 優先、中繼兜底。

## 使用流程

| 步驟 | 主機（Windows/Linux） | 行動裝置 |
|---|---|---|
| 1 | 建立傳輸（host／peer 模式），產生 256-bit 配對密鑰與 QR Code | 掃描 QR Code |
| 2 | 顯示連線請求；使用者核准 | 開啟傳輸頁面並輸入裝置名稱 |
| 3 | 拖放或選取檔案加入佇列；接收上傳 | 下載主機分享的檔案、上傳至主機或指定裝置 |
| 4 | 顯示檔案進度與接收紀錄 | 顯示上傳／下載進度與完成結果 |
| 5 | 手動結束或 10 分鐘到期後，清除授權與暫存 | 連線失效，無法重新存取 |

公網流程：主機建立遠端房間（6 位數代碼）→ 行動裝置於中繼伺服器頁面輸入代碼 →
主機核准 → ECDH 金鑰協商 → WebRTC 直連（失敗走中繼）→ 加密分塊傳輸。

## 元件與責任

| 元件 | 技術選擇 | 責任 |
|---|---|---|
| Windows 殼層 | Electron | 安裝型程式、原生選檔、防火牆提示、遠端傳輸 IPC |
| Linux 主機 | Node.js headless（`src/linux-host.js`） | 同一傳輸服務 + 本機網頁管理 + systemd |
| 區網傳輸服務 | Node.js `http`（`src/transfer-server.js`） | 一次性配對頁面、上傳／下載串流、行動互傳、管理 API |
| 行動 LAN 頁面 | 內嵌 HTML（`src/portal.js`） | 配對、下載、上傳（可指定目標裝置） |
| 中繼伺服器 | Node.js + `ws`（`relay/`） | WSS 訊號、房間註冊表、中繼資料面、遠端頁面託管 |
| 訊號協定 | `src/protocol.js` | 訊息信封、房間／核准狀態機 |
| 端對端加密 | WebCrypto（`src/crypto.js`） | ECDH P-256 + HKDF + AES-256-GCM（跨端一致） |
| 分塊傳輸 | `src/chunker.js` | 64 KiB 分塊、SHA-256、ACK、指數退避重傳 |
| 遠端協調 | `src/remote-transfer.js` | WebRTC 優先／中繼兜底、金鑰交換、傳輸狀態機 |
| 中繼客戶端 | `src/relay-client.js` | 註冊、房間、心跳、斷線重連與排隊補送（Node/瀏覽器通用） |
| 桌面遠端整合 | `src/remote-host.js` | 以自訂伺服器設定建立遠端房間與雙向傳檔 |
| QR Code | `qrcode` | LAN 傳輸網址與管理頁 QR |

## 配對與安全邊界

- LAN：傳輸網址含 256-bit 隨機密鑰；不列舉工作階段、無密鑰一律 410。
- 公網：房間代碼（人類輸入）+ 高熵 roomToken + 主機核准；中繼不解密任何資料。
- 端對端加密：每次傳輸全新 ECDH 金鑰對與鹽；AES-GCM 同時提供機密性與完整性。
- 上傳寫入隨機暫存檔，完成後以安全檔名移至接收資料夾；互傳檔案僅目標可下載。
- 中繼限速：每通道令牌桶（預設 2 MiB/s）、區塊 256 KiB、累計 200 GiB 上限。

## 高速傳輸設計

- LAN：HTTP 串流直寫磁碟，不載入記憶體；速度受 Wi-Fi／儲存裝置限制。
- 公網：64 KiB 流水線分塊 + ACK；每區塊獨立加密；壞塊以 SHA-256 偵測並重傳。
- WebRTC 資料通道直連繞過中繼頻寬；TURN 作為 NAT 對稱環境的兜底。

## 封裝與交付

- Windows：electron-builder（NSIS 安裝程式 + portable）。
- Linux：`scripts/install-linux.sh` + systemd（主機）；`scripts/install-relay.sh`
  + systemd（中繼）。
- 行動端：無安裝；Safari／Chrome 開啟主機頁面或中繼伺服器遠端頁面。

## 驗收標準

1. Windows 10/11 與 Ubuntu/Kali 皆可啟動傳輸服務並產生 QR Code。
2. 只有主機核准後，行動頁面才能上傳與下載。
3. 兩方向檔案的位元組數與 SHA-256 一致（LAN 與公網皆驗證）。
4. 行動互傳：iPhone → Android 與 Android → Android 經主機轉送成功。
5. 公網：WebRTC 直連成功時使用 P2P；失敗時經中繼完成，且中繼只看到密文。
6. 逾時或手動結束後，原網址／房間代碼立即失效。
7. `pnpm test:coverage` 覆蓋率 ≥ 95%，`pnpm lint` 0 錯誤 0 警告。

## 名稱

工作名稱為 **LanLift**。
