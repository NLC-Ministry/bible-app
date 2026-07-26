-- =========================================================================
-- SQL Script to seed church campaign master and stages into global_plans
-- =========================================================================

TRUNCATE TABLE global_plans CASCADE;

-- 1. Insert Master Campaign Plan
INSERT INTO global_plans (
  id, name, description, start_date, end_date, target_books, is_hidden, is_fixed, plan_kind, rule_version, rules
) VALUES (
  '00000000-0000-0000-c026-000000002029',
  '2026–2029 新生命聖經速讀計畫',
  '全教會依統一時程完成聖經 66 卷；加入一次即可持續參與至計畫結束。',
  '2026-08-01',
  '2029-08-31',
  '{"創世記","出埃及記","利未記","民數記","申命記","約書亞記","士師記","路得記","撒母耳記上","撒母耳記下","列王紀上","列王紀下","歷代志上","歷代志下","以斯拉記","尼希米記","以斯帖記","約伯記","詩篇","箴言","傳道書","雅歌","以賽亞書","耶利米書","耶利米哀歌","以西結書","但以理書","何西阿書","約珥書","阿摩司書","俄巴底亞書","約拿書","彌迦書","那鴻書","哈巴谷書","西番雅書","哈該書","撒迦利亞書","瑪拉基書","馬太福音","馬可福音","路加福音","約翰福音","使徒行傳","羅馬書","哥林多前書","哥林多後書","加拉太書","以弗所書","腓立比書","歌羅西書","帖撒羅尼迦前書","帖撒羅尼迦後書","提摩太前書","提摩太後書","提多書","腓利門書","希伯來書","雅各書","彼得前書","彼得後書","約翰一書","約翰二書","約翰三書","猶大書","啟示錄"}',
  true, -- is_hidden
  true, -- is_fixed
  'church_campaign',
  1,
  '{"id":"00000000-0000-0000-c026-000000002029","presetKey":"church_2026_2029","planKind":"church_campaign","name":"2026–2029 新生命聖經速讀計畫","description":"全教會依統一時程完成聖經 66 卷；加入一次即可持續參與至計畫結束。","startDate":"2026-08-01","endDate":"2029-08-31","isFixed":true,"version":1,"rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}},"stages":[{"stageNo":1,"roundNo":1,"phase":"warmup","name":"第一輪熱身賽","startDate":"2026-08-01","endDate":"2026-08-31","awardName":"磐石獎","examDate":"2026-08-30"},{"stageNo":2,"roundNo":1,"phase":"final","name":"第一輪期末賽","startDate":"2026-09-01","endDate":"2026-12-31","awardName":"鐵獎","examDate":"2026-12-27"},{"stageNo":3,"roundNo":2,"phase":"warmup","name":"第二輪熱身賽","startDate":"2027-01-01","endDate":"2027-03-31","awardName":"銅獎","examDate":"2027-03-28"},{"stageNo":4,"roundNo":2,"phase":"final","name":"第二輪期末賽","startDate":"2027-04-01","endDate":"2027-08-31","awardName":"青銅獎","examDate":"2027-08-29"},{"stageNo":5,"roundNo":3,"phase":"full","name":"第三輪","startDate":"2027-09-01","endDate":"2028-03-31","awardName":"白銀獎","examDate":null},{"stageNo":6,"roundNo":4,"phase":"full","name":"第四輪","startDate":"2028-04-01","endDate":"2028-11-30","awardName":"黃金獎","examDate":null},{"stageNo":7,"roundNo":5,"phase":"full","name":"第五輪","startDate":"2028-12-01","endDate":"2029-03-31","awardName":"精金獎","examDate":null},{"stageNo":8,"roundNo":6,"phase":"full","name":"第六輪","startDate":"2029-04-01","endDate":"2029-06-30","awardName":"俄斐金獎","examDate":null},{"stageNo":9,"roundNo":7,"phase":"full","name":"第七輪","startDate":"2029-07-01","endDate":"2029-07-31","awardName":"火煉金獎","examDate":null},{"stageNo":10,"roundNo":8,"phase":"full","name":"第八輪","startDate":"2029-08-01","endDate":"2029-08-31","awardName":"新耶路撒冷獎","examDate":null}],"segments":[{"stageNo":1,"roundNo":1,"label":"2026年8月","startDate":"2026-08-01","endDate":"2026-08-31","readings":[{"book":"創世記","from":1,"to":50}]},{"stageNo":2,"roundNo":1,"label":"2026年9月","startDate":"2026-09-01","endDate":"2026-09-30","readings":[{"book":"出埃及記","from":1,"to":40}]},{"stageNo":2,"roundNo":1,"label":"2026年10月","startDate":"2026-10-01","endDate":"2026-10-31","readings":[{"book":"利未記","from":1,"to":27}]},{"stageNo":2,"roundNo":1,"label":"2026年11月","startDate":"2026-11-01","endDate":"2026-11-30","readings":[{"book":"民數記","from":1,"to":36}]},{"stageNo":2,"roundNo":1,"label":"2026年12月","startDate":"2026-12-01","endDate":"2026-12-31","readings":[{"book":"申命記","from":1,"to":34}]},{"stageNo":3,"roundNo":2,"label":"2027年1月","startDate":"2027-01-01","endDate":"2027-01-31","readings":[{"book":"約書亞記","from":1,"to":null},{"book":"士師記","from":1,"to":null},{"book":"路得記","from":1,"to":null}]},{"stageNo":3,"roundNo":2,"label":"2027年2月","startDate":"2027-02-01","endDate":"2027-02-28","readings":[{"book":"撒母耳記上","from":1,"to":null}]},{"stageNo":3,"roundNo":2,"label":"2027年3月","startDate":"2027-03-01","endDate":"2027-03-31","readings":[{"book":"撒母耳記下","from":1,"to":null}]},{"stageNo":4,"roundNo":2,"label":"2027年4月","startDate":"2027-04-01","endDate":"2027-04-30","readings":[{"book":"列王紀上","from":1,"to":null}]},{"stageNo":4,"roundNo":2,"label":"2027年5月","startDate":"2027-05-01","endDate":"2027-05-31","readings":[{"book":"列王紀下","from":1,"to":null}]},{"stageNo":4,"roundNo":2,"label":"2027年6月","startDate":"2027-06-01","endDate":"2027-06-30","readings":[{"book":"歷代志上","from":1,"to":null}]},{"stageNo":4,"roundNo":2,"label":"2027年7月","startDate":"2027-07-01","endDate":"2027-07-31","readings":[{"book":"歷代志下","from":1,"to":null}]},{"stageNo":4,"roundNo":2,"label":"2027年8月","startDate":"2027-08-01","endDate":"2027-08-31","readings":[{"book":"以斯拉記","from":1,"to":null},{"book":"尼希米記","from":1,"to":null},{"book":"以斯帖記","from":1,"to":null}]},{"stageNo":5,"roundNo":3,"label":"2027年9月","startDate":"2027-09-01","endDate":"2027-09-30","readings":[{"book":"約伯記","from":1,"to":null}]},{"stageNo":5,"roundNo":3,"label":"2027年10月","startDate":"2027-10-01","endDate":"2027-10-31","readings":[{"book":"詩篇","from":1,"to":41}]},{"stageNo":5,"roundNo":3,"label":"2027年11月","startDate":"2027-11-01","endDate":"2027-11-30","readings":[{"book":"詩篇","from":42,"to":72}]},{"stageNo":5,"roundNo":3,"label":"2027年12月","startDate":"2027-12-01","endDate":"2027-12-31","readings":[{"book":"詩篇","from":73,"to":106}]},{"stageNo":5,"roundNo":3,"label":"2028年1月","startDate":"2028-01-01","endDate":"2028-01-31","readings":[{"book":"詩篇","from":107,"to":150}]},{"stageNo":5,"roundNo":3,"label":"2028年2月","startDate":"2028-02-01","endDate":"2028-02-29","readings":[{"book":"箴言","from":1,"to":null}]},{"stageNo":5,"roundNo":3,"label":"2028年3月","startDate":"2028-03-01","endDate":"2028-03-31","readings":[{"book":"傳道書","from":1,"to":null},{"book":"雅歌","from":1,"to":null}]},{"stageNo":6,"roundNo":4,"label":"2028年4–5月","startDate":"2028-04-01","endDate":"2028-05-31","readings":[{"book":"以賽亞書","from":1,"to":null}]},{"stageNo":6,"roundNo":4,"label":"2028年6–7月","startDate":"2028-06-01","endDate":"2028-07-31","readings":[{"book":"耶利米書","from":1,"to":null},{"book":"耶利米哀歌","from":1,"to":null}]},{"stageNo":6,"roundNo":4,"label":"2028年8月","startDate":"2028-08-01","endDate":"2028-08-31","readings":[{"book":"以西結書","from":1,"to":null}]},{"stageNo":6,"roundNo":4,"label":"2028年9月","startDate":"2028-09-01","endDate":"2028-09-30","readings":[{"book":"但以理書","from":1,"to":null},{"book":"何西阿書","from":1,"to":null},{"book":"約珥書","from":1,"to":null}]},{"stageNo":6,"roundNo":4,"label":"2028年10月","startDate":"2028-10-01","endDate":"2028-10-31","readings":[{"book":"阿摩司書","from":1,"to":null},{"book":"俄巴底亞書","from":1,"to":null},{"book":"約拿書","from":1,"to":null},{"book":"彌迦書","from":1,"to":null}]},{"stageNo":6,"roundNo":4,"label":"2028年11月","startDate":"2028-11-01","endDate":"2028-11-30","readings":[{"book":"那鴻書","from":1,"to":null},{"book":"哈巴谷書","from":1,"to":null},{"book":"西番雅書","from":1,"to":null},{"book":"哈該書","from":1,"to":null},{"book":"撒迦利亞書","from":1,"to":null},{"book":"瑪拉基書","from":1,"to":null}]},{"stageNo":7,"roundNo":5,"label":"2028年12月","startDate":"2028-12-01","endDate":"2028-12-31","readings":[{"book":"馬太福音","from":1,"to":null}]},{"stageNo":7,"roundNo":5,"label":"2029年1月","startDate":"2029-01-01","endDate":"2029-01-31","readings":[{"book":"馬可福音","from":1,"to":null},{"book":"路加福音","from":1,"to":null}]},{"stageNo":7,"roundNo":5,"label":"2029年2月","startDate":"2029-02-01","endDate":"2029-02-28","readings":[{"book":"約翰福音","from":1,"to":null}]},{"stageNo":7,"roundNo":5,"label":"2029年3月","startDate":"2029-03-01","endDate":"2029-03-31","readings":[{"book":"使徒行傳","from":1,"to":null}]},{"stageNo":8,"roundNo":6,"label":"2029年4月","startDate":"2029-04-01","endDate":"2029-04-30","readings":[{"book":"羅馬書","from":1,"to":null},{"book":"哥林多前書","from":1,"to":null}]},{"stageNo":8,"roundNo":6,"label":"2029年5月","startDate":"2029-05-01","endDate":"2029-05-31","readings":[{"book":"哥林多後書","from":1,"to":null},{"book":"加拉太書","from":1,"to":null},{"book":"以弗所書","from":1,"to":null},{"book":"腓立比書","from":1,"to":null}]},{"stageNo":8,"roundNo":6,"label":"2029年6月","startDate":"2029-06-01","endDate":"2029-06-30","readings":[{"book":"歌羅西書","from":1,"to":null},{"book":"帖撒羅尼迦前書","from":1,"to":null},{"book":"帖撒羅尼迦後書","from":1,"to":null},{"book":"提摩太前書","from":1,"to":null},{"book":"提摩太後書","from":1,"to":null},{"book":"提多書","from":1,"to":null},{"book":"腓利門書","from":1,"to":null}]},{"stageNo":9,"roundNo":7,"label":"2029年7月","startDate":"2029-07-01","endDate":"2029-07-31","readings":[{"book":"希伯來書","from":1,"to":null},{"book":"雅各書","from":1,"to":null},{"book":"彼得前書","from":1,"to":null},{"book":"彼得後書","from":1,"to":null},{"book":"約翰一書","from":1,"to":null},{"book":"約翰二書","from":1,"to":null},{"book":"約翰三書","from":1,"to":null},{"book":"猶大書","from":1,"to":null}]},{"stageNo":10,"roundNo":8,"label":"2029年8月","startDate":"2029-08-01","endDate":"2029-08-31","readings":[{"book":"啟示錄","from":1,"to":null}]}]}'
);

