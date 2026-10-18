// 計畫總覽與名單（#564）：SQL 回的「每人一列」事實 + global_plans 一列 → 用和會友 App 同一份規則
// （plan-progress.mjs）算出每個人的狀態，再組成兩種回應：
//   · 總覽（plan_summary）：只有數字——漏斗、兩個條件各格人數、需要關心（分原因）、單位比較、今天的日程。
//     不含任何人的名字。
//   · 名單（plan_roster）：範圍內每人一列，展開需要的欄位都在裡面（前端展開一列不再發請求）；不帶 email。
// admin-api（全教會）與 nlc-data（組長，範圍由伺服器依身分決定）共用。
//
// 不漏：SQL 另外數的人數（meta）和這裡算出來的對不上時，meta.consistent＝false，前端要警告、不快取。
import { BIBLE_BOOK_CHAPTERS } from "./bible-chapters.mjs";
import { buildGlobalPlanBaseline } from "./plan-schedule.mjs";
import {
  CHECKIN_BUCKETS,
  PROGRESS_BUCKETS,
  SCOPE_LEVELS,
  buildPlanContext,
  buildScopeOptions,
  compareUnits,
  countBuckets,
  countCareReasons,
  describePeople,
  filterByScope,
  normalizeScope,
  pickUnitLevel,
  summarizeFunnel,
  unitName
} from "./plan-progress.mjs";

export { CHECKIN_BUCKETS, PROGRESS_BUCKETS };

const MAX_UNIT_NAME_CHARS = 100;

// 總覽的範圍篩選（只是在授權範圍內再縮小，例如展開某個大區）：{ greatRegion, pastoralZone, smallGroup }
export function parseScopeFilter(value) {
  if (value === undefined || value === null) return { ok: true, scope: {} };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid_org_filter" };
  const scope = {};
  for (const level of SCOPE_LEVELS) {
    const raw = value[level];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string" || raw.length > MAX_UNIT_NAME_CHARS) return { ok: false, error: "invalid_org_filter" };
    scope[level] = raw;
  }
  return { ok: true, scope };
}

// global_plans 一列 → 比對尺與計畫欄位；SQL 要的 preset key 也從這裡來（和 App 的 plan.presetKey 相同）
export function resolvePlanForReport(planRow, { bibleBooks = BIBLE_BOOK_CHAPTERS } = {}) {
  return buildGlobalPlanBaseline(planRow, { bibleBooks });
}

function reconcile(sqlMeta, people) {
  const meta = sqlMeta && typeof sqlMeta === "object" ? sqlMeta : {};
  const inScope = Number.isInteger(meta.inScope) ? meta.inScope : null;
  const enrolled = Number.isInteger(meta.enrolled) ? meta.enrolled : null;
  const rows = people.length;
  const rowsEnrolled = people.filter((person) => person.enrolled).length;
  return { inScope, enrolled, rows, rowsEnrolled, consistent: inScope === rows && enrolled === rowsEnrolled };
}

// SQL 的 { today, people, meta } + 比對尺 → 每個人都判斷好的報表
export function preparePlanReport({ resolved, overview, bibleBooks = BIBLE_BOOK_CHAPTERS }) {
  const { plan, baselineDays } = resolved;
  const data = overview && typeof overview === "object" ? overview : {};
  const today = typeof data.today === "string" ? data.today.slice(0, 10) : "";
  const ctx = buildPlanContext({ plan, baselineDays, bibleBooks, today });
  const rows = (Array.isArray(data.people) ? data.people : []).filter((row) => row && typeof row === "object" && typeof row.id === "string");
  const people = describePeople(rows, ctx);
  return { plan, ctx, people, meta: reconcile(data.meta, people) };
}

function planInfo(report) {
  const { plan } = report;
  return {
    id: plan.id,
    name: plan.name,
    planKind: plan.planKind,
    startDate: plan.startDate,
    endDate: plan.endDate,
    books: Array.isArray(plan.books) ? plan.books : [],
    presetKey: plan.presetKey
  };
}

