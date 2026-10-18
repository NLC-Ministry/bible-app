// 後台匯出（#550）：CSV 由 admin-api 產生，前端只負責下載。
//
// 儲存格規則和會友 App 的 js/modules/csv-cell.mjs（#553）相同——以 = + - @ Tab 換行開頭的文字前面加 '，
// 管理員用 Excel／Google 試算表打開時不會被當成公式執行；真正的數字維持原樣。
// 直接內嵌、不 import 共用檔：部署只打包函式自己的資料夾。scripts/admin-api.test.mjs 會比對兩邊結果一致。
const FORMULA_PREFIX_RE = /^[=+\-@\t\r\n]/;
const NUMERIC_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?%?$/;

export function neutralizeCsvFormula(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  const text = String(value);
  if (!FORMULA_PREFIX_RE.test(text) || text === "-" || NUMERIC_RE.test(text)) return text;
  return `'${text}`;
}

export function csvCell(value: unknown): string {
  return `"${neutralizeCsvFormula(value).replace(/"/g, '""')}"`;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

const TAIPEI_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

/** ISO 時間 → 台北時間「2026-10-12 09:05」；空值或無法解析回空字串。 */
export function taipeiDateTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(TAIPEI_PARTS.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 檔名用的台北日期：2026-10-12 */
export function taipeiDate(now: Date): string {
  return taipeiDateTime(now.toISOString()).slice(0, 10);
}

export const REPORT_CATEGORY_LABEL: Readonly<Record<string, string>> = {
  bug: "Bug 錯誤",
  ui: "UI 建議",
  data: "資料問題",
  other: "其他"
};

export const REPORT_STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: "待處理",
  processing: "處理中",
  resolved: "已解決",
  ignored: "已存檔"
};

export type ReportExportRow = {
  id?: string;
  created_at?: string;
  category?: string;
  status?: string;
  message_count?: number;
  last_message_at?: string | null;
  description?: string;
  url?: string | null;
  reporter_name?: string | null;
  reporter_zone?: string | null;
  reporter_group?: string | null;
};

export const REPORT_EXPORT_HEADERS = [
  "ID", "建立時間", "分類", "處理狀況", "訊息數", "最後訊息時間", "問題描述", "頁面網址", "回報者姓名", "回報者牧區", "回報者小組"
] as const;

export function reportsCsv(rows: readonly ReportExportRow[]): string {
  return toCsv(REPORT_EXPORT_HEADERS, rows.map((row) => [
    row.id || "",
    taipeiDateTime(row.created_at),
    REPORT_CATEGORY_LABEL[row.category || ""] || row.category || "",
    REPORT_STATUS_LABEL[row.status || ""] || row.status || "",
    typeof row.message_count === "number" ? row.message_count : "",
    taipeiDateTime(row.last_message_at),
    row.description || "",
    row.url || "",
    row.reporter_name || "訪客／離線",
    row.reporter_zone || "",
    row.reporter_group || ""
  ]));
}

// ── 帳號與權限（#550 第二組）─────────────────────────────────────────────────
// 欄位、預設字與 App 管理分頁的 convertUserDirectoryToCSV／convertOrgStructureToCSV 相同，
// 開頭一樣多一列「匯出時間（台灣時間）」，管理員拿兩邊的檔案比對時不會對不上。

/** CSV 最前面加一列匯出時間（同 js/modules/export-time.mjs 的 prependTaiwanExportTime）。 */
// 時間前面的零寬空白：Excel 才不會把它轉成日期序號、在窄欄顯示成 ####（同 App）
export function withExportTime(csv: string, now: Date): string {
  return `${csvCell("匯出時間（台灣時間）")},${csvCell(`​${taipeiDateTime(now.toISOString())}`)}\r\n${csv}`;
}

export type DirectoryTeam = { name?: string | null; role?: string | null };
export type DirectoryExportRow = {
  name?: string | null;
  email?: string | null;
  great_region?: string | null;
  pastoral_zone?: string | null;
  small_group?: string | null;
  role_code?: string | null;
  role_label?: string | null;
  is_active?: boolean | null;
  teams?: DirectoryTeam[] | null;
};

export const DIRECTORY_EXPORT_HEADERS = ["大區", "牧區", "小組", "姓名", "電子信箱", "角色", "組隊狀態", "帳號狀態"] as const;

/** 隊名（隊長加「[隊長] 」），同 App 的 formatProfilePlanTeams。 */
export function formatTeams(teams: readonly DirectoryTeam[] | null | undefined): string {
  return (Array.isArray(teams) ? teams : [])
    .map((team) => `${team?.role === "captain" || team?.role === "leader" ? "[隊長] " : ""}${String(team?.name || "").trim() || "未命名隊伍"}`)
    .join("、");
}

export function directoryCsv(rows: readonly DirectoryExportRow[]): string {
  return toCsv(DIRECTORY_EXPORT_HEADERS, rows.map((row) => [
    row.great_region || "未設定",
    row.pastoral_zone || "未設定牧區",
    row.small_group || "未設定",
    row.name || "未設定",
    row.email || "",
    row.role_label || (row.role_code && row.role_code !== "member" ? row.role_code : "一般會友"),
    formatTeams(row.teams) || "未加入團隊 (個人速讀中)",
    row.is_active === false ? "已停用" : "啟用中"
  ]));
}

export const ORG_EXPORT_HEADERS = ["大區", "牧區", "小組"] as const;

export function orgCsv(rows: readonly (readonly unknown[])[]): string {
  return toCsv(ORG_EXPORT_HEADERS, rows.map((row) => [row[0] ?? "", row[1] ?? "", row[2] ?? ""]));
}
