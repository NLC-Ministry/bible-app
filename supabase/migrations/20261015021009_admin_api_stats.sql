-- #568 後台「報表」區：讀經使用率（含每日趨勢）與報名註冊統計，數字都在伺服器彙總，不把原始打卡送進瀏覽器。
--
-- 1. admin_api_reading_usage(p_actor_id, p_from, p_to)：admin-api 的 reading_usage（只有數字、不記稽核）。
--    一次拿齊舊「讀經使用率」頁的三組數字——直接呼叫舊頁用的三支函式，定義一模一樣：
--      · admin_get_reading_activity（DAU／WAU／MAU 逐日，#452）
--      · admin_get_reading_activity_l7（本週 vs 上週讀幾天，#453）
--      · admin_get_reading_hour_heatmap（星期 × 小時，#454）
--    另外加每天的章數（每日趨勢）：條件和上面三支相同——有歸屬計畫（plan_id 不是 NULL）、不算個人計畫（#473）、
--    台灣時間的日期。有讀＝當天打卡任何一章，不限計畫書卷（和計畫總覽的「近 7 天有讀」不同，那個只算計畫書卷）。
--    區間最長 180 天（同舊頁）；不合法回 22023（admin-api 回 400）。
-- 2. admin_api_registration_stats(p_actor_id, p_global_plan_id)：admin-api 的 registration_stats／registration_export／
--    registration_sheet_sync。數字直接用舊頁的 get_admin_registration_statistics（定義不變），這裡只加：
--      · 依組織的 sort_order 排序（大區、牧區；名稱不在組織名單裡的排後面，「未設定」最後）——同 App 的排序，
--        唯一來源是資料庫的 sort_order（0133）。
--      · 每個牧區的牧區長姓名（試算表要用）：角色是 zone_leader 的啟用帳號，管理範圍＝managed_zones，
--        沒設就是自己的牧區（同 App 權限管理的 getProfileDefaultManagedScopes）。舊頁是瀏覽器把整份帶權限的名單
--        拉回來再對，現在在伺服器對。
--    找不到計畫回 NULL（admin-api 回 404）。匯出、同步試算表的稽核由 admin-api 記（admin_api_record_event），
--    記不成就不回檔案。
--
-- 兩支都先在 SQL 依操作者重查是不是系統管理員（admin_api_assert_admin，不是就 42501）；舊的三支與
-- get_admin_registration_statistics 也會再用 p_actor_id 檢查一次角色（service_role 才能帶 p_actor_id）。
-- 依賴：20261013114704_admin_api_plan_progress.sql（admin_api_assert_admin）、
--       20261010153702_personal_reading_plans.sql（三支使用率函式的現行版本）、
--       20260929093001_drop_profiles_is_demo.sql（get_admin_registration_statistics 的現行版本）。
-- 純新增：舊頁與會友 App 不受影響。

CREATE OR REPLACE FUNCTION public.admin_api_reading_usage(p_actor_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_reading_usage$
DECLARE
  v_activity jsonb;
  v_l7 jsonb;
  v_hours jsonb;
  v_days jsonb;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
  END IF;
  IF p_to - p_from > 179 THEN
    RAISE EXCEPTION 'range_too_long' USING ERRCODE = '22023';
  END IF;

  v_activity := public.admin_get_reading_activity(p_from, p_to, p_actor_id);
  v_l7 := public.admin_get_reading_activity_l7(p_to, p_actor_id);
  v_hours := public.admin_get_reading_hour_heatmap(p_from, p_to, p_actor_id);

  WITH chapters AS (
    SELECT (log.read_at AT TIME ZONE 'Asia/Taipei')::date AS day, count(*)::integer AS n
    FROM public.reading_logs AS log
    WHERE log.plan_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.reading_plans AS plan WHERE plan.id = log.plan_id AND plan.is_personal)
      AND log.read_at >= (p_from::timestamp AT TIME ZONE 'Asia/Taipei')
      AND log.read_at < ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Taipei')
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(day.value || jsonb_build_object('chapters', COALESCE(chapters.n, 0)) ORDER BY day.ord), '[]'::jsonb)
  INTO v_days
  FROM jsonb_array_elements(COALESCE(v_activity -> 'days', '[]'::jsonb)) WITH ORDINALITY AS day(value, ord)
  LEFT JOIN chapters ON chapters.day::text = day.value ->> 'date';

  RETURN jsonb_build_object(
    'from', p_from::text,
    'to', p_to::text,
    'today', ((now() AT TIME ZONE 'Asia/Taipei')::date)::text,
    'days', v_days,
    'l7', v_l7,
    'hours', v_hours
  );
