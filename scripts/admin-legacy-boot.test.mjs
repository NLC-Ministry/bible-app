// 後台照搬區塊（#550）的開機冒煙測試：真的建出 legacy bundle，在 jsdom 裡用假的外殼與假的
// nlc-session／nlc-data 跑一次開機 → 打開一區 → 換區 → 匯出被攔下交給外殼。
// 會友 App 核心鏈（state.js → db.js → … → admin.js）改了載入順序或依賴的全域，這裡會先壞。
// CSP 要在瀏覽器（staging）確認；這裡只抓執行期錯誤與開機流程。
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MessageChannel } from "node:worker_threads";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildLegacy } from "./build-admin.mjs";
import { LEGACY_SECTION_IDS } from "../admin-legacy/sections.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ORIGIN = "https://bible-speed-reading-admin.vercel.app";
const SUPABASE = "https://dbtjsljrytzonjvclgrd.supabase.co";

const ADMIN_ROLE = { id: "10000000-0000-4000-8000-000000000006", code: "admin", label: "系統管理員", sort_order: 10, is_assignable: false, can_manage_plans: true, can_manage_permissions: true, scope_type: "church" };
const PROFILE = {
  id: "aaaaaaaa-0000-4000-8000-000000000001", name: "測試管理員", email: "admin@example.com",
  great_region: "北區", pastoral_zone: "一牧區", small_group: "喜樂小組",
  role_id: ADMIN_ROLE.id, role_definition: ADMIN_ROLE, is_active: true,
  managed_regions: "", managed_zones: "", managed_groups: ""
};
const TABLES = {
  profiles: () => [PROFILE],
  role_definitions: () => [ADMIN_ROLE],
  app_feature_settings: () => [{ key: "daily_quiz", enabled: true }, { key: "speed_reading_exam", enabled: true }],
  church_announcements: () => [{ id: "an-1", title: "<img src=x onerror=alert(1)>十月提醒", body: "這週讀完創世記", is_pinned: true, created_at: new Date().toISOString(), is_active: true }],
  global_plans: () => [{ id: "bbbbbbbb-0000-4000-8000-000000000001", name: "<b>秋季</b>速讀", start_date: "2026-10-01", end_date: "2026-12-31", target_books: ["創世記", "出埃及記"], is_fixed: true, is_hidden: false, plan_kind: "standard", grace_days: 0 }]
};

const LEGACY_CONFIG = { supabaseUrl: SUPABASE, anonKey: "boot-anon", memberHubUrl: "https://member.newlife.org.tw", issuer: "https://sso.newlife.org.tw/oidc", resource: "https://platform.newlife.org.tw" };
// 使用者基本資料（整份名單）才會查的欄位
const USER_DIRECTORY_MARKER = "small_group, is_active, member_context_synced_at";

function tableData(query) {
  const rows = TABLES[query.table] ? TABLES[query.table]() : [];
  return query.returning === "single" || query.returning === "maybeSingle" ? rows[0] ?? null : rows;
}