-- 2. Insert Campaign Stages
-- Stage 1: 第1階段｜第一輪熱身賽
INSERT INTO global_plans (
  id, name, description, start_date, end_date, target_books, is_hidden, is_fixed, plan_kind, rule_version, rules
) VALUES (
  '00000000-0000-0000-c026-000000000001',
  '第1階段｜第一輪熱身賽',
  '第一輪熱身賽，完成本階段可獲得「磐石獎」。',
  '2026-08-01',
  '2026-08-31',
  '{"創世記"}',
  false, -- is_hidden
  true, -- is_fixed
  'church_campaign_stage',
  1,
  '{"id":"00000000-0000-0000-c026-000000000001","parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_stage_01","planKind":"church_campaign_stage","name":"第1階段｜第一輪熱身賽","description":"第一輪熱身賽，完成本階段可獲得「磐石獎」。","startDate":"2026-08-01","endDate":"2026-08-31","isFixed":true,"version":1,"stageNo":1,"roundNo":1,"phase":"warmup","awardName":"磐石獎","examDate":"2026-08-30","rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}},"stages":[{"stageNo":1,"roundNo":1,"phase":"warmup","name":"第一輪熱身賽","startDate":"2026-08-01","endDate":"2026-08-31","awardName":"磐石獎","examDate":"2026-08-30"}],"segments":[{"stageNo":1,"roundNo":1,"label":"2026年8月","startDate":"2026-08-01","endDate":"2026-08-31","readings":[{"book":"創世記","from":1,"to":50}]}],"books":["創世記"]}'
);

