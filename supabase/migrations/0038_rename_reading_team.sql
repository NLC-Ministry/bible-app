-- Migration 0038: Support renaming reading teams securely for captains and admins

CREATE OR REPLACE FUNCTION public.rename_reading_team(
  p_team_id UUID,
  p_name TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $rename_reading_team$
DECLARE
  actor_id UUID;
  selected_team public.reading_teams%ROWTYPE;
  actor_role TEXT;
  clean_name TEXT;
  violated_constraint TEXT;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT role INTO actor_role FROM public.profiles WHERE id = actor_id;

  SELECT * INTO selected_team FROM public.reading_teams WHERE id = p_team_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reading_team_not_found'; END IF;

  IF selected_team.captain_id <> actor_id AND actor_role <> 'admin' THEN
    RAISE EXCEPTION 'team_captain_required';
  END IF;

  IF NOT public.is_safe_reading_team_name(p_name) THEN
    RAISE EXCEPTION 'invalid_team_name';
  END IF;
  clean_name := regexp_replace(btrim(p_name), '[[:space:]]+', ' ', 'g');

  -- Lock and check for duplicate team name within the same plan and division
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      selected_team.global_plan_id::TEXT || ':' || selected_team.division::TEXT || ':'
        || public.normalize_reading_team_name(clean_name),
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM public.reading_teams AS team
    WHERE team.global_plan_id = selected_team.global_plan_id
      AND team.division = selected_team.division
      AND team.id <> p_team_id
      AND public.normalize_reading_team_name(team.name)
        = public.normalize_reading_team_name(clean_name)
  ) THEN
    RAISE EXCEPTION 'duplicate_team_name';
  END IF;

  UPDATE public.reading_teams
  SET name = clean_name,
      updated_at = NOW()
  WHERE id = p_team_id;

  RETURN jsonb_build_object(
    'teamId', p_team_id,
    'name', clean_name
  );
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint = 'idx_reading_teams_plan_division_normalized_name' THEN
      RAISE EXCEPTION 'duplicate_team_name';
    END IF;
    RAISE EXCEPTION 'duplicate_team_name';
END;
$rename_reading_team$;

REVOKE ALL ON FUNCTION public.rename_reading_team(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_reading_team(UUID, TEXT, UUID) TO authenticated, service_role;
