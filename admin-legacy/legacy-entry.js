// 後台「照搬」區塊的 iframe 入口（#550）：admin-legacy/legacy.html → scripts/build-admin.mjs → dist-admin/legacy。
//
// 載入會友 App 管理分頁的同一份程式（js/modules/admin.js、plan.js…）與同一份畫面（build 時從
// index.html 抽出 <body>），只換掉登入與儲存：
//   · token 跟後台外殼要（admin-legacy/legacy-auth.mjs），資料照舊走 nlc-session／nlc-data
//   · localStorage／sessionStorage 只在記憶體（admin-legacy/memory-storage.mjs）
//   · 所有下載先經後台外殼記稽核才存檔（admin-legacy/export-guard.mjs）
// 開機步驟對照 js/app.js 打開管理分頁的流程（switchTab('admin-view') → 網址指定的功能）。
import "./globals.js";
import "../js/data/bible_data.js";
import "../js/data/bible_verse_counts.js";
import "../js/copy/zh-Hant.js";
import "../js/data/church_campaign.js";
import "../js/design/design-tokens.js";
import "../js/design/design-system-helpers.js";
import "../js/design/icon-registry.js";
import "../js/design/icons.js";
import "../js/state.js";
import "../js/db.js";
import "../js/utils.js";
import "../js/gamification.js";
import * as planModule from "../js/modules/plan.js";
import * as adminModule from "../js/modules/admin.js";
import "../js/modules/campaign-rule-editor.js";
import { forwardActivity, waitForBridge } from "./bridge.mjs";
import { countCsvRecords, installExportGuard } from "./export-guard.mjs";
import { LEGACY_SECTION_IDS } from "./sections.mjs";

const THEMES = ["light", "dark", "warm"];
const statusEl = document.getElementById("adm-legacy-status");
let bridge = null;
let currentSection = "";
// 開機（載入資料、初始化管理分頁）完成前收到的換區，等開完機再開
let booted = false;
let pendingSection = null;

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

function toast(message) {
  if (typeof window.showToast === "function") window.showToast(message, 4000);
}

// 同 app.js 的 loadModule：載一次、有 init 就跑一次
const lazyModules = new Map();
function loadLazy(name, loader) {
  if (!lazyModules.has(name)) {
    const promise = loader().then((mod) => {
      if (typeof mod.init === "function") mod.init();
      return mod;
    });
    promise.catch(() => lazyModules.delete(name));
    lazyModules.set(name, promise);
  }
  return lazyModules.get(name);
}

function applyTheme(theme) {
  const name = THEMES.includes(theme) ? theme : "light";
  window.state.theme = name;
  if (typeof window.setBodyThemeClass === "function") window.setBodyThemeClass(name);
}

async function handleExport({ blob, filename }) {
  if (!bridge) return;
  if (!blob) {
    toast("沒有匯出：認不得要下載的檔案內容。");
    return;
  }
  const format = /\.txt$/i.test(filename) ? "txt" : "csv";
  let rows = null;
  if (format === "csv") {
    try {
      rows = countCsvRecords(await blob.text());
    } catch (_err) {
      rows = null;
    }
  }
  const reply = await bridge.request("export", { blob, filename, format, rows, section: currentSection });
  if (!reply || reply.ok !== true) toast(`沒有匯出：${reply?.message || "記錄稽核失敗，請稍後再試。"}`);
}

function openSection(id) {
  if (!booted) {
    pendingSection = id;
    return;
  }
  currentSection = id;
  const available = LEGACY_SECTION_IDS.includes(id) && adminModule.openAdminSectionRoute(id) === true;
  if (typeof window.hydrateIcons === "function") window.hydrateIcons(document.getElementById("admin-view"));
  bridge.post("section", { section: id, available });
}

function revealAdminView() {
  document.querySelector(".app-layout")?.classList.remove("hidden");
  const pane = document.getElementById("admin-view");
  if (pane) {
    pane.classList.remove("hidden");
    pane.classList.add("active");
    pane.style.display = "block";
  }
  if (window.appRouter) window.appRouter.currentTab = "admin-view";
}

async function loadSession() {
  const { state, db } = window;
  state.supabaseConfig = { url: window.SUPABASE_CONFIG.url, anonKey: window.SUPABASE_CONFIG.anonKey, allowGoogleLogin: false };
  state.isSupabaseMode = true;
  setStatus("確認登入…");
  await window.auth.getValidAccessToken();
  await db.syncNlcSessionWithSupabase(true);
  setStatus("載入資料…");
  const [roleResult, userResult] = await Promise.allSettled([
    db.fetchRoleDefinitions(),
    // 管理畫面用不到自己的讀經紀錄與螢光筆
    db.loadUserData(true, { skipReadingLogs: true })
  ]);
  if (roleResult.status === "rejected") console.error("[admin-legacy] role definitions failed", roleResult.reason);
  if (userResult.status === "rejected") throw userResult.reason;
  if (!state.currentProfileId) throw new Error("profile_missing");
  if (typeof window.syncActivePlanContext === "function") window.syncActivePlanContext();
  try {
    await db.loadOrgStructure();
  } catch (err) {
    console.warn("[admin-legacy] org structure failed", err);
  }
}

async function mountAdminView(section) {
  revealAdminView();
  planModule.registerPlanStatsLoader(() => loadLazy("plan-stats", () => import("../js/modules/plan-stats.js")));
  planModule.registerPlanChunkLoader((name) => (name === "plan-quiz"
    ? loadLazy("plan-quiz", () => import("../js/modules/plan-quiz.js"))
    : Promise.reject(new Error(`unknown plan chunk: ${name}`))));
  planModule.init();
  adminModule.init();
  // init() 裡的功能開關是背景載入；小測驗／大測驗要等開關讀回來才知道開不開，這裡等它
  await adminModule.renderAdminFeatureSettings();
  // 先記住要開的區，renderAdminPlanManagement() 還原「上次選的功能」時就直接是它
  try {
    window.sessionStorage.setItem("selected_admin_section", section);
  } catch (_err) {
    // 記憶體版 storage 不會失敗
  }
  await adminModule.renderAdminPlanManagement();
  if (typeof window.hydrateIcons === "function") window.hydrateIcons(document.body);
}

async function boot() {
  try {
    bridge = await waitForBridge(window);
  } catch (err) {
    setStatus(err && err.message === "not_embedded"
      ? "這一頁是管理後台的一部分，請從管理後台開啟。"
      : "連不上管理後台，請重新整理。");
    return;
  }
  window.auth.connect(bridge);
  forwardActivity(window, bridge);
  installExportGuard(window, (file) => { void handleExport(file); });
  applyTheme(bridge.init.theme);
  bridge.onMessage((message) => {
    if (message.type === "open" && typeof message.section === "string") openSection(message.section);
    else if (message.type === "theme") applyTheme(message.theme);
  });

  try {
    await loadSession();
    await mountAdminView(bridge.init.section);
  } catch (err) {
    console.error("[admin-legacy] boot failed", err);
    const expired = err && err.code === "session_expired";
    setStatus(expired ? "登入已過期，正在重新登入…" : "管理畫面載入失敗。");
    bridge.post("error", { code: expired ? "session_expired" : "boot_failed" });
    return;
  }
  setStatus("");
  booted = true;
  bridge.post("ready");
  openSection(pendingSection || bridge.init.section);
}

void boot();