-- Stage 2: 第2階段｜第一輪期末賽
INSERT INTO global_plans (
  id, name, description, start_date, end_date, target_books, is_hidden, is_fixed, plan_kind, rule_version, rules
) VALUES (
  '00000000-0000-0000-c026-000000000002',
  '第2階段｜第一輪期末賽',
  '第一輪期末賽，完成本階段可獲得「鐵獎」。',
  '2026-09-01',
  '2026-12-31',
  '{"出埃及記","利未記","民數記","申命記"}',
  false, -- is_hidden
  true, -- is_fixed
  'church_campaign_stage',
  1,
  '{"id":"00000000-0000-0000-c026-000000000002","parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_stage_02","planKind":"church_campaign_stage","name":"第2階段｜第一輪期末賽","description":"第一輪期末賽，完成本階段可獲得「鐵獎」。","startDate":"2026-09-01","endDate":"2026-12-31","isFixed":true,"version":1,"stageNo":2,"roundNo":1,"phase":"final","awardName":"鐵獎","examDate":"2026-12-27","rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}},"stages":[{"stageNo":2,"roundNo":1,"phase":"final","name":"第一輪期末賽","startDate":"2026-09-01","endDate":"2026-12-31","awardName":"鐵獎","examDate":"2026-12-27"}],"segments":[{"stageNo":2,"roundNo":1,"label":"2026年9月","startDate":"2026-09-01","endDate":"2026-09-30","readings":[{"book":"出埃及記","from":1,"to":40}]},{"stageNo":2,"roundNo":1,"label":"2026年10月","startDate":"2026-10-01","endDate":"2026-10-31","readings":[{"book":"利未記","from":1,"to":27}]},{"stageNo":2,"roundNo":1,"label":"2026年11月","startDate":"2026-11-01","endDate":"2026-11-30","readings":[{"book":"民數記","from":1,"to":36}]},{"stageNo":2,"roundNo":1,"label":"2026年12月","startDate":"2026-12-01","endDate":"2026-12-31","readings":[{"book":"申命記","from":1,"to":34}]}],"books":["出埃及記","利未記","民數記","申命記"]}'
);

