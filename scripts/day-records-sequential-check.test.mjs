// #330 當天閱讀紀錄 + #331 照順序打卡
process.env.TZ = "Asia/Taipei";

import { describe, expect, it } from "vitest";
import {
  canToggleRoundChapter,
  countDayReadingRecordsByDate,
  formatSequentialCheckMessage,
  getDayReadingRecords,
  getRoundCheckState,
  getSequentialCheckBlock,
  isSequentialCheckPlan,
  toLocalDateKey
} from "../js/data/current-round-progress.mjs";

describe("toLocalDateKey", () => {
  it("converts UTC timestamps to the local (Taipei) date", () => {
    // 台灣 9/11 07:30 打的卡，UTC 還是 9/10
    expect(toLocalDateKey("2026-09-10T23:30:00+00:00")).toBe("2026-09-11");
    expect(toLocalDateKey("2026-09-10T23:30:00.000Z")).toBe("2026-09-11");
    expect(toLocalDateKey("2026-09-10T15:59:00Z")).toBe("2026-09-10");
  });

  it("keeps date-only strings as they are and rejects junk", () => {
    expect(toLocalDateKey("2026-09-10")).toBe("2026-09-10");
    expect(toLocalDateKey("")).toBe("");
    expect(toLocalDateKey(null)).toBe("");
    expect(toLocalDateKey("not a date")).toBe("");
  });
});

describe("getDayReadingRecords (#330)", () => {
  const scope = {
    planId: "plan-1",
    presetKey: "preset-1",
    chapterOrder: Array.from({ length: 40 }, (_, i) => `出埃及記_${i + 1}`)
  };
  const log = (chapter, round, readAt, extra = {}) => ({
    book: "出埃及記", chapter, round, read_at: readAt, plan_id: "plan-1", ...extra
  });

  it("groups the day's logs by round (latest round first) and merges consecutive chapters", () => {
    const logs = [
      log(3, 30, "2026-09-12T02:00:00Z"),
      log(1, 30, "2026-09-12T01:00:00Z"),
      log(2, 30, "2026-09-12T01:30:00Z"),
      log(4, 30, "2026-09-12T03:00:00Z"),
      log(38, 29, "2026-09-12T00:10:00Z"),
      log(39, 29, "2026-09-12T00:20:00Z"),
      log(40, 29, "2026-09-12T00:30:00Z"),
      log(5, 30, "2026-09-13T01:00:00Z") // 隔天
    ];
    const result = getDayReadingRecords(logs, scope, "2026-09-12");
    expect(result.total).toBe(7);
    expect(result.groups.map(g => g.round)).toEqual([30, 29]);
    expect(result.groups[0].ranges).toEqual([{ book: "出埃及記", from: 1, to: 4 }]);
    expect(result.groups[1].ranges).toEqual([{ book: "出埃及記", from: 38, to: 40 }]);
  });

  it("uses the local date, not the UTC date", () => {
    const logs = [log(7, 2, "2026-09-11T23:30:00Z")]; // 台灣 9/12 07:30
    expect(getDayReadingRecords(logs, scope, "2026-09-11").total).toBe(0);
    expect(getDayReadingRecords(logs, scope, "2026-09-12").total).toBe(1);
  });

  it("excludes other plans, unattributed logs and chapters outside the plan", () => {
    const logs = [
      log(1, 1, "2026-09-12T01:00:00Z", { plan_id: "other-plan" }),
      log(2, 1, "2026-09-12T01:00:00Z", { plan_id: null }),
      { book: "民數記", chapter: 1, round: 1, read_at: "2026-09-12T01:00:00Z", plan_id: "plan-1" },
      log(3, 1, "2026-09-12T01:00:00Z", { plan_id: null, preset_key: "preset-1" })
    ];
    const result = getDayReadingRecords(logs, scope, "2026-09-12");
    expect(result.total).toBe(1);
    expect(result.groups[0].chapters).toEqual([{ book: "出埃及記", chapter: 3 }]);
  });

  it("counts records per local date with the same scope rules", () => {
    const logs = [
      log(1, 1, "2026-09-11T23:30:00Z"), // 台灣 9/12
      log(2, 1, "2026-09-12T01:00:00Z"),
      log(2, 1, "2026-09-12T02:00:00Z"), // 重複
      log(2, 2, "2026-09-12T03:00:00Z"), // 不同遍數另算
      log(3, 1, "2026-09-12T01:00:00Z", { plan_id: null }), // 無歸屬
      { book: "民數記", chapter: 1, round: 1, read_at: "2026-09-12T01:00:00Z", plan_id: "plan-1" }
    ];
    const counts = countDayReadingRecordsByDate(logs, scope);
    expect(counts.get("2026-09-12")).toBe(3);
    expect(counts.get("2026-09-11")).toBeUndefined();
  });

  it("skips chapters already listed as today's tasks and de-duplicates", () => {
    const logs = [
      log(10, 31, "2026-09-12T01:00:00Z"),
      log(10, 31, "2026-09-12T02:00:00Z"),
      log(11, 31, "2026-09-12T02:00:00Z")
    ];
    const result = getDayReadingRecords(logs, scope, "2026-09-12", ["出埃及記_11_31"]);
    expect(result.total).toBe(1);
    expect(result.groups[0].chapters).toEqual([{ book: "出埃及記", chapter: 10 }]);
  });
});

