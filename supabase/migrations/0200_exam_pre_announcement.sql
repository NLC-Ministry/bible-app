-- 0200_exam_pre_announcement.sql
--
-- 新增「預告」：開考前幾天可以先發的一則簡短通知（標題/內容，沒有入口按鈕，
-- 因為這時候還不能作答），跟「公告」（測驗活動期間出現的入口文字，必填）是
-- 兩個獨立的內容欄位。不加新資料表——只在 exam_papers 加兩個欄位，沿用
-- 「公告」已經在用的同一套模式（JSONB 內容 + 布林旗標）。
--
-- 顯示邏輯是純粹的「哪個內容蓋過哪個」，不是另外一組「發佈/撤下」狀態機：
--   · 預告要出現，需要 pre_announcement_enabled = TRUE 且標題/內容都填了，
--     而且「公告」還沒發佈（announcement_published = FALSE）。
--   · 公告一旦發佈，會友端自動只看得到公告，預告不會再出現——不用額外按
--     「撤下預告」，公告發佈這個動作本身就等於蓋掉預告。
--   · 跟公告一樣：內容只能在測試版編輯，正式版靠「同步到正式版」帶過去；
--     測試版可以獨立開關/預覽自己的預告內容，只有 admin/pastor 看得到。
--
-- 部署：Supabase SQL editor 執行，或 supabase db push。

ALTER TABLE public.exam_papers
  ADD COLUMN IF NOT EXISTS pre_announcement JSONB NOT NULL
    DEFAULT jsonb_build_object('headline', '', 'body', ''),
  ADD COLUMN IF NOT EXISTS pre_announcement_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 儲存預告內容 + 開關，一次搞定（不用像公告那樣分「存草稿」跟「發佈」兩步，
