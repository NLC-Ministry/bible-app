-- ============================================================================
-- 20261009092820_commentary_review.sql  —  #471 經文注釋審核流程
--
-- 匯入的注釋（Tyndale Open Study Notes 翻譯，#476 各卷）先不公開，經審核後才由維護者發布：
--   待審 pending → 通過待發布 approved → 已發布 published（維護者按「最終發布」）
--             ↘ 退回 returned（附意見）→ 維護者修改後重新送審 → pending
-- 後台手寫的注釋與詞條不走這個流程（review_status 是 NULL），照舊用 is_published。
--
-- - passage_commentary 加審核欄位、英文原文 source_text、匯入識別碼 source_ref
--   （重跑匯入時用它跳過已存在的列，不會蓋掉審過的內容）。
-- - 審核中（pending／returned／approved）的列一定是未發布：CHECK 擋住，閱讀器與索引
--   本來就只看 is_published，所以會友看不到。
-- - commentary_reviewers：依書卷指派審核者（不新增角色，任何會友都可以被指派）。
-- - commentary_review_notifications：App 內通知（併進通知鈴）。同一人、同一種、同一卷的
--   未讀通知會合併成一筆並累加數量，一次匯入幾百則也只會有一筆「利未記有 N 則待審」。
-- - 讀寫一律走 RPC（nlc-data 注入 p_actor_id）。SQL 端自己檢查：系統管理員，或被指派到
--   這一卷的審核者；沒有指派就拒絕（fail closed）。兩張新表不直接開放給 authenticated。
--
-- 全部是新增，舊版程式不會呼叫，不需要 forceUpdateBuiltBefore。
-- 依賴 20261009064256_verse_commentary_terms.sql（#470）。
-- 部署順序：先跑這支 migration，再部署 nlc-data（新版才放行這些 RPC）。
-- ============================================================================

-- ── passage_commentary：審核欄位 ───────────────────────────────────────
ALTER TABLE public.passage_commentary
  ADD COLUMN IF NOT EXISTS review_status TEXT,
  ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

ALTER TABLE public.passage_commentary DROP CONSTRAINT IF EXISTS passage_commentary_review_status_check;
ALTER TABLE public.passage_commentary ADD CONSTRAINT passage_commentary_review_status_check
  CHECK (review_status IS NULL OR review_status IN ('pending', 'returned', 'approved', 'published'));

-- 審核中的列不能是已發布。
ALTER TABLE public.passage_commentary DROP CONSTRAINT IF EXISTS passage_commentary_review_unpublished_check;
ALTER TABLE public.passage_commentary ADD CONSTRAINT passage_commentary_review_unpublished_check
  CHECK (review_status IS NULL OR review_status = 'published' OR is_published = FALSE);

-- #470 的「同一章同一個節範圍只能一則」只管後台手寫的注釋：匯入的研讀注釋常有同一節的
-- 多則（例如 1:1 的注釋和「1:1–7:38 總覽」都掛在 1:1），用 source_ref 區分。
DROP INDEX IF EXISTS public.passage_commentary_verse_note_key;
CREATE UNIQUE INDEX IF NOT EXISTS passage_commentary_verse_note_key
  ON public.passage_commentary (book, chapter, verse_start, verse_end)
  WHERE verse_start IS NOT NULL AND source_ref IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS passage_commentary_source_ref_key
  ON public.passage_commentary (source_ref)
  WHERE source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS passage_commentary_review_book_idx
  ON public.passage_commentary (book, review_status)
  WHERE review_status IS NOT NULL;

-- ── commentary_reviewers：依書卷指派 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.commentary_reviewers (
  book TEXT NOT NULL CHECK (btrim(book) <> ''),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (book, profile_id)
);

CREATE INDEX IF NOT EXISTS commentary_reviewers_profile_idx ON public.commentary_reviewers (profile_id);

ALTER TABLE public.commentary_reviewers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.commentary_reviewers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.commentary_reviewers TO service_role;

