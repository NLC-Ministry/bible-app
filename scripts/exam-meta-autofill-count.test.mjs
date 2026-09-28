import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exam = read("js/modules/exam.js");

// 大測驗「試卷設定」的題數，之前完全靠 admin 手動輸入、跟「題庫編輯」裡實際
// 寫了幾題無關。現在題庫已經寫的題目數量，要自動帶入這個欄位——題目是第一手
// 事實，設定值只是跟著同步。
describe("大測驗 admin 試卷設定: 題數自動帶入實際已寫的題目數", () => {
  it("renderExamMetaForm now receives questions and derives actualCounts from them", () => {
    const fn = exam.slice(exam.indexOf("function renderExamMetaForm"), exam.indexOf("const collectSections"));
    expect(fn).toContain("function renderExamMetaForm(host, paper, questions, rerender, { readOnly = false } = {})");
    expect(fn).toContain("actualCounts[q.section] = (actualCounts[q.section] || 0) + 1");
  });

  it("count input defaults to the actual written count when questions already exist for that section", () => {
    const fn = exam.slice(exam.indexOf("function renderExamMetaForm"), exam.indexOf("const collectSections"));
    expect(fn).toContain("const actual = actualCounts[t] || 0;");
    expect(fn).toContain("const count = actual > 0 ? actual : c.count;");
    expect(fn).toContain('data-s="count" value="${count}"');
  });

  it("shows a hint next to the field so the admin knows why the number changed", () => {
    const fn = exam.slice(exam.indexOf("function renderExamMetaForm"), exam.indexOf("const collectSections"));
    expect(fn).toContain("已寫 ${actual} 題，題數已自動帶入");
  });

  it("call site now threads questions through to renderExamMetaForm", () => {
    expect(exam).toContain('renderExamMetaForm(sub.querySelector("[data-settings-meta]"), paper, questions, rerender, { readOnly: !canEditPaper });');
  });

  it("the count field stays a plain editable number input, not read-only — admin can still override before saving", () => {
    const fn = exam.slice(exam.indexOf("function renderExamMetaForm"), exam.indexOf("const collectSections"));
    expect(fn).not.toContain('data-s="count" readonly');
    expect(fn).not.toContain('data-s="count" disabled');
  });
});
