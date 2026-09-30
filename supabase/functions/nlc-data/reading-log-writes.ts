// #359 計畫內打卡（reading_logs.plan_id 不是 NULL）只能經 record_chapter_read /
// unrecord_chapter_read（CHECK_IN_RPC_FUNCTIONS）寫入；資料庫也有 trigger 擋
// （check_in_via_rpc_only）。這裡在 nlc-data 先擋，回清楚的錯誤而不是 Postgres 例外。
//
// client 直接寫 reading_logs 只剩：
//   - 自由閱讀（plan_id NULL）：insert/upsert 每一筆 plan_id 都要是空的；
//     update/delete 一定要帶 .is("plan_id", null) 篩選，update 也不能把 plan_id 改成非空。
//   - 「重置計畫進度」（plan.js）：delete 只帶 user_id/plan_id 兩個 eq 篩選 →
//     改走 reset_plan_reading_logs RPC（伺服器檢查擁有者、再整份清掉）。
// 其餘一律拒絕。

export const READING_LOG_PLAN_WRITE_ERROR = "check_in_via_rpc_only";

type Classification =
  | { kind: "not_reading_log_write" }
  | { kind: "free_reading" }
  | { kind: "reset_plan"; planId: string }
  | { kind: "reject" };

const WRITE_ACTIONS = new Set(["insert", "upsert", "update", "delete"]);

function isEmptyPlanId(value: unknown) {
  return value === null || value === undefined || value === "";
}

function payloadRows(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

export function classifyReadingLogWrite(body: any): Classification {
  const table = String(body?.table || "");
  const action = String(body?.action || "select");
  if (table !== "reading_logs" || !WRITE_ACTIONS.has(action)) return { kind: "not_reading_log_write" };

  const filters = Array.isArray(body?.filters) ? body.filters.filter(Boolean) : [];

  if (action === "insert" || action === "upsert") {
    const rows = payloadRows(body?.payload);
    if (rows.length === 0) return { kind: "reject" };
    return rows.every(row => row && typeof row === "object" && isEmptyPlanId(row.plan_id))
      ? { kind: "free_reading" }
      : { kind: "reject" };
  }

  const scopedToFreeReading = filters.some((filter: any) =>
    filter.type === "is" && filter.column === "plan_id" && filter.value === null
  );
  if (scopedToFreeReading) {
    if (action === "update") {
      const rows = payloadRows(body?.payload);
      if (rows.some(row => !row || typeof row !== "object"
        || (Object.prototype.hasOwnProperty.call(row, "plan_id") && !isEmptyPlanId(row.plan_id)))) {
        return { kind: "reject" };
      }
    }
    return { kind: "free_reading" };
  }

  // 重置計畫進度：delete ... eq(user_id) eq(plan_id)，沒有其他篩選、沒有 or。
  if (action === "delete" && !body?.or) {
    const planFilters = filters.filter((filter: any) => filter.column === "plan_id");
    const others = filters.filter((filter: any) => filter.column !== "plan_id" && filter.column !== "user_id");
    const userFiltersAreEq = filters
      .filter((filter: any) => filter.column === "user_id")
      .every((filter: any) => filter.type === "eq");
    const [planFilter] = planFilters;
    if (planFilters.length === 1 && others.length === 0 && userFiltersAreEq
      && planFilter.type === "eq" && typeof planFilter.value === "string" && planFilter.value) {
      return { kind: "reset_plan", planId: planFilter.value };
    }
  }

  return { kind: "reject" };
}
