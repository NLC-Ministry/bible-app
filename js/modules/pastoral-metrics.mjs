// App 管理分頁（#551）的計算：get_pastoral_overview 回的「每人一列」精簡資料 → 每個人的狀態、
// 進度漏斗、需要關心、單位比較、名單篩選、團隊與小測驗摘要、CSV。全部是純函式，畫面在 pastoral.js。
//
// 每個人的進度判斷、漏斗、單位比較在伺服器共用的 plan-progress.mjs（#564），這裡轉出；
// 名單篩選、團隊、小測驗、CSV 是 App 畫面專用的，留在這裡。
import { UNSET_UNIT_LABEL, careReasonText, ratio, unitName } from "../../supabase/functions/_shared/progress/plan-progress.mjs";
import { csvCell } from "./csv-cell.mjs";

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

export const ROSTER_FILTERS = Object.freeze([
  { id: "all", label: "全部" },
  { id: "care", label: "需要關心" },
  { id: "not_enrolled", label: "未報名" },
  { id: "behind", label: "落後" },
  { id: "no_team", label: "未組隊" },
  { id: "completed", label: "讀完一遍" }
]);

export function resolvePastoralTab(value) {
  const text = String(value || "");
  if (PASTORAL_TABS.includes(text)) return text;
  return LEGACY_SECTION_TABS[text] || null;
}

export function filterRoster(people, { filter = "all", query = "" } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  return (Array.isArray(people) ? people : []).filter((person) => {
    if (needle && !person.name.toLowerCase().includes(needle)) return false;
    switch (filter) {
      case "care": return person.care;
      case "not_enrolled": return !person.enrolled;
      case "behind": return person.enrolled && person.behindDays >= 2;
      case "no_team": return person.enrolled && person.teams.length === 0;
      case "completed": return person.completedOnce;
      default: return true;
    }
  });
}

export function countRosterFilters(people) {
  return Object.fromEntries(ROSTER_FILTERS.map((item) => [item.id, filterRoster(people, { filter: item.id }).length]));
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

function csvText(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function buildRosterCsv(people) {
  const head = ["姓名", "大區", "牧區", "小組", "報名", "狀態", "本遍進度(%)", "已讀章數", "最後打卡", "近7天打卡天數", "3人隊", "6人隊", "小測驗作答", "小測驗發布", "需要關心"];
  const rows = (Array.isArray(people) ? people : []).map((person) => [
    person.name,
    person.greatRegion,
    person.pastoralZone,
    person.smallGroup,
    person.enrolled ? "已報名" : "未報名",
    person.statusLabel,
    person.enrolled ? person.progress : "",
    person.enrolled ? person.chapters : "",
    person.lastReadKey,
    person.enrolled ? person.readDays7 : "",
    person.team3 ? person.team3.name : "",
    person.team6 ? person.team6.name : "",
    person.enrolled ? person.quiz.submitted : "",
    person.enrolled ? person.quiz.published : "",
    person.careReasons.map(careReasonText).join("、")
  ]);
  return csvText([head, ...rows]);
}

export function buildTeamsCsv(summary) {
  const head = ["隊型", "隊名", "狀態", "全隊人數", "範圍內成員"];
  const rows = (summary && Array.isArray(summary.teams) ? summary.teams : []).map((team) => [
    `${team.division} 人隊`,
    team.name,
    team.full ? "已滿" : `還缺 ${team.missing} 人`,
    team.size,
    team.members.map((member) => `${member.name}${member.captain ? "（隊長）" : ""}`).join("、")
  ]);
  return csvText([head, ...rows]);
}
