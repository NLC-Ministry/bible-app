-- ============================================================================
-- 20260926141025_profiles_no_demo.sql  —  #261（D1）
--
-- profiles.is_demo 用來標記示範帳號。2026-09-25 確認正式環境 1,217 個帳號全部
-- 是 false，nlc-session 建立帳號時也一律寫 false，程式裡沒有任何地方寫 true。
-- 現在測試都在 staging 做（樣本資料一樣是 false），正式環境不該再出現示範帳號，
-- 所以用 CHECK 在資料庫層擋下。
--
-- 欄位本身先保留：排行榜、統計等 9 個函式還有 `is_demo = FALSE` 的條件，
-- 加了這個限制後那些條件永遠成立，移除欄位是 #263（backlog）。
--
-- 冪等：可以重複執行。
-- ============================================================================

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_no_demo;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_no_demo CHECK (is_demo = false);

COMMENT ON CONSTRAINT profiles_no_demo ON public.profiles IS
  'Demo accounts are not allowed; testing happens on the staging project (#261).';
