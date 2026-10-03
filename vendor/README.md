# vendor/

第三方程式的固定版本，原封不動保存，由 `scripts/bundle.mjs` 在建置時以內容雜湊檔名發佈到同網域（#418）。

## supabase-js

- `supabase-js/<版本>/supabase.js`：`@supabase/supabase-js` 的 UMD 檔（`dist/umd/supabase.js`，也就是 jsdelivr 對 `@supabase/supabase-js@<版本>` 預設提供的檔案），授權見同資料夾 `LICENSE`（MIT）。
- 版本以 `index.html`／`exam.html`／`grade.html` 裡的 CDN 標籤為準。建置時把那個標籤換成同網域的 `/supabase.<hash>.js`；三頁版本不一致，或 vendor 裡沒有那個版本的檔案，建置會直接失敗。
- 換版本：
  ```bash
  npm pack @supabase/supabase-js@<版本>      # 會驗證 registry 的完整性雜湊
  tar -xzf supabase-supabase-js-<版本>.tgz
  # 複製 package/dist/umd/supabase.js 與 package/LICENSE 到 vendor/supabase-js/<版本>/
  ```
  再把三個 HTML 的 CDN 標籤改成同一個版本號。
- 它必須留在關鍵路徑、同步載入：真的 Supabase client 是 Logto session 失效時讀公開表的退路（2026-09-06 改成延後載入曾讓正式站整頁黑）。
