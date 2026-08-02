// js/app.js

// Import support and core files needed before first paint.
import '../config.js';
import './data/bible_data.js';
import './data/bible_verse_counts.js';
import './copy/zh-Hant.js?v=20260726_org_setup_onboarding';
import './data/church_campaign.js?v=20260728_badge_img_refactor';
import './design/design-tokens.js';
import './design/design-system-helpers.js?v=20260801_timezone_local_fixes';
import './design/icon-registry.js?v=20260729_team_stats_poke';
import './design/icons.js';
import './state.js?v=20260730_performance_refactor';
import './auth.js?v=20260802_login_auto_repair';
import './auth-launch.mjs';
import './db.js?v=20260802_login_auto_repair';
import './utils.js?v=20260801_full_plan_reset';
import './gamification.js?v=20260728_badge_img_refactor';

import { cleanupProductionStorage } from './production-cleanup.mjs';
import { initializePwa } from './pwa/PwaCoordinator.js?v=20260728_badge_img_refactor';
import { IndexedDbClient } from './pwa/IndexedDbClient.js';
import { SupabaseRepository } from './pwa/SupabaseRepository.js';
import { installPullToRefresh } from './pull-to-refresh.mjs';
import { clearBadge, requestNotificationPermission } from '../lib/services/badge-service.ts';

cleanupProductionStorage(window.localStorage);

let buildVersion = "__BUILD_VERSION__";
if (!/^\d{14}$/.test(buildVersion)) {
  buildVersion = "dev_" + Date.now();
}
buildVersion += "_clean_demo_mode_v20";
const moduleCache = {};
const RELEASE_ONBOARDING_MODULE_PATH = './modules/onboarding-helper.js?v=20260729_release_010';
const RELEASE_ONBOARDING_STORAGE_KEY = "bible_onboarding_seen_version";
const ISSUE_REPORT_UI_MODULE_PATH = './modules/issue-report-ui.bundle.js?v=' + buildVersion;
let releaseOnboardingModulePromise = null;
let careReminderBadgeLastRefresh = 0;

function getReleaseOnboardingVersion(config = window.APP_CONFIG || {}) {
  return String(config.onboardingVersion || config.appVersion || "0.1.1");
}

function isReleaseOnboardingLoginEligible(authClient) {
  if (!authClient) return false;
  if (typeof authClient.isLoggedIn === "function") return authClient.isLoggedIn();
  return Boolean(authClient.loggedIn);
}

function shouldAutoShowReleaseOnboarding({ auth: authClient, syncComplete, storage = window.localStorage, config = window.APP_CONFIG || {} } = {}) {
  if (!isReleaseOnboardingLoginEligible(authClient)) return false;
  if (!syncComplete) return false;
  const version = getReleaseOnboardingVersion(config);
  try {
    return storage?.getItem(RELEASE_ONBOARDING_STORAGE_KEY) !== version;
  } catch {
    return window.__bibleOnboardingSeenInSession !== version;
  }
}

async function loadReleaseOnboardingHelper() {
  if (!releaseOnboardingModulePromise) {
    releaseOnboardingModulePromise = import(RELEASE_ONBOARDING_MODULE_PATH).then((mod) => {
      if (window.__bibleDeferredInstallPrompt && typeof mod.captureInstallPrompt === "function") {
        mod.captureInstallPrompt(window.__bibleDeferredInstallPrompt);
      }
      return mod;
    });
  }
  return releaseOnboardingModulePromise;
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  window.__bibleDeferredInstallPrompt = event;
});

window.openOnboardingHelper = async function openLazyOnboardingHelper(options = {}) {
  const mod = await loadReleaseOnboardingHelper();
  return mod.openOnboardingHelper(options);
};

function maybeShowReleaseOnboarding(options = {}) {
  if (!shouldAutoShowReleaseOnboarding(options)) return false;
  window.setTimeout(() => {
    window.openOnboardingHelper?.(options);
  }, 250);
  return true;
}

