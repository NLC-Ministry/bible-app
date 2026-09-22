import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exam = read("js/modules/exam.js");

// Bug: qEditCard() renders a "＋ 選項" button (data-opt-add) for single/
// multiple-choice questions in the 大測驗 admin question editor, but no
// click handler was ever wired for it anywhere in the file — clicking it
// did nothing. Fixed by adding the listener inside wire(card), alongside
// the existing data-q-save/data-q-del bindings.
describe("大測驗 admin question editor: add-option button actually works", () => {
  it("renders the add-option button only for single/multiple sections", () => {
    const qEditCard = exam.slice(exam.indexOf("function qEditCard"), exam.indexOf("function collectQCard"));
    expect(qEditCard).toContain('sec === "single" || sec === "multiple"');
    expect(qEditCard).toContain('data-opt-add');
    expect(qEditCard).toContain("exam-admin__opts");
    expect(qEditCard).toContain("exam-admin__opt");
  });

  it("wires a click handler for data-opt-add inside wire(card), not left dangling", () => {
    const wireFn = exam.slice(exam.indexOf("const wire = (card) => {"), exam.indexOf("host.querySelectorAll(\".exam-admin__q-card\").forEach(wire);"));
    expect(wireFn).toContain('card.querySelector("[data-opt-add]")?.addEventListener("click"');
  });

  it("appends a new option row with the correct input type and a fresh index, reusing the existing radio group name", () => {
    const handler = exam.slice(exam.indexOf('card.querySelector("[data-opt-add]")'), exam.indexOf("};", exam.indexOf('card.querySelector("[data-opt-add]")')));
    expect(handler).toContain('const optsList = card.querySelector(".exam-admin__opts");');
    expect(handler).toContain("const nextIndex = optsList.querySelectorAll(\".exam-admin__opt\").length;");
    expect(handler).toContain('optsList.querySelector(\'[data-a="opt"]\')?.name');
    expect(handler).toContain('sec === "multiple" ? "checkbox" : "radio"');
    expect(handler).toContain('data-a="opt" value="${nextIndex}"');
    expect(handler).toContain('data-p="opt" value=""');
  });

  it("collectQCard still reads options purely by DOM order, so appending at the end is safe", () => {
    const collect = exam.slice(exam.indexOf("function collectQCard"), exam.indexOf("function answerKeyCard"));
    expect(collect).toContain('[...card.querySelectorAll(\'[data-p="opt"]\')].map((i) => i.value.trim())');
    expect(collect).toContain('[...card.querySelectorAll(\'[data-a="opt"]\')].filter((i) => i.checked).map((i) => Number(i.value))');
  });
});
