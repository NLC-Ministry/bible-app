// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCaptainReminderMessage,
  buildCarryConfirmMessage,
  carryEntriesForPlan,
  describeTeamCarryEntry,
  needsTeamCarryStatus
} from "../js/modules/team-carry-model.mjs";

// #678：首頁和計畫卡片的帶隊卡片。RPC 的行為在 db-behavior.test.mjs 實際跑 SQL，這裡驗畫面與流程。
const PLAN_ID = "70000000-0000-4000-8000-000000000781";
const SOURCE_PLAN_ID = "70000000-0000-4000-8000-000000000780";
const SOURCE_TEAM_ID = "70000000-0000-4000-8000-000000000678";

const base = {
  targetPlanId: PLAN_ID,
  targetPlanName: "十一月・民數記",
  targetStarted: true,
  sourcePlanId: SOURCE_PLAN_ID,
  sourceTeamId: SOURCE_TEAM_ID,
  name: "十月隊",
  division: 3,
  memberCount: 3,
  captainId: "captain",
  captainName: "隊長甲",
  hasVacancy: false,
  reminderSentToday: false,
  roster: []
};
const carryEntry = overrides => ({
  ...base,
  state: "carry",
  role: "captain",
  roster: [{ userId: "m1", name: "隊員乙", reason: null }, { userId: "m2", name: "隊員丙", reason: "already_in_target_team" }],
  ...overrides
});
const waitingEntry = overrides => ({
  ...base,
  state: "waiting",
  role: "member",
  canTakeover: false,
  takeoverOpensOn: "2026-12-04",
  roster: [{ userId: "m2", name: "隊員丙", reason: null }],
  ...overrides
});
const carriedEntry = overrides => ({
  ...base,
  state: "carried",
  role: "captain",
  carried: true,
  carriedTeamId: "new-team",
  carriedTeamName: "十月隊",
  carriedByName: "隊員乙",
  hasVacancy: true,
  ...overrides
});
const backfillEntry = overrides => ({
  ...base,
  state: "backfill",
  role: "captain",
  ownTeamId: "own-team",
  ownTeamName: "隊長新隊",
  ownTeamVacancy: 2,
  roster: [{ userId: "m1", name: "隊員乙", reason: null }],
  ...overrides
});

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
};
const statusOf = (...teams) => ({ success: true, context: { teams } });
const titleText = () => document.querySelector(".team-carry-card__title")?.textContent;
const actionButton = kind => document.querySelector(`[data-team-carry-action="${kind}"]`);

let db;
let carryModule;
let reload;

beforeAll(async () => {
  globalThis.state = { isSupabaseMode: true, supabase: {}, currentProfileId: "me", globalPlans: [] };
  globalThis.escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
  globalThis.loader = { show: vi.fn(), hide: vi.fn() };
  globalThis.showToast = vi.fn();
  globalThis.hydrateIcons = () => {};
  globalThis.auth = { isLoggedIn: () => true };
  db = {
    _readingTeamPlanId: plan => plan.globalPlanId || plan.id,
    getReadingTeamCarryStatus: vi.fn(),
    carryReadingTeamsToStage: vi.fn(),
    takeOverReadingTeamCarry: vi.fn(),
    backfillReadingTeamFromSource: vi.fn(),
    joinCarriedReadingTeam: vi.fn(),
    sendReadingTeamReminder: vi.fn(),
    describeReadingTeamCarryoverSkips: ({ skippedTeam, skippedMembers }) => ({
      captainBlocked: skippedTeam ? "blocked:" + skippedTeam.reason : null,
      memberNotes: (skippedMembers || []).map(member => "skipped:" + member.name)
    })
  };
  globalThis.db = db;
  carryModule = await import("../js/modules/team-carry.mjs");
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.dispatchEvent(new CustomEvent("reading-team:changed"));
  document.body.innerHTML = `<div id="team-carry-home-card" class="hidden"></div><div id="slot"></div>`;
  globalThis.alert = vi.fn();
  window.showConfirmDialog = vi.fn().mockResolvedValue(true);
  window.showPromptDialog = vi.fn();
  reload = vi.fn();
});

const render = entries => carryModule.renderTeamCarryCards(document.getElementById("slot"), entries, { onDone: reload });

