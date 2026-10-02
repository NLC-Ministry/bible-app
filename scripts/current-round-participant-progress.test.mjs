import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  getConfirmedReadingRound,
  getCurrentRoundChapterProgress,
  segmentScheduleDaysForRoundCount
} from "../js/data/current-round-progress.mjs";

const db = readFileSync("js/db.js", "utf8");
const plan = readFileSync("js/modules/plan.js", "utf8");
// #370：統計、排行、組員狀況搬到 plan-stats.js。
const planStats = readFileSync("js/modules/plan-stats.js", "utf8");
const utils = readFileSync("js/utils.js", "utf8");
const firstRoundLogs = Array.from({ length: 50 }, (_, index) => ({
  book: "創世記",
  chapter: index + 1,
  round: 1
}));

describe("participant overview current-round progress", () => {
  it("keeps an unconfirmed legacy upgrade on first-pass complete", () => {
    const confirmedRound = getConfirmedReadingRound({
      currentRound: 2,
      upgradePromptHandled: false,
      logs: firstRoundLogs
    });
    expect(confirmedRound).toBe(1);
    expect(getCurrentRoundChapterProgress(firstRoundLogs, confirmedRound, 50).progress).toBe(100);
  });

  it("shows pass two at zero only after the user confirms the upgrade", () => {
    const confirmedRound = getConfirmedReadingRound({
      currentRound: 2,
      upgradePromptHandled: true,
      logs: firstRoundLogs
    });
    expect(confirmedRound).toBe(2);
    expect(getCurrentRoundChapterProgress(firstRoundLogs, confirmedRound, 50)).toEqual({
      round: 2,
      read: 0,
      total: 50,
      progress: 0
    });
  });

  it("recognizes legacy users who already started reading pass two", () => {
    const logs = [...firstRoundLogs, { book: "創世記", chapter: 1, round: 2 }];
    expect(getConfirmedReadingRound({ currentRound: 2, logs })).toBe(2);
    expect(getCurrentRoundChapterProgress(logs, 2, 50).progress).toBe(2);
  });

  it("places completed chapters on their actual check dates and the next pass afterward", () => {
    const days = Array.from({ length: 4 }, (_, index) => ({
      dayNum: index + 1,
      isRestDay: false,
      chapters: index < 2 ? [{ book: "創世記", chapter: index + 1, round: 1 }] : []
    }));
    const actualFirstRoundOffsets = new Map([
      ["創世記_1", 0],
      ["創世記_2", 1]
    ]);
    const scheduled = segmentScheduleDaysForRoundCount(days, 2, [1], [actualFirstRoundOffsets]);

    expect(scheduled[0].chapters).toEqual([expect.objectContaining({ chapter: 1, round: 1 })]);
    expect(scheduled[1].chapters).toEqual([expect.objectContaining({ chapter: 2, round: 1 })]);
    expect(scheduled.slice(0, 2).flatMap(day => day.chapters).some(chapter => chapter.round === 2)).toBe(false);
    expect(scheduled.slice(2).flatMap(day => day.chapters).map(chapter => chapter.round)).toEqual([2, 2]);
  });

  it("遍數超過日曆天數也不會有哪一遍擠不進去（可一天疊多遍）", () => {
    // 30 天的階段被讀完 30 遍、正在進入第 31 遍。已完成的 30 遍全都在前 9 天讀掉。
    const days = Array.from({ length: 30 }, (_, index) => ({ dayNum: index + 1, isRestDay: false, chapters: [] }));
    for (let c = 1; c <= 40; c += 1) days[Math.min(29, Math.floor((c - 1) * 30 / 40))].chapters.push({ book: "出", chapter: c, round: 1 });

    const completed = [];
    for (let r = 1; r <= 30; r += 1) {
      const m = new Map();
      for (let c = 1; c <= 40; c += 1) m.set(`出_${c}`, c % 9); // 全落在 offset 0..8
      completed.push(m);
    }
    // 目前這遍（第 31）從 offset 8（確認進入那天）鋪到階段結束
    const scheduled = segmentScheduleDaysForRoundCount(days, 31, [], completed, 8);

    // 每一遍都剛好 40 章，一章不漏、一章不重複
    for (let r = 1; r <= 31; r += 1) {
      const count = scheduled.reduce((sum, day) => sum + day.chapters.filter(ch => ch.round === r).length, 0);
      expect(count).toBe(40);
    }
    expect(scheduled.reduce((sum, day) => sum + day.chapters.length, 0)).toBe(40 * 31);

    // 第 31 遍拿到「進入那天 → 階段結束」整段（offset 8..29），不是 0 天
    const round31Offsets = scheduled.flatMap((day, index) => day.chapters.some(ch => ch.round === 31) ? [index] : []);
    expect(round31Offsets.length).toBeGreaterThan(0);
    expect(Math.min(...round31Offsets)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...round31Offsets)).toBeLessThanOrEqual(29);

    // 已完成的 30 遍在其實際打卡的日期範圍內（前 9 天）
    const doneOffsets = new Set(scheduled.flatMap((day, index) => day.chapters.some(ch => ch.round < 31) ? [index] : []));
    expect(Math.max(...doneOffsets)).toBeLessThanOrEqual(8);

    // 同一天不會有重複的 key
    scheduled.forEach(day => {
      const keys = day.chapters.map(ch => ch.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  it("已完成的遍：每章擺在它實際打卡的那一天（可一天疊多遍）", () => {
    const days = Array.from({ length: 30 }, (_, index) => ({ dayNum: index + 1, isRestDay: false, chapters: [] }));
    for (let c = 1; c <= 40; c += 1) days[Math.min(29, Math.floor((c - 1) * 30 / 40))].chapters.push({ book: "出", chapter: c, round: 1 });

    const completed = [];
    for (let r = 1; r <= 9; r += 1) { const m = new Map(); for (let c = 1; c <= 40; c += 1) m.set(`出_${c}`, r - 1); completed.push(m); }
    // 第 10 遍：第 8 天（offset 7）讀 出 1-38，第 11 天（offset 10）讀 出 39-40
    const r10 = new Map();
    for (let c = 1; c <= 38; c += 1) r10.set(`出_${c}`, 7);
    for (let c = 39; c <= 40; c += 1) r10.set(`出_${c}`, 10);
    completed.push(r10);

    const scheduled = segmentScheduleDaysForRoundCount(days, 11, [], completed, 10);

    // 照打卡紀錄：出 1-38 在 offset 7、出 39-40 在 offset 10
    const at = (offset) => scheduled[offset].chapters.filter(ch => ch.round === 10).map(ch => ch.chapter).sort((a, b) => a - b);
    expect(at(7)).toEqual(Array.from({ length: 38 }, (_, i) => i + 1));
    expect(at(10)).toEqual([39, 40]);
    // 中間沒打卡的日子就沒有第 10 遍章節
    expect(at(8)).toEqual([]);
    expect(at(9)).toEqual([]);
  });

  it("persists confirmation, invalidates old totals, and renders only the active round", () => {
    expect(db).toContain("chapters_read: uniqueLogs.length");
    expect(db).toContain("getConfirmedReadingRound({");
    expect(plan).toContain("plan.upgradePromptHandled = true");
    expect(planStats).toContain('statusStr = "第一遍完成"');
    // 0% now reads as "in progress" rather than "complete 0%".
    expect(planStats).toContain('statusStr = memberProgress > 0 ? `第${memberRound}遍完成${memberProgress}%` : `第${memberRound}遍進行中`');
    expect(plan).toContain("const visibleChapters = (selectedDay.chapters || []).filter");
    expect(plan).toContain("db.invalidateMergedUsersCache();");
    expect(utils).toContain("log.read_at || log.readAt");
    expect(utils).toContain("segmentScheduleDaysForRoundCount(");
  });
});