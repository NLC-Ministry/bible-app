// @vitest-environment jsdom
// 照搬的舊管理區塊（#550）外殼這一端：iframe 通道（token、匯出前稽核、換區、主題）與「內容」區的畫面。
// iframe 那一端（admin-legacy/）在 scripts/admin-legacy.test.mjs。
import { afterEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminApp } from "../src/App.tsx";
import { AdminApiError, createAdminApi } from "../src/api.ts";
import type { AdminAuth } from "../src/auth.ts";
import { IFRAME_ACTIVITY_EVENT } from "../src/idle.ts";
import { areaTabs } from "../src/tabs.ts";
import {
  LEGACY_HELLO,
  LEGACY_INIT,
  MAX_LEGACY_EXPORT_BYTES,
  safeExportFilename,
  startLegacyHost,
  unavailableHint,
  type LegacyHostOptions
} from "../src/legacy.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ORIGIN = "https://bible-speed-reading-admin.vercel.app";

type Posted = { message: any; origin?: string; transfer?: unknown[] };

function fakePort() {
  const port = {
    sent: [] as any[],
    closed: false,
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage(message: unknown) { port.sent.push(message); },
    close() { port.closed = true; },
    receive(data: unknown) { port.onmessage?.({ data } as MessageEvent); }
  };
  return port;
}

