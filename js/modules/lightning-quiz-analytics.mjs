// js/modules/lightning-quiz-analytics.mjs
// 雲柱測驗後台分析的純函式：把 admin_get_lightning_quiz_results（0211）與
// admin_get_lightning_quiz_week／_weeks（週統計，#311）的回傳彙總成作答總覽、
// 牧區分析、大區分析、週排行、週趨勢，並產生 CSV 字串。不碰 DOM，方便用 vitest 直接測。

import { prependTaiwanExportTime, formatTaiwanExportDateTime, taiwanDateTimeParts } from "./export-time.mjs";
import { csvCell } from "./csv-cell.mjs";

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

// 只要月／日，例如「9/21」（得獎日期一次列很多天時用）。
export function formatMonthDay(dateStr) {
  return shortDate(dateStr);
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


// ── 每週前三名（#429）─────────────────────────────────────────────────────────
// 後台預覽用：admin_get_lightning_quiz_week_ranking 回傳的某一天答對名單（已依
// 秒數由快到慢）扣掉排除的人，取前 limit 名。跟伺服器公布時的算法一樣
// （admin_publish_lightning_quiz_week_ranking），名次依序 1、2、3，不並列。
export function pickDayWinners(candidates, excludedIds, limit = 3) {
  const excluded = new Set((Array.isArray(excludedIds) ? excludedIds : []).map(String));
  return (Array.isArray(candidates) ? candidates : [])
    .filter(candidate => !excluded.has(String(candidate.userId)))
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

// 排除名單只留這週真的有的日期與答對的人，送給伺服器前整理成
// { "YYYY-MM-DD": [userId, …] }。
export function normalizeRankingExcluded(days, excluded) {
  const result = {};
  (Array.isArray(days) ? days : []).forEach(day => {
    const ids = new Set(((excluded || {})[day.riseDate] || []).map(String));
    result[day.riseDate] = (Array.isArray(day.candidates) ? day.candidates : [])
      .map(candidate => String(candidate.userId))
      .filter(id => ids.has(id));
  });
  return result;
}

export const RANK_LABELS = Object.freeze(["第一名", "第二名", "第三名"]);

export function formatRankLabel(rank) {
  return RANK_LABELS[Number(rank) - 1] || `第 ${rank} 名`;
}

// ── 英雄榜兌換券（#445）──────────────────────────────────────────────────────

export const VOUCHER_STATUS_LABELS = Object.freeze({
  available: "可使用",
  redeemed: "已兌換",
  expired: "已過期",
  void: "已作廢"
});

export const VOUCHER_REDEEMED_VIA_LABELS = Object.freeze({
  self: "本人確認",
  admin: "管理員標記"
});

// 個人頁與後台兌換券上的兌換時間，例如「10/5 14:30」。
export function formatVoucherTime(value) {
  const parts = value ? taiwanDateTimeParts(value) : null;
  return parts ? `${Number(parts.month)}/${Number(parts.day)} ${parts.hour}:${parts.minute}` : "";
}

function formatTaiwanDateTimeShort(value) {
  const parts = value ? taiwanDateTimeParts(value) : null;
  return parts ? `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}` : "";
}

// 後台摘要：作廢的不算發出的券。
export function summarizeVouchers(vouchers) {
  const counts = { issued: 0, available: 0, redeemed: 0, expired: 0, void: 0 };
  (Array.isArray(vouchers) ? vouchers : []).forEach(voucher => {
    if (!(voucher?.status in counts)) return;
    counts[voucher.status] += 1;
    if (voucher.status !== "void") counts.issued += 1;
  });
  return counts;
}

// includeWeek：跨週的總覽（#614）在最前面多一欄「週（週一）」。
export function buildVoucherCsv(vouchers, exportedAt = new Date(), { includeWeek = false } = {}) {
  const headers = ["日期", "名次", "姓名", "牧區", "兌換碼", "面額", "狀態", "有效期限", "兌換時間", "兌換方式", "標記者"];
  if (includeWeek) headers.unshift("週（週一）");
  const rows = (Array.isArray(vouchers) ? vouchers : []).map(voucher => [
    ...(includeWeek ? [voucher.weekStart || ""] : []),
    voucher.riseDate || "",
    formatRankLabel(voucher.rank),
    voucher.name || "",
    voucher.pastoralZone || "",
    voucher.code || "",
    voucher.amount ?? "",
    VOUCHER_STATUS_LABELS[voucher.status] || voucher.status || "",
    voucher.expiresOn || "",
    formatTaiwanDateTimeShort(voucher.redeemedAt),
    VOUCHER_REDEEMED_VIA_LABELS[voucher.redeemedVia] || "",
    voucher.redeemedVia === "admin" ? (voucher.redeemedByName || "") : ""
  ]);
  return toCsv(headers, rows, exportedAt);
}

// ── 得獎與兌換總覽（#614）────────────────────────────────────────────────────
// 後台跨週看英雄榜兌換券：admin_list_lightning_quiz_vouchers 不帶週（全部週）的回傳。
// 一張未作廢的券＝一次得獎（每天每個名次各一張）；作廢的（重新公布時被排除）不算。
// 日期一律跟伺服器回傳的 today 比，不用瀏覽器的日期。

export const VOUCHER_EXPIRING_SOON_DAYS = 7;

// 可以改期限的券：可使用、已過期（已兌換、已作廢不能改，伺服器也會跳過）。
export function canChangeVoucherExpiry(voucher) {
  return voucher?.status === "available" || voucher?.status === "expired";
}

// 7 天內到期：可使用、期限在今天起 7 天內（含今天）。
export function isVoucherExpiringSoon(voucher, today, days = VOUCHER_EXPIRING_SOON_DAYS) {
  if (voucher?.status !== "available" || !today || !voucher.expiresOn) return false;
  return voucher.expiresOn < addDays(today, days);
}

function voucherCounts(list) {
  const counts = summarizeVouchers(list);
  return { ...counts, redeemRate: ratio(counts.redeemed, counts.issued) };
}

export function summarizeVoucherOverview(vouchers, today) {
  const list = Array.isArray(vouchers) ? vouchers : [];
  return {
    ...voucherCounts(list),
    expiringSoon: list.filter(voucher => isVoucherExpiringSoon(voucher, today)).length
  };
}

// 依週：新的週在前。
export function summarizeVouchersByWeek(vouchers) {
  const weeks = new Map();
  (Array.isArray(vouchers) ? vouchers : []).forEach(voucher => {
    const key = voucher.weekStart || "";
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(voucher);
  });
  return [...weeks.entries()]
    .map(([weekStart, list]) => ({ weekStart, ...voucherCounts(list) }))
    .sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));
}