-- Stage 3: 第3階段｜第二輪熱身賽
INSERT INTO global_plans (
  id, name, description, start_date, end_date, target_books, is_hidden, is_fixed, plan_kind, rule_version, rules
) VALUES (
  '00000000-0000-0000-c026-000000000003',
  '第3階段｜第二輪熱身賽',
  '第二輪熱身賽，完成本階段可獲得「銅獎」。',
  '2027-01-01',
  '2027-03-31',
  '{"約書亞記","士師記","路得記","撒母耳記上","撒母耳記下"}',
  false, -- is_hidden
  true, -- is_fixed
  'church_campaign_stage',
  1,
  '{"id":"00000000-0000-0000-c026-000000000003","parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_stage_03","planKind":"church_campaign_stage","name":"第3階段｜第二輪熱身賽","description":"第二輪熱身賽，完成本階段可獲得「銅獎」。","startDate":"2027-01-01","endDate":"2027-03-31","isFixed":true,"version":1,"stageNo":3,"roundNo":2,"phase":"warmup","awardName":"銅獎","examDate":"2027-03-28","rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}},"stages":[{"stageNo":3,"roundNo":2,"phase":"warmup","name":"第二輪熱身賽","startDate":"2027-01-01","endDate":"2027-03-31","awardName":"銅獎","examDate":"2027-03-28"}],"segments":[{"stageNo":3,"roundNo":2,"label":"2027年1月","startDate":"2027-01-01","endDate":"2027-01-31","readings":[{"book":"約書亞記","from":1,"to":null},{"book":"士師記","from":1,"to":null},{"book":"路得記","from":1,"to":null}]},{"stageNo":3,"roundNo":2,"label":"2027年2月","startDate":"2027-02-01","endDate":"2027-02-28","readings":[{"book":"撒母耳記上","from":1,"to":null}]},{"stageNo":3,"roundNo":2,"label":"2027年3月","startDate":"2027-03-01","endDate":"2027-03-31","readings":[{"book":"撒母耳記下","from":1,"to":null}]}],"books":["約書亞記","士師記","路得記","撒母耳記上","撒母耳記下"]}'
);

