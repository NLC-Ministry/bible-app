-- Match reading-team member status with the organisation member roster.
-- This replaces only the team context RPC and leaves organisation permissions unchanged.

CREATE OR REPLACE FUNCTION public.get_my_reading_team(
  p_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_my_reading_teams$
DECLARE
  actor_id UUID;
  team_contexts JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  WITH my_teams AS (
    SELECT team.*
    FROM public.reading_teams team
    JOIN public.reading_team_members own_membership
      ON own_membership.team_id = team.id
     AND own_membership.global_plan_id = team.global_plan_id
     AND own_membership.division = team.division
    WHERE own_membership.user_id = actor_id
      AND own_membership.global_plan_id = p_global_plan_id
  ), contexts AS (
    SELECT
      selected_team.division,
      jsonb_build_object(
        'team', jsonb_build_object(
          'id', selected_team.id,
          'globalPlanId', selected_team.global_plan_id,
          'name', selected_team.name,
          'division', selected_team.division,
          'capacity', selected_team.division,
          'memberCount', (
            SELECT COUNT(*)::INTEGER
            FROM public.reading_team_members count_membership
            WHERE count_membership.team_id = selected_team.id
          ),
          'status', CASE WHEN (
            SELECT COUNT(*)
            FROM public.reading_team_members count_membership
            WHERE count_membership.team_id = selected_team.id
          ) = selected_team.division THEN 'ready' ELSE 'forming' END,
          'captainId', selected_team.captain_id,
          'inviteCode', selected_team.invite_code,
          'createdAt', selected_team.created_at
        ),
        'members', (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'userId', member_row.user_id,
              'name', member_row.name,
              'avatarUrl', member_row.avatar_url,
              'role', member_row.member_role,
              'isMe', member_row.user_id = actor_id,
              'joinedAt', member_row.joined_at,
              'hasJoinedPlan', member_row.plan_id IS NOT NULL,
              'currentRound', member_row.current_round,
              'chaptersRead', member_row.chapters_read,
              'todayRead', member_row.today_read,
              'lastReadAt', member_row.last_read_at,
              'longestStreak', member_row.longest_streak,
              'readingLogs', member_row.reading_logs
            ) ORDER BY CASE WHEN member_row.member_role = 'captain' THEN 0 ELSE 1 END, member_row.joined_at
          ), '[]'::JSONB)
          FROM (
            SELECT
              membership.user_id,
              membership.member_role,
              membership.joined_at,
              profile.name,
              profile.avatar_url,
              plan.id AS plan_id,
              COALESCE(plan.current_round, 1) AS current_round,
              COALESCE(progress.chapters_read, 0) AS chapters_read,
              COALESCE(progress.today_read, 0) AS today_read,
              progress.last_read_at,
              COALESCE(progress.longest_streak, 0) AS longest_streak,
              COALESCE(progress.reading_logs, '[]'::JSONB) AS reading_logs
            FROM public.reading_team_members membership
            JOIN public.profiles profile ON profile.id = membership.user_id
            LEFT JOIN public.reading_plans plan
              ON plan.user_id = membership.user_id
             AND plan.global_plan_id = selected_team.global_plan_id
            LEFT JOIN LATERAL (
              SELECT
                COUNT(*) FILTER (WHERE log.round = COALESCE(plan.current_round, 1))::INTEGER AS chapters_read,
                COUNT(*) FILTER (
                  WHERE log.round = COALESCE(plan.current_round, 1)
                    AND log.read_at::DATE = CURRENT_DATE
                )::INTEGER AS today_read,
                MAX(log.read_at) AS last_read_at,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'book', log.book,
                  'chapter', log.chapter,
                  'round', log.round,
                  'readAt', log.read_at
                ) ORDER BY log.read_at) FILTER (WHERE log.id IS NOT NULL), '[]'::JSONB) AS reading_logs,
                (
                  SELECT COALESCE(MAX(streak_group.streak_days), 0)::INTEGER
                  FROM (
                    SELECT COUNT(*)::INTEGER AS streak_days
                    FROM (
                      SELECT read_day,
                        read_day - (ROW_NUMBER() OVER (ORDER BY read_day))::INTEGER AS streak_key
                      FROM (
                        SELECT DISTINCT streak_log.read_at::DATE AS read_day
                        FROM public.reading_logs streak_log
                        WHERE streak_log.plan_id = plan.id
                      ) distinct_days
                    ) numbered_days
                    GROUP BY streak_key
                  ) streak_group
                ) AS longest_streak
              FROM public.reading_logs log
              WHERE log.plan_id = plan.id
            ) progress ON TRUE
            WHERE membership.team_id = selected_team.id
          ) member_row
        )
      ) AS context
    FROM my_teams selected_team
  )
  SELECT COALESCE(jsonb_agg(context ORDER BY division), '[]'::JSONB)
  INTO team_contexts
  FROM contexts;

  RETURN jsonb_build_object(
    'teams', team_contexts,
    -- Keep the first context for older clients during a rolling deployment.
    'team', team_contexts->0->'team',
    'members', COALESCE(team_contexts->0->'members', '[]'::JSONB)
  );
END;
$get_my_reading_teams$;

REVOKE ALL ON FUNCTION public.get_my_reading_team(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_reading_team(UUID, UUID) TO authenticated, service_role;