function setup(overrides: Partial<LegacyHostOptions> = {}) {
  const win = new EventTarget() as EventTarget & { location: { origin: string } };
  win.location = { origin: ORIGIN };
  const framePosts: Posted[] = [];
  const frame = { postMessage: (message: unknown, origin: string, transfer: unknown[]) => framePosts.push({ message, origin, transfer }) };
  const channels: { port1: ReturnType<typeof fakePort>; port2: { id: number } }[] = [];
  const audits: unknown[] = [];
  const saved: { blob: Blob; filename: string }[] = [];
  const events = { ready: 0, sections: [] as [string, boolean][], errors: [] as string[], login: 0, activity: 0 };
  let token: string | null = "access-token";
  const options: LegacyHostOptions = {
    win: win as unknown as Window,
    frameWindow: () => frame as unknown as Window,
    initial: () => ({ section: "exam", theme: "dark", plan: "plan-1" }),
    getToken: () => token,
    getIdToken: () => "id-token",
    auditExport: vi.fn(async (file) => { audits.push(file); return 1; }),
    saveFile: (blob, filename) => saved.push({ blob, filename }),
    describeError: (err) => (err instanceof Error ? `錯誤：${err.message}` : "錯誤"),
    createChannel: () => {
      const channel = { port1: fakePort(), port2: { id: channels.length + 1 } };
      channels.push(channel);
      return channel;
    },
    onReady: () => { events.ready += 1; },
    onSection: (section, available) => { events.sections.push([section, available]); },
    onError: (code) => { events.errors.push(code); },
    onLoginRequired: () => { events.login += 1; },
    onActivity: () => { events.activity += 1; },
    ...overrides
  };
  const host = startLegacyHost(options);
  const hello = (source: unknown = frame, origin = ORIGIN, data: unknown = { type: LEGACY_HELLO }) => {
    const event = new MessageEvent("message", { data, origin });
    Object.defineProperty(event, "source", { value: source });
    win.dispatchEvent(event);
  };
  return {
    host, win, frame, framePosts, channels, audits, saved, events, options, hello,
    setToken: (value: string | null) => { token = value; },
    port: () => channels.at(-1)!.port1
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startLegacyHost (iframe channel)", () => {
  it("answers only its own iframe's hello, on this origin, with a private channel", () => {
    const t = setup();
    t.hello({ postMessage() {} });
    t.hello(t.frame, "https://evil.example");
    t.hello(t.frame, ORIGIN, { type: "something-else" });
    expect(t.framePosts).toEqual([]);
    t.hello();
    expect(t.framePosts).toEqual([{
      message: { type: LEGACY_INIT, section: "exam", theme: "dark", plan: "plan-1" },
      origin: ORIGIN,
      transfer: [t.channels[0].port2]
    }]);
  });

  it("hands out the in-memory tokens; none when the console's login expired", () => {
    const t = setup();
    t.hello();
    t.port().receive({ type: "token", id: 1 });
    expect(t.port().sent.at(-1)).toEqual({ ok: true, token: "access-token", idToken: "id-token", replyTo: 1 });
    t.setToken(null);
    t.port().receive({ type: "token", id: 2 });
    expect(t.port().sent.at(-1)).toEqual({ ok: false, error: "session_expired", replyTo: 2 });
  });

  it("records the audit before saving; no audit, no file", async () => {
    const t = setup();
    t.hello();
    const blob = new Blob(["a,b\r\n1,2"], { type: "text/csv" });
    t.port().receive({ type: "export", id: 7, blob, filename: "exam/第一次:作答明細.csv", format: "csv", rows: 1, section: "exam" });
    await flush();
    expect(t.audits).toEqual([{ section: "exam", filename: "exam_第一次_作答明細.csv", format: "csv", rows: 1, bytes: blob.size }]);
    expect(t.saved).toEqual([{ blob, filename: "exam_第一次_作答明細.csv" }]);
    expect(t.port().sent.at(-1)).toEqual({ ok: true, replyTo: 7 });

    const failing = setup({ auditExport: vi.fn(async () => { throw new Error("稽核寫不進去"); }) });
    failing.hello();
    failing.port().receive({ type: "export", id: 8, blob, filename: "x.csv", format: "csv", rows: 1, section: "quizzes" });
    await flush();
    expect(failing.saved).toEqual([]);
    expect(failing.port().sent.at(-1)).toEqual({ ok: false, message: "錯誤：稽核寫不進去", replyTo: 8 });
  });

  it("uploads a lightning-quiz image through admin-api and answers with the file name (#585)", async () => {
    const uploadQuizImage = vi.fn(async () => ({ name: "3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f.webp", w: 1600, h: 900 }));
    const t = setup({ uploadQuizImage });
    t.hello();
    t.port().receive({ type: "quiz_image_upload", id: 3, image: { mime: "image/webp", base64: "AAAA", w: 1600, h: 900 } });
    await flush();
    expect(uploadQuizImage).toHaveBeenCalledWith({ mime: "image/webp", base64: "AAAA", w: 1600, h: 900 });
    expect(t.port().sent.at(-1)).toEqual({ ok: true, name: "3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f.webp", replyTo: 3 });

    t.port().receive({ type: "quiz_image_upload", id: 4, image: { mime: "image/svg+xml", base64: "AAAA" } });
    await flush();
    expect(uploadQuizImage).toHaveBeenCalledTimes(1);
    expect(t.port().sent.at(-1)).toMatchObject({ ok: false, replyTo: 4 });

    const failing = setup({ uploadQuizImage: vi.fn(async () => { throw new Error("太大"); }) });
    failing.hello();
    failing.port().receive({ type: "quiz_image_upload", id: 5, image: { mime: "image/png", base64: "AAAA" } });
    await flush();
    expect(failing.port().sent.at(-1)).toEqual({ ok: false, message: "錯誤：太大", replyTo: 5 });
  });

  it("refuses files it cannot recognise without asking admin-api", async () => {
    const t = setup();
    t.hello();
    t.port().receive({ type: "export", id: 1, blob: null, filename: "x.csv", section: "exam" });
    t.port().receive({ type: "export", id: 2, blob: new Blob(["x"]), filename: "x.csv", section: "users" });
    t.port().receive({ type: "export", id: 3, blob: { size: 1 }, filename: "x.csv", section: "exam" });
    const huge = new Blob(["x"]);
    Object.defineProperty(huge, "size", { value: MAX_LEGACY_EXPORT_BYTES + 1 });
    t.port().receive({ type: "export", id: 4, blob: huge, filename: "x.csv", section: "exam" });
    await flush();
    expect(t.options.auditExport).not.toHaveBeenCalled();
    expect(t.saved).toEqual([]);
    expect(t.port().sent.map((m: any) => [m.replyTo, m.ok])).toEqual([[1, false], [2, false], [3, false], [4, false]]);
  });

  it("guesses txt vs csv from the name and drops a bogus row count", async () => {
    const t = setup();
    t.hello();
    t.port().receive({ type: "export", id: 1, blob: new Blob(["x"]), filename: "exam_簡答.txt", rows: -3, section: "exam" });
    await flush();
    expect(t.audits).toEqual([expect.objectContaining({ format: "txt", rows: null, filename: "exam_簡答.txt" })]);
    expect(safeExportFilename("  ..\u0000 ", "公告.csv")).toBe("公告.csv");
    expect(safeExportFilename("a<b>|c?.csv", "x")).toBe("a_b__c_.csv");
  });

  it("passes on ready, section, error, login and activity; opens sections and themes on the current channel", () => {
    const t = setup();
    t.hello();
    const port = t.port();
    port.receive({ type: "ready" });
    port.receive({ type: "section", section: "quizzes", available: false });
    port.receive({ type: "section", section: "exam", available: true });
    port.receive({ type: "error", code: "boot_failed" });
    port.receive({ type: "error" });
    port.receive({ type: "login_required" });
    port.receive({ type: "activity" });
    expect(t.events).toEqual({ ready: 1, sections: [["quizzes", false], ["exam", true]], errors: ["boot_failed", "boot_failed"], login: 1, activity: 1 });
    t.host.open("commentary");
    t.host.setTheme("warm");
    // 計畫（#620）：外框的計畫選單換了就告訴 iframe；null＝外框沒有計畫可給，iframe 用自己的計畫篩選
    t.host.setPlan("plan-2");
    t.host.setPlan(null);
    expect(port.sent.slice(-4)).toEqual([
      { type: "open", section: "commentary" },
      { type: "theme", theme: "warm" },
      { type: "plan", plan: "plan-2" },
      { type: "plan", plan: null }
    ]);
  });

  it("re-handshakes when the iframe reloads and ignores the old channel", () => {
    const t = setup();
    t.hello();
    const first = t.port();
    t.hello();
    const second = t.port();
    expect(first).not.toBe(second);
    expect(first.closed).toBe(true);
    first.receive({ type: "ready" });
    expect(t.events.ready).toBe(0);
    second.receive({ type: "ready" });
    expect(t.events.ready).toBe(1);
    t.host.stop();
    expect(second.closed).toBe(true);
    t.hello();
    expect(t.channels.length).toBe(2);
  });
});

