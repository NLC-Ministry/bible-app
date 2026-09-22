-- get_joined_plan_members（現行版本：migration 0135）用一般 JOIN 把
-- reading_plans 接到 profiles，條件是「global_plan_id = target OR preset_key
-- = p_plan_key」。如果同一個人對同一個計畫留了不只一筆 reading_plans（例如
-- 舊制只有 preset_key、沒有 global_plan_id 的歷史列，加上後來改用
-- global_plan_id 之後又產生的新列），這個 JOIN 會對同一個人吐出兩列，讓
-- 「已加入計畫」清單裡這個人重複出現、人數也被灌水（例如系統管理畫面顯示
-- 1080 人，但同一份資料在別處用 profile 去重後只有 909 人）。
--
-- reading_plans(user_id, global_plan_id) 在 global_plan_id 非 NULL 時有唯一
-- 索引（0001），能擋住「兩筆同一個 global_plan_id」，但擋不住「一筆新制
-- global_plan_id 列 + 一筆舊制只有 preset_key、global_plan_id 是 NULL 的
-- 列」同時存在、又剛好都命中同一次查詢條件的狀況。
--
-- 修法：改用 LATERAL 子查詢，每個 candidate 最多只挑一筆相符的
-- reading_plans（優先選 global_plan_id 直接命中的那筆，其次挑最新建立的
-- preset_key 命中列），再外接 profiles，確保一個人在結果裡最多出現一次。
CREATE OR REPLACE FUNCTION public.get_joined_plan_members(
  p_global_plan_id UUID,
  p_plan_key TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_joined_plan_members$
DECLARE
  actor_id UUID;
  actor_profile public.profiles%ROWTYPE;
  actor_role TEXT;
  target_plan public.global_plans%ROWTYPE;
  members_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT * INTO actor_profile FROM public.profiles WHERE id = actor_id;
  SELECT * INTO target_plan FROM public.global_plans WHERE id = p_global_plan_id;

  IF actor_profile.id IS NULL THEN
    RAISE EXCEPTION 'profile_identity_not_found';
  END IF;

  actor_role := public.role_code(actor_profile.role_id);
  IF actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'plan_management_scope_required';
  END IF;
  IF target_plan.id IS NULL THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'id', candidate.id,
        'name', candidate.name,
        'greatRegion', NULLIF(BTRIM(candidate.great_region), ''),
        'pastoralZone', NULLIF(BTRIM(candidate.pastoral_zone), ''),
        'smallGroup', NULLIF(BTRIM(candidate.small_group), ''),
        'joinedAt', joined_plan.created_at,
        'currentRound', COALESCE(joined_plan.current_round, 1)
      )
      ORDER BY gr.sort_order NULLS LAST, pz.sort_order NULLS LAST,
        candidate.great_region, candidate.pastoral_zone, candidate.small_group, candidate.name
    ),
    '[]'::JSONB
  ) INTO members_json
  FROM public.profiles AS candidate
  JOIN LATERAL (
    SELECT rp.created_at, rp.current_round
    FROM public.reading_plans AS rp
    WHERE rp.user_id = candidate.id
      AND (
        rp.global_plan_id = target_plan.id
        OR (
          NULLIF(BTRIM(p_plan_key), '') IS NOT NULL
          AND rp.preset_key = BTRIM(p_plan_key)
        )
      )
    ORDER BY (rp.global_plan_id = target_plan.id) DESC, rp.created_at DESC
    LIMIT 1
  ) AS joined_plan ON TRUE
  LEFT JOIN public.great_regions AS gr ON gr.name = candidate.great_region
  LEFT JOIN public.pastoral_zones AS pz ON pz.name = candidate.pastoral_zone AND pz.great_region_id = gr.id
  WHERE candidate.is_active = TRUE
    AND candidate.is_demo = FALSE
    AND candidate.id <> actor_id
    AND (
      actor_role IN ('admin', 'pastor')
      OR (actor_role = 'great_zone_leader' AND public.values_overlap(candidate.great_region, COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, '')))
      OR (actor_role = 'zone_leader' AND public.values_overlap(candidate.pastoral_zone, COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, '')))
      OR (actor_role = 'group_leader' AND public.values_overlap(candidate.small_group, COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, '')))
    );

  RETURN JSONB_BUILD_OBJECT(
    'planId', target_plan.id,
    'planName', target_plan.name,
    'members', members_json
  );
END;
$get_joined_plan_members$;

REVOKE ALL ON FUNCTION public.get_joined_plan_members(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_joined_plan_members(UUID, TEXT, UUID) TO authenticated, service_role;