describe("卡片文字", () => {
  it("隊長：帶「隊名」進入這個月的計畫；提早開放時說下個月", () => {
    expect(describeTeamCarryEntry(carryEntry()).title).toBe("帶「十月隊」進入這個月的計畫");
    expect(describeTeamCarryEntry(carryEntry({ targetStarted: false })).title).toBe("帶「十月隊」進入下個月的計畫");
  });

  it("隊員：說明隊長還沒帶隊，並提醒先不要加入別隊", () => {
    const model = describeTeamCarryEntry(waitingEntry());
    expect(model.title).toBe("你上個月在「十月隊」，隊長還沒帶隊。");
    expect(model.hint).toBe("如果想等隊長帶隊，先不要加入別隊（先加入別隊的人，帶隊時會被略過）。");
    expect(model.description).toBe("12/4 起如果隊長還沒帶隊，隊員可以接手。");
    expect(model.actions.map(action => action.kind)).toEqual(["remind"]);
  });

  it("滿 3 天才有接手按鈕；今天提醒過按鈕就停用", () => {
    const open = describeTeamCarryEntry(waitingEntry({ canTakeover: true, reminderSentToday: true }));
    expect(open.actions).toEqual([
      { kind: "takeover", label: "由我帶隊加入", primary: true },
      { kind: "remind", label: "今天已提醒", primary: false, disabled: true }
    ]);
  });

  it("隊伍已被帶入：說出由誰帶入，額滿時沒有加入按鈕", () => {
    expect(describeTeamCarryEntry(carriedEntry()).title).toBe("「十月隊」已由隊員乙帶入");
    expect(describeTeamCarryEntry(carriedEntry()).actions[0].kind).toBe("join");
    expect(describeTeamCarryEntry(carriedEntry({ hasVacancy: false })).actions).toEqual([]);
  });

  it("確認畫面列出會帶入與不會帶入的人；接手時說明原隊長不會加入", () => {
    expect(buildCarryConfirmMessage(carryEntry(), "carry")).toContain("會一起帶入：隊員乙\n不會帶入：隊員丙（已加入別隊）");
    const takeover = buildCarryConfirmMessage(waitingEntry({ canTakeover: true }), "takeover");
    expect(takeover).toContain("你會成為「十月隊」");
    expect(takeover).toContain("會一起帶入：隊員丙");
    expect(takeover).toContain("原隊長隊長甲 不會自動加入新隊伍。");
    expect(buildCarryConfirmMessage(backfillEntry(), "backfill")).toContain("補進「隊長新隊」");
  });

  it("提醒隊長的內容不超過 300 字", () => {
    const message = buildCaptainReminderMessage(waitingEntry({ name: "長".repeat(40), targetPlanName: "計".repeat(200) }));
    expect(message.length).toBeLessThanOrEqual(300);
  });

  it("兩種人數都滿隊才不用查帶隊狀態", () => {
    const team = (division, memberCount) => ({ team: { division, memberCount, capacity: division } });
    expect(needsTeamCarryStatus([])).toBe(true);
    expect(needsTeamCarryStatus([team(3, 3)])).toBe(true);
    expect(needsTeamCarryStatus([team(3, 3), team(6, 2)])).toBe(true);
    expect(needsTeamCarryStatus([team(3, 3), team(6, 6)])).toBe(false);
  });

  it("只取這張計畫的狀態", () => {
    expect(carryEntriesForPlan([carryEntry(), { ...carryEntry(), targetPlanId: "other" }], PLAN_ID)).toHaveLength(1);
    expect(carryEntriesForPlan([carryEntry()], null)).toEqual([]);
  });
});

describe("首頁和計畫卡片共用同一份狀態", () => {
  it("隊長還沒加入新計畫也在首頁看到帶隊入口；多個入口只查一次", async () => {
    db.getReadingTeamCarryStatus.mockResolvedValue(statusOf(carryEntry()));
    await carryModule.refreshTeamCarryHomeCard();
    await carryModule.getPlanCarryEntries({ globalPlanId: PLAN_ID });
    await carryModule.getPlanCarryEntries({ globalPlanId: PLAN_ID });
    const card = document.getElementById("team-carry-home-card");
    expect(card.classList.contains("hidden")).toBe(false);
    expect(card.textContent).toContain("帶「十月隊」進入這個月的計畫");
    expect(db.getReadingTeamCarryStatus).toHaveBeenCalledTimes(1);
  });

  it("沒有帶隊的事：首頁隱藏，當天不再查；團隊異動後才重查", async () => {
    db.getReadingTeamCarryStatus.mockResolvedValue(statusOf());
    await carryModule.refreshTeamCarryHomeCard();
    expect(document.getElementById("team-carry-home-card").classList.contains("hidden")).toBe(true);

    // 模擬下一次開機：記憶體快取沒了，但 localStorage 記得今天查過是空的
    const remembered = window.localStorage.getItem("team-carry-status-empty");
    carryModule.invalidateTeamCarryStatus();
    window.localStorage.setItem("team-carry-status-empty", remembered);
    await carryModule.getTeamCarryEntries();
    expect(db.getReadingTeamCarryStatus).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new CustomEvent("reading-team:changed"));
    await carryModule.getTeamCarryEntries();
    expect(db.getReadingTeamCarryStatus).toHaveBeenCalledTimes(2);
  });

  it("查詢失敗不記成沒事，首頁隱藏，下次重查", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.getReadingTeamCarryStatus.mockResolvedValueOnce({ success: false, message: "壞了" });
    await carryModule.refreshTeamCarryHomeCard();
    expect(document.getElementById("team-carry-home-card").classList.contains("hidden")).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(window.localStorage.getItem("team-carry-status-empty")).toBeNull();
    db.getReadingTeamCarryStatus.mockResolvedValue(statusOf(carryEntry()));
    expect(await carryModule.getTeamCarryEntries()).toHaveLength(1);
    warn.mockRestore();
  });

  it("首頁可以關掉這張提醒，之後不再出現", async () => {
    db.getReadingTeamCarryStatus.mockResolvedValue(statusOf(waitingEntry()));
    await carryModule.refreshTeamCarryHomeCard();
    document.querySelector("[data-team-carry-dismiss]").click();
    await flush();
    expect(document.getElementById("team-carry-home-card").classList.contains("hidden")).toBe(true);
    await carryModule.refreshTeamCarryHomeCard();
    expect(document.getElementById("team-carry-home-card").classList.contains("hidden")).toBe(true);
  });
});