// 一天的章節 → [{ book, from, to }]（同一卷連續的章合併）
function chapterRanges(chapters) {
  const ranges = [];
  for (const ch of Array.isArray(chapters) ? chapters : []) {
    const last = ranges[ranges.length - 1];
    if (last && last.book === ch.book && last.to + 1 === ch.chapter) last.to = ch.chapter;
    else ranges.push({ book: ch.book, from: ch.chapter, to: ch.chapter });
  }
  return ranges;
}

// 狀態列：第幾天、今天應讀哪些章、到今天應讀幾天
function scheduleInfo(ctx) {
  const days = ctx.baselineDays;
  const index = ctx.daysSinceStart;
  const inRange = ctx.started && index !== null && index < days.length;
  return {
    totalDays: days.length,
    totalChapters: days.reduce((sum, day) => sum + (Array.isArray(day.chapters) ? day.chapters.length : 0), 0),
    dayNumber: inRange ? index + 1 : null,
    started: ctx.started,
    ended: ctx.started && index !== null && index >= days.length,
    expectedDays: ctx.expectedDays,
    today: inRange ? chapterRanges(days[index].chapters) : []
  };
}

// 團隊：報名者有沒有隊、隊伍數、還沒滿的隊（#565；隊伍清單與除錯在 #566）
export function summarizeTeams(people) {
  const enrolled = (Array.isArray(people) ? people : []).filter((person) => person.enrolled);
  const teams = new Map();
  for (const person of enrolled) {
    for (const team of person.teams || []) {
      if (team.id && !teams.has(team.id)) teams.set(team.id, team);
    }
  }
  const list = [...teams.values()];
  const withTeam = enrolled.filter((person) => (person.teams || []).length > 0).length;
  return {
    enrolled: enrolled.length,
    withTeam,
    withoutTeam: enrolled.length - withTeam,
    teams: list.length,
    unfilled: list.filter((team) => team.division > 0 && team.size < team.division).length
  };
}

function unitRowsWithTeams(people, level) {
  return compareUnits(people, level).map((row) => ({
    ...row,
    withTeam: people.filter((person) => person.enrolled && unitName(person[level]) === row.name && (person.teams || []).length > 0).length
  }));
}

// 下一層：比較的是大區時，每個大區再附各牧區（後台點大區展開，不另外發請求）
function unitChildren(people, level) {
  const index = SCOPE_LEVELS.indexOf(level);
  const childLevel = index >= 0 ? SCOPE_LEVELS[index + 1] : null;
  if (!childLevel || level !== "greatRegion") return { level: null, rows: {} };
  const rows = {};
  for (const name of new Set(people.map((person) => unitName(person[level])))) {
    rows[name] = unitRowsWithTeams(people.filter((person) => unitName(person[level]) === name), childLevel);
  }
  return { level: childLevel, rows };
}

export function buildPlanSummary(report, scope = {}) {
  const optionsFor = buildScopeOptions(report.people);
  const normalized = normalizeScope(scope, optionsFor);
  const people = filterByScope(report.people, normalized);
  const level = pickUnitLevel(people);
  return {
    plan: planInfo(report),
    today: report.ctx.todayKey,
    schedule: scheduleInfo(report.ctx),
    scope: normalized,
    scopeOptions: optionsFor(normalized),
    funnel: summarizeFunnel(people),
    buckets: countBuckets(people),
    care: countCareReasons(people),
    teams: summarizeTeams(people),
    units: { level, rows: level ? unitRowsWithTeams(people, level) : [], children: unitChildren(people, level) },
    meta: report.meta
  };
}

function rosterRow(person) {
  return {
    id: person.id,
    name: person.name,
    greatRegion: person.greatRegion,
    pastoralZone: person.pastoralZone,
    smallGroup: person.smallGroup,
    enrolled: person.enrolled,
    status: person.status,
    statusLabel: person.statusLabel,
    progressBucket: person.progressBucket,
    checkinBucket: person.checkinBucket,
    round: person.round,
    progress: person.progress,
    chapters: person.chapters,
    byRound: person.byRound,
    behindDays: person.behindDays,
    lastReadAt: person.lastReadAt,
    daysSinceRead: person.daysSinceRead,
    readDays7: person.readDays7,
    care: person.care,
    careReasons: person.careReasons,
    teams: person.teams,
    quiz: person.quiz
  };
}

