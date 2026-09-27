-- ============================================================================
-- 20260927143318_drop_lightning_quiz_leaderboard.sql  —  #316
--
-- 快問快答「查看排行榜」拿掉了：作答明細（admin_get_lightning_quiz_results）
-- 本來就依「答對 → 用時由快到慢」排序，現在加上名次欄，排行榜的前 10 名就是
-- 作答明細最上面的 10 個人。只有後台用過這支函式；舊版後台按到「查看排行榜」
-- 會失敗，重新整理就是新版。
-- ============================================================================

DROP FUNCTION IF EXISTS public.admin_get_lightning_quiz_leaderboard(uuid, integer, uuid);

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'admin_get_lightning_quiz_leaderboard') THEN
    RAISE EXCEPTION 'admin_get_lightning_quiz_leaderboard still exists';
  END IF;
END $verify$;
