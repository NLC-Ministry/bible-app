// 大測驗作答頁：同步狀態 / 只上傳改過的題 / 登入失效不打斷作答（行為測試，不是原始碼字串斷言）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

let dom;
let db;
let toasts;
let mountExamRunner;
let isEmptyExamAnswer;
let runners = [];

const QUESTIONS = [
  { id: "q1", section: "truefalse", position: 1, points: 1, payload: { stem: "是非" } },
  { id: "q2", section: "truefalse", position: 2, points: 1, payload: { stem: "是非2" } },
  { id: "q3", section: "shortanswer", position: 1, points: 10, payload: { stem: "簡答" } }
];

const attemptPayload = (savedAnswers = {}) => ({
  success: true,
  data: {
    state: "open",
    paper: { id: "p1", title: "測驗", mode: "live" },
    attempt: {
      id: "a1", status: "in_progress", secondsRemaining: 3600,
      paperSnapshot: { questions: QUESTIONS }, layout: {}, savedAnswers
    }
  }
});

const flushMicrotasks = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
async function mount() {
  const runner = mountExamRunner({ paperId: "p1", standalone: true });
  runners.push(runner);
  await vi.waitFor(() => expect(document.querySelector("[data-exam-q]")).toBeTruthy());
  return runner;
}

const syncText = () => document.getElementById("exam-sync").textContent;
const pickTrue = (qid) => {
  const inp = document.querySelector(`input[name="q_${qid}"][value="true"]`);
  inp.checked = true;
  inp.dispatchEvent(new window.Event("change"));
};

beforeEach(async () => {
  vi.resetModules();
  dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/exam.html?paper=p1" });
  toasts = [];
  db = {
    getExamForAttempt: vi.fn(async () => attemptPayload()),
    saveExamProgress: vi.fn(async () => ({ success: true, data: { secondsRemaining: 3500 } })),
    submitExamAttempt: vi.fn(async () => ({ success: true, data: { status: "submitted" } })),
    getMyExamResult: vi.fn(async () => ({ success: true, data: { state: "submitted", answers: [] } }))
  };
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("localStorage", dom.window.localStorage);
  vi.stubGlobal("location", dom.window.location);
  vi.stubGlobal("db", db);
  vi.stubGlobal("escapeHTML", (v) => String(v));
  vi.stubGlobal("hydrateIcons", () => {});
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 0));
  dom.window.showToast = (m) => toasts.push(m);
  dom.window.auth = { startInteractiveLogin: vi.fn(async () => {}) };
  ({ mountExamRunner, isEmptyExamAnswer } = await import("../js/modules/exam.js?exam-sync-status"));
});

afterEach(() => {
  runners.forEach((r) => { try { r.detachLifecycle(); } catch (_) {} });
  runners = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  dom.window.close();
});

describe("isEmptyExamAnswer", () => {
  it("treats blank values as unanswered but keeps false / 0", () => {
    [undefined, null, "", [], {}].forEach((v) => expect(isEmptyExamAnswer(v)).toBe(true));
    [false, 0, "x", [1], { a: "b" }].forEach((v) => expect(isEmptyExamAnswer(v)).toBe(false));
  });
});

