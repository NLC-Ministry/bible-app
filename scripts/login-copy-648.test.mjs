// #648：登入說詞統一
// - 動作只說「登入／登出」，東西只叫「帳號」，原因只說「登入過期了」；不用 NLC、SSO、身份、同步、正式帳號、失效。
// - 登入過期改用錯誤代碼判斷，不再比對畫面文字（改字不會讓「重新登入」按鈕消失）。
import { JSDOM } from "jsdom";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLoginGateView, getLoginGateCopy } from "../js/login-onboarding-gate.mjs";
import {
  AUTH_SESSION_EXPIRED_CODE,
  SESSION_EXPIRED_MESSAGE,
  createSessionExpiredError,
  isAuthExpiredError
} from "../js/copy/auth-messages.mjs";

const html = readFileSync("index.html", "utf8");
const loginCard = html.slice(html.indexOf('<div class="login-gate hidden" id="login-gate">'), html.indexOf("<!-- Verse Note Editor Mount Root"));

describe("login card wording (#648)", () => {
  it("the sign-in button just says 登入, and first-timers know to start here", () => {
    const copy = getLoginGateCopy(null, { hasTokens: false });
    expect(copy.button).toBe("登入");
    expect(copy.subtitle).toBe("跟弟兄姊妹一起速讀聖經。登入後，換手機也能接著讀。第一次使用也從這裡開始。");
    const dom = new JSDOM(`<!doctype html><body>${loginCard}</body>`);
    const doc = dom.window.document;
    expect(doc.getElementById("btn-gate-nlc-login").textContent.trim()).toBe("登入");
    expect(doc.getElementById("login-gate-subtitle").textContent).toBe(copy.subtitle);
    expect(doc.querySelector("[data-login-switch-account]").textContent).toBe("找不到以前的進度？換回上次的登入方式");
  });

  it("Member Hub screens don't name 會員中心 on the button, and say where it goes", () => {
    const register = getLoginGateCopy({ reason: "member_not_registered" }, { hasTokens: true });
    expect(register.title).toBe("請先到會員中心註冊");
    expect(register.subtitle).toBe("這個帳號還沒在教會的會員中心註冊。註冊好回到這裡就能開始。會開啟教會的會員頁面。");
    expect(register.button).toBe("去註冊");

    const other = getLoginGateCopy({ reason: "something_else" }, { hasTokens: true });
    expect(other.title).toBe("還有一步要完成");
    expect(other.subtitle).toBe("按下方按鈕繼續就好，不用重新註冊。");
    expect(other.button).toBe("繼續");
  });

  it("data temporarily unavailable: plain words, support code kept", () => {
    const copy = getLoginGateCopy({ reason: "member_context_unavailable" }, { hasTokens: true });
    expect(copy.title).toBe("正在確認會員資料");
    expect(copy.button).toBe("重新確認會員資料");
    expect(copy.subtitle).toBe("你已經登入了，只是資料一時讀不到。請再試一次，不用重新註冊。（代碼：MEMBER_CONTEXT_UNAVAILABLE）");
  });

  it("the switch-account link on the view keeps the new wording", () => {
    const dom = new JSDOM(`<!doctype html><body>${loginCard}<div class="app-layout"></div></body>`);
    const doc = dom.window.document;
    const loginGate = doc.getElementById("login-gate");
    applyLoginGateView({
      block: { reason: "member_not_registered" },
      hasTokens: true,
      loginGate,
      titleEl: loginGate.querySelector(".login-title"),
      subtitleEl: doc.getElementById("login-gate-subtitle"),
      buttonEl: doc.getElementById("btn-gate-nlc-login")
    });
    const link = doc.querySelector("[data-login-switch-account]");
    expect(link.classList.contains("hidden")).toBe(false);
    expect(link.textContent).toBe("找不到以前的進度？換回上次的登入方式");
  });
});