// 認人用 userId；舊版後端沒回 userId 時退回姓名＋牧區，畫面不會壞。
function winnerKey(voucher) {
  return voucher.userId ? `id:${voucher.userId}` : `name:${voucher.name || ""}\u0000${voucher.pastoralZone || ""}`;
}

// 依牧區（公布當時的牧區）：得獎人數（同一人不重複算）、發出張數（一張＝一次得獎，
// 所以也是得獎人次）、已兌換、兌換率。牧區名稱沒有排序資料，依發出多的在前、未分配排最後。
export function summarizeVouchersByZone(vouchers) {
  const zones = new Map();
  const won = (Array.isArray(vouchers) ? vouchers : []).filter(voucher => voucher.status !== "void");
  won.forEach(voucher => {
    const key = voucher.pastoralZone || "";
    if (!zones.has(key)) zones.set(key, { pastoralZone: key, list: [], people: new Set() });
    const zone = zones.get(key);
    zone.list.push(voucher);
    zone.people.add(winnerKey(voucher));
  });
  const toRow = (pastoralZone, list, people) => {
    const counts = voucherCounts(list);
    return { pastoralZone, winners: people.size, issued: counts.issued, redeemed: counts.redeemed, redeemRate: counts.redeemRate };
  };
  const rows = [...zones.values()]
    .map(zone => toRow(zone.pastoralZone, zone.list, zone.people))
    .sort((a, b) => {
      if (!a.pastoralZone !== !b.pastoralZone) return a.pastoralZone ? -1 : 1;
      return b.issued - a.issued || String(a.pastoralZone).localeCompare(String(b.pastoralZone), "zh-Hant");
    });
  return { rows, total: toRow("", won, new Set(won.map(winnerKey))) };
}

