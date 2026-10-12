// 後台網址（hash）格式（#555）。純函式，測試直接測。
//
//   #/support                                回報收件匣（#550）
//   #/support/report/<uuid>                  收件匣＋打開這張回報
//   #/support/users                          使用者查詢
//   #/support/user/<uuid>[/<tab>][?reason=…] 某個人（可以直接用網址連過來；reason 是查看理由，會記進稽核）
//   #/accounts                               使用者名單（#550）
//   #/accounts/scopes[/<uuid>]               管理範圍（權限總覽＋編輯某個人）
//   #/content[/<區塊>]                       照搬的舊管理區塊（#550，見 legacy.ts；沒指定就是第一個）
//   #/system[/audit][?actor=<uuid>&target=<uuid>]  稽核紀錄（#550；actor／target 是篩選條件，可以從別頁連過來）
//   #/system/settings                        功能開放設定（照搬）
//   #/operations                             營運（#550 陸續搬過來）
//
// 用 hash 而不是路徑：靜態網站不用設定改寫規則，重新整理、登入導回來都回得到同一頁。

import { isLegacyArea, legacySectionsOf, type LegacyArea } from "./legacy.ts";

export const USER_TABS = ["overview", "reading_logs", "team_events", "tests", "vouchers", "reports", "timeline"] as const;
export type UserTab = typeof USER_TABS[number];

export const AREAS = ["support", "accounts", "operations", "content", "system"] as const;
export type Area = typeof AREAS[number];

export const ACCOUNT_TABS = ["users", "scopes"] as const;
export type AccountTab = typeof ACCOUNT_TABS[number];

export type AdminRoute =
  | { view: "inbox"; reportId: string | null }
  | { view: "search" }
  | { view: "user"; userId: string; tab: UserTab; reason: string }
  | { view: "accounts"; tab: AccountTab; profileId: string | null }
  | { view: "legacy"; area: LegacyArea; section: string }
  | { view: "audit"; actorId: string | null; targetId: string | null }
  | { view: "area"; area: Exclude<Area, "support" | "accounts" | LegacyArea> }
  | { view: "not_found" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON_CHARS = 200;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function cleanReason(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_REASON_CHARS) : "";
}

export function parseRoute(hash: string): AdminRoute {
  const raw = String(hash || "").replace(/^#/, "");
  const queryAt = raw.indexOf("?");
  const path = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const query = new URLSearchParams(queryAt === -1 ? "" : raw.slice(queryAt + 1));
  const parts = path.split("/").filter(Boolean);

  if (parts.length === 0) return { view: "inbox", reportId: null };
  const [area, ...rest] = parts;
  if (area === "support") {
    if (rest.length === 0) return { view: "inbox", reportId: null };
    if (rest[0] === "report" && isUuid(rest[1]) && rest.length === 2) return { view: "inbox", reportId: rest[1].toLowerCase() };
    if (rest[0] === "users" && rest.length === 1) return { view: "search" };
    if (rest[0] === "user" && isUuid(rest[1]) && rest.length <= 3) {
      const tab = (rest[2] || "overview") as UserTab;
      if (!(USER_TABS as readonly string[]).includes(tab)) return { view: "not_found" };
      return { view: "user", userId: rest[1].toLowerCase(), tab, reason: cleanReason(query.get("reason")) };
    }
    return { view: "not_found" };
  }
  if (area === "accounts") {
    if (rest.length === 0) return { view: "accounts", tab: "users", profileId: null };
    if (rest[0] === "scopes" && rest.length === 1) return { view: "accounts", tab: "scopes", profileId: null };
    if (rest[0] === "scopes" && isUuid(rest[1]) && rest.length === 2) return { view: "accounts", tab: "scopes", profileId: rest[1].toLowerCase() };
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
  if ((AREAS as readonly string[]).includes(area) && rest.length === 0) {
    return { view: "area", area: area as Exclude<Area, "support" | "accounts" | LegacyArea> };
  }
  return { view: "not_found" };
}

export function formatRoute(route: AdminRoute): string {
  switch (route.view) {
    case "inbox":
      return route.reportId ? `#/support/report/${route.reportId}` : "#/support";
    case "search":
      return "#/support/users";
    case "not_found":
      return "#/support";
    case "accounts":
      if (route.tab === "users") return "#/accounts";
      return route.profileId ? `#/accounts/scopes/${route.profileId}` : "#/accounts/scopes";
    case "legacy":
      return `#/${route.area}/${route.section}`;
    case "audit": {
      const query = new URLSearchParams();
      if (route.actorId) query.set("actor", route.actorId);
      if (route.targetId) query.set("target", route.targetId);
      const text = query.toString();
      return text ? `#/system/audit?${text}` : "#/system/audit";
    }
    case "area":
      return `#/${route.area}`;
    case "user": {
      const tab = route.tab === "overview" ? "" : `/${route.tab}`;
      const reason = cleanReason(route.reason);
      const query = reason ? `?${new URLSearchParams({ reason })}` : "";
      return `#/support/user/${route.userId}${tab}${query}`;
    }
  }
}

export function areaOf(route: AdminRoute): Area {
  if (route.view === "area" || route.view === "legacy") return route.area;
  if (route.view === "audit") return "system";
  if (route.view === "accounts") return "accounts";
  return "support";
}
