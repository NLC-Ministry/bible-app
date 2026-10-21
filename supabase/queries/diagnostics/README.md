# 診斷查詢（只讀）

排查特定問題時寫的查詢，全部**只讀**，不會修改資料（`scripts/diagnostic-queries-read-only.test.mjs` 會檢查）。

- 在 SQL Editor 執行前，先確認左上角選的是哪個專案：正式環境或 staging（專案名稱看 Supabase Dashboard）。
- 用 CLI 執行時一律明確指定環境：
  ```bash
  npx supabase db query --linked --project-ref <ref> -f supabase/queries/diagnostics/<檔名>.sql
  ```
- 會修改資料的一次性 SQL 不要放進 repo；要改資料就寫成 migration。
