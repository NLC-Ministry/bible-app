-- 回報管理清單每筆多帶回報者的 id（#555）：App 的回報管理要加「在後台查看此使用者」連結，
-- 後台用這個 id 直接打開那個人（#/support/user/<id>）。
-- 只在 reporter 物件多一個 id，其他和 0153 一字不差；授權照舊（函式內檢查管理員）。
-- 不是破壞性變更：舊版 App 不讀這個欄位，不用設 forceUpdateBuiltBefore。

CREATE OR REPLACE FUNCTION public.issue_admin_thread_list(
  p_status text DEFAULT NULL, p_limit int DEFAULT 40, p_offset int DEFAULT 0, p_actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor uuid := public._issue_actor(p_actor_id);
  rows_j jsonb;
BEGIN
  IF NOT public._issue_is_admin(actor) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'lastMessageAt' DESC NULLS LAST), '[]'::jsonb) INTO rows_j
  FROM (
    SELECT jsonb_build_object(
      'id', r.id, 'category', r.category, 'status', r.status,
      'description', r.description, 'url', r.url,
      'createdAt', r.created_at, 'lastMessageAt', r.last_message_at,
      'messageCount', (SELECT count(*) FROM public.issue_report_messages m
                       WHERE m.report_id = r.id AND m.attachment_path IS DISTINCT FROM 'pending'),
      'unreadFromMember', EXISTS (
        SELECT 1 FROM public.issue_report_messages m
        WHERE m.report_id = r.id AND m.author_role = 'member' AND m.is_internal_note = false
          AND m.attachment_path IS DISTINCT FROM 'pending'
          AND m.created_at > COALESCE(r.admin_last_read_at, r.created_at)),
      'reporter', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', p.id,
        'name', p.name, 'pastoralZone', p.pastoral_zone, 'smallGroup', p.small_group) END
    ) AS x
    FROM public.issue_reports r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE (p_status IS NULL OR r.status = p_status)
    ORDER BY r.last_message_at DESC NULLS LAST
    LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0)
  ) sub;
  RETURN jsonb_build_object('rows', rows_j);
END $$;

REVOKE ALL ON FUNCTION public.issue_admin_thread_list(text, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_admin_thread_list(text, integer, integer, uuid) TO authenticated, service_role;
