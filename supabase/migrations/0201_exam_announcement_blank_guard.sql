-- 0201_exam_announcement_blank_guard.sql
--
-- 補洞：「公告必填」只在第一次按「發佈預告文」時檢查過（exam_publish_announcement
-- 本來就擋空白），但存檔動作（exam_save_announcement）完全沒有檢查——已經發佈的
-- 公告，事後回去把標題/內容清空再按「儲存公告」，會直接存成空字串，
-- announcement_published 卻還是 TRUE，首頁卡片變成內容空白但還在顯示。
-- 「同步到正式版」（exam_push_to_live）也有同一個洞、影響更大：正式版已經發佈給
-- 全體會友看的公告，只要測試版被改空再同步，會直接覆蓋成空白，且沒有任何警告。
--
-- 修法：
--   1. exam_save_announcement：如果這筆卷「目前」announcement_published=TRUE，
--      不准把標題或內容存成空白（要清空請先「撤下預告文」）。
--   2. exam_push_to_live：如果正式版「目前」announcement_published=TRUE，
--      不准帶一份標題/內容空白的公告過去覆蓋它。
--
-- 部署：Supabase SQL editor 執行，或 supabase db push。

CREATE OR REPLACE FUNCTION public.exam_save_announcement(
  p_paper_id     UUID,
  p_announcement JSONB,
  p_actor_id     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  pr       public.exam_papers%ROWTYPE;
  row_out  public.exam_papers%ROWTYPE;
  new_headline TEXT;
  new_body     TEXT;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;

  new_headline := COALESCE(p_announcement ->> 'headline', '');
  new_body     := COALESCE(p_announcement ->> 'body', '');
  -- 已經發佈中的公告不准存成空白——要清空內容請先按「撤下預告文」。
  IF pr.announcement_published AND (btrim(new_headline) = '' OR btrim(new_body) = '') THEN
    RAISE EXCEPTION 'exam_announcement_would_blank_published';
  END IF;

  UPDATE public.exam_papers SET
    announcement = jsonb_build_object(
      'headline', new_headline,
      'body',     new_body,
      'ctaLabel', COALESCE(p_announcement ->> 'ctaLabel', ''))
  WHERE id = p_paper_id AND status <> 'closed'
  RETURNING * INTO row_out;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_announcement_locked'; END IF;
  RETURN to_jsonb(row_out);
END;
$$;

COMMENT ON FUNCTION public.exam_save_announcement(UUID, JSONB, UUID)
IS '儲存公告內容（標題/內容/按鈕文字）。若這筆卷目前 announcement_published=TRUE，不准把標題或內容存成空白（exam_announcement_would_blank_published）——避免已發佈的公告卡片變成內容空白卻還在顯示；要清空請先「撤下預告文」。';

-- ── 同步到正式版：不准帶一份空白公告去覆蓋「已經發佈給會友看」的正式版公告 ──
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
    -- 防呆 3：正式版公告已經發佈給會友看了 → 不准帶一份空白內容過去覆蓋掉
    IF dst.announcement_published AND (
      COALESCE(btrim(src.announcement ->> 'headline'), '') = ''
      OR COALESCE(btrim(src.announcement ->> 'body'), '') = ''
    ) THEN
      RAISE EXCEPTION 'exam_push_would_blank_announcement';
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
IS '把測試版的題目、試卷設定（含公告 announcement、預告 pre_announcement）整份同步到對應的正式版。announcement_published 是正式版自己的發佈開關，不受同步影響；若正式版公告目前已發佈，同步的內容標題/內容不能是空白（exam_push_would_blank_announcement），避免覆蓋掉已經曝光給會友的公告。正式版一旦有作答或測驗進行中就不能再同步（exam_push_live_has_attempts／exam_push_live_not_closed）。';
