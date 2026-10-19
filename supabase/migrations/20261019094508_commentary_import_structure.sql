-- ============================================================================
-- 20261019094508_commentary_import_structure.sql  —  #542 經文注釋匯入流程 2.0
--
-- passage_commentary 加匯入工具（scripts/commentary-import/）產生的結構化資料，全部是新增欄位：
-- - chapter_end／chapter_end_verse：跨章範圍的結束章與結束節（例如「1:1–7:38 總覽」= 1:1 起、
--   7 章 38 節止）。verse_start／verse_end 照舊是掛在起始章的位置（verse_end = verse_start），
--   舊版前端看到的跟以前一樣；新版前端在整段的每一章都顯示。
-- - cross_refs：譯文裡的經文出處 [{ book, chapter, verse, chapter_end, verse_end, label, note?, end_book? }]。
--   label 是譯文裡的寫法（「出27:21」「5:17-19」「第16章」），閱讀器找到就做成可點的連結；
--   note = TRUE 表示原文是「see study note on …」（見…的注釋）。整章出處的 verse 是 NULL。
-- - excerpts：被解釋的經文片語 [{ en, zh, chapter, verse, heading }]。zh 是和合本字句，面板裡加粗，
--   並在引用的經文中標出。
-- - source_version／source_hash：TOSN 版本（例如 'TOSN 1.25'）與每則原文的指紋（sha256），
--   TOSN 改版時只重翻指紋變了的。
-- 後台手寫的注釋不用這些欄位（預設 NULL／空陣列／空字串）。
--
-- 另外：
-- - 檢視表 commentary_chapter_index 加上跨章注釋涵蓋的每一章（欄位不變，只多列）。
-- - _commentary_review_item_json（我的審核、後台審核回傳的一則）加新欄位，審核頁能顯示跨章範圍
--   與要保留的出處寫法。
--
-- 全部是新增：舊版前端不會選這些欄位，不需要 forceUpdateBuiltBefore。
-- 依賴 20261009092820_commentary_review.sql（#471）。
-- 部署順序：先跑這支 migration，再部署前端（新版閱讀器會 select 這些欄位，欄位不存在會查不到注釋）。
-- 已匯入的利未記另外用 node scripts/commentary-import/build-sql.mjs --structure 產生的 SQL 補結構
-- （只更新新欄位，不動譯文與審核狀態），見 docs/commentary-import.md。
-- ============================================================================

ALTER TABLE public.passage_commentary
  ADD COLUMN IF NOT EXISTS chapter_end INTEGER,
  ADD COLUMN IF NOT EXISTS chapter_end_verse INTEGER,
  ADD COLUMN IF NOT EXISTS cross_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS excerpts JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_version TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_hash TEXT NOT NULL DEFAULT '';

-- 跨章只用在節注釋：結束章一定在起始章之後，而且要有結束節。
ALTER TABLE public.passage_commentary DROP CONSTRAINT IF EXISTS passage_commentary_chapter_end_check;
ALTER TABLE public.passage_commentary ADD CONSTRAINT passage_commentary_chapter_end_check CHECK (
  (chapter_end IS NULL AND chapter_end_verse IS NULL)
  OR (verse_start IS NOT NULL AND chapter_end > chapter AND chapter_end_verse > 0)
);

ALTER TABLE public.passage_commentary DROP CONSTRAINT IF EXISTS passage_commentary_structure_arrays_check;
ALTER TABLE public.passage_commentary ADD CONSTRAINT passage_commentary_structure_arrays_check CHECK (
  jsonb_typeof(cross_refs) = 'array' AND jsonb_typeof(excerpts) = 'array'
);

-- 閱讀器查某一章時要帶出從前面的章延續過來的跨章注釋（chapter < n AND chapter_end >= n）。
CREATE INDEX IF NOT EXISTS passage_commentary_cross_chapter_idx
  ON public.passage_commentary (book, chapter, chapter_end)
  WHERE chapter_end IS NOT NULL;

-- ── commentary_chapter_index：跨章注釋涵蓋的每一章都列出來 ──────────────────
CREATE OR REPLACE VIEW public.commentary_chapter_index
WITH (security_invoker = true) AS
  SELECT book, chapter FROM public.passage_commentary WHERE is_published = TRUE
  UNION
  SELECT c.book, spanned.chapter
  FROM public.passage_commentary c
  CROSS JOIN LATERAL generate_series(c.chapter + 1, c.chapter_end) AS spanned(chapter)
  WHERE c.is_published = TRUE AND c.chapter_end IS NOT NULL
  UNION
  SELECT book, chapter FROM public.commentary_terms WHERE is_published = TRUE;

REVOKE ALL ON TABLE public.commentary_chapter_index FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.commentary_chapter_index TO authenticated, service_role;

-- ── 審核頁、後台總覽回傳的一則注釋：加新欄位 ─────────────────────────────
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
    'chapter_end', c.chapter_end,
    'chapter_end_verse', c.chapter_end_verse,
    'title', c.title,
    'content', c.content,
    'topic_tags', c.topic_tags,
    'source', c.source,
    'source_text', c.source_text,
    'source_version', c.source_version,
    'cross_refs', c.cross_refs,
    'excerpts', c.excerpts,
    'review_status', c.review_status,
    'review_note', c.review_note,
    'reviewed_at', c.reviewed_at,
    'reviewed_by_name', (SELECT COALESCE(p.name, '') FROM public.profiles p WHERE p.id = c.reviewed_by),
    'updated_at', c.updated_at
  );
$$;
REVOKE ALL ON FUNCTION public._commentary_review_item_json(public.passage_commentary) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._commentary_review_item_json(public.passage_commentary) TO service_role;
