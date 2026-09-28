import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { getRoundProgressDisplay } from "../js/data/round-progress-display.mjs";
import { getMemberOverallPlanProgress } from "../js/modules/team-progress-metrics.mjs";

// #293：第 2 遍以後不要再讓「本遍才剛開始」的 0% 看起來像紀錄不見了。
// getRoundProgressDisplay 是首頁卡片 (home.js)、讀經計畫分頁卡片
// (plan.js 的 renderPlanCardProgressHero)、讀經小組名冊 (team-registration.js)
// 共用的文字來源，這裡先直接把它的規則釘死。

describe("getRoundProgressDisplay", () => {
  it("round 1: 畫面完全不變 —— 不是多輪，底層 previousRoundPercent 是 0", () => {
    const result = getRoundProgressDisplay({ round: 1, progress: 30, read: 12, total: 40 });
    expect(result.isMultiRound).toBe(false);
    expect(result.progressLayers).toEqual({ previousRoundPercent: 0, currentRoundPercent: 30 });
  });

  it("round 2 剛開始 (progress 0)：第 2 遍 + 已完成 1 遍，底層滿格，不含 0%", () => {
    const result = getRoundProgressDisplay({ round: 2, progress: 0, read: 0, total: 40 });
    expect(result.isMultiRound).toBe(true);
    expect(result.roundLabel).toBe("第 2 遍");
    expect(result.roundStatusText).toBe("本遍 0/40 章");
    expect(result.completedRoundsLabel).toBe("已完成 1 遍");
    expect(result.progressLayers).toEqual({ previousRoundPercent: 100, currentRoundPercent: 0 });
    expect(result.roundLabel).not.toContain("%");
  });

  it("round 2 讀了幾章 (progress 部分)：本遍 X/Y 章 隨已讀章數更新", () => {
    const result = getRoundProgressDisplay({ round: 2, progress: 25, read: 10, total: 40 });
    expect(result.roundStatusText).toBe("本遍 10/40 章");
    expect(result.progressLayers).toEqual({ previousRoundPercent: 100, currentRoundPercent: 25 });
  });

  it("每一格文字（不含數字）都在 5 個中文字以內", () => {
    const labels = [
      getRoundProgressDisplay({ round: 3 }).roundLabel,
      getRoundProgressDisplay({ round: 3 }).completedRoundsLabel,
      getRoundProgressDisplay({ round: 3, read: 1, total: 2 }).roundStatusText
    ];
    labels.forEach(label => {
      const hanziOnly = label.replace(/[0-9\s/]/g, "");
      expect(hanziOnly.length).toBeLessThanOrEqual(5);
    });
  });
});

// ── js/modules/team-registration.js：小組名冊卡片 + 戳一下提醒 ────────────
// renderMember / bindTeamReminderButtons 不是 export 出來的（整份檔案是舊式
// IIFE），沿用 scripts/reading-team-registration.test.mjs 既有的「切出原始碼
// 片段再用 new Function 重建」手法，直接跑真正會上線的邏輯，而不是重寫一份
// 平行實作。

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const teamUi = read("js/modules/team-registration.js");

const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[char]));

