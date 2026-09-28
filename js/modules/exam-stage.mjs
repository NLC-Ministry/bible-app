// js/modules/exam-stage.mjs
//
// 大測驗五個階段（#297、#300）：
//   ① 準備中 → ② 已排程 → ③ 作答中 → ④ 批改中 → ⑤ 已公布
// 由試卷現有欄位推算（伺服器端 _exam_paper_stage 同樣的規則，另外多看 close_at：
// 截止時間過了、每分鐘的自動收卷還沒跑到時，畫面上就先算批改中）。

export const EXAM_STAGES = [
  { key: "preparing", label: "準備中" },
  { key: "scheduled", label: "已排程" },
  { key: "open", label: "作答中" },
  { key: "grading", label: "批改中" },
  { key: "published", label: "已公布" }
];

const ts = (value) => {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : null;
};

// paper 可以是後台的 snake_case（open_at）或會友端的 camelCase（openAt）
export function examStage(paper, now = Date.now()) {
  if (!paper) return null;
  if (paper.results_published_at || paper.resultsPublishedAt) return "published";
  if (paper.status === "draft") return "preparing";
  if (paper.status === "closed") return "grading";
  if (paper.status === "published") {
    const openAt = ts(paper.open_at ?? paper.openAt);
    const closeAt = ts(paper.close_at ?? paper.closeAt);
    if (openAt === null || now < openAt) return "scheduled";
    if (closeAt === null || now < closeAt) return "open";
    return "grading";
  }
  return paper.stage || null;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// 「12/28（日）09:00」，一律用台北時間（跟伺服器端 _exam_default_card_body 一樣）
export function formatExamTime(iso) {
  const t = ts(iso);
  if (t === null) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei", month: "numeric", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${parts.month}/${parts.day}（${WEEKDAYS[EN_WEEKDAYS.indexOf(parts.weekday)]}）${parts.hour}:${parts.minute}`;
}

// 進度條旁邊那一句「下一步」
export function examNextStepText(stage, paper, { checklistDone = false, officialAttemptCount = 0 } = {}) {
  const openAt = formatExamTime(paper?.open_at ?? paper?.openAt);
  const closeAt = formatExamTime(paper?.close_at ?? paper?.closeAt);
  switch (stage) {
    case "preparing":
      return checklistDone
        ? "準備好了。按「排程」後，會友首頁就會出現這份測驗。"
        : "完成下面的清單，就可以排程。";
    case "scheduled":
      return `開放時間 ${openAt}，時間到會自動開放作答。開放前仍可修改題目內容。`;
    case "open":
      return `作答中，${closeAt} 截止後會自動收卷並計分。`;
    case "grading":
      return officialAttemptCount > 0
        ? "已收卷。確認正解、批改完簡答題後，按「公布成績」。"
        : "已收卷，這份測驗沒有人作答。";
    case "published":
      return "成績已公布，所有結算都已鎖定。";
    default:
      return "";
  }
}
