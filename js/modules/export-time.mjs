import { csvCell } from "./csv-cell.mjs";

export const TAIWAN_TIME_ZONE = "Asia/Taipei";

// 用 formatToParts 自己拼字串：zh-TW 的 .format() 輸出（日期與時間之間的空白字元）
// 會隨 ICU 版本不同，Node 20 與 Node 24、各家瀏覽器都可能不一樣。
export function taiwanDateTimeParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIWAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

export function formatTaiwanDateTime(value = new Date()) {
  const parts = taiwanDateTimeParts(value);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * CSV cannot declare an Excel column width. A bare date-time is auto-coerced
 * to an Excel date serial and narrow columns render it as "########". The
 * invisible zero-width prefix keeps the exported value as readable text in
 * Excel without changing what the user sees in the cell.
 */
export function formatTaiwanExportDateTime(value = new Date()) {
  const dateTime = formatTaiwanDateTime(value);
  const minutePrecision = dateTime.slice(0, 16);
  return minutePrecision ? `\u200B${minutePrecision}` : "";
}

export function formatTaiwanDate(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const parts = taiwanDateTimeParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

export function prependTaiwanExportTime(csvContent, exportedAt = new Date()) {
  if (!csvContent) return "";
  const exportTime = formatTaiwanExportDateTime(exportedAt);
  return [
    [csvCell("匯出時間（台灣時間）"), csvCell(exportTime)].join(","),
    csvContent
  ].join("\n");
}
