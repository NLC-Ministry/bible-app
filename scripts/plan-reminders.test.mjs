import { describe, it, expect } from "vitest";
import {
  mergeChapterRanges,
  formatUnfinishedRanges,
  getUnfinishedChapters,
  getBehindChapterCount,
  getDeadlineInfo,
  resolveGraceDays,
  decideReminderBanners,
  readDismissed,
  saveDismissal,
  DISMISS_STORAGE_KEY,
  diffDays,
  toDateKey
} from "../js/data/plan-reminders.mjs";

const ch = (book, chapter, read = false, round = 1) => ({
  book, chapter, round, ["isReadR" + round]: read
});
const day = (dayNum, y, m, d, chapters) => ({ dayNum, year: y, month: m, date: `${m}/${d}`, chapters });

function makePlan(overrides = {}) {
  return {
    id: "p1",
    name: "第一階段",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    isFixed: true,
    currentRound: 1,
    days: [
      day(1, 2026, 10, 1, [ch("出埃及記", 3, true), ch("出埃及記", 4, false)]),
      day(2, 2026, 10, 2, [ch("出埃及記", 5, false), ch("出埃及記", 6, false)]),
      day(3, 2026, 10, 3, []),
      day(4, 2026, 10, 4, [ch("出埃及記", 7, false), ch("出埃及記", 12, false)])
    ],
    ...overrides
  };
}

describe("mergeChapterRanges", () => {
  it("merges consecutive chapters and keeps gaps", () => {
    const list = [3, 4, 5, 6, 7, 12].map(n => ({ book: "出埃及記", chapter: n }));
    expect(mergeChapterRanges(list)).toEqual([{ book: "出埃及記", text: "3–7、12" }]);
    expect(formatUnfinishedRanges(list)).toBe("出埃及記 3–7、12");
  });
  it("splits by book and does not merge across books", () => {
    const list = [
      { book: "出埃及記", chapter: 39 }, { book: "出埃及記", chapter: 40 },
      { book: "利未記", chapter: 1 }, { book: "利未記", chapter: 2 }, { book: "利未記", chapter: 5 }
    ];
    expect(formatUnfinishedRanges(list)).toBe("出埃及記 39–40；利未記 1–2、5");
  });
  it("handles empty and single", () => {
    expect(formatUnfinishedRanges([])).toBe("");
    expect(formatUnfinishedRanges([{ book: "創世記", chapter: 1 }])).toBe("創世記 1");
  });
});

describe("getUnfinishedChapters", () => {
  it("lists unread chapters of the current round in reading order", () => {
    const list = getUnfinishedChapters(makePlan());
    expect(list.map(c => c.chapter)).toEqual([4, 5, 6, 7, 12]);
  });
  it("only counts the current round (round 2)", () => {
    const plan = makePlan({
      currentRound: 2,
      days: [
        day(1, 2026, 10, 1, [ch("創世記", 1, true, 1), ch("創世記", 1, false, 2)]),
        day(2, 2026, 10, 2, [ch("創世記", 2, true, 1), ch("創世記", 2, true, 2)])
      ]
    });
    expect(getUnfinishedChapters(plan)).toEqual([{ book: "創世記", chapter: 1 }]);
  });
  it("limits to days scheduled up to a date", () => {
    expect(getBehindChapterCount(makePlan(), "2026-10-02")).toBe(3);
    expect(getBehindChapterCount(makePlan(), "2026-09-30")).toBe(0);
  });
});

describe("deadline", () => {
  it("counts days left", () => {
    expect(diffDays("2026-10-01", "2026-10-31")).toBe(30);
    const info = getDeadlineInfo(makePlan(), "2026-10-21");
    expect(info.daysLeft).toBe(10);
    expect(info.text).toBe("截止 10/31（還有 10 天）");
    expect(info.graceNote).toBe("截止後 3 天內仍可補打卡");
  });
  it("respects graceDays, hides note when 0", () => {
    expect(getDeadlineInfo(makePlan({ graceDays: 5 }), "2026-10-21").graceNote).toBe("截止後 5 天內仍可補打卡");
    expect(getDeadlineInfo(makePlan({ grace_days: 0 }), "2026-10-21").graceNote).toBe("");
    expect(resolveGraceDays({})).toBe(3);
    expect(resolveGraceDays({ graceDays: "x" })).toBe(3);
  });
  it("today is the last day, then grace, then closed", () => {
    expect(getDeadlineInfo(makePlan(), "2026-10-31").text).toBe("截止 10/31（今天截止）");
    const grace = getDeadlineInfo(makePlan(), "2026-11-02");
    expect(grace.phase).toBe("grace");
    expect(grace.graceLeft).toBe(1);
    expect(getDeadlineInfo(makePlan(), "2026-11-03").phase).toBe("grace");
    expect(getDeadlineInfo(makePlan(), "2026-11-04").phase).toBe("closed");
  });
  it("no deadline for flexible plans", () => {
    expect(getDeadlineInfo(makePlan({ isFixed: false }), "2026-10-05").phase).toBe("none");
  });
});