// 名單預設照落後天數多→少（維護者 2026-10-13），同天數再照姓名
export function buildPlanRoster(report) {
  const people = report.people
    .map(rosterRow)
    .sort((a, b) => b.behindDays - a.behindDays || a.name.localeCompare(b.name, "zh-Hant") || a.id.localeCompare(b.id));
  return {
    plan: planInfo(report),
    today: report.ctx.todayKey,
    progressBuckets: PROGRESS_BUCKETS,
    checkinBuckets: CHECKIN_BUCKETS,
    people,
    meta: report.meta
  };
}

// ── 名單篩選（#565）：後台畫面與伺服器匯出用同一份 ─────────────────────────────
// 「進度」「最後打卡」兩個條件：同一條件內勾幾個＝聯集，條件之間（再加團隊）＝交集。
// 每個人在每個條件剛好落在一格，所以同一條件各格人數相加＝總數，可以對帳。
// 「需要關心」（全部／只看落後／只看沒打卡）「近 7 天有讀」是捷徑：打開時不看進度／打卡兩個條件，
// 從總覽的漏斗、需要關心點進來的人數才會和總覽一模一樣（同一份 careReasons、activeThisWeek）。
export const ROSTER_TEAM_FILTERS = Object.freeze(["any", "yes", "no"]);
export const ROSTER_SORTS = Object.freeze(["behind", "chapters_desc", "chapters_asc"]);
export const ROSTER_SHORTCUTS = Object.freeze(["", "care", "care_behind", "care_checkin", "active7"]);
const MAX_ROSTER_QUERY_CHARS = 50;
const PROGRESS_IDS = PROGRESS_BUCKETS.map((bucket) => bucket.id);
const CHECKIN_IDS = CHECKIN_BUCKETS.map((bucket) => bucket.id);

/** 預設：報名者（進度扣掉未報名）、最後打卡不限、團隊不限 */
export function defaultRosterFilters() {
  return {
    shortcut: "",
    progress: PROGRESS_IDS.filter((id) => id !== "not_enrolled"),
    checkin: [...CHECKIN_IDS],
    team: "any",
    q: ""
  };
}

function pickIds(value, allowed) {
  if (value === undefined || value === null) return [...allowed];
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !allowed.includes(id))) return null;
  return allowed.filter((id) => value.includes(id));
}

/** 名單上方的三個快速按鈕：報名者（預設）／需要關心／全部（含未報名） */
export function presetRosterFilters(preset) {
  const base = defaultRosterFilters();
  if (preset === "care") return { ...base, shortcut: "care" };
  if (preset === "all") return { ...base, progress: [...PROGRESS_IDS] };
  return base;
}

export const ROSTER_PRESETS = Object.freeze(["enrolled", "care", "all"]);

function sameIds(a, b) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** 目前條件是不是三個快速按鈕之一（不看搜尋字）；都不是回 null */
export function activeRosterPreset(filters) {
  for (const preset of ROSTER_PRESETS) {
    const base = presetRosterFilters(preset);
    if (filters.shortcut === base.shortcut && filters.team === base.team
      && sameIds(filters.progress, base.progress) && sameIds(filters.checkin, base.checkin)) return preset;
  }
  return null;
}

/** 篩選區收起來時標題上的「幾個條件」：捷徑算一個；預設的報名者不算（後台與 App 管理分頁共用，#570） */
export function countRosterConditions(filters) {
  if (filters.shortcut) return 1 + (filters.team !== "any" ? 1 : 0);
  const base = defaultRosterFilters();
  return (sameIds(filters.progress, base.progress) ? 0 : 1) + (sameIds(filters.checkin, base.checkin) ? 0 : 1) + (filters.team !== "any" ? 1 : 0);
}

