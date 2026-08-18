# LanLift Linux 主機（Ubuntu / Kali）部署指南

LanLift Linux 主機是一個 headless 服務：在 Ubuntu 22.04+ 與 Kali Rolling 上提供與
Windows 桌面版完全相同的區域網路傳輸服務，並附帶本機網頁管理介面。

## 1. 系統需求

| 項目 | 要求 |
|---|---|
| 作業系統 | Ubuntu 22.04+ / Kali Rolling（Debian 系） |
| Node.js | 22 或更新（安裝腳本會自動處理） |
| 網路 | 與行動裝置位於同一可互通 Wi-Fi／LAN；防火牆開放 TCP 連接埠 |
| 記憶體／磁碟 | 傳輸服務本身極輕量；磁碟需容納接收的檔案 |

## 2. 快速安裝

```bash
git clone <你的 LanLift fork 或倉庫>
cd LanLift
sudo bash scripts/install-linux.sh
```

安裝腳本會：

1. 偵測發行版（Ubuntu／Kali，皆為 Debian 系）。
2. 安裝系統依賴（ca-certificates、curl、unzip、ufw）。
3. 若 Node.js 主版本 < 22，透過 NodeSource 安裝 Node 22。
4. 以 `corepack` 啟用 pnpm 並安裝依賴。
5. 部署程式到 `/opt/lanlift`，建立 `lanlift` 系統使用者與 `/var/lib/lanlift/downloads` 接收資料夾。
6. 安裝 systemd 服務 `lanlift`（`/etc/lanlift.env` 存放設定）。
7. 若 ufw 啟用，開放 `${LANLIFT_PORT:-8899}/tcp`。

### 可覆寫的安裝變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `LANLIFT_PORT` | `8899` | 監聽連接埠 |
| `LANLIFT_HOST` | `0.0.0.0` | 綁定位址 |
| `LANLIFT_RECEIVE_DIR` | `/var/lib/lanlift/downloads` | 接收資料夾 |
| `LANLIFT_ADMIN_TOKEN` | 空 | 管理頁面權杖（選用） |

範例：

```bash
sudo LANLIFT_PORT=9000 LANLIFT_ADMIN_TOKEN=secret bash scripts/install-linux.sh
```

## 3. 使用方式

### 管理頁面

安裝後開啟 `http://127.0.0.1:8899/admin`（僅限本機迴路）：

- **建立傳輸**：模式選 `host`（主機 ↔ 單一行動裝置）或 `peer`（行動互傳，多裝置）。
- 行動裝置掃描管理頁 QR Code（或複製網址）連線；在「待核准裝置」按下允許。
- **加入檔案或資料夾**：輸入伺服器本機路徑（多行）加入分享佇列。
- **接收資料夾**：查看或變更儲存位置。
- 收到的檔案與互傳中的檔案都會顯示在管理頁。

### 命令列（無需 systemd）

```bash
node src/linux-host.js --help

# 常用範例
node src/linux-host.js --port 8899 --session host --qr
node src/linux-host.js --port 8899 --session peer --qr   # 行動互傳模式
node src/linux-host.js --receive-dir /srv/lanlift
```

啟動後終端機印出管理頁網址與傳輸網址；`--qr` 會以文字 QR Code 列印傳輸網址。

### systemd

```bash
systemctl status lanlift
journalctl -u lanlift -f
systemctl restart lanlift      # 修改 /etc/lanlift.env 後
```

## 4. 與 Windows／行動端相容性

Linux 主機與 Windows 桌面版共用同一 `TransferServer`（`src/transfer-server.js`）與
同一個行動端入口頁（`src/portal.js`）：

- API 路徑、配對流程、核准流程、上傳／下載格式完全一致。
- v0.2.2 的行動端頁面與既有 Windows 端不受任何影響（新增能力皆為向後相容的擴充）。
- 行動互傳（peer 模式）需要主機端選擇 peer 模式；host 模式維持單裝置語意。

## 5. 解除安裝

```bash
sudo bash /opt/lanlift/scripts/uninstall-linux.sh
```

移除服務、`/opt/lanlift` 與 systemd 單元；使用者檔案保留於 `/var/lib/lanlift`。

## 6. 防火牆與安全建議

- 若路由器啟用 AP／Client isolation，請先停用或改用可互通網段。
- 只對私人網段開放傳輸連接埠；管理頁面與管理 API 僅綁定本機迴路。
- 建議設定 `LANLIFT_ADMIN_TOKEN`，管理 API 會要求 `X-LanLift-Admin` 標頭。
- 傳輸連結為 256-bit 隨機密鑰且 10 分鐘過期；工作階段結束後立即失效。

## 7. 疑難排解

| 症狀 | 處理 |
|---|---|
| 服務無法啟動 | `journalctl -u lanlift -n 50`；確認 Node ≥ 22 與 `/etc/lanlift.env` |
| 手機掃不到 | 確認同一網段、防火牆（ufw）已開 TCP 連接埠、AP isolation 已關閉 |
| 管理頁 401 | 安裝時設定了 `LANLIFT_ADMIN_TOKEN`；輸入正確權杖或清空環境變數重啟 |
| 端口被占用 | 修改 `/etc/lanlift.env` 的 `LANLIFT_PORT` 後 `systemctl restart lanlift` |
