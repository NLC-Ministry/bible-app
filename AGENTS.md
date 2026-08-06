# AGENTS.md

Codex agents should use the shared repository instructions in [`CLAUDE.md`](CLAUDE.md) and [`.agents/skills/bible-study-dev-guidelines/SKILL.md`](.agents/skills/bible-study-dev-guidelines/SKILL.md).

## 🗄️ 核心規範：Database Migration Schema 全局對齊 (Database Migration Integrity Rule)

- **修改 Edge Function / RPC 前必須完整檢視 Migration 歷史**：
  - 在修改 `supabase/functions/` (如 `nlc-data`) 或撰寫 Supabase 查詢時，**絕對禁止憑空猜測或使用已廢棄的舊資料架構欄位**（例如 `profiles.role` 欄位已在 Migration `0048` 被 `DROP COLUMN` 刪除，全站統一改用 `role_id` 關聯 `role_definitions`）。
  - **開工前第一步**：修改 Edge Function 或 DB 查詢前，必須先掃描 `supabase/migrations/` 中最新的 SQL Schema 檔案（如 `0048`, `0054`），確認請求的所有欄位在資料庫中均為真實存在的實體欄位。
- **防止無效 PostgREST 查詢與 Edge Function 500 崩潰**：
  - 嚴禁請求已被刪除的舊欄位或非實體 Column（如 `role_code` 為 SQL 函數，非 `profiles` 表實體欄位）。
  - 所有 Edge Function 內部對 Supabase 的查詢必須配置強固的 Try-Catch / Fallback 容錯備援，確保縱使外鍵關聯遇到異常，亦能降級處理，絕不讓 Edge Function 拋出未捕獲例外導致 HTTP 500 伺服器崩潰。