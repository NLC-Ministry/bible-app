// js/modules/lightning-quiz-analytics.mjs
// 快問快答後台分析的純函式：把 admin_get_lightning_quiz_results（0211）與
// admin_get_lightning_quiz_week／_weeks（週統計，#311）的回傳彙總成作答總覽、
// 牧區分析、大區分析、週排行、週趨勢，並產生 CSV 字串。不碰 DOM，方便用 vitest 直接測。

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

// 單題名次（#316）：只有答對的有名次，依作答時間由快到慢；用時完全一樣就並列
// （1、1、3）。在搜尋／篩選之前算，篩選後每個人仍保留全體名次。原本的順序不變
// （admin_get_lightning_quiz_results 已經是答對→答錯→未送出、各自依用時排序）。
export function rankAttempts(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  const ranks = new Map();
  const correct = list
    .filter(attempt => attempt.status === "correct")
    .sort((a, b) => (Number(a.elapsedMs) || 0) - (Number(b.elapsedMs) || 0));
  correct.forEach((attempt, index) => {
    const prev = correct[index - 1];
    const tied = prev && (Number(prev.elapsedMs) || 0) === (Number(attempt.elapsedMs) || 0);
    ranks.set(attempt, tied ? ranks.get(prev) : index + 1);
  });
  return list.map(attempt => ({ ...attempt, rank: ranks.get(attempt) ?? null }));
}

