// #551 App 管理分頁的計算。落後／超前的判斷要和計畫統計的參與者總覽
// （plan-stats.js renderGroupParticipantsRankingTable）同一套，所以這裡的期望值直接照那邊的規則寫。
import { describe, expect, it } from "vitest";
import * as metrics from "./pastoral-metrics.mjs";
import * as planReport from "../../supabase/functions/_shared/progress/plan-report.mjs";
import {
  CARE_THRESHOLDS,
  buildPlanContext,
  buildScopeOptions,
  careReasonText,
  compareQuizUnits,
  compareUnits,
  countRosterConditions,
  daysBetweenKeys,
  defaultRosterFilters,
  describePeople,
  describePerson,
  filterByScope,
  filterPlanRoster,
  normalizeScope,
  pickUnitLevel,
  ratio,
  resolvePastoralTab,
  rosterPerson,
  selectCareList,
  summarizeFunnel,
  summarizeQuiz,
  summarizeTeams,
  taipeiDateKey,
  teamLabel
} from "./pastoral-metrics.mjs";

// 30 天、每天 3 章（創世記 50＋出埃及記 40 = 90 章）。10/1 開始，今天 10/12 → 應讀 12 天。
const BOOKS = [{ name: "創世記", chapters: 50 }, { name: "出埃及記", chapters: 40 }];
const DAYS = Array.from({ length: 30 }, (_, index) => ({ chapters: [{}, {}, {}], index }));
// 單位名稱的排序跟著 zh-Hant 定序（沒給教會順序時）
const zhSorted = (names) => [...names].sort((a, b) => a.localeCompare(b, "zh-Hant"));
const ctx = buildPlanContext({ plan: { startDate: "2026-10-01" }, baselineDays: DAYS, bibleBooks: BOOKS, today: "2026-10-12" });

const person = (id, enrollment, extra = {}) => ({
  id,
  name: id,
  greatRegion: "東區",
  pastoralZone: "一牧區",
  smallGroup: "甲組",
  enrollment: enrollment && {
    planId: `plan-${id}`,
    round: 1,
    upgradeHandled: false,
    books: ["創世記", "出埃及記"],
    byRound: { 1: enrollment.chapters ?? 0 },
    maxRound: (enrollment.chapters ?? 0) > 0 ? 1 : null,
    lastReadAt: "2026-10-12T01:00:00Z",
    readDays7: 3,
    ...enrollment
  },
  teams: [],
  quiz: { published: 0, submitted: 0 },
  ...extra
});

describe("plan context", () => {
  it("counts expected days up to today (inclusive) on the church's baseline schedule", () => {
    expect(ctx.expectedDays).toBe(12);
    expect(ctx.started).toBe(true);
    expect(ctx.daysSinceStart).toBe(11);
    expect(ctx.chaptersByBook.get("創世記")).toBe(50);
  });

  it("before the start nothing is expected and nobody needs care", () => {
    const early = buildPlanContext({ plan: { startDate: "2026-10-20" }, baselineDays: DAYS, bibleBooks: BOOKS, today: "2026-10-12" });
    expect(early.expectedDays).toBe(0);
    expect(early.started).toBe(false);
    expect(describePerson(person("p", { chapters: 0, lastReadAt: null }), early).care).toBe(false);
  });

  it("dates are Taipei dates", () => {
    expect(taipeiDateKey("2026-10-08T23:30:00Z")).toBe("2026-10-09");
    expect(taipeiDateKey("2026-10-09")).toBe("2026-10-09");
    expect(taipeiDateKey(null)).toBe("");
    expect(taipeiDateKey("nonsense")).toBe("");
    expect(daysBetweenKeys("2026-09-30", "2026-10-02")).toBe(2);
    expect(daysBetweenKeys("", "2026-10-02")).toBeNull();
  });
});

