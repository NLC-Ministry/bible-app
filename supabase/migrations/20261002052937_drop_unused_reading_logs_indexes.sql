-- #400 reading_logs 索引整理：移除 3 個幾乎沒用到或開頭欄位重複的單欄索引。
--
-- 依據（正式站 ztozevcqkfrohgjmngcj，2026-10-02 只讀查詢；pg_stat_database.stats_reset =
-- 2026-05-22，涵蓋 6/1、7/1、8/1、9/1、10/1 五次月初換計畫）：
--   reading_logs 123,781 筆，每次打卡都要更新全部 9 個索引。
--   idx_reading_logs_read_at   (read_at DESC)  5.0 MB  idx_scan = 8
--     → 程式（js/、supabase/functions/、資料庫函式）沒有任何「只用 read_at 排序／篩選」的查詢；
--       read_at 一律搭配 plan_id 使用，由 idx_reading_logs_plan_round_read_at 處理。
--   idx_reading_logs_plan_id   (plan_id)       1.3 MB  idx_scan = 21,135,426
--     → 開頭欄位與 idx_reading_logs_plan_round_read_at (plan_id, round, read_at DESC) 相同。
--   idx_reading_logs_user_id   (user_id)       1.3 MB  idx_scan = 32,438
--     → 開頭欄位與 idx_reading_logs_user_plan (user_id, plan_id)、reading_logs_unique、
--       idx_reading_logs_composite 相同。
--   外鍵 plan_id → reading_plans、user_id → profiles 的 ON DELETE CASCADE 查找仍有上述複合索引可用。
--
-- staging（25,980 筆，約正式站 1/5）以 BEGIN…DROP…EXPLAIN (ANALYZE, BUFFERS)…回滾 模擬，
-- 每支查詢跑 5 次取中位數，移除前 → 後：
--   計畫統計 digest（193 個計畫）        47.7 → 19.6 ms（改走 user_plan）
--   get_plan_reading_log_digest RPC      31.5 → 24.3 ms
--   個人打卡讀取（user_id，order by id） 0.93 → 0.65 ms；不排序版 0.08 → 0.08 ms
--   排行 get_personal_plan_ranking_summary 9.9 → 6.5 ms（buffer 912 → 1,863，改走較大的複合索引）
--   get_pastoral_zone_leaderboard         6.1 → 3.6 ms
--   get_my_plan_chapter_total             0.62 → 0.47 ms（本來就走 reading_logs_unique）
--   舊版分頁 plan_id = ANY(40 個) order by id  5.2 → 2.3 ms
-- 皆在誤差內或更快，沒有退化成循序掃描。
-- （正式站沒有 get_user_rankings 這支函式；排行實際是上面兩支。）
--
-- DROP INDEX 會短暫取得 ACCESS EXCLUSIVE 鎖（表小，毫秒級），正式站請避開晚上讀經尖峰套用。
--
-- 復原（原始定義：0001_clean_schema.sql、0004_performance_indexes.sql 以 IF NOT EXISTS 補建同名）：
--   CREATE INDEX IF NOT EXISTS idx_reading_logs_user_id ON public.reading_logs(user_id);
--   CREATE INDEX IF NOT EXISTS idx_reading_logs_plan_id ON public.reading_logs(plan_id);
--   CREATE INDEX IF NOT EXISTS idx_reading_logs_read_at ON public.reading_logs(read_at DESC);

DROP INDEX IF EXISTS public.idx_reading_logs_read_at;
DROP INDEX IF EXISTS public.idx_reading_logs_plan_id;
DROP INDEX IF EXISTS public.idx_reading_logs_user_id;
