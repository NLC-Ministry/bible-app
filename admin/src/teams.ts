// 後台隊伍除錯（#566）與修正動作（#571）的型別與畫面規則。純函式，測試直接測。
//
// 檢查、「會友 App 應該顯示」、加入方式、異動的白話說明都由伺服器算好（_shared/progress/team-report.mjs，
// 和會友 App 同一份規則）；這裡只放清單的篩選與排序，與修正動作按鈕何時出現。
// 修正動作真正的檢查（已結束階段、已在別隊、沒報名、已滿、隊長）在 SQL，這裡只決定畫面上給不給按。

export type TeamListFilter = "all" | "unfilled" | "issues";

export type TeamListRow = {
  id: string; name: string; division: number; status: string; statusLabel: string;
  memberCount: number; missing: number; captainName: string; carried: boolean;
  issues: number; issueLabels: string[];
};
export type TeamPlan = { id: string; name: string; planKind: string; startDate: string; endDate: string; stage: boolean; ended: boolean };
export type TeamList = {
  plan: TeamPlan;
  today: string;
  teams: TeamListRow[];
  counts: { teams: number; unfilled: number; issues: number; members: number };
};

export type TeamCheck = { id: string; label: string; applicable: boolean; ok: boolean; problems: string[]; impact: string; fix: string };
export type CarryStage = {
  planId: string; planName: string; shown: boolean; reason: string; warning: string;
  carriedTeam: { id: string; name: string } | null;
  skipped: { id: string; name: string; reason: string }[];
};
export type TeamMemberRow = {
  id: string; name: string; role: string; roleLabel: string; joinedAt: string | null;
  joinMethod: { key: string; label: string }; active: boolean; unit: string;
  enrolled: boolean; statusLabel: string; progress: number; round: number; chapters: number; behindDays: number;
};
export type TeamDetail = {
  plan: TeamPlan;
  today: string;
  team: {
    id: string; name: string; division: number; status: string; statusLabel: string;
    captain: { id: string; name: string }; inviteCode: string; memberCount: number;
    carriedFromTeamId: string | null; createdAt: string | null; lastEventAt: string | null;
  };
  app: {
    progress: number; inviteVisible: boolean; invite: string; inviteNote: string;
    carry: { applicable: boolean; message: string; stages: CarryStage[] };
  };
  checks: TeamCheck[];
  issues: number;
  members: TeamMemberRow[];
};

export type TeamHistoryEvent = {
  id: string; at: string; kind: "member" | "team"; eventType: string; text: string; actor: string;
  member: { id: string; name: string } | null;
  engineering: { functions: string[]; txid: number | null; dbUser: string; appName: string; callContext: string };
};
export type TeamHistory = { recordsSince: string | null; events: TeamHistoryEvent[] };

export type LineageStage = {
  plan: { id: string; name: string; startDate: string | null; endDate: string | null; planKind: string };
  team: { id: string; name: string; division: number; captainName: string; status: string; statusLabel: string };
  current: boolean;
  carriedFromTeamId: string | null;
  hasParent: boolean;
  members: { id: string; name: string; role: string }[];
  added: { id: string; name: string }[];
  removed: { id: string; name: string; elsewhere: { id: string; name: string } | null; inferred: string }[];
};
export type TeamLineage = { teamId: string | null; stages: LineageStage[] };

export type TeamSearchResult = {
  id: string; name: string; division: number; status: string; member_count: number; captain_name: string | null;
  matched_code: boolean;
  plan: { id: string; name: string; plan_kind: string; start_date: string | null; end_date: string | null };
};

export const TEAM_FILTER_OPTIONS: readonly { value: TeamListFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "unfilled", label: "還沒滿" },
  { value: "issues", label: "有異常" }
];

/** 清單篩選：全部／還沒滿／有異常；有異常的排前面，再依組別、隊名 */
export function filterTeams(rows: readonly TeamListRow[], filter: TeamListFilter, query = ""): TeamListRow[] {
  const q = query.trim();
  return rows
    .filter((row) => (filter === "unfilled" ? row.missing > 0 : filter === "issues" ? row.issues > 0 : true))
    .filter((row) => !q || row.name.includes(q) || row.captainName.includes(q))
    .sort((a, b) => b.issues - a.issues || a.division - b.division || a.name.localeCompare(b.name, "zh-Hant") || a.id.localeCompare(b.id));
}

/** 清單右邊那一小段：有異常寫幾項，不然寫缺幾人或已滿 */
export function teamRowNote(row: TeamListRow): string {
  if (row.issues > 0) return `${row.issues} 項異常`;
  return row.missing > 0 ? `還缺 ${row.missing} 人` : "已滿";
}

// ── 修正動作（#571）────────────────────────────────────────────────────────
export type TeamRemoveResult = {
  team_id: string; global_plan_id: string; removed_user_id: string; dissolved: boolean; member_count: number; status: string | null;
};
export type TeamAddResult =
  | { added: true; team_id: string; user_id: string; member_count: number; status: string }
  | { added: false; blocked: "already_in_other_team"; other_team: { id: string; name: string | null } };
export type TeamRecomputeResult = { team_id: string; member_count: number; status_before: string; status: string; changed: boolean };
/** user_search 的一筆（加人時找人用） */
export type UserSearchHit = {
  id: string; name: string | null; email_masked: string | null;
  great_region: string | null; pastoral_zone: string | null; small_group: string | null; is_active: boolean | null;
};

const STATUS_LABEL: Readonly<Record<string, string>> = { forming: "招募中", ready: "已滿" };
export const teamStatusLabel = (status: string | null | undefined) => STATUS_LABEL[String(status)] || String(status || "未知");

/** 這隊給不給修正：要有 teams.write；已結束的階段一律不能改（同 0163 的保護，後台不提供繞過） */
export function teamFixState(detail: TeamDetail, capabilities: readonly string[]): { allowed: boolean; note: string } {
  if (!capabilities.includes("teams.write")) return { allowed: false, note: "" };
  if (detail.plan.stage && detail.plan.ended) {
    return { allowed: false, note: "階段已結束，名單不能修改。要改請到現行階段的那一隊（打開「跨階段對應」找到對應的隊）。" };
  }
  return { allowed: true, note: "" };
}

/** 移出這位成員：隊長只剩自己一人時＝解散這隊；隊上還有別人時不能移出隊長（不做轉移隊長） */
export function memberRemoval(detail: TeamDetail, memberId: string): { allowed: boolean; dissolve: boolean; note: string } {
  if (detail.team.captain.id !== memberId) return { allowed: true, dissolve: false, note: "" };
  if (detail.members.length <= 1) return { allowed: true, dissolve: true, note: "" };
  return { allowed: false, dissolve: false, note: "隊上還有其他人，不能移出隊長" };
}

/** 加人按鈕：沒滿才給（滿了 SQL 也會擋） */
export function canAddMember(detail: TeamDetail): boolean {
  return detail.members.length < detail.team.division;
}

/** 狀態檢查沒過才給「重算狀態」 */
export function needsRecompute(detail: TeamDetail): boolean {
  return detail.checks.some((check) => check.id === "status" && !check.ok);
}

/** 找人結果的單位 */
export function hitUnit(hit: UserSearchHit): string {
  return [hit.great_region, hit.pastoral_zone, hit.small_group].filter(Boolean).join("・");
}
