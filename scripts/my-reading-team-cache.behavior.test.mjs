// @vitest-environment jsdom
// #407 切到「團隊」時重複打 4 次 get_my_reading_team：實際載入 plan.js，
// 計算一次切頁打了幾次 db.getMyReadingTeam；團隊異動（reading-team:changed）後要重查。

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN_ID = "00000000-0000-0000-c026-000000000002";
const teamContext = {
  teams: [{
    team: { id: "team-3", globalPlanId: PLAN_ID, name: "Team", division: 3, captainId: "me", capacity: 3, memberCount: 1, status: "forming" },
    members: [{ userId: "me", name: "Me", role: "captain", isMe: true, hasJoinedPlan: true, chaptersRead: 0 }]
  }]
};

let db;

beforeAll(async () => {
  globalThis.state = { readerState: {}, activePlans: [], readingLogs: [], currentProfileId: "me" };
  globalThis.escapeHTML = value => String(value ?? "");
  globalThis.showToast = vi.fn();
  globalThis.renderIcon = key => `<i data-test-icon="${key}"></i>`;
  globalThis.hydrateIcons = () => {};
  globalThis.getUserRoleCode = () => "member";
  globalThis.isPlanStarted = () => true;
  globalThis.isPlanExpired = () => false;
  globalThis.calculatePlanProgress = vi.fn();
  globalThis.saveReaderPreferences = vi.fn();
  globalThis.BIBLE_BOOKS = [];
  globalThis.appRouter = { switchTab: vi.fn() };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.setDataVersion = vi.fn();
  window.isReadingTeamPlan = () => true;
  document.body.innerHTML = `
    <div id="plan-view">
      <div id="plan-list-subview"></div>
      <div id="plan-detail-subview">
        <div id="subview-plan-schedule"></div>
        <div id="subview-plan-stats">
          <div id="stats-team-view-switch"><div id="stats-team-view-tabs"></div></div>
          <div id="reading-team-stats-inline"></div>
        </div>
        <div id="subview-plan-ranking"></div>
        <div id="subview-plan-members"></div>
      </div>
    </div>`;
  db = {
    getMyReadingTeam: vi.fn(),
    getFeatureSetting: vi.fn().mockResolvedValue({ enabled: false })
  };
  globalThis.db = db;
  await import("../js/copy/zh-Hant.js");
  await import("../js/modules/plan.js");
});

beforeEach(() => {
  vi.useRealTimers();
  window.dispatchEvent(new CustomEvent("reading-team:changed"));
  db.getMyReadingTeam.mockReset();
  db.getMyReadingTeam.mockImplementation(async () => ({ success: true, context: teamContext }));
  state.activePlan = { id: PLAN_ID, globalPlanId: PLAN_ID, name: "Stage 2", planKind: "church_campaign_stage", days: [] };
});

async function switchToTeamTab() {
  // 只關心查了幾次；後面的畫面渲染在這個精簡 DOM 下失敗與否不影響計數。
  await window.PlanPageController.switchPrimaryView("stats").catch(() => {});
}

describe("my reading team lookup while switching plan tabs (#407)", () => {
  it("asks the server at most once per tab switch", async () => {
    await switchToTeamTab();
    expect(db.getMyReadingTeam).toHaveBeenCalledTimes(1);
  });

  it("reuses the answer for later switches while it is fresh", async () => {
    await switchToTeamTab();
    await switchToTeamTab();
    await switchToTeamTab();
    expect(db.getMyReadingTeam).toHaveBeenCalledTimes(1);
  });

  it("re-asks after the cached answer expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await switchToTeamTab();
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await switchToTeamTab();
    expect(db.getMyReadingTeam).toHaveBeenCalledTimes(2);
  });

  it("re-asks right after the user's team changes", async () => {
    await switchToTeamTab();
    window.dispatchEvent(new CustomEvent("reading-team:changed"));
    await switchToTeamTab();
    expect(db.getMyReadingTeam).toHaveBeenCalledTimes(2);
  });

  it("keeps each plan's answer separate", async () => {
    await switchToTeamTab();
    const OTHER = "00000000-0000-0000-c026-000000000003";
    state.activePlan = { ...state.activePlan, id: OTHER, globalPlanId: OTHER };
    await switchToTeamTab();
    expect(db.getMyReadingTeam).toHaveBeenCalledTimes(2);
    expect(db.getMyReadingTeam.mock.calls.map(([plan]) => plan.globalPlanId)).toEqual([PLAN_ID, OTHER]);
  });

  it("does not keep a failed lookup", async () => {
    db.getMyReadingTeam.mockImplementation(async () => ({ success: false, message: "boom" }));
    await switchToTeamTab();
    const callsAfterFailure = db.getMyReadingTeam.mock.calls.length;
    db.getMyReadingTeam.mockImplementation(async () => ({ success: true, context: teamContext }));
    await switchToTeamTab();
    expect(db.getMyReadingTeam.mock.calls.length).toBe(callsAfterFailure + 1);
  });
});