-- ── commentary_review_notifications：App 內通知 ─────────────────────────
CREATE TABLE IF NOT EXISTS public.commentary_review_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('assigned', 'pending', 'approved', 'returned')),
  book TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

-- 同一人、同一種、同一卷只會有一筆未讀（新的事件累加到這一筆）。
CREATE UNIQUE INDEX IF NOT EXISTS commentary_review_notifications_unread_key
  ON public.commentary_review_notifications (recipient_id, kind, book)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS commentary_review_notifications_recipient_idx
  ON public.commentary_review_notifications (recipient_id, updated_at DESC);

ALTER TABLE public.commentary_review_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.commentary_review_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.commentary_review_notifications TO service_role;

-- ── 內部輔助 ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._commentary_actor_is_admin(p_actor_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT public.role_code(p.role_id) = 'admin'
    FROM public.profiles p
    WHERE p.id = p_actor_id AND p.is_active = TRUE
  ), FALSE);
$$;
REVOKE ALL ON FUNCTION public._commentary_actor_is_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._commentary_actor_is_admin(uuid) TO service_role;

-- 管理員或被指派到這一卷；沒有指派就是 FALSE。
CREATE OR REPLACE FUNCTION public._commentary_actor_can_review(p_actor_id UUID, p_book TEXT)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT public._commentary_actor_is_admin(p_actor_id)
    OR EXISTS (
      SELECT 1
      FROM public.commentary_reviewers r
      JOIN public.profiles p ON p.id = r.profile_id AND p.is_active = TRUE
      WHERE r.profile_id = p_actor_id AND r.book = p_book
    );
