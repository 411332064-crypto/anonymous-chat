# CLAUDE.md

不用登入的匿名網頁聊天室：前端放在 GitHub Pages，即時傳訊用 Supabase Realtime（Broadcast + Presence），不保留任何聊天紀錄。

## 開始任何工作前
先讀 `docs/architecture.md`。所有技術選擇、通訊約定、畫面行為和驗證清單都寫在裡面，跟它衝突時以它為準；要改變做法的話，先更新這份文件。需求來源是 `docs/requirements.md`。

## 目前進度
**階段一**：只做前端，使用模擬傳訊層（`js/transport/mock.js`），還不要接 Supabase。完成的標準是 `docs/architecture.md` 第 13.1 節的驗證清單。

## 金鑰規則
- 不可以把金鑰檔案或任何祕密 commit 進 git（`.env`、`.env.*`、`*.local`、`secrets/` 已列在 `.gitignore`）。
- Supabase 的 Secret key（service_role）和資料庫密碼絕對不能出現在 repo 的任何檔案裡。這個專案用不到它們。
- 只有 Project URL 和 Publishable key 可以放進 `js/config.js`，而且要到階段二才放。
