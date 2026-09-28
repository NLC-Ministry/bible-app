import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exam = read("js/modules/exam.js");
const css = read("index.css");

// 分頁固定三個（#301，屬於 #297）：題目／設定／作答與成績，不會隨階段出現又消失。
//   · 題目：準備中、已排程可以出題（正解、詳解都在題目卡片裡）；開放作答後題目唯讀，
//           每一題旁邊仍可改正解（成績公布前）和答案詳解。
//   · 設定：試卷設定（開放作答後唯讀）＋首頁卡片文字（結束前可改）＋作答規則開關。
//   · 作答與成績：統計／簡答批改／批改指派／複習紀錄；還沒有作答時只寫一句話。
const panel = exam.slice(exam.indexOf("export async function renderExamPanel"), exam.indexOf("// ── 不能改的時候，分頁上面那一句原因"));

describe("三個固定分頁", () => {
  it("nav 永遠是題目／設定／作答與成績", () => {
    expect(panel).toContain('data-exam-sub="questions" class="${examAdminSubview === "questions" ? "active" : ""}">題目</button>');
    expect(panel).toContain('data-exam-sub="settings" class="${examAdminSubview === "settings" ? "active" : ""}">設定</button>');
    expect(panel).toContain('data-exam-sub="results" class="${examAdminSubview === "results" ? "active" : ""}">作答與成績</button>');
    expect(panel.match(/data-exam-sub="/g)).toHaveLength(3);
  });

  it("舊的分頁與依狀態增減的判斷都拿掉了", () => {
    for (const gone of ["availableSubviews", "showNotice", "showAnswers", "showExplain", "showStats",
      'data-exam-sub="bank"', 'data-exam-sub="meta"', 'data-exam-sub="answers"', 'data-exam-sub="explain"',
      "renderExamAnswerKeys", "renderExamExplanationEditor"]) {
      expect(exam, gone).not.toContain(gone);
    }
  });

  it("不認得的分頁值一律回到「題目」；換試卷也回到「題目」", () => {
    expect(panel).toContain('if (!["questions", "settings", "results"].includes(examAdminSubview)) examAdminSubview = "questions";');
    expect(panel).toContain('examAdminSubview = "questions"; examAdminResultsView = "stats"; rerender();');
  });

  it("手機上三個分頁平均分寬，不會擠成兩行", () => {
    expect(css).toContain(".exam-admin__subnav > button { flex: 1 1 0; white-space: nowrap; }");
  });
});

describe("題目分頁", () => {
  it("能改題目時用題庫編輯；開放作答後改成唯讀題目＋正解＋詳解", () => {
    expect(panel).toContain("else if (canEditPaper) renderExamQuestionBank(sub, paper, questions, rerender);");
    expect(panel).toContain("else renderExamLockedQuestions(sub, paper, questions, stage);");
  });

  it("鎖定時正解到成績公布前都能改，答案詳解任何時候都能補寫", () => {
    const locked = exam.slice(exam.indexOf("function renderExamLockedQuestions"), exam.indexOf("function wireAnswerKeyCards"));
    expect(locked).toContain("const keysEditable = !paper.results_published_at;");
    expect(locked).toContain('keysEditable && q.section !== "shortanswer"');
    expect(locked).toContain("data-explain-save");
    expect(locked).toContain('examLockReason(stage, "questions")');
  });
});

describe("設定分頁", () => {
  it("試卷設定開放作答後唯讀，首頁卡片文字與作答規則放在同一頁", () => {
    expect(panel).toContain('renderExamMetaForm(sub.querySelector("[data-settings-meta]"), paper, questions, rerender, { readOnly: !canEditPaper });');
    expect(panel).toContain('renderExamNoticeForm(sub.querySelector("[data-settings-card]"), paper, rerender);');
    expect(panel).toContain("<legend>作答規則</legend>");
    expect(panel).toContain('data-exam-act="practice-toggle"');
    expect(panel).toContain('data-exam-act="explain-toggle"');
  });

  it("唯讀時欄位停用、沒有儲存按鈕", () => {
    const meta = exam.slice(exam.indexOf("function renderExamMetaForm"), exam.indexOf("function examInfoIcon"));
    expect(meta).toContain('host.querySelectorAll("input, select, textarea").forEach((el) => { el.disabled = true; });');
    expect(meta).toContain('host.querySelector("#exam-meta-save")?.remove();');
  });

  it("作答規則不在標頭了", () => {
    const header = panel.slice(panel.indexOf("body.innerHTML = `"), panel.indexOf('<nav class="exam-admin__subnav"'));
    expect(header).not.toContain("rules.join");
  });
});

describe("作答與成績分頁", () => {
  it("小分頁：統計一定有；有簡答題且成績未公布才有批改／指派；開放作答後才有複習紀錄", () => {
    expect(panel).toContain('const resultsViews = ["stats", ...(showGrade ? ["grade", "assign"] : []), ...(showPractice ? ["practice"] : [])];');
    expect(panel).toContain("const showGrade = hasShortSection && !resultsPublished;");
    expect(panel).toContain("const showPractice = !canEditPaper;");
  });

  it("還沒有作答時只寫一句話", () => {
    expect(panel).toContain('"開放作答後會出現在這裡。"');
    expect(panel).toContain('"這份測驗沒有人作答。"');
  });
});

describe("鎖定原因", () => {
  it("每個鎖定階段都有一句原因", () => {
    const fn = exam.slice(exam.indexOf("function examLockReason"), exam.indexOf("// ── 統計報表"));
    expect(fn).toContain("已開放作答，題目已鎖定；正解和答案詳解仍可修改。");
    expect(fn).toContain("已開放作答，試卷設定已鎖定；首頁卡片文字和作答規則仍可修改。");
    expect(css).toContain(".exam-admin__lock-note");
  });
});
