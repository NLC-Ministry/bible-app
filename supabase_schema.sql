-- ==========================================
-- 教會速讀挑戰與統計系統 - Supabase 資料庫腳本 (RBAC & Google OAuth 升級版)
-- 請將此腳本複製到 Supabase Dashboard 中的 SQL Editor 並執行。
-- ==========================================

-- 1. 建立組織架構表 (大區、牧區、小組)
CREATE TABLE IF NOT EXISTS public.great_regions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS public.pastoral_zones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  great_region_id UUID REFERENCES public.great_regions(id) ON DELETE CASCADE,
  UNIQUE(name, great_region_id)
);

CREATE TABLE IF NOT EXISTS public.small_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  pastoral_zone_id UUID REFERENCES public.pastoral_zones(id) ON DELETE CASCADE,
  UNIQUE(name, pastoral_zone_id)
);

-- 2. 建立使用者個人資料表 (Profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  great_region_id UUID REFERENCES public.great_regions(id) ON DELETE SET NULL,
  pastoral_zone_id UUID REFERENCES public.pastoral_zones(id) ON DELETE SET NULL,
  small_group_id UUID REFERENCES public.small_groups(id) ON DELETE SET NULL,
  great_region TEXT NOT NULL, -- 所屬大區 (例如：東區、南區)
  pastoral_zone TEXT NOT NULL,
  small_group TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 權限角色 (member, group_leader, zone_leader, great_zone_leader, admin, senior_pastor)
  is_demo BOOLEAN NOT NULL DEFAULT FALSE, -- 是否為示範/測試帳號，正式上線後統計一律排除 demo 成員
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  
  CONSTRAINT check_valid_role CHECK (role IN ('member', 'group_leader', 'zone_leader', 'great_zone_leader', 'admin', 'senior_pastor'))
);

-- 建立自動同步文字欄位的觸發器函數與觸發器
CREATE OR REPLACE FUNCTION public.sync_profile_text_fields()
RETURNS TRIGGER AS $$
DECLARE
  r_id UUID;
  z_id UUID;
  g_id UUID;
  user_role TEXT;
