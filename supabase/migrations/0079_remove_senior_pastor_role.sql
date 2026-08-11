-- Migration 0079: Remove senior_pastor as a separate role — it and pastor
-- were always meant to be the same role. Migration 0078 mistakenly created
-- pastor as a brand-new, distinct role_definitions row instead of renaming
-- the existing one, leaving two rows in the admin "組織架構權限總覽" list
-- (教會牧者 and 牧者), both unassigned. This migration corrects that:
-- rename the original church-pastor row in place (same UUID, so anyone
-- ever assigned senior_pastor becomes "pastor" automatically — no
-- profiles.role_id data migration needed) and delete the duplicate row
-- migration 0078 added. Every RPC/RLS check that referenced 'senior_pastor'
-- is rewritten to reference 'pastor' only — this is a rename, not an
-- addition, so the literal string 'senior_pastor' must not survive
-- anywhere in the live schema.

-- Defensive: if anything was assigned to 0078's short-lived duplicate row
-- already, move it back onto the row this migration keeps and renames.
UPDATE public.profiles
SET role_id = '10000000-0000-4000-8000-000000000005'
WHERE role_id = '10000000-0000-4000-8000-000000000007';

-- Delete the duplicate row FIRST — role_definitions.code has a UNIQUE
-- constraint, so the rename below (setting ...005's code to 'pastor')
-- would collide with 0078's row (which already has code='pastor') if that
-- row weren't gone yet.
DELETE FROM public.role_definitions WHERE id = '10000000-0000-4000-8000-000000000007';

-- Rename in place. Keep the legacy Member Hub signals (主任牧師/教會牧者/
-- senior_pastor/church_pastor) so real Hub-side leadership labels already in
-- use keep resolving to this role, and add the new pastor/牧者 signals
-- alongside them.
UPDATE public.role_definitions
SET
  code = 'pastor',
  label = '牧者',
  hub_permission_keys = ARRAY['senior_pastor', 'church_pastor', 'pastor']::TEXT[],
  hub_permission_labels = ARRAY['主任牧師', '教會牧者', '牧者']::TEXT[]
WHERE id = '10000000-0000-4000-8000-000000000005';

-- ── can_send_care_reminder (current def: migration 0078) ──
CREATE OR REPLACE FUNCTION public.can_send_care_reminder(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $can_send_care_reminder$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS sender
    JOIN public.profiles AS recipient ON recipient.id = target_profile_id
    WHERE sender.id = public.current_profile_id()
      AND sender.id <> recipient.id
      AND recipient.is_active = TRUE
      AND (
        public.role_code(sender.role_id) IN ('admin', 'pastor')
        OR (
          public.role_code(sender.role_id) = 'great_zone_leader'
          AND recipient.great_region = ANY(string_to_array(
            COALESCE(NULLIF(sender.managed_regions, ''), sender.great_region, ''), ','
          ))
        )
        OR (
          public.role_code(sender.role_id) = 'zone_leader'
          AND recipient.pastoral_zone = ANY(string_to_array(
            COALESCE(NULLIF(sender.managed_zones, ''), sender.pastoral_zone, ''), ','
          ))
        )
        OR (
          public.role_code(sender.role_id) = 'group_leader'
          AND recipient.small_group = ANY(string_to_array(
            COALESCE(NULLIF(sender.managed_groups, ''), sender.small_group, ''), ','
          ))
        )
      )
  );
$can_send_care_reminder$;

-- ── get_admin_member_team_placements (current def: migration 0078) ──
CREATE OR REPLACE FUNCTION public.get_admin_member_team_placements(
  p_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_admin_member_team_placements$
DECLARE
  actor_id UUID;
  actor_profile public.profiles%ROWTYPE;
  actor_role TEXT;
  target_plan public.global_plans%ROWTYPE;
  managed_regions_arr TEXT[];
  managed_zones_arr TEXT[];
  managed_groups_arr TEXT[];
  results_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT * INTO actor_profile FROM public.profiles WHERE id = actor_id;
  SELECT * INTO target_plan FROM public.global_plans WHERE id = p_global_plan_id;

  IF actor_profile.id IS NULL THEN
    RAISE EXCEPTION 'profile_identity_not_found';
  END IF;

  actor_role := public.role_code(actor_profile.role_id);
  IF actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'plan_management_scope_required';
  END IF;

  IF target_plan.id IS NULL THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  -- Prepare delegated managed scopes arrays
  managed_regions_arr := ARRAY(
    SELECT NULLIF(BTRIM(x), '')
    FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, ''), ',')) AS x
    WHERE NULLIF(BTRIM(x), '') IS NOT NULL
  );
  managed_zones_arr := ARRAY(
    SELECT NULLIF(BTRIM(x), '')
    FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, ''), ',')) AS x
    WHERE NULLIF(BTRIM(x), '') IS NOT NULL
  );
  managed_groups_arr := ARRAY(
    SELECT NULLIF(BTRIM(x), '')
    FROM UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, ''), ',')) AS x
    WHERE NULLIF(BTRIM(x), '') IS NOT NULL
  );

  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'profileId', candidate.id,
        'name', candidate.name,
        'email', candidate.email,
        'greatRegion', NULLIF(BTRIM(candidate.great_region), ''),
        'pastoralZone', NULLIF(BTRIM(candidate.pastoral_zone), ''),
        'smallGroup', NULLIF(BTRIM(candidate.small_group), ''),
        'isJoined', (membership.user_id IS NOT NULL),
        'teamId', team.id,
        'teamName', team.name,
        'division', membership.division,
        'memberRole', membership.member_role,
        'memberCount', (
          SELECT COUNT(*)
          FROM public.reading_team_members AS tm
          WHERE tm.team_id = team.id
        )
      )
      ORDER BY candidate.great_region, candidate.pastoral_zone, candidate.small_group, candidate.name
    ),
    '[]'::JSONB
  ) INTO results_json
  FROM public.profiles AS candidate
  LEFT JOIN public.reading_team_members AS membership
    ON membership.user_id = candidate.id
   AND membership.global_plan_id = target_plan.id
  LEFT JOIN public.reading_teams AS team
    ON team.id = membership.team_id
  WHERE candidate.is_active = TRUE
    AND candidate.is_demo = FALSE
    AND (
      actor_role IN ('admin', 'pastor')
      OR (
        actor_role = 'great_zone_leader'
        AND (
          CARDINALITY(managed_regions_arr) = 0
          OR candidate.great_region = ANY(managed_regions_arr)
        )
      )
      OR (
        actor_role = 'zone_leader'
        AND (
          CARDINALITY(managed_zones_arr) = 0
          OR candidate.pastoral_zone = ANY(managed_zones_arr)
        )
      )
      OR (
        actor_role = 'group_leader'
        AND (
          CARDINALITY(managed_groups_arr) = 0
          OR candidate.small_group = ANY(managed_groups_arr)
        )
      )
    );

  RETURN results_json;
