-- Allow the current captain to transfer captaincy to another member of the
-- same reading team. This is intentionally captain-only: administrators do
-- not receive an override for this operation.

CREATE OR REPLACE FUNCTION public.transfer_reading_team_captain(
  p_team_id UUID,
  p_new_captain_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $transfer_reading_team_captain$
DECLARE
  actor_id UUID;
  selected_team public.reading_teams%ROWTYPE;
  new_captain_membership public.reading_team_members%ROWTYPE;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  SELECT * INTO selected_team
  FROM public.reading_teams
  WHERE id = p_team_id
  FOR UPDATE;

  IF selected_team.id IS NULL THEN
    RAISE EXCEPTION 'reading_team_not_found';
  END IF;
  IF selected_team.captain_id <> actor_id THEN
    RAISE EXCEPTION 'team_captain_transfer_required';
  END IF;
  IF p_new_captain_id = actor_id THEN
    RAISE EXCEPTION 'team_captain_transfer_same_member';
  END IF;

  SELECT * INTO new_captain_membership
  FROM public.reading_team_members
  WHERE team_id = p_team_id
    AND user_id = p_new_captain_id
    AND global_plan_id = selected_team.global_plan_id
    AND member_role = 'member'
  FOR UPDATE;

  IF new_captain_membership.user_id IS NULL THEN
    RAISE EXCEPTION 'team_captain_transfer_member_required';
  END IF;

  UPDATE public.reading_team_members
  SET member_role = 'member'
  WHERE team_id = p_team_id
    AND user_id = actor_id
    AND member_role = 'captain';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'team_captain_membership_missing';
  END IF;

  UPDATE public.reading_team_members
  SET member_role = 'captain'
  WHERE team_id = p_team_id
    AND user_id = p_new_captain_id
    AND member_role = 'member';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'team_captain_transfer_member_required';
  END IF;

  UPDATE public.reading_teams
  SET captain_id = p_new_captain_id,
      updated_at = NOW()
  WHERE id = p_team_id;

  RETURN jsonb_build_object(
    'teamId', p_team_id,
    'previousCaptainId', actor_id,
    'captainId', p_new_captain_id
  );
END;
$transfer_reading_team_captain$;

REVOKE ALL ON FUNCTION public.transfer_reading_team_captain(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_reading_team_captain(UUID, UUID, UUID) TO authenticated, service_role;
