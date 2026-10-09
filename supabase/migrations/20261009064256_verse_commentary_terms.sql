-- ============================================================================
-- 20261009064256_verse_commentary_terms.sql  —  #470 逐節注釋＋詞條
--
-- 擴充 #447 的 passage_commentary：
-- - passage_commentary 加 verse_start／verse_end：兩個都 NULL＝整章注釋（#447 原本的那種，
--   一章仍最多一則）；有值＝節注釋（例如 26:1-5），同一章可以有很多則。
-- - 新表 commentary_terms（詞條）：詞、其他寫法、短解釋、主題圖。範圍三種：
--     整卷：chapter、verse_start、verse_end 都 NULL
--     整章：chapter 有值、verse_* NULL
--     指定節：chapter、verse_start、verse_end 都有值
--   整卷／整章的詞條只套用在經文裡真的出現這個詞（或其他寫法）的節，由前端比對；
--   指定節的詞條不比對文字，直接掛在那幾節。
-- - source：出處／授權標示（例如開放授權資料的來源），閱讀器面板會顯示。#471 匯入時用。
-- - 檢視表 commentary_chapter_index：閱讀器換章前只查這份「哪些章（或整卷）有內容」，
--   有才抓那一章的資料。security_invoker：照呼叫者的權限讀底下兩張表。
--
-- 權限同 #447：會友只讀已發布，寫入只有系統管理員。正式環境走 nlc-data（service role，
-- RLS 不作用），同樣規則在 nlc-data 的 applyForcedScope／ADMIN_ONLY_WRITE_TABLES 再做一次。
--
-- 沒有新增 function。全部是新增或放寬（拿掉一章一則的限制），不需要 forceUpdateBuiltBefore：
-- 舊版前端只認得整章注釋，管理員開始加節注釋之前，舊版早就自動更新了。
-- 部署順序：先跑這支 migration，再部署 nlc-data（新版 nlc-data 才認得新表和檢視表）。
-- ============================================================================

-- ── passage_commentary：加節範圍與出處 ────────────────────────────────
ALTER TABLE public.passage_commentary
  ADD COLUMN IF NOT EXISTS verse_start INTEGER,
  ADD COLUMN IF NOT EXISTS verse_end INTEGER,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '';

ALTER TABLE public.passage_commentary DROP CONSTRAINT IF EXISTS passage_commentary_verse_range_check;
ALTER TABLE public.passage_commentary ADD CONSTRAINT passage_commentary_verse_range_check CHECK (
  (verse_start IS NULL AND verse_end IS NULL)
  OR (verse_start > 0 AND verse_end >= verse_start)
);

-- 原本的 UNIQUE (book, chapter) 擋掉同一章的節注釋：拿掉，改成兩個部分唯一索引。
ALTER TABLE public.passage_commentary DROP CONSTRAINT IF EXISTS passage_commentary_book_chapter_key;

CREATE UNIQUE INDEX IF NOT EXISTS passage_commentary_chapter_note_key
  ON public.passage_commentary (book, chapter)
  WHERE verse_start IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS passage_commentary_verse_note_key
  ON public.passage_commentary (book, chapter, verse_start, verse_end)
  WHERE verse_start IS NOT NULL;

-- ── commentary_terms：詞條 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.commentary_terms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  term TEXT NOT NULL CHECK (btrim(term) <> ''),
  aliases TEXT[] NOT NULL DEFAULT '{}',
  definition TEXT NOT NULL CHECK (btrim(definition) <> ''),
  topic_tags TEXT[] NOT NULL DEFAULT '{}',
  book TEXT NOT NULL CHECK (btrim(book) <> ''),
  chapter INTEGER CHECK (chapter > 0),
  verse_start INTEGER,
  verse_end INTEGER,
  source TEXT NOT NULL DEFAULT '',
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commentary_terms_scope_check CHECK (
    (verse_start IS NULL AND verse_end IS NULL)
    OR (chapter IS NOT NULL AND verse_start > 0 AND verse_end >= verse_start)
  )
);

CREATE INDEX IF NOT EXISTS commentary_terms_book_idx ON public.commentary_terms (book);

DROP TRIGGER IF EXISTS trg_commentary_terms_updated_at ON public.commentary_terms;
CREATE TRIGGER trg_commentary_terms_updated_at
  BEFORE UPDATE ON public.commentary_terms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.commentary_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commentary_terms_read_published ON public.commentary_terms;
CREATE POLICY commentary_terms_read_published ON public.commentary_terms
  FOR SELECT TO authenticated
  USING (is_published = TRUE OR public.current_role_code() = 'admin');

DROP POLICY IF EXISTS commentary_terms_manage_admin ON public.commentary_terms;
CREATE POLICY commentary_terms_manage_admin ON public.commentary_terms
  FOR ALL TO authenticated
  USING (public.current_role_code() = 'admin')
  WITH CHECK (public.current_role_code() = 'admin');

REVOKE ALL ON TABLE public.commentary_terms FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.commentary_terms TO authenticated;
GRANT ALL ON TABLE public.commentary_terms TO service_role;

-- ── commentary_chapter_index：哪些章有內容 ──────────────────────────────
-- 每列一個 (book, chapter)；chapter IS NULL＝這卷書有整卷詞條。只看已發布的內容。
CREATE OR REPLACE VIEW public.commentary_chapter_index
WITH (security_invoker = true) AS
  SELECT book, chapter FROM public.passage_commentary WHERE is_published = TRUE
  UNION
  SELECT book, chapter FROM public.commentary_terms WHERE is_published = TRUE;

REVOKE ALL ON TABLE public.commentary_chapter_index FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.commentary_chapter_index TO authenticated, service_role;
