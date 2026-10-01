// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

// #372：實際跑 updateDashboardView 畫首頁計畫卡（不是只比對原始碼字串）。
const basePlan = {
  name: "第一輪期末賽｜2026年9月・出埃及記",
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  totalDays: 30,
  progress: 85,
  currentRound: 1,
  completedChapters: 34,
  totalChapters: 40,
  days: []
};

function setup(today) {
  document.body.innerHTML = '<div id="active-plan-summary"></div>';
  globalThis.state = {
    currentUser: { name: "測試", streak: 3 },
    activePlan: { ...basePlan },
    activePlans: [],
    globalPlans: [],
    readingLogs: []
  };
  globalThis.isPlanExpired = plan => today > plan.endDate;
  globalThis.isPlanStarted = () => true;
  globalThis.getUserRoleCode = () => "member";
  globalThis.appRouter = { switchTab() {} };
  globalThis.showToast = () => {};
}

const cardText = () => document.getElementById("active-plan-summary").textContent.replace(/\s+/g, " ");

describe("home plan card (#372)", () => {
  let updateDashboardView;
  beforeEach(async () => {
    setup("2026-10-01");
    ({ updateDashboardView } = await import("../js/modules/home.js"));
  });

  it("shows an ended state with the final chapters and next-step buttons", () => {
    updateDashboardView();
    const text = cardText();
    expect(text).toContain("已結束");
    expect(text).toContain("已於 9/30 結束");
    expect(text).toContain("34/40 章");
    expect(text).toContain("查看紀錄");
    expect(text).toContain("找下一個計畫");
    expect(text).not.toMatch(/第 \d+ 天/);
    expect(text).not.toContain("開始閱讀");
  });

  it("keeps the normal card while the plan is still running", () => {
    setup("2026-09-15");
    updateDashboardView();
    const text = cardText();
    expect(text).not.toContain("已結束");
    expect(text).toContain("讀經表");
    expect(text).toContain("開始閱讀");
  });
});
