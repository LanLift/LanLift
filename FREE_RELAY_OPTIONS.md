# LanLift：免費遠端中繼服務評估

## 結論

免費服務可以用於 **LanLift 測試版或個人使用的起步方案**，但不適合把共用金鑰直接內建在公開的 Windows 安裝包中。任何被內建的 TURN API 金鑰都可被擷取與濫用，導致免費流量被耗盡。因此，免費方案應採用「**使用者建立自己的免費帳號，再把個人連線設定匯入 LanLift**」的方式；真正零設定的「預設遠端」則需要 LanLift 自己營運一個服務與頻寬預算。

GitHub 的正確角色是保存伺服器程式、Docker Compose 部署檔與版本更新；它本身不提供長駐 WebSocket 訊號服務、UDP/TCP TURN 中繼或持續檔案轉送。

## 可用方案比較

| 方案 | 免費額度／價格 | 提供的能力 | 適合 LanLift 的方式 | 主要限制 |
|---|---|---|---|---|
| **Metered Open Relay + Realtime Messaging** | TURN 每月 20 GB；訊號服務 100 個連線與 100,000 則訊息／月。 | STUN、TURN、WebSocket 訊號與短期連線憑證。 | **推薦作為「免費遠端設定」起步方案**。使用者自行註冊免費帳號並匯入金鑰。 | 不應把共用帳號／API key 寫進公開 App；20 GB 對大檔或多使用者很快耗盡。 |
| **Cloudflare Realtime TURN** | 與 Cloudflare Realtime SFU 一起使用才免費；單獨 TURN 為每 GB $0.05 出站流量。 | 全球 Anycast TURN、STUN、UDP/TCP/TLS。 | 適合未來 LanLift 自營預設中繼的可擴展選項。 | 不是獨立免費的預設遠端解法，且仍需自己做訊號與帳號控制。 |
| **自架 coturn + 小型訊號服務** | 軟體免費；伺服器與頻寬由使用者承擔。 | 完整 STUN/TURN，支援 UDP、TCP、TLS、DTLS 與短期憑證。 | **推薦作為「自訂伺服器」**，尤其是公司、NAS、固定 VPS 或隱私需求。 | 需要部署、網域、TLS、UDP/TCP 防火牆規則和監控。 |
| **Headscale 私有網路** | 軟體免費；需要自行運作控制服務，裝置還需私有網路客戶端。 | 建立私人 mesh 網路，讓 LanLift 使用私有 IP 直連。 | 適合技術團隊與多台自有設備。 | 對一般使用者操作成本較高，不適合作為預設遠端模式。 |

## 建議產品配置

| LanLift 選項 | 初始狀態 | 使用者操作 |
|---|---|---|
| **直接連線** | 預設啟用 | 不需設定；同一網路自動發現後直傳。 |
| **遠端連線（免費帳號）** | 可選啟用 | 按「連接免費中繼服務」後，使用者貼上自己建立的 Metered 設定；可隨時移除。 |
| **自訂伺服器** | 可選啟用 | 匯入 coturn + 訊號伺服器的 JSON 設定檔。 |
| **LanLift 預設遠端** | 暫不啟用 | 待營運者決定帳號、資料用量限制、頻寬成本、隱私條款與濫用防護後再推出。 |

## 為什麼 TURN 需要用量上限

遠端傳輸會先嘗試點對點直連。若兩端的 NAT 或企業防火牆無法建立直連，TURN 才會轉送資料。此時一份 1 GB 檔案通常使中繼服務承擔接收與轉送兩段流量，因此免費配額會比使用者感受到的檔案大小消耗得更快。WebRTC 官方說明也指出，直接 socket 在跨網路時經常不可行，而 TURN 是用於轉送流量的標準備援。[1]

## 實作安全要求

1. 使用者的服務金鑰以 Windows DPAPI 保護，不寫入傳輸紀錄或錯誤日誌。
2. 遠端工作階段使用短期、一次性配對代碼；不以永久 Room ID 公開接收端。
3. 中繼僅應轉送端到端加密資料，並限制單次檔案大小、工作階段時效與重試次數。
4. 共用的免費 API key 不得直接放進 Windows 安裝包。

## 參考資料

[1] [WebRTC：TURN server](https://webrtc.org/getting-started/turn-server)

[2] [Open Relay Project：免費 TURN、訊號與額度](https://www.metered.ca/tools/openrelay/)

[3] [Cloudflare Realtime TURN 服務與計費](https://developers.cloudflare.com/realtime/turn/)

[4] [coturn：開源 TURN/STUN Server](https://github.com/coturn/coturn)

[5] [Headscale：自架 Tailscale 控制伺服器](https://headscale.net/stable/)

---

作者：Manus AI  
日期：2026-08-18