--    因為預告沒有獨立的發佈狀態——是否顯示純粹由「開關 + 內容 + 公告是否已發佈」
--    這三個條件算出來，存的當下就立刻生效/失效）──
CREATE OR REPLACE FUNCTION public.exam_save_pre_announcement(
  p_paper_id        UUID,
  p_pre_announcement JSONB,
  p_enabled         BOOLEAN,
  p_actor_id        UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  row_out  public.exam_papers%ROWTYPE;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  UPDATE public.exam_papers SET
    pre_announcement = jsonb_build_object(
      'headline', COALESCE(p_pre_announcement ->> 'headline', ''),
      'body',     COALESCE(p_pre_announcement ->> 'body', '')),
    pre_announcement_enabled = COALESCE(p_enabled, FALSE)
  WHERE id = p_paper_id AND status <> 'closed'
  RETURNING * INTO row_out;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_announcement_locked'; END IF;
  RETURN to_jsonb(row_out);
END;
$$;

REVOKE ALL ON FUNCTION public.exam_save_pre_announcement(UUID, JSONB, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exam_save_pre_announcement(UUID, JSONB, BOOLEAN, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.exam_save_pre_announcement(UUID, JSONB, BOOLEAN, UUID)
IS '儲存「預告」內容（標題/內容）跟開關，跟公告一樣只有測試版草稿能改（status<>closed），沒有獨立的發佈/撤下狀態——是否顯示由 _exam_member_paper_summary 依「開關 + 內容 + 公告尚未發佈」即時算出。';

-- ── 同步到正式版：預告內容跟開關一併帶過去，跟公告同一個待遇（每次同步都覆蓋）──
CREATE OR REPLACE FUNCTION public.exam_push_to_live(p_test_paper_id UUID, p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  src public.exam_papers%ROWTYPE;
  dst public.exam_papers%ROWTYPE;
  did_create BOOLEAN := FALSE;
  reverted   BOOLEAN := FALSE;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;

  SELECT * INTO src FROM public.exam_papers WHERE id = p_test_paper_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
  IF src.mode <> 'test' THEN RAISE EXCEPTION 'exam_push_source_not_test'; END IF;

  SELECT * INTO dst FROM public.exam_papers
  WHERE pushed_from_id = src.id AND mode = 'live'
  ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.exam_papers (
      title, description, mode, status, open_at, close_at,
      duration_minutes, total_points, pledge, sections, section_targets,
      announcement, announcement_published, pre_announcement, pre_announcement_enabled,
      linked_plan_id, pushed_from_id, created_by)
    VALUES (
      src.title, src.description, 'live', 'draft', src.open_at, src.close_at,
      src.duration_minutes, src.total_points, src.pledge, src.sections, src.section_targets,
      src.announcement, FALSE, src.pre_announcement, src.pre_announcement_enabled,
      src.linked_plan_id, src.id, actor_id)
    RETURNING * INTO dst;
    did_create := TRUE;
  ELSE
    -- 防呆 1：正式版已有人作答 → 不准再推（會換 question id、毀掉已計分結果）
    IF EXISTS (SELECT 1 FROM public.exam_attempts WHERE paper_id = dst.id) THEN
      RAISE EXCEPTION 'exam_push_live_has_attempts';
    END IF;
    -- 防呆 2：測驗進行中 → 先關閉測驗再更新內容
    IF dst.status = 'published' THEN
      RAISE EXCEPTION 'exam_push_live_not_closed';
    END IF;

    reverted := (dst.status = 'closed');
    UPDATE public.exam_papers SET
      title = src.title,
      description = src.description,
      open_at = src.open_at,
      close_at = src.close_at,
      duration_minutes = src.duration_minutes,
      total_points = src.total_points,
      pledge = src.pledge,
      sections = src.sections,
      section_targets = src.section_targets,
      linked_plan_id = src.linked_plan_id,
      announcement = src.announcement,
      pre_announcement = src.pre_announcement,
      pre_announcement_enabled = src.pre_announcement_enabled,
      status = CASE WHEN dst.status = 'closed' THEN 'draft' ELSE dst.status END,
      published_at = NULL,
      published_by = NULL
      -- announcement_published／announced_at／announced_by 是正式版自己的
      -- 發佈狀態，push 不動——內容換了不代表要自動重新對外公布。
    WHERE id = dst.id
    RETURNING * INTO dst;
  END IF;

  -- 題目整份覆蓋（新 id、同內容）
  DELETE FROM public.exam_questions WHERE paper_id = dst.id;
  INSERT INTO public.exam_questions (paper_id, section, position, points, payload, answer_key)
  SELECT dst.id, section, position, points, payload, answer_key
  FROM public.exam_questions WHERE paper_id = src.id;

  RETURN jsonb_build_object(
    'livePaperId', dst.id, 'created', did_create, 'reverted', reverted, 'liveStatus', dst.status
  );
END;
$$;

COMMENT ON FUNCTION public.exam_push_to_live(UUID, UUID)
IS '把測試版的題目、試卷設定（含公告 announcement、預告 pre_announcement）整份同步到對應的正式版。announcement_published 是正式版自己的發佈開關，不受同步影響；預告沒有獨立發佈狀態，開關值 pre_announcement_enabled 跟著內容一起同步。正式版一旦有作答或測驗進行中就不能再同步（exam_push_live_has_attempts／exam_push_live_not_closed）。';

-- ── 會友端摘要：公告已發佈就優先顯示公告，否則預告開著且內容齊全才顯示預告 ──
CREATE OR REPLACE FUNCTION public._exam_member_paper_summary(p_paper_id UUID,p_actor_id UUID,p_is_staff BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE pr public.exam_papers%ROWTYPE;official_at public.exam_attempts%ROWTYPE;practice_at public.exam_attempts%ROWTYPE;
  now_ts TIMESTAMPTZ:=NOW();practice_end TIMESTAMPTZ;in_window BOOLEAN:=FALSE;
  can_enter BOOLEAN:=FALSE;can_practice BOOLEAN:=FALSE;result_ready BOOLEAN:=FALSE;
  show_pre BOOLEAN;disp_headline TEXT;disp_body TEXT;
BEGIN
  SELECT * INTO pr FROM public.exam_papers WHERE id=p_paper_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  practice_end:=public._exam_practice_close_at(pr.id);
  SELECT * INTO official_at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=p_actor_id AND attempt_kind='official';
  SELECT * INTO practice_at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=p_actor_id AND attempt_kind='practice';
  in_window:=pr.open_at IS NOT NULL AND pr.close_at IS NOT NULL AND now_ts>=pr.open_at AND now_ts<pr.close_at;
  can_enter:=official_at.id IS NULL AND pr.status='published' AND(in_window OR(pr.mode='test' AND p_is_staff));
  can_practice:=pr.practice_retake_enabled AND pr.status IN('published','closed') AND now_ts<practice_end
    AND official_at.id IS NOT NULL AND official_at.status<>'in_progress';
  result_ready:=official_at.status='graded' AND(pr.results_published_at IS NOT NULL OR p_is_staff);
  -- 公告已發佈 → 一律顯示公告（等於預告自動被蓋掉，不用另外撤下）；
  -- 公告還沒發佈 → 預告開著且標題/內容都填了才顯示預告。
  show_pre:=(NOT pr.announcement_published) AND pr.pre_announcement_enabled
    AND COALESCE(btrim(pr.pre_announcement->>'headline'),'')<>'' AND COALESCE(btrim(pr.pre_announcement->>'body'),'')<>'';
  disp_headline:=CASE WHEN show_pre THEN pr.pre_announcement->>'headline' ELSE pr.announcement->>'headline' END;
  disp_body:=CASE WHEN show_pre THEN pr.pre_announcement->>'body' ELSE pr.announcement->>'body' END;
  RETURN jsonb_build_object('paperId',pr.id,'title',pr.title,'status',pr.status,'mode',pr.mode,
    'headline',COALESCE(disp_headline,''),'body',COALESCE(disp_body,''),
    'isPreAnnouncement',show_pre,
    'ctaLabel',COALESCE(NULLIF(pr.announcement->>'ctaLabel',''),'進入測驗'),'openAt',pr.open_at,
    'closeAt',pr.close_at,'practiceCloseAt',practice_end,'durationMinutes',pr.duration_minutes,
    'serverNow',now_ts,'inWindow',in_window,'canEnter',can_enter,'myAttemptStatus',official_at.status,
    'officialAttemptId',official_at.id,'canReviewOfficial',official_at.id IS NOT NULL AND official_at.status<>'in_progress',
    'canPractice',can_practice,'practiceAttemptId',practice_at.id,'practiceAttemptStatus',practice_at.status,
    'practiceReviewReady',practice_at.id IS NOT NULL,'resultReady',result_ready,
    'resultsPublishedAt',pr.results_published_at,
    'myTotalScore',CASE WHEN result_ready THEN official_at.total_score ELSE NULL END);
END;
$$;

-- ── 首頁清單：公告已發佈「或」預告開著且內容齊全，都算是可以出現在首頁的卷 ──
CREATE OR REPLACE FUNCTION public.exam_home_exams(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  is_staff BOOLEAN := public._exam_actor_role(actor_id) IN ('admin', 'pastor');
BEGIN
  IF NOT public.is_feature_enabled('speed_reading_exam') THEN RETURN '[]'::jsonb; END IF;
  PERFORM public._exam_close_expired_papers();

  RETURN COALESCE((
    SELECT jsonb_agg(public._exam_member_paper_summary(pr.id, actor_id, is_staff)
      ORDER BY
        (pr.status = 'published' AND NOW() >= pr.open_at AND NOW() < pr.close_at) DESC,
        (pr.status = 'published' AND NOW() < pr.open_at) DESC,
        pr.open_at DESC NULLS LAST,
        pr.created_at DESC)
    FROM public.exam_papers pr
    WHERE (
      pr.announcement_published = TRUE
      OR (pr.pre_announcement_enabled = TRUE
          AND COALESCE(btrim(pr.pre_announcement->>'headline'), '') <> ''
          AND COALESCE(btrim(pr.pre_announcement->>'body'), '') <> '')
    )
      AND (pr.mode = 'live' OR is_staff)
  ), '[]'::jsonb);
END;
$$;

-- ── 舊版單卡 fallback：同一套「公告優先、否則預告」判斷 ──
CREATE OR REPLACE FUNCTION public.exam_home_banner(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor_id UUID:=public.resolve_quiz_actor(p_actor_id);is_staff BOOLEAN:=public._exam_actor_role(actor_id)IN('admin','pastor');
  paper_id UUID;
BEGIN
  IF NOT public.is_feature_enabled('speed_reading_exam')THEN RETURN NULL; END IF;
  PERFORM public._exam_close_expired_papers();
  SELECT pr.id INTO paper_id FROM public.exam_papers pr
  WHERE (
      pr.announcement_published = TRUE
      OR (pr.pre_announcement_enabled = TRUE
          AND COALESCE(btrim(pr.pre_announcement->>'headline'), '') <> ''
          AND COALESCE(btrim(pr.pre_announcement->>'body'), '') <> '')
    ) AND(pr.mode='live' OR is_staff)
  ORDER BY(pr.mode='live')DESC,pr.announced_at DESC NULLS LAST,pr.created_at DESC LIMIT 1;
  IF paper_id IS NULL THEN RETURN NULL; END IF;
  RETURN public._exam_member_paper_summary(paper_id,actor_id,is_staff);
END;
$$;