// 依人：得獎次數（第 1／2／3 名各幾次）、得獎日期、已兌換幾張。姓名／牧區用最近一次
// 得獎時的紀錄。排序：次數多 → 第一名次數多 → 最近得獎在前。
export function summarizeWinners(vouchers) {
  const people = new Map();
  (Array.isArray(vouchers) ? vouchers : []).forEach(voucher => {
    if (voucher.status === "void") return;
    const key = winnerKey(voucher);
    if (!people.has(key)) {
      people.set(key, { userId: voucher.userId || null, name: "", pastoralZone: "", wins: 0, rank1: 0, rank2: 0, rank3: 0, redeemed: 0, dates: [], lastWinDate: "" });
    }
    const person = people.get(key);
    person.wins += 1;
    if (Number(voucher.rank) === 1) person.rank1 += 1;
    else if (Number(voucher.rank) === 2) person.rank2 += 1;
    else if (Number(voucher.rank) === 3) person.rank3 += 1;
    if (voucher.status === "redeemed") person.redeemed += 1;
    person.dates.push(voucher.riseDate || "");
    if (String(voucher.riseDate || "") >= person.lastWinDate) {
      person.lastWinDate = voucher.riseDate || "";
      person.name = voucher.name || "";
      person.pastoralZone = voucher.pastoralZone || "";
    }
  });
  const list = [...people.values()]
    .map(person => ({ ...person, dates: [...person.dates].sort() }))
    .sort((a, b) => b.wins - a.wins
      || b.rank1 - a.rank1
      || String(b.lastWinDate).localeCompare(String(a.lastWinDate))
      || String(a.name).localeCompare(String(b.name), "zh-Hant"));
  const count = test => list.filter(person => test(person.wins)).length;
  return {
    people: list,
    winners: list.length,
    totalWins: list.reduce((sum, person) => sum + person.wins, 0),
    distribution: [
      { label: "得獎 1 次", people: count(wins => wins === 1) },
      { label: "得獎 2 次", people: count(wins => wins === 2) },
      { label: "得獎 3 次以上", people: count(wins => wins >= 3) }
    ]
  };
}

// 篩選：weekStart＝''（全部週）；zone＝null（全部牧區）、''＝未分配；status＝'all' 或
// available／redeemed／expired；作廢的券只在 showVoid 且狀態是「全部」時才列。
export function filterVouchers(vouchers, { weekStart = "", zone = null, status = "all", showVoid = false } = {}) {
  return (Array.isArray(vouchers) ? vouchers : []).filter(voucher => {
    if (weekStart && voucher.weekStart !== weekStart) return false;
    if (zone !== null && (voucher.pastoralZone || "") !== zone) return false;
    if (voucher.status === "void") return showVoid && status === "all";
    return status === "all" || voucher.status === status;
  });
}

export function buildVoucherWeekCsv(rows, exportedAt = new Date()) {
  const headers = ["週（週一）", "發出", "已兌換", "可使用", "已過期", "兌換率", "已作廢"];
  const body = (Array.isArray(rows) ? rows : []).map(row => [
    row.weekStart, row.issued, row.redeemed, row.available, row.expired, csvRate(row.redeemRate), row.void
  ]);
  return toCsv(headers, body, exportedAt);
}

export function buildVoucherZoneCsv(summary, exportedAt = new Date()) {
  const headers = ["牧區", "得獎人數", "發出張數（得獎人次）", "已兌換", "兌換率"];
  const cells = row => [row.winners, row.issued, row.redeemed, csvRate(row.redeemRate)];
  const rows = (summary?.rows || []).map(row => [row.pastoralZone || UNASSIGNED_ZONE_LABEL, ...cells(row)]);
  if (summary?.total) rows.push(["合計", ...cells(summary.total)]);
  return toCsv(headers, rows, exportedAt);
}

export function buildWinnersCsv(people, exportedAt = new Date()) {
  const headers = ["姓名", "牧區", "得獎次數", "第一名", "第二名", "第三名", "已兌換", "得獎日期"];
  const rows = (Array.isArray(people) ? people : []).map(person => [
    person.name || "（未命名）",
    person.pastoralZone || UNASSIGNED_ZONE_LABEL,
    person.wins,
    person.rank1,
    person.rank2,
    person.rank3,
    person.redeemed,
    person.dates.join("、")
  ]);
  return toCsv(headers, rows, exportedAt);
}