export function buildOverviewCsv(attempts, exportedAt = new Date()) {
  const headers = ["名次", "姓名", "大區", "牧區", "小組", "結果", "作答時間（秒）", "送出時間"];
  const rows = (Array.isArray(attempts) ? attempts : []).map(attempt => [
    attempt.rank ?? "",
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

// ── 週統計（#311）────────────────────────────────────────────────────────
// 一週是週一到週日（台灣日期），日期一律用 YYYY-MM-DD 字串計算，不受瀏覽器時區影響。

function parseDateUTC(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

export function addDays(dateStr, days) {
  const date = parseDateUTC(dateStr);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekStartOf(dateStr) {
  const date = parseDateUTC(dateStr);
  return date ? addDays(dateStr, -((date.getUTCDay() + 6) % 7)) : "";
}

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function shortDate(dateStr) {
  const date = parseDateUTC(dateStr);
  return date ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : "";
}

export function formatWeekday(dateStr) {
  const date = parseDateUTC(dateStr);
  return date ? `${shortDate(dateStr)}（${WEEKDAY_LABELS[date.getUTCDay()]}）` : "";
}

export function formatWeekRange(weekStart) {
  return weekStart ? `${shortDate(weekStart)}～${shortDate(addDays(weekStart, 6))}` : "";
}

function emptyWeekBucket(extra) {
  return { ...extra, eligible: 0, participants: 0, allAnswered: 0, completed: 0, correct: 0 };
}

function finalizeWeekBucket(bucket) {
  return {
    ...bucket,
    participationRate: ratio(bucket.participants, bucket.eligible),
    allAnsweredRate: ratio(bucket.allAnswered, bucket.eligible),
    correctRate: ratio(bucket.correct, bucket.completed)
  };
}

function summarizeWeekBy(week, keyOf, makeBucket, labelKey, sortField) {
  const members = Array.isArray(week?.members) ? week.members : [];
  const eligible = Array.isArray(week?.eligible) ? week.eligible : [];
  const questionCount = Array.isArray(week?.questions) ? week.questions.length : 0;
  const buckets = new Map();
  const bucketFor = row => {
    const key = keyOf(row);
    if (!buckets.has(key)) buckets.set(key, emptyWeekBucket(makeBucket(row)));
    const bucket = buckets.get(key);
    if (sortKey(row[sortField]) < sortKey(bucket[sortField])) bucket[sortField] = row[sortField];
    return bucket;
  };
  eligible.forEach(row => { bucketFor(row).eligible += Number(row.count) || 0; });
  members.forEach(member => {
    const answered = Number(member.answered) || 0;
    if (answered <= 0) return;
    const bucket = bucketFor(member);
    bucket.participants += 1;
    if (questionCount > 0 && answered >= questionCount) bucket.allAnswered += 1;
    bucket.completed += answered;
    bucket.correct += Number(member.correct) || 0;
  });
  const rows = [...buckets.values()]
    .sort((a, b) => compareOrg(a, b, labelKey, sortField))
    .map(finalizeWeekBucket);
  const total = finalizeWeekBucket(rows.reduce((acc, row) => {
    acc.eligible += row.eligible;
    acc.participants += row.participants;
    acc.allAnswered += row.allAnswered;
    acc.completed += row.completed;
    acc.correct += row.correct;
    return acc;
  }, emptyWeekBucket({})));
  return { rows, total, questionCount };
}

export function summarizeWeekByZone(week) {
  return summarizeWeekBy(
    week,
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

export function summarizeWeekByRegion(week) {
  return summarizeWeekBy(
    week,
    row => row.greatRegion || "",
    row => ({ greatRegion: row.greatRegion || "", regionSort: row.regionSort ?? null }),
    "greatRegion",
    "regionSort"
  );
}

// 整週彙總：參與＝這週至少送出 1 題；全部答完＝這週每一題都送出；
// 答對率＝答對題數 ÷ 送出題數；平均用時＝答對的題目平均幾秒。
export function summarizeWeek(week) {
  const { total, questionCount } = summarizeWeekByRegion(week);
  const members = Array.isArray(week?.members) ? week.members : [];
  const correctElapsed = members.reduce((sum, member) => sum + (Number(member.correctElapsedMs) || 0), 0);
  return {
    ...total,
    questionCount,
    avgCorrectElapsedMs: total.correct > 0 ? Math.round(correctElapsed / total.correct) : null
  };
}

function compareWeekMembers(a, b) {
  return (Number(b.correct) || 0) - (Number(a.correct) || 0)
    || (Number(a.correctElapsedMs) || 0) - (Number(b.correctElapsedMs) || 0)
    || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
}

// 週排行：答對題數多的在前；同分比答對題目的總用時（短的在前）。沒答對任何一題
// 的人不上榜。題數與總用時都一樣時名次並列。
export function buildWeekLeaderboard(week, limit = 20) {
  const members = (Array.isArray(week?.members) ? week.members : [])
    .filter(member => (Number(member.correct) || 0) > 0)
    .sort(compareWeekMembers);
  let rank = 0;
  return members.slice(0, Math.max(0, limit)).map((member, index, list) => {
    const prev = list[index - 1];
    const tied = prev && Number(prev.correct) === Number(member.correct)
      && Number(prev.correctElapsedMs) === Number(member.correctElapsedMs);
    if (!tied) rank = index + 1;
    return { ...member, rank };
  });
}

export function buildWeeklyTrendSeries(weeks) {
  return (Array.isArray(weeks) ? weeks : [])
    .map(week => {
      const participants = Number(week.participants) || 0;
      const eligible = Number(week.totalEligible) || 0;
      const completed = Number(week.completedAttempts) || 0;
      const correct = Number(week.correctAttempts) || 0;
      const allAnswered = Number(week.allAnswered) || 0;
      return {
        weekStart: week.weekStart,
        label: formatWeekRange(week.weekStart),
        questionCount: Number(week.questionCount) || 0,
        participants,
        eligible,
        allAnswered,
        completed,
        correct,
        participationRate: ratio(participants, eligible),
        allAnsweredRate: ratio(allAnswered, eligible),
        correctRate: ratio(correct, completed),
        avgElapsedMs: week.avgElapsedMs == null ? null : Number(week.avgElapsedMs)
      };
    })
    .sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)));
}

function weekOrgCells(row) {
  return [row.eligible, row.participants, csvRate(row.participationRate), row.allAnswered, csvRate(row.correctRate)];
}

export function buildWeekZoneCsv(summary, exportedAt = new Date()) {
  const headers = ["大區", "牧區", "應答人數", "參與人數", "參與率", "全部答完", "答對率"];
  const rows = sortZoneRowsByRegion(summary?.rows || []).map(row => [
    row.greatRegion || UNASSIGNED_REGION_LABEL,
    row.pastoralZone || UNASSIGNED_ZONE_LABEL,
    ...weekOrgCells(row)
  ]);
  if (summary?.total) rows.push(["全教會合計", "", ...weekOrgCells(summary.total)]);
  return toCsv(headers, rows, exportedAt);
}

export function buildWeekRegionCsv(summary, exportedAt = new Date()) {
  const headers = ["大區", "應答人數", "參與人數", "參與率", "全部答完", "答對率"];
  const rows = (summary?.rows || []).map(row => [row.greatRegion || UNASSIGNED_REGION_LABEL, ...weekOrgCells(row)]);
  if (summary?.total) rows.push(["全教會合計", ...weekOrgCells(summary.total)]);
  return toCsv(headers, rows, exportedAt);
}

// 週名單：這週有送出作答的每一位會友，依週排行的順序；沒答對的人沒有名次。
export function buildWeekMembersCsv(week, exportedAt = new Date()) {
  const questionCount = Array.isArray(week?.questions) ? week.questions.length : 0;
  const headers = ["名次", "姓名", "大區", "牧區", "小組", `送出題數（共 ${questionCount} 題）`, "答對題數", "答對總用時（秒）"];
  const ranks = new Map(buildWeekLeaderboard(week, Number.MAX_SAFE_INTEGER).map(member => [member.userId, member.rank]));
  const rows = [...(Array.isArray(week?.members) ? week.members : [])].sort(compareWeekMembers).map(member => [
    ranks.get(member.userId) ?? "",
    member.name || "（未命名）",
    member.greatRegion || UNASSIGNED_REGION_LABEL,
    member.pastoralZone || UNASSIGNED_ZONE_LABEL,
    member.smallGroup || "",
    Number(member.answered) || 0,
    Number(member.correct) || 0,
    (Number(member.correct) || 0) > 0 ? formatElapsedSeconds(member.correctElapsedMs) : ""
  ]);
  return toCsv(headers, rows, exportedAt);
}

export function buildWeeklyTrendCsv(series, exportedAt = new Date()) {
  const headers = ["週（週一）", "題數", "參與人數", "應答人數", "參與率", "全部答完", "答對題數", "送出題數", "答對率", "平均作答時間（秒）"];
  const rows = (Array.isArray(series) ? series : []).map(point => [
    point.weekStart,
    point.questionCount,
    point.participants,
    point.eligible,
    csvRate(point.participationRate),
    point.allAnswered,
    point.correct,
    point.completed,
    csvRate(point.correctRate),
    formatElapsedSeconds(point.avgElapsedMs)
  ]);
  return toCsv(headers, rows, exportedAt);
}

