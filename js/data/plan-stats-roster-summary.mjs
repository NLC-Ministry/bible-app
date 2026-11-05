// 計畫統計名冊的伺服器端彙總（#673）：get_plan_stats_roster_summary 只回每人的數字，不回逐筆打卡。
//
// 這支不能用（migration 還沒套、nlc-data 還沒部署、本機用真的 Supabase client、任何失敗）時
// fetchPlanStatsRosterSummary 回 null，呼叫端退回舊的 get_plan_stats_roster，所以部署順序不拘。
// 最高連續、補讀天數的 SQL 版本和前端算法由 scripts/db-behavior.test.mjs 的 parity 測試鎖住。
import { getConfirmedReadingRound, getRoundChapterProgressFromCount } from "./current-round-progress.mjs";

export const PLAN_STATS_ROSTER_SUMMARY_RPC = "get_plan_stats_roster_summary";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 前端算法的日期是「看的人裝置時區」的日期，彙總也照這個時區算，同一台裝置看到的數字才會一樣。
export function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

// 比對尺送去伺服器的樣子：[[第幾天（從 0 起）, 書卷, 章], …]，休息日不用列。
// 回 false＝這份日程不能精確交給 SQL（格式不符），呼叫端要走舊路徑。
export function buildPlanStatsRosterSchedule(baselineDays, startDate, timezone = getDeviceTimezone()) {
  if (!DATE_PATTERN.test(String(startDate || "")) || !timezone) return false;
  const entries = [];
  for (const [dayIndex, day] of (Array.isArray(baselineDays) ? baselineDays : []).entries()) {
    const chapters = day && Array.isArray(day.chapters) ? day.chapters : [];
    for (const chapter of chapters) {
      const number = Number(chapter && chapter.chapter);
      const book = chapter && chapter.book;
      if (typeof book !== "string" || !book || !Number.isInteger(number) || number <= 0) return false;
      entries.push([dayIndex, book, number]);
    }
  }
  return { startDate: String(startDate), timezone, entries };
}

function isValidPerson(person, scheduleRequested) {
  if (!person || !person.i) return false;
  if (!Number.isInteger(person.s)) return false;
  return !scheduleRequested || Number.isInteger(person.m);
}

// 回傳格式不對就回 null，呼叫端退回舊路徑。
export function parsePlanStatsRosterSummary(payload, { timezone, scheduleRequested = false } = {}) {
  if (!payload || typeof payload !== "object" || payload.tz !== timezone) return null;
  const { people, plans, roles } = payload;
  if (![people, plans, roles].every(Array.isArray)) return null;
  if (!people.every(person => isValidPerson(person, scheduleRequested))) return null;
  return {
    people,
    plans: plans.map(([presetKey, globalPlanId, targetBooks]) => ({ presetKey, globalPlanId, targetBooks })),
    rolesById: new Map(roles.map(([id, code, label]) => [id, { id, code, label }]))
  };
}

// planAliases 是 null 代表沒有計畫篩選；schedule 是 buildPlanStatsRosterSchedule 的結果，
// 不需要補讀天數的畫面不傳。可見範圍由 nlc-data 注入，這裡不帶。
export async function fetchPlanStatsRosterSummary(client, { planAliases = null, pastoralZone = "", schedule = null } = {}) {
  if (!client || typeof client.rpc !== "function") return null;
  const timezone = schedule ? schedule.timezone : getDeviceTimezone();
  if (!timezone) return null;
  try {
    const { data, error } = await client.rpc(PLAN_STATS_ROSTER_SUMMARY_RPC, {
      p_plan_aliases: Array.isArray(planAliases) ? planAliases : null,
      p_pastoral_zone: pastoralZone || null,
      p_timezone: timezone,
      p_start_date: schedule ? schedule.startDate : null,
      p_schedule: schedule ? schedule.entries : null
    });
    if (error) {
      console.warn("Plan stats roster summary RPC failed; falling back to the full roster.", error);
      return null;
    }
    const parsed = parsePlanStatsRosterSummary(data, { timezone, scheduleRequested: Boolean(schedule) });
    if (!parsed) console.warn("Plan stats roster summary RPC returned an unexpected shape; falling back to the full roster.");
    return parsed;
  } catch (err) {
    console.warn("Plan stats roster summary RPC threw; falling back to the full roster.", err);
    return null;
  }
}

// 彙總的一列 → 舊路徑 profile 那一半的欄位＋報名（書卷空白的報名要跑舊邏輯，所以分開組）。
export function rosterSummaryProfile(person, summary) {
  return {
    id: person.i,
    name: person.n,
    great_region: person.r,
    pastoral_zone: person.z,
    small_group: person.g,
    role_id: person.ri,
    role_definition: summary.rolesById.get(person.ri) || null
  };
}

export function rosterSummaryPlan(person, summary) {
  if (!person.p) return null;
  const kind = summary.plans[person.t] || {};
  return {
    id: person.p,
    user_id: person.i,
    preset_key: kind.presetKey ?? null,
    global_plan_id: kind.globalPlanId ?? null,
    target_books: kind.targetBooks,
    current_round: person.c,
    upgrade_prompt_handled: person.h
  };
}

// 彙總的連續天數、補讀天數。makeup 是 null＝這次沒帶日程。
export function rosterSummaryStats(person) {
  return { streak: person.s, makeup: Number.isInteger(person.m) ? person.m : null };
}

// 彙總的一列 → 跟舊路徑相同欄位的 user。遍數確認和本遍進度仍然走前端共用的函式，
// 這裡只是把逐筆打卡換成「各遍章數」。
export function buildMergedUserFromRosterSummary(person, summary, { bibleBooks = [] } = {}) {
  const uPlan = rosterSummaryPlan(person, summary);
  const byRound = person.b && typeof person.b === "object" ? person.b : {};
  const rounds = Object.keys(byRound).map(Number);
  const chaptersRead = rounds.reduce((sum, round) => sum + (Number(byRound[round]) || 0), 0);
  const confirmedRound = uPlan
    ? getConfirmedReadingRound({
        currentRound: uPlan.current_round || 1,
        upgradePromptHandled: uPlan.upgrade_prompt_handled,
        logs: rounds.map(round => ({ round }))
      })
    : 1;
  let planProgress = 0;
  if (uPlan && Array.isArray(uPlan.target_books) && uPlan.target_books.length > 0) {
    let totalChapters = 0;
    uPlan.target_books.forEach(bookName => {
      const book = bibleBooks.find(item => item.name === bookName);
      if (book) totalChapters += book.chapters;
    });
    planProgress = getRoundChapterProgressFromCount(Number(byRound[confirmedRound]) || 0, confirmedRound, totalChapters).progress;
  }
  const lastReadAt = person.a || null;
  return {
    ...rosterSummaryProfile(person, summary),
    chapters_read: chaptersRead,
    plan_progress: planProgress,
    streak: 0,
    last_read: lastReadAt ? lastReadAt.substring(0, 10) : null,
    last_read_at: lastReadAt,
    plan_id: uPlan ? uPlan.id : null,
    presetKey: uPlan ? uPlan.preset_key : null,
    globalPlanId: uPlan ? uPlan.global_plan_id : null,
    current_round: confirmedRound,
    today_devotional: null,
    roster_stats: rosterSummaryStats(person)
  };
}