describe("status: same order and labels as the participant overview", () => {
  const cases = [
    ["on schedule", { chapters: 36 }, "on_track", "在進度上", 0],
    ["one day short is 今日未完成", { chapters: 33 }, "today_pending", "今日未完成", -1],
    ["behind", { chapters: 9 }, "behind", "落後 9天", -9],
    ["ahead", { chapters: 45 }, "ahead", "超前 3天", 3],
    ["first round done", { chapters: 90, byRound: { 1: 90 } }, "first_round_done", "第一遍完成", 18],
    ["not started", { chapters: 0, lastReadAt: null, readDays7: 0 }, "not_started", "未開始", -12]
  ];
  for (const [label, enrollment, status, statusLabel, diff] of cases) {
    it(label, () => {
      const result = describePerson(person("p", enrollment), ctx);
      expect(result).toMatchObject({ enrolled: true, status, statusLabel, diff });
    });
  }

  it("a later round counts as completed once, whatever the calendar says", () => {
    const later = describePerson(person("p", { round: 2, upgradeHandled: true, chapters: 135, maxRound: 2, byRound: { 1: 90, 2: 45 }, lastReadAt: "2026-10-01T00:00:00Z" }), ctx);
    expect(later).toMatchObject({ status: "later_round", statusLabel: "第2遍完成50%", round: 2, progress: 50, completedOnce: true, behindDays: 0, care: false });
    const fresh = describePerson(person("p", { round: 2, upgradeHandled: true, chapters: 90, maxRound: 1, byRound: { 1: 90 } }), ctx);
    expect(fresh.statusLabel).toBe("第2遍進行中");
  });

  it("a stored round 2 that was never confirmed stays round 1 (getConfirmedReadingRound)", () => {
    const unconfirmed = describePerson(person("p", { round: 2, upgradeHandled: false, chapters: 36, maxRound: 1 }), ctx);
    expect(unconfirmed).toMatchObject({ round: 1, status: "on_track", completedOnce: false });
  });

  it("progress is this round's chapters over the plan's books", () => {
    expect(describePerson(person("p", { chapters: 45 }), ctx).progress).toBe(50);
    expect(describePerson(person("p", { chapters: 45, books: [] }), ctx).progress).toBe(0);
  });

  it("not enrolled", () => {
    expect(describePerson(person("p", null), ctx)).toMatchObject({ enrolled: false, status: "not_enrolled", statusLabel: "未報名", care: false });
  });
});

describe("需要關心 (3 days without a check-in, 7 days behind)", () => {
  it("uses the maintainer's thresholds", () => {
    expect(CARE_THRESHOLDS).toEqual({ noCheckInDays: 3, behindDays: 7 });
  });

  it("behind by 7 or more", () => {
    expect(describePerson(person("p", { chapters: 18 }), ctx).careReasons).toEqual([]);
    expect(describePerson(person("p", { chapters: 15 }), ctx).careReasons).toEqual([{ type: "behind", days: 7 }]);
  });

  it("3 or more days since the last check-in (Taipei dates)", () => {
    expect(describePerson(person("p", { chapters: 36, lastReadAt: "2026-10-10T15:59:00Z" }), ctx).care).toBe(false);
    expect(describePerson(person("p", { chapters: 36, lastReadAt: "2026-10-09T03:00:00Z" }), ctx).careReasons).toEqual([{ type: "no_checkin", days: 3 }]);
  });

  it("enrolled but never read, once the plan has run 3 days", () => {
    const never = describePerson(person("p", { chapters: 0, lastReadAt: null }), ctx);
    expect(never.careReasons).toEqual([{ type: "behind", days: 12 }, { type: "never_read", days: 11 }]);
    expect(never.careReasons.map(careReasonText)).toEqual(["落後 12 天", "報名後還沒開始讀"]);
  });

  it("people who finished a round are never flagged", () => {
    expect(describePerson(person("p", { chapters: 90, byRound: { 1: 90 }, lastReadAt: "2026-09-01T00:00:00Z" }), ctx).care).toBe(false);
  });

  it("the list puts the furthest behind first, then the longest silence", () => {
    const people = describePeople([
      person("a", { chapters: 33, lastReadAt: "2026-10-05T00:00:00Z" }),
      person("b", { chapters: 0, lastReadAt: null }),
      person("c", { chapters: 9 }),
      person("d", { chapters: 36 })
    ], ctx);
    expect(selectCareList(people).map((item) => item.id)).toEqual(["b", "c", "a"]);
  });
});

