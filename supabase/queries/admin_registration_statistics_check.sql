-- 報名與註冊統計核對
-- 用法：
-- 1. 若要核對特定計畫，將下方 NULL::UUID 改成：
--    '計畫的 UUID'::UUID
-- 2. 若維持 NULL::UUID，會優先選擇目前進行中的非隱藏計畫；
--    若目前沒有進行中的計畫，則選擇開始日期最新的非隱藏計畫。
--
-- 定義：
-- - 註冊人數：profiles 中 is_active = TRUE 且 is_demo = FALSE 的帳號
-- - 報名人數：上述帳號中，在 reading_plans 加入所選 global_plan_id 的不重複人數
-- - 未填 pastoral_zone 的帳號會列在「未設定牧區」

WITH params AS (
  SELECT NULL::UUID AS global_plan_id
),
selected_plan AS (
  SELECT
    plan.id,
    plan.name,
    plan.start_date,
    plan.end_date
  FROM public.global_plans AS plan
  CROSS JOIN params
  WHERE (
    params.global_plan_id IS NOT NULL
    AND plan.id = params.global_plan_id
  ) OR (
    params.global_plan_id IS NULL
    AND plan.is_hidden = FALSE
  )
  ORDER BY
    CASE
      WHEN CURRENT_DATE BETWEEN plan.start_date AND plan.end_date THEN 0
      ELSE 1
    END,
    plan.start_date DESC,
    plan.name
  LIMIT 1
),
eligible_profiles AS (
  SELECT
    profile.id,
    COALESCE(NULLIF(BTRIM(profile.great_region), ''), '未設定') AS great_region,
    COALESCE(NULLIF(BTRIM(profile.pastoral_zone), ''), '未設定牧區') AS pastoral_zone
  FROM public.profiles AS profile
  WHERE profile.is_active = TRUE
    AND profile.is_demo = FALSE
),
signed_up_profiles AS (
  SELECT DISTINCT reading_plan.user_id
  FROM public.reading_plans AS reading_plan
  JOIN selected_plan AS plan
    ON plan.id = reading_plan.global_plan_id
),
great_region_rollup AS (
  SELECT
    profile.great_region AS label,
    COUNT(signup.user_id)::INTEGER AS signup_count,
    COUNT(*)::INTEGER AS registered_count
  FROM eligible_profiles AS profile
  LEFT JOIN signed_up_profiles AS signup
    ON signup.user_id = profile.id
  GROUP BY profile.great_region
),
pastoral_zone_rollup AS (
  SELECT
    profile.pastoral_zone AS label,
    COUNT(signup.user_id)::INTEGER AS signup_count,
    COUNT(*)::INTEGER AS registered_count
  FROM eligible_profiles AS profile
  LEFT JOIN signed_up_profiles AS signup
    ON signup.user_id = profile.id
  GROUP BY profile.pastoral_zone
),
report_rows AS (
  SELECT
    1 AS section_order,
    CASE WHEN label = '未設定' THEN 1 ELSE 0 END AS row_order,
    '大區'::TEXT AS category,
    label,
    signup_count,
    registered_count
  FROM great_region_rollup

  UNION ALL

  SELECT
    2 AS section_order,
    CASE WHEN label = '未設定牧區' THEN 1 ELSE 0 END AS row_order,
    '牧區'::TEXT AS category,
    label,
    signup_count,
    registered_count
  FROM pastoral_zone_rollup
)
SELECT
  plan.id AS selected_plan_id,
  plan.name AS selected_plan_name,
  report.category AS 統計層級,
  report.label AS 區域,
  report.signup_count AS 報名人數,
  report.registered_count AS 註冊人數,
  CONCAT(
    report.label,
    '/',
    report.signup_count,
    '/',
    report.registered_count
  ) AS 文字檔內容
FROM report_rows AS report
CROSS JOIN selected_plan AS plan
ORDER BY
  report.section_order,
  report.row_order,
  report.label;