-- Stage 4: 第4階段｜第二輪期末賽
INSERT INTO global_plans (
  id, name, description, start_date, end_date, target_books, is_hidden, is_fixed, plan_kind, rule_version, rules
) VALUES (
  '00000000-0000-0000-c026-000000000004',
  '第4階段｜第二輪期末賽',
  '第二輪期末賽，完成本階段可獲得「青銅獎」。',
  '2027-04-01',
  '2027-08-31',
  '{"列王紀上","列王紀下","歷代志上","歷代志下","以斯拉記","尼希米記","以斯帖記"}',
  false, -- is_hidden
  true, -- is_fixed
  'church_campaign_stage',
  1,
  '{"id":"00000000-0000-0000-c026-000000000004","parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_stage_04","planKind":"church_campaign_stage","name":"第4階段｜第二輪期末賽","description":"第二輪期末賽，完成本階段可獲得「青銅獎」。","startDate":"2027-04-01","endDate":"2027-08-31","isFixed":true,"version":1,"stageNo":4,"roundNo":2,"phase":"final","awardName":"青銅獎","examDate":"2027-08-29","rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}},"stages":[{"stageNo":4,"roundNo":2,"phase":"final","name":"第二輪期末賽","startDate":"2027-04-01","endDate":"2027-08-31","awardName":"青銅獎","examDate":"2027-08-29"}],"segments":[{"stageNo":4,"roundNo":2,"label":"2027年4月","startDate":"2027-04-01","endDate":"2027-04-30","readings":[{"book":"列王紀上","from":1,"to":null}]},{"stageNo":4,"roundNo":2,"label":"2027年5月","startDate":"2027-05-01","endDate":"2027-05-31","readings":[{"book":"列王紀下","from":1,"to":null}]},{"stageNo":4,"roundNo":2,"label":"2027年6月","startDate":"2027-06-01","endDate":"2027-06-30","readings":[{"book":"歷代志上","from":1,"to":null}]},{"stageNo":4,"roundNo":2,"label":"2027年7月","startDate":"2027-07-01","endDate":"2027-07-31","readings":[{"book":"歷代志下","from":1,"to":null}]},{"stageNo":4,"roundNo":2,"label":"2027年8月","startDate":"2027-08-01","endDate":"2027-08-31","readings":[{"book":"以斯拉記","from":1,"to":null},{"book":"尼希米記","from":1,"to":null},{"book":"以斯帖記","from":1,"to":null}]}],"books":["列王紀上","列王紀下","歷代志上","歷代志下","以斯拉記","尼希米記","以斯帖記"]}'
);

-- Stage 5: 第5階段｜第三輪
INSERT INTO global_plans (
  id, name, description, start_date, end_date, target_books, is_hidden, is_fixed, plan_kind, rule_version, rules
) VALUES (
  '00000000-0000-0000-c026-000000000005',
  '第5階段｜第三輪',
  '第三輪，完成本階段可獲得「白銀獎」。',
  '2027-09-01',
  '2028-03-31',
  '{"約伯記","詩篇","箴言","傳道書","雅歌"}',
  false, -- is_hidden
  true, -- is_fixed
  'church_campaign_stage',
  1,
  '{"id":"00000000-0000-0000-c026-000000000005","parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_stage_05","planKind":"church_campaign_stage","name":"第5階段｜第三輪","description":"第三輪，完成本階段可獲得「白銀獎」。","startDate":"2027-09-01","endDate":"2028-03-31","isFixed":true,"version":1,"stageNo":5,"roundNo":3,"phase":"full","awardName":"白銀獎","examDate":null,"rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}},"stages":[{"stageNo":5,"roundNo":3,"phase":"full","name":"第三輪","startDate":"2027-09-01","endDate":"2028-03-31","awardName":"白銀獎","examDate":null}],"segments":[{"stageNo":5,"roundNo":3,"label":"2027年9月","startDate":"2027-09-01","endDate":"2027-09-30","readings":[{"book":"約伯記","from":1,"to":null}]},{"stageNo":5,"roundNo":3,"label":"2027年10月","startDate":"2027-10-01","endDate":"2027-10-31","readings":[{"book":"詩篇","from":1,"to":41}]},{"stageNo":5,"roundNo":3,"label":"2027年11月","startDate":"2027-11-01","endDate":"2027-11-30","readings":[{"book":"詩篇","from":42,"to":72}]},{"stageNo":5,"roundNo":3,"label":"2027年12月","startDate":"2027-12-01","endDate":"2027-12-31","readings":[{"book":"詩篇","from":73,"to":106}]},{"stageNo":5,"roundNo":3,"label":"2028年1月","startDate":"2028-01-01","endDate":"2028-01-31","readings":[{"book":"詩篇","from":107,"to":150}]},{"stageNo":5,"roundNo":3,"label":"2028年2月","startDate":"2028-02-01","endDate":"2028-02-29","readings":[{"book":"箴言","from":1,"to":null}]},{"stageNo":5,"roundNo":3,"label":"2028年3月","startDate":"2028-03-01","endDate":"2028-03-31","readings":[{"book":"傳道書","from":1,"to":null},{"book":"雅歌","from":1,"to":null}]}],"books":["約伯記","詩篇","箴言","傳道書","雅歌"]}'
);