BEGIN
  -- 取得使用者角色
  SELECT role INTO user_role FROM public.profiles WHERE id = NEW.id;
  IF user_role IS NULL THEN
    user_role := NEW.role;
  END IF;

  -- 0. 防範角色篡改 (Privilege Escalation Protection)
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role IS DISTINCT FROM NEW.role THEN
      IF auth.uid() IS NOT NULL AND (SELECT role FROM public.profiles WHERE id = auth.uid()) NOT IN ('admin', 'senior_pastor') THEN
        RAISE EXCEPTION '權限不足，您不能修改角色權限！';
      END IF;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    -- 如果是新註冊用戶，且資料庫中已有管理員，強制將角色設為 'member'，防止自封 admin
    IF NEW.role NOT IN ('member') THEN
      IF (SELECT COUNT(*) FROM public.profiles WHERE role IN ('admin', 'senior_pastor')) > 0 THEN
        NEW.role := 'member';
      END IF;
    END IF;
  END IF;

  -- 1. 大區同步與防自訂
  IF NEW.great_region_id IS NOT NULL THEN
    SELECT name INTO NEW.great_region FROM public.great_regions WHERE id = NEW.great_region_id;
  ELSIF NEW.great_region IS NOT NULL AND NEW.great_region <> '' THEN
    SELECT id INTO r_id FROM public.great_regions WHERE name = NEW.great_region;
    IF r_id IS NOT NULL THEN
      NEW.great_region_id := r_id;
    ELSIF user_role IN ('admin', 'senior_pastor') THEN
      INSERT INTO public.great_regions (id, name)
      VALUES (gen_random_uuid(), NEW.great_region)
      RETURNING id INTO r_id;
      NEW.great_region_id := r_id;
    ELSE
      -- 非管理員不能新增大區，將其清空或設為預設
      RAISE EXCEPTION '只有系統管理員可以新增或自訂大區！';
    END IF;
  END IF;

  -- 2. 牧區同步與防自訂
  IF NEW.pastoral_zone_id IS NOT NULL THEN
    SELECT name INTO NEW.pastoral_zone FROM public.pastoral_zones WHERE id = NEW.pastoral_zone_id;
  ELSIF NEW.pastoral_zone IS NOT NULL AND NEW.pastoral_zone <> '' THEN
    SELECT id INTO z_id FROM public.pastoral_zones 
    WHERE name = NEW.pastoral_zone AND great_region_id = NEW.great_region_id;
    
    IF z_id IS NOT NULL THEN
      NEW.pastoral_zone_id := z_id;
    ELSIF user_role IN ('admin', 'senior_pastor') AND NEW.great_region_id IS NOT NULL THEN
      INSERT INTO public.pastoral_zones (id, name, great_region_id)
      VALUES (gen_random_uuid(), NEW.pastoral_zone, NEW.great_region_id)
      RETURNING id INTO z_id;
      NEW.pastoral_zone_id := z_id;
    ELSE
      RAISE EXCEPTION '只有系統管理員可以新增或自訂牧區！';
    END IF;
  END IF;

  -- 3. 小組同步與防自訂
  IF NEW.small_group_id IS NOT NULL THEN
    SELECT name INTO NEW.small_group FROM public.small_groups WHERE id = NEW.small_group_id;
  ELSIF NEW.small_group IS NOT NULL AND NEW.small_group <> '' THEN
    SELECT id INTO g_id FROM public.small_groups 
    WHERE name = NEW.small_group AND pastoral_zone_id = NEW.pastoral_zone_id;
    
    IF g_id IS NOT NULL THEN
      NEW.small_group_id := g_id;
    ELSIF user_role IN ('admin', 'senior_pastor') AND NEW.pastoral_zone_id IS NOT NULL THEN
      INSERT INTO public.small_groups (id, name, pastoral_zone_id)
      VALUES (gen_random_uuid(), NEW.small_group, NEW.pastoral_zone_id)
      RETURNING id INTO g_id;
      NEW.small_group_id := g_id;
    ELSE
      RAISE EXCEPTION '只有系統管理員可以新增或自訂小組！';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trigger_sync_profile_text_fields
BEFORE INSERT OR UPDATE
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_text_fields();

-- 2. 建立讀經計畫表 (Reading Plans)
CREATE TABLE IF NOT EXISTS public.reading_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  target_books TEXT[] NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 3. 建立已讀章節紀錄表 (Reading Logs)
CREATE TABLE IF NOT EXISTS public.reading_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  plan_id UUID REFERENCES public.reading_plans(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  
  CONSTRAINT unique_user_plan_book_chapter UNIQUE (user_id, plan_id, book, chapter)
);

-- ==========================================
-- 建立 SECURITY DEFINER 輔助函數以防止 RLS 遞迴查詢
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE (my_role TEXT, my_great_region TEXT, my_pastoral_zone TEXT, my_small_group TEXT)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT role, great_region, pastoral_zone, small_group 
  FROM public.profiles 
  WHERE id = auth.uid();
$$;

