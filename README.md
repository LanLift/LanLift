# LanLift

> **快速傳送，留在你的網路裡。**
>
> 一款私人檔案傳輸工具：同一 Wi-Fi 直連、行動裝置互傳，以及透過自架中繼伺服器的公網傳輸。
> 支援 Windows 桌面、Linux 主機（Ubuntu / Kali）與行動瀏覽器（iPhone / Android）。

## 目錄

1. [專案簡介](#專案簡介)
2. [主要功能](#主要功能)
3. [安裝](#安裝)
4. [直接連線：同一 Wi-Fi 傳檔](#直接連線同一-wi-fi-傳檔)
5. [行動裝置互傳](#行動裝置互傳)
6. [Linux 主機（Ubuntu / Kali）](#linux-主機ubuntu--kali)
7. [公網傳輸：自架中繼伺服器](#公網傳輸自架中繼伺服器)
8. [安全與隱私](#安全與隱私)
9. [開發](#開發)
10. [Roadmap](#roadmap)
11. [授權](#授權)

---

## 專案簡介

LanLift 讓 Windows 電腦、Linux 主機、iPhone 與 Android 裝置之間以**一次性配對**建立短暫傳輸空間，雙向傳送檔案：

- **直接連線**：同一 Wi-Fi 內以 QR Code 配對，檔案只在區域網路傳輸。
- **行動互傳**：iPhone ↔ Android、Android ↔ Android，經主機協調的儲存轉送（store-and-forward）。
- **公網傳輸**：透過自架中繼伺服器（訊號 + 中繼 + TURN 協調），優先 WebRTC 直連，失敗自動回退中繼，全程端對端加密。

> **限制說明：** LanLift 不加入 Apple 原生 AirDrop。Apple 裝置以 QR Code 開啟 LanLift 的傳輸頁面（Safari）。iPhone ↔ iPhone 請直接使用 AirDrop。公網傳輸需要部署 LanLift 相容的中繼伺服器（詳見 `docs/PUBLIC-TRANSFER.md`）。

---

## 主要功能

| 功能 | 說明 |
|---|---|
| **直接連線** | Windows／Linux 主機與 iPhone、Android 位於同一可互通 Wi-Fi 時，以一次性 QR Code 建立連線。 |
| **行動互傳** | 主機建立「行動互傳」傳輸後，多台行動裝置可互相傳檔（iPhone → Android、Android → Android）。 |
| **公網傳輸** | 自架中繼伺服器：訊號轉發、WebRTC 協調與中繼資料面；WebRTC 直連優先、TURN／中繼兜底。 |
| **端對端加密** | ECDH（P-256）+ HKDF + AES-256-GCM；中繼伺服器只看到密文。 |
| **雙向傳檔** | 主機可分享檔案供裝置下載；裝置可上傳至主機或指定裝置。 |
| **資料夾自動 ZIP** | 拖入或選取資料夾時在本機壓縮為 ZIP 再加入佇列。 |
| **連線核准** | 新裝置必須經主機明確允許；未核准裝置無法收發任何資料。 |
| **串流式傳輸** | LAN 檔案以串流方式傳送；公網傳輸以 64 KiB 分塊 + SHA-256 校驗 + ACK 重試。 |
| **頻寬限制** | 中繼伺服器以令牌桶對每通道限速（預設 2 MiB/s，可設定）。 |
| **自訂伺服器紀錄** | 桌面端可新增、編輯、選用與刪除訊號與 TURN 伺服器設定；憑證以系統資料保護保存。 |
| **Linux 管理頁面** | Linux 主機提供本機網頁管理介面（建立傳輸、核准、加入檔案、切換接收資料夾）。 |

---

## 安裝

### Windows 桌面版

1. 前往 **Releases** 下載最新 `LanLift Setup x.y.z.exe`。
2. 執行安裝程式；若 Windows Defender Firewall 詢問網路權限，請只允許 **私人網路**。
3. 執行 `pnpm start` 啟動（開發模式），或使用安裝版捷徑。

### Linux 主機（Ubuntu 22.04+ / Kali Rolling）

```bash
sudo bash scripts/install-linux.sh
```

安裝完成後：管理頁面 `http://127.0.0.1:8899/admin`、systemd 服務 `lanlift`。詳見 [docs/LINUX.md](docs/LINUX.md)。

### 公網中繼伺服器

```bash
sudo bash scripts/install-relay.sh
```

詳見 [docs/PUBLIC-TRANSFER.md](docs/PUBLIC-TRANSFER.md)。

---

## 直接連線：同一 Wi-Fi 傳檔

1. 在桌面端或 Linux 管理頁選擇 **直接連線**，按下 **建立傳輸**。
2. LanLift 產生有效期 10 分鐘的 QR Code（Linux 端亦可列印文字 QR 與網址）。
3. 行動裝置掃描 QR Code，開啟傳輸頁面並輸入裝置名稱。
4. 主機核准後即可雙向傳檔；完成後按 **結束這次傳輸**，連線網址立即失效。

---

## 行動裝置互傳

支援 **iPhone → Android** 與 **Android → Android**（不實作 iPhone → iPhone，請使用 AirDrop）。

1. 主機建立傳輸時選擇 **peer（行動互傳）模式**（Linux 管理頁選 `peer`）。
2. 兩台裝置掃描同一 QR Code 並提出連線請求。
3. 主機核准兩台裝置後，裝置頁面會出現「其他裝置」區塊與傳送目標選單。
4. 選擇目標裝置上傳檔案：檔案經主機暫存（主機為協調者），目標裝置於「從主機接收」區塊下載。
5. 互傳檔案只開放給目標裝置下載；host 模式維持 v0.2.2 單裝置語意，不受影響。

流程與 API 詳見 [docs/MOBILE-TRANSFER.md](docs/MOBILE-TRANSFER.md)。

---

## Linux 主機（Ubuntu / Kali）

- 與 Windows 桌面版共用同一 `TransferServer`，通訊協定完全相容（既有 Windows ↔ 行動裝置傳輸不受影響）。
- 指令：`node src/linux-host.js --port 8899 --session host --qr`
- 安裝、systemd 服務、防火牆與解除安裝：詳見 [docs/LINUX.md](docs/LINUX.md)。

---

## 公網傳輸：自架中繼伺服器

LanLift 不使用任何共用或預設免費中繼；跨網路傳輸由你自架的中繼伺服器提供：

| 元件 | 說明 |
|---|---|
| **訊號伺服器**（`relay/`） | WSS：裝置註冊、房間建立／加入、核准、WebRTC 協商轉發、ECDH 公鑰交換。 |
| **中繼資料面** | 已核准成員間的加密區塊轉發；令牌桶限速、區塊大小與累計流量上限。 |
| **WebRTC 協調** | 端點優先建立 P2P 資料通道（STUN/TURN），逾時自動回退中繼通道。 |
| **遠端頁面** | 中繼伺服器託管 `/` 頁面，行動裝置輸入 6 位數房間代碼加入。 |

桌面端在「遠端連線」頁選擇自訂伺服器後按 **建立遠端傳輸**；行動裝置開啟 `https://<你的伺服器>/` 輸入房間代碼。全程端對端加密，詳見 [docs/PUBLIC-TRANSFER.md](docs/PUBLIC-TRANSFER.md) 與 [docs/PROTOCOL.md](docs/PROTOCOL.md)。

---

## 安全與隱私

| 項目 | LanLift 行為 |
|---|---|
| **配對授權** | 高熵一次性配對密鑰（256-bit）+ 主機明確核准；未核准裝置無法收發。 |
| **端對端加密** | 公網傳輸使用 ECDH（P-256）+ HKDF + AES-256-GCM；每區塊獨立 IV，中繼不可讀。 |
| **傳輸完整性** | 每 64 KiB 區塊附 SHA-256 校驗；AES-GCM 認證標籤同時提供完整性保證。 |
| **伺服器認證** | 中繼伺服器可設定 `serverToken`，拒絕未授權裝置註冊；遠端頁面建議僅經 WSS/HTTPS 提供。 |
| **頻寬與流量上限** | 每通道令牌桶限速、單一區塊 256 KiB 上限、累計 200 GiB 上限（可設定）。 |
| **憑證保存** | 桌面端伺服器憑證以 Windows 系統資料保護保存；Linux 端管理權杖僅限本機迴路使用。 |

---

## 開發

### 環境需求

| 工具 | 建議版本 |
|---|---|
| Node.js | 22 或更新 |
| pnpm | 9 或更新（`corepack enable pnpm`） |
| 桌面版 | Windows 10/11（Electron） |
| Linux 主機 | Ubuntu 22.04+ / Kali Rolling |

### 常用指令

```bash
pnpm install          # 安裝依賴
pnpm start            # Windows 桌面版（Electron）
pnpm start:linux      # Linux 主機（headless + 管理頁面）
pnpm start:relay      # 公網中繼伺服器
pnpm test             # 全部測試（node:test）
pnpm test:coverage    # 測試 + 覆蓋率（≥ 95%）
pnpm lint             # ESLint（0 錯誤 0 警告）
pnpm build:web        # 打包中繼伺服器的遠端頁面 bundle
pnpm run dist:setup   # 建立 Windows 安裝程式（輸出至 release/）
```

### 專案結構

```text
LanLift/
├── src/                       # 共享程式碼（Node.js / Electron / 瀏覽器）
│   ├── main.js                # Electron 主程序與安全 IPC（含遠端傳輸）
│   ├── preload.js             # 受限的桌面橋接層
│   ├── renderer.js            # 直接／遠端雙頁互動
│   ├── transfer-server.js     # 區域網路傳輸服務（LAN + 行動互傳 + Linux 管理 API）
│   ├── server-profiles.js     # 自訂伺服器加密保存與歷史紀錄
│   ├── portal.js              # 行動裝置 LAN 傳輸頁面（含互傳 UI）
│   ├── admin-page.js          # Linux 主機網頁管理介面
│   ├── linux-host.js          # Linux headless 主機入口（CLI）
│   ├── crypto.js              # ECDH + HKDF + AES-GCM 端對端加密（跨端）
│   ├── chunker.js             # 分塊、SHA-256 校驗、ACK 重試
│   ├── protocol.js            # 訊號協定與房間註冊表
│   ├── relay-client.js        # 訊號／中繼客戶端（Node 與瀏覽器通用）
│   ├── remote-transfer.js     # 遠端傳輸協調器（P2P 優先、中繼兜底）
│   ├── remote-host.js         # 桌面／Linux 主機的遠端傳輸整合
│   ├── remote-web.js          # 行動遠端頁面邏輯（可注入 DOM 測試）
│   ├── remote-web-entry.js    # 瀏覽器入口（esbuild 打包）
│   ├── event-emitter.js       # 跨端迷你 EventEmitter
│   ├── index.html             # 桌面介面
│   └── styles.css             # 響應式 UI 樣式
├── relay/                     # 公網中繼伺服器
│   ├── server.js              # HTTP(S) + WSS 入口、健康檢查、遠端頁面
│   ├── signaling.js           # 訊號伺服器（房間、核准、轉發）
│   ├── relay-hub.js           # 中繼資料面（限速、大小與流量上限）
│   ├── bandwidth.js           # 令牌桶流量整形
│   ├── config.example.json    # 設定範例
│   ├── remote.html            # 行動遠端傳輸頁面
│   └── remote-web.js          # 打包產物（pnpm build:web）
├── scripts/                   # Linux 安裝腳本與 systemd 單元
│   ├── install-linux.sh       # Ubuntu / Kali 主機安裝
│   ├── uninstall-linux.sh     # 解除安裝
│   ├── install-relay.sh       # 中繼伺服器安裝
│   ├── lanlift.service        # 主機 systemd 單元
│   └── lanlift-relay.service  # 中繼 systemd 單元
├── test/                      # 單元與整合測試（node:test）
├── docs/                      # 架構、協定、部署與測試文件
├── build/installer.nsh        # Windows 單版本升級提示
└── release/                   # Windows 安裝程式輸出
```

---

## Roadmap

- [x] Windows 與 Apple 裝置的同網路雙向傳檔
- [x] 一次性 QR Code 與 Windows 端連線核准
- [x] 資料夾自動壓縮為 ZIP
- [x] 直接／遠端雙頁導覽與自訂伺服器紀錄
- [x] Linux 主機（Ubuntu / Kali）：headless 服務、網頁管理、安裝腳本
- [x] 行動裝置互傳（iPhone → Android、Android → Android）
- [x] 自架中繼伺服器（訊號 + 中繼 + WebRTC 協調）與端對端加密
- [x] 分塊傳輸、SHA-256 校驗、ACK 重試與頻寬限制
- [ ] iPhone／iPad 原生用戶端與已配對裝置自動發現
- [ ] Windows 程式碼簽章與自動更新

---

## 貢獻

歡迎提交 Issue、功能建議與 Pull Request（以 `develop` 為目標分支）。回報問題時請附上 LanLift 版本、作業系統、網路類型、可重現步驟與非敏感的錯誤資訊。

## 授權

本專案採用 [MIT License](LICENSE)。
