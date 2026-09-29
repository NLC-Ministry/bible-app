-- #263 [demo D3] 第 2 步：刪除 profiles.is_demo 欄位。
--
-- 為什麼可以刪：
--   * 兩個環境 is_demo = TRUE 的帳號都是 0 位（欄位 NOT NULL，也沒有 NULL），
--     #261 的限制 profiles_no_demo（CHECK is_demo = false）保證不會再出現示範帳號。
--     所以所有「排除示範帳號」的條件（is_demo = FALSE、NOT is_demo）永遠成立，
--     拿掉之後回傳的資料完全一樣。
--   * 第 1 步（commit 8b29b5a，已上線正式站與 staging）網站、nlc-data、nlc-session
--     都已不再讀寫這個欄位。
--
-- 依賴清單（2026-09-29 在 staging 與正式站用 pg_proc / pg_views / pg_indexes /
-- pg_constraint / pg_policies / pg_depend 重新查過，兩邊一致）：
--   * 9 個函式：send_plan_join_invitation、get_personal_plan_ranking_summary、
--     protect_profile_privileged_fields（trigger）、get_admin_registration_statistics、
--     get_pastoral_zone_leaderboard、get_admin_member_team_placements、
--     get_unjoined_plan_members、get_org_structure_tree、get_joined_plan_members
--   * 1 個 view：member_reading_summary（沒有輸出 is_demo 欄位，所以用 CREATE OR REPLACE）
--   * 限制 profiles_no_demo
--   * 索引 idx_profiles_is_demo（直接刪）；idx_profiles_active_great_region、
--     idx_profiles_active_zone_group 是部分索引，先建不含 is_demo 的新版再換掉舊的，
--     名單、統計的查詢不會因此變慢
--   * Policy、publication、統計物件：0 個
--
-- 每個函式都以 staging 上的現行定義（pg_get_functiondef）為底，只拿掉 is_demo 條件，
-- 其他一個字都不動（例如 send_plan_join_invitation 角色清單裡還寫著 'senior_pastor'，
-- 那是現況，不在這次範圍）。send_plan_join_invitation 的現行定義是 0045 經過
-- 0047／0048／0063 用字串替換改出來的，所以跟任何一支 migration 的原文都不同；
-- 其餘 8 個與 repo 裡最後一次定義相同。授權照現況：authenticated + service_role，anon 沒有。
--
-- member_reading_summary 的 security_invoker = on 與授權（含 anon）不是 repo 的 migration
-- 設的（Dashboard 設定），CREATE OR REPLACE VIEW 會保留授權；reloptions 一定要在
-- WITH 裡重寫一次，不然會被清掉。
--
-- 舊前端相容性：2026-09-27 以前的版本還會在 select 裡帶 is_demo，欄位刪掉後會失敗。
-- 如果這支 migration 在 2026-10-11 之前上正式站，要設 release-policy.json 的
-- forceUpdateBuiltBefore（見 handoff trailer）。

-- ── 1. 函式：拿掉 is_demo 條件（其餘照現行定義）─────────────────────────────

