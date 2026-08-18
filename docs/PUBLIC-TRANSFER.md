# 公網傳輸適配設計（中繼伺服器 + WebRTC + 端對端加密）

v0.2.2 的 LanLift 僅支援區域網路：傳輸服務綁定本機介面、QR 網址使用本機 IP、
無任何跨網際網路路徑（亦無 mDNS／Bonjour 依賴）。v0.3 新增自架中繼伺服器，使
Windows／Linux 主機與行動裝置可在不同網路之間傳檔。

## 1. 架構總覽

```text
                        ┌───────────────────────────┐
  Windows/Linux 主機 ────│  LanLift 中繼伺服器 (VPS)  │──── 行動裝置（iPhone/Android）
  RelayClient/RemoteHost│  /ws 訊號 + 中繼資料面     │    remote.html 遠端頁面
        │               │  /    遠端傳輸頁面         │           │
        └──── WebRTC P2P 直連（優先，STUN/TURN）────┘           │
        └──── 中繼通道（兜底，E2E 加密區塊轉發）────────────────┘
```

- **訊號伺服器**：裝置註冊、房間建立／加入、主機核准、WebRTC offer/answer/ICE
  轉發、ECDH 公鑰交換（詳見 [PROTOCOL.md](PROTOCOL.md)）。
- **中繼資料面**：已核准成員之間的加密區塊與 ACK 轉發，附令牌桶限速與流量上限。
- **傳輸通道選擇**：端點優先嘗試 WebRTC 資料通道；逾時（預設 8 秒）或失敗自動
  回退中繼通道。中繼永遠只看到密文。

## 2. 連線流程

| 步驟 | 主機（Windows/Linux） | 行動裝置 |
|---|---|---|
| 1 | 在「遠端連線」頁選擇自訂伺服器並按「建立遠端傳輸」 | 開啟 `https://<伺服器>/` |
| 2 | `RemoteHost.createSession()` → 訊號註冊 → 建立房間 | 輸入 6 位數房間代碼 |
| 3 | 收到訪客加入 → 核准 | 等待主機核准 |
| 4 | 交換 ECDH 公鑰與鹽 → 衍生 AES-256-GCM 工作階段金鑰 | 同左 |
| 5 | 建立 WebRTC 資料通道（STUN/TURN） | 同左 |
| 6 | P2P 連通 → 加密分塊直傳；逾時 → 中繼通道加密分塊 | 同左 |

## 3. 安全設計

| 項目 | 實作 |
|---|---|
| **身分驗證** | 房間代碼（6 位十六進位）+ 高熵 roomToken；主機逐裝置核准；伺服器可設 `serverToken` 拒絕未授權註冊 |
| **傳輸加密** | ECDH（P-256）→ HKDF-SHA256 → AES-256-GCM；每區塊獨立 12-byte IV，中繼無法解密 |
| **完整性** | AES-GCM 認證標籤 + 每區塊 SHA-256；壞塊自動要求重傳 |
| **傳輸安全** | 生產環境強制 WSS／HTTPS（TLS 憑證於 `relay/config.example.json` 設定） |
| **金鑰前向性** | 每次傳輸產生全新 ECDH 金鑰對與鹽；不保存任何長期金鑰 |

## 4. 失敗重試

- **分塊層**：每個 64 KiB 區塊等待 ACK；未確認區塊按指數退避重傳（1s 起、上限
  30s、最多 8 次）；接收端定時要求缺塊（`relay-request`）。
- **連線層**：`RelayClient` 斷線自動重連（指數退避），重連後重新註冊並恢復房間。
- **通道層**：WebRTC 連線逾時（`p2pTimeoutMs`）自動切換中繼，已發出區塊在
  新通道上補送（接收端以區塊序號去重）。

## 5. 頻寬限制

中繼伺服器對每個房間通道套用**令牌桶**（`relay/bandwidth.js`）：

| 參數 | 預設 | 說明 |
|---|---|---|
| `bytesPerSecond` | 2 MiB/s | 每通道每秒位元組上限（0 = 不限） |
| `burstFactor` | 3 | 允許的瞬間突發倍數 |
| `maxChunkBytes` | 256 KiB | 單一區塊大小上限 |
| `maxSessionBytes` | 200 GiB | 每通道累計流量上限 |

超限區塊被拒絕並通知發送端稍後重試（`relay-frame` 回 `retryable` 錯誤）；
`GET /stats` 可檢視各房間的轉發統計（可設 `adminToken` 保護）。

## 6. 部署

```bash
sudo bash scripts/install-relay.sh     # 安裝 + systemd 服務
```

| 設定 | 位置 |
|---|---|
| 連接埠／host／權杖／限速 | `/etc/lanlift/relay.json` |
| TLS 憑證（fullchain／privkey） | `/etc/lanlift/relay.json` 的 `tls` 欄位 |
| 環境變數 | `/etc/lanlift-relay.env`（`LANLIFT_PORT`、`LANLIFT_SERVER_TOKEN`） |

```bash
systemctl status lanlift-relay
journalctl -u lanlift-relay -f
```

防火牆需開放 TCP `${RELAY_PORT}`（預設 8443）。桌面端在「遠端連線」頁填入
`wss://<你的網域>:8443/ws` 與 TURN 位址（選用）。

## 7. 桌面端整合

- `src/remote-host.js`：以保存的自訂伺服器設定建立遠端房間、核准、雙向傳檔
  （讀取本機檔案路徑；接收檔案寫入接收資料夾）。不依賴 Electron，可單獨測試。
- Electron `main.js`／`preload.js`／`renderer.js`：遠端頁新增「建立遠端傳輸」
  房間代碼顯示、待核准裝置清單與結束按鈕。
- TURN 設定沿用 v0.2.2 的伺服器設定紀錄（`server-profiles.js`），憑證以系統
  資料保護保存。

## 8. 限制與後續

- 中繼通道為單一伺服器儲存轉發；中繼伺服器本身不參與 WebRTC 資料面（TURN 需
  另外部署 coturn 等標準 TURN 服務）。
- 瀏覽器端不實作 UDP 打洞（瀏覽器不開放原始 UDP socket）；NAT 穿透由 WebRTC
  ICE（STUN/TURN）完成，這正是「優先 P2P、失敗走中繼」的落地方式。
- 行動互傳跨公網：兩台裝置各自加入同一房間（主機為房間建立者），流程相同。
