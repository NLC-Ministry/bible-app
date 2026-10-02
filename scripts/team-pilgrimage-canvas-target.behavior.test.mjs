// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// #406：計畫頁同時有「團隊」(stats) 和隱藏的組員總覽 (members) 兩份團隊區塊時，
// 各自的賽道地圖要畫在自己的畫布上；首頁的呼叫也不能去改團隊畫布。
const plan = {
  globalPlanId: "00000000-0000-0000-c026-000000000406",
  planKind: "church_campaign_stage",
  name: "Stage",
  totalChapters: 6,
  currentRound: 1,
  days: [
    { chapters: [{ book: "創世記", chapter: 1, isReadR1: true }, { book: "創世記", chapter: 2, isReadR1: true }, { book: "創世記", chapter: 3 }] },
    { chapters: [{ book: "出埃及記", chapter: 1 }, { book: "出埃及記", chapter: 2 }, { book: "出埃及記", chapter: 3 }] }
  ]
};
const context = {
  team: { id: "team-1", name: "測試隊", division: 3, captainId: "me", capacity: 3, memberCount: 2, status: "full" },
  members: [
    { userId: "me", name: "我", role: "captain", isMe: true, hasJoinedPlan: true, chaptersRead: 2 },
    { userId: "mate", name: "隊友", role: "member", isMe: false, hasJoinedPlan: true, chaptersRead: 4 }
  ]
};

// jsdom 沒有 canvas：每張畫布記下自己被畫了幾筆。
const drawCalls = new WeakMap();
const draws = canvas => drawCalls.get(canvas) || 0;
const waitForTrail = () => new Promise(resolve => setTimeout(resolve, 150));

beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = function () {
    const canvas = this;
    return new Proxy({}, {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => {
          drawCalls.set(canvas, draws(canvas) + 1);
          return key === "measureText" ? { width: 0 } : undefined;
        };
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      }
    });
  };
  globalThis.escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
  globalThis.hydrateIcons = () => {};
  globalThis.showToast = vi.fn();
  globalThis.loader = { show: vi.fn(), hide: vi.fn() };
  globalThis.db = { fetchMergedUsersWithLogs: vi.fn().mockResolvedValue({ users: [] }) };
  await import("../js/modules/team-registration.js");
  await import("../js/modules/home.js");
});

beforeEach(() => {
  globalThis.state = {
    currentUser: { id: "me", name: "我", pastoral_zone: "測試牧區" },
    currentProfileId: "me",
    activePlan: plan,
    activePlans: [plan]
  };
  // 和正式頁面一樣：組員總覽那份在前面而且隱藏。
  document.body.innerHTML = `
    <div id="reading-team-members-inline" style="display:none"></div>
    <div id="reading-team-stats-inline"></div>`;
  globalThis.db.fetchMergedUsersWithLogs.mockClear();
});

const membersEl = () => document.getElementById("reading-team-members-inline");
const statsEl = () => document.getElementById("reading-team-stats-inline");
const canvasIn = el => el.querySelector("canvas");

describe("team pilgrimage trail draws on its own canvas (#406)", () => {
  it("draws the visible team tab even when the hidden members view rendered first", async () => {
    window.renderMyReadingTeamInline(membersEl(), plan, context, "members");
    window.renderMyReadingTeamInline(statsEl(), plan, context, "stats");
    await waitForTrail();

    expect(draws(canvasIn(statsEl()))).toBeGreaterThan(0);
    expect(draws(canvasIn(membersEl()))).toBeGreaterThan(0);
    expect(statsEl().textContent).toContain("隊友軌跡");
    expect(membersEl().textContent).toContain("隊友軌跡");
  });

  it("does not let the home dashboard redraw the team canvas", async () => {
    window.renderMyReadingTeamInline(statsEl(), plan, context, "stats");
    await waitForTrail();
    const before = draws(canvasIn(statsEl()));

    await window.renderPilgrimageTrail();

    expect(draws(canvasIn(statsEl()))).toBe(before);
    expect(globalThis.db.fetchMergedUsersWithLogs).not.toHaveBeenCalled();
  });

  it("leaves no duplicate canvas or legend ids when both team views exist", () => {
    window.renderMyReadingTeamInline(membersEl(), plan, context, "members");
    window.renderMyReadingTeamInline(statsEl(), plan, context, "stats");

    expect(document.querySelectorAll("#team-pilgrimage-canvas, #team-pilgrimage-legend")).toHaveLength(0);
    expect(document.querySelectorAll("canvas[data-team-pilgrimage-canvas]")).toHaveLength(2);
  });
});