-- ── 1.1 send_plan_join_invitation ─────────────────────────────────────────
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
     OR actor_profile.role_code NOT IN ('admin', 'senior_pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
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
    actor_profile.role_code IN ('admin', 'senior_pastor')
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

-- ── 1.2 get_personal_plan_ranking_summary ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_personal_plan_ranking_summary(p_global_plan_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id UUID;
  actor_zone TEXT;
  result JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.global_plans AS plan
    WHERE plan.id = p_global_plan_id
  ) THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  SELECT NULLIF(BTRIM(profile.pastoral_zone), '')
  INTO actor_zone
  FROM public.profiles AS profile
  WHERE profile.id = actor_id;

  WITH participant_progress AS (
    SELECT
      profile.id,
      NULLIF(BTRIM(profile.pastoral_zone), '') AS pastoral_zone,
      COUNT(reading_log.id)::INTEGER AS chapters_read,
      MAX(reading_log.read_at) AS last_read_at
    FROM public.profiles AS profile
    JOIN public.reading_plans AS reading_plan
      ON reading_plan.user_id = profile.id
     AND reading_plan.global_plan_id = p_global_plan_id
    LEFT JOIN public.reading_logs AS reading_log
      ON reading_log.plan_id = reading_plan.id
    WHERE COALESCE(profile.is_active, TRUE) = TRUE
    GROUP BY profile.id, profile.pastoral_zone
  ), ranked AS (
    SELECT
      participant.*,
      COUNT(*) OVER ()::INTEGER AS church_total,
      COUNT(*) OVER (PARTITION BY participant.pastoral_zone)::INTEGER AS zone_total,
      CASE
        WHEN participant.chapters_read = 0 THEN COUNT(*) OVER ()::INTEGER
        ELSE RANK() OVER (
          ORDER BY participant.chapters_read DESC,
            participant.last_read_at ASC NULLS LAST
        )::INTEGER
      END AS church_rank,
      CASE
        WHEN participant.chapters_read = 0
          THEN COUNT(*) OVER (PARTITION BY participant.pastoral_zone)::INTEGER
        ELSE RANK() OVER (
          PARTITION BY participant.pastoral_zone
          ORDER BY participant.chapters_read DESC,
            participant.last_read_at ASC NULLS LAST
        )::INTEGER
      END AS zone_rank
    FROM participant_progress AS participant
  ), actor_ranking AS (
    SELECT *
    FROM ranked
    WHERE id = actor_id
  )
  SELECT jsonb_build_object(
    'churchRank', actor.church_rank,
    'churchTotal', COALESCE(
      actor.church_total,
      (SELECT COUNT(*)::INTEGER FROM participant_progress)
    ),
    'zoneName', actor_zone,
    'zoneRank', actor.zone_rank,
    'zoneTotal', COALESCE(
      actor.zone_total,
      (SELECT COUNT(*)::INTEGER
       FROM participant_progress
       WHERE pastoral_zone = actor_zone)
    )
  )
  INTO result
  FROM (SELECT 1) AS singleton
  LEFT JOIN actor_ranking AS actor ON TRUE;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_personal_plan_ranking_summary(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_personal_plan_ranking_summary(uuid, uuid) TO authenticated, service_role;

-- ── 1.3 protect_profile_privileged_fields ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  actor_role TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN RETURN NEW; END IF;

  SELECT public.role_code(profile.role_id)
  INTO actor_role
  FROM public.profiles AS profile
  WHERE profile.auth_user_id = auth.uid()
  LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role_id IS DISTINCT FROM '10000000-0000-4000-8000-000000000001'::UUID THEN
      RAISE EXCEPTION 'role assignment is managed by Member Hub' USING ERRCODE = '42501';
    END IF;
    IF actor_role = 'admin' THEN RETURN NEW; END IF;
    IF NEW.is_active <> TRUE
       OR NEW.nlc_member_id IS NOT NULL
       OR COALESCE(NEW.managed_regions, '') <> ''
       OR COALESCE(NEW.managed_zones, '') <> ''
       OR COALESCE(NEW.managed_groups, '') <> ''
       OR (NEW.auth_user_id IS NOT NULL AND NEW.auth_user_id IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'privileged profile fields cannot be supplied by a member'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
      RAISE EXCEPTION 'role assignment is managed by Member Hub' USING ERRCODE = '42501';
    END IF;
    IF actor_role = 'admin' THEN RETURN NEW; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.nlc_member_id IS DISTINCT FROM OLD.nlc_member_id
       OR NEW.managed_regions IS DISTINCT FROM OLD.managed_regions
       OR NEW.managed_zones IS DISTINCT FROM OLD.managed_zones
       OR NEW.managed_groups IS DISTINCT FROM OLD.managed_groups THEN
      RAISE EXCEPTION 'privileged profile fields can only be changed by an administrator'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_profile_privileged_fields() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_profile_privileged_fields() TO authenticated, service_role;

-- ── 1.4 get_admin_registration_statistics ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_registration_statistics(p_global_plan_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  plan_name TEXT;
  pastoral_zones_json JSONB;
  great_regions_json JSONB;
  summary_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT public.role_code(profile.role_id)
  INTO actor_role
  FROM public.profiles AS profile
  WHERE profile.id = actor_id;

  IF actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'registration_statistics_admin_required';
  END IF;

  SELECT plan.name INTO plan_name
  FROM public.global_plans AS plan
  WHERE plan.id = p_global_plan_id;

  IF plan_name IS NULL THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  WITH eligible_profiles AS (
    SELECT
      profile.id,
      NULLIF(BTRIM(profile.pastoral_zone), '') IS NOT NULL AS has_pastoral_zone
    FROM public.profiles AS profile
    WHERE profile.is_active = TRUE
  ), signed_up_profiles AS (
    SELECT DISTINCT reading_plan.user_id
    FROM public.reading_plans AS reading_plan
    WHERE reading_plan.global_plan_id = p_global_plan_id
  )
  SELECT JSONB_BUILD_OBJECT(
    'withoutPastoralZoneNotJoined', COUNT(*) FILTER (
      WHERE NOT profile.has_pastoral_zone AND signup.user_id IS NULL
    )::INTEGER,
    'withoutPastoralZoneJoined', COUNT(*) FILTER (
      WHERE NOT profile.has_pastoral_zone AND signup.user_id IS NOT NULL
    )::INTEGER,
    'withPastoralZoneNotJoined', COUNT(*) FILTER (
      WHERE profile.has_pastoral_zone AND signup.user_id IS NULL
    )::INTEGER,
    'withPastoralZoneJoined', COUNT(*) FILTER (
      WHERE profile.has_pastoral_zone AND signup.user_id IS NOT NULL
    )::INTEGER,
    'totalJoined', COUNT(signup.user_id)::INTEGER,
    'totalRegistered', COUNT(*)::INTEGER
  )
  INTO summary_json
  FROM eligible_profiles AS profile
  LEFT JOIN signed_up_profiles AS signup ON signup.user_id = profile.id;

  WITH eligible_profiles AS (
    SELECT
      profile.id,
      COALESCE(NULLIF(BTRIM(profile.pastoral_zone), ''), '未設定牧區') AS label
    FROM public.profiles AS profile
    WHERE profile.is_active = TRUE
  ), signed_up_profiles AS (
    SELECT DISTINCT reading_plan.user_id
    FROM public.reading_plans AS reading_plan
    WHERE reading_plan.global_plan_id = p_global_plan_id
  ), team_memberships AS (
    -- A user can join at most one team per plan (UNIQUE(global_plan_id, user_id)
    -- on reading_team_members), so the two division filters below never overlap.
    SELECT tm.user_id, rt.division
    FROM public.reading_team_members AS tm
    JOIN public.reading_teams AS rt ON rt.id = tm.team_id
    WHERE tm.global_plan_id = p_global_plan_id
  ), rollup AS (
    SELECT
      profile.label,
      COUNT(*)::INTEGER AS registered_count,
      COUNT(signup.user_id)::INTEGER AS signup_count,
      COUNT(team3.user_id)::INTEGER AS team3_count,
      COUNT(team6.user_id)::INTEGER AS team6_count
    FROM eligible_profiles AS profile
    LEFT JOIN signed_up_profiles AS signup ON signup.user_id = profile.id
    LEFT JOIN team_memberships AS team3 ON team3.user_id = profile.id AND team3.division = 3
    LEFT JOIN team_memberships AS team6 ON team6.user_id = profile.id AND team6.division = 6
    GROUP BY profile.label
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'label', label,
        'signupCount', signup_count,
        'registeredCount', registered_count,
        'team3Count', team3_count,
        'team6Count', team6_count
      )
      ORDER BY CASE WHEN label = '未設定牧區' THEN 1 ELSE 0 END, label
    ),
    '[]'::JSONB
  )
  INTO pastoral_zones_json
  FROM rollup;

  WITH eligible_profiles AS (
    SELECT
      profile.id,
      COALESCE(NULLIF(BTRIM(profile.great_region), ''), '未設定') AS label
    FROM public.profiles AS profile
    WHERE profile.is_active = TRUE
  ), signed_up_profiles AS (
    SELECT DISTINCT reading_plan.user_id
    FROM public.reading_plans AS reading_plan
    WHERE reading_plan.global_plan_id = p_global_plan_id
  ), team_memberships AS (
    SELECT tm.user_id, rt.division
    FROM public.reading_team_members AS tm
    JOIN public.reading_teams AS rt ON rt.id = tm.team_id
    WHERE tm.global_plan_id = p_global_plan_id
  ), rollup AS (
    SELECT
      profile.label,
      COUNT(*)::INTEGER AS registered_count,
      COUNT(signup.user_id)::INTEGER AS signup_count,
      COUNT(team3.user_id)::INTEGER AS team3_count,
      COUNT(team6.user_id)::INTEGER AS team6_count
    FROM eligible_profiles AS profile
    LEFT JOIN signed_up_profiles AS signup ON signup.user_id = profile.id
    LEFT JOIN team_memberships AS team3 ON team3.user_id = profile.id AND team3.division = 3
    LEFT JOIN team_memberships AS team6 ON team6.user_id = profile.id AND team6.division = 6
    GROUP BY profile.label
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'label', label,
        'signupCount', signup_count,
        'registeredCount', registered_count,
        'team3Count', team3_count,
        'team6Count', team6_count
      )
      ORDER BY CASE WHEN label = '未設定' THEN 1 ELSE 0 END, label
    ),
    '[]'::JSONB
  )
  INTO great_regions_json
  FROM rollup;

  RETURN JSONB_BUILD_OBJECT(
    'planId', p_global_plan_id,
    'planName', plan_name,
    'summary', summary_json,
    'pastoralZones', pastoral_zones_json,
    'greatRegions', great_regions_json
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_registration_statistics(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_registration_statistics(uuid, uuid) TO authenticated, service_role;

-- ── 1.5 get_pastoral_zone_leaderboard ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pastoral_zone_leaderboard(p_global_plan_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id UUID;
  actor_pastoral_zone TEXT;
  result JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.global_plans AS plan
    WHERE plan.id = p_global_plan_id
  ) THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  SELECT NULLIF(BTRIM(profile.pastoral_zone), '')
  INTO actor_pastoral_zone
  FROM public.profiles AS profile
  WHERE profile.id = actor_id;

  WITH member_progress AS (
    SELECT
      profile.id,
      NULLIF(BTRIM(profile.pastoral_zone), '') AS pastoral_zone,
      COALESCE(progress.chapters_read, 0) AS chapters_read,
      progress.last_read_at
    FROM public.profiles AS profile
    LEFT JOIN public.reading_plans AS reading_plan
      ON reading_plan.user_id = profile.id
     AND reading_plan.global_plan_id = p_global_plan_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::INTEGER AS chapters_read,
        MAX(reading_log.read_at) AS last_read_at
      FROM public.reading_logs AS reading_log
      WHERE reading_log.plan_id = reading_plan.id
    ) AS progress ON TRUE
    WHERE COALESCE(profile.is_active, TRUE) = TRUE
  ), zone_rollup AS (
    SELECT
      pastoral_zone,
      COUNT(*)::INTEGER AS member_count,
      COALESCE(SUM(chapters_read), 0)::INTEGER AS chapters_read,
      ROUND(
        COALESCE(SUM(chapters_read), 0)::NUMERIC / NULLIF(COUNT(*), 0),
        2
      ) AS average_chapters,
      MAX(last_read_at) AS last_read_at
    FROM member_progress
    WHERE pastoral_zone IS NOT NULL
      AND pastoral_zone NOT IN ('未設定', '未設定牧區', '未分類')
    GROUP BY pastoral_zone
  )
  SELECT jsonb_build_object(
    'zones',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', zone.pastoral_zone,
          'memberCount', zone.member_count,
          'chaptersRead', zone.chapters_read,
          'averageChapters', zone.average_chapters,
          'lastReadAt', zone.last_read_at,
          'isMine', actor_pastoral_zone IS NOT NULL
            AND zone.pastoral_zone = actor_pastoral_zone
        )
        ORDER BY zone.average_chapters DESC,
          zone.last_read_at ASC NULLS LAST,
          zone.pastoral_zone
      )
      FROM zone_rollup AS zone
    ), '[]'::JSONB),
    'unassignedCount',
    (
      SELECT COUNT(*)::INTEGER
      FROM member_progress
      WHERE pastoral_zone IS NULL
        OR pastoral_zone IN ('未設定', '未設定牧區', '未分類')
    )
  )
  INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pastoral_zone_leaderboard(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pastoral_zone_leaderboard(uuid, uuid) TO authenticated, service_role;

-- ── 1.6 get_admin_member_team_placements ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_member_team_placements(p_global_plan_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id UUID;
  actor_profile public.profiles%ROWTYPE;
  actor_role TEXT;
  target_plan public.global_plans%ROWTYPE;
  managed_regions_arr TEXT[];
  managed_zones_arr TEXT[];
  managed_groups_arr TEXT[];
  results_json JSONB;
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

  -- Prepare delegated managed scopes arrays
  managed_regions_arr := ARRAY(
    SELECT NULLIF(BTRIM(x), '')
    FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, ''), ',')) AS x
    WHERE NULLIF(BTRIM(x), '') IS NOT NULL
  );
  managed_zones_arr := ARRAY(
    SELECT NULLIF(BTRIM(x), '')
    FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, ''), ',')) AS x
    WHERE NULLIF(BTRIM(x), '') IS NOT NULL
  );
  managed_groups_arr := ARRAY(
    SELECT NULLIF(BTRIM(x), '')
    FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, ''), ',')) AS x
    WHERE NULLIF(BTRIM(x), '') IS NOT NULL
  );

  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'profileId', candidate.id,
        'name', candidate.name,
        'email', candidate.email,
        'greatRegion', NULLIF(BTRIM(candidate.great_region), ''),
        'pastoralZone', NULLIF(BTRIM(candidate.pastoral_zone), ''),
        'smallGroup', NULLIF(BTRIM(candidate.small_group), ''),
        'isJoined', (membership.user_id IS NOT NULL),
        'teamId', team.id,
        'teamName', team.name,
        'division', membership.division,
        'memberRole', membership.member_role,
        'memberCount', (
          SELECT COUNT(*)
          FROM public.reading_team_members AS tm
          WHERE tm.team_id = team.id
        )
      )
      ORDER BY gr.sort_order NULLS LAST, pz.sort_order NULLS LAST,
        candidate.great_region, candidate.pastoral_zone, candidate.small_group, candidate.name
    ),
    '[]'::JSONB
  ) INTO results_json
  FROM public.profiles AS candidate
  LEFT JOIN public.reading_team_members AS membership
    ON membership.user_id = candidate.id
   AND membership.global_plan_id = target_plan.id
  LEFT JOIN public.reading_teams AS team
    ON team.id = membership.team_id
  LEFT JOIN public.great_regions AS gr ON gr.name = candidate.great_region
  LEFT JOIN public.pastoral_zones AS pz ON pz.name = candidate.pastoral_zone AND pz.great_region_id = gr.id
  WHERE candidate.is_active = TRUE
    AND (
      actor_role IN ('admin', 'pastor')
      OR (actor_role = 'great_zone_leader' AND candidate.great_region = ANY(managed_regions_arr))
      OR (actor_role = 'zone_leader' AND candidate.pastoral_zone = ANY(managed_zones_arr))
      OR (actor_role = 'group_leader' AND candidate.small_group = ANY(managed_groups_arr))
    );

  RETURN results_json;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_member_team_placements(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_member_team_placements(uuid, uuid) TO authenticated, service_role;

-- ── 1.7 get_unjoined_plan_members ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_unjoined_plan_members(p_global_plan_id uuid, p_plan_key text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id UUID;
  actor_profile public.profiles%ROWTYPE;
  actor_role TEXT;
  target_plan public.global_plans%ROWTYPE;
  members_json JSONB;
  reminder_key TEXT;
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
      ORDER BY gr.sort_order NULLS LAST, pz.sort_order NULLS LAST,
        candidate.great_region, candidate.pastoral_zone, candidate.small_group, candidate.name
    ),
    '[]'::JSONB
  ) INTO members_json
  FROM public.profiles AS candidate
  LEFT JOIN public.great_regions AS gr ON gr.name = candidate.great_region
  LEFT JOIN public.pastoral_zones AS pz ON pz.name = candidate.pastoral_zone AND pz.great_region_id = gr.id
  WHERE candidate.is_active = TRUE
    AND candidate.id <> actor_id
    AND (
      actor_role IN ('admin', 'pastor')
      OR (actor_role = 'great_zone_leader' AND public.values_overlap(candidate.great_region, COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, '')))
      OR (actor_role = 'zone_leader' AND public.values_overlap(candidate.pastoral_zone, COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, '')))
      OR (actor_role = 'group_leader' AND public.values_overlap(candidate.small_group, COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, '')))
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
$function$;

