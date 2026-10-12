-- #550 第一組（客服）：後台的回報收件匣，admin-api 的 report_* action 用的資料庫函式。
--
-- 以前回報管理在 App 的管理分頁，經 nlc-data 呼叫 0153 的 issue_* RPC，刪除回報直接刪資料表、
-- 改狀態與回覆都沒有稽核。後台改由 admin-api 呼叫這裡的函式：會改資料的每一支都在
-- **同一個交易內** 呼叫 audit.record()，資料改了就一定有紀錄，紀錄寫不進去資料也不會改。
--
--   admin_api_report_list(...)            收件匣清單（keyset 分頁：最後訊息時間＋id）＋各狀態筆數（只有第一頁）
--   admin_api_report_thread(...)          一張回報＋全部訊息（含內部備註）；標記管理員已讀；第一次打開記 view_report
--   admin_api_report_diagnostics(id)      回報附的診斷資訊（#548，issue_reports.metadata.diagnostics）
--   admin_api_report_set_status(...)      改狀態＋稽核（前後值）
--   admin_api_report_post(...)            管理員回覆／內部備註＋稽核；有截圖時先放 'pending' 佔位，admin-api 上傳後回填
--   admin_api_report_set_attachment(...)  回填截圖（只有 admin-api 上傳成功後呼叫，只接受 'pending' 佔位列）
--   admin_api_report_drop_attachment(...) 刪截圖（訊息沒文字就整則刪）＋稽核；回傳舊路徑讓 admin-api 刪 Storage 物件
--   admin_api_report_delete(...)          刪整張回報（訊息跟著刪）＋稽核（留刪除前的內容）；回傳所有截圖路徑
--   admin_api_report_export(...)          匯出用的資料（最多 5000 筆）＋ export 稽核；CSV 由 admin-api 產生
--
-- 全部只給 service_role（admin-api 以 service role 連線）；誰能呼叫由 admin-api 的能力表決定。
-- 依賴 #549 的 audit schema（20261010181946_admin_audit_events.sql）與 #547（20261011110008_admin_api_support.sql）。
-- 不改任何既有函式，會友 App（nlc-data 的 issue_* 路徑）不受影響。

-- 收件匣排序：最後訊息時間（沒有就用建立時間）由新到舊
CREATE INDEX IF NOT EXISTS idx_issue_reports_inbox_order
  ON public.issue_reports ((COALESCE(last_message_at, created_at)) DESC, id DESC);

