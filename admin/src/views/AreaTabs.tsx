// 「營運」「內容」「系統」上方那排分頁（tabs.ts）。照搬的區塊（LegacyHost）和新寫的稽核紀錄共用。
import type { LegacyArea } from "../legacy.ts";
import { visibleAreaTabs } from "../tabs.ts";

export function AreaTabs({ area, current, capabilities, className = "" }: {
  area: LegacyArea;
  current: string;
  capabilities: readonly string[];
  className?: string;
}) {
  const tabs = visibleAreaTabs(area, capabilities);
  // 只有一個分頁、而且就是目前這頁：分頁列沒有意義。目前這頁沒權限時仍顯示，才點得到能用的那一頁。
  if (tabs.length === 0 || (tabs.length === 1 && tabs[0].id === current)) return null;
  return (
    <nav className={`adm-tabs${className ? ` ${className}` : ""}`} aria-label="管理區塊">
      {tabs.map((tab) => (
        <a
          key={tab.id}
          className={`adm-tab${tab.id === current ? " adm-tab--active" : ""}`}
          href={tab.href}
          aria-current={tab.id === current ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
