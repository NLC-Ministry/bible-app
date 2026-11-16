// #709 雲柱測驗後台：單選／多選的每個選項可以加入圖片，存檔時帶進 payload.optionImages
// （和 options 一樣長，沒有圖的格子是 null）。縮圖（canvas）在 jsdom 跑不了，上傳模組換成假的。
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

const ORIGIN = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
const NAMES = [
  "3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f.webp",
  "4a3c9d2f-5e6b-4c7d-8f80-1b2c3d4e5f60.webp"
];
const url = name => `${ORIGIN}/storage/v1/object/public/quiz-images/${name}`;

let dom;
let dbStub;
let upload;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const indexHtml = readLegacyIndexHtml();
const sectionHtml = indexHtml.slice(
  indexHtml.indexOf('<div id="admin-section-lightning-quiz"'),
  indexHtml.indexOf('<div id="admin-section-settings"')
);
const sheetsHtml = indexHtml.slice(
  indexHtml.indexOf("<!-- lightning-quiz-sheets:start -->"),
  indexHtml.indexOf("<!-- lightning-quiz-sheets:end -->")
);

const existingQuestion = (payloadExtra = {}) => ({
  id: "lq-1",
  status: "draft",
  riseDate: "2099-01-05",
  riseTimeStart: "07:00:00",
  riseTimeEnd: "10:00:00",
  questionType: "single",
  payload: { stem: "哪一張是燈臺？", options: ["銅海", "燈臺", "香壇"], optionImages: [{ src: url(NAMES[0]) }, null, { src: url(NAMES[1]) }], ...payloadExtra },
  answerKey: 1,
  explanation: ""
});

