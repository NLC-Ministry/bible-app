// js/modules/lightning-quiz-schedule.mjs
// 雲柱測驗後台的排程判斷（純函式，不碰 DOM）。
//
// 資料庫只存兩種狀態（#309）：draft＝準備中、published＝已排程。畫面上的
// 「作答中」「已結束」由日期與時段推算（台灣時間），規則跟 SQL 的
// _lightning_quiz_window_started／_lightning_quiz_window_ended 一致：
// 開始時間當下就算開始，結束時間那一分鐘內都還算作答中。

import { addDays, weekStartOf } from "./lightning-quiz-analytics.mjs";
import { parseQuizImportText } from "./quiz-import.mjs";

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

// ── 排程規則、日曆、文字匯入（#310）──────────────────────────────────────
// 規則：weekdays 用 ISO（1＝週一 … 7＝週日），預設一三五；timeStart/timeEnd 為 "HH:MM"。

export const DEFAULT_LIGHTNING_QUIZ_SETTINGS = Object.freeze({ weekdays: [1, 3, 5], timeStart: "07:00", timeEnd: "10:00" });

export function isoWeekday(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!match) return 0;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  return ((day + 6) % 7) + 1;
}

// 還能排：日期在今天之後，或是今天但開始時間還沒到。
function slotStillAhead(date, timeStart, now) {
  return date > now.date || (date === now.date && hhmmss(timeStart) > hhmmss(now.time));
}

// 日曆：從本週一起 weeks 週，只列規則裡的星期。同一天有已排程的題目優先顯示。
export function buildLightningQuizCalendar({ weekdays, questions, now, weeks = 4 }) {
  const days = [...new Set((weekdays || []).map(Number))].filter(d => d >= 1 && d <= 7).sort((a, b) => a - b);
  const byDate = new Map();
  (Array.isArray(questions) ? questions : []).forEach(question => {
    const current = byDate.get(question.riseDate);
    if (!current || (current.status !== "published" && question.status === "published")) byDate.set(question.riseDate, question);
  });
  const start = weekStartOf(now.date);
  return Array.from({ length: weeks }, (_, weekIndex) => {
    const weekStart = addDays(start, weekIndex * 7);
    return {
      weekStart,
      days: days.map(weekday => {
        const date = addDays(weekStart, weekday - 1);
        const question = byDate.get(date) || null;
        const past = date < now.date;
        return {
          date,
          question,
          stage: question ? lightningQuizStage(question, now) : null,
          past,
          missing: !question && !past
        };
      })
    };
  });
}

const DATE_LINE = /^日期\s*[:：]\s*(.+)$/;
const TIME_LINE = /^時段\s*[:：]\s*(\d{1,2}):(\d{2})\s*[-–~～至到]\s*(\d{1,2}):(\d{2})$/;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${pad2(month)}-${pad2(day)}`
    : "";
}

// 「10/9」這種沒寫年份的日期：取今天以後最近的那一個（今年已經過了就是明年）。
export function resolveImportDate(text, today) {
  const value = String(text || "").trim();
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[/.-](\d{1,2})$/.exec(value);
  if (!match) return "";
  const year = Number(String(today).slice(0, 4));
  const thisYear = validDate(year, Number(match[1]), Number(match[2]));
  if (thisYear && thisYear >= today) return thisYear;
  return validDate(year + 1, Number(match[1]), Number(match[2]));
}

// 解析貼上的文字：每題之間空一行；題目前面可以加「日期：10/9」「時段：12:00-13:00」。
// 題目本身的格式跟小測驗的文字匯入一樣（quiz-import.mjs）。
export function parseLightningImportText(text, { today }) {
  const blocks = String(text || "").replace(/\r\n/g, "\n").split(/\n\s*\n+/).map(block => block.trim()).filter(Boolean);
  const items = [];
  const errors = [];
  blocks.forEach((block, blockIndex) => {
    const number = blockIndex + 1;
    const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
    let date = null;
    let timeStart = null;
    let timeEnd = null;
    while (lines.length && (DATE_LINE.test(lines[0]) || TIME_LINE.test(lines[0]))) {
      const line = lines.shift();
      const dateMatch = DATE_LINE.exec(line);
      if (dateMatch) {
        date = resolveImportDate(dateMatch[1], today);
        if (!date) {
          errors.push({ number, message: `看不懂日期「${dateMatch[1].trim()}」，請寫成 10/9 或 2026-10-09` });
          return;
        }
        continue;
      }
      const timeMatch = TIME_LINE.exec(line);
      timeStart = `${pad2(timeMatch[1])}:${timeMatch[2]}`;
      timeEnd = `${pad2(timeMatch[3])}:${timeMatch[4]}`;
      if (timeStart >= timeEnd || Number(timeMatch[1]) > 23 || Number(timeMatch[3]) > 23) {
        errors.push({ number, message: `時段「${line.replace(/^時段\s*[:：]\s*/, "")}」不正確，結束時間要晚於開始時間` });
        return;
      }
    }
    const parsed = parseQuizImportText(lines.join("\n"));
    if (parsed.errors.length) {
      errors.push({ number, message: parsed.errors[0].message });
      return;
    }
    if (parsed.questions.length !== 1) {
      errors.push({ number, message: "每一題之間要空一行" });
      return;
    }
    const { type, payload, answerKey } = parsed.questions[0];
    items.push({ number, date, timeStart, timeEnd, question: { type, payload, answerKey } });
  });
  return { items, errors };
}

// 排日期：有寫日期的照寫的；沒寫的依序填進接下來還空著、而且還沒開始的規則日。
// 已經有題目（準備中或已排程）的日子不能再排。
export function planLightningImport(items, { existingDates, settings, now }) {
  const rule = settings || DEFAULT_LIGHTNING_QUIZ_SETTINGS;
  const weekdays = new Set((rule.weekdays || []).map(Number));
  const occupied = new Set(existingDates || []);
  const plan = [];
  const errors = [];
  const timesOf = item => ({ timeStart: item.timeStart || rule.timeStart, timeEnd: item.timeEnd || rule.timeEnd });

  (items || []).filter(item => item.date).forEach(item => {
    const times = timesOf(item);
    if (occupied.has(item.date)) {
      errors.push({ number: item.number, message: `${item.date} 已經有題目了` });
    } else if (!slotStillAhead(item.date, times.timeStart, now)) {
      errors.push({ number: item.number, message: `${item.date} ${times.timeStart} 已經過了` });
    } else {
      occupied.add(item.date);
      plan.push({ ...item, ...times, pinned: true, date: item.date });
    }
  });

  let cursor = now.date;
  (items || []).filter(item => !item.date).forEach(item => {
    const times = timesOf(item);
    let date = cursor;
    for (let guard = 0; guard < 400; guard += 1, date = addDays(date, 1)) {
      if (weekdays.has(isoWeekday(date)) && !occupied.has(date) && slotStillAhead(date, times.timeStart, now)) break;
    }
    if (!weekdays.has(isoWeekday(date)) || occupied.has(date)) {
      errors.push({ number: item.number, message: "找不到可以排的日子，請確認排程規則" });
      return;
    }
    occupied.add(date);
    cursor = date;
    plan.push({ ...item, ...times, pinned: false, date });
  });

  plan.sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
  return { plan, errors };
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
