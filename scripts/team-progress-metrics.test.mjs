import { describe, expect, it } from "vitest";
import {
  getMemberOverallPlanProgress,
  getTeamOverallPlanProgress
} from "../js/modules/team-progress-metrics.mjs";

describe("current-round team progress", () => {
  it("shows zero percent after pass two is confirmed but no pass-two chapter is read", () => {
    expect(getMemberOverallPlanProgress({ currentRound: 2, chaptersRead: 0 }, 50)).toEqual({
      currentRoundRead: 0,
      completedChapters: 50,
      journeyChapters: 100,
      progress: 0,
      round: 2
    });
  });

  it("averages only each member's current-round completion", () => {
    const result = getTeamOverallPlanProgress([
      { currentRound: 2, chaptersRead: 0 },
      { currentRound: 1, chaptersRead: 2 },
      { currentRound: 1, chaptersRead: 0 }
    ], 50);
    expect(result.rows.map(row => row.progress)).toEqual([0, 4, 0]);
    expect(result.averageProgress).toBe(1);
    expect(result.completedChapters).toBe(52);
    expect(result.currentRoundReadChapters).toBe(2);
    expect(result.currentRoundTargetChapters).toBe(150);
  });
});