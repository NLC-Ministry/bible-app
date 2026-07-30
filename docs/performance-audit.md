# 效能診斷與上線驗證

## 本次找到的主要瓶頸

1. 首頁完成後約 250–1500ms 就下載並解析約 679KB 的 React 問題回報介面。
2. `nlc-data` 每次查詢權限範圍時，會先下載全部 `profiles` 再由 Edge Runtime 篩選。
3. 一般 API 回應重複附帶完整 profile 與教會系統同步欄位。
4. 啟動、計畫、公告、統計與身分同步仍有多個 `select(*)`。
5. 管理回報沒有上限；查詢協定也不支援分頁。
6. 組員搜尋每輸入一個字就重跑完整排名資料流程。
7. 5xx 最長退避 7 秒，而且寫入操作也可能被重送。

## 瀏覽器量測

登入後在開發者工具 Console 執行：

```js
console.table(window.__nlcNetworkMetrics.summary())
```

輸出只包含請求類別、狀態碼、TTFB、總耗時與 Payload bytes。它只存在目前分頁記憶體，不包含 URL、Token、Request Body、Email 或其他個資。

建議效能預算：

- 一般 Edge 讀取 P75 TTFB：同區小於 400ms，跨區小於 800ms。
- 一般清單 Payload：小於 100KB。
- 管理清單：每頁最多 200 筆；目前問題回報先載入 100 筆。
- 5xx 讀取重試總等待：最多 1.6 秒；寫入不自動重送。

## PostgreSQL 驗證

先套用 `0051_performance_indexes.sql`，再用實際計畫 UUID 執行：

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT user_id, global_plan_id
FROM public.reading_plans
WHERE global_plan_id = '00000000-0000-0000-0000-000000000000'::uuid;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT user_id, round, read_at
FROM public.reading_logs
WHERE plan_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND round = 1
ORDER BY read_at DESC;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id
FROM public.profiles
WHERE is_demo = false
  AND is_active = true
  AND great_region = '請替換為大區名稱';
```

計畫應出現對應的 `idx_reading_plans_global_user`、`idx_reading_logs_plan_round_read_at`、`idx_profiles_active_great_region`，避免大型 `Seq Scan`。

若已啟用 `pg_stat_statements`，可找出最慢且最常執行的查詢：

```sql
SELECT
  calls,
  round(total_exec_time::numeric, 2) AS total_ms,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  rows,
  left(query, 240) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

## RLS 與部署區域

正式 NLC 登入走 `nlc-data` 與 service role，因此正式流量的主要權限成本在 Edge Function 的強制範圍查詢，不是 PostgreSQL RLS；本機 Supabase Auth 才會走 RLS。這次已把 Edge 的全表 profile 掃描改為索引化條件查詢。

此專案在 Vercel 是靜態網站，沒有 Vercel Serverless/Edge Function，所以沒有可設定的 Vercel Function Region。實際延遲路徑是：

```text
使用者瀏覽器 → Supabase Edge Function → Supabase PostgreSQL
```

上線前請從 Supabase Dashboard 提供資料庫 Region，以及從台灣實際量到的 `Server-Timing` 與上述瀏覽器摘要，才能判斷是否需要搬遷專案或調整 Edge Function 的執行區域。

