-- #348 個人統計「累積閱讀章數」改由伺服器計算。
--
-- 原本前端用 state.readingLogs 自己數，而那份資料是每頁 200 筆、沒有固定排序分頁抓回來的。
-- 小組長以上的角色經過 nlc-data 的 applyForcedScope 後，查詢變成
-- user_id = $1 AND user_id = ANY($2)，PostgREST 的 prepared statement 在不同連線上
-- 可能走 idx_reading_logs_user_id 或 idx_reading_logs_user_plan，兩者回傳順序不同，
-- 前後頁接不起來 → 同一個人每次重整看到的章數都不一樣、而且偏少（421 顯示成 374/375/418）。
-- 前端分頁已補 .order("id")；這支讓這個數字完全不依賴前端載入了幾筆。
--
-- 只數呼叫者自己在指定個人計畫（reading_plans.id）裡的紀錄，同一章同一遍只算一次，
-- 跟前端原本的去重規則（book_chapter_round）一樣。
-- p_actor_id 由 nlc-data 注入（READING_STATS_RPC_FUNCTIONS），前端傳的值會被蓋掉；
-- 只給 service_role，client 不能直接呼叫。

CREATE OR REPLACE FUNCTION public.get_my_plan_chapter_total(p_plan_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT COUNT(*)::integer
  FROM (
    SELECT DISTINCT log.book, log.chapter, log.round
    FROM public.reading_logs AS log
    WHERE p_actor_id IS NOT NULL
      AND log.user_id = p_actor_id
      AND log.plan_id = p_plan_id
  ) AS distinct_chapters;
$function$;

REVOKE ALL ON FUNCTION public.get_my_plan_chapter_total(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_plan_chapter_total(uuid, uuid) TO service_role;
