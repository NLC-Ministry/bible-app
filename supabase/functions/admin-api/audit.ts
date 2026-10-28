// 後台稽核紀錄（#550 第四組）：audit_list／audit_event／audit_export 的參數檢查、動作的中文名稱、CSV。
//
// 稽核紀錄的 action 有三種來源，名稱在這裡統一翻成中文（清單、匯出都用這份，前端不另外維護）：
//   · admin-api 的 SQL 函式（audit.record('admin-api', '<動作>'…)）
//   · admin-api 擋下的請求（recordDenied：action＝admin-api 的 action 名稱，例如 directory_list）
//   · nlc-data 的補記（AUDITED_ADMIN_RPCS 的 RPC 名稱、「資料表.insert／update／upsert／delete」）
// scripts/admin-api-audit.test.mjs 檢查三邊每個名稱都有中文。
import { taipeiDate, taipeiDateTime, toCsv, withExportTime } from "./exports.ts";
import { sqlFailure } from "./run-helpers.ts";
import type { ActionRunner } from "./types.ts";

export const AUDIT_DAYS = [1, 7, 30, 90, 365] as const;
export const AUDIT_RESULTS = ["ok", "denied", "error"] as const;
// 來源篩選：前端用 legacy 代表 nlc-data 補記的「舊管理畫面」（後台的程式碼裡不出現 nlc-data，見 scripts/admin-console.test.mjs）
export const AUDIT_SOURCE_FILTERS: Readonly<Record<string, string>> = { "admin-api": "admin-api", legacy: "nlc-data" };

const own = (map: Readonly<Record<string, string>>, key: unknown): string | null =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

export type AuditFilters = {
  days: number;
  action: string | null;
  result: string | null;
  source: string | null;
  actorId: string | null;
  targetUserId: string | null;
};

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** 清單與匯出共用的條件。沒帶的條件＝不篩；期間預設 7 天。 */
export function auditFilters(params: Record<string, unknown>): Checked<AuditFilters> {
  const days = params.days ?? 7;
  if (!(AUDIT_DAYS as readonly unknown[]).includes(days)) return { ok: false, error: "invalid_days" };
  const empty = (value: unknown) => value === undefined || value === null || value === "";
  if (!empty(params.action) && !(typeof params.action === "string" && ACTION_RE.test(params.action))) {
    return { ok: false, error: "invalid_action_filter" };
  }
  if (!empty(params.result) && !(AUDIT_RESULTS as readonly unknown[]).includes(params.result)) return { ok: false, error: "invalid_result" };
  if (!empty(params.source) && !own(AUDIT_SOURCE_FILTERS, params.source)) return { ok: false, error: "invalid_source" };
  if (!empty(params.actor_id) && !(typeof params.actor_id === "string" && UUID_RE.test(params.actor_id))) {
    return { ok: false, error: "invalid_user_id" };
  }
  if (!empty(params.target_user_id) && !(typeof params.target_user_id === "string" && UUID_RE.test(params.target_user_id))) {
    return { ok: false, error: "invalid_user_id" };
  }
  return {
    ok: true,
    value: {
      days: days as number,
      action: empty(params.action) ? null : params.action as string,
      result: empty(params.result) ? null : params.result as string,
      source: empty(params.source) ? null : own(AUDIT_SOURCE_FILTERS, params.source),
      actorId: empty(params.actor_id) ? null : (params.actor_id as string).toLowerCase(),
      targetUserId: empty(params.target_user_id) ? null : (params.target_user_id as string).toLowerCase()
    }
  };
}

/** 稽核紀錄的編號（BIGINT identity）：正整數。清單的游標、單筆查詢都用它。 */
export function auditEventId(value: unknown): Checked<number> {
  return Number.isSafeInteger(value) && (value as number) > 0 ? { ok: true, value: value as number } : { ok: false, error: "invalid_event_id" };
}

// ── 中文名稱 ─────────────────────────────────────────────────────────────────

export const AUDIT_SOURCE_LABEL: Readonly<Record<string, string>> = {
  "admin-api": "後台",
  "nlc-data": "舊管理畫面"
};

export const AUDIT_RESULT_LABEL: Readonly<Record<string, string>> = {
  ok: "成功",
  denied: "被拒絕",
  error: "失敗"
};

