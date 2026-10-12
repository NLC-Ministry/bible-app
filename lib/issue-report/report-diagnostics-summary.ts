// 回報診斷資訊（#548）的顯示用摘要：會友 App 的回報管理與後台（#550）共用，純函式。

export function taipeiTime(iso?: string, withDate = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return withDate
    ? d.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })
    : d.toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

/** 回報診斷資訊（#548）的摘要列：[標籤, 值]。 */
export function diagnosticsSummaryRows(d: Record<string, any>): Array<[string, string]> {
  const source = d?.data_source || {};
  const queue = d?.offline_queue || {};
  const rows: Array<[string, string]> = [
    ["版本", d?.build_id || "—"],
    ["送出時間", taipeiTime(d?.submitted_at)],
    ["開啟方式", d?.standalone ? "主畫面 App" : "瀏覽器"],
    ["網路", d?.online === false ? "離線" : "線上"],
    ["頁面", d?.route || "—"],
    ["作用中計畫", d?.active_plan_id || "—"],
    ["資料來源", `${source.reading_data_source || "—"}${source.reading_data_stale === "true" ? "（舊資料）" : ""}`],
    ["資料讀取錯誤", source.repository_error || "無"],
    ["離線佇列", queue.available ? `待送 ${queue.pending ?? 0}／失敗 ${queue.failed ?? 0}` : "讀不到"]
  ];
  if (queue.last_error) rows.push(["佇列最後錯誤", String(queue.last_error)]);
  return rows;
}
