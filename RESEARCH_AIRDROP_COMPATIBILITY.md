# LanLift：AirDrop 相容性研究結論

## 結論摘要

小米與 iPhone 間看起來像 AirDrop 的體驗，**不代表一般 Windows 應用程式可以直接成為 AirDrop 裝置**。目前至少存在兩種不同路徑：其一是小米在 iPhone／iPad／Mac 上安裝其官方的 **Xiaomi Interconnectivity Services** 應用程式，以其自有跨裝置協定完成協作；其二是部分特定 Android 手機取得官方 **Quick Share to AirDrop** 系統級功能，可在 iPhone 的 AirDrop 介面中被選取。[1] [2] [3]

Android 官方清楚將 AirDrop 互通列為相容 Android **行動裝置與平板**的功能，並列出支援型號；小米僅列出 Xiaomi 17T Pro。相對地，Quick Share for Windows 的官方頁面僅說明 Windows 與 Android 的雙向分享，未將 Windows 列入 AirDrop 相容接收者。[2] [4]

Apple 公開的 `sendViaAirDrop` API 是 macOS AppKit 中，讓 **Mac 應用程式**呼叫系統 AirDrop 分享服務的 API；它不是讓 Windows 或任意第三方設備實作 AirDrop 端點的跨平台 SDK。[5] Apple 目前提供的正式路徑是，符合資格的 EU 開發者可依 DMA 互通程序提出具體互操作性請求；該程序包含資格審核與可能數月到最長 24 個月的解決方案開發時程，並不是可立即整合的通用 API。[6]

## 對 LanLift 的產品含義

| 方案 | iPhone 是否需要 LanLift App | 是否會出現在 iPhone 原生 AirDrop 清單 | 可行性與建議 |
|---|---:|---:|---|
| 直接實作 Windows 為 AirDrop 裝置 | 否 | 是 | 現階段無可供一般 Windows App 採用的公開交付路徑；不建議以逆向工程或未授權協定實作。 |
| 等待或合作取得系統級 Quick Share／AirDrop 互通 | 否 | 是 | 依賴平台供應商、特定硬體與授權／發行資格；不適合本產品近期 MVP。 |
| Windows + iPhone 原生 LanLift App | 是，一次安裝 | 否，但 LanLift 的附近裝置清單可呈現同等流程 | **建議方案**。可掌控配對記憶、局域網路直傳、加密、通知與界面。 |
| Windows + Safari QR 網頁 | 否 | 否 | 已實作，但每次掃碼、手機瀏覽器受限、互動慢；不符合新的體驗目標。 |

## 建議的 AirDrop-like 升級設計

首次使用時，Windows 和 iPhone 各自建立長期裝置金鑰。使用者只須掃碼或輸入六位數驗證碼**一次**，在雙方確認指紋後，將對方公開金鑰和裝置名稱安全保存於 Windows 的受保護儲存區與 iOS Keychain。之後不再掃碼。

當 LanLift 啟動時，兩端以 mDNS／Bonjour 在同一個區域網路公布短暫服務名稱與已簽名的工作階段資訊；Windows 端只會顯示已配對且目前可達的裝置。使用者將檔案拖至目標裝置後，系統以 TLS 1.3 或基於雙方裝置金鑰的加密傳輸，串流至 iPhone 原生 App。接收端可依使用者的規則自動接收小型檔案，或顯示一次接受通知。

該路徑將「每次掃碼」改成「首次信任」，將 Safari multipart 網頁上傳改成原生 socket／HTTP/2 或 QUIC 串流，並透過常駐／前景服務與本地通知改善互動延遲。iOS 對背景網路與廣播有系統限制，因此最穩定的產品規則應是：iPhone App 已開啟或近期使用時，可直接發現並傳輸；App 處於背景時以通知喚起確認，檔案連線則在 App 啟用後繼續。每筆傳輸保留「接受」選項能避免已信任裝置被他人取得後靜默外傳檔案。

## 交付前提

完整 iPhone 版需使用 Swift／SwiftUI、Apple Network.framework、Bonjour 服務宣告、Local Network 權限、Keychain 與系統分享擴充功能。安裝到實體 iPhone 進行常態測試與發布，還需要可簽名的 Apple Developer Program 帳號；原始碼可以先行開發，但無法在 Linux 環境產出可直接安裝的正式 iOS App。

## 參考資料

[1] [Xiaomi：HyperConnect on Apple devices](https://www.mi.com/global/discover/article?id=4829)

[2] [Xiaomi Interconnectivity Services — App Store](https://apps.apple.com/eg/app/xiaomi-interconnectivity/id6673908449)

[3] [Android：Quick Share with iPhone / AirDrop](https://www.android.com/quick-share/with-iphone/)

[4] [Android：Quick Share for Windows](https://www.android.com/quick-share/with-windows-pc/)

[5] [Apple Developer：`NSSharingService.sendViaAirDrop`](https://developer.apple.com/documentation/appkit/nssharingservice/name/sendviaairdrop)

[6] [Apple Developer：Requesting interoperability with iOS and iPadOS in the EU](https://developer.apple.com/support/ios-interoperability/)

---

作者：Manus AI  
日期：2026-08-18