async function bootLegacy(bundle, html, section) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("error", (...args) => errors.push(args.map(String).join(" ")));
  virtualConsole.on("jsdomError", (err) => errors.push(String(err?.stack || err)));
  const dom = new JSDOM(html.replace(/<script type="module"[^>]*><\/script>/, ""), {
    url: `${ORIGIN}/legacy`, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole
  });
  const win = dom.window;
  // jsdom 沒有、瀏覽器有的 API
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  win.scrollTo = () => {};
  win.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  let blobSeq = 0;
  win.URL.createObjectURL = () => `blob:${ORIGIN}/${++blobSeq}`;
  win.URL.revokeObjectURL = () => {};
  const requests = [];
  win.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    const path = String(url).replace(SUPABASE, "");
    requests.push({ path, body, auth: init.headers?.Authorization || null });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/functions/v1/nlc-session") return json({ edge_session: true, profile: PROFILE, locked_fields: [] });
    if (path === "/functions/v1/nlc-data") {
      if (body.action === "batch") return json({ data: body.queries.map((q) => ({ data: tableData(q) })) });
      if (body.action === "rpc") return json({ data: null });
      if (body.action && body.action !== "select") return json({ data: body.payload ?? null });
      return json({ data: tableData(body) });
    }
    return json({ error: "not_found" }, 404);
  };
  win.addEventListener("error", (event) => errors.push(String(event.error?.stack || event.message)));
  win.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason?.stack || event.reason)));

  // 假的外殼：收 hello → 開通道 → 回 token、記下其他訊息
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const token = `${b64({ alg: "none" })}.${b64({ sub: "logto-sub", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  const messages = [];
  const waiters = [];
  const channel = new MessageChannel();
  channel.port1.on("message", (msg) => {
    if (msg.type === "token") {
      channel.port1.postMessage({ replyTo: msg.id, ok: true, token, idToken: token });
      return;
    }
    if (msg.type === "export") channel.port1.postMessage({ replyTo: msg.id, ok: true });
    messages.push(msg);
    waiters.splice(0).forEach((check) => check());
  });
  const parent = {
    postMessage(data, origin) {
      if (data?.type !== "adm-legacy-hello" || origin !== ORIGIN) return;
      setTimeout(() => {
        const event = new win.MessageEvent("message", { data: { type: "adm-legacy-init", section, theme: "dark" }, origin: ORIGIN, ports: [channel.port2] });
        Object.defineProperty(event, "source", { value: parent });
        win.dispatchEvent(event);
      }, 0);
    }
  };
  Object.defineProperty(win, "parent", { value: parent });
  const waitFor = (predicate, label, timeoutMs = 20000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}: ${JSON.stringify(messages.map((m) => m.type))} ${errors.join("\n")}`)), timeoutMs);
    const check = () => {
      const found = messages.find(predicate);
      if (found) {
        clearTimeout(timer);
        resolve(found);
      } else {
        waiters.push(check);
      }
    };
    check();
  });

  win.eval(bundle);
  return { win, messages, requests, errors, waitFor, port: channel.port1, close: () => { channel.port1.close(); win.close(); } };
}

