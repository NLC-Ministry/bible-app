-- Migration 0072: Self-heal a stale reading_teams.status on join
--
-- join_reading_team_by_code (migration 0022) blocks joining on
-- `current_count >= selected_team.division OR selected_team.status = 'ready'`.
-- `current_count` is always computed fresh via COUNT(*), but `status` is a
-- cached column that only gets reset back to 'forming' by
-- remove_reading_team_member (migration 0042). A regular (non-captain)
-- member has no self-service way to leave a team at all in the current
-- design (only the captain can, and that dissolves the whole team) — so
-- under normal app usage `status` can never legitimately go stale. It can
-- only desync from a membership row being removed some other way (e.g. a
-- manual delete via the Supabase dashboard table editor), after which the
-- team is stuck reporting "full" to every future invite-code attempt no
-- matter how many members it actually has.
--
-- Fix: re-derive status from the real row count right before the
-- full-check and self-heal the stored column if it disagrees, instead of
-- trusting the cached value. This both fixes any team already stuck today
-- and makes the bug class impossible going forward, regardless of how a
-- membership row is ever removed.

CREATE OR REPLACE FUNCTION public.join_reading_team_by_code(
  p_global_plan_id UUID,
  p_invite_code TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $join_reading_team$
DECLARE
  actor_id UUID;
  selected_team public.reading_teams%ROWTYPE;
  current_count INTEGER;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);

  SELECT * INTO selected_team
  FROM public.reading_teams
  WHERE global_plan_id = p_global_plan_id
    AND invite_code = upper(btrim(COALESCE(p_invite_code, '')))
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'team_invite_not_found'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.reading_team_members
    WHERE global_plan_id = p_global_plan_id
      AND user_id = actor_id
      AND division = selected_team.division
  ) THEN RAISE EXCEPTION 'already_in_plan_division'; END IF;

  SELECT COUNT(*)::INTEGER INTO current_count
  FROM public.reading_team_members WHERE team_id = selected_team.id;

  -- Row count is always the source of truth. If a membership row was ever
  -- removed without going through remove_reading_team_member, the cached
  -- status column can be stuck at 'ready' below capacity — correct it here
  -- rather than trusting it.
  IF selected_team.status = 'ready' AND current_count < selected_team.division THEN
    UPDATE public.reading_teams SET status = 'forming' WHERE id = selected_team.id;
    selected_team.status := 'forming';
  END IF;

  IF current_count >= selected_team.division OR selected_team.status = 'ready' THEN
    RAISE EXCEPTION 'reading_team_full';
  END IF;

  INSERT INTO public.reading_team_members(team_id, global_plan_id, user_id, division, member_role)
  VALUES (selected_team.id, p_global_plan_id, actor_id, selected_team.division, 'member');
  current_count := current_count + 1;

  IF current_count = selected_team.division THEN
    UPDATE public.reading_teams SET status = 'ready' WHERE id = selected_team.id;
  END IF;

  RETURN jsonb_build_object(
    'teamId', selected_team.id,
    'division', selected_team.division,
    'memberCount', current_count,
    'capacity', selected_team.division,
    'status', CASE WHEN current_count = selected_team.division THEN 'ready' ELSE 'forming' END
  );
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'already_in_plan_division';
END;
$join_reading_team$;

REVOKE ALL ON FUNCTION public.join_reading_team_by_code(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_reading_team_by_code(UUID, TEXT, UUID) TO authenticated, service_role;

-- One-time repair for any team already stuck today, so affected members
-- don't have to wait for someone to trigger the self-heal above.
UPDATE public.reading_teams team
SET status = 'forming'
WHERE team.status = 'ready'
  AND (
    SELECT COUNT(*) FROM public.reading_team_members member WHERE member.team_id = team.id
  ) < team.division;
