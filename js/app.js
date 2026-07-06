// js/app.js

// Import all support and core files to be bundled by esbuild in correct order
import '../config.js';
import './data/bible_data.js';
import './data/bible_verse_counts.js';
import './copy/zh-Hant.js';
import './design/design-tokens.js';
import './design/design-system-helpers.js';
import './design/icon-registry.js';
import './design/icons.js';
import './state.js';
import './auth.js';
import './db.js';
import './utils.js';
import './gamification.js';

const moduleCache = {};

async function loadModule(name, path) {
  if (moduleCache[name]) {
    return moduleCache[name];
  }
  console.log(`📡 [ESM] Lazy-loading module: ${name} from ${path}`);
  try {
    const mod = await import(path);
    moduleCache[name] = mod;
    if (typeof mod.init === 'function') {
      mod.init();
    }
    return mod;
  } catch (err) {
    console.error(`Failed to load module ${name}:`, err);
    throw err;
  }
}

// Override routing switchTab to support dynamic ESM lazy-loading
const originalSwitchTab = appRouter.switchTab;

appRouter.switchTab = async function (tabId, options = {}) {
  // Scenario checks
  if (tabId !== "reader-view" || !options.fromPlan) {
    if (state.readerState) {
      state.readerState.fromPlan = false;
    }
  }

  // Stop reading audio if switching away from reader-view
  if (tabId !== "reader-view" && typeof window.speechSynthesis !== "undefined") {
    window.speechSynthesis.cancel();
    const audioBtn = document.getElementById("reader-audio-btn");
    if (audioBtn) audioBtn.classList.remove("active");
  }

  this.currentTab = tabId;

  // Update Active Nav Buttons (both desktop and mobile)
  document.querySelectorAll(".tab-btn, .mobile-nav-btn").forEach(btn => {
    const target = btn.getAttribute("data-target");
    if (!target) return;
    const isActive = target === tabId;
    btn.classList.toggle("active", isActive);
    if (btn.classList.contains("mobile-nav-btn") || btn.closest(".nav-tabs")) {
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive) {
        btn.setAttribute("aria-current", "page");
      } else {
        btn.removeAttribute("aria-current");
      }
    }
  });

  // Rule A compliance: Hide all view-panes by default using .hidden class
  document.querySelectorAll(".view-pane").forEach(pane => {
    if (pane.id === tabId) {
      pane.classList.remove("hidden");
      pane.classList.add("active");
    } else {
      pane.classList.add("hidden");
      pane.classList.remove("active");
    }
  });

  this.updateNavigationChrome();

  // Lazy-load module and render
  if (tabId === "dashboard-view") {
    const mod = await loadModule('home', './modules/home.js');
    if (mod && typeof mod.updateDashboardView === 'function') {
      mod.updateDashboardView();
    } else if (typeof window.updateDashboardView === 'function') {
      window.updateDashboardView();
    }
  } else if (tabId === "reader-view") {
    const mod = await loadModule('bible', './modules/bible.js');
    if (mod && typeof mod.renderReaderText === 'function') {
      mod.renderReaderText();
    } else if (typeof window.renderReaderText === 'function') {
      window.renderReaderText();
    }
  } else if (tabId === "plan-view") {
    if (!options.keepPlanDetail) {
      state.planDetailOpen = false;
    }
    const mod = await loadModule('plan', './modules/plan.js');
    if (typeof window.renderPlanView === 'function') {
      window.renderPlanView();
    }
  } else if (tabId === "stats-view") {
    const mod = await loadModule('plan', './modules/plan.js');
    if (typeof window.updateStatsView === 'function') {
      window.updateStatsView();
    }
  } else if (tabId === "profile-view") {
    const mod = await loadModule('profile', './modules/profile.js');
    if (typeof auth !== "undefined" && auth.isLoggedIn() && typeof db !== "undefined" && typeof db.syncNlcSessionWithSupabase === "function") {
      db.syncNlcSessionWithSupabase(true).then(function () {
        if (typeof window.renderProfileView === "function") window.renderProfileView();
      }).catch(function (err) {
        console.warn("Profile tab sync failed:", err);
        if (typeof window.renderProfileView === "function") window.renderProfileView();
      });
    } else if (typeof window.renderProfileView === "function") {
      window.renderProfileView();
    }
  } else if (tabId === "admin-view") {
    const mod = await loadModule('admin', './modules/admin.js');
    if (typeof window.renderAdminUserManagement === 'function') {
      window.renderAdminUserManagement();
    }
    if (typeof window.renderAdminOrgManagement === 'function') {
      window.renderAdminOrgManagement();
    }
  }

  this.updateNavigationChrome();
};

// Bootstrap the application on DomContentLoaded
document.addEventListener("DOMContentLoaded", async () => {
  // Initialize Theme
  try {
    initTheme();
  } catch (err) {
    console.error("Failed to initialize theme:", err);
  }

  if (typeof ComponentSkeletonLoader !== "undefined") {
    ComponentSkeletonLoader.applyBootSkeletons();
  }

  // Initialize Routing
  try {
    appRouter.init();
    if (typeof hydrateIcons === "function") hydrateIcons();
  } catch (err) {
    console.error("Failed to initialize routing:", err);
  }

  // Initialize Settings & State Loading
  try {
    loadLocalSettings();
  } catch (err) {
    console.error("Failed to load local settings:", err);
  }

  // Initialize Database Connection & Auth (triggers loadUserData)
  try {
    await db.init();
    // 確保管理員 nav 在 init 完成後立即更新（OIDC 模式 return early 後 profile.js 還未載入）
    if (typeof updateAdminNavVisibility === 'function') updateAdminNavVisibility();
  } catch (err) {
    console.error('Failed to initialize database connection & auth:', err);
  }

  // Load Data in Parallel, Verify Session & Render initial Dashboard
  try {
    await Promise.all([
      db.loadOrgStructure(),
      db.loadUserData()
    ]);

    // 確保管理員 UI 和角色相關 UI 在資料載入後即時更新
    if (typeof updateAdminNavVisibility === 'function') updateAdminNavVisibility();

    if (state.isSupabaseMode && state.supabase && state.supabase.auth) {
      const { data: { session } } = await state.supabase.auth.getSession();
      if (session) {
        db.updateAuthUI(session);
        await db.loadUserData();
        if (typeof updateAdminNavVisibility === 'function') updateAdminNavVisibility();
      }
    }

    // Lazy load the homepage module and render the initial view
    await appRouter.switchTab('dashboard-view');
  } catch (err) {
    console.error('Failed to load initial data & render dashboard:', err);
  } finally {
    if (typeof ComponentSkeletonLoader !== 'undefined') {
      ComponentSkeletonLoader.clearBootInlineSkeletons();
    }
  }

  // PWA Cache Buster
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      if (registrations.length > 0) {
        console.log("[Cache Buster] 偵測到舊版 Service Worker，正在移除並清空快取...");
        for (let registration of registrations) {
          registration.unregister();
        }
        if (window.caches) {
          caches.keys().then(keys => {
            Promise.all(keys.map(key => caches.delete(key))).then(() => {
              console.log("[Cache Buster] 快取已清空，正在執行強制重新整理...");
              window.location.reload(true);
            });
          });
        } else {
          window.location.reload(true);
        }
      }
    });
  }
});
