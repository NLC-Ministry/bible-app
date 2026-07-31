import { describe, expect, it, vi } from "vitest";
import {
  sendBulkPlanInvitations,
  wasPlanInviteRemindedToday
} from "../js/modules/admin-bulk-plan-invite.mjs";

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
