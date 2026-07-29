-- Public-to-authenticated team leaderboards without exposing member identities.
-- Three-person and six-person teams are ranked independently by current-round
-- completed chapters, then by the earliest time that total was reached. Exact ties share a rank.

CREATE OR REPLACE FUNCTION public.get_reading_team_leaderboards(
  p_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_reading_team_leaderboards$
DECLARE
  leaderboards JSONB;
BEGIN
  PERFORM public.resolve_reading_team_actor(p_actor_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.global_plans AS plan
    WHERE plan.id = p_global_plan_id
      AND plan.plan_kind = 'church_campaign_stage'
  ) THEN
    RAISE EXCEPTION 'team_plan_not_found';
  END IF;

  WITH member_progress AS (
    SELECT
      team.id AS team_id,
      membership.user_id,
      COALESCE(progress.chapters_read, 0) AS chapters_read,
      progress.last_read_at
    FROM public.reading_teams AS team
    JOIN public.reading_team_members AS membership
      ON membership.team_id = team.id
     AND membership.global_plan_id = team.global_plan_id
     AND membership.division = team.division
    LEFT JOIN public.reading_plans AS plan
      ON plan.user_id = membership.user_id
     AND plan.global_plan_id = team.global_plan_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (
          WHERE reading_log.round = COALESCE(plan.current_round, 1)
        )::INTEGER AS chapters_read,
        MAX(reading_log.read_at) FILTER (
          WHERE reading_log.round = COALESCE(plan.current_round, 1)
        ) AS last_read_at
      FROM public.reading_logs AS reading_log
      WHERE reading_log.plan_id = plan.id
    ) AS progress ON TRUE
    WHERE team.global_plan_id = p_global_plan_id
  ), team_rollup AS (
    SELECT
      team.id,
      team.name,
      team.division,
      team.status,
      COUNT(member.user_id)::INTEGER AS member_count,
      COALESCE(SUM(member.chapters_read), 0)::INTEGER AS chapters_read,
      MAX(member.last_read_at) AS last_read_at
    FROM public.reading_teams AS team
    LEFT JOIN member_progress AS member ON member.team_id = team.id
    WHERE team.global_plan_id = p_global_plan_id
    GROUP BY team.id
  ), ranked_teams AS (
    SELECT
      team_rollup.*,
      RANK() OVER (
        PARTITION BY division
        ORDER BY chapters_read DESC, last_read_at ASC NULLS LAST
      )::INTEGER AS team_rank
    FROM team_rollup
  )
  SELECT jsonb_build_object(
    'division3', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ranked.id,
          'name', ranked.name,
          'division', ranked.division,
          'status', ranked.status,
          'memberCount', ranked.member_count,
          'chaptersRead', ranked.chapters_read,
          'lastReadAt', ranked.last_read_at,
          'rank', ranked.team_rank
        )
        ORDER BY ranked.chapters_read DESC,
          ranked.last_read_at ASC NULLS LAST,
          ranked.name,
          ranked.id
      )
      FROM ranked_teams AS ranked
      WHERE ranked.division = 3
    ), '[]'::JSONB),
    'division6', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ranked.id,
          'name', ranked.name,
          'division', ranked.division,
          'status', ranked.status,
          'memberCount', ranked.member_count,
          'chaptersRead', ranked.chapters_read,
          'lastReadAt', ranked.last_read_at,
          'rank', ranked.team_rank
        )
        ORDER BY ranked.chapters_read DESC,
          ranked.last_read_at ASC NULLS LAST,
          ranked.name,
          ranked.id
      )
      FROM ranked_teams AS ranked
      WHERE ranked.division = 6
    ), '[]'::JSONB)
  )
  INTO leaderboards;

  RETURN leaderboards;
END;
$get_reading_team_leaderboards$;

REVOKE ALL ON FUNCTION public.get_reading_team_leaderboards(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reading_team_leaderboards(UUID, UUID)
  TO authenticated, service_role;
