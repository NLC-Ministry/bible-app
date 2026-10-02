// #407 團隊異動成功後，db.js 要發 reading-team:changed，讓 plan.js 的「我的團隊」快取清掉。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

const PLAN = { globalPlanId: "00000000-0000-0000-c026-000000000002" };

describe("db reading-team:changed event", () => {
  let dom, db, rpc, changed;

  beforeEach(async () => {
    vi.resetModules();
    dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    rpc = vi.fn(async () => ({ data: {}, error: null }));
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
    vi.stubGlobal("localStorage", dom.window.localStorage);
    vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("location", dom.window.location);
    vi.stubGlobal("state", { isSupabaseMode: true, supabase: { rpc }, currentUser: { id: "me" } });
    await import("../js/db.js?reading-team-changed-event");
    db = dom.window.db || globalThis.db;
    changed = vi.fn();
    dom.window.addEventListener("reading-team:changed", changed);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it.each([
    ["createReadingTeam", () => db.createReadingTeam(PLAN, 3, "Team")],
    ["joinReadingTeam", () => db.joinReadingTeam(PLAN, "abc123")],
    ["leaveReadingTeam", () => db.leaveReadingTeam("team-1")],
    ["removeReadingTeamMember", () => db.removeReadingTeamMember("team-1", "member-2")],
    ["disbandReadingTeam", () => db.disbandReadingTeam("team-1")],
    ["renameReadingTeam", () => db.renameReadingTeam("team-1", "New")],
    ["transferReadingTeamCaptain", () => db.transferReadingTeamCaptain("team-1", "member-2")],
    ["carryReadingTeamsToStage", () => db.carryReadingTeamsToStage(PLAN, 3)]
  ])("fires after %s succeeds", async (_name, call) => {
    const result = await call();
    expect(result.success).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the change fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "team_full" } });
    const result = await db.joinReadingTeam(PLAN, "abc123");
    expect(result.success).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it("does not fire for reads", async () => {
    await db.getMyReadingTeam(PLAN);
    await db.sendReadingTeamReminder({ teamId: "team-1", recipientId: "member-2", globalPlanId: PLAN.globalPlanId });
    expect(changed).not.toHaveBeenCalled();
  });
});
