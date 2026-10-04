-- ============================================================================
-- 20261004165112_passage_commentary.sql  —  #447 閱讀器「經文注釋」
--
-- 管理員按「書卷＋章」寫的經文解釋，會友在聖經閱讀器（js/modules/bible.js）
-- 點工具列的注釋按鈕才看得到。一章最多一則，所以 (book, chapter) 唯一。
--
-- - book 存繁中書名，跟 BIBLE_BOOKS[].name、reading_logs.book、verse_notes.book
--   一樣，閱讀器直接用目前開的書卷＋章查。
-- - topic_tags 存主題代碼（例如 'tabernacle'），對應的輔助圖片由前端固定圖庫
--   js/data/passage-commentary.mjs 決定（assets/commentary/），資料庫不存圖片。
-- - 會友只讀得到 is_published = TRUE；寫入只有系統管理員（admin）。正式環境
--   走 nlc-data（service role，RLS 不作用），同樣的規則在 nlc-data 的
--   applyForcedScope／ADMIN_ONLY_WRITE_TABLES 再做一次；這裡的 RLS 給開發用的
--   Supabase 直連登入。
--
-- 沒有新增 function。全部是新增，舊版程式不會呼叫，不需要 forceUpdateBuiltBefore。
-- 部署順序：先跑這支 migration，再部署 nlc-data（新版 nlc-data 才認得這張表）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.passage_commentary (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  book TEXT NOT NULL CHECK (btrim(book) <> ''),
  chapter INTEGER NOT NULL CHECK (chapter > 0),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL CHECK (btrim(content) <> ''),
  topic_tags TEXT[] NOT NULL DEFAULT '{}',
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book, chapter)
);

DROP TRIGGER IF EXISTS trg_passage_commentary_updated_at ON public.passage_commentary;
CREATE TRIGGER trg_passage_commentary_updated_at
  BEFORE UPDATE ON public.passage_commentary
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.passage_commentary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS passage_commentary_read_published ON public.passage_commentary;
CREATE POLICY passage_commentary_read_published ON public.passage_commentary
  FOR SELECT TO authenticated
  USING (is_published = TRUE OR public.current_role_code() = 'admin');

DROP POLICY IF EXISTS passage_commentary_manage_admin ON public.passage_commentary;
CREATE POLICY passage_commentary_manage_admin ON public.passage_commentary
  FOR ALL TO authenticated
  USING (public.current_role_code() = 'admin')
  WITH CHECK (public.current_role_code() = 'admin');

REVOKE ALL ON TABLE public.passage_commentary FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passage_commentary TO authenticated;
GRANT ALL ON TABLE public.passage_commentary TO service_role;
