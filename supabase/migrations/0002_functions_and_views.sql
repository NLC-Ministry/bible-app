-- ==========================================================
-- Migration: 0002_functions_and_views.sql
-- 說明：建立資料庫函數、預存程序、觸發器與統計視圖 (Views)
-- ==========================================================

-- 1. 建立自動同步文字欄位的觸發器函數與觸發器
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
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
      IF NEW.role NOT IN ('member') THEN
        IF (SELECT COUNT(*) FROM public.profiles WHERE role IN ('admin', 'senior_pastor')) > 0 THEN
          NEW.role := 'member';
        END IF;
      END IF;
    END IF;
  END IF;

  -- 1. 大區同步與防自訂
  IF NEW.great_region_id IS NOT NULL AND (NEW.great_region IS NULL OR position(',' in NEW.great_region) = 0) THEN
    SELECT name INTO NEW.great_region FROM public.great_regions WHERE id = NEW.great_region_id;
  ELSIF NEW.great_region IS NOT NULL AND NEW.great_region <> '' AND position(',' in NEW.great_region) = 0 THEN
    SELECT id INTO r_id FROM public.great_regions WHERE name = NEW.great_region;
    IF r_id IS NOT NULL THEN
      NEW.great_region_id := r_id;
    ELSIF user_role IN ('admin', 'senior_pastor') THEN
      INSERT INTO public.great_regions (id, name)
      VALUES (gen_random_uuid(), NEW.great_region)
      RETURNING id INTO r_id;
      NEW.great_region_id := r_id;
    ELSE
      RAISE EXCEPTION '只有系統管理員可以新增或自訂大區！';
    END IF;
  ELSIF NEW.great_region IS NOT NULL AND position(',' in NEW.great_region) > 0 THEN
    NEW.great_region_id := NULL;
  END IF;

  -- 2. 牧區同步與防自訂
  IF NEW.pastoral_zone_id IS NOT NULL AND (NEW.pastoral_zone IS NULL OR position(',' in NEW.pastoral_zone) = 0) THEN
    SELECT name INTO NEW.pastoral_zone FROM public.pastoral_zones WHERE id = NEW.pastoral_zone_id;
  ELSIF NEW.pastoral_zone IS NOT NULL AND NEW.pastoral_zone <> '' AND position(',' in NEW.pastoral_zone) = 0 THEN
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
  ELSIF NEW.pastoral_zone IS NOT NULL AND position(',' in NEW.pastoral_zone) > 0 THEN
    NEW.pastoral_zone_id := NULL;
  END IF;

  -- 3. 小組同步與防自訂
  IF NEW.small_group_id IS NOT NULL AND (NEW.small_group IS NULL OR position(',' in NEW.small_group) = 0) THEN
    SELECT name INTO NEW.small_group FROM public.small_groups WHERE id = NEW.small_group_id;
  ELSIF NEW.small_group IS NOT NULL AND NEW.small_group <> '' AND position(',' in NEW.small_group) = 0 THEN
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
  ELSIF NEW.small_group IS NOT NULL AND position(',' in NEW.small_group) > 0 THEN
    NEW.small_group_id := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trigger_sync_profile_text_fields
BEFORE INSERT OR UPDATE
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_text_fields();

-- 2. 建立 SECURITY DEFINER 輔助函數以防止 RLS 遞迴查詢
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

-- 3. 建立計算計畫總章數的輔助函數
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

-- 4. 建立個人排名計算函數 (SECURITY DEFINER 以便一般會友越過 RLS 安全計算排名)
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

-- 5. 建立即時統計視圖 (Views) 方便前端查詢
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
