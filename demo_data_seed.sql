-- ==========================================
-- 模擬成員進度與速讀聖經計畫種子資料 (精簡高效版)
-- 本檔案利用 PostgreSQL 迴圈與臨時表動態生成進度，大小僅約 15KB
-- 請複製並在 Supabase SQL Editor 中執行。
-- ==========================================

-- 建立臨時表並生成第一季速讀的 321 個章節列表
CREATE TEMP TABLE temp_books (
  idx SERIAL PRIMARY KEY,
  book TEXT,
  chapters INT
);

INSERT INTO temp_books (book, chapters) VALUES
('創世記', 50),
('馬太福音', 28),
('列王紀下', 25),
('雅各書', 5),
('出埃及記', 40),
('馬可福音', 16),
('約伯記', 42),
('加拉太書', 6),
('哈巴谷書', 3),
('猶大書', 1),
('利未記', 27),
('路加福音', 24),
('歷代志下', 36),
('帖撒羅尼迦前書', 5),
('約拿書', 4),
('約翰二書', 1),
('彌迦書', 7),
('約翰三書', 1);

CREATE TEMP TABLE temp_chapters AS
SELECT 
  row_number() OVER (ORDER BY b.idx, s.ch) as idx,
  b.book,
  s.ch as chapter
FROM temp_books b
CROSS JOIN LATERAL generate_series(1, b.chapters) as s(ch)
ORDER BY b.idx, s.ch;

-- 開始插入使用者、計畫與進度紀錄
DO $$
DECLARE
  u_id UUID;
  p_id UUID;
