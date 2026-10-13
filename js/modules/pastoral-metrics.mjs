// App 管理分頁（#551）的計算：get_pastoral_overview 回的「每人一列」精簡資料 → 每個人的狀態、
// 進度漏斗、需要關心、單位比較、名單篩選、團隊與小測驗摘要、CSV。全部是純函式，畫面在 pastoral.js。
//
// 落後／超前一律用唯一的比對原語（js/data/schedule-progress.mjs，教會原始日程），判斷順序和
// 計畫統計的參與者總覽（plan-stats.js renderGroupParticipantsRankingTable）相同，伺服器不另算一套。
import { countExpectedScheduleDays, countScheduleDaysCoveredByChapters } from "../data/schedule-progress.mjs";
import { getConfirmedReadingRound } from "../data/current-round-progress.mjs";
import { csvCell } from "./csv-cell.mjs";

export const PASTORAL_TABS = Object.freeze(["overview", "roster", "teams", "quizzes"]);

// 「需要關心」：已報名、還在第一遍，而且這麼多天沒打卡或落後這麼多天（維護者 2026-10-12）
export const CARE_THRESHOLDS = Object.freeze({ noCheckInDays: 3, behindDays: 7 });

// 舊管理分頁（#/admin/<區塊>）的組長區塊 → 新分頁
export const LEGACY_SECTION_TABS = Object.freeze({
  "join-status": "roster",
  members: "roster",
  teams: "teams",
  statistics: "overview",
  quizzes: "quizzes",
  exam: "quizzes"
});

export const SCOPE_LEVELS = Object.freeze(["greatRegion", "pastoralZone", "smallGroup"]);
export const SCOPE_LEVEL_LABEL = Object.freeze({ greatRegion: "大區", pastoralZone: "牧區", smallGroup: "小組" });
export const UNSET_UNIT_LABEL = "未設定";

export const ROSTER_FILTERS = Object.freeze([
  { id: "all", label: "全部" },
  { id: "care", label: "需要關心" },
  { id: "not_enrolled", label: "未報名" },
  { id: "behind", label: "落後" },
  { id: "no_team", label: "未組隊" },
  { id: "completed", label: "讀完一遍" }
]);

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

export function resolvePastoralTab(value) {
  const text = String(value || "");
  if (PASTORAL_TABS.includes(text)) return text;
  return LEGACY_SECTION_TABS[text] || null;
}

// 台北時間的日期 YYYY-MM-DD
export function taipeiDateKey(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" && DATE_KEY_RE.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function daysBetweenKeys(fromKey, toKey) {
  if (!DATE_KEY_RE.test(String(fromKey || "")) || !DATE_KEY_RE.test(String(toKey || ""))) return null;
  const from = Date.UTC(...String(fromKey).split("-").map((part, index) => Number(part) - (index === 1 ? 1 : 0)));
  const to = Date.UTC(...String(toKey).split("-").map((part, index) => Number(part) - (index === 1 ? 1 : 0)));
  return Math.round((to - from) / DAY_MS);
}

// 一個計畫的比對尺：baselineDays 由呼叫端用 window.getCanonicalStageScheduleDays(plan) 算好傳入。
// today 是伺服器回的台北日期；應讀天數算到 today（含）。
export function buildPlanContext({ plan, baselineDays, bibleBooks = [], today }) {
  const days = Array.isArray(baselineDays) ? baselineDays : [];
  const startKey = String((plan && (plan.startDate || plan.start_date)) || "").slice(0, 10);
  const todayKey = taipeiDateKey(today) || taipeiDateKey(new Date());
  const expectedDays = countExpectedScheduleDays(days, startKey, new Date(`${todayKey}T12:00:00`));
  const chaptersByBook = new Map((Array.isArray(bibleBooks) ? bibleBooks : [])
    .filter((book) => book && book.name)
    .map((book) => [String(book.name), Number(book.chapters) || 0]));
  const elapsed = daysBetweenKeys(startKey, todayKey);
  return {
    baselineDays: days,
    expectedDays,
    startKey,
    todayKey,
    started: elapsed !== null && elapsed >= 0,
    daysSinceStart: elapsed,
    chaptersByBook
  };
}

function countBookChapters(books, chaptersByBook) {
  return (Array.isArray(books) ? books : []).reduce((sum, name) => sum + (chaptersByBook.get(String(name)) || 0), 0);
}

function unitName(value) {
  const text = String(value || "").trim();
  return text || UNSET_UNIT_LABEL;
}

const STATUS_LABEL = {
  not_enrolled: "未報名",
  not_started: "未開始",
  on_track: "在進度上"
};