function updateCareReminderBadge(reminders = []) {
  const unreadReminderKeys = new Set();
  if (Array.isArray(reminders)) {
    reminders.forEach((reminder, index) => {
      if (!reminder || reminder.status === "read") return;
      const reminderId = String(reminder.id || "").trim();
      unreadReminderKeys.add(reminderId ? `id:${reminderId}` : `row:${index}`);
    });
  }
  const count = unreadReminderKeys.size;
  const badgeText = count > 9 ? "9+" : String(count);

  const bellBadge = document.getElementById("notification-bell-badge");
  if (bellBadge) {
    bellBadge.hidden = count === 0;
    bellBadge.textContent = count === 0 ? "" : badgeText;
  }
  const bellButton = document.getElementById("btn-notification-bell");
  if (bellButton) {
    bellButton.setAttribute(
      "aria-label",
      count > 0 ? `通知，${count} 則未讀` : "通知"
    );
  }

}

async function refreshCareReminderBadge(options = {}) {
  if (typeof db === "undefined" || typeof db.fetchCareReminders !== "function") return;
  if (!state.currentUser || !state.currentUser.id) {
    updateCareReminderBadge([]);
    return;
  }

  const now = Date.now();
  if (!options.force && now - careReminderBadgeLastRefresh < 30000) return;
  careReminderBadgeLastRefresh = now;

  try {
    const { data, error } = await db.fetchCareReminders();
    if (!error) updateCareReminderBadge(data || []);
  } catch (error) {
    console.warn("Care reminder badge refresh failed:", error);
  }
}

window.updateCareReminderBadge = updateCareReminderBadge;
window.refreshCareReminderBadge = refreshCareReminderBadge;

function safeEscapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function renderNotificationsList() {
  const container = document.getElementById("notification-list-container");
  if (!container) return;

  container.innerHTML = `<div style="text-align:center; padding:1.5rem; color:var(--text-muted); font-size:0.8rem;"><span class="nlc-icon nlc-icon--sm" data-icon="loading" aria-hidden="true"></span> 載入中...</div>`;
  if (typeof hydrateIcons === "function") hydrateIcons(container);

  const { data: notifications, error } = await db.fetchAllNotifications();

  if (error || !notifications || notifications.length === 0) {
    container.innerHTML = `<div class="notification-popover__empty">目前沒有通知</div>`;
    return;
  }

  container.innerHTML = "";

  const roleNames = {
    member: "組員",
    group_leader: "小組長",
    zone_leader: "區長",
    great_zone_leader: "大區長",
    senior_pastor: "教會牧者",
    admin: "系統管理員"
  };

  notifications.forEach(item => {
    const div = document.createElement("div");
    div.className = `notification-item ${item.status === 'unread' ? 'notification-item--unread' : ''}`;

    const sender = item.sender || {};
    const senderName = String(sender.name || "").trim() || "—";
    const senderRoleRaw = getUserRoleCode(sender);
    const isTeamReminder = String(item.plan_key || "").startsWith("reading-team:");
    const senderRole = isTeamReminder
      ? "隊友"
      : (getRoleDefinition(senderRoleRaw)?.label || roleNames[senderRoleRaw] || "領袖");

    const dateStr = item.sent_on || "";

    div.innerHTML = `
      <div class="notification-item__header">
        <span class="notification-item__sender">來自${senderRole} ${safeEscapeHTML(senderName)}</span>
        <span class="notification-item__time">${safeEscapeHTML(dateStr)}</span>
      </div>
      <p class="notification-item__body">${safeEscapeHTML(item.message || "加油！一起穩定讀經。")}</p>
    `;

    div.onclick = async (e) => {
      e.stopPropagation();
      if (item.status === 'unread') {
        div.classList.remove("notification-item--unread");
        await db.acknowledgeCareReminder(item.id);
        await refreshCareReminderBadge({ force: true });
      }
    };

    container.appendChild(div);
  });

  if (typeof hydrateIcons === "function") {
    hydrateIcons(container);
  }
}

