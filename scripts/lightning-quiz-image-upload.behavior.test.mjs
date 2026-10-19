// #585 雲柱測驗後台：編輯題目時可以加入／更換／移除圖片，存檔時帶進 payload.image。
// 縮圖（canvas）在 jsdom 跑不了，這裡把上傳模組換成假的；縮圖的純函式另外測。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

const ORIGIN = "https://dbtjsljrytzonjvclgrd.supabase.co";
const NAME = "3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f.webp";
const PUBLIC_URL = `${ORIGIN}/storage/v1/object/public/quiz-images/${NAME}`;

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

function setup({ canUpload }) {
  vi.resetModules();
  upload = vi.fn(async () => NAME);
  vi.doMock("../js/modules/quiz-image-upload.mjs", () => ({
    QUIZ_IMAGE_ACCEPT: "image/png,image/jpeg,image/webp",
    canUploadQuizImage: () => canUpload,
    uploadQuizImageFile: upload,
    setQuizImageUploader: () => {}
  }));
  dbStub = {
    adminListLightningQuizQuestions: vi.fn(async () => ({ success: true, data: [] })),
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
}

afterEach(() => {
  vi.doUnmock("../js/modules/quiz-image-upload.mjs");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dom?.window.close();
});

const body = () => document.getElementById("admin-lightning-quiz-question-body");
const fieldset = () => body().querySelector("fieldset");

async function openNewQuestion() {
  const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-image-upload");
  await renderAdminLightningQuizQuestions();
  document.getElementById("admin-lightning-quiz-create").click();
}

async function pickFile() {
  const input = body().querySelector("[data-lq-image-file]");
  const file = new dom.window.File(["x"], "photo.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await flush();
  await flush();
  return file;
}

function fillSingleQuestion() {
  body().querySelector('[data-field="stem"]').value = "看圖：這是哪一個場景？";
  body().querySelectorAll("[data-option-text]").forEach((input, index) => { input.value = `選項${index + 1}`; });
  body().querySelector("[data-option-correct]").checked = true;
  document.getElementById("admin-lightning-quiz-rise-date").value = "2099-01-05";
}

async function save() {
  document.getElementById("admin-lightning-quiz-save").click();
  await flush();
  return dbStub.adminUpsertLightningQuizQuestion.mock.calls.at(-1)?.[0];
}

describe("雲柱測驗後台：題目附圖上傳（#585）", () => {
  it("新增題目時有「加入圖片」，上傳後顯示縮圖，存檔時帶進 payload.image", async () => {
    setup({ canUpload: true });
    await openNewQuestion();
    expect(body().querySelector("[data-lq-image-pick]").textContent).toBe("加入圖片");
    expect(body().querySelector("[data-lq-image-remove]")).toBeNull();

    const file = await pickFile();
    expect(upload).toHaveBeenCalledWith(file);
    expect(body().querySelector(".admin-lq-image-note img").getAttribute("src")).toBe(PUBLIC_URL);
    expect(body().querySelector("[data-lq-image-pick]").textContent).toBe("更換圖片");

    body().querySelector("[data-lq-image-alt]").value = "祭司獻燔祭";
    fillSingleQuestion();
    const saved = await save();
    expect(saved.payload.image).toEqual({ src: PUBLIC_URL, alt: "祭司獻燔祭" });
    expect(saved.payload.stem).toBe("看圖：這是哪一個場景？");
  });

  it("圖片說明留白時用預設文字", async () => {
    setup({ canUpload: true });
    await openNewQuestion();
    await pickFile();
    fillSingleQuestion();
    expect((await save()).payload.image).toEqual({ src: PUBLIC_URL, alt: "題目附圖" });
  });

  it("移除圖片後存檔就不帶 image", async () => {
    setup({ canUpload: true });
    await openNewQuestion();
    await pickFile();
    fillSingleQuestion();
    body().querySelector("[data-lq-image-remove]").click();
    expect(body().querySelector(".admin-lq-image-note")).toBeNull();
    expect(fieldset().dataset.lqImage).toBeUndefined();
    expect((await save()).payload.image).toBeUndefined();
  });

  it("上傳失敗時顯示原因，按鈕恢復，題目不帶圖", async () => {
    setup({ canUpload: true });
    await openNewQuestion();
    upload.mockRejectedValueOnce(new Error("圖片太大（最多 700 KB），請換一張小一點的。"));
    await pickFile();
    expect(showToast).toHaveBeenCalledWith("圖片太大（最多 700 KB），請換一張小一點的。");
    const pick = body().querySelector("[data-lq-image-pick]");
    expect(pick.disabled).toBe(false);
    expect(pick.textContent).toBe("加入圖片");
    expect(fieldset().dataset.lqImage).toBeUndefined();
  });

  it("加了圖片就算有改動，返回時會先問", async () => {
    setup({ canUpload: true });
    await openNewQuestion();
    await pickFile();
    document.getElementById("admin-lightning-quiz-cancel").click();
    await flush();
    expect(dom.window.showConfirmDialog).toHaveBeenCalled();
  });

  it("不能上傳的地方不顯示「加入圖片」", async () => {
    setup({ canUpload: false });
    await openNewQuestion();
    expect(body().querySelector("[data-lq-image-section]")).toBeNull();
  });
});

describe("quiz-image-upload helpers", () => {
  it("fitWithin only shrinks, keeping the aspect ratio", async () => {
    const { fitWithin } = await vi.importActual("../js/modules/quiz-image-upload.mjs");
    expect(fitWithin(4000, 1000)).toEqual({ w: 2000, h: 500 });
    expect(fitWithin(1200, 800)).toEqual({ w: 1200, h: 800 });
  });

  it("refuses to upload without an uploader, and reports the server's message", async () => {
    const mod = await vi.importActual("../js/modules/quiz-image-upload.mjs");
    mod.setQuizImageUploader(null);
    expect(mod.canUploadQuizImage()).toBe(false);
    await expect(mod.uploadQuizImageFile({ type: "image/png" })).rejects.toThrow("這裡不能上傳圖片");
    mod.setQuizImageUploader(async () => ({ ok: false, message: "x" }));
    expect(mod.canUploadQuizImage()).toBe(true);
    await expect(mod.prepareQuizImage({ type: "image/svg+xml" })).rejects.toThrow("圖片只接受 PNG、JPEG、WebP。");
    mod.setQuizImageUploader(null);
  });
});