// nlc-data 補記的資料表寫入：「<資料表>.<insert|update|upsert|delete>」
export const AUDIT_TABLE_LABEL: Readonly<Record<string, string>> = {
  great_regions: "大區",
  pastoral_zones: "牧區",
  small_groups: "小組",
  global_plans: "教會計畫",
  church_announcements: "公告",
  profiles: "會友資料",
  app_feature_settings: "功能開放設定",
  passage_commentary: "經文注釋",
  commentary_terms: "注釋詞彙",
  issue_reports: "回報"
};

const TABLE_VERB: Readonly<Record<string, string>> = {
  insert: "新增",
  update: "修改",
  upsert: "新增或修改",
  delete: "刪除"
};

export const AUDIT_ACTION_LABEL: Readonly<Record<string, string>> = {
  // admin-api 的 SQL 函式寫的
  view_user: "查看使用者",
  view_user_section: "查看使用者的紀錄（點開某一區）",
  reveal_pii: "顯示完整個資",
  export: "匯出",
  view_report: "查看回報",
  "report.set_status": "變更回報狀態",
  "report.reply": "回覆回報",
  "report.note": "回報內部備註",
  "report.attachment_delete": "刪除回報截圖",
  "lightning_quiz.image_upload": "上傳雲柱測驗附圖",
  "report.delete": "刪除回報",
  set_profile_managed_scopes: "設定管理範圍",
  view_plan_roster: "打開計畫名單",
  "care_reminder.send": "送關心提醒",
  view_plan_teams: "打開隊伍清單",
  view_team: "查看隊伍",
  "team.remove_member": "移出隊員",
  "team.dissolve": "解散隊伍（移出唯一的隊長）",
  "team.add_member": "把人加進隊伍",
  "team.recompute_status": "重算隊伍狀態",

  // admin-api 擋下的請求（action 名稱）
  unknown: "不明的後台操作",
  bootstrap: "進入後台",
  home_summary: "看首頁",
  user_search: "查詢使用者",
  user_summary: "查看使用者",
  user_section: "查看使用者紀錄",
  user_timeline: "查看使用者時間軸",
  report_list: "看回報收件匣",
  report_thread: "查看回報",
  report_diagnostics: "看回報診斷資訊",
  report_set_status: "變更回報狀態",
  report_post: "回覆回報",
  report_attachment_delete: "刪除回報截圖",
  report_delete: "刪除回報",
  report_export: "匯出回報",
  directory_list: "看使用者名單",
  directory_export: "匯出使用者名單",
  scope_overview: "看管理範圍",
  scope_set: "設定管理範圍",
  org_export: "匯出組織架構",
  legacy_export_audit: "匯出（照搬的管理區塊）",
  lightning_quiz_image_upload: "上傳雲柱測驗附圖",
  plan_summary: "看計畫總覽",
  plan_roster: "看計畫名單",
  plan_options: "看計畫清單",
  plan_quiz: "看計畫的測驗作答",
  plan_roster_export: "匯出計畫名單",
  care_remind: "送關心提醒",
  team_list: "看隊伍清單",
  team_detail: "查看隊伍",
  team_history: "看隊伍異動歷程",
  team_lineage: "看隊伍跨階段對應",
  team_search: "找隊伍",
  team_remove_member: "移出隊員",
  team_add_member: "把人加進隊伍",
  team_recompute_status: "重算隊伍狀態",
  reading_usage: "看讀經使用率",
  registration_stats: "看報名註冊統計",
  registration_export: "匯出報名註冊統計",
  registration_sheet_sync: "同步報名統計試算表",
  audit_list: "看稽核紀錄",
  audit_event: "看稽核紀錄明細",
  audit_export: "匯出稽核紀錄",

  // nlc-data 補記的管理 RPC（AUDITED_ADMIN_RPCS）
  create_region_stage_cohort: "建立大區梯次",
  publish_global_plan_rules: "發布計畫規則",
  set_daily_quiz_auto_publish_rule: "設定小測驗自動發佈",
  set_daily_quiz_day_skip: "設定小測驗某天不發",
  set_daily_quiz_day_custom: "自訂小測驗某天的題目",
  swap_daily_quiz_version: "更換小測驗版本",
  set_daily_quiz_answer_key: "更正小測驗答案",
  remove_daily_quiz_kept_question: "移除小測驗保留題目",
  publish_daily_quiz_makeup: "補發小測驗",
  exam_upsert_paper: "編輯大測驗試卷",
  exam_upsert_question: "編輯大測驗題目",
  exam_delete_question: "刪除大測驗題目",
  exam_save_announcement: "儲存大測驗公告",
  exam_publish: "發布大測驗",
  exam_set_status: "變更大測驗狀態",
  exam_reset_attempts: "重設大測驗作答",
  exam_set_practice_enabled: "設定大測驗練習模式",
  exam_set_answer_explanation_visible: "設定大測驗詳解是否顯示",
  exam_set_question_explanation: "編輯大測驗題目詳解",
  exam_recompute_scores: "重算大測驗成績",
  exam_set_answer_key: "設定大測驗標準答案",
  exam_publish_results: "公布大測驗成績",
  exam_finalize_expired: "結算逾時的大測驗作答",
  exam_assign_attempts: "指派大測驗批改",
  exam_reset_attempt_grading: "重設大測驗批改",
  admin_upsert_lightning_quiz_question: "編輯雲柱測驗題目",
  admin_set_lightning_quiz_status: "變更雲柱測驗題目狀態",
  admin_delete_lightning_quiz_question: "刪除雲柱測驗題目",
  admin_save_lightning_quiz_settings: "儲存雲柱測驗設定",
  admin_import_lightning_quiz_questions: "匯入雲柱測驗題目",
  admin_publish_lightning_quiz_week_ranking: "公布雲柱測驗每週前三名",
  admin_revoke_lightning_quiz_week_ranking: "撤回雲柱測驗每週前三名",
  admin_set_lightning_quiz_voucher_redeemed: "標記兌換券已兌換",
  admin_set_lightning_quiz_vouchers_expiry: "更改兌換券有效期限",
  admin_set_lightning_quiz_answer_key: "更正雲柱測驗答案",
  issue_admin_set_status: "變更回報狀態",
  set_commentary_reviewers: "設定注釋審核人",
  resubmit_commentary: "注釋重新送審",
  publish_approved_commentary: "發布已審核的注釋",
  // nlc-data（舊頁）與 admin-api 的報表區（#568）都記這個
  sync_registration_stats_sheet: "同步報名統計試算表"
};

