# 行動裝置互傳（iPhone ↔ Android）設計與流程

LanLift 在 v0.3 新增行動裝置之間的檔案傳輸：**iPhone → Android** 與
**Android → Android**。iPhone → iPhone 刻意不實作（Apple 裝置請使用 AirDrop）。

## 1. 設計選擇：主機協調的儲存轉送（store-and-forward）

行動瀏覽器無法在背景作為 HTTP 伺服器，因此兩台行動裝置無法直接互相下載。
LanLift 採用「主機協調」模型：

1. Windows／Linux 主機建立 **peer（行動互傳）模式** 的傳輸。
2. 兩台裝置掃描同一 QR Code 加入同一個傳輸工作階段，並由主機分別核准。
3. 裝置 A 把檔案上傳到主機的暫存區，目標指定為裝置 B。
4. 裝置 B 輪詢 `info` 後看到「來自其他裝置」的檔案，點選下載。
5. 主機（Windows／Linux）全程可看見佇列；工作階段結束或逾時後暫存自動清除。

此模型與 v0.2.2 的配對／核准／上傳／下載流程完全一致，僅新增「第二台裝置」與
「傳送目標」概念，因此**既有 Windows ↔ 行動裝置傳輸完全不受影響**。

> 跨網路的行動互傳（兩台裝置不在同一 LAN、或主機不在場）請使用公網中繼，
> 見 [PUBLIC-TRANSFER.md](PUBLIC-TRANSFER.md)。

## 2. 裝置發現流程

| 步驟 | 裝置 | 動作 |
|---|---|---|
| 1 | 主機 | `createSession({ mode: 'peer' })`，產生 256-bit 配對密鑰與 QR Code |
| 2 | 裝置 A/B | 掃描 QR → `POST /api/s/:token/pair`（`{ id, name }`） |
| 3 | 主機 | 管理頁／桌面端顯示兩台待核准裝置，逐台按「允許」 |
| 4 | 裝置 | `GET /api/s/:token/info?client=<id>` 回傳 `peers`（其他已核准裝置清單） |

「發現」依賴主機的一次性網址（QR Code），不引入 mDNS／Bonjour：在行動瀏覽器
環境中最可靠，且與 v0.2.2 行為一致。

## 3. 連線建立與傳輸流程（iPhone → Android 範例）

```text
iPhone                       主機（Windows/Linux）              Android
  │  pair(id=A, name)              │                              │
  │ ─────────────────────────────▶ │  pair(id=B, name)            │
  │                                │ ◀────────────────────────── │
  │  主機核准 A、核准 B            │                              │
  │ ◀──────── info { peers:[B] } ──│── info { peers:[A], files } ▶│
  │                                │                              │
  │  upload?client=A&to=B          │                              │
  │ ─────────────────────────────▶ │  存入 receiveDir 暫存        │
  │                                │  files += { from:A, to:B }   │
  │                                │ ── info { files:[{from:A}] }▶│
  │                                │ ◀── download/<fileId>?client=B
  │                                │ ──────── 檔案串流 ──────────▶│
```

- 上傳沿用既有 multipart 串流（busboy），上限 20 GiB／30 個檔案。
- `to` 參數指定目標裝置；省略時即傳給主機（v0.2.2 相容行為）。
- 互傳檔案記錄 `from`／`to`；只有目標裝置與主機可下載，其他人一律 403。

## 4. API 變更摘要

| 端點 | 變更 |
|---|---|
| `POST /api/s/:token/pair` | 不變（任何裝置皆可加入；peer 模式允許多台 approved） |
| `GET /api/s/:token/info` | 新增 `mode`、`peers`；`files` 每項新增 `from`／`to` |
| `POST /api/s/:token/upload?client=&to=` | 新增選用 `to`；host 模式下 `to` 回 400 |
| `GET /api/s/:token/download/:id?client=` | 互傳檔案僅目標裝置可下載 |
| `POST /api/admin/session` | 新增 `{ mode: 'host' \| 'peer' }` |

## 5. 行動端 UI（portal）

- 傳送目標下拉選單：預設「主機」，有已核准對端時列出對方名稱。
- 「其他裝置」卡片：顯示互傳對象；無對端時自動隱藏（對 v0.2.2 主機亦相容）。
- 來自對端的檔案在「從主機接收」區塊顯示「來自其他裝置」標記。

## 6. 安全考量

- 兩台裝置都必須經主機明確核准（peer 模式不會放寬核准要求）。
- 互傳檔案的路徑以亂數後綴寫入暫存，避免檔名衝突與猜測。
- 工作階段逾時（10 分鐘）或結束時，佇列與暫存檔案自動清除。
- 互傳範圍限於該次一次性工作階段；不保留任何跨工作階段的裝置身分。
