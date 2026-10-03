// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// #415：主畫面 App 沒有網址列、不能重新整理，開機一卡住就只能刪 App。
// index.html 最上面的 #boot-watchdog 在「太久沒有開機進展」時蓋上保底畫面。

const html = readFileSync("index.html", "utf8");
const authSource = readFileSync("js/auth.js", "utf8");
const appSource = readFileSync("js/app.js", "utf8");
const dbSource = readFileSync("js/db.js", "utf8");

function watchdogSource() {
  const open = html.indexOf('<script id="boot-watchdog">');
  const start = html.indexOf(">", open) + 1;
  const end = html.indexOf("</script>", start);
  return html.slice(start, end);
}

function setupDom() {
  document.body.innerHTML = `
    <div class="app-layout hidden"></div>
    <div class="login-gate hidden" id="login-gate"></div>`;
  window.eval(watchdogSource());
}

function overlay() {
  return document.getElementById("boot-watchdog-overlay");
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  setupDom();
});

afterEach(() => {
  overlay()?.remove();
  vi.useRealTimers();
});

describe("boot watchdog placement", () => {
  it("runs before any external stylesheet or script so a stuck CDN cannot block it", () => {
    const watchdog = html.indexOf('<script id="boot-watchdog">');
    expect(watchdog).toBeGreaterThan(-1);
    const firstExternal = Math.min(
      ...[html.indexOf('rel="stylesheet"'), html.indexOf("<script src=")].filter(i => i >= 0)
    );
    expect(watchdog).toBeLessThan(firstExternal);
  });

  it("is the only definition of window.__bootMark (a later one would bypass the progress tracking)", () => {
    expect(html.match(/window\.__bootMark\s*=/g)).toHaveLength(1);
  });
});

describe("boot watchdog behaviour", () => {
  it("shows the fallback screen with the last boot step after 20s without progress", async () => {
    window.__bootMark("nlc-session-sync-start");
    await vi.advanceTimersByTimeAsync(19999);
    expect(overlay()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(overlay()).not.toBeNull();
    expect(document.getElementById("boot-watchdog-detail").textContent).toContain("nlc-session-sync-start");
    expect([...overlay().querySelectorAll("button")].map(b => b.textContent))
      .toEqual(["重新載入", "修復並重新載入", "重新登入"]);
  });

  it("restarts the countdown on every boot step, so a slow but progressing boot never shows it", async () => {
    for (const step of ["dom-content-loaded", "db-init-start", "auth-handle-callback-start", "auth-handle-callback-done"]) {
      await vi.advanceTimersByTimeAsync(15000);
      window.__bootMark(step);
    }
    expect(overlay()).toBeNull();
  });

  it("never shows once the app shell or the login card is visible", async () => {
    document.querySelector(".app-layout").classList.remove("hidden");
    window.__bootMark("app-shell-shown");
    await vi.advanceTimersByTimeAsync(60000);
    expect(overlay()).toBeNull();
  });

  it("does not show when the login card appeared without a boot step", async () => {
    document.getElementById("login-gate").classList.remove("hidden");
    await vi.advanceTimersByTimeAsync(60000);
    expect(overlay()).toBeNull();
  });

  it("removes itself when the app recovers on its own (e.g. a request timed out back to the login card)", async () => {
    await vi.advanceTimersByTimeAsync(20000);
    expect(overlay()).not.toBeNull();
    document.getElementById("login-gate").classList.remove("hidden");
    await vi.advanceTimersByTimeAsync(1000);
    expect(overlay()).toBeNull();
  });

  it("shows soon after a script fails to load while the app is still blank", async () => {
    const script = document.createElement("script");
    script.src = "https://example.test/app.abc123.js";
    document.head.appendChild(script);
    script.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(overlay()).not.toBeNull();
    expect(document.getElementById("boot-watchdog-detail").textContent).toContain("app.abc123.js");
  });

  it("includes the reported boot error in the detail line", async () => {
    window.__bootReportError(new Error("db.init exploded"));
    await vi.advanceTimersByTimeAsync(20000);
    expect(document.getElementById("boot-watchdog-detail").textContent).toContain("db.init exploded");
  });

  it("「重新登入」 clears login data only — reading progress and the identity snapshot stay", async () => {
    localStorage.setItem("nlc_access_token", "a");
    localStorage.setItem("nlc_refresh_token", "r");
    localStorage.setItem("nlc_edge_session_expires_at", "1");
    sessionStorage.setItem("nlc_auth_verifier", "v");
    localStorage.setItem("reading_logs", "[1]");
    localStorage.setItem("active_reading_plans", "[2]");
    localStorage.setItem("offline_trusted_identity", "{}");
    await vi.advanceTimersByTimeAsync(20000);
    const relogin = [...overlay().querySelectorAll("button")].find(b => b.textContent === "重新登入");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    relogin.click(); // jsdom 不支援導頁，只檢查清掉了什麼
    consoleError.mockRestore();
    expect(localStorage.getItem("nlc_access_token")).toBeNull();
    expect(localStorage.getItem("nlc_refresh_token")).toBeNull();
    expect(localStorage.getItem("nlc_edge_session_expires_at")).toBeNull();
    expect(sessionStorage.getItem("nlc_auth_verifier")).toBeNull();
    expect(localStorage.getItem("reading_logs")).toBe("[1]");
    expect(localStorage.getItem("active_reading_plans")).toBe("[2]");
    expect(localStorage.getItem("offline_trusted_identity")).toBe("{}");
  });

  it("「重新載入」 drops the one-time ?code&state instead of re-sending it", () => {
    const source = watchdogSource();
    expect(source).toContain("if (location.search) location.replace(location.pathname + location.hash);");
  });
});

describe("boot watchdog login-key list stays in sync with auth.js", () => {
  it("covers every key auth.js stores in auth.keys", () => {
    const keysBlock = authSource.slice(authSource.indexOf("keys: {"), authSource.indexOf("},", authSource.indexOf("keys: {")));
    const authKeys = [...keysBlock.matchAll(/:\s*"([^"]+)"/g)].map(m => m[1]);
    expect(authKeys.length).toBeGreaterThan(10);
    const source = watchdogSource();
    for (const key of authKeys) expect(source, key).toContain(`"${key}"`);
  });
});

describe("boot failure falls back to an actionable login card", () => {
  it("app.js shows the login card (retry mode when tokens remain) when db.init() throws", () => {
    const idx = appSource.indexOf("Failed to initialize database connection & auth");
    const body = appSource.slice(idx, idx + 500);
    expect(body).toContain("window.__bootReportError?.(err)");
    expect(body).toContain("db.showBootFailureGate()");
    const gate = dbSource.slice(dbSource.indexOf("  showBootFailureGate() {"), dbSource.indexOf("  bindLoginGateHubReturnSync() {"));
    expect(gate).toContain('reason: "member_context_unavailable"');
  });

  it("the nlc-session sync and nlc-data reads have timeouts; nlc-data writes do not", () => {
    expect(dbSource).toMatch(/fetchWithTimeout\(functionUrl, \{[\s\S]*?\}, BOOT_FETCH_TIMEOUT_MS\)/);
    expect(dbSource).toContain('const isReadRequest = !request.action || request.action === "select" || request.action === "batch";');
    expect(dbSource).toContain("? await fetchWithTimeout(url, init, DATA_READ_TIMEOUT_MS)");
    expect(dbSource).toContain(": await fetch(url, init);");
  });
});
