// 後台網址（hash）格式（#555）。純函式，測試直接測。
//
//   #/support                                回報收件匣（#550）
//   #/support/report/<uuid>                  收件匣＋打開這張回報
//   #/support/users                          使用者查詢
//   #/support/user/<uuid>[/<tab>][?reason=…] 某個人（可以直接用網址連過來；reason 是查看理由，會記進稽核）
//   #/accounts、#/operations、#/content、#/system  其他區（#550 陸續搬過來）
//
// 用 hash 而不是路徑：靜態網站不用設定改寫規則，重新整理、登入導回來都回得到同一頁。

export const USER_TABS = ["overview", "reading_logs", "team_events", "tests", "vouchers", "reports", "timeline"] as const;
export type UserTab = typeof USER_TABS[number];

export const AREAS = ["support", "accounts", "operations", "content", "system"] as const;
export type Area = typeof AREAS[number];

export type AdminRoute =
  | { view: "inbox"; reportId: string | null }
  | { view: "search" }
  | { view: "user"; userId: string; tab: UserTab; reason: string }
  | { view: "area"; area: Exclude<Area, "support"> }
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
  if ((AREAS as readonly string[]).includes(area) && rest.length === 0) {
    return { view: "area", area: area as Exclude<Area, "support"> };
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
  if (route.view === "area") return route.area;
  return "support";
}