describe("sequential check (#331)", () => {
  const chapter = (n, round, read) => ({ book: "出埃及記", chapter: n, round, [`isReadR${round}`]: read });
  const days = (round, readSet) => [
    { dayNum: 1, chapters: [chapter(1, round, readSet.has(1)), chapter(2, round, readSet.has(2))] },
    { dayNum: 2, chapters: [chapter(1, round - 1 || 1, true)].filter(() => round > 1).concat([chapter(3, round, readSet.has(3))]) },
    { dayNum: 3, chapters: [chapter(4, round, readSet.has(4)), chapter(5, round, readSet.has(5))] }
  ];

  it("next chapter is the first unread one in reading order, including legacy gaps", () => {
    const state = getRoundCheckState(days(1, new Set([1, 3, 4])), 1);
    expect(state.next.chapter).toBe(2);
    expect(state.lastRead.chapter).toBe(4);
    expect(state.readCount).toBe(3);
    expect(state.isComplete).toBe(false);
  });

  it("only allows checking the next chapter (reading ahead in order is fine)", () => {
    const state = getRoundCheckState(days(1, new Set([1, 2])), 1);
    expect(canToggleRoundChapter(state, "出埃及記", 3, true)).toEqual({ ok: true });
    expect(canToggleRoundChapter(state, "出埃及記", 5, true)).toEqual({
      ok: false, reason: "not_next", target: { book: "出埃及記", chapter: 3 }
    });
    // 已經勾過的再勾一次不擋（no-op）
    expect(canToggleRoundChapter(state, "出埃及記", 1, true)).toEqual({ ok: true });
  });

  it("only allows unchecking the last checked chapter", () => {
    const state = getRoundCheckState(days(1, new Set([1, 2, 3])), 1);
    expect(canToggleRoundChapter(state, "出埃及記", 3, false)).toEqual({ ok: true });
    expect(canToggleRoundChapter(state, "出埃及記", 2, false)).toEqual({
      ok: false, reason: "not_last", target: { book: "出埃及記", chapter: 3 }
    });
  });

  it("ignores chapters outside the round's list", () => {
    const state = getRoundCheckState(days(1, new Set()), 1);
    expect(canToggleRoundChapter(state, "民數記", 9, true)).toEqual({ ok: true });
  });

  it("uses only the current round's chapters when several rounds share the calendar", () => {
    const state = getRoundCheckState(days(2, new Set([1])), 2);
    expect(state.order.every(ch => ch.round === 2)).toBe(true);
    expect(state.total).toBe(5);
    expect(state.next.chapter).toBe(2);
  });

  it("applies only to speed-reading campaign plans and the current round", () => {
    const plan = { planKind: "church_campaign_stage", currentRound: 1, days: days(1, new Set([1])) };
    expect(isSequentialCheckPlan(plan)).toBe(true);
    expect(isSequentialCheckPlan({ plan_kind: "church_campaign_stage_cohort" })).toBe(true);
    expect(isSequentialCheckPlan({ planKind: "church_campaign" })).toBe(true);
    expect(isSequentialCheckPlan({ planKind: "devotional" })).toBe(false);
    expect(isSequentialCheckPlan({ planKind: "group_meeting" })).toBe(false);
    expect(isSequentialCheckPlan({})).toBe(false);

    expect(getSequentialCheckBlock(plan, "出埃及記", 4, 1, true)).toMatchObject({ reason: "not_next" });
    expect(getSequentialCheckBlock(plan, "出埃及記", 2, 1, true)).toBeNull();
    expect(getSequentialCheckBlock({ ...plan, planKind: undefined }, "出埃及記", 4, 1, true)).toBeNull();
    // 已完成的遍數由既有唯讀保護處理，這裡不重複擋
    expect(getSequentialCheckBlock({ ...plan, currentRound: 2 }, "出埃及記", 4, 1, true)).toBeNull();
  });

  it("formats the toast text", () => {
    expect(formatSequentialCheckMessage({ reason: "not_next", target: { book: "出埃及記", chapter: 12 } }))
      .toBe("請照順序打卡，先讀完 出埃及記 12章");
    expect(formatSequentialCheckMessage(
      { reason: "not_last", target: { book: "出埃及記", chapter: 12 } },
      { sequentialUncheckBlocked: "只能取消 {chapter}" }
    )).toBe("只能取消 出埃及記 12章");
  });
});