function initNotificationSystem() {
  const bellBtn = document.getElementById("btn-notification-bell");
  const popover = document.getElementById("notification-popover");
  const readAllBtn = document.getElementById("btn-notification-read-all");

  if (!bellBtn || !popover) return;

  function openPopover() {
    popover.classList.remove("hidden");
    bellBtn.setAttribute("aria-expanded", "true");
    const firstFocusable = popover.querySelector("button, [tabindex]");
    if (firstFocusable) firstFocusable.focus();
  }

  function closePopover() {
    popover.classList.add("hidden");
    bellBtn.setAttribute("aria-expanded", "false");
    bellBtn.focus();
  }

  bellBtn.onclick = async (e) => {
    e.stopPropagation();
    const isHidden = popover.classList.contains("hidden");

    document.querySelectorAll(".options-dropdown").forEach(el => el.classList.add("hidden"));

    if (isHidden) {
      openPopover();
      await renderNotificationsList();
    } else {
      closePopover();
    }
  };

  if (readAllBtn) {
    readAllBtn.onclick = async (e) => {
      e.stopPropagation();
      readAllBtn.disabled = true;
      const { error } = await db.acknowledgeAllCareReminders();
      readAllBtn.disabled = false;
      if (!error) {
        updateCareReminderBadge([]);
        await renderNotificationsList();
      } else {
        alert("全部已讀失敗: " + (error.message || error));
      }
    };
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popover.classList.contains("hidden")) {
      closePopover();
    }
  });

  document.addEventListener("click", (e) => {
    if (!popover.classList.contains("hidden") && !popover.contains(e.target) && e.target !== bellBtn) {
      closePopover();
    }
  });
}

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

async function loadIssueReportUi(options = {}) {
  const mod = await loadModule('issue-report-ui', ISSUE_REPORT_UI_MODULE_PATH);
  if (mod && typeof mod.mountIssueReportUi === "function") {
    mod.mountIssueReportUi(options);
  }
  return mod;
}

function scheduleIssueReportUiLoad(options = {}) {
  let loadStarted = false;
  const load = () => {
    if (loadStarted) return;
    loadStarted = true;
    loadIssueReportUi(options).catch(err => {
      console.warn("[IssueReport] Lazy UI load failed; continuing without report UI.", err);
    });
  };

  window.setTimeout(() => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(load, { timeout: 5000 });
    } else {
      window.setTimeout(load, 2000);
    }
  }, 3000);
}

async function ensurePlanFeatureModulesLoaded() {
  await loadModule('team-registration', './modules/team-registration.js?v=' + buildVersion);
  if (state.currentUser && getUserRoleCode(state.currentUser) === 'admin') {
    await loadModule('campaign-rule-editor', './modules/campaign-rule-editor.js?v=' + buildVersion);
  }
}

async function ensureAdminFeatureModulesLoaded() {
  await loadModule('campaign-rule-editor', './modules/campaign-rule-editor.js?v=' + buildVersion);
}