describe("overview funnel and unit comparison", () => {
  const people = describePeople([
    person("a", { chapters: 36 }, { greatRegion: "東區", pastoralZone: "一牧區" }),
    person("b", { chapters: 9, readDays7: 0 }, { greatRegion: "東區", pastoralZone: "二牧區" }),
    person("c", { chapters: 90, byRound: { 1: 90 } }, { greatRegion: "西區", pastoralZone: "三牧區" }),
    person("d", null, { greatRegion: "西區", pastoralZone: "三牧區" }),
    person("e", null, { greatRegion: "", pastoralZone: "" })
  ], ctx);

  it("every stage counts people in scope", () => {
    expect(summarizeFunnel(people)).toEqual({ inScope: 5, enrolled: 3, active7: 2, onTrack: 2, completedOnce: 1, care: 1 });
    expect(ratio(2, 3)).toBe(67);
    expect(ratio(1, 0)).toBe(0);
  });

  it("compares the next level down, unset units last", () => {
    expect(pickUnitLevel(people)).toBe("greatRegion");
    const counts = { 東區: [2, 2], 西區: [2, 1] };
    expect(compareUnits(people, "greatRegion").map((row) => [row.name, row.inScope, row.enrolled])).toEqual([
      ...zhSorted(["東區", "西區"]).map((name) => [name, ...counts[name]]),
      ["未設定", 1, 0]
    ]);
    const east = filterByScope(people, { greatRegion: "東區" });
    expect(pickUnitLevel(east)).toBe("pastoralZone");
    expect(pickUnitLevel(filterByScope(people, { greatRegion: "東區", pastoralZone: "一牧區" }))).toBeNull();
    expect(compareUnits(people, null)).toEqual([]);
  });

  it("scope options come only from people in the data, and a stale lower level is cleared", () => {
    const optionsFor = buildScopeOptions(people);
    expect(optionsFor({}).greatRegion).toEqual([...zhSorted(["東區", "西區"]), "未設定"]);
    expect(optionsFor({ greatRegion: "東區" }).pastoralZone).toEqual(zhSorted(["一牧區", "二牧區"]));
    expect(normalizeScope({ greatRegion: "西區", pastoralZone: "一牧區" }, optionsFor)).toEqual({ greatRegion: "西區", pastoralZone: "", smallGroup: "" });
    expect(filterByScope(people, { greatRegion: "未設定" }).map((item) => item.id)).toEqual(["e"]);
  });

  it("uses the church's display order when given", () => {
    const order = ["西區", "東區"];
    const optionsFor = buildScopeOptions(people, { compare: () => (a, b) => order.indexOf(a) - order.indexOf(b) });
    expect(optionsFor({}).greatRegion).toEqual(["西區", "東區", "未設定"]);
    const reversed = buildScopeOptions(people, { compare: () => (a, b) => order.indexOf(b) - order.indexOf(a) });
    expect(reversed({}).greatRegion).toEqual(["東區", "西區", "未設定"]);
  });
});

describe("roster (#570): the server's rows, the console's filter rules", () => {
  const report = {
    plan: { id: "plan-1", name: "2026 第四季", books: [] },
    ctx,
    people: describePeople([
      person("王小明", { chapters: 9 }),
      person("李大華", null),
      person("陳美玲", { chapters: 36 }, { teams: [{ id: "t1", name: "火箭隊", division: 3, status: "active", size: 3, captain: true }] }),
      person("林志強", { chapters: 90, byRound: { 1: 90 } })
    ], ctx),
    meta: { consistent: true }
  };
  const rows = planReport.buildPlanRoster(report).people.map(rosterPerson);

  it("uses the same filter, sort and drill rules as the admin console", () => {
    for (const name of ["filterPlanRoster", "sortPlanRoster", "defaultRosterFilters", "drillRosterFilters", "presetRosterFilters", "activeRosterPreset", "countRosterConditions"]) {
      expect(metrics[name]).toBe(planReport[name]);
    }
  });

  it("defaults to enrolled people sorted by days behind; the 未報名 bucket and the care shortcut", () => {
    const enrolled = metrics.sortPlanRoster(filterPlanRoster(rows, defaultRosterFilters()), "behind");
    expect(enrolled.map((row) => row.id)).toEqual(["王小明", "林志強", "陳美玲"]);
    expect(filterPlanRoster(rows, { ...defaultRosterFilters(), progress: ["not_enrolled"] }).map((row) => row.id)).toEqual(["李大華"]);
    expect(filterPlanRoster(rows, metrics.drillRosterFilters("care")).map((row) => row.id)).toEqual(["王小明"]);
    expect(filterPlanRoster(rows, { ...defaultRosterFilters(), team: "no" }).map((row) => row.id)).toEqual(["王小明", "林志強"]);
  });

  it("counts conditions for the collapsed 篩選（N 個條件）header", () => {
    expect(countRosterConditions(defaultRosterFilters())).toBe(0);
    expect(countRosterConditions({ ...defaultRosterFilters(), progress: ["behind"], team: "yes" })).toBe(2);
    expect(countRosterConditions(metrics.drillRosterFilters("careBehind"))).toBe(1);
  });

  it("rosterPerson adds what the teams and quiz tabs need", () => {
    const chen = rows.find((row) => row.id === "陳美玲");
    expect(chen.team3).toMatchObject({ name: "火箭隊", captain: true });
    expect(chen.team6).toBeNull();
    expect(rows.find((row) => row.id === "林志強").completedOnce).toBe(true);
    expect(rows.find((row) => row.id === "李大華")).toMatchObject({ enrolled: false, lastReadKey: "", completedOnce: false });
    expect(rosterPerson({ id: "x" })).toMatchObject({ name: "", teams: [], careReasons: [], quiz: { published: 0, submitted: 0 } });
  });

  it("offers no CSV export in the App (exports live in the console, generated and audited by the server)", () => {
    expect(metrics.buildRosterCsv).toBeUndefined();
    expect(metrics.buildTeamsCsv).toBeUndefined();
  });
});