-- Stage 6: 第6階段｜第四輪
INSERT INTO global_plans (
  id, name, description, start_date, end_date, target_books, is_hidden, is_fixed, plan_kind, rule_version, rules
) VALUES (
  '00000000-0000-0000-c026-000000000006',
  '第6階段｜第四輪',
  '第四輪，完成本階段可獲得「黃金獎」。',
  '2028-04-01',
  '2028-11-30',
  '{"以賽亞書","耶利米書","耶利米哀歌","以西結書","但以理書","何西阿書","約珥書","阿摩司書","俄巴底亞書","約拿書","彌迦書","那鴻書","哈巴谷書","西番雅書","哈該書","撒迦利亞書","瑪拉基書"}',
  false, -- is_hidden
  true, -- is_fixed
  'church_campaign_stage',
  1,
  '{"id":"00000000-0000-0000-c026-000000000006","parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_stage_06","planKind":"church_campaign_stage","name":"第6階段｜第四輪","description":"第四輪，完成本階段可獲得「黃金獎」。","startDate":"2028-04-01","endDate":"2028-11-30","isFixed":true,"version":1,"stageNo":6,"roundNo":4,"phase":"full","awardName":"黃金獎","examDate":null,"rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}},"stages":[{"stageNo":6,"roundNo":4,"phase":"full","name":"第四輪","startDate":"2028-04-01","endDate":"2028-11-30","awardName":"黃金獎","examDate":null}],"segments":[{"stageNo":6,"roundNo":4,"label":"2028年4–5月","startDate":"2028-04-01","endDate":"2028-05-31","readings":[{"book":"以賽亞書","from":1,"to":null}]},{"stageNo":6,"roundNo":4,"label":"2028年6–7月","startDate":"2028-06-01","endDate":"2028-07-31","readings":[{"book":"耶利米書","from":1,"to":null},{"book":"耶利米哀歌","from":1,"to":null}]},{"stageNo":6,"roundNo":4,"label":"2028年8月","startDate":"2028-08-01","endDate":"2028-08-31","readings":[{"book":"以西結書","from":1,"to":null}]},{"stageNo":6,"roundNo":4,"label":"2028年9月","startDate":"2028-09-01","endDate":"2028-09-30","readings":[{"book":"但以理書","from":1,"to":null},{"book":"何西阿書","from":1,"to":null},{"book":"約珥書","from":1,"to":null}]},{"stageNo":6,"roundNo":4,"label":"2028年10月","startDate":"2028-10-01","endDate":"2028-10-31","readings":[{"book":"阿摩司書","from":1,"to":null},{"book":"俄巴底亞書","from":1,"to":null},{"book":"約拿書","from":1,"to":null},{"book":"彌迦書","from":1,"to":null}]},{"stageNo":6,"roundNo":4,"label":"2028年11月","startDate":"2028-11-01","endDate":"2028-11-30","readings":[{"book":"那鴻書","from":1,"to":null},{"book":"哈巴谷書","from":1,"to":null},{"book":"西番雅書","from":1,"to":null},{"book":"哈該書","from":1,"to":null},{"book":"撒迦利亞書","from":1,"to":null},{"book":"瑪拉基書","from":1,"to":null}]}],"books":["以賽亞書","耶利米書","耶利米哀歌","以西結書","但以理書","何西阿書","約珥書","阿摩司書","俄巴底亞書","約拿書","彌迦書","那鴻書","哈巴谷書","西番雅書","哈該書","撒迦利亞書","瑪拉基書"]}'
);