// 匯出（action＝export）依 detail.kind 補上匯出了什麼
export const AUDIT_EXPORT_KIND_LABEL: Readonly<Record<string, string>> = {
  reports: "回報",
  user_directory: "使用者名單",
  org_structure: "組織架構",
  audit: "稽核紀錄",
  plan_roster: "計畫名單",
  registration_stats: "報名註冊統計",
  legacy: "照搬的管理區塊"
};

// 照搬區塊的 id → 名稱（同 admin/src/legacy.ts；admin-api 單獨部署，不能 import 前端檔）。
// 移除的區塊名稱留著，之前的匯出紀錄才看得懂（RETIRED_LEGACY_SECTIONS）：#565 的加入計畫狀況、組員總覽、計畫統計，
// #568 的讀經使用率、報名註冊統計（改成「報表」區）。
export const RETIRED_LEGACY_SECTIONS = ["join-status", "members", "statistics", "reading-activity", "registrations"] as const;
export const AUDIT_LEGACY_SECTION_LABEL: Readonly<Record<string, string>> = {
  announcements: "公告",
  commentary: "經文注釋",
  quizzes: "小測驗",
  exam: "大測驗",
  "lightning-quiz": "雲柱測驗",
  plans: "計畫設定",
  "join-status": "加入計畫狀況",
  members: "組員總覽",
  teams: "組隊狀況",
  statistics: "計畫統計",
  "reading-activity": "讀經使用率",
  registrations: "報名註冊統計",
  settings: "功能開放設定"
};


/** 動作名稱 → 中文；認不得的原樣回傳（新加的動作忘了翻譯時，畫面仍看得到原名）。 */
export function auditActionLabel(action: unknown): string {
  const direct = own(AUDIT_ACTION_LABEL, action);
  if (direct) return direct;
  if (typeof action === "string") {
    const dot = action.lastIndexOf(".");
    if (dot > 0) {
      const table = own(AUDIT_TABLE_LABEL, action.slice(0, dot));
      const verb = own(TABLE_VERB, action.slice(dot + 1));
      if (table && verb) return `${verb}${table}`;
    }
    return action;
  }
  return "—";
}

