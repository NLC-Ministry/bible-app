-- #395 管理頁「使用者基本資料」「權限管理」改用單一 RPC。
--
-- 原本前端把 profiles、reading_plans（所有計畫歷來全部報名）、reading_team_members、
-- reading_teams 每頁 200 筆依序抓回來：正式站使用者基本資料 53 個 nlc-data 請求、約 16 秒；
-- 權限管理的兩個區塊又各自把 profiles 抓一遍。這支一次回傳全部 profiles，兩頁共用。
--
-- 回傳 { e: 是否含報名／隊伍, p: [ { i, n, m, r, z, g, a, s, ss, ri, rd, mr, mz, mg, j, t }, … ] }：
-- - i/n/m：id／name／email；r/z/g：大區／牧區／小組；a：is_active（前端自己篩）；
--   s/ss：member_context_synced_at／member_context_sync_status；ri：role_id；
--   rd：[id, code, label, scope_type]（沒有對應的角色定義是 null）；mr/mz/mg：managed_*。
-- - j：報名 [[global_plan_id, preset_key], …]，照 reading_plans.id 排序。舊列可能只有
--   preset_key，交給前端照現在的 resolveEnrollmentPlanId 對回計畫。
-- - t：隊伍 [[global_plan_id, 隊名, member_role], …]，照 team_id 排序，伺服器直接 join 隊名。
-- - 排序跟舊查詢一樣：name、id。
--
-- 誰能呼叫由 nlc-data 決定（跟其他 nlc-data 規則一樣用 getProfileRoleCode）：全教會範圍
-- （admin／pastor）才放行；p_include_plan_details 只有 admin 是 true（使用者基本資料是
-- admin 限定，權限管理只需要 profiles）。p_actor_id、p_include_plan_details 都由 nlc-data
-- 注入，前端傳的值會被蓋掉。只給 service_role，client 不能直接呼叫。

CREATE OR REPLACE FUNCTION public.get_admin_user_directory(
  p_include_plan_details boolean DEFAULT false,
  p_actor_id uuid DEFAULT NULL::uuid
)
 RETURNS json
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_actor_id IS NULL THEN NULL ELSE json_build_object(
    'e', COALESCE(p_include_plan_details, false),
    'p', COALESCE((
      SELECT json_agg(json_build_object(
          'i', profile.id,
          'n', profile.name,
          'm', profile.email,
          'r', profile.great_region,
          'z', profile.pastoral_zone,
          'g', profile.small_group,
          'a', profile.is_active,
          's', profile.member_context_synced_at,
          'ss', profile.member_context_sync_status,
          'ri', profile.role_id,
          'rd', CASE WHEN role_def.id IS NULL THEN NULL
                     ELSE json_build_array(role_def.id, role_def.code, role_def.label, role_def.scope_type) END,
          'mr', profile.managed_regions,
          'mz', profile.managed_zones,
          'mg', profile.managed_groups,
          'j', CASE WHEN p_include_plan_details THEN (
                 SELECT json_agg(json_build_array(plan.global_plan_id, plan.preset_key) ORDER BY plan.id)
                 FROM public.reading_plans AS plan
                 WHERE plan.user_id = profile.id
               ) END,
          't', CASE WHEN p_include_plan_details THEN (
                 SELECT json_agg(json_build_array(member.global_plan_id, team.name, member.member_role) ORDER BY member.team_id)
                 FROM public.reading_team_members AS member
                 LEFT JOIN public.reading_teams AS team ON team.id = member.team_id
                 WHERE member.user_id = profile.id
                   AND member.global_plan_id IS NOT NULL
               ) END
        ) ORDER BY profile.name, profile.id)
      FROM public.profiles AS profile
      LEFT JOIN public.role_definitions AS role_def ON role_def.id = profile.role_id
    ), '[]'::json)
  ) END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_user_directory(boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_user_directory(boolean, uuid) TO service_role;
