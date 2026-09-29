-- #263 第 2 步驗收：刪除 profiles 的示範帳號欄位前後，五項數字要完全一致。
--
-- 只讀：只呼叫會被改寫的讀取函式和 view，不寫任何資料。
-- 開頭的 set_config(..., true) 只在這次查詢的交易內有效，讓函式接受指定的 actor
-- （跟 nlc-data 用 service_role 呼叫時一樣）。
--
-- 用法（套用 migration 前跑一次、套用後再跑一次，兩次輸出逐列比對）：
--   npx supabase db query --linked --project-ref dbtjsljrytzonjvclgrd -f supabase/queries/drop_demo_column_compare_263.sql
-- 或整段貼到 SQL Editor 一次執行（要整段一起跑，set_config 才會生效）。
--
-- 選樣都是固定規則（報名人數最多的 3 個計畫、每種管理角色 id 最小的一位、每個計畫
-- user_id 最小的 5 位報名者），前後兩次選到的對象一樣。detail 同時列出人數等數字和
-- 整份輸出的 md5；只要 staging 在兩次之間沒有人打卡或改資料，md5 也要一樣。
--
-- 沒涵蓋：send_plan_join_invitation（會寫入關心提醒）與 protect_profile_privileged_fields
-- （trigger），這兩支只拿掉「永遠成立」的條件，不影響回傳數字。

SELECT
  set_config('request.jwt.claims', '{"role":"service_role"}', true) AS claims,
  set_config('request.jwt.claim.role', 'service_role', true) AS claim_role;