-- 啟用安全原則 (Row Level Security - RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.great_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastoral_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.small_groups ENABLE ROW LEVEL SECURITY;

-- --- 組織架構資料表讀取與管理策略 ---
CREATE POLICY "允許已驗證用戶讀取大區資料" ON public.great_regions FOR SELECT TO authenticated USING (true);
CREATE POLICY "允許已驗證用戶讀取牧區資料" ON public.pastoral_zones FOR SELECT TO authenticated USING (true);
CREATE POLICY "允許已驗證用戶讀取小組資料" ON public.small_groups FOR SELECT TO authenticated USING (true);

CREATE POLICY "允許管理員管理大區資料" ON public.great_regions FOR ALL TO authenticated USING (
  (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')
);
CREATE POLICY "允許管理員管理牧區資料" ON public.pastoral_zones FOR ALL TO authenticated USING (
  (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')
);
CREATE POLICY "允許管理員管理小組資料" ON public.small_groups FOR ALL TO authenticated USING (
  (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')
);

-- ==========================================
-- 設定 RLS 權限原則 (Policies)
-- ==========================================

-- --- Profiles 權限策略 ---
CREATE POLICY "允許用戶新增或更新自己的個人資料" 
  ON public.profiles FOR ALL 
  TO authenticated 
  USING (auth.uid() = id) 
  WITH CHECK (auth.uid() = id);

CREATE POLICY "根據角色限制 Profiles 讀取權限" 
  ON public.profiles FOR SELECT 
  TO authenticated 
  USING (
    id = auth.uid() OR -- 自己可以讀自己
    (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor') OR -- admin & 主任牧師可讀全部
    ((SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader' AND (SELECT my_great_region FROM public.get_my_profile()) = great_region) OR -- 大區長可讀自己大區
    ((SELECT my_role FROM public.get_my_profile()) = 'zone_leader' AND (SELECT my_pastoral_zone FROM public.get_my_profile()) = pastoral_zone) OR -- 區長可讀自己牧區
    ((SELECT my_role FROM public.get_my_profile()) = 'group_leader' AND (SELECT my_pastoral_zone FROM public.get_my_profile()) = pastoral_zone AND (SELECT my_small_group FROM public.get_my_profile()) = small_group) -- 小組長可讀自己小組
  );

-- --- Reading Plans 權限策略 ---
CREATE POLICY "允許用戶管理自己的讀經計畫" 
  ON public.reading_plans FOR ALL 
  TO authenticated 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "根據角色限制 Reading Plans 讀取權限" 
  ON public.reading_plans FOR SELECT 
  TO authenticated 
  USING (
    user_id = auth.uid() OR
    (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor') OR
    EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = user_id AND (
        (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader' AND (SELECT my_great_region FROM public.get_my_profile()) = p.great_region OR
        (SELECT my_role FROM public.get_my_profile()) = 'zone_leader' AND (SELECT my_pastoral_zone FROM public.get_my_profile()) = p.pastoral_zone OR
        (SELECT my_role FROM public.get_my_profile()) = 'group_leader' AND (SELECT my_pastoral_zone FROM public.get_my_profile()) = p.pastoral_zone AND (SELECT my_small_group FROM public.get_my_profile()) = p.small_group
      )
    )
  );

-- --- Reading Logs 權限策略 ---
CREATE POLICY "允許用戶管理自己的讀經紀錄" 
  ON public.reading_logs FOR ALL 
  TO authenticated 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "根據角色限制 Reading Logs 讀取權限" 
  ON public.reading_logs FOR SELECT 
  TO authenticated 
  USING (
    user_id = auth.uid() OR
    (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor') OR
    EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = user_id AND (
        (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader' AND (SELECT my_great_region FROM public.get_my_profile()) = p.great_region OR
        (SELECT my_role FROM public.get_my_profile()) = 'zone_leader' AND (SELECT my_pastoral_zone FROM public.get_my_profile()) = p.pastoral_zone OR
        (SELECT my_role FROM public.get_my_profile()) = 'group_leader' AND (SELECT my_pastoral_zone FROM public.get_my_profile()) = p.pastoral_zone AND (SELECT my_small_group FROM public.get_my_profile()) = p.small_group
      )
    )
  );

-- ==========================================
-- 建立計算計畫總章數的輔助函數與個人排名計算函數
-- ==========================================

-- 建立計算計畫總章數的輔助函數
CREATE OR REPLACE FUNCTION public.get_plan_total_chapters(target_books TEXT[])
RETURNS INTEGER AS $$
DECLARE
  b TEXT;
  total INTEGER := 0;
BEGIN
  IF target_books IS NULL THEN
    RETURN 0;
  END IF;
  FOREACH b IN ARRAY target_books LOOP
    total := total + CASE b
      WHEN '創世記' THEN 50 WHEN '出埃及記' THEN 40 WHEN '利未記' THEN 27 WHEN '民數記' THEN 36 WHEN '申命記' THEN 34
      WHEN '約書亞記' THEN 24 WHEN '士師記' THEN 21 WHEN '路得記' THEN 4 WHEN '撒母耳記上' THEN 31 WHEN '撒母耳記下' THEN 24
      WHEN '列王紀上' THEN 22 WHEN '列王紀下' THEN 25 WHEN '歷代志上' THEN 29 WHEN '歷代志下' THEN 36 WHEN '以斯拉記' THEN 10
      WHEN '尼希米記' THEN 13 WHEN '以斯帖記' THEN 10 WHEN '約伯記' THEN 42 WHEN '詩篇' THEN 150 WHEN '箴言' THEN 31
      WHEN '傳道書' THEN 12 WHEN '雅歌' THEN 8 WHEN '以賽亞書' THEN 66 WHEN '耶利米書' THEN 52 WHEN '耶利米哀歌' THEN 5
      WHEN '以西結書' THEN 48 WHEN '但以理書' THEN 12 WHEN '何西阿書' THEN 14 WHEN '約珥書' THEN 3 WHEN '阿摩司書' THEN 9
      WHEN '俄巴底亞書' THEN 1 WHEN '約拿書' THEN 4 WHEN '彌迦書' THEN 7 WHEN '那鴻書' THEN 3 WHEN '哈巴谷書' THEN 3
      WHEN '西番雅書' THEN 3 WHEN '哈該書' THEN 2 WHEN '撒迦利亞書' THEN 14 WHEN '瑪拉基書' THEN 4
      WHEN '馬太福音' THEN 28 WHEN '馬可福音' THEN 16 WHEN '路加福音' THEN 24 WHEN '約翰福音' THEN 21 WHEN '使徒行傳' THEN 28
      WHEN '羅馬書' THEN 16 WHEN '哥林多前書' THEN 16 WHEN '哥林多後書' THEN 13 WHEN '加拉太書' THEN 6 WHEN '以弗所書' THEN 6
      WHEN '腓立比書' THEN 4 WHEN '歌羅西書' THEN 4 WHEN '帖撒羅尼迦前書' THEN 5 WHEN '帖撒羅尼迦後書' THEN 3 WHEN '提摩太前書' THEN 6
      WHEN '提摩太後書' THEN 4 WHEN '提多書' THEN 3 WHEN '腓利門書' THEN 1 WHEN '希伯來書' THEN 13 WHEN '雅各書' THEN 5
      WHEN '彼得前書' THEN 5 WHEN '彼得後書' THEN 3 WHEN '約翰一書' THEN 5 WHEN '約翰二書' THEN 1 WHEN '約翰三書' THEN 1
      WHEN '猶大書' THEN 1 WHEN '啟示錄' THEN 22
      ELSE 0
    END;
  END LOOP;
  RETURN total;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 建立個人排名計算函數 (SECURITY DEFINER 以便一般會友越過 RLS 安全計算排名)
CREATE OR REPLACE FUNCTION public.get_user_rankings(user_uuid UUID)
RETURNS TABLE (
  group_rank BIGINT, group_total BIGINT,
  zone_rank BIGINT, zone_total BIGINT,
  region_rank BIGINT, region_total BIGINT,
  church_rank BIGINT, church_total BIGINT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  u_chapters INT;
  u_group TEXT;
  u_zone TEXT;
  u_region TEXT;
BEGIN
  -- 取得使用者的主要大區、牧區、小組
  SELECT 
    great_region, pastoral_zone, small_group,
    (SELECT COUNT(*)::INT FROM public.reading_logs WHERE user_id = user_uuid)
  INTO 
    u_region, u_zone, u_group, u_chapters
  FROM 
    public.profiles 
  WHERE 
    id = user_uuid;

  IF u_region IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH 
    user_totals AS (
      SELECT 
        p.id,
        p.great_region,
        p.pastoral_zone,
        p.small_group,
        COUNT(l.id)::INT as total_chapters
      FROM 
        public.profiles p
      LEFT JOIN 
        public.reading_logs l ON p.id = l.user_id
      WHERE
        p.is_demo = false
      GROUP BY 
        p.id, p.great_region, p.pastoral_zone, p.small_group
    ),
    ranked_church AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY total_chapters DESC, id) as rank
      FROM user_totals
    ),
    ranked_region AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY great_region ORDER BY total_chapters DESC, id) as rank
      FROM user_totals
      WHERE great_region = u_region
    ),
    ranked_zone AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY pastoral_zone ORDER BY total_chapters DESC, id) as rank
      FROM user_totals
      WHERE pastoral_zone = u_zone
    ),
    ranked_group AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY pastoral_zone, small_group ORDER BY total_chapters DESC, id) as rank
      FROM user_totals
      WHERE pastoral_zone = u_zone AND small_group = u_group
    )
  SELECT
    COALESCE((SELECT rank FROM ranked_group WHERE id = user_uuid), 0::BIGINT),
    COALESCE((SELECT COUNT(*) FROM user_totals WHERE pastoral_zone = u_zone AND small_group = u_group), 0::BIGINT),
    COALESCE((SELECT rank FROM ranked_zone WHERE id = user_uuid), 0::BIGINT),
    COALESCE((SELECT COUNT(*) FROM user_totals WHERE pastoral_zone = u_zone), 0::BIGINT),
    COALESCE((SELECT rank FROM ranked_region WHERE id = user_uuid), 0::BIGINT),
    COALESCE((SELECT COUNT(*) FROM user_totals WHERE great_region = u_region), 0::BIGINT),
    COALESCE((SELECT rank FROM ranked_church WHERE id = user_uuid), 0::BIGINT),
    COALESCE((SELECT COUNT(*) FROM user_totals), 0::BIGINT)
  ;
END;
$$;

-- ==========================================
-- 建立即時統計視圖 (Views) 方便前端查詢 (過濾 Demo 帳號並由資料庫端安全彙整)
-- ==========================================

-- 各大區統計數據視圖
CREATE OR REPLACE VIEW public.view_great_region_stats AS
SELECT 
  p.great_region,
  COUNT(DISTINCT p.id) as member_count,
  COUNT(l.id) as total_chapters_read,
  COUNT(DISTINCT CASE WHEN l.read_at > NOW() - INTERVAL '2 days' THEN p.id END) as active_member_count
FROM 
  public.profiles p
LEFT JOIN 
  public.reading_logs l ON p.id = l.user_id
WHERE
  p.is_demo = false
GROUP BY 
  p.great_region;

-- 各牧區統計數據視圖
CREATE OR REPLACE VIEW public.view_pastoral_zone_stats AS
WITH user_progress AS (
  SELECT 
    p.id,
    p.great_region,
    p.pastoral_zone,
    COUNT(l.id) as chapters_read,
    COALESCE(get_plan_total_chapters(pl.target_books), 0) as total_chapters
  FROM 
    public.profiles p
  LEFT JOIN 
    public.reading_plans pl ON p.id = pl.user_id
  LEFT JOIN 
    public.reading_logs l ON p.id = l.user_id AND l.plan_id = pl.id
  WHERE
    p.is_demo = false
  GROUP BY 
    p.id, p.great_region, p.pastoral_zone, pl.target_books
)
SELECT 
  great_region,
  pastoral_zone,
  COUNT(DISTINCT id) as member_count,
  SUM(chapters_read)::BIGINT as total_chapters_read,
  COALESCE(ROUND(AVG(CASE WHEN total_chapters > 0 THEN (chapters_read::FLOAT / total_chapters::FLOAT * 100.0) ELSE 0.0 END)), 0)::INTEGER as avg_progress,
  COUNT(DISTINCT CASE WHEN id IN (SELECT DISTINCT user_id FROM public.reading_logs WHERE read_at > NOW() - INTERVAL '2 days') THEN id END) as active_member_count
FROM 
  user_progress
GROUP BY 
  great_region, pastoral_zone;

-- 各小組統計數據視圖
CREATE OR REPLACE VIEW public.view_small_group_stats AS
SELECT 
  p.great_region,
  p.pastoral_zone,
  p.small_group,
  COUNT(DISTINCT p.id) as member_count,
  COUNT(l.id) as total_chapters_read
FROM 
  public.profiles p
LEFT JOIN 
  public.reading_logs l ON p.id = l.user_id
WHERE
  p.is_demo = false
GROUP BY 
  p.great_region, p.pastoral_zone, p.small_group;


-- ==========================================
-- 初始種子資料 (Seed Data)
-- ==========================================

-- 1. 插入大區
INSERT INTO public.great_regions (id, name) VALUES (gen_random_uuid(), '東區') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO public.great_regions (id, name) VALUES (gen_random_uuid(), '南區') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO public.great_regions (id, name) VALUES (gen_random_uuid(), '西區') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO public.great_regions (id, name) VALUES (gen_random_uuid(), '北區') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO public.great_regions (id, name) VALUES (gen_random_uuid(), '青少年') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO public.great_regions (id, name) VALUES (gen_random_uuid(), '慶典') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO public.great_regions (id, name) VALUES (gen_random_uuid(), '創藝') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;

-- 2. 插入牧區與小組
DO $$
DECLARE
  r_id_0 UUID;
  z_id_0_0 UUID;
  z_id_0_1 UUID;
  z_id_0_2 UUID;
  z_id_0_3 UUID;
  z_id_0_4 UUID;
  z_id_0_5 UUID;
  z_id_0_6 UUID;
  z_id_0_7 UUID;
  z_id_0_8 UUID;
  z_id_0_9 UUID;
  z_id_0_10 UUID;
  z_id_0_11 UUID;
  r_id_1 UUID;
  z_id_1_0 UUID;
  z_id_1_1 UUID;
  z_id_1_2 UUID;
  z_id_1_3 UUID;
  z_id_1_4 UUID;
  z_id_1_5 UUID;
  z_id_1_6 UUID;
  z_id_1_7 UUID;
  r_id_2 UUID;
  z_id_2_0 UUID;
  z_id_2_1 UUID;
  z_id_2_2 UUID;
  z_id_2_3 UUID;
  z_id_2_4 UUID;
  z_id_2_5 UUID;
  z_id_2_6 UUID;
  z_id_2_7 UUID;
  r_id_3 UUID;
  z_id_3_0 UUID;
  z_id_3_1 UUID;
  z_id_3_2 UUID;
  z_id_3_3 UUID;
  z_id_3_4 UUID;
  z_id_3_5 UUID;
  z_id_3_6 UUID;
  z_id_3_7 UUID;
  r_id_4 UUID;
  z_id_4_0 UUID;
  z_id_4_1 UUID;
  z_id_4_2 UUID;
  z_id_4_3 UUID;
  r_id_5 UUID;
  z_id_5_0 UUID;
  z_id_5_1 UUID;
  r_id_6 UUID;
  z_id_6_0 UUID;
BEGIN
  -- 東區
  SELECT id INTO r_id_0 FROM public.great_regions WHERE name = '東區';
  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大安1', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_0;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '馬鈴', z_id_0_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '安利', z_id_0_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '玉君', z_id_0_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大安2', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_1;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '名雅', z_id_0_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '韋彤', z_id_0_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '文文', z_id_0_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), 'Eason', z_id_0_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大安3', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_2;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '兆尹', z_id_0_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '朱朱', z_id_0_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '絢伊', z_id_0_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '嘉宥', z_id_0_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大安4', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_3;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '天韻', z_id_0_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '怡信', z_id_0_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '旭雯', z_id_0_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大安7', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_4;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '曉萍', z_id_0_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '楊桃', z_id_0_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '鈺書', z_id_0_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大安8', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_5;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '倩如', z_id_0_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '莊導/Isa', z_id_0_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '佳靜/Isa', z_id_0_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大安9', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_6;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '明耀', z_id_0_6) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '玉銓', z_id_0_6) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '惠英', z_id_0_6) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大安10', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_7;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '意茹', z_id_0_7) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '福智', z_id_0_7) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '桂心', z_id_0_7) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大安11', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_8;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '秋桂', z_id_0_8) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '夙珠', z_id_0_8) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大安12', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_9;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '芝綺', z_id_0_9) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '子媛', z_id_0_9) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '東宏', z_id_0_9) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '信義2', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_10;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), 'Gary', z_id_0_10) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '衍如', z_id_0_10) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '小葉', z_id_0_10) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '阿鐘', z_id_0_10) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '南港', r_id_0) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_0_11;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '逸賢', z_id_0_11) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '慧甜', z_id_0_11) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '秋如', z_id_0_11) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  -- 南區
  SELECT id INTO r_id_1 FROM public.great_regions WHERE name = '南區';
  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大安6', r_id_1) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_1_0;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '郁君', z_id_1_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), 'Jeff', z_id_1_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '無敵', z_id_1_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '瑞玉', z_id_1_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '信義3', r_id_1) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_1_1;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '保羅', z_id_1_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '易展', z_id_1_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '太郎', z_id_1_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '稚鈞辰辰', z_id_1_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '松山', r_id_1) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_1_2;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '小美', z_id_1_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), 'Stacy', z_id_1_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '維靜', z_id_1_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '正道', z_id_1_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '育萍', z_id_1_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '文山', r_id_1) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_1_3;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '千惠', z_id_1_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '雯菁', z_id_1_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), 'Kelly', z_id_1_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '毛姐', z_id_1_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '新烏1', r_id_1) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_1_4;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '秀鳳', z_id_1_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '旻柔', z_id_1_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '家興', z_id_1_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '新烏2', r_id_1) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_1_5;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '達威', z_id_1_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '櫻蒨', z_id_1_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '俊雄', z_id_1_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '怡惠', z_id_1_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '新烏3', r_id_1) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_1_6;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), 'Erika', z_id_1_6) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '雨農', z_id_1_6) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '新烏4', r_id_1) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_1_7;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '亭筑', z_id_1_7) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '秀枝', z_id_1_7) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  -- 西區
  SELECT id INTO r_id_2 FROM public.great_regions WHERE name = '西區';
  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '中正1', r_id_2) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_2_0;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '詠溱', z_id_2_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), 'Marisa', z_id_2_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '濰瑄', z_id_2_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '文如', z_id_2_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '中正2', r_id_2) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_2_1;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), 'Dolly', z_id_2_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '旻鴻', z_id_2_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), 'Ingrid', z_id_2_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '韻芝/馨柳', z_id_2_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), 'Irene', z_id_2_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '中正3', r_id_2) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_2_2;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '鍾傑', z_id_2_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '老人', z_id_2_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '小紅', z_id_2_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '中正4', r_id_2) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_2_3;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '達哥', z_id_2_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '孟玲', z_id_2_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '中永和', r_id_2) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_2_4;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '季樺', z_id_2_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '婷羽', z_id_2_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '維新培霖', z_id_2_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '右聖', z_id_2_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '小萍', z_id_2_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '新莊1', r_id_2) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_2_5;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '翠欗', z_id_2_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '阿淳', z_id_2_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '新莊2', r_id_2) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_2_6;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '慧雯', z_id_2_6) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '都都', z_id_2_6) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '佳欣', z_id_2_6) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '新莊3', r_id_2) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_2_7;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '善揚', z_id_2_7) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '比嗨', z_id_2_7) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '家榕+瑞典', z_id_2_7) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  -- 北區
  SELECT id INTO r_id_3 FROM public.great_regions WHERE name = '北區';
  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '中正5', r_id_3) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_3_0;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '樹人', z_id_3_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '毓倩', z_id_3_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '琇誼', z_id_3_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '中山1', r_id_3) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_3_1;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '建安', z_id_3_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '愉琍琬婷', z_id_3_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '壹晴', z_id_3_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '鳳如', z_id_3_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '中山2', r_id_3) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_3_2;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '培貞', z_id_3_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '昌賢', z_id_3_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '凱仲', z_id_3_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '宛瑜', z_id_3_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '琬婷培貞', z_id_3_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '中山3', r_id_3) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_3_3;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '華誠', z_id_3_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '梅雋', z_id_3_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '儷友', z_id_3_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '中山5', r_id_3) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_3_4;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '依庭', z_id_3_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '易姍', z_id_3_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '阿康', z_id_3_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '裕昇', z_id_3_4) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '士林', r_id_3) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_3_5;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '哲蓉', z_id_3_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '盈蒨', z_id_3_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '小菜', z_id_3_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '爸爸', z_id_3_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '金宛', z_id_3_5) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '內湖', r_id_3) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_3_6;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '育玲', z_id_3_6) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '瑋琦', z_id_3_6) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '雅鈴', z_id_3_6) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '板三蘆', r_id_3) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_3_7;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '彥宇', z_id_3_7) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), 'Cindy', z_id_3_7) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  -- 青少年
  SELECT id INTO r_id_4 FROM public.great_regions WHERE name = '青少年';
  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '青少年教會', r_id_4) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_4_0;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '第一組', z_id_4_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '第二組', z_id_4_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '第三組', z_id_4_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '第四組', z_id_4_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '第五組', z_id_4_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '活校1', r_id_4) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_4_1;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '高嘉鴻', z_id_4_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '盧冠毓', z_id_4_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '活嗨', r_id_4) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_4_2;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '干靖', z_id_4_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '沛恩', z_id_4_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '予芯', z_id_4_2) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '大學', r_id_4) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_4_3;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '朵拉', z_id_4_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '又銓永祥', z_id_4_3) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  -- 慶典
  SELECT id INTO r_id_5 FROM public.great_regions WHERE name = '慶典';
  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '慶典1', r_id_5) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_5_0;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '威宇', z_id_5_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '瑋佑', z_id_5_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '雯樺', z_id_5_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '佳樺', z_id_5_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '姿穎', z_id_5_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '慶典2', r_id_5) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_5_1;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '唐寧', z_id_5_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '乃華/裕順', z_id_5_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '宥宥', z_id_5_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '政緯', z_id_5_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '競文', z_id_5_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '秀怡', z_id_5_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '科技', z_id_5_1) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  -- 創藝
  SELECT id INTO r_id_6 FROM public.great_regions WHERE name = '創藝';
  INSERT INTO public.pastoral_zones (id, name, great_region_id) 
  VALUES (gen_random_uuid(), '創藝', r_id_6) 
  ON CONFLICT (name, great_region_id) DO UPDATE SET name = EXCLUDED.name 
  RETURNING id INTO z_id_6_0;

  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '嘎嘎', z_id_6_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '宸瑋', z_id_6_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;
  INSERT INTO public.small_groups (id, name, pastoral_zone_id) 
  VALUES (gen_random_uuid(), '美珠', z_id_6_0) 
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

END $$;

-- ==========================================
-- 建立每日靈修心得資料表 (Devotional Notes)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.devotional_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    note_date DATE NOT NULL DEFAULT CURRENT_DATE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, note_date)
);

-- 啟用 RLS
ALTER TABLE public.devotional_notes ENABLE ROW LEVEL SECURITY;

-- 建立安全存取原則
CREATE POLICY "Users can manage their own devotional notes" ON public.devotional_notes
    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
