-- 0210_lightning_quiz_results_analytics.sql
--
-- 快問快答後台「作答明細」：單一題目＋版本的逐人作答名單，加上各牧區／大區
-- 的應答人數（有效會友數），給前端算作答總覽、牧區分析、大區分析並匯出 CSV。
--
--   * 只有 admin 可以呼叫（_lightning_quiz_actor_is_admin），跟其他 admin_*
--     快問快答 RPC 一樣由 nlc-data 注入 p_actor_id。
--   * 名單包含「按了開始但沒送出」的人（status = 'in_progress'），前端顯示為
--     「未完成」，不算進作答人數與答對率。
--   * 組織歸屬以 *_id 外鍵為準，舊資料只有文字欄位時退回用文字；大區優先
--     取牧區所屬的大區，避免 profile 上的大區文字跟牧區對不上。
--   * 應答人數的定義跟 admin_get_lightning_quiz_trend 的 totalEligible 相同
--     （profiles.is_active = TRUE），全教會合計會跟逐日表格的分母一致。
--   * 跟 0209 的 trend 一樣不排除 admin 的作答，兩邊數字才對得起來。

CREATE OR REPLACE FUNCTION public.admin_get_lightning_quiz_results(
  p_question_id UUID,
  p_question_version INT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id    UUID := public.resolve_quiz_actor(p_actor_id);
  q           public.lightning_quiz_questions%ROWTYPE;
  attempts_j  JSONB;
  eligible_j  JSONB;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;

  SELECT * INTO q FROM public.lightning_quiz_questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lightning_quiz_question_not_found';
  END IF;

  WITH member_org AS (
    SELECT
      p.id,
      p.name,
      p.is_active,
      COALESCE(NULLIF(r.name, ''), NULLIF(pr.name, ''), NULLIF(btrim(p.great_region), ''), '') AS great_region,
      COALESCE(r.sort_order, pr.sort_order) AS region_sort,
      COALESCE(NULLIF(z.name, ''), NULLIF(btrim(p.pastoral_zone), ''), '') AS pastoral_zone,
      z.sort_order AS zone_sort,
      COALESCE(NULLIF(g.name, ''), NULLIF(btrim(p.small_group), ''), '') AS small_group
    FROM public.profiles p
    LEFT JOIN public.small_groups g ON g.id = p.small_group_id
    LEFT JOIN public.pastoral_zones z ON z.id = COALESCE(p.pastoral_zone_id, g.pastoral_zone_id)
    LEFT JOIN public.great_regions r ON r.id = z.great_region_id
    LEFT JOIN public.great_regions pr ON pr.id = p.great_region_id
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId', a.user_id,
        'name', m.name,
        'greatRegion', m.great_region,
        'pastoralZone', m.pastoral_zone,
        'smallGroup', m.small_group,
        'regionSort', m.region_sort,
        'zoneSort', m.zone_sort,
        'status', CASE WHEN a.completed_at IS NULL THEN 'in_progress'
                       WHEN a.is_correct THEN 'correct'
                       ELSE 'wrong' END,
        'elapsedMs', a.elapsed_ms,
        'completedAt', a.completed_at
      ) ORDER BY a.completed_at IS NULL, a.is_correct IS NOT TRUE, a.elapsed_ms NULLS LAST, m.name)
      FROM public.lightning_quiz_attempts a
      JOIN member_org m ON m.id = a.user_id
      WHERE a.question_id = p_question_id
        AND a.question_version = p_question_version
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'greatRegion', e.great_region,
        'pastoralZone', e.pastoral_zone,
        'regionSort', e.region_sort,
        'zoneSort', e.zone_sort,
        'count', e.cnt
      ))
      FROM (
        SELECT great_region, pastoral_zone, MIN(region_sort) AS region_sort, MIN(zone_sort) AS zone_sort, COUNT(*) AS cnt
        FROM member_org
        WHERE is_active = TRUE
        GROUP BY great_region, pastoral_zone
      ) e
    ), '[]'::jsonb)
  INTO attempts_j, eligible_j;

  RETURN jsonb_build_object(
    'questionId', q.id,
    'questionVersion', p_question_version,
    'riseDate', q.rise_date::TEXT,
    'attempts', attempts_j,
    'eligible', eligible_j
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_results(uuid, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_results(uuid, int, uuid) TO authenticated, service_role;
