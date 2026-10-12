// 後台「照搬」的舊管理區塊（#550）：iframe 頁（admin-legacy/）的建置、通道、匯出稽核、清單一致。
// 外殼那一端（admin/src/legacy.ts、LegacyHost.tsx）在 admin/__tests__/legacy.test.tsx。
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  assertLegacyCspAllows,
  extractLegacyMarkup,
  listInlineHandlers,
  readLegacyCsp,
  resolveAdminConfig,
  resolveLegacyConfig,
  stripInlineHandlers
} from "./build-admin.mjs";
import { LEGACY_HOSTED_CARDS, LEGACY_SECTION_IDS, legacyMarkupId } from "../admin-legacy/sections.mjs";
import { countCsvRecords, dataUrlToBlob, installExportGuard } from "../admin-legacy/export-guard.mjs";
import { createBridge, forwardActivity, waitForBridge } from "../admin-legacy/bridge.mjs";
import { createMemoryStorage, installMemoryStorage } from "../admin-legacy/memory-storage.mjs";
import { LEGACY_AUTH_KEYS, createLegacyAuth } from "../admin-legacy/legacy-auth.mjs";
import { LEGACY_SECTIONS } from "../admin/src/legacy.ts";
import { NAV_ITEMS } from "../admin/src/nav.ts";
import {
  ADMIN_ACTIONS,
  CAPABILITIES,
  LEGACY_EXPORT_SECTIONS,
  capabilitiesForRole,
  legacySectionCapability
} from "../supabase/functions/admin-api/policy.ts";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const root = new URL("..", import.meta.url);
const rootPath = decodeURIComponent(root.pathname).replace(/^\/([A-Za-z]:)/, "$1");
const STAGING_API = "https://dbtjsljrytzonjvclgrd.supabase.co/functions/v1/admin-api";
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

