// 網址 hash 路由（#370 第 5 批）：讓網址反映目前畫面，重新整理、VersionWatcher 重新載入、
// 通知或分享連結都能直接開到同一個畫面。
//
// 只用 replaceState 改目前這一筆紀錄的網址，不另外 push：手機返回鍵仍然走 app.js 的
// popstate（先關彈窗、再關子頁、再回首頁），順序跟以前完全一樣。
//
// 網址格式：
//   （無 hash）              首頁
//   #/bible                  讀經
//   #/plans                  計畫清單
//   #/plan/<key>             計畫詳情（今日進度）
//   #/plan/<key>/<view>      計畫的個人／團體統計／排行（view = personal | stats | ranking）
//   #/profile[/<detail>]     個人頁（detail = exams、badges…）
//   #/admin[/<section>]      管理（section = users、lightning-quiz…）
//   #my-exams                舊連結，等同 #/profile/exams

const TAB_BY_SEGMENT = Object.freeze({
  home: "dashboard-view",
  bible: "reader-view",
  plans: "plan-view",
  plan: "plan-view",
  profile: "profile-view",
  admin: "admin-view"
});

const PLAN_GROUP_VIEWS = Object.freeze(["personal", "stats", "ranking"]);
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_PLAN_KEY_LENGTH = 120;

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (_err) {
    return "";
  }
}

export function parseHashRoute(hash) {
  const raw = String(hash || "");
  if (raw === "#my-exams") return { tab: "profile-view", profileDetail: "exams" };
  if (!raw.startsWith("#/")) return null;

  const segments = raw.slice(2).split("/").filter(Boolean);
  const tab = TAB_BY_SEGMENT[segments[0]];
  if (!tab) return null;
  const route = { tab };

  if (segments[0] === "plan") {
    const planKey = decodeSegment(segments[1] || "");
    if (planKey && planKey.length <= MAX_PLAN_KEY_LENGTH) {
      route.planKey = planKey;
      route.planView = PLAN_GROUP_VIEWS.includes(segments[2]) ? segments[2] : "progress";
    }
  } else if (segments[0] === "profile" && SLUG.test(segments[1] || "")) {
    route.profileDetail = segments[1];
  } else if (segments[0] === "admin" && SLUG.test(segments[1] || "")) {
    route.adminSection = segments[1];
  }
  return route;
}

export function buildHashRoute(route) {
  if (!route || !route.tab) return "";
  switch (route.tab) {
    case "reader-view":
      return "#/bible";
    case "plan-view":
      if (!route.planKey) return "#/plans";
      return `#/plan/${encodeURIComponent(route.planKey)}`
        + (PLAN_GROUP_VIEWS.includes(route.planView) ? `/${route.planView}` : "");
    case "profile-view":
      return route.profileDetail ? `#/profile/${route.profileDetail}` : "#/profile";
    case "admin-view":
      return route.adminSection ? `#/admin/${route.adminSection}` : "#/admin";
    default:
      return "";
  }
}

// 網址裡的計畫 key 優先用 global plan id：同一個計畫對每個會友都一樣，分享連結別人也打得開。
// 自訂的個人計畫沒有 global plan，才用自己那一筆的 id。
export function planRouteKey(plan) {
  if (!plan) return "";
  return String(plan.globalPlanId || plan.id || plan.presetKey || "");
}

export function resolveRoutePlan(key, { activePlans = [], globalPlans = [] } = {}) {
  const wanted = String(key || "");
  if (!wanted) return { plan: null, joined: false };
  const joinedPlans = Array.isArray(activePlans) ? activePlans : [];
  const byGlobal = joinedPlans.find(plan => String(plan.globalPlanId || "") === wanted);
  const joined = byGlobal || joinedPlans.find(plan =>
    String(plan.id || "") === wanted || String(plan.presetKey || "") === wanted);
  if (joined) return { plan: joined, joined: true };
  const global = (Array.isArray(globalPlans) ? globalPlans : []).find(plan =>
    String(plan.id || "") === wanted || String(plan.globalPlanId || "") === wanted);
  return { plan: global || null, joined: false };
}

export function currentRouteFromState({
  currentTab,
  activePlan = null,
  planDetailOpen = false,
  planViewState = "LIST",
  groupSubview = null,
  profileDetailOpen = null,
  adminSection = null
} = {}) {
  const route = { tab: currentTab || "dashboard-view" };
  if (route.tab === "plan-view" && activePlan && planDetailOpen) {
    const planKey = planRouteKey(activePlan);
    if (planKey) {
      route.planKey = planKey;
      route.planView = String(planViewState).toUpperCase() === "GROUP" && PLAN_GROUP_VIEWS.includes(groupSubview)
        ? groupSubview
        : "progress";
    }
  } else if (route.tab === "profile-view" && SLUG.test(profileDetailOpen || "")) {
    route.profileDetail = profileDetailOpen;
  } else if (route.tab === "admin-view" && SLUG.test(adminSection || "")) {
    route.adminSection = adminSection;
  }
  return route;
}

// 還沒登入就點了深連結：登入要跳到 Logto 再回來，回來的網址不帶 hash。
// 先把路由記在 sessionStorage（同一個分頁跳轉後還在），登入完成後再開。
const PENDING_KEY = "pending_hash_route";
const PENDING_TTL_MS = 10 * 60 * 1000;

export function savePendingHashRoute(storage, hash, now = Date.now()) {
  if (!parseHashRoute(hash)) return;
  try {
    storage.setItem(PENDING_KEY, JSON.stringify({ hash: String(hash), at: now }));
  } catch (_err) { /* 無痕模式等存不了就算了 */ }
}

export function takePendingHashRoute(storage, now = Date.now(), { consume = true } = {}) {
  let saved = null;
  try {
    saved = JSON.parse(storage.getItem(PENDING_KEY) || "null");
    if (consume) storage.removeItem(PENDING_KEY);
  } catch (_err) {
    return null;
  }
  if (!saved || typeof saved.hash !== "string" || !(now - Number(saved.at) <= PENDING_TTL_MS)) return null;
  return parseHashRoute(saved.hash);
}

// 把目前畫面寫回網址。enable() 之前完全不寫：開機時畫面還停在首頁，
// 太早寫會把使用者點進來的深連結蓋掉。同一輪的多次 request() 合併成一次。
export function createHashRouteSync({ history, location, readRoute }) {
  let enabled = false;
  let queued = false;

  function writeNow() {
    queued = false;
    if (!enabled) return;
    let route;
    try {
      route = readRoute();
    } catch (err) {
      console.warn("[HashRoute] failed to read the current view:", err);
      return;
    }
    const nextUrl = `${location.pathname}${location.search}${buildHashRoute(route)}`;
    if (nextUrl === `${location.pathname}${location.search}${location.hash}`) return;
    try {
      history.replaceState(history.state, "", nextUrl);
    } catch (err) {
      console.warn("[HashRoute] replaceState failed:", err);
    }
  }

  function request() {
    if (!enabled || queued) return;
    queued = true;
    queueMicrotask(writeNow);
  }

  return {
    request,
    enable() {
      enabled = true;
      request();
    },
    get enabled() {
      return enabled;
    }
  };
}
