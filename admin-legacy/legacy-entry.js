// 後台「照搬」區塊的 iframe 入口（#550）：admin-legacy/legacy.html → scripts/build-admin.mjs → dist-admin/legacy。
//
// 載入舊管理分頁的程式（js/modules/admin.js、plan.js…；#551 起會友 App 不再載入）與畫面（build 時
// 取 index.html，管理分頁那段換成 admin-legacy/admin-view.html，再抽出 <body>），只換掉登入與儲存：
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
import { LEGACY_HOSTED_CARDS, LEGACY_SECTION_IDS } from "./sections.mjs";

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

// 搬進來的卡片（LEGACY_HOSTED_CARDS）：包成和管理分頁一樣的區塊面板，換區時 admin.js 的
// setAdminSection() 會連它一起藏起來
function mountHostedCards() {
  const content = document.getElementById("admin-section-content");
  for (const [id, cardId] of Object.entries(LEGACY_HOSTED_CARDS)) {
    const card = document.getElementById(cardId);
    if (!content || !card) continue;
    const panel = document.createElement("div");
    panel.id = `admin-section-${id}`;
    panel.className = "card-col span-12 admin-section-panel hidden";
    panel.style.display = "none";
    panel.appendChild(card);
    content.appendChild(panel);
  }
}

// 計畫管理卡片只給系統管理員，程式在 plan-admin.js（只有這裡會載入，#551）
async function openHostedSection(id) {
  const isAdmin = typeof window.getUserRoleCode === "function" && window.getUserRoleCode(window.state.currentUser) === "admin";
  const panel = document.getElementById(`admin-section-${id}`);
  const card = document.getElementById(LEGACY_HOSTED_CARDS[id]);
  if (!isAdmin || !panel || !card) return false;
  document.querySelectorAll("#admin-section-content > .admin-section-panel").forEach((other) => {
    const active = other === panel;
    other.classList.toggle("hidden", !active);
    other.style.display = active ? "flex" : "none";
  });
  // 管理分頁的「計畫篩選」列只屬於加入計畫狀況、組員總覽這幾區
  const planContext = document.getElementById("admin-plan-context");
  if (planContext) {
    planContext.classList.add("hidden");
    planContext.style.display = "none";
  }
  card.classList.remove("hidden");
  if (id === "plans") await loadLazy("plan-admin", () => import("../js/modules/plan-admin.js"));
  return true;
}

async function openSection(id) {
  if (!booted) {
    pendingSection = id;
    return;
  }
  currentSection = id;
  let available = false;
  if (Object.hasOwn(LEGACY_HOSTED_CARDS, id)) {
    try {
      available = await openHostedSection(id);
    } catch (err) {
      console.error("[admin-legacy] hosted section failed", err);
      toast("這一區載入失敗，請重新整理。");
    }
  } else {
    available = LEGACY_SECTION_IDS.includes(id) && adminModule.openAdminSectionRoute(id) === true;
  }
  // 等待中又換了區：只回報最後那一區
  if (currentSection !== id) return;
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
  mountHostedCards();
  // init() 裡的功能開關是背景載入；小測驗／大測驗要等開關讀回來才知道開不開，這裡等它
  await adminModule.renderAdminFeatureSettings();
  // 先記住要開的區，renderAdminPlanManagement() 還原「上次選的功能」時就直接是它。
  // 搬進來的卡片不在管理分頁的清單裡，admin.js 會退回清單第一個（使用者基本資料，要載全部名單），
  // 改記公告（init() 本來就會載）
  try {
    window.sessionStorage.setItem("selected_admin_section", Object.hasOwn(LEGACY_HOSTED_CARDS, section) ? "announcements" : section);
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
    if (message.type === "open" && typeof message.section === "string") void openSection(message.section);
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
  void openSection(pendingSection || bridge.init.section);
}

void boot();
