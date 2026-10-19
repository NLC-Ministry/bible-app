import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

// #588：雲柱配對題多對一——右邊文字相同的列合併成同一個點；重新編輯時每列照答案還原
let dom;
let dbStub;
let renderAdminLightningQuizQuestions;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const manyToOneQuestion = {
  id: "lq-1",
  status: "draft",
  riseDate: "2099-01-05",
  riseTimeStart: "07:00:00",
  riseTimeEnd: "10:00:00",
  questionType: "matching",
  payload: {
    stem: "配對人物與身分",
    left: [{ id: "L1", text: "彼得" }, { id: "L2", text: "馬太" }, { id: "L3", text: "安得烈" }],
    right: [{ id: "R1", text: "加利利漁夫" }, { id: "R2", text: "稅吏" }]
  },
  answerKey: { L1: "R1", L2: "R2", L3: "R1" },
  explanation: ""
};

const indexHtml = readLegacyIndexHtml();
const sectionHtml = indexHtml.slice(
  indexHtml.indexOf('<div id="admin-section-lightning-quiz"'),
  indexHtml.indexOf('<div id="admin-section-settings"')
);
// 題目面板放在後台區塊外面（#420），要另外帶進來
const sheetsHtml = indexHtml.slice(
  indexHtml.indexOf("<!-- lightning-quiz-sheets:start -->"),
  indexHtml.indexOf("<!-- lightning-quiz-sheets:end -->")
);

beforeEach(async () => {
  vi.resetModules();
  dom = new JSDOM(`<!doctype html><body><section class="view-pane active">${sectionHtml}</section>${sheetsHtml}</body>`, { url: "https://example.test" });
  dbStub = {
    adminListLightningQuizQuestions: vi.fn(async () => ({ success: true, data: [manyToOneQuestion] })),
    adminGetLightningQuizSettings: vi.fn(async () => ({ success: true, data: { weekdays: [1, 3, 5], timeStart: "07:00", timeEnd: "10:00" } })),
    adminUpsertLightningQuizQuestion: vi.fn(async () => ({ success: true, data: {} }))
  };
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
  vi.stubGlobal("state", { currentUser: { role: "admin" }, activePlan: null });
  vi.stubGlobal("escapeHTML", value => String(value));
  vi.stubGlobal("hydrateIcons", () => {});
  vi.stubGlobal("showToast", vi.fn());
  vi.stubGlobal("db", dbStub);
  dom.window.showConfirmDialog = vi.fn(async () => true);
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  ({ renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lightning-quiz-many-to-one"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dom.window.close();
});

async function openEditor() {
  await renderAdminLightningQuizQuestions();
  await flush();
  document.querySelector('[data-admin-lightning-quiz-id="lq-1"]').click();
  document.querySelector('[data-lq-detail-action="edit"]').click();
  return document.querySelector("#admin-lightning-quiz-question-body fieldset");
}

const pairRows = fieldset => Array.from(fieldset.querySelectorAll("[data-pair-row]")).map(row => [
  row.querySelector("[data-pair-left]").value,
  row.querySelector("[data-pair-right]").value
]);

describe("雲柱配對題多對一（#588）", () => {
  it("re-opening a merged question restores each row's right text from the answer key", async () => {
    const fieldset = await openEditor();
    expect(pairRows(fieldset)).toEqual([["彼得", "加利利漁夫"], ["馬太", "稅吏"], ["安得烈", "加利利漁夫"]]);
  });

  it("saving folds identical right texts into one shared point", async () => {
    await openEditor();
    document.getElementById("admin-lightning-quiz-save").click();
    await flush();
    expect(dbStub.adminUpsertLightningQuizQuestion).toHaveBeenCalledTimes(1);
    const saved = dbStub.adminUpsertLightningQuizQuestion.mock.calls[0][0];
    expect(saved.payload.left.map(item => item.text)).toEqual(["彼得", "馬太", "安得烈"]);
    expect(saved.payload.right).toEqual([{ id: "R1", text: "加利利漁夫" }, { id: "R2", text: "稅吏" }]);
    expect(saved.answerKey).toEqual({ L1: "R1", L2: "R2", L3: "R1" });
  });

  it("refuses a question whose rows all share one right point", async () => {
    const fieldset = await openEditor();
    const input = fieldset.querySelectorAll("[data-pair-right]")[1];
    input.value = "加利利漁夫";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    document.getElementById("admin-lightning-quiz-save").click();
    await flush();
    expect(dbStub.adminUpsertLightningQuizQuestion).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("請完整填寫題目內容（含正確答案）後再儲存。");
  });
});
