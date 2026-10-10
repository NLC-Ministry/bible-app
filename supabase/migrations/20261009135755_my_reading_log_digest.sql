-- #474 打卡紀錄按需載入：已關閉計畫的「已讀章節摘要」。
--
-- 開機原本把本人所有計畫、所有遍數的 reading_logs 逐筆抓回來（讀完一遍就是 1,189 筆）。
-- 改成只抓還能打卡的計畫的逐筆紀錄；已關閉的計畫只拿這份摘要，點進去才抓逐筆。
-- 摘要讓前端在沒有逐筆紀錄時，獎章、鐵獎、已結束清單、遍數確認、連續天數照樣算得出來：
--   chapters   ：每個計畫、每一遍、每卷書讀過哪些章（同一章只算一次）
--   read_dates ：這些紀錄的打卡日期（台北時間、去重），首頁連續天數跨計畫算要用
--
-- 只看呼叫者自己、而且只看 p_plan_ids 指定的計畫。
-- p_actor_id 由 nlc-data 注入（READING_STATS_RPC_FUNCTIONS），前端傳的值會被蓋掉；
-- 只給 service_role，client 不能直接呼叫。拿不到（dev 模式、nlc-data 還沒部署）時
-- 前端退回逐筆抓已關閉計畫的紀錄，所以這支跟前端誰先上線都可以。

CREATE OR REPLACE FUNCTION public.get_my_reading_log_digest(p_plan_ids uuid[], p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH scoped AS (
    SELECT log.plan_id, log.round, log.book, log.chapter, log.read_at
    FROM public.reading_logs AS log
    WHERE p_actor_id IS NOT NULL
      AND log.user_id = p_actor_id
      AND log.plan_id = ANY(COALESCE(p_plan_ids, ARRAY[]::uuid[]))
  ),
  chapter_rows AS (
    SELECT scoped.plan_id, scoped.round, scoped.book,
           array_agg(DISTINCT scoped.chapter ORDER BY scoped.chapter) AS chapters
    FROM scoped
    GROUP BY scoped.plan_id, scoped.round, scoped.book
  ),
  read_days AS (
    SELECT DISTINCT (scoped.read_at AT TIME ZONE 'Asia/Taipei')::date AS read_day
    FROM scoped
  )
  SELECT jsonb_build_object(
    'chapters', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'plan_id', chapter_rows.plan_id,
        'round', chapter_rows.round,
        'book', chapter_rows.book,
        'chapters', to_jsonb(chapter_rows.chapters)
      ))
      FROM chapter_rows
    ), '[]'::jsonb),
    'read_dates', COALESCE((
      SELECT jsonb_agg(read_days.read_day ORDER BY read_days.read_day)
      FROM read_days
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.get_my_reading_log_digest(uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_reading_log_digest(uuid[], uuid) TO service_role;
