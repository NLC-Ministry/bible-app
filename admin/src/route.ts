// 後台網址（hash）格式（#555）。純函式，測試直接測。
//
//   #/  或 #/home                            首頁（#569：今天要處理的事，只有數字）
//   #/support                                回報收件匣（#550）
//   #/support/report/<uuid>                  收件匣＋打開這張回報
//   #/people                                 「人」區：名單與查詢（#567，原本的使用者查詢＋使用者名單）
//   #/people/user/<uuid>[?reason=…]          某個人（可以直接用網址連過來；reason 是查看理由，會記進稽核）
//   #/people/scopes[/<uuid>]                 管理範圍（權限總覽＋編輯某個人）
//   #/plans[/roster|teams][?plan=<uuid>]     計畫區（#565；沒指定計畫就用上次選的、再來是伺服器挑的預設計畫）
//   #/plans/teams/<uuid>[?plan=<uuid>]       隊伍頁（#566；隊伍自己知道屬於哪個計畫，plan 只是回清單時用）
//   #/plans/settings                         計畫設定（照搬的「全域計畫管理」卡片）
//   #/plans/team-status                      組隊狀況（照搬；#569 從營運區搬來，計畫區最後一個分頁）
//   #/quiz[?plan=<uuid>]                     測驗區（#619）的總覽：原本報表區的「測驗作答」（#581）；#/quiz/overview 也認得
//   #/quiz/<區塊>                            測驗區的小測驗／大測驗／雲柱測驗（照搬，#619 從內容區搬來）
//   #/stats[/registrations][?plan=<uuid>]    報表區（#568）：讀經使用率／報名註冊（plan 只有報名註冊用）
//   #/content[/<區塊>]                       照搬的舊管理區塊（#550，見 legacy.ts；沒指定就是第一個）：公告、經文注釋
//   #/system[/audit][?actor=<uuid>&target=<uuid>]  稽核紀錄（#550；actor／target 是篩選條件，可以從別頁連過來）
//   #/system/settings                        功能開放設定（照搬）
//
// 用 hash 而不是路徑：靜態網站不用設定改寫規則，重新整理、登入導回來都回得到同一頁。
// 搬到計畫區的舊營運區塊（#565），舊書籤導到新位置：計畫管理 → 計畫設定、加入計畫狀況／組員總覽 → 名單、計畫統計 → 總覽；
// #568 讀經使用率、報名註冊統計 → 報表區。#581 計畫區的測驗作答 #/plans/quiz[?plan=] → 報表區 #/stats/quiz[?plan=]。#569 選單拿掉「營運」：#/operations、#/operations/teams → 計畫區的組隊狀況。
// #619 測驗獨立成一區：#/stats/quiz、#/plans/quiz（都帶著計畫）→ #/quiz；#/content/<測驗區塊> → #/quiz/<同一個區塊>。
// 「人」區的舊網址（#567）也導到新位置：#/support/users、#/accounts → 名單；#/support/user/<uuid>[/<舊分頁>] → 個人頁
// （個人頁不再分頁，舊分頁名稱略過）；#/accounts/scopes[/<uuid>] → 管理範圍。會友 App 的舊連結因此仍然有效。

import { isLegacyArea, legacySectionsOf, type LegacyArea } from "./legacy.ts";

// 舊個人頁的分頁（#555）：只為了認得舊網址
const OLD_USER_TABS: readonly string[] = ["overview", "reading_logs", "team_events", "tests", "vouchers", "reports", "timeline"];

// 選單順序（#569）：照「要做什麼事」排；測驗（#619）跟在計畫後面
export const AREAS = ["home", "plans", "quiz", "stats", "people", "support", "content", "system"] as const;
export type Area = typeof AREAS[number];

export const PEOPLE_TABS = ["directory", "scopes"] as const;
export type PeopleTab = typeof PEOPLE_TABS[number];

export const PLAN_TABS = ["overview", "roster", "teams"] as const;
export type PlanTab = typeof PLAN_TABS[number];

export const STATS_TABS = ["usage", "registrations"] as const;
export type StatsTab = typeof STATS_TABS[number];

