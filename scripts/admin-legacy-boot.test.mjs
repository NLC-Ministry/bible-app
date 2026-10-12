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
  church_announcements: () => [{ id: "an-1", title: "<img src=x onerror=alert(1)>十月提醒", body: "這週讀完創世記", is_pinned: true, created_at: new Date().toISOString(), is_active: true }]
};

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
      const { jsFile } = await buildLegacy({
        root,
        outDir: out,
        legacyConfig: { supabaseUrl: SUPABASE, anonKey: "boot-anon", memberHubUrl: "https://member.newlife.org.tw", issuer: "https://sso.newlife.org.tw/oidc", resource: "https://platform.newlife.org.tw" },
        sectionIds: LEGACY_SECTION_IDS
      });
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

      // 已知的雜訊以外沒有錯誤
      expect(errors.filter((line) => !line.includes("[campaign]"))).toEqual([]);
    } finally {
      legacy?.close();
      rmSync(out, { recursive: true, force: true });
    }
  }, 90000);
});
