-- Only a team captain may leave. Captain exit dissolves the whole team so no
-- team can remain without a captain. This also protects requests from old UIs.

CREATE OR REPLACE FUNCTION public.leave_reading_team(
  p_team_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $captain_leave_reading_team$
DECLARE
  actor_id UUID;
  selected_team public.reading_teams%ROWTYPE;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  SELECT *
  INTO selected_team
  FROM public.reading_teams
  WHERE id = p_team_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'reading_team_not_found'; END IF;
  IF selected_team.captain_id <> actor_id THEN
    RAISE EXCEPTION 'team_captain_required';
  END IF;

  DELETE FROM public.reading_teams WHERE id = p_team_id;
  RETURN TRUE;
END;
$captain_leave_reading_team$;

CREATE OR REPLACE FUNCTION public.disband_reading_team(
  p_team_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $captain_disband_reading_team$
DECLARE
  actor_id UUID;
  selected_team public.reading_teams%ROWTYPE;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  SELECT *
  INTO selected_team
  FROM public.reading_teams
  WHERE id = p_team_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'reading_team_not_found'; END IF;
  IF selected_team.captain_id <> actor_id THEN
    RAISE EXCEPTION 'team_captain_required';
  END IF;

  DELETE FROM public.reading_teams WHERE id = p_team_id;
  RETURN TRUE;
END;
$captain_disband_reading_team$;

CREATE OR REPLACE FUNCTION public.remove_reading_team_member(
  p_team_id UUID,
  p_member_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $remove_reading_team_member$
DECLARE
  actor_id UUID;
  selected_team public.reading_teams%ROWTYPE;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  SELECT *
  INTO selected_team
  FROM public.reading_teams
  WHERE id = p_team_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'reading_team_not_found'; END IF;
  IF selected_team.captain_id <> actor_id THEN
    RAISE EXCEPTION 'team_member_remove_captain_required';
  END IF;
  IF p_member_id = actor_id OR p_member_id = selected_team.captain_id THEN
    RAISE EXCEPTION 'team_captain_remove_self_not_allowed';
  END IF;

  DELETE FROM public.reading_team_members
  WHERE team_id = p_team_id
    AND user_id = p_member_id
    AND member_role = 'member';

  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_team_member'; END IF;

  UPDATE public.reading_teams
  SET status = 'forming'
  WHERE id = p_team_id
    AND status <> 'forming';

  RETURN TRUE;
END;
$remove_reading_team_member$;
REVOKE ALL ON FUNCTION public.leave_reading_team(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disband_reading_team(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_reading_team_member(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_reading_team(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.disband_reading_team(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_reading_team_member(UUID, UUID, UUID) TO authenticated, service_role;