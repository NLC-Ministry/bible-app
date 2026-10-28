-- #639 第 1 步：計畫之間的關係改用資料表記錄，不再靠 rules.stageNo 推。
--
-- 1. plan_groups／plan_group_members：獎項分組（多對多）。
--    一組＝一個獎；成員各佔一格（slot，例如「利未記」），完成條件記在 plan_groups.rules。
--    key 是穩定的識別字，程式用它找組，不用寫死 UUID。
-- 2. global_plans.source_plan_id：梯次的複製來源（一張梯次只有一個來源）。
--    同一大區（audience_regions）對同一張來源只能有一張。來源被刪時設回 NULL，
--    不擋總表清理觸發器刪階段。
-- 3. 回填（維護者 2026-10-28 定案：全教會、桃園各是一個鐵獎，讀另一組不算進這一組）：
--    · r1final_church：全教會 4 張月度期末賽（c126 …202609～202612）
--    · r1final_taoyuan：桃園 4 張梯次（c326 …202610～202701），
--      各自以全教會同經卷那張為 source_plan_id。
--    找不到的計畫列直接略過；可重跑。
--
-- 這一步只建表、回填，沒有任何程式讀它（第 2 步才改讀），rules.stageNo 等舊欄位照舊。
-- 前端不用一起上，也不是 breaking change。

-- ── 1. 獎項分組 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE CHECK (BTRIM(key) <> ''),
  kind TEXT NOT NULL CHECK (kind IN ('award')),
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  rules JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.plan_group_members (
  group_id UUID NOT NULL REFERENCES public.plan_groups(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.global_plans(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (BTRIM(slot) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, plan_id)
);

CREATE INDEX IF NOT EXISTS plan_group_members_plan_idx ON public.plan_group_members (plan_id);

-- 分組資訊不含個資：登入者可讀（Supabase-Auth 模式）；寫入只走 service_role。
ALTER TABLE public.plan_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_groups_read ON public.plan_groups;
CREATE POLICY plan_groups_read ON public.plan_groups FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS plan_group_members_read ON public.plan_group_members;
CREATE POLICY plan_group_members_read ON public.plan_group_members FOR SELECT TO authenticated USING (TRUE);

REVOKE ALL ON TABLE public.plan_groups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.plan_group_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.plan_groups TO authenticated;
GRANT SELECT ON TABLE public.plan_group_members TO authenticated;
GRANT ALL ON TABLE public.plan_groups TO service_role;
GRANT ALL ON TABLE public.plan_group_members TO service_role;

-- ── 2. 複製來源 ─────────────────────────────────────────────────────────
ALTER TABLE public.global_plans
  ADD COLUMN IF NOT EXISTS source_plan_id UUID REFERENCES public.global_plans(id) ON DELETE SET NULL;

ALTER TABLE public.global_plans DROP CONSTRAINT IF EXISTS global_plans_source_not_self;
ALTER TABLE public.global_plans
  ADD CONSTRAINT global_plans_source_not_self CHECK (source_plan_id IS NULL OR source_plan_id <> id);

CREATE UNIQUE INDEX IF NOT EXISTS global_plans_source_region_key
  ON public.global_plans (source_plan_id, audience_regions)
  WHERE source_plan_id IS NOT NULL;

-- ── 3. 回填 ─────────────────────────────────────────────────────────────
INSERT INTO public.plan_groups (key, kind, name, rules) VALUES
  ('r1final_church', 'award', '鐵獎（全教會）',
   '{"awardName":"鐵獎","completion":"every_slot","slots":["出埃及記","利未記","民數記","申命記"]}'::JSONB),
  ('r1final_taoyuan', 'award', '鐵獎（桃園）',
   '{"awardName":"鐵獎","completion":"every_slot","slots":["出埃及記","利未記","民數記","申命記"]}'::JSONB)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.plan_group_members (group_id, plan_id, slot)
SELECT g.id, gp.id, v.slot
FROM (VALUES
  ('r1final_church',  '00000000-0000-0000-c126-000000202609'::UUID, '出埃及記'),
  ('r1final_church',  '00000000-0000-0000-c126-000000202610'::UUID, '利未記'),
  ('r1final_church',  '00000000-0000-0000-c126-000000202611'::UUID, '民數記'),
  ('r1final_church',  '00000000-0000-0000-c126-000000202612'::UUID, '申命記'),
  ('r1final_taoyuan', '00000000-0000-0000-c326-000000202610'::UUID, '出埃及記'),
  ('r1final_taoyuan', '00000000-0000-0000-c326-000000202611'::UUID, '利未記'),
  ('r1final_taoyuan', '00000000-0000-0000-c326-000000202612'::UUID, '民數記'),
  ('r1final_taoyuan', '00000000-0000-0000-c326-000000202701'::UUID, '申命記')
) AS v(group_key, plan_id, slot)
JOIN public.plan_groups g ON g.key = v.group_key
JOIN public.global_plans gp ON gp.id = v.plan_id
ON CONFLICT (group_id, plan_id) DO UPDATE SET slot = EXCLUDED.slot;

UPDATE public.global_plans gp SET source_plan_id = v.source_id
FROM (VALUES
  ('00000000-0000-0000-c326-000000202610'::UUID, '00000000-0000-0000-c126-000000202609'::UUID),
  ('00000000-0000-0000-c326-000000202611'::UUID, '00000000-0000-0000-c126-000000202610'::UUID),
  ('00000000-0000-0000-c326-000000202612'::UUID, '00000000-0000-0000-c126-000000202611'::UUID),
  ('00000000-0000-0000-c326-000000202701'::UUID, '00000000-0000-0000-c126-000000202612'::UUID)
) AS v(plan_id, source_id)
WHERE gp.id = v.plan_id
  AND gp.source_plan_id IS DISTINCT FROM v.source_id
  AND EXISTS (SELECT 1 FROM public.global_plans src WHERE src.id = v.source_id);
