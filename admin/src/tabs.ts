// 「計畫」「報表」「內容」「系統」上方的分頁（#550、#565、#568、#569）。報表區全是新寫的。內容區全是照搬的舊區塊；系統區混了新寫的稽核紀錄
// 和照搬的功能開放設定，計畫區混了新寫的總覽／名單／團隊和照搬的計畫設定、組隊狀況（#569 從營運區搬來）——兩種頁面用同一排分頁，
// 切換時看起來是同一區。
// 每個分頁要自己的能力，沒有的就不顯示（伺服器端 admin-api／nlc-data 仍會再擋）。
import { isLegacyArea, legacySectionsOf, type LegacyArea } from "./legacy.ts";
import { formatRoute, type PlanTab, type StatsTab } from "./route.ts";

export type TabArea = LegacyArea | "stats";

export type AreaTab = { id: string; label: string; href: string; capability: string };

const planTab = (tab: PlanTab, label: string): AreaTab => ({
  id: tab, label, href: formatRoute({ view: "plans", tab, planId: null }), capability: "plans.read"
});

const statsTab = (tab: StatsTab, label: string): AreaTab => ({
  id: tab, label, href: formatRoute({ view: "stats", tab, planId: null }), capability: "stats.read"
});

const NATIVE_TABS: Readonly<Record<TabArea, readonly AreaTab[]>> = {
  plans: [planTab("overview", "總覽"), planTab("roster", "名單"), planTab("teams", "團隊")],
  // 測驗作答（#581）從計畫區搬來：資料仍是 plan_quiz，所以要 plans.read
  stats: [
    statsTab("usage", "讀經使用率"),
    statsTab("registrations", "報名註冊"),
    { ...statsTab("quiz", "測驗作答"), capability: "plans.read" }
  ],
  content: [],
  system: [{ id: "audit", label: "稽核紀錄", href: formatRoute({ view: "audit", actorId: null, targetId: null }), capability: "audit.read" }]
};

export function areaTabs(area: TabArea): AreaTab[] {
  const legacy = (isLegacyArea(area) ? legacySectionsOf(area) : []).map((section) => ({
    id: section.id,
    label: section.label,
    href: formatRoute({ view: "legacy", area: section.area, section: section.id }),
    capability: section.capability
  }));
  return [...NATIVE_TABS[area], ...legacy];
}

export function visibleAreaTabs(area: TabArea, capabilities: readonly string[]): AreaTab[] {
  return areaTabs(area).filter((tab) => capabilities.includes(tab.capability));
}
