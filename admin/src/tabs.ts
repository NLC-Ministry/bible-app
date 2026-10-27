// 各區上方的分頁（#550、#565、#568、#569、#619），同一份也是左側選單在目前這一區底下列的分頁（App.tsx，#619）。
// 報表區、人區全是新寫的。內容區全是照搬的舊區塊；系統區混了新寫的稽核紀錄和照搬的功能開放設定，計畫區混了新寫的
// 總覽／名單／團隊和照搬的計畫設定、組隊狀況（#569 從營運區搬來），測驗區混了新寫的總覽（原報表區的測驗作答）和照搬的
// 小測驗、大測驗、雲柱測驗（#619 從內容區搬來）——兩種頁面用同一排分頁，切換時看起來是同一區。
// 每個分頁要自己的能力，沒有的就不顯示（伺服器端 admin-api／nlc-data 仍會再擋）。
import { isLegacyArea, legacySectionsOf, type LegacyArea } from "./legacy.ts";
import { formatRoute, type AdminRoute, type PlanTab, type StatsTab } from "./route.ts";

export type TabArea = LegacyArea | "stats" | "people";

export type AreaTab = { id: string; label: string; href: string; capability: string };

const planTab = (tab: PlanTab, label: string): AreaTab => ({
  id: tab, label, href: formatRoute({ view: "plans", tab, planId: null }), capability: "plans.read"
});

const statsTab = (tab: StatsTab, label: string): AreaTab => ({
  id: tab, label, href: formatRoute({ view: "stats", tab, planId: null }), capability: "stats.read"
});

const NATIVE_TABS: Readonly<Record<TabArea, readonly AreaTab[]>> = {
  plans: [planTab("overview", "總覽"), planTab("roster", "名單"), planTab("teams", "團隊")],
  // 測驗區的總覽＝原本報表區的「測驗作答」（#581 → #619）：資料是 plan_quiz，所以要 plans.read
  quiz: [{ id: "overview", label: "總覽", href: formatRoute({ view: "quiz", planId: null }), capability: "plans.read" }],
  stats: [statsTab("usage", "讀經使用率"), statsTab("registrations", "報名註冊")],
  // 人區（#567）：個人頁沒有自己的分頁，從名單點進去
  people: [
    { id: "directory", label: "名單與查詢", href: formatRoute({ view: "people", tab: "directory", profileId: null }), capability: "accounts.read" },
    { id: "scopes", label: "管理範圍", href: formatRoute({ view: "people", tab: "scopes", profileId: null }), capability: "accounts.read" }
  ],
  content: [],
  system: [{ id: "audit", label: "稽核紀錄", href: formatRoute({ view: "audit", actorId: null, targetId: null }), capability: "audit.read" }]
};

// 照搬分頁的 id 加前綴，才不會和同一區新寫的分頁撞名（計畫區的「團隊」和照搬的組隊狀況區塊都叫 teams，#583）。
// 區塊 id 本身不改：iframe 通道、admin-api 權限、稽核標籤都靠它。
export const legacyTabId = (section: string) => `legacy:${section}`;

export function areaTabs(area: TabArea): AreaTab[] {
  const legacy = (isLegacyArea(area) ? legacySectionsOf(area) : []).map((section) => ({
    id: legacyTabId(section.id),
    label: section.label,
    href: formatRoute({ view: "legacy", area: section.area, section: section.id }),
    capability: section.capability
  }));
  return [...NATIVE_TABS[area], ...legacy];
}

export function visibleAreaTabs(area: TabArea, capabilities: readonly string[]): AreaTab[] {
  return areaTabs(area).filter((tab) => capabilities.includes(tab.capability));
}

export function isTabArea(area: string): area is TabArea {
  return Object.prototype.hasOwnProperty.call(NATIVE_TABS, area);
}

/** 這個網址是哪一個分頁（和 areaTabs 的 id 對得上）；沒有分頁的頁面（首頁、收件匣、個人頁）回 null */
export function currentTabId(route: AdminRoute): string | null {
  switch (route.view) {
    case "plans":
    case "stats":
    case "people":
      return route.tab;
    case "quiz":
      return "overview";
    case "legacy":
      return legacyTabId(route.section);
    case "audit":
      return "audit";
    default:
      return null;
  }
}
