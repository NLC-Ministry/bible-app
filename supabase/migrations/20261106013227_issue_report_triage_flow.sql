-- #683 回報處理流程：狀態看得出在等誰、結案一定告知會友、自動結案只限等會友、每日摘要的數字與排程。
--
-- 狀態（status）：
--   pending         待回覆：輪到管理者
--   waiting_member  等會友：輪到會友（新增）；只有這個狀態會自動結案
--   processing      等開發：已回覆、等修復；沿用舊狀態碼（維護者看到的標籤改成「等開發」，會友仍看到「處理中」）
--   resolved／ignored  已結案；close_reason 記原因（這支之前結案的舊資料是 NULL，不回填）
--
-- 自動轉換都在 _issue_touch_report_on_message（後台與 App 泡泡兩條路都會經過）：
--   管理者公開回覆 pending → waiting_member；有截圖的要上傳完才算送出，所以看 attachment_path 離開 'pending' 的 UPDATE。
--   會友留言 waiting_member／已結案 → pending（已結案另外清掉 closed_at、close_reason）；processing 不變。
--
-- 結案只能走 _issue_close_report（狀態、原因、給會友的訊息在同一個交易）：後台 admin_api_report_close、
-- App 泡泡 issue_admin_close。admin_api_report_set_status、issue_admin_set_status 不再接受已結案的狀態。
--
-- 部署順序：這支 migration → admin-api、nlc-data、issue-report-maintenance → 前端。
-- 每日摘要另外要設 ISSUE_REPORT_DIGEST_WEBHOOK_URL、ISSUE_REPORT_DIGEST_WEBHOOK_SECRET（見 supabase/functions/README.md）；
-- 沒設只是不寄信，排程照跑。舊版前端看到 waiting_member 只會顯示原始代碼，不會壞，所以不需要 forceUpdateBuiltBefore。

-- ── 1. 資料表 ──────────────────────────────────────────────────────────────────
ALTER TABLE public.issue_reports DROP CONSTRAINT IF EXISTS check_status;
ALTER TABLE public.issue_reports ADD CONSTRAINT check_status
  CHECK (status IN ('pending', 'waiting_member', 'processing', 'resolved', 'ignored'));

ALTER TABLE public.issue_reports ADD COLUMN IF NOT EXISTS close_reason TEXT;
ALTER TABLE public.issue_reports DROP CONSTRAINT IF EXISTS issue_reports_close_reason_check;
ALTER TABLE public.issue_reports ADD CONSTRAINT issue_reports_close_reason_check
  CHECK (close_reason IS NULL OR close_reason IN ('fixed', 'answered', 'cannot_reproduce', 'suggestion_noted', 'other', 'no_response'));

-- 最後一則公開訊息是管理者的待處理回報，其實是在等會友
UPDATE public.issue_reports AS report
SET status = 'waiting_member'
FROM (
  SELECT DISTINCT ON (message.report_id) message.report_id, message.author_role
  FROM public.issue_report_messages AS message
  WHERE message.is_internal_note = FALSE AND message.attachment_path IS DISTINCT FROM 'pending'
  ORDER BY message.report_id, message.created_at DESC, message.id DESC
) AS last_message
WHERE last_message.report_id = report.id
  AND last_message.author_role = 'admin'
  AND report.status = 'pending';

-- ── 2. 新訊息 → 更新回報 ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._issue_touch_report_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_internal_note THEN
    RETURN NEW;
  END IF;

  -- 截圖上傳完（或上傳失敗但訊息有文字、截圖被清掉）才算管理者的回覆送出了
  IF TG_OP = 'UPDATE' THEN
    IF NEW.author_role = 'admin' AND OLD.attachment_path = 'pending' AND NEW.attachment_path IS DISTINCT FROM 'pending' THEN
      UPDATE public.issue_reports SET status = 'waiting_member' WHERE id = NEW.report_id AND status = 'pending';
    END IF;
    RETURN NEW;
  END IF;

  UPDATE public.issue_reports
  SET last_message_at = NEW.created_at,
      status = CASE
        WHEN NEW.author_role = 'member' AND status IN ('waiting_member', 'resolved', 'ignored') THEN 'pending'
        WHEN NEW.author_role = 'admin' AND status = 'pending' AND NEW.attachment_path IS DISTINCT FROM 'pending' THEN 'waiting_member'
        ELSE status
      END,
      closed_at = CASE WHEN NEW.author_role = 'member' AND status IN ('resolved', 'ignored') THEN NULL ELSE closed_at END,
      close_reason = CASE WHEN NEW.author_role = 'member' AND status IN ('resolved', 'ignored') THEN NULL ELSE close_reason END
  WHERE id = NEW.report_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._issue_touch_report_on_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_issue_touch_report_on_message ON public.issue_report_messages;
