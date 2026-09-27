// 計畫分頁右側欄（#plan-sidebar-info-card）裡有兩張卡：「每日陪你靈修」歡迎卡
// 和「全域計畫管理」（系統管理員專屬）。歡迎卡只在使用者完全沒有計畫時顯示；
// 管理卡不能跟著它一起消失——曾經整欄一起藏，管理員加入任何計畫後就找不到
// 新增計畫的入口（2026-09-27）。
//
// - 「已結束」分頁：整欄隱藏（原本行為）。
// - 其他分頁：歡迎卡依 hasAnyPlan 切換；整欄只在兩張卡都不顯示時才隱藏。
//   管理卡本身的 hidden 由角色判斷的程式（renderPlanView / updateAdminNavVisibility）
//   負責，這裡只用 isSystemAdmin 決定整欄要不要留著，不依賴管理卡目前的 class，
//   避免兩邊執行順序不同時算錯。
export function applyPlanSidebarVisibility({ sidebar, introCard, filter, hasAnyPlan, isSystemAdmin }) {
  if (!sidebar) return;
  if (filter === "completed") {
    sidebar.classList.add("hidden");
    return;
  }
  const showIntro = !hasAnyPlan;
  if (introCard) introCard.classList.toggle("hidden", !showIntro);
  sidebar.classList.toggle("hidden", !showIntro && !isSystemAdmin);
}
