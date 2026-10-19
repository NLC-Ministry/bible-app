// App 管理分頁（#551、#570）的計算。全部是純函式，畫面在 pastoral.js。
//
// 總覽數字與名單由伺服器算（nlc-data plan_summary／plan_roster，#564）；名單的篩選、排序、從總覽點進名單的條件
// 和後台同一份（supabase/functions/_shared/progress/plan-report.mjs），這裡轉出。
// 團隊、小測驗摘要是 App 畫面專用的，從名單算，留在這裡。App 不提供匯出（匯出只在後台，伺服器產生並記稽核）。
import {
  CARE_THRESHOLDS,
  CHECKIN_BUCKETS,
  PROGRESS_BUCKETS,
  UNSET_UNIT_LABEL,
  ratio,
  taipeiDateKey,
  unitName
} from "../../supabase/functions/_shared/progress/plan-progress.mjs";
import { defaultRosterFilters } from "../../supabase/functions/_shared/progress/plan-report.mjs";

// 進度判斷、漏斗、單位比較和伺服器共用（#564），本體在 supabase/functions/_shared/progress/plan-progress.mjs
export {
  CARE_THRESHOLDS,
  CHECKIN_BUCKETS,
  PROGRESS_BUCKETS,
  SCOPE_LEVELS,
  SCOPE_LEVEL_LABEL,
  UNSET_UNIT_LABEL,
  buildPlanContext,
  buildScopeOptions,
  careReasonText,
  compareUnits,
  countBuckets,
  countCareReasons,
  daysBetweenKeys,
  describePeople,
  describePerson,
  filterByScope,
  normalizeScope,
  pickUnitLevel,
  ratio,
  selectCareList,
  summarizeFunnel,
  taipeiDateKey
} from "../../supabase/functions/_shared/progress/plan-progress.mjs";

// 名單條件（進度、最後打卡兩個條件＋團隊；捷徑；快速按鈕）和後台同一份（#570）
export {
  ROSTER_PRESETS,
  activeRosterPreset,
  countRosterConditions,
  defaultRosterFilters,
  drillRosterFilters,
  filterPlanRoster,
  presetRosterFilters,
  sortPlanRoster
} from "../../supabase/functions/_shared/progress/plan-report.mjs";

export const PASTORAL_TABS = Object.freeze(["overview", "roster", "teams", "quizzes"]);

// 舊管理分頁（#/admin/<區塊>）的組長區塊 → 新分頁
export const LEGACY_SECTION_TABS = Object.freeze({
  "join-status": "roster",
  members: "roster",
  teams: "teams",
  statistics: "overview",
  quizzes: "quizzes",
  exam: "quizzes"
});

export const ROSTER_SORTS = Object.freeze([
  { id: "behind", label: "落後天數" },
  { id: "chapters_desc", label: "章數多" },
  { id: "chapters_asc", label: "章數少" }
]);
export const ROSTER_PRESET_LABELS = Object.freeze({ enrolled: "報名者", care: "需要關心", all: "全部" });
export const ROSTER_TEAM_OPTIONS = Object.freeze([
  { id: "any", label: "不限" },
  { id: "yes", label: "有隊" },
  { id: "no", label: "沒有隊" }
]);

// 名單上方「已套用的條件」標籤（#584）。規則不變（同 #570），這裡只把目前條件說成字：
// 捷徑一個標籤；進度、最後打卡和預設不同時各一個標籤（列出勾了哪幾格）；團隊不限以外一個標籤。
// 「需要關心」捷徑本身是名單上方固定的那顆，不另外列。
export const ROSTER_SHORTCUT_LABELS = Object.freeze({
  care: "需要關心",
  care_behind: `需要關心・落後 ${CARE_THRESHOLDS.behindDays} 天以上`,
  care_checkin: `需要關心・${CARE_THRESHOLDS.noCheckInDays} 天以上沒打卡`,
  active7: "近 7 天有讀"
});

const sameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
const bucketLabels = (buckets, ids) => buckets.filter((bucket) => ids.includes(bucket.id)).map((bucket) => bucket.label);

export function rosterConditionChips(filters) {
  const chips = [];
  if (filters.shortcut) {
    if (filters.shortcut !== "care") chips.push({ id: "shortcut", label: ROSTER_SHORTCUT_LABELS[filters.shortcut] || "捷徑" });
  } else {
    const base = defaultRosterFilters();
    if (!sameIds(filters.progress, base.progress)) {
      const all = PROGRESS_BUCKETS.every((bucket) => filters.progress.includes(bucket.id));
      const labels = bucketLabels(PROGRESS_BUCKETS, filters.progress);
      chips.push({ id: "progress", label: all ? "含未報名" : labels.length ? labels.join("、") : "進度：一格都沒勾" });
    }
    if (!sameIds(filters.checkin, base.checkin)) {
      const labels = bucketLabels(CHECKIN_BUCKETS, filters.checkin);
      chips.push({ id: "checkin", label: `最後打卡：${labels.length ? labels.join("、") : "一格都沒勾"}` });
    }
  }
  if (filters.team === "yes") chips.push({ id: "team", label: "有隊" });
  if (filters.team === "no") chips.push({ id: "team", label: "沒有隊" });
  return chips;
}