CREATE TRIGGER trg_issue_touch_report_on_message
  AFTER INSERT OR UPDATE OF attachment_path ON public.issue_report_messages
  FOR EACH ROW EXECUTE FUNCTION public._issue_touch_report_on_message();

-- ── 3. 結案 ────────────────────────────────────────────────────────────────────
-- 找不到回 NULL。no_response 只給自動結案，不能手動選。結案訊息不受單串 200 則的限制，滿了也要能結案。
CREATE OR REPLACE FUNCTION public._issue_close_report(
  p_report_id UUID,
  p_actor_id UUID,
  p_close_reason TEXT,
  p_body TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $_issue_close_report$
DECLARE
  v_body TEXT := btrim(regexp_replace(COALESCE(p_body, ''), '[[:cntrl:]]', '', 'g'));
  v_status TEXT;
  v_before TEXT;
  v_user_id UUID;
  v_message_id UUID;
  v_closed_at TIMESTAMPTZ;
BEGIN
  IF p_close_reason IS NULL OR p_close_reason NOT IN ('fixed', 'answered', 'cannot_reproduce', 'suggestion_noted', 'other') THEN
    RAISE EXCEPTION 'invalid_close_reason' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) < 1 THEN
    RAISE EXCEPTION 'empty_message' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) > 500 THEN
    RAISE EXCEPTION 'body_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT status, user_id INTO v_before, v_user_id FROM public.issue_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_before IN ('resolved', 'ignored') THEN
    RAISE EXCEPTION 'already_closed' USING ERRCODE = '22023';
  END IF;

  v_status := CASE WHEN p_close_reason IN ('fixed', 'answered') THEN 'resolved' ELSE 'ignored' END;

  INSERT INTO public.issue_report_messages (report_id, author_role, author_id, body, is_internal_note)
  VALUES (p_report_id, 'admin', p_actor_id, v_body, FALSE)
  RETURNING id INTO v_message_id;

  UPDATE public.issue_reports
  SET status = v_status, close_reason = p_close_reason, closed_at = now(), admin_last_read_at = now()
  WHERE id = p_report_id
  RETURNING closed_at INTO v_closed_at;

  RETURN jsonb_build_object(
    'id', p_report_id, 'status', v_status, 'close_reason', p_close_reason, 'closed_at', v_closed_at,
    'status_before', v_before, 'user_id', v_user_id, 'message_id', v_message_id, 'body_chars', char_length(v_body));
