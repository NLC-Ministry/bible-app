-- 0198_exam_test_announcement_preview.sql
--
-- 架構維持不變（測試版／正式版仍是兩份獨立的 exam_papers），但測試版也要能
-- 測試預告文內容：讓管理員在測試版把標題/內容/按鈕文字寫好、按「發佈預告文」
-- 預覽實際上首頁會長什麼樣子，而不是只能盯著編輯表單想像。
--
-- 為什麼這樣改是安全的：exam_home_exams／exam_home_banner（首頁預告卡片來源）
-- 從 0112 就是 `announcement_published = TRUE AND (mode = 'live' OR is_staff)`——
-- 一般會友那個 OR 分支永遠是 FALSE，不管 mode='test' 的 announcement_published
-- 是不是 TRUE，都不會出現在一般會友的首頁；只有 admin/pastor 自己看得到。
-- exam_my_papers（我的測驗）維持 mode='live' 專用，不受這次改動影響（測試版
-- 本來就不該出現在「我的測驗」歷史列表）。
--
-- 這裡唯一要拿掉的限制：exam_publish_announcement 原本擋死
-- `mode <> 'live' → exam_announcement_live_only`（0131 加的），現在讓測試版
-- 也能呼叫同一支函式發佈/微調——存草稿的 exam_save_announcement、撤下的
-- exam_unpublish_announcement 本來就沒有這個限制，這裡補齊讓三支函式行為一致。
--
-- 部署：Supabase SQL editor 執行，或 supabase db push。

CREATE OR REPLACE FUNCTION public.exam_publish_announcement(p_paper_id UUID, p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  pr       public.exam_papers%ROWTYPE;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
  IF pr.status = 'closed' THEN RAISE EXCEPTION 'exam_announcement_locked'; END IF;
  IF pr.announcement_published THEN RAISE EXCEPTION 'exam_announcement_already_published'; END IF;
  IF COALESCE(btrim(pr.announcement ->> 'headline'), '') = ''
     OR COALESCE(btrim(pr.announcement ->> 'body'), '') = '' THEN
    RAISE EXCEPTION 'exam_announcement_incomplete';
  END IF;
  IF pr.open_at IS NULL OR pr.close_at IS NULL OR pr.close_at <= pr.open_at THEN
    RAISE EXCEPTION 'exam_window_invalid';
  END IF;

  UPDATE public.exam_papers
  SET announcement_published = TRUE, announced_at = NOW(), announced_by = actor_id
  WHERE id = pr.id;

  RETURN jsonb_build_object('paperId', pr.id, 'announcementPublished', TRUE);
END;
$$;

COMMENT ON FUNCTION public.exam_publish_announcement(UUID, UUID)
IS '發佈預告文（不分 mode，測試版與正式版都能發）。測試版的 announcement_published=TRUE 只讓 admin/pastor 自己在首頁預覽看得到——exam_home_exams/exam_home_banner 的 (mode=''live'' OR is_staff) 判斷擋住一般會友，不會外流。';
