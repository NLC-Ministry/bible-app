-- Personal plan-ranking summary available to every authenticated participant.
-- The function calculates against all active church participants while returning
-- only the caller's ranks and aggregate counts, never another member's identity.

CREATE OR REPLACE FUNCTION public.get_personal_plan_ranking_summary(
  p_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_personal_plan_ranking_summary$
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
    WHERE profile.is_demo = FALSE
      AND COALESCE(profile.is_active, TRUE) = TRUE
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
$get_personal_plan_ranking_summary$;

REVOKE ALL ON FUNCTION public.get_personal_plan_ranking_summary(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_personal_plan_ranking_summary(UUID, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_personal_plan_ranking_summary(UUID, UUID) IS
  'Returns the caller personal church and pastoral-zone plan ranks without exposing other member identities.';
