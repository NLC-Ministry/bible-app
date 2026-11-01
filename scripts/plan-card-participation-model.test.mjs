import { describe, expect, it } from "vitest";
import {
  getPlanParticipationModel,
  shouldHidePlanTeamInviteShortcut
} from "../js/modules/plan-participation-helpers.mjs";

const ctx = (division, { name = "光鹽", memberCount = 1, capacity = division } = {}) => ({
  team: { division, name, memberCount, capacity }
});

describe("shouldHidePlanTeamInviteShortcut", () => {
  it("hides only when every current plan has both the 3-person and 6-person teams", () => {
    expect(shouldHidePlanTeamInviteShortcut([
      [ctx(3), ctx(6)],
      [ctx(3), ctx(6)]
    ])).toBe(true);

    expect(shouldHidePlanTeamInviteShortcut([
      [ctx(3), ctx(6)],
      [ctx(3)]
    ])).toBe(false);
  });

  it("keeps the shortcut when there are no current team plans or contexts are incomplete", () => {
    expect(shouldHidePlanTeamInviteShortcut([])).toBe(false);
    expect(shouldHidePlanTeamInviteShortcut([[]])).toBe(false);
    expect(shouldHidePlanTeamInviteShortcut([[ctx(6), null, {}]])).toBe(false);
  });
});

describe("getPlanParticipationModel", () => {
  it("returns the solo variant when the member is in no team", () => {
    const m = getPlanParticipationModel(null, []);
    expect(m.variant).toBe("solo");
    expect(m.icon).toBe("user");
    expect(m.tone).toBe("neutral");
    expect(m.title).toBe("個人讀經中");
    expect(m.description).toBe("尚未加入團隊");
    expect(m.action).toEqual({ label: "建立 / 加入團隊", division: 3, action: "join-team-division" });
  });

  // #652：個人加入後，上一個計畫的隊長在卡片上要直接看到帶隊入口。
  it("offers carrying the previous plan's team when a solo member can carry one", () => {
    const m = getPlanParticipationModel(null, [], {
      carryoverTeams: [{ sourceTeamId: "t1", name: "光鹽", division: 6, memberCount: 5 }]
    });
    expect(m.variant).toBe("carryover");
    expect(m.icon).toBe("people");
    expect(m.tone).toBe("brand");
    expect(m.title).toBe("帶「光鹽」加入");
    expect(m.description).toBe("上一個計畫的隊伍可直接帶入");
    expect(m.action).toEqual({ label: "帶隊加入", division: 6, action: "carry-team" });
  });

  it("names how many teams can be carried when there is more than one", () => {
    const m = getPlanParticipationModel(null, [], {
      carryoverTeams: [
        { sourceTeamId: "t1", name: "光鹽", division: 3 },
        { sourceTeamId: "t2", name: "恩典", division: 6 }
      ]
    });
    expect(m.variant).toBe("carryover");
    expect(m.title).toBe("帶上一個計畫的 2 支隊伍加入");
    expect(m.action).toEqual({ label: "帶隊加入", division: 3, action: "open-team-dialog" });
  });

  it("ignores carryover teams once the member is already in a team", () => {
    const m = getPlanParticipationModel(null, [ctx(3, { memberCount: 2, capacity: 3 })], {
      carryoverTeams: [{ sourceTeamId: "t1", name: "光鹽", division: 6 }]
    });
    expect(m.variant).toBe("team-open");
  });

  it("filters out falsy / teamless contexts before deciding (still solo)", () => {
    expect(getPlanParticipationModel(null, [null, undefined, {}]).variant).toBe("solo");
  });

  it("invites members for the one joined, not-yet-full team", () => {
    const m = getPlanParticipationModel(null, [ctx(3, { memberCount: 2, capacity: 3 })]);
    expect(m.variant).toBe("team-open");
    expect(m.icon).toBe("share");
    expect(m.tone).toBe("brand");
    expect(m.title).toBe("邀請組員加入");
    expect(m.action).toEqual({ label: "邀請組員", division: 3, action: "open-team-dialog" });
    expect(m.description).toBe("3人組・還缺 1 人");
  });

  it("invites for the joined 6-person division instead of nudging the other division", () => {
    const m = getPlanParticipationModel(null, [ctx(6, { memberCount: 4, capacity: 6 })]);
    expect(m.variant).toBe("team-open");
    expect(m.action).toEqual({ label: "邀請組員", division: 6, action: "open-team-dialog" });
  });

  it("nudges toward the other division once the one joined team is full, instead of a division-specific 'full' label", () => {
    const m = getPlanParticipationModel(null, [ctx(3, { memberCount: 3, capacity: 3 })]);
    expect(m.variant).toBe("team-full-other-available");
    expect(m.tone).toBe("brand");
    expect(m.icon).toBe("people");
    expect(m.title).toBe("還可以組一隊 6 人隊");
    expect(m.description).toBe("3人隊已滿員");
    expect(m.action).toEqual({ label: "組 6 人隊", division: 6, action: "open-team-dialog" });
  });

  it("keeps inviting for whichever joined division still has room when both sizes are joined", () => {
    const m = getPlanParticipationModel(null, [
      ctx(3, { memberCount: 2, capacity: 3 }),
      ctx(6, { memberCount: 5, capacity: 6 })
    ]);
    expect(m.variant).toBe("team-open");
    expect(m.action).toEqual({ label: "邀請組員", division: 3, action: "open-team-dialog" });
    expect(m.action.action).not.toBe("join-team-division");
  });

  it("invites for the still-open division even when the first-joined division is full", () => {
    const m = getPlanParticipationModel(null, [
      ctx(3, { memberCount: 3, capacity: 3 }),
      ctx(6, { memberCount: 1, capacity: 6 })
    ]);
    expect(m.variant).toBe("team-open");
    expect(m.tone).toBe("brand");
    expect(m.action).toEqual({ label: "邀請組員", division: 6, action: "open-team-dialog" });
    expect(m.description).toBe("6人組・還缺 5 人");
  });

  it("reports team-full with no action only once every joined division is full", () => {
    const m = getPlanParticipationModel(null, [
      ctx(3, { memberCount: 3, capacity: 3 }),
      ctx(6, { memberCount: 6, capacity: 6 })
    ]);
    expect(m.variant).toBe("team-full");
    expect(m.tone).toBe("success");
    expect(m.title).toBe("隊伍已滿");
    expect(m.action).toBeNull();
  });

  it("falls back gracefully on missing team fields", () => {
    const m = getPlanParticipationModel(null, [{ team: { division: 3 } }]);
    expect(m.description).toBe("3人組・還缺 3 人");
    expect(m.tone).toBe("brand"); // 0/3 is not full
  });

  it("only ever emits registered Lucide icon keys", () => {
    const icons = [
      getPlanParticipationModel(null, []),
      getPlanParticipationModel(null, [ctx(3, { memberCount: 1, capacity: 3 })]),
      getPlanParticipationModel(null, [ctx(3, { memberCount: 3, capacity: 3 })]),
      getPlanParticipationModel(null, [
        ctx(3, { memberCount: 3, capacity: 3 }),
        ctx(6, { memberCount: 6, capacity: 6 })
      ])
    ].map(m => m.icon);
    expect(new Set(icons)).toEqual(new Set(["user", "share", "people", "checkCircle"]));
  });
});
