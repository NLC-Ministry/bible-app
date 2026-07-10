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
import './utils.js?v=20260709_badge_back';
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

// ─── Tab Switching: isSwitching guard prevents concurrent race conditions ───
let isSwitching = false;

appRouter.switchTab = async function (tabId, options = {}) {
  // ── State Lock: block double-tap / rapid navigation ──
  if (isSwitching) {
    console.warn(`[Router] switchTab('${tabId}') blocked — previous transition still in progress.`);
    return;
  }
  isSwitching = true;

  try {
    // ── Pre-flight: reader-state cleanup ──
    if (tabId !== "reader-view" || !options.fromPlan) {
      if (state.readerState) state.readerState.fromPlan = false;
    }

    // ── Pre-flight: stop TTS audio ──
    if (tabId !== "reader-view" && typeof window.speechSynthesis !== "undefined") {
      window.speechSynthesis.cancel();
      const audioBtn = document.getElementById("reader-audio-btn");
      if (audioBtn) audioBtn.classList.remove("active");
    }

    // ── 1. Update currentTab immediately (sync) ──
    this.currentTab = tabId;

    // ── 2. Update nav button states (sync) ──
    document.querySelectorAll(".tab-btn, .mobile-nav-btn").forEach(btn => {
      const target = btn.getAttribute("data-target");
      if (!target) return;
      const isActive = target === tabId;
      btn.classList.toggle("active", isActive);
      if (btn.classList.contains("mobile-nav-btn") || btn.closest(".nav-tabs")) {
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
        if (isActive) btn.setAttribute("aria-current", "page");
        else btn.removeAttribute("aria-current");
      }
    });

    // ── 3. Show/hide view panes (sync) ──
    document.querySelectorAll(".view-pane").forEach(pane => {
      if (pane.id === tabId) {
        pane.classList.remove("hidden");
        pane.classList.add("active");
      } else {
        pane.classList.add("hidden");
        pane.classList.remove("active");
      }
    });

    // ── 4. Pre-render state mutations (sync, before any await) ──
    if (tabId === "plan-view" && !options.keepPlanDetail) {
      // Only reset if no active plan: preserve plan detail when re-tapping the plan nav tab
      if (!state.activePlan) {
        state.planDetailOpen = false;
      }
    }

    // ── 5. Load module + render (fully awaited) ──
    if (typeof window.syncActivePlanContext === 'function') {
      window.syncActivePlanContext();
    }

    if (tabId === "dashboard-view") {
      const mod = await loadModule('home', './modules/home.js?v=20260710_cuv_fix');
      if (mod && typeof mod.updateDashboardView === 'function') {
        await mod.updateDashboardView();
      } else if (typeof window.updateDashboardView === 'function') {
        await window.updateDashboardView();
      }

    } else if (tabId === "reader-view") {
      const mod = await loadModule('bible', './modules/bible.js');
      if (mod && typeof mod.renderReaderText === 'function') {
        await mod.renderReaderText();
      } else if (typeof window.renderReaderText === 'function') {
        await window.renderReaderText();
      }

    } else if (tabId === "plan-view") {
      const mod = await loadModule('plan', './modules/plan.js?v=20260708_calendar_only');
      if (mod && typeof mod.renderPlanView === 'function') {
        await mod.renderPlanView();
      } else if (typeof window.renderPlanView === 'function') {
        await window.renderPlanView();
      }

    } else if (tabId === "stats-view") {
      const mod = await loadModule('plan', './modules/plan.js?v=20260708_calendar_only');
      if (typeof window.updateStatsView === 'function') {
        await window.updateStatsView();
      }

    } else if (tabId === "profile-view") {
      const mod = await loadModule('profile', './modules/profile.js');
      // syncNlcSessionWithSupabase is optional; render profile regardless of outcome
      if (typeof auth !== "undefined" && auth.isLoggedIn() &&
          typeof db !== "undefined" && typeof db.syncNlcSessionWithSupabase === "function") {
        try {
          await db.syncNlcSessionWithSupabase(true);
        } catch (err) {
          console.warn("Profile tab sync failed (non-fatal):", err);
        }
      }
      if (typeof window.syncActivePlanContext === 'function') {
        window.syncActivePlanContext();
      }
      if (typeof window.renderProfileView === 'function') {
        await window.renderProfileView();
      }

    } else if (tabId === "admin-view") {
      const mod = await loadModule('admin', './modules/admin.js');
      // Run both admin renders, await the async one
      if (mod && typeof mod.renderAdminUserManagement === 'function') {
        await mod.renderAdminUserManagement();
      } else if (typeof window.renderAdminUserManagement === 'function') {
        await window.renderAdminUserManagement();
      }
      if (typeof window.renderAdminOrgManagement === 'function') {
        window.renderAdminOrgManagement(); // sync, no await needed
      }
    }

    // ── 6. updateNavigationChrome — THE SINGLE, FINAL CALL ──
    // All async rendering is complete. State is now fully settled.
    this.updateNavigationChrome();

  } finally {
    // ── 7. Always release the lock, even on error ──
    isSwitching = false;
  }
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

  // Initialize Database Connection & Auth
  // db.init() handles: OIDC callback, session sync, and returns early after auth is established.
  // loadUserData() is called exactly once after init() to populate state.
  try {
    await db.init();
  } catch (err) {
    console.error('Failed to initialize database connection & auth:', err);
  }

  // Load all user data in one shot. db.init() guarantees auth is resolved before we reach here.
  try {
    await Promise.all([
      db.loadOrgStructure(),
      db.loadUserData(true)
    ]);

    if (typeof window.syncActivePlanContext === 'function') {
      window.syncActivePlanContext();
    }

    // Update role-dependent UI now that profile data is loaded
    if (typeof updateAdminNavVisibility === 'function') updateAdminNavVisibility();

    // Render the initial view only after ALL data is ready
    await appRouter.switchTab('dashboard-view');
  } catch (err) {
    console.error('Failed to load initial data & render dashboard:', err);
  } finally {
    if (typeof ComponentSkeletonLoader !== 'undefined') {
      ComponentSkeletonLoader.clearBootInlineSkeletons();
    }
  }

  // ── Background pre-warm: silently load plan module & render plan list ──
  // While the user sees the dashboard, we load plan.js and call renderPlanView()
  // in the background. This guarantees the plan tab shows real data immediately
  // when tapped — eliminating the skeleton-stuck-forever bug.
  // We intentionally do NOT await this (fire-and-forget) to keep startup fast.
  loadModule('plan', './modules/plan.js?v=20260708_calendar_only').then(mod => {
    if (mod && typeof mod.renderPlanView === 'function') {
      mod.renderPlanView().catch(() => {});
    }
  }).catch(() => {});

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