/** 一筆紀錄的標題：動作中文；匯出再補上匯出了什麼。 */
export function auditEventLabel(event: { action?: unknown; detail?: unknown }): string {
  const base = auditActionLabel(event.action);
  if (event.action !== "export") return base;
  const detail = event.detail && typeof event.detail === "object" ? event.detail as Record<string, unknown> : {};
  if (detail.kind === "legacy") {
    const section = own(AUDIT_LEGACY_SECTION_LABEL, detail.section);
    return section ? `匯出${section}` : `匯出${AUDIT_EXPORT_KIND_LABEL.legacy}`;
  }
  const kind = own(AUDIT_EXPORT_KIND_LABEL, detail.kind);
  return kind ? `匯出${kind}` : base;
}

// ── runners ──────────────────────────────────────────────────────────────────

type AuditRow = Record<string, unknown> & { action?: unknown; detail?: unknown };

const withLabel = (row: AuditRow) => ({
  ...row,
  label: auditEventLabel(row),
  source_label: own(AUDIT_SOURCE_LABEL, row.source) || String(row.source ?? "")
});

export const runAuditList: ActionRunner = async ({ args, rpc }) => {
  const result = await rpc("admin_api_audit_list", args);
  if (result.error) return sqlFailure("admin_api_audit_list", result.error);
  const data = (result.data || {}) as {
    items?: AuditRow[];
    facets?: { actions?: Array<{ action?: unknown; count?: unknown }>; actors?: unknown[] } | null;
  } & Record<string, unknown>;
  const facets = data.facets && typeof data.facets === "object"
    ? {
      ...data.facets,
      actions: (Array.isArray(data.facets.actions) ? data.facets.actions : []).map((entry) => ({ ...entry, label: auditActionLabel(entry.action) }))
    }
    : null;
  return {
    ok: true,
    data: { ...data, items: (Array.isArray(data.items) ? data.items : []).map(withLabel), facets }
  };
};

export const runAuditEvent: ActionRunner = async ({ args, rpc }) => {
  const result = await rpc("admin_api_audit_event", args);
  if (result.error) return sqlFailure("admin_api_audit_event", result.error);
  if (!result.data || typeof result.data !== "object") return { ok: false, status: 404, error: "audit_event_not_found" };
  return { ok: true, data: withLabel(result.data as AuditRow) };
};

export const AUDIT_EXPORT_HEADERS = [
  "時間", "來源", "操作者", "操作者角色", "動作", "動作代碼", "對象", "對象編號", "結果", "理由", "變更內容", "補充資訊", "請求編號", "紀錄編號"
] as const;

const json = (value: unknown) => (value === null || value === undefined ? "" : JSON.stringify(value));

export function auditCsv(rows: readonly AuditRow[]): string {
  return toCsv(AUDIT_EXPORT_HEADERS, rows.map((row) => {
    const actor = row.actor && typeof row.actor === "object" ? row.actor as { id?: unknown; name?: unknown } : null;
    const target = row.target_user && typeof row.target_user === "object" ? row.target_user as { id?: unknown; name?: unknown } : null;
    const tooLong = `（內容過長，請到後台看第 ${row.id} 筆）`;
    return [
      taipeiDateTime(row.occurred_at),
      own(AUDIT_SOURCE_LABEL, row.source) || String(row.source ?? ""),
      actor ? String(actor.name || actor.id || "") : "",
      String(row.actor_role_label || row.actor_role || ""),
      auditEventLabel(row),
      String(row.action ?? ""),
      target ? String(target.name || target.id || "") : "",
      String(row.target_id ?? (target?.id || "")),
      own(AUDIT_RESULT_LABEL, row.result) || String(row.result ?? ""),
      String(row.reason ?? ""),
      row.changes_omitted === true ? tooLong : json(row.changes),
      row.detail_omitted === true ? tooLong : json(row.detail),
      String(row.request_id ?? ""),
      typeof row.id === "number" ? row.id : String(row.id ?? "")
    ];
  }));
}

export const runAuditExport: ActionRunner = async ({ args, rpc }) => {
  const result = await rpc("admin_api_audit_export", args);
  if (result.error) return sqlFailure("admin_api_audit_export", result.error);
  const data = (result.data || {}) as { rows?: AuditRow[]; total?: number; truncated?: boolean };
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const now = new Date();
  return {
    ok: true,
    data: {
      filename: `稽核紀錄_${taipeiDate(now)}.csv`,
      csv: withExportTime(auditCsv(rows), now),
      rows: rows.length,
      total: typeof data.total === "number" ? data.total : rows.length,
      truncated: data.truncated === true
    }
  };
};
