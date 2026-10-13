// App → 後台（#555）的固定連結。後台網址寫死，不從網頁內容推算；
// 正式站的 App 連正式後台，其他（staging、本機）連 staging 後台。
export const ADMIN_CONSOLE_URL = {
  production: "https://bible-speed-reading-admin.vercel.app",
  staging: "https://bible-speed-reading-admin-staging.vercel.app"
};

const PRODUCTION_HOSTS = new Set(["bible.newlife.org.tw"]);

export function adminConsoleBase(hostname) {
  return PRODUCTION_HOSTS.has(String(hostname || "")) ? ADMIN_CONSOLE_URL.production : ADMIN_CONSOLE_URL.staging;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 後台「使用者查詢」直接打開某人；reason 會記進後台的查看稽核。不是合法 id 就回 null。 */
export function adminConsoleUserUrl(userId, { reason = "", hostname = globalThis.location?.hostname } = {}) {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) return null;
  const trimmed = String(reason || "").trim().slice(0, 200);
  const query = trimmed ? `?${new URLSearchParams({ reason: trimmed })}` : "";
  return `${adminConsoleBase(hostname)}/#/support/user/${userId.toLowerCase()}${query}`;
}

// 舊的 App 管理分頁區塊（#/admin/<區塊>）→ 後台的位置（#551：系統管理功能都在後台）。
// 組長區塊（加入計畫狀況、組員、組隊、統計、小測驗、大測驗）留在 App 的管理分頁，不在這裡。
export const ADMIN_CONSOLE_SECTION_ROUTES = Object.freeze({
  users: "#/accounts",
  permissions: "#/accounts/scopes",
  reports: "#/support",
  registrations: "#/operations/registrations",
  "reading-activity": "#/operations/reading-activity",
  plans: "#/operations/plans",
  announcements: "#/content/announcements",
  commentary: "#/content/commentary",
  "lightning-quiz": "#/content/lightning-quiz",
  settings: "#/system/settings"
});

/** 後台某個區塊的網址；不是後台的區塊回 null。 */
export function adminConsoleSectionUrl(section, { hostname = globalThis.location?.hostname } = {}) {
  const route = Object.hasOwn(ADMIN_CONSOLE_SECTION_ROUTES, String(section || "")) ? ADMIN_CONSOLE_SECTION_ROUTES[section] : null;
  return route ? `${adminConsoleBase(hostname)}/${route}` : null;
}
