import { describe, expect, it } from "vitest";
import {
  getMemberOverallPlanProgress,
  getTeamOverallPlanProgress
} from "../js/modules/team-progress-metrics.mjs";

describe("round-aware team progress", () => {
  it("retains the completed first pass when a member begins pass two", () => {
    expect(getMemberOverallPlanProgress({ currentRound: 2, chaptersRead: 0 }, 50)).toEqual({
      currentRoundRead: 0,
      completedChapters: 50,
      journeyChapters: 100,
      progress: 50,
      round: 2
    });
  });

  it("calculates the reported mixed-round team consistently", () => {
    const result = getTeamOverallPlanProgress([
      { currentRound: 2, chaptersRead: 0 },
      { currentRound: 1, chaptersRead: 2 },
      { currentRound: 1, chaptersRead: 0 }
    ], 50);
    expect(result.rows.map(row => row.progress)).toEqual([50, 4, 0]);
    expect(result.averageProgress).toBe(18);
    expect(result.completedChapters).toBe(52);
    expect(result.journeyChapters).toBe(200);
  });
});