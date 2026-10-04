// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// #321：帶隊入口在「下一個計畫」裡——加入計畫時的提示＋加入團隊視窗最上面，每隊一顆按鈕。
const OCT = {
  id: "00000000-0000-0000-c126-000000202610",
  globalPlanId: "00000000-0000-0000-c126-000000202610",
  name: "第一輪期末賽｜2026年10月・利未記",
  planKind: "church_campaign_stage",
  startDate: "2999-10-01",
  endDate: "2999-10-31"
};
const TEAM3 = { sourceTeamId: "t3", name: "恩典同行隊", division: 3, memberCount: 3 };
const TEAM6 = { sourceTeamId: "t6", name: "喜樂六人行", division: 6, memberCount: 5 };

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const offer = teams => ({ success: true, context: { eligible: teams.length > 0, teams } });

let db;

beforeAll(async () => {
  globalThis.state = { isSupabaseMode: true, supabase: {}, currentUser: { id: "captain" }, currentProfileId: "captain" };
  globalThis.escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
  globalThis.loader = { show: vi.fn(), hide: vi.fn() };
  globalThis.showToast = vi.fn();
  globalThis.hydrateIcons = () => {};
  db = {
    getReadingTeamCarryoverOffer: vi.fn(),
    carryReadingTeamsToStage: vi.fn(),
    getMyReadingTeam: vi.fn(),
    createReadingTeam: vi.fn(),
    describeReadingTeamCarryoverSkips: ({ skippedTeam, skippedMembers }) => ({
      captainBlocked: skippedTeam ? "blocked:" + skippedTeam.reason : null,
      memberNotes: (skippedMembers || []).map(member => "skipped:" + member.name)
    })
  };
  globalThis.db = db;
  await import("../js/modules/team-registration.js");
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  globalThis.alert = vi.fn();
  window.showConfirmDialog = vi.fn().mockResolvedValue(true);
});

describe("carry-over when joining the next plan", () => {
  it("goes straight to the normal join when there is nothing to carry", async () => {
    db.getReadingTeamCarryoverOffer.mockResolvedValue(offer([]));
    await expect(window.offerReadingTeamCarryoverOnJoin(OCT)).resolves.toBe("none");
    expect(document.querySelector("#reading-team-carryover-join-dialog")).toBeNull();
  });

  it("does not ask for non-stage plans", async () => {
    await expect(window.offerReadingTeamCarryoverOnJoin({ ...OCT, planKind: "standard" })).resolves.toBe("none");
    expect(db.getReadingTeamCarryoverOffer).not.toHaveBeenCalled();
  });

  it("offers one button per team and carries only the chosen division", async () => {
    db.getReadingTeamCarryoverOffer.mockResolvedValue(offer([TEAM3, TEAM6]));
    db.carryReadingTeamsToStage.mockResolvedValue({
      success: true,
      data: { teams: [{ division: 6, skippedMembers: [{ name: "小明", reason: "plan_requires_pastoral_zone" }] }], skippedTeams: [] }
    });

    const choice = window.offerReadingTeamCarryoverOnJoin(OCT);
    await flush();
    const dialog = document.querySelector("#reading-team-carryover-join-dialog");
    expect(dialog.textContent).toContain("要帶隊伍一起加入嗎？");
    const buttons = [...dialog.querySelectorAll("[data-carryover-division]")];
    expect(buttons.map(button => button.textContent.replace(/\s+/g, " ").trim())).toEqual([
      "帶「恩典同行隊」加入3 人組・3 位隊員",
      "帶「喜樂六人行」加入6 人組・5 位隊員"
    ]);
    expect(dialog.querySelector("[data-carryover-solo]").textContent).toContain("只有我自己加入");

    buttons[1].click();
    await expect(choice).resolves.toBe("carried");
    expect(db.carryReadingTeamsToStage).toHaveBeenCalledWith(OCT, 6);
    expect(alert).toHaveBeenCalledWith(`已將「喜樂六人行」帶入「${OCT.name}」。\nskipped:小明`);
    expect(document.querySelector("#reading-team-carryover-join-dialog")).toBeNull();
  });

  it("lets the captain join alone, or close without doing anything", async () => {
    db.getReadingTeamCarryoverOffer.mockResolvedValue(offer([TEAM3]));
    let choice = window.offerReadingTeamCarryoverOnJoin(OCT);
    await flush();
    document.querySelector("[data-carryover-solo]").click();
    await expect(choice).resolves.toBe("solo");

    choice = window.offerReadingTeamCarryoverOnJoin(OCT);
    await flush();
    document.querySelector("#reading-team-carryover-join-dialog [data-team-close]").click();
    await expect(choice).resolves.toBe(null);
    expect(db.carryReadingTeamsToStage).not.toHaveBeenCalled();
  });

  it("stays open with an explanation when the captain can't join", async () => {
    db.getReadingTeamCarryoverOffer.mockResolvedValue(offer([TEAM3]));
    db.carryReadingTeamsToStage.mockResolvedValue({
      success: true,
      data: { teams: [], skippedTeams: [{ division: 3, reason: "plan_requires_pastoral_zone" }] }
    });
    const choice = window.offerReadingTeamCarryoverOnJoin(OCT);
    await flush();
    document.querySelector("[data-carryover-division='3']").click();
    await flush();
    expect(alert).toHaveBeenCalledWith("blocked:plan_requires_pastoral_zone");
    expect(document.querySelector("#reading-team-carryover-join-dialog")).not.toBeNull();
    expect(document.querySelector("[data-carryover-division='3']").disabled).toBe(false);
    document.querySelector("[data-carryover-solo]").click();
    await expect(choice).resolves.toBe("solo");
  });
});

describe("carry-over at the top of the 我的團隊 dialog", () => {
  it("lists only divisions not joined yet, and shows the new team after carrying", async () => {
    const myTeam6 = { team: { id: "n6", division: 6, name: "新六人隊", captainId: "captain" }, members: [] };
    const myTeam3 = { team: { id: "n3", division: 3, name: "恩典同行隊", captainId: "captain" }, members: [] };
    db.getMyReadingTeam
      .mockResolvedValueOnce({ success: true, context: { teams: [myTeam6] } })
      .mockResolvedValue({ success: true, context: { teams: [myTeam3, myTeam6] } });
    db.getReadingTeamCarryoverOffer.mockResolvedValue(offer([TEAM3, TEAM6]));
    db.carryReadingTeamsToStage.mockResolvedValue({
      success: true,
      data: { teams: [{ division: 3, skippedMembers: [] }], skippedTeams: [] }
    });

    await window.openReadingTeamDialog(OCT, { preferredDivision: 3 });
    await flush();
    const section = document.querySelector("[data-team-carryover]");
    expect(section.hidden).toBe(false);
    expect(section.textContent).toContain("帶上一個計畫的隊伍一起加入");
    const buttons = [...section.querySelectorAll("[data-carryover-division]")];
    expect(buttons.map(button => button.dataset.carryoverDivision)).toEqual(["3"]);
    // 原本的建立新團隊表單還在下面
    expect(document.querySelector("#reading-team-create-form")).not.toBeNull();

    buttons[0].click();
    await flush();
    await flush();
    expect(window.showConfirmDialog).toHaveBeenCalled();
    expect(db.carryReadingTeamsToStage).toHaveBeenCalledWith(OCT, 3);
    expect(alert).toHaveBeenCalledWith(`已將「恩典同行隊」帶入「${OCT.name}」。`);
    expect(db.getMyReadingTeam).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[data-team-carryover]")).toBeNull();
  });

  it("stays hidden when there is nothing to carry", async () => {
    db.getMyReadingTeam.mockResolvedValue({ success: true, context: { teams: [] } });
    db.getReadingTeamCarryoverOffer.mockResolvedValue(offer([]));
    await window.openReadingTeamDialog(OCT);
    await flush();
    expect(document.querySelector("[data-team-carryover]").hidden).toBe(true);
  });

  it("does nothing when the captain cancels the confirmation", async () => {
    db.getMyReadingTeam.mockResolvedValue({ success: true, context: { teams: [] } });
    db.getReadingTeamCarryoverOffer.mockResolvedValue(offer([TEAM3]));
    window.showConfirmDialog = vi.fn().mockResolvedValue(false);
    await window.openReadingTeamDialog(OCT);
    await flush();
    document.querySelector("[data-carryover-division='3']").click();
    await flush();
    expect(db.carryReadingTeamsToStage).not.toHaveBeenCalled();
  });
});
