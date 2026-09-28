import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EXAM_STAGES, examNextStepText, examStage, formatExamTime } from "../js/modules/exam-stage.mjs";

// #300（大測驗 R3，屬於 #297）：五格進度條＋一顆主按鈕＋用語統一。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exam = read("js/modules/exam.js");
const css = read("index.css");

const OPEN = "2026-12-28T01:00:00Z";   // 台北 12/28（一）09:00
const CLOSE = "2026-12-29T13:00:00Z";  // 台北 12/29（二）21:00
const at = iso => Date.parse(iso);
const paper = (extra = {}) => ({ status: "published", open_at: OPEN, close_at: CLOSE, results_published_at: null, ...extra });

describe("examStage: five stages from the paper's own fields", () => {
  it("lists the five stages in order", () => {
    expect(EXAM_STAGES.map(s => s.label)).toEqual(["準備中", "已排程", "作答中", "批改中", "已公布"]);
  });

  it("draft → preparing, whatever the times", () => {
    expect(examStage(paper({ status: "draft" }), at("2027-01-01T00:00:00Z"))).toBe("preparing");
  });

  it("published before open_at → scheduled; exactly at open_at → open", () => {
    expect(examStage(paper(), at(OPEN) - 1)).toBe("scheduled");
    expect(examStage(paper(), at(OPEN))).toBe("open");
  });

  it("published: open until close_at; at close_at it already counts as grading (auto-close runs every minute)", () => {
    expect(examStage(paper(), at(CLOSE) - 1)).toBe("open");
    expect(examStage(paper(), at(CLOSE))).toBe("grading");
  });

  it("closed → grading, even if closed early", () => {
    expect(examStage(paper({ status: "closed" }), at(OPEN) + 60_000)).toBe("grading");
  });

  it("results published → published, regardless of status", () => {
    expect(examStage(paper({ status: "closed", results_published_at: CLOSE }), at(CLOSE))).toBe("published");
  });

  it("scheduled with no open time yet stays scheduled; missing paper → null", () => {
    expect(examStage(paper({ open_at: null }), at(OPEN))).toBe("scheduled");
    expect(examStage(null)).toBe(null);
  });

  it("accepts the member-side camelCase fields too", () => {
    expect(examStage({ status: "published", openAt: OPEN, closeAt: CLOSE }, at(OPEN) + 1)).toBe("open");
    expect(examStage({ status: "closed", resultsPublishedAt: CLOSE }, at(CLOSE))).toBe("published");
  });
});

describe("next-step sentence", () => {
  it("formats times in Taipei with the weekday", () => {
    expect(formatExamTime(OPEN)).toBe("12/28（一）09:00");
    expect(formatExamTime(CLOSE)).toBe("12/29（二）21:00");
  });

  it("says what happens next at each stage", () => {
    expect(examNextStepText("preparing", paper(), { checklistDone: false })).toBe("完成下面的清單，就可以排程。");
    expect(examNextStepText("preparing", paper(), { checklistDone: true })).toContain("按「排程」後");
    expect(examNextStepText("scheduled", paper())).toBe("開放時間 12/28（一）09:00，時間到會自動開放作答。開放前仍可修改題目內容。");
    expect(examNextStepText("open", paper())).toBe("作答中，12/29（二）21:00 截止後會自動收卷並計分。");
    expect(examNextStepText("grading", paper(), { officialAttemptCount: 3 })).toContain("按「公布成績」");
    expect(examNextStepText("grading", paper(), { officialAttemptCount: 0 })).toBe("已收卷，這份測驗沒有人作答。");
    expect(examNextStepText("published", paper())).toBe("成績已公布，所有結算都已鎖定。");
  });
});

describe("admin header (#300)", () => {
  const header = exam.slice(exam.indexOf("// ── 五格進度條＋一句下一步（#300）──"), exam.indexOf('<nav class="exam-admin__subnav">'));

  it("renders the stage bar and the next-step sentence", () => {
    expect(header).toContain('<ol class="exam-stage-bar" aria-label="試卷進度">');
    expect(header).toContain('${i === stageIdx ? \' aria-current="step"\' : ""}');
    expect(header).toContain('<p class="exam-admin__next">${esc(nextStep)}</p>');
    expect(css).toContain(".exam-stage-bar__step.is-current");
  });

  it("has exactly one main action per stage: 排程／取消排程／提前結束／公布成績", () => {
    const main = header.slice(header.indexOf('let mainAction = "";'), header.indexOf("// ── 次要工具"));
    expect(main).toContain('data-exam-act="publish">排程</button>');
    expect(main).toContain('data-exam-act="reopen">取消排程</button>');
    expect(main).toContain('data-exam-act="close">提前結束</button>');
    expect(main).toContain('data-exam-act="publish-results">公布成績</button>');
    expect(main.match(/mainAction = [`']/g)).toHaveLength(4);
  });

  it("the ⋯ 更多 menu is gone", () => {
    expect(exam).not.toContain("moreActions");
    expect(exam).not.toContain("⋯ 更多");
    expect(exam).not.toContain("exam-admin__more");
    expect(css).not.toContain(".exam-admin__more");
  });

  it("status badge and label are replaced by the stage bar", () => {
    expect(exam).not.toContain("statusLabel");
    expect(exam).not.toContain("annBadge");
  });
});

describe("terminology (#300)", () => {
  it("the exam UI no longer uses the retired words", () => {
    for (const word of ["預告文", "發佈測驗", "撤回成草稿", "測驗進行中", "已關閉"]) {
      expect(exam, word).not.toContain(word);
    }
    // 「公告」「預告」只剩說明退場原因的註解
    const codeOnly = exam.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
    expect(codeOnly).not.toContain("公告");
    expect(codeOnly).not.toContain("預告");
  });
});