END;
$_issue_close_report$;
REVOKE ALL ON FUNCTION public._issue_close_report(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._issue_close_report(UUID, UUID, TEXT, TEXT) TO service_role;

-- 後台：稽核和資料變動同一個交易
CREATE OR REPLACE FUNCTION public.admin_api_report_close(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_report_id UUID,
  p_close_reason TEXT,
  p_body TEXT,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_report_close$
DECLARE
  v_closed JSONB;
BEGIN
  v_closed := public._issue_close_report(p_report_id, p_actor_id, p_close_reason, p_body);
  IF v_closed IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM audit.record('admin-api', 'report.close', 'ok', p_actor_id, p_actor_role, 'issue_reports',
    (v_closed ->> 'user_id')::UUID, p_report_id::text,
    jsonb_build_object(
      'status', jsonb_build_object('before', v_closed ->> 'status_before', 'after', v_closed ->> 'status'),
      'close_reason', jsonb_build_object('before', NULL, 'after', p_close_reason)),
    NULL, p_request_id,
    jsonb_build_object('message_id', v_closed ->> 'message_id', 'body_chars', (v_closed ->> 'body_chars')::INTEGER));

  RETURN jsonb_build_object(
    'id', p_report_id, 'status', v_closed ->> 'status', 'close_reason', p_close_reason, 'closed_at', v_closed ->> 'closed_at');
END;
$admin_api_report_close$;
REVOKE ALL ON FUNCTION public.admin_api_report_close(UUID, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_report_close(UUID, TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;

-- App 泡泡的回覆模式：經 nlc-data（service role，稽核由 nlc-data 的 AUDITED_ADMIN_RPCS 記）
CREATE OR REPLACE FUNCTION public.issue_admin_close(
  p_report_id UUID,
  p_close_reason TEXT,
  p_body TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $issue_admin_close$
DECLARE
  v_actor UUID := public._issue_actor(p_actor_id);
  v_closed JSONB;
BEGIN
  IF NOT COALESCE(public._issue_is_admin(v_actor), FALSE) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_closed := public._issue_close_report(p_report_id, v_actor, p_close_reason, p_body);
  IF v_closed IS NULL THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;
  RETURN jsonb_build_object(
    'ok', TRUE, 'status', v_closed ->> 'status', 'close_reason', p_close_reason, 'closed_at', v_closed ->> 'closed_at');
END;
$issue_admin_close$;
REVOKE ALL ON FUNCTION public.issue_admin_close(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_admin_close(UUID, TEXT, TEXT, UUID) TO service_role;

-- ── 4. 改狀態：不能再只改狀態就結案 ────────────────────────────────────────────
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
BEGIN
  IF p_status IN ('resolved', 'ignored') THEN
    RAISE EXCEPTION 'close_requires_reason' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'waiting_member', 'processing') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT status, user_id INTO v_before, v_user_id
  FROM public.issue_reports WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.issue_reports
  SET status = p_status, closed_at = NULL, close_reason = NULL, admin_last_read_at = now()
  WHERE id = p_report_id;

  PERFORM audit.record('admin-api', 'report.set_status', 'ok', p_actor_id, p_actor_role, 'issue_reports',
    v_user_id, p_report_id::text,
    jsonb_build_object('status', jsonb_build_object('before', v_before, 'after', p_status)),
    NULL, p_request_id, NULL);
  RETURN jsonb_build_object('id', p_report_id, 'status', p_status, 'closed_at', NULL, 'close_reason', NULL);
END;
$admin_api_report_set_status$;
REVOKE ALL ON FUNCTION public.admin_api_report_set_status(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_report_set_status(UUID, TEXT, UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_admin_set_status(
  p_report_id UUID,
  p_status TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $issue_admin_set_status$
DECLARE
  actor UUID := public._issue_actor(p_actor_id);
BEGIN
  IF NOT COALESCE(public._issue_is_admin(actor), FALSE) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_status IN ('resolved', 'ignored') THEN
    RAISE EXCEPTION 'close_requires_reason';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'waiting_member', 'processing') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  UPDATE public.issue_reports
  SET status = p_status, closed_at = NULL, close_reason = NULL, admin_last_read_at = now()
  WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;
  RETURN jsonb_build_object('ok', TRUE, 'status', p_status);
END;
$issue_admin_set_status$;
REVOKE ALL ON FUNCTION public.issue_admin_set_status(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_admin_set_status(UUID, TEXT, UUID) TO service_role;

-- ── 5. 自動結案：只限等會友 ────────────────────────────────────────────────────
-- 等開發不會自動結案。結案訊息沒有作者（系統發的），會友看到的是管理員訊息，並收到未讀提示。
CREATE OR REPLACE FUNCTION public.issue_threads_autoclose()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $issue_threads_autoclose$
DECLARE
  v_report_id UUID;
  v_closed INTEGER := 0;
BEGIN
  FOR v_report_id IN
    SELECT report.id
    FROM public.issue_reports AS report
    WHERE report.status = 'waiting_member'
      AND COALESCE(report.last_message_at, report.created_at) < now() - interval '14 days'
    FOR UPDATE
  LOOP
    UPDATE public.issue_reports
    SET status = 'ignored', close_reason = 'no_response', closed_at = now()
    WHERE id = v_report_id;

    INSERT INTO public.issue_report_messages (report_id, author_role, author_id, body, is_internal_note)
    VALUES (v_report_id, 'admin', NULL, '超過 14 天沒有收到回覆，先結案。若問題還在，直接回覆這則就會重新打開。', FALSE);

    v_closed := v_closed + 1;
  END LOOP;
  RETURN v_closed;
END;
$issue_threads_autoclose$;
REVOKE ALL ON FUNCTION public.issue_threads_autoclose() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_threads_autoclose() TO service_role;

-- ── 6. 收件匣清單 ──────────────────────────────────────────────────────────────
-- p_status：NULL＝全部、'open'＝三種未結案、'closed'＝兩種已結案，或單一狀態。
-- 待回覆、等開發從等最久的排起（keyset 分頁方向跟著反過來）；其他維持由新到舊。
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
  v_oldest_first BOOLEAN := COALESCE(p_status IN ('pending', 'processing'), FALSE) AND NOT COALESCE(p_unread_only, FALSE);
  v_rows JSONB;
  v_count INTEGER;
  v_counts JSONB := NULL;
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'closed', 'pending', 'waiting_member', 'processing', 'resolved', 'ignored') THEN
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
        OR (p_status = 'open' AND report.status IN ('pending', 'waiting_member', 'processing'))
        OR (p_status = 'closed' AND report.status IN ('resolved', 'ignored'))
        OR report.status = p_status)
  ),
  page AS (
    SELECT * FROM matched
    WHERE (NOT COALESCE(p_unread_only, FALSE) OR matched.unread)
      AND (p_cursor_at IS NULL
        OR (v_oldest_first AND (matched.sort_at > p_cursor_at OR (matched.sort_at = p_cursor_at AND matched.id > p_cursor_id)))
        OR (NOT v_oldest_first AND (matched.sort_at < p_cursor_at OR (matched.sort_at = p_cursor_at AND matched.id < p_cursor_id))))
    ORDER BY
      CASE WHEN v_oldest_first THEN matched.sort_at END ASC,
      CASE WHEN v_oldest_first THEN matched.id END ASC,
      CASE WHEN NOT v_oldest_first THEN matched.sort_at END DESC,
      CASE WHEN NOT v_oldest_first THEN matched.id END DESC
    LIMIT v_limit + 1
  )
  SELECT jsonb_agg(jsonb_build_object(
      'id', page.id,
      'category', page.category,
      'status', page.status,
      'close_reason', page.close_reason,
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
    ) ORDER BY
      CASE WHEN v_oldest_first THEN page.sort_at END ASC,
      CASE WHEN v_oldest_first THEN page.id END ASC,
      CASE WHEN NOT v_oldest_first THEN page.sort_at END DESC,
      CASE WHEN NOT v_oldest_first THEN page.id END DESC),
    count(*)
  INTO v_rows, v_count
  FROM page
  LEFT JOIN public.profiles AS profile ON profile.id = page.user_id;

  IF p_cursor_at IS NULL THEN
    SELECT jsonb_build_object(
      'all', count(*),
      'open', count(*) FILTER (WHERE report.status IN ('pending', 'waiting_member', 'processing')),
      'pending', count(*) FILTER (WHERE report.status = 'pending'),
      'waiting_member', count(*) FILTER (WHERE report.status = 'waiting_member'),
      'processing', count(*) FILTER (WHERE report.status = 'processing'),
      'closed', count(*) FILTER (WHERE report.status IN ('resolved', 'ignored')),
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

-- ── 7. 一張回報的對話：多帶結案原因 ────────────────────────────────────────────
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
      'close_reason', v_report.close_reason,
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

-- ── 8. 匯出：認得新的篩選 ──────────────────────────────────────────────────────
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
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'closed', 'pending', 'waiting_member', 'processing', 'resolved', 'ignored') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.issue_reports AS report
  WHERE (p_status IS NULL
    OR (p_status = 'open' AND report.status IN ('pending', 'waiting_member', 'processing'))
    OR (p_status = 'closed' AND report.status IN ('resolved', 'ignored'))
    OR report.status = p_status);

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
    WHERE (p_status IS NULL
      OR (p_status = 'open' AND report.status IN ('pending', 'waiting_member', 'processing'))
      OR (p_status = 'closed' AND report.status IN ('resolved', 'ignored'))
      OR report.status = p_status)
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

-- ── 9. 首頁：只算待回覆，等待時間看最後一則公開訊息 ────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_api_home_counts(p_actor_id uuid, p_global_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_home_counts$
DECLARE
  v_tomorrow date := (now() AT TIME ZONE 'Asia/Taipei')::date + 1;
  v_reports jsonb;
  v_commentary jsonb;
  v_quiz jsonb := NULL;
  v_calendar jsonb;
  v_changes jsonb;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);

  -- 回報：同 admin_api_report_list 的 counts
  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE report.status = 'pending'),
    'processing', count(*) FILTER (WHERE report.status = 'processing'),
    'unread', count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.issue_report_messages AS message
      WHERE message.report_id = report.id AND message.author_role = 'member' AND message.is_internal_note = FALSE
        AND message.attachment_path IS DISTINCT FROM 'pending'
        AND message.created_at > COALESCE(report.admin_last_read_at, report.created_at))),
    'oldest_pending_at', min(COALESCE(report.last_message_at, report.created_at)) FILTER (WHERE report.status = 'pending')
  ) INTO v_reports
  FROM public.issue_reports AS report;

  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE commentary.review_status = 'pending'),
    'approved', count(*) FILTER (WHERE commentary.review_status = 'approved')
  ) INTO v_commentary
  FROM public.passage_commentary AS commentary
  WHERE commentary.review_status IN ('pending', 'approved');

  IF p_global_plan_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.global_plans AS plan WHERE plan.id = p_global_plan_id) THEN
    v_calendar := public.get_daily_quiz_calendar(p_global_plan_id, v_tomorrow, 1, p_actor_id);
    v_quiz := jsonb_build_object(
      'enabled', COALESCE((SELECT setting.enabled FROM public.app_feature_settings AS setting WHERE setting.key = 'daily_quiz'), FALSE),
      -- 同 admin_api_plan_quiz 的 configured
      'configured', EXISTS (SELECT 1 FROM public.daily_quizzes AS quiz WHERE quiz.global_plan_id = p_global_plan_id)
        OR EXISTS (SELECT 1 FROM public.quiz_auto_publish_rules AS rule WHERE rule.global_plan_id = p_global_plan_id AND rule.enabled),
      'date', v_tomorrow,
      'status', v_calendar -> 'days' -> 0 ->> 'status',
      'needs_attention', COALESCE((v_calendar -> 'days' -> 0 ->> 'needsAttention')::boolean, FALSE)
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('action', recent.action, 'occurred_at', recent.occurred_at)
      ORDER BY recent.occurred_at DESC, recent.id DESC), '[]'::jsonb)
  INTO v_changes
  FROM (
    SELECT event.id, event.action, event.occurred_at
    FROM audit.admin_events AS event
    WHERE event.result = 'ok'
      AND event.occurred_at > now() - interval '30 days'
      AND (event.action LIKE 'app_feature_settings.%'
        OR event.action LIKE 'global_plans.%'
        OR event.action IN (
          'publish_global_plan_rules', 'create_region_stage_cohort', 'set_daily_quiz_auto_publish_rule',
          'admin_save_lightning_quiz_settings', 'set_profile_managed_scopes', 'set_commentary_reviewers'))
    ORDER BY event.occurred_at DESC, event.id DESC
    LIMIT 5
  ) AS recent;

  RETURN jsonb_build_object(
    'reports', v_reports,
    'commentary', v_commentary,
    'quiz', v_quiz,
    'changes', v_changes
  );