/** 點掉一個標籤：那個條件回到預設，其他條件不動 */
export function clearRosterCondition(filters, id) {
  const base = defaultRosterFilters();
  if (id === "shortcut") return { ...filters, shortcut: "" };
  if (id === "progress") return { ...filters, progress: base.progress };
  if (id === "checkin") return { ...filters, checkin: base.checkin };
  if (id === "team") return { ...filters, team: "any" };
  return filters;
}

export function resolvePastoralTab(value) {
  const text = String(value || "");
  if (PASTORAL_TABS.includes(text)) return text;
  return LEGACY_SECTION_TABS[text] || null;
}

// 伺服器名單的一列 → 團隊、小測驗摘要與畫面要的欄位（team3／team6、讀完一遍、最後打卡日期）
export function rosterPerson(row) {
  const teams = Array.isArray(row && row.teams) ? row.teams : [];
  return {
    ...row,
    name: String((row && row.name) || ""),
    teams,
    team3: teams.find((team) => team.division === 3) || null,
    team6: teams.find((team) => team.division === 6) || null,
    careReasons: Array.isArray(row && row.careReasons) ? row.careReasons : [],
    completedOnce: Boolean(row && row.progressBucket === "completed"),
    lastReadKey: taipeiDateKey(row && row.lastReadAt),
    quiz: {
      published: Math.max(0, Number(row && row.quiz && row.quiz.published) || 0),
      submitted: Math.max(0, Number(row && row.quiz && row.quiz.submitted) || 0)
    }
  };
}

export function teamLabel(team) {
  if (!team) return "";
  return `${team.name || "未命名"}（${team.division} 人隊${team.size >= team.division ? "" : `，${team.size}/${team.division}`}）`;
}

// 團隊：範圍內有人參加的隊（隊伍人數是全隊，成員只列範圍內的人）、已報名但沒組隊的人
export function summarizeTeams(people) {
  const list = Array.isArray(people) ? people : [];
  const enrolled = list.filter((person) => person.enrolled);
  const teams = new Map();
  for (const person of list) {
    for (const team of person.teams) {
      if (!team.id) continue;
      if (!teams.has(team.id)) teams.set(team.id, { ...team, members: [] });
      teams.get(team.id).members.push({ name: person.name, captain: team.captain });
    }
  }
  const teamList = Array.from(teams.values())
    .map((team) => ({ ...team, full: team.size >= team.division, missing: Math.max(0, team.division - team.size) }))
    .sort((a, b) => Number(a.full) - Number(b.full) || a.division - b.division || b.missing - a.missing || a.name.localeCompare(b.name, "zh-Hant"));
  return {
    enrolled: enrolled.length,
    in3: list.filter((person) => person.team3).length,
    in6: list.filter((person) => person.team6).length,
    inAny: enrolled.filter((person) => person.teams.length > 0).length,
    noTeam: enrolled.filter((person) => person.teams.length === 0),
    teams: teamList,
    openTeams: teamList.filter((team) => !team.full)
  };
}

// 小測驗：只看已報名、而且有發給他的人；不排名、不看分數
export function summarizeQuiz(people) {
  const eligible = (Array.isArray(people) ? people : []).filter((person) => person.enrolled && person.quiz.published > 0);
  const published = eligible.reduce((sum, person) => sum + person.quiz.published, 0);
  const submitted = eligible.reduce((sum, person) => sum + Math.min(person.quiz.submitted, person.quiz.published), 0);
  return {
    eligible: eligible.length,
    answeredAny: eligible.filter((person) => person.quiz.submitted > 0).length,
    neverAnswered: eligible.filter((person) => person.quiz.submitted === 0),
    published,
    submitted,
    rate: ratio(submitted, published)
  };
}

export function compareQuizUnits(people, level, { compare = null } = {}) {
  if (!level) return [];
  const groups = new Map();
  for (const person of Array.isArray(people) ? people : []) {
    const name = unitName(person[level]);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(person);
  }
  const comparator = typeof compare === "function" ? compare(level) : null;
  return Array.from(groups.entries())
    .map(([name, members]) => ({ name, ...summarizeQuiz(members) }))
    .filter((row) => row.eligible > 0)
    .sort((a, b) => {
      if (a.name === UNSET_UNIT_LABEL || b.name === UNSET_UNIT_LABEL) return a.name === UNSET_UNIT_LABEL ? 1 : -1;
      return comparator ? comparator(a.name, b.name) : a.name.localeCompare(b.name, "zh-Hant");
    });
}