export type AdminRoute =
  | { view: "home" }
  | { view: "inbox"; reportId: string | null }
  | { view: "user"; userId: string; reason: string }
  | { view: "people"; tab: PeopleTab; profileId: string | null }
  | { view: "plans"; tab: PlanTab; planId: string | null; teamId?: string | null }
  | { view: "stats"; tab: StatsTab; planId: string | null }
  | { view: "quiz"; planId: string | null }
  | { view: "legacy"; area: LegacyArea; section: string }
  | { view: "audit"; actorId: string | null; targetId: string | null }
  | { view: "not_found" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON_CHARS = 200;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const DIRECTORY: AdminRoute = { view: "people", tab: "directory", profileId: null };

function userRoute(id: string, query: URLSearchParams): AdminRoute {
  return { view: "user", userId: id.toLowerCase(), reason: cleanReason(query.get("reason")) };
}

/** #/people/scopes[/<uuid>] 與舊的 #/accounts/scopes[/<uuid>] */
function scopesRoute(rest: readonly string[]): AdminRoute | null {
  if (rest[0] !== "scopes") return null;
  if (rest.length === 1) return { view: "people", tab: "scopes", profileId: null };
  if (rest.length === 2 && isUuid(rest[1])) return { view: "people", tab: "scopes", profileId: rest[1].toLowerCase() };
  return null;
}

// 計畫區裡照搬的分頁：網址片段 ↔ 區塊 id（「teams」已經是新寫的團隊分頁，所以組隊狀況用 team-status）
const PLAN_LEGACY_PATHS: Readonly<Record<string, string>> = Object.freeze({ settings: "plans", "team-status": "teams" });

const TEAM_STATUS: AdminRoute = { view: "legacy", area: "plans", section: "teams" };

const MOVED_OPERATIONS_SECTIONS: Readonly<Record<string, AdminRoute>> = Object.freeze({
  plans: { view: "legacy", area: "plans", section: "plans" },
  teams: TEAM_STATUS, // #569
  "join-status": { view: "plans", tab: "roster", planId: null },
  members: { view: "plans", tab: "roster", planId: null },
  statistics: { view: "plans", tab: "overview", planId: null },
  "reading-activity": { view: "stats", tab: "usage", planId: null },
  registrations: { view: "stats", tab: "registrations", planId: null }
});

export function cleanReason(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_REASON_CHARS) : "";
}

function planIdOf(query: URLSearchParams): string | null {
  const plan = query.get("plan");
  return isUuid(plan) ? plan.toLowerCase() : null;
}

/** 測驗區的總覽（#619）；舊的 #/stats/quiz、#/plans/quiz 也導到這裡 */
function quizOverview(query: URLSearchParams): AdminRoute {
  return { view: "quiz", planId: planIdOf(query) };
}

/** 測驗區的照搬區塊；不是測驗區塊就回 null（#/content/<測驗區塊> 的舊網址也用這個認） */
function quizSection(id: string | undefined): AdminRoute | null {
  return legacySectionsOf("quiz").some((section) => section.id === id) ? { view: "legacy", area: "quiz", section: String(id) } : null;
}

