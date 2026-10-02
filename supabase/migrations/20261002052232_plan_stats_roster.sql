-- #397 計畫統計名單改用單一 RPC：profiles＋報名＋打卡＋今天的靈修一次回傳。
--
-- 原本前端用 fetchAllRows 依序分頁抓 profiles（每頁 200 筆）、reading_plans，
-- 再呼叫 #394 的 get_plan_reading_log_digest、最後抓 devotional_notes，
-- 正式站 9 月出埃及記（管理員）要 18 個 nlc-data 請求、5–9 秒。
-- 這支只把同一批資料「篩選＋瘦身」後一次回傳；章數、進度、遍數、連續天數、補讀
-- 的規則仍然只在前端 JS（同 #394 方案 D）。
--
-- 回傳 { profiles, plans, logs, notes }：
-- - profiles：[{ id, name, great_region, pastoral_zone, small_group, role_id,
--   role_definition: { id, code, label } | null }]，照 id 排序（跟舊的分頁查詢一樣）。
-- - plans：[{ id, user_id, name, preset_key, global_plan_id, target_books, current_round,
--   upgrade_prompt_handled }]，照 id 排序（前端取「第一筆符合的報名」，順序要一樣）。
--   有計畫篩選（p_plan_aliases 不是 NULL）時，比對規則跟前端 buildPlansQuery 的 or 條件
--   相同：preset_key／name 比對文字別名；global_plan_id／id 比對看起來像 uuid 的別名。
--   有 p_pastoral_zone 時只留那個牧區的人的報名。
-- - logs：跟 get_plan_reading_log_digest 相同的精簡格式
--   [{ u, p, l: [[book, chapter, round, read_at], …] }]，不去重、不換時區、組內照 id 排。
-- - notes：p_note_date 當天的靈修筆記 [[user_id, content], …]，照 id 排（前端後面覆蓋前面）。
--   日期由前端用台北時區算好傳入，這裡不換算。
--
-- 權限：p_whole_church、p_visible_ids、p_actor_id 一律由 nlc-data 注入（前端傳的值會被蓋掉），
-- 來源是 getVisibleProfileIds（跟 profiles／reading_plans／reading_logs 的 select 同一個）。
-- p_whole_church 不是 true 而且 p_visible_ids 是 NULL 或空陣列時什麼都不回（fail closed），
-- 不把 NULL 當成「全部」。全教會範圍包含停用的人、管理角色不包含：照現狀保留。
-- 只給 service_role，client 不能直接呼叫。
--
-- 同一個 migration 也把 #394 的 get_plan_reading_log_digest 改成同樣的明確旗標。
-- 新參數 p_whole_church 沒有預設值：還沒重新部署的 nlc-data 只帶三個參數，會找不到函式
-- 而回錯誤，前端就退回分頁查詢，不會在部署空窗期拿到空的打卡紀錄。所以 migration 和
-- nlc-data 的部署順序不拘。

