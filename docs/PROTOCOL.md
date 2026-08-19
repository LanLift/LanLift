# LanLift 訊號與中繼協定（v1）

中繼伺服器與所有端點（Windows 桌面、Linux 主機、行動網頁）之間的交換格式。
所有訊號訊息皆為 JSON、經 WebSocket 傳送；檔案資料以加密區塊經中繼資料面轉發。

## 1. 訊息信封

```json
{ "v": 1, "type": "<訊息類型>", "payload": { } }
```

`v` 為協定版本（目前固定 `1`）。未知類型或格式錯誤時，伺服器回傳 `error`。

## 2. 訊息類型

| type | 方向 | 說明 |
|---|---|---|
| `register` | 端點 → 伺服器 | 註冊裝置：`deviceId`、`name`、`platform`、`token`（伺服器認證） |
| `welcome` | 伺服器 → 端點 | 註冊成功：`deviceId`、`serverTime`、`relayChunkBytes`、`bytesPerSecond` |
| `create-room` | 主機 → 伺服器 | 建立遠端房間：`name`、`platform`、`publicKey`（ECDH 公鑰） |
| `room-created` | 伺服器 → 主機 | `roomCode`（6 位十六進位）、`roomToken`（高熵）、`expiresAt`、`members` |
| `join-room` | 訪客 → 伺服器 | 以 `roomCode` 加入：`name`、`platform`、`publicKey` |
| `room-state` | 伺服器 → 成員 | `roomToken`、`members`（含角色、核准狀態、公鑰、鹽） |
| `approve` | 主機 → 伺服器 | 核准／拒絕：`roomToken`、`memberId`、`approved` |
| `signal` | 端點 ⇄ 伺服器 | WebRTC 協商轉發：`roomToken`、`target`、`data`（offer/answer/candidate） |
| `peer-key` | 端點 ⇄ 伺服器 | 交換 ECDH 公鑰與鹽：`roomToken`、`publicKey`、`salt` |
| `relay-frame` | 端點 ⇄ 伺服器 | 加密檔案區塊：`roomToken`、`fileId`、`seq`、`total`、`checksum`、`iv`、`data`（base64） |
| `relay-ack` | 端點 ⇄ 伺服器 | 區塊確認：`roomToken`、`fileId`、`seq` |
| `relay-request` | 端點 ⇄ 伺服器 | 要求重傳：`roomToken`、`fileId`、`missing`（序號陣列） |
| `ping` / `pong` | 雙向 | 心跳；伺服器每 30 秒檢查並終止無回應連線 |
| `bye` | 端點 → 伺服器 | 離開房間：`roomToken`（省略表示離開全部） |
| `error` | 伺服器 → 端點 | `error`（訊息）、`retryable`（可否重試） |

## 3. 房間與核准

- 房間由主機建立：`roomCode` 為 6 位十六進位（人類輸入），`roomToken` 為
  256-bit 隨機權杖（內部識別）。房間最長 24 小時。
- 訪客加入後為 `pending`；只有主機可 `approve`。
- **未核准成員**：不可傳送／接收 `signal`、`peer-key` 與 `relay-frame`，
  伺服器直接丟棄其資料區塊（`relay-hub` 核准檢查）。
- 成員斷線即從房間移除並廣播 `room-state`；房間清空後釋放中繼通道。

## 4. 端對端加密（區塊格式）

1. 雙方以 `join-room`／`create-room` 攜帶的 `publicKey`（ECDH P-256 SPKI）交換公鑰。
2. 主機產生隨機鹽，經 `peer-key` 廣播；雙方以
   `HKDF-SHA256(ECDH 共享密鑰, salt, info="lanlift/e2e/v1")` 衍生 AES-256-GCM 金鑰。
3. 檔案切為 64 KiB 區塊；每區塊獨立 12-byte IV，以 AES-GCM 加密後 base64 傳送。
4. 序號 `-1` 的區塊為**檔案中繼資料**（加密後）：`{ name, size, total, fileId }`。

```text
relay-frame payload
  fileId   隨機檔案識別碼
  seq      -1 = 中繼資料；0..total-1 = 資料區塊
  total    區塊總數
  checksum 明文區塊的 SHA-256（十六進位；中繼資料為空）
  iv       12-byte IV（base64）
  data     AES-GCM 密文（base64）
```

## 5. 中繼資料面規則（relay-hub）

- 只轉發已核准成員的區塊；`relay-ack`／`relay-request` 僅在房間成員間轉發。
- 每通道令牌桶限速（預設 2 MiB/s）；超限回 `error { retryable: true }`。
- 單一區塊上限 256 KiB；每通道累計上限 200 GiB。
- 伺服器**不解密**任何區塊。

## 6. 斷線重連

- `RelayClient` 以指數退避（1s → 30s）自動重連；連線建立前發出的訊息會排隊補送。
- 重連後重新 `register`；上層 `RemoteTransfer.refresh()` 重新加入房間。
- 傳輸層以 ACK／重傳彌補斷線期間的遺失區塊。