BEGIN

  -- [陳建國] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '080a73d5-253c-4296-b2e3-cca498351f49',
    '080a73d5@church-bible.com',
    '{"full_name": "陳建國"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '080a73d5-253c-4296-b2e3-cca498351f49',
    '陳建國',
    '東區',
    '大安1',
    '馬鈴',
    'group_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '738d3e6f-8fc8-4379-9276-b4dd826837ba',
    '080a73d5-253c-4296-b2e3-cca498351f49',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：280 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '080a73d5-253c-4296-b2e3-cca498351f49',
    '738d3e6f-8fc8-4379-9276-b4dd826837ba',
    book,
    chapter,
    NOW() - (280 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 280;

  -- [林秀琴] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '3e9c44e1-841a-4524-9d9c-bae7b2291ba3',
    '3e9c44e1@church-bible.com',
    '{"full_name": "林秀琴"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '3e9c44e1-841a-4524-9d9c-bae7b2291ba3',
    '林秀琴',
    '東區',
    '大安1',
    '馬鈴',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '89d29055-0599-44de-9d85-faf937640ade',
    '3e9c44e1-841a-4524-9d9c-bae7b2291ba3',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：110 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '3e9c44e1-841a-4524-9d9c-bae7b2291ba3',
    '89d29055-0599-44de-9d85-faf937640ade',
    book,
    chapter,
    NOW() - (110 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 110;

  -- [吳志明] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '33d34ec6-9d57-4d9a-a107-09a2649de7d0',
    '33d34ec6@church-bible.com',
    '{"full_name": "吳志明"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '33d34ec6-9d57-4d9a-a107-09a2649de7d0',
    '吳志明',
    '東區',
    '大安1',
    '安利',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '02b11748-bb13-4aec-9813-63089e0a9561',
    '33d34ec6-9d57-4d9a-a107-09a2649de7d0',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：290 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '33d34ec6-9d57-4d9a-a107-09a2649de7d0',
    '02b11748-bb13-4aec-9813-63089e0a9561',
    book,
    chapter,
    NOW() - (290 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 290;

  -- [張明哲] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '623462cf-0aae-47bb-94c2-6ffe28627676',
    '623462cf@church-bible.com',
    '{"full_name": "張明哲"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '623462cf-0aae-47bb-94c2-6ffe28627676',
    '張明哲',
    '東區',
    '大安2',
    '名雅',
    'group_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'd64daea4-6569-419b-a761-77c6497c7514',
    '623462cf-0aae-47bb-94c2-6ffe28627676',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：310 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '623462cf-0aae-47bb-94c2-6ffe28627676',
    'd64daea4-6569-419b-a761-77c6497c7514',
    book,
    chapter,
    NOW() - (310 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 310;

  -- [黃雅婷] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '8104335b-50be-4431-8c38-c9b923f43d62',
    '8104335b@church-bible.com',
    '{"full_name": "黃雅婷"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '8104335b-50be-4431-8c38-c9b923f43d62',
    '黃雅婷',
    '東區',
    '大安2',
    '名雅',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'b545362e-4c53-400c-af20-0fda18ba0168',
    '8104335b-50be-4431-8c38-c9b923f43d62',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：60 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '8104335b-50be-4431-8c38-c9b923f43d62',
    'b545362e-4c53-400c-af20-0fda18ba0168',
    book,
    chapter,
    NOW() - (60 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 60;

  -- [李冠宇] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '6e889aa1-e20e-4d9c-902c-53dca4d2ab76',
    '6e889aa1@church-bible.com',
    '{"full_name": "李冠宇"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '6e889aa1-e20e-4d9c-902c-53dca4d2ab76',
    '李冠宇',
    '東區',
    '信義2',
    'Gary',
    'group_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '3bd9a85b-a9ec-47a4-b2b4-9655f5857382',
    '6e889aa1-e20e-4d9c-902c-53dca4d2ab76',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：170 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '6e889aa1-e20e-4d9c-902c-53dca4d2ab76',
    '3bd9a85b-a9ec-47a4-b2b4-9655f5857382',
    book,
    chapter,
    NOW() - (170 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 170;

  -- [王淑芬] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '30124682-17d5-4afe-9d65-acb6dba062f3',
    '30124682@church-bible.com',
    '{"full_name": "王淑芬"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '30124682-17d5-4afe-9d65-acb6dba062f3',
    '王淑芬',
    '東區',
    '信義2',
    'Gary',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '3182ca00-f821-4464-981d-cae34bd0efb3',
    '30124682-17d5-4afe-9d65-acb6dba062f3',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：50 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '30124682-17d5-4afe-9d65-acb6dba062f3',
    '3182ca00-f821-4464-981d-cae34bd0efb3',
    book,
    chapter,
    NOW() - (50 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 50;

  -- [東區區長] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '4c720456-8862-4824-9e98-79aaf6468905',
    '4c720456@church-bible.com',
    '{"full_name": "東區區長"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '4c720456-8862-4824-9e98-79aaf6468905',
    '東區區長',
    '東區',
    '大安1',
    '馬鈴',
    'zone_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '32af315e-9f68-40de-8ee0-a8550ee7e3b9',
    '4c720456-8862-4824-9e98-79aaf6468905',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：260 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '4c720456-8862-4824-9e98-79aaf6468905',
    '32af315e-9f68-40de-8ee0-a8550ee7e3b9',
    book,
    chapter,
    NOW() - (260 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 260;

  -- [東區大區長] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '84e25920-14fc-4c06-9b2a-f4dd331cd689',
    '84e25920@church-bible.com',
    '{"full_name": "東區大區長"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '84e25920-14fc-4c06-9b2a-f4dd331cd689',
    '東區大區長',
    '東區',
    '大安1',
    '馬鈴',
    'great_zone_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'e4d57651-20b6-40ff-861f-fc43106aff8e',
    '84e25920-14fc-4c06-9b2a-f4dd331cd689',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：300 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '84e25920-14fc-4c06-9b2a-f4dd331cd689',
    'e4d57651-20b6-40ff-861f-fc43106aff8e',
    book,
    chapter,
    NOW() - (300 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 300;

  -- [楊俊傑] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '70010f93-9785-48ea-885a-8bb890acbd7a',
    '70010f93@church-bible.com',
    '{"full_name": "楊俊傑"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '70010f93-9785-48ea-885a-8bb890acbd7a',
    '楊俊傑',
    '南區',
    '大安6',
    '郁君',
    'group_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '10eb0cb2-0215-4de9-89cd-8fad2335d42c',
    '70010f93-9785-48ea-885a-8bb890acbd7a',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：315 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '70010f93-9785-48ea-885a-8bb890acbd7a',
    '10eb0cb2-0215-4de9-89cd-8fad2335d42c',
    book,
    chapter,
    NOW() - (315 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 315;

  -- [許美惠] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '4de204ca-b8e4-4684-9f6f-c96d2e3896e6',
    '4de204ca@church-bible.com',
    '{"full_name": "許美惠"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '4de204ca-b8e4-4684-9f6f-c96d2e3896e6',
    '許美惠',
    '南區',
    '大安6',
    '郁君',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '49264a66-a739-448f-84d3-0dec95b9f26f',
    '4de204ca-b8e4-4684-9f6f-c96d2e3896e6',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：250 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '4de204ca-b8e4-4684-9f6f-c96d2e3896e6',
    '49264a66-a739-448f-84d3-0dec95b9f26f',
    book,
    chapter,
    NOW() - (250 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 250;

  -- [鄭裕民] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'd4445dda-7226-4231-98d5-f1fceb1cd103',
    'd4445dda@church-bible.com',
    '{"full_name": "鄭裕民"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    'd4445dda-7226-4231-98d5-f1fceb1cd103',
    '鄭裕民',
    '南區',
    '信義3',
    '保羅',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '7b815c84-f653-4f19-b9fb-b1d7fe3ead8b',
    'd4445dda-7226-4231-98d5-f1fceb1cd103',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：150 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'd4445dda-7226-4231-98d5-f1fceb1cd103',
    '7b815c84-f653-4f19-b9fb-b1d7fe3ead8b',
    book,
    chapter,
    NOW() - (150 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 150;

  -- [謝佩珊] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'af879675-09e3-45ff-8450-9bf41808ff3c',
    'af879675@church-bible.com',
    '{"full_name": "謝佩珊"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    'af879675-09e3-45ff-8450-9bf41808ff3c',
    '謝佩珊',
    '南區',
    '信義3',
    '保羅',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'bb7ac8fa-e165-48ca-83aa-8c966c6545d3',
    'af879675-09e3-45ff-8450-9bf41808ff3c',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：80 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'af879675-09e3-45ff-8450-9bf41808ff3c',
    'bb7ac8fa-e165-48ca-83aa-8c966c6545d3',
    book,
    chapter,
    NOW() - (80 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 80;

  -- [郭家豪] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '354b5067-b213-4c81-8f8e-d1ffe59ce21d',
    '354b5067@church-bible.com',
    '{"full_name": "郭家豪"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '354b5067-b213-4c81-8f8e-d1ffe59ce21d',
    '郭家豪',
    '南區',
    '文山',
    '千惠',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'a6070667-bb84-41c5-ba24-9b55badec45f',
    '354b5067-b213-4c81-8f8e-d1ffe59ce21d',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：270 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '354b5067-b213-4c81-8f8e-d1ffe59ce21d',
    'a6070667-bb84-41c5-ba24-9b55badec45f',
    book,
    chapter,
    NOW() - (270 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 270;

  -- [南區區長] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '7d5fc859-2ca2-48fd-98f6-b6ce5689a014',
    '7d5fc859@church-bible.com',
    '{"full_name": "南區區長"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '7d5fc859-2ca2-48fd-98f6-b6ce5689a014',
    '南區區長',
    '南區',
    '大安6',
    '郁君',
    'zone_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '426e027d-1e7b-4fd9-b2d7-c64d1a7c7598',
    '7d5fc859-2ca2-48fd-98f6-b6ce5689a014',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：280 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '7d5fc859-2ca2-48fd-98f6-b6ce5689a014',
    '426e027d-1e7b-4fd9-b2d7-c64d1a7c7598',
    book,
    chapter,
    NOW() - (280 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 280;

  -- [葉子毅] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '28b557f2-8063-4516-a635-7158cf9d6205',
    '28b557f2@church-bible.com',
    '{"full_name": "葉子毅"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '28b557f2-8063-4516-a635-7158cf9d6205',
    '葉子毅',
    '西區',
    '中正1',
    '詠溱',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '0dee5fbc-65d2-4156-9048-66c8deff644a',
    '28b557f2-8063-4516-a635-7158cf9d6205',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：90 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '28b557f2-8063-4516-a635-7158cf9d6205',
    '0dee5fbc-65d2-4156-9048-66c8deff644a',
    book,
    chapter,
    NOW() - (90 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 90;

  -- [周宛儒] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'f0cdc39a-1a95-45d2-ae11-e570be769b14',
    'f0cdc39a@church-bible.com',
    '{"full_name": "周宛儒"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    'f0cdc39a-1a95-45d2-ae11-e570be769b14',
    '周宛儒',
    '西區',
    '中正1',
    '詠溱',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '0d13c324-5b54-4c4f-adb4-06fb919273f1',
    'f0cdc39a-1a95-45d2-ae11-e570be769b14',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：160 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'f0cdc39a-1a95-45d2-ae11-e570be769b14',
    '0d13c324-5b54-4c4f-adb4-06fb919273f1',
    book,
    chapter,
    NOW() - (160 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 160;

  -- [蕭志平] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'aa30a94b-d430-4fae-a709-eb21c213e83d',
    'aa30a94b@church-bible.com',
    '{"full_name": "蕭志平"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    'aa30a94b-d430-4fae-a709-eb21c213e83d',
    '蕭志平',
    '西區',
    '中永和',
    '季樺',
    'group_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'f46a46e1-af91-469a-875f-de38ecfcbdda',
    'aa30a94b-d430-4fae-a709-eb21c213e83d',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：305 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'aa30a94b-d430-4fae-a709-eb21c213e83d',
    'f46a46e1-af91-469a-875f-de38ecfcbdda',
    book,
    chapter,
    NOW() - (305 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 305;

  -- [莊雅雯] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'f4947272-1d6c-400d-a391-d7ea7c1c30d2',
    'f4947272@church-bible.com',
    '{"full_name": "莊雅雯"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    'f4947272-1d6c-400d-a391-d7ea7c1c30d2',
    '莊雅雯',
    '西區',
    '中永和',
    '季樺',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'f4e32ee7-43d2-4ea1-90fd-24588e7bb835',
    'f4947272-1d6c-400d-a391-d7ea7c1c30d2',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：130 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'f4947272-1d6c-400d-a391-d7ea7c1c30d2',
    'f4e32ee7-43d2-4ea1-90fd-24588e7bb835',
    book,
    chapter,
    NOW() - (130 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 130;

  -- [西區區長] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'aa951160-ef5b-45d7-9759-75db4fc1f917',
    'aa951160@church-bible.com',
    '{"full_name": "西區區長"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    'aa951160-ef5b-45d7-9759-75db4fc1f917',
    '西區區長',
    '西區',
    '中正1',
    '詠溱',
    'zone_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '80a12936-69d1-44a5-b24c-39d7302fc497',
    'aa951160-ef5b-45d7-9759-75db4fc1f917',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：290 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'aa951160-ef5b-45d7-9759-75db4fc1f917',
    '80a12936-69d1-44a5-b24c-39d7302fc497',
    book,
    chapter,
    NOW() - (290 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 290;

  -- [梁哲瑋] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '69f58e02-3b84-40ea-bff0-a3331bc4a29d',
    '69f58e02@church-bible.com',
    '{"full_name": "梁哲瑋"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '69f58e02-3b84-40ea-bff0-a3331bc4a29d',
    '梁哲瑋',
    '北區',
    '中山1',
    '建安',
    'group_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '6d8aec7a-dfec-4ce6-93ae-0e4eb9c8059f',
    '69f58e02-3b84-40ea-bff0-a3331bc4a29d',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：300 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '69f58e02-3b84-40ea-bff0-a3331bc4a29d',
    '6d8aec7a-dfec-4ce6-93ae-0e4eb9c8059f',
    book,
    chapter,
    NOW() - (300 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 300;

  -- [徐淑貞] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '63e4885c-134b-4c27-bb8e-d63627e68fec',
    '63e4885c@church-bible.com',
    '{"full_name": "徐淑貞"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '63e4885c-134b-4c27-bb8e-d63627e68fec',
    '徐淑貞',
    '北區',
    '中山1',
    '建安',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '0fc75d08-2e19-4e0c-92d6-d7eb6107e3d4',
    '63e4885c-134b-4c27-bb8e-d63627e68fec',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：140 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '63e4885c-134b-4c27-bb8e-d63627e68fec',
    '0fc75d08-2e19-4e0c-92d6-d7eb6107e3d4',
    book,
    chapter,
    NOW() - (140 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 140;

  -- [孫啟宏] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'c624ad1e-1815-4f92-814e-cffcb0644cb8',
    'c624ad1e@church-bible.com',
    '{"full_name": "孫啟宏"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    'c624ad1e-1815-4f92-814e-cffcb0644cb8',
    '孫啟宏',
    '北區',
    '士林',
    '哲蓉',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '26e8680e-4d02-4ca2-a1f8-5ed90555492b',
    'c624ad1e-1815-4f92-814e-cffcb0644cb8',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：220 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'c624ad1e-1815-4f92-814e-cffcb0644cb8',
    '26e8680e-4d02-4ca2-a1f8-5ed90555492b',
    book,
    chapter,
    NOW() - (220 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 220;

  -- [傅小敏] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '90038bcd-80d2-40ec-93a2-e9cebb23a921',
    '90038bcd@church-bible.com',
    '{"full_name": "傅小敏"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '90038bcd-80d2-40ec-93a2-e9cebb23a921',
    '傅小敏',
    '北區',
    '士林',
    '哲蓉',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '5a126710-cabd-427e-8563-2b0d464a65b1',
    '90038bcd-80d2-40ec-93a2-e9cebb23a921',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：85 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '90038bcd-80d2-40ec-93a2-e9cebb23a921',
    '5a126710-cabd-427e-8563-2b0d464a65b1',
    book,
    chapter,
    NOW() - (85 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 85;

  -- [北區區長] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '20ea2dd4-e503-454d-9f3c-957bc86cc47d',
    '20ea2dd4@church-bible.com',
    '{"full_name": "北區區長"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '20ea2dd4-e503-454d-9f3c-957bc86cc47d',
    '北區區長',
    '北區',
    '中山1',
    '建安',
    'zone_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '8986abc3-7907-4d22-95c0-544fe71ae640',
    '20ea2dd4-e503-454d-9f3c-957bc86cc47d',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：275 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '20ea2dd4-e503-454d-9f3c-957bc86cc47d',
    '8986abc3-7907-4d22-95c0-544fe71ae640',
    book,
    chapter,
    NOW() - (275 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 275;

  -- [林青年] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'ce1a7262-4dd9-491c-947c-41d3e874203d',
    'ce1a7262@church-bible.com',
    '{"full_name": "林青年"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    'ce1a7262-4dd9-491c-947c-41d3e874203d',
    '林青年',
    '青少年',
    '青少年教會',
    '第一組',
    'group_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '5131e459-dd55-4d51-82dd-f56828aa9f58',
    'ce1a7262-4dd9-491c-947c-41d3e874203d',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：200 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'ce1a7262-4dd9-491c-947c-41d3e874203d',
    '5131e459-dd55-4d51-82dd-f56828aa9f58',
    book,
    chapter,
    NOW() - (200 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 200;

  -- [王同學] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'c638f36e-847d-463e-8b8e-55743a15604b',
    'c638f36e@church-bible.com',
    '{"full_name": "王同學"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    'c638f36e-847d-463e-8b8e-55743a15604b',
    '王同學',
    '青少年',
    '青少年教會',
    '第一組',
    'member',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'cbbc3e71-1639-40c4-8a8d-fd311cb4b6d0',
    'c638f36e-847d-463e-8b8e-55743a15604b',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：95 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'c638f36e-847d-463e-8b8e-55743a15604b',
    'cbbc3e71-1639-40c4-8a8d-fd311cb4b6d0',
    book,
    chapter,
    NOW() - (95 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 95;

  -- [慶典同工] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '9d4c9e46-b742-4c5f-a841-1ef47244bb40',
    '9d4c9e46@church-bible.com',
    '{"full_name": "慶典同工"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '9d4c9e46-b742-4c5f-a841-1ef47244bb40',
    '慶典同工',
    '慶典',
    '慶典1',
    '威宇',
    'group_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '06a70aa0-50e3-4dc5-a514-9c88580df36a',
    '9d4c9e46-b742-4c5f-a841-1ef47244bb40',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：240 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '9d4c9e46-b742-4c5f-a841-1ef47244bb40',
    '06a70aa0-50e3-4dc5-a514-9c88580df36a',
    book,
    chapter,
    NOW() - (240 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 240;

  -- [創藝同工] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '92f6ce9f-8b8a-47da-aab4-96c51012b23a',
    '92f6ce9f@church-bible.com',
    '{"full_name": "創藝同工"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '92f6ce9f-8b8a-47da-aab4-96c51012b23a',
    '創藝同工',
    '創藝',
    '創藝',
    '嘎嘎',
    'group_leader',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'e8aa1cde-b03e-400a-87de-5184a7345b65',
    '92f6ce9f-8b8a-47da-aab4-96c51012b23a',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：215 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '92f6ce9f-8b8a-47da-aab4-96c51012b23a',
    'e8aa1cde-b03e-400a-87de-5184a7345b65',
    book,
    chapter,
    NOW() - (215 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 215;

  -- [張主任牧師] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '02289c7c-c19a-4672-b322-5939112f9e91',
    '02289c7c@church-bible.com',
    '{"full_name": "張主任牧師"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, updated_at)
  VALUES (
    '02289c7c-c19a-4672-b322-5939112f9e91',
    '張主任牧師',
    '東區',
    '大安1',
    '馬鈴',
    'senior_pastor',
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'a03df370-7b90-4aa4-94cc-830cede02217',
    '02289c7c-c19a-4672-b322-5939112f9e91',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：320 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '02289c7c-c19a-4672-b322-5939112f9e91',
    'a03df370-7b90-4aa4-94cc-830cede02217',
    book,
    chapter,
    NOW() - (320 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 320;

END $$;