END;
$admin_api_reading_usage$;

REVOKE ALL ON FUNCTION public.admin_api_reading_usage(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_reading_usage(uuid, date, date) TO service_role;


CREATE OR REPLACE FUNCTION public.admin_api_registration_stats(p_actor_id uuid, p_global_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_registration_stats$
DECLARE
  v_stats jsonb;
  v_regions jsonb;
  v_zones jsonb;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  IF p_global_plan_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.global_plans WHERE id = p_global_plan_id) THEN
    RETURN NULL;
  END IF;

  v_stats := public.get_admin_registration_statistics(p_global_plan_id, p_actor_id);

  SELECT COALESCE(jsonb_agg(row.value ORDER BY
      CASE WHEN row.value ->> 'label' IN ('未設定', '未設定牧區') THEN 1 ELSE 0 END,
      (SELECT min(region.sort_order) FROM public.great_regions AS region WHERE region.name = row.value ->> 'label') NULLS LAST,
      row.value ->> 'label'), '[]'::jsonb)
  INTO v_regions
  FROM jsonb_array_elements(COALESCE(v_stats -> 'greatRegions', '[]'::jsonb)) AS row(value);

  WITH leaders AS (
    SELECT btrim(scope.value) AS zone, string_agg(DISTINCT btrim(profile.name), '、' ORDER BY btrim(profile.name)) AS names
    FROM public.profiles AS profile
    JOIN public.role_definitions AS role ON role.id = profile.role_id AND role.code = 'zone_leader'
    CROSS JOIN LATERAL unnest(string_to_array(
      COALESCE(NULLIF(btrim(profile.managed_zones), ''), profile.pastoral_zone, ''), ','
    )) AS scope(value)
    WHERE profile.is_active IS NOT FALSE
      AND btrim(scope.value) <> ''
      AND NULLIF(btrim(profile.name), '') IS NOT NULL
    GROUP BY 1
  ), zone_order AS (
    SELECT zone.name, min(region.sort_order) AS region_sort, min(zone.sort_order) AS zone_sort
    FROM public.pastoral_zones AS zone
    LEFT JOIN public.great_regions AS region ON region.id = zone.great_region_id
    GROUP BY zone.name
  )
  SELECT COALESCE(jsonb_agg(
      row.value || jsonb_build_object('leaderName', COALESCE(leaders.names, ''))
      ORDER BY
        CASE WHEN row.value ->> 'label' IN ('未設定', '未設定牧區') THEN 1 ELSE 0 END,
        zone_order.region_sort NULLS LAST,
        zone_order.zone_sort NULLS LAST,
        row.value ->> 'label'), '[]'::jsonb)
  INTO v_zones
  FROM jsonb_array_elements(COALESCE(v_stats -> 'pastoralZones', '[]'::jsonb)) AS row(value)
  LEFT JOIN leaders ON leaders.zone = row.value ->> 'label'
  LEFT JOIN zone_order ON zone_order.name = row.value ->> 'label';

  RETURN jsonb_build_object(
    'planId', p_global_plan_id,
    'planName', v_stats ->> 'planName',
    'summary', COALESCE(v_stats -> 'summary', '{}'::jsonb),
    'greatRegions', v_regions,
    'pastoralZones', v_zones
  );
END;
$admin_api_registration_stats$;

REVOKE ALL ON FUNCTION public.admin_api_registration_stats(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_registration_stats(uuid, uuid) TO service_role;
