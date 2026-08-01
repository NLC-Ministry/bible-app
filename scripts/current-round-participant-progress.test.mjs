import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  getConfirmedReadingRound,
  getCurrentRoundChapterProgress
} from "../js/data/current-round-progress.mjs";

const db = readFileSync("js/db.js", "utf8");
const plan = readFileSync("js/modules/plan.js", "utf8");
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

  it("keeps cumulative count separate and records explicit upgrade confirmation", () => {
    expect(db).toContain("chapters_read: uniqueLogs.length");
    expect(db).toContain("getConfirmedReadingRound({");
    expect(plan).toContain("plan.upgradePromptHandled = true");
    expect(plan).toContain('statusStr = "第一遍完成"');
    expect(plan).toContain('statusStr = `第${memberRound}遍完成${memberProgress}%`');
  });
});