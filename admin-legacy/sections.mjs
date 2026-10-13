// 後台「照搬」進來的舊管理區塊（#550）。id 就是 App 管理分頁（js/modules/admin.js ADMIN_SECTIONS）的 id，
// 打開時直接交給 admin.js 的 openAdminSectionRoute()，畫面與程式都是 App 那一份。
// 後台外殼（admin/src/legacy.ts）與 admin-api（policy.ts 的 LEGACY_EXPORT_SECTIONS）各有一份同樣的清單，
// scripts/admin-legacy.test.mjs 檢查三邊一致。
// #565：加入計畫狀況、組員總覽、計畫統計由後台「計畫」區的總覽／名單取代，不再照搬；計畫管理（plans）是計畫區的「計畫設定」。
export const LEGACY_SECTION_IDS = Object.freeze([
  "announcements",
  "commentary",
  "quizzes",
  "exam",
  "lightning-quiz",
  "plans",
  "teams",
  "reading-activity",
  "registrations",
  "settings"
]);

// 不在 App 管理分頁、在 App 別的分頁的管理卡片：iframe 開機時建一個同樣格式的區塊面板
// （admin-section-<id>），把這張卡片（DOM id）搬進去。
//   plans：讀經計畫分頁側欄的「全域計畫管理」（js/modules/plan-admin.js，含大區延後梯次、編輯活動規則）
export const LEGACY_HOSTED_CARDS = Object.freeze({
  plans: "admin-plan-card"
});

/** 這一區在 index.html 一定要有的元素 id（建置時檢查）：一般是管理分頁的區塊面板，搬進來的就是那張卡片。 */
export function legacyMarkupId(id) {
  return Object.hasOwn(LEGACY_HOSTED_CARDS, id) ? LEGACY_HOSTED_CARDS[id] : `admin-section-${id}`;
}