function extractRange(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function loadTeamMemberHelpers(windowStub) {
  // formatLastRead → getMemberProgress → renderMember → bindTeamReminderButtons →
  // bindTeamMemberRemovalButtons → getExpectedChapters all live in this one
  // contiguous block; toLocalDateKey is the next function after it and only
  // used to mark the end of the slice.
  const src = extractRange(teamUi, "function formatLastRead", "function toLocalDateKey");
  const factory = new Function(
    "escapeHTML",
    "getMemberOverallPlanProgress",
    "getRoundProgressDisplay",
    "window",
    `${src}\nreturn { getMemberProgress, renderMember, bindTeamReminderButtons };`
  );
  return factory(escapeHTML, getMemberOverallPlanProgress, getRoundProgressDisplay, windowStub);
}

describe("team-registration.js renderMember — #293", () => {
  it("round 1 卡片畫面不變：純數字百分比，單層進度條", () => {
    const { renderMember } = loadTeamMemberHelpers({});
    const html = renderMember(
      { userId: "u1", name: "小美", currentRound: 1, chaptersRead: 12, hasJoinedPlan: true },
      40,
      null
    );
    expect(html).toContain('<strong class="reading-team-member__percent">30%</strong>');
    expect(html).not.toContain("crown");
    expect(html).not.toContain("reading-team-progress--layered");
    expect(html).not.toContain("reading-team-progress__base");
  });

  it("round 2 剛開始：皇冠 + 第 2 遍，看不到 0%，進度條變兩層", () => {
    const { renderMember } = loadTeamMemberHelpers({});
    const html = renderMember(
      { userId: "u1", name: "小美", currentRound: 2, chaptersRead: 0, hasJoinedPlan: true },
      40,
      null
    );
    expect(html).toContain('data-icon="crown"');
    expect(html).toContain("第 2 遍");
    expect(html).not.toContain(">0%<");
    expect(html).toContain("reading-team-progress--layered");
    expect(html).toContain("reading-team-progress__base");
  });
});

describe("team-registration.js 戳一下提醒 — #293", () => {
  const buildDom = () => {
    const dom = new JSDOM("<!doctype html><body><div id='container'></div></body>", { url: "https://example.test" });
    const container = dom.window.document.getElementById("container");
    const button = dom.window.document.createElement("button");
    button.setAttribute("data-team-remind-user", "u1");
    container.appendChild(button);
    return { dom, container, button };
  };

  it("剛進第 2 遍、本遍 0 章的成員：不再說「尚未開始」，改成「已完成 1 遍」", () => {
    const { container, button } = buildDom();
    const openCareReminderDialog = vi.fn();
    const { bindTeamReminderButtons } = loadTeamMemberHelpers({ openCareReminderDialog });
    const team = { id: "team1", globalPlanId: "plan1" };
    const members = [{ userId: "u1", name: "小美", currentRound: 2, chaptersRead: 0 }];

    bindTeamReminderButtons(container, team, members, 40);
    button.click();

    expect(openCareReminderDialog).toHaveBeenCalledTimes(1);
    const arg = openCareReminderDialog.mock.calls[0][0];
    expect(arg.statusStr).toBe("已完成 1 遍");
    expect(arg.isNotStarted).toBe(false);
    expect(arg.isBehind).toBe(false);
  });

  it("回歸：第 1 遍完全沒讀過的人維持「尚未開始」", () => {
    const { container, button } = buildDom();
    const openCareReminderDialog = vi.fn();
    const { bindTeamReminderButtons } = loadTeamMemberHelpers({ openCareReminderDialog });
    const team = { id: "team1", globalPlanId: "plan1" };
    const members = [{ userId: "u1", name: "小美", currentRound: 1, chaptersRead: 0 }];

    bindTeamReminderButtons(container, team, members, 40);
    button.click();

    const arg = openCareReminderDialog.mock.calls[0][0];
    expect(arg.statusStr).toBe("尚未開始");
    expect(arg.isNotStarted).toBe(true);
  });

  it("回歸：第 2 遍已經讀了幾章的人，維持原本「已完成 X%」的說法", () => {
    const { container, button } = buildDom();
    const openCareReminderDialog = vi.fn();
    const { bindTeamReminderButtons } = loadTeamMemberHelpers({ openCareReminderDialog });
    const team = { id: "team1", globalPlanId: "plan1" };
    const members = [{ userId: "u1", name: "小美", currentRound: 2, chaptersRead: 10 }];

    bindTeamReminderButtons(container, team, members, 40);
    button.click();

    const arg = openCareReminderDialog.mock.calls[0][0];
    expect(arg.statusStr).toBe("已完成 25%");
    expect(arg.isNotStarted).toBe(false);
    expect(arg.isBehind).toBe(true);
  });
});
