-- ============================================================================
-- 0214_revoke_anon_function_execute.sql  —  安全性 hotfix，請盡快部署
-- ----------------------------------------------------------------------------
-- 問題：正式環境有 24 個 public 函式可以被 anon（未登入、只拿前端公開的
-- anon key）直接呼叫。其中 schedule_announcement（0195 新增的 7 參數版本）
-- 完全沒有呼叫者檢查，任何人都能對全體會友發布公告、冒用任何人當發布者。
-- 0187 修過同一個漏洞，但只修了 5 參數的舊版本；0195 新增的版本又拿到
-- anon 的執行權，漏洞回來了。
--
-- 根因：這個資料庫的 default privileges 是
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
-- 所以每個新建的函式都會**直接**授權給 anon、authenticated。migration 裡的
-- `REVOKE ALL ... FROM PUBLIC` 只收回 PUBLIC，收不回這個直接授權（查詢結果：
-- 這 24 個函式的 PUBLIC 執行權都是 false，anon 的權限全部來自直接授權）。
-- 每新增一支函式，漏洞就可能再出現一次。
--
-- 修法：
--   1. 7 個內部用、沒有呼叫者檢查的函式：只留 service_role。
--   2. 17 個有呼叫者檢查（resolve_quiz_actor）或被 authenticated 的 RLS 規則
--      用到的函式：收回 anon，保留 authenticated（本機開發模式用真的
--      Supabase client 以 authenticated 呼叫）和 service_role（nlc-data）。
--   3. 修根因：之後新建的函式預設不再授權給 PUBLIC、anon、authenticated，
--      service_role 維持不變。需要開放的函式要在 migration 裡明確 GRANT。
--   4. 最後檢查：public 裡還有任何函式能被 anon 執行，就整支 rollback。
--
-- 正式環境的 nlc-data 以 service_role 呼叫，這支 migration 不影響它。
-- 部署：Supabase SQL editor 執行。冪等。先在 staging 驗證。
-- ============================================================================

-- ── 1. 內部函式：只留 service_role ──────────────────────────────────────────
-- 沒有任何呼叫者檢查，只由其他 SECURITY DEFINER 函式（以 postgres 身分）或
-- Edge Function（service_role）呼叫。
REVOKE ALL ON FUNCTION public.schedule_announcement(text, text, timestamp with time zone, uuid, timestamp with time zone, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_announcement(text, text, timestamp with time zone, uuid, timestamp with time zone, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.run_daily_quiz_schedule_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_daily_quiz_schedule_sweep() TO service_role;

REVOKE ALL ON FUNCTION public._lightning_quiz_actor_is_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_actor_is_admin(uuid) TO service_role;

REVOKE ALL ON FUNCTION public._lightning_quiz_answer_is_correct(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_answer_is_correct(text, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public._lightning_quiz_is_locked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_is_locked(uuid) TO service_role;

REVOKE ALL ON FUNCTION public._lightning_quiz_window_ended(date, time without time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_window_ended(date, time without time zone) TO service_role;

REVOKE ALL ON FUNCTION public._lightning_quiz_window_started(date, time without time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_window_started(date, time without time zone) TO service_role;

-- ── 2. 有呼叫者檢查、或被 authenticated 的 RLS 規則用到：只收回 anon ────────
-- profile_matches_announcement_scope 被 church_announcements 的
-- announcements_read_published（TO authenticated）規則呼叫，一定要保留
-- authenticated。其餘都先經過 resolve_quiz_actor（未登入 → profile_required；
-- 非 service_role 指定 p_actor_id → actor_override_forbidden）。
REVOKE ALL ON FUNCTION public.profile_matches_announcement_scope(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_matches_announcement_scope(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_clear_lightning_quiz_attempts(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_lightning_quiz_attempts(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_lightning_quiz_question(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_lightning_quiz_question(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_leaderboard(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_leaderboard(uuid, integer, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_results(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_results(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_trend(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_trend(date, date, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_list_lightning_quiz_questions(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_lightning_quiz_questions(date, date, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_set_lightning_quiz_status(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_lightning_quiz_status(uuid, text, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time without time zone, time without time zone, text, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_lightning_quiz_question(uuid, date, time without time zone, time without time zone, text, jsonb, jsonb, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_daily_quiz_schedule(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_daily_quiz_schedule(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.exam_save_pre_announcement(uuid, jsonb, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_save_pre_announcement(uuid, jsonb, boolean, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_my_lightning_quiz_history(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_lightning_quiz_history(date, date, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_todays_lightning_quiz(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_todays_lightning_quiz(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid, timestamp with time zone) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.schedule_daily_quiz_publish(uuid, date, text, text, text, jsonb, timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_daily_quiz_publish(uuid, date, text, text, text, jsonb, timestamp with time zone, timestamp with time zone, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_lightning_quiz_attempt(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_lightning_quiz_attempt(uuid, jsonb, uuid) TO authenticated, service_role;

-- ── 3. 修根因：之後新建的函式預設不開放給 PUBLIC／anon／authenticated ───────
-- schema 層級：收回 Supabase 預設直接給 anon、authenticated 的授權。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
-- 全域：Postgres 內建「新函式預設給 PUBLIC EXECUTE」只能在全域層級收回
-- （schema 層級的 ALTER DEFAULT PRIVILEGES 只能增加、不能減少全域預設）。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- service_role 的預設授權維持不變（nlc-data 需要）。

-- ── 4. 檢查：public 裡不能再有任何 anon 能執行的函式 ─────────────────────────
DO $verify_no_anon_function_execute$
DECLARE
  offenders TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.proname)
  INTO offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'anon can still execute public functions: %', offenders;
  END IF;
END;
$verify_no_anon_function_execute$;