// ── 「內容」區的畫面 ────────────────────────────────────────────────────────
let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  window.location.hash = "";
});

async function mount(hash: string, capabilities: string[]) {
  window.location.hash = hash;
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const { action } = JSON.parse(String(init.body));
    if (action === "bootstrap") {
      return new Response(JSON.stringify({ data: { me: { id: "me", name: "管理員" }, capabilities, org: [] }, request_id: "srv" }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { items: [], counts: { unread: 0 } }, request_id: "srv" }), { status: 200 });
  });
  const api = createAdminApi({ url: "https://api.test/admin-api", getToken: () => "token-in-memory", fetchImpl });
  const auth: AdminAuth = {
    init: vi.fn(async () => ({ status: "signed_in" as const })),
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    getToken: () => "token-in-memory",
    getIdToken: () => null
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<AdminApp auth={auth} api={api} environment="staging" win={window} />); });
  await act(async () => { await flush(); });
  return { el: container, fetchImpl, auth };
}

async function go(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await flush();
  });
}

const CONTENT_CAPS = ["console.access", "support.read", "export", "content.manage"];
const OPERATIONS_CAPS = ["console.access", "support.read", "export", "operations.manage"];

describe("legacy tabs in the plan area", () => {
  it("moves 組隊狀況 to the plan area's last tab; old operations bookmarks open it (#569)", async () => {
    const { el, fetchImpl } = await mount("#/operations", [...OPERATIONS_CAPS, "plans.read"]);
    const frame = el.querySelector("iframe.adm-legacy__frame") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/legacy");
    expect(frame.title).toBe("組隊狀況管理");
    const tabs = [...el.querySelectorAll(".adm-legacy__tabs a")];
    expect(tabs.map((a) => a.textContent)).toEqual(["總覽", "名單", "團隊", "計畫設定", "組隊狀況"]);
    expect(tabs[4].getAttribute("aria-current")).toBe("page");
    expect(tabs[4].getAttribute("href")).toBe("#/plans/team-status");
    expect(el.querySelector(".adm-nav__link[aria-current='page']")?.textContent).toBe("計畫");
    // 選單沒有「營運」了
    expect([...el.querySelectorAll(".adm-nav__link")].map((a) => a.textContent)).not.toContain("營運");
    // 照搬區的資料由 iframe 走 nlc-data；外框只拿計畫選單的清單（#620，組隊狀況用外框的計畫選單）
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init.body)).action)).toEqual(["bootstrap", "plan_options"]);
    // 舊書籤到報表區（沒有 stats.read 就是沒有權限，不會打開 iframe 的舊頁）
    await go("#/operations/registrations");
    expect(el.textContent).toContain("沒有權限");
    expect(frame.title).toBe("組隊狀況管理");
  });

  it("opens the plan card as the plan area's settings tab, next to the native tabs (#565)", async () => {
    const { el, fetchImpl } = await mount("#/plans/settings", [...OPERATIONS_CAPS, "plans.read"]);
    const frame = el.querySelector("iframe.adm-legacy__frame") as HTMLIFrameElement;
    expect(frame.title).toBe("計畫設定管理");
    const tabs = [...el.querySelectorAll(".adm-legacy__tabs a")];
    expect(tabs.map((a) => a.textContent)).toEqual(["總覽", "名單", "團隊", "計畫設定", "組隊狀況"]);
    expect(tabs[3].getAttribute("aria-current")).toBe("page");
    expect(tabs[1].getAttribute("href")).toBe("#/plans/roster");
    expect(el.querySelector(".adm-nav__link[aria-current='page']")?.textContent).toBe("計畫");
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init.body)).action)).toEqual(["bootstrap"]);
    // 舊書籤 #/operations/plans 也到這裡
    await go("#/operations/plans");
    expect(el.querySelector(".adm-legacy__tabs a[aria-current='page']")?.textContent).toBe("計畫設定");
  });

  it("hides the settings and 組隊狀況 tabs without operations.manage", async () => {
    const { el } = await mount("#/plans/settings", ["console.access", "plans.read"]);
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.textContent).toContain("沒有權限");
    await go("#/plans/team-status");
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.textContent).toContain("沒有權限");
  });

  it("shares one iframe with the quiz area", async () => {
    const { el } = await mount("#/quiz/exam", [...OPERATIONS_CAPS, "plans.read", "content.manage"]);
    const frame = el.querySelector("iframe.adm-legacy__frame");
    await go("#/plans/team-status");
    expect(el.querySelectorAll("iframe.adm-legacy__frame")).toHaveLength(1);
    expect(el.querySelector("iframe.adm-legacy__frame")).toBe(frame);
    expect((frame as HTMLIFrameElement).title).toBe("組隊狀況管理");
    expect([...el.querySelectorAll(".adm-legacy__tabs a")].map((a) => a.textContent)).not.toContain("大測驗");
  });

  it("is blocked without plans.read and operations.manage; no more \"moving\" placeholders", async () => {
    const { el } = await mount("#/operations/teams", ["console.access", "support.read", "content.manage"]);
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.textContent).toContain("沒有權限");
    const links = [...el.querySelectorAll(".adm-nav__link")].map((a) => a.textContent);
    // 有 support.read 就看得到人區（個人頁，#567）；有 content.manage 就看得到測驗區（#619）
    expect(links).toEqual(["首頁", "測驗", "人", "回報收件匣", "內容"]);
    expect(el.textContent).not.toContain("搬移中");
  });

  it("lights only the tab that is open: 團隊 and 組隊狀況 no longer share an id (#583)", async () => {
    for (const area of ["plans", "quiz", "stats", "people", "content", "system"] as const) {
      const ids = areaTabs(area).map((tab) => tab.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const { el } = await mount("#/plans/team-status", [...OPERATIONS_CAPS, "plans.read"]);
    const lit = () => [...el.querySelectorAll(".adm-tabs a[aria-current='page']")]
      .filter((a) => !a.closest("[hidden]"))
      .map((a) => a.textContent);
    expect(lit()).toEqual(["組隊狀況"]);
    await go("#/plans/teams");
    expect(lit()).toEqual(["團隊"]);
  });

  it("explains why a section is not available", () => {
    expect(unavailableHint("exam")).toContain("功能開放設定");
    expect(unavailableHint("quizzes")).toContain("功能開放設定");
    expect(unavailableHint("join-status")).toContain("角色");
    expect(unavailableHint("plans")).toContain("角色");
  });
});

