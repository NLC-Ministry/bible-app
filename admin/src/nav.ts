// 左側導覽（#555）：五區，依 bootstrap 回的能力清單決定顯示哪些。
// 能力名稱和 admin-api 的 policy.ts 同一份（CAPABILITIES），伺服器端仍會再擋一次；這裡只決定畫面。
// 「營運」「內容」是照搬的舊管理區塊（legacy.ts），資料仍走 nlc-data；這裡的能力只決定後台給不給開。
// 「系統」有兩個分頁、各要不同能力（稽核紀錄 audit.read、功能開放設定 settings.manage），有其中一個就顯示（anyOf）；
// 分頁本身再依能力顯示（tabs.ts）。

import type { Area } from "./route.ts";

export type NavItem = {
  area: Area;
  label: string;
  icon: "headset" | "shield" | "activity" | "book" | "settings";
  requires: readonly string[];
  // 另外至少要有其中一個（沒有這欄＝不檢查）
  anyOf?: readonly string[];
  description: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { area: "support", label: "客服", icon: "headset", requires: ["support.read"], description: "回報收件匣、查詢使用者" },
  { area: "accounts", label: "帳號與權限", icon: "shield", requires: ["accounts.read"], description: "使用者名單、管理範圍" },
  { area: "operations", label: "營運", icon: "activity", requires: ["operations.manage"], description: "計畫管理、加入計畫狀況、組員、組隊、統計、使用率、報名" },
  { area: "content", label: "內容", icon: "book", requires: ["content.manage"], description: "公告、注釋、小測驗、大測驗、雲柱測驗" },
  { area: "system", label: "系統", icon: "settings", requires: ["console.access"], anyOf: ["audit.read", "settings.manage"], description: "稽核紀錄、功能開放設定" }
];

export function visibleNavItems(capabilities: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.requires.every((cap) => capabilities.includes(cap))
    && (!item.anyOf || item.anyOf.some((cap) => capabilities.includes(cap))));
}

export function canUse(capabilities: readonly string[], area: Area): boolean {
  return visibleNavItems(capabilities).some((item) => item.area === area);
}
