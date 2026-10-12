// 多步驟 action（spec.run）共用的小工具（#550）。
import type { RpcResult, RunOutcome } from "./types.ts";

/** SQL 錯誤 → 回應：參數檢查（ERRCODE 22023）照原訊息回 400，例如 empty_message、plan_not_found；其他 500。 */
export function sqlFailure(stage: string, error: RpcResult["error"]): RunOutcome {
  if (error?.code === "22023") return { ok: false, status: 400, error: error.message || "invalid_params" };
  return { ok: false, status: 500, error: "admin_api_failed", stage, detail: error };
}
