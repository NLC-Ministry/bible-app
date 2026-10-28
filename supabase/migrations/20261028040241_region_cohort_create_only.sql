-- #633 大區梯次面板改成只新增：每次給新 id，來源改選「全教會的哪一張計畫」。
--
-- 需要 #639 第 1 步（20261028034547_plan_groups_source_plan.sql）先跑：用到
-- global_plans.source_plan_id 和它的唯一索引 global_plans_source_region_key。
--
-- create_region_stage_cohort 換簽章（名稱不變，nlc-data 的白名單、補 p_actor_id、稽核都照舊）：
--   舊：(大區, 來源階段號碼, 起, 迄, 先隱藏, actor) —— 用「大區＋stageNo」找現成梯次，找到就整列更新。
--   新：(大區, 來源計畫 id, 起, 迄, 先隱藏, actor) —— 一律新增，不查找、不更新既有梯次。
--   · 來源只能是全教會正式階段（plan_kind = church_campaign_stage，含 4 張月度期末賽）。
--   · 經卷、說明、規則從來源複製；名稱「<來源名稱>（<大區>）」；考試日期不帶（由大區自訂）。
--   · 複製來源寫進 source_plan_id。同一大區對同一張來源已經有梯次 → cohort_already_exists。
--   · rules.stageNo／cohortSourceStageNo 照舊從來源帶過去（發獎還在讀，#639 第 2 步才換），
--     但不再拿來當梯次的身分。
--   · presetKey＝<來源 presetKey>_cohort_<新 id 前 8 碼>：每張梯次各自唯一。
-- 修改日期、名稱改用計畫列表的「編輯」，開放狀態用「開放給使用者／暫停開放」（#632），都用 id 指定。
--
-- 舊的後台頁面（還沒重新整理的管理員）呼叫舊簽章會失敗，重新整理就好；會友端不受影響。
--
-- 回填：以前用面板建的梯次（presetKey church_stage_cohort_NN）補上 source_plan_id
-- ＝ c026-<cohortSourceStageNo>，這樣新面板對同一大區、同一階段也會擋重複。
-- 萬一同一大區同一階段有兩張，只回填最早建立的那張（唯一索引不允許兩張）。

DROP FUNCTION IF EXISTS public.create_region_stage_cohort(TEXT, INTEGER, DATE, DATE, BOOLEAN, UUID);

CREATE OR REPLACE FUNCTION public.create_region_stage_cohort(
  p_great_region   TEXT,
  p_source_plan_id UUID,
  p_start_date     DATE,
  p_end_date       DATE,
  p_is_hidden      BOOLEAN DEFAULT TRUE,
  p_actor_id       UUID DEFAULT NULL
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
  src        public.global_plans%ROWTYPE;
  dst_id     UUID := gen_random_uuid();
  dst_name   TEXT;
  preset     TEXT;
  new_rules  JSONB;
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
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  SELECT * INTO src FROM public.global_plans
  WHERE id = p_source_plan_id AND plan_kind = 'church_campaign_stage';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source_plan_not_found: %', p_source_plan_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.global_plans
    WHERE source_plan_id = src.id AND audience_regions = ARRAY[region]
  ) THEN
    RAISE EXCEPTION 'cohort_already_exists';
  END IF;

  dst_name := src.name || '（' || region || '）';
  preset := COALESCE(NULLIF(src.rules->>'presetKey', ''), 'church_stage_cohort')
    || '_cohort_' || left(replace(dst_id::TEXT, '-', ''), 8);

  -- 沿用來源的 rules，疊上梯次專屬欄位。不含 stages／segments —— 梯次不走 campaign 排程機制。
  new_rules := COALESCE(src.rules, '{}'::JSONB) || jsonb_build_object(
    'planKind',            'church_campaign_stage_cohort',
    'presetKey',           preset,
    'name',                dst_name,
    'startDate',           p_start_date::TEXT,
    'endDate',             p_end_date::TEXT,
    'cohortRegion',        region,
    'cohortSourceStageNo', src.rules->'stageNo',
    'examDate',            NULL
  );
  new_rules := (new_rules - 'id') - 'stages' - 'segments' - 'isHidden';

  BEGIN
    INSERT INTO public.global_plans (
      id, name, description, start_date, end_date, target_books,
      is_hidden, is_fixed, plan_kind, rules, rule_version, published_at,
      audience_regions, source_plan_id, created_by
    ) VALUES (
      dst_id, dst_name, src.description, p_start_date, p_end_date, src.target_books,
      COALESCE(p_is_hidden, TRUE), TRUE, 'church_campaign_stage_cohort',
      new_rules, COALESCE(src.rule_version, 1), NOW(),
      ARRAY[region], src.id, actor_id
    );
  EXCEPTION WHEN unique_violation THEN
    -- 兩個管理員同時送出：唯一索引擋下第二張
    RAISE EXCEPTION 'cohort_already_exists';
  END;

  RETURN jsonb_build_object(
    'planId', dst_id, 'created', TRUE, 'name', dst_name,
    'sourcePlanId', src.id, 'region', region,
    'isHidden', COALESCE(p_is_hidden, TRUE)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_region_stage_cohort(TEXT, UUID, DATE, DATE, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_region_stage_cohort(TEXT, UUID, DATE, DATE, BOOLEAN, UUID) TO authenticated, service_role;

-- ── 回填以前用面板建的梯次 ─────────────────────────────────────────────
WITH legacy AS (
  SELECT DISTINCT ON (src.id, gp.audience_regions) gp.id, src.id AS source_id
  FROM public.global_plans gp
  JOIN public.global_plans src
    ON src.id = format('00000000-0000-0000-c026-%s',
         lpad((gp.rules->>'cohortSourceStageNo')::INTEGER::TEXT, 12, '0'))::UUID
   AND src.plan_kind = 'church_campaign_stage'
  WHERE gp.plan_kind = 'church_campaign_stage_cohort'
    AND gp.source_plan_id IS NULL
    AND gp.rules->>'presetKey' LIKE 'church_stage_cohort_%'
    AND gp.rules->>'cohortSourceStageNo' ~ '^[0-9]+$'
    AND NOT EXISTS (
      SELECT 1 FROM public.global_plans taken
      WHERE taken.source_plan_id = src.id AND taken.audience_regions = gp.audience_regions
    )
  ORDER BY src.id, gp.audience_regions, gp.created_at, gp.id
)
UPDATE public.global_plans gp SET source_plan_id = legacy.source_id
FROM legacy
WHERE gp.id = legacy.id;
