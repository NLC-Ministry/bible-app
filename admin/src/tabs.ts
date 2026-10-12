// 「內容」「系統」兩區上方的分頁（#550）。內容區全是照搬的舊區塊；系統區混了新寫的稽核紀錄
// 和照搬的功能開放設定——兩種頁面用同一排分頁，切換時看起來是同一區。
// 每個分頁要自己的能力，沒有的就不顯示（伺服器端 admin-api／nlc-data 仍會再擋）。
import { legacySectionsOf, type LegacyArea } from "./legacy.ts";
import { formatRoute } from "./route.ts";

export type AreaTab = { id: string; label: string; href: string; capability: string };

const NATIVE_TABS: Readonly<Record<LegacyArea, readonly AreaTab[]>> = {
  content: [],
  system: [{ id: "audit", label: "稽核紀錄", href: formatRoute({ view: "audit", actorId: null, targetId: null }), capability: "audit.read" }]
};

export function areaTabs(area: LegacyArea): AreaTab[] {
  const legacy = legacySectionsOf(area).map((section) => ({
    id: section.id,
    label: section.label,
    href: formatRoute({ view: "legacy", area, section: section.id }),
    capability: section.capability
  }));
  return [...NATIVE_TABS[area], ...legacy];
}

export function visibleAreaTabs(area: LegacyArea, capabilities: readonly string[]): AreaTab[] {
  return areaTabs(area).filter((tab) => capabilities.includes(tab.capability));
}
