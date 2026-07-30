import { describe, expect, it } from "vitest";
import { getPlanParticipationModel } from "../js/modules/plan-participation-helpers.mjs";

const ctx = (division, { name = "光鹽", memberCount = 1, capacity = division } = {}) => ({
  team: { division, name, memberCount, capacity }
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

  it("offers the OTHER division when joined to exactly one (the multi-division fix)", () => {
    const m = getPlanParticipationModel(null, [ctx(3, { memberCount: 2, capacity: 3 })]);
    expect(m.variant).toBe("team-with-other-division-available");
    expect(m.icon).toBe("people");
    expect(m.tone).toBe("brand");
    expect(m.action).toEqual({ label: "報名 6人組", division: 6, action: "join-team-division" });
    expect(m.description).toBe("3人組・光鹽・2/3");
  });

  it("mirrors the division when joined only to the 6-person team", () => {
    const m = getPlanParticipationModel(null, [ctx(6, { memberCount: 4, capacity: 6 })]);
    expect(m.variant).toBe("team-with-other-division-available");
    expect(m.action.division).toBe(3);
    expect(m.action.label).toBe("報名 3人組");
  });

  it("uses the success tone once the joined team is full", () => {
    const m = getPlanParticipationModel(null, [ctx(3, { memberCount: 3, capacity: 3 })]);
    expect(m.tone).toBe("success");
    // still offers the other division, since only one is joined
    expect(m.action.division).toBe(6);
  });

  it("switches to view-team (no available division) when joined to BOTH sizes", () => {
    const m = getPlanParticipationModel(null, [
      ctx(3, { memberCount: 2, capacity: 3 }),
      ctx(6, { memberCount: 5, capacity: 6 })
    ]);
    expect(m.variant).toBe("team-open");
    expect(m.action).toEqual({ label: "查看團隊", division: 3, action: "open-team" });
    // never re-offers a division the member already holds
    expect(m.action.action).not.toBe("join-team-division");
  });

  it("reports team-full when the primary joined team of a dual membership is full", () => {
    const m = getPlanParticipationModel(null, [
      ctx(3, { memberCount: 3, capacity: 3 }),
      ctx(6, { memberCount: 1, capacity: 6 })
    ]);
    expect(m.variant).toBe("team-full");
    expect(m.tone).toBe("success");
    expect(m.action.action).toBe("open-team");
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
