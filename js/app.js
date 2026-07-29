// js/app.js

// Import all support and core files to be bundled by esbuild in correct order
import React from 'react';
import { createRoot } from 'react-dom/client';
import { IssueReportFab } from '../components/issue-report/IssueReportFab.tsx';
import { AdminReportView } from '../components/issue-report/AdminReportView.tsx';
import { AdminUsersAccordion } from '../components/issue-report/AdminUsersAccordion.tsx';
import '../config.js';
import './data/bible_data.js';
import './data/bible_verse_counts.js';
import './copy/zh-Hant.js?v=20260726_org_setup_onboarding';
import './data/church_campaign.js?v=20260728_badge_img_refactor';
import './design/design-tokens.js';
import './design/design-system-helpers.js';
import './design/icon-registry.js';
import './design/icons.js';
import './state.js?v=20260729_tab_navigation_memory';
import './auth.js';
import './db.js?v=20260729_team_leaderboards';
import './utils.js?v=20260728_badge_img_refactor';
import './gamification.js?v=20260728_badge_img_refactor';
import './modules/campaign-rule-editor.js?v=20260720_round_editor';
import './modules/team-registration.js?v=20260723_team_dual_division';
import { cleanupProductionStorage } from './production-cleanup.mjs';
import { initializePwa } from './pwa/PwaCoordinator.js?v=20260728_badge_img_refactor';
import { IndexedDbClient } from './pwa/IndexedDbClient.js';
import { SupabaseRepository } from './pwa/SupabaseRepository.js';

cleanupProductionStorage(window.localStorage);

let buildVersion = "__BUILD_VERSION__" + "_clean_demo_mode_v20";
if (buildVersion.includes("__BUILD_VERSION__")) {
  buildVersion = "dev_" + Date.now();
}
const moduleCache = {};
let careReminderBadgeLastRefresh = 0;

function updateCareReminderBadge(reminders = []) {
  const count = Array.isArray(reminders) ? reminders.length : 0;
  const badgeText = count > 9 ? "9+" : String(count);

  document.querySelectorAll("[data-care-reminder-badge]").forEach(badge => {
    badge.hidden = count === 0;
    badge.textContent = count === 0 ? "" : badgeText;
  });

  const bellBadge = document.getElementById("notification-bell-badge");
  if (bellBadge) {
    bellBadge.hidden = count === 0;
    bellBadge.textContent = count === 0 ? "" : badgeText;
  }

  document.querySelectorAll('[data-target="profile-view"]').forEach(button => {
    button.setAttribute(
      "aria-label",
      count > 0 ? `個人，${count} 則未讀關心提醒` : "個人"
    );
  });
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
    admin: "系統管理員"
  };

  notifications.forEach(item => {
    const div = document.createElement("div");
    div.className = `notification-item ${item.status === 'unread' ? 'notification-item--unread' : ''}`;

    const sender = item.sender || {};
    const senderName = sender.name || "領袖";
    const senderRoleRaw = sender.role || "leader";
    const isTeamReminder = String(item.plan_key || "").startsWith("reading-team:");
    const senderRole = isTeamReminder ? "隊友" : (roleNames[senderRoleRaw] || "領袖");

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

  bellBtn.onclick = async (e) => {
    e.stopPropagation();
    const isHidden = popover.classList.contains("hidden");

    document.querySelectorAll(".options-dropdown").forEach(el => el.classList.add("hidden"));

    if (isHidden) {
      popover.classList.remove("hidden");
      await renderNotificationsList();
    } else {
      popover.classList.add("hidden");
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

  document.addEventListener("click", (e) => {
    if (popover && !popover.classList.contains("hidden") && !popover.contains(e.target) && e.target !== bellBtn) {
      popover.classList.add("hidden");
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

    // ── 3b. Hide theme toggle except on profile-view tab (sync) ──
    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) {
      themeToggle.classList.toggle("hidden", tabId !== "profile-view");
    }

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
      if (mod && typeof mod.renderPlanView === 'function') {
        await mod.renderPlanView();
      } else if (typeof window.renderPlanView === 'function') {
        await window.renderPlanView();
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
      const mod = await loadModule('admin', './modules/admin.js?v=' + buildVersion);
      // Run both admin renders, await the async one
      if (mod && typeof mod.renderAdminUserManagement === 'function') {
        await mod.renderAdminUserManagement();
      } else if (typeof window.renderAdminUserManagement === 'function') {
        await window.renderAdminUserManagement();
      }
      if (typeof window.renderAdminOrgManagement === 'function') {
        window.renderAdminOrgManagement(); // sync, no await needed
      }
      if (mod && typeof mod.renderAdminFeatureSettings === 'function') {
        await mod.renderAdminFeatureSettings();
      }
      if (mod && typeof mod.renderAdminTeamRegistrationStatus === 'function') {
        await mod.renderAdminTeamRegistrationStatus(true);
      } else if (typeof window.renderAdminTeamRegistrationStatus === 'function') {
        await window.renderAdminTeamRegistrationStatus(true);
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
  try {
    await db.init();
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
    await Promise.all([
      db.loadOrgStructure(),
      db.loadUserData(true)
    ]);

    if (typeof window.syncActivePlanContext === 'function') {
      window.syncActivePlanContext();
    }

    // Update role-dependent UI now that profile data is loaded
    if (typeof updateAdminNavVisibility === 'function') updateAdminNavVisibility();

    await refreshCareReminderBadge({ force: true });

    // Render the initial view only after ALL data is ready
    await appRouter.switchTab('dashboard-view');
  } catch (err) {
    console.error('Failed to load initial data & render dashboard:', err);
  } finally {
    if (typeof ComponentSkeletonLoader !== 'undefined') {
      ComponentSkeletonLoader.clearBootInlineSkeletons();
    }
  }

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
      mod.renderPlanView().catch(() => {});
    }
  }).catch(() => {});

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshCareReminderBadge();
    }
  });

  // Mount the React IssueReportFab component to document.body
  try {
    const reportRoot = document.createElement("div");
    reportRoot.id = "issue-report-root";
    document.body.appendChild(reportRoot);
    const root = createRoot(reportRoot);
    root.render(React.createElement(IssueReportFab));
    console.log("[IssueReport] Mounted IssueReportFab React component successfully.");
  } catch (err) {
    console.error("[IssueReport] Failed to mount React component:", err);
  }

  // Mount the React AdminReportView component to #admin-reports-root
  try {
    const adminReportsRoot = document.getElementById("admin-reports-root");
    if (adminReportsRoot) {
      const root = createRoot(adminReportsRoot);
      root.render(React.createElement(AdminReportView));
      console.log("[IssueReportAdmin] Mounted AdminReportView React component successfully.");
    }
  } catch (err) {
    console.error("[IssueReportAdmin] Failed to mount AdminReportView component:", err);
  }

  // Mount the React AdminUsersAccordion component to #admin-users-accordion-root
  try {
    const adminUsersAccordionRoot = document.getElementById("admin-users-accordion-root");
    if (adminUsersAccordionRoot) {
      const root = createRoot(adminUsersAccordionRoot);
      root.render(React.createElement(AdminUsersAccordion));
      console.log("[IssueReportAdmin] Mounted AdminUsersAccordion React component successfully.");
    }
  } catch (err) {
    console.error("[IssueReportAdmin] Failed to mount AdminUsersAccordion component:", err);
  }
});
