// nlc-data 舊有管理寫入的稽核補記（#549）。這裡只放純函式（組出要記的內容），
// 實際寫入在 index.ts 的 recordAdminAudit()：寫入成功後補記一筆、盡力而為，
// 稽核失敗不影響原本的請求。搬進後台（admin-api）的操作改成同交易寫入，不走這裡。
//
// 只記管理操作；會友自己的寫入（打卡、筆記、作答等）不記。

// 會改資料的管理 RPC。唯讀的（get_*、*_list、統計）不記。
// 批改（exam_grade_*、exam_save_grading_draft）是批改人員的日常工作、量大，不記；
// 隊伍異動已有自己的事件表（0149），也不記。
export const AUDITED_ADMIN_RPCS = new Set([
  // 權限與組織
  "set_profile_managed_scopes",
  "create_region_stage_cohort",
  "publish_global_plan_rules",
  // 每日小測驗設定
  "set_daily_quiz_auto_publish_rule",
  "set_daily_quiz_day_skip",
  "set_daily_quiz_day_custom",
  "swap_daily_quiz_version",
  "set_daily_quiz_answer_key",
  "remove_daily_quiz_kept_question",
  // 大測驗出題、發布、重設、指派
  "exam_upsert_paper",
  "exam_upsert_question",
  "exam_delete_question",
  "exam_save_announcement",
  "exam_publish",
  "exam_set_status",
  "exam_reset_attempts",
  "exam_set_practice_enabled",
  "exam_set_answer_explanation_visible",
  "exam_set_question_explanation",
  "exam_recompute_scores",
  "exam_set_answer_key",
  "exam_publish_results",
  "exam_finalize_expired",
  "exam_assign_attempts",
  "exam_reset_attempt_grading",
  // 雲柱測驗
  "admin_upsert_lightning_quiz_question",
  "admin_set_lightning_quiz_status",
  "admin_delete_lightning_quiz_question",
  "admin_save_lightning_quiz_settings",
  "admin_import_lightning_quiz_questions",
  "admin_publish_lightning_quiz_week_ranking",
  "admin_revoke_lightning_quiz_week_ranking",
  "admin_set_lightning_quiz_voucher_redeemed",
  // 回報、注釋審核
  "issue_admin_set_status",
  "set_commentary_reviewers",
  "resubmit_commentary",
  "publish_approved_commentary"
]);

// 管理用資料表的一般寫入（insert／update／upsert／delete）。issue_reports 只記管理員的
// update／delete；會友送出回報（insert）是自己的寫入。
export const AUDITED_ADMIN_TABLES = new Set([
  "great_regions", "pastoral_zones", "small_groups", "global_plans", "church_announcements",
  "profiles", "app_feature_settings", "passage_commentary", "commentary_terms", "issue_reports"
]);

export function isAuditedTableWrite(table: string, action: string): boolean {
  if (!AUDITED_ADMIN_TABLES.has(table)) return false;
  if (!["insert", "update", "upsert", "delete"].includes(action)) return false;
  return !(table === "issue_reports" && action === "insert");
}

// 單列操作用哪個欄位認列：大部分是 id，功能開關是 key
const ROW_KEY_COLUMN: Record<string, string> = { app_feature_settings: "key" };

export function singleRowKey(table: string, filters: unknown): { column: string; value: string } | null {
  if (!Array.isArray(filters)) return null;
  const column = ROW_KEY_COLUMN[table] || "id";
  const matches = filters.filter((f: any) => f && f.type === "eq" && f.column === column);
  if (matches.length !== 1) return null;
  const value = matches[0].value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  return { column, value: String(value) };
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// 只留有變動的欄位：{ 欄位: { before, after } }。沒有 before（新增）時只記 after。
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): Record<string, { before?: unknown; after?: unknown }> | null {
  if (!after || typeof after !== "object" || Array.isArray(after)) return null;
  const out: Record<string, { before?: unknown; after?: unknown }> = {};
  for (const [key, value] of Object.entries(after)) {
    if (key === "updated_at") continue;
    if (before && typeof before === "object") {
      if (sameValue(before[key], value)) continue;
      out[key] = { before: before[key] ?? null, after: value ?? null };
    } else {
      out[key] = { after: value ?? null };
    }
  }
  return Object.keys(out).length ? out : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (value: unknown) => (typeof value === "string" && UUID_RE.test(value) ? value : null);

const TARGET_USER_ARGS = ["p_profile_id", "p_user_id", "p_target_user_id"];
const TARGET_ID_ARGS = [
  "p_global_plan_id", "p_plan_id", "p_paper_id", "p_question_id", "p_attempt_id", "p_report_id",
  "p_voucher_id", "p_week_start", "p_quiz_date", "p_date", "p_book", "p_id"
];

export function rpcTarget(args: Record<string, unknown> | null | undefined) {
  const source = args && typeof args === "object" ? args : {};
  let targetUserId: string | null = null;
  for (const key of TARGET_USER_ARGS) {
    targetUserId = asUuid(source[key]);
    if (targetUserId) break;
  }
  let targetId: string | null = null;
  for (const key of TARGET_ID_ARGS) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number") { targetId = String(value); break; }
  }
  return { targetUserId, targetId };
}