END;
$get_admin_member_team_placements$;

REVOKE ALL ON FUNCTION public.get_admin_member_team_placements(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_member_team_placements(UUID, UUID) TO authenticated, service_role;

-- ── get_reading_team_registration_overview (current def: migration 0078) ──
CREATE OR REPLACE FUNCTION public.get_reading_team_registration_overview(
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reading_team_registration_overview$
DECLARE
  actor_id UUID;
  actor_profile public.profiles%ROWTYPE;
  actor_role TEXT;
  plans_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT * INTO actor_profile FROM public.profiles WHERE id = actor_id;

  actor_role := public.role_code(actor_profile.role_id);

  IF actor_profile.id IS NULL
     OR actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'team_statistics_management_scope_required';
  END IF;

  WITH member_details AS (
    SELECT
      tm.team_id,
      tm.member_role,
      tm.division,
      p.id AS user_id,
      p.name,
      p.great_region,
      p.pastoral_zone,
      p.small_group
    FROM public.reading_team_members tm
    JOIN public.profiles p ON p.id = tm.user_id
  ),
  team_details AS (
    SELECT
      rt.id AS team_id,
      rt.global_plan_id,
      rt.name AS team_name,
      rt.division,
      rt.status,
      rt.created_at,
      c.pastoral_zone AS captain_pastoral_zone,
      (
        SELECT COALESCE(JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'userId', md.user_id,
            'role', md.member_role,
            'name', md.name,
            'greatRegion', md.great_region,
            'pastoralZone', md.pastoral_zone,
            'smallGroup', md.small_group
          )
        ), '[]'::JSONB)
        FROM member_details md
        WHERE md.team_id = rt.id
      ) AS members,
      (
        SELECT COUNT(*)::INT
        FROM member_details md
        WHERE md.team_id = rt.id
      ) AS member_count
    FROM public.reading_teams rt
    LEFT JOIN public.profiles c ON c.id = rt.captain_id
  ),
  scoped_teams AS (
    SELECT DISTINCT td.*
    FROM team_details td
    JOIN member_details md ON md.team_id = td.team_id
    WHERE actor_role IN ('admin', 'pastor')
       OR (actor_role = 'great_zone_leader' AND public.values_overlap(md.pastoral_zone, COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, '')))
       OR (actor_role = 'zone_leader' AND public.values_overlap(md.pastoral_zone, COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, '')))
       OR (actor_role = 'group_leader' AND public.values_overlap(md.small_group, COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, '')))
  ),
  plan_aggregates AS (
    SELECT
      gp.id AS plan_id,
      gp.name AS plan_name,
      gp.start_date,
      gp.end_date,
      COUNT(DISTINCT st.team_id)::INT AS team_count,
      COALESCE(SUM(st.member_count), 0)::INT AS member_count,
      COALESCE(JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', st.team_id,
          'name', st.team_name,
          'division', st.division,
          'status', st.status,
          'createdAt', st.created_at,
          'captainPastoralZone', st.captain_pastoral_zone,
          'memberCount', st.member_count,
          'members', st.members
        )
      ) FILTER (WHERE st.team_id IS NOT NULL), '[]'::JSONB) AS teams
    FROM public.global_plans gp
    LEFT JOIN scoped_teams st ON st.global_plan_id = gp.id
    WHERE gp.is_hidden = FALSE OR gp.plan_kind = 'church_campaign_stage'
    GROUP BY gp.id, gp.name, gp.start_date, gp.end_date
  )
  SELECT COALESCE(JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'id', pa.plan_id,
      'name', pa.plan_name,
      'startDate', pa.start_date,
      'endDate', pa.end_date,
      'teamCount', pa.team_count,
      'memberCount', pa.member_count,
      'teams', pa.teams
    )
  ), '[]'::JSONB)
  INTO plans_json
  FROM plan_aggregates pa;

  RETURN JSONB_BUILD_OBJECT(
    'summary', JSONB_BUILD_OBJECT(
      'planCount', JSONB_ARRAY_LENGTH(plans_json),
      'teamCount', (SELECT COALESCE(SUM((p->>'teamCount')::INT), 0) FROM JSONB_ARRAY_ELEMENTS(plans_json) p),
      'memberCount', (SELECT COALESCE(SUM((p->>'memberCount')::INT), 0) FROM JSONB_ARRAY_ELEMENTS(plans_json) p)
    ),
    'plans', plans_json
  );