describe("隊員：提醒隊長與接手", () => {
  it("提醒隊長走隊友提醒，傳送後按鈕變成今天已提醒", async () => {
    db.sendReadingTeamReminder.mockResolvedValue({ error: null });
    render([waitingEntry()]);
    actionButton("remind").click();
    await flush();
    expect(db.sendReadingTeamReminder).toHaveBeenCalledWith(expect.objectContaining({
      teamId: SOURCE_TEAM_ID, recipientId: "captain", globalPlanId: SOURCE_PLAN_ID, reason: "care"
    }));
    expect(actionButton("remind").textContent).toBe("今天已提醒");
    expect(actionButton("remind").disabled).toBe(true);
  });

  it("傳送失敗：顯示原因，按鈕還能再按", async () => {
    db.sendReadingTeamReminder.mockResolvedValue({ error: new Error("提醒傳送失敗。") });
    render([waitingEntry()]);
    actionButton("remind").click();
    await flush();
    expect(showToast).toHaveBeenCalledWith("提醒傳送失敗。", "error");
    expect(actionButton("remind").disabled).toBe(false);
  });

  it("接手前先列出名單，成功後告知略過的人並重新載入", async () => {
    db.takeOverReadingTeamCarry.mockResolvedValue({
      success: true,
      data: { teams: [{ name: "十月隊", skippedMembers: [{ name: "隊員丙", reason: "already_in_target_team" }] }] }
    });
    render([waitingEntry({ canTakeover: true })]);
    actionButton("takeover").click();
    await flush();
    expect(window.showConfirmDialog.mock.calls[0][0].message).toContain("會一起帶入：隊員丙");
    expect(db.takeOverReadingTeamCarry).toHaveBeenCalledWith(
      expect.objectContaining({ globalPlanId: PLAN_ID }), SOURCE_TEAM_ID, null
    );
    expect(alert).toHaveBeenCalledWith("已帶「十月隊」加入「十一月・民數記」，你是新隊長。\nskipped:隊員丙");
    expect(reload).toHaveBeenCalled();
  });

  it("接手時隊名重複：不顯示失敗，請使用者改名後再送出", async () => {
    db.takeOverReadingTeamCarry
      .mockResolvedValueOnce({ success: false, error: { message: "duplicate_team_name" }, message: "這個團隊名稱已有人使用" })
      .mockResolvedValue({ success: true, data: { teams: [{ name: "新隊名", skippedMembers: [] }] } });
    window.showPromptDialog.mockResolvedValue("新隊名");
    render([waitingEntry({ canTakeover: true })]);
    actionButton("takeover").click();
    await flush();
    expect(window.showPromptDialog).toHaveBeenCalledTimes(1);
    expect(db.takeOverReadingTeamCarry).toHaveBeenLastCalledWith(expect.anything(), SOURCE_TEAM_ID, "新隊名");
    expect(alert).not.toHaveBeenCalledWith("這個團隊名稱已有人使用");
    expect(reload).toHaveBeenCalled();
  });

  it("後按的人已被帶入：顯示已在隊上", async () => {
    db.takeOverReadingTeamCarry.mockResolvedValue({
      success: true,
      data: { teams: [{ name: "十月隊", alreadyCarried: true, actorIsMember: true }] }
    });
    render([waitingEntry({ canTakeover: true })]);
    actionButton("takeover").click();
    await flush();
    expect(alert).toHaveBeenCalledWith("你已經在「十月隊」隊上了。");
    expect(reload).toHaveBeenCalled();
  });

  it("取消確認就什麼都不做", async () => {
    window.showConfirmDialog.mockResolvedValue(false);
    render([waitingEntry({ canTakeover: true })]);
    actionButton("takeover").click();
    await flush();
    expect(db.takeOverReadingTeamCarry).not.toHaveBeenCalled();
    expect(actionButton("takeover").disabled).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("隊長：帶隊、回來、補帶", () => {
  it("隊名重複時請隊長改名，再帶一次", async () => {
    db.carryReadingTeamsToStage
      .mockResolvedValueOnce({ success: true, data: { teams: [], skippedTeams: [{ division: 3, name: "十月隊", reason: "duplicate_team_name" }] } })
      .mockResolvedValue({ success: true, data: { teams: [{ division: 3, name: "新隊名", skippedMembers: [] }], skippedTeams: [] } });
    window.showPromptDialog.mockResolvedValue("新隊名");
    render([carryEntry()]);
    actionButton("carry").click();
    await flush();
    expect(window.showPromptDialog.mock.calls[0][0].message).toContain("「十月隊」這個隊名");
    expect(db.carryReadingTeamsToStage).toHaveBeenLastCalledWith(expect.anything(), 3, "新隊名");
    expect(alert).toHaveBeenCalledWith("已將「新隊名」帶入「十一月・民數記」。");
    expect(reload).toHaveBeenCalled();
  });

  it("改名時按取消：不帶隊也不顯示失敗", async () => {
    db.carryReadingTeamsToStage.mockResolvedValue({
      success: true, data: { teams: [], skippedTeams: [{ division: 3, name: "十月隊", reason: "duplicate_team_name" }] }
    });
    window.showPromptDialog.mockResolvedValue(null);
    render([carryEntry()]);
    actionButton("carry").click();
    await flush();
    expect(db.carryReadingTeamsToStage).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("按帶隊時才發現已被帶入：不說帶隊成功，問要不要加入", async () => {
    db.carryReadingTeamsToStage.mockResolvedValue({
      success: true,
      data: {
        teams: [{ division: 3, name: "十月隊", alreadyCarried: true, actorIsMember: false, carriedByName: "隊員乙", hasVacancy: true }],
        skippedTeams: []
      }
    });
    db.joinCarriedReadingTeam.mockResolvedValue({ success: true, data: { name: "十月隊" } });
    render([carryEntry()]);
    actionButton("carry").click();
    await flush();
    expect(window.showConfirmDialog.mock.calls[1][0].title).toBe("隊伍已由隊員乙帶入");
    expect(db.joinCarriedReadingTeam).toHaveBeenCalledWith(expect.anything(), SOURCE_TEAM_ID);
    expect(alert).not.toHaveBeenCalledWith(expect.stringContaining("帶入「十一月・民數記」。"));
    expect(alert).toHaveBeenCalledWith("已加入「十月隊」。");
  });

  it("原隊長回來：一鍵加入；額滿時只顯示狀態", async () => {
    db.joinCarriedReadingTeam.mockResolvedValue({ success: true, data: { name: "十月隊" } });
    render([carriedEntry()]);
    expect(titleText()).toBe("「十月隊」已由隊員乙帶入");
    actionButton("join").click();
    await flush();
    expect(db.joinCarriedReadingTeam).toHaveBeenCalledWith(expect.objectContaining({ globalPlanId: PLAN_ID }), SOURCE_TEAM_ID);
    expect(reload).toHaveBeenCalled();

    render([carriedEntry({ hasVacancy: false })]);
    expect(actionButton("join")).toBeNull();
    expect(document.getElementById("slot").textContent).toContain("隊伍已額滿");
  });

  it("補帶：列出名單，回報補了幾位、誰被略過", async () => {
    db.backfillReadingTeamFromSource.mockResolvedValue({
      success: true,
      data: { name: "隊長新隊", addedCount: 1, skippedMembers: [{ name: "隊員丙", reason: "team_full" }] }
    });
    render([backfillEntry()]);
    actionButton("backfill").click();
    await flush();
    expect(window.showConfirmDialog.mock.calls[0][0].message).toContain("會一起帶入：隊員乙");
    expect(alert).toHaveBeenCalledWith("已把 1 位隊員補進「隊長新隊」。\nskipped:隊員丙");
    expect(reload).toHaveBeenCalled();
  });

  it("按鈕不會順便觸發外層計畫卡片的點擊", async () => {
    const outer = vi.fn();
    document.getElementById("slot").addEventListener("click", outer);
    window.showConfirmDialog.mockResolvedValue(false);
    render([carryEntry()]);
    actionButton("carry").click();
    await flush();
    expect(outer).not.toHaveBeenCalled();
  });

  it("隊名會跳脫，不會變成 HTML", () => {
    render([carryEntry({ name: "<img src=x>" })]);
    expect(document.querySelector("#slot img")).toBeNull();
  });
});