// RPC 的一列 → 畫面用的一個人。判斷順序同 plan-stats.js 的參與者總覽（別人的那條路）。
export function describePerson(raw, ctx) {
  const person = raw || {};
  const enrollment = person.enrollment && typeof person.enrollment === "object" ? person.enrollment : null;
  const teams = (Array.isArray(person.teams) ? person.teams : []).map((team) => ({
    id: String(team.id || ""),
    name: String(team.name || ""),
    division: Number(team.division) || 0,
    status: String(team.status || ""),
    size: Number(team.size) || 0,
    captain: team.captain === true
  }));
  const quiz = {
    published: Math.max(0, Number(person.quiz && person.quiz.published) || 0),
    submitted: Math.max(0, Number(person.quiz && person.quiz.submitted) || 0)
  };
  const base = {
    id: String(person.id || ""),
    name: String(person.name || ""),
    greatRegion: String(person.greatRegion || ""),
    pastoralZone: String(person.pastoralZone || ""),
    smallGroup: String(person.smallGroup || ""),
    teams,
    team3: teams.find((team) => team.division === 3) || null,
    team6: teams.find((team) => team.division === 6) || null,
    quiz
  };
  if (!enrollment) {
    return {
      ...base,
      enrolled: false,
      status: "not_enrolled",
      statusLabel: STATUS_LABEL.not_enrolled,
      round: 0,
      progress: 0,
      chapters: 0,
      diff: null,
      behindDays: 0,
      lastReadAt: null,
      lastReadKey: "",
      daysSinceRead: null,
      readDays7: 0,
      activeThisWeek: false,
      completedOnce: false,
      onTrack: false,
      care: false,
      careReasons: []
    };
  }

  const chapters = Math.max(0, Number(enrollment.chapters) || 0);
  const maxRound = Number(enrollment.maxRound) || 0;
  const round = getConfirmedReadingRound({
    currentRound: enrollment.round,
    upgradePromptHandled: enrollment.upgradeHandled === true,
    logs: maxRound > 0 ? [{ round: maxRound }] : []
  });
  const total = countBookChapters(enrollment.books, ctx.chaptersByBook);
  const byRound = enrollment.byRound && typeof enrollment.byRound === "object" ? enrollment.byRound : {};
  const roundRead = Math.max(0, Number(byRound[String(round)]) || 0);
  const progress = total > 0 ? Math.min(100, Math.round(roundRead / total * 100)) : 0;
  const hasRead = chapters > 0;
  const completedOnce = round > 1;
  const completedDays = completedOnce
    ? ctx.baselineDays.length
    : countScheduleDaysCoveredByChapters(ctx.baselineDays, chapters);
  const diff = completedDays - ctx.expectedDays;

  let status = hasRead ? "on_track" : "not_started";
  let statusLabel = hasRead ? STATUS_LABEL.on_track : STATUS_LABEL.not_started;
  if (hasRead && round === 1 && progress >= 100) {
    status = "first_round_done";
    statusLabel = "第一遍完成";
  } else if (hasRead && round > 1) {
    status = "later_round";
    statusLabel = progress > 0 ? `第${round}遍完成${progress}%` : `第${round}遍進行中`;
  } else if (hasRead && diff > 0) {
    status = "ahead";
    statusLabel = `超前 ${diff}天`;
  } else if (hasRead && diff < 0) {
    status = diff === -1 ? "today_pending" : "behind";
    statusLabel = diff === -1 ? "今日未完成" : `落後 ${Math.abs(diff)}天`;
  }

  const readOnce = status === "first_round_done" || status === "later_round";
  // 還沒開始讀的人也用同一把尺：應讀天數 ≤ 1 時（計畫第一天）不算落後
  const behindDays = readOnce ? 0 : Math.max(0, -diff);
  const lastReadAt = enrollment.lastReadAt || null;
  const lastReadKey = taipeiDateKey(lastReadAt);
  const daysSinceRead = lastReadKey ? daysBetweenKeys(lastReadKey, ctx.todayKey) : null;
  const readDays7 = Math.max(0, Number(enrollment.readDays7) || 0);

  const careReasons = [];
  if (!readOnce && ctx.started) {
    if (behindDays >= CARE_THRESHOLDS.behindDays) careReasons.push({ type: "behind", days: behindDays });
    if (daysSinceRead !== null && daysSinceRead >= CARE_THRESHOLDS.noCheckInDays) {
      careReasons.push({ type: "no_checkin", days: daysSinceRead });
    } else if (daysSinceRead === null && (ctx.daysSinceStart || 0) >= CARE_THRESHOLDS.noCheckInDays) {
      careReasons.push({ type: "never_read", days: ctx.daysSinceStart });
    }
  }

  return {
    ...base,
    enrolled: true,
    status,
    statusLabel,
    round,
    progress,
    chapters,
    diff,
    behindDays,
    lastReadAt,
    lastReadKey,
    daysSinceRead,
    readDays7,
    activeThisWeek: readDays7 > 0,
    completedOnce: readOnce,
    onTrack: readOnce || diff >= -1,
    care: careReasons.length > 0,
    careReasons
  };
}