END;
$reading_team_registration_overview$;

REVOKE ALL ON FUNCTION public.get_reading_team_registration_overview(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reading_team_registration_overview(UUID) TO authenticated;

-- ── get_joined_plan_members (current def: migration 0078) ──
CREATE OR REPLACE FUNCTION public.get_joined_plan_members(
  p_global_plan_id UUID,
  p_plan_key TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $get_joined_plan_members$
DECLARE
  actor_id UUID;
  actor_profile public.profiles%ROWTYPE;
  actor_role TEXT;
  target_plan public.global_plans%ROWTYPE;
  members_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT * INTO actor_profile FROM public.profiles WHERE id = actor_id;
  SELECT * INTO target_plan FROM public.global_plans WHERE id = p_global_plan_id;

  IF actor_profile.id IS NULL THEN
    RAISE EXCEPTION 'profile_identity_not_found';
  END IF;

  actor_role := public.role_code(actor_profile.role_id);
  IF actor_role NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'plan_management_scope_required';
  END IF;
  IF target_plan.id IS NULL THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'id', candidate.id,
        'name', candidate.name,
        'greatRegion', NULLIF(BTRIM(candidate.great_region), ''),
        'pastoralZone', NULLIF(BTRIM(candidate.pastoral_zone), ''),
        'smallGroup', NULLIF(BTRIM(candidate.small_group), ''),
        'joinedAt', joined_plan.created_at,
        'currentRound', COALESCE(joined_plan.current_round, 1)
      )
      ORDER BY candidate.great_region, candidate.pastoral_zone, candidate.small_group, candidate.name
    ),
    '[]'::JSONB
  ) INTO members_json
  FROM public.profiles AS candidate
  JOIN public.reading_plans AS joined_plan
    ON joined_plan.user_id = candidate.id
   AND (
     joined_plan.global_plan_id = target_plan.id
     OR (
       NULLIF(BTRIM(p_plan_key), '') IS NOT NULL
       AND joined_plan.preset_key = BTRIM(p_plan_key)
     )
   )
  WHERE candidate.is_active = TRUE
    AND candidate.is_demo = FALSE
    AND candidate.id <> actor_id
    AND (
      actor_role IN ('admin', 'pastor')
      OR (actor_role = 'great_zone_leader' AND public.values_overlap(candidate.great_region, COALESCE(NULLIF(actor_profile.managed_regions, ''), actor_profile.great_region, '')))
      OR (actor_role = 'zone_leader' AND public.values_overlap(candidate.pastoral_zone, COALESCE(NULLIF(actor_profile.managed_zones, ''), actor_profile.pastoral_zone, '')))
      OR (actor_role = 'group_leader' AND public.values_overlap(candidate.small_group, COALESCE(NULLIF(actor_profile.managed_groups, ''), actor_profile.small_group, '')))
    );

  RETURN JSONB_BUILD_OBJECT(
    'planId', target_plan.id,
    'planName', target_plan.name,
    'members', members_json
  );
