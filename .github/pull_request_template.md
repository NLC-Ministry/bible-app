<!--
上線 PR（staging → main）。在 staging 確認沒問題後按 merge，就會上線到正式網站。
流程見 docs/staging.md「上線到正式環境」。
-->

## 這次上線改了什麼
<!-- 用一兩句白話寫：會友或管理員會看到什麼不一樣 -->
-

## 按 merge 之前，請在 staging 網站確認
staging 網站：https://bible-speed-reading-staging.vercel.app

<!-- 每一項寫成「打開哪個頁面 → 應該看到什麼」 -->
- [ ] 打開 ______ → 應該看到 ______
- [ ] 首頁、讀經、計畫都能正常打開

**確認沒問題 → 按下方的 Merge（選「Create a merge commit」）→ 就會上線。**
有問題就先不要 merge，告訴開發者要改什麼。

---
<details>
<summary>開發者用（上線前後的技術步驟）</summary>

- 資料庫要更新的項目（正式環境 `db push --dry-run` 的結果）：<!-- 沒有就寫「無」 -->
- 要重新部署的 Edge Function：<!-- 沒有就寫「無」 -->
- 舊版前端會壞掉的改動（要設 `release-policy.json` 的 `forceUpdateBuiltBefore`）：<!-- 沒有就寫「無」 -->
- merge 後：正式環境 `npx supabase db push --linked --project-ref ztozevcqkfrohgjmngcj`、部署 Edge Function、確認正式網站已更新、`node scripts/compare-env-snapshots.mjs --run`
</details>
