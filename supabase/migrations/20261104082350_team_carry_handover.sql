-- ============================================================================
-- 20261104082350_team_carry_handover.sql  —  #678
--
-- 每個月初都有隊伍接不上：隊伍不會自動延續，只有上個月的隊長本人能帶。
-- 這裡補上隊長不在、隊長已另組隊伍時的出路：
--   · get_reading_team_carry_status：登入者在開放中階段的帶隊狀態（首頁、計畫卡片共用這一支）
--   · take_over_reading_team_carry：階段開始滿 3 天還沒帶入，原隊員接手當新隊長，原隊長不會被加入
--   · backfill_reading_team_from_source：隊長自己的隊還有空位時，把上月隊員補進來
--   · join_carried_reading_team：隊伍已被帶入，原隊長（或被略過的隊員）一鍵加入
--   · carry_reading_teams_to_stage：多一個 p_team_name；原隊名被用走時回報要改名，不再整筆失敗；
--     隊伍已被帶入時明確回報，不再假裝帶隊成功
--
-- 接手的等待天數只在 reading_team_takeover_opens_on 一處，要調整就改這支。
--
-- 舊前端照常可用：carry 多的參數有預設值，原本的呼叫不受影響。
-- 新 RPC 要加進 nlc-data 的白名單，上線要部署 nlc-data。
-- ============================================================================

-- 接手開放日：階段開始滿 3 天（12/01 開始 → 12/04 起可以接手）。
CREATE OR REPLACE FUNCTION public.reading_team_takeover_opens_on(p_start_date DATE)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $reading_team_takeover_opens_on$
  SELECT p_start_date + 3;
$reading_team_takeover_opens_on$;

REVOKE ALL ON FUNCTION public.reading_team_takeover_opens_on(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reading_team_takeover_opens_on(DATE) TO service_role;


-- 來源隊伍裡，可以帶進目標計畫的人。依加入順序排，reason 是 NULL 的會帶入，其餘是略過原因。
-- 預覽（確認畫面的名單）和實際帶入（_reading_team_fill_from_source）都用這一份，兩邊才不會說的不一樣。
CREATE OR REPLACE FUNCTION public._reading_team_carry_candidates(
  p_target_plan_id UUID,
  p_source_team_id UUID,
  p_division INTEGER,
  p_exclude_user_ids UUID[],
  p_into_team_id UUID,
  p_slots INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reading_team_carry_candidates$
DECLARE
  v_member RECORD;
  v_reason TEXT;
  v_slots_left INTEGER := GREATEST(COALESCE(p_slots, 0), 0);
  v_candidates JSONB := '[]'::JSONB;
BEGIN
  FOR v_member IN
    SELECT source_member.user_id, profile.name
    FROM public.reading_team_members source_member
    JOIN public.profiles profile ON profile.id = source_member.user_id
    WHERE source_member.team_id = p_source_team_id
      AND source_member.user_id <> ALL(COALESCE(p_exclude_user_ids, '{}'::UUID[]))
      AND NOT EXISTS (
        SELECT 1 FROM public.reading_team_members already_here
        WHERE already_here.team_id = p_into_team_id
          AND already_here.user_id = source_member.user_id
      )
    ORDER BY source_member.joined_at, source_member.user_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.reading_team_members target_membership
      WHERE target_membership.global_plan_id = p_target_plan_id
        AND target_membership.user_id = v_member.user_id
        AND target_membership.division = p_division
    ) THEN
      v_reason := 'already_in_target_team';
    ELSE
      v_reason := public.campaign_stage_join_block_reason(p_target_plan_id, v_member.user_id);
    END IF;

    IF v_reason IS NULL THEN
      IF v_slots_left <= 0 THEN
        v_reason := 'team_full';
      ELSE
        v_slots_left := v_slots_left - 1;
      END IF;
    END IF;

    v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
      'userId', v_member.user_id,
      'name', v_member.name,
      'reason', v_reason
    ));
  END LOOP;

  RETURN v_candidates;
END;
$reading_team_carry_candidates$;