describe("legacy iframe boots in a browser-like environment", () => {
  it("boots, opens a section, switches section and routes downloads to the console", async () => {
    const out = mkdtempSync(join(tmpdir(), "admin-legacy-boot-"));
    let legacy = null;
    try {
      const { jsFile } = await buildLegacy({ root, outDir: out, legacyConfig: LEGACY_CONFIG, sectionIds: LEGACY_SECTION_IDS });
      legacy = await bootLegacy(readFileSync(join(out, jsFile), "utf8"), readFileSync(join(out, "legacy.html"), "utf8"), "announcements");
      const { win, messages, requests, errors, waitFor, port } = legacy;

      const first = await waitFor((m) => m.type === "section" || m.type === "error", "the first section");
      expect(first).toEqual({ type: "section", section: "announcements", available: true });
      expect(messages.map((m) => m.type)).toEqual(["ready", "section"]);
      expect(win.document.getElementById("adm-legacy-status").hidden).toBe(true);
      const panel = win.document.getElementById("admin-section-announcements");
      expect(panel.classList.contains("hidden")).toBe(false);
      // 會友輸入的內容照舊當文字顯示
      expect(panel.textContent).toContain("<img src=x onerror=alert(1)>十月提醒");
      expect(panel.querySelector("img[src='x']")).toBeNull();
      // 主題跟著外殼
      expect(win.document.body.classList.contains("dark-theme")).toBe(true);

      // 資料照舊走 nlc-session／nlc-data，每個請求都帶外殼給的 token；不打 admin-api
      expect(requests[0].path).toBe("/functions/v1/nlc-session");
      expect(requests[0].body.id_token).toBeTruthy();
      expect(requests.every((r) => ["/functions/v1/nlc-session", "/functions/v1/nlc-data"].includes(r.path))).toBe(true);
      expect(requests.filter((r) => r.path === "/functions/v1/nlc-data").every((r) => /^Bearer /.test(r.auth))).toBe(true);
      // 個資沒有寫進瀏覽器的永久儲存：localStorage 是記憶體版
      expect(win.localStorage.getItem("nlc_supabase_profile")).toContain("測試管理員");
      expect(Object.getOwnPropertyDescriptor(win, "localStorage").writable).toBe(false);

      port.postMessage({ type: "open", section: "exam" });
      expect(await waitFor((m) => m.type === "section" && m.section === "exam", "exam")).toMatchObject({ available: true });
      expect(win.document.getElementById("admin-section-exam").classList.contains("hidden")).toBe(false);

      const link = win.document.createElement("a");
      link.href = win.URL.createObjectURL(new win.Blob(["﻿\"姓名\",\"分數\"\r\n\"王\",\"90\""], { type: "text/csv" }));
      link.download = "exam_第一次.csv";
      link.click();
      expect(await waitFor((m) => m.type === "export", "the export")).toMatchObject({ filename: "exam_第一次.csv", format: "csv", rows: 1, section: "exam" });

      // 營運區：計畫管理是讀經計畫分頁的卡片，搬進一個區塊面板
      port.postMessage({ type: "open", section: "plans" });
      expect(await waitFor((m) => m.type === "section" && m.section === "plans", "plans")).toMatchObject({ available: true });
      const doc = win.document;
      const plansPanel = doc.getElementById("admin-section-plans");
      const card = doc.getElementById("admin-plan-card");
      expect(plansPanel.parentElement.id).toBe("admin-section-content");
      expect(plansPanel.contains(card)).toBe(true);
      expect(plansPanel.classList.contains("hidden")).toBe(false);
      expect(card.classList.contains("hidden")).toBe(false);
      expect(doc.getElementById("admin-section-exam").classList.contains("hidden")).toBe(true);
      expect(doc.getElementById("admin-plan-context").classList.contains("hidden")).toBe(true);
      // 計畫列表與書卷勾選由 plan-admin.js 畫；計畫名稱當文字
      const plansBody = doc.getElementById("admin-plans-table-body");
      expect(plansBody.textContent).toContain("<b>秋季</b>速讀");
      expect(plansBody.querySelector("b")).toBeNull();
      expect(doc.querySelectorAll(".admin-book-checkbox").length).toBe(66);

      // 換到管理分頁的計畫類區塊：計畫管理藏起來、計畫篩選列出現
      port.postMessage({ type: "open", section: "join-status" });
      expect(await waitFor((m) => m.type === "section" && m.section === "join-status", "join-status")).toMatchObject({ available: true });
      expect(plansPanel.classList.contains("hidden")).toBe(true);
      expect(doc.getElementById("admin-section-join-status").classList.contains("hidden")).toBe(false);
      expect(doc.getElementById("admin-plan-context").classList.contains("hidden")).toBe(false);

      port.postMessage({ type: "open", section: "registrations" });
      expect(await waitFor((m) => m.type === "section" && m.section === "registrations", "registrations")).toMatchObject({ available: true });
      expect(doc.getElementById("admin-section-registrations").classList.contains("hidden")).toBe(false);
      expect(doc.getElementById("admin-plan-context").classList.contains("hidden")).toBe(true);

      // 沒打開使用者基本資料就不載整份名單
      expect(JSON.stringify(requests)).not.toContain(USER_DIRECTORY_MARKER);
      // 已知的雜訊以外沒有錯誤
      expect(errors.filter((line) => !line.includes("[campaign]"))).toEqual([]);
    } finally {
      legacy?.close();
      rmSync(out, { recursive: true, force: true });
    }
  }, 90000);

  it("boots straight into the hosted plan card without loading the whole user list", async () => {
    const out = mkdtempSync(join(tmpdir(), "admin-legacy-boot-"));
    let legacy = null;
    try {
      const { jsFile } = await buildLegacy({ root, outDir: out, legacyConfig: LEGACY_CONFIG, sectionIds: LEGACY_SECTION_IDS });
      legacy = await bootLegacy(readFileSync(join(out, jsFile), "utf8"), readFileSync(join(out, "legacy.html"), "utf8"), "plans");
      const { win, requests, errors, waitFor } = legacy;
      expect(await waitFor((m) => m.type === "section" || m.type === "error", "the first section")).toEqual({ type: "section", section: "plans", available: true });
      expect(win.document.getElementById("admin-section-plans").classList.contains("hidden")).toBe(false);
      expect(win.document.getElementById("admin-section-users").classList.contains("hidden")).toBe(true);
      expect(win.document.getElementById("admin-plans-table-body").textContent).toContain("<b>秋季</b>速讀");
      expect(JSON.stringify(requests)).not.toContain(USER_DIRECTORY_MARKER);
      expect(errors.filter((line) => !line.includes("[campaign]"))).toEqual([]);
    } finally {
      legacy?.close();
      rmSync(out, { recursive: true, force: true });
    }
  }, 90000);
});
