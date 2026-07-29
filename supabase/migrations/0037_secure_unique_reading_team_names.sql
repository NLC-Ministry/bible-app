-- Normalize reading-team names, preserve existing teams, and enforce safe,
-- unique names per plan and division.

CREATE OR REPLACE FUNCTION public.normalize_reading_team_name(p_name TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $normalize_reading_team_name$
  SELECT lower(regexp_replace(btrim(COALESCE(p_name, '')), '[[:space:]]+', ' ', 'g'));
$normalize_reading_team_name$;

CREATE OR REPLACE FUNCTION public.is_safe_reading_team_name(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $is_safe_reading_team_name$
  SELECT COALESCE(
    char_length(btrim(p_name)) BETWEEN 1 AND 40
    AND p_name !~ '[[:cntrl:]<>]'
    AND p_name !~ U&'[\200B\200C\200D\202A\202B\202C\202D\202E\2060\2066\2067\2068\2069\FEFF]',
    FALSE
  );
$is_safe_reading_team_name$;

-- Clean legacy values without deleting teams. Control, HTML delimiter, zero-width,
-- and bidirectional override characters are removed; ordinary spacing is collapsed.
WITH sanitized AS (
  SELECT
    id,
    regexp_replace(
      btrim(
        regexp_replace(
          regexp_replace(name, '[[:cntrl:]<>]', '', 'g'),
          U&'[\200B\200C\200D\202A\202B\202C\202D\202E\2060\2066\2067\2068\2069\FEFF]',
          '',
          'g'
        )
      ),
      '[[:space:]]+',
      ' ',
      'g'
    ) AS clean_name
  FROM public.reading_teams
)
UPDATE public.reading_teams AS team
SET name = CASE
  WHEN sanitized.clean_name = '' THEN '未命名隊伍-' || left(team.id::TEXT, 8)
  ELSE left(sanitized.clean_name, 40)
END
FROM sanitized
WHERE sanitized.id = team.id
  AND team.name IS DISTINCT FROM CASE
    WHEN sanitized.clean_name = '' THEN '未命名隊伍-' || left(team.id::TEXT, 8)
    ELSE left(sanitized.clean_name, 40)
  END;

-- Rename only later duplicates. The oldest team keeps the original display name.
DO $deduplicate_reading_team_names$
DECLARE
  duplicate_team RECORD;
  suffix_number BIGINT;
  suffix TEXT;
  candidate_name TEXT;
BEGIN
  FOR duplicate_team IN
    SELECT
      team.id,
      team.global_plan_id,
      team.division,
      team.name,
      row_number() OVER (
        PARTITION BY team.global_plan_id, team.division,
          public.normalize_reading_team_name(team.name)
        ORDER BY team.created_at, team.id
      ) AS duplicate_number
    FROM public.reading_teams AS team
  LOOP
    IF duplicate_team.duplicate_number > 1 THEN
      suffix_number := duplicate_team.duplicate_number;
      LOOP
        suffix := pg_catalog.format(' (%s)', suffix_number);
        candidate_name := left(
          duplicate_team.name,
          GREATEST(1, 40 - char_length(suffix))
        ) || suffix;

        EXIT WHEN NOT EXISTS (
          SELECT 1
          FROM public.reading_teams AS existing
          WHERE existing.global_plan_id = duplicate_team.global_plan_id
            AND existing.division = duplicate_team.division
            AND existing.id <> duplicate_team.id
            AND public.normalize_reading_team_name(existing.name)
              = public.normalize_reading_team_name(candidate_name)
        );
        suffix_number := suffix_number + 1;
      END LOOP;

      UPDATE public.reading_teams
      SET name = candidate_name
      WHERE id = duplicate_team.id;
    END IF;
  END LOOP;
END;
$deduplicate_reading_team_names$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_teams_plan_division_normalized_name
  ON public.reading_teams (
    global_plan_id,
    division,
    public.normalize_reading_team_name(name)
  );

DO $add_reading_team_name_safety_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reading_teams'::regclass
      AND conname = 'reading_teams_name_safe_check'
  ) THEN
    ALTER TABLE public.reading_teams
      ADD CONSTRAINT reading_teams_name_safe_check
      CHECK (
        public.is_safe_reading_team_name(name)
        AND name = regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')
      )
      NOT VALID;
  END IF;
END;
$add_reading_team_name_safety_constraint$;

ALTER TABLE public.reading_teams
  VALIDATE CONSTRAINT reading_teams_name_safe_check;

CREATE OR REPLACE FUNCTION public.create_reading_team(
  p_global_plan_id UUID,
  p_division SMALLINT,
  p_name TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $create_reading_team$
DECLARE
  actor_id UUID;
  new_team public.reading_teams%ROWTYPE;
  generated_code TEXT;
  clean_name TEXT;
  violated_constraint TEXT;
BEGIN
  actor_id := public.resolve_reading_team_actor(p_actor_id);
  IF p_division NOT IN (3, 6) THEN RAISE EXCEPTION 'invalid_team_division'; END IF;
  IF NOT public.is_safe_reading_team_name(p_name) THEN
    RAISE EXCEPTION 'invalid_team_name';
  END IF;
  clean_name := regexp_replace(btrim(p_name), '[[:space:]]+', ' ', 'g');

  IF NOT EXISTS (
    SELECT 1 FROM public.global_plans plan
    WHERE plan.id = p_global_plan_id
      AND plan.plan_kind = 'church_campaign_stage'
  ) THEN RAISE EXCEPTION 'team_plan_not_found'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.reading_team_members
    WHERE global_plan_id = p_global_plan_id
      AND user_id = actor_id
      AND division = p_division
  ) THEN RAISE EXCEPTION 'already_in_plan_division'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_global_plan_id::TEXT || ':' || p_division::TEXT || ':'
        || public.normalize_reading_team_name(clean_name),
      0
    )
  );
  IF EXISTS (
    SELECT 1
    FROM public.reading_teams AS team
    WHERE team.global_plan_id = p_global_plan_id
      AND team.division = p_division
      AND public.normalize_reading_team_name(team.name)
        = public.normalize_reading_team_name(clean_name)
  ) THEN RAISE EXCEPTION 'duplicate_team_name'; END IF;

  LOOP
    generated_code := upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 10));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.reading_teams WHERE invite_code = generated_code);
  END LOOP;

  INSERT INTO public.reading_teams(global_plan_id, division, name, captain_id, invite_code)
  VALUES (p_global_plan_id, p_division, clean_name, actor_id, generated_code)
  RETURNING * INTO new_team;

  INSERT INTO public.reading_team_members(team_id, global_plan_id, user_id, division, member_role)
  VALUES (new_team.id, p_global_plan_id, actor_id, p_division, 'captain');

  RETURN jsonb_build_object(
    'teamId', new_team.id,
    'division', new_team.division,
    'inviteCode', new_team.invite_code,
    'status', new_team.status
  );
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint = 'idx_reading_teams_plan_division_normalized_name' THEN
      RAISE EXCEPTION 'duplicate_team_name';
    END IF;
    RAISE EXCEPTION 'already_in_plan_division';
END;
$create_reading_team$;
