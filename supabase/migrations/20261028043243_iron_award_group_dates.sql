-- #639 第 2 步：鐵獎改讀分組表，兩組各自的賽季結束日與合成日記在 plan_groups.rules。
--   全教會：賽季到 2026-12-31，2027-01-02 起可合成（原本 CHURCH_CAMPAIGN.finalSynthesisDate）
--   桃園：  賽季到 2027-01-31，2027-02-02 起可合成（原本 CHURCH_CAMPAIGN.firstRoundFinalCohorts）
-- 需要 20261028034547_plan_groups_source_plan.sql 先跑。可重跑；前端讀不到時退回同一份內建值。

UPDATE public.plan_groups
SET rules = rules || '{"seasonEndDate":"2026-12-31","finalSynthesisDate":"2027-01-02"}'::JSONB,
    updated_at = NOW()
WHERE key = 'r1final_church';

UPDATE public.plan_groups
SET rules = rules || '{"seasonEndDate":"2027-01-31","finalSynthesisDate":"2027-02-02"}'::JSONB,
    updated_at = NOW()
WHERE key = 'r1final_taoyuan';
