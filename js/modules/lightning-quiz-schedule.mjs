// js/modules/lightning-quiz-schedule.mjs
// 快問快答後台的排程判斷（純函式，不碰 DOM）。
//
// 資料庫只存兩種狀態（#309）：draft＝準備中、published＝已排程。畫面上的
// 「作答中」「已結束」由日期與時段推算（台灣時間），規則跟 SQL 的
// _lightning_quiz_window_started／_lightning_quiz_window_ended 一致：
// 開始時間當下就算開始，結束時間那一分鐘內都還算作答中。

export const LIGHTNING_QUIZ_STAGE_LABELS = Object.freeze({
  draft: "準備中",
  scheduled: "已排程",
  live: "作答中",
  ended: "已結束"
});

function hhmmss(value) {
  const text = String(value || "");
  return text.length === 5 ? `${text}:00` : text;
}

// now：{ date: "YYYY-MM-DD", time: "HH:MM:SS" }（台灣時間）
export function lightningQuizStage(question, now) {
  if (!question || question.status !== "published") return "draft";
  const date = String(question.riseDate || "");
  const start = hhmmss(question.riseTimeStart);
  const end = hhmmss(question.riseTimeEnd);
  const time = hhmmss(now?.time);
  if (date < now.date || (date === now.date && time > end)) return "ended";
  if (date === now.date && time >= start) return "live";
  return "scheduled";
}

// 複製成新題：沿用題型、題目、正解與時段，日期留空讓管理員重新選。
export function copyLightningQuizQuestion(question) {
  return {
    id: null,
    riseDate: "",
    riseTimeStart: question?.riseTimeStart || "",
    riseTimeEnd: question?.riseTimeEnd || "",
    questionType: question?.questionType,
    payload: question?.payload,
    answerKey: question?.answerKey
  };
}
