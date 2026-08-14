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

  it("filters out falsy / teamless contexts before deciding (still solo)", () => {
    expect(getPlanParticipationModel(null, [null, undefined, {}]).variant).toBe("solo");
  });

  it("offers a single My Team entry when joined to exactly one team", () => {
    const m = getPlanParticipationModel(null, [ctx(3, { memberCount: 2, capacity: 3 })]);
    expect(m.variant).toBe("team-with-other-division-available");
    expect(m.icon).toBe("people");
    expect(m.tone).toBe("brand");
    expect(m.action).toEqual({ label: "我的團隊", division: 3, action: "open-team-dialog" });
    expect(m.description).toBe("3人組・光鹽・2/3");
  });

  it("opens My Team for the joined 6-person division instead of nudging the other division", () => {
    const m = getPlanParticipationModel(null, [ctx(6, { memberCount: 4, capacity: 6 })]);
    expect(m.variant).toBe("team-with-other-division-available");
    expect(m.action).toEqual({ label: "我的團隊", division: 6, action: "open-team-dialog" });
  });

  it("uses the success tone once the joined team is full", () => {
    const m = getPlanParticipationModel(null, [ctx(3, { memberCount: 3, capacity: 3 })]);
    expect(m.tone).toBe("success");
    expect(m.action).toEqual({ label: "我的團隊", division: 3, action: "open-team-dialog" });
  });

  it("keeps the same My Team entry when joined to BOTH sizes", () => {
    const m = getPlanParticipationModel(null, [
      ctx(3, { memberCount: 2, capacity: 3 }),
      ctx(6, { memberCount: 5, capacity: 6 })
    ]);
    expect(m.variant).toBe("team-open");
    expect(m.action).toEqual({ label: "我的團隊", division: 3, action: "open-team-dialog" });
    expect(m.action.action).not.toBe("join-team-division");
  });

  it("reports team-full when the primary joined team of a dual membership is full", () => {
    const m = getPlanParticipationModel(null, [
      ctx(3, { memberCount: 3, capacity: 3 }),
      ctx(6, { memberCount: 1, capacity: 6 })
    ]);
    expect(m.variant).toBe("team-full");
    expect(m.tone).toBe("success");
    expect(m.action).toEqual({ label: "我的團隊", division: 3, action: "open-team-dialog" });
  });

  it("falls back gracefully on missing team fields", () => {
    const m = getPlanParticipationModel(null, [{ team: { division: 3 } }]);
    expect(m.description).toBe("3人組・團隊・0/3");
    expect(m.tone).toBe("brand"); // 0/3 is not full
  });

  it("only ever emits registered Lucide icon keys", () => {
    const icons = [
      getPlanParticipationModel(null, []),
      getPlanParticipationModel(null, [ctx(3)]),
      getPlanParticipationModel(null, [ctx(3), ctx(6)])
    ].map(m => m.icon);
    expect(new Set(icons)).toEqual(new Set(["user", "people"]));
  });
});
