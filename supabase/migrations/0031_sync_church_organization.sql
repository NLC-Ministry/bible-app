-- Create sync_church_organization function for bulk import
CREATE OR REPLACE FUNCTION public.sync_church_organization(
  p_regions TEXT[],
  p_zones JSONB, -- [{"name": "大安1", "region_name": "東區"}]
  p_groups JSONB -- [{"name": "大安1A", "zone_name": "大安1"}]
) RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- 1. 權限檢查：只有 admin 或 senior_pastor 可執行
  SELECT my_role INTO v_role FROM public.get_my_profile();
  IF v_role NOT IN ('admin', 'senior_pastor') THEN
    RAISE EXCEPTION '權限不足，只有管理員可管理組織架構';
  END IF;

  -- 2. 大區更新
  -- 刪除不在傳入名單中的大區
  DELETE FROM public.great_regions WHERE name NOT IN (SELECT unnest(p_regions));
  
  -- 新增大區 (已存在的忽略)
  INSERT INTO public.great_regions (name)
  SELECT DISTINCT r_name FROM unnest(p_regions) AS r_name
  ON CONFLICT (name) DO NOTHING;

  -- 3. 牧區更新
  -- 刪除不在傳入名單中的牧區
  DELETE FROM public.pastoral_zones z
  USING public.great_regions r
  WHERE z.great_region_id = r.id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_zones) AS x(name TEXT, region_name TEXT)
      WHERE x.name = z.name AND x.region_name = r.name
    );

  -- 刪除因為大區被刪除而變成孤立的牧區 (great_region_id IS NULL)
  DELETE FROM public.pastoral_zones WHERE great_region_id IS NULL;

  -- 新增/更新牧區
  INSERT INTO public.pastoral_zones (name, great_region_id)
  SELECT DISTINCT x.name, r.id
  FROM jsonb_to_recordset(p_zones) AS x(name TEXT, region_name TEXT)
  JOIN public.great_regions r ON r.name = x.region_name
  ON CONFLICT (name, great_region_id) DO NOTHING;

  -- 4. 小組更新
  -- 刪除不在傳入名單中的小組
  DELETE FROM public.small_groups g
  USING public.pastoral_zones z
  WHERE g.pastoral_zone_id = z.id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_groups) AS x(name TEXT, zone_name TEXT)
      WHERE x.name = g.name AND x.zone_name = z.name
    );

  -- 刪除因為牧區被刪除而變成孤立的小組 (pastoral_zone_id IS NULL)
  DELETE FROM public.small_groups WHERE pastoral_zone_id IS NULL;

  -- 新增/更新小組
  INSERT INTO public.small_groups (name, pastoral_zone_id)
  SELECT DISTINCT x.name, z.id
  FROM jsonb_to_recordset(p_groups) AS x(name TEXT, zone_name TEXT)
  JOIN public.pastoral_zones z ON z.name = x.zone_name
  ON CONFLICT (name, pastoral_zone_id) DO NOTHING;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