// 總覽點漏斗某一層／需要關心某個數字 → 名單條件。人數一定和總覽那個數字相同（scripts/plan-area.test.mjs 對帳）
const FUNNEL_DRILLS = Object.freeze({
  inScope: () => presetRosterFilters("all"),
  enrolled: () => defaultRosterFilters(),
  active7: () => ({ ...defaultRosterFilters(), shortcut: "active7" }),
  onTrack: () => ({ ...defaultRosterFilters(), progress: ["on_track", "completed"] }),
  completedOnce: () => ({ ...defaultRosterFilters(), progress: ["completed"] }),
  care: () => ({ ...defaultRosterFilters(), shortcut: "care" }),
  careBehind: () => ({ ...defaultRosterFilters(), shortcut: "care_behind" }),
  careCheckin: () => ({ ...defaultRosterFilters(), shortcut: "care_checkin" })
});
export const FUNNEL_DRILL_KEYS = Object.freeze(Object.keys(FUNNEL_DRILLS));

export function drillRosterFilters(key) {
  const make = Object.prototype.hasOwnProperty.call(FUNNEL_DRILLS, key) ? FUNNEL_DRILLS[key] : FUNNEL_DRILLS.enrolled;
  return make();
}

/** 前端送來的條件 → 檢查過的條件；格式不對回 { ok: false } */
export function parseRosterFilters(value) {
  if (value === undefined || value === null) return { ok: true, filters: defaultRosterFilters() };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid_roster_filter" };
  const shortcut = value.shortcut === undefined || value.shortcut === null ? "" : value.shortcut;
  const team = value.team === undefined || value.team === null ? "any" : value.team;
  const q = value.q === undefined || value.q === null ? "" : value.q;
  const progress = pickIds(value.progress, PROGRESS_IDS);
  const checkin = pickIds(value.checkin, CHECKIN_IDS);
  if (!ROSTER_SHORTCUTS.includes(shortcut) || !ROSTER_TEAM_FILTERS.includes(team) || !progress || !checkin
    || typeof q !== "string" || q.length > MAX_ROSTER_QUERY_CHARS) {
    return { ok: false, error: "invalid_roster_filter" };
  }
  return { ok: true, filters: { shortcut, progress, checkin, team, q: q.trim() } };
}

export function rosterRowMatches(row, filters) {
  const reasons = Array.isArray(row.careReasons) ? row.careReasons : [];
  if (filters.shortcut === "care") {
    if (!row.care) return false;
  } else if (filters.shortcut === "care_behind") {
    if (!reasons.some((reason) => reason.type === "behind")) return false;
  } else if (filters.shortcut === "care_checkin") {
    if (!reasons.some((reason) => reason.type === "no_checkin" || reason.type === "never_read")) return false;
  } else if (filters.shortcut === "active7") {
    if (!row.enrolled || !(row.readDays7 > 0)) return false;
  } else if (!filters.progress.includes(row.progressBucket) || !filters.checkin.includes(row.checkinBucket)) {
    return false;
  }
  const hasTeam = Array.isArray(row.teams) && row.teams.length > 0;
  if (filters.team === "yes" && !hasTeam) return false;
  if (filters.team === "no" && (hasTeam || !row.enrolled)) return false;
  if (filters.q) {
    const text = [row.name, row.greatRegion, row.pastoralZone, row.smallGroup].join(" ");
    if (!text.includes(filters.q)) return false;
  }
  return true;
}

export function filterPlanRoster(rows, filters) {
  return (Array.isArray(rows) ? rows : []).filter((row) => rosterRowMatches(row, filters));
}

// 預設落後天數多→少（維護者 2026-10-13：章數會被延後梯次、中途報名、讀第二遍弄失真）
export function sortPlanRoster(rows, sort = "behind") {
  const byName = (a, b) => a.name.localeCompare(b.name, "zh-Hant") || a.id.localeCompare(b.id);
  const compare = sort === "chapters_desc"
    ? (a, b) => b.chapters - a.chapters || byName(a, b)
    : sort === "chapters_asc"
      ? (a, b) => a.chapters - b.chapters || byName(a, b)
      : (a, b) => b.behindDays - a.behindDays || byName(a, b);
  return [...(Array.isArray(rows) ? rows : [])].sort(compare);
}
