-- ============================================================================
-- 20260928120418_carryover_single_division.sql  —  #321
--
-- 帶隊入口改到「下一個計畫」的加入團隊視窗與加入計畫時的提示，每支隊伍一顆按鈕，
-- 按哪隊就只帶哪隊。carry_reading_teams_to_stage 加上 p_division：
--   NULL（預設）＝ 跟以前一樣，一次帶隊長在上一個計畫的所有組別（舊版前端照舊可用）
--   3 / 6       ＝ 只帶那一組
--
-- 參數數量改變，要先 DROP 舊的兩參數版本；只留一個版本，PostgREST 才不會因為
-- 同名多載而選不到函式。函式本體取自 20260928101011，只多了 p_division 條件。
-- ============================================================================

DROP FUNCTION IF EXISTS public.carry_reading_teams_to_stage(UUID, UUID);

CREATE OR REPLACE FUNCTION public.carry_reading_teams_to_stage(
  p_target_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL,
  p_division INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $carry_reading_teams_to_stage$
DECLARE
  actor_id UUID;
  target_plan public.global_plans%ROWTYPE;
  source_plan_id UUID;
  target_stage_no INTEGER;
  source_team RECORD;
  target_team public.reading_teams%ROWTYPE;
  generated_code TEXT;
  carried_teams JSONB := '[]'::JSONB;
  skipped_teams JSONB := '[]'::JSONB;
  carried_member_count INTEGER := 0;
  captain_conflict BOOLEAN;
  captain_block_reason TEXT;
  skipped_members JSONB;
  carried_count INTEGER;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  SELECT * INTO target_plan
  FROM public.global_plans
  WHERE id = p_target_global_plan_id
    AND public.is_campaign_stage_kind(plan_kind)
    AND is_hidden = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'target_stage_not_open'; END IF;

  target_stage_no := NULLIF(target_plan.rules->>'stageNo', '')::INTEGER;
  source_plan_id := public.previous_campaign_stage_plan_id(target_plan.id);

  IF source_plan_id IS NULL THEN RAISE EXCEPTION 'previous_stage_not_found'; END IF;

  FOR source_team IN
    SELECT team.*
    FROM public.reading_teams team
    JOIN public.reading_team_members captain_membership
      ON captain_membership.team_id = team.id
     AND captain_membership.global_plan_id = team.global_plan_id
     AND captain_membership.division = team.division
    WHERE team.global_plan_id = source_plan_id
      AND team.captain_id = actor_id
      AND captain_membership.user_id = actor_id
      AND captain_membership.member_role = 'captain'
      AND (p_division IS NULL OR team.division = p_division)
    ORDER BY team.division
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_target_global_plan_id::TEXT || ':' || source_team.id::TEXT,
        0
      )
    );

    SELECT * INTO target_team
    FROM public.reading_teams
    WHERE global_plan_id = p_target_global_plan_id
      AND carried_from_team_id = source_team.id
    FOR UPDATE;

    IF NOT FOUND THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.reading_team_members target_membership
        WHERE target_membership.global_plan_id = p_target_global_plan_id
          AND target_membership.user_id = actor_id
          AND target_membership.division = source_team.division
      ) INTO captain_conflict;

      IF captain_conflict THEN
        skipped_teams := skipped_teams || jsonb_build_array(jsonb_build_object(
          'sourceTeamId', source_team.id,
          'name', source_team.name,
          'division', source_team.division,
          'reason', 'captain_already_in_target'
        ));
        CONTINUE;
      END IF;

      -- 隊長自己不能加入目標計畫（例如沒設牧區）→ 這組的隊伍帶不過去。
      captain_block_reason := public.campaign_stage_join_block_reason(p_target_global_plan_id, actor_id);
      IF captain_block_reason IS NOT NULL THEN
        skipped_teams := skipped_teams || jsonb_build_array(jsonb_build_object(
          'sourceTeamId', source_team.id,
          'name', source_team.name,
          'division', source_team.division,
          'reason', captain_block_reason
        ));
        CONTINUE;
      END IF;

      -- 略過的隊員：已在目標計畫同組別加入別隊，或不符合加入條件（牧區／對象大區）。
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'userId', blocked.user_id,
          'name', blocked.name,
          'reason', blocked.reason
        )), '[]'::JSONB)
        INTO skipped_members
      FROM (
        SELECT
          source_member.user_id,
          profile.name,
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM public.reading_team_members target_membership
              WHERE target_membership.user_id = source_member.user_id
                AND target_membership.global_plan_id = p_target_global_plan_id
                AND target_membership.division = source_team.division
            ) THEN 'already_in_target_team'
            ELSE public.campaign_stage_join_block_reason(p_target_global_plan_id, source_member.user_id)
          END AS reason
        FROM public.reading_team_members source_member
        JOIN public.profiles profile ON profile.id = source_member.user_id
        WHERE source_member.team_id = source_team.id
          AND source_member.user_id <> actor_id
      ) blocked
      WHERE blocked.reason IS NOT NULL;

      LOOP
        generated_code := upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 10));
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.reading_teams WHERE invite_code = generated_code
        );
      END LOOP;

      INSERT INTO public.reading_teams(
        global_plan_id,
        division,
        name,
        captain_id,
        invite_code,
        status,
        carried_from_team_id
      ) VALUES (
        p_target_global_plan_id,
        source_team.division,
        source_team.name,
        source_team.captain_id,
        generated_code,
        'forming',
        source_team.id
      )
      RETURNING * INTO target_team;

      INSERT INTO public.reading_team_members(
        team_id,
        global_plan_id,
        user_id,
        division,
        member_role,
        joined_at
      )
      SELECT
        target_team.id,
        p_target_global_plan_id,
        source_member.user_id,
        source_team.division,
        source_member.member_role,
        NOW()
      FROM public.reading_team_members source_member
      WHERE source_member.team_id = source_team.id
        AND (
          source_member.user_id = actor_id
          OR NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(skipped_members) skipped
            WHERE skipped->>'userId' = source_member.user_id::TEXT
          )
        )
      ON CONFLICT (global_plan_id, user_id, division) DO NOTHING;

      GET DIAGNOSTICS carried_count = ROW_COUNT;

      UPDATE public.reading_teams
      SET status = CASE WHEN carried_count = source_team.division THEN 'ready' ELSE 'forming' END
      WHERE id = target_team.id;

      -- reading_plans.level 已由 migration 0138 廢除（日程永遠是教會原始一遍，
      -- 靠 current_round 累加）。這裡不再寫 level 欄。
      INSERT INTO public.reading_plans(
        user_id,
        global_plan_id,
        name,
        start_date,
        end_date,
        target_books,
        preset_key,
        current_round,
        upgrade_prompt_handled,
        is_fixed
      )
      SELECT
        carried_member.user_id,
        target_plan.id,
        target_plan.name,
        target_plan.start_date,
        target_plan.end_date,
        target_plan.target_books,
        target_plan.rules->>'presetKey',
        1,
        FALSE,
        target_plan.is_fixed
      FROM public.reading_team_members carried_member
      WHERE carried_member.team_id = target_team.id
      ON CONFLICT (user_id, global_plan_id)
        WHERE global_plan_id IS NOT NULL
        DO NOTHING;

      carried_member_count := carried_member_count + carried_count;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'userId', source_member.user_id,
          'name', profile.name,
          'reason', COALESCE(
            public.campaign_stage_join_block_reason(p_target_global_plan_id, source_member.user_id),
            'already_in_target_team'
          )
        )), '[]'::JSONB)
        INTO skipped_members
      FROM public.reading_team_members source_member
      JOIN public.profiles profile ON profile.id = source_member.user_id
      WHERE source_member.team_id = source_team.id
        AND NOT EXISTS (
          SELECT 1 FROM public.reading_team_members target_membership
          WHERE target_membership.team_id = target_team.id
            AND target_membership.user_id = source_member.user_id
        );

      SELECT COUNT(*)::INTEGER INTO carried_count
      FROM public.reading_team_members
      WHERE team_id = target_team.id;
    END IF;

    carried_teams := carried_teams || jsonb_build_array(jsonb_build_object(
      'sourceTeamId', source_team.id,
      'teamId', target_team.id,
      'name', target_team.name,
      'division', target_team.division,
      'memberCount', carried_count,
      'inviteCode', target_team.invite_code,
      'skippedMembers', skipped_members
    ));
  END LOOP;

  IF jsonb_array_length(carried_teams) = 0 THEN
    IF jsonb_array_length(skipped_teams) > 0 THEN
      RETURN jsonb_build_object(
        'success', TRUE,
        'targetPlanId', target_plan.id,
        'targetPlanName', target_plan.name,
        'targetStageNo', target_stage_no,
        'teams', carried_teams,
        'skippedTeams', skipped_teams,
        'memberCount', 0
      );
    END IF;
    RAISE EXCEPTION 'team_carryover_captain_required';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'targetPlanId', target_plan.id,
    'targetPlanName', target_plan.name,
    'targetStageNo', target_stage_no,
    'teams', carried_teams,
    'skippedTeams', skipped_teams,
    'memberCount', carried_member_count
  );
END;
$carry_reading_teams_to_stage$;

REVOKE ALL ON FUNCTION public.carry_reading_teams_to_stage(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carry_reading_teams_to_stage(UUID, UUID, INTEGER) TO authenticated, service_role;
