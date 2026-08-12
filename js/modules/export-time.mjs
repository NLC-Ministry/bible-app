export const TAIWAN_TIME_ZONE = "Asia/Taipei";

function taiwanDateTimeParts(value) {
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

export function formatTaiwanDate(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const parts = taiwanDateTimeParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

function escapeCsvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function prependTaiwanExportTime(csvContent, exportedAt = new Date()) {
  if (!csvContent) return "";
  const exportTime = formatTaiwanDateTime(exportedAt);
  return [
    [escapeCsvValue("匯出時間（台灣時間）"), escapeCsvValue(exportTime)].join(","),
    csvContent
  ].join("\n");
}
