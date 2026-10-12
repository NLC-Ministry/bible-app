# Supabase / PWA 資料一致性除錯

本專案以 Supabase 為伺服器真相來源。IndexedDB 的 `server_cache` 只保存依使用者 ID 隔離的讀取快照；`offline_operations` 只保存尚未送出的讀經操作。Service Worker 絕不處理 Supabase、REST、Auth、Functions、Storage 或 Realtime 請求。

## 先看回報附的診斷資訊（#548）

會友從 App 送出的回報會自動附 `metadata.diagnostics`，通常不必再到對方裝置開 F12：

1. 管理端打開那筆回報的對話，展開原始回報下方的「診斷資訊」。看得到版本（build id）、是否以主畫面 App 開啟、線上／離線、頁面、作用中的計畫、`readingDataSource`／`readingDataStale`／`repositoryError`、離線佇列的待送／失敗筆數與最後錯誤、最近 5 個 `nlc-data` 請求、最近 10 筆前端錯誤（window error、unhandledrejection、console.error）。
2. 最近請求的每一列都有 `request_id`。到 Supabase Dashboard → Edge Functions → `nlc-data` → Logs 搜這個 id，會找到一行 `{"event":"nlc_data_request","request_id":…,"action":…,"target":…,"status":…,"ms":…}`；同一個 id 也寫在稽核紀錄（`audit.admin_events.request_id`）與回應標頭 `x-request-id`。
3. 收集端在 `js/diagnostics/report-diagnostics.mjs`：不收 token、cookie、localStorage；錯誤訊息先遮掉 `Bearer …`、`eyJ…`、網址裡的 token／code 與 email；整包壓在 8 KB 內（超過先丟最舊的錯誤）。`nlc-data` 新增回報時 metadata 只留 `diagnostics`（16 KB 以內）。較早送出的回報沒有這份資料。

## F12 三步檢查

### 1. Network：確認寫入真的成功

1. 開啟 DevTools → Network，勾選 Preserve log，篩選 `reading_logs` 或 `nlc-data`。
2. 勾選一章，確認出現 `POST`（upsert/insert）或 NLC Edge Function 請求，HTTP 應為 2xx。
3. 查看 Response：RLS 常見為 `401/403` 或 PostgreSQL `42501`；欄位與唯一鍵錯誤常見為 `400`、`23502`、`23503`、`23505`。若完全沒有請求，檢查 Console 的 `[Repository:reading_logs]` 訊息。
4. 點開 Request Payload，確認 `user_id`、`plan_id`、`book`、`chapter`、`round` 正確。Network 的 Size 不應顯示 `(ServiceWorker)` 或 `(disk cache)`。

### 2. Application：確認 Service Worker 沒有快取 API

1. Application → Service Workers，確認目前腳本為 `sw.js`，並勾選一次 Update on reload 後重新整理。
2. Application → Cache Storage，只應看到 `newlife-bible-static-*`、`newlife-bible-runtime-*` 的靜態資產或公開聖經 API；不應看到任何 `supabase.co`、`/rest/v1/`、`/functions/v1/`、`reading_logs`。
3. 若曾有舊錯誤快取，按 Unregister，清除 Cache Storage 後重新整理一次。新版 Service Worker 會自動清除同前綴舊版本。

### 3. IndexedDB：比對快照、待同步操作與 Supabase

1. Application → IndexedDB → `newlife-bible`。
2. `server_cache` 的 key 應為 `reading_logs:<目前 profile UUID>:open`（開機範圍：還能打卡的計畫＋無歸屬紀錄）；點進已結束計畫後會多一份 `reading_logs:<目前 profile UUID>:plan:<計畫 UUID>`（#474）。檢查 `updatedAt` 與 `data`。登入另一帳號時 key 必須不同。
   - 已結束計畫開機只拿摘要（RPC `get_my_reading_log_digest`），所以 Network 開機只會看到還能打卡的計畫的 `reading_logs` 查詢；Console 的 `state.readingLogScope`／`state.readingLogDigest` 是目前載入範圍與摘要。`readingLogScope.mode === "all"` 代表摘要拿不到、退回整包抓。
3. `offline_operations` 在線上正常寫入後應為空；若有 `pending`，查看 `lastError`、`attempts`、`nextAttemptAt`。`failed` 且錯誤為 401/403 代表權限問題，不應自動重試。
4. 到 Supabase Table Editor 以相同 `user_id + plan_id + book + chapter + round` 查詢。Supabase 是最終真相；若資料不同，重新載入後 `server_cache` 應被 Supabase 結果完整覆蓋。

## Console 診斷欄位

可在 Console 執行：

```js
document.documentElement.dataset.readingDataSource
// "indexeddb"：目前先顯示本機快照；"supabase"：已由伺服器刷新

document.documentElement.dataset.readingDataStale
// "true" 代表仍是舊快照

document.documentElement.dataset.repositoryError
// network / permission / validation / server
```