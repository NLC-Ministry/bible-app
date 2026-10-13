import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

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

describe("雲柱測驗後台：分頁＋彈出面板（#309、#310、#313）", () => {
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
    ...Array.from({ length: 12 }, (_, index) => ({ ...base, id: `ended-${index + 1}`, riseDate: shift(-2 - index), status: "published", locked: true }))
  ];
  // 用 index.html 裡真正的雲柱測驗區塊，不另外手寫假的 DOM
  const indexHtml = readLegacyIndexHtml();
  const sectionHtml = indexHtml.slice(
    indexHtml.indexOf('<div id="admin-section-lightning-quiz"'),
    indexHtml.indexOf('<div id="admin-section-settings"')
  );
  // 題目、試作、排程規則面板在 index.html 裡直接放在 body 底下（#420）
  const sheetsHtml = indexHtml.slice(
    indexHtml.indexOf("<!-- lightning-quiz-sheets:start -->"),
    indexHtml.indexOf("<!-- lightning-quiz-sheets:end -->")
  );

  beforeEach(() => {
    dbStub = {
      adminListLightningQuizQuestions: vi.fn(async () => ({ success: true, data: questions })),
      adminSetLightningQuizStatus: vi.fn(async () => ({ success: true, data: {} })),
      adminDeleteLightningQuizQuestion: vi.fn(async () => ({ success: true, data: {} })),
      adminGetLightningQuizTrend: vi.fn(async () => ({ success: true, data: { days: [] } })),
      adminGetLightningQuizWeek: vi.fn(async () => ({ success: true, data: { questions: [] } })),
      adminGetLightningQuizSettings: vi.fn(async () => ({ success: true, data: { weekdays: [1, 3, 5], timeStart: "07:00", timeEnd: "10:00" } })),
      adminImportLightningQuizQuestions: vi.fn(async items => ({ success: true, data: { imported: items.length } }))
    };
    vi.resetModules();
    setupGlobals(`<section class="view-pane active">${sectionHtml.replace("admin-section-panel hidden", "admin-section-panel")}</section>${sheetsHtml}<div id="after-sheets"></div>`);
    vi.stubGlobal("localStorage", dom.window.localStorage);
  });

  const row = id => document.querySelector(`#admin-lightning-quiz-list [data-admin-lightning-quiz-id="${id}"]`);
  const detail = () => document.getElementById("admin-lightning-quiz-question-sheet");
  const openDetail = id => { row(id).click(); return detail(); };
  const detailStatuses = () => [...detail().querySelectorAll("[data-lightning-quiz-status]")].map(button => button.dataset.lightningQuizStatus);
  const isOpen = id => !document.getElementById(id).classList.contains("hidden");
  const render = async () => {
    const { renderAdminLightningQuizQuestions } = await import("../js/modules/admin.js?lq-layout");
    await renderAdminLightningQuizQuestions();
  };

  it("opens on the 排程 tab; the list and stats are in their own tabs, and the choice is remembered", async () => {
    await render();
    const panel = name => document.querySelector(`[data-lq-tab-panel="${name}"]`);
    expect(panel("schedule").classList.contains("hidden")).toBe(false);
    expect(panel("list").classList.contains("hidden")).toBe(true);
    expect(panel("stats").classList.contains("hidden")).toBe(true);
    document.querySelector('[data-lq-tab="list"]').click();
    expect(panel("list").classList.contains("hidden")).toBe(false);
    expect(panel("schedule").classList.contains("hidden")).toBe(true);
    expect(dom.window.localStorage.getItem("adminLightningQuizTab")).toBe("list");
  });

  it("list shows upcoming questions by default, one row each, with one stage badge", async () => {
    await render();
    const badges = [...document.querySelectorAll("#admin-lightning-quiz-list [data-lightning-quiz-stage]")].map(badge => badge.textContent);
    expect(badges).toEqual(["作答中", "已排程", "準備中"]);
    const text = document.getElementById("admin-lightning-quiz-list").textContent;
    expect(text).toContain("接下來（3）");
    expect(text).toContain("已結束（12）");
    expect(text).not.toContain("下架");
  });

  it("已結束 shows ten at a time with 顯示更多", async () => {
    await render();
    document.querySelector('[data-lq-list-filter="ended"]').click();
    expect(document.querySelectorAll("#admin-lightning-quiz-list .admin-lq-row")).toHaveLength(10);
    document.querySelector("[data-lq-list-more]").click();
    expect(document.querySelectorAll("#admin-lightning-quiz-list .admin-lq-row")).toHaveLength(12);
    expect(document.querySelector("[data-lq-list-more]")).toBeNull();
  });

  it("the question panel offers only the next step; locked questions can only be tried or copied", async () => {
    await render();
    expect(openDetail("draft-1").classList.contains("hidden")).toBe(false);
    expect(detailStatuses()).toEqual(["published"]);
    expect(detail().querySelector("[data-lightning-quiz-edit]")).not.toBeNull();
    expect(detail().textContent).toContain("正解：亞倫");

    openDetail("sched-1");
    expect(detailStatuses()).toEqual(["draft"]);

    openDetail("live-1");
    expect(detailStatuses()).toEqual([]);
    expect(detail().querySelector("[data-lightning-quiz-edit]")).toBeNull();
    expect(detail().querySelector("[data-lightning-quiz-delete]")).toBeNull();
    detail().querySelector("[data-lightning-quiz-copy]").click();
    expect(isOpen("admin-lightning-quiz-question-sheet")).toBe(false);
    expect(isOpen("admin-lightning-quiz-editor")).toBe(true);
    expect(document.getElementById("admin-lightning-quiz-form-title").textContent).toContain("複製成新題");
    expect(document.getElementById("admin-lightning-quiz-rise-date").value).toBe("");
    expect(document.getElementById("admin-lightning-quiz-time-start").value).toBe("00:00");
  });

  const confirmRow = () => detail().querySelector("[data-lq-detail-confirm]");
  const actionsRow = () => detail().querySelector(".admin-lq-detail__actions");

  it("the sheets sit directly under body in index.html and opening them never moves them (#420)", async () => {
    const page = new JSDOM(indexHtml).window.document;
    for (const id of ["admin-lightning-quiz-question-sheet", "admin-lightning-quiz-preview", "admin-lightning-quiz-rule"]) {
      expect(page.getElementById(id).parentElement).toBe(page.body);
      expect(sectionHtml).not.toContain(`id="${id}"`);
    }
    await render();
    const order = () => [...document.body.children].map(element => element.id).filter(Boolean);
    const before = order();
    document.getElementById("admin-lightning-quiz-rule-open").click();
    expect(isOpen("admin-lightning-quiz-rule")).toBe(true);
    openDetail("draft-1").querySelector('[data-lq-detail-action="try"]').click();
    expect(isOpen("admin-lightning-quiz-preview")).toBe(true);
    expect(order()).toEqual(before);
  });

  it("scheduling confirms inside the panel with the date and time, without a second dialog, then calls the RPC (#420)", async () => {
    const confirmDialog = vi.fn(async () => true);
    dom.window.showConfirmDialog = confirmDialog;
    await render();
    openDetail("draft-1").querySelector('[data-lightning-quiz-status="published"]').click();
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(confirmRow().textContent).toContain("確定要排程這一題嗎？");
    expect(confirmRow().textContent).toContain("07:00–10:00");
    expect(actionsRow().classList.contains("hidden")).toBe(true);
    expect(db.adminSetLightningQuizStatus).not.toHaveBeenCalled();

    confirmRow().querySelector("[data-lq-detail-confirm-ok]").click();
    expect(confirmRow().querySelector("[data-lq-detail-confirm-ok]").disabled).toBe(true);
    await flush();
    expect(db.adminSetLightningQuizStatus).toHaveBeenCalledWith("draft-1", "published");
    expect(isOpen("admin-lightning-quiz-question-sheet")).toBe(false);
  });

  it("取消 on the in-panel confirmation goes back to the buttons and changes nothing (#420)", async () => {
    await render();
    openDetail("sched-1").querySelector('[data-lightning-quiz-status="draft"]').click();
    expect(confirmRow().textContent).toContain("確定要取消排程嗎？");
    confirmRow().querySelector("[data-lq-detail-confirm-cancel]").click();
    expect(confirmRow()).toBeNull();
    expect(actionsRow().classList.contains("hidden")).toBe(false);
    expect(isOpen("admin-lightning-quiz-question-sheet")).toBe(true);
    expect(db.adminSetLightningQuizStatus).not.toHaveBeenCalled();
  });

  it("deleting confirms inside the panel; a failed request gives the buttons back (#420)", async () => {
    const confirmDialog = vi.fn(async () => true);
    dom.window.showConfirmDialog = confirmDialog;
    db.adminDeleteLightningQuizQuestion.mockResolvedValueOnce({ success: false, message: "刪除失敗" });
    await render();
    openDetail("draft-1").querySelector("[data-lightning-quiz-delete]").click();
    expect(confirmRow().textContent).toContain("此動作無法復原");
    confirmRow().querySelector("[data-lq-detail-confirm-ok]").click();
    await flush();
    expect(db.adminDeleteLightningQuizQuestion).toHaveBeenCalledWith("draft-1");
    expect(showToast).toHaveBeenCalledWith("刪除失敗");
    expect(confirmRow()).toBeNull();
    expect(actionsRow().classList.contains("hidden")).toBe(false);
    expect(isOpen("admin-lightning-quiz-question-sheet")).toBe(true);

    actionsRow().querySelector("[data-lightning-quiz-delete]").click();
    confirmRow().querySelector("[data-lq-detail-confirm-ok]").click();
    await flush();
    expect(db.adminDeleteLightningQuizQuestion).toHaveBeenCalledTimes(2);
    expect(isOpen("admin-lightning-quiz-question-sheet")).toBe(false);
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it("sheets close with the close button or Escape, but not with a click outside (#317)", async () => {
    await render();
    openDetail("draft-1");
    detail().querySelector("[data-lq-sheet-close]").click();
    expect(isOpen("admin-lightning-quiz-question-sheet")).toBe(false);

    openDetail("draft-1");
    detail().dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(isOpen("admin-lightning-quiz-question-sheet")).toBe(true);

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    expect(isOpen("admin-lightning-quiz-question-sheet")).toBe(false);
    expect(detail().parentElement).toBe(document.body);
  });

  it("new/edit is a full page: the main view hides, and 返回 comes straight back when nothing was typed (#317)", async () => {
    await render();
    document.querySelector('[data-lq-tab="list"]').click();
    document.getElementById("admin-lightning-quiz-create").click();
    expect(isOpen("admin-lightning-quiz-editor")).toBe(true);
    expect(document.querySelector(".admin-lq").classList.contains("hidden")).toBe(true);

    document.querySelector("#admin-lightning-quiz-editor [data-lq-subpage-back]").click();
    await flush();
    expect(isOpen("admin-lightning-quiz-editor")).toBe(false);
    expect(document.querySelector(".admin-lq").classList.contains("hidden")).toBe(false);
    // 回到原本的分頁
    expect(document.querySelector('[data-lq-tab-panel="list"]').classList.contains("hidden")).toBe(false);
  });

  it("asks before throwing away typed text; 繼續編輯 keeps it, 放棄並返回 leaves", async () => {
    const confirmDialog = vi.fn(async () => false);
    dom.window.showConfirmDialog = confirmDialog;
    await render();
    document.getElementById("admin-lightning-quiz-create").click();
    const stem = document.querySelector("#admin-lightning-quiz-question-body [data-field=\"stem\"]");
    stem.value = "打到一半的題目";

    document.getElementById("admin-lightning-quiz-cancel").click();
    await flush();
    expect(confirmDialog.mock.calls[0][0].title).toBe("要放棄這些內容嗎？");
    expect(isOpen("admin-lightning-quiz-editor")).toBe(true);
    expect(stem.value).toBe("打到一半的題目");

    confirmDialog.mockResolvedValueOnce(true);
    document.querySelector("#admin-lightning-quiz-editor [data-lq-subpage-back]").click();
    await flush();
    expect(isOpen("admin-lightning-quiz-editor")).toBe(false);
  });

  it("the phone back button closes a sheet first, then a full page, and otherwise lets the app handle it", async () => {
    dom.window.showConfirmDialog = vi.fn(async () => true);
    await render();
    const closeLayer = dom.window.closeAdminLightningQuizLayer;
    expect(closeLayer()).toBe(false);

    document.getElementById("admin-lightning-quiz-import-open").click();
    expect(isOpen("admin-lightning-quiz-import")).toBe(true);
    expect(closeLayer()).toBe(true);
    await flush();
    expect(isOpen("admin-lightning-quiz-import")).toBe(false);

    document.getElementById("admin-lightning-quiz-rule-open").click();
    expect(closeLayer()).toBe(true);
    expect(isOpen("admin-lightning-quiz-rule")).toBe(false);
    expect(closeLayer()).toBe(false);
  });

  it("calendar marks empty rule days as 缺題; clicking one opens the editor on that date with the rule's times", async () => {
    await render();
    const planner = document.getElementById("admin-lightning-quiz-planner");
    expect(planner.textContent).toContain("每週一、三、五　07:00–10:00");
    expect(planner.querySelectorAll(".admin-lightning-quiz-calendar__week")).toHaveLength(4);
    const missing = planner.querySelector("[data-lq-calendar-add]");
    missing.click();
    expect(isOpen("admin-lightning-quiz-editor")).toBe(true);
    expect(document.getElementById("admin-lightning-quiz-rise-date").value).toBe(missing.dataset.lqCalendarAdd);
    expect(document.getElementById("admin-lightning-quiz-time-start").value).toBe("07:00");
    expect(document.getElementById("admin-lightning-quiz-form-title").textContent).toBe("新增題目");
  });

  it("匯入題目 opens a sheet that previews the dates first, then imports everything in one call", async () => {
    await render();
    document.getElementById("admin-lightning-quiz-import-open").click();
    expect(isOpen("admin-lightning-quiz-import")).toBe(true);
    const sheet = document.getElementById("admin-lightning-quiz-import");
    sheet.querySelector("[data-lq-import-text]").value = "[是非] 第一題\n答案：對\n\n[是非] 第二題\n答案：錯";
    sheet.querySelector("[data-lq-import-parse]").click();
    const preview = sheet.querySelector("[data-lq-import-preview]");
    expect(preview.textContent).toContain("共 2 題");
    expect(db.adminImportLightningQuizQuestions).not.toHaveBeenCalled();

    preview.querySelector('[data-lq-import-save="schedule"]').click();
    await flush();
    const [items, schedule] = db.adminImportLightningQuizQuestions.mock.calls[0];
    expect(schedule).toBe(true);
    expect(items.map(item => item.payload.stem)).toEqual(["第一題", "第二題"]);
    expect(items.every(item => item.riseTimeStart === "07:00" && item.riseTimeEnd === "10:00")).toBe(true);
    expect(items.map(item => item.riseDate).some(date => questions.some(q => q.riseDate === date))).toBe(false);
    expect(isOpen("admin-lightning-quiz-import")).toBe(false);
  });

  it("import errors are listed by question number with no import button", async () => {
    await render();
    document.getElementById("admin-lightning-quiz-import-open").click();
    const sheet = document.getElementById("admin-lightning-quiz-import");
    sheet.querySelector("[data-lq-import-text]").value = "[是非] 好的\n答案：對\n\n[單選] 沒答案\nA. 一\nB. 二";
    sheet.querySelector("[data-lq-import-parse]").click();
    const preview = sheet.querySelector("[data-lq-import-preview]");
    expect(preview.textContent).toContain("第 2 題");
    expect(preview.querySelector("[data-lq-import-save]")).toBeNull();
  });

  it("⚙ 排程規則 opens a sheet with the current rule", async () => {
    await render();
    document.getElementById("admin-lightning-quiz-rule-open").click();
    expect(isOpen("admin-lightning-quiz-rule")).toBe(true);
    const checked = [...document.querySelectorAll("#admin-lightning-quiz-rule [data-lq-rule-day]:checked")].map(input => input.value);
    expect(checked).toEqual(["1", "3", "5"]);
    expect(document.querySelector("#admin-lightning-quiz-rule [data-lq-rule-start]").value).toBe("07:00");
  });

  it("with the list and the stats both rendered, no id appears twice (the question sheet once collided with the stats detail)", async () => {
    const { renderAdminLightningQuizQuestions, renderAdminLightningQuizStats } = await import("../js/modules/admin.js?lq-layout");
    await renderAdminLightningQuizQuestions();
    await renderAdminLightningQuizStats();
    await flush();
    const ids = [...document.querySelectorAll("[id]")].map(element => element.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    openDetail("draft-1");
    expect(isOpen("admin-lightning-quiz-question-sheet")).toBe(true);
    expect(document.getElementById("admin-lightning-quiz-question-sheet-body").textContent).toContain("正解");
  });

  it("試作 opens the run-through in its own sheet at any time", async () => {
    await render();
    document.querySelector('[data-lq-list-filter="ended"]').click();
    openDetail("ended-1").querySelector('[data-lq-detail-action="try"]').click();
    expect(isOpen("admin-lightning-quiz-question-sheet")).toBe(false);
    expect(isOpen("admin-lightning-quiz-preview")).toBe(true);
    expect(document.getElementById("admin-lightning-quiz-preview-host").textContent).toContain("開始作答");
  });
});
