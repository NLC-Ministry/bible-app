-- ============================================================================
-- 20260928101011_carryover_next_plan_by_date.sql  —  #321
--
-- 隊長「帶隊進入下一階段」原本用 stageNo 找上一張計畫（target stageNo - 1）。
-- 0142 把第一輪期末賽拆成 9～12 月四張、全部 stageNo = 2 之後，9 月 → 10 月
-- （2 → 2）就找不到上一張，隊長看不到按鈕；10 月的上一張還會被算成 8 月。
--
-- 改成：上一張 = 同一個活動（rules.parentCampaignId）、同一個對象大區
-- （audience_regions）的階段計畫裡，開始日期早於目標、而且最接近的那一張。
-- 全教會：8 月 → 9 月 → 10 月 → …；桃園梯次：熱身賽（桃園）→ 出埃及記（桃園）→ …
--
-- 另外：0193 規定 2026-10-01 起的階段要先設定牧區，而且對象大區的限制也會
-- 逐筆檢查隊員。帶隊是一個 INSERT 帶整隊，只要一位隊員不符合就整隊失敗
-- （9 月有 33 隊有隊員沒設牧區）。改成比照 0154：不符合的隊員略過並回報原因，
-- 其他人照常帶入；隊長自己不符合 → 略過該組別的隊伍並回報原因。
--
-- 函式本體取自正式站目前版本（0058 → 0137 → 0138 → 0154），只改上面兩件事，
-- 並在回傳補上 targetPlanName／skippedMembers[].reason。
-- ============================================================================

-- 回傳某人加入某個階段計畫會被擋下的原因（NULL = 可以加入）。
-- 直接呼叫 assert_campaign_stage_open，規則只維護在那一個地方。
CREATE OR REPLACE FUNCTION public.campaign_stage_join_block_reason(
  p_target_global_plan_id UUID,
  p_profile_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $join_block_reason$
BEGIN
  PERFORM public.assert_campaign_stage_open(p_target_global_plan_id, p_profile_id);
  RETURN NULL;
EXCEPTION
  WHEN raise_exception THEN
    RETURN SQLERRM;
END;
$join_block_reason$;

REVOKE ALL ON FUNCTION public.campaign_stage_join_block_reason(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_stage_join_block_reason(UUID, UUID) TO service_role;


-- 找「帶隊的來源計畫」：同活動、同對象大區、開始日期早於目標且最接近的階段計畫。
CREATE OR REPLACE FUNCTION public.previous_campaign_stage_plan_id(p_target_global_plan_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $previous_stage_plan$
  SELECT source_plan.id
  FROM public.global_plans target_plan
  JOIN public.global_plans source_plan
    ON public.is_campaign_stage_kind(source_plan.plan_kind)
   AND source_plan.id <> target_plan.id
   AND NOT COALESCE(source_plan.rules ? 'supersededBy', FALSE) -- 0142 停用的舊第 2 階段列
   AND source_plan.start_date < target_plan.start_date
   AND source_plan.audience_regions IS NOT DISTINCT FROM target_plan.audience_regions
   AND COALESCE(source_plan.rules->>'parentCampaignId', '')
     = COALESCE(target_plan.rules->>'parentCampaignId', '')
  WHERE target_plan.id = p_target_global_plan_id
  ORDER BY source_plan.start_date DESC, source_plan.is_hidden ASC, source_plan.published_at DESC NULLS LAST
  LIMIT 1;
$previous_stage_plan$;

REVOKE ALL ON FUNCTION public.previous_campaign_stage_plan_id(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.previous_campaign_stage_plan_id(UUID) TO service_role;


CREATE OR REPLACE FUNCTION public.get_reading_team_carryover_offer(
  p_target_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_reading_team_carryover_offer$
DECLARE
  actor_id UUID;
  target_plan public.global_plans%ROWTYPE;
  source_plan_id UUID;
  target_stage_no INTEGER;
  source_stage_no INTEGER;
  team_summaries JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  SELECT * INTO target_plan
  FROM public.global_plans
  WHERE id = p_target_global_plan_id
    AND public.is_campaign_stage_kind(plan_kind)
    AND is_hidden = FALSE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'target_stage_not_open');
  END IF;

  source_plan_id := public.previous_campaign_stage_plan_id(target_plan.id);

  IF source_plan_id IS NULL THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'previous_stage_not_found');
  END IF;

  target_stage_no := NULLIF(target_plan.rules->>'stageNo', '')::INTEGER;
  SELECT NULLIF(rules->>'stageNo', '')::INTEGER INTO source_stage_no
  FROM public.global_plans WHERE id = source_plan_id;

  SELECT COALESCE(jsonb_agg(eligible.team_summary ORDER BY eligible.division), '[]'::JSONB)
    INTO team_summaries
  FROM (
    SELECT
      source_team.division,
      jsonb_build_object(
        'sourceTeamId', source_team.id,
        'name', source_team.name,
        'division', source_team.division,
        'memberCount', (
          SELECT COUNT(*)::INTEGER
          FROM public.reading_team_members source_member
          WHERE source_member.team_id = source_team.id
        )
      ) AS team_summary
    FROM public.reading_teams source_team
    JOIN public.reading_team_members own_membership
      ON own_membership.team_id = source_team.id
     AND own_membership.global_plan_id = source_team.global_plan_id
     AND own_membership.division = source_team.division
    WHERE source_team.global_plan_id = source_plan_id
      AND source_team.captain_id = actor_id
      AND own_membership.user_id = actor_id
      AND own_membership.member_role = 'captain'
      AND NOT EXISTS (
        SELECT 1
        FROM public.reading_team_members target_membership
        WHERE target_membership.global_plan_id = p_target_global_plan_id
          AND target_membership.user_id = actor_id
          AND target_membership.division = source_team.division
      )
  ) eligible;

  RETURN jsonb_build_object(
    'eligible', jsonb_array_length(team_summaries) > 0,
    'sourcePlanId', source_plan_id,
    'sourceStageNo', source_stage_no,
    'targetPlanId', target_plan.id,
    'targetStageNo', target_stage_no,
    'targetPlanName', target_plan.name,
    'teams', team_summaries
  );
END;
$get_reading_team_carryover_offer$;

REVOKE ALL ON FUNCTION public.get_reading_team_carryover_offer(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reading_team_carryover_offer(UUID, UUID) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.carry_reading_teams_to_stage(
  p_target_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
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

REVOKE ALL ON FUNCTION public.carry_reading_teams_to_stage(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carry_reading_teams_to_stage(UUID, UUID) TO authenticated, service_role;
