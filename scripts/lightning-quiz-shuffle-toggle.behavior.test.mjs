import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

// #687：雲柱單選／多選可以逐題關掉「打亂選項順序」，存在 payload.shuffleOptions
let dom;
let dbStub;
let renderAdminLightningQuizQuestions;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const singleQuestion = (payloadExtra = {}) => ({
  id: "lq-1",
  status: "draft",
  riseDate: "2099-01-05",
  riseTimeStart: "07:00:00",
  riseTimeEnd: "10:00:00",
  questionType: "single",
  payload: { stem: "誰帶領以色列人出埃及？", options: ["摩西", "約書亞", "以上皆是"], ...payloadExtra },
  answerKey: 0,
  explanation: ""
});

const indexHtml = readLegacyIndexHtml();
const sectionHtml = indexHtml.slice(
  indexHtml.indexOf('<div id="admin-section-lightning-quiz"'),
  indexHtml.indexOf('<div id="admin-section-settings"')
);
const sheetsHtml = indexHtml.slice(
  indexHtml.indexOf("<!-- lightning-quiz-sheets:start -->"),
  indexHtml.indexOf("<!-- lightning-quiz-sheets:end -->")
);

async function setup(question) {
  vi.resetModules();
  dom = new JSDOM(`<!doctype html><body><section class="view-pane active">${sectionHtml}</section>${sheetsHtml}</body>`, { url: "https://example.test" });
  dbStub = {
    adminListLightningQuizQuestions: vi.fn(async () => ({ success: true, data: [question] })),
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
  ({ renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lightning-quiz-shuffle"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dom?.window.close();
});

async function openEditor(question) {
  await setup(question);
  await renderAdminLightningQuizQuestions();
  await flush();
  document.querySelector('[data-admin-lightning-quiz-id="lq-1"]').click();
  document.querySelector('[data-lq-detail-action="edit"]').click();
  return document.querySelector("#admin-lightning-quiz-question-body fieldset");
}

async function save() {
  document.getElementById("admin-lightning-quiz-save").click();
  await flush();
  expect(dbStub.adminUpsertLightningQuizQuestion).toHaveBeenCalledTimes(1);
  return dbStub.adminUpsertLightningQuizQuestion.mock.calls[0][0];
}

const shuffleBox = fieldset => fieldset.querySelector('[data-field="shuffleOptions"]');

describe("雲柱「打亂選項順序」（#687）", () => {
  it("existing questions show the box checked and save without the field", async () => {
    const fieldset = await openEditor(singleQuestion());
    expect(shuffleBox(fieldset).checked).toBe(true);
    expect(fieldset.querySelector("[data-lq-shuffle]").hidden).toBe(false);
    const saved = await save();
    expect(saved.payload).not.toHaveProperty("shuffleOptions");
  });

  it("unchecking saves shuffleOptions: false", async () => {
    const fieldset = await openEditor(singleQuestion());
    shuffleBox(fieldset).click();
    const saved = await save();
    expect(saved.payload.shuffleOptions).toBe(false);
    expect(saved.payload.options).toEqual(["摩西", "約書亞", "以上皆是"]);
  });

  it("re-editing a question saved with shuffleOptions: false keeps it unchecked", async () => {
    const fieldset = await openEditor(singleQuestion({ shuffleOptions: false }));
    expect(shuffleBox(fieldset).checked).toBe(false);
    const saved = await save();
    expect(saved.payload.shuffleOptions).toBe(false);
  });

  it("hides the box for types that must always shuffle and never saves the field for them", async () => {
    const fieldset = await openEditor(singleQuestion({ shuffleOptions: false }));
    const typeSelect = fieldset.querySelector('[data-field="type"]');
    typeSelect.value = "ordering";
    typeSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(fieldset.querySelector("[data-lq-shuffle]").hidden).toBe(true);

    typeSelect.value = "multiple";
    typeSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(fieldset.querySelector("[data-lq-shuffle]").hidden).toBe(false);

    typeSelect.value = "ordering";
    typeSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    fieldset.querySelectorAll("[data-item-text]").forEach((input, index) => {
      input.value = `步驟${index + 1}`;
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const saved = await save();
    expect(saved.payload).not.toHaveProperty("shuffleOptions");
  });
});