REVOKE ALL ON FUNCTION public.get_unjoined_plan_members(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unjoined_plan_members(uuid, text, uuid) TO authenticated, service_role;

-- ── 1.8 get_org_structure_tree ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_org_structure_tree(p_actor_id uuid, p_role_code text DEFAULT 'member'::text, p_scope_regions text[] DEFAULT ARRAY[]::text[], p_scope_zones text[] DEFAULT ARRAY[]::text[], p_scope_groups text[] DEFAULT ARRAY[]::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  resolved_actor_id      UUID;
  resolved_role_code     TEXT;
  resolved_scope_regions TEXT[];
  resolved_scope_zones   TEXT[];
  resolved_scope_groups  TEXT[];
  v_whole_church         BOOLEAN;
  v_rows                 JSONB;
  v_region_sort          JSONB := '{}'::JSONB;
  v_zone_sort            JSONB := '{}'::JSONB;
BEGIN
  IF auth.role() = 'service_role' THEN
    -- nlc-data has already verified the Logto token and resolved the
    -- caller's real role/scope from Member Hub data — trust it as given.
    resolved_actor_id      := p_actor_id;
    resolved_role_code     := COALESCE(p_role_code, 'member');
    resolved_scope_regions := COALESCE(p_scope_regions, ARRAY[]::TEXT[]);
    resolved_scope_zones   := COALESCE(p_scope_zones, ARRAY[]::TEXT[]);
    resolved_scope_groups  := COALESCE(p_scope_groups, ARRAY[]::TEXT[]);
  ELSE
    -- Any direct caller (authenticated/anon over PostgREST) never gets to
    -- claim a role or scope — forced to their own session identity and the
    -- narrowest ("just me") view, no matter what it passes.
    resolved_actor_id      := public.current_profile_id();
    resolved_role_code     := 'member';
    resolved_scope_regions := ARRAY[]::TEXT[];
    resolved_scope_zones   := ARRAY[]::TEXT[];
    resolved_scope_groups  := ARRAY[]::TEXT[];
  END IF;

  v_whole_church := resolved_role_code IN ('admin', 'pastor');

  IF resolved_actor_id IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::JSONB, 'regionSort', v_region_sort, 'zoneSort', v_zone_sort);
  END IF;

  SELECT COALESCE(
           jsonb_agg(DISTINCT jsonb_build_object(
             'great_region',  profile.great_region,
             'pastoral_zone', profile.pastoral_zone,
             'small_group',   profile.small_group
           )),
           '[]'::JSONB
         )
    INTO v_rows
  FROM public.profiles profile
  WHERE COALESCE(BTRIM(profile.great_region), '') <> ''
    AND (
      v_whole_church
      OR profile.id = resolved_actor_id
      OR (
        profile.is_active = TRUE AND (
             (resolved_role_code = 'great_zone_leader' AND profile.great_region  = ANY(resolved_scope_regions))
          OR (resolved_role_code = 'zone_leader'        AND profile.pastoral_zone = ANY(resolved_scope_zones))
          OR (resolved_role_code = 'group_leader'       AND profile.small_group   = ANY(resolved_scope_groups))
        )
      )
    );

  -- sort_order 表（migration 0133）在舊環境可能還沒有——抓不到就回空物件，
  -- 前端會自動退回字母排序。
  BEGIN
    SELECT COALESCE(jsonb_object_agg(name, sort_order), '{}'::JSONB) INTO v_region_sort FROM public.great_regions;
  EXCEPTION WHEN undefined_table THEN v_region_sort := '{}'::JSONB;
  END;
  BEGIN
    SELECT COALESCE(jsonb_object_agg(name, sort_order), '{}'::JSONB) INTO v_zone_sort FROM public.pastoral_zones;
  EXCEPTION WHEN undefined_table THEN v_zone_sort := '{}'::JSONB;
  END;

  RETURN jsonb_build_object('rows', v_rows, 'regionSort', v_region_sort, 'zoneSort', v_zone_sort);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_org_structure_tree(uuid, text, text[], text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_structure_tree(uuid, text, text[], text[], text[]) TO authenticated, service_role;

-- ── 1.9 get_joined_plan_members ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_joined_plan_members(p_global_plan_id uuid, p_plan_key text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.get_joined_plan_members(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_joined_plan_members(uuid, text, uuid) TO authenticated, service_role;

-- ── 2. member_reading_summary：拿掉 WHERE profile.is_demo = FALSE ────────────
-- 欄位名稱、型別、順序都跟現在一樣；WITH 重寫 security_invoker，授權由 CREATE OR REPLACE 保留。
CREATE OR REPLACE VIEW public.member_reading_summary
WITH (security_invoker = on) AS
SELECT
  profile.id AS user_id,
  profile.name,
  profile.role_id,
  definition.code AS role_code,
  definition.label AS role_label,
  profile.great_region,
  profile.pastoral_zone,
  profile.small_group,
  COUNT(DISTINCT plan.id) AS plan_count,
  COUNT(log.id) AS log_count,
  MAX(log.read_at) AS last_read_at
FROM public.profiles AS profile
JOIN public.role_definitions AS definition ON definition.id = profile.role_id
LEFT JOIN public.reading_plans AS plan ON plan.user_id = profile.id
LEFT JOIN public.reading_logs AS log ON log.user_id = profile.id
GROUP BY profile.id, profile.name, profile.role_id, definition.code, definition.label,
         profile.great_region, profile.pastoral_zone, profile.small_group;

-- ── 3. 限制 ─────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT profiles_no_demo;

-- ── 4. 索引 ─────────────────────────────────────────────────────────────────
DROP INDEX public.idx_profiles_is_demo;

-- 部分索引：先建新的（暫時名稱）再刪舊的，最後改回原名，中間不會沒有索引可用。
CREATE INDEX idx_profiles_active_great_region_263
  ON public.profiles USING btree (great_region)
  WHERE is_active = TRUE;
DROP INDEX public.idx_profiles_active_great_region;
ALTER INDEX public.idx_profiles_active_great_region_263 RENAME TO idx_profiles_active_great_region;
COMMENT ON INDEX public.idx_profiles_active_great_region IS
  'Supports server-side great-region permission scope filtering without scanning all profiles.';

CREATE INDEX idx_profiles_active_zone_group_263
  ON public.profiles USING btree (pastoral_zone, small_group)
  WHERE is_active = TRUE;
DROP INDEX public.idx_profiles_active_zone_group;
ALTER INDEX public.idx_profiles_active_zone_group_263 RENAME TO idx_profiles_active_zone_group;

-- ── 5. 刪欄位（不加 CASCADE：還有東西依賴就直接失敗）────────────────────────
ALTER TABLE public.profiles DROP COLUMN is_demo;

-- ── 6. 檢查 ─────────────────────────────────────────────────────────────────
DO $verify_is_demo_removed$
DECLARE
  leftovers TEXT;
  offenders TEXT;
BEGIN
  SELECT string_agg(item, ', ' ORDER BY item)
  INTO leftovers
  FROM (
    SELECT 'function ' || p.oid::regprocedure::TEXT AS item
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc ILIKE '%is_demo%'
    UNION ALL
    SELECT 'view ' || viewname FROM pg_views
    WHERE schemaname = 'public' AND definition ILIKE '%is_demo%'
    UNION ALL
    SELECT 'matview ' || matviewname FROM pg_matviews
    WHERE schemaname = 'public' AND definition ILIKE '%is_demo%'
    UNION ALL
    SELECT 'index ' || indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexdef ILIKE '%is_demo%'
    UNION ALL
    SELECT 'constraint ' || c.conname
    FROM pg_constraint AS c
    JOIN pg_namespace AS n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND pg_get_constraintdef(c.oid) ILIKE '%is_demo%'
    UNION ALL
    SELECT 'policy ' || tablename || '.' || policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND (COALESCE(qual, '') ILIKE '%is_demo%' OR COALESCE(with_check, '') ILIKE '%is_demo%')
    UNION ALL
    SELECT 'column ' || table_name || '.' || column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'is_demo'
  ) AS found;

  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'is_demo is still referenced: %', leftovers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_profiles_active_great_region'
      AND indexdef ILIKE '%(great_region) WHERE (is_active = true)%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_profiles_active_zone_group'
      AND indexdef ILIKE '%(pastoral_zone, small_group) WHERE (is_active = true)%'
  ) THEN
    RAISE EXCEPTION 'partial indexes idx_profiles_active_great_region / idx_profiles_active_zone_group were not rebuilt';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.member_reading_summary'::regclass
      AND 'security_invoker=on' = ANY(reloptions)
  ) THEN
    RAISE EXCEPTION 'member_reading_summary lost security_invoker';
  END IF;

  SELECT string_agg(p.oid::regprocedure::TEXT, ', ' ORDER BY p.proname)
  INTO offenders
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'anon can still execute public functions: %', offenders;
  END IF;
END;
$verify_is_demo_removed$;
