import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildLightningQuizCalendar,
  isoWeekday,
  parseLightningImportText,
  planLightningImport,
  resolveImportDate
} from "../js/modules/lightning-quiz-schedule.mjs";

// #310：雲柱測驗一三五排程日曆＋文字匯入
const settings = { weekdays: [1, 3, 5], timeStart: "07:00", timeEnd: "10:00" };
// 2026-09-28 是週一
const now = { date: "2026-09-28", time: "08:00:00" };

describe("dates", () => {
  it("knows ISO weekdays", () => {
    expect(isoWeekday("2026-09-28")).toBe(1);
    expect(isoWeekday("2026-10-04")).toBe(7);
  });

  it("resolves M/D to the next occurrence and accepts full dates", () => {
    expect(resolveImportDate("10/9", "2026-09-28")).toBe("2026-10-09");
    expect(resolveImportDate("1/5", "2026-09-28")).toBe("2027-01-05");
    expect(resolveImportDate("9/28", "2026-09-28")).toBe("2026-09-28");
    expect(resolveImportDate("2026-10-09", "2026-09-28")).toBe("2026-10-09");
    expect(resolveImportDate("2/30", "2026-09-28")).toBe("");
    expect(resolveImportDate("下週三", "2026-09-28")).toBe("");
  });
});

describe("parseLightningImportText", () => {
  const text = [
    "[單選] 亞伯拉罕原本住在哪座城市？",
    "A. 哈蘭",
    "B. 吾珥",
    "答案：B",
    "",
    "日期：10/9",
    "時段：12:00-13:00",
    "[是非] 摩西在米甸住了四十年。",
    "答案：對",
    "",
    "日期：明天",
    "[是非] 錯的日期",
    "答案：對",
    "",
    "[單選] 沒有答案",
    "A. 一",
    "B. 二"
  ].join("\n");

  it("parses questions with optional 日期／時段 lines, and reports errors by question number", () => {
    const { items, errors } = parseLightningImportText(text, { today: "2026-09-28" });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ number: 1, date: null, timeStart: null, question: { type: "single", answerKey: 1 } });
    expect(items[1]).toMatchObject({ number: 2, date: "2026-10-09", timeStart: "12:00", timeEnd: "13:00", question: { type: "truefalse", answerKey: true } });
    expect(errors.map(error => error.number)).toEqual([3, 4]);
    expect(errors[0].message).toContain("看不懂日期");
  });

  it("rejects a time range that ends before it starts", () => {
    const { errors } = parseLightningImportText("時段：13:00-12:00\n[是非] x\n答案：對", { today: "2026-09-28" });
    expect(errors[0].message).toContain("結束時間要晚於開始時間");
  });

  it("merges matching rows with the same right text into one shared point (#588)", () => {
    const { items, errors } = parseLightningImportText(
      "[配對] 配對人物與身分\n彼得｜加利利漁夫\n安得烈｜加利利漁夫\n馬太｜稅吏",
      { today: "2026-09-28" }
    );
    expect(errors).toEqual([]);
    const { payload, answerKey } = items[0].question;
    expect(payload.right.map(item => item.text)).toEqual(["加利利漁夫", "稅吏"]);
    expect(answerKey[payload.left[0].id]).toBe(answerKey[payload.left[1].id]);
  });

  it("accepts the lightning-only menu question (#612)", () => {
    const { items, errors } = parseLightningImportText(
      "[選單] 每種潔淨的動物帶幾隻？\n牛｜7\n豬｜0",
      { today: "2026-09-28" }
    );
    expect(errors).toEqual([]);
    const { type, payload, answerKey } = items[0].question;
    expect(type).toBe("menu");
    expect(answerKey).toEqual({ [payload.items[0].id]: 7 });
  });
});