REVOKE ALL ON FUNCTION public._reading_team_carry_candidates(UUID, UUID, INTEGER, UUID[], UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reading_team_carry_candidates(UUID, UUID, INTEGER, UUID[], UUID, INTEGER) TO service_role;


-- 替這個人加入計畫（已加入就不動）。欄位同 carry_reading_teams_to_stage。
CREATE OR REPLACE FUNCTION public._reading_team_enroll_member(
  p_target_plan_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $reading_team_enroll_member$
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
    p_user_id,
    target_plan.id,
    target_plan.name,
    target_plan.start_date,
    target_plan.end_date,
    target_plan.target_books,
    target_plan.rules->>'presetKey',
    1,
    FALSE,
    target_plan.is_fixed
  FROM public.global_plans target_plan
  WHERE target_plan.id = p_target_plan_id
  ON CONFLICT (user_id, global_plan_id)
    WHERE global_plan_id IS NOT NULL
    DO NOTHING;
$reading_team_enroll_member$;

REVOKE ALL ON FUNCTION public._reading_team_enroll_member(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reading_team_enroll_member(UUID, UUID) TO service_role;


-- 從來源隊伍補人進這支隊，補到額滿為止；回傳帶入人數與略過名單。
CREATE OR REPLACE FUNCTION public._reading_team_fill_from_source(
  p_team_id UUID,
  p_source_team_id UUID,
  p_exclude_user_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reading_team_fill_from_source$
DECLARE
  v_team public.reading_teams%ROWTYPE;
  v_member_count INTEGER;
  v_candidate JSONB;
  v_added_count INTEGER := 0;
  v_inserted_count INTEGER;
  v_skipped JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_team FROM public.reading_teams WHERE id = p_team_id FOR UPDATE;

  SELECT COUNT(*)::INTEGER INTO v_member_count
  FROM public.reading_team_members WHERE team_id = p_team_id;

  FOR v_candidate IN
    SELECT value FROM jsonb_array_elements(public._reading_team_carry_candidates(
      v_team.global_plan_id,
      p_source_team_id,
      v_team.division,
      p_exclude_user_ids,
      p_team_id,
      v_team.division - v_member_count
    ))
  LOOP
    IF v_candidate->>'reason' IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_array(v_candidate);
      CONTINUE;
    END IF;

    INSERT INTO public.reading_team_members(team_id, global_plan_id, user_id, division, member_role, joined_at)
    VALUES (p_team_id, v_team.global_plan_id, (v_candidate->>'userId')::UUID, v_team.division, 'member', NOW())
    ON CONFLICT (global_plan_id, user_id, division) DO NOTHING;
    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    IF v_inserted_count = 0 THEN
      -- 檢查之後才被別的路徑加進別隊。
      v_skipped := v_skipped || jsonb_build_array(
        v_candidate || jsonb_build_object('reason', 'already_in_target_team')
      );
      CONTINUE;
    END IF;

    PERFORM public._reading_team_enroll_member(v_team.global_plan_id, (v_candidate->>'userId')::UUID);
    v_added_count := v_added_count + 1;
  END LOOP;

  v_member_count := v_member_count + v_added_count;
  UPDATE public.reading_teams
  SET status = CASE WHEN v_member_count >= division THEN 'ready' ELSE 'forming' END
  WHERE id = p_team_id;

  RETURN jsonb_build_object(
    'addedCount', v_added_count,
    'memberCount', v_member_count,
    'skippedMembers', v_skipped
  );
END;
$reading_team_fill_from_source$;

REVOKE ALL ON FUNCTION public._reading_team_fill_from_source(UUID, UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reading_team_fill_from_source(UUID, UUID, UUID[]) TO service_role;


-- 隊名在「計畫＋組別」內唯一。跟 create_reading_team 拿同一把鎖，兩邊不會同時用掉同一個名字。
CREATE OR REPLACE FUNCTION public._reading_team_carry_name_taken(
  p_target_plan_id UUID,
  p_division INTEGER,
  p_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reading_team_carry_name_taken$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_target_plan_id::TEXT || ':' || p_division::TEXT || ':'
        || public.normalize_reading_team_name(p_name),
      0
    )
  );
  RETURN EXISTS (
    SELECT 1
    FROM public.reading_teams team
    WHERE team.global_plan_id = p_target_plan_id
      AND team.division = p_division
      AND public.normalize_reading_team_name(team.name) = public.normalize_reading_team_name(p_name)
  );
END;
$reading_team_carry_name_taken$;

REVOKE ALL ON FUNCTION public._reading_team_carry_name_taken(UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reading_team_carry_name_taken(UUID, INTEGER, TEXT) TO service_role;


-- 隊伍已被帶入時，給這個人看的摘要：由誰帶入、你在不在隊上、還有沒有空位。
CREATE OR REPLACE FUNCTION public._reading_team_carried_summary(
  p_team_id UUID,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $reading_team_carried_summary$
  SELECT jsonb_build_object(
    'teamId', team.id,
    'name', team.name,
    'division', team.division,
    'memberCount', member_count.total,
    'alreadyCarried', TRUE,
    'actorIsMember', EXISTS (
      SELECT 1 FROM public.reading_team_members own_row
      WHERE own_row.team_id = team.id AND own_row.user_id = p_actor_id
    ),
    'carriedByName', captain.name,
    'hasVacancy', member_count.total < team.division
  )
  FROM public.reading_teams team
  LEFT JOIN public.profiles captain ON captain.id = team.captain_id
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS total
    FROM public.reading_team_members member_row
    WHERE member_row.team_id = team.id
  ) member_count
  WHERE team.id = p_team_id;
$reading_team_carried_summary$;

REVOKE ALL ON FUNCTION public._reading_team_carried_summary(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reading_team_carried_summary(UUID, UUID) TO service_role;


-- 帶隊狀態。state：
--   carry     隊長、隊伍還沒帶入、這裡同組別還沒有隊 → 可以帶隊（還沒加入計畫也算）
--   waiting   隊員、隊伍還沒帶入、這裡同組別還沒有隊 → 看到隊長還沒帶隊，可以提醒，滿 3 天可以接手
--   carried   隊伍已被別人帶入、自己不在隊上、這裡同組別還沒有隊 → 看到由誰帶入，有空位可以加入
--   backfill  隊長在這裡自己當隊長的隊還有空位，而且上月隊員有人可以補 → 可以補帶
-- 其餘情況（已在隊上、在別隊當隊員）不列出。對象大區不符的計畫也不列出，因為本來就不能加入。
CREATE OR REPLACE FUNCTION public.get_reading_team_carry_status(
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_reading_team_carry_status$
DECLARE
  v_actor_id UUID;
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  v_stage RECORD;
  v_source RECORD;
  v_carried public.reading_teams%ROWTYPE;
  v_own_team public.reading_teams%ROWTYPE;
  v_own_role TEXT;
  v_own_count INTEGER;
  v_is_captain BOOLEAN;
  v_state TEXT;
  v_roster JSONB;
  v_block_reason TEXT;
  v_opens_on DATE;
  v_summary JSONB;
  v_entries JSONB := '[]'::JSONB;
BEGIN
  v_actor_id := public.resolve_reading_team_actor(p_actor_id);

  FOR v_stage IN
    SELECT
      stage.id,
      stage.name,
      stage.start_date,
      public.previous_campaign_stage_plan_id(stage.id) AS source_plan_id
    FROM public.global_plans stage
    WHERE public.is_campaign_stage_kind(stage.plan_kind)
      AND stage.is_hidden = FALSE
      AND stage.end_date >= v_today
      AND NOT COALESCE(stage.rules ? 'supersededBy', FALSE)
    ORDER BY stage.start_date, stage.id
  LOOP
    CONTINUE WHEN v_stage.source_plan_id IS NULL;

    FOR v_source IN
      SELECT
        team.id,
        team.name,
        team.division,
        team.captain_id,
        own_membership.member_role,
        captain.name AS captain_name,
        (
          SELECT COUNT(*)::INTEGER
          FROM public.reading_team_members source_member
          WHERE source_member.team_id = team.id
        ) AS member_count
      FROM public.reading_team_members own_membership
      JOIN public.reading_teams team ON team.id = own_membership.team_id
      LEFT JOIN public.profiles captain ON captain.id = team.captain_id
      WHERE own_membership.global_plan_id = v_stage.source_plan_id
        AND own_membership.user_id = v_actor_id
      ORDER BY team.division
    LOOP
      v_is_captain := v_source.captain_id = v_actor_id AND v_source.member_role = 'captain';

      SELECT * INTO v_carried
      FROM public.reading_teams
      WHERE global_plan_id = v_stage.id
        AND carried_from_team_id = v_source.id;

      SELECT membership.member_role INTO v_own_role
      FROM public.reading_team_members membership
      WHERE membership.global_plan_id = v_stage.id
        AND membership.user_id = v_actor_id
        AND membership.division = v_source.division;

      SELECT team.* INTO v_own_team
      FROM public.reading_teams team
      JOIN public.reading_team_members membership ON membership.team_id = team.id
      WHERE membership.global_plan_id = v_stage.id
        AND membership.user_id = v_actor_id
        AND membership.division = v_source.division;

      v_state := NULL;
      v_roster := '[]'::JSONB;
      v_own_count := 0;

      IF v_carried.id IS NOT NULL THEN
        IF v_own_role IS NULL THEN
          v_state := 'carried';
        END IF;
      ELSIF v_own_role IS NULL THEN
        IF v_is_captain THEN
          v_state := 'carry';
          v_roster := public._reading_team_carry_candidates(
            v_stage.id, v_source.id, v_source.division, ARRAY[v_actor_id], NULL, v_source.division - 1
          );
        ELSE
          v_state := 'waiting';
          v_roster := public._reading_team_carry_candidates(
            v_stage.id, v_source.id, v_source.division, ARRAY[v_actor_id, v_source.captain_id], NULL, v_source.division - 1
          );
        END IF;
      ELSIF v_is_captain
        AND v_own_role = 'captain'
        AND v_own_team.captain_id = v_actor_id
        AND v_own_team.carried_from_team_id IS NULL
      THEN
        SELECT COUNT(*)::INTEGER INTO v_own_count
        FROM public.reading_team_members
        WHERE team_id = v_own_team.id;

        IF v_own_count < v_source.division THEN
          v_roster := public._reading_team_carry_candidates(
            v_stage.id, v_source.id, v_source.division, ARRAY[]::UUID[], v_own_team.id, v_source.division - v_own_count
          );
          IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_roster) candidate
            WHERE candidate.value->>'reason' IS NULL
          ) THEN
            v_state := 'backfill';
          END IF;
        END IF;
      END IF;

      CONTINUE WHEN v_state IS NULL;

      -- 這張計畫本來就不開放給他：不要顯示帶不了的卡片。
      v_block_reason := public.campaign_stage_join_block_reason(v_stage.id, v_actor_id);
      CONTINUE WHEN v_block_reason IN ('plan_audience_restricted', 'campaign_stage_not_open');

      v_opens_on := public.reading_team_takeover_opens_on(v_stage.start_date);
      v_summary := CASE
        WHEN v_carried.id IS NOT NULL THEN public._reading_team_carried_summary(v_carried.id, v_actor_id)
        ELSE '{}'::JSONB
      END;

      v_entries := v_entries || jsonb_build_array(jsonb_build_object(
        'state', v_state,
        'role', CASE WHEN v_is_captain THEN 'captain' ELSE 'member' END,
        'targetPlanId', v_stage.id,
        'targetPlanName', v_stage.name,
        'targetStartDate', v_stage.start_date,
        'targetStarted', v_stage.start_date <= v_today,
        'sourcePlanId', v_stage.source_plan_id,
        'sourceTeamId', v_source.id,
        'name', v_source.name,
        'division', v_source.division,
        'memberCount', v_source.member_count,
        'captainId', v_source.captain_id,
        'captainName', v_source.captain_name,
        'captainJoinedTarget', EXISTS (
          SELECT 1 FROM public.reading_plans captain_plan
          WHERE captain_plan.user_id = v_source.captain_id
            AND captain_plan.global_plan_id = v_stage.id
        ),
        'carried', v_carried.id IS NOT NULL,
        'carriedTeamId', v_carried.id,
        'carriedTeamName', v_carried.name,
        'carriedByName', v_summary->>'carriedByName',
        'hasVacancy', COALESCE((v_summary->>'hasVacancy')::BOOLEAN, FALSE),
        'canTakeover', v_state = 'waiting' AND v_today >= v_opens_on,
        'takeoverOpensOn', v_opens_on,
        -- 跟 send_reading_team_reminder 的每日上限同一個判斷（plan_key＋sent_on）
        'reminderSentToday', EXISTS (
          SELECT 1 FROM public.care_reminders sent
          WHERE sent.sender_id = v_actor_id
            AND sent.recipient_id = v_source.captain_id
            AND sent.plan_key = 'reading-team:' || v_source.id::TEXT
            AND sent.sent_on = CURRENT_DATE
        ),
        'ownTeamId', CASE WHEN v_state = 'backfill' THEN v_own_team.id END,
        'ownTeamName', CASE WHEN v_state = 'backfill' THEN v_own_team.name END,
        'ownTeamVacancy', CASE WHEN v_state = 'backfill' THEN v_source.division - v_own_count END,
        'roster', v_roster
      ));
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('teams', v_entries);
END;
$get_reading_team_carry_status$;

REVOKE ALL ON FUNCTION public.get_reading_team_carry_status(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reading_team_carry_status(UUID) TO service_role;


-- 隊員接手帶隊：先按先贏。跟 carry_reading_teams_to_stage 拿同一把鎖，不會帶出兩支隊。
CREATE OR REPLACE FUNCTION public.take_over_reading_team_carry(
  p_target_global_plan_id UUID,
  p_source_team_id UUID,
  p_team_name TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $take_over_reading_team_carry$
DECLARE
  v_actor_id UUID;
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  v_target public.global_plans%ROWTYPE;
  v_source public.reading_teams%ROWTYPE;
  v_team public.reading_teams%ROWTYPE;
  v_team_name TEXT;
  v_block_reason TEXT;
  v_code TEXT;
  v_fill JSONB;
BEGIN
  v_actor_id := public.resolve_reading_team_actor(p_actor_id);

  SELECT * INTO v_target
  FROM public.global_plans
  WHERE id = p_target_global_plan_id
    AND public.is_campaign_stage_kind(plan_kind)
    AND is_hidden = FALSE
    AND end_date >= v_today;
  IF NOT FOUND THEN RAISE EXCEPTION 'target_stage_not_open'; END IF;

  SELECT * INTO v_source
  FROM public.reading_teams
  WHERE id = p_source_team_id
    AND global_plan_id = public.previous_campaign_stage_plan_id(v_target.id);
  IF NOT FOUND THEN RAISE EXCEPTION 'previous_stage_not_found'; END IF;

  -- 原隊長走帶隊，不走接手；這裡只收原隊員。
  IF v_source.captain_id = v_actor_id OR NOT EXISTS (
    SELECT 1 FROM public.reading_team_members
    WHERE team_id = v_source.id AND user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'team_takeover_member_required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_target.id::TEXT || ':' || v_source.id::TEXT, 0)
  );

  SELECT * INTO v_team
  FROM public.reading_teams
  WHERE global_plan_id = v_target.id
    AND carried_from_team_id = v_source.id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'targetPlanId', v_target.id,
      'targetPlanName', v_target.name,
      'teams', jsonb_build_array(
        public._reading_team_carried_summary(v_team.id, v_actor_id)
          || jsonb_build_object('sourceTeamId', v_source.id, 'skippedMembers', '[]'::JSONB)
      ),
      'memberCount', 0
    );
  END IF;

  IF v_today < public.reading_team_takeover_opens_on(v_target.start_date) THEN
    RAISE EXCEPTION 'team_takeover_not_open';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reading_team_members
    WHERE global_plan_id = v_target.id
      AND user_id = v_actor_id
      AND division = v_source.division
  ) THEN
    RAISE EXCEPTION 'already_in_plan_division';
  END IF;

  v_block_reason := public.campaign_stage_join_block_reason(v_target.id, v_actor_id);
  IF v_block_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_block_reason;
  END IF;

  IF p_team_name IS NOT NULL AND NOT public.is_safe_reading_team_name(p_team_name) THEN
    RAISE EXCEPTION 'invalid_team_name';
  END IF;
  v_team_name := COALESCE(regexp_replace(btrim(p_team_name), '[[:space:]]+', ' ', 'g'), v_source.name);

  IF public._reading_team_carry_name_taken(v_target.id, v_source.division, v_team_name) THEN
    RAISE EXCEPTION 'duplicate_team_name';
  END IF;

  LOOP
    v_code := upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 10));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.reading_teams WHERE invite_code = v_code);
  END LOOP;

  INSERT INTO public.reading_teams(global_plan_id, division, name, captain_id, invite_code, status, carried_from_team_id)
  VALUES (v_target.id, v_source.division, v_team_name, v_actor_id, v_code, 'forming', v_source.id)
  RETURNING * INTO v_team;

  INSERT INTO public.reading_team_members(team_id, global_plan_id, user_id, division, member_role, joined_at)
  VALUES (v_team.id, v_target.id, v_actor_id, v_source.division, 'captain', NOW());
  PERFORM public._reading_team_enroll_member(v_target.id, v_actor_id);

  -- 原隊長不會被自動加入新計畫，也不放進新隊伍。
  v_fill := public._reading_team_fill_from_source(v_team.id, v_source.id, ARRAY[v_source.captain_id]);

  RETURN jsonb_build_object(
    'success', TRUE,
    'targetPlanId', v_target.id,
    'targetPlanName', v_target.name,
    'teams', jsonb_build_array(jsonb_build_object(
      'sourceTeamId', v_source.id,
      'teamId', v_team.id,
      'name', v_team.name,
      'division', v_team.division,
      'memberCount', (v_fill->>'memberCount')::INTEGER,
      'inviteCode', v_team.invite_code,
      'skippedMembers', v_fill->'skippedMembers'
    )),
    'memberCount', (v_fill->>'memberCount')::INTEGER
  );
END;
$take_over_reading_team_carry$;

REVOKE ALL ON FUNCTION public.take_over_reading_team_carry(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_over_reading_team_carry(UUID, UUID, TEXT, UUID) TO service_role;


-- 補帶：隊長在新計畫自己當隊長的隊還有空位時，把上月隊員補進來。
-- 補進人之後把這支隊標成來源隊伍的延續，之後就不會再被接手一次。
CREATE OR REPLACE FUNCTION public.backfill_reading_team_from_source(
  p_target_global_plan_id UUID,
  p_source_team_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $backfill_reading_team_from_source$
DECLARE
  v_actor_id UUID;
  v_target public.global_plans%ROWTYPE;
  v_source public.reading_teams%ROWTYPE;
  v_own_team public.reading_teams%ROWTYPE;
  v_carried_team_id UUID;
  v_fill JSONB;
BEGIN
  v_actor_id := public.resolve_reading_team_actor(p_actor_id);

  SELECT * INTO v_target
  FROM public.global_plans
  WHERE id = p_target_global_plan_id
    AND public.is_campaign_stage_kind(plan_kind)
    AND is_hidden = FALSE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target_stage_not_open'; END IF;

  SELECT * INTO v_source
  FROM public.reading_teams
  WHERE id = p_source_team_id
    AND global_plan_id = public.previous_campaign_stage_plan_id(v_target.id);
  IF NOT FOUND THEN RAISE EXCEPTION 'previous_stage_not_found'; END IF;

  IF v_source.captain_id <> v_actor_id THEN
    RAISE EXCEPTION 'team_backfill_captain_required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_target.id::TEXT || ':' || v_source.id::TEXT, 0)
  );

  SELECT id INTO v_carried_team_id
  FROM public.reading_teams
  WHERE global_plan_id = v_target.id
    AND carried_from_team_id = v_source.id;

  SELECT team.* INTO v_own_team
  FROM public.reading_teams team
  JOIN public.reading_team_members own_membership ON own_membership.team_id = team.id
  WHERE own_membership.global_plan_id = v_target.id
    AND own_membership.user_id = v_actor_id
    AND own_membership.division = v_source.division
    AND own_membership.member_role = 'captain'
    AND team.captain_id = v_actor_id
  FOR UPDATE OF team;

  IF v_carried_team_id IS NOT NULL AND v_carried_team_id IS DISTINCT FROM v_own_team.id THEN
    RAISE EXCEPTION 'team_backfill_already_carried';
  END IF;
  IF v_own_team.id IS NULL THEN
    RAISE EXCEPTION 'team_backfill_captain_required';
  END IF;
  IF v_own_team.carried_from_team_id IS NOT NULL AND v_own_team.carried_from_team_id <> v_source.id THEN
    RAISE EXCEPTION 'team_backfill_already_carried';
  END IF;

  v_fill := public._reading_team_fill_from_source(v_own_team.id, v_source.id, ARRAY[]::UUID[]);

  IF (v_fill->>'addedCount')::INTEGER > 0 AND v_own_team.carried_from_team_id IS NULL THEN
    UPDATE public.reading_teams
    SET carried_from_team_id = v_source.id
    WHERE id = v_own_team.id;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'targetPlanId', v_target.id,
    'targetPlanName', v_target.name,
    'teamId', v_own_team.id,
    'name', v_own_team.name,
    'division', v_own_team.division,
    'addedCount', (v_fill->>'addedCount')::INTEGER,
    'memberCount', (v_fill->>'memberCount')::INTEGER,
    'skippedMembers', v_fill->'skippedMembers'
  );
END;
$backfill_reading_team_from_source$;

REVOKE ALL ON FUNCTION public.backfill_reading_team_from_source(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_reading_team_from_source(UUID, UUID, UUID) TO service_role;


-- 隊伍已被帶入：原隊長或被略過的原隊員，不用邀請碼就能加入，並一併加入計畫。
CREATE OR REPLACE FUNCTION public.join_carried_reading_team(
  p_target_global_plan_id UUID,
  p_source_team_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $join_carried_reading_team$
DECLARE
  v_actor_id UUID;
  v_target public.global_plans%ROWTYPE;
  v_team public.reading_teams%ROWTYPE;
  v_member_count INTEGER;
  v_block_reason TEXT;
BEGIN
  v_actor_id := public.resolve_reading_team_actor(p_actor_id);

  SELECT * INTO v_target
  FROM public.global_plans
  WHERE id = p_target_global_plan_id
    AND public.is_campaign_stage_kind(plan_kind)
    AND is_hidden = FALSE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target_stage_not_open'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.reading_team_members source_member
    JOIN public.reading_teams source_team ON source_team.id = source_member.team_id
    WHERE source_member.team_id = p_source_team_id
      AND source_member.user_id = v_actor_id
      AND source_team.global_plan_id = public.previous_campaign_stage_plan_id(v_target.id)
  ) THEN
    RAISE EXCEPTION 'team_join_carried_member_required';
  END IF;

  SELECT * INTO v_team
  FROM public.reading_teams
  WHERE global_plan_id = v_target.id
    AND carried_from_team_id = p_source_team_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reading_team_not_found'; END IF;

  SELECT COUNT(*)::INTEGER INTO v_member_count
  FROM public.reading_team_members WHERE team_id = v_team.id;

  IF EXISTS (
    SELECT 1 FROM public.reading_team_members
    WHERE team_id = v_team.id AND user_id = v_actor_id
  ) THEN
    RETURN jsonb_build_object(
      'teamId', v_team.id,
      'name', v_team.name,
      'division', v_team.division,
      'memberCount', v_member_count,
      'alreadyMember', TRUE
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reading_team_members
    WHERE global_plan_id = v_target.id
      AND user_id = v_actor_id
      AND division = v_team.division
  ) THEN
    RAISE EXCEPTION 'already_in_other_team';
  END IF;

  v_block_reason := public.campaign_stage_join_block_reason(v_target.id, v_actor_id);
  IF v_block_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_block_reason;
  END IF;

  IF v_member_count >= v_team.division THEN
    RAISE EXCEPTION 'reading_team_full';
  END IF;

  INSERT INTO public.reading_team_members(team_id, global_plan_id, user_id, division, member_role, joined_at)
  VALUES (v_team.id, v_target.id, v_actor_id, v_team.division, 'member', NOW());
  PERFORM public._reading_team_enroll_member(v_target.id, v_actor_id);

  v_member_count := v_member_count + 1;
  UPDATE public.reading_teams
  SET status = CASE WHEN v_member_count >= division THEN 'ready' ELSE 'forming' END
  WHERE id = v_team.id;

  RETURN jsonb_build_object(
    'teamId', v_team.id,
    'name', v_team.name,
    'division', v_team.division,
    'memberCount', v_member_count
  );
END;
$join_carried_reading_team$;

REVOKE ALL ON FUNCTION public.join_carried_reading_team(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_carried_reading_team(UUID, UUID, UUID) TO service_role;


-- 帶隊：本體取自 20261102090639，改了三處（都標了 #678）：
--   1. 多一個 p_team_name，給重名時改名用
--   2. 原隊名被用走時略過這一組並回報 duplicate_team_name，不再讓整筆交易失敗
--   3. 隊伍已被帶入時多回報由誰帶入、你在不在隊上，前端才不會顯示帶隊成功
DROP FUNCTION IF EXISTS public.carry_reading_teams_to_stage(UUID, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.carry_reading_teams_to_stage(
  p_target_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL,
  p_division INTEGER DEFAULT NULL,
  p_team_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $carry_reading_teams_to_stage$
DECLARE
  actor_id UUID;
  target_plan public.global_plans%ROWTYPE;
  v_source_plan_id UUID;
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
  v_clean_team_name TEXT;
  v_team_name TEXT;
  v_carried_summary JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  -- #678：隊名只在重名時才帶進來。
  IF p_team_name IS NOT NULL THEN
    IF NOT public.is_safe_reading_team_name(p_team_name) THEN
      RAISE EXCEPTION 'invalid_team_name';
    END IF;
    v_clean_team_name := regexp_replace(btrim(p_team_name), '[[:space:]]+', ' ', 'g');
  END IF;

  SELECT * INTO target_plan
  FROM public.global_plans
  WHERE id = p_target_global_plan_id
    AND public.is_campaign_stage_kind(plan_kind)
    AND is_hidden = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'target_stage_not_open'; END IF;

  target_stage_no := NULLIF(target_plan.rules->>'stageNo', '')::INTEGER;
  v_source_plan_id := public.previous_campaign_stage_plan_id(target_plan.id);

  IF v_source_plan_id IS NULL THEN RAISE EXCEPTION 'previous_stage_not_found'; END IF;

  FOR source_team IN
    SELECT team.*
    FROM public.reading_teams team
    JOIN public.reading_team_members captain_membership
      ON captain_membership.team_id = team.id
     AND captain_membership.global_plan_id = team.global_plan_id
     AND captain_membership.division = team.division
    WHERE team.global_plan_id = v_source_plan_id
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

      -- #678：隊名在「計畫＋組別」內唯一。被用走時請隊長改名，這組先不寫入。
      v_team_name := COALESCE(v_clean_team_name, source_team.name);
      IF public._reading_team_carry_name_taken(p_target_global_plan_id, source_team.division, v_team_name) THEN
        skipped_teams := skipped_teams || jsonb_build_array(jsonb_build_object(
          'sourceTeamId', source_team.id,
          'name', v_team_name,
          'division', source_team.division,
          'reason', 'duplicate_team_name'
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
        v_team_name,
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
      v_carried_summary := '{}'::JSONB;
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

      -- #678：隊伍可能是隊員接手帶入的，隊長這時不在隊上。
      v_carried_summary := public._reading_team_carried_summary(target_team.id, actor_id);
    END IF;

    carried_teams := carried_teams || jsonb_build_array(jsonb_build_object(
      'sourceTeamId', source_team.id,
      'teamId', target_team.id,
      'name', target_team.name,
      'division', target_team.division,
      'memberCount', carried_count,
      'inviteCode', target_team.invite_code,
      'skippedMembers', skipped_members
    ) || v_carried_summary);
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

REVOKE ALL ON FUNCTION public.carry_reading_teams_to_stage(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carry_reading_teams_to_stage(UUID, UUID, INTEGER, TEXT) TO authenticated, service_role;
