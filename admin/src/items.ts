// 各區塊／時間軸的一筆紀錄 → 標題＋細節（#555；#567 加計畫報名、團隊、通知）。純函式；畫面用 React 文字節點顯示，一律跳脫。

import { CARE_REMINDER_REASONS } from "./plans.ts";
import { formatRoute, isUuid } from "./route.ts";
import type { Cursor, SectionItem } from "./types.ts";
import {
  REPORT_CATEGORY_LABEL,
  REPORT_STATUS_LABEL,
  TEAM_EVENT_LABEL,
  TEST_KIND_LABEL,
  formatDate,
  formatDateTime,
  label,
  text
} from "./format.ts";

/** href：點了打開的後台頁（回報 → 收件匣裡那張對話，#550；團隊、團隊異動 → 隊伍頁，#566；計畫報名 → 計畫區，#567）。 */
export type ItemView = { title: string; details: string[]; when: string; href?: string };

export type DescribeOptions = {
  /** 看的人有 plans.read 才給隊伍頁、計畫區連結（沒權限點進去也是 403） */
  teamLinks?: boolean;
  /** 教會時區的今天（YYYY-MM-DD），判斷兌換券過期；沒有就不判斷 */
  today?: string | null;
};

const MEMBER_ROLE_LABEL: Record<string, string> = { captain: "隊長", member: "隊員" };
const EXAM_STATUS_LABEL: Record<string, string> = { in_progress: "作答中", submitted: "已交卷", graded: "已批改" };
const QUIZ_STATUS_LABEL: Record<string, string> = { in_progress: "作答中", completed: "已完成" };
const TEAM_STATUS_LABEL: Record<string, string> = { forming: "組隊中（未滿）", ready: "已滿" };
const CARE_REASON_LABEL: Record<string, string> = Object.fromEntries(CARE_REMINDER_REASONS.map((reason) => [reason.value, reason.label]));
const NOTIFICATION_KIND_LABEL: Record<string, string> = { care: "關心提醒", quiz: "小測驗通知", exam: "大測驗通知" };

const uuidOrNull = (value: unknown) => (isUuid(value) ? String(value).toLowerCase() : null);

/** 兌換券狀態，判斷順序同 admin_api_user_summary 的 voucher_states：作廢 → 已兌換 → 過期 → 未兌換 */
export function voucherState(item: SectionItem, today: string | null | undefined): string {
  if (item.voided_at) return "已作廢";
  if (item.redeemed_at) return `已兌換（${formatDateTime(item.redeemed_at)}）`;
  if (today && typeof item.expires_on === "string" && item.expires_on < today) return "已過期";
  return "未兌換";
}

function compact(values: (string | null | false | undefined)[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim() !== "" && value !== "—");
}

