// 「...」選單的退出／刪除按鈕（#473）：個人計畫是本人的，顯示「刪除此計畫」＋垃圾桶；
// 其他計畫維持「退出此計畫」＋登出圖示。用 class 找文字與圖示——不要用
// span:last-child，它會先比對到 .menu-icon 裡唯一的圖示 span，把字塞進圖示欄。
export function applyDeletePlanButtonKind(btn, personal, renderIcon) {
  if (!btn) return;
  const label = btn.querySelector(".delete-plan-label");
  if (label) label.textContent = personal ? "刪除此計畫" : "退出此計畫";
  const icon = btn.querySelector(".menu-icon .nlc-icon");
  const key = personal ? "trash" : "logout";
  if (icon && icon.getAttribute("data-icon") !== key) {
    icon.setAttribute("data-icon", key);
    if (typeof renderIcon === "function") icon.innerHTML = renderIcon(key, { element: icon });
  }
}
