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

describe("後台題目清單：準備中 → 已排程 → 作答中 → 已結束（#309）", () => {
  const taipei = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const shift = days => {
    const date = new Date(`${taipei}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const base = { questionType: "single", payload: singleQuestion.payload, answerKey: 1, riseTimeStart: "07:00:00", riseTimeEnd: "10:00:00" };
  const questions = [
    { ...base, id: "draft-1", riseDate: shift(3), status: "draft", locked: false },
    { ...base, id: "sched-1", riseDate: shift(1), status: "published", locked: false },
    { ...base, id: "live-1", riseDate: taipei, riseTimeStart: "00:00:00", riseTimeEnd: "23:59:59", status: "published", locked: true },
    { ...base, id: "ended-1", riseDate: shift(-2), status: "published", locked: true }
  ];

  beforeEach(() => {
    dbStub = {
      adminListLightningQuizQuestions: vi.fn(async () => ({ success: true, data: questions })),
      adminSetLightningQuizStatus: vi.fn(async () => ({ success: true, data: {} })),
      adminGetLightningQuizTrend: vi.fn(async () => ({ success: true, data: { days: [] } })),
      adminGetLightningQuizWeek: vi.fn(async () => ({ success: true, data: { questions: [] } })),
      adminGetLightningQuizSettings: vi.fn(async () => ({ success: true, data: { weekdays: [1, 3, 5], timeStart: "07:00", timeEnd: "10:00" } })),
      adminImportLightningQuizQuestions: vi.fn(async items => ({ success: true, data: { imported: items.length } }))
    };
    vi.resetModules();
    setupGlobals(`
      <div id="admin-lightning-quiz-preview" class="hidden"><div id="admin-lightning-quiz-preview-host"></div></div>
      <div id="admin-lightning-quiz-editor" class="hidden">
        <h4 id="admin-lightning-quiz-form-title"></h4>
        <input id="admin-lightning-quiz-rise-date"><input id="admin-lightning-quiz-time-start"><input id="admin-lightning-quiz-time-end">
        <div id="admin-lightning-quiz-question-body"></div>
        <button id="admin-lightning-quiz-cancel"></button><button id="admin-lightning-quiz-save"></button>
      </div>
      <button id="admin-lightning-quiz-create"></button>
      <div id="admin-lightning-quiz-planner"></div>
      <div id="admin-lightning-quiz-list"></div>
      <div id="admin-lightning-quiz-stats-body"></div>`);
  });

  const card = id => document.querySelector(`[data-admin-lightning-quiz-id="${id}"]`);
  const stage = id => card(id).querySelector("[data-lightning-quiz-stage]").textContent;
  const actions = id => [...card(id).querySelectorAll("[data-lightning-quiz-status]")].map(button => button.dataset.lightningQuizStatus);

  it("shows one stage badge per question and only the next step as its action", async () => {
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-stages");
    await renderAdminLightningQuizQuestions();
    expect(["draft-1", "sched-1", "live-1", "ended-1"].map(stage)).toEqual(["準備中", "已排程", "作答中", "已結束"]);
    expect(actions("draft-1")).toEqual(["published"]);
    expect(actions("sched-1")).toEqual(["draft"]);
    expect(actions("live-1")).toEqual([]);
    expect(actions("ended-1")).toEqual([]);
    const text = document.getElementById("admin-lightning-quiz-list").textContent;
    expect(text).not.toContain("下架");
    expect(text).not.toContain("測試中");
  });

  it("locked questions cannot be edited or deleted, only copied into a new draft with the date cleared", async () => {
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-copy");
    await renderAdminLightningQuizQuestions();
    expect(card("live-1").querySelector("[data-lightning-quiz-edit]")).toBeNull();
    expect(card("live-1").querySelector("[data-lightning-quiz-delete]")).toBeNull();
    expect(card("sched-1").querySelector("[data-lightning-quiz-edit]")).not.toBeNull();

    card("live-1").querySelector("[data-lightning-quiz-copy]").click();
    expect(document.getElementById("admin-lightning-quiz-editor").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("admin-lightning-quiz-form-title").textContent).toContain("複製成新題");
    expect(document.getElementById("admin-lightning-quiz-rise-date").value).toBe("");
    expect(document.getElementById("admin-lightning-quiz-time-start").value).toBe("00:00");
  });

  it("scheduling asks for confirmation with the date and time, then calls the RPC", async () => {
    const confirmDialog = vi.fn(async () => true);
    dom.window.showConfirmDialog = confirmDialog;
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-schedule");
    await renderAdminLightningQuizQuestions();
    card("draft-1").querySelector('[data-lightning-quiz-status="published"]').click();
    await flush();
    expect(confirmDialog.mock.calls[0][0].title).toBe("確定要排程這一題嗎？");
    expect(confirmDialog.mock.calls[0][0].message).toContain("07:00–10:00");
    expect(db.adminSetLightningQuizStatus).toHaveBeenCalledWith("draft-1", "published");
  });

  it("calendar marks empty rule days as 缺題; 新增 opens the editor on that date with the rule's times", async () => {
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-calendar");
    await renderAdminLightningQuizQuestions();
    const planner = document.getElementById("admin-lightning-quiz-planner");
    expect(planner.textContent).toContain("每週一、三、五　07:00–10:00");
    expect(planner.querySelectorAll(".admin-lightning-quiz-calendar__week")).toHaveLength(4);
    const missing = planner.querySelector("[data-lq-calendar-add]");
    expect(missing).not.toBeNull();
    missing.click();
    expect(document.getElementById("admin-lightning-quiz-rise-date").value).toBe(missing.dataset.lqCalendarAdd);
    expect(document.getElementById("admin-lightning-quiz-time-start").value).toBe("07:00");
    expect(document.getElementById("admin-lightning-quiz-form-title").textContent).toBe("新增題目");
  });

  it("text import previews the dates first, then imports everything in one call", async () => {
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-import");
    await renderAdminLightningQuizQuestions();
    const planner = document.getElementById("admin-lightning-quiz-planner");
    planner.querySelector("[data-lq-import-text]").value = "[是非] 第一題\n答案：對\n\n[是非] 第二題\n答案：錯";
    planner.querySelector("[data-lq-import-parse]").click();
    const preview = planner.querySelector("[data-lq-import-preview]");
    expect(preview.textContent).toContain("共 2 題");
    expect(db.adminImportLightningQuizQuestions).not.toHaveBeenCalled();

    preview.querySelector('[data-lq-import-save="schedule"]').click();
    await flush();
    const [items, schedule] = db.adminImportLightningQuizQuestions.mock.calls[0];
    expect(schedule).toBe(true);
    expect(items.map(item => item.payload.stem)).toEqual(["第一題", "第二題"]);
    expect(items.every(item => item.riseTimeStart === "07:00" && item.riseTimeEnd === "10:00")).toBe(true);
    // 已經有題目的日子（這個測試的四題）不會被排進去
    expect(items.map(item => item.riseDate).some(date => questions.some(q => q.riseDate === date))).toBe(false);
  });

  it("shows import errors by question number and offers no import button", async () => {
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-import-errors");
    await renderAdminLightningQuizQuestions();
    const planner = document.getElementById("admin-lightning-quiz-planner");
    planner.querySelector("[data-lq-import-text]").value = "[是非] 好的\n答案：對\n\n[單選] 沒答案\nA. 一\nB. 二";
    planner.querySelector("[data-lq-import-parse]").click();
    const preview = planner.querySelector("[data-lq-import-preview]");
    expect(preview.textContent).toContain("第 2 題");
    expect(preview.querySelector("[data-lq-import-save]")).toBeNull();
  });

  it("試作 opens the in-admin run-through at any time", async () => {
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-try");
    await renderAdminLightningQuizQuestions();
    const button = card("ended-1").querySelector("[data-lightning-quiz-preview]");
    expect(button.textContent).toBe("試作");
    button.click();
    expect(document.getElementById("admin-lightning-quiz-preview").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("admin-lightning-quiz-preview-host").textContent).toContain("開始作答");
  });
});
