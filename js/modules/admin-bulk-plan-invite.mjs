// 跟 send_plan_join_invitations_batch 的 v_max_recipients 一致（scripts/db-behavior.test.mjs 實際呼叫確認）。
export const PLAN_INVITE_BATCH_MAX_RECIPIENTS = 500;
// 批次 RPC 不能用時的逐筆並行數（#676）。
export const PLAN_INVITE_FALLBACK_CONCURRENCY = 5;

export function wasPlanInviteRemindedToday(member) {
  return member && (member.remindedToday === true || member.reminded_today === true);
}

// 批次 RPC 還不能用：nlc-data 白名單沒有（Edge Function 還沒部署）、函式不存在（migration 還沒套用）、
// 或沒有執行權限（本機開發模式直連，函式只開給 service_role）。
// 其他錯誤（沒權限管理計畫、網路中斷）不算：逐筆重送也不會比較好。
export function isPlanInviteBatchUnavailable(error) {
  if (!error || typeof error !== "object") return false;
  const code = String(error.code || "");
  if (code === "PGRST202" || code === "42883" || code === "42501") return true;
  const raw = `${error.error || ""} ${error.message || ""}`.toLowerCase();
  return raw.includes("forbidden_rpc")
    || raw.includes("could not find the function")
    || raw.includes("schema cache");
}

// sendInvitationBatch(plan, ids) 回 { success, results: [{ recipient_id, status }] }；
// { unavailable: true } 或 RPC 不能用的錯誤就把還沒送的人改走 sendInvitation，有限並行。
export async function sendBulkPlanInvitations({
  members,
  plan,
  sendInvitation,
  sendInvitationBatch = null,
  onProgress = () => {}
}) {
  const eligibleMembers = (Array.isArray(members) ? members : [])
    .filter(member => !wasPlanInviteRemindedToday(member));
  const total = eligibleMembers.length;
  const summary = {
    total,
    sentCount: 0,
    duplicateCount: 0,
    failedMembers: []
  };
  const failed = new Set();
  let completed = 0;
  const finish = (member, outcome) => {
    if (outcome === "sent" || outcome === "duplicate") {
      member.remindedToday = true;
      if (outcome === "sent") summary.sentCount += 1;
      else summary.duplicateCount += 1;
    } else {
      failed.add(member);
    }
    completed += 1;
  };

  const sendOneByOne = async (queue) => {
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const member = queue[next];
        next += 1;
        let result = null;
        try {
          result = await sendInvitation(plan, member.id);
        } catch {
          result = null;
        }
        if (result && result.success) {
          finish(member, result.context?.duplicate === true || result.context?.sent === false ? "duplicate" : "sent");
        } else {
          finish(member, "failed");
        }
        onProgress({ completed, total, member });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PLAN_INVITE_FALLBACK_CONCURRENCY, queue.length) }, worker));
  };

  onProgress({ completed: 0, total, member: eligibleMembers[0] || null });

  let cursor = 0;
  if (typeof sendInvitationBatch === "function") {
    while (cursor < total) {
      const chunk = eligibleMembers.slice(cursor, cursor + PLAN_INVITE_BATCH_MAX_RECIPIENTS);
      const ids = [...new Set(chunk.map(member => member.id).filter(Boolean))];
      let response = null;
      try {
        response = await sendInvitationBatch(plan, ids);
      } catch (error) {
        response = { success: false, error };
      }
      if (response && !response.success && (response.unavailable || isPlanInviteBatchUnavailable(response.error))) {
        break;
      }
      const statusById = new Map(
        (response && response.success && Array.isArray(response.results) ? response.results : [])
          .map(row => [String(row.recipient_id), row.status])
      );
      chunk.forEach(member => finish(member, statusById.get(String(member.id))));
      cursor += chunk.length;
      onProgress({ completed, total, member: null });
    }
  }
  if (cursor < total) await sendOneByOne(eligibleMembers.slice(cursor));

  summary.failedMembers = eligibleMembers.filter(member => failed.has(member));
  return summary;
}