WITH plans AS (
  SELECT plan.id, plan.name
  FROM public.global_plans AS plan
  JOIN (
    SELECT global_plan_id, COUNT(*) AS joined
    FROM public.reading_plans
    WHERE global_plan_id IS NOT NULL
    GROUP BY global_plan_id
  ) AS counts ON counts.global_plan_id = plan.id
  ORDER BY counts.joined DESC, plan.id
  LIMIT 3
), actors AS (
  SELECT DISTINCT ON (public.role_code(profile.role_id))
    public.role_code(profile.role_id) AS role_code,
    profile.id,
    profile.great_region,
    profile.pastoral_zone,
    profile.small_group,
    profile.managed_regions,
    profile.managed_zones,
    profile.managed_groups
  FROM public.profiles AS profile
  WHERE profile.is_active = TRUE
    AND public.role_code(profile.role_id) IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader')
  ORDER BY public.role_code(profile.role_id), profile.id
), ranking_members AS (
  SELECT plan.id AS plan_id, sample.user_id
  FROM plans AS plan
  CROSS JOIN LATERAL (
    SELECT DISTINCT reading_plan.user_id
    FROM public.reading_plans AS reading_plan
    WHERE reading_plan.global_plan_id = plan.id
    ORDER BY reading_plan.user_id
    LIMIT 5
  ) AS sample
), checks AS (
  -- 1. 排行榜（個人：全教會／牧區名次）
  SELECT
    '1 排行榜 get_personal_plan_ranking_summary' AS section,
    plan.name AS object,
    STRING_AGG(
      (result ->> 'churchRank') || '/' || (result ->> 'churchTotal') || ' ' ||
      COALESCE(result ->> 'zoneRank', '-') || '/' || COALESCE(result ->> 'zoneTotal', '-'),
      ', ' ORDER BY member.user_id
    ) || ' md5=' || MD5(STRING_AGG(result::TEXT, '|' ORDER BY member.user_id)) AS detail
  FROM plans AS plan
  JOIN ranking_members AS member ON member.plan_id = plan.id
  CROSS JOIN LATERAL public.get_personal_plan_ranking_summary(plan.id, member.user_id) AS result
  GROUP BY plan.name

  UNION ALL
  -- 2. 牧區排名
  SELECT
    '2 牧區排名 get_pastoral_zone_leaderboard',
    plan.name,
    'zones=' || JSONB_ARRAY_LENGTH(result -> 'zones')
      || ' members=' || COALESCE((SELECT SUM((zone ->> 'memberCount')::INTEGER) FROM JSONB_ARRAY_ELEMENTS(result -> 'zones') AS zone), 0)
      || ' chapters=' || COALESCE((SELECT SUM((zone ->> 'chaptersRead')::NUMERIC) FROM JSONB_ARRAY_ELEMENTS(result -> 'zones') AS zone), 0)
      || ' unassigned=' || (result ->> 'unassignedCount')
      || ' md5=' || MD5(result::TEXT)
  FROM plans AS plan
  CROSS JOIN LATERAL public.get_pastoral_zone_leaderboard(plan.id, (SELECT id FROM actors WHERE role_code = 'admin')) AS result

  UNION ALL
  -- 3. 報名統計（管理員）
  SELECT
    '3 報名統計 get_admin_registration_statistics',
    plan.name,
    'summary=' || (result -> 'summary')::TEXT
      || ' zones=' || JSONB_ARRAY_LENGTH(result -> 'pastoralZones')
      || ' regions=' || JSONB_ARRAY_LENGTH(result -> 'greatRegions')
      || ' md5=' || MD5(result::TEXT)
  FROM plans AS plan
  CROSS JOIN LATERAL public.get_admin_registration_statistics(plan.id, (SELECT id FROM actors WHERE role_code = 'admin')) AS result

  UNION ALL
  -- 4. 名單（已報名／未報名／團隊安排），每種管理角色各一位
  SELECT
    '4 名單 get_joined_plan_members',
    plan.name || ' / ' || actor.role_code,
    'members=' || JSONB_ARRAY_LENGTH(result -> 'members') || ' md5=' || MD5(result::TEXT)
  FROM plans AS plan
  CROSS JOIN actors AS actor
  CROSS JOIN LATERAL public.get_joined_plan_members(plan.id, NULL, actor.id) AS result

  UNION ALL
  SELECT
    '4 名單 get_unjoined_plan_members',
    plan.name || ' / ' || actor.role_code,
    'members=' || JSONB_ARRAY_LENGTH(result -> 'members') || ' md5=' || MD5(result::TEXT)
  FROM plans AS plan
  CROSS JOIN actors AS actor
  CROSS JOIN LATERAL public.get_unjoined_plan_members(plan.id, NULL, actor.id) AS result

  UNION ALL
  SELECT
    '4 名單 get_admin_member_team_placements',
    plan.name || ' / ' || actor.role_code,
    'rows=' || CASE WHEN JSONB_TYPEOF(result) = 'array' THEN JSONB_ARRAY_LENGTH(result)::TEXT ELSE JSONB_TYPEOF(result) END
      || ' md5=' || MD5(result::TEXT)
  FROM plans AS plan
  CROSS JOIN actors AS actor
  CROSS JOIN LATERAL public.get_admin_member_team_placements(plan.id, actor.id) AS result

  UNION ALL
  -- 5. 組織樹（nlc-data 傳入的角色與範圍，跟 applyForcedScope 相同寫法）
  SELECT
    '5 組織樹 get_org_structure_tree',
    actor.role_code,
    'rows=' || JSONB_ARRAY_LENGTH(result -> 'rows') || ' md5=' || MD5((result -> 'rows')::TEXT)
  FROM actors AS actor
  CROSS JOIN LATERAL public.get_org_structure_tree(
    actor.id,
    actor.role_code,
    STRING_TO_ARRAY(COALESCE(NULLIF(actor.managed_regions, ''), actor.great_region, ''), ','),
    STRING_TO_ARRAY(COALESCE(NULLIF(actor.managed_zones, ''), actor.pastoral_zone, ''), ','),
    STRING_TO_ARRAY(COALESCE(NULLIF(actor.managed_groups, ''), actor.small_group, ''), ',')
  ) AS result

  UNION ALL
  -- member_reading_summary
  SELECT
    '6 view member_reading_summary',
    'all rows',
    'rows=' || COUNT(*) || ' plans=' || COALESCE(SUM(plan_count), 0) || ' logs=' || COALESCE(SUM(log_count), 0)
      || ' md5=' || MD5(COALESCE(STRING_AGG(user_id::TEXT || ':' || plan_count || ':' || log_count, ',' ORDER BY user_id), ''))
  FROM public.member_reading_summary
)
SELECT section, object, detail
FROM checks
ORDER BY section, object;
