-- Let the captain carry the previous-stage roster into an open next stage.
-- The operation is transactional and idempotent per source team and target plan.

BEGIN;

ALTER TABLE public.reading_teams
  ADD COLUMN IF NOT EXISTS carried_from_team_id UUID
  REFERENCES public.reading_teams(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_teams_one_carryover_per_stage
  ON public.reading_teams(global_plan_id, carried_from_team_id)
  WHERE carried_from_team_id IS NOT NULL;

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
    AND plan_kind = 'church_campaign_stage'
    AND is_hidden = FALSE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'target_stage_not_open');
  END IF;

  target_stage_no := NULLIF(target_plan.rules->>'stageNo', '')::INTEGER;
  IF target_stage_no IS NULL OR target_stage_no <= 1 THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'previous_stage_not_found');
  END IF;
  source_stage_no := target_stage_no - 1;

  SELECT source_plan.id INTO source_plan_id
  FROM public.global_plans source_plan
  WHERE source_plan.plan_kind = 'church_campaign_stage'
    AND NULLIF(source_plan.rules->>'stageNo', '')::INTEGER = source_stage_no
    AND COALESCE(source_plan.rules->>'parentCampaignId', '')
      = COALESCE(target_plan.rules->>'parentCampaignId', '')
  ORDER BY source_plan.published_at DESC NULLS LAST
  LIMIT 1;

  IF source_plan_id IS NULL THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'previous_stage_not_found');
  END IF;

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
  source_stage_no INTEGER;
  source_team RECORD;
  target_team public.reading_teams%ROWTYPE;
  generated_code TEXT;
  carried_teams JSONB := '[]'::JSONB;
  carried_member_count INTEGER := 0;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  SELECT * INTO target_plan
  FROM public.global_plans
  WHERE id = p_target_global_plan_id
    AND plan_kind = 'church_campaign_stage'
    AND is_hidden = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'target_stage_not_open'; END IF;

  target_stage_no := NULLIF(target_plan.rules->>'stageNo', '')::INTEGER;
  IF target_stage_no IS NULL OR target_stage_no <= 1 THEN
    RAISE EXCEPTION 'previous_stage_not_found';
  END IF;
  source_stage_no := target_stage_no - 1;

  SELECT source_plan.id INTO source_plan_id
  FROM public.global_plans source_plan
  WHERE source_plan.plan_kind = 'church_campaign_stage'
    AND NULLIF(source_plan.rules->>'stageNo', '')::INTEGER = source_stage_no
    AND COALESCE(source_plan.rules->>'parentCampaignId', '')
      = COALESCE(target_plan.rules->>'parentCampaignId', '')
  ORDER BY source_plan.published_at DESC NULLS LAST
  LIMIT 1;

  IF source_plan_id IS NULL THEN RAISE EXCEPTION 'previous_stage_not_found'; END IF;

  FOR source_team IN
    SELECT
      team.*,
      (
        SELECT COUNT(*)::INTEGER
        FROM public.reading_team_members member
        WHERE member.team_id = team.id
      ) AS member_count
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
      IF EXISTS (
        SELECT 1
        FROM public.reading_team_members source_member
        JOIN public.reading_team_members target_membership
          ON target_membership.user_id = source_member.user_id
         AND target_membership.global_plan_id = p_target_global_plan_id
         AND target_membership.division = source_team.division
        WHERE source_member.team_id = source_team.id
      ) THEN
        RAISE EXCEPTION 'team_carryover_member_conflict';
      END IF;

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
        CASE WHEN source_team.member_count = source_team.division THEN 'ready' ELSE 'forming' END,
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
      WHERE source_member.team_id = source_team.id;

      INSERT INTO public.reading_plans(
        user_id,
        global_plan_id,
        name,
        start_date,
        end_date,
        target_books,
        preset_key,
        level,
        current_round,
        upgrade_prompt_handled,
        is_fixed
      )
      SELECT
        source_member.user_id,
        target_plan.id,
        target_plan.name,
        target_plan.start_date,
        target_plan.end_date,
        target_plan.target_books,
        target_plan.rules->>'presetKey',
        'normal',
        1,
        FALSE,
        target_plan.is_fixed
      FROM public.reading_team_members source_member
      WHERE source_member.team_id = source_team.id
      ON CONFLICT (user_id, global_plan_id)
        WHERE global_plan_id IS NOT NULL
        DO NOTHING;

      carried_member_count := carried_member_count + source_team.member_count;
    END IF;

    carried_teams := carried_teams || jsonb_build_array(jsonb_build_object(
      'sourceTeamId', source_team.id,
      'teamId', target_team.id,
      'name', target_team.name,
      'division', target_team.division,
      'memberCount', source_team.member_count,
      'inviteCode', target_team.invite_code
    ));
  END LOOP;

  IF jsonb_array_length(carried_teams) = 0 THEN
    RAISE EXCEPTION 'team_carryover_captain_required';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'targetPlanId', target_plan.id,
    'targetStageNo', target_stage_no,
    'teams', carried_teams,
    'memberCount', carried_member_count
  );
END;
$carry_reading_teams_to_stage$;

REVOKE ALL ON FUNCTION public.get_reading_team_carryover_offer(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.carry_reading_teams_to_stage(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reading_team_carryover_offer(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.carry_reading_teams_to_stage(UUID, UUID) TO authenticated, service_role;

COMMIT;