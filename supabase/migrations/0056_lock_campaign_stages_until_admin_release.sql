-- Lock church campaign stages until a system administrator explicitly opens them.
-- Stage 1 stays open. Existing visibility choices survive later campaign rule publishes.

BEGIN;

UPDATE public.global_plans
SET is_hidden = CASE
  WHEN id = '00000000-0000-0000-c026-000000000001'::UUID THEN FALSE
  ELSE TRUE
END
WHERE id BETWEEN
  '00000000-0000-0000-c026-000000000001'::UUID
  AND '00000000-0000-0000-c026-000000000010'::UUID
  AND plan_kind = 'church_campaign_stage';

CREATE OR REPLACE FUNCTION public.sync_church_campaign_stage_plans()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $sync_stage_plans$
DECLARE
  stage JSONB;
  stage_segments JSONB;
  stage_definition JSONB;
  stage_no INTEGER;
  stage_id UUID;
  stage_name TEXT;
  stage_books TEXT[];
BEGIN
  IF NEW.id <> '00000000-0000-0000-c026-000000002029'::UUID
     OR NEW.plan_kind <> 'church_campaign'
     OR jsonb_typeof(NEW.rules->'stages') <> 'array'
     OR jsonb_typeof(NEW.rules->'segments') <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR stage IN SELECT value FROM jsonb_array_elements(NEW.rules->'stages')
  LOOP
    stage_no := (stage->>'stageNo')::INTEGER;
    stage_id := format(
      '00000000-0000-0000-c026-%s',
      lpad(stage_no::TEXT, 12, '0')
    )::UUID;
    stage_name := '第' || stage_no || '階段｜' || stage->>'name';

    SELECT COALESCE(jsonb_agg(segment ORDER BY segment->>'startDate'), '[]'::JSONB)
      INTO stage_segments
    FROM jsonb_array_elements(NEW.rules->'segments') segment
    WHERE (segment->>'stageNo')::INTEGER = stage_no;

    SELECT COALESCE(array_agg(DISTINCT reading->>'book'), ARRAY[]::TEXT[])
      INTO stage_books
    FROM jsonb_array_elements(stage_segments) segment
    CROSS JOIN LATERAL jsonb_array_elements(segment->'readings') reading;

    stage_definition := jsonb_build_object(
      'id', stage_id::TEXT,
      'parentCampaignId', NEW.id::TEXT,
      'presetKey', 'church_stage_' || lpad(stage_no::TEXT, 2, '0'),
      'planKind', 'church_campaign_stage',
      'name', stage_name,
      'description', stage->>'name' || '，完成本階段可獲得「' || stage->>'awardName' || '」。',
      'startDate', stage->>'startDate',
      'endDate', stage->>'endDate',
      'isFixed', TRUE,
      'version', NEW.rule_version,
      'stageNo', stage_no,
      'roundNo', (stage->>'roundNo')::INTEGER,
      'phase', stage->>'phase',
      'awardName', stage->>'awardName',
      'examDate', stage->'examDate',
      'rules', NEW.rules->'rules',
      'stages', jsonb_build_array(stage),
      'segments', stage_segments,
      'books', to_jsonb(stage_books)
    );

    INSERT INTO public.global_plans(
      id, name, description, start_date, end_date, target_books,
      is_hidden, is_fixed, plan_kind, rules, rule_version, published_at
    ) VALUES (
      stage_id,
      stage_name,
      stage_definition->>'description',
      (stage->>'startDate')::DATE,
      (stage->>'endDate')::DATE,
      stage_books,
      stage_no <> 1,
      TRUE,
      'church_campaign_stage',
      stage_definition,
      NEW.rule_version,
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date,
      target_books = EXCLUDED.target_books,
      -- Deliberately preserve global_plans.is_hidden. It is controlled by admin.
      is_fixed = TRUE,
      plan_kind = 'church_campaign_stage',
      rules = EXCLUDED.rules,
      rule_version = EXCLUDED.rule_version,
      published_at = EXCLUDED.published_at;

    UPDATE public.reading_plans
    SET name = stage_name,
        start_date = (stage->>'startDate')::DATE,
        end_date = (stage->>'endDate')::DATE,
        target_books = stage_books,
        preset_key = 'church_stage_' || lpad(stage_no::TEXT, 2, '0'),
        is_fixed = TRUE
    WHERE global_plan_id = stage_id;
  END LOOP;

  RETURN NEW;
END;
$sync_stage_plans$;

-- Database-level enforcement prevents clients from joining a hidden stage by UUID.
CREATE OR REPLACE FUNCTION public.assert_campaign_stage_open(
  target_global_plan_id UUID,
  actor_profile_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $assert_stage_open$
DECLARE
  target_plan public.global_plans%ROWTYPE;
  actor_role TEXT;
BEGIN
  IF target_global_plan_id IS NULL THEN RETURN; END IF;

  SELECT * INTO target_plan
  FROM public.global_plans
  WHERE id = target_global_plan_id;

  IF NOT FOUND OR target_plan.plan_kind <> 'church_campaign_stage' OR NOT target_plan.is_hidden THEN
    RETURN;
  END IF;

  SELECT public.role_code(profile.role_id)
    INTO actor_role
  FROM public.profiles profile
  WHERE profile.id = actor_profile_id;

  IF COALESCE(actor_role, 'member') <> 'admin' THEN
    RAISE EXCEPTION 'campaign_stage_not_open' USING ERRCODE = 'P0001';
  END IF;
END;
$assert_stage_open$;

REVOKE ALL ON FUNCTION public.assert_campaign_stage_open(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_campaign_stage_open(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_reading_plan_stage_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $enforce_reading_plan_stage_open$
BEGIN
  PERFORM public.assert_campaign_stage_open(NEW.global_plan_id, NEW.user_id);
  RETURN NEW;
END;
$enforce_reading_plan_stage_open$;

DROP TRIGGER IF EXISTS trg_reading_plan_stage_open ON public.reading_plans;
CREATE TRIGGER trg_reading_plan_stage_open
  BEFORE INSERT OR UPDATE OF global_plan_id ON public.reading_plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reading_plan_stage_open();

CREATE OR REPLACE FUNCTION public.enforce_reading_log_stage_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $enforce_reading_log_stage_open$
DECLARE
  target_global_plan_id UUID;
BEGIN
  SELECT plan.global_plan_id INTO target_global_plan_id
  FROM public.reading_plans plan
  WHERE plan.id = NEW.plan_id;

  PERFORM public.assert_campaign_stage_open(target_global_plan_id, NEW.user_id);
  RETURN NEW;
END;
$enforce_reading_log_stage_open$;

DROP TRIGGER IF EXISTS trg_reading_log_stage_open ON public.reading_logs;
CREATE TRIGGER trg_reading_log_stage_open
  BEFORE INSERT OR UPDATE OF plan_id ON public.reading_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reading_log_stage_open();

CREATE OR REPLACE FUNCTION public.enforce_reading_team_stage_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $enforce_reading_team_stage_open$
BEGIN
  PERFORM public.assert_campaign_stage_open(NEW.global_plan_id, NEW.captain_id);
  RETURN NEW;
END;
$enforce_reading_team_stage_open$;

DROP TRIGGER IF EXISTS trg_reading_team_stage_open ON public.reading_teams;
CREATE TRIGGER trg_reading_team_stage_open
  BEFORE INSERT OR UPDATE OF global_plan_id ON public.reading_teams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reading_team_stage_open();

CREATE OR REPLACE FUNCTION public.enforce_reading_team_member_stage_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $enforce_reading_team_member_stage_open$
BEGIN
  PERFORM public.assert_campaign_stage_open(NEW.global_plan_id, NEW.user_id);
  RETURN NEW;
END;
$enforce_reading_team_member_stage_open$;

DROP TRIGGER IF EXISTS trg_reading_team_member_stage_open ON public.reading_team_members;
CREATE TRIGGER trg_reading_team_member_stage_open
  BEFORE INSERT OR UPDATE OF global_plan_id ON public.reading_team_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reading_team_member_stage_open();

CREATE OR REPLACE FUNCTION public.enforce_small_home_team_stage_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $enforce_small_home_team_stage_open$
BEGIN
  PERFORM public.assert_campaign_stage_open(NEW.global_plan_id, NEW.created_by);
  RETURN NEW;
END;
$enforce_small_home_team_stage_open$;

DROP TRIGGER IF EXISTS trg_small_home_team_stage_open ON public.small_home_teams;
CREATE TRIGGER trg_small_home_team_stage_open
  BEFORE INSERT OR UPDATE OF global_plan_id ON public.small_home_teams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_small_home_team_stage_open();

CREATE OR REPLACE FUNCTION public.enforce_small_home_team_member_stage_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $enforce_small_home_team_member_stage_open$
DECLARE
  target_global_plan_id UUID;
BEGIN
  SELECT team.global_plan_id INTO target_global_plan_id
  FROM public.small_home_teams team
  WHERE team.id = NEW.team_id;

  PERFORM public.assert_campaign_stage_open(target_global_plan_id, NEW.user_id);
  RETURN NEW;
END;
$enforce_small_home_team_member_stage_open$;

DROP TRIGGER IF EXISTS trg_small_home_team_member_stage_open ON public.small_home_team_members;
CREATE TRIGGER trg_small_home_team_member_stage_open
  BEFORE INSERT OR UPDATE OF team_id ON public.small_home_team_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_small_home_team_member_stage_open();

COMMIT;