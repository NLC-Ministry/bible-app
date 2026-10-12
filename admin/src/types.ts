// admin-api 回傳資料的形狀（#547 的 SQL 函式：supabase/migrations/20261011110008_admin_api_support.sql）。

export type Bootstrap = {
  me: { id: string; name: string | null; email: string | null; role_code: string; role_label: string | null } | null;
  capabilities: string[];
  feature_settings: { key: string; enabled: boolean; description: string | null }[];
  org: OrgTreeNode[];
};

/** 組織名單（依 sort_order 排好）：大區 → 牧區 → 小組 */
export type OrgTreeNode = { id: string; name: string; zones: { id: string; name: string; groups: { id: string; name: string }[] }[] };

export type SearchResult = {
  id: string;
  name: string | null;
  email_masked: string | null;
  great_region: string | null;
  pastoral_zone: string | null;
  small_group: string | null;
  role_code: string;
  role_label: string | null;
  is_active: boolean | null;
  last_seen_at: string | null;
};

export type SectionName = "reading_logs" | "team_events" | "tests" | "vouchers" | "reports";

export type SectionItem = { section: SectionName; id: string; at: string | null; [key: string]: unknown };

export type Cursor = { at: string; id: string };

export type Page = { items: SectionItem[]; next_cursor: Cursor | null };

export type PlanSummary = {
  plan_id: string;
  global_plan_id: string | null;
  name: string | null;
  plan_kind: string | null;
  is_personal: boolean | null;
  start_date: string | null;
  end_date: string | null;
  church_start_date: string | null;
  church_end_date: string | null;
  current_round: number | null;
  grace_days: number | null;
  joined_at: string | null;
  round1_chapters: number;
  current_round_chapters: number;
  logged_chapters: number;
  last_read_at: string | null;
  teams: { team_id: string; name: string | null; status: string | null; division: string | null; member_role: string | null; is_captain: boolean }[];
};

export type UserSummary = {
  account: {
    id: string;
    name: string | null;
    email_masked: string | null;
    phone_masked: string | null;
    has_email: boolean;
    has_phone: boolean;
    is_active: boolean | null;
    role_code: string;
    role_label: string | null;
    created_at: string | null;
    last_seen_at: string | null;
    has_member_hub_id: boolean;
  };
  identities: { provider: string; email_masked: string | null; is_primary: boolean | null; created_at: string | null; last_seen_at: string | null }[];
  org: { great_region: string | null; pastoral_zone: string | null; small_group: string | null };
  member_hub: {
    synced_at: string | null;
    sync_status: string | null;
    sync_error: string | null;
    membership_lifecycle_state: string | null;
    placement_state: string | null;
    required_action: string | null;
    leadership_display_label: string | null;
  };
  plans: PlanSummary[];
  counts: Record<SectionName, number>;
  latest: Record<SectionName, SectionItem[]>;
};

export type RevealedPii = {
  email: string | null;
  phone: string | null;
  identities: { provider: string; email: string | null; is_primary: boolean | null }[];
};

// ── 回報收件匣（#550）──────────────────────────────────────────────────────
export type ReportReporter = {
  id: string;
  name: string | null;
  great_region?: string | null;
  pastoral_zone: string | null;
  small_group: string | null;
};

export type ReportListItem = {
  id: string;
  category: string;
  status: string;
  description: string;
  created_at: string;
  last_message_at: string | null;
  sort_at: string;
  unread: boolean;
  message_count: number;
  reporter: ReportReporter | null;
};

export type ReportCounts = Record<"all" | "open" | "pending" | "processing" | "resolved" | "ignored" | "unread", number>;

export type ReportPage = { items: ReportListItem[]; next_cursor: Cursor | null; counts: ReportCounts | null };

export type ReportMessage = {
  id: string;
  author_role: "member" | "admin";
  author_name: string | null;
  is_internal: boolean;
  body: string;
  created_at: string;
  has_attachment: boolean;
  attachment_url: string | null;
  attachment_w: number | null;
  attachment_h: number | null;
};

export type ReportThread = {
  report: {
    id: string;
    category: string;
    status: string;
    description: string;
    url: string | null;
    created_at: string;
    last_message_at: string | null;
    closed_at: string | null;
    admin_last_read_at: string | null;
    member_last_read_at: string | null;
    has_diagnostics: boolean;
    reporter: ReportReporter | null;
  };
  messages: ReportMessage[];
};

/** admin-api 產生的 CSV（伺服器端已記稽核；前端只負責下載）。 */
export type CsvExport = { filename: string; csv: string; rows: number; total: number; truncated: boolean; plan_name?: string | null };
export type ReportExport = CsvExport;

// ── 帳號與權限（#550）──────────────────────────────────────────────────────
// supabase/migrations/20261012053123_admin_api_accounts.sql
export type DirectoryTeam = { name: string | null; role: string | null };

export type DirectoryItem = {
  id: string;
  name: string | null;
  email_masked: string | null;
  great_region: string | null;
  pastoral_zone: string | null;
  small_group: string | null;
  is_active: boolean | null;
  sync_status: string | null;
  synced_at: string | null;
  role_code: string;
  role_label: string | null;
  /** 逗號分隔（profiles 原樣） */
  managed_regions: string;
  managed_zones: string;
  managed_groups: string;
  joined: boolean;
  teams: DirectoryTeam[];
};

export type PlanOption = { id: string; name: string | null; start_date: string | null; end_date: string | null; plan_kind: string | null };

export type DirectoryPage = {
  items: DirectoryItem[];
  total: number;
  next_offset: number | null;
  /** 這頁用的計畫（沒指定時伺服器挑的預設計畫） */
  plan_id: string | null;
  /** 只有第一頁有 */
  plans: PlanOption[] | null;
  all_count: number | null;
};

export type ScopeLeader = {
  id: string;
  name: string | null;
  email_masked: string | null;
  role_code: string;
  role_label: string | null;
  great_region: string | null;
  pastoral_zone: string | null;
  small_group: string | null;
  managed_regions: string[];
  managed_zones: string[];
  managed_groups: string[];
};

export type ScopeOverview = { leaders: ScopeLeader[] };

export type ScopeSetResult = {
  profile_id: string;
  role_code: string;
  managed_regions: string[];
  managed_zones: string[];
  managed_groups: string[];
};

// ── 稽核紀錄（#550 第四組）──────────────────────────────────────────────────
// supabase/migrations/20261012102522_admin_api_audit.sql；label 由 admin-api 補上（audit.ts）
export type AuditPerson = { id: string; name: string | null };

export type AuditEvent = {
  id: number;
  occurred_at: string;
  source: string;
  source_label: string;
  action: string;
  label: string;
  resource: string | null;
  result: "ok" | "denied" | "error" | string;
  reason: string | null;
  request_id: string | null;
  actor: AuditPerson | null;
  actor_role: string | null;
  actor_role_label: string | null;
  target_user: AuditPerson | null;
  target_id: string | null;
  changes: unknown;
  detail: unknown;
  // 清單裡太大的變更內容／補充資訊不放，點開再用 audit_event 抓
  changes_omitted: boolean;
  detail_omitted: boolean;
};

export type AuditFacets = {
  actions: { action: string; label: string; count: number }[];
  actors: { id: string; name: string | null; count: number }[];
};

export type AuditPage = {
  items: AuditEvent[];
  next_cursor: number | null;
  // 第一頁才有
  total: number | null;
  facets: AuditFacets | null;
  since: string;
  actor: AuditPerson | null;
  target: AuditPerson | null;
};