CREATE OR REPLACE FUNCTION public.get_plan_stats_roster(
  p_plan_aliases text[],
  p_pastoral_zone text,
  p_note_date date,
  p_whole_church boolean,
  p_visible_ids uuid[],
  p_actor_id uuid
)
 RETURNS json
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH scope AS (
    SELECT (
      p_actor_id IS NOT NULL
      AND (p_whole_church IS TRUE OR COALESCE(cardinality(p_visible_ids), 0) > 0)
    ) AS allowed
  ),
  uuid_aliases AS (
    SELECT alias::uuid AS id
    FROM unnest(COALESCE(p_plan_aliases, '{}'::text[])) AS alias
    WHERE alias ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  ),
  roster AS (
    SELECT
      prof.id,
      prof.name,
      prof.great_region,
      prof.pastoral_zone,
      prof.small_group,
      prof.role_id,
      role_def.id AS role_definition_id,
      role_def.code AS role_definition_code,
      role_def.label AS role_definition_label
    FROM public.profiles AS prof
    LEFT JOIN public.role_definitions AS role_def ON role_def.id = prof.role_id
    WHERE (SELECT allowed FROM scope)
      AND (p_whole_church IS TRUE OR prof.id = ANY (p_visible_ids))
      AND (NULLIF(p_pastoral_zone, '') IS NULL OR prof.pastoral_zone = p_pastoral_zone)
  ),
  plans AS (
    SELECT
      plan.id,
      plan.user_id,
      plan.name,
      plan.preset_key,
      plan.global_plan_id,
      plan.target_books,
      plan.current_round,
      plan.upgrade_prompt_handled
    FROM public.reading_plans AS plan
    WHERE (SELECT allowed FROM scope)
      AND (p_whole_church IS TRUE OR plan.user_id = ANY (p_visible_ids))
      AND (NULLIF(p_pastoral_zone, '') IS NULL OR plan.user_id IN (SELECT roster.id FROM roster))
      AND (
        p_plan_aliases IS NULL
        OR plan.preset_key = ANY (p_plan_aliases)
        OR plan.name = ANY (p_plan_aliases)
        OR plan.global_plan_id IN (SELECT uuid_aliases.id FROM uuid_aliases)
        OR plan.id IN (SELECT uuid_aliases.id FROM uuid_aliases)
      )
  ),
  log_groups AS (
    SELECT
      log.user_id,
      log.plan_id,
      json_agg(json_build_array(log.book, log.chapter, log.round, log.read_at) ORDER BY log.id) AS logs
    FROM public.reading_logs AS log
    WHERE (SELECT allowed FROM scope)
      AND log.plan_id IN (SELECT plans.id FROM plans)
      AND (p_whole_church IS TRUE OR log.user_id = ANY (p_visible_ids))
    GROUP BY log.user_id, log.plan_id
  ),
  notes AS (
    SELECT note.id, note.user_id, note.content
    FROM public.devotional_notes AS note
    WHERE (SELECT allowed FROM scope)
      AND p_note_date IS NOT NULL
      AND note.note_date = p_note_date
      AND note.user_id IN (SELECT roster.id FROM roster)
  )
  SELECT json_build_object(
    'profiles', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', roster.id,
        'name', roster.name,
        'great_region', roster.great_region,
        'pastoral_zone', roster.pastoral_zone,
        'small_group', roster.small_group,
        'role_id', roster.role_id,
        'role_definition', CASE WHEN roster.role_definition_id IS NULL THEN NULL ELSE json_build_object(
          'id', roster.role_definition_id,
          'code', roster.role_definition_code,
          'label', roster.role_definition_label
        ) END
      ) ORDER BY roster.id), '[]'::json)
      FROM roster
    ),
    'plans', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', plans.id,
        'user_id', plans.user_id,
        'name', plans.name,
        'preset_key', plans.preset_key,
        'global_plan_id', plans.global_plan_id,
        'target_books', plans.target_books,
        'current_round', plans.current_round,
        'upgrade_prompt_handled', plans.upgrade_prompt_handled
      ) ORDER BY plans.id), '[]'::json)
      FROM plans
    ),
    'logs', (
      SELECT COALESCE(
        json_agg(json_build_object('u', log_groups.user_id, 'p', log_groups.plan_id, 'l', log_groups.logs)
                 ORDER BY log_groups.user_id, log_groups.plan_id),
        '[]'::json
      )
      FROM log_groups
    ),
    'notes', (
      SELECT COALESCE(json_agg(json_build_array(notes.user_id, notes.content) ORDER BY notes.id), '[]'::json)
      FROM notes
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.get_plan_stats_roster(text[], text, date, boolean, uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plan_stats_roster(text[], text, date, boolean, uuid[], uuid) TO service_role;

-- #394 的打卡精簡 RPC 改成明確的全教會旗標：原本 p_visible_ids 是 NULL 就回全部。
-- 舊的三個參數版本整個拿掉（不留多載，避免 PostgREST 選錯或 NULL＝全部的舊語意還在）。
DROP FUNCTION IF EXISTS public.get_plan_reading_log_digest(uuid[], uuid[], uuid);

CREATE OR REPLACE FUNCTION public.get_plan_reading_log_digest(
  p_plan_ids uuid[],
  p_whole_church boolean,
  p_visible_ids uuid[],
  p_actor_id uuid
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
      AND (p_whole_church IS TRUE OR COALESCE(cardinality(p_visible_ids), 0) > 0)
      AND log.plan_id = ANY (p_plan_ids)
      AND (p_whole_church IS TRUE OR log.user_id = ANY (p_visible_ids))
    GROUP BY log.user_id, log.plan_id
  ) AS grouped;
$function$;

REVOKE ALL ON FUNCTION public.get_plan_reading_log_digest(uuid[], boolean, uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plan_reading_log_digest(uuid[], boolean, uuid[], uuid) TO service_role;
