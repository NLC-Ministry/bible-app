// 後台「照搬」進來的舊管理區塊（#550）。id 就是 App 管理分頁（js/modules/admin.js ADMIN_SECTIONS）的 id，
// 打開時直接交給 admin.js 的 openAdminSectionRoute()，畫面與程式都是 App 那一份。
// 後台外殼（admin/src/legacy.ts）與 admin-api（policy.ts 的 LEGACY_EXPORT_SECTIONS）各有一份同樣的清單，
// scripts/admin-legacy.test.mjs 檢查三邊一致。
export const LEGACY_SECTION_IDS = Object.freeze([
  "announcements",
  "commentary",
  "quizzes",
  "exam",
  "lightning-quiz"
]);
