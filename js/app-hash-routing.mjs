// app 端的 hash 路由接線（#370 第 5 批）。網址格式與純函式在 modules/hash-route.mjs。
//
// - 開機：網址帶路由（或登入前記下的路由）就直接開到那個畫面。
// - 之後：每次畫面變動（app:route-changed）都用 replaceState 把目前畫面寫回網址，
//   所以重新整理、VersionWatcher 重新載入都會停在同一個畫面。
// - 不 push 任何紀錄：返回鍵仍然走 app.js 的 popstate，順序跟以前一樣。
import { isAppShellVisible } from "./boot-navigation.mjs";
import { adminConsoleSectionUrl } from "./admin-console-link.mjs";
import {
  buildHashRoute,
  createHashRouteSync,
  currentRouteFromState,
  parseHashRoute,
  resolveRoutePlan,
  savePendingHashRoute,
  takePendingHashRoute
} from "./modules/hash-route.mjs";

export const ROUTE_CHANGED_EVENT = "app:route-changed";
const MANAGEMENT_ROLES = ["admin", "pastor", "great_zone_leader", "zone_leader", "group_leader"];

function safeSessionStorage(win) {
  try {
    return win.sessionStorage;
  } catch (_err) {
    return null;
  }
}

export function createAppHashRouting({ win, doc, appRouter, state, loadModule, getLoadedModule, getRole, toast }) {
  const storage = safeSessionStorage(win) || { getItem: () => null, setItem() {}, removeItem() {} };

  const sync = createHashRouteSync({
    history: win.history,
    location: win.location,
    readRoute: () => currentRouteFromState({
      currentTab: appRouter.currentTab,
      activePlan: state.activePlan,
      planDetailOpen: state.planDetailOpen,
      planViewState: win.currentPlanViewState,
      groupSubview: win.PlanPageController?.groupSubview || state.planActiveSubTab,
      profileDetailOpen: state.profileDetailOpen,
      adminSection: getLoadedModule("pastoral")?.getPastoralRouteTab?.() || null
    })
  });

  async function applyPlanRoute(route) {
    if (!route.planKey) {
      state.planDetailOpen = false;
      win.currentPlanViewState = "LIST";
      await appRouter.switchTab("plan-view", { keepPlanDetail: true });
      return;
    }
    await loadModule("plan");
    const { plan, joined } = resolveRoutePlan(route.planKey, {
      activePlans: state.activePlans,
      globalPlans: state.globalPlans
    });
    if (!plan || !joined) {
      state.planDetailOpen = false;
      win.currentPlanViewState = "LIST";
      await appRouter.switchTab("plan-view", { keepPlanDetail: true });
      toast?.("找不到這個計畫，或你還沒加入");
      return;
    }
    const groupView = route.planView && route.planView !== "progress" && joined ? route.planView : null;
    state.activePlan = plan;
    state.planDetailOpen = true;
    state.planActiveSubTab = groupView || "today";
    win.currentPlanViewState = groupView ? "GROUP" : "DETAIL";
    if (groupView && win.PlanPageController) win.PlanPageController.groupSubview = groupView;
    if (typeof win.syncActivePlanContext === "function") win.syncActivePlanContext(plan);
    await appRouter.switchTab("plan-view", { keepPlanDetail: true });
  }

  // 回傳有沒有真的切到畫面（離線閱讀模式不切，讓開機照原本的流程走）。
  async function applyRoute(route) {
    if (!route || state.offlineMode) return false;
    if (route.tab === "plan-view") {
      await applyPlanRoute(route);
    } else if (route.tab === "admin-view") {
      const role = getRole() || "member";
      // 系統管理功能在管理後台（#551）：舊的 #/admin/<系統管理區塊> 讓系統管理員直接開到後台那一區
      const consoleUrl = route.adminSection ? adminConsoleSectionUrl(route.adminSection, { hostname: win.location.hostname }) : null;
      if (consoleUrl && role === "admin") {
        win.location.assign(consoleUrl);
        return true;
      }
      if (!MANAGEMENT_ROLES.includes(role)) {
        await appRouter.switchTab("dashboard-view");
        return true;
      }
      // 管理分頁的四個分頁（總覽／名單／團隊／測驗）；舊的組長區塊名稱對到新分頁
      if (route.adminSection && !consoleUrl) {
        const pastoral = await loadModule("pastoral");
        pastoral?.openPastoralTab?.(route.adminSection);
      }
      await appRouter.switchTab("admin-view");
    } else if (route.tab === "profile-view") {
      await appRouter.switchTab("profile-view");
      if (route.profileDetail && typeof win.openProfileDetail === "function") {
        win.openProfileDetail(route.profileDetail);
      }
    } else {
      await appRouter.switchTab(route.tab);
    }
    return true;
  }

  return {
    // DOMContentLoaded 一開始呼叫，回傳開機要開的路由（網址上的優先，其次是登入前記下的）。
    // 網址上的路由先存進 sessionStorage：開機途中如果跳去 Logto 登入，回來的網址不帶 hash，
    // 下一次開機還拿得到。真正開到畫面時（finishBoot）才清掉。
    captureBootRoute() {
      const fromUrl = parseHashRoute(win.location.hash);
      if (fromUrl) savePendingHashRoute(storage, buildHashRoute(fromUrl) || "#/home");
      return fromUrl || takePendingHashRoute(storage, Date.now(), { consume: false });
    },
    // 開機的第一個畫面畫完後呼叫。登入頁還開著就不動：路由留在 sessionStorage，
    // 登入跳轉回來的那次開機再開。同頁登入完成（app:shell-shown）時資料還沒載完，
    // 不硬開，丟掉路由、從那時起開始同步網址。回傳有沒有開到路由的畫面，沒有的話開機自己畫預設分頁。
    async finishBoot({ userNavigated = false, skipRoute = false } = {}) {
      if (!isAppShellVisible(doc)) {
        win.addEventListener("app:shell-shown", () => {
          takePendingHashRoute(storage);
          sync.enable();
        }, { once: true });
        return false;
      }
      const route = takePendingHashRoute(storage);
      let opened = false;
      if (route && !userNavigated && !skipRoute) {
        try {
          opened = await applyRoute(route);
        } catch (err) {
          console.warn("[HashRoute] failed to open the boot route:", err);
        }
      }
      sync.enable();
      return opened;
    },
    // popstate 收到 state 是 null 的紀錄＝新開的 hash（網址列手打、點了 #/ 連結），不是返回鍵。
    handleFreshNavigation() {
      const route = parseHashRoute(win.location.hash);
      if (!route) return false;
      try {
        win.history.replaceState({ isAppRoot: true }, "", win.location.href);
      } catch (_err) { /* 換不了就照樣開畫面 */ }
      applyRoute(route).catch(err => console.warn("[HashRoute] failed to open the route:", err));
      return true;
    },
    // 頁面內的 <a href="#/...">：直接開畫面，不讓瀏覽器多塞一筆紀錄。
    handleLinkClick(event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target?.closest?.("a[href]");
      if (!link) return;
      const route = parseHashRoute(link.getAttribute("href"));
      if (!route) return;
      event.preventDefault();
      applyRoute(route).catch(err => console.warn("[HashRoute] failed to open the link:", err));
    },
    applyRoute,
    requestSync: () => sync.request()
  };
}