-- Stage 7: 第7階段｜第五輪
INSERT INTO global_plans (
  id, name, description, start_date, end_date, target_books, is_hidden, is_fixed, plan_kind, rule_version, rules
) VALUES (
  '00000000-0000-0000-c026-000000000007',
  '第7階段｜第五輪',
  '第五輪，完成本階段可獲得「精金獎」。',
  '2028-12-01',
  '2029-03-31',
  '{"馬太福音","馬可福音","路加福音","約翰福音","使徒行傳"}',
  false, -- is_hidden
  true, -- is_fixed
  'church_campaign_stage',
  1,
  '{"id":"00000000-0000-0000-c026-000000000007","parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_stage_07","planKind":"church_campaign_stage","name":"第7階段｜第五輪","description":"第五輪，完成本階段可獲得「精金獎」。","startDate":"2028-12-01","endDate":"2029-03-31","isFixed":true,"version":1,"stageNo":7,"roundNo":5,"phase":"full","awardName":"精金獎","examDate":null,"rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}},"stages":[{"stageNo":7,"roundNo":5,"phase":"full","name":"第五輪","startDate":"2028-12-01","endDate":"2029-03-31","awardName":"精金獎","examDate":null}],"segments":[{"stageNo":7,"roundNo":5,"label":"2028年12月","startDate":"2028-12-01","endDate":"2028-12-31","readings":[{"book":"馬太福音","from":1,"to":null}]},{"stageNo":7,"roundNo":5,"label":"2029年1月","startDate":"2029-01-01","endDate":"2029-01-31","readings":[{"book":"馬可福音","from":1,"to":null},{"book":"路加福音","from":1,"to":null}]},{"stageNo":7,"roundNo":5,"label":"2029年2月","startDate":"2029-02-01","endDate":"2029-02-28","readings":[{"book":"約翰福音","from":1,"to":null}]},{"stageNo":7,"roundNo":5,"label":"2029年3月","startDate":"2029-03-01","endDate":"2029-03-31","readings":[{"book":"使徒行傳","from":1,"to":null}]}],"books":["馬太福音","馬可福音","路加福音","約翰福音","使徒行傳"]}'
);

-- Stage 8: 第8階段｜第六輪
INSERT INTO global_plans (
  id, name, description, start_date, end_date, target_books, is_hidden, is_fixed, plan_kind, rule_version, rules
) VALUES (
  '00000000-0000-0000-c026-000000000008',
  '第8階段｜第六輪',
  '第六輪，完成本階段可獲得「俄斐金獎」。',
  '2029-04-01',
  '2029-06-30',
  '{"羅馬書","哥林多前書","哥林多後書","加拉太書","以弗所書","腓立比書","歌羅西書","帖撒羅尼迦前書","帖撒羅尼迦後書","提摩太前書","提摩太後書","提多書","腓利門書"}',
  false, -- is_hidden
  true, -- is_fixed
  'church_campaign_stage',
  1,
  '{"id":"00000000-0000-0000-c026-000000000008","parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_stage_08","planKind":"church_campaign_stage","name":"第8階段｜第六輪","description":"第六輪，完成本階段可獲得「俄斐金獎」。","startDate":"2029-04-01","endDate":"2029-06-30","isFixed":true,"version":1,"stageNo":8,"roundNo":6,"phase":"full","awardName":"俄斐金獎","examDate":null,"rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}},"stages":[{"stageNo":8,"roundNo":6,"phase":"full","name":"第六輪","startDate":"2029-04-01","endDate":"2029-06-30","awardName":"俄斐金獎","examDate":null}],"segments":[{"stageNo":8,"roundNo":6,"label":"2029年4月","startDate":"2029-04-01","endDate":"2029-04-30","readings":[{"book":"羅馬書","from":1,"to":null},{"book":"哥林多前書","from":1,"to":null}]},{"stageNo":8,"roundNo":6,"label":"2029年5月","startDate":"2029-05-01","endDate":"2029-05-31","readings":[{"book":"哥林多後書","from":1,"to":null},{"book":"加拉太書","from":1,"to":null},{"book":"以弗所書","from":1,"to":null},{"book":"腓立比書","from":1,"to":null}]},{"stageNo":8,"roundNo":6,"label":"2029年6月","startDate":"2029-06-01","endDate":"2029-06-30","readings":[{"book":"歌羅西書","from":1,"to":null},{"book":"帖撒羅尼迦前書","from":1,"to":null},{"book":"帖撒羅尼迦後書","from":1,"to":null},{"book":"提摩太前書","from":1,"to":null},{"book":"提摩太後書","from":1,"to":null},{"book":"提多書","from":1,"to":null},{"book":"腓利門書","from":1,"to":null}]}],"books":["羅馬書","哥林多前書","哥林多後書","加拉太書","以弗所書","腓立比書","歌羅西書","帖撒羅尼迦前書","帖撒羅尼迦後書","提摩太前書","提摩太後書","提多書","腓利門書"]}'
);

