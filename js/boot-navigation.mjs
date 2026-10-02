// 啟動／背景載入與分頁導覽之間的協調規則（#388、#389）。

/**
 * 資料載完之後該停在哪個分頁。
 *
 * 載入期間分頁列已經可以點：使用者自己切過分頁（router 的導覽號碼變了），
 * 就停在他目前的分頁、只把資料重畫上去；沒切過才去 landingTab（啟動時的
 * 首頁／續讀的計畫／快速啟動的讀經）。以前一律切到 landingTab，使用者會在
 * 資料載完時被拉回首頁（#388）。
 */
export function resolvePostLoadTab({ landingTab, navGenAtStart, navGenNow, currentTab }) {
  const userNavigated = navGenNow !== navGenAtStart;
  if (!userNavigated && landingTab) return landingTab;
  return currentTab || landingTab || "dashboard-view";
}

/**
 * App 主畫面是否正顯示（登入頁沒開著）。
 *
 * iOS 左緣右滑的「上一頁」預覽，是在 pushState 離開那筆紀錄的當下拍的截圖；
 * 登入頁還開著時塞紀錄，之後每次右滑預覽都會是登入頁（#389）。
 */
export function isAppShellVisible(doc) {
  if (!doc) return false;
  const loginGate = doc.getElementById("login-gate");
  if (loginGate && !loginGate.classList.contains("hidden")) return false;
  const appLayout = doc.querySelector(".app-layout");
  return !appLayout || !appLayout.classList.contains("hidden");
}