END;
$admin_api_home_counts$;
REVOKE ALL ON FUNCTION public.admin_api_home_counts(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_home_counts(uuid, uuid) TO service_role;

-- ── 10. 每日摘要的數字：只有數字，沒有任何人的名字或回報內容 ───────────────────
CREATE OR REPLACE FUNCTION public.issue_report_digest_counts()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $issue_report_digest_counts$
  SELECT jsonb_build_object(
    'new_24h', count(*) FILTER (WHERE report.created_at > now() - interval '24 hours'),
    'pending', count(*) FILTER (WHERE report.status = 'pending'),
    'processing', count(*) FILTER (WHERE report.status = 'processing'),
    'unread', count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.issue_report_messages AS message
      WHERE message.report_id = report.id AND message.author_role = 'member' AND message.is_internal_note = FALSE
        AND message.attachment_path IS DISTINCT FROM 'pending'
        AND message.created_at > COALESCE(report.admin_last_read_at, report.created_at))),
    'oldest_pending_at', min(COALESCE(report.last_message_at, report.created_at)) FILTER (WHERE report.status = 'pending')
  )
  FROM public.issue_reports AS report;
$issue_report_digest_counts$;
REVOKE ALL ON FUNCTION public.issue_report_digest_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_report_digest_counts() TO service_role;

