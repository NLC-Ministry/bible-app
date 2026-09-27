<!--
上線 PR（staging → main）。流程見 docs/staging.md「上線到正式環境」。
緊急修正（hotfix/* → main）也用這份清單，staging 那幾項改成在本機或正式環境確認。
-->

## 這次上線的內容
<!-- 列出這次要上線的改動、對應的 issue -->
-

## 上線前：在 staging 確認（全部打勾後再貼 `staging-verified` 標籤）
- [ ] CI 的 `build-and-test` 通過
- [ ] staging 網站（https://bible-speed-reading-staging.vercel.app）已經是這次的版本（`staging` 分支最新一次部署成功）
- [ ] 在 staging 實際操作過這次改到的功能：<!-- 寫下操作了哪些 -->
- [ ] 會友常用的功能沒有被影響：首頁、讀經打卡、計畫、小測驗
- [ ] 這次有 migration 的話，已經推到 staging：`npx supabase db push --linked --project-ref vzokpsscyivhgmhleplq`
- [ ] 正式環境要套用的 migration（`npx supabase db push --linked --project-ref ztozevcqkfrohgjmngcj --dry-run` 的結果）：<!-- 沒有就寫「無」 -->
- [ ] migration 的檔頭有沒有寫上線順序要求（例如要先設定 Vault / secret）：<!-- 沒有就寫「無」 -->
- [ ] 要重新部署的 Edge Function：<!-- 沒有就寫「無」 -->
- [ ] 資料庫結構有「舊版前端會壞掉」的改動嗎？有的話要設定 `release-policy.json` 的 `forceUpdateBuiltBefore`

**確認完，把這個 PR 貼上 `staging-verified` 標籤**，`release-gate` 才會變綠燈。沒有這個標籤，就算 merge 了也不會部署到正式環境。

## 上線（merge 之後，依序）
- [ ] 用 **Create a merge commit** merge（不要用 squash）
- [ ] 正式環境套用 migration：`npx supabase db push --linked --project-ref ztozevcqkfrohgjmngcj`
- [ ] 重新部署上面列出的 Edge Function
- [ ] CI 的 deploy 成功，正式網站（https://bible.newlife.org.tw）已經是新版本
- [ ] 在正式環境快速確認這次改到的功能
- [ ] `node scripts/compare-env-snapshots.mjs --run`：兩個環境仍然一致