describe("teams", () => {
  const team3 = { id: "t1", name: "火箭隊", division: 3, status: "active", size: 3, captain: false };
  const team6 = { id: "t2", name: "=cmd", division: 6, status: "forming", size: 4, captain: false };
  const people = describePeople([
    person("a", { chapters: 36 }, { teams: [{ ...team3, captain: true }, team6] }),
    person("b", { chapters: 36 }, { teams: [team3] }),
    person("c", { chapters: 36 }),
    person("d", null)
  ], ctx);

  it("lists each team once with members in scope; open teams first", () => {
    const summary = summarizeTeams(people);
    expect(summary).toMatchObject({ enrolled: 3, in3: 2, in6: 1, inAny: 2 });
    expect(summary.noTeam.map((item) => item.id)).toEqual(["c"]);
    expect(summary.teams.map((team) => [team.name, team.full, team.missing, team.members.map((member) => member.name)])).toEqual([
      ["=cmd", false, 2, ["a"]],
      ["火箭隊", true, 0, ["a", "b"]]
    ]);
    expect(summary.openTeams).toHaveLength(1);
    expect(summary.teams[1].members[0]).toEqual({ name: "a", captain: true });
    expect(teamLabel(team6)).toBe("=cmd（6 人隊，4/6）");
    expect(teamLabel(team3)).toBe("火箭隊（3 人隊）");
  });
});

describe("quizzes: participation only, no ranking", () => {
  const people = describePeople([
    person("a", { chapters: 36 }, { quiz: { published: 4, submitted: 4 } }),
    person("b", { chapters: 36 }, { quiz: { published: 4, submitted: 0 } }),
    person("c", { chapters: 36 }, { quiz: { published: 2, submitted: 9 }, greatRegion: "西區" }),
    person("d", { chapters: 36 }, { quiz: { published: 0, submitted: 0 } }),
    person("e", null, { quiz: { published: 4, submitted: 1 } })
  ], ctx);

  it("counts enrolled people who were sent quizzes; submissions never exceed what was sent", () => {
    const summary = summarizeQuiz(people);
    expect(summary).toMatchObject({ eligible: 3, answeredAny: 2, published: 10, submitted: 6, rate: 60 });
    expect(summary.neverAnswered.map((item) => item.id)).toEqual(["b"]);
    expect(Object.keys(summary)).not.toContain("ranking");
  });

  it("compares units that had quizzes", () => {
    const rows = { 東區: [2, 50], 西區: [1, 100] };
    expect(compareQuizUnits(people, "greatRegion").map((row) => [row.name, row.eligible, row.rate]))
      .toEqual(zhSorted(["東區", "西區"]).map((name) => [name, ...rows[name]]));
  });
});

describe("tabs and old links", () => {
  it("old leader section names open the matching tab", () => {
    expect(resolvePastoralTab("roster")).toBe("roster");
    expect(resolvePastoralTab("join-status")).toBe("roster");
    expect(resolvePastoralTab("members")).toBe("roster");
    expect(resolvePastoralTab("statistics")).toBe("overview");
    expect(resolvePastoralTab("exam")).toBe("quizzes");
    expect(resolvePastoralTab("users")).toBeNull();
    expect(resolvePastoralTab("")).toBeNull();
  });
});

describe("roster condition chips (#584)", () => {
  const base = defaultRosterFilters();

  it("the default 報名者 has no chips; 需要關心 is the fixed shortcut chip, not a removable one", () => {
    expect(metrics.rosterConditionChips(base)).toEqual([]);
    expect(metrics.rosterConditionChips({ ...base, shortcut: "care" })).toEqual([]);
  });

  it("names shortcuts, the ticked buckets and the team; clearing one resets only that condition", () => {
    expect(metrics.rosterConditionChips({ ...base, shortcut: "care_behind", team: "yes" }).map((chip) => chip.label))
      .toEqual([`需要關心・落後 ${CARE_THRESHOLDS.behindDays} 天以上`, "有隊"]);
    const filters = { ...base, progress: ["behind_long"], checkin: ["dormant", "none"], team: "no" };
    expect(metrics.rosterConditionChips(filters)).toEqual([
      { id: "progress", label: "落後 7 天以上" },
      { id: "checkin", label: "最後打卡：7 天以上、沒有紀錄" },
      { id: "team", label: "沒有隊" }
    ]);
    expect(metrics.rosterConditionChips({ ...base, progress: [...base.progress, "not_enrolled"] }).map((chip) => chip.label)).toEqual(["含未報名"]);
    const cleared = metrics.clearRosterCondition(filters, "checkin");
    expect(cleared).toEqual({ ...filters, checkin: base.checkin });
    expect(countRosterConditions(cleared)).toBe(2);
    expect(metrics.clearRosterCondition({ ...base, shortcut: "active7" }, "shortcut")).toEqual(base);
  });
});
