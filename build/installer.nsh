; LanLift assisted installer extension.
; The stable appId keeps the same NSIS GUID across versions, so electron-builder
; identifies a previous LanLift installation as an update before files are replaced.

!macro customInit
  ${if} ${isUpdated}
    MessageBox MB_OK|MB_ICONINFORMATION "偵測到已安裝的 LanLift。$\r$\n$\r$\n此安裝會以新版取代舊版，系統只會保留一個 LanLift 版本。你的接收資料夾、伺服器紀錄與已儲存設定會保留。"
  ${endIf}
!macroend