async function refreshCurrentAppView() {
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      await registration?.update();
    } catch (error) {
      console.warn("Unable to check for an app shell update", error);
    }
  }
  window._cachedAllUsersList = null;
  window._cachedAllUsersListKey = null;

  if (typeof db !== "undefined") {
    if (typeof db.loadOrgStructure === "function") {
      await db.loadOrgStructure();
    }
    if (typeof db.loadUserData === "function") {
      await db.loadUserData(true);
    }
  }

  if (typeof window.syncActivePlanContext === "function") {
    window.syncActivePlanContext();
  }
  if (typeof updateAdminNavVisibility === "function") {
    updateAdminNavVisibility();
  }

  const currentTab = appRouter.currentTab || "dashboard-view";
  await appRouter.switchTab(currentTab, {
    keepPlanDetail: true,
    restoreTabScroll: false
  });
  await refreshCareReminderBadge({ force: true });

  if (typeof showToast === "function") {
    showToast("已更新");
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
  this.isTabTransitioning = true;

  const previousTab = this.currentTab;
  if (previousTab && previousTab !== tabId && typeof this.captureTabScroll === "function") {
    this.captureTabScroll(previousTab);
  }

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
    if (tabId === "plan-view" && options.onboardingPlanDestination === "active-progress" && state.activePlan) {
      state.planDetailOpen = true;
      state.planActiveSubTab = "today";
      window.currentPlanViewState = "DETAIL";
    }

    // ── 5. Load module + render (fully awaited) ──
    if (typeof window.syncActivePlanContext === 'function') {
      window.syncActivePlanContext();
    }

    if (tabId === "dashboard-view") {
      const mod = await loadModule('home', './modules/home.js?v=' + buildVersion);
      if (mod && typeof mod.updateDashboardView === 'function') {
        await mod.updateDashboardView();
      } else if (typeof window.updateDashboardView === 'function') {
        await window.updateDashboardView();
      }

    } else if (tabId === "reader-view") {
      const mod = await loadModule('bible', './modules/bible.js?v=' + buildVersion);
      if (mod && typeof mod.renderReaderText === 'function') {
        await mod.renderReaderText();
      } else if (typeof window.renderReaderText === 'function') {
        await window.renderReaderText();
      }

    } else if (tabId === "plan-view") {
      const mod = await loadModule('plan', './modules/plan.js?v=' + buildVersion);
      await ensurePlanFeatureModulesLoaded();
      if (mod && typeof mod.renderPlanView === 'function') {
        await mod.renderPlanView();
      } else if (typeof window.renderPlanView === 'function') {
        await window.renderPlanView();
      }
      if (options.onboardingPlanDestination === "discover") {
        if (mod && typeof mod.showDiscoverPlans === "function") {
          await mod.showDiscoverPlans();
        } else if (typeof window.showDiscoverPlans === "function") {
          await window.showDiscoverPlans();
        }
      }

    } else if (tabId === "stats-view") {
      const mod = await loadModule('plan', './modules/plan.js?v=' + buildVersion);
      if (typeof window.updateStatsView === 'function') {
        await window.updateStatsView();
      }

    } else if (tabId === "profile-view") {
      const mod = await loadModule('profile', './modules/profile.js?v=' + buildVersion);
      // syncNlcSessionWithSupabase is optional; render profile regardless of outcome
      if (typeof auth !== "undefined" && auth.isLoggedIn() &&
          typeof db !== "undefined" && typeof db.syncNlcSessionWithSupabase === "function") {
        state.profileIdentityLoading = true;
        if (typeof window.applyProfileIdentitySkeletons === "function") {
          window.applyProfileIdentitySkeletons();
        }
        try {
          await db.syncNlcSessionWithSupabase(true);
        } catch (err) {
          console.warn("Profile tab sync failed (non-fatal):", err);
        } finally {
          state.profileIdentityLoading = false;
        }
      }
      if (typeof window.syncActivePlanContext === 'function') {
        window.syncActivePlanContext();
      }
      if (typeof window.renderProfileView === 'function') {
        await window.renderProfileView();
      }

    } else if (tabId === "admin-view") {
      await loadModule('plan', './modules/plan.js?v=' + buildVersion);
      const mod = await loadModule('admin', './modules/admin.js?v=' + buildVersion);
      const isSystemAdmin = getUserRoleCode(state.currentUser) === 'admin';


      if (isSystemAdmin) {
        await ensureAdminFeatureModulesLoaded();
        await loadIssueReportUi({ includeAdmin: true });
      }

      if (mod && typeof mod.renderAdminPlanManagement === 'function') {
        await mod.renderAdminPlanManagement();
      } else if (typeof window.renderAdminPlanManagement === 'function') {
        await window.renderAdminPlanManagement();
      }
    }

    // ── 6. updateNavigationChrome — THE SINGLE, FINAL CALL ──
    // All async rendering is complete. State is now fully settled.
    this.updateNavigationChrome();
    refreshCareReminderBadge();

    if (options.restoreTabScroll && typeof this.restoreTabScroll === "function") {
      await this.restoreTabScroll(tabId);
    }

  } finally {
    // ── 7. Always release the lock, even on error ──
    this.isTabTransitioning = false;
    isSwitching = false;
  }
};

