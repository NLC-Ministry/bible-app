// 計畫分頁右側欄（#plan-sidebar-info-card）裡有兩張卡：「每日陪你靈修」歡迎卡
// 和「全域計畫管理」（系統管理員專屬）。曾經整欄一起藏，管理員加入任何計畫後
// 就找不到新增計畫的入口（2026-09-27），所以整欄要看兩張卡各自的條件。
//
// 每張卡只在一個分頁出現（#409）：
// - 歡迎卡：只在「我的計畫」，且使用者完全沒有計畫時。
// - 管理卡：只在「探索計畫」。卡本身的 hidden 由角色判斷的程式
//   （renderPlanView / updateAdminNavVisibility）負責，分頁條件交給 CSS 讀
//   #plan-list-subview[data-active-filter]；這裡只用 isSystemAdmin 決定整欄要不要
//   留著，不依賴管理卡目前的 class，避免兩邊執行順序不同時算錯。
// - 「已結束」分頁：整欄隱藏。
export function applyPlanSidebarVisibility({ sidebar, introCard, filter, hasAnyPlan, isSystemAdmin }) {
  if (!sidebar) return;
  const showIntro = filter === "mine" && !hasAnyPlan;
  const showAdmin = filter === "saved" && isSystemAdmin;
  if (introCard) introCard.classList.toggle("hidden", !showIntro);
  sidebar.classList.toggle("hidden", !showIntro && !showAdmin);
}
