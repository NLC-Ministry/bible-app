-- ============================================================================
-- 20260928101019_taoyuan_first_round_final_exodus.sql  —  #321
--
-- 桃園梯次比全教會晚一個月：桃園熱身賽是 2026/9，接著每月一張桃園版的
-- 第一輪期末賽。這支先建 10 月的「出埃及記（桃園）」，讓桃園熱身賽的隊長
-- 能帶隊接續（帶隊規則見 20260928101011：同活動、同對象大區、日期緊接在後）。
-- 利未記／民數記／申命記（桃園）之後再建。
--
-- 不用後台的 create_region_stage_cohort：它固定複製舊的整段第 2 階段
-- （四卷書、9～12 月），而且同一大區同一 stageNo 只能有一張。
--
-- · plan_kind = church_campaign_stage_cohort、audience_regions = {桃園}
-- · rules.stageNo = 2（第一輪期末賽）；presetKey 用 church_r1final_ 開頭，
--   前端才會把獎項顯示成「四卷合成鐵獎」而不是「讀完這張就得鐵獎」。
--   桃園版怎麼算進鐵獎另外處理（#321 留言）。
-- · 建立時就開放（is_hidden = FALSE），跟全教會 10 月計畫一樣，9 月底就能帶隊。
--   重跑時保留管理員當下的開放／隱藏設定。
-- ============================================================================

INSERT INTO public.global_plans(
  id, name, description, start_date, end_date, target_books,
  is_hidden, is_fixed, plan_kind, rules, rule_version, published_at,
  audience_regions
) VALUES (
  '00000000-0000-0000-c326-000000202610'::UUID,
  '第一輪期末賽｜2026年10月・出埃及記（桃園）',
  '桃園梯次：2026年10月讀出埃及記。',
  '2026-10-01'::DATE, '2026-10-31'::DATE, ARRAY['出埃及記']::TEXT[],
  FALSE, TRUE, 'church_campaign_stage_cohort',
  '{"parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_r1final_taoyuan_2026_10","planKind":"church_campaign_stage_cohort","name":"第一輪期末賽｜2026年10月・出埃及記（桃園）","description":"桃園梯次：2026年10月讀出埃及記。","startDate":"2026-10-01","endDate":"2026-10-31","isFixed":true,"version":1,"stageNo":2,"cohortSourceStageNo":2,"cohortRegion":"桃園","roundNo":1,"phase":"final","awardName":"鐵獎","examDate":null,"discoverWhenLocked":true,"books":["出埃及記"],"rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}}}'::JSONB,
  1, NOW(),
  ARRAY['桃園']::TEXT[]
)
ON CONFLICT (id) DO UPDATE SET
  name             = EXCLUDED.name,
  description      = EXCLUDED.description,
  start_date       = EXCLUDED.start_date,
  end_date         = EXCLUDED.end_date,
  target_books     = EXCLUDED.target_books,
  is_fixed         = TRUE,
  plan_kind        = EXCLUDED.plan_kind,
  rules            = EXCLUDED.rules,
  rule_version     = EXCLUDED.rule_version,
  audience_regions = EXCLUDED.audience_regions,
  updated_at       = NOW();
