import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

let dom;
let dbStub;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const singleQuestion = {
  questionType: "single",
  payload: { stem: "摩西的哥哥是誰？", options: ["約書亞", "亞倫", "迦勒"] },
  answerKey: 1
};

function setupGlobals(html) {
  dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: "https://example.test" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
  vi.stubGlobal("state", { currentUser: { role: "admin" }, activePlan: null });
  vi.stubGlobal("escapeHTML", value => String(value));
  vi.stubGlobal("hydrateIcons", () => {});
  vi.stubGlobal("showToast", vi.fn());
  vi.stubGlobal("db", dbStub);
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
}

function answerSingle(host, index) {
  const input = host.querySelector(`input[type=radio][value="${index}"]`);
  input.checked = true;
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function submit(host) {
  host.querySelector("[data-lq-form]").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dom?.window.close();
});

describe("後台預覽測試", () => {
  beforeEach(() => {
    // 預覽不能碰到任何作答 RPC：呼叫到就直接讓測試失敗。
    const forbidden = () => { throw new Error("preview must not call the database"); };
    dbStub = { startLightningQuizAttempt: forbidden, submitLightningQuizAttempt: forbidden };
    vi.resetModules();
    setupGlobals('<div id="preview-host"></div>');
  });

  it("跑完整流程並在瀏覽器端判分，不寫入任何作答紀錄", async () => {
    const { openLightningQuizPreview } = await import("../js/modules/lightning-quiz.mjs?preview-correct");
    const host = document.getElementById("preview-host");
    openLightningQuizPreview(host, singleQuestion);
    expect(host.textContent).toContain("題型：單選");

    host.querySelector("[data-lq-start]").click();
    await flush();
    expect(host.textContent).toContain("摩西的哥哥是誰？");

    answerSingle(host, 1);
    submit(host);
    await flush();
    expect(host.textContent).toContain("答對了！");
  });

  it("答錯時顯示答錯，重新預覽會回到題型預告", async () => {
    const { openLightningQuizPreview } = await import("../js/modules/lightning-quiz.mjs?preview-wrong");
    const host = document.getElementById("preview-host");
    openLightningQuizPreview(host, singleQuestion);
    host.querySelector("[data-lq-start]").click();
    await flush();
    answerSingle(host, 0);
    submit(host);
    await flush();
    expect(host.textContent).toContain("答錯了");

    openLightningQuizPreview(host, singleQuestion);
    expect(host.querySelector("[data-lq-start]")).not.toBeNull();
  });
});

describe("後台活動清單：每題各自發布", () => {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const base = { questionType: "single", payload: singleQuestion.payload, answerKey: 1, riseTimeStart: "12:00:00", riseTimeEnd: "12:30:00" };
  const questions = [
    { ...base, id: "draft-1", riseDate: today, status: "draft", locked: false },
    { ...base, id: "live-1", riseDate: today, status: "published", locked: true },
    { ...base, id: "old-1", riseDate: "2026-01-01", status: "archived", locked: true }
  ];

  beforeEach(() => {
    dbStub = {
      adminListLightningQuizQuestions: vi.fn(async () => ({ success: true, data: questions })),
      adminSetLightningQuizStatus: vi.fn(async () => ({ success: true, data: { archivedQuestionId: "live-1" } })),
      adminGetLightningQuizTrend: vi.fn(async () => ({ success: true, data: { days: [] } }))
    };
    vi.resetModules();
    setupGlobals(`
      <div id="admin-lightning-quiz-preview" class="hidden"><div id="admin-lightning-quiz-preview-host"></div></div>
      <div id="admin-lightning-quiz-editor" class="hidden">
        <h4 id="admin-lightning-quiz-form-title"></h4>
        <p id="admin-lightning-quiz-fork-note" class="hidden"></p>
        <input id="admin-lightning-quiz-rise-date"><input id="admin-lightning-quiz-time-start"><input id="admin-lightning-quiz-time-end">
        <div id="admin-lightning-quiz-question-body"></div>
        <button id="admin-lightning-quiz-cancel"></button><button id="admin-lightning-quiz-save"></button>
      </div>
      <button id="admin-lightning-quiz-create"></button>
      <div id="admin-lightning-quiz-list"></div>
      <div id="admin-lightning-quiz-stats-body"></div>`);
  });

  const card = id => document.querySelector(`[data-admin-lightning-quiz-id="${id}"]`);
  const actions = id => [...card(id).querySelectorAll("[data-lightning-quiz-status]")].map(button => button.dataset.lightningQuizStatus);

  it("測試中只能發布；已鎖定的已發布活動只能下架；已下架可以重新上架", async () => {
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-publish-list");
    await renderAdminLightningQuizQuestions();
    expect(actions("draft-1")).toEqual(["published"]);
    expect(actions("live-1")).toEqual(["archived"]);
    expect(actions("old-1")).toEqual(["published"]);
    expect(card("live-1").textContent).toContain("已鎖定");
    expect(card("draft-1").textContent).toContain("測試中");
  });

  it("發布同一天已有已發布活動的草稿時，先提示原活動會自動下架", async () => {
    const confirmDialog = vi.fn(async () => true);
    dom.window.showConfirmDialog = confirmDialog;
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-publish-conflict");
    await renderAdminLightningQuizQuestions();

    card("draft-1").querySelector('[data-lightning-quiz-status="published"]').click();
    await flush();
    expect(confirmDialog.mock.calls[0][0].message).toContain("原本已發布的活動會自動下架");
    expect(db.adminSetLightningQuizStatus).toHaveBeenCalledWith("draft-1", "published");
  });

  it("打開已鎖定活動的編輯畫面時，提示儲存會另存為新活動", async () => {
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-publish-fork");
    await renderAdminLightningQuizQuestions();
    card("live-1").querySelector("[data-lightning-quiz-edit]").click();
    expect(document.getElementById("admin-lightning-quiz-fork-note").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("admin-lightning-quiz-save").textContent).toBe("另存為新活動");
  });

  it("預覽測試按鈕在後台打開預覽，不需要等到活動時段", async () => {
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-publish-preview");
    await renderAdminLightningQuizQuestions();
    card("old-1").querySelector("[data-lightning-quiz-preview]").click();
    expect(document.getElementById("admin-lightning-quiz-preview").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("admin-lightning-quiz-preview-host").textContent).toContain("開始作答");
  });
});