describe("planLightningImport", () => {
  const item = (number, extra = {}) => ({ number, date: null, timeStart: null, timeEnd: null, question: { type: "truefalse", payload: { stem: `q${number}` }, answerKey: true }, ...extra });

  it("fills the next empty Mon/Wed/Fri that hasn't started, skipping taken days", () => {
    // 今天週一 08:00，07:00 的時段已經開始 → 從週三開始；週五已經有題目
    const { plan, errors } = planLightningImport([item(1), item(2), item(3)], {
      existingDates: ["2026-10-02"], settings, now
    });
    expect(errors).toEqual([]);
    expect(plan.map(p => [p.number, p.date, p.timeStart])).toEqual([
      [1, "2026-09-30", "07:00"], [2, "2026-10-05", "07:00"], [3, "2026-10-07", "07:00"]
    ]);
  });

  it("uses today when the default window hasn't started yet", () => {
    const { plan } = planLightningImport([item(1)], { existingDates: [], settings, now: { date: "2026-09-28", time: "06:00:00" } });
    expect(plan[0].date).toBe("2026-09-28");
  });

  it("puts pinned questions on their date first and keeps them out of the automatic slots", () => {
    const { plan } = planLightningImport([item(1), item(2, { date: "2026-09-30", timeStart: "12:00", timeEnd: "13:00" })], {
      existingDates: [], settings, now
    });
    expect(plan.map(p => [p.number, p.date, p.pinned, p.timeStart])).toEqual([[2, "2026-09-30", true, "12:00"], [1, "2026-10-02", false, "07:00"]]);
  });

  it("reports pinned dates that are taken or already past", () => {
    const { errors } = planLightningImport([item(1, { date: "2026-10-02" }), item(2, { date: "2026-09-28" })], {
      existingDates: ["2026-10-02"], settings, now
    });
    expect(errors.map(e => e.number)).toEqual([1, 2]);
    expect(errors[0].message).toContain("已經有題目");
    expect(errors[1].message).toContain("已經過了");
  });
});

describe("buildLightningQuizCalendar", () => {
  it("lists four weeks of rule days from this Monday, marking missing and past days", () => {
    const weeks = buildLightningQuizCalendar({
      weekdays: [5, 1, 3],
      questions: [
        { id: "a", riseDate: "2026-09-28", status: "published", riseTimeStart: "07:00:00", riseTimeEnd: "10:00:00" },
        { id: "d", riseDate: "2026-10-02", status: "draft" },
        { id: "p", riseDate: "2026-10-02", status: "published", riseTimeStart: "07:00:00", riseTimeEnd: "10:00:00" }
      ],
      now: { date: "2026-09-30", time: "12:00:00" }
    });
    expect(weeks).toHaveLength(4);
    expect(weeks[0].days.map(d => d.date)).toEqual(["2026-09-28", "2026-09-30", "2026-10-02"]);
    expect(weeks[0].days[0]).toMatchObject({ stage: "ended", past: true, missing: false });
    expect(weeks[0].days[1]).toMatchObject({ question: null, past: false, missing: true });
    expect(weeks[0].days[2].question.id).toBe("p");
    expect(weeks[3].weekStart).toBe("2026-10-19");
  });
});

describe("wiring", () => {
  const migration = readFileSync("supabase/migrations/20260927123111_lightning_quiz_calendar_import.sql", "utf8");
  const nlcData = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");

  it("import is all-or-nothing and checks dates again on the server", () => {
    expect(migration).toContain("lightning_quiz_import_duplicate_date");
    expect(migration).toContain("RAISE EXCEPTION 'lightning_quiz_date_taken:%', d;");
    expect(migration).toContain("IF p_schedule AND public._lightning_quiz_window_started(d, t_start) THEN");
  });

  it("settings table is closed to clients; every new function revokes before granting", () => {
    expect(migration).toContain("REVOKE ALL ON TABLE public.lightning_quiz_settings FROM PUBLIC, anon, authenticated;");
    for (const sig of [
      "admin_get_lightning_quiz_settings(uuid)",
      "admin_save_lightning_quiz_settings(smallint[], time, time, uuid)",
      "admin_import_lightning_quiz_questions(jsonb, boolean, uuid)"
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(nlcData).toContain(`"${sig.slice(0, sig.indexOf("("))}"`);
    }
  });
});
