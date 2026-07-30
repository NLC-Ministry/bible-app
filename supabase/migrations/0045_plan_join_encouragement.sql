-- Let plan managers see active people in their authorized scope who have not
-- joined a selected plan, and send each person one encouragement per day.

CREATE OR REPLACE FUNCTION public.get_unjoined_plan_members(
  p_global_plan_id UUID,
  p_plan_key TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_unjoined_plan_members$
DECLARE
  actor_id UUID;
  actor_profile public.profiles%ROWTYPE;
  target_plan public.global_plans%ROWTYPE;
  members_json JSONB;
  reminder_key TEXT;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT * INTO actor_profile FROM public.profiles WHERE id = actor_id;
  SELECT * INTO target_plan FROM public.global_plans WHERE id = p_global_plan_id;

  IF actor_profile.id IS NULL
     OR actor_profile.role NOT IN ('admin', 'great_zone_leader', 'zone_leader') THEN
    RAISE EXCEPTION 'plan_management_scope_required';
  END IF;
  IF target_plan.id IS NULL THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  reminder_key := 'plan-invite:' || target_plan.id::TEXT;

  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'id', candidate.id,
        'name', candidate.name,
        'greatRegion', NULLIF(BTRIM(candidate.great_region), ''),
        'pastoralZone', NULLIF(BTRIM(candidate.pastoral_zone), ''),
        'smallGroup', NULLIF(BTRIM(candidate.small_group), ''),
        'remindedToday', EXISTS (
          SELECT 1
          FROM public.care_reminders AS reminder
          WHERE reminder.sender_id = actor_id
            AND reminder.recipient_id = candidate.id
            AND reminder.plan_key = reminder_key
            AND reminder.sent_on = CURRENT_DATE
        )
      )
      ORDER BY candidate.great_region, candidate.pastoral_zone, candidate.small_group, candidate.name
    ),
    '[]'::JSONB
  ) INTO members_json
  FROM public.profiles AS candidate
  WHERE candidate.is_active = TRUE
    AND candidate.is_demo = FALSE
    AND candidate.id <> actor_id
    AND (
      actor_profile.role = 'admin'
      OR (
        actor_profile.role = 'great_zone_leader'
        AND EXISTS (
          SELECT 1
          FROM UNNEST(STRING_TO_ARRAY(COALESCE(candidate.great_region, ''), ',')) AS member_scope(value)
          JOIN UNNEST(STRING_TO_ARRAY(
            COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, ''), ','
          )) AS actor_scope(value)
            ON BTRIM(member_scope.value) = BTRIM(actor_scope.value)
          WHERE BTRIM(member_scope.value) <> ''
        )
      )
      OR (
        actor_profile.role = 'zone_leader'
        AND EXISTS (
          SELECT 1
          FROM UNNEST(STRING_TO_ARRAY(COALESCE(candidate.pastoral_zone, ''), ',')) AS member_scope(value)
          JOIN UNNEST(STRING_TO_ARRAY(
            COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, ''), ','
          )) AS actor_scope(value)
            ON BTRIM(member_scope.value) = BTRIM(actor_scope.value)
          WHERE BTRIM(member_scope.value) <> ''
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.reading_plans AS reading_plan
      WHERE reading_plan.user_id = candidate.id
        AND (
          reading_plan.global_plan_id = target_plan.id
          OR (
            NULLIF(BTRIM(p_plan_key), '') IS NOT NULL
            AND reading_plan.preset_key = BTRIM(p_plan_key)
          )
        )
    );

  RETURN JSONB_BUILD_OBJECT(
    'planId', target_plan.id,
    'planName', target_plan.name,
    'members', members_json
  );
END;
$get_unjoined_plan_members$;

CREATE OR REPLACE FUNCTION public.send_plan_join_invitation(
  p_global_plan_id UUID,
  p_recipient_id UUID,
  p_plan_key TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $send_plan_join_invitation$
DECLARE
  actor_id UUID;
  actor_profile public.profiles%ROWTYPE;
  recipient_profile public.profiles%ROWTYPE;
  target_plan public.global_plans%ROWTYPE;
  reminder_key TEXT;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT * INTO actor_profile FROM public.profiles WHERE id = actor_id;
  SELECT * INTO recipient_profile FROM public.profiles WHERE id = p_recipient_id;
  SELECT * INTO target_plan FROM public.global_plans WHERE id = p_global_plan_id;

  IF actor_profile.id IS NULL
     OR actor_profile.role NOT IN ('admin', 'great_zone_leader', 'zone_leader') THEN
    RAISE EXCEPTION 'plan_management_scope_required';
  END IF;
  IF target_plan.id IS NULL THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;
  IF recipient_profile.id IS NULL OR recipient_profile.is_active = FALSE OR recipient_profile.is_demo = TRUE THEN
    RAISE EXCEPTION 'plan_invitation_recipient_not_found';
  END IF;
  IF recipient_profile.id = actor_id THEN
    RAISE EXCEPTION 'plan_invitation_self_not_allowed';
  END IF;
  IF NOT (
    actor_profile.role = 'admin'
    OR (
      actor_profile.role = 'great_zone_leader'
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
      actor_profile.role = 'zone_leader'
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
$send_plan_join_invitation$;

REVOKE ALL ON FUNCTION public.get_unjoined_plan_members(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_plan_join_invitation(UUID, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unjoined_plan_members(UUID, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_plan_join_invitation(UUID, UUID, TEXT, UUID) TO authenticated, service_role;
