const RETIRED_GLOBAL_PLAN_IDS = new Set([
  "00000000-0000-0000-c026-000000009999"
]);
const RETIRED_PLAN_PRESET_KEYS = new Set(["q1", "q2", "q3", "q4"]);
const RETIRED_PLAN_NAMES = new Set([
  "測試讀書計畫",
  "測試讀經計畫",
  "團報測試計畫",
  "第一季速讀：2026年7月~9月",
  "第二季速讀：2026年10月~12月",
  "第三季速讀：2027年1月~3月",
  "第四季速讀：2027年4月~6月"
]);

function isRetiredValue(column: string, value: unknown) {
  if (value == null) return false;
  const normalized = String(value);
  if (column === "id" || column === "global_plan_id") {
    return RETIRED_GLOBAL_PLAN_IDS.has(normalized);
  }
  if (column === "preset_key") {
    return RETIRED_PLAN_PRESET_KEYS.has(normalized);
  }
  if (column === "name") {
    return RETIRED_PLAN_NAMES.has(normalized);
  }
  return false;
}

export function isRetiredPlanRequest(body: any) {
  const table = String(body?.table || "");
  const action = String(body?.action || "select");
  const filters = Array.isArray(body?.filters) ? body.filters : [];
  const payloadRows = Array.isArray(body?.payload) ? body.payload : [body?.payload];

  if (action === "rpc") {
    return isRetiredValue("global_plan_id", body?.args?.p_global_plan_id);
  }

  if (!["global_plans", "reading_plans", "reading_logs"].includes(table)) {
    return false;
  }

  const filterMatch = filters.some((filter: any) =>
    filter?.type === "eq" && isRetiredValue(String(filter.column || ""), filter.value)
  );
  if (filterMatch) return true;

  return payloadRows.some((row: any) =>
    row && typeof row === "object" && (
      isRetiredValue("id", row.id)
      || isRetiredValue("global_plan_id", row.global_plan_id)
      || isRetiredValue("preset_key", row.preset_key)
      || isRetiredValue("name", row.name)
    )
  );
}