async function setup({ canUpload, questions = [] }) {
  vi.resetModules();
  let next = 0;
  upload = vi.fn(async () => NAMES[next++ % NAMES.length]);
  vi.doMock("../js/modules/quiz-image-upload.mjs", () => ({
    QUIZ_IMAGE_ACCEPT: "image/png,image/jpeg,image/webp",
    QUIZ_OPTION_IMAGE_MAX_WIDTH: 1000,
    canUploadQuizImage: () => canUpload,
    uploadQuizImageFile: upload,
    setQuizImageUploader: () => {}
  }));
  dbStub = {
    adminListLightningQuizQuestions: vi.fn(async () => ({ success: true, data: questions })),
    adminGetLightningQuizTrend: vi.fn(async () => ({ success: true, data: { days: [] } })),
    adminGetLightningQuizWeek: vi.fn(async () => ({ success: true, data: { questions: [] } })),
    adminGetLightningQuizSettings: vi.fn(async () => ({ success: true, data: { weekdays: [1, 3, 5], timeStart: "07:00", timeEnd: "10:00" } })),
    adminUpsertLightningQuizQuestion: vi.fn(async () => ({ success: true, data: { id: "new-1" } }))
  };
  dom = new JSDOM(`<!doctype html><body><section class="view-pane active">${sectionHtml.replace("admin-section-panel hidden", "admin-section-panel")}</section>${sheetsHtml}</body>`, { url: "https://example.test" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
  vi.stubGlobal("localStorage", dom.window.localStorage);
  vi.stubGlobal("state", { currentUser: { role: "admin" }, activePlan: null });
  vi.stubGlobal("escapeHTML", value => String(value));
  vi.stubGlobal("hydrateIcons", () => {});
  vi.stubGlobal("showToast", vi.fn());
  vi.stubGlobal("db", dbStub);
  vi.stubGlobal("SUPABASE_CONFIG", { url: ORIGIN });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.showConfirmDialog = vi.fn(async () => true);
  const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-option-images");
  await renderAdminLightningQuizQuestions();
  await flush();
}

afterEach(() => {
  vi.doUnmock("../js/modules/quiz-image-upload.mjs");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dom?.window.close();
});

const body = () => document.getElementById("admin-lightning-quiz-question-body");
const rows = () => Array.from(body().querySelectorAll("[data-option-row]"));

async function openNewQuestion(options) {
  await setup(options);
  document.getElementById("admin-lightning-quiz-create").click();
}

async function openExisting(options) {
  await setup({ ...options, questions: [existingQuestion()] });
  document.querySelector('[data-admin-lightning-quiz-id="lq-1"]').click();
}

async function pickOptionFile(row) {
  const input = row.querySelector("[data-option-image-file]");
  const file = new dom.window.File(["x"], "photo.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await flush();
  await flush();
  return file;
}

function fillOptions(texts) {
  body().querySelector('[data-field="stem"]').value = "哪一張是燈臺？";
  rows().forEach((row, index) => { row.querySelector("[data-option-text]").value = texts[index] ?? `選項${index + 1}`; });
  const correct = rows()[1].querySelector("[data-option-correct]");
  if (!correct.checked) correct.click();
  document.getElementById("admin-lightning-quiz-rise-date").value = "2099-01-05";
}

async function save() {
  document.getElementById("admin-lightning-quiz-save").click();
  await flush();
  return dbStub.adminUpsertLightningQuizQuestion.mock.calls.at(-1)?.[0];
}

describe("雲柱測驗後台：選項圖片（#709）", () => {
  it("每個選項都能加入圖片，上傳縮到 1000px，存檔時帶進 optionImages（沒圖的是 null）", async () => {
    await openNewQuestion({ canUpload: true });
    expect(rows()).toHaveLength(4);
    rows().forEach(row => expect(row.querySelector("[data-option-image-pick]").textContent).toBe("加入圖片"));

    const file = await pickOptionFile(rows()[1]);
    expect(upload).toHaveBeenCalledWith(file, { maxWidth: 1000 });
    expect(rows()[1].querySelector(".admin-quiz-option-image img").getAttribute("src")).toBe(url(NAMES[0]));
    expect(rows()[1].querySelector("[data-option-image-pick]").textContent).toBe("更換圖片");
    expect(rows()[0].querySelector(".admin-quiz-option-image img")).toBeNull();

    fillOptions(["銅海", "燈臺", "香壇", "陳設餅桌"]);
    const saved = await save();
    expect(saved.payload.options).toEqual(["銅海", "燈臺", "香壇", "陳設餅桌"]);
    expect(saved.payload.optionImages).toEqual([null, { src: url(NAMES[0]) }, null, null]);
    expect(saved.answerKey).toBe(1);
  });

  it("沒有加圖就不寫 optionImages", async () => {
    await openNewQuestion({ canUpload: true });
    fillOptions([]);
    expect(await save()).not.toHaveProperty("payload.optionImages");
  });

  it("移除選項圖片後存檔就不帶那張圖", async () => {
    await openNewQuestion({ canUpload: true });
    await pickOptionFile(rows()[0]);
    rows()[0].querySelector("[data-option-image-remove]").click();
    expect(rows()[0].querySelector(".admin-quiz-option-image img")).toBeNull();
    fillOptions([]);
    expect(await save()).not.toHaveProperty("payload.optionImages");
  });

  it("刪掉一個選項時，其他選項的圖跟著自己的選項走", async () => {
    await openNewQuestion({ canUpload: true });
    await pickOptionFile(rows()[2]);
    rows()[0].querySelector("[data-option-remove]").click();
    fillOptions(["燈臺", "香壇", "陳設餅桌"]);
    const saved = await save();
    expect(saved.payload.optionImages).toEqual([null, { src: url(NAMES[0]) }, null]);
  });

  it("新增的選項列也能加圖；多選題一樣可以", async () => {
    await openNewQuestion({ canUpload: true });
    const typeSelect = body().querySelector('[data-field="type"]');
    typeSelect.value = "multiple";
    typeSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    body().querySelector("[data-option-add]").click();
    expect(rows()).toHaveLength(3);
    await pickOptionFile(rows()[2]);
    fillOptions(["銅海", "燈臺", "香壇"]);
    const saved = await save();
    expect(saved.questionType).toBe("multiple");
    expect(saved.payload.optionImages).toEqual([null, null, { src: url(NAMES[0]) }]);
  });

  it("上傳失敗時顯示原因、按鈕恢復，選項不帶圖", async () => {
    await openNewQuestion({ canUpload: true });
    upload.mockRejectedValueOnce(new Error("圖片太大，縮小後還是超過 700 KB，請換一張。"));
    await pickOptionFile(rows()[0]);
    expect(showToast).toHaveBeenCalledWith("圖片太大，縮小後還是超過 700 KB，請換一張。");
    const pick = rows()[0].querySelector("[data-option-image-pick]");
    expect(pick.disabled).toBe(false);
    expect(pick.textContent).toBe("加入圖片");
    expect(rows()[0].hasAttribute("data-option-image")).toBe(false);
  });

  it("編輯既有題目時顯示選項縮圖，原樣存回", async () => {
    await openExisting({ canUpload: true });
    document.querySelector('[data-lq-detail-action="edit"]').click();
    expect(rows().map(row => row.querySelector(".admin-quiz-option-image img")?.getAttribute("src") ?? null))
      .toEqual([url(NAMES[0]), null, url(NAMES[1])]);
    const saved = await save();
    expect(saved.payload.optionImages).toEqual([{ src: url(NAMES[0]) }, null, { src: url(NAMES[1]) }]);
  });

  it("不能上傳的地方不顯示「加入圖片」，但既有的選項圖照樣顯示、存回", async () => {
    await openExisting({ canUpload: false });
    document.querySelector('[data-lq-detail-action="edit"]').click();
    expect(body().querySelector("[data-option-image-pick]")).toBeNull();
    expect(rows()[0].querySelector(".admin-quiz-option-image img").getAttribute("src")).toBe(url(NAMES[0]));
    const saved = await save();
    expect(saved.payload.optionImages).toEqual([{ src: url(NAMES[0]) }, null, { src: url(NAMES[1]) }]);
  });

  it("題目詳情的選項清單顯示縮圖", async () => {
    await openExisting({ canUpload: true });
    const items = document.querySelectorAll(".admin-lq-detail__options li");
    expect(items).toHaveLength(3);
    expect(items[0].querySelector("img").getAttribute("src")).toBe(url(NAMES[0]));
    expect(items[1].querySelector("img")).toBeNull();
    expect(items[1].textContent).toContain("燈臺");
  });
});