describe("one list of legacy sections everywhere", () => {
  const adminJs = read("js/modules/admin.js");
  const appSectionIds = [...adminJs.matchAll(/\{ id: '([a-z-]+)',\s+group:/g)].map((m) => m[1]);

  it("matches between the iframe, the console, admin-api and the App's admin tab", () => {
    expect(appSectionIds.length).toBeGreaterThan(10);
    expect([...LEGACY_SECTION_IDS]).toEqual(LEGACY_SECTIONS.map((section) => section.id));
    expect(Object.keys(LEGACY_EXPORT_SECTIONS)).toEqual([...LEGACY_SECTION_IDS]);
    for (const id of LEGACY_SECTION_IDS) {
      // 搬進來的卡片不是管理分頁的區塊；其他一定是
      if (Object.hasOwn(LEGACY_HOSTED_CARDS, id)) expect(appSectionIds, id).not.toContain(id);
      else expect(appSectionIds, id).toContain(id);
    }
    for (const id of Object.keys(LEGACY_HOSTED_CARDS)) expect(LEGACY_SECTION_IDS, id).toContain(id);
  });

  it("hosts the plan card the App shows only to the system administrator (#550)", () => {
    expect(LEGACY_HOSTED_CARDS).toEqual({ plans: "admin-plan-card" });
    // App 端：讀經計畫分頁只對 admin 角色打開這張卡、只對 admin 載入 plan-admin.js
    expect(read("js/modules/plan.js")).toMatch(/const isSystemAdmin = getUserRoleCode\(state\.currentUser\) === "admin";\s+const adminCard = document\.getElementById\("admin-plan-card"\);/);
    expect(read("js/app.js")).toMatch(/getUserRoleCode\(state\.currentUser\) === 'admin'\) \{\s+await loadModule\('campaign-rule-editor'\);\s+await loadModule\('plan-admin'\);/);
    // iframe 端：同樣只給 admin 打開，程式就是 plan-admin.js
    const entry = read("admin-legacy/legacy-entry.js");
    expect(entry).toContain('window.getUserRoleCode(window.state.currentUser) === "admin"');
    expect(entry).toContain('import("../js/modules/plan-admin.js")');
  });

  it("needs the same capability in the console and in admin-api, and only the admin has it", () => {
    for (const section of LEGACY_SECTIONS) {
      expect(LEGACY_EXPORT_SECTIONS[section.id], section.id).toBe(section.capability);
      expect(CAPABILITIES, section.id).toContain(section.capability);
      // 這一區的導覽要這個能力（營運、內容區直接要；系統區有其中一個就顯示）
      const nav = NAV_ITEMS.find((item) => item.area === section.area);
      expect([...(nav?.requires || []), ...(nav?.anyOf || [])], section.id).toContain(section.capability);
    }
    for (const capability of ["operations.manage", "content.manage", "settings.manage"]) {
      expect(capabilitiesForRole("admin")).toContain(capability);
      for (const role of ["pastor", "great_zone_leader", "zone_leader", "group_leader", "member"]) {
        expect(capabilitiesForRole(role)).not.toContain(capability);
      }
    }
  });

  it("finds every section's panel in index.html (the markup the iframe copies)", () => {
    const markup = extractLegacyMarkup(read("index.html"));
    for (const id of LEGACY_SECTION_IDS) expect(markup, id).toContain(`id="${legacyMarkupId(id)}"`);
    expect(legacyMarkupId("plans")).toBe("admin-plan-card");
    expect(legacyMarkupId("join-status")).toBe("admin-section-join-status");
  });
});

describe("legacy page build helpers", () => {
  it("copies the body without scripts or inline event handlers, keeping ids, classes and styles", () => {
    const html = `<html><head><script>bad()</script></head><body class="x">
      <!-- <button onclick="old()"> -->
      <div id="admin-view" style="display:none" data-note="onclick=nothing">
        <button type="button" onclick="go('a > b')" class="primary-btn">Go</button>
        <img src="x.png" onerror='boom()' alt="">
        <input oninput=live value="1">
      </div>
      <script src="/app.js"></script><script>inline()</script>
    </body></html>`;
    const markup = extractLegacyMarkup(html);
    expect(markup).not.toMatch(/<script/i);
    expect(listInlineHandlers(markup)).toEqual([]);
    expect(markup).toContain('id="admin-view" style="display:none" data-note="onclick=nothing"');
    expect(markup).toContain('<button type="button"  class="primary-btn">Go</button>');
    expect(markup).toContain("<!-- <button onclick=\"old()\"> -->");
    expect(listInlineHandlers(html).sort()).toEqual(["onclick", "onerror", "oninput"]);
    expect(stripInlineHandlers('<a href="#" ONCLICK="x()">y</a>')).toBe('<a href="#" >y</a>');
  });

  it("real index.html: nothing the CSP would block is left", () => {
    const markup = extractLegacyMarkup(read("index.html"));
    expect(listInlineHandlers(markup)).toEqual([]);
    expect(markup).not.toMatch(/<script/i);
    expect(markup).toContain('id="admin-section-content"');
  });

  it("derives the Supabase URL from ADMIN_API_URL and requires the anon key outside local builds", () => {
    const config = resolveAdminConfig({ ADMIN_LOGTO_CLIENT_ID: "c", ADMIN_API_URL: STAGING_API });
    expect(resolveLegacyConfig({ SUPABASE_ANON_KEY: "anon" }, config)).toEqual({
      supabaseUrl: "https://dbtjsljrytzonjvclgrd.supabase.co",
      anonKey: "anon",
      memberHubUrl: "https://member.newlife.org.tw",
      issuer: config.issuer,
      resource: config.resource
    });
    expect(() => resolveLegacyConfig({}, config)).toThrow(/SUPABASE_ANON_KEY/);
    expect(() => resolveLegacyConfig({ SUPABASE_ANON_KEY: "a", SUPABASE_URL: "https://ztozevcqkfrohgjmngcj.supabase.co" }, config))
      .toThrow(/different Supabase projects/);
    expect(() => resolveLegacyConfig({ SUPABASE_ANON_KEY: "a", NLC_MEMBER_HUB_URL: "http://member.test" }, config)).toThrow(/https/);
    const local = resolveAdminConfig({ ADMIN_LOGTO_CLIENT_ID: "c", ADMIN_API_URL: "http://127.0.0.1:54321/functions/v1/admin-api" });
    expect(resolveLegacyConfig({}, local).anonKey).toBe("");
  });

  it("checks the legacy CSP lets the iframe reach Supabase and Chart.js", () => {
    const csp = readLegacyCsp(rootPath);
    const config = resolveAdminConfig({ ADMIN_LOGTO_CLIENT_ID: "c", ADMIN_API_URL: STAGING_API });
    expect(() => assertLegacyCspAllows(csp, resolveLegacyConfig({ SUPABASE_ANON_KEY: "a" }, config))).not.toThrow();
    expect(() => assertLegacyCspAllows(csp, { supabaseUrl: "https://other.supabase.co" })).toThrow(/connect-src https:\/\/other\.supabase\.co/);
    expect(() => assertLegacyCspAllows("script-src 'self'; connect-src https://dbtjsljrytzonjvclgrd.supabase.co", { supabaseUrl: "https://dbtjsljrytzonjvclgrd.supabase.co" }))
      .toThrow(/chart\.js/);
  });

  it("the Chart.js URL in the CSP is the exact one the App loads", () => {
    const appChartUrls = [...read("js/modules/chart-loader.mjs").matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@[^"'`\s]+/g)].map((m) => m[0]);
    expect(appChartUrls.length).toBeGreaterThan(0);
    for (const url of appChartUrls) expect(readLegacyCsp(rootPath)).toContain(url);
  });
});

describe("iframe runtime", () => {
  const makeWindow = (url = "https://bible-speed-reading-admin.vercel.app/legacy") => new JSDOM("<!doctype html><body></body>", { url }).window;

  it("keeps localStorage and sessionStorage in memory only", () => {
    const win = makeWindow();
    win.localStorage.setItem("before", "1");
    installMemoryStorage(win);
    expect(win.localStorage.getItem("before")).toBeNull();
    win.localStorage.setItem("nlc_supabase_profile", "{}");
    win.sessionStorage.setItem("selected_admin_section", "exam");
    expect(win.localStorage.getItem("nlc_supabase_profile")).toBe("{}");
    expect(win.localStorage.length).toBe(1);
    expect(win.localStorage.key(0)).toBe("nlc_supabase_profile");
    expect(win.sessionStorage.getItem("selected_admin_section")).toBe("exam");
    expect(win.indexedDB).toBeUndefined();
    const storage = createMemoryStorage();
    storage.setItem(1, 2);
    expect(storage.getItem("1")).toBe("2");
    storage.clear();
    expect(storage.length).toBe(0);
  });

  it("counts CSV records, including quoted line breaks, without the header", () => {
    expect(countCsvRecords("﻿\"a\",\"b\"\r\n\"1\",\"line\nbreak\"\r\n\"2\",\"x\"\r\n")).toBe(2);
    expect(countCsvRecords("a,b")).toBe(0);
    expect(countCsvRecords("")).toBe(0);
  });

  it("turns data: URLs into Blobs", async () => {
    const win = makeWindow();
    expect(await dataUrlToBlob(win, "data:text/csv;charset=utf-8,a%2Cb").text()).toBe("a,b");
    expect(await dataUrlToBlob(win, `data:text/plain;base64,${Buffer.from("hi").toString("base64")}`).text()).toBe("hi");
    expect(dataUrlToBlob(win, "https://evil.example/x.csv")).toBeNull();
  });

  it("stops every download and hands the file over instead (even after revokeObjectURL)", async () => {
    const win = makeWindow();
    let counter = 0;
    win.URL.createObjectURL = vi.fn(() => `blob:https://bible-speed-reading-admin.vercel.app/${++counter}`);
    win.URL.revokeObjectURL = vi.fn();
    const exports = [];
    const guard = installExportGuard(win, (file) => exports.push(file));

    // App 的寫法：建 Blob → createObjectURL → <a download>.click() → 馬上 revoke
    const blob = new win.Blob(["﻿\"標題\"\r\n\"1\""], { type: "text/csv;charset=utf-8" });
    const url = win.URL.createObjectURL(blob);
    const link = win.document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "daily_quiz_results_2026-10-12.csv");
    win.document.body.appendChild(link);
    link.click();
    win.URL.revokeObjectURL(url);
    // exam.js 的寫法：a.download = …、沒放進畫面
    const exam = win.document.createElement("a");
    exam.href = win.URL.createObjectURL(new win.Blob(["x"], { type: "text/plain" }));
    exam.download = "exam_第一次.txt";
    exam.click();

    expect(exports.map((file) => file.filename)).toEqual(["daily_quiz_results_2026-10-12.csv", "exam_第一次.txt"]);
    expect(exports[0].blob).toBe(blob);
    expect(await exports[1].blob.text()).toBe("x");

    // 認不得的內容也不放行：交出去時 blob 是 null（外殼會拒絕）
    const unknown = win.document.createElement("a");
    unknown.setAttribute("href", "https://evil.example/x.csv");
    unknown.setAttribute("download", "x.csv");
    unknown.click();
    expect(exports.at(-1)).toEqual({ blob: null, filename: "x.csv" });

    // 使用者直接點畫面上的 <a download>
    const visible = win.document.createElement("a");
    visible.setAttribute("href", win.URL.createObjectURL(new win.Blob(["v"])));
    visible.setAttribute("download", "visible.csv");
    visible.textContent = "下載";
    win.document.body.appendChild(visible);
    const event = new win.MouseEvent("click", { bubbles: true, cancelable: true });
    visible.dispatchEvent(event);
    expect(exports.at(-1).filename).toBe("visible.csv");

    // 一般連結不受影響
    const plain = win.document.createElement("a");
    plain.setAttribute("href", "#/x");
    const nativeClick = vi.fn();
    guard.restore();
    win.HTMLAnchorElement.prototype.click = nativeClick;
    installExportGuard(win, (file) => exports.push(file));
    plain.click();
    expect(nativeClick).toHaveBeenCalledTimes(1);
  });

  it("only accepts the init handshake from its own parent on the same origin", async () => {
    const top = makeWindow();
    await expect(waitForBridge(top)).rejects.toThrow("not_embedded");

    const parentPosts = [];
    const fakeParent = { postMessage: (data, origin) => parentPosts.push({ data, origin }) };
    const win = makeWindow();
    Object.defineProperty(win, "parent", { value: fakeParent });
    const promise = waitForBridge(win, { timeoutMs: 1000 });
    expect(parentPosts).toEqual([{ data: { type: "adm-legacy-hello" }, origin: "https://bible-speed-reading-admin.vercel.app" }]);
    const channel = new MessageChannel();
    // 別的網域、不是 parent 送的，都不理
    win.dispatchEvent(new win.MessageEvent("message", { data: { type: "adm-legacy-init" }, origin: "https://evil.example", source: fakeParent, ports: [channel.port2] }));
    win.dispatchEvent(new win.MessageEvent("message", { data: { type: "adm-legacy-init" }, origin: "https://bible-speed-reading-admin.vercel.app", source: null, ports: [channel.port2] }));
    win.dispatchEvent(new win.MessageEvent("message", {
      data: { type: "adm-legacy-init", section: "exam", theme: "dark" },
      origin: "https://bible-speed-reading-admin.vercel.app",
      source: fakeParent,
      ports: [channel.port2]
    }));
    const bridge = await promise;
    expect(bridge.init).toEqual({ section: "exam", theme: "dark" });
    channel.port1.close();
    channel.port2.close();
  });

  it("requests get matched to their replies; other messages go to listeners", async () => {
    const win = makeWindow();
    const sent = [];
    const port = { postMessage: (message) => sent.push(message), onmessage: null };
    const bridge = createBridge(win, port, { section: "quizzes" });
    const heard = [];
    bridge.onMessage((message) => heard.push(message));
    const reply = bridge.request("token");
    expect(sent).toEqual([{ id: 1, type: "token" }]);
    port.onmessage({ data: { type: "open", section: "exam" } });
    port.onmessage({ data: { replyTo: 1, ok: true, token: "t" } });
    expect(await reply).toEqual({ replyTo: 1, ok: true, token: "t" });
    expect(heard).toEqual([{ type: "open", section: "exam" }]);
    bridge.post("section", { section: "exam", available: true });
    expect(sent.at(-1)).toEqual({ section: "exam", available: true, type: "section" });
  });

  it("tells the console about activity, at most every 20 seconds", () => {
    const win = makeWindow();
    const posts = [];
    let now = 0;
    forwardActivity(win, { post: (type) => posts.push(type) }, () => now);
    now = 30_000;
    win.dispatchEvent(new win.Event("keydown"));
    now = 35_000;
    win.dispatchEvent(new win.Event("keydown"));
    now = 51_000;
    win.dispatchEvent(new win.Event("pointerdown"));
    expect(posts).toEqual(["activity", "activity"]);
  });
});

describe("legacy auth (window.auth inside the iframe)", () => {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const jwt = (claims) => `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;

  function setup(replies) {
    const requests = [];
    const posts = [];
    const storage = createMemoryStorage();
    let now = 1_000_000;
    const bridge = {
      request: vi.fn(async (type) => {
        requests.push(type);
        return replies.shift();
      }),
      post: (type) => posts.push(type)
    };
    const { auth } = createLegacyAuth({ storage, now: () => now });
    return { auth, bridge, requests, posts, storage, advance: (ms) => { now += ms; } };
  }

  it("asks the console for the token, caches it until a minute before expiry and keeps the id token in memory", async () => {
    const access = jwt({ sub: "logto-sub", exp: 1_000 + 600 });
    const { auth, bridge, requests, storage, advance } = setup([
      { ok: true, token: access, idToken: "id-token-1" },
      { ok: true, token: jwt({ sub: "logto-sub", exp: 5_000 }), idToken: "id-token-2" }
    ]);
    const pending = auth.getValidAccessToken();
    auth.connect(bridge);
    expect(await pending).toBe(access);
    expect(storage.getItem(LEGACY_AUTH_KEYS.idToken)).toBe("id-token-1");
    expect(auth.getLogtoSubject()).toBe("logto-sub");
    expect(await auth.getValidAccessToken()).toBe(access);
    expect(requests).toEqual(["token"]);
    advance(560_000); // 剩不到一分鐘
    await auth.getValidAccessToken();
    expect(requests).toEqual(["token", "token"]);
    expect(storage.getItem(LEGACY_AUTH_KEYS.idToken)).toBe("id-token-2");
  });

  it("when the console has no token: asks it to sign in again, clears the id token and throws session_expired", async () => {
    const { auth, bridge, posts, storage } = setup([{ ok: true, token: jwt({ sub: "s", exp: 9_999 }), idToken: "id" }, { ok: false, error: "session_expired" }]);
    auth.connect(bridge);
    await auth.getValidAccessToken();
    await expect(auth.getValidAccessToken(true)).rejects.toMatchObject({ code: "session_expired" });
    expect(posts).toEqual(["login_required"]);
    expect(storage.getItem(LEGACY_AUTH_KEYS.idToken)).toBeNull();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it("never starts its own login: every login path goes back to the console", async () => {
    const { auth, bridge, posts } = setup([]);
    auth.connect(bridge);
    await auth.login();
    await auth.logout();
    await auth.startInteractiveLogin();
    expect(posts).toEqual(["login_required", "login_required", "login_required"]);
    expect(await auth.handleCallback()).toBe(false);
    expect(auth.isMemberHubSession()).toBe(false);
  });

  it("the iframe entry never touches the App's real auth or persistent storage", () => {
    const entry = read("admin-legacy/legacy-entry.js");
    const globals = read("admin-legacy/globals.js");
    expect(entry.indexOf('import "./globals.js"')).toBeLessThan(entry.indexOf('import "../js/state.js"'));
    for (const src of [entry, globals]) {
      const code = src.replace(/^\s*\/\/.*$/gm, "");
      const imports = [...code.matchAll(/import\s+(?:[^"']*from\s+)?["']([^"']+)["']/g)].map((m) => m[1]);
      expect(imports.length).toBeGreaterThan(0);
      for (const spec of imports) expect(spec).not.toMatch(/js\/auth\.js$|js\/app\.js$|config\.js$|components\//);
      expect(code).not.toMatch(/serviceWorker|indexedDB\.open/);
    }
    expect(globals).toMatch(/installMemoryStorage\(window\)/);
    expect(globals.indexOf("installMemoryStorage(window)")).toBeLessThan(globals.indexOf("createLegacyAuth("));
  });
});

describe("admin-api: legacy_export_audit", () => {
  const ctx = { actorId: ADMIN_ID, actorRole: "admin", requestId: "req-1" };
  const build = (params) => ADMIN_ACTIONS.legacy_export_audit.buildArgs(params, ctx);
  const good = { section: "exam", filename: "exam_第一次_作答明細.csv", format: "csv", rows: 120, bytes: 34567 };

  it("needs export plus the section's capability, and shares the export rate limit", () => {
    const spec = ADMIN_ACTIONS.legacy_export_audit;
    expect(spec.capabilities).toEqual(["export"]);
    expect(spec.paramCapabilities({ section: "exam" })).toEqual(["content.manage"]);
    expect(spec.paramCapabilities({ section: "users" })).toEqual([]);
    expect(spec.paramCapabilities({ section: "__proto__" })).toEqual([]);
    expect(spec.rateLimit).toMatchObject({ bucket: "export", limit: 20, windowSeconds: 3600 });
    expect(spec.rpc).toBe("admin_api_record_event");
    expect(legacySectionCapability("toString")).toBeNull();
  });

  it("records one export audit row with the file's details", () => {
    expect(build(good)).toEqual({ ok: true, args: {
      p_action: "export", p_result: "ok", p_actor_id: ADMIN_ID, p_actor_role: "admin",
      p_resource: "legacy:exam", p_target_user_id: null, p_reason: null, p_request_id: "req-1",
      p_detail: { kind: "legacy", section: "exam", filename: "exam_第一次_作答明細.csv", format: "csv", rows: 120, bytes: 34567 }
    } });
    expect(build({ ...good, format: "txt", rows: null }).args.p_detail).toMatchObject({ format: "txt", rows: null });
  });

  it("rejects unknown sections and malformed file details", () => {
    expect(build({ ...good, section: "users" })).toEqual({ ok: false, error: "invalid_section" });
    expect(build({ ...good, section: undefined })).toEqual({ ok: false, error: "invalid_section" });
    for (const bad of [
      { filename: "" }, { filename: "x".repeat(201) }, { filename: "a\u0000b.csv" }, { filename: 42 },
      { format: "xlsx" }, { format: undefined },
      { rows: -1 }, { rows: 1.5 }, { rows: "3" },
      { bytes: undefined }, { bytes: -1 }, { bytes: 60 * 1024 * 1024 }
    ]) {
      expect(build({ ...good, ...bad }), JSON.stringify(bad)).toEqual({ ok: false, error: "invalid_export" });
    }
  });

  it("goes through the full request flow and checks the section capability before the rate limit", async () => {
    const calls = [];
    const deps = {
      env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: "admin-spa" })[key],
      verifyToken: async () => ({ ok: true, payload: { sub: "logto-sub", client_id: "admin-spa" } }),
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: "admin", is_active: true }, error: null };
        if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
        if (fn === "admin_api_record_event") return { data: 4242, error: null };
        return { data: null, error: null };
      },
      randomId: () => "generated"
    };
    const post = (params) => new Request("https://x.supabase.co/functions/v1/admin-api", {
      method: "POST",
      headers: { Origin: "https://bible-speed-reading-admin.vercel.app", Authorization: "Bearer t", "Content-Type": "application/json", "x-request-id": "req-legacy-1" },
      body: JSON.stringify({ action: "legacy_export_audit", params })
    });
    const ok = await handleAdminRequest(post(good), deps);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ data: 4242 });
    expect(calls.map((call) => call.fn)).toEqual(["admin_api_actor", "admin_api_take_rate_limit", "admin_api_record_event"]);
    expect(calls.at(-1).args).toMatchObject({ p_action: "export", p_result: "ok", p_resource: "legacy:exam", p_request_id: "req-legacy-1" });

    calls.length = 0;
    const bad = await handleAdminRequest(post({ ...good, section: "permissions" }), deps);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_section");
    expect(calls.some((call) => call.fn === "admin_api_record_event")).toBe(false);

    // 能力檢查把 paramCapabilities 算進去（只有系統管理員有能力，這裡直接看程式碼）
    expect(read("supabase/functions/admin-api/handler.ts"))
      .toMatch(/const required = \[\.\.\.spec\.capabilities, \.\.\.\(spec\.paramCapabilities\?\.\(params\) \|\| \[\]\)\];\n\s+if \(!hasCapabilities\(granted, required\)\)/);
  });
});
