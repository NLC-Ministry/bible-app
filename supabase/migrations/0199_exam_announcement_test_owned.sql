-- 0199_exam_announcement_test_owned.sql
--
-- 預告文的「內容編輯」全部拉回測試版處理，正式版不再獨立編輯內容：
--   · 測試版：標題/內容/按鈕文字在「試卷設定」的「公告設定」區塊編輯
--     （UI 端改動，這裡不用管），可以自己「發佈/撤下」做 staff-only 預覽
--     （0198 已經開放，這份不動它）。
--   · 正式版：只保留「發佈/撤下」這個動作（讓內容真的曝光給全體會友），
--     不再能自己編輯文字內容——內容一律由「同步到正式版」
--     （exam_push_to_live）從測試版帶過來。
--
-- 這份只改一件事：exam_push_to_live 的「更新既有正式版」分支，把
-- announcement 加進同步欄位（原本只有「第一次建立」才會帶，之後永遠不覆蓋，
-- 改成每次同步都覆蓋，跟 title/sections/pledge 等其他欄位待遇一致）。
-- announcement_published（正式版自己的發佈開關）跟 status 一樣不受影響——
-- push 只換內容，正式版何時真的公布出去仍由管理員自己按「發佈預告文」決定。
--
-- 沒改動的既有防呆照舊有效：正式版一旦有人作答就不能再推
-- （exam_push_live_has_attempts）；正式版測驗進行中要先關閉才能推
-- （exam_push_live_not_closed）——這兩個防呆本來是為了保護題目 id 不被換掉，
-- 現在連預告文文字修正也一併受這兩個防呆保護，這是刻意的：正式測驗進行中
-- 就不該再動這份卷的任何內容，要修改請先「關閉測驗」。
--
-- 部署：Supabase SQL editor 執行，或 supabase db push。

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
      announcement, announcement_published, linked_plan_id, pushed_from_id, created_by)
    VALUES (
      src.title, src.description, 'live', 'draft', src.open_at, src.close_at,
      src.duration_minutes, src.total_points, src.pledge, src.sections, src.section_targets,
      src.announcement, FALSE, src.linked_plan_id, src.id, actor_id)
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
IS '把測試版的題目、試卷設定（含公告內容 announcement）整份同步到對應的正式版。announcement_published 是正式版自己的發佈開關，不受同步影響。正式版一旦有作答或測驗進行中就不能再同步（exam_push_live_has_attempts／exam_push_live_not_closed），要改內容（含預告文文字）一律先在測試版改好、視需要先關閉正式版測驗，再同步過去。';
