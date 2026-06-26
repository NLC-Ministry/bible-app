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

  -- 建立虛擬組織架構 (大區、牧區、小組)
  INSERT INTO public.great_regions (id, name) VALUES 
  ('da000000-0000-0000-0000-000000000001', '示範大區A'),
  ('da000000-0000-0000-0000-000000000002', '示範大區B'),
  ('da000000-0000-0000-0000-000000000003', '示範大區C'),
  ('da000000-0000-0000-0000-000000000004', '示範大區D')
  ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) VALUES
  ('da000000-0000-0000-0000-000000000011', '示範牧區甲', 'da000000-0000-0000-0000-000000000001'),
  ('da000000-0000-0000-0000-000000000012', '示範牧區乙', 'da000000-0000-0000-0000-000000000001'),
  ('da000000-0000-0000-0000-000000000013', '示範牧區丙', 'da000000-0000-0000-0000-000000000001'),
  ('da000000-0000-0000-0000-000000000014', '示範牧區丁', 'da000000-0000-0000-0000-000000000002'),
  ('da000000-0000-0000-0000-000000000015', '示範牧區戊', 'da000000-0000-0000-0000-000000000002'),
  ('da000000-0000-0000-0000-000000000016', '示範牧區己', 'da000000-0000-0000-0000-000000000002'),
  ('da000000-0000-0000-0000-000000000017', '示範牧區庚', 'da000000-0000-0000-0000-000000000003'),
  ('da000000-0000-0000-0000-000000000018', '示範牧區辛', 'da000000-0000-0000-0000-000000000003'),
  ('da000000-0000-0000-0000-000000000019', '示範牧區壬', 'da000000-0000-0000-0000-000000000004'),
  ('da000000-0000-0000-0000-000000000020', '示範牧區癸', 'da000000-0000-0000-0000-000000000004')
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) VALUES
  ('da000000-0000-0000-0000-000000000101', '示範小組1', 'da000000-0000-0000-0000-000000000011'),
  ('da000000-0000-0000-0000-000000000102', '示範小組2', 'da000000-0000-0000-0000-000000000011'),
  ('da000000-0000-0000-0000-000000000103', '示範小組3', 'da000000-0000-0000-0000-000000000012'),
  ('da000000-0000-0000-0000-000000000104', '示範小組4', 'da000000-0000-0000-0000-000000000013'),
  ('da000000-0000-0000-0000-000000000105', '示範小組5', 'da000000-0000-0000-0000-000000000014'),
  ('da000000-0000-0000-0000-000000000106', '示範小組6', 'da000000-0000-0000-0000-000000000015'),
  ('da000000-0000-0000-0000-000000000107', '示範小組7', 'da000000-0000-0000-0000-000000000016'),
  ('da000000-0000-0000-0000-000000000108', '示範小組8', 'da000000-0000-0000-0000-000000000017'),
  ('da000000-0000-0000-0000-000000000109', '示範小組9', 'da000000-0000-0000-0000-000000000018'),
  ('da000000-0000-0000-0000-000000000110', '示範小組10', 'da000000-0000-0000-0000-000000000019'),
  ('da000000-0000-0000-0000-000000000111', '示範小組11', 'da000000-0000-0000-0000-000000000020')
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  -- [陳建國] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'ba7e5f7a-93c9-4b3f-b3d2-ede41124ba34',
    'ba7e5f7a@church-bible.com',
    '{"full_name": "陳建國"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'ba7e5f7a-93c9-4b3f-b3d2-ede41124ba34',
    '陳建國',
    '示範大區A',
    '示範牧區甲',
    '示範小組1',
    'group_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '31d596ef-59de-4f57-b5cf-ed0a62aea196',
    'ba7e5f7a-93c9-4b3f-b3d2-ede41124ba34',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：280 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'ba7e5f7a-93c9-4b3f-b3d2-ede41124ba34',
    '31d596ef-59de-4f57-b5cf-ed0a62aea196',
    book,
    chapter,
    NOW() - (280 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 280;

  -- [林秀琴] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'e41c09cd-3694-4f7e-b393-4adcda0acc69',
    'e41c09cd@church-bible.com',
    '{"full_name": "林秀琴"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'e41c09cd-3694-4f7e-b393-4adcda0acc69',
    '林秀琴',
    '示範大區A',
    '示範牧區甲',
    '示範小組1',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'ccaac502-0406-4c11-889d-dab1f2fb7363',
    'e41c09cd-3694-4f7e-b393-4adcda0acc69',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：110 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'e41c09cd-3694-4f7e-b393-4adcda0acc69',
    'ccaac502-0406-4c11-889d-dab1f2fb7363',
    book,
    chapter,
    NOW() - (110 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 110;

  -- [吳志明] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'f6364874-5c3e-4c34-8ab4-4f58806edc26',
    'f6364874@church-bible.com',
    '{"full_name": "吳志明"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'f6364874-5c3e-4c34-8ab4-4f58806edc26',
    '吳志明',
    '示範大區A',
    '示範牧區甲',
    '示範小組2',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '729d9856-7431-48d4-931e-986a1f197b36',
    'f6364874-5c3e-4c34-8ab4-4f58806edc26',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：290 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'f6364874-5c3e-4c34-8ab4-4f58806edc26',
    '729d9856-7431-48d4-931e-986a1f197b36',
    book,
    chapter,
    NOW() - (290 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 290;

  -- [張明哲] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'd04051db-87ef-4d6c-abb2-a1526438ebee',
    'd04051db@church-bible.com',
    '{"full_name": "張明哲"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'd04051db-87ef-4d6c-abb2-a1526438ebee',
    '張明哲',
    '示範大區A',
    '示範牧區乙',
    '示範小組3',
    'group_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'deef3d02-9ed5-4360-8c52-97eb021683b6',
    'd04051db-87ef-4d6c-abb2-a1526438ebee',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：310 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'd04051db-87ef-4d6c-abb2-a1526438ebee',
    'deef3d02-9ed5-4360-8c52-97eb021683b6',
    book,
    chapter,
    NOW() - (310 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 310;

  -- [黃雅婷] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'e64b40a1-5099-4d6b-904e-87e8284c2de9',
    'e64b40a1@church-bible.com',
    '{"full_name": "黃雅婷"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'e64b40a1-5099-4d6b-904e-87e8284c2de9',
    '黃雅婷',
    '示範大區A',
    '示範牧區乙',
    '示範小組3',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '4e7f3077-ea84-4c87-abb5-fa16b825cb26',
    'e64b40a1-5099-4d6b-904e-87e8284c2de9',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：60 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'e64b40a1-5099-4d6b-904e-87e8284c2de9',
    '4e7f3077-ea84-4c87-abb5-fa16b825cb26',
    book,
    chapter,
    NOW() - (60 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 60;

  -- [李冠宇] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'b02367b0-e5d7-42e5-8197-eafe8a553f86',
    'b02367b0@church-bible.com',
    '{"full_name": "李冠宇"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'b02367b0-e5d7-42e5-8197-eafe8a553f86',
    '李冠宇',
    '示範大區A',
    '示範牧區丙',
    '示範小組4',
    'group_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '6e491c0a-a1bd-421f-a3a8-cece767e28ec',
    'b02367b0-e5d7-42e5-8197-eafe8a553f86',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：170 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'b02367b0-e5d7-42e5-8197-eafe8a553f86',
    '6e491c0a-a1bd-421f-a3a8-cece767e28ec',
    book,
    chapter,
    NOW() - (170 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 170;

  -- [王淑芬] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'f071b619-e040-4676-9116-d582052aa17f',
    'f071b619@church-bible.com',
    '{"full_name": "王淑芬"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'f071b619-e040-4676-9116-d582052aa17f',
    '王淑芬',
    '示範大區A',
    '示範牧區丙',
    '示範小組4',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '6dff9907-a61f-4f1c-8f0e-3750e4bfa3d6',
    'f071b619-e040-4676-9116-d582052aa17f',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：50 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'f071b619-e040-4676-9116-d582052aa17f',
    '6dff9907-a61f-4f1c-8f0e-3750e4bfa3d6',
    book,
    chapter,
    NOW() - (50 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 50;

  -- [東區區長] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'a14cd31e-b44e-4d05-ba29-3b8ca1f2aed2',
    'a14cd31e@church-bible.com',
    '{"full_name": "東區區長"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'a14cd31e-b44e-4d05-ba29-3b8ca1f2aed2',
    '東區區長',
    '示範大區A',
    '示範牧區甲',
    '示範小組1',
    'zone_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'b052e166-5af0-44d1-b42f-8a61c0796d82',
    'a14cd31e-b44e-4d05-ba29-3b8ca1f2aed2',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：260 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'a14cd31e-b44e-4d05-ba29-3b8ca1f2aed2',
    'b052e166-5af0-44d1-b42f-8a61c0796d82',
    book,
    chapter,
    NOW() - (260 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 260;

  -- [東區大區長] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'ab6c07fe-8031-4dfe-894e-58683567292b',
    'ab6c07fe@church-bible.com',
    '{"full_name": "東區大區長"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'ab6c07fe-8031-4dfe-894e-58683567292b',
    '東區大區長',
    '示範大區A',
    '示範牧區甲',
    '示範小組1',
    'great_zone_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'f795cbe7-52cf-49aa-bbf1-65389c872726',
    'ab6c07fe-8031-4dfe-894e-58683567292b',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：300 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'ab6c07fe-8031-4dfe-894e-58683567292b',
    'f795cbe7-52cf-49aa-bbf1-65389c872726',
    book,
    chapter,
    NOW() - (300 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 300;

  -- [楊俊傑] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '2fd3cc45-7e0c-4653-ace0-9a44f77d53ce',
    '2fd3cc45@church-bible.com',
    '{"full_name": "楊俊傑"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '2fd3cc45-7e0c-4653-ace0-9a44f77d53ce',
    '楊俊傑',
    '示範大區B',
    '示範牧區丁',
    '示範小組5',
    'group_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '573a83b6-d901-4ece-869c-95be6c42e864',
    '2fd3cc45-7e0c-4653-ace0-9a44f77d53ce',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：315 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '2fd3cc45-7e0c-4653-ace0-9a44f77d53ce',
    '573a83b6-d901-4ece-869c-95be6c42e864',
    book,
    chapter,
    NOW() - (315 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 315;

  -- [許美惠] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '74c4beb3-4bd6-498f-adca-3e1a3619761e',
    '74c4beb3@church-bible.com',
    '{"full_name": "許美惠"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '74c4beb3-4bd6-498f-adca-3e1a3619761e',
    '許美惠',
    '示範大區B',
    '示範牧區丁',
    '示範小組5',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'dbb0ae7d-520a-4b6b-9ae2-e24784a4f38b',
    '74c4beb3-4bd6-498f-adca-3e1a3619761e',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：250 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '74c4beb3-4bd6-498f-adca-3e1a3619761e',
    'dbb0ae7d-520a-4b6b-9ae2-e24784a4f38b',
    book,
    chapter,
    NOW() - (250 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 250;

  -- [鄭裕民] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '0c905bf0-567c-4034-8ac7-8f52f1478690',
    '0c905bf0@church-bible.com',
    '{"full_name": "鄭裕民"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '0c905bf0-567c-4034-8ac7-8f52f1478690',
    '鄭裕民',
    '示範大區B',
    '示範牧區戊',
    '示範小組6',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'cd78b333-ec08-438d-a8c7-dca30eb27132',
    '0c905bf0-567c-4034-8ac7-8f52f1478690',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：150 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '0c905bf0-567c-4034-8ac7-8f52f1478690',
    'cd78b333-ec08-438d-a8c7-dca30eb27132',
    book,
    chapter,
    NOW() - (150 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 150;

  -- [謝佩珊] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '29c9bdc5-2696-4473-8c35-12b571ca9982',
    '29c9bdc5@church-bible.com',
    '{"full_name": "謝佩珊"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '29c9bdc5-2696-4473-8c35-12b571ca9982',
    '謝佩珊',
    '示範大區B',
    '示範牧區戊',
    '示範小組6',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'bd0a5525-daf9-4ba3-add5-6bb1378454ad',
    '29c9bdc5-2696-4473-8c35-12b571ca9982',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：80 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '29c9bdc5-2696-4473-8c35-12b571ca9982',
    'bd0a5525-daf9-4ba3-add5-6bb1378454ad',
    book,
    chapter,
    NOW() - (80 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 80;

  -- [郭家豪] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '7635e39e-3e29-4804-894a-e7629a137393',
    '7635e39e@church-bible.com',
    '{"full_name": "郭家豪"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '7635e39e-3e29-4804-894a-e7629a137393',
    '郭家豪',
    '示範大區B',
    '示範牧區己',
    '示範小組7',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '388ff21c-6948-4f2e-a70b-08ccf4a1d8b1',
    '7635e39e-3e29-4804-894a-e7629a137393',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：270 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '7635e39e-3e29-4804-894a-e7629a137393',
    '388ff21c-6948-4f2e-a70b-08ccf4a1d8b1',
    book,
    chapter,
    NOW() - (270 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 270;

  -- [南區區長] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '7f369baa-6db8-4c28-9b8d-44d5f0964144',
    '7f369baa@church-bible.com',
    '{"full_name": "南區區長"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '7f369baa-6db8-4c28-9b8d-44d5f0964144',
    '南區區長',
    '示範大區B',
    '示範牧區丁',
    '示範小組5',
    'zone_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '15e87195-66a6-4768-9bd1-7e1f10ce7299',
    '7f369baa-6db8-4c28-9b8d-44d5f0964144',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：280 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '7f369baa-6db8-4c28-9b8d-44d5f0964144',
    '15e87195-66a6-4768-9bd1-7e1f10ce7299',
    book,
    chapter,
    NOW() - (280 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 280;

  -- [葉子毅] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '2c3f9569-c1d8-4852-8bb6-4ac2a193befc',
    '2c3f9569@church-bible.com',
    '{"full_name": "葉子毅"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '2c3f9569-c1d8-4852-8bb6-4ac2a193befc',
    '葉子毅',
    '示範大區C',
    '示範牧區庚',
    '示範小組8',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '79c9cfc9-7954-4d19-8b93-c59fd810d5ac',
    '2c3f9569-c1d8-4852-8bb6-4ac2a193befc',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：90 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '2c3f9569-c1d8-4852-8bb6-4ac2a193befc',
    '79c9cfc9-7954-4d19-8b93-c59fd810d5ac',
    book,
    chapter,
    NOW() - (90 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 90;

  -- [周宛儒] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '68b2e8ac-b34e-4b77-a31f-3913ab8fa08f',
    '68b2e8ac@church-bible.com',
    '{"full_name": "周宛儒"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '68b2e8ac-b34e-4b77-a31f-3913ab8fa08f',
    '周宛儒',
    '示範大區C',
    '示範牧區庚',
    '示範小組8',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'aeda6ef9-9158-4743-a9a2-36d9f011b043',
    '68b2e8ac-b34e-4b77-a31f-3913ab8fa08f',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：160 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '68b2e8ac-b34e-4b77-a31f-3913ab8fa08f',
    'aeda6ef9-9158-4743-a9a2-36d9f011b043',
    book,
    chapter,
    NOW() - (160 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 160;

  -- [蕭志平] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '6afbf6e7-3fba-47ac-b314-889292ff69ab',
    '6afbf6e7@church-bible.com',
    '{"full_name": "蕭志平"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '6afbf6e7-3fba-47ac-b314-889292ff69ab',
    '蕭志平',
    '示範大區C',
    '示範牧區辛',
    '示範小組9',
    'group_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'fde238fb-2eec-4b47-a902-c591fbb4dba5',
    '6afbf6e7-3fba-47ac-b314-889292ff69ab',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：305 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '6afbf6e7-3fba-47ac-b314-889292ff69ab',
    'fde238fb-2eec-4b47-a902-c591fbb4dba5',
    book,
    chapter,
    NOW() - (305 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 305;

  -- [莊雅雯] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '05ee16e8-f969-44ce-b689-92feb0f30841',
    '05ee16e8@church-bible.com',
    '{"full_name": "莊雅雯"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '05ee16e8-f969-44ce-b689-92feb0f30841',
    '莊雅雯',
    '示範大區C',
    '示範牧區辛',
    '示範小組9',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'd7c8e499-6c47-4602-ba93-3fe3042dec40',
    '05ee16e8-f969-44ce-b689-92feb0f30841',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：130 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '05ee16e8-f969-44ce-b689-92feb0f30841',
    'd7c8e499-6c47-4602-ba93-3fe3042dec40',
    book,
    chapter,
    NOW() - (130 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 130;

  -- [西區區長] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '66e48db8-1e9a-45df-ab34-e442d363885f',
    '66e48db8@church-bible.com',
    '{"full_name": "西區區長"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '66e48db8-1e9a-45df-ab34-e442d363885f',
    '西區區長',
    '示範大區C',
    '示範牧區庚',
    '示範小組8',
    'zone_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '1bff3f74-57db-4df0-a0a3-ec4c69f0e990',
    '66e48db8-1e9a-45df-ab34-e442d363885f',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：290 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '66e48db8-1e9a-45df-ab34-e442d363885f',
    '1bff3f74-57db-4df0-a0a3-ec4c69f0e990',
    book,
    chapter,
    NOW() - (290 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 290;

  -- [梁哲瑋] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '696dd6fe-e56b-40a8-8625-010e0fd3f5c3',
    '696dd6fe@church-bible.com',
    '{"full_name": "梁哲瑋"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '696dd6fe-e56b-40a8-8625-010e0fd3f5c3',
    '梁哲瑋',
    '示範大區D',
    '示範牧區壬',
    '示範小組10',
    'group_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'c003b7ec-40a9-4d7e-9e58-75c9b20885a5',
    '696dd6fe-e56b-40a8-8625-010e0fd3f5c3',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：300 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '696dd6fe-e56b-40a8-8625-010e0fd3f5c3',
    'c003b7ec-40a9-4d7e-9e58-75c9b20885a5',
    book,
    chapter,
    NOW() - (300 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 300;

  -- [徐淑貞] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '00ac5c24-7d52-4a17-8b05-763821b95039',
    '00ac5c24@church-bible.com',
    '{"full_name": "徐淑貞"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '00ac5c24-7d52-4a17-8b05-763821b95039',
    '徐淑貞',
    '示範大區D',
    '示範牧區壬',
    '示範小組10',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '0c986487-5b19-454e-a2d4-09fb23009727',
    '00ac5c24-7d52-4a17-8b05-763821b95039',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：140 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '00ac5c24-7d52-4a17-8b05-763821b95039',
    '0c986487-5b19-454e-a2d4-09fb23009727',
    book,
    chapter,
    NOW() - (140 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 140;

  -- [孫啟宏] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'cef53f07-37c0-4e4a-95b2-67ec44b60926',
    'cef53f07@church-bible.com',
    '{"full_name": "孫啟宏"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'cef53f07-37c0-4e4a-95b2-67ec44b60926',
    '孫啟宏',
    '示範大區D',
    '示範牧區癸',
    '示範小組11',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'fef15b43-aa11-4ba4-892c-0e533ae7fb09',
    'cef53f07-37c0-4e4a-95b2-67ec44b60926',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：220 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'cef53f07-37c0-4e4a-95b2-67ec44b60926',
    'fef15b43-aa11-4ba4-892c-0e533ae7fb09',
    book,
    chapter,
    NOW() - (220 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 220;

  -- [傅小敏] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '3a30651e-4590-48e0-b677-ee68e6cc061d',
    '3a30651e@church-bible.com',
    '{"full_name": "傅小敏"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '3a30651e-4590-48e0-b677-ee68e6cc061d',
    '傅小敏',
    '示範大區D',
    '示範牧區癸',
    '示範小組11',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '345abc89-3f87-491b-8a32-97e8a222c95f',
    '3a30651e-4590-48e0-b677-ee68e6cc061d',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：85 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '3a30651e-4590-48e0-b677-ee68e6cc061d',
    '345abc89-3f87-491b-8a32-97e8a222c95f',
    book,
    chapter,
    NOW() - (85 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 85;

  -- [北區區長] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '9685e28f-c85e-4d96-a87a-00bb6f4427af',
    '9685e28f@church-bible.com',
    '{"full_name": "北區區長"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '9685e28f-c85e-4d96-a87a-00bb6f4427af',
    '北區區長',
    '示範大區D',
    '示範牧區壬',
    '示範小組10',
    'zone_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '270c96cc-257b-4610-a3bc-ebdf2bd1988a',
    '9685e28f-c85e-4d96-a87a-00bb6f4427af',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：275 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '9685e28f-c85e-4d96-a87a-00bb6f4427af',
    '270c96cc-257b-4610-a3bc-ebdf2bd1988a',
    book,
    chapter,
    NOW() - (275 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 275;

  -- [林青年] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '16f331f8-5d4e-4ca2-b215-ff14be39df38',
    '16f331f8@church-bible.com',
    '{"full_name": "林青年"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '16f331f8-5d4e-4ca2-b215-ff14be39df38',
    '林青年',
    '示範大區A',
    '示範牧區甲',
    '示範小組1',
    'group_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '4ca8f767-42bd-4019-970f-2b791fa8db04',
    '16f331f8-5d4e-4ca2-b215-ff14be39df38',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：200 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '16f331f8-5d4e-4ca2-b215-ff14be39df38',
    '4ca8f767-42bd-4019-970f-2b791fa8db04',
    book,
    chapter,
    NOW() - (200 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 200;

  -- [王同學] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'd37d87e3-2232-4f4b-acb7-a21eb4f50e0a',
    'd37d87e3@church-bible.com',
    '{"full_name": "王同學"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'd37d87e3-2232-4f4b-acb7-a21eb4f50e0a',
    '王同學',
    '示範大區A',
    '示範牧區甲',
    '示範小組1',
    'member',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '2cc4ab37-2f54-4e35-a530-df3d5cf69f20',
    'd37d87e3-2232-4f4b-acb7-a21eb4f50e0a',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：95 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'd37d87e3-2232-4f4b-acb7-a21eb4f50e0a',
    '2cc4ab37-2f54-4e35-a530-df3d5cf69f20',
    book,
    chapter,
    NOW() - (95 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 95;

  -- [慶典同工] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'd1ae3a8f-4b3a-4796-af40-c2d323597320',
    'd1ae3a8f@church-bible.com',
    '{"full_name": "慶典同工"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'd1ae3a8f-4b3a-4796-af40-c2d323597320',
    '慶典同工',
    '示範大區B',
    '示範牧區丁',
    '示範小組5',
    'group_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    '4da64350-b456-49e8-960b-ba02eaee4b0a',
    'd1ae3a8f-4b3a-4796-af40-c2d323597320',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：240 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'd1ae3a8f-4b3a-4796-af40-c2d323597320',
    '4da64350-b456-49e8-960b-ba02eaee4b0a',
    book,
    chapter,
    NOW() - (240 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 240;

  -- [創藝同工] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    'e4e37666-5787-43a7-9525-11b9044c4135',
    'e4e37666@church-bible.com',
    '{"full_name": "創藝同工"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    'e4e37666-5787-43a7-9525-11b9044c4135',
    '創藝同工',
    '示範大區C',
    '示範牧區庚',
    '示範小組8',
    'group_leader',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'fd74e172-0407-4778-b532-b38f24d1f950',
    'e4e37666-5787-43a7-9525-11b9044c4135',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：215 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    'e4e37666-5787-43a7-9525-11b9044c4135',
    'fd74e172-0407-4778-b532-b38f24d1f950',
    book,
    chapter,
    NOW() - (215 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 215;

  -- [張主任牧師] --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, encrypted_password)
  VALUES (
    '934334bb-38fd-4c60-9681-e1d6e873bd34',
    '934334bb@church-bible.com',
    '{"full_name": "張主任牧師"}',
    NOW() - INTERVAL '60 days',
    NOW(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, great_region, pastoral_zone, small_group, role, is_demo, updated_at)
  VALUES (
    '934334bb-38fd-4c60-9681-e1d6e873bd34',
    '張主任牧師',
    '示範大區A',
    '示範牧區甲',
    '示範小組1',
    'senior_pastor',
    TRUE,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.reading_plans (id, user_id, name, start_date, end_date, target_books)
  VALUES (
    'aff1cdcc-c211-4a01-84a6-4306c76bcb9b',
    '934334bb-38fd-4c60-9681-e1d6e873bd34',
    '第一季速讀：2026年7月~9月',
    '2026-07-01',
    '2026-09-30',
    ARRAY['創世記', '馬太福音', '列王紀下', '雅各書', '出埃及記', '馬可福音', '約伯記', '加拉太書', '哈巴谷書', '猶大書', '利未記', '路加福音', '歷代志下', '帖撒羅尼迦前書', '約拿書', '約翰二書', '彌迦書', '約翰三書']
  ) ON CONFLICT (id) DO NOTHING;

  -- 插入進度歷史：320 章
  INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, read_at)
  SELECT 
    '934334bb-38fd-4c60-9681-e1d6e873bd34',
    'aff1cdcc-c211-4a01-84a6-4306c76bcb9b',
    book,
    chapter,
    NOW() - (320 - idx) * INTERVAL '4 hours'
  FROM temp_chapters
  WHERE idx <= 320;

END $$;
