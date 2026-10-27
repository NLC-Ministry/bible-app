// 左側導覽（#555）：八區，依 bootstrap 回的能力清單決定顯示哪些。
// #569 照「要做什麼事」重排：首頁／計畫／報表／人／回報收件匣／內容／系統；「營運」拿掉（組隊狀況搬到計畫區）。
// #619 加「測驗」（放在計畫後面）：總覽（原報表區的測驗作答）要 plans.read、三種測驗（照搬，原在內容區）要 content.manage，有其中一個就顯示。
// 目前這一區的分頁列在側欄那一項底下（App.tsx，分頁來源同 tabs.ts）。
// 能力名稱和 admin-api 的 policy.ts 同一份（CAPABILITIES），伺服器端仍會再擋一次；這裡只決定畫面。
// 「內容」是照搬的舊管理區塊（legacy.ts），資料仍走 nlc-data；這裡的能力只決定後台給不給開。
// 「人」區：名單與管理範圍要 accounts.read、個人頁要 support.read，有其中一個就顯示（分頁再各自檢查）。
// 「系統」有兩個分頁、各要不同能力（稽核紀錄 audit.read、功能開放設定 settings.manage），有其中一個就顯示（anyOf）；
// 分頁本身再依能力顯示（tabs.ts）。首頁進得了後台就顯示，每一項再看能力（views/HomeArea.tsx）。

import type { Area } from "./route.ts";

export type NavItem = {
  area: Area;
  label: string;
  icon: "home" | "headset" | "users" | "plan" | "quiz" | "chart" | "book" | "settings";
  requires: readonly string[];
  // 另外至少要有其中一個（沒有這欄＝不檢查）
  anyOf?: readonly string[];
  description: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { area: "home", label: "首頁", icon: "home", requires: ["console.access"], description: "今天要處理的事" },
  { area: "plans", label: "計畫", icon: "plan", requires: ["plans.read"], description: "總覽、名單、團隊、計畫設定、組隊狀況" },
  { area: "quiz", label: "測驗", icon: "quiz", requires: ["console.access"], anyOf: ["plans.read", "content.manage"], description: "總覽、小測驗、大測驗、雲柱測驗" },
  { area: "stats", label: "報表", icon: "chart", requires: ["stats.read"], description: "讀經使用率、報名註冊" },
  { area: "people", label: "人", icon: "users", requires: ["console.access"], anyOf: ["accounts.read", "support.read"], description: "名單與查詢、個人頁、管理範圍" },
  { area: "support", label: "回報收件匣", icon: "headset", requires: ["support.read"], description: "會友的回報與對話" },
  { area: "content", label: "內容", icon: "book", requires: ["content.manage"], description: "公告、經文注釋" },
  { area: "system", label: "系統", icon: "settings", requires: ["console.access"], anyOf: ["audit.read", "settings.manage"], description: "稽核紀錄、功能開放設定" }
];

export function visibleNavItems(capabilities: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.requires.every((cap) => capabilities.includes(cap))
    && (!item.anyOf || item.anyOf.some((cap) => capabilities.includes(cap))));
}

export function canUse(capabilities: readonly string[], area: Area): boolean {
  return visibleNavItems(capabilities).some((item) => item.area === area);
}