// p_actor_id 由伺服器注入、等於操作者，不必重複記
export function auditArgs(args: Record<string, unknown> | null | undefined) {
  if (!args || typeof args !== "object") return null;
  const { p_actor_id: _actor, ...rest } = args as Record<string, unknown>;
  return Object.keys(rest).length ? rest : null;
}

// SQL 端拒絕（不是管理員、不在範圍內）算 denied，其他錯誤算 error
export function classifyFailure(error: { message?: string; code?: string } | null | undefined): "denied" | "error" {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  return /42501|forbidden|permission|not[_ ]allowed|not[_ ]authori[sz]ed|admin[_ ]required|scope[_ ]required|權限/i.test(text)
    ? "denied"
    : "error";
}

// x-request-id：前端每個請求帶一個（#548）；沒帶或格式不對就由伺服器產生
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,100}$/;
export function resolveRequestId(header: string | null | undefined, generate: () => string): string {
  const value = String(header || "").trim();
  return REQUEST_ID_RE.test(value) ? value : generate();
}

export type AdminAuditEvent = {
  p_action: string;
  p_result: "ok" | "denied" | "error";
  p_actor_id: string | null;
  p_actor_role: string | null;
  p_resource: string | null;
  p_target_user_id: string | null;
  p_target_id: string | null;
  p_changes: Record<string, unknown> | null;
  p_reason: string | null;
  p_request_id: string | null;
  p_detail: Record<string, unknown> | null;
};

type Actor = { id?: string | null } | null | undefined;

export function buildRpcAuditEvent(input: {
  fn: string;
  args: Record<string, unknown> | null | undefined;
  actor: Actor;
  roleCode: string | null;
  requestId: string | null;
  result: "ok" | "denied" | "error";
  error?: { message?: string; code?: string } | null;
  changes?: Record<string, unknown> | null;
}): AdminAuditEvent {
  const { targetUserId, targetId } = rpcTarget(input.args);
  const detail: Record<string, unknown> = {};
  const args = auditArgs(input.args);
  if (args) detail.args = args;
  if (input.error) detail.error = { code: input.error.code || null, message: String(input.error.message || "").slice(0, 300) };
  return {
    p_action: input.fn,
    p_result: input.result,
    p_actor_id: input.actor?.id || null,
    p_actor_role: input.roleCode,
    p_resource: "rpc",
    p_target_user_id: targetUserId,
    p_target_id: targetId,
    p_changes: input.changes || null,
    p_reason: null,
    p_request_id: input.requestId,
    p_detail: Object.keys(detail).length ? detail : null
  };
}

export function buildTableWriteAuditEvent(input: {
  table: string;
  action: string;
  filters: unknown;
  orFilter?: unknown;
  payload: unknown;
  before: Record<string, unknown> | null;
  actor: Actor;
  roleCode: string | null;
  requestId: string | null;
  result: "ok" | "denied" | "error";
  rowCount?: number | null;
  error?: { message?: string; code?: string } | null;
}): AdminAuditEvent {
  const key = singleRowKey(input.table, input.filters);
  const rows = Array.isArray(input.payload) ? input.payload : (input.payload && typeof input.payload === "object" ? [input.payload] : []);
  const singlePayload = rows.length === 1 ? rows[0] as Record<string, unknown> : null;
  let changes: Record<string, unknown> | null = null;
  if (input.action === "delete") {
    changes = input.before ? { deleted: input.before } : null;
  } else if (singlePayload) {
    changes = diffFields(input.action === "update" ? input.before : null, singlePayload);
  }
  const detail: Record<string, unknown> = {};
  // 批次（沒有單一列條件，或一次多列）只記條件和筆數
  if (!key) {
    const filters = Array.isArray(input.filters) ? input.filters : [];
    if (filters.length) detail.filters = filters;
    if (input.orFilter) detail.or = input.orFilter;
  }
  if (rows.length > 1) detail.rows = rows.length;
  if (typeof input.rowCount === "number") detail.affected = input.rowCount;
  if (input.error) detail.error = { code: input.error.code || null, message: String(input.error.message || "").slice(0, 300) };

  const rowId = key?.value ?? (singlePayload && (typeof singlePayload.id === "string" || typeof singlePayload.id === "number") ? String(singlePayload.id) : null);
  const targetUserId = input.table === "profiles" ? asUuid(rowId) : asUuid(singlePayload?.user_id);
  return {
    p_action: `${input.table}.${input.action}`,
    p_result: input.result,
    p_actor_id: input.actor?.id || null,
    p_actor_role: input.roleCode,
    p_resource: input.table,
    p_target_user_id: targetUserId,
    p_target_id: rowId,
    p_changes: changes,
    p_reason: null,
    p_request_id: input.requestId,
    p_detail: Object.keys(detail).length ? detail : null
  };
}
