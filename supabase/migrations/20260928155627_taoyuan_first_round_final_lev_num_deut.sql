-- ============================================================================
-- 20260928155627_taoyuan_first_round_final_lev_num_deut.sql  —  #326
--
-- 桃園梯次比全教會晚一個月：10 月出埃及記（桃園）已在 20260928101019 建立。
-- 這支接著把 11 月利未記、12 月民數記、1 月申命記（桃園）三張一次建好，
-- 讓管理員每月開始前逐一開放即可，不必臨時再跑 migration。
--
-- 不用後台的 create_region_stage_cohort：它固定複製舊的整段第 2 階段
-- （四卷書、9～12 月），而且同一大區同一 stageNo 只能有一張。
--
-- · plan_kind = church_campaign_stage_cohort、audience_regions = {桃園}
-- · rules.stageNo = 2（第一輪期末賽）；presetKey 用 church_r1final_ 開頭，
--   前端才會把獎項顯示成「四卷合成鐵獎」而不是「讀完這張就得鐵獎」。
--   桃園版怎麼算進鐵獎另外處理（#321 留言）。
-- · 三張建立時都先隱藏（is_hidden = TRUE），由管理員在每月開始前開放；
--   帶隊只看「未隱藏」的下一張，開放後隊長就能從上個月帶隊進來。
-- · 重跑時保留管理員當下的開放／隱藏設定。
-- ============================================================================

INSERT INTO public.global_plans(
  id, name, description, start_date, end_date, target_books,
  is_hidden, is_fixed, plan_kind, rules, rule_version, published_at,
  audience_regions
) VALUES
(
  '00000000-0000-0000-c326-000000202611'::UUID,
  '第一輪期末賽｜2026年11月・利未記（桃園）',
  '桃園梯次：2026年11月讀利未記。',
  '2026-11-01'::DATE, '2026-11-30'::DATE, ARRAY['利未記']::TEXT[],
  TRUE, TRUE, 'church_campaign_stage_cohort',
  '{"parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_r1final_taoyuan_2026_11","planKind":"church_campaign_stage_cohort","name":"第一輪期末賽｜2026年11月・利未記（桃園）","description":"桃園梯次：2026年11月讀利未記。","startDate":"2026-11-01","endDate":"2026-11-30","isFixed":true,"version":1,"stageNo":2,"cohortSourceStageNo":2,"cohortRegion":"桃園","roundNo":1,"phase":"final","awardName":"鐵獎","examDate":null,"discoverWhenLocked":true,"books":["利未記"],"rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}}}'::JSONB,
  1, NOW(),
  ARRAY['桃園']::TEXT[]
),
(
  '00000000-0000-0000-c326-000000202612'::UUID,
  '第一輪期末賽｜2026年12月・民數記（桃園）',
  '桃園梯次：2026年12月讀民數記。',
  '2026-12-01'::DATE, '2026-12-31'::DATE, ARRAY['民數記']::TEXT[],
  TRUE, TRUE, 'church_campaign_stage_cohort',
  '{"parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_r1final_taoyuan_2026_12","planKind":"church_campaign_stage_cohort","name":"第一輪期末賽｜2026年12月・民數記（桃園）","description":"桃園梯次：2026年12月讀民數記。","startDate":"2026-12-01","endDate":"2026-12-31","isFixed":true,"version":1,"stageNo":2,"cohortSourceStageNo":2,"cohortRegion":"桃園","roundNo":1,"phase":"final","awardName":"鐵獎","examDate":null,"discoverWhenLocked":true,"books":["民數記"],"rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}}}'::JSONB,
  1, NOW(),
  ARRAY['桃園']::TEXT[]
),
(
  '00000000-0000-0000-c326-000000202701'::UUID,
  '第一輪期末賽｜2027年1月・申命記（桃園）',
  '桃園梯次：2027年1月讀申命記。',
  '2027-01-01'::DATE, '2027-01-31'::DATE, ARRAY['申命記']::TEXT[],
  TRUE, TRUE, 'church_campaign_stage_cohort',
  '{"parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_r1final_taoyuan_2027_01","planKind":"church_campaign_stage_cohort","name":"第一輪期末賽｜2027年1月・申命記（桃園）","description":"桃園梯次：2027年1月讀申命記。","startDate":"2027-01-01","endDate":"2027-01-31","isFixed":true,"version":1,"stageNo":2,"cohortSourceStageNo":2,"cohortRegion":"桃園","roundNo":1,"phase":"final","awardName":"鐵獎","examDate":null,"discoverWhenLocked":true,"books":["申命記"],"rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}}}'::JSONB,
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
