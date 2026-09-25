// js/modules/lightning-quiz-analytics.mjs
// 快問快答後台分析的純函式：把 admin_get_lightning_quiz_results 與
// admin_get_lightning_quiz_trend（皆見 0211）的回傳彙總成作答總覽、牧區分析、
// 大區分析、歷史趨勢，並產生 CSV 字串。不碰 DOM，方便用 vitest 直接測。

import { prependTaiwanExportTime, formatTaiwanExportDateTime } from "./export-time.mjs";

export const UNASSIGNED_ZONE_LABEL = "未分配牧區";
export const UNASSIGNED_REGION_LABEL = "未分配大區";

export const ATTEMPT_STATUS_LABELS = Object.freeze({
  correct: "答對",
  wrong: "答錯",
  in_progress: "未完成"
});

export function formatElapsedSeconds(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return "";
  return (Math.max(0, Number(ms)) / 1000).toFixed(1);
}

export function formatRate(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function sortKey(value) {
  return Number.isFinite(Number(value)) && value !== null ? Number(value) : Number.MAX_SAFE_INTEGER;
}

function compareOrg(a, b, labelKey, sortField) {
  // 未分配永遠排最後；其餘依組織設定的 sort_order，再依名稱。
  const aUnassigned = !a[labelKey];
  const bUnassigned = !b[labelKey];
  if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
  const diff = sortKey(a[sortField]) - sortKey(b[sortField]);
  if (diff !== 0) return diff;
  return String(a[labelKey] || "").localeCompare(String(b[labelKey] || ""), "zh-Hant");
}

function emptyBucket(extra) {
  return { ...extra, eligible: 0, completed: 0, correct: 0, inProgress: 0 };
}

function finalizeBucket(bucket) {
  return {
    ...bucket,
    participationRate: ratio(bucket.completed, bucket.eligible),
    correctRate: ratio(bucket.correct, bucket.completed)
  };
}

function addAttempt(bucket, attempt) {
  if (attempt.status === "in_progress") {
    bucket.inProgress += 1;
    return;
  }
  bucket.completed += 1;
  if (attempt.status === "correct") bucket.correct += 1;
}

function summarize(results, keyOf, makeBucket, labelKey, sortField) {
  const attempts = Array.isArray(results?.attempts) ? results.attempts : [];
  const eligible = Array.isArray(results?.eligible) ? results.eligible : [];
  const buckets = new Map();
  const bucketFor = row => {
    const key = keyOf(row);
    if (!buckets.has(key)) buckets.set(key, emptyBucket(makeBucket(row)));
    const bucket = buckets.get(key);
    // 同一個牧區/大區可能從多筆資料來，sort_order 取最小的那個有值的
    if (sortKey(row[sortField]) < sortKey(bucket[sortField])) bucket[sortField] = row[sortField];
    return bucket;
  };
  eligible.forEach(row => { bucketFor(row).eligible += Number(row.count) || 0; });
  attempts.forEach(attempt => addAttempt(bucketFor(attempt), attempt));

  const rows = [...buckets.values()]
    .sort((a, b) => compareOrg(a, b, labelKey, sortField))
    .map(finalizeBucket);
  const total = finalizeBucket(rows.reduce((acc, row) => {
    acc.eligible += row.eligible;
    acc.completed += row.completed;
    acc.correct += row.correct;
    acc.inProgress += row.inProgress;
    return acc;
  }, emptyBucket({})));
  return { rows, total };
}

// 牧區分析：同名牧區若屬於不同大區視為不同列（大區 + 牧區當 key）。
export function summarizeByZone(results) {
  return summarize(
    results,
    row => `${row.greatRegion || ""}\u0000${row.pastoralZone || ""}`,
    row => ({
      greatRegion: row.greatRegion || "",
      pastoralZone: row.pastoralZone || "",
      regionSort: row.regionSort ?? null,
      zoneSort: row.zoneSort ?? null
    }),
    "pastoralZone",
    "zoneSort"
  );
}

export function summarizeByRegion(results) {
  return summarize(
    results,
    row => row.greatRegion || "",
    row => ({ greatRegion: row.greatRegion || "", regionSort: row.regionSort ?? null }),
    "greatRegion",
    "regionSort"
  );
}

// 牧區表排序要先依大區、再依牧區，跟組織架構的閱讀順序一致。
export function sortZoneRowsByRegion(rows) {
  return [...rows].sort((a, b) => {
    const regionCompare = compareOrg(a, b, "greatRegion", "regionSort");
    if (regionCompare !== 0) return regionCompare;
    return compareOrg(a, b, "pastoralZone", "zoneSort");
  });
}

// 歷史趨勢：同一天可能有已下架的原活動與另存後發布的新活動，只取已發布的
// 那一個，一天一個點（整天都被下架的日期不列入趨勢）。
export function buildTrendSeries(days) {
  const list = Array.isArray(days) ? days : [];
  return list
    .filter(day => day && day.status !== "archived")
    .map(day => {
      const completed = Number(day.completedCount) || 0;
      const correct = Number(day.correctCount) || 0;
      const eligible = Number(day.totalEligible) || 0;
      return {
        riseDate: day.riseDate,
        questionId: day.questionId,
        completed,
        correct,
        eligible,
        participationRate: ratio(completed, eligible),
        correctRate: ratio(correct, completed),
        avgElapsedMs: day.avgElapsedMs == null ? null : Number(day.avgElapsedMs)
      };
    })
    .sort((a, b) => String(a.riseDate).localeCompare(String(b.riseDate)));
}

export function filterAttempts(attempts, { search = "", status = "all" } = {}) {
  const needle = String(search || "").trim().toLowerCase();
  return (Array.isArray(attempts) ? attempts : []).filter(attempt => {
    if (status !== "all" && attempt.status !== status) return false;
    if (!needle) return true;
    return [attempt.name, attempt.pastoralZone, attempt.smallGroup, attempt.greatRegion]
      .some(value => String(value || "").toLowerCase().includes(needle));
  });
}

// ── CSV ────────────────────────────────────────────────────────────────

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function toCsv(headers, rows, exportedAt) {
  return prependTaiwanExportTime([
    headers.map(csvCell).join(","),
    ...rows.map(row => row.map(csvCell).join(","))
  ].join("\n"), exportedAt);
}

function csvRate(value) {
  return value == null ? "" : `${(value * 100).toFixed(1)}%`;
}

export function buildOverviewCsv(attempts, exportedAt = new Date()) {
  const headers = ["姓名", "大區", "牧區", "小組", "結果", "作答時間（秒）", "送出時間"];
  const rows = (Array.isArray(attempts) ? attempts : []).map(attempt => [
    attempt.name || "（未命名）",
    attempt.greatRegion || UNASSIGNED_REGION_LABEL,
    attempt.pastoralZone || UNASSIGNED_ZONE_LABEL,
    attempt.smallGroup || "",
    ATTEMPT_STATUS_LABELS[attempt.status] || "",
    attempt.status === "in_progress" ? "" : formatElapsedSeconds(attempt.elapsedMs),
    attempt.completedAt ? formatTaiwanExportDateTime(attempt.completedAt) : ""
  ]);
  return toCsv(headers, rows, exportedAt);
}

function orgStatCells(row) {
  return [row.eligible, row.completed, csvRate(row.participationRate), row.correct, csvRate(row.correctRate)];
}

export function buildZoneCsv(summary, exportedAt = new Date()) {
  const headers = ["大區", "牧區", "應答人數", "作答人數", "參與率", "答對人數", "答對率"];
  const rows = sortZoneRowsByRegion(summary?.rows || []).map(row => [
    row.greatRegion || UNASSIGNED_REGION_LABEL,
    row.pastoralZone || UNASSIGNED_ZONE_LABEL,
    ...orgStatCells(row)
  ]);
  if (summary?.total) rows.push(["全教會合計", "", ...orgStatCells(summary.total)]);
  return toCsv(headers, rows, exportedAt);
}

export function buildRegionCsv(summary, exportedAt = new Date()) {
  const headers = ["大區", "應答人數", "作答人數", "參與率", "答對人數", "答對率"];
  const rows = (summary?.rows || []).map(row => [
    row.greatRegion || UNASSIGNED_REGION_LABEL,
    ...orgStatCells(row)
  ]);
  if (summary?.total) rows.push(["全教會合計", ...orgStatCells(summary.total)]);
  return toCsv(headers, rows, exportedAt);
}

export function buildTrendCsv(series, exportedAt = new Date()) {
  const headers = ["日期", "作答人數", "應答人數", "參與率", "答對人數", "答對率", "平均作答時間（秒）"];
  const rows = (Array.isArray(series) ? series : []).map(point => [
    point.riseDate,
    point.completed,
    point.eligible,
    csvRate(point.participationRate),
    point.correct,
    csvRate(point.correctRate),
    formatElapsedSeconds(point.avgElapsedMs)
  ]);
  return toCsv(headers, rows, exportedAt);
}