export function describePeople(rows, ctx) {
  return (Array.isArray(rows) ? rows : []).map((row) => describePerson(row, ctx));
}

export function careReasonText(reason) {
  if (!reason) return "";
  if (reason.type === "behind") return `落後 ${reason.days} 天`;
  if (reason.type === "no_checkin") return `${reason.days} 天沒打卡`;
  if (reason.type === "never_read") return "報名後還沒開始讀";
  return "";
}

// 進度漏斗：每一層都是「範圍內」的人數，比例也對範圍內算
export function summarizeFunnel(people) {
  const list = Array.isArray(people) ? people : [];
  const enrolled = list.filter((person) => person.enrolled);
  return {
    inScope: list.length,
    enrolled: enrolled.length,
    active7: enrolled.filter((person) => person.activeThisWeek).length,
    onTrack: enrolled.filter((person) => person.onTrack).length,
    completedOnce: enrolled.filter((person) => person.completedOnce).length,
    care: enrolled.filter((person) => person.care).length
  };
}

export function ratio(part, whole) {
  return whole > 0 ? Math.round(part / whole * 100) : 0;
}

// 需要關心：落後最多的排前面，再來是最久沒打卡
export function selectCareList(people) {
  const score = (person) => Math.max(...person.careReasons.map((reason) => Number(reason.days) || 0), 0);
  return (Array.isArray(people) ? people : [])
    .filter((person) => person.care)
    .sort((a, b) => b.behindDays - a.behindDays || score(b) - score(a) || a.name.localeCompare(b.name, "zh-Hant"));
}

// 範圍選單的選項：只從資料裡出現過的單位組出來（管得到的才會出現）
export function buildScopeOptions(people, { compare = null } = {}) {
  const list = Array.isArray(people) ? people : [];
  const sortNames = (names, level) => {
    const unique = Array.from(new Set(names));
    const comparator = typeof compare === "function" ? compare(level) : null;
    return unique.sort((a, b) => {
      if (a === UNSET_UNIT_LABEL || b === UNSET_UNIT_LABEL) return a === UNSET_UNIT_LABEL ? 1 : -1;
      return comparator ? comparator(a, b) : a.localeCompare(b, "zh-Hant");
    });
  };
  return (scope = {}) => {
    const inRegion = list.filter((person) => !scope.greatRegion || unitName(person.greatRegion) === scope.greatRegion);
    const inZone = inRegion.filter((person) => !scope.pastoralZone || unitName(person.pastoralZone) === scope.pastoralZone);
    return {
      greatRegion: sortNames(list.map((person) => unitName(person.greatRegion)), "greatRegion"),
      pastoralZone: sortNames(inRegion.map((person) => unitName(person.pastoralZone)), "pastoralZone"),
      smallGroup: sortNames(inZone.map((person) => unitName(person.smallGroup)), "smallGroup")
    };
  };
}

// 改上層時，下層選項不在新範圍裡就清掉
export function normalizeScope(scope, optionsFor) {
  const next = { greatRegion: "", pastoralZone: "", smallGroup: "", ...(scope || {}) };
  for (const level of SCOPE_LEVELS) {
    const options = optionsFor(next)[level];
    if (next[level] && !options.includes(next[level])) next[level] = "";
  }
  return next;
}

export function filterByScope(people, scope = {}) {
  return (Array.isArray(people) ? people : []).filter((person) => SCOPE_LEVELS.every((level) =>
    !scope[level] || unitName(person[level]) === scope[level]));
}

// 下一層比較：範圍內橫跨兩個以上的大區就比大區，否則看牧區，再看小組；只有一個小組就不比
export function pickUnitLevel(people) {
  const list = Array.isArray(people) ? people : [];
  for (const level of SCOPE_LEVELS) {
    if (new Set(list.map((person) => unitName(person[level]))).size > 1) return level;
  }
  return null;
}

export function compareUnits(people, level, { compare = null } = {}) {
  if (!level) return [];
  const groups = new Map();
  for (const person of Array.isArray(people) ? people : []) {
    const name = unitName(person[level]);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(person);
  }
  const comparator = typeof compare === "function" ? compare(level) : null;
  return Array.from(groups.entries())
    .map(([name, members]) => ({ name, ...summarizeFunnel(members) }))
    .sort((a, b) => {
      if (a.name === UNSET_UNIT_LABEL || b.name === UNSET_UNIT_LABEL) return a.name === UNSET_UNIT_LABEL ? 1 : -1;
      return comparator ? comparator(a.name, b.name) : a.name.localeCompare(b.name, "zh-Hant");
    });
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