$$;
REVOKE ALL ON FUNCTION public._commentary_actor_can_review(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._commentary_actor_can_review(uuid, text) TO service_role;

-- 新增或累加一筆未讀通知。
CREATE OR REPLACE FUNCTION public._notify_commentary_review(p_recipient_id UUID, p_kind TEXT, p_book TEXT, p_count INTEGER)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_recipient_id IS NULL OR COALESCE(p_count, 0) < 0 THEN
    RETURN;
  END IF;
  INSERT INTO public.commentary_review_notifications (recipient_id, kind, book, item_count)
  VALUES (p_recipient_id, p_kind, p_book, COALESCE(p_count, 0))
  ON CONFLICT (recipient_id, kind, book) WHERE read_at IS NULL
  DO UPDATE SET
    item_count = CASE WHEN p_kind = 'assigned'
      THEN EXCLUDED.item_count
      ELSE public.commentary_review_notifications.item_count + EXCLUDED.item_count END,
    updated_at = NOW();
END;
$$;
REVOKE ALL ON FUNCTION public._notify_commentary_review(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._notify_commentary_review(uuid, text, text, integer) TO service_role;

-- 狀態變成待審 → 通知這一卷的審核者；變成通過或退回 → 通知系統管理員。
-- SECURITY DEFINER：直連開發環境的管理員也寫得進通知表（通知表不開放給 authenticated）。
CREATE OR REPLACE FUNCTION public._passage_commentary_review_notify()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  recipient UUID;
BEGIN
  IF NEW.review_status IS NULL
    OR (TG_OP = 'UPDATE' AND OLD.review_status IS NOT DISTINCT FROM NEW.review_status) THEN
    RETURN NEW;
  END IF;
  IF NEW.review_status = 'pending' THEN
    FOR recipient IN
      SELECT r.profile_id
      FROM public.commentary_reviewers r
      JOIN public.profiles p ON p.id = r.profile_id AND p.is_active = TRUE
      WHERE r.book = NEW.book
    LOOP
      PERFORM public._notify_commentary_review(recipient, 'pending', NEW.book, 1);
    END LOOP;
  ELSIF NEW.review_status IN ('approved', 'returned') THEN
    FOR recipient IN
      SELECT p.id FROM public.profiles p
      WHERE p.is_active = TRUE AND public.role_code(p.role_id) = 'admin'
    LOOP
      PERFORM public._notify_commentary_review(recipient, NEW.review_status, NEW.book, 1);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._passage_commentary_review_notify() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._passage_commentary_review_notify() TO service_role;

DROP TRIGGER IF EXISTS trg_passage_commentary_review_notify ON public.passage_commentary;
CREATE TRIGGER trg_passage_commentary_review_notify
  AFTER INSERT OR UPDATE OF review_status ON public.passage_commentary
  FOR EACH ROW EXECUTE FUNCTION public._passage_commentary_review_notify();

-- 審核頁、後台總覽回傳的一則注釋。
CREATE OR REPLACE FUNCTION public._commentary_review_item_json(c public.passage_commentary)
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'id', c.id,
    'book', c.book,
    'chapter', c.chapter,
    'verse_start', c.verse_start,
    'verse_end', c.verse_end,
    'title', c.title,
    'content', c.content,
    'topic_tags', c.topic_tags,
    'source', c.source,
    'source_text', c.source_text,
    'review_status', c.review_status,
    'review_note', c.review_note,
    'reviewed_at', c.reviewed_at,
    'reviewed_by_name', (SELECT COALESCE(p.name, '') FROM public.profiles p WHERE p.id = c.reviewed_by),
    'updated_at', c.updated_at
  );
$$;
REVOKE ALL ON FUNCTION public._commentary_review_item_json(public.passage_commentary) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._commentary_review_item_json(public.passage_commentary) TO service_role;

-- ── 審核者：我的審核 ───────────────────────────────────────────────────
-- 回傳指派給我的書卷，以及那些書卷裡還在流程中的注釋（待審、退回、通過待發布）。
-- 系統管理員看到所有有審核內容或有指派的書卷。
CREATE OR REPLACE FUNCTION public.get_my_commentary_reviews(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  is_admin BOOLEAN := public._commentary_actor_is_admin(actor_id);
  my_books TEXT[];
BEGIN
  IF is_admin THEN
    SELECT COALESCE(array_agg(DISTINCT b), '{}') INTO my_books FROM (
      SELECT book AS b FROM public.passage_commentary WHERE review_status IN ('pending', 'returned', 'approved')
      UNION SELECT book FROM public.commentary_reviewers
    ) s;
  ELSE
    SELECT COALESCE(array_agg(DISTINCT r.book), '{}') INTO my_books
    FROM public.commentary_reviewers r WHERE r.profile_id = actor_id;
  END IF;

  RETURN jsonb_build_object(
    'is_admin', is_admin,
    'books', to_jsonb(my_books),
    'items', COALESCE((
      SELECT jsonb_agg(public._commentary_review_item_json(c)
        ORDER BY c.book, c.chapter, c.verse_start NULLS FIRST, c.verse_end NULLS FIRST, c.id)
      FROM public.passage_commentary c
      WHERE c.book = ANY (my_books)
        AND c.review_status IN ('pending', 'returned', 'approved')
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_commentary_reviews(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_commentary_reviews(uuid) TO authenticated, service_role;

-- 通過或退回（可同時修改譯文）。還沒發布前可以改判。退回一定要附意見。
CREATE OR REPLACE FUNCTION public.review_commentary(
  p_id UUID,
  p_decision TEXT,
  p_title TEXT DEFAULT NULL,
  p_content TEXT DEFAULT NULL,
  p_note TEXT DEFAULT '',
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  c public.passage_commentary%ROWTYPE;
  next_content TEXT;
  note TEXT := btrim(COALESCE(p_note, ''));
BEGIN
  IF p_decision NOT IN ('approve', 'return') THEN
    RAISE EXCEPTION 'commentary_review_invalid_decision';
  END IF;
  SELECT * INTO c FROM public.passage_commentary WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR c.review_status NOT IN ('pending', 'returned', 'approved') THEN
    RAISE EXCEPTION 'commentary_review_not_found';
  END IF;
  IF NOT public._commentary_actor_can_review(actor_id, c.book) THEN
    RAISE EXCEPTION 'commentary_review_forbidden';
  END IF;
  next_content := btrim(COALESCE(p_content, c.content));
  IF next_content = '' THEN
    RAISE EXCEPTION 'commentary_review_content_required';
  END IF;
  IF p_decision = 'return' AND note = '' THEN
    RAISE EXCEPTION 'commentary_review_note_required';
  END IF;

  UPDATE public.passage_commentary SET
    title = btrim(COALESCE(p_title, c.title)),
    content = next_content,
    review_status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'returned' END,
    review_note = CASE WHEN p_decision = 'approve' THEN '' ELSE note END,
    reviewed_by = actor_id,
    reviewed_at = NOW()
  WHERE id = p_id
  RETURNING * INTO c;

  RETURN public._commentary_review_item_json(c);
END;
$$;
REVOKE ALL ON FUNCTION public.review_commentary(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_commentary(uuid, text, text, text, text, uuid) TO authenticated, service_role;

-- ── 系統管理員：總覽、指派、重新送審、最終發布 ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_commentary_review_overview(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
BEGIN
  IF NOT public._commentary_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'commentary_review_admin_required';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'book', b.book,
      'pending', (SELECT COUNT(*) FROM public.passage_commentary c WHERE c.book = b.book AND c.review_status = 'pending'),
      'returned', (SELECT COUNT(*) FROM public.passage_commentary c WHERE c.book = b.book AND c.review_status = 'returned'),
      'approved', (SELECT COUNT(*) FROM public.passage_commentary c WHERE c.book = b.book AND c.review_status = 'approved'),
      'published', (SELECT COUNT(*) FROM public.passage_commentary c WHERE c.book = b.book AND c.review_status = 'published' AND c.is_published),
      'reviewers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', COALESCE(p.name, ''), 'pastoral_zone', COALESCE(p.pastoral_zone, ''))
          ORDER BY p.name)
        FROM public.commentary_reviewers r JOIN public.profiles p ON p.id = r.profile_id
        WHERE r.book = b.book
      ), '[]'::jsonb)
    ) ORDER BY b.book)
    FROM (
      SELECT book FROM public.passage_commentary WHERE review_status IS NOT NULL
      UNION SELECT book FROM public.commentary_reviewers
    ) b
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_commentary_review_overview(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_commentary_review_overview(uuid) TO authenticated, service_role;

-- 設定這一卷的審核者名單（整份取代）。新加入的人收到「被指派」通知（附目前待審數）。
CREATE OR REPLACE FUNCTION public.set_commentary_reviewers(
  p_book TEXT,
  p_profile_ids UUID[],
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  book_name TEXT := btrim(COALESCE(p_book, ''));
  wanted UUID[] := COALESCE(p_profile_ids, '{}');
  added UUID;
  pending_count INTEGER;
BEGIN
  IF NOT public._commentary_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'commentary_review_admin_required';
  END IF;
  IF book_name = '' THEN
    RAISE EXCEPTION 'commentary_review_book_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(wanted) AS w(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = w.id AND p.is_active = TRUE)
  ) THEN
    RAISE EXCEPTION 'commentary_review_profile_not_found';
  END IF;

  DELETE FROM public.commentary_reviewers
  WHERE book = book_name AND NOT (profile_id = ANY (wanted));

  SELECT COUNT(*) INTO pending_count FROM public.passage_commentary
  WHERE book = book_name AND review_status = 'pending';

  FOR added IN
    INSERT INTO public.commentary_reviewers (book, profile_id, assigned_by)
    SELECT book_name, w.id, actor_id FROM (SELECT DISTINCT unnest(wanted) AS id) w
    ON CONFLICT (book, profile_id) DO NOTHING
    RETURNING profile_id
  LOOP
    PERFORM public._notify_commentary_review(added, 'assigned', book_name, pending_count);
  END LOOP;

  RETURN public.get_commentary_review_overview(actor_id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_commentary_reviewers(text, uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_commentary_reviewers(text, uuid[], uuid) TO authenticated, service_role;

-- 退回的注釋修改後重新送審（也可以順便改內容）。
CREATE OR REPLACE FUNCTION public.resubmit_commentary(
  p_id UUID,
  p_title TEXT DEFAULT NULL,
  p_content TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  c public.passage_commentary%ROWTYPE;
  next_content TEXT;
BEGIN
  IF NOT public._commentary_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'commentary_review_admin_required';
  END IF;
  SELECT * INTO c FROM public.passage_commentary WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR c.review_status NOT IN ('returned', 'approved') THEN
    RAISE EXCEPTION 'commentary_review_not_found';
  END IF;
  next_content := btrim(COALESCE(p_content, c.content));
  IF next_content = '' THEN
    RAISE EXCEPTION 'commentary_review_content_required';
  END IF;
  UPDATE public.passage_commentary SET
    title = btrim(COALESCE(p_title, c.title)),
    content = next_content,
    review_status = 'pending'
  WHERE id = p_id
  RETURNING * INTO c;
  RETURN public._commentary_review_item_json(c);
END;
$$;
REVOKE ALL ON FUNCTION public.resubmit_commentary(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_commentary(uuid, text, text, uuid) TO authenticated, service_role;

-- 最終發布：只發布「通過待發布」的。傳 p_ids 發布那幾則；傳 p_book 發布整卷。回傳發布數量。
CREATE OR REPLACE FUNCTION public.publish_approved_commentary(
  p_ids UUID[] DEFAULT NULL,
  p_book TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  published_count INTEGER;
BEGIN
  IF NOT public._commentary_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'commentary_review_admin_required';
  END IF;
  IF p_ids IS NULL AND btrim(COALESCE(p_book, '')) = '' THEN
    RAISE EXCEPTION 'commentary_review_target_required';
  END IF;
  UPDATE public.passage_commentary SET
    review_status = 'published',
    is_published = TRUE,
    published_by = actor_id,
    published_at = NOW()
  WHERE review_status = 'approved'
    AND (p_ids IS NULL OR id = ANY (p_ids))
    AND (btrim(COALESCE(p_book, '')) = '' OR book = btrim(p_book));
  GET DIAGNOSTICS published_count = ROW_COUNT;
  RETURN jsonb_build_object('published', published_count);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_approved_commentary(uuid[], text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_approved_commentary(uuid[], text, uuid) TO authenticated, service_role;

-- ── 通知 ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_commentary_review_notifications(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id,
      'kind', n.kind,
      'book', n.book,
      'item_count', n.item_count,
      'created_at', n.created_at,
      'updated_at', n.updated_at,
      'read_at', n.read_at
    ) ORDER BY (n.read_at IS NULL) DESC, n.updated_at DESC)
    FROM (
      SELECT * FROM public.commentary_review_notifications
      WHERE recipient_id = actor_id
      ORDER BY (read_at IS NULL) DESC, updated_at DESC
      LIMIT 20
    ) n
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_commentary_review_notifications(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_commentary_review_notifications(uuid) TO authenticated, service_role;

-- p_notification_id 是 NULL＝全部標成已讀。只動呼叫者自己的通知。
CREATE OR REPLACE FUNCTION public.mark_commentary_review_notifications_read(
  p_notification_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  marked INTEGER;
BEGIN
  UPDATE public.commentary_review_notifications SET read_at = NOW()
  WHERE recipient_id = actor_id
    AND read_at IS NULL
    AND (p_notification_id IS NULL OR id = p_notification_id);
  GET DIAGNOSTICS marked = ROW_COUNT;
  RETURN jsonb_build_object('marked', marked);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_commentary_review_notifications_read(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_commentary_review_notifications_read(uuid, uuid) TO authenticated, service_role;
