// 計畫分頁右側欄（#plan-sidebar-info-card）只剩「每日陪你靈修」歡迎卡：只在「我的計畫」、
// 且使用者完全沒有計畫時出現（#409），其他時候整欄隱藏，不留空欄。
// 原本同一欄的「全域計畫管理」（系統管理員專屬）已搬到管理後台（#551），管理員也一樣。
export function applyPlanSidebarVisibility({ sidebar, introCard, filter, hasAnyPlan }) {
  if (!sidebar) return;
  const showIntro = filter === "mine" && !hasAnyPlan;
  if (introCard) introCard.classList.toggle("hidden", !showIntro);
  sidebar.classList.toggle("hidden", !showIntro);
}