describe("session-expired error is recognised by its code (#648)", () => {
  it("one message, one code", () => {
    const err = createSessionExpiredError();
    expect(err.message).toBe("登入過期了，請再登入一次。讀經進度不會不見。");
    expect(err.message).toBe(SESSION_EXPIRED_MESSAGE);
    expect(err.code).toBe(AUTH_SESSION_EXPIRED_CODE);
    expect(isAuthExpiredError(err)).toBe(true);
  });

  it("server token rejections still count; wording alone doesn't", () => {
    expect(isAuthExpiredError({ message: "invalid_logto_token" })).toBe(true);
    expect(isAuthExpiredError({ error: "invalid_token" })).toBe(true);
    expect(isAuthExpiredError({ message: "profile_identity_not_found" })).toBe(true);
    expect(isAuthExpiredError({ message: "目前無法連線驗證登入狀態。" })).toBe(false);
    expect(isAuthExpiredError(null)).toBe(false);
  });

  it("auth.js throws the coded error when it gives up on the session", () => {
    const authSrc = readFileSync("js/auth.js", "utf8");
    expect(authSrc).toContain("throw createSessionExpiredError()");
    expect(authSrc).not.toContain("登入狀態已失效");
  });

  it("team registration decides 重新登入 from result.authExpired, not from the message text", () => {
    const src = readFileSync("js/modules/team-registration.js", "utf8");
    expect(src).toContain("const isAuthExpired = Boolean(result.authExpired);");
    expect(src).not.toMatch(/result\.message\.includes\(/);
  });
});

// 會友看得到的字（註解以外）不再出現這些說法。db.js 有些字串用 \u 跳脫寫，先解開再找。
const BANNED = ["正式帳號", "登入狀態已失效", "登入同步失敗", "NLC 身份", "(SSO)", "會員資料，請重新登入", "帳號資料暫時無法讀取"];

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(m?js)$/.test(name) ? [path] : [];
  });
}

function visibleLines(text) {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line));
}

describe("no leftover login jargon in what members see (#648)", () => {
  it("js/ and index.html", () => {
    const hits = [];
    for (const file of [...sourceFiles("js"), "index.html"]) {
      visibleLines(readFileSync(file, "utf8")).forEach((line, i) => {
        for (const word of BANNED) if (line.includes(word)) hits.push(`${file}:${i + 1} ${word}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe("db: coded session-expired errors reach the callers (#648)", () => {
  let dom, db;

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    dom = new JSDOM(`<!doctype html><body>${loginCard}<div class="app-layout"></div></body>`, { url: "https://example.test/" });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("localStorage", dom.window.localStorage);
    vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("location", dom.window.location);
    vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
    vi.stubGlobal("CHURCH_PLAN_PRESETS", {});
    vi.stubGlobal("getPresetKeyByName", () => null);
    vi.stubGlobal("auth", { isLoggedIn: () => false, getValidAccessToken: async () => { throw createSessionExpiredError(); } });
    dom.window.authLaunch = { startInteractiveAuth: vi.fn(() => true) };
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      supabase: { rpc: async () => { throw createSessionExpiredError(); } },
      currentUser: null,
      currentProfileId: null
    });
    await import("../js/db.js?login-copy-648");
    db = dom.window.db || globalThis.db;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dom.window.close();
  });

  it("team RPCs flag authExpired so the dialog offers 重新登入", async () => {
    const res = await db.getMyReadingTeam({ id: "11111111-1111-4111-8111-111111111111" });
    expect(res.success).toBe(false);
    expect(res.authExpired).toBe(true);
    expect(res.message).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("team RPCs: profile not found also counts, with the new wording", async () => {
    globalThis.state.supabase.rpc = async () => ({ data: null, error: { message: "profile_required" } });
    const res = await db.getMyReadingTeam({ id: "11111111-1111-4111-8111-111111111111" });
    expect(res.authExpired).toBe(true);
    expect(res.message).toBe("找不到你的帳號資料，請登出後再登入一次。");
  });

  it("exam RPCs flag authExpired", async () => {
    const res = await db._callExamRpc("exam_get_paper_admin", {});
    expect(res.authExpired).toBe(true);
    expect(res.message).toBe("登入過期了，請再登入一次就能繼續。");
  });

  it("the second session loss shows the shared message under the sign-in button", () => {
    db.showSessionLostGate();
    expect(dom.window.document.getElementById("gate-status-text").textContent).toBe(SESSION_EXPIRED_MESSAGE);
  });
});