export function describeItem(item: SectionItem, { teamLinks = false, today = null }: DescribeOptions = {}): ItemView {
  const when = formatDateTime(item.at);
  switch (item.section) {
    case "plans": {
      const teams = Array.isArray(item.teams) ? item.teams as { name?: unknown; is_captain?: unknown }[] : [];
      const start = item.church_start_date || item.start_date;
      const end = item.church_end_date || item.end_date;
      const planId = uuidOrNull(item.global_plan_id);
      return {
        title: `${text(item.name, "（未命名計畫）")}${item.is_personal ? "（個人計畫）" : ""}`,
        details: compact([
          `${formatDate(start)} – ${formatDate(end)}`,
          `目前第 ${text(item.current_round, "1")} 遍`,
          `打卡 ${Number(item.logged_chapters) || 0} 章`,
          item.last_read_at ? `最後打卡 ${formatDateTime(item.last_read_at)}` : "還沒打卡",
          item.grace_days ? `寬限 ${text(item.grace_days)} 天` : null,
          teams.length ? `團隊：${teams.map((team) => `${text(team.name, "未命名隊伍")}${team.is_captain ? "（隊長）" : ""}`).join("、")}` : null
        ]),
        when: `報名 ${when}`,
        ...(teamLinks && planId && !item.is_personal ? { href: formatRoute({ view: "plans", tab: "roster", planId }) } : {})
      };
    }
    case "teams": {
      const teamId = uuidOrNull(item.team_id);
      return {
        title: text(item.team_name, "未命名隊伍"),
        details: compact([
          text(item.plan_name),
          item.division ? `組別 ${text(item.division)} 人` : null,
          typeof item.size === "number" ? `目前 ${item.size} 人` : null,
          item.member_role ? label(MEMBER_ROLE_LABEL, item.member_role) : null,
          item.status ? label(TEAM_STATUS_LABEL, item.status) : null
        ]),
        when: `加入 ${when}`,
        ...(teamLinks && teamId ? { href: formatRoute({ view: "plans", tab: "teams", planId: uuidOrNull(item.global_plan_id), teamId }) } : {})
      };
    }
    case "notifications": {
      const kind = label(NOTIFICATION_KIND_LABEL, item.kind);
      let title = kind;
      if (item.kind === "care") title = `${kind}：${text(item.sender_name, "（未填姓名）")}・${label(CARE_REASON_LABEL, item.reason)}`;
      if (item.kind === "quiz" && item.quiz_date) title = `${kind}：${formatDate(item.quiz_date)}`;
      return {
        title,
        details: compact([text(item.message, ""), text(item.plan_name, ""), item.read_at ? `已讀（${formatDateTime(item.read_at)}）` : "未讀"]),
        when
      };
    }
    case "reading_logs":
      return {
        title: `${text(item.book, "")} ${text(item.chapter, "")} 章`.trim(),
        details: compact([text(item.plan_name), item.round ? `第 ${item.round} 遍` : null]),
        when
      };
    case "team_events":
      return {
        title: `${label(TEAM_EVENT_LABEL, item.event_type)}${item.team_name ? `：${text(item.team_name)}` : ""}`,
        details: compact([
          text(item.plan_name),
          item.member_role ? label(MEMBER_ROLE_LABEL, item.member_role) : null,
          item.division ? `組別 ${text(item.division)}` : null
        ]),
        when,
        // 隊伍已刪就沒有 team_name（LEFT JOIN），不給連結
        ...(teamLinks && isUuid(item.team_id) && item.team_name
          ? { href: formatRoute({ view: "plans", tab: "teams", planId: uuidOrNull(item.global_plan_id), teamId: String(item.team_id).toLowerCase() }) }
          : {})
      };
    case "tests":
      if (item.kind === "exam") {
        return {
          title: `${TEST_KIND_LABEL.exam}：${text(item.title, "（未命名試卷）")}`,
          details: compact([
            label(EXAM_STATUS_LABEL, item.status),
            item.total_score !== null && item.total_score !== undefined ? `${item.total_score} 分` : null,
            item.is_test ? "測試作答" : null,
            item.attempt_kind ? text(item.attempt_kind) : null
          ]),
          when
        };
      }
      if (item.kind === "daily_quiz") {
        return {
          title: `${TEST_KIND_LABEL.daily_quiz}：${formatDate(item.quiz_date)}`,
          details: compact([
            label(QUIZ_STATUS_LABEL, item.status),
            item.score !== null && item.score !== undefined ? `${item.score}／${text(item.total, "?")} 題` : null
          ]),
          when
        };
      }
      return {
        title: `${TEST_KIND_LABEL.lightning_quiz}：${formatDate(item.rise_date)}`,
        details: compact([
          item.is_correct === true ? "答對" : item.is_correct === false ? "答錯" : "未作答",
          typeof item.elapsed_ms === "number" ? `${(item.elapsed_ms / 1000).toFixed(1)} 秒` : null
        ]),
        when
      };
    case "vouchers": {
      const state = voucherState(item, today);
      return {
        title: `兌換券：${formatDate(item.week_start)} 那週第 ${text(item.rank, "?")} 名`,
        details: compact([
          state,
          item.amount !== null && item.amount !== undefined ? `${item.amount} 元` : null,
          item.code ? `代碼 ${text(item.code)}` : null,
          item.expires_on ? `${formatDate(item.expires_on)} 到期` : null
        ]),
        when
      };
    }
    case "reports":
      return {
        title: `回報：${label(REPORT_CATEGORY_LABEL, item.category)}・${label(REPORT_STATUS_LABEL, item.status)}`,
        details: compact([text(item.description, "")]),
        when,
        ...(isUuid(item.id) ? { href: formatRoute({ view: "inbox", reportId: item.id.toLowerCase() }) } : {})
      };
    default:
      return { title: text((item as SectionItem).section), details: [], when };
  }
}

export function usableCursor(cursor: { at?: unknown; id?: unknown } | null | undefined): Cursor | null {
  return cursor && typeof cursor.at === "string" && cursor.at && typeof cursor.id === "string" && cursor.id
    ? { at: cursor.at, id: cursor.id }
    : null;
}
