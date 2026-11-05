import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  PLAN_INVITE_BATCH_MAX_RECIPIENTS,
  isPlanInviteBatchUnavailable,
  sendBulkPlanInvitations,
  wasPlanInviteRemindedToday
} from "../js/modules/admin-bulk-plan-invite.mjs";

const people = (count, prefix = "person") =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, name: `測試會友 ${index}` }));

const batchSent = (plan, ids) => ({
  success: true,
  results: ids.map(id => ({ recipient_id: id, status: "sent" }))
});

// 兩種「批次 RPC 還不能用」的實際回應（js/db.js 的 callEdge 把 nlc-data 的 body 當 error 回傳）
const NOT_IN_WHITELIST = { success: false, error: { error: "forbidden_rpc" } };
const FUNCTION_MISSING = {
  success: false,
  error: {
    error: "Could not find the function public.send_plan_join_invitations_batch(p_actor_id, p_global_plan_id, p_plan_key, p_recipient_ids) in the schema cache",
    code: "PGRST202"
  }
};

describe("admin bulk plan invitations", () => {
  it("skips people already reminded today", async () => {
    const members = [
      { id: "one", remindedToday: true },
      { id: "two", reminded_today: true },
      { id: "three" }
    ];
    const sendInvitation = vi.fn().mockResolvedValue({
      success: true,
      context: { sent: true, duplicate: false }
    });

    const result = await sendBulkPlanInvitations({
      members,
      plan: { id: "plan" },
      sendInvitation
    });

    expect(sendInvitation).toHaveBeenCalledTimes(1);
    expect(sendInvitation).toHaveBeenCalledWith({ id: "plan" }, "three");
    expect(result.sentCount).toBe(1);
    expect(wasPlanInviteRemindedToday(members[2])).toBe(true);
  });

  it("continues after duplicates, failures, and thrown requests", async () => {
    const members = [
      { id: "sent", name: "Sent" },
      { id: "duplicate", name: "Duplicate" },
      { id: "failed", name: "Failed" },
      { id: "thrown", name: "Thrown" }
    ];
    const sendInvitation = vi.fn()
      .mockResolvedValueOnce({ success: true, context: { sent: true } })
      .mockResolvedValueOnce({ success: true, context: { sent: false, duplicate: true } })
      .mockResolvedValueOnce({ success: false })
      .mockRejectedValueOnce(new Error("network"));
    const progress = [];

    const result = await sendBulkPlanInvitations({
      members,
      plan: { id: "plan" },
      sendInvitation,
      onProgress: state => progress.push([state.completed, state.total])
    });

    expect(result).toMatchObject({
      total: 4,
      sentCount: 1,
      duplicateCount: 1
    });
    expect(result.failedMembers.map(member => member.id)).toEqual(["failed", "thrown"]);
    expect(progress).toEqual([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
  });
});

describe("批次 RPC（#676）", () => {
  it("200 人只打 1 次批次 RPC，不再一人一次", async () => {
    const members = people(200);
    const sendInvitation = vi.fn();
    const sendInvitationBatch = vi.fn(batchSent);

    const result = await sendBulkPlanInvitations({ members, plan: { id: "plan" }, sendInvitation, sendInvitationBatch });

    expect(sendInvitationBatch).toHaveBeenCalledTimes(1);
    expect(sendInvitation).not.toHaveBeenCalled();
    expect(sendInvitationBatch.mock.calls[0][1]).toHaveLength(200);
    expect(result).toMatchObject({ total: 200, sentCount: 200, duplicateCount: 0, failedMembers: [] });
    expect(members.every(wasPlanInviteRemindedToday)).toBe(true);
  });

  it("超過伺服器上限就分批送，一次不會超過上限；進度照批往前", async () => {
    const count = PLAN_INVITE_BATCH_MAX_RECIPIENTS * 2 + 7;
    const sendInvitationBatch = vi.fn(batchSent);
    const progress = [];

    const result = await sendBulkPlanInvitations({
      members: people(count),
      plan: { id: "plan" },
      sendInvitation: vi.fn(),
      sendInvitationBatch,
      onProgress: state => progress.push([state.completed, state.total])
    });

    expect(sendInvitationBatch).toHaveBeenCalledTimes(3);
    for (const [, ids] of sendInvitationBatch.mock.calls) {
      expect(ids.length).toBeLessThanOrEqual(PLAN_INVITE_BATCH_MAX_RECIPIENTS);
    }
    expect(result.sentCount).toBe(count);
    expect(progress).toEqual([
      [0, count],
      [PLAN_INVITE_BATCH_MAX_RECIPIENTS, count],
      [PLAN_INVITE_BATCH_MAX_RECIPIENTS * 2, count],
      [count, count]
    ]);
  });

  it("每人結果對到畫面：已送、今天已提醒算成功；沒有權限等其他結果算失敗且不標記已提醒", async () => {
    const members = [
      { id: "sent" }, { id: "duplicate" }, { id: "outside" }, { id: "missing" },
      { id: "joined" }, { id: "self" }, { id: "no-answer" }, { id: "weird" }
    ];
    const sendInvitation = vi.fn();
    const sendInvitationBatch = vi.fn(async () => ({
      success: true,
      results: [
        { recipient_id: "sent", status: "sent" },
        { recipient_id: "duplicate", status: "duplicate" },
        { recipient_id: "outside", status: "outside_scope" },
        { recipient_id: "missing", status: "not_found" },
        { recipient_id: "joined", status: "already_joined" },
        { recipient_id: "self", status: "self" },
        { recipient_id: "weird", status: "something_new" }
      ]
    }));

    const result = await sendBulkPlanInvitations({ members, plan: { id: "plan" }, sendInvitation, sendInvitationBatch });

    expect(result.sentCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.failedMembers.map(member => member.id)).toEqual(["outside", "missing", "joined", "self", "no-answer", "weird"]);
    expect(members.filter(wasPlanInviteRemindedToday).map(member => member.id)).toEqual(["sent", "duplicate"]);
    // 個別被拒的人不再逐筆重送：單筆的 care reminder 退路不能繞過批次的判斷
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it("送出前去掉重複的 id，今天已提醒的人不送", async () => {
    const sendInvitationBatch = vi.fn(batchSent);
    const result = await sendBulkPlanInvitations({
      members: [{ id: "a" }, { id: "a" }, { id: "b", remindedToday: true }, { id: "c" }],
      plan: { id: "plan" },
      sendInvitation: vi.fn(),
      sendInvitationBatch
    });

    expect(sendInvitationBatch.mock.calls[0][1]).toEqual(["a", "c"]);
    expect(result.total).toBe(3);
  });

  it("傳給批次 RPC 的只有計畫和 id，沒有訊息內容（內容由伺服器決定）", async () => {
    const plan = { id: "plan", name: "測試計畫" };
    const sendInvitationBatch = vi.fn(batchSent);
    await sendBulkPlanInvitations({ members: people(2), plan, sendInvitation: vi.fn(), sendInvitationBatch });
    expect(sendInvitationBatch.mock.calls[0]).toEqual([plan, ["person-0", "person-1"]]);
  });

  it("批次 RPC 其他錯誤（例如網路）：那一批算失敗、不逐筆重送，後面的批照樣送", async () => {
    const members = people(PLAN_INVITE_BATCH_MAX_RECIPIENTS + 1);
    const sendInvitation = vi.fn();
    const sendInvitationBatch = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementationOnce(batchSent);

    const result = await sendBulkPlanInvitations({ members, plan: { id: "plan" }, sendInvitation, sendInvitationBatch });

    expect(sendInvitationBatch).toHaveBeenCalledTimes(2);
    expect(sendInvitation).not.toHaveBeenCalled();
    expect(result.failedMembers).toHaveLength(PLAN_INVITE_BATCH_MAX_RECIPIENTS);
    expect(result.sentCount).toBe(1);
  });
});

describe("批次 RPC 還不能用時退回逐筆（#676）", () => {
  // 記錄同時在飛的請求數，確認真的有並行、也真的有上限
  const trackedInvitation = () => {
    const tracker = { active: 0, peak: 0 };
    const sendInvitation = vi.fn(async () => {
      tracker.active += 1;
      tracker.peak = Math.max(tracker.peak, tracker.active);
      await new Promise(resolve => setImmediate(resolve));
      tracker.active -= 1;
      return { success: true, context: { sent: true, duplicate: false } };
    });
    return { sendInvitation, tracker };
  };

  it.each([
    ["nlc-data 白名單還沒有（舊版 Edge Function）", NOT_IN_WHITELIST],
    ["migration 還沒套用（函式不存在）", FUNCTION_MISSING],
    ["後端標明不支援（例如分梯次計畫）", { success: false, unavailable: true }]
  ])("%s：全部改逐筆送，有限並行、不整批失敗", async (_label, refusal) => {
    const members = people(23);
    const { sendInvitation, tracker } = trackedInvitation();
    const sendInvitationBatch = vi.fn(async () => refusal);
    const progress = [];

    const result = await sendBulkPlanInvitations({
      members,
      plan: { id: "plan" },
      sendInvitation,
      sendInvitationBatch,
      onProgress: state => progress.push(state.completed)
    });

    expect(sendInvitationBatch).toHaveBeenCalledTimes(1);
    expect(sendInvitation).toHaveBeenCalledTimes(23);
    expect(result).toMatchObject({ total: 23, sentCount: 23, duplicateCount: 0, failedMembers: [] });
    expect(members.every(wasPlanInviteRemindedToday)).toBe(true);
    expect(tracker.peak).toBeGreaterThan(1);
    expect(tracker.peak).toBeLessThanOrEqual(5);
    expect(progress).toEqual(Array.from({ length: 24 }, (_, index) => index));
  });

  it("多批的情況：第一批被拒之後不再試批次，剩下全部逐筆", async () => {
    const count = PLAN_INVITE_BATCH_MAX_RECIPIENTS + 3;
    const { sendInvitation } = trackedInvitation();
    const sendInvitationBatch = vi.fn(async () => NOT_IN_WHITELIST);

    const result = await sendBulkPlanInvitations({ members: people(count), plan: { id: "plan" }, sendInvitation, sendInvitationBatch });

    expect(sendInvitationBatch).toHaveBeenCalledTimes(1);
    expect(sendInvitation).toHaveBeenCalledTimes(count);
    expect(result.sentCount).toBe(count);
  });

  it("中途才被拒（部署到一半）：已送的不重送，只有剩下的逐筆", async () => {
    const count = PLAN_INVITE_BATCH_MAX_RECIPIENTS + 2;
    const { sendInvitation } = trackedInvitation();
    const sendInvitationBatch = vi.fn()
      .mockImplementationOnce(batchSent)
      .mockResolvedValueOnce(FUNCTION_MISSING);

    const result = await sendBulkPlanInvitations({ members: people(count), plan: { id: "plan" }, sendInvitation, sendInvitationBatch });

    expect(sendInvitation).toHaveBeenCalledTimes(2);
    expect(result.sentCount).toBe(count);
  });

  it("逐筆失敗照舊只算那一個人，名單順序不因完成順序改變", async () => {
    const members = people(8);
    const sendInvitation = vi.fn(async (_plan, id) => {
      await new Promise(resolve => setImmediate(resolve));
      if (id === "person-1" || id === "person-6") throw new Error("network");
      if (id === "person-2") return { success: false };
      if (id === "person-3") return { success: true, context: { sent: false, duplicate: true } };
      return { success: true, context: { sent: true } };
    });

    const result = await sendBulkPlanInvitations({
      members,
      plan: { id: "plan" },
      sendInvitation,
      sendInvitationBatch: async () => NOT_IN_WHITELIST
    });

    expect(result).toMatchObject({ total: 8, sentCount: 4, duplicateCount: 1 });
    expect(result.failedMembers.map(member => member.id)).toEqual(["person-1", "person-2", "person-6"]);
  });

  it("只有「RPC 不存在／沒開放」才算不能用", () => {
    expect(isPlanInviteBatchUnavailable(NOT_IN_WHITELIST.error)).toBe(true);
    expect(isPlanInviteBatchUnavailable(FUNCTION_MISSING.error)).toBe(true);
    expect(isPlanInviteBatchUnavailable({ code: "42883", message: "function public.x(uuid) does not exist" })).toBe(true);
    // 本機開發模式走真的 client：函式只開給 service_role
    expect(isPlanInviteBatchUnavailable({ code: "42501", message: "permission denied for function x" })).toBe(true);

    expect(isPlanInviteBatchUnavailable(null)).toBe(false);
    expect(isPlanInviteBatchUnavailable(new TypeError("Failed to fetch"))).toBe(false);
    expect(isPlanInviteBatchUnavailable({ error: "plan_management_scope_required", code: "P0001" })).toBe(false);
    expect(isPlanInviteBatchUnavailable({ error: "plan_not_found", code: "P0001" })).toBe(false);
    expect(isPlanInviteBatchUnavailable({ error: "plan_invitation_batch_too_large", code: "P0001" })).toBe(false);
  });
});

describe("呼叫端與 nlc-data 接線（#676）", () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it.each([
    ["js/modules/admin.js", "db.sendPlanJoinInvitationsBatch(targetPlan, memberIds)"],
    ["js/modules/pastoral.js", "window.db.sendPlanJoinInvitationsBatch(target, ids)"]
  ])("%s 兩條路都有給", (path, batchCall) => {
    const source = read(path);
    expect(source).toContain(batchCall);
    expect(source).toContain("sendPlanJoinInvitation(");
  });

  it("nlc-data：在白名單、限管理者、會注入 p_actor_id；是寫入所以不能進批次讀取", () => {
    const source = read("supabase/functions/nlc-data/index.ts");
    const setBody = name => {
      const start = source.indexOf(`const ${name} = new Set([`);
      expect(start, name).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf("]);", start));
    };
    expect(setBody("TEAM_RPC_FUNCTIONS")).toContain('"send_plan_join_invitations_batch"');
    expect(setBody("PLAN_MANAGEMENT_RPC_FUNCTIONS")).toContain('"send_plan_join_invitations_batch"');
    expect(setBody("BATCH_RPC_FUNCTIONS")).not.toContain("send_plan_join_invitations_batch");
    expect(read("js/data/nlc-read-coalescer.mjs")).not.toContain("send_plan_join_invitations_batch");
  });
});