export function parseRoute(hash: string): AdminRoute {
  const raw = String(hash || "").replace(/^#/, "");
  const queryAt = raw.indexOf("?");
  const path = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const query = new URLSearchParams(queryAt === -1 ? "" : raw.slice(queryAt + 1));
  const parts = path.split("/").filter(Boolean);

  if (parts.length === 0) return { view: "home" };
  const [area, ...rest] = parts;
  if (area === "home") return rest.length === 0 ? { view: "home" } : { view: "not_found" };
  if (area === "support") {
    if (rest.length === 0) return { view: "inbox", reportId: null };
    if (rest[0] === "report" && isUuid(rest[1]) && rest.length === 2) return { view: "inbox", reportId: rest[1].toLowerCase() };
    // 舊網址（#567 前）
    if (rest[0] === "users" && rest.length === 1) return DIRECTORY;
    if (rest[0] === "user" && isUuid(rest[1]) && (rest.length === 2 || (rest.length === 3 && OLD_USER_TABS.includes(rest[2])))) {
      return userRoute(rest[1], query);
    }
    return { view: "not_found" };
  }
  if (area === "people") {
    if (rest.length === 0) return DIRECTORY;
    if (rest[0] === "user" && isUuid(rest[1]) && rest.length === 2) return userRoute(rest[1], query);
    return scopesRoute(rest) ?? { view: "not_found" };
  }
  if (area === "accounts") {
    // 舊網址（#567 前）
    if (rest.length === 0) return DIRECTORY;
    return scopesRoute(rest) ?? { view: "not_found" };
  }
  if (area === "plans") {
    if (rest.length === 1 && Object.prototype.hasOwnProperty.call(PLAN_LEGACY_PATHS, rest[0])) {
      return { view: "legacy", area: "plans", section: PLAN_LEGACY_PATHS[rest[0]] };
    }
    const tab = (rest[0] || "overview") as PlanTab;
    const planId = planIdOf(query);
    // 測驗作答搬走（#581 報表區、#619 測驗區），舊書籤帶著計畫過去
    if (rest.length === 1 && rest[0] === "quiz") return quizOverview(query);
    if (rest.length === 2 && tab === "teams" && isUuid(rest[1])) return { view: "plans", tab, planId, teamId: rest[1].toLowerCase() };
    if (rest.length > 1 || !(PLAN_TABS as readonly string[]).includes(tab)) return { view: "not_found" };
    return { view: "plans", tab, planId };
  }
  if (area === "stats") {
    // 測驗作答搬到測驗區的總覽（#619）
    if (rest.length === 1 && rest[0] === "quiz") return quizOverview(query);
    const tab = (rest[0] || "usage") as StatsTab;
    if (rest.length > 1 || !(STATS_TABS as readonly string[]).includes(tab)) return { view: "not_found" };
    return { view: "stats", tab, planId: tab !== "usage" ? planIdOf(query) : null };
  }
  if (area === "quiz") {
    if (rest.length === 0 || (rest.length === 1 && rest[0] === "overview")) return quizOverview(query);
    return (rest.length === 1 && quizSection(rest[0])) || { view: "not_found" };
  }
  if (area === "content" && rest.length === 1) {
    // 三種測驗搬到測驗區（#619），舊書籤與會友 App 的舊連結跟過去
    const moved = quizSection(rest[0]);
    if (moved) return moved;
  }
  if (area === "operations") {
    // 營運區已拿掉（#569），舊書籤導到新位置
    if (rest.length === 0) return TEAM_STATUS;
    if (rest.length === 1 && Object.prototype.hasOwnProperty.call(MOVED_OPERATIONS_SECTIONS, rest[0])) return MOVED_OPERATIONS_SECTIONS[rest[0]];
    return { view: "not_found" };
  }
  if (area === "system" && (rest.length === 0 || (rest[0] === "audit" && rest.length === 1))) {
    const pick = (key: string) => (isUuid(query.get(key)) ? String(query.get(key)).toLowerCase() : null);
    return { view: "audit", actorId: pick("actor"), targetId: pick("target") };
  }
  if (isLegacyArea(area)) {
    const sections = legacySectionsOf(area);
    if (rest.length === 0) return { view: "legacy", area, section: sections[0].id };
    if (rest.length === 1 && sections.some((section) => section.id === rest[0])) return { view: "legacy", area, section: rest[0] };
    return { view: "not_found" };
  }
  return { view: "not_found" };
}

export function formatRoute(route: AdminRoute): string {
  switch (route.view) {
    case "home":
      return "#/";
    case "inbox":
      return route.reportId ? `#/support/report/${route.reportId}` : "#/support";
    case "not_found":
      return "#/";
    case "people":
      if (route.tab === "directory") return "#/people";
      return route.profileId ? `#/people/scopes/${route.profileId}` : "#/people/scopes";
    case "plans": {
      const tab = route.teamId ? `/teams/${route.teamId}` : route.tab === "overview" ? "" : `/${route.tab}`;
      return `#/plans${tab}${route.planId ? `?plan=${route.planId}` : ""}`;
    }
    case "stats":
      if (route.tab === "usage") return "#/stats";
      return `#/stats/${route.tab}${route.planId ? `?plan=${route.planId}` : ""}`;
    case "quiz":
      return `#/quiz${route.planId ? `?plan=${route.planId}` : ""}`;
    case "legacy": {
      if (route.area !== "plans") return `#/${route.area}/${route.section}`;
      const path = Object.keys(PLAN_LEGACY_PATHS).find((key) => PLAN_LEGACY_PATHS[key] === route.section) || "settings";
      return `#/plans/${path}`;
    }
    case "audit": {
      const query = new URLSearchParams();
      if (route.actorId) query.set("actor", route.actorId);
      if (route.targetId) query.set("target", route.targetId);
      const text = query.toString();
      return text ? `#/system/audit?${text}` : "#/system/audit";
    }
    case "user": {
      const reason = cleanReason(route.reason);
      const query = reason ? `?${new URLSearchParams({ reason })}` : "";
      return `#/people/user/${route.userId}${query}`;
    }
  }
}

export function areaOf(route: AdminRoute): Area {
  if (route.view === "legacy") return route.area;
  if (route.view === "audit") return "system";
  if (route.view === "people" || route.view === "user") return "people";
  if (route.view === "plans") return "plans";
  if (route.view === "stats") return "stats";
  if (route.view === "quiz") return "quiz";
  if (route.view === "home" || route.view === "not_found") return "home";
  return "support";
}
