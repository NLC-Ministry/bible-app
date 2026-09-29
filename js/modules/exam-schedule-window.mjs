// js/modules/exam-schedule-window.mjs
//
// 「排程」視窗裡開放時間的檢查（#339）。開放時間不在「設定」分頁填了，改成按「排程」
// （或已排程時按「改開放時間」）才選。
//   errors   → 擋下，按鈕不能按（跟伺服器端 exam_publish／exam_upsert_paper 的
//              exam_window_invalid 同樣的條件：兩個都要有、結束晚於開始、結束在未來）
//   warnings → 只提醒，仍然可以排程

const ts = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : null;
};

export function checkExamScheduleWindow({ openAt, closeAt, durationMinutes, now = Date.now() } = {}) {
  const open = ts(openAt);
  const close = ts(closeAt);
  const errors = [];
  const warnings = [];

  if (open === null || close === null) {
    errors.push("請選擇開始和結束時間。");
    return { errors, warnings };
  }
  if (close <= open) errors.push("結束時間要晚於開始時間。");
  if (close <= now) errors.push("結束時間已經過了，請選擇未來的時間。");
  if (errors.length) return { errors, warnings };

  if (open < now) warnings.push("開始時間已經過了，排程後會立刻開放作答。");
  const windowMinutes = Math.floor((close - open) / 60000);
  const limit = Number(durationMinutes);
  if (limit > 0 && windowMinutes < limit) {
    warnings.push(`開放時段只有 ${windowMinutes} 分鐘，比作答時限 ${limit} 分鐘短：會友可能會在寫完前被提早收卷。`);
  }
  return { errors, warnings };
}

// 試卷上原本的時間要不要標「已過期」：結束時間已經過了，整段時間都不能用
export function isExamWindowExpired(paper, now = Date.now()) {
  const close = ts(paper?.close_at ?? paper?.closeAt);
  return close !== null && close <= now;
}
