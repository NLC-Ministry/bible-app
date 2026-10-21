import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

// #612：雲柱選單題的後台編輯器——每列「項目｜正確數量」，干擾項填 0；重新編輯時數量照答案還原
let dom;
let dbStub;
let renderAdminLightningQuizQuestions;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const menuQuestion = {
  id: "lq-1",
  status: "draft",
  riseDate: "2099-01-05",
  riseTimeStart: "07:00:00",
  riseTimeEnd: "10:00:00",
  questionType: "menu",
  payload: {
    stem: "挪亞方舟上，每種潔淨的動物帶幾隻？",
    items: [{ id: "I1", text: "牛" }, { id: "I2", text: "豬" }, { id: "I3", text: "羊" }]
  },
  answerKey: { I1: 7, I3: 7 },
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
    adminListLightningQuizQuestions: vi.fn(async () => ({ success: true, data: [menuQuestion] })),
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
  ({ renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lightning-quiz-menu"));
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

const menuRows = fieldset => Array.from(fieldset.querySelectorAll("[data-menu-row]")).map(row => [
  row.querySelector("[data-menu-text]").value,
  row.querySelector("[data-menu-quantity]").value
]);

const typeInEditor = (input, value) => {
  input.value = value;
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};

describe("雲柱選單題的後台編輯器（#612）", () => {
  it("offers 選單 in the type picker and restores each item's quantity from the answer key", async () => {
    const fieldset = await openEditor();
    expect(fieldset.querySelector('[data-field="type"] option[value="menu"]')?.textContent).toBe("選單");
    expect(menuRows(fieldset)).toEqual([["牛", "7"], ["豬", "0"], ["羊", "7"]]);
  });

  it("saves item ids in order and keeps only positive quantities in the answer", async () => {
    await openEditor();
    document.getElementById("admin-lightning-quiz-save").click();
    await flush();
    expect(dbStub.adminUpsertLightningQuizQuestion).toHaveBeenCalledTimes(1);
    const saved = dbStub.adminUpsertLightningQuizQuestion.mock.calls[0][0];
    expect(saved.type ?? saved.questionType).toBe("menu");
    expect(saved.payload.items).toEqual([{ id: "I1", text: "牛" }, { id: "I2", text: "豬" }, { id: "I3", text: "羊" }]);
    expect(saved.answerKey).toEqual({ I1: 7, I3: 7 });
  });

  it("refuses an all-zero answer or a quantity over 20", async () => {
    const fieldset = await openEditor();
    const quantities = fieldset.querySelectorAll("[data-menu-quantity]");
    typeInEditor(quantities[0], "21");
    document.getElementById("admin-lightning-quiz-save").click();
    await flush();
    typeInEditor(quantities[0], "0");
    typeInEditor(quantities[2], "0");
    document.getElementById("admin-lightning-quiz-save").click();
    await flush();
    expect(dbStub.adminUpsertLightningQuizQuestion).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("請完整填寫題目內容（含正確答案）後再儲存。");
  });
});
