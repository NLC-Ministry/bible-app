-- ============================================================================
-- 20260929041515_lightning_quiz_weekdays_check_rebuild.sql  —  #333
--
-- 環境一致性檢查（compare-env-snapshots.mjs）一直列出
-- lightning_quiz_settings_weekdays_check 在正式環境和 staging「內容不同」：
--   prod：   CHECK ((((cardinality(weekdays) >= 1) AND (cardinality(weekdays) <= 7)) AND (weekdays <@ ...)))
--   staging：CHECK (((cardinality(weekdays) >= 1) AND (cardinality(weekdays) <= 7) AND (weekdays <@ ...)))
-- 條件完全一樣，只差 AND 有沒有被攤平：正式環境照 20260927123111 原文（用
-- BETWEEN）建立，Postgres 存成巢狀 AND；staging 在 2026-09-28 是用正式環境
-- 匯出的結構重建（docs/staging.md），重新解析時 AND 被攤平。
--
-- 做法：兩邊都用 20260927123111 同一段原文刪掉再重建，存下來的格式就一樣。
-- 規則本身不變；lightning_quiz_settings 只有一列，重建時的驗證瞬間完成。
-- ============================================================================

ALTER TABLE public.lightning_quiz_settings
  DROP CONSTRAINT IF EXISTS lightning_quiz_settings_weekdays_check,
  ADD CONSTRAINT lightning_quiz_settings_weekdays_check
    CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]);
