-- #632 大區延後梯次的名稱只標大區，後台重送不再覆寫名稱。
--
-- create_region_stage_cohort（0140 版）：
--   1. 新建的梯次名稱從「<來源階段名>（<大區>延後梯次）」改成「<來源階段名>（<大區>）」，
--      跟用 migration 直接建的桃園梯次一致。
--   2. 同大區同階段再送一次（UPDATE 路徑）時，保留既有名稱：global_plans.name、
--      rules.name、reading_plans.name 都不動，避免蓋掉管理員用「編輯」改過的名稱。
--      日期、經卷、開放狀態、其他規則照舊更新。
-- 回傳的 name 是梯次實際的名稱（更新時就是保留下來的名稱）。
-- 簽章、權限檢查不變；既有梯次資料不批次改名。前端不用一起上。

CREATE OR REPLACE FUNCTION public.create_region_stage_cohort(
  p_great_region    TEXT,
  p_source_stage_no INTEGER,
  p_start_date      DATE,
  p_end_date        DATE,
  p_is_hidden       BOOLEAN DEFAULT TRUE,
  p_actor_id        UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id   UUID;
  actor_role TEXT;
  region     TEXT := BTRIM(COALESCE(p_great_region, ''));
  src_id     UUID;
  src        public.global_plans%ROWTYPE;
  dst_id     UUID;
  dst_name   TEXT;
  preset     TEXT := 'church_stage_cohort_' || lpad(COALESCE(p_source_stage_no, 0)::TEXT, 2, '0');
  new_rules  JSONB;
  did_create BOOLEAN := FALSE;
BEGIN
  IF p_actor_id IS NOT NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'actor_override_forbidden';
  END IF;
  actor_id := COALESCE(p_actor_id, public.current_profile_id());
  actor_role := COALESCE(
    public.role_code((SELECT role_id FROM public.profiles WHERE id = actor_id)), 'member');
  IF actor_role NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF region = '' THEN RAISE EXCEPTION 'great_region_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.great_regions WHERE name = region) THEN
    RAISE EXCEPTION 'great_region_not_found: %', region;
  END IF;
  IF p_source_stage_no IS NULL OR p_source_stage_no < 1 OR p_source_stage_no > 10 THEN
    RAISE EXCEPTION 'invalid_stage_no';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  src_id := format('00000000-0000-0000-c026-%s', lpad(p_source_stage_no::TEXT, 12, '0'))::UUID;
  SELECT * INTO src FROM public.global_plans
  WHERE id = src_id AND plan_kind = 'church_campaign_stage';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source_stage_not_found: %', p_source_stage_no;
  END IF;

  SELECT id, name INTO dst_id, dst_name FROM public.global_plans
  WHERE plan_kind = 'church_campaign_stage_cohort'
    AND audience_regions = ARRAY[region]
    AND (rules->>'stageNo')::INTEGER = p_source_stage_no
  LIMIT 1;

  -- 新建才產生名稱；既有梯次沿用目前的名稱
  IF dst_id IS NULL THEN
    dst_name := src.name || '（' || region || '）';
  END IF;

  -- 沿用來源階段的 rules，明確補上 stageNo / cohortSourceStageNo（發獎靠這兩個），
  -- 疊上梯次專屬欄位。不含 stages / segments —— 梯次不走 campaign 排程機制。
  new_rules := COALESCE(src.rules, '{}'::jsonb) || jsonb_build_object(
    'planKind',            'church_campaign_stage_cohort',
    'presetKey',           preset,
    'name',                dst_name,
    'startDate',           p_start_date::TEXT,
    'endDate',             p_end_date::TEXT,
    'stageNo',             p_source_stage_no,
    'cohortRegion',        region,
    'cohortSourceStageNo', p_source_stage_no
  );
  new_rules := (new_rules - 'id') - 'stages' - 'segments';

  IF dst_id IS NULL THEN
    dst_id := gen_random_uuid();
    INSERT INTO public.global_plans (
      id, name, description, start_date, end_date, target_books,
      is_hidden, is_fixed, plan_kind, rules, rule_version, published_at,
      audience_regions, created_by
    ) VALUES (
      dst_id, dst_name, src.description, p_start_date, p_end_date, src.target_books,
      COALESCE(p_is_hidden, TRUE), TRUE, 'church_campaign_stage_cohort',
      new_rules, COALESCE(src.rule_version, 1), NOW(),
      ARRAY[region], actor_id
    );
    did_create := TRUE;
  ELSE
    UPDATE public.global_plans SET
      description  = src.description,
      start_date   = p_start_date,
      end_date     = p_end_date,
      target_books = src.target_books,
      is_hidden    = COALESCE(p_is_hidden, is_hidden),
      rules        = new_rules,
      updated_at   = NOW()
    WHERE id = dst_id;

    UPDATE public.reading_plans SET
      start_date   = p_start_date,
      end_date     = p_end_date,
      target_books = src.target_books,
      preset_key   = preset,
      updated_at   = NOW()
    WHERE global_plan_id = dst_id;
  END IF;

  RETURN jsonb_build_object(
    'planId', dst_id, 'created', did_create, 'name', dst_name,
    'stageNo', p_source_stage_no, 'region', region,
    'isHidden', COALESCE(p_is_hidden, TRUE)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_region_stage_cohort(TEXT, INTEGER, DATE, DATE, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_region_stage_cohort(TEXT, INTEGER, DATE, DATE, BOOLEAN, UUID) TO authenticated, service_role;
