import { describe, it, expect } from "vitest";
import { buildRound1ReadDateMap, countLateCompletedDays } from "../js/data/schedule-progress.mjs";
import { computeOrgUnitStats, logMatchesPlan } from "../js/data/plan-stats-rules.mjs";

// #370：plan.js 抽出的純規則，用行為測試鎖住。
describe("buildRound1ReadDateMap", () => {
  it("只收第一遍、同一章後面的覆蓋前面的、日期轉成本地 YYYY-MM-DD", () => {
    const map = buildRound1ReadDateMap([
      { book: "利未記", chapter: 1, round: 1, read_at: new Date(2026, 9, 1, 8) },
      { book: "利未記", chapter: 1, round: 1, read_at: new Date(2026, 9, 3, 8) },
      { book: "利未記", chapter: 2, round: 2, read_at: new Date(2026, 9, 2, 8) },
      { book: "利未記", chapter: 3, read_at: new Date(2026, 9, 2, 23, 30) }
    ]);
    expect([...map.entries()]).toEqual([
      ["利未記_1", "2026-10-03"],
      ["利未記_3", "2026-10-02"]
    ]);
  });

  it("給 matchLog 時只留符合的 log", () => {
    const logs = [
      { book: "A", chapter: 1, round: 1, plan_id: "p1", read_at: new Date(2026, 9, 1) },
      { book: "A", chapter: 2, round: 1, plan_id: "p2", read_at: new Date(2026, 9, 1) }
    ];
    const map = buildRound1ReadDateMap(logs, l => l.plan_id === "p1");
    expect([...map.keys()]).toEqual(["A_1"]);
  });

  it("沒有 log 時回傳空的 Map", () => {
    expect(buildRound1ReadDateMap(null).size).toBe(0);
  });
});

describe("排行的補讀天數（buildRound1ReadDateMap + countLateCompletedDays）", () => {
  const days = [
    { chapters: [{ book: "A", chapter: 1 }] },
    { chapters: [] },
    { chapters: [{ book: "A", chapter: 2 }, { book: "A", chapter: 3 }] }
  ];
  const at = d => new Date(2026, 9, d, 9);

  it("整天讀完、且最後一章讀在排程日之後才算補讀；休息日不算", () => {
    const logs = [
      { book: "A", chapter: 1, round: 1, read_at: at(2) },
      { book: "A", chapter: 2, round: 1, read_at: at(3) },
      { book: "A", chapter: 3, round: 1, read_at: at(4) }
    ];
    expect(countLateCompletedDays(days, "2026-10-01", buildRound1ReadDateMap(logs))).toBe(2);
  });

  it("當天讀完不算補讀；缺一章的那天也不算", () => {
    const logs = [
      { book: "A", chapter: 1, round: 1, read_at: at(1) },
      { book: "A", chapter: 2, round: 1, read_at: at(5) }
    ];
    expect(countLateCompletedDays(days, "2026-10-01", buildRound1ReadDateMap(logs))).toBe(0);
  });

  it("第二遍的 log 不影響補讀天數", () => {
    const logs = [
      { book: "A", chapter: 1, round: 1, read_at: at(1) },
      { book: "A", chapter: 1, round: 2, read_at: at(9) }
    ];
    expect(countLateCompletedDays(days, "2026-10-01", buildRound1ReadDateMap(logs))).toBe(0);
  });
});

describe("logMatchesPlan", () => {
  const activePlan = { id: "mine", globalPlanId: "g1", presetKey: "k1" };

  it("plan_id／global_plan_id／presetKey／preset_key 任一對得上就算", () => {
    expect(logMatchesPlan({ plan_id: "p1" }, "p1", null, null)).toBe(true);
    expect(logMatchesPlan({ global_plan_id: "g1" }, null, null, activePlan)).toBe(true);
    expect(logMatchesPlan({ preset_key: "k2" }, null, "k2", null)).toBe(true);
    expect(logMatchesPlan({ presetKey: "k1" }, null, null, activePlan)).toBe(true);
  });

  it("帶了別的計畫歸屬就不算，四個都沒有的舊日誌才當無歸屬計入", () => {
    expect(logMatchesPlan({ global_plan_id: "other" }, "p1", "k1", activePlan)).toBe(false);
    expect(logMatchesPlan({}, "p1", "k1", activePlan)).toBe(true);
  });
});

describe("computeOrgUnitStats", () => {
  const plan = { startDate: "2026-10-01", endDate: "2026-10-10" };
  const now = new Date(2026, 9, 5, 15); // 第 5 天 → 應讀 50%

  it("加總章數、人數、有讀過、完成一遍的人", () => {
    const stats = computeOrgUnitStats([
      { chapters_read: 10, plan_progress: 50, current_round: 1 },
      { chapters_read: 0, plan_progress: 0, current_round: 1, last_read: "2026-10-01" },
      { chapters_read: 30, plan_progress: 100, current_round: 1 },
      { chapters_read: 40, plan_progress: 10, current_round: 2 }
    ], plan, now);
    expect(stats).toEqual({
      totalChapters: 80,
      totalMembers: 4,
      totalActive: 4,
      totalCompleted: 2,
      behindCount: 1,
      rereadCount: 1
    });
  });

  it("落後＝進度 0，或比應讀 % 少超過 5", () => {
    const users = [
      { chapters_read: 5, plan_progress: 44, current_round: 1 },
      { chapters_read: 5, plan_progress: 45, current_round: 1 }
    ];
    expect(computeOrgUnitStats(users, plan, now).behindCount).toBe(1);
  });

  it("沒有計畫時以 50% 當應讀基準；空名單全部是 0", () => {
    expect(computeOrgUnitStats([{ chapters_read: 1, plan_progress: 44 }], null).behindCount).toBe(1);
    expect(computeOrgUnitStats(null, plan, now)).toEqual({
      totalChapters: 0, totalMembers: 0, totalActive: 0, totalCompleted: 0, behindCount: 0, rereadCount: 0
    });
  });
});