-- ── 11. 每日摘要排程：台北時間 08:00（= 00:00 UTC）────────────────────────────
-- 和 invoke_issue_report_maintenance 共用 Vault 的 issue_report_maintenance_cron_secret；沒設定就只留 WARNING。
CREATE OR REPLACE FUNCTION public.invoke_issue_report_digest()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $invoke_issue_report_digest$
DECLARE
  cron_secret TEXT;
  target_url TEXT;
BEGIN
  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'issue_report_maintenance_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL THEN
    RAISE WARNING 'issue_report_maintenance_cron_secret not found in Vault; skipping issue report digest';
    RETURN;
  END IF;

  target_url := public.edge_function_url('issue-report-maintenance');
  IF target_url IS NULL THEN
    RAISE WARNING 'project_url not configured in Vault; skipping issue report digest';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := target_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-maintenance-secret', cron_secret
    ),
    body := jsonb_build_object('digest', true)
  );
END;
$invoke_issue_report_digest$;
REVOKE ALL ON FUNCTION public.invoke_issue_report_digest() FROM PUBLIC, anon, authenticated;

DO $schedule_issue_report_digest$
DECLARE
  existing_job BIGINT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'issue-report-daily-digest'
  LIMIT 1;
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
  PERFORM cron.schedule(
    'issue-report-daily-digest',
    '0 0 * * *',
    'SELECT public.invoke_issue_report_digest();'
  );
END;
$schedule_issue_report_digest$;
