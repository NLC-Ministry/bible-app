// #574：提醒＝一天一則、送出後不能改。同一天再送一次要明講「今天已提醒過」，
// 不能假裝可以編輯（0010 觸發器 enforce_care_reminder_transition 擋住 reason／message 的修改），
// 也不能把觸發器的 42501 誤報成「此成員不在您的牧養範圍內」。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const R = "44444444-4444-4444-8444-444444444444";
const U = "33333333-3333-4333-8333-333333333333";

const nlcData = readFileSync(new URL("../supabase/functions/nlc-data/index.ts", import.meta.url), "utf8");
const planSrc = readFileSync(new URL("../js/modules/plan.js", import.meta.url), "utf8");

describe("nlc-data send_care_reminder", () => {
  const start = nlcData.indexOf('if (action === "send_care_reminder")');
  const branch = nlcData.slice(start, nlcData.indexOf("// ── mark_issue_report_reply_seen", start));

  it("never updates an already-sent reminder (the trigger forbids it)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(branch).not.toMatch(/\.update\(/);
  });

  it("answers a same-day resend with care_reminder_already_sent (409), including the concurrent-insert race", () => {
    expect(branch).toMatch(/error: "care_reminder_already_sent" }, 409/);
    expect(branch).toMatch(/23505/);
    expect(branch).not.toContain("care_reminder_already_seen");
  });

  it("records an audit event after a successful send, like the console's admin_api_care_remind (#570)", () => {
    const insertAt = branch.indexOf('.from("care_reminders")\n        .insert(');
    const auditAt = branch.indexOf('p_action: "care_reminder.send"');
    expect(insertAt).toBeGreaterThan(-1);
    expect(auditAt).toBeGreaterThan(insertAt);
    expect(branch.slice(auditAt)).toMatch(/p_target_user_id: p\.recipient_id/);
    expect(branch.slice(auditAt)).toMatch(/p_changes: \{ reason: p\.reason, message: msg \}/);
  });
});

describe("openCareReminderDialog plan key (#570)", () => {
  it("the management tab's own plan wins over the plan open in the reader; team reminders keep their key", () => {
    const start = planSrc.indexOf("const planKeyForCare = member.readingTeamId");
    const block = planSrc.slice(start, planSrc.indexOf(";", start));
    expect(block.indexOf("reading-team:")).toBeLessThan(block.indexOf("member.carePlanKey"));
    expect(block.indexOf("member.carePlanKey")).toBeLessThan(block.indexOf("state.activePlan"));
  });
});

describe("db.sendCareReminder error mapping", () => {
  let dom, db, fetchMock;

  beforeEach(async () => {
    vi.resetModules();
    dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    fetchMock = vi.fn();
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("localStorage", dom.window.localStorage);
    vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("location", dom.window.location);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("auth", { isLoggedIn: () => true, getValidAccessToken: async () => "tok" });
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      supabase: {},
      supabaseConfig: { url: "https://proj.supabase.co/", anonKey: "anon" },
      currentUser: { id: U },
      currentProfileId: U
    });
    await import("../js/db.js?care-reminder-readonly");
    db = dom.window.db || globalThis.db;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.window.close();
  });

  const respond = (status, body) => fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300, status, json: async () => body
  });
  const send = () => db.sendCareReminder({ recipientId: R, reason: "care", message: "加油" });

  it("says the reminder was already sent today", async () => {
    respond(409, { error: "care_reminder_already_sent" });
    const res = await send();
    expect(res.error.message).toBe("今天已提醒過這位了，明天可以再提醒。");
  });

  it("does not report a trigger/permission 42501 as an out-of-scope member", async () => {
    respond(400, { error: "care reminder audit fields are immutable", code: "42501" });
    const res = await send();
    expect(res.error.message).not.toContain("牧養範圍");
  });

  it("still reports a real scope rejection as out of scope", async () => {
    respond(403, { error: "pastoral_reminder_scope_required" });
    const res = await send();
    expect(res.error.message).toBe("此成員不在您的牧養範圍內");
  });
});

describe("openCareReminderDialog is read-only once today's reminder exists", () => {
  let dom, db;

  const loadDialog = () => {
    const start = planSrc.indexOf("window.openCareReminderDialog = async function");
    const endMatch = /\r?\n};\r?\n/.exec(planSrc.slice(start));
    const src = planSrc.slice(start, start + endMatch.index + endMatch[0].length);
    new Function("window", "document", "state", "db", "escapeHTML", "showToast", "hydrateIcons", src)(
      dom.window, dom.window.document, { activePlan: { presetKey: "p1" } }, db,
      (s) => String(s), () => {}, () => {}
    );
    return dom.window.openCareReminderDialog;
  };
  const member = { id: R, name: "小明", statusColor: "red", statusStr: "落後", completed: 3, isBehind: true };

  beforeEach(() => {
    dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
  });
  afterEach(() => dom.window.close());

  it("shows today's reminder without any way to edit or resend it, even while unread", async () => {
    db = {
      getTodayCareReminderFor: async () => ({ data: { id: "r1", reason: "care", message: "早上好", status: "unread" } }),
      sendCareReminder: vi.fn()
    };
    await loadDialog()(member);
    const doc = dom.window.document;
    expect(doc.getElementById("care-send-btn")).toBeNull();
    expect(doc.getElementById("care-msg-input").hasAttribute("readonly")).toBe(true);
    expect(doc.getElementById("care-msg-input").value).toBe("早上好");
    expect(doc.getElementById("care-existing-note").textContent).toContain("今天已提醒");
    expect(doc.body.textContent).not.toContain("修改");
  });

  it("locks the dialog after a successful send instead of offering an update", async () => {
    db = {
      getTodayCareReminderFor: async () => ({ data: null }),
      sendCareReminder: vi.fn(async () => ({ error: null, data: { id: "r2" } }))
    };
    await loadDialog()(member);
    const doc = dom.window.document;
    doc.getElementById("care-send-btn").click();
    await vi.waitFor(() => expect(db.sendCareReminder).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(doc.getElementById("care-send-btn")).toBeNull());
    expect(doc.getElementById("care-msg-input").hasAttribute("readonly")).toBe(true);
    expect(doc.body.textContent).not.toContain("更新關心內容");
  });
});
