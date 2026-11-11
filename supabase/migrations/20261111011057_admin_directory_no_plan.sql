-- #694 後台「人 → 名單與查詢」不綁計畫：查人不用選計畫。
--
-- 原本沒指定計畫時，名單會自己挑一個「目前進行中」的計畫，每列附上「已加入／未加入」和隊伍，
-- 第一頁再附上計畫清單給前端的下拉選單。人區名單拿掉計畫篩選後，這些都用不到了：
-- · 沒指定計畫＝不篩計畫（不再挑預設計畫）；
-- · 不回計畫清單（plans）和使用的計畫（plan_id）；
-- · 每列不帶 joined／teams。
-- 某計畫的參加者、組隊狀況看「計畫 → 名單」（admin_api_plan_roster），不在這裡。
--
-- 參數簽名不變（p_plan_id／p_participation／p_team 照收、照篩）：admin-api 自 #694 起固定送「不限計畫」，
-- 但新舊 admin-api 和這支函式不論哪個先部署都能互相呼叫，所以本 migration 和 admin-api 部署沒有先後要求。
-- 匯出（admin_api_directory_export）不用改：沒指定計畫本來就不篩計畫，CSV 欄位由 admin-api 決定。

CREATE OR REPLACE FUNCTION public.admin_api_directory_list(
  p_actor_id UUID,
  p_q TEXT DEFAULT NULL,
  p_regions TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_zones TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_groups TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_plan_id UUID DEFAULT NULL,
  p_participation TEXT DEFAULT 'all',
  p_team TEXT DEFAULT 'all',
  p_incomplete BOOLEAN DEFAULT FALSE,
  p_cursor JSONB DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_directory_list$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_first BOOLEAN := p_cursor IS NULL OR jsonb_typeof(p_cursor) = 'null';
  c_region INTEGER;
  c_region_name TEXT;
  c_zone INTEGER;
  c_zone_name TEXT;
  c_name TEXT;
  c_id UUID;
  v_items JSONB;
  v_total BIGINT;
  v_more BOOLEAN;
BEGIN
  IF p_participation NOT IN ('all', 'joined', 'not_joined') OR p_team NOT IN ('all', 'joined', 'not_joined') THEN
    RAISE EXCEPTION 'invalid_plan_filter' USING ERRCODE = '22023';
  END IF;
  IF NOT v_first THEN
    IF jsonb_typeof(p_cursor) <> 'array' OR jsonb_array_length(p_cursor) <> 6 OR jsonb_typeof(p_cursor -> 5) <> 'string' THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
    END IF;
    BEGIN
      c_region := (p_cursor ->> 0)::integer;
      c_region_name := p_cursor ->> 1;
      c_zone := (p_cursor ->> 2)::integer;
      c_zone_name := p_cursor ->> 3;
      c_name := p_cursor ->> 4;
      c_id := (p_cursor ->> 5)::uuid;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
    END;
  END IF;

  WITH filtered AS (
    SELECT dir.*
    FROM public.admin_api_directory_rows(p_actor_id, p_q, p_regions, p_zones, p_groups, p_plan_id,
      p_participation, p_team, p_incomplete) AS dir
  ),
  page AS (
    SELECT filtered.*
    FROM filtered
    WHERE v_first OR (
      filtered.sort_region IS NULL, COALESCE(filtered.sort_region, 0),
      filtered.great_region IS NULL, COALESCE(filtered.great_region, ''),
      filtered.sort_zone IS NULL, COALESCE(filtered.sort_zone, 0),
      filtered.pastoral_zone IS NULL, COALESCE(filtered.pastoral_zone, ''),
      filtered.name IS NULL, COALESCE(filtered.name, ''),
      filtered.id
    ) > (
      c_region IS NULL, COALESCE(c_region, 0),
      c_region_name IS NULL, COALESCE(c_region_name, ''),
      c_zone IS NULL, COALESCE(c_zone, 0),
      c_zone_name IS NULL, COALESCE(c_zone_name, ''),
      c_name IS NULL, COALESCE(c_name, ''),
      c_id
    )
    ORDER BY filtered.sort_region IS NULL, COALESCE(filtered.sort_region, 0),
      filtered.great_region IS NULL, COALESCE(filtered.great_region, ''),
      filtered.sort_zone IS NULL, COALESCE(filtered.sort_zone, 0),
      filtered.pastoral_zone IS NULL, COALESCE(filtered.pastoral_zone, ''),
      filtered.name IS NULL, COALESCE(filtered.name, ''),
      filtered.id
    LIMIT v_limit + 1
  ),
  numbered AS (
    SELECT page.*, row_number() OVER (
      ORDER BY page.sort_region IS NULL, COALESCE(page.sort_region, 0),
        page.great_region IS NULL, COALESCE(page.great_region, ''),
        page.sort_zone IS NULL, COALESCE(page.sort_zone, 0),
        page.pastoral_zone IS NULL, COALESCE(page.pastoral_zone, ''),
        page.name IS NULL, COALESCE(page.name, ''),
        page.id
    ) AS seq
    FROM page
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', numbered.id, 'name', numbered.name, 'email_masked', public.admin_api_mask_email(numbered.email),
      'great_region', numbered.great_region, 'pastoral_zone', numbered.pastoral_zone, 'small_group', numbered.small_group,
      'is_active', numbered.is_active, 'sync_status', numbered.sync_status, 'synced_at', numbered.synced_at,
      'role_code', numbered.role_code, 'role_label', numbered.role_label,
      'managed_regions', numbered.managed_regions, 'managed_zones', numbered.managed_zones, 'managed_groups', numbered.managed_groups,
      'sort_key', jsonb_build_array(numbered.sort_region, numbered.great_region, numbered.sort_zone, numbered.pastoral_zone, numbered.name, numbered.id)
    ) ORDER BY numbered.seq) FILTER (WHERE numbered.seq <= v_limit), '[]'::jsonb),
    COALESCE(bool_or(numbered.seq > v_limit), FALSE),
    (SELECT count(*) FROM filtered)
  INTO v_items, v_more, v_total
  FROM numbered;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'next_cursor', CASE WHEN v_more THEN v_items -> (jsonb_array_length(v_items) - 1) -> 'sort_key' END,
    'all_count', CASE WHEN v_first THEN (SELECT count(*) FROM public.profiles) END
  );
END;
$admin_api_directory_list$;
REVOKE ALL ON FUNCTION public.admin_api_directory_list(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_directory_list(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN, JSONB, INTEGER) TO service_role;
