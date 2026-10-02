-- #394 計畫統計／組員總覽的打卡紀錄改成一次回傳的精簡格式。
--
-- 原本前端用 fetchReadingLogsByPlanIds 每 40 個計畫一批、每頁 200 筆依序抓 reading_logs，
-- 正式站 9 月出埃及記（912 人、49,363 筆）要 285 個 nlc-data 請求、約 15 秒。
-- 這支只把同一批資料「瘦身」後一次回傳；章數、連續天數、補讀天數的規則仍然只在前端 JS。
--
-- 回傳 [{ u: user_id, p: plan_id, l: [[book, chapter, round, read_at], …] }, …]：
-- - 不帶 log id，也不在每一列重複 uuid。
-- - 不去重、不換算時區：每組照 id 排序（跟舊分頁查詢的 .order("id") 一樣）、read_at 原樣，
--   前端還原後跟舊路徑逐筆相同。補讀天數的 logMap 是後面覆蓋前面、章數取最早的一筆，
--   伺服器先去重會改變結果。
--
-- p_actor_id、p_visible_ids 由 nlc-data 注入，前端傳的值會被蓋掉：
-- p_visible_ids 用 getVisibleProfileIds 的結果（跟 reading_logs／profiles 讀取同一個來源），
-- 全教會範圍時是 NULL。只給 service_role，client 不能直接呼叫。

CREATE OR REPLACE FUNCTION public.get_plan_reading_log_digest(
  p_plan_ids uuid[],
  p_visible_ids uuid[] DEFAULT NULL::uuid[],
  p_actor_id uuid DEFAULT NULL::uuid
)
 RETURNS json
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(
    json_agg(json_build_object('u', grouped.user_id, 'p', grouped.plan_id, 'l', grouped.logs)
             ORDER BY grouped.user_id, grouped.plan_id),
    '[]'::json
  )
  FROM (
    SELECT
      log.user_id,
      log.plan_id,
      json_agg(json_build_array(log.book, log.chapter, log.round, log.read_at) ORDER BY log.id) AS logs
    FROM public.reading_logs AS log
    WHERE p_actor_id IS NOT NULL
      AND log.plan_id = ANY (p_plan_ids)
      AND (p_visible_ids IS NULL OR log.user_id = ANY (p_visible_ids))
    GROUP BY log.user_id, log.plan_id
  ) AS grouped;
$function$;

REVOKE ALL ON FUNCTION public.get_plan_reading_log_digest(uuid[], uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plan_reading_log_digest(uuid[], uuid[], uuid) TO service_role;