describe("content and quiz areas", () => {
  it("shows the legacy page in an iframe with one tab per section; the quizzes have their own area (#619)", async () => {
    const { el, fetchImpl } = await mount("#/quiz/exam", CONTENT_CAPS);
    const frame = el.querySelector("iframe.adm-legacy__frame") as HTMLIFrameElement;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("src")).toBe("/legacy");
    expect(frame.title).toBe("大測驗管理");
    // 沒有 plans.read：看不到測驗區的總覽，只有三種測驗
    const tabs = [...el.querySelectorAll(".adm-legacy__tabs a")];
    expect(tabs.map((a) => a.textContent)).toEqual(["小測驗", "大測驗", "雲柱測驗"]);
    expect(tabs.map((a) => a.getAttribute("href"))).toEqual(["#/quiz/quizzes", "#/quiz/exam", "#/quiz/lightning-quiz"]);
    expect(tabs[1].getAttribute("aria-current")).toBe("page");
    expect(el.querySelector(".adm-nav__link[aria-current='page']")?.textContent).toBe("測驗");
    expect(el.querySelector(".adm-app")?.classList.contains("adm-app--legacy")).toBe(true);
    // 「內容」區不打 admin-api（資料由 iframe 照舊走 nlc-data），只有開後台的 bootstrap
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init.body)).action)).toEqual(["bootstrap"]);
  });

  it("keeps the same iframe when leaving and coming back (no second boot)", async () => {
    const { el } = await mount("#/content", CONTENT_CAPS);
    const frame = el.querySelector("iframe.adm-legacy__frame");
    expect(el.querySelector(".adm-legacy__tabs a[aria-current='page']")?.textContent).toBe("公告");
    await go("#/support");
    expect(el.querySelector(".adm-legacy")?.hasAttribute("hidden")).toBe(true);
    expect(el.querySelector(".adm-app")?.classList.contains("adm-app--legacy")).toBe(false);
    await go("#/quiz/quizzes");
    expect(el.querySelector("iframe.adm-legacy__frame")).toBe(frame);
    expect(el.querySelector(".adm-legacy")?.hasAttribute("hidden")).toBe(false);
    expect(el.querySelector(".adm-legacy__tabs a[aria-current='page']")?.textContent).toBe("小測驗");
  });

  it("content keeps only 公告 and 經文注釋; old content quiz addresses open the quiz area (#619)", async () => {
    const { el } = await mount("#/content/commentary", CONTENT_CAPS);
    expect([...el.querySelectorAll(".adm-legacy__tabs a")].map((a) => a.textContent)).toEqual(["公告", "經文注釋"]);
    await go("#/content/lightning-quiz");
    expect(el.querySelector(".adm-legacy__tabs a[aria-current='page']")?.textContent).toBe("雲柱測驗");
    expect(el.querySelector(".adm-nav__link[aria-current='page']")?.textContent).toBe("測驗");
  });

  it("the menu lists the open area's tabs underneath it, and only that area's (#619)", async () => {
    const { el } = await mount("#/quiz/exam", [...CONTENT_CAPS, "plans.read"]);
    const sub = () => [...el.querySelectorAll(".adm-nav__sub a")];
    const owner = () => el.querySelector(".adm-nav__sub")?.closest("li")?.querySelector(".adm-nav__link")?.textContent;
    expect(sub().map((a) => a.textContent)).toEqual(["總覽", "小測驗", "大測驗", "雲柱測驗"]);
    expect(sub().map((a) => a.getAttribute("href"))).toEqual(["#/quiz", "#/quiz/quizzes", "#/quiz/exam", "#/quiz/lightning-quiz"]);
    expect(sub().filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent)).toEqual(["大測驗"]);
    expect(owner()).toBe("測驗");
    await go("#/content/commentary");
    expect(sub().map((a) => a.textContent)).toEqual(["公告", "經文注釋"]);
    expect(owner()).toBe("內容");
    // 沒有分頁的區不展開
    await go("#/support");
    expect(sub()).toEqual([]);
  });

  it("is hidden from the menu and blocked without content.manage", async () => {
    const { el } = await mount("#/content/commentary", ["console.access", "support.read"]);
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.textContent).toContain("沒有權限");
    const links = [...el.querySelectorAll(".adm-nav__link")].map((a) => a.textContent);
    expect(links).not.toContain("內容");
    expect(links).not.toContain("測驗");
  });

  it("forwards iframe activity to the idle timer as a window event", async () => {
    const seen = vi.fn();
    window.addEventListener(IFRAME_ACTIVITY_EVENT, seen);
    const t = setup({ onActivity: () => window.dispatchEvent(new Event(IFRAME_ACTIVITY_EVENT)) });
    t.hello();
    t.port().receive({ type: "activity" });
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener(IFRAME_ACTIVITY_EVENT, seen);
  });

  it("explains admin-api audit failures in Chinese", async () => {
    const t = setup({
      auditExport: async () => { throw new AdminApiError(429, "rate_limited", "req-1", 120); },
      describeError: (await import("../src/api.ts")).describeAdminError
    });
    t.hello();
    t.port().receive({ type: "export", id: 1, blob: new Blob(["x"]), filename: "a.csv", section: "exam" });
    await flush();
    expect(t.port().sent.at(-1)).toEqual({ ok: false, message: "操作太頻繁，請 2 分鐘後再試。", replyTo: 1 });
  });
});