END;
$get_joined_plan_members$;

REVOKE ALL ON FUNCTION public.get_joined_plan_members(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_joined_plan_members(UUID, TEXT, UUID) TO authenticated, service_role;

-- ── get_reading_team_statistics (current def: migration 0078) ──
CREATE OR REPLACE FUNCTION public.get_reading_team_statistics(
  p_global_plan_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reading_team_statistics$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  teams_json JSONB;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT public.role_code(role_id) INTO actor_role FROM public.profiles WHERE id = actor_id;
  IF actor_role NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'team_statistics_admin_required';
  END IF;

  WITH member_progress AS (
    SELECT
      team.id AS team_id, membership.user_id, membership.member_role, membership.joined_at,
      profile.name, profile.pastoral_zone, COALESCE(plan.current_round, 1) AS current_round,
      COALESCE(progress.chapters_read, 0) AS chapters_read, progress.last_read_at
    FROM public.reading_teams team
    JOIN public.reading_team_members membership ON membership.team_id = team.id
    JOIN public.profiles profile ON profile.id = membership.user_id
    LEFT JOIN public.reading_plans plan
      ON plan.user_id = membership.user_id AND plan.global_plan_id = team.global_plan_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INTEGER AS chapters_read,
             MAX(log.read_at) AS last_read_at
      FROM public.reading_logs log WHERE log.plan_id = plan.id
    ) progress ON TRUE
    WHERE team.global_plan_id = p_global_plan_id
  ), team_rollup AS (
    SELECT team.id, team.name, team.division, team.status, team.created_at,
      COUNT(member.user_id)::INTEGER AS member_count,
      COALESCE(SUM(member.chapters_read), 0)::INTEGER AS chapters_read,
      MAX(member.last_read_at) AS last_read_at,
      COALESCE(jsonb_agg(jsonb_build_object(
        'userId', member.user_id, 'name', member.name, 'role', member.member_role,
        'pastoralZone', member.pastoral_zone,
        'currentRound', member.current_round, 'chaptersRead', member.chapters_read,
        'lastReadAt', member.last_read_at
      ) ORDER BY CASE WHEN member.member_role = 'captain' THEN 0 ELSE 1 END, member.joined_at)
      FILTER (WHERE member.user_id IS NOT NULL), '[]'::JSONB) AS members
    FROM public.reading_teams team
    LEFT JOIN member_progress member ON member.team_id = team.id
    WHERE team.global_plan_id = p_global_plan_id
    GROUP BY team.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'division', division, 'status', status,
    'memberCount', member_count, 'chaptersRead', chapters_read,
    'lastReadAt', last_read_at, 'members', members
  ) ORDER BY division, name), '[]'::JSONB) INTO teams_json FROM team_rollup;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'teamCount', (SELECT COUNT(*) FROM public.reading_teams WHERE global_plan_id = p_global_plan_id),
      'readyTeamCount', (SELECT COUNT(*) FROM public.reading_teams WHERE global_plan_id = p_global_plan_id AND status = 'ready'),
      'memberCount', (SELECT COUNT(*) FROM public.reading_team_members WHERE global_plan_id = p_global_plan_id),
      'division3Teams', (SELECT COUNT(*) FROM public.reading_teams WHERE global_plan_id = p_global_plan_id AND division = 3),
      'division6Teams', (SELECT COUNT(*) FROM public.reading_teams WHERE global_plan_id = p_global_plan_id AND division = 6)
    ),
    'teams', teams_json
  );
