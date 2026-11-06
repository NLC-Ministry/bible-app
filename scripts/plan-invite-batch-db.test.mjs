// #676：js/db.js 的批次提醒接上 sendBulkPlanInvitations，用真的 db.js（只換掉 state.supabase.rpc），
// 確認 RPC 的參數、以及新 RPC 還沒上線時真的退回單筆。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { sendBulkPlanInvitations } from "../js/modules/admin-bulk-plan-invite.mjs";

const PLAN_ID = "40000000-0000-4000-8000-000000000676";
const PLAN = { id: PLAN_ID, globalPlanId: PLAN_ID, name: "測試計畫", presetKey: "stage-676" };
const people = count => Array.from({ length: count }, (_, index) => ({
  id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  name: `測試會友 ${index}`
}));

describe("db.sendPlanJoinInvitationsBatch", () => {
  let dom, db, rpc;

  beforeEach(async () => {
    vi.resetModules();
    dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    rpc = vi.fn();
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("localStorage", dom.window.localStorage);
    vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("location", dom.window.location);
    vi.stubGlobal("auth", { isLoggedIn: () => true, getValidAccessToken: async () => "tok" });
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      supabase: { rpc },
      supabaseConfig: { url: "https://proj.supabase.co/", anonKey: "anon" },
      globalPlans: [{ id: PLAN_ID, name: "測試計畫" }]
    });
    await import("../js/db.js?plan-invite-batch");
    db = dom.window.db || globalThis.db;
  }, 60_000); // 第一次 import db.js 在機器忙時要十幾秒

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  const bulk = (members, plan = PLAN) => sendBulkPlanInvitations({
    members,
    plan,
    sendInvitation: (target, id) => db.sendPlanJoinInvitation(target, id),
    sendInvitationBatch: (target, ids) => db.sendPlanJoinInvitationsBatch(target, ids)
  });
  const calledWith = name => rpc.mock.calls.filter(([fn]) => fn === name);

  it("200 人：前端只打 1 次 RPC；參數只有計畫和名單，不帶訊息、不帶 actor", async () => {
    rpc.mockImplementation(async (_fn, args) => ({
      data: { results: args.p_recipient_ids.map(id => ({ recipient_id: id, status: "sent" })) },
      error: null
    }));

    const members = people(200);
    const summary = await bulk(members);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("send_plan_join_invitations_batch");
    expect(Object.keys(args).sort()).toEqual(["p_global_plan_id", "p_plan_key", "p_recipient_ids"]);
    expect(args.p_global_plan_id).toBe(PLAN_ID);
    expect(args.p_plan_key).toBe("stage-676");
    expect(args.p_recipient_ids).toHaveLength(200);
    expect(summary).toMatchObject({ total: 200, sentCount: 200, duplicateCount: 0, failedMembers: [] });
  });

  it.each([
    ["nlc-data 白名單還沒有", { error: "forbidden_rpc" }],
    ["migration 還沒套用", {
      error: "Could not find the function public.send_plan_join_invitations_batch in the schema cache",
      code: "PGRST202"
    }]
  ])("%s：改打單筆 RPC，不整批失敗", async (_label, batchError) => {
    rpc.mockImplementation(async fn => (fn === "send_plan_join_invitations_batch"
      ? { data: null, error: batchError }
      : { data: { sent: true, duplicate: false }, error: null }));

    const summary = await bulk(people(12));

    expect(calledWith("send_plan_join_invitations_batch")).toHaveLength(1);
    expect(calledWith("send_plan_join_invitation")).toHaveLength(12);
    expect(summary).toMatchObject({ total: 12, sentCount: 12, failedMembers: [] });
  });

  it("分梯次計畫本來就不走團隊 RPC：直接逐筆，不打批次", async () => {
    const cohortPlan = { ...PLAN, planKind: "church_campaign_stage_cohort" };
    const sendCareReminder = vi.spyOn(db, "sendCareReminder").mockResolvedValue({ data: {} });

    const summary = await bulk(people(3), cohortPlan);

    expect(rpc).not.toHaveBeenCalled();
    expect(sendCareReminder).toHaveBeenCalledTimes(3);
    expect(summary.sentCount).toBe(3);
  });

  it("沒有權限管理計畫：那一批算失敗，不逐筆繞去 care reminder", async () => {
    rpc.mockResolvedValue({ data: null, error: { error: "plan_management_scope_required", code: "P0001" } });
    const sendCareReminder = vi.spyOn(db, "sendCareReminder");

    const summary = await bulk(people(4));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(sendCareReminder).not.toHaveBeenCalled();
    expect(summary.failedMembers).toHaveLength(4);
  });
});