-- ── 1. 清單 ───────────────────────────────────────────────────────────────────
-- p_status：NULL＝全部、'open'＝待處理＋處理中，或單一狀態。p_unread_only：只看會友有新訊息的。
CREATE OR REPLACE FUNCTION public.admin_api_report_list(
  p_status TEXT DEFAULT NULL,
  p_unread_only BOOLEAN DEFAULT FALSE,
  p_cursor_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_report_list$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50);
  v_rows JSONB;
  v_count INTEGER;
  v_counts JSONB := NULL;
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'pending', 'processing', 'resolved', 'ignored') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  WITH matched AS (
    SELECT report.*,
      COALESCE(report.last_message_at, report.created_at) AS sort_at,
      EXISTS (
        SELECT 1 FROM public.issue_report_messages AS message
        WHERE message.report_id = report.id AND message.author_role = 'member' AND message.is_internal_note = FALSE
          AND message.attachment_path IS DISTINCT FROM 'pending'
          AND message.created_at > COALESCE(report.admin_last_read_at, report.created_at)
      ) AS unread
    FROM public.issue_reports AS report
    WHERE (p_status IS NULL
        OR (p_status = 'open' AND report.status IN ('pending', 'processing'))
        OR report.status = p_status)
  ),
  page AS (
    SELECT * FROM matched
    WHERE (NOT COALESCE(p_unread_only, FALSE) OR matched.unread)
      AND (p_cursor_at IS NULL
        OR matched.sort_at < p_cursor_at
        OR (matched.sort_at = p_cursor_at AND matched.id < p_cursor_id))
    ORDER BY matched.sort_at DESC, matched.id DESC
    LIMIT v_limit + 1
  )
  SELECT jsonb_agg(jsonb_build_object(
      'id', page.id,
      'category', page.category,
      'status', page.status,
      'description', left(page.description, 300),
      'created_at', page.created_at,
      'last_message_at', page.last_message_at,
      'sort_at', page.sort_at,
      'unread', page.unread,
      'message_count', (SELECT count(*) FROM public.issue_report_messages AS message
                        WHERE message.report_id = page.id AND message.attachment_path IS DISTINCT FROM 'pending'),
      'reporter', CASE WHEN profile.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', profile.id, 'name', profile.name,
        'pastoral_zone', profile.pastoral_zone, 'small_group', profile.small_group) END
    ) ORDER BY page.sort_at DESC, page.id DESC),
    count(*)
  INTO v_rows, v_count
  FROM page
  LEFT JOIN public.profiles AS profile ON profile.id = page.user_id;

  IF p_cursor_at IS NULL THEN
    SELECT jsonb_build_object(
      'all', count(*),
      'open', count(*) FILTER (WHERE report.status IN ('pending', 'processing')),
      'pending', count(*) FILTER (WHERE report.status = 'pending'),
      'processing', count(*) FILTER (WHERE report.status = 'processing'),
      'resolved', count(*) FILTER (WHERE report.status = 'resolved'),
      'ignored', count(*) FILTER (WHERE report.status = 'ignored'),
      'unread', count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.issue_report_messages AS message
        WHERE message.report_id = report.id AND message.author_role = 'member' AND message.is_internal_note = FALSE
          AND message.attachment_path IS DISTINCT FROM 'pending'
          AND message.created_at > COALESCE(report.admin_last_read_at, report.created_at)))
    ) INTO v_counts
    FROM public.issue_reports AS report;
  END IF;

  v_rows := COALESCE(v_rows, '[]'::jsonb);
  RETURN jsonb_build_object(
    'items', CASE WHEN v_count > v_limit THEN v_rows - v_limit ELSE v_rows END,
    'next_cursor', CASE WHEN v_count > v_limit THEN jsonb_build_object(
      'at', v_rows -> (v_limit - 1) ->> 'sort_at',
      'id', v_rows -> (v_limit - 1) ->> 'id') END,
    'counts', v_counts
  );
END;
$admin_api_report_list$;
REVOKE ALL ON FUNCTION public.admin_api_report_list(TEXT, BOOLEAN, TIMESTAMPTZ, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_report_list(TEXT, BOOLEAN, TIMESTAMPTZ, UUID, INTEGER) TO service_role;

-- ── 2. 一張回報的對話 ──────────────────────────────────────────────────────────
-- 找不到回 NULL（admin-api → 404）。p_audit：第一次打開才記 view_report，畫面每 20 秒自動更新不重複記。
CREATE OR REPLACE FUNCTION public.admin_api_report_thread(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_report_id UUID,
  p_audit BOOLEAN DEFAULT TRUE,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_report_thread$
DECLARE
  v_report public.issue_reports%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_report FROM public.issue_reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'report', jsonb_build_object(
      'id', v_report.id,
      'category', v_report.category,
      'status', v_report.status,
      'description', v_report.description,
      'url', v_report.url,
      'created_at', v_report.created_at,
      'last_message_at', v_report.last_message_at,
      'closed_at', v_report.closed_at,
      -- 「呼叫前」的讀取進度：用來顯示會友讀到哪
      'admin_last_read_at', v_report.admin_last_read_at,
      'member_last_read_at', v_report.member_last_read_at,
      'has_diagnostics', COALESCE(jsonb_typeof(v_report.metadata -> 'diagnostics') = 'object', FALSE),
      'reporter', (
        SELECT jsonb_build_object(
          'id', profile.id, 'name', profile.name, 'great_region', profile.great_region,
          'pastoral_zone', profile.pastoral_zone, 'small_group', profile.small_group)
        FROM public.profiles AS profile WHERE profile.id = v_report.user_id
      )
    ),
    'messages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', message.id,
          'author_role', message.author_role,
          'author_name', CASE WHEN message.author_role = 'admin' THEN author.name END,
          'is_internal', message.is_internal_note,
          'body', message.body,
          'created_at', message.created_at,
          'attachment_path', message.attachment_path,
          'attachment_mime', message.attachment_mime,
          'attachment_w', message.attachment_w,
          'attachment_h', message.attachment_h
        ) ORDER BY message.created_at, message.id)
      FROM public.issue_report_messages AS message
      LEFT JOIN public.profiles AS author ON author.id = message.author_id
      WHERE message.report_id = p_report_id
        AND message.attachment_path IS DISTINCT FROM 'pending'
    ), '[]'::jsonb)
  ) INTO v_result;

  UPDATE public.issue_reports SET admin_last_read_at = now() WHERE id = p_report_id;

  IF COALESCE(p_audit, TRUE) THEN
    PERFORM audit.record('admin-api', 'view_report', 'ok', p_actor_id, p_actor_role, 'issue_reports',
      v_report.user_id, v_report.id::text, NULL, p_reason, p_request_id, NULL);
  END IF;
  RETURN v_result;