// Bootstrap the application on DomContentLoaded
document.addEventListener("DOMContentLoaded", async () => {
  // Clear badge notification count on app startup / load
  clearBadge().catch(err => console.error("Failed to clear badge on startup:", err));

  // Expose iOS 16.4+ notification permission helper for user gesture triggers
  window.requestPwaNotificationPermission = async () => {
    const permission = await requestNotificationPermission();
    console.log("PWA Notification permission status:", permission);
    return permission;
  };

  try {
    installPullToRefresh({ window, document });
    window.registerPullToRefresh(refreshCurrentAppView);
  } catch (err) {
    console.error("Failed to initialize pull-to-refresh:", err);
  }

  // Initialize Theme
  try {
    initTheme();
  } catch (err) {
    console.error("Failed to initialize theme:", err);
  }

  try {
    initNotificationSystem();
  } catch (err) {
    console.error("Failed to initialize notification system:", err);
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
  let initialSessionSyncSucceeded = false;
  try {
    initialSessionSyncSucceeded = await db.init() === true;
  } catch (err) {
    console.error('Failed to initialize database connection & auth:', err);
  }

  // One authoritative path for reading-log snapshots and mutations.
  const repositoryCache = "indexedDB" in window ? new IndexedDbClient() : null;
  window.pwaDataStore = repositoryCache;
  window.readingLogRepository = new SupabaseRepository({
    table: "reading_logs",
    clientProvider: () => window.state?.supabase,
    cacheClient: repositoryCache
  });
  window.readingLogRepository.addEventListener("data", event => {
    document.documentElement.dataset.readingDataSource = event.detail.source;
    document.documentElement.dataset.readingDataStale = String(Boolean(event.detail.stale));
  });
  window.readingLogRepository.addEventListener("error", event => {
    const error = event.detail;
    document.documentElement.dataset.repositoryError = error.category || "unknown";
    console.error(`[Repository:reading_logs] ${error.operation} failed (${error.category})`, error);
  });
  // Load all user data in one shot. db.init() guarantees auth is resolved before we reach here.
  try {
    const [, initialDataLoadSucceeded] = await Promise.all([
      db.fetchRoleDefinitions(),
      db.loadUserData(true)
    ]);

    if (typeof window.syncActivePlanContext === 'function') {
      window.syncActivePlanContext();
    }

    // Update role-dependent UI now that profile data is loaded
    if (typeof updateAdminNavVisibility === 'function') updateAdminNavVisibility();

    // Render the initial view only after ALL data is ready
    await appRouter.switchTab('dashboard-view');
    refreshCareReminderBadge({ force: true });
    maybeShowReleaseOnboarding({
      auth,
      syncComplete: initialSessionSyncSucceeded && initialDataLoadSucceeded === true,
      storage: window.localStorage,
      config: window.APP_CONFIG
    });

    // Organization-directory data is not required for the first dashboard paint.
    // Load it in the background so larger churches do not block app startup.
    db.loadOrgStructure().catch(error => {
      console.warn("Organization directory load failed after startup", error);
    });
  } catch (err) {
    console.error('Failed to load initial data & render dashboard:', err);
  } finally {
    if (typeof ComponentSkeletonLoader !== 'undefined') {
      ComponentSkeletonLoader.clearBootInlineSkeletons();
    }
  }

  // Mount the report action independently of PWA initialization so a slow service worker cannot hide it.
  scheduleIssueReportUiLoad({ includeAdmin: false });

  // PWA registration and authenticated offline reading queue.
  try {
    await initializePwa();
  } catch (error) {
    console.warn("[PWA] Initialization failed; continuing in online-only mode.", error);
  }

  window.addEventListener("pwa:sync-status", event => {
    const detail = event.detail || {};
    document.documentElement.dataset.syncState = detail.status || "idle";
    document.documentElement.dataset.pendingSyncCount = String(detail.pending || 0);
    if (detail.status === "queued" && typeof showToast === "function") {
      showToast("已離線儲存，恢復網路後會自動同步");
    } else if (detail.status === "complete" && detail.pending === 0 && typeof showToast === "function") {
      showToast("離線讀經進度已同步");
    }
  });

  // ── Background pre-warm: silently load plan module & render plan list ──
  // While the user sees the dashboard, we load plan.js and call renderPlanView()
  // in the background. This guarantees the plan tab shows real data immediately
  // when tapped — eliminating the skeleton-stuck-forever bug.
  // We intentionally do NOT await this (fire-and-forget) to keep startup fast.
  loadModule('plan', './modules/plan.js?v=' + buildVersion).then(mod => {
    if (mod && typeof mod.renderPlanView === 'function') {
      ensurePlanFeatureModulesLoaded()
        .then(() => mod.renderPlanView())
        .catch(() => {});
    }
  }).catch(() => {});

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshCareReminderBadge();
      clearBadge().catch(err => console.error("Failed to clear badge on visible:", err));
    }
  });

});