-- Stage 9: 第9階段｜第七輪
INSERT INTO global_plans (
  id, name, description, start_date, end_date, target_books, is_hidden, is_fixed, plan_kind, rule_version, rules
) VALUES (
  '00000000-0000-0000-c026-000000000009',
  '第9階段｜第七輪',
  '第七輪，完成本階段可獲得「火煉金獎」。',
  '2029-07-01',
  '2029-07-31',
  '{"希伯來書","雅各書","彼得前書","彼得後書","約翰一書","約翰二書","約翰三書","猶大書"}',
  false, -- is_hidden
  true, -- is_fixed
  'church_campaign_stage',
  1,
  '{"id":"00000000-0000-0000-c026-000000000009","parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_stage_09","planKind":"church_campaign_stage","name":"第9階段｜第七輪","description":"第七輪，完成本階段可獲得「火煉金獎」。","startDate":"2029-07-01","endDate":"2029-07-31","isFixed":true,"version":1,"stageNo":9,"roundNo":7,"phase":"full","awardName":"火煉金獎","examDate":null,"rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}},"stages":[{"stageNo":9,"roundNo":7,"phase":"full","name":"第七輪","startDate":"2029-07-01","endDate":"2029-07-31","awardName":"火煉金獎","examDate":null}],"segments":[{"stageNo":9,"roundNo":7,"label":"2029年7月","startDate":"2029-07-01","endDate":"2029-07-31","readings":[{"book":"希伯來書","from":1,"to":null},{"book":"雅各書","from":1,"to":null},{"book":"彼得前書","from":1,"to":null},{"book":"彼得後書","from":1,"to":null},{"book":"約翰一書","from":1,"to":null},{"book":"約翰二書","from":1,"to":null},{"book":"約翰三書","from":1,"to":null},{"book":"猶大書","from":1,"to":null}]}],"books":["希伯來書","雅各書","彼得前書","彼得後書","約翰一書","約翰二書","約翰三書","猶大書"]}'
);

-- Stage 10: 第10階段｜第八輪
INSERT INTO global_plans (
  id, name, description, start_date, end_date, target_books, is_hidden, is_fixed, plan_kind, rule_version, rules
) VALUES (
  '00000000-0000-0000-c026-000000000010',
  '第10階段｜第八輪',
  '第八輪，完成本階段可獲得「新耶路撒冷獎」。',
  '2029-08-01',
  '2029-08-31',
  '{"啟示錄"}',
  false, -- is_hidden
  true, -- is_fixed
  'church_campaign_stage',
  1,
  '{"id":"00000000-0000-0000-c026-000000000010","parentCampaignId":"00000000-0000-0000-c026-000000002029","presetKey":"church_stage_10","planKind":"church_campaign_stage","name":"第10階段｜第八輪","description":"第八輪，完成本階段可獲得「新耶路撒冷獎」。","startDate":"2029-08-01","endDate":"2029-08-31","isFixed":true,"version":1,"stageNo":10,"roundNo":8,"phase":"full","awardName":"新耶路撒冷獎","examDate":null,"rules":{"allowMidJoin":true,"sequentialAwards":true,"applyChangesFrom":"future_only","teamRules":{"personal":{"min":1,"max":1,"source":"self"},"smallHome":{"min":2,"max":4,"source":"registration"},"smallGroup":{"min":6,"max":null,"source":"profile.small_group"}}},"stages":[{"stageNo":10,"roundNo":8,"phase":"full","name":"第八輪","startDate":"2029-08-01","endDate":"2029-08-31","awardName":"新耶路撒冷獎","examDate":null}],"segments":[{"stageNo":10,"roundNo":8,"label":"2029年8月","startDate":"2029-08-01","endDate":"2029-08-31","readings":[{"book":"啟示錄","from":1,"to":null}]}],"books":["啟示錄"]}'
);

