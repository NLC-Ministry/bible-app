-- #343 「提醒加入計畫」的權限檢查：牧者、小組長不再被拒絕。
--
-- send_plan_join_invitation 的角色清單還寫著舊的 'senior_pastor'（0078/0079 已改名成
-- 'pastor'），所以牧者一呼叫就是 plan_management_scope_required；範圍判斷也沒有小組長，
-- 小組長一定拿到 plan_member_outside_scope。前端（js/db.js sendPlanJoinInvitation）失敗時
-- 會改走 nlc-data 的 send_care_reminder，提醒還是送得出去，但每位多一次失敗請求、
-- 也少了「已經加入這個計畫」的檢查。
--
-- 這支只改兩件事，其餘照 20260929093001_drop_profiles_is_demo.sql 裡的現行定義：
--   1. 兩處角色清單 'senior_pastor' → 'pastor'
--   2. 範圍判斷補上小組長，規則跟同一個畫面的名單 get_unjoined_plan_members 一樣：
--      對方的 small_group 跟自己的 managed_groups（沒設定就用自己的 small_group）有重疊
-- 授權照舊：authenticated + service_role，anon 沒有。前端、nlc-data 都不用改。

CREATE OR REPLACE FUNCTION public.send_plan_join_invitation(p_global_plan_id uuid, p_recipient_id uuid, p_plan_key text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id UUID;
  actor_profile RECORD;
  recipient_profile public.profiles%ROWTYPE;
  target_plan public.global_plans%ROWTYPE;
  reminder_key TEXT;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT profile.*, public.role_code(profile.role_id) AS role_code INTO actor_profile FROM public.profiles AS profile WHERE profile.id = actor_id;
  SELECT * INTO recipient_profile FROM public.profiles WHERE id = p_recipient_id;
  SELECT * INTO target_plan FROM public.global_plans WHERE id = p_global_plan_id;

  IF actor_profile.id IS NULL
     OR actor_profile.role_code NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'plan_management_scope_required';
  END IF;
  IF target_plan.id IS NULL THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;
  IF recipient_profile.id IS NULL OR recipient_profile.is_active = FALSE THEN
    RAISE EXCEPTION 'plan_invitation_recipient_not_found';
  END IF;
  IF recipient_profile.id = actor_id THEN
    RAISE EXCEPTION 'plan_invitation_self_not_allowed';
  END IF;
  IF NOT (
    actor_profile.role_code IN ('admin', 'pastor')
    OR (
      actor_profile.role_code = 'great_zone_leader'
      AND EXISTS (
        SELECT 1
        FROM UNNEST(STRING_TO_ARRAY(COALESCE(recipient_profile.great_region, ''), ',')) AS member_scope(value)
        JOIN UNNEST(STRING_TO_ARRAY(
          COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, ''), ','
        )) AS actor_scope(value)
          ON BTRIM(member_scope.value) = BTRIM(actor_scope.value)
        WHERE BTRIM(member_scope.value) <> ''
      )
    )
    OR (
      actor_profile.role_code = 'zone_leader'
      AND EXISTS (
        SELECT 1
        FROM UNNEST(STRING_TO_ARRAY(COALESCE(recipient_profile.pastoral_zone, ''), ',')) AS member_scope(value)
        JOIN UNNEST(STRING_TO_ARRAY(
          COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, ''), ','
        )) AS actor_scope(value)
          ON BTRIM(member_scope.value) = BTRIM(actor_scope.value)
        WHERE BTRIM(member_scope.value) <> ''
      )
    )
    OR (
      -- 跟 get_unjoined_plan_members 的名單範圍一樣：小組長看得到誰，就能提醒誰
      actor_profile.role_code = 'group_leader'
      AND public.values_overlap(
        recipient_profile.small_group,
        COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, '')
      )
    )
  ) THEN
    RAISE EXCEPTION 'plan_member_outside_scope';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.reading_plans AS reading_plan
    WHERE reading_plan.user_id = recipient_profile.id
      AND (
        reading_plan.global_plan_id = target_plan.id
        OR (
          NULLIF(BTRIM(p_plan_key), '') IS NOT NULL
          AND reading_plan.preset_key = BTRIM(p_plan_key)
        )
      )
  ) THEN
    RAISE EXCEPTION 'plan_invitation_recipient_already_joined';
  END IF;

  reminder_key := 'plan-invite:' || target_plan.id::TEXT;
  BEGIN
    INSERT INTO public.care_reminders (
      sender_id,
      recipient_id,
      global_plan_id,
      plan_key,
      reason,
      message,
      status,
      sent_on
    ) VALUES (
      actor_id,
      recipient_profile.id,
      target_plan.id,
      reminder_key,
      'encouragement',
      '邀請你加入「' || target_plan.name || '」讀經計畫，一起開始讀經吧！',
      'unread',
      CURRENT_DATE
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN JSONB_BUILD_OBJECT('sent', FALSE, 'duplicate', TRUE);
  END;

  RETURN JSONB_BUILD_OBJECT('sent', TRUE, 'duplicate', FALSE);
END;
$function$;

REVOKE ALL ON FUNCTION public.send_plan_join_invitation(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_plan_join_invitation(uuid, uuid, text, uuid) TO authenticated, service_role;