describe("delta upload", () => {
  it("uploads only the questions that changed, not the whole sheet", async () => {
    db.getExamForAttempt.mockResolvedValue(attemptPayload({ q1: false }));
    const runner = await mount();
    db.saveExamProgress.mockClear();

    pickTrue("q2");
    await runner.flushSave();

    expect(db.saveExamProgress).toHaveBeenCalledTimes(1);
    expect(db.saveExamProgress.mock.calls[0][1]).toEqual({ q2: true });
    expect(syncText()).toBe("✓ 已儲存");
  });

  it("keeps failed questions pending and retries them on the next flush", async () => {
    const runner = await mount();
    db.saveExamProgress.mockResolvedValueOnce({ success: false, message: "offline" });

    pickTrue("q1");
    await runner.flushSave();
    expect(syncText()).toBe("1 題待儲存");

    await runner.flushSave();
    expect(db.saveExamProgress.mock.calls.at(-1)[1]).toEqual({ q1: true });
    expect(syncText()).toBe("✓ 已儲存");
  });

  it("never runs two uploads at once; edits made mid-upload go in a follow-up round", async () => {
    const runner = await mount();
    let release;
    db.saveExamProgress.mockImplementationOnce(() => new Promise((r) => { release = r; }));

    pickTrue("q1");
    const first = runner.flushSave();
    await flushMicrotasks();
    expect(syncText()).toBe("儲存中…");

    pickTrue("q2");
    runner.flushSave();                        // queued, must not start a parallel request
    expect(db.saveExamProgress).toHaveBeenCalledTimes(1);

    release({ success: true, data: {} });
    await first;
    expect(db.saveExamProgress).toHaveBeenCalledTimes(2);
    expect(db.saveExamProgress.mock.calls[1][1]).toEqual({ q2: true });
  });

  it("pushes answers that exist only in the local mirror after a reload / re-login", async () => {
    localStorage.setItem("exam_resp_a1", JSON.stringify({ q1: true, q3: "本機才有的簡答", __savedAt: Date.now() }));
    db.getExamForAttempt.mockResolvedValue(attemptPayload({ q1: true }));
    await mount();
    await vi.waitFor(() => expect(db.saveExamProgress).toHaveBeenCalled());
    expect(db.saveExamProgress.mock.calls[0][1]).toEqual({ q3: "本機才有的簡答" });
  });

  it("picks up short-answer text that never fired an input event (iOS dictation)", async () => {
    const runner = await mount();
    db.saveExamProgress.mockClear();
    document.querySelector('textarea[data-sa="q3"]').value = "語音輸入的內容";
    await runner.flushSave();
    expect(db.saveExamProgress.mock.calls[0][1]).toEqual({ q3: "語音輸入的內容" });
  });
});

describe("sync status escalation", () => {
  it("warns (once) when changes stay unsynced for more than 30 seconds", async () => {
    const runner = await mount();
    db.saveExamProgress.mockResolvedValue({ success: false, message: "offline" });
    pickTrue("q1");
    await runner.flushSave();

    runner._unsyncedSince = Date.now() - 31000;
    runner._renderSync();
    runner._renderSync();
    expect(syncText()).toBe("⚠ 1 題未上傳");
    expect(document.getElementById("exam-sync").dataset.tone).toBe("error");
    expect(toasts.filter((t) => t.includes("還沒上傳")).length).toBe(1);
  });

  it("mentions the device-storage failure when localStorage writes fail", async () => {
    const runner = await mount();
    db.saveExamProgress.mockResolvedValue({ success: false, message: "offline" });
    vi.spyOn(dom.window.Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    pickTrue("q1");
    await runner.flushSave();
    runner._unsyncedSince = Date.now() - 31000;
    runner._renderSync();
    expect(toasts.at(-1)).toContain("這台裝置也存不下來");
  });
});

describe("expired login never interrupts the exam", () => {
  it("an auth-expired autosave just stays pending — no re-login prompt, next round retries", async () => {
    const runner = await mount();
    db.saveExamProgress.mockResolvedValueOnce({ success: false, authExpired: true, message: "登入已過期" });
    pickTrue("q1");
    await runner.flushSave();

    expect(document.querySelector("[data-exam-relogin]")).toBeNull();
    expect(syncText()).toBe("1 題待儲存");
    await runner.flushSave();
    expect(syncText()).toBe("✓ 已儲存");
  });

  it("ignores the global auth:session-expired event while answering", async () => {
    await mount();
    window.dispatchEvent(new window.CustomEvent("auth:session-expired"));
    expect(document.querySelector("[data-exam-relogin]")).toBeNull();
  });

  it("passes the attempt write token to save and submit", async () => {
    const payload = attemptPayload();
    payload.data.attempt.writeToken = "v1.tok";
    db.getExamForAttempt.mockResolvedValue(payload);
    const runner = await mount();
    pickTrue("q1");
    await runner.flushSave();
    expect(db.saveExamProgress.mock.calls.at(-1)[2]).toBe("v1.tok");
    await runner.submit("manual");
    expect(db.submitExamAttempt.mock.calls[0][3]).toBe("v1.tok");
  });
});
