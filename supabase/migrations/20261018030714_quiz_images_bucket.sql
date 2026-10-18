-- ============================================================================
-- 20261018030714_quiz_images_bucket.sql  —  #585 雲柱測驗題目附圖上傳
-- ============================================================================
-- 後台編輯題目時可以直接上傳圖片：admin-api（service role）寫進這個 bucket，
-- 題目 payload.image.src 存公開網址 …/storage/v1/object/public/quiz-images/<uuid>.<ext>。
--
-- · public = true：會友端直接用公開網址載入（不經簽章）。檔名是隨機 UUID，拿不到題目就猜不到網址。
-- · 不建任何 storage.objects 的 policy：anon／authenticated 不能列出、上傳、改或刪；
--   只有 service role（admin-api）能寫。公開讀取走 /object/public/，不需要 policy。
-- · 大小、格式在這裡再擋一次（admin-api 也會先擋、並檢查檔頭）。
-- 不依賴其他 migration。
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('quiz-images', 'quiz-images', true, 716800,
        ARRAY['image/webp','image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
