// 左側導覽（#555）：五區，依 bootstrap 回的能力清單決定顯示哪些。
// 能力名稱和 admin-api 的 policy.ts 同一份（CAPABILITIES），伺服器端仍會再擋一次；這裡只決定畫面。
// 還沒搬好的區（ready: false）要等 #550 把舊的管理區塊搬過來，搬好之前只放說明。

import type { Area } from "./route.ts";

export type NavItem = {
  area: Area;
  label: string;
  icon: "headset" | "shield" | "activity" | "book" | "settings";
  requires: readonly string[];
  ready: boolean;
  description: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { area: "support", label: "客服", icon: "headset", requires: ["support.read"], ready: true, description: "回報收件匣、查詢使用者" },
  { area: "accounts", label: "帳號與權限", icon: "shield", requires: ["accounts.read"], ready: true, description: "使用者名單、管理範圍" },
  { area: "operations", label: "營運", icon: "activity", requires: ["console.access"], ready: false, description: "計畫管理、組隊狀況、統計" },
  { area: "content", label: "內容", icon: "book", requires: ["console.access"], ready: false, description: "公告、注釋、小測驗、大測驗、雲柱測驗" },
  { area: "system", label: "系統", icon: "settings", requires: ["console.access"], ready: false, description: "功能開放設定、稽核紀錄" }
];

export function visibleNavItems(capabilities: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.requires.every((cap) => capabilities.includes(cap)));
}

export function canUse(capabilities: readonly string[], area: Area): boolean {
  return visibleNavItems(capabilities).some((item) => item.area === area);
}
