-- ============================================================================
-- 20260928113656_drop_leftover_reading_plans_level.sql
--
-- 0138 本來就要刪掉 reading_plans.level，但正式環境的這個欄位還在（當時沒刪成功），
-- 2026-09-28 重建 staging 時比對兩邊結構才發現。前端、Edge Function、SQL 函式
-- 都已經不讀也不寫這個欄位，直接刪掉。IF EXISTS：從 migration 重跑建出來的環境
-- 本來就沒有這個欄位。
-- ============================================================================

ALTER TABLE public.reading_plans DROP COLUMN IF EXISTS level;
