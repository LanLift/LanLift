# LanLift

> **同一個 Wi-Fi，直接雙向傳檔。**

LanLift 是一個適用於 Windows 10／11 的桌面傳輸程式。它在電腦上建立一個短暫、一次性的區域網路傳輸連線，並顯示 QR Code。iPhone、iPad 或 Mac 只要掃描 QR Code，在 Safari 中取得 Windows 使用者的核准後，即可和電腦雙向收發檔案。檔案不會經過雲端服務或外網中繼。

Apple 的原生 AirDrop 僅在 iPhone、iPad 與 Mac 間運作；LanLift 因此不嘗試加入原生 AirDrop，而是在同一網路提供相同「掃描、核准、直接傳送」體驗。[1]

## 安裝

| 檔案 | 用途 | 建議對象 |
|---|---|---|
| `LanLift Setup 0.1.1.exe` | 標準安裝程式，會建立開始功能表與桌面捷徑。 | 一般使用者。 |
| `LanLift 0.1.1.exe` | 免安裝可攜版，可直接執行。 | 希望先試用或沒有安裝權限的使用者。 |

請從 `release` 資料夾選取其中一個檔案。在首次啟動時，如 Windows Defender Firewall 詢問是否允許網路存取，請**只勾選「私人網路」**並選擇允許；若拒絕，iPhone、iPad 或 Mac 將無法開啟 QR Code 對應的區網網址。

由於此為未簽署的原型，Windows SmartScreen 可能顯示警示。請只在你信任檔案來源時使用「更多資訊」中的執行選項；正式公開發行前應使用受信任的程式碼簽章憑證。

## 使用方式

| 步驟 | Windows 上的操作 | Apple 裝置上的操作 |
|---|---|---|
| 1 | 確認 Windows 電腦與 iPhone、iPad 或 Mac 連上同一個 Wi-Fi。 | 連至同一個 Wi-Fi。 |
| 2 | 開啟 LanLift，按下 **建立傳輸**。 | 無需安裝 App。 |
| 3 | 程式顯示 QR Code 與 10 分鐘倒數。 | 使用相機掃描 QR Code，開啟 Safari。iPhone 支援直接從相機辨識 QR Code。[2] |
| 4 | 畫面顯示對方輸入的裝置名稱後，按下 **允許**。 | 等待 Windows 核准。 |
| 5 | 在 Windows 將檔案或資料夾拖入分享佇列；資料夾會自動壓縮成 ZIP。 | 下載 Windows 端分享的檔案，或選取檔案上傳。 |
| 6 | 完成後按 **結束這次傳輸**，或等待 10 分鐘自動到期。 | 網址會立即／到期後失效。 |

傳入 Windows 的檔案預設儲存在 `下載\LanLift`。可從右上角的 **接收資料夾** 變更位置。

## 已實作功能

| 功能 | 說明 |
|---|---|
| 一次性 QR 配對 | 每個工作階段使用 256-bit 隨機密鑰，預設 10 分鐘失效，且一次只核准一台 Apple 裝置。 |
| 雙向直接傳檔 | Windows 端可拖放或選取檔案分享；Apple 裝置可在 Safari 下載或上傳檔案。 |
| 串流式傳輸 | 檔案直接由來源串流至目的端，不壓縮、不轉碼、不上傳雲端；大型檔案不會整個載入記憶體。 |
| 使用者核准 | Apple 裝置連線後必須由 Windows 使用者明確允許，才能讀取或上傳檔案。 |
| 檔案衛生處理 | 上傳檔案會寫入使用者指定的接收資料夾，並處理可能不安全的檔名。 |
| 即時介面 | Windows 端顯示連線裝置、檔案佇列、接收紀錄及傳輸到期倒數；窄視窗會改為單欄卡片，避免右側內容被裁切。Safari 頁面顯示上傳進度。 |
| 資料夾 ZIP 傳送 | 拖入或選取資料夾時，程式會在本機建立暫存 ZIP，加入佇列後傳送；移除佇列或結束工作階段時會自動清除該暫存 ZIP。 |

## 速度與網路條件

LanLift 的速度由 Wi-Fi 訊號、路由器、Windows 網卡及裝置儲存速度決定；它不受家用網際網路上傳頻寬影響，因為檔案不離開本地網路。程式採用 Node.js 串流 API，不會將完整檔案讀入記憶體。[3]

請勿使用啟用裝置隔離的訪客 Wi-Fi 或公司網路；這類網路通常會阻止裝置彼此連線。若掃描後無法開啟頁面，請依序確認兩台裝置使用同一個私有 Wi-Fi、Windows 網路設定為「私人」、防火牆已允許 LanLift 私人網路存取，以及 VPN 已暫時停用。

## 安全與限制

LanLift 的首版採用「可信任的同一個私人網路 + 不可猜測的短期 QR 連結 + Windows 明確核准」模式。它**不是**原生 AirDrop 協定，也尚未提供端對端加密、可續傳、資料夾同步、多人傳輸或跨網路傳輸。因此，不應在不可信任的公共 Wi-Fi 上傳送機密資料。

正式產品後續應加入：以 WebCrypto 實作的端對端加密與 QR 驗證碼比對、裝置信任清單、斷點續傳、mDNS Windows 裝置自動發現、可選的 iOS 原生 App 以及程式碼簽章。

## 開發與測試

```bash
pnpm install
pnpm test
pnpm run dist:win
```

`pnpm test` 會驗證：一次性配對、核准前存取限制、Windows 至 Apple 的檔案下載、Apple 至 Windows 的串流上傳，以及工作階段結束後網址失效。

## 參考資料

[1] [Apple Support：在 Mac 上使用 AirDrop](https://support.apple.com/guide/mac-help/use-airdrop-to-send-items-to-nearby-devices-mh35868/mac)

[2] [Apple Support：使用 iPhone 掃描 QR Code](https://support.apple.com/guide/iphone/scan-a-qr-code-iphe8bda8762/ios)

[3] [Node.js：Stream API](https://nodejs.org/api/stream.html)

---

作者：Manus AI  
版本：0.1.1  
日期：2026-08-18
