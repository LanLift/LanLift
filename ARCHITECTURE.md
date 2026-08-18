# LanLift 首版架構

## 目標

LanLift 是一個可安裝於 Windows 的桌面程式，讓 Windows、iPhone、iPad 與 Mac 在**同一個區域網路**直接雙向傳送檔案。首版以一次性 QR Code 配對建立短暫通訊空間，不使用帳號、雲端中繼或外網儲存。

## 使用流程

| 步驟 | Windows 桌面程式 | Apple 裝置（Safari） |
|---|---|---|
| 1 | 使用者點選「建立傳輸」 | 無動作 |
| 2 | 程式建立一個 256-bit 隨機配對密鑰與 10 分鐘有效期限，並以本機 IP、連接埠與密鑰產生 QR Code | 掃描 QR Code |
| 3 | 顯示連線請求；使用者核准 | 開啟本機傳輸頁面並輸入裝置名稱 |
| 4 | 拖放或選取檔案，直接以串流方式送出；接收上傳的檔案 | 下載 PC 分享的檔案，或選取檔案上傳至 PC |
| 5 | 顯示每個檔案的進度、速度、完成狀態與接收資料夾 | 顯示上傳／下載進度與完成結果 |
| 6 | 手動結束或到期後，清除記憶體中的授權與公開連線 | 連線失效，無法重新存取 |

## 元件與責任

| 元件 | 技術選擇 | 責任 |
|---|---|---|
| Windows 殼層 | Electron | 安裝型 Windows 程式、系統通知、原生選檔與資料夾選擇、Windows 防火牆提示。 |
| 桌面介面 | 原生 HTML/CSS/JavaScript | 傳輸建立、QR 顯示、檔案佇列、接收紀錄與設定。 |
| 區網傳輸服務 | Node.js `http` | 僅在執行期間綁定區網介面，提供一次性配對頁面、上傳及下載串流。 |
| 即時狀態通道 | Server-Sent Events | 向桌面介面與手機網頁回報配對、進度、完成與到期事件。 |
| QR Code | `qrcode` | 將短期傳輸網址編碼，以相機掃描建立連線。 |

## 配對與安全邊界

傳輸網址包含不可猜測的隨機密鑰；伺服器不列舉工作階段、不接受沒有正確密鑰的存取，且每個工作階段僅容許一台 Apple 裝置連線。首次開啟時，Windows 端必須核准裝置名稱；任何上傳均寫入隨機暫存檔，完成後才以安全檔名移至使用者指定的接收資料夾。工作階段預設在 10 分鐘後自動失效，使用者可隨時手動結束。

> 首版採取「同網路、短期高熵連結、使用者核准」的信任模型，並不聲稱在惡意或被監聽的 LAN 上提供端對端加密。正式商業版應補上裝置憑證釘選與 WebCrypto／ECDH 金鑰協商，避免 QR URL 或 HTTP 流量遭區網攔截。

## 高速傳輸設計

檔案會以 HTTP 串流從來源直接寫入目的端，不會載入記憶體、壓縮、轉碼或上傳至第三方。下載端以 `Content-Disposition: attachment` 觸發系統下載；上傳端以 multipart 串流直接寫入磁碟。因此，實際速度主要受 Wi-Fi、網卡、路由器與目的端儲存裝置限制，而非外網頻寬。

首版限制為同一個可互相路由的私有網段。若路由器啟用 AP／Client isolation、訪客網路隔離或 Windows 網路類型設為「公用」，裝置可能無法連線；程式會顯示可診斷的提示。

## 首版功能範圍

| 納入首版 | 後續版本 |
|---|---|
| 一次性 QR Code、10 分鐘過期、單一 Apple 裝置配對 | 多人房間與持久受信任裝置 |
| Mac/iPhone/iPad Safari 免安裝雙向傳檔 | iOS 原生 App 與原生分享擴充功能 |
| Windows 拖放檔案、檔案選擇、接收目錄與傳輸紀錄 | Windows 裝置 mDNS 自動發現 |
| 大檔串流、進度與每秒速度 | 可續傳、資料夾同步與跨網路中繼 |
| 配對核准、不可猜測連結、到期與手動結束 | E2E 加密、憑證釘選、企業裝置管理 |

## 封裝與交付

專案使用 `electron-builder` 產出 Windows NSIS 安裝程式與 portable 可攜版本。Windows 用戶端首次執行時，應允許程式在「私人網路」上通過防火牆，否則 Apple 裝置無法開啟 QR Code 所指向的本機網址。

## 驗收標準

1. Windows 10/11 可安裝並啟動應用程式。
2. 程式可產生 QR Code，iPhone/iPad/Mac 掃描後於 Safari 顯示連線請求。
3. 只有 Windows 端核准後，Safari 頁面才能上傳與下載。
4. 兩方向檔案的位元組數與 SHA-256 雜湊皆一致。
5. 逾時或手動結束後，原網址回傳無效狀態，不再提供檔案。
6. 傳輸期間可顯示進度與即時速度，並全程不呼叫雲端服務。

## 名稱

工作名稱為 **LanLift**。這個名稱僅用於原型，日後可替換為正式品牌名稱。

[1]: https://support.apple.com/guide/mac-help/use-airdrop-to-send-items-to-nearby-devices-mh35868/mac "Apple Support：AirDrop 支援的裝置範圍"
[2]: https://support.apple.com/guide/iphone/scan-a-qr-code-iphe8bda8762/ios "Apple Support：使用 iPhone 掃描 QR Code"
[3]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests "MDN：HTTP Range requests（後續可續傳設計參考）"
[4]: https://nodejs.org/api/stream.html "Node.js：串流 API"

## 參考資料

[1] [Apple Support：在 Mac 上使用 AirDrop](https://support.apple.com/guide/mac-help/use-airdrop-to-send-items-to-nearby-devices-mh35868/mac)

[2] [Apple Support：使用 iPhone 掃描 QR Code](https://support.apple.com/guide/iphone/scan-a-qr-code-iphe8bda8762/ios)

[3] [MDN：HTTP Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)

[4] [Node.js：Stream API](https://nodejs.org/api/stream.html)

---

作者：Manus AI
日期：2026-08-18