describe("decideReminderBanners", () => {
  const plan = makePlan();
  it("shows a normal banner with the behind count", () => {
    const [b] = decideReminderBanners({ plans: [plan], todayKey: "2026-10-02" });
    expect(b.behind).toBe(3);
    expect(b.level).toBe("normal");
    expect(b.message).toBe("本週還差 3 章，截止 10/31");
  });
  it("escalates in the last 3 days and the last day", () => {
    const urgent = decideReminderBanners({ plans: [makePlan({ endDate: "2026-10-05" })], todayKey: "2026-10-03" })[0];
    expect(urgent.level).toBe("urgent");
    const dayBefore = decideReminderBanners({ plans: [makePlan({ endDate: "2026-10-05" })], todayKey: "2026-10-04" })[0];
    expect(dayBefore.level).toBe("final");
    const last = decideReminderBanners({ plans: [makePlan({ endDate: "2026-10-05" })], todayKey: "2026-10-05" })[0];
    expect(last.level).toBe("final");
    expect(last.message).toContain("今天截止");
  });
  it("shows nothing when not behind, not started, closed or non-speed plans", () => {
    expect(decideReminderBanners({ plans: [plan], todayKey: "2026-09-30" })).toEqual([]);
    expect(decideReminderBanners({ plans: [plan], todayKey: "2026-11-10" })).toEqual([]);
    expect(decideReminderBanners({ plans: [makePlan({ planKind: "devotional" })], todayKey: "2026-10-02" })).toEqual([]);
    const done = makePlan({ days: [day(1, 2026, 10, 1, [ch("出埃及記", 3, true)])] });
    expect(decideReminderBanners({ plans: [done], todayKey: "2026-10-02" })).toEqual([]);
  });
  it("shows a grace-period banner after the end date", () => {
    const [b] = decideReminderBanners({ plans: [plan], todayKey: "2026-11-01" });
    expect(b.level).toBe("final");
    expect(b.message).toContain("補打卡");
  });
  it("hides dismissed plans only on the same day", () => {
    const dismissed = { date: "2026-10-02", keys: ["p1"] };
    expect(decideReminderBanners({ plans: [plan], todayKey: "2026-10-02", dismissed })).toEqual([]);
    expect(decideReminderBanners({ plans: [plan], todayKey: "2026-10-03", dismissed })).toHaveLength(1);
  });
});

describe("dismissal storage", () => {
  const fakeStorage = () => {
    const map = new Map();
    return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
  };
  it("round-trips and accumulates keys per day", () => {
    const s = fakeStorage();
    saveDismissal(s, "a", "2026-10-02");
    saveDismissal(s, "b", "2026-10-02");
    expect(readDismissed(s)).toEqual({ date: "2026-10-02", keys: ["a", "b"] });
    saveDismissal(s, "c", "2026-10-03");
    expect(readDismissed(s)).toEqual({ date: "2026-10-03", keys: ["c"] });
    expect(JSON.parse(s.getItem(DISMISS_STORAGE_KEY)).date).toBe("2026-10-03");
  });
  it("never throws when storage is broken", () => {
    const broken = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } };
    expect(readDismissed(broken)).toEqual({ date: "", keys: [] });
    expect(() => saveDismissal(broken, "a", "2026-10-02")).not.toThrow();
    expect(readDismissed(null)).toEqual({ date: "", keys: [] });
  });
  it("toDateKey formats local dates", () => {
    expect(toDateKey(new Date(2026, 9, 5))).toBe("2026-10-05");
  });
});

import { readFileSync } from "node:fs";
describe("wiring (#358)", () => {
  const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  it("index.html has both hosts and the callers exist", () => {
    const html = read("index.html");
    expect(html).toContain('id="plan-reminder-banner"');
    expect(html).toContain('id="plan-unfinished-summary"');
    expect(read("js/modules/home.js")).toContain("refreshPlanReminderBanner();");
    expect(read("js/modules/plan.js")).toContain("renderPlanUnfinishedSummary(state.activePlan);");
  });
});