END;
$admin_api_report_thread$;
REVOKE ALL ON FUNCTION public.admin_api_report_thread(UUID, TEXT, UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_report_thread(UUID, TEXT, UUID, BOOLEAN, TEXT, TEXT) TO service_role;

-- ── 3. 診斷資訊（#548）──────────────────────────────────────────────────────────
-- 找不到回報回 NULL；回報沒附診斷回 {"diagnostics": null}。
CREATE OR REPLACE FUNCTION public.admin_api_report_diagnostics(p_report_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_report_diagnostics$
  SELECT jsonb_build_object(
    'diagnostics', CASE WHEN jsonb_typeof(report.metadata -> 'diagnostics') = 'object' THEN report.metadata -> 'diagnostics' END
  )
  FROM public.issue_reports AS report
  WHERE report.id = p_report_id;
$admin_api_report_diagnostics$;
REVOKE ALL ON FUNCTION public.admin_api_report_diagnostics(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_report_diagnostics(UUID) TO service_role;

-- ── 4. 改狀態 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_api_report_set_status(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_report_id UUID,
  p_status TEXT,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_report_set_status$
DECLARE
  v_before TEXT;
  v_user_id UUID;
  v_closed_at TIMESTAMPTZ;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'processing', 'resolved', 'ignored') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT status, user_id INTO v_before, v_user_id
  FROM public.issue_reports WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.issue_reports
  SET status = p_status,
      closed_at = CASE WHEN p_status IN ('resolved', 'ignored') THEN now() ELSE NULL END,
      admin_last_read_at = now()
  WHERE id = p_report_id
  RETURNING closed_at INTO v_closed_at;

  PERFORM audit.record('admin-api', 'report.set_status', 'ok', p_actor_id, p_actor_role, 'issue_reports',
    v_user_id, p_report_id::text,
    jsonb_build_object('status', jsonb_build_object('before', v_before, 'after', p_status)),
    NULL, p_request_id, NULL);
  RETURN jsonb_build_object('id', p_report_id, 'status', p_status, 'closed_at', v_closed_at);
END;
$admin_api_report_set_status$;
REVOKE ALL ON FUNCTION public.admin_api_report_set_status(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_report_set_status(UUID, TEXT, UUID, TEXT, TEXT) TO service_role;

-- ── 5. 回覆／內部備註 ─────────────────────────────────────────────────────────
-- 規則和 0153 的 issue_thread_post 相同（去控制字元、最多 500 字、沒字也沒圖不收、一串最多 200 則）；
-- 頻率限制由 admin-api 的限流負責。內部備註會友看不到，也不會觸發「有新訊息」。
CREATE OR REPLACE FUNCTION public.admin_api_report_post(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_report_id UUID,
  p_body TEXT,
  p_is_internal BOOLEAN DEFAULT FALSE,
  p_has_attachment BOOLEAN DEFAULT FALSE,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_report_post$
DECLARE
  v_body TEXT := btrim(regexp_replace(COALESCE(p_body, ''), '[[:cntrl:]]', '', 'g'));
  v_user_id UUID;
  v_id UUID;
BEGIN
  IF char_length(v_body) > 500 THEN
    RAISE EXCEPTION 'body_too_long' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) < 1 AND NOT COALESCE(p_has_attachment, FALSE) THEN
    RAISE EXCEPTION 'empty_message' USING ERRCODE = '22023';
  END IF;

  SELECT user_id INTO v_user_id FROM public.issue_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM public.issue_report_messages WHERE report_id = p_report_id) >= 200 THEN
    RAISE EXCEPTION 'thread_full' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.issue_report_messages (report_id, author_role, author_id, body, is_internal_note, attachment_path)
  VALUES (p_report_id, 'admin', p_actor_id, v_body, COALESCE(p_is_internal, FALSE),
          CASE WHEN COALESCE(p_has_attachment, FALSE) THEN 'pending' END)
  RETURNING id INTO v_id;

  UPDATE public.issue_reports SET admin_last_read_at = now() WHERE id = p_report_id;

  PERFORM audit.record('admin-api', CASE WHEN COALESCE(p_is_internal, FALSE) THEN 'report.note' ELSE 'report.reply' END,
    'ok', p_actor_id, p_actor_role, 'issue_reports', v_user_id, p_report_id::text, NULL, NULL, p_request_id,
    jsonb_build_object('message_id', v_id, 'body_chars', char_length(v_body), 'has_attachment', COALESCE(p_has_attachment, FALSE)));
  RETURN jsonb_build_object('id', v_id, 'report_id', p_report_id);
END;
$admin_api_report_post$;
REVOKE ALL ON FUNCTION public.admin_api_report_post(UUID, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_report_post(UUID, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT) TO service_role;

-- ── 6. 截圖回填（admin-api 上傳成功後）────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_api_report_set_attachment(
  p_message_id UUID,
  p_path TEXT,
  p_mime TEXT,
  p_bytes INTEGER,
  p_w INTEGER DEFAULT NULL,
  p_h INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_report_set_attachment$
BEGIN
  IF p_mime IS NULL OR p_mime NOT IN ('image/webp', 'image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'bad_mime' USING ERRCODE = '22023';
  END IF;
  IF p_bytes IS NULL OR p_bytes < 1 OR p_bytes > 512000 THEN
    RAISE EXCEPTION 'too_large' USING ERRCODE = '22023';
  END IF;
  UPDATE public.issue_report_messages
  SET attachment_path = p_path, attachment_mime = p_mime, attachment_bytes = p_bytes,
      attachment_w = p_w, attachment_h = p_h
  WHERE id = p_message_id AND attachment_path = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attachment_not_pending' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('ok', TRUE);
END;
$admin_api_report_set_attachment$;
REVOKE ALL ON FUNCTION public.admin_api_report_set_attachment(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_report_set_attachment(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;

-- ── 7. 刪截圖 ──────────────────────────────────────────────────────────────────
-- 找不到訊息回 NULL。p_audit = FALSE 是 admin-api 上傳失敗時清掉佔位列（不是管理員的操作，不記）。
CREATE OR REPLACE FUNCTION public.admin_api_report_drop_attachment(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_message_id UUID,
  p_audit BOOLEAN DEFAULT TRUE,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_report_drop_attachment$
DECLARE
  v_message public.issue_report_messages%ROWTYPE;
  v_user_id UUID;
BEGIN
  SELECT * INTO v_message FROM public.issue_report_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT user_id INTO v_user_id FROM public.issue_reports WHERE id = v_message.report_id;

  IF char_length(COALESCE(v_message.body, '')) = 0 THEN
    DELETE FROM public.issue_report_messages WHERE id = p_message_id;
  ELSE
    UPDATE public.issue_report_messages
    SET attachment_path = NULL, attachment_mime = NULL, attachment_bytes = NULL,
        attachment_w = NULL, attachment_h = NULL
    WHERE id = p_message_id;
  END IF;

  IF COALESCE(p_audit, TRUE) THEN
    PERFORM audit.record('admin-api', 'report.attachment_delete', 'ok', p_actor_id, p_actor_role, 'issue_report_messages',
      v_user_id, v_message.report_id::text, NULL, NULL, p_request_id,
      jsonb_build_object('message_id', p_message_id, 'author_role', v_message.author_role));
  END IF;
  RETURN jsonb_build_object('report_id', v_message.report_id, 'old_path', NULLIF(v_message.attachment_path, 'pending'));
END;
$admin_api_report_drop_attachment$;
REVOKE ALL ON FUNCTION public.admin_api_report_drop_attachment(UUID, TEXT, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_report_drop_attachment(UUID, TEXT, UUID, BOOLEAN, TEXT) TO service_role;

-- ── 8. 刪整張回報 ──────────────────────────────────────────────────────────────
-- 稽核留刪除前的內容（描述最多 500 字），刪了還查得到是哪張、誰刪的。
CREATE OR REPLACE FUNCTION public.admin_api_report_delete(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_report_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_report_delete$
DECLARE
  v_report public.issue_reports%ROWTYPE;
  v_paths TEXT[];
  v_messages INTEGER;
BEGIN
  SELECT * INTO v_report FROM public.issue_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(array_agg(attachment_path) FILTER (WHERE attachment_path IS NOT NULL AND attachment_path <> 'pending'), ARRAY[]::TEXT[]),
         count(*)
  INTO v_paths, v_messages
  FROM public.issue_report_messages WHERE report_id = p_report_id;

  DELETE FROM public.issue_reports WHERE id = p_report_id;

  PERFORM audit.record('admin-api', 'report.delete', 'ok', p_actor_id, p_actor_role, 'issue_reports',
    v_report.user_id, p_report_id::text,
    jsonb_build_object('report', jsonb_build_object(
      'before', jsonb_build_object(
        'category', v_report.category, 'status', v_report.status,
        'description', left(v_report.description, 500), 'url', v_report.url,
        'created_at', v_report.created_at, 'message_count', v_messages),
      'after', NULL)),
    p_reason, p_request_id, jsonb_build_object('attachments', cardinality(v_paths)));
  RETURN jsonb_build_object('id', p_report_id, 'paths', to_jsonb(v_paths));
END;
$admin_api_report_delete$;
REVOKE ALL ON FUNCTION public.admin_api_report_delete(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_report_delete(UUID, TEXT, UUID, TEXT, TEXT) TO service_role;

-- ── 9. 匯出 ────────────────────────────────────────────────────────────────────
-- 回原始資料，CSV（含公式注入防護）由 admin-api 產生。稽核記條件與筆數，不記內容。
CREATE OR REPLACE FUNCTION public.admin_api_report_export(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_status TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_report_export$
DECLARE
  v_max CONSTANT INTEGER := 5000;
  v_rows JSONB;
  v_total INTEGER;
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'pending', 'processing', 'resolved', 'ignored') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.issue_reports AS report
  WHERE (p_status IS NULL OR (p_status = 'open' AND report.status IN ('pending', 'processing')) OR report.status = p_status);

  SELECT jsonb_agg(row_data ORDER BY sort_at DESC, id DESC) INTO v_rows
  FROM (
    SELECT report.id, COALESCE(report.last_message_at, report.created_at) AS sort_at,
      jsonb_build_object(
        'id', report.id,
        'created_at', report.created_at,
        'category', report.category,
        'status', report.status,
        'message_count', (SELECT count(*) FROM public.issue_report_messages AS message
                          WHERE message.report_id = report.id AND message.attachment_path IS DISTINCT FROM 'pending'),
        'last_message_at', report.last_message_at,
        'description', report.description,
        'url', report.url,
        'reporter_name', profile.name,
        'reporter_zone', profile.pastoral_zone,
        'reporter_group', profile.small_group
      ) AS row_data
    FROM public.issue_reports AS report
    LEFT JOIN public.profiles AS profile ON profile.id = report.user_id
    WHERE (p_status IS NULL OR (p_status = 'open' AND report.status IN ('pending', 'processing')) OR report.status = p_status)
    ORDER BY COALESCE(report.last_message_at, report.created_at) DESC, report.id DESC
    LIMIT v_max
  ) AS limited;

  PERFORM audit.record('admin-api', 'export', 'ok', p_actor_id, p_actor_role, 'issue_reports',
    NULL, NULL, NULL, NULL, p_request_id,
    jsonb_build_object('kind', 'reports', 'status', p_status, 'rows', LEAST(v_total, v_max), 'truncated', v_total > v_max));
  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total', v_total, 'truncated', v_total > v_max);
END;
$admin_api_report_export$;
REVOKE ALL ON FUNCTION public.admin_api_report_export(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_report_export(UUID, TEXT, TEXT, TEXT) TO service_role;
