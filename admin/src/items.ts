// 各區塊／時間軸的一筆紀錄 → 標題＋細節（#555）。純函式；畫面用 React 文字節點顯示，一律跳脫。

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

/** href：點了打開的後台頁（回報 → 收件匣裡那張對話，#550；團隊異動 → 隊伍頁，#566）。 */
export type ItemView = { title: string; details: string[]; when: string; href?: string };

const MEMBER_ROLE_LABEL: Record<string, string> = { captain: "隊長", member: "隊員" };
const EXAM_STATUS_LABEL: Record<string, string> = { in_progress: "作答中", submitted: "已交卷", graded: "已批改" };
const QUIZ_STATUS_LABEL: Record<string, string> = { in_progress: "作答中", completed: "已完成" };

function compact(values: (string | null | false | undefined)[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim() !== "" && value !== "—");
}

/** teamLinks：看的人有 plans.read 才給團隊異動連結（沒權限點進去也是 403） */
export function describeItem(item: SectionItem, { teamLinks = false }: { teamLinks?: boolean } = {}): ItemView {
  const when = formatDateTime(item.at);
  switch (item.section) {
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
          ? { href: formatRoute({ view: "plans", tab: "teams", planId: isUuid(item.global_plan_id) ? String(item.global_plan_id).toLowerCase() : null, teamId: String(item.team_id).toLowerCase() }) }
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
      const state = item.voided_at ? "已作廢" : item.redeemed_at ? `已兌換（${formatDateTime(item.redeemed_at)}）` : "未兌換";
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

/** 下一頁的游標：時間欄位缺漏時無法往下載（admin-api 會拒絕），當成沒有下一頁。 */
export function cursorAfter(items: readonly SectionItem[]): Cursor | null {
  const last = items[items.length - 1];
  return last && typeof last.at === "string" && last.at && last.id ? { at: last.at, id: last.id } : null;
}

export function usableCursor(cursor: { at?: unknown; id?: unknown } | null | undefined): Cursor | null {
  return cursor && typeof cursor.at === "string" && cursor.at && typeof cursor.id === "string" && cursor.id
    ? { at: cursor.at, id: cursor.id }
    : null;
}
