-- ==========================================
-- 教會速讀挑戰與統計系統 - Supabase 初始化資料庫腳本 (RBAC & Google OAuth 支援)
-- Migration: 0001_init_schema
-- ==========================================

-- 1. 建立使用者個人資料表 (Profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  great_region TEXT NOT NULL, -- 所屬大區 (例如：第一大區、第二大區)
  pastoral_zone TEXT NOT NULL, -- 所屬牧區
  small_group TEXT NOT NULL, -- 所屬小組
  role TEXT NOT NULL DEFAULT 'member', -- 權限角色 (member, group_leader, zone_leader, great_zone_leader, admin, senior_pastor)
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  
  CONSTRAINT check_valid_role CHECK (role IN ('member', 'group_leader', 'zone_leader', 'great_zone_leader', 'admin', 'senior_pastor'))
);

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
-- 建立即時統計視圖 (Views) 方便前端查詢
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
GROUP BY 
  p.great_region;

-- 各牧區統計數據視圖
CREATE OR REPLACE VIEW public.view_pastoral_zone_stats AS
SELECT 
  p.great_region,
  p.pastoral_zone,
  COUNT(DISTINCT p.id) as member_count,
  COUNT(l.id) as total_chapters_read,
  COUNT(DISTINCT CASE WHEN l.read_at > NOW() - INTERVAL '2 days' THEN p.id END) as active_member_count
FROM 
  public.profiles p
LEFT JOIN 
  public.reading_logs l ON p.id = l.user_id
GROUP BY 
  p.great_region, p.pastoral_zone;

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
GROUP BY 
  p.great_region, p.pastoral_zone, p.small_group;
