-- ==========================================================
-- Migration: 0003_policies.sql
-- 說明：啟用資料表行級安全策略 (Row Level Security - RLS) 並建立相關存取規則
-- ==========================================================

-- 1. 啟用安全原則 (Row Level Security - RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.great_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastoral_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.small_groups ENABLE ROW LEVEL SECURITY;

-- 2. 組織架構資料表讀取與管理策略
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

-- 3. Profiles 個人資料權限策略
CREATE POLICY "允許用戶新增或更新自己的個人資料" 
  ON public.profiles FOR ALL 
  TO authenticated 
  USING (auth.uid() = id) 
  WITH CHECK (auth.uid() = id);

CREATE POLICY "根據角色限制 Profiles 讀取權限" 
  ON public.profiles FOR SELECT 
  TO authenticated 
  USING (
    id = auth.uid() OR
    (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor') OR
    ((SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader' AND great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ','))) OR
    ((SELECT my_role FROM public.get_my_profile()) = 'zone_leader' AND pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ','))) OR
    ((SELECT my_role FROM public.get_my_profile()) IN ('group_leader', 'member') AND pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ',')) AND small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ',')))
  );

-- 4. Reading Plans 讀經計畫權限策略
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
        (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader' AND p.great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ',')) OR
        (SELECT my_role FROM public.get_my_profile()) = 'zone_leader' AND p.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ',')) OR
        (SELECT my_role FROM public.get_my_profile()) IN ('group_leader', 'member') AND p.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ',')) AND p.small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ','))
      )
    )
  );

-- 5. Reading Logs 讀經紀錄權限策略
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
        (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader' AND p.great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ',')) OR
        (SELECT my_role FROM public.get_my_profile()) = 'zone_leader' AND p.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ',')) OR
        (SELECT my_role FROM public.get_my_profile()) IN ('group_leader', 'member') AND p.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ',')) AND p.small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ','))
      )
    )
  );