END;
$reading_team_statistics$;

REVOKE ALL ON FUNCTION public.get_reading_team_statistics(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reading_team_statistics(UUID, UUID) TO authenticated, service_role;

-- ── RLS (dev/localhost real-Supabase-client path only; current defs: 0078) ──
DROP POLICY IF EXISTS profiles_select_by_scope ON public.profiles;
CREATE POLICY profiles_select_by_scope ON public.profiles FOR SELECT TO authenticated USING (
  id = public.current_profile_id()
  OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'pastor')
  OR (
    (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader'
    AND great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ','))
  )
  OR (
    (SELECT my_role FROM public.get_my_profile()) = 'zone_leader'
    AND pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ','))
  )
  OR (
    (SELECT my_role FROM public.get_my_profile()) = 'group_leader'
    AND small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ','))
  )
);

DROP POLICY IF EXISTS reading_plans_select_by_scope ON public.reading_plans;
CREATE POLICY reading_plans_select_by_scope ON public.reading_plans FOR SELECT TO authenticated USING (
  user_id = public.current_profile_id()
  OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'pastor')
  OR EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = user_id
      AND (
        (
          (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader'
          AND profile.great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ','))
        )
        OR (
          (SELECT my_role FROM public.get_my_profile()) = 'zone_leader'
          AND profile.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ','))
        )
        OR (
          (SELECT my_role FROM public.get_my_profile()) = 'group_leader'
          AND profile.small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ','))
        )
      )
  )
);

DROP POLICY IF EXISTS reading_logs_select_by_scope ON public.reading_logs;
CREATE POLICY reading_logs_select_by_scope ON public.reading_logs FOR SELECT TO authenticated USING (
  user_id = public.current_profile_id()
  OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'pastor')
  OR EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = user_id
      AND (
        (
          (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader'
          AND profile.great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ','))
        )
        OR (
          (SELECT my_role FROM public.get_my_profile()) = 'zone_leader'
          AND profile.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ','))
        )
        OR (
          (SELECT my_role FROM public.get_my_profile()) = 'group_leader'
          AND profile.small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ','))
        )
      )
  )
);
