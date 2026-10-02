// Combined plan and stats module

import {
  isAlreadyJoinedTeamResult,
  resetPlanTeamInvitePanelState,
  resolveTeamJoinEffectivePlan
} from "./plan-team-navigation-helpers.mjs";
import {
  getPlanParticipationModel,
  shouldHidePlanTeamInviteShortcut
} from "./plan-participation-helpers.mjs";
import { getPlanUpgradeAvailability } from "./plan-upgrade-availability.mjs";
import { applyPlanSidebarVisibility } from "./plan-sidebar-visibility.mjs";
import { createReaderBottomDwellController, observeReaderEndSentinel } from "./reader-bottom-dwell.mjs";
import { isPlanProgressLocked } from "../data/plan-progress-availability.mjs";
import {
  countLateCompletedDays,
  buildRound1ReadDateMap,
  isFirstRoundInProgress
} from "../data/schedule-progress.mjs";
import {
  cleanPlanAssociatedBadges,
  removePlanReadingLogs,
  resetPlanProgressState
} from "./plan-progress-reset.mjs";
import { computePlanScopedStreak } from "./team-progress-metrics.mjs";
import { logMatchesPlan as logMatchesPlanScope } from "../data/plan-stats-rules.mjs";
import {
  normalizeQuestion,
  isResponseComplete,
  renderQuestionFieldsetHtml,
  readResponseFromFieldset,
  bindQuestionFieldset
} from "./quiz-question-types.mjs";
import { renderDailyQuizReviewHtml, drawMatchReviewLines } from "./quiz-review.mjs";
import { getRoundProgressDisplay } from "../data/round-progress-display.mjs";
import {
  countDayReadingRecordsByDate,
  formatChapterList,
  getDayReadingRecords,
  getRoundCheckState,
  getRoundGapChapters,
  getRoundUnreadChapters,
  isSequentialCheckPlan
} from "../data/current-round-progress.mjs";
import { AUTO_RECORD_REASONS, getAutoRecordDecision, recordPlanOpened } from "../data/reader-auto-record.mjs";
import { getPlanEndedNotice } from "../data/plan-ended-copy.mjs";
import { getExplorePlanVisibility } from "./explore-plan-visibility.mjs";

// Reading plans tab view controller

window._currentStatsTab = 'personal';
window._statsTabScope = null;

// Asynchronous Request & Click Debounce state trackers
let lastTrackerRequestId = 0;
let planUpgradeInFlight = false;
let dateClickDebounceTimer = null;
let viewMode = 'calendar'; // Today reading always shows calendar + chapter list
let planSearchQuery = '';
let planTeamInviteVisibilityRequestId = 0;
// 計畫分頁的「系列」篩選（全部 / campaign / devotional / group_meeting / other）。
// 只有「靈修」或「小組」任一系列有可見計畫時，那排 pill 才會顯示（審核未過 = 完全不出現）。
let activePlanSeries = (() => {
  try { return sessionStorage.getItem('plan_list_series') || 'all'; } catch (_e) { return 'all'; }
})();

export const PLAN_ROUTE = Object.freeze({
  LIST: "LIST",
  DETAIL: "DETAIL",
  GROUP: "GROUP",
  ORG_STATS: "ORG_STATS"
});

window.currentPlanViewState = window.currentPlanViewState || PLAN_ROUTE.LIST;

// 計畫增刪改卡片在 plan-admin.js（只有管理員會載入的 lazy chunk，#370）；它載入時登記 render 函式。
let planAdminRenderer = null;
export function registerPlanAdminRenderer(render) {
  planAdminRenderer = typeof render === "function" ? render : null;
}

// 統計、排行、組員狀況畫面在 plan-stats.js（lazy chunk，#370）。app.js 載入 plan.js 時登記
// 載入函式；下面四個同名函式第一次被叫到時才下載 plan-stats，之後直接轉呼叫。
let planStatsLoader = null;
export function registerPlanStatsLoader(load) {
  planStatsLoader = typeof load === "function" ? load : null;
}
function loadPlanStats() {
  if (!planStatsLoader) return Promise.reject(new Error("plan-stats loader is not registered"));
  return planStatsLoader();
}
async function renderPlanStatsView() {
  return (await loadPlanStats()).renderPlanStatsView();
}
async function renderPlanRankingView() {
  return (await loadPlanStats()).renderPlanRankingView();
}
async function renderPlanMembersView() {
  return (await loadPlanStats()).renderPlanMembersView();
}
// admin.js 用同步 try/catch 呼叫它，所以載入失敗在這裡接住，不留未處理的 rejection。
async function populateMembersSelector() {
  try {
    (await loadPlanStats()).populateMembersSelector();
  } catch (e) {
    console.warn('[Plan] populateMembersSelector error caught:', e);
  }
}

function getPlanDetailTabs() {
  return document.querySelector(".plan-detail-tabs");
}

function moveGroupNodesToDetail(shell = ensurePlanRouteShell()) {
  if (!shell || !shell.legacyDetail) return;

  const tabs = getPlanDetailTabs();
  const schedule = document.getElementById("subview-plan-schedule");
  if (tabs && schedule && tabs.parentElement !== shell.legacyDetail) {
    shell.legacyDetail.insertBefore(tabs, schedule);
  } else if (tabs && !schedule && tabs.parentElement !== shell.legacyDetail) {
    shell.legacyDetail.appendChild(tabs);
  }

  [
    document.getElementById("subview-plan-stats"),
    document.getElementById("subview-plan-ranking")
  ].filter(Boolean).forEach(node => {
    if (node.parentElement !== shell.legacyDetail) shell.legacyDetail.appendChild(node);
  });
  const stats = document.getElementById("subview-plan-stats");
  const members = document.getElementById("subview-plan-members");
  if (stats && members && members.parentElement !== stats) stats.insertBefore(members, stats.firstChild);
}

function forceHidden(el, hidden) {
  if (!el) return;
  el.classList.toggle("hidden", hidden);
  el.hidden = hidden;
  if (hidden) {
    el.style.setProperty("display", "none", "important");
  } else {
    el.style.display = "";
  }
}

function ensurePlanRouteShell() {
  const planRoot = document.getElementById("plan-view");
  if (!planRoot) return null;

  const legacyList = document.getElementById("plan-list-subview");
  const legacyDetail = document.getElementById("plan-detail-subview");
  if (!legacyList || !legacyDetail) return null;

  let listView = document.getElementById("plan-list-view");
  if (!listView) {
    listView = document.createElement("div");
    listView.id = "plan-list-view";
    const listParent = legacyList.parentNode || planRoot;
    listParent.insertBefore(listView, legacyList);
    listView.appendChild(legacyList);
  }

  let detailView = document.getElementById("plan-detail-view");
  if (!detailView) {
    detailView = document.createElement("div");
    detailView.id = "plan-detail-view";
    detailView.className = "hidden";
    const detailParent = legacyDetail.parentNode || planRoot;
    detailParent.insertBefore(detailView, legacyDetail);
    detailView.appendChild(legacyDetail);
  }

  let groupView = document.getElementById("group-progress-view");
  if (!groupView) {
    groupView = document.createElement("div");
    groupView.id = "group-progress-view";
    groupView.className = "hidden";
    detailView.after(groupView);
  }

  return { listView, detailView, groupView, legacyList, legacyDetail };
}

function setOnlyPlanRouteVisible(route) {
  const shell = ensurePlanRouteShell();
  if (!shell) return null;

  forceHidden(shell.listView, route !== PLAN_ROUTE.LIST);
  forceHidden(shell.detailView, route === PLAN_ROUTE.LIST);
  forceHidden(shell.groupView, true);
  forceHidden(shell.legacyList, false);
  forceHidden(shell.legacyDetail, route === PLAN_ROUTE.LIST);


  return shell;
}

function getCurrentPlanRoute() {
  return window.currentPlanViewState || PLAN_ROUTE.LIST;
}

const PLAN_PAGE = Object.freeze({ READING: 0, GROUP: 1 });

function ensurePlanPageShell() {
  const shell = ensurePlanRouteShell();
  const detail = shell && shell.legacyDetail;
  if (!detail) return null;
  forceHidden(detail, false);
  const oldSegmented = document.getElementById("tab-today-task")?.closest(".px-4.py-2");
  if (oldSegmented) oldSegmented.style.display = "none";
  const legacyTabs = getPlanDetailTabs();
  if (legacyTabs) legacyTabs.style.display = "none";
  let strip = document.getElementById("plan-detail-tab-strip");
  let windowEl = document.getElementById("plan-view-window");
  if (!strip) {
    strip = document.createElement("nav");
    strip.id = "plan-detail-tab-strip";
    strip.className = "plan-detail-tab-strip hidden";
    strip.setAttribute("aria-label", "計畫分頁");
    strip.style.display = "none";
    strip.innerHTML = `<div class="plan-detail-tab-strip__scroller" role="tablist"><button id="plan-primary-tab-progress" class="plan-detail-tab-btn active" type="button" role="tab" aria-selected="true" data-plan-primary-view="progress">進度</button><button id="plan-primary-tab-personal" class="plan-detail-tab-btn" type="button" role="tab" aria-selected="false" data-plan-primary-view="personal">個人統計</button><button id="plan-primary-tab-stats" class="plan-detail-tab-btn" type="button" role="tab" aria-selected="false" data-plan-primary-view="stats">團體統計</button><button id="plan-primary-tab-ranking" class="plan-detail-tab-btn" type="button" role="tab" aria-selected="false" data-plan-primary-view="ranking">排名</button><div id="tab-indicator" aria-hidden="true"></div></div>`;
    detail.insertBefore(strip, detail.querySelector(".px-4.py-2, .plan-detail-tabs, #subview-plan-schedule") || detail.firstChild);
  }
  if (!windowEl) {
    windowEl = document.createElement("div");
    windowEl.id = "plan-view-window";
    windowEl.className = "plan-view-window hidden";
    windowEl.style.display = "none";
    windowEl.innerHTML = `<div id="plan-view-wrapper" class="w-full flex will-change-transform transition-transform duration-300"><section id="plan-page-0" class="plan-page-panel" data-plan-page="0"></section><section id="plan-page-1" class="plan-page-panel" data-plan-page="1"></section></div>`;
    strip.after(windowEl);
  }
  const wrapper = document.getElementById("plan-view-wrapper");
  const page0 = document.getElementById("plan-page-0");
  const page1 = document.getElementById("plan-page-1");
  const schedule = document.getElementById("subview-plan-schedule");
  const stats = document.getElementById("subview-plan-stats");
  const ranking = document.getElementById("subview-plan-ranking");
  const members = document.getElementById("subview-plan-members");
  if (page0 && schedule && schedule.parentElement !== page0) page0.appendChild(schedule);
  [stats, ranking].filter(Boolean).forEach(node => { if (page1 && node.parentElement !== page1) page1.appendChild(node); });
  if (stats && members && members.parentElement !== stats) stats.insertBefore(members, stats.firstChild);
  return { shell, detail, strip, windowEl, wrapper, page0, page1, schedule, stats, ranking, members };
}

const PLAN_PRIMARY_VIEW = Object.freeze({
  PROGRESS: "progress",
  PERSONAL: "personal",
  STATS: "stats",
  RANKING: "ranking"
});

function updatePlanPrimaryTabs(view = PLAN_PRIMARY_VIEW.PROGRESS) {
  const strip = document.getElementById("plan-detail-tab-strip");
  if (!strip) return;
  const activeView = Object.values(PLAN_PRIMARY_VIEW).includes(view) ? view : PLAN_PRIMARY_VIEW.PROGRESS;
  strip.querySelectorAll("[data-plan-primary-view]").forEach(button => {
    const isActive = button.dataset.planPrimaryView === activeView;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.tabIndex = isActive ? 0 : -1;
  });
  const active = strip.querySelector(`[data-plan-primary-view="${activeView}"]`);
  const indicator = strip.querySelector("#tab-indicator");
  if (!active || !indicator) return;
  window.requestAnimationFrame(() => {
    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.transform = `translateX(${active.offsetLeft}px)`;
  });
}

const GROUP_SUBVIEW = Object.freeze({ PERSONAL: "personal", STATS: "stats", RANKING: "ranking" });

async function showPlanGroupSubview(view = GROUP_SUBVIEW.STATS) {
  const allowedViews = Object.values(GROUP_SUBVIEW);
  let target = allowedViews.includes(view) ? view : GROUP_SUBVIEW.STATS;

  const isTeamPlan = typeof window.isReadingTeamPlan === "function" && window.isReadingTeamPlan(state.activePlan);
  if (isTeamPlan && target === GROUP_SUBVIEW.STATS) {
    const hasTeam = await checkUserHasTeam();
    if (!hasTeam) {
      target = GROUP_SUBVIEW.PERSONAL;
    }
  }

  const statsPanel = document.getElementById("subview-plan-stats");
  const rankingPanel = document.getElementById("subview-plan-ranking");
  const membersPanel = document.getElementById("subview-plan-members");

  const legacyScheduleTab = document.getElementById("tab-plan-schedule");
  if (legacyScheduleTab) {
    legacyScheduleTab.classList.remove("active");
    legacyScheduleTab.setAttribute("aria-selected", "false");
  }
  ["tab-plan-stats", "tab-plan-ranking", "tab-plan-members"].forEach(id => {
    const button = document.getElementById(id);
    if (!button) return;
    forceHidden(button, true);
    const isActive = id === "tab-plan-stats" && target === GROUP_SUBVIEW.STATS
      || id === "tab-plan-ranking" && target === GROUP_SUBVIEW.RANKING;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  forceHidden(statsPanel, target === GROUP_SUBVIEW.RANKING);
  forceHidden(rankingPanel, target !== GROUP_SUBVIEW.RANKING);
  forceHidden(membersPanel, true); // Keep members panel hidden under all main tabs

  window.PlanPageController.groupSubview = target;
  updatePlanPrimaryTabs(target);

  if (target === GROUP_SUBVIEW.PERSONAL) {
    await window.switchStatTab("personal");
  } else if (target === GROUP_SUBVIEW.STATS) {
    const regContainer = document.getElementById("reading-team-registration-inline");
    if (regContainer) regContainer.classList.add("hidden");

    // Hide personal section under the stats tab
    const personalSec = document.getElementById("stats-personal-section");
    if (personalSec) personalSec.classList.add("hidden");

    await prepareReadingTeamSubview("stats");
  } else if (target === GROUP_SUBVIEW.RANKING) {
    await renderPlanRankingView();
  }
}

// 一次切到「團隊」會經過 switchPrimaryView → switchPage → showPlanGroupSubview →
// prepareReadingTeamSubview，各自都要問「我的團隊」，以前每一關都打一次
// get_my_reading_team（#407）。改成同一份答案共用：同時發出的共用同一個 Promise，
// 成功的結果留 30 秒；本機做了任何團隊異動，db.js 會發 reading-team:changed 立刻清掉。
// 別台裝置的隊友異動要等這 30 秒過去才看得到。
const MY_READING_TEAM_FRESH_MS = 30000;
const myReadingTeamCache = new Map();

function getMyReadingTeamCached(plan) {
  const planKey = plan && (plan.globalPlanId || plan.global_plan_id || plan.id);
  const key = `${state.currentProfileId || state.currentUser?.id || ""}|${planKey || ""}`;
  const cached = myReadingTeamCache.get(key);
  if (cached && (cached.pending || Date.now() - cached.at < MY_READING_TEAM_FRESH_MS)) return cached.promise;

  const entry = { pending: true, at: 0, promise: null };
  const forget = () => { if (myReadingTeamCache.get(key) === entry) myReadingTeamCache.delete(key); };
  entry.promise = Promise.resolve()
    .then(() => db.getMyReadingTeam(plan))
    .then(result => {
      entry.pending = false;
      entry.at = Date.now();
      if (!result || !result.success) forget(); // 失敗不留，下一次重查
      return result;
    }, error => {
      forget();
      throw error;
    });
  myReadingTeamCache.set(key, entry);
  return entry.promise;
}

window.addEventListener("reading-team:changed", () => myReadingTeamCache.clear());

async function checkUserHasTeam() {
  if (!state.activePlan) return false;
  const supported = typeof window.isReadingTeamPlan === "function" && window.isReadingTeamPlan(state.activePlan);
  if (!supported) return false;
  const result = await getMyReadingTeamCached(state.activePlan);
  if (result && result.success) {
    const contexts = getJoinedReadingTeamContexts(result.context);
    return contexts.length > 0;
  }
  return false;
}

window.PlanPageController = {
  currentIndex: PLAN_PAGE.READING,
  groupLoadedForPlanKey: null,
  groupLoadPromise: null,
  groupSubview: GROUP_SUBVIEW.STATS,
  ensureShell() {
    const shell = ensurePlanPageShell();
    if (!shell) return null;
    forceHidden(shell.strip, false);
    forceHidden(shell.windowEl, false);
    if (!shell.strip.dataset.planControllerBound) {
      shell.strip.addEventListener("click", async event => {
        const button = event.target.closest("[data-plan-primary-view]");
        if (!button) return;
        event.preventDefault();
        await window.PlanPageController.switchPrimaryView(button.dataset.planPrimaryView);
      });
      shell.strip.addEventListener("keydown", async event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const buttons = [...shell.strip.querySelectorAll("[data-plan-primary-view]")].filter(b => !b.classList.contains("hidden") && b.style.display !== "none");
        const current = buttons.indexOf(document.activeElement);
        if (current < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0
          : event.key === "End" ? buttons.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
        await window.PlanPageController.switchPrimaryView(buttons[next].dataset.planPrimaryView);
      });
      shell.strip.dataset.planControllerBound = "true";
    }
    const groupTabs = getPlanDetailTabs();
    if (groupTabs && !groupTabs.dataset.groupControllerBound) {
      const viewById = {
        "tab-plan-stats": GROUP_SUBVIEW.STATS,
        "tab-plan-ranking": GROUP_SUBVIEW.RANKING,
        "tab-plan-members": GROUP_SUBVIEW.STATS
      };
      groupTabs.addEventListener("click", async event => {
        const button = event.target.closest("button");
        const view = button ? viewById[button.id] : null;
        if (!view) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        await showPlanGroupSubview(view);
      }, true);
      groupTabs.dataset.groupControllerBound = "true";
    }
    return shell;
  },
  async switchPrimaryView(view, options = {}) {
    let targetView = Object.values(PLAN_PRIMARY_VIEW).includes(view) ? view : PLAN_PRIMARY_VIEW.PROGRESS;
    const isTeamPlan = typeof window.isReadingTeamPlan === "function" && window.isReadingTeamPlan(state.activePlan);
    if (isTeamPlan && targetView === PLAN_PRIMARY_VIEW.STATS) {
      const hasTeam = await checkUserHasTeam();
      if (!hasTeam) {
        targetView = PLAN_PRIMARY_VIEW.PERSONAL;
      }
    }
    if (targetView === PLAN_PRIMARY_VIEW.PROGRESS) {
      return this.switchPage(PLAN_PAGE.READING, options);
    }
    this.groupSubview = targetView;
    return this.switchPage(PLAN_PAGE.GROUP, { ...options, primaryView: targetView });
  },
  async switchPage(index, options = {}) {
    if (!state.activePlan) return;

    const target = Number(index) === PLAN_PAGE.GROUP ? PLAN_PAGE.GROUP : PLAN_PAGE.READING;
    const shell = this.ensureShell();
    if (!shell?.wrapper) return;

    // Check if user has team and dynamically update third tab name
    const isTeamPlan = typeof window.isReadingTeamPlan === "function" && window.isReadingTeamPlan(state.activePlan);
    let hasTeam = false;
    if (isTeamPlan) {
      hasTeam = await checkUserHasTeam();
    }
    const statsTab = document.getElementById("plan-primary-tab-stats");
    if (statsTab) {
      if (isTeamPlan) {
        statsTab.textContent = "團隊";
        forceHidden(statsTab, !hasTeam);
      } else {
        statsTab.textContent = "團體統計";
        forceHidden(statsTab, false);
      }
    }

    if (isTeamPlan && !hasTeam) {
      if (options.primaryView === GROUP_SUBVIEW.STATS) {
        options.primaryView = GROUP_SUBVIEW.PERSONAL;
      }
      if (this.groupSubview === GROUP_SUBVIEW.STATS) {
        this.groupSubview = GROUP_SUBVIEW.PERSONAL;
      }
    }

    this.currentIndex = target;
    state.planDetailOpen = true;
    state.planActiveSubTab = target === PLAN_PAGE.GROUP ? (options.primaryView || this.groupSubview || "stats") : "today";
    window.currentPlanViewState = target === PLAN_PAGE.GROUP ? PLAN_ROUTE.GROUP : PLAN_ROUTE.DETAIL;
    shell.wrapper.style.transform = `translateX(-${target * 100}%)`;
    const groupTabs = getPlanDetailTabs();
    if (groupTabs) forceHidden(groupTabs, true);
    if (target === PLAN_PAGE.READING) {
      updatePlanPrimaryTabs(PLAN_PRIMARY_VIEW.PROGRESS);
      forceHidden(shell.schedule, false);
      state.inlineReader.active = false;
      document.body.classList.remove("plan-inline-reader-open");
      inlineReaderBottomDwellController?.cancel();
      inlineReaderEndObserver?.disconnect();
      inlineReaderEndObserver = null;
      inlineReaderEndVisible = false;
      const inlineReader = document.getElementById("plan-inline-reader");
      if (inlineReader) inlineReader.classList.add("hidden");
      ensurePlanViewModeToggle();
      if (typeof setViewMode === "function") setViewMode("calendar");
      if (typeof renderPlanScheduleTracker === "function") await renderPlanScheduleTracker();
    } else {
      const planKey = state.activePlan.id || state.activePlan.globalPlanId || state.activePlan.presetKey;
      if (this.groupLoadedForPlanKey !== planKey || options.forceReload) {
        this.groupLoadPromise = fetchGroupRankings(planKey).finally(() => { this.groupLoadPromise = null; });
        await this.groupLoadPromise;
        this.groupLoadedForPlanKey = planKey;
      } else if (this.groupLoadPromise) {
        await this.groupLoadPromise;
      }
      await showPlanGroupSubview(options.primaryView || this.groupSubview || GROUP_SUBVIEW.STATS);
    }
    if (!options.skipChrome && typeof appRouter !== "undefined" && typeof appRouter.updateNavigationChrome === "function") appRouter.updateNavigationChrome();
  },
};

function ensurePlanViewModeToggle() {
  const toggle = document.getElementById("plan-view-mode-toggle");
  if (toggle) toggle.remove();
}

// Reactive state propagation audit
window.addEventListener("planDataChanged", (e) => {
  renderHorizontalDateStrip();
  renderPlanScheduleTracker(true);
});

function canUseAdvancedGroupStats() {
  const allowedRoles = ["admin", "pastor", "great_zone_leader", "zone_leader", "group_leader"];
  const currentRole = (state.currentUser && getUserRoleCode(state.currentUser)) || "member";

  return allowedRoles.includes(currentRole);
}

function getDefaultGroupStatsScope() {
  const myGroup = (state.currentUser && state.currentUser.small_group) || "";
  const myZone = (state.currentUser && state.currentUser.pastoral_zone) || "";
  if (myGroup) return `group:${myGroup.split(",")[0].trim()}`;
  return myZone ? `zone:${myZone.split(",")[0].trim()}` : "all";
}

function applyBasicStatsScope() {
  const basicSelect = document.getElementById("stats-basic-scope-select");
  if (!basicSelect) return getDefaultGroupStatsScope();
  if (!basicSelect.value) basicSelect.value = getDefaultGroupStatsScope();
  if (basicSelect.value === "advanced") return null;
  return basicSelect.value;
}

window.switchStatTab = async function (tab) {
  window._currentStatsTab = tab;

  const tabs = document.querySelectorAll(".stats-inner-tab");
  tabs.forEach(t => t.classList.toggle("active", t.getAttribute("data-tab") === tab));

  const adminScopeBar = document.getElementById("stats-admin-scope-bar");
  const membersOrgControls = document.getElementById("members-organization-controls");

  if (adminScopeBar) {
    adminScopeBar.classList.toggle("hidden", tab !== 'admin');
    adminScopeBar.style.display = tab === 'admin' ? "" : "none";
  }
  if (membersOrgControls) {
    // Members controls only show on members-related views, never alongside stats-admin-scope-bar
    membersOrgControls.style.display = "none";
  }

  if (tab === 'personal') {
    window._statsTabScope = 'me';
  } else if (tab === 'admin') {
    window._statsTabScope = applyBasicStatsScope();
  }

  if (state.activePlan) {
    await renderPlanStatsView();
  }
};


function getJoinedReadingTeamContexts(context) {
  if (Array.isArray(context && context.teams)) {
    return context.teams
      .filter(item => item && item.team)
      .sort((left, right) => Number(left.team.division) - Number(right.team.division));
  }
  return context && context.team ? [context] : [];
}

export async function prepareReadingTeamSubview(mode) {
  // Bypass reading team subview when in ORG_STATS mode
  if (window.currentPlanViewState === PLAN_ROUTE.ORG_STATS) {
    const switcher = document.getElementById(mode === "stats" ? "stats-team-view-switch" : "members-team-view-switch");
    const inline = document.getElementById(mode === "stats" ? "reading-team-stats-inline" : "reading-team-members-inline");
    if (switcher) switcher.classList.add("hidden");
    if (inline) inline.classList.add("hidden");
    return true;
  }

  const isStats = mode === "stats";
  const switcher = document.getElementById(isStats ? "stats-team-view-switch" : "members-team-view-switch");
  const tabs = document.getElementById(isStats ? "stats-team-view-tabs" : "members-team-view-tabs");
  const inline = document.getElementById(isStats ? "reading-team-stats-inline" : "reading-team-members-inline");
  if (!switcher || !tabs || !inline) return true;

  const supported = typeof window.isReadingTeamPlan === "function" && window.isReadingTeamPlan(state.activePlan);
  if (!supported) {
    switcher.classList.add("hidden");
    inline.classList.add("hidden");
    return true;
  }

  const result = await getMyReadingTeamCached(state.activePlan);
  const contexts = result && result.success ? getJoinedReadingTeamContexts(result.context) : [];

  if (contexts.length === 0) {
    tabs.innerHTML = "";
    delete tabs.dataset.readingTeamDefaultPlan;
    delete tabs.dataset.readingTeamSelectedDivision;
    switcher.classList.add("hidden");
    inline.classList.add("hidden");
    return true;
  }

  const regContainer = document.getElementById("reading-team-registration-inline");
  if (regContainer) regContainer.classList.add("hidden");

  // 使用者同時加入 3 人與 6 人團隊時，兩個選項一律並排顯示（segmented control），
  // 不再靠一個沒展開就看不出還有別的選項的下拉選單——先前這樣做，導致有人加入
  // 6 人團隊後回報「看不到 6 人團隊」，其實只是沒發現下拉選單裡還有別的選項。
  const activePlanKey = String(
    state.activePlan.globalPlanId
      || state.activePlan.id
      || state.activePlan.presetKey
      || state.activePlan.name
      || "current-plan"
  );
  const planChanged = tabs.dataset.readingTeamDefaultPlan !== activePlanKey;
  const previousDivision = Number(tabs.dataset.readingTeamSelectedDivision || 0);
  const hasPreviousDivision = contexts.some(context => Number(context.team.division) === previousDivision);
  const selectedDivision = (!planChanged && hasPreviousDivision)
    ? previousDivision
    : Number(contexts[0].team.division);

  tabs.dataset.readingTeamDefaultPlan = activePlanKey;
  tabs.dataset.readingTeamSelectedDivision = String(selectedDivision);

  const renderSelectedTeam = () => {
    const division = Number(tabs.dataset.readingTeamSelectedDivision);
    const selectedContext = contexts.find(context => Number(context.team.division) === division) || contexts[0];
    inline.classList.toggle("hidden", !selectedContext);
    if (selectedContext && typeof window.renderMyReadingTeamInline === "function") {
      window.renderMyReadingTeamInline(inline, state.activePlan, selectedContext, mode);
    }
  };

  tabs.innerHTML = "";
  contexts.forEach(context => {
    const division = Number(context.team.division);
    const isActive = division === selectedDivision;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "segment-toggle-btn" + (isActive ? " active" : "");
    btn.dataset.readingTeamDivision = String(division);
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    btn.textContent = division + " 人團隊";
    btn.addEventListener("click", () => {
      if (Number(tabs.dataset.readingTeamSelectedDivision) === division) return;
      tabs.dataset.readingTeamSelectedDivision = String(division);
      tabs.querySelectorAll(".segment-toggle-btn").forEach(otherBtn => {
        const active = Number(otherBtn.dataset.readingTeamDivision) === division;
        otherBtn.classList.toggle("active", active);
        otherBtn.setAttribute("aria-selected", active ? "true" : "false");
      });
      renderSelectedTeam();
    });
    tabs.appendChild(btn);
  });

  // 只有一個團隊時沒什麼好切換的，直接隱藏切換列，內容照樣顯示。
  switcher.classList.toggle("hidden", contexts.length <= 1);

  renderSelectedTeam();

  return true;
}


function openPlanTeamInvitePanel() {
  const joinedContainer = document.getElementById("joined-plans-list-container");
  const presetContainer = document.getElementById("preset-plans-list-container");
  const sidebarCard = document.getElementById("plan-sidebar-info-card");
  const joinTeamContainer = document.getElementById("join-team-container");
  const trigger = document.getElementById("btn-open-plan-team-invite");

  if (joinedContainer) joinedContainer.classList.add("hidden");
  if (presetContainer) presetContainer.classList.add("hidden");
  if (sidebarCard) sidebarCard.classList.add("hidden");
  if (joinTeamContainer) joinTeamContainer.classList.remove("hidden");
  trigger?.setAttribute("aria-expanded", "true");
  setupGlobalJoinTeamForm();
  document.getElementById("global-team-code-input")?.focus();
}

function resetPlanTeamInvitePanel({ restoreFocus = false } = {}) {
  const joinTeamContainer = document.getElementById("join-team-container");
  const trigger = document.getElementById("btn-open-plan-team-invite");
  const activePill = document.querySelector("#plan-list-status-pills .pill-btn.active");
  const fallbackMine = document.querySelector('#plan-list-status-pills .pill-btn[data-filter="mine"]');
  const target = activePill || fallbackMine;

  resetPlanTeamInvitePanelState({
    panel: joinTeamContainer,
    trigger,
    target,
    restoreFocus
  });
}

function closePlanTeamInvitePanel() {
  resetPlanTeamInvitePanel({ restoreFocus: true });
}

async function updatePlanTeamInviteShortcutVisibility() {
  const shortcut = document.getElementById("plan-team-invite-shortcut");
  if (!shortcut) return;

  const requestId = ++planTeamInviteVisibilityRequestId;
  const revealShortcut = () => {
    if (requestId !== planTeamInviteVisibilityRequestId) return;
    shortcut.classList.remove("hidden");
    shortcut.hidden = false;
  };

  const canLoadTeams = state.isSupabaseMode
    && state.supabase
    && typeof window.isReadingTeamPlan === "function"
    && typeof db !== "undefined"
    && typeof db.getMyReadingTeam === "function";
  if (!canLoadTeams) {
    revealShortcut();
    return;
  }

  const eligiblePlans = (state.activePlans || []).filter(plan =>
    !isPlanExpired(plan)
    && (canManageHiddenPlans() || !isPlanHidden(plan))
    && window.isReadingTeamPlan(plan)
  );
  if (eligiblePlans.length === 0) {
    revealShortcut();
    return;
  }

  try {
    const results = await Promise.all(eligiblePlans.map(plan => db.getMyReadingTeam(plan)));
    if (requestId !== planTeamInviteVisibilityRequestId) return;

    // A failed lookup must never hide a useful action. Only hide after every
    // current plan positively reports membership in both supported divisions.
    if (results.some(result => !result || !result.success)) {
      revealShortcut();
      return;
    }

    const contextsByPlan = results.map(result => getJoinedReadingTeamContexts(result.context));
    const shouldHide = shouldHidePlanTeamInviteShortcut(contextsByPlan, [3, 6]);
    shortcut.classList.toggle("hidden", shouldHide);
    shortcut.hidden = shouldHide;

    if (shouldHide && !document.getElementById("join-team-container")?.classList.contains("hidden")) {
      resetPlanTeamInvitePanel();
    }
  } catch (error) {
    console.warn("Unable to update invite-code shortcut visibility:", error);
    revealShortcut();
  }
}

// 每日靈修／小組經營週計畫：純看內容，沒有「每週讀經安排」（章節怎麼分配）
// 跟「重置此計畫進度」（打卡/遍數）的概念，這兩項只對一般讀經計畫有意義。
// 「...」選單是所有計畫共用同一份 DOM，開啟前依目前這份計畫的種類決定要不要
// 藏起來——不能只在進入計畫詳情時做一次，因為按鈕本身之前會在每次點開
// 「...」時無條件重設回顯示，所以要在同一個地方（點開的當下）重新判斷。
function refreshPlanOptionsMenuForKind(plan) {
  const kind = (plan && (plan.planKind || plan.plan_kind)) || "";
  const isViewerOnlyPlan = kind === "devotional" || kind === "group_meeting";
  // 計畫已結束（過了 endDate）→ 每週讀經安排／退出此計畫／重置此計畫進度都會
  // 動到已經定案的歷史紀錄，一律藏起來，只留「計畫詳情」可查看。
  const expired = typeof isPlanExpired === "function" && isPlanExpired(plan);
  const scheduleBtn = document.getElementById("edit-flexible-plan-schedule-btn");
  const deleteBtn = document.getElementById("delete-plan-btn");
  const resetBtn = document.getElementById("reset-plan-progress-btn");
  if (scheduleBtn) scheduleBtn.style.display = (isViewerOnlyPlan || expired) ? "none" : "";
  if (deleteBtn) deleteBtn.style.display = expired ? "none" : "";
  if (resetBtn) resetBtn.style.display = (isViewerOnlyPlan || expired) ? "none" : "";
}

function initPlanControls() {
  ensurePlanRouteShell();
  renderPresetPlansList();

  const planSearchToggle = document.getElementById("btn-toggle-plan-search");
  const planSearchPanel = document.getElementById("plan-search-panel");
  const planSearchInput = document.getElementById("plan-search-input");
  const planSearchClear = document.getElementById("btn-clear-plan-search");

  const refreshPlanSearchResults = () => {
    renderJoinedPlansList();
    renderPresetPlansList();
  };

  const updatePlanSearchQuery = value => {
    planSearchQuery = normalizePlanSearchValue(value);
    if (planSearchClear) planSearchClear.classList.toggle("hidden", !planSearchQuery);
    refreshPlanSearchResults();
  };

  const closePlanSearch = () => {
    if (!planSearchPanel) return;
    planSearchPanel.classList.add("hidden");
    planSearchToggle?.setAttribute("aria-expanded", "false");
    if (planSearchInput && (planSearchInput.value || planSearchQuery)) {
      planSearchInput.value = "";
      updatePlanSearchQuery("");
    }
  };

  if (planSearchToggle && planSearchPanel && planSearchInput && !planSearchToggle._hasPlanSearchListener) {
    planSearchToggle.addEventListener("click", event => {
      event.preventDefault();
      const isOpening = planSearchPanel.classList.contains("hidden");
      if (!isOpening) {
        closePlanSearch();
        return;
      }
      planSearchPanel.classList.remove("hidden");
      planSearchToggle.setAttribute("aria-expanded", "true");
      requestAnimationFrame(() => planSearchInput.focus());
    });
    planSearchToggle._hasPlanSearchListener = true;

    planSearchInput.addEventListener("input", () => updatePlanSearchQuery(planSearchInput.value));
    planSearchInput.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePlanSearch();
      planSearchToggle.focus();
    });

    planSearchClear?.addEventListener("click", () => {
      planSearchInput.value = "";
      updatePlanSearchQuery("");
      planSearchInput.focus();
    });
  }

  const openInviteBtn = document.getElementById("btn-open-plan-team-invite");
  if (openInviteBtn && !openInviteBtn.dataset.planInviteBound) {
    openInviteBtn.dataset.planInviteBound = "true";
    openInviteBtn.addEventListener("click", event => {
      event.preventDefault();
      openPlanTeamInvitePanel();
    });
  }

  const closeInviteBtn = document.getElementById("btn-close-plan-team-invite");
  if (closeInviteBtn && !closeInviteBtn.dataset.planInviteBound) {
    closeInviteBtn.dataset.planInviteBound = "true";
    closeInviteBtn.addEventListener("click", event => {
      event.preventDefault();
      closePlanTeamInvitePanel();
    });
  }

  if (!window.__planTeamInviteVisibilityBound) {
    window.__planTeamInviteVisibilityBound = true;
    window.addEventListener("readingTeam:updated", () => {
      void updatePlanTeamInviteShortcutVisibility();
    });
  }

  const goMyProgressBtn = document.getElementById("go-my-progress-btn");
  if (goMyProgressBtn) {
    goMyProgressBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      snapCalendarToMyProgress();
    });
  }

  const goTodayPlanBtn = document.getElementById("go-today-plan-btn");
  if (goTodayPlanBtn) {
    goTodayPlanBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      snapCalendarToToday();
    });
  }

  // Back Button
  const backBtn = document.getElementById("btn-back-to-plans");
  if (backBtn && !backBtn.dataset.listenerBound) {
    backBtn.dataset.listenerBound = "true";
    backBtn.addEventListener("click", () => {

      state.activePlan = null;
      if (typeof window.syncActivePlanContext === 'function') window.syncActivePlanContext(null);
      localStorage.removeItem("selected_plan_key");
      setPlanState(PLAN_ROUTE.LIST);
    });
  }
  // Options Dropdown Menu Toggle
  const optionsBtn = document.getElementById("btn-plan-options");
  const dropdown = document.getElementById("plan-options-dropdown");
  if (optionsBtn && dropdown) {
    if (!optionsBtn.dataset.dropdownBound) {
      optionsBtn.dataset.dropdownBound = "true";
      optionsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        refreshPlanOptionsMenuForKind(state.activePlan);
        dropdown.classList.toggle("hidden");
      });
    }
    if (!window._planDropdownClickListenerBound) {
      window._planDropdownClickListenerBound = true;
      document.addEventListener("click", () => {
        const dd = document.getElementById("plan-options-dropdown");
        if (dd) dd.classList.add("hidden");
      });
    }
  }


  const planDetailsButton = document.getElementById("view-plan-details-btn");
  if (planDetailsButton) {
    planDetailsButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const dropdown = document.getElementById("plan-options-dropdown");
      if (dropdown) dropdown.classList.add("hidden");
      openPlanDetailsDialog(state.activePlan);
    });
  }

  const flexibleScheduleMenuButton = document.getElementById("edit-flexible-plan-schedule-btn");
  if (flexibleScheduleMenuButton) {
    flexibleScheduleMenuButton.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const plan = state.activePlan;
      if (!plan) return;
      const dropdown = document.getElementById("plan-options-dropdown");
      if (dropdown) dropdown.classList.add("hidden");
      if (isPlanExpired(plan)) {
        showToast("此計畫已結束，無法再調整每週讀經安排。");
        return;
      }
      const scheduleSettings = await openFlexibleScheduleDialog(plan, { editing: true });
      if (!scheduleSettings) return;
      const result = await db.updateFlexiblePlanSchedule(plan, scheduleSettings);
      if (!result || !result.success) {
        showToast("儲存每週安排失敗：" + ((result && result.error && result.error.message) || "請稍後再試"));
        return;
      }
      showToast("每週讀經安排已更新，章節已重新分配。");
      renderPlanScheduleView();
      await renderPlanScheduleTracker();
    });
  }

  // Abandon Plan Button inside options dropdown
  const deleteBtn = document.getElementById("delete-plan-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!state.activePlan) return;
      if (isPlanExpired(state.activePlan)) {
        showToast("此計畫已結束，僅供查看紀錄與統計，無法再退出。");
        return;
      }
      const confirmed = await window.showConfirmDialog({
        title: "確定要放棄目前的讀經計畫嗎？",
        message: "您的已讀進度紀錄仍會保留，之後您可以隨時重新加入。",
        confirmText: "確定放棄",
        cancelText: "保留計畫",
        isDestructive: true
      });
      if (!confirmed) return;
      await db.leavePlan(state.activePlan.id, state.activePlan.presetKey);
    });
  }

  // Reset Plan Progress Button inside options dropdown
  const resetProgressBtn = document.getElementById("reset-plan-progress-btn");
  if (resetProgressBtn) {
    resetProgressBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const menu = document.getElementById("plan-options-dropdown");
      if (menu) menu.classList.add("hidden");
      if (!state.activePlan) return;
      if (isPlanExpired(state.activePlan)) {
        showToast("此計畫已結束，僅供查看紀錄與統計，無法再重置進度。");
        return;
      }
      const planName = state.activePlan.name;
      const confirmed = await window.showConfirmDialog({
        title: `確定要重置「${planName}」的進度嗎？`,
        message: "重置後，此計畫的所有打卡紀錄都將會被清除，且無法復原。",
        confirmText: "確定重置",
        cancelText: "保留進度",
        isDestructive: true
      });
      if (!confirmed) return;

      loader.show("正在重置計畫進度...");
      try {
        const plan = state.activePlan;
        const planId = plan.id;

        // 1. Clear the persisted logs before changing local state. A Supabase
        // enrollment always has a UUID, so never query a non-existent preset_key
        // column on reading_logs.
        if (state.isSupabaseMode && state.supabase) {
          const user = await db.getCurrentDbUser();
          if (!user || !user.id || !planId) throw new Error("找不到可重置的讀經計畫資料");
          const cacheKey = `reading_logs:${user.id}`;
          const applyDeleteFilters = query => query.eq("user_id", user.id).eq("plan_id", planId);
          const deleteResult = window.readingLogRepository
            ? await window.readingLogRepository.delete(applyDeleteFilters, { invalidate: [cacheKey] })
            : await applyDeleteFilters(state.supabase.from("reading_logs").delete());
          if (deleteResult && deleteResult.error) {
            throw new Error(deleteResult.error.message || deleteResult.error.error || String(deleteResult.error));
          }

          const { error: planResetError } = await state.supabase
            .from("reading_plans")
            .update({
              current_round: 1,
              upgrade_prompt_handled: false
            })
            .eq("id", planId)
            .eq("user_id", user.id);
          if (planResetError) throw planResetError;
        }

        // 2. Only update memory after the server reset succeeds.
        state.readingLogs = removePlanReadingLogs(state.readingLogs, plan);
        resetPlanProgressState(plan);
        rebuildPlanSchedule(plan);
        const firstReadingDay = (plan.days || []).find(day => (day.chapters || []).some(ch => Number(ch.round || 1) === 1));
        if (firstReadingDay) state.selectedPlanDay = firstReadingDay.dayNum;
        db.invalidateMergedUsersCache();

        // 3. Save to localStorage (if local/demo mode)
        if (!state.isSupabaseMode) {
          localStorage.setItem("reading_logs", JSON.stringify(state.readingLogs || []));
          localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans || []));
        }

        // 3b. Reset corresponding badges associated with this plan
        cleanPlanAssociatedBadges(plan);

        // 4. Update UI
        if (typeof calculatePlanProgress === "function") {
          calculatePlanProgress();
        }
        window.setDataVersion(prev => prev + 1);
        window.dispatchEvent(new CustomEvent("app:dataRefresh", { detail: { scope: "plan" } }));

        showToast("已成功重置計畫進度！");
        
        // Reload the plan detail view to reflect the 0% progress
        if (typeof window.setPlanState === 'function') {
          await window.setPlanState(PLAN_ROUTE.DETAIL);
        } else {
          renderPlanView();
        }
      } catch (err) {
        console.error("Failed to reset plan progress:", err);
        showToast("重置失敗：" + (err.message || err));
      } finally {
        loader.hide();
      }
    });
  }

  const _canSeeMembers = canUseAdvancedGroupStats();
  const innerAdminTab = document.getElementById("stats-inner-tab-admin");
  if (innerAdminTab) forceHidden(innerAdminTab, !_canSeeMembers);
  function closePlanOptionsMenu() {
    const menu = document.getElementById("plan-options-dropdown");
    if (menu) menu.classList.add("hidden");
  }

  function bindPlanMenuItem(id, handler) {
    const item = document.getElementById(id);
    if (!item) return;
    item.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handler();
      closePlanOptionsMenu();
    });
  }



  bindPlanMenuItem("menu-plan-stats", async () => {
    await window.PlanPageController.switchPage(PLAN_PAGE.GROUP);
    await showPlanGroupSubview(GROUP_SUBVIEW.STATS);
  });

  bindPlanMenuItem("menu-plan-ranking", async () => {
    await window.PlanPageController.switchPage(PLAN_PAGE.GROUP);
    await showPlanGroupSubview(GROUP_SUBVIEW.RANKING);
  });


  const membersMenuItem = document.getElementById("menu-plan-members");
  if (membersMenuItem) membersMenuItem.style.display = _canSeeMembers ? "" : "none";
  bindPlanMenuItem("menu-plan-members", async () => {
    if (!_canSeeMembers) return;
    await window.PlanPageController.switchPage(PLAN_PAGE.GROUP);
    await showPlanGroupSubview(GROUP_SUBVIEW.STATS);
  });
  // Category Pills filters inside Plan List Page
  const listPills = document.querySelectorAll("#plan-list-status-pills .pill-btn");
  listPills.forEach(pill => {
    pill.addEventListener("click", () => {
      listPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      openInviteBtn?.setAttribute("aria-expanded", "false");
      const filter = pill.getAttribute("data-filter");

      const joinedContainer = document.getElementById("joined-plans-list-container");
      const presetContainer = document.getElementById("preset-plans-list-container");
      const joinTeamContainer = document.getElementById("join-team-container");

      if (joinTeamContainer) joinTeamContainer.classList.add("hidden");
      // 側欄與各卡依分頁顯示（#409）；清單渲染可能因資料未就緒提早 return，
      // 所以切換當下先算一次，不靠清單渲染順帶更新。
      updatePlanSidebarIntroCardVisibility();

      if (filter === "saved") {
        if (joinedContainer) joinedContainer.classList.add("hidden");
        if (presetContainer) presetContainer.classList.remove("hidden");
        renderPresetPlansList();
      } else {
        if (joinedContainer) joinedContainer.classList.remove("hidden");
        if (presetContainer) presetContainer.classList.add("hidden");
        renderJoinedPlansList();
      }
    });
  });

  // 系列篩選 pill（全部 / 速讀 / 靈修 / 小組 / 其他）—— 整排只在靈修或小組任一可見時才出現
  document.querySelectorAll("#plan-list-series-pills .pill-btn--series").forEach(pill => {
    pill.addEventListener("click", () => {
      setActivePlanSeries(pill.getAttribute("data-series"));
    });
  });

  // Action button: Start Reading Today
  const startReadingBtn = document.getElementById("btn-start-reading-today");
  if (startReadingBtn) {
    startReadingBtn.addEventListener("click", () => {
      if (!state.activePlan || !state.selectedPlanDay) return;
      const day = state.activePlan.days.find(d => d.dayNum === state.selectedPlanDay);
      const currentRound = Number(state.activePlan.currentRound || 1);
      const chapters = (day && day.chapters || []).filter(ch => Number(ch.round || currentRound) === currentRound);
      if (chapters.length === 0) return;

      const firstUnread = chapters.find(ch => !ch[`isReadR${currentRound}`]) || chapters[0];
      window.openPlanInlineReader(firstUnread.book, firstUnread.chapter, state.selectedPlanDay, firstUnread.round || 1);
    });
  }
}





async function renderPlanView() {
  if (typeof appRouter !== "undefined" && appRouter.currentTab && appRouter.currentTab !== "plan-view") {
    return;
  }
  try {
    if (state.activePlan && isPlanHidden(state.activePlan) && !canManageHiddenPlans()) {
      const nextVisiblePlan = (state.activePlans || []).find(plan => !isPlanHidden(plan));
      state.activePlan = nextVisiblePlan || null;
      if (state.activePlan) localStorage.setItem("selected_plan_key", state.activePlan.presetKey || state.activePlan.id || "");
      else localStorage.removeItem("selected_plan_key");
    }

    renderJoinedPlansList();
    renderPresetPlansList();
    void updatePlanTeamInviteShortcutVisibility();

    ensurePlanRouteShell();

    if (window.currentPlanViewState === PLAN_ROUTE.ORG_STATS) {
      window.currentPlanViewState = PLAN_ROUTE.LIST;
      state.planDetailOpen = false;
    }

    if (state.activePlan && state.planDetailOpen) {
      const groupViews = [GROUP_SUBVIEW.PERSONAL, GROUP_SUBVIEW.STATS, GROUP_SUBVIEW.RANKING, "group"];
      if (groupViews.includes(state.planActiveSubTab)) {
        if (window.PlanPageController && state.planActiveSubTab !== "group") {
          window.PlanPageController.groupSubview = state.planActiveSubTab;
        }
        await setPlanState(PLAN_ROUTE.GROUP);
      } else {
        await setPlanState(PLAN_ROUTE.DETAIL);
      }
    } else {
      await setPlanState(PLAN_ROUTE.LIST);
    }

    // System administrator controls use the UUID-backed role definition.
    const isSystemAdmin = getUserRoleCode(state.currentUser) === "admin";
    const adminCard = document.getElementById("admin-plan-card");
    if (adminCard) {
      adminCard.classList.toggle("hidden", !isSystemAdmin);
    }

    // 計畫增刪改卡片在 plan-admin.js（只有管理員會載入的 chunk）；還沒載入就先跳過，
    // 載入時它會自己補畫一次。
    if (isSystemAdmin && planAdminRenderer) {
      planAdminRenderer();
    }

    if (state.activePlan && isPlanHidden(state.activePlan) && canManageHiddenPlans()) {
      showToast("這個計畫目前已隱藏，一般使用者不會看到。");
    }

    // NOTE: updateNavigationChrome() is intentionally NOT called here.
    // It is the exclusive responsibility of app.js switchTab to call it
    // once, after all async rendering is fully complete.
  } catch (err) {
    console.error("Critical error inside renderPlanView:", err);
  }
}



function getResolvedPresetKey(plan) {
  if (!plan) return null;
  return plan.presetKey || plan.globalPlanId || plan.id || plan.name || null;
}

function getPlanCoverColor(plan) {
  const covers = window.NLC_PLAN_COVERS || ["#B8E8F5", "#C8F5D8", "#FFE4CC", "#D4E4F7", "#E8E0F5", "#F7D4E4", "#F4F7D4", "#E4D4F7", "#D4F7F2"];
  const key = String(getResolvedPresetKey(plan) || "");
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  return covers[Math.abs(hash) % covers.length] || covers[0];
}

function getPlanCoverHtml(plan) {
  const bg = getPlanCoverColor(plan);
  const isCampaign = plan && (
    plan.planKind === "church_campaign"
    || window.isCampaignStagePlan(plan)
    || plan.id === window.CHURCH_CAMPAIGN_ID
    || plan.globalPlanId === window.CHURCH_CAMPAIGN_ID
  );
  const campaignStageNo = plan && window.isCampaignStagePlan(plan)
    ? Number(plan.stageNo || plan.campaignDefinition && plan.campaignDefinition.stageNo || 0)
    : 0;
  if (campaignStageNo) {
    return `<div class="plan-cover-thumbnail plan-cover-thumbnail--icon" style="background: color-mix(in srgb, var(--primary-color) 8%, var(--bg-card)); color: var(--primary-color); border-color: color-mix(in srgb, var(--primary-color) 24%, var(--border-card));">
      <span class="nlc-icon nlc-icon--sm" data-icon="calendarThirty" aria-hidden="true"></span>
    </div>`;
  }

  const label = isCampaign ? "66卷" : escapeHTML(String(plan && plan.name || "讀經").slice(0, 2));
  return `<div class="plan-cover-thumbnail" style="background: ${bg};">${label}</div>`;
}

function renderPlanCardHeader({ eyebrow = "", title = "", meta = "", description = "", titleTrailing = "" } = {}) {
  return `
    <div class="plan-card__header">
      ${eyebrow ? `<div class="plan-card__eyebrow">${eyebrow}</div>` : ""}
      <div class="plan-card__title-row">
        <h4 class="plan-card__title">${title}</h4>
        ${titleTrailing ? `<div class="plan-card__title-trailing">${titleTrailing}</div>` : ""}
      </div>
      ${meta ? `<div class="plan-card__meta">${meta}</div>` : ""}
      ${description ? `<p class="plan-card__description">${description}</p>` : ""}
    </div>
  `;
}

// 卡片精簡：進度用大數字當主角，取代「進度：」整行文字；徽章/獎項狀態
// 改用 .stat-badge（跟排行榜共用同一套 tone 配色），不再用整行 icon+標籤+值。
function renderPlanCardProgressHero({ value = "", caption = "", tone = "neutral" } = {}) {
  if (!value) return "";
  return `
    <div class="plan-card__progress-hero plan-card__progress-hero--${escapeHTML(tone)}">
      <span class="plan-card__progress-hero-value">${value}</span>
      ${caption ? `<span class="plan-card__progress-hero-caption">${caption}</span>` : ""}
    </div>
  `;
}

function renderPlanCardBadge({ icon = "", label = "", tone = "neutral" } = {}) {
  if (!label) return "";
  const iconHtml = icon ? `<span class="nlc-icon nlc-icon--sm" data-icon="${escapeHTML(icon)}" aria-hidden="true"></span>` : "";
  return `<span class="stat-badge stat-badge--${escapeHTML(tone)} plan-card__badge">${iconHtml}<span>${label}</span></span>`;
}

function renderPlanCardBadgeRow(badges = []) {
  const html = badges.filter(Boolean).join("");
  return html ? `<div class="plan-card__badges">${html}</div>` : "";
}

function renderPlanCardStatusSummary(items = []) {
  const rows = items.filter(Boolean).map(item => `
    <div class="plan-card__status-row ${item.tone ? `plan-card__status-row--${escapeHTML(item.tone)}` : ""}">
      ${item.icon ? `<span class="nlc-icon nlc-icon--sm" data-icon="${escapeHTML(item.icon)}" aria-hidden="true"></span>` : ""}
      <span class="plan-card__status-label">${item.label ? `${escapeHTML(item.label)}：` : ""}</span>
      <span class="plan-card__status-value">${item.value || ""}</span>
    </div>
  `).join("");

  if (!rows) return "";
  return `<div class="plan-card__status">${rows}</div>`;
}

function renderPlanCardActions(actions = []) {
  const buttons = actions.filter(Boolean).map(action => {
    const kind = action.kind === "primary" ? "primary" : "secondary";
    const buttonClass = kind === "primary" ? "primary-btn plan-card-action-btn" : "secondary-btn plan-card-action-btn";
    const icon = action.icon ? `<span class="nlc-icon nlc-icon--sm" data-icon="${escapeHTML(action.icon)}" aria-hidden="true"></span>` : "";
    const dataAction = action.action ? ` data-plan-card-action="${escapeHTML(action.action)}"` : "";
    return `
      <button type="button" class="plan-card__${kind}-action ${buttonClass}"${dataAction}>
        ${icon}<span>${escapeHTML(action.label || "")}</span>
      </button>
    `;
  }).join("");

  if (!buttons) return "";
  return `<div class="plan-card__actions plan-card-participation-actions">${buttons}</div>`;
}

function renderPlanCardShell({ plan, variant = "", header = "", status = "", progress = "", actions = "", after = "", trailing = "" } = {}) {
  const variantClass = variant ? ` plan-card--${escapeHTML(variant)}` : "";
  return `
    ${getPlanCoverHtml(plan)}
    <div class="plan-card__main${variantClass}">
      ${header}
      ${status}
      ${progress}
      ${actions}
      ${after}
    </div>
    ${trailing}
  `;
}

function normalizePlanSearchValue(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    .replace(/\s+/g, " ")
    .trim();
}

function getPlanSearchText(plan) {
  if (!plan) return "";
  const stageNo = Number(plan.stageNo || plan.campaignDefinition && plan.campaignDefinition.stageNo || 0);
  const roundNo = Number(plan.roundNo || plan.campaignDefinition && plan.campaignDefinition.roundNo || 0);
  const bookNames = Array.isArray(plan.books)
    ? plan.books.map(book => typeof book === "string" ? book : book && (book.name || book.book)).filter(Boolean)
    : [];
  return normalizePlanSearchValue([
    plan.name,
    plan.description,
    plan.awardName,
    plan.presetKey,
    stageNo ? `第${stageNo}階段 ${stageNo}階段` : "",
    roundNo ? `第${roundNo}輪 ${roundNo}輪` : "",
    ...bookNames
  ].filter(Boolean).join(" "));
}

function matchesPlanSearch(plan) {
  if (!planSearchQuery) return true;
  return getPlanSearchText(plan).includes(planSearchQuery);
}

// ── 計畫「系列」分類 ────────────────────────────────────────────────
function getPlanSeries(plan) {
  const kind = plan && (plan.planKind || plan.plan_kind);
  if (kind === "devotional") return "devotional";
  if (kind === "group_meeting") return "group_meeting";
  if (kind === "church_campaign" || kind === "church_campaign_stage" || kind === "church_campaign_stage_cohort") return "campaign";
  return "other"; // 沒有 plan_kind 的一般自建讀經計畫
}

function matchesPlanSeries(plan) {
  if (!activePlanSeries || activePlanSeries === "all") return true;
  return getPlanSeries(plan) === activePlanSeries;
}

// 這個使用者「實際看得到」的計畫系列集合（含已加入 + 探索 + 靈修/小組 viewer-only）。
// devotional / group_meeting 走各自的 visibility helper（內含 devotionGroupHidden 硬閘）。
function getVisiblePlanSeriesSet() {
  const set = new Set();
  const consider = plan => {
    if (!plan) return;
    const series = getPlanSeries(plan);
    if (series === "devotional") {
      if (typeof isDevotionalPlanVisibleToUser === "function" && !isDevotionalPlanVisibleToUser(plan)) return;
    } else if (series === "group_meeting") {
      if (typeof isGroupMeetingPlanVisibleToUser === "function" && !isGroupMeetingPlanVisibleToUser(plan)) return;
    }
    set.add(series);
  };
  (state.activePlans || []).forEach(consider);
  (state.globalPlans || []).forEach(consider);
  return set;
}

// 依「有哪些系列看得到」決定：整排 pill 顯不顯示、個別 pill 顯不顯示。
// 規則：靈修或小組任一可見 → 顯示整排；否則整排隱藏（不預先讓使用者知道有這功能）。
function updateSeriesPillRowVisibility() {
  const row = document.getElementById("plan-list-series-pills");
  if (!row) return;
  const seriesSet = getVisiblePlanSeriesSet();
  const showRow = seriesSet.has("devotional") || seriesSet.has("group_meeting");
  row.hidden = !showRow;
  if (!showRow) {
    if (activePlanSeries !== "all") setActivePlanSeries("all", { rerender: false });
    return;
  }
  row.querySelectorAll(".pill-btn--series").forEach(btn => {
    const series = btn.getAttribute("data-series");
    btn.hidden = series !== "all" && !seriesSet.has(series);
  });
  // 目前選的系列 pill 被藏了（例如計畫結束了）→ 回到「全部」
  const activeBtn = row.querySelector(`.pill-btn--series[data-series="${activePlanSeries}"]`);
  if (activePlanSeries !== "all" && (!activeBtn || activeBtn.hidden)) {
    setActivePlanSeries("all", { rerender: false });
  }
  row.querySelectorAll(".pill-btn--series").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-series") === activePlanSeries);
  });
}

function setActivePlanSeries(series, { rerender = true } = {}) {
  activePlanSeries = series || "all";
  try { sessionStorage.setItem("plan_list_series", activePlanSeries); } catch (_e) {}
  const row = document.getElementById("plan-list-series-pills");
  row?.querySelectorAll(".pill-btn--series").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-series") === activePlanSeries);
  });
  if (rerender) {
    renderJoinedPlansList();
    renderPresetPlansList();
  }
}

function getPlanStartCountdownText(plan) {
  if (!plan || !plan.startDate) return "";
  const parts = plan.startDate.split("-");
  if (parts.length !== 3) return `預計 ${escapeHTML(plan.startDate)} 開始`;
  
  const startYear = parseInt(parts[0], 10);
  const startMonth = parseInt(parts[1], 10) - 1;
  const startDay = parseInt(parts[2], 10);
  
  const start = new Date(startYear, startMonth, startDay);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const diffTime = start.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays <= 0) {
    return "今天開始";
  }
  return `${diffDays} 天後開始`;
}

function getPlanStorageKey(plan) {
  return plan && (plan.presetKey || plan.globalPlanId || plan.id || "");
}

async function openJoinedPlanProgress(plan) {
  if (!plan) return;
  delete plan.upgradeOverlayDismissedRound;
  state.activePlan = plan;
  // 「最近開啟的計畫」時間戳（#349）：讀經頁沒有計畫情境時，用它在多個含這章的計畫裡挑一個。
  recordPlanOpened(plan);
  state.planDetailOpen = true;
  state.planActiveSubTab = "today";
  window.currentPlanViewState = PLAN_ROUTE.DETAIL;
  if (typeof window.syncActivePlanContext === "function") window.syncActivePlanContext(plan);
  state.selectedPlanDay = null;
  localStorage.setItem("selected_plan_key", getPlanStorageKey(plan));
  if (isPlanExpired(plan)) showToast(getPlanEndedNotice(plan.endDate));
  if (typeof window.setPlanState === "function") {
    await window.setPlanState(PLAN_ROUTE.DETAIL);
  } else {
    await renderPlanView();
  }
}

async function openJoinedPlanTeam(plan) {
  await openJoinedPlanProgress(plan);
  if (window.PlanPageController) {
    await window.PlanPageController.switchPrimaryView(PLAN_PRIMARY_VIEW.STATS);
  }
}

async function confirmPlanJoin({ plan, mode, onConfirm }) {
  return new Promise(resolve => {
    const ElementCtor = window.HTMLElement || Element;
    const previousActiveElement = document.activeElement instanceof ElementCtor
      ? document.activeElement
      : null;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay plan-join-confirmation-overlay";
    overlay.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:var(--z-modal,700);";

    const title = mode === "team" ? "要和夥伴一起開始嗎？" : "要加入這個讀經計畫嗎？";
    const description = mode === "team"
      ? "你可以先選擇 3 人或 6 人團隊；建立後再把邀請碼分享給朋友。"
      : "加入後就能在首頁看到今天進度，也可以之後再加入團隊。";
    const confirmLabel = mode === "team" ? "選擇團隊人數" : "太好了，開始吧";

    overlay.innerHTML = `
      <section class="plan-join-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-join-confirmation-title" aria-describedby="plan-join-confirmation-description" tabindex="-1">
        <header class="plan-join-confirmation-dialog__header">
          <p class="plan-join-confirmation-dialog__eyebrow">${escapeHTML(plan.name || "讀經計畫")}</p>
          <h3 id="plan-join-confirmation-title">${title}</h3>
          <p id="plan-join-confirmation-description">${description}</p>
        </header>
        <footer class="plan-join-confirmation-dialog__footer">
          <p class="plan-join-confirmation-dialog__error" data-plan-confirm-error hidden></p>
          <button type="button" class="secondary-btn plan-join-confirmation-dialog__cancel" data-plan-confirm-cancel>我再看看</button>
          <button type="button" class="primary-btn plan-join-confirmation-dialog__confirm" data-plan-confirm-action>${confirmLabel}</button>
        </footer>
      </section>`;

    const panel = overlay.firstElementChild;
    const cancelButton = overlay.querySelector("[data-plan-confirm-cancel]");
    const confirmButton = overlay.querySelector("[data-plan-confirm-action]");
    const errorMessage = overlay.querySelector("[data-plan-confirm-error]");
    let settled = false;
    const focusableSelector = [
      "button:not([disabled])",
      "[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])'
    ].join(",");
    const focusableElements = () => Array.from(overlay.querySelectorAll(focusableSelector))
      .filter(element => element instanceof ElementCtor && !element.hidden);
    const close = value => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      if (previousActiveElement && document.contains(previousActiveElement)) {
        previousActiveElement.focus();
      }
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key === "Escape") close(false);
      if (event.key !== "Tab") return;

      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    overlay.addEventListener("click", event => {
      if (event.target === overlay) close(false);
    });
    cancelButton.addEventListener("click", () => close(false));
    confirmButton.addEventListener("click", async () => {
      confirmButton.disabled = true;
      if (errorMessage) {
        errorMessage.hidden = true;
        errorMessage.textContent = "";
      }
      try {
        await onConfirm();
        close(true);
      } catch (err) {
        console.error("Plan join confirmation failed:", err);
        if (!overlay.isConnected) return;
        if (errorMessage) {
          errorMessage.textContent = "暫時無法加入，請再試一次。";
          errorMessage.hidden = false;
        }
        confirmButton.disabled = false;
        confirmButton.focus();
      }
    });
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
    if (typeof hydrateIcons === "function") hydrateIcons(overlay);
    (cancelButton || panel).focus();
  });
}

async function joinPlanSoloFromCard(plan, key) {
  const defaultSchedule = { readingDaysPerWeek: 7, restWeekdays: [] };
  const joinedPlan = await db.joinPresetPlan(key, defaultSchedule);
  if (joinedPlan) await openJoinedPlanProgress(joinedPlan);
  return joinedPlan;
}

// 探索計畫的「加入計畫」：上一個計畫的隊長可以直接帶隊加入（#321），
// 不能帶隊（或選「只有我自己加入」）就走原本的個人加入。
async function joinPlanFromExplore(plan, key) {
  if (typeof window.offerReadingTeamCarryoverOnJoin === "function") {
    const choice = await window.offerReadingTeamCarryoverOnJoin(plan);
    if (choice === null) return;
    if (choice === "carried") {
      // 帶隊時後端已經替隊長和隊員加入了計畫；重新載入讓計畫清單與團隊狀態一致。
      window.location.reload();
      return;
    }
    // "none" / "solo"：照原本的個人加入確認流程。
  }
  await confirmPlanJoin({
    plan,
    mode: "solo",
    onConfirm: async () => {
      await joinPlanSoloFromCard(plan, key);
    }
  });
}

function getJoinedPlanStartTime(plan) {
  if (!plan || !plan.startDate) return Number.MAX_SAFE_INTEGER;
  const date = new Date(`${plan.startDate}T00:00:00`);
  const time = date.getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function sortJoinedPlansChronologically(plans) {
  return [...(plans || [])].sort((left, right) => {
    const leftStart = getJoinedPlanStartTime(left);
    const rightStart = getJoinedPlanStartTime(right);
    if (leftStart !== rightStart) return leftStart - rightStart;

    const leftStage = Number(left && (left.stageNumber || left.stage || left.stageIndex) || 0);
    const rightStage = Number(right && (right.stageNumber || right.stage || right.stageIndex) || 0);
    if (leftStage !== rightStage) return leftStage - rightStage;

    return String(left && left.name || "").localeCompare(String(right && right.name || ""), "zh-Hant");
  });
}

function renderPlanParticipationItem(model) {
  if (!model) return "";
  const classes = `plan-card-participation-item plan-card-participation-item--${escapeHTML(model.variant)} plan-card-participation-item--${escapeHTML(model.tone)}`;
  const media = `
    <span class="plan-card-participation-item__media" aria-hidden="true">
      <span class="nlc-icon nlc-icon--sm" data-icon="${escapeHTML(model.icon)}"></span>
    </span>
  `;
  const content = `
    <span class="plan-card-participation-item__content">
      <span class="plan-card-participation-item__title">${escapeHTML(model.title)}</span>
      ${model.description ? `<span class="plan-card-participation-item__description">${escapeHTML(model.description)}</span>` : ""}
    </span>
  `;

  // 沒有動作可做（例如兩隊都滿）：安靜顯示狀態就好，不做成按鈕。
  if (!model.action) {
    return `<div class="${classes}">${media}${content}</div>`;
  }

  // 整排都能點，取代原本只有右側一顆小按鈕——觸控範圍更大，尾端一個箭頭
  // 提示可點，跟卡片本體那個箭頭是同一套視覺語言。
  return `
    <button
      type="button"
      class="${classes} plan-card-participation-item--actionable"
      data-plan-participation-action="${escapeHTML(model.action.action)}"
      data-plan-participation-division="${escapeHTML(String(model.action.division || ""))}"
    >
      ${media}${content}
      <span class="plan-card-participation-item__actions" aria-hidden="true">
        <span class="nlc-icon nlc-icon--sm" data-icon="chevronRight"></span>
      </span>
    </button>
  `;
}

function bindPlanParticipationItemActions(card, plan, model) {
  if (!card || !plan || !model || !model.action) return;
  card.querySelectorAll("[data-plan-participation-action]").forEach(button => {
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const action = button.getAttribute("data-plan-participation-action");
      const division = Number(button.getAttribute("data-plan-participation-division") || model.action.division || 3);

      if (action === "open-team") {
        await openJoinedPlanTeam(plan);
        return;
      }

      if (
        (action === "join-team-division" || action === "open-team-dialog")
        && typeof window.openReadingTeamDialog === "function"
      ) {
        await window.openReadingTeamDialog(plan, { preferredDivision: division });
      }
    });
  });
}

// 「每日陪你靈修」歡迎卡（計畫分頁側欄，靜態文案：邀請去探索計畫）：只有在
// 使用者完全沒有任何計畫——一般讀經、每日靈修、小組聚會通通沒有——才顯示，
// 已經有任何一種計畫的話，這句「歡迎加入」文案就顯得多餘/矛盾。
function userHasNoPlanAtAll() {
  if ((state.activePlans || []).length > 0) return false;
  const hasVisibleDevotional = (state.globalPlans || []).some(gp =>
    (gp.planKind || gp.plan_kind) === "devotional" && isDevotionalPlanVisibleToUser(gp)
  );
  if (hasVisibleDevotional) return false;
  const hasVisibleGroupMeeting = (state.globalPlans || []).some(gp =>
    (gp.planKind || gp.plan_kind) === "group_meeting"
    && typeof isGroupMeetingPlanVisibleToUser === "function" && isGroupMeetingPlanVisibleToUser(gp)
  );
  return !hasVisibleGroupMeeting;
}

// 歡迎卡只在「我的計畫」、「全域計畫管理」只在「探索計畫」、「已結束」整欄隱藏
// （見 plan-sidebar-visibility.mjs，#409）。邀請碼卡與管理卡的分頁條件由 CSS 讀
// #plan-list-subview[data-active-filter]，和它們各自依組隊／角色切換的 hidden 分開。
// 兩份清單（joined/preset）各自渲染時都會呼叫這裡，且各自從 DOM 讀目前作用中的
// 分頁，所以不管先渲染哪一份都能算對。
function updatePlanSidebarIntroCardVisibility() {
  const activePill = document.querySelector("#plan-list-status-pills .pill-btn.active");
  const filter = activePill ? activePill.getAttribute("data-filter") : "mine";
  const listSubview = document.getElementById("plan-list-subview");
  if (listSubview) listSubview.dataset.activeFilter = filter;
  applyPlanSidebarVisibility({
    sidebar: document.getElementById("plan-sidebar-info-card"),
    introCard: document.getElementById("plan-sidebar-intro-card"),
    filter,
    hasAnyPlan: !userHasNoPlanAtAll(),
    isSystemAdmin: getUserRoleCode(state.currentUser) === "admin"
  });
}

// 靈修影片連結只存网址，縮圖用 YouTube 自家公開的縮圖 CDN 現拼現算
// （img.youtube.com/vi/<id>/...），不用呼叫任何 API、不用金鑰——只是把網址
// 裡的 video id 抽出來組另一個網址而已。抽不出 id（例如貼的不是 YouTube 連結）
// 就沒有縮圖，退回純文字連結。
function extractYoutubeVideoId(url) {
  try {
    const u = new URL(String(url || ""));
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const match = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/);
      if (match) return match[1];
    }
  } catch (_) { /* not a valid URL */ }
  return null;
}

function formatPlanDurationLabel(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "日期尚未公布";
  const days = Math.max(1, Math.ceil((end - start) / 86400000) + 1);
  return days >= 365 ? `${startDate} ～ ${endDate}` : `共 ${days} 天`;
}

// 每日靈修／小組聚會週計畫的卡片：只看內容，沒有「加入」，所以沒有進度條、
// 沒有加入/建立團隊按鈕，只有一顆「預覽內容」。這種計畫本來會出現在「探索
// 計畫」，現在改放進「我的計畫」（見下面 renderJoinedPlansList），這裡抽成
// 共用函式，避免兩份清單各自維護一份、之後行為兜不起來。
function buildViewerOnlyPlanCard(plan) {
  const isDevotional = (plan.planKind || plan.plan_kind) === "devotional";
  const isGroupMeeting = (plan.planKind || plan.plan_kind) === "group_meeting";
  const devDevMode = isDevotional && window.isDevotionalPlanDevMode(plan);
  const gmDevMode = isGroupMeeting && typeof window.isGroupMeetingPlanDevMode === "function" && window.isGroupMeetingPlanDevMode(plan);
  const viewerDevMode = devDevMode || gmDevMode;
  const scheduleLabel = isDevotional
    ? `每日靈修・${formatPlanDurationLabel(plan.startDate, plan.endDate)}`
    : "小組聚會・週計畫";
  const description = plan.description || "";

  const card = document.createElement("div");
  card.className = "plan-card joined-plan-item-card" + (viewerDevMode ? " plan-card--dev" : "");
  card.innerHTML = renderPlanCardShell({
    plan,
    variant: "available",
    header: renderPlanCardHeader({
      title: escapeHTML(plan.name)
        + (viewerDevMode ? ' <span class="plan-card__dev-badge">開發中・只有你看得到</span>' : ""),
      meta: `
        <span class="nlc-icon nlc-icon--sm" data-icon="calendarThirty" aria-hidden="true"></span>
        <span>${escapeHTML(scheduleLabel)}</span>
      `,
      description: description ? escapeHTML(description) : ""
    }),
    status: renderPlanCardStatusSummary([
      viewerDevMode && {
        icon: "lock",
        label: "開放狀態",
        value: "開發中，尚未對會友開放（只有你看得到）",
        tone: "warning"
      }
    ])
    // 沒有 actions：整張卡片可點擊直接進去，再放一顆「預覽內容」按鈕是多餘的。
  });

  card.onclick = () => {
    if (isDevotional && typeof window.previewDevotionalPlanAsMember === "function") {
      window.previewDevotionalPlanAsMember(plan.globalPlanId || plan.id);
    } else if (isGroupMeeting && typeof window.previewGroupMeetingPlanAsMember === "function") {
      window.previewGroupMeetingPlanAsMember(plan.globalPlanId || plan.id);
    }
  };

  return card;
}

function renderJoinedPlansList() {
  try {
    const container = document.getElementById("joined-plans-list");
    if (!container) return;

    if (!state.activePlans) {
      ComponentSkeletonLoader.show('plan', container);
      return;
    }

    container.innerHTML = "";

    const activePill = document.querySelector("#plan-list-status-pills .pill-btn.active");
    const filter = activePill ? activePill.getAttribute("data-filter") : "mine";
    updatePlanSidebarIntroCardVisibility();
    updateSeriesPillRowVisibility();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isExpired = (plan) => {
      if (!plan || !plan.endDate) return false;
      const end = new Date(plan.endDate);
      end.setHours(0, 0, 0, 0);
      return today > end;
    };

    let plansToRender = [];
    if (filter === "mine") {
      plansToRender = (state.activePlans || []).filter(p => !isExpired(p));
    } else if (filter === "completed") {
      plansToRender = (state.activePlans || []).filter(p => isExpired(p));
    }

    plansToRender = plansToRender.filter(plan => canManageHiddenPlans() || !isPlanHidden(plan));
    plansToRender = plansToRender.filter(matchesPlanSearch);
    plansToRender = plansToRender.filter(matchesPlanSeries);
    plansToRender = sortJoinedPlansChronologically(plansToRender);

    // 每日靈修／小組聚會週計畫「功能設定」（總開關＋個人偏好）還沒讀到 → 先讀，
    // 讀到之後如果有變化（例如剛好在總開關開著、自己也開了）再重畫一次讓計畫
    // 現身；isDevotionalPlanVisibleToUser/isGroupMeetingPlanVisibleToUser 讀的
    // 是快取的 window.* 全域變數，第一次進來時可能還沒抓到，不能只算一次。
    if (typeof window.devotionGroupFeaturesMasterEnabled !== "boolean"
      && typeof ensureDevotionGroupPreferencesLoaded === "function") {
      ensureDevotionGroupPreferencesLoaded().then(() => renderJoinedPlansList()).catch(() => {});
    }

    // 每日靈修／小組聚會週計畫沒有「加入」這回事，改成直接從 state.globalPlans
    // 撈出「這個人看得到」的那幾份，跟已加入的一般計畫一起放在「我的計畫」──但
    // 只在「進行中」分頁顯示，這種計畫沒有「已結束/已完成」的概念可以歸類。
    const viewerOnlyPlans = filter === "mine"
      ? (state.globalPlans || []).filter(gp => {
          if (!gp) return false;
          const kind = gp.planKind || gp.plan_kind;
          if (kind !== "devotional" && kind !== "group_meeting") return false;
          if (kind === "devotional" && !isDevotionalPlanVisibleToUser(gp)) return false;
          if (kind === "group_meeting" && typeof isGroupMeetingPlanVisibleToUser === "function" && !isGroupMeetingPlanVisibleToUser(gp)) return false;
          return matchesPlanSearch(gp) && matchesPlanSeries(gp);
        })
        // 每日靈修排在小組聚會上面（同類型維持原本 start_date 排序）
        .sort((a, b) => {
          const rank = gp => ((gp.planKind || gp.plan_kind) === "devotional" ? 0 : 1);
          return rank(a) - rank(b);
        })
      : [];

    if (plansToRender.length === 0 && viewerOnlyPlans.length === 0 && planSearchQuery) {
      container.innerHTML = `
        <div class="empty-state" style="text-align:center;padding:3rem 1rem;width:100%;">
          <p style="color:var(--text-secondary);margin:0 0 .5rem;font-weight:500;">找不到符合「${escapeHTML(planSearchQuery)}」的計畫</p>
          <p style="font-size:0.875rem;color:var(--text-muted);margin:0;">請嘗試其他計畫名稱、階段或獎項。</p>
        </div>
      `;
      return;
    }

    if (plansToRender.length === 0 && viewerOnlyPlans.length === 0) {
      if (filter === "mine") {
        container.innerHTML = `
          <div class="empty-state" style="text-align: center; padding: 3rem 0;">
            <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-weight: 500;">您目前沒有加入任何讀經計畫。</p>
            <p style="font-size: 0.88rem; color: var(--text-muted);">${(window.APP_COPY && window.APP_COPY.plan.clickFindPlans) || "請點擊頂部「探索計畫」瀏覽並加入！"}</p>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="empty-state" style="text-align: center; padding: 3rem 0; width: 100%;">
            <p style="color: var(--text-secondary); margin-bottom: 1rem; font-weight: 500;">目前沒有已結束的計畫</p>
            <p style="font-size: 0.875rem; color: var(--text-muted);">前往「探索計畫」加入新挑戰吧！</p>
          </div>
        `;
      }
      return;
    }

    plansToRender.forEach(plan => {
      const card = document.createElement("div");
      card.className = "plan-card joined-plan-item-card";
      card.onclick = async event => {
        if (event.target.closest("[data-plan-card-action]")) return;
        await openJoinedPlanProgress(plan);
      };

      const progress = plan.progress || 0;
      const currentRound = plan.currentRound || 1;
      const upgradeAvailability = getPlanUpgradeAvailability(plan, { expired: isPlanExpired(plan) });
      const isCampaignStage = window.isCampaignStagePlan(plan);
      const campaignAwardName = plan.awardName || plan.campaignDefinition && plan.campaignDefinition.awardName || "";
      const isMonthlyFinalCard = isCampaignStage && (plan.isMonthlyFinal
        || (Number(plan.stageNo) === 2 && String(plan.presetKey || "").startsWith("church_r1final")));
      let campaignAwardEarned = isCampaignStage && (currentRound > 1 || progress >= 100);
      // 第一輪期末賽月度卡：鐵獎是「四卷合計 + 季末手動合成」，不是單張完成就有。
      let campaignAwardValue = `${campaignAwardEarned ? "已獲得" : "完成可獲得"} ${escapeHTML(campaignAwardName)}`;
      if (isMonthlyFinalCard && typeof window.getFirstRoundFinalStatus === "function") {
        const frf = window.getFirstRoundFinalStatus();
        campaignAwardEarned = frf.ironAwardEarned;
        campaignAwardValue = frf.ironAwardEarned
          ? `已獲得 ${escapeHTML(campaignAwardName)}`
          : frf.canSynthesize
          ? `${escapeHTML(campaignAwardName)}・可前往合成`
          : `${escapeHTML(campaignAwardName)}・已完成 ${frf.collected}/${frf.total} 卷`;
      }
      const isUpcomingFixed = isFixedPlanUpcoming(plan);
      const dateMeta = `
        <span class="nlc-icon nlc-icon--sm" data-icon="calendarThirty" aria-hidden="true"></span>
        <span>${escapeHTML(plan.startDate)} ~ ${escapeHTML(plan.endDate)}</span>
      `;

      if (filter === "completed") {
        // Expired plan: status becomes a small badge next to the title instead of a full text row
        const isCompleted = (currentRound > 1) || (progress === 100);

        card.innerHTML = renderPlanCardShell({
          plan,
          variant: "completed",
          header: renderPlanCardHeader({
            title: escapeHTML(plan.name),
            titleTrailing: renderPlanCardBadge({
              icon: isCompleted ? "check" : "hourglass",
              label: isCompleted ? "已完成" : "未完成",
              tone: isCompleted ? "success" : "danger"
            }),
            meta: dateMeta
          }),
          status: renderPlanCardBadgeRow([
            isCampaignStage && renderPlanCardBadge({
              icon: "award",
              label: campaignAwardValue,
              tone: campaignAwardEarned ? "success" : "brand"
            })
          ])
        });
        if (typeof hydrateIcons === "function") hydrateIcons(card);
      } else {
        // Normal active plan: a big progress number carries the card instead of a "進度：" text row
        const totalChapters = plan.currentRoundTotalChapters || plan.totalChapters;
        // #293：第 2 遍以後不要再讓大字單獨顯示「0%」——改成皇冠圖示＋「第 N 遍」，
        // caption 改成本遍實際章數，round 1 畫面完全不變。
        const roundProgress = getRoundProgressDisplay({
          round: currentRound,
          progress,
          read: plan.completedChapters,
          total: totalChapters
        });
        const progressCaption = roundProgress.isMultiRound
          ? roundProgress.roundStatusText
          : `已讀 ${plan.completedChapters} / ${totalChapters} 章`;
        const progressHeroValue = roundProgress.isMultiRound
          ? `<span class="nlc-icon nlc-icon--sm" data-icon="crown" aria-hidden="true"></span>${roundProgress.roundLabel}`
          : `${progress}%`;
        const progressHero = isUpcomingFixed
          ? renderPlanCardProgressHero({ value: escapeHTML(getPlanStartCountdownText(plan)), tone: "warning" })
          : renderPlanCardProgressHero({ value: progressHeroValue, caption: progressCaption });

        const isTeamPlan = typeof window.isReadingTeamPlan === "function" && window.isReadingTeamPlan(plan);
        const teamHtml = isTeamPlan ? `<div class="plan-card-team-controls"></div>` : "";
        const progressHtml = isUpcomingFixed
          ? ""
          : `<div class="plan-progress-wrapper plan-progress-wrapper--compact${roundProgress.isMultiRound ? " plan-progress-wrapper--layered" : ""}" style="width: 100%;">
              ${roundProgress.isMultiRound ? `<div class="plan-progress-bar-base"></div>` : ""}
              <div class="plan-progress-bar" style="width: ${progress}%;"></div>
            </div>`;

        card.innerHTML = renderPlanCardShell({
          plan,
          variant: isUpcomingFixed ? "upcoming" : "joined",
          header: renderPlanCardHeader({
            title: escapeHTML(plan.name),
            meta: dateMeta
          }),
          status: progressHero + renderPlanCardBadgeRow([
            isCampaignStage && renderPlanCardBadge({
              icon: "award",
              label: campaignAwardValue,
              tone: campaignAwardEarned ? "success" : "brand"
            })
          ]),
          progress: progressHtml,
          actions: renderPlanCardActions([
            upgradeAvailability.eligible && { kind: "primary", icon: "trophy", label: `開始${upgradeAvailability.nextRoundLabel}`, action: "upgrade" }
          ]),
          after: teamHtml,
          trailing: `<span class="plan-card__chevron"><span class="nlc-icon nlc-icon--sm" data-icon="chevronRight" aria-hidden="true"></span></span>`
        });

        if (typeof hydrateIcons === "function") hydrateIcons(card);

        card.querySelector('[data-plan-card-action="upgrade"]')?.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          delete plan.upgradeOverlayDismissedRound;
          await openJoinedPlanProgress(plan);
        });
        if (isTeamPlan) {
          const teamContainer = card.querySelector(".plan-card-team-controls");
          if (teamContainer) {
            teamContainer.classList.add("plan-card-participation-slot");
            const isLoggedIn = typeof auth !== "undefined" && auth.isLoggedIn();

            if (!isLoggedIn) {
              teamContainer.innerHTML = `<span class="plan-card-participation-item__hint">團隊功能需登入正式帳號</span>`;
            } else {
              teamContainer.innerHTML = `<span class="plan-card-participation-item__hint">正在載入團隊狀態...</span>`;
              db.getMyReadingTeam(plan).then(result => {
                if (!teamContainer.parentElement) return;
                const contexts = (result && result.success) ? getJoinedReadingTeamContexts(result.context) : [];
                const participationModel = getPlanParticipationModel(plan, contexts);
                teamContainer.innerHTML = renderPlanParticipationItem(participationModel);
                bindPlanParticipationItemActions(card, plan, participationModel);
                if (typeof hydrateIcons === "function") hydrateIcons(teamContainer);
              }).catch(err => {
                console.error("Error loading team info for card:", err);
                teamContainer.innerHTML = `<span class="plan-card-participation-item__hint plan-card-participation-item__hint--danger">無法載入團隊資料</span>`;
              });
            }
          }
        }
      }

      container.appendChild(card);
    });

    viewerOnlyPlans.forEach(plan => {
      container.appendChild(buildViewerOnlyPlanCard(plan));
    });
  } catch (err) {
    console.error("Critical error inside renderJoinedPlansList:", err);
  }
}


function formatCampaignReadingRange(reading) {
  const book = (window.BIBLE_BOOKS || []).find(item => item.name === reading.book);
  const from = Number(reading.from || 1);
  const to = Number(reading.to || book && book.chapters || from);
  return reading.book + " " + (from === to ? from : from + "–" + to) + "章";
}

// openJoinModeDialog removed 2026-09-16: zero callers anywhere in js/ — the
// preset-join flow that used to show this "個人 or 團體" picker was
// rewritten to not call it anymore (see plan-primary-navigation.test.mjs's
// assertion that the flow no longer contains it), and the body was left
// behind.

// ==================== 全域加入團隊支援 ====================
async function joinTeamGlobally(inviteCode) {
  const code = String(inviteCode || "").trim().toUpperCase();
  if (!code) {
    return { success: false, message: "請輸入邀請碼。" };
  }

  if (!state.isSupabaseMode || !state.supabase) {
    return { success: false, message: "團隊功能需登入正式帳號使用。" };
  }

  loader.show("正在尋找並加入團隊...");
  try {
    const candidatePlans = [];
    const seenIds = new Set();

    const addPlan = (p) => {
      if (!p) return;
      const id = p.globalPlanId || p.id;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        candidatePlans.push(p);
      }
    };

    (state.activePlans || []).forEach(addPlan);
    (state.globalPlans || []).forEach(addPlan);

    if (candidatePlans.length === 0 && typeof CHURCH_PLAN_PRESETS !== "undefined") {
      Object.values(CHURCH_PLAN_PRESETS).forEach(addPlan);
    }

    let joinResult = null;
    let matchingPlan = null;

    // Try joining for each plan UUID
    for (const plan of candidatePlans) {
      const planId = typeof db._readingTeamPlanId === "function" ? db._readingTeamPlanId(plan) : (plan.globalPlanId || plan.id);
      if (!planId) continue;

      const res = await db.joinReadingTeam(plan, code);
      if (res && (res.success || isAlreadyJoinedTeamResult(res))) {
        joinResult = res;
        matchingPlan = plan;
        break;
      } else if (res && res.message && !res.message.includes("找不到這組邀請碼")) {
        joinResult = res;
        matchingPlan = plan;
        break;
      }
    }

    if (!joinResult || (!joinResult.success && !isAlreadyJoinedTeamResult(joinResult))) {
      return {
        success: false,
        message: (joinResult && joinResult.message) || "找不到這組邀請碼，請向隊長確認。"
      };
    }

    const effectivePlan = await resolveTeamJoinEffectivePlan({
      teamJoinResult: joinResult,
      matchingPlan,
      activePlans: state.activePlans || [],
      joinPlan: async plan => {
        const defaultSchedule = { readingDaysPerWeek: 7, restWeekdays: [] };
        return db.joinPresetPlan(plan.presetKey || plan.id, defaultSchedule);
      }
    });
    if (!effectivePlan) {
      return {
        success: false,
        message: "已加入團隊，但無法自動加入對應讀經計畫。請重新整理後再試。"
      };
    }

    return { success: true, plan: effectivePlan, result: joinResult };
  } catch (err) {
    console.error("joinTeamGlobally error:", err);
    return { success: false, message: "加入失敗：" + (err.message || err) };
  } finally {
    loader.hide();
  }
}
window.joinTeamGlobally = joinTeamGlobally;

function setupGlobalJoinTeamForm() {
  const form = document.getElementById("global-join-team-form");
  if (!form || form.dataset.listenerBound) return;
  form.dataset.listenerBound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("global-team-code-input");
    const errorEl = document.getElementById("global-join-team-error");
    const submitBtn = document.getElementById("global-join-team-submit-btn");

    if (!input || !errorEl) return;
    errorEl.style.display = "none";
    errorEl.textContent = "";

    const code = input.value.trim().toUpperCase();
    if (!code) {
      errorEl.textContent = "請輸入邀請碼！";
      errorEl.style.display = "block";
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = "0.7";
    }

    try {
      const res = await window.joinTeamGlobally(code);
      if (res && res.success) {
        const planName = res.plan && res.plan.name ? res.plan.name : "對應讀經計畫";
        const teamData = res.result && res.result.data;
        const teamName = teamData && (teamData.teamName || teamData.name || teamData.team && teamData.team.name)
          || res.result && (res.result.teamName || res.result.name);
        const alreadyMember = Boolean(teamData && teamData.alreadyMember);
        showToast(alreadyMember
          ? (teamName ? `你已經在「${teamName}」團隊裡了。` : "你已經在這個團隊裡了。")
          : (teamName ? `已成功加入「${planName}」的「${teamName}」團隊！` : `已成功加入「${planName}」的團隊！`));
        input.value = "";

        resetPlanTeamInvitePanel();
        void updatePlanTeamInviteShortcutVisibility();
        if (res.plan) {
          await openJoinedPlanTeam(res.plan);
        } else {
          closePlanTeamInvitePanel();
        }
      } else {
        errorEl.textContent = (res && res.message) || "加入失敗，請確認邀請碼是否正確。";
        errorEl.style.display = "block";
      }
    } catch (err) {
      errorEl.textContent = "加入團隊時發生錯誤：" + (err.message || err);
      errorEl.style.display = "block";
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
      }
    }
  });
}

function openPlanDetailsDialog(plan, options = {}) {
  if (!plan) return;
  const joinAction = typeof options.onJoin === "function" ? options.onJoin : null;
  const existing = document.getElementById("plan-details-dialog");
  if (existing) existing.remove();

  const isFlexible = plan.isFixed === false || plan.is_fixed === false;
  const definition = plan.campaignDefinition || null;
  const isCampaignStage = window.isCampaignStagePlan(plan) && definition;
  const books = plan.target_books || plan.targetBooks || plan.books || [];
  const scheduleText = (plan.startDate + " ～ " + plan.endDate) + "；" + formatFlexibleScheduleSummary(plan);
  const segments = isCampaignStage && Array.isArray(definition.segments) ? definition.segments : [];
  // 延後大區梯次沒有 campaignDefinition，但一樣要顯示「完成可獲得的獎」——用 plan.awardName。
  const awardName = plan.awardName || (isCampaignStage ? (definition.awardName || "") : "");
  const showAward = Boolean(awardName);
  const isMonthlyFinalDetail = plan.isMonthlyFinal
    || (Number(plan.stageNo) === 2 && String(plan.presetKey || "").startsWith("church_r1final"));
  let awardEarned = showAward && ((plan.currentRound || 1) > 1 || Number(plan.progress || 0) >= 100);
  let awardCaption = awardEarned ? "已完成並獲得" : "完成本階段可獲得";
  if (isMonthlyFinalDetail && typeof window.getFirstRoundFinalStatus === "function") {
    const frf = window.getFirstRoundFinalStatus();
    awardEarned = frf.ironAwardEarned;
    awardCaption = frf.ironAwardEarned
      ? "已完成並獲得"
      : frf.canSynthesize
      ? "四卷完成 · 前往徽章牆合成"
      : `四卷全部完成才頒發（已完成 ${frf.collected}/${frf.total} 卷）`;
  }
  const segmentHtml = segments.map(segment => `
    <section style="padding:.9rem;border:1px solid var(--border-card);border-radius:12px;background:var(--bg-secondary);">
      <div style="display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;">
        <strong style="font-size:0.875rem;font-weight:500;color:var(--text-primary);">${escapeHTML(segment.label)}</strong>
        <span style="font-size:0.875rem;color:var(--text-muted);white-space:nowrap;">${escapeHTML(segment.startDate)} ～ ${escapeHTML(segment.endDate)}</span>
      </div>
      <div style="margin-top:.5rem;font-size:0.875rem;line-height:1.65;color:var(--text-secondary);">${(segment.readings || []).map(formatCampaignReadingRange).map(escapeHTML).join("、")}</div>
    </section>
  `).join("");

  const overlay = document.createElement("div");
  overlay.id = "plan-details-dialog";
  overlay.className = "modal-overlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:1rem;";
  overlay.innerHTML = `
    <div class="glass-card" role="dialog" aria-modal="true" aria-labelledby="plan-details-title"
      style="width:min(520px,100%);height:auto!important;max-height:84vh;overflow:auto;padding:1.5rem;background:var(--bg-card);border:1px solid var(--border-card);box-shadow:var(--shadow-lg);position:relative;">
      
      <!-- X Close Button -->
      <button type="button" id="plan-details-x-btn" class="dialog-close-button icon-button icon-button--subtle" aria-label="關閉"
        style="position:absolute;top:1rem;right:1rem;">
        <span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span>
      </button>

      <h3 id="plan-details-title" style="margin:0 0 1rem;font-size:1.15rem;font-weight:500;color:var(--text-primary);padding-right:2rem;">${escapeHTML(plan.name || "讀經計畫")}</h3>
      ${showAward ? `<div style="display:flex;align-items:center;gap:.75rem;padding:.9rem;margin-bottom:1rem;border-radius:14px;background:var(--bg-secondary);border:1px solid var(--border-card);"><div style="width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:var(--primary-color);color:white;"><span class="nlc-icon" data-icon="award" aria-hidden="true"></span></div><div><div style="font-size:0.875rem;color:var(--text-muted);">${escapeHTML(awardCaption)}</div><strong style="font-size:1rem;color:var(--text-primary);">${escapeHTML(awardName)}</strong></div></div>` : ""}
      ${plan.description ? `<p style="margin:0 0 1rem;font-size:0.875rem;line-height:1.6;color:var(--text-secondary);">${escapeHTML(plan.description)}</p>` : ""}
      <dl style="display:grid;grid-template-columns:auto 1fr;gap:.65rem .9rem;margin:0;font-size:0.875rem;">
        <dt style="color:var(--text-muted);">計畫類型</dt><dd style="margin:0;color:var(--text-primary);">${isCampaignStage ? "教會分階段計畫" : (isFlexible ? "非固定日期" : "固定日期")}</dd>
        <dt style="color:var(--text-muted);">日期／安排</dt><dd style="margin:0;color:var(--text-primary);">${escapeHTML(scheduleText)}</dd>
        ${isCampaignStage ? `<dt style="color:var(--text-muted);">階段／輪次</dt><dd style="margin:0;color:var(--text-primary);">第 ${Number(definition.stageNo)} 階段・第 ${Number(definition.roundNo)} 輪</dd>${definition.examDate ? `<dt style="color:var(--text-muted);">考試日期</dt><dd style="margin:0;color:var(--text-primary);">${escapeHTML(definition.examDate)}</dd>` : ""}` : ""}
        <dt style="color:var(--text-muted);">閱讀經卷</dt><dd style="margin:0;color:var(--text-primary);line-height:1.55;">${books.length ? escapeHTML(books.join("、")) : "依計畫排程"}</dd>
      </dl>
      ${segmentHtml ? `<h4 style="margin:1.25rem 0 .7rem;font-size:.92rem;font-weight:500;color:var(--text-primary);">每月／階段章節安排</h4><div style="display:grid;gap:.65rem;">${segmentHtml}</div>` : ""}
      <div style="display:flex;justify-content:flex-end;margin-top:1.35rem;"><button type="button" id="plan-details-close" class="primary-btn">關閉</button></div>
    </div>
  `;
  document.body.appendChild(overlay);
  if (typeof hydrateIcons === "function") hydrateIcons(overlay);
  const close = () => overlay.remove();
  
  const xBtn = overlay.querySelector("#plan-details-x-btn");
  xBtn.addEventListener("click", close);

  const closeButton = overlay.querySelector("#plan-details-close");
  closeButton.addEventListener("click", close);

  if (joinAction) {
    const parent = closeButton.parentElement;
    closeButton.remove();
    
    const joinButton = document.createElement("button");
    joinButton.type = "button";
    joinButton.className = "primary-btn";
    joinButton.textContent = isFixedPlanUpcoming(plan) ? "預先加入計畫" : "加入計畫";
    joinButton.addEventListener("click", async () => {
      joinButton.disabled = true;
      close();
      await joinAction();
    });
    parent.appendChild(joinButton);
  }
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
}

function formatFlexibleScheduleSummary(plan) {
  const labels = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  const restDays = Array.isArray(plan && (plan.restWeekdays || plan.rest_weekdays))
    ? (plan.restWeekdays || plan.rest_weekdays).map(Number).filter(day => day >= 0 && day <= 6)
    : [];
  const readingDays = Number(plan && (plan.readingDaysPerWeek || plan.reading_days_per_week)) || (7 - restDays.length);
  return restDays.length
    ? "每週 " + readingDays + " 天；" + restDays.map(day => labels[day]).join("、") + "休息"
    : "每週 7 天；沒有固定休息日";
}

function isFixedPlanUpcoming(plan) {
  if (!plan || plan.isFixed === false || plan.is_fixed === false || !plan.startDate) return false;
  if (typeof isPlanStarted === "function") return !isPlanStarted(plan);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(plan.startDate + "T00:00:00");
  return !Number.isNaN(start.getTime()) && today < start;
}

function openFlexibleScheduleDialog(plan, options = {}) {
  return new Promise(resolve => {
    const existing = document.getElementById("flexible-schedule-dialog");
    if (existing) existing.remove();

    const weekdayLabels = ["\u9031\u65e5", "\u9031\u4e00", "\u9031\u4e8c", "\u9031\u4e09", "\u9031\u56db", "\u9031\u4e94", "\u9031\u516d"];
    const initialRestDays = Array.isArray(plan && (plan.restWeekdays || plan.rest_weekdays))
      ? (plan.restWeekdays || plan.rest_weekdays).map(Number)
      : [0, 6];
    const initialReadingDays = Number(plan && (plan.readingDaysPerWeek || plan.reading_days_per_week)) || (7 - initialRestDays.length);
    const isEditing = options.editing === true;
    const isFixed = plan && plan.isFixed !== false && plan.is_fixed !== false;
    const isUpcomingFixed = isFixedPlanUpcoming(plan);
    const scheduleIntro = isUpcomingFixed
      ? `已開放預覽與預先加入，將於 ${plan.startDate} 正式開始，敬請期待。`
      : (isFixed
        ? `這是固定日期計畫，章節會依 ${plan.startDate} ～ ${plan.endDate} 與您選擇的讀經日安排。`
        : `${(plan && plan.name) || "非固定日期計畫"}會從今天開始，章節只會分配在您選擇的讀經日。`);
    const overlay = document.createElement("div");
    overlay.id = "flexible-schedule-dialog";
    overlay.className = "modal-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:1rem;";
    overlay.innerHTML = `
      <div class="glass-card" role="dialog" aria-modal="true" aria-labelledby="flexible-schedule-title"
        style="width:min(420px,100%);height:auto!important;padding:1.5rem;background:var(--bg-card);border:1px solid var(--border-card);box-shadow:var(--shadow-lg);">
        <h3 id="flexible-schedule-title" style="margin:0 0 .35rem;font-size:1.15rem;font-weight:500;color:var(--text-primary);">\u8a2d\u5b9a\u6bcf\u9031\u8b80\u7d93\u5b89\u6392</h3>
        <p style="margin:0 0 1.25rem;font-size:0.875rem;line-height:1.55;color:var(--text-secondary);">
          ${escapeHTML(scheduleIntro)}
        </p>
        <label for="flexible-reading-days" style="display:block;margin-bottom:.45rem;font-size:0.875rem;font-weight:500;color:var(--text-primary);">\u4e00\u9031\u60f3\u8b80\u7d93\u5e7e\u5929</label>
        <select id="flexible-reading-days" class="form-control" style="width:100%;margin-bottom:1.1rem;">
          ${[1, 2, 3, 4, 5, 6, 7].map(days => `<option value="${days}" ${days === initialReadingDays ? "selected" : ""}>\u6bcf\u9031 ${days} \u5929</option>`).join("")}
        </select>
        <fieldset style="border:0;padding:0;margin:0;">
          <legend style="margin-bottom:.55rem;font-size:0.875rem;font-weight:500;color:var(--text-primary);">\u56fa\u5b9a\u4f11\u606f\u661f\u671f</legend>
          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem;">
            ${weekdayLabels.map((label, day) => `
              <label style="display:flex;align-items:center;gap:.35rem;padding:.55rem .45rem;border:1px solid var(--border-card);border-radius:10px;cursor:pointer;font-size:0.875rem;color:var(--text-primary);">
                <input class="schedule-weekday-checkbox" type="checkbox" value="${day}" ${initialRestDays.includes(day) ? "checked" : ""}>
                <span>${label}</span>
              </label>
            `).join("")}
          </div>
        </fieldset>
        <p id="flexible-schedule-summary" style="margin:.85rem 0 0;font-size:0.875rem;color:var(--text-muted);"></p>
        <p id="flexible-schedule-error" role="alert" style="display:none;margin:.55rem 0 0;font-size:0.875rem;color:var(--color-danger);"></p>
        <div style="display:flex;justify-content:flex-end;gap:.65rem;margin-top:1.25rem;">
          <button type="button" id="flexible-schedule-cancel" class="secondary-btn">\u53d6\u6d88</button>
          <button type="button" id="flexible-schedule-confirm" class="primary-btn">${isEditing ? "儲存安排" : (isUpcomingFixed ? "預先加入" : "加入計畫")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const daysSelect = overlay.querySelector("#flexible-reading-days");
    const checkboxes = Array.from(overlay.querySelectorAll(".schedule-weekday-checkbox"));
    const summary = overlay.querySelector("#flexible-schedule-summary");
    const error = overlay.querySelector("#flexible-schedule-error");
    const preferredRestOrder = [0, 6, 5, 4, 3, 2, 1];

    const updateSummary = () => {
      const restDays = checkboxes.filter(input => input.checked).map(input => weekdayLabels[Number(input.value)]);
      summary.textContent = restDays.length > 0
        ? `\u6bcf\u9031\u8b80 ${daysSelect.value} \u5929\uff1b${restDays.join("\u3001")}\u56fa\u5b9a\u4f11\u606f\u3002`
        : "\u6bcf\u9031 7 \u5929\u90fd\u5b89\u6392\u8b80\u7d93\u3002";
      error.style.display = "none";
    };

    const syncRestDays = () => {
      const targetRestCount = 7 - Number(daysSelect.value);
      const selected = checkboxes.filter(input => input.checked).map(input => Number(input.value));
      const nextRestDays = selected.slice(0, targetRestCount);
      preferredRestOrder.forEach(day => {
        if (nextRestDays.length < targetRestCount && !nextRestDays.includes(day)) nextRestDays.push(day);
      });
      checkboxes.forEach(input => { input.checked = nextRestDays.includes(Number(input.value)); });
      updateSummary();
    };

    daysSelect.addEventListener("change", syncRestDays);
    checkboxes.forEach(input => input.addEventListener("change", () => {
      const restCount = checkboxes.filter(item => item.checked).length;
      if (restCount >= 7) {
        input.checked = false;
        error.textContent = "\u4e00\u9031\u81f3\u5c11\u9700\u8981\u4fdd\u7559 1 \u5929\u8b80\u7d93\u3002";
        error.style.display = "block";
        return;
      }
      daysSelect.value = String(7 - checkboxes.filter(item => item.checked).length);
      updateSummary();
    }));

    const close = value => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector("#flexible-schedule-cancel").addEventListener("click", () => close(null));
    overlay.querySelector("#flexible-schedule-confirm").addEventListener("click", () => {
      const restWeekdays = checkboxes.filter(input => input.checked).map(input => Number(input.value)).sort((a, b) => a - b);
      const templateStart = new Date(plan.startDate);
      const templateEnd = new Date(plan.endDate);
      const durationDays = Math.max(1, Math.ceil((templateEnd - templateStart) / 86400000) + 1);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const validationStart = isFixed && !Number.isNaN(templateStart.getTime()) ? templateStart : today;
      const hasReadingDay = Array.from({ length: durationDays }, (_, offset) => {
        const date = new Date(validationStart);
        date.setDate(validationStart.getDate() + offset);
        return date;
      }).some(date => !restWeekdays.includes(date.getDay()));

      if (!hasReadingDay) {
        error.textContent = "\u9019\u500b\u8a08\u756b\u671f\u9593\u5167\u6c92\u6709\u53ef\u7528\u7684\u8b80\u7d93\u65e5\uff0c\u8acb\u8abf\u6574\u4f11\u606f\u661f\u671f\u3002";
        error.style.display = "block";
        return;
      }
      close({ readingDaysPerWeek: 7 - restWeekdays.length, restWeekdays });
    });
    overlay.addEventListener("click", event => {
      if (event.target === overlay) close(null);
    });
    updateSummary();
  });
}

function renderPresetPlansList() {
  const container = document.getElementById("preset-plans-list");
  if (!container) return;
  container.innerHTML = "";
  updatePlanSidebarIntroCardVisibility();
  updateSeriesPillRowVisibility();

  const legacyCategoryIdPrefix = "00000000-0000-0000-a000-";
  // 第一輪期末賽（第 2 階段）已拆成 4 個「月度期末賽」（c126 命名空間）。DB 裡
  // 0017 的 sync trigger 仍會補一列舊的「聚合」第 2 階段（c026…02 / church_stage_02），
  // 那一列已被取代、不該出現在探索清單。
  const isSupersededAggregateStage2 = plan => {
    const id = String(plan && (plan.id || plan.globalPlanId || ""));
    const key = String(plan && plan.presetKey || "");
    return id === "00000000-0000-0000-c026-000000000002"
      || key === "church_stage_02"
      || String(plan && plan.name || "") === "第2階段｜第一輪期末賽";
  };
  const isObsoleteCategoryPlan = plan =>
    String(plan && (plan.id || plan.globalPlanId || "")).startsWith(legacyCategoryIdPrefix)
    || String(plan && plan.presetKey || "").startsWith("m_")
    || isSupersededAggregateStage2(plan);

  const presetPlanEntries = Object.entries(CHURCH_PLAN_PRESETS).map(([key, plan]) => ({
    ...plan,
    id: plan.id || key,
    presetKey: key
  }));
  const loadedPlans = state.globalPlans && state.globalPlans.length > 0
    ? state.globalPlans
    : [];
  const loadedPlanKeys = new Set(loadedPlans.flatMap(plan =>
    [plan && plan.id, plan && plan.globalPlanId, plan && plan.presetKey].filter(Boolean).map(String)
  ));
  const missingCampaignStages = presetPlanEntries.filter(plan =>
    ![plan.id, plan.globalPlanId, plan.presetKey].filter(Boolean).map(String).some(key => loadedPlanKeys.has(key))
  );
  const sourcePlans = loadedPlans.length > 0
    ? [...loadedPlans, ...missingCampaignStages]
    : presetPlanEntries;

  const joinedKeys = new Set((state.activePlans || []).flatMap(plan => [
    plan.id,
    plan.globalPlanId,
    plan.presetKey,
    plan.name
  ].filter(Boolean).map(String)));

  const isLegacyCampaignMaster = plan => {
    const identifiers = [plan && plan.id, plan && plan.globalPlanId, plan && plan.presetKey].filter(Boolean).map(String);
    const normalizedName = String(plan && plan.name || "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
    return plan && (plan.planKind === "church_campaign"
      || identifiers.includes(String(window.CHURCH_CAMPAIGN_ID))
      || identifiers.includes(String(window.CHURCH_CAMPAIGN_PRESET_KEY))
      || normalizedName === "2026-2029 新生生命聖經速讀計畫");
  };

  // 「這張卡只有管理員 / 有管理權限的人看得到，一般會友看不到」的 plan key 集合，
  // 拿來在卡片上標一個提示，讓管理員知道會友端其實看不到這張。
  const managerOnlyPlanKeys = new Set();
  const markManagerOnly = plan => {
    [plan.id, plan.globalPlanId, plan.presetKey, plan.name].filter(Boolean).forEach(v => managerOnlyPlanKeys.add(String(v)));
  };

  // 延後大區梯次（audience_regions 非空）計畫，且使用者「還沒設定牧區/大區」→
  // 卡片仍顯示，但停用「加入」並提示先補會員資料。若使用者有大區、只是不在
  // 名單內（那是別的大區的梯次）→ 直接濾掉、不顯示。
  const regionSetupPlanKeys = new Set();
  const markRegionSetup = plan => {
    [plan.id, plan.globalPlanId, plan.presetKey, plan.name].filter(Boolean).forEach(v => regionSetupPlanKeys.add(String(v)));
  };
  const viewerRegionMissing = !String((state.currentUser && state.currentUser.great_region) || "").trim();

  // 2026-10-01 起開始的教會階段計畫，沒設定牧區就先擋加入——跟資料庫端
  // assert_campaign_stage_open()（migration 0193）用同一個固定分界日期，
  // 前端只是提早給提示，真正擋人的是資料庫那道 trigger。卡片仍顯示，只是
  // 把「加入計畫」按鈕換成「前往會員中心設定牧區」。
  const PASTORAL_ZONE_REQUIRED_FROM = "2026-10-01";
  const pastoralZoneSetupPlanKeys = new Set();
  const markPastoralZoneSetup = plan => {
    [plan.id, plan.globalPlanId, plan.presetKey, plan.name].filter(Boolean).forEach(v => pastoralZoneSetupPlanKeys.add(String(v)));
  };
  const viewerPastoralZoneMissing = !String((state.currentUser && state.currentUser.pastoral_zone) || "").trim();

  const visiblePlans = sourcePlans.filter(plan => {
    if (!plan) return false;
    const isObsolete = isObsoleteCategoryPlan(plan);
    const isLegacy = isLegacyCampaignMaster(plan);
    const isHidden = isPlanHidden(plan);
    const matchesSearch = matchesPlanSearch(plan);
    
    const joinedKeysValues = [plan.id, plan.globalPlanId, plan.presetKey, plan.name].filter(Boolean).map(String);
    const isAlreadyJoined = joinedKeysValues.some(value => joinedKeys.has(value));

    if (isObsolete || isLegacy) return false;
    // 每日靈修／小組聚會週計畫：只看內容、沒有「加入」，改到「我的計畫」清單顯示
    // （見 renderJoinedPlansList 裡的 buildViewerOnlyPlanCard），探索清單不再重複出現。
    const planKind = plan.planKind || plan.plan_kind;
    if (planKind === "devotional" || planKind === "group_meeting") return false;
    // 已結束／尚未開放（隱藏、鎖住）的計畫：會友端不顯示，管理者預覽時標
    // 「會友看不到」——規則見 getExplorePlanVisibility（#372）。
    const exploreVisibility = getExplorePlanVisibility({
      expired: isPlanExpired(plan),
      hidden: isHidden,
      lockedStage: window.isCampaignStageLocked(plan),
      discoverableWhileLocked: window.isCampaignStageDiscoverableWhileLocked(plan),
      viewerRole: (state.currentUser && getUserRoleCode(state.currentUser)) || "member",
      canManageHidden: canManageHiddenPlans()
    });
    if (!exploreVisibility.visible) return false;
    if (!matchesSearch) return false;
    if (!matchesPlanSeries(plan)) return false;
    if (isAlreadyJoined) return false;

    // 延後大區梯次：非本大區就不顯示；本人沒設定大區則保留卡片但停用加入。
    const audienceList = plan.audienceRegions || plan.audience_regions;
    const hasAudience = Array.isArray(audienceList) && audienceList.length > 0;
    if (hasAudience && !window.isPlanAudienceMatch(plan)) {
      if (viewerRegionMissing && !canManageHiddenPlans()) {
        markRegionSetup(plan);
      } else {
        return false;
      }
    }

    // 2026-10-01 起的教會階段計畫：沒設定牧區 → 卡片仍顯示，但停用「加入」。
    if (window.isCampaignStagePlan(plan)
      && String(plan.startDate || "") >= PASTORAL_ZONE_REQUIRED_FROM
      && viewerPastoralZoneMissing
      && !canManageHiddenPlans()) {
      markPastoralZoneSetup(plan);
    }

    // 走到這裡代表這張卡會顯示。如果它只是因為「我是管理員 / 有隱藏計畫管理權」
    // 才沒被濾掉（會友端其實看不到），就標記起來。
    if (exploreVisibility.managerOnly) {
      markManagerOnly(plan);
    }
    return true;
  });

  if (visiblePlans.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="text-align:center;padding:2.5rem 1rem;">
        <p style="color:var(--text-secondary);margin:0;">${planSearchQuery
          ? `找不到符合「${escapeHTML(planSearchQuery)}」的計畫。`
          : "目前沒有其他可加入的讀經計畫。"}</p>
      </div>
    `;
    return;
  }

  const getDurationLabel = (startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "日期尚未公布";
    const days = Math.max(1, Math.ceil((end - start) / 86400000) + 1);
    return days >= 365 ? `${startDate} ～ ${endDate}` : `共 ${days} 天`;
  };

  visiblePlans.forEach(plan => {
    const key = plan.id || plan.presetKey;
    const isCampaignStage = window.isCampaignStagePlan(plan);
    const isLockedStage = window.isCampaignStageLocked(plan);
    // 這張卡只有「管理員 / 有隱藏計畫管理權」的人在探索清單看得到（會友端看不到）。
    const isManagerOnly = [plan.id, plan.globalPlanId, plan.presetKey, plan.name]
      .filter(Boolean).some(v => managerOnlyPlanKeys.has(String(v)));
    // 延後大區梯次計畫，但使用者還沒設定牧區/大區 → 卡片停用「加入」，提示補資料。
    const needsRegionSetup = [plan.id, plan.globalPlanId, plan.presetKey, plan.name]
      .filter(Boolean).some(v => regionSetupPlanKeys.has(String(v)));
    // 2026-10-01 起的教會階段計畫，使用者還沒設定牧區 → 卡片一樣顯示，但把
    // 「加入計畫」按鈕換成「前往會員中心設定牧區」，不彈窗、不整頁攔截。
    const needsPastoralZoneSetup = [plan.id, plan.globalPlanId, plan.presetKey, plan.name]
      .filter(Boolean).some(v => pastoralZoneSetupPlanKeys.has(String(v)));
    const isJoinBlocked = isLockedStage || needsRegionSetup || needsPastoralZoneSetup;
    // 缺牧區是唯一「補資料就能繼續」的擋卡原因：卡片上直接給一顆可操作的按鈕，
    // 不像鎖定中／缺大區那樣只能點卡片開詳情視窗。
    const showPastoralZoneCta = needsPastoralZoneSetup && !isLockedStage && !needsRegionSetup;
    const isHiddenFromMembers = isManagerOnly;
    const isFixed = plan.isFixed !== false && plan.is_fixed !== false;
    const scheduleLabel = isCampaignStage
      ? `第 ${Number(plan.stageNo || plan.campaignDefinition && plan.campaignDefinition.stageNo)} 階段・第 ${Number(plan.roundNo || plan.campaignDefinition && plan.campaignDefinition.roundNo)} 輪`
      : (isFixed ? getDurationLabel(plan.startDate, plan.endDate) : `彈性開始・${getDurationLabel(plan.startDate, plan.endDate)}`);
    const description = plan.description || "";
    const awardName = plan.awardName || plan.campaignDefinition && plan.campaignDefinition.awardName || "";
    const isUpcomingFixed = isFixed && isFixedPlanUpcoming(plan);
    // 鎖住的階段已經標「尚未開放」，不能再同時說「已開放預覽與預先加入」（#372）。
    const upcomingNotice = isUpcomingFixed && !isLockedStage
      ? `已開放預覽與預先加入・${plan.startDate} 正式開始，敬請期待`
      : "";

    const card = document.createElement("div");
    card.className = "plan-card joined-plan-item-card" + (isHiddenFromMembers ? " plan-card--dev" : "");
    card.innerHTML = renderPlanCardShell({
      plan,
      variant: isJoinBlocked ? "available-locked" : (isUpcomingFixed ? "available-upcoming" : "available"),
      header: renderPlanCardHeader({
        title: escapeHTML(plan.name)
          + (isManagerOnly ? ' <span class="plan-card__dev-badge">會友看不到</span>' : ""),
        meta: `
          <span class="nlc-icon nlc-icon--sm" data-icon="calendarThirty" aria-hidden="true"></span>
          <span>${escapeHTML(scheduleLabel)}</span>
        `,
        description: description ? escapeHTML(description) : ""
      }),
      status: renderPlanCardStatusSummary([
        isCampaignStage && {
          icon: "award",
          label: "完成獎勵",
          value: (plan.isMonthlyFinal || (Number(plan.stageNo) === 2 && String(plan.presetKey || "").startsWith("church_r1final")))
            ? `${escapeHTML(awardName)}（四卷合計）`
            : escapeHTML(awardName)
        },
        isLockedStage && {
          icon: "lock",
          label: "\u958b\u653e\u72c0\u614b",
          value: "\u5c1a\u672a\u958b\u653e",
          tone: "warning"
        },
        needsRegionSetup && {
          icon: "personBox",
          label: "\u5831\u540d\u689d\u4ef6",
          value: "\u9019\u500b\u8a08\u756b\u9650\u7279\u5b9a\u5927\u5340\u53c3\u52a0\u3002\u8acb\u5148\u5230\u6703\u54e1\u4e2d\u5fc3\u88dc\u9f4a\u4f60\u7684\u7267\u5340\uff0f\u5927\u5340\u8cc7\u6599\uff0c\u518d\u56de\u4f86\u52a0\u5165\u3002",
          tone: "warning"
        },
        needsPastoralZoneSetup && {
          icon: "personBox",
          label: "\u5831\u540d\u689d\u4ef6",
          value: "\u9019\u500b\u968e\u6bb5\u9700\u8981\u5148\u8a2d\u5b9a\u7267\u5340\u624d\u80fd\u52a0\u5165\uff0c\u8acb\u5230\u6703\u54e1\u4e2d\u5fc3\u88dc\u9f4a\u8cc7\u6599\u3002",
          tone: "warning"
        },
        isManagerOnly && {
          icon: "lock",
          label: "\u986f\u793a\u7bc4\u570d",
          value: "\u53ea\u6709\u7cfb\u7d71\u7ba1\u7406\u54e1\u770b\u5f97\u5230\uff1b\u6703\u53cb\u7aef\u7684\u63a2\u7d22\u8a08\u756b\u4e0d\u6703\u51fa\u73fe\u9019\u5f35\uff08\uff1d\u76ee\u524d\u5c0d\u6703\u53cb\u662f\u96b1\u85cf\u7684\uff09\u3002",
          tone: "warning"
        },
        upcomingNotice && {
          icon: "hourglass",
          label: "開放狀態",
          value: escapeHTML(upcomingNotice),
          tone: "warning"
        }
      ]),
      actions: showPastoralZoneCta
        ? renderPlanCardActions([
            { kind: "secondary", icon: "signpost", label: "前往會員中心設定牧區", action: "member-hub-pastoral-zone" }
          ])
        : isJoinBlocked
        ? ""
        : renderPlanCardActions([
            { kind: "primary", icon: "bookOpen", label: "加入計畫", action: "solo-join" }
          ])
    });

    // 缺牧區這種「補資料就能繼續」的狀況，直接開會員中心，不彈計畫詳情視窗。
    const goSetPastoralZone = () => {
      if (typeof auth !== "undefined" && typeof auth.openMemberHub === "function") {
        auth.openMemberHub("onboarding");
      }
    };

    const openDetails = () => {
      if (showPastoralZoneCta) {
        goSetPastoralZone();
        return;
      }
      if (isJoinBlocked) {
        openPlanDetailsDialog(plan);
        return;
      }
      openPlanDetailsDialog(plan, { onJoin: () => joinPlanFromExplore(plan, key) });
    };

    card.onclick = event => {
      if (event.target.closest("[data-plan-card-action]")) return;
      openDetails();
    };

    card.querySelector('[data-plan-card-action="details"]')?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openDetails();
    });
    card.querySelector('[data-plan-card-action="solo-join"]')?.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      await joinPlanFromExplore(plan, key);
    });
    card.querySelector('[data-plan-card-action="member-hub-pastoral-zone"]')?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      goSetPastoralZone();
    });
    container.appendChild(card);
  });

  if (typeof hydrateIcons === "function") hydrateIcons(container);
}

function isChapterReadForRound(ch, round) {
  if (!ch) return false;
  const chRound = ch.round || 1;
  if (chRound < round) return true;
  if (chRound > round) return false;
  return Boolean(ch["isReadR" + round] || ch.isRead);
}

function isPlanDayCompletedForRound(day, round) {
  if (!day || !day.chapters || day.chapters.length === 0) return false;
  return day.chapters.every(ch => isChapterReadForRound(ch, round));
}

function getNextReadingPlanDay(plan = state.activePlan) {
  if (!plan || !plan.days || plan.days.length === 0) return null;
  const currentRound = plan.currentRound || 1;
  const readingDays = plan.days.filter(day => Array.isArray(day.chapters) && day.chapters.length > 0);
  return readingDays.find(day => !isPlanDayCompletedForRound(day, currentRound))
    || readingDays[readingDays.length - 1]
    || plan.days[plan.days.length - 1];
}

function getExpectedPlanDayCount(plan = state.activePlan, now = new Date()) {
  if (!plan || !plan.days || plan.days.length === 0 || !plan.startDate) return 0;
  const planStart = new Date(plan.startDate);
  if (isNaN(planStart.getTime())) return 0;
  planStart.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const elapsedDays = Math.floor((today - planStart) / (1000 * 60 * 60 * 24)) + 1;
  const elapsedCalendarDays = Math.max(0, Math.min(plan.days.length, elapsedDays));
  return plan.days.slice(0, elapsedCalendarDays)
    .filter(day => Array.isArray(day.chapters) && day.chapters.length > 0)
}

export function getPlanProgressStatus(plan = state.activePlan) {
  if (typeof getPlanProgressStatusFromDesignSystem === "function") {
    return getPlanProgressStatusFromDesignSystem(plan);
  }
  return { label: "進度一致", badgeClass: "stat-badge--brand", diff: 0 };
}

function renderHorizontalDateStrip() {
  const container = document.getElementById("plan-date-carousel");
  if (!container || !state.activePlan) return;

  if (!state.selectedPlanDay) {
    const nextReadingDay = getNextReadingPlanDay(state.activePlan);
    state.selectedPlanDay = nextReadingDay ? nextReadingDay.dayNum : 1;
  }

  const oldScrollContainer = container.querySelector(".calendar-scroll-container");
  const savedScrollTop = oldScrollContainer ? oldScrollContainer.scrollTop : null;

  container.innerHTML = "";

  // 1. Calculate active plan start/end dates
  let planStartDate = null;
  let planEndDate = null;

  if (state.activePlan.startDate) {
    planStartDate = new Date(state.activePlan.startDate);
  }
  if (state.activePlan.endDate) {
    planEndDate = new Date(state.activePlan.endDate);
  }

  // Fallback to first/last day of plan if start/end dates are not explicitly set or invalid
  if (!planStartDate || isNaN(planStartDate.getTime())) {
    const firstDay = state.activePlan.days[0];
    if (firstDay) {
      const parts = firstDay.date.split('/');
      planStartDate = new Date(Number(firstDay.year), Number(firstDay.month) - 1, Number(parts[1] || 1));
    } else {
      planStartDate = new Date();
    }
  }

  if (!planEndDate || isNaN(planEndDate.getTime())) {
    const lastDay = state.activePlan.days[state.activePlan.days.length - 1];
    if (lastDay) {
      const parts = lastDay.date.split('/');
      planEndDate = new Date(Number(lastDay.year), Number(lastDay.month) - 1, Number(parts[1] || 28));
    } else {
      planEndDate = new Date();
    }
  }

  // 2. Define Sliding Window boundaries: start - 2 weeks (backtrack to Sunday), end + 3 weeks (forward to Saturday)
  const startBase = new Date(planStartDate);
  startBase.setDate(startBase.getDate() - 14);
  const startDayOfWeek = startBase.getDay();
  const windowStart = new Date(startBase);
  windowStart.setDate(startBase.getDate() - startDayOfWeek);

  const endBase = new Date(planEndDate);
  endBase.setDate(endBase.getDate() + 21);
  const endDayOfWeek = endBase.getDay();
  const windowEnd = new Date(endBase);
  windowEnd.setDate(endBase.getDate() + (6 - endDayOfWeek));

  // 3. Create the Calendar Wrapper (scoped under .plan-calendar for square-cell styling)
  const calendarWrapper = document.createElement("div");
  calendarWrapper.className = "calendar-component plan-calendar";

  // 4. Create Global Static Weekday Header (outside the scroll container)
  const weekdaysDiv = document.createElement("div");
  weekdaysDiv.className = "calendar-weekdays";
  const weekdays = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  weekdays.forEach(w => {
    const wDiv = document.createElement("div");
    wDiv.textContent = w;
    weekdaysDiv.appendChild(wDiv);
  });
  calendarWrapper.appendChild(weekdaysDiv);

  // 5. Create the Scroll Container (visible area is capped to five calendar rows)
  const scrollContainer = document.createElement("div");
  scrollContainer.className = "calendar-scroll-container scrollbar-none";

  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();

  // Find a plan day by exact date
  const findPlanDay = (year, month, dayOfMonth) => {
    return state.activePlan.days.find(d => {
      if (Number(d.year) !== Number(year) || Number(d.month) !== Number(month)) return false;
      const parts = d.date.split('/');
      return parts.length === 2 && Number(parts[1]) === Number(dayOfMonth);
    });
  };

  // 日曆格和當天清單用同一套判斷（#330）：一次算好每天的打卡章數
  const recordCountsByDate = countDayReadingRecordsByDate(
    state.readingLogs,
    getPlanReadingRecordScope(state.activePlan)
  );

  // 6. Generate single flat continuous array of dates within the sliding window
  let cells = [];
  let curr = new Date(windowStart);
  while (curr <= windowEnd) {
    cells.push({
      year: curr.getFullYear(),
      month: curr.getMonth() + 1,
      dayOfMonth: curr.getDate()
    });
    curr.setDate(curr.getDate() + 1);
  }

  // Month Grid Container (Seamless single grid, no month banners/dividers)
  const gridDiv = document.createElement("div");
  gridDiv.className = "calendar-grid";

  // Render cells flatly
  cells.forEach(cell => {
    const isToday = cell.year === todayYear && cell.month === todayMonth && cell.dayOfMonth === todayDay;
    const numberLabel = cell.dayOfMonth === 1 ? `${cell.month}/${cell.dayOfMonth}` : `${cell.dayOfMonth}`;
    const day = findPlanDay(cell.year, cell.month, cell.dayOfMonth);

    if (day) {
      const dayCell = document.createElement("button");
      dayCell.type = "button";
      dayCell.className = "plan-day-cell";
      dayCell.innerHTML = `<span class="day-number">${numberLabel}</span>`;
      dayCell.setAttribute("data-day-num", day.dayNum);
      dayCell.setAttribute("aria-selected", day.dayNum === state.selectedPlanDay ? "true" : "false");
      if (isToday) {
        dayCell.setAttribute("aria-current", "date");
      }

      const cellStatus = getPlanDayCellStatus(
        state.activePlan,
        day,
        recordCountsByDate.get(getPlanDayDateKey(day)) || 0
      );
      const totalChapters = cellStatus.taskCount;
      const completedChapters = cellStatus.doneCount;
      const isDayCompleted = cellStatus.completed;
      const isPartiallyCompleted = cellStatus.partial;

      const isPast = cell.year < todayYear ||
        (cell.year === todayYear && cell.month < todayMonth) ||
        (cell.year === todayYear && cell.month === todayMonth && cell.dayOfMonth < todayDay);

      // Selected active focus highlight
      if (day.dayNum === state.selectedPlanDay) {
        dayCell.classList.add("active");
      }

      if (isToday) {
        dayCell.classList.add("today");
      }

      if (isDayCompleted) {
        dayCell.classList.add("completed");
      }

      if (isPast && !isDayCompleted && totalChapters > 0) {
        dayCell.classList.add("past-unread");
      }

      if (isPartiallyCompleted) {
        const progressContainer = document.createElement("div");
        progressContainer.className = "micro-progress-container";
        const progressBar = document.createElement("div");
        progressBar.className = "micro-progress-bar";
        progressBar.style.width = `${(completedChapters / totalChapters) * 100}%`;
        progressContainer.appendChild(progressBar);
        dayCell.appendChild(progressContainer);
      }

      // Status dot indicator
      if (!isToday) {
        const dot = document.createElement("div");
        dot.className = "day-status-dot";
        if (isDayCompleted) {
          dot.classList.add("dot-completed");
        } else if (isPast && totalChapters > 0) {
          dot.classList.add("dot-behind");
        } else {
          dot.classList.add("dot-grey");
        }
        dayCell.appendChild(dot);
      }

      // Click handler with race condition cancellation
      dayCell.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (window._dateSwitchAbortController) {
          window._dateSwitchAbortController.abort();
        }
        window._dateSwitchAbortController = new AbortController();
        const signal = window._dateSwitchAbortController.signal;

        state.selectedPlanDay = day.dayNum;

        // 1. Pure front-end high-speed active class switching
        const prevSelected = container.querySelector('.plan-day-cell.active');
        if (prevSelected) {
          prevSelected.classList.remove('active');
          prevSelected.setAttribute('aria-selected', 'false');
        }
        dayCell.classList.add('active');
        dayCell.setAttribute('aria-selected', 'true');

        // 2. Refresh bottom task list without redrawing the calendar strip
        renderPlanScheduleTracker(true, signal);
      });

      gridDiv.appendChild(dayCell);
    } else {
      const dayCell = document.createElement("span");
      dayCell.className = "plan-day-cell plan-day-cell--muted other-month";
      dayCell.setAttribute("aria-hidden", "true");
      dayCell.innerHTML = `<span class="day-number">${numberLabel}</span>`;

      if (isToday) {
        dayCell.classList.add("today");
      } else {
        const dot = document.createElement("div");
        dot.className = "day-status-dot dot-grey";
        dayCell.appendChild(dot);
      }

      gridDiv.appendChild(dayCell);
    }
  });



  scrollContainer.appendChild(gridDiv);
  calendarWrapper.appendChild(scrollContainer);
  container.appendChild(calendarWrapper);

  const applyCalendarMaxRows = () => {
    const firstCell = gridDiv.querySelector(".plan-day-cell");
    if (!firstCell) return;

    const gridStyles = getComputedStyle(gridDiv);
    const rowGap = parseFloat(gridStyles.rowGap) || 0;
    const paddingTop = parseFloat(gridStyles.paddingTop) || 0;
    const paddingBottom = parseFloat(gridStyles.paddingBottom) || 0;
    const rowHeight = firstCell.getBoundingClientRect().height;

    if (rowHeight > 0) {
      const visibleRows = 5;
      const maxHeight = (rowHeight * visibleRows) + (rowGap * (visibleRows - 1)) + paddingTop + paddingBottom;
      scrollContainer.style.maxHeight = Math.ceil(maxHeight) + "px";
    }
  };

  applyCalendarMaxRows();

  if (savedScrollTop !== null) {
    scrollContainer.scrollTop = savedScrollTop;
  } else {
    // 首次載入或切換計畫時，自動將選取的天數滾動到可見區域（無縫定位，不造成全網頁大跳）
    const scrollToActiveCell = () => {
      const activeCell = gridDiv.querySelector(`.plan-day-cell[data-day-num="${state.selectedPlanDay}"]`);
      if (activeCell) {
        const containerHeight = scrollContainer.clientHeight;
        const cellTop = activeCell.offsetTop;
        const cellHeight = activeCell.offsetHeight;
        if (containerHeight > 0) {
          scrollContainer.scrollTop = cellTop - (containerHeight / 2) + (cellHeight / 2);
        }
      }
    };
    requestAnimationFrame(scrollToActiveCell);
  }

  requestAnimationFrame(applyCalendarMaxRows);

  if (container._calendarResizeCleanup) {
    container._calendarResizeCleanup();
  }
  const resizeObserver = new ResizeObserver(applyCalendarMaxRows);
  resizeObserver.observe(gridDiv);
  container._calendarResizeCleanup = () => resizeObserver.disconnect();

  // 🛡️ scrollIntoView 已物理刪除：
  // 禁止在此處用 scrollIntoView/scrollTo 做自動捲動，
  // 這是點擊日期格造成整頁大跳的根本元凶。
  // 日曆的垂直捲動位置由使用者手勢完全自主控制。
}

function renderPlanProgressUpgradeOverlay(plan = state.activePlan) {
  if (!plan || window.currentPlanViewState !== PLAN_ROUTE.DETAIL) return;

  const availability = getPlanUpgradeAvailability(plan, { expired: isPlanExpired(plan) });
  const existing = document.getElementById("congrats-modal");
  if (!availability.eligible) {
    if (!planUpgradeInFlight && existing?.dataset.planUpgradePrompt === "true") existing.remove();
    return;
  }
  if (Number(plan.upgradeOverlayDismissedRound || 0) === availability.currentRound) return;

  const planKey = String(plan.id || plan.globalPlanId || plan.presetKey || plan.name || "plan");
  if (existing &&
      existing.dataset.planUpgradePrompt === "true" &&
      existing.dataset.planKey === planKey &&
      Number(existing.dataset.planRound) === availability.currentRound) return;

  showCongratsModal(plan, availability.currentRound);
}

// ── 當天閱讀紀錄（#330）───────────────────────────────────────────────
// 只算明確歸屬本計畫的打卡；章節順序以目前這遍的閱讀順序為準。
function getPlanReadingRecordScope(plan) {
  if (!plan) return { chapterOrder: [] };
  const round = Number(plan.currentRound || 1);
  const chapterOrder = [];
  const seen = new Set();
  const pushKey = ch => {
    const key = `${ch.book}_${Number(ch.chapter)}`;
    if (seen.has(key)) return;
    seen.add(key);
    chapterOrder.push(key);
  };
  const days = Array.isArray(plan.days) ? plan.days : [];
  days.forEach(day => (day.chapters || []).forEach(ch => {
    if (Number(ch.round || round) === round) pushKey(ch);
  }));
  days.forEach(day => (day.chapters || []).forEach(pushKey));
  return {
    planId: plan.id || null,
    globalPlanId: plan.globalPlanId || plan.global_plan_id || null,
    presetKey: plan.presetKey || plan.preset_key || null,
    chapterOrder
  };
}

function getPlanDayDateKey(day) {
  if (!day) return "";
  const dayOfMonth = day.date ? Number(String(day.date).split("/")[1]) : NaN;
  if (!day.year || !day.month || !Number.isFinite(dayOfMonth)) return "";
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

// 日曆格與當天清單共用：有本遍任務看任務完成度；沒有本遍任務時，那天有打卡紀錄就算完成。
function getPlanDayCellStatus(plan, day, recordCount = 0) {
  const round = Number((plan && plan.currentRound) || 1);
  const tasks = (day && Array.isArray(day.chapters) ? day.chapters : [])
    .filter(ch => Number(ch.round || round) === round);
  const doneCount = tasks.filter(ch => Boolean(ch["isReadR" + round] || ch.isRead)).length;
  return {
    taskCount: tasks.length,
    doneCount,
    recordCount,
    completed: tasks.length > 0 ? doneCount === tasks.length : recordCount > 0,
    partial: tasks.length > 0 && doneCount > 0 && doneCount < tasks.length
  };
}

// 進入目前這遍之前的日子（第 2 遍起才有）。
function isPlanDayBeforeCurrentRound(plan, day) {
  const round = Number((plan && plan.currentRound) || 1);
  if (round <= 1 || !day || !Array.isArray(plan.days)) return false;
  const firstDay = plan.days.find(item => (item.chapters || []).some(ch => Number(ch.round || round) === round));
  return Boolean(firstDay) && Number(day.dayNum) < Number(firstDay.dayNum);
}

function renderPlanDayNotice(text) {
  return `
        <div style="text-align: center; padding: 2rem; background: var(--bg-card); border: 1px dashed var(--border-card); border-radius: 14px; color: var(--text-secondary); font-weight: 500; width: 100%;">
          ${text}
        </div>
      `;
}

// 當天紀錄的章節用一般閱讀模式打開（不帶計畫情境）→ 讀到底不會自動打卡成舊的遍數。
function openRecordChapterInReader(bookName, chapter) {
  if (state.readerState) {
    state.readerState.fromPlan = false;
    state.readerState.planDayNum = null;
    state.readerState.planRound = null;
    state.readerState.planContextId = null;
    state.readerState.returnTab = "plan-view";
  }
  openReaderPassage({ book: bookName, chapterFrom: Number(chapter) || 1, verseFrom: 1 });
}

function renderDayReadingRecordsSection(records) {
  const copy = (window.APP_COPY && window.APP_COPY.plan) || {};
  const section = document.createElement("section");
  section.className = "plan-day-records";
  section.setAttribute("aria-label", copy.dayRecordsTitle || "當天閱讀紀錄");
  const rowsHtml = records.groups.map(group => {
    const rangesHtml = group.ranges.map(range => {
      const label = range.from === range.to
        ? `${range.book} ${range.from}章`
        : `${range.book} ${range.from}–${range.to}章`;
      return `<button type="button" class="plan-day-records__range" data-book="${escapeHTML(range.book)}" data-chapter="${range.from}" aria-label="閱讀 ${escapeHTML(label)}">${escapeHTML(label)}</button>`;
    }).join("");
    return `
      <li class="plan-day-records__row">
        <span class="plan-day-records__round">第${group.round}遍</span>
        <span class="plan-day-records__check" aria-hidden="true">${typeof renderIcon === "function" ? renderIcon("check", { size: "sm", className: "nlc-icon" }) : ""}</span>
        <span class="plan-day-records__ranges">${rangesHtml}</span>
      </li>`;
  }).join("");
  section.innerHTML = `
    <h4 class="plan-day-records__title">${escapeHTML(copy.dayRecordsTitle || "當天閱讀紀錄")}</h4>
    <ul class="plan-day-records__list">${rowsHtml}</ul>
  `;
  section.querySelectorAll(".plan-day-records__range").forEach(button => {
    button.addEventListener("click", () => openRecordChapterInReader(button.dataset.book, button.dataset.chapter));
  });
  return section;
}

async function renderPlanScheduleTracker(skipCarouselUpdate = false, signal = null) {

  const container = document.getElementById("plan-tasks-list");
  if (!container || !state.activePlan) return;
  hideDailyQuizSection();

  if (!state.inlineReader?.active) {
    container.classList.remove("hidden");
    const carousel = document.getElementById("plan-date-carousel");
    const planDayHeader = document.getElementById("plan-day-subtitle") ? document.getElementById("plan-day-subtitle").parentElement : null;
    const readBtn = document.getElementById("plan-start-reading-container");
    const inlineReader = document.getElementById("plan-inline-reader");
    if (carousel) carousel.classList.remove("hidden");
    if (planDayHeader) planDayHeader.classList.remove("hidden");
    if (readBtn) readBtn.classList.remove("hidden");
    if (inlineReader) inlineReader.classList.add("hidden");
    document.body.classList.remove("plan-inline-reader-open");
  }

  renderPlanProgressUpgradeOverlay(state.activePlan);

  const currentRequestId = ++lastTrackerRequestId;

  container.innerHTML = "";

  // Set default selected day if not set or invalid for current plan
  let selectedDay = Array.isArray(state.activePlan.days)
    ? state.activePlan.days.find(d => d && d.dayNum === state.selectedPlanDay)
    : null;

  if (!selectedDay && Array.isArray(state.activePlan.days) && state.activePlan.days.length > 0) {
    const nextReadingDay = getNextReadingPlanDay(state.activePlan);
    state.selectedPlanDay = nextReadingDay ? nextReadingDay.dayNum : state.activePlan.days[0].dayNum;
    selectedDay = state.activePlan.days.find(d => d.dayNum === state.selectedPlanDay) || state.activePlan.days[0];
  }

  if (!selectedDay) {
    container.innerHTML = "";
    hideDailyQuizSection();
    return;
  }
  const currentRound = Number(state.activePlan.currentRound || 1);
  const visibleChapters = (selectedDay.chapters || []).filter(ch =>
    Number(ch.round || currentRound) === currentRound
  );
  // 當天實際讀了哪些章（#330）：已經列在本遍任務的不重複列。
  const dayRecords = getDayReadingRecords(
    state.readingLogs,
    getPlanReadingRecordScope(state.activePlan),
    getPlanDayDateKey(selectedDay),
    visibleChapters.map(ch => `${ch.book}_${Number(ch.chapter)}_${Number(ch.round || currentRound)}`)
  );
  // 沒有本遍任務時：有紀錄 → 顯示紀錄；本遍開始前又沒紀錄 → 「無紀錄」；其餘才是休息日。
  const dayEmptyKind = visibleChapters.length > 0
    ? null
    : dayRecords.total > 0
      ? "records"
      : (!selectedDay.isRestDay && isPlanDayBeforeCurrentRound(state.activePlan, selectedDay))
        ? "no_records"
        : "rest";

  // Render day subtitle
  const daySubtitle = document.getElementById("plan-day-subtitle");
  const currentViewDay = document.getElementById("current-view-day");
  const currentViewDate = document.getElementById("current-view-date");

  const year = selectedDay.year || new Date().getFullYear();
  const month = selectedDay.month || (new Date().getMonth() + 1);
  const dayOfMonth = selectedDay.date ? selectedDay.date.split('/')[1] : new Date().getDate();
  const displayDayNumber = isPlanStarted(state.activePlan) ? state.selectedPlanDay : 0;
  const formattedDayText = "第 " + displayDayNumber + " 天";
  const formattedDateText = `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;

  if (daySubtitle) {
    daySubtitle.textContent = `${formattedDayText} (${year}年${month}月${dayOfMonth}日)`;
  }
  if (currentViewDay) {
    currentViewDay.textContent = formattedDayText;
  }
  if (currentViewDate) {
    currentViewDate.textContent = formattedDateText;
  }

  // Check checkPlanSchedule
  await checkPlanSchedule(state.activePlan);

  // Validate abort signal
  if (signal && signal.aborted) {
    return;
  }
  // Validate request pointer after asynchronous block to prevent race condition overrides
  if (currentRequestId !== lastTrackerRequestId) {
    return;
  }

  const isAdmin = state.currentUser && getUserRoleCode(state.currentUser) === 'admin';
  const started = isPlanStarted(state.activePlan) || isAdmin;

  // Render status pill for day
  const statusPill = document.getElementById("plan-day-status-pill");
  if (statusPill) {
    const planCopy = (window.APP_COPY && window.APP_COPY.plan) || {};
    if (dayEmptyKind === "records") {
      statusPill.textContent = String(planCopy.dayRecordsPill || "已讀 {count} 章").replace("{count}", dayRecords.total);
      statusPill.className = "stat-badge stat-badge--success";
    } else if (dayEmptyKind === "no_records") {
      statusPill.textContent = planCopy.dayNoRecordsPill || "無紀錄";
      statusPill.className = "stat-badge stat-badge--neutral";
    } else if (dayEmptyKind === "rest") {
      statusPill.textContent = planCopy.restDayPill || "休息日";
      statusPill.className = "stat-badge stat-badge--brand";
    } else {
      const allDone = visibleChapters.every(ch => {
        const currentRound = state.activePlan.currentRound || 1;
        const taskRound = ch.round || currentRound;
        return Boolean(ch["isReadR" + taskRound] || ch.isRead);
      });
      if (allDone) {
        statusPill.textContent = "已完成";
        statusPill.className = "stat-badge stat-badge--success";
      } else {
        statusPill.textContent = "進行中";
        statusPill.className = "stat-badge stat-badge--warning";
      }
    }
  }

  // Update completion check on the active date card in the calendar dynamically
  const activeCard = document.querySelector(`.plan-day-cell[data-day-num="${state.selectedPlanDay}"]`);
  if (activeCard && state.activePlan) {
    const isDayCompleted = getPlanDayCellStatus(state.activePlan, selectedDay, dayRecords.total).completed;

    if (isDayCompleted) {
      activeCard.classList.add("completed");
      const progressContainer = activeCard.querySelector('.micro-progress-container');
      if (progressContainer) progressContainer.remove();
    } else {
      activeCard.classList.remove("completed");
      const totalCh = visibleChapters.length;
      let completedCh = 0;
      visibleChapters.forEach(ch => {
        const currentRound = state.activePlan.currentRound || 1;
        const taskRound = ch.round || currentRound;
        const isRead = Boolean(ch["isReadR" + taskRound] || ch.isRead);
        if (isRead) completedCh++;
      });

      let progressContainer = activeCard.querySelector('.micro-progress-container');
      if (completedCh > 0 && completedCh < totalCh) {
        if (!progressContainer) {
          progressContainer = document.createElement("div");
          progressContainer.className = "micro-progress-container";
          const progressBar = document.createElement("div");
          progressBar.className = "micro-progress-bar";
          progressContainer.appendChild(progressBar);
          activeCard.appendChild(progressContainer);
        }
        progressContainer.querySelector('.micro-progress-bar').style.width = `${(completedCh / totalCh) * 100}%`;
      } else {
        if (progressContainer) progressContainer.remove();
      }
    }
  }

  // Render items
  if (dayEmptyKind) {
    // 區分「這一天真的是休息日」與「整個計畫排程壞了（每一天都空）」——後者不能
    // 用休息日文案蓋過去，否則跟正常休息日分不出來（桃園延後梯次事故）。
    const planDays = Array.isArray(state.activePlan && state.activePlan.days) ? state.activePlan.days : [];
    const scheduleIsBroken = planDays.length > 0
      && !planDays.some(day => Array.isArray(day.chapters) && day.chapters.length > 0);
    const planCopy = (window.APP_COPY && window.APP_COPY.plan) || {};
    if (scheduleIsBroken) {
      console.error(
        `[plan] 計畫「${state.activePlan.name}」(${state.activePlan.id}) 每一天都沒有章節，排程尚未就緒。`
      );
      container.innerHTML = renderPlanDayNotice("此計畫的每日進度尚未就緒，請聯絡教會同工。");
    } else if (dayEmptyKind === "records") {
      container.appendChild(renderDayReadingRecordsSection(dayRecords));
    } else if (dayEmptyKind === "no_records") {
      container.innerHTML = renderPlanDayNotice(planCopy.dayNoRecordsBanner || "這天沒有閱讀紀錄");
    } else {
      container.innerHTML = renderPlanDayNotice(planCopy.restDayBanner || "今天是補讀或靈修休息日，好好親近神吧");
    }
    hideDailyQuizSection();
    return;
  }

  // 速讀計畫：標出建議的「下一章」；打卡不限順序（#363），任何一章都能勾、能取消。
  const roundCheckState = isSequentialCheckPlan(state.activePlan)
    ? getRoundCheckState(state.activePlan.days, currentRound)
    : null;
  const nextCheckChapter = roundCheckState && roundCheckState.next;
  const gapNotice = renderRoundGapNotice(state.activePlan, roundCheckState);
  if (gapNotice) container.appendChild(gapNotice);

  visibleChapters.forEach(ch => {

    const taskItem = document.createElement("div");
    taskItem.className = "plan-task-item";

    const taskRound = ch.round || currentRound;
    const { cssClass, content } = getChapterCheckboxState(ch, taskRound);
    const roundLabelHtml = taskRound >= 2
      ? `<span class="task-round-label round-${taskRound}">第${taskRound}遍</span>`
      : "";

    const isCurrentRead = Boolean(ch["isReadR" + taskRound] || ch.isRead);
    const isNextChapter = Boolean(nextCheckChapter
      && nextCheckChapter.book === ch.book
      && Number(nextCheckChapter.chapter) === Number(ch.chapter));
    if (isNextChapter) taskItem.classList.add("plan-task-item--next");
    const planCopy = (window.APP_COPY && window.APP_COPY.plan) || {};
    const toggleLabel = `${ch.book} ${ch.chapter}章，${isCurrentRead ? '取消已讀' : '標記已讀'}`;
    const nextLabelHtml = isNextChapter
      ? `<span class="task-next-label">${planCopy.sequentialNextLabel || "下一章"}</span>`
      : "";
    taskItem.innerHTML = `
      <button type="button"
              class="task-read-toggle"
              data-is-current-read="${isCurrentRead ? 'true' : 'false'}"
              aria-pressed="${isCurrentRead ? 'true' : 'false'}"
              aria-label="${toggleLabel}">
        <span class="task-checkbox ${cssClass}" aria-hidden="true">
          ${content}
        </span>
      </button>
      <button type="button" class="task-open-button" aria-label="閱讀 ${ch.book} ${ch.chapter}章">
        <span class="task-title">
          ${ch.book} ${ch.chapter}章${nextLabelHtml}
        </span>
        ${roundLabelHtml}
        <span class="task-arrow" aria-hidden="true">
          ${typeof renderIcon === "function" ? renderIcon("chevronRight", { size: "sm", className: "nlc-icon" }) : ""}
        </span>
      </button>
    `;

    const readToggle = taskItem.querySelector(".task-read-toggle");
    const openButton = taskItem.querySelector(".task-open-button");
    const openChapter = () => window.openPlanChapterInReader(ch.book, ch.chapter, state.selectedPlanDay, taskRound);

    readToggle.addEventListener("click", event => {
      event.stopPropagation();
      if (readToggle.dataset.pending === "true") return;
      readToggle.dataset.pending = "true";
      window.toggleYouVersionChapter(readToggle, ch.book, ch.chapter, taskRound);
      window.setTimeout(() => {
        delete readToggle.dataset.pending;
      }, 450);
    });
    openButton.addEventListener("click", openChapter);
    container.appendChild(taskItem);
  });
  if (dayRecords.total > 0) container.appendChild(renderDayReadingRecordsSection(dayRecords));
  void renderDailyQuizSection(state.activePlan, selectedDay, currentRequestId);

  // 常駐「進入下一遍」按鈕：本遍讀完就出現
  renderRoundAdvanceButton(state.activePlan, selectedDay);
}

let dailyQuizRenderRequestId = 0;
let dailyQuizFeatureRequest = null;

async function isDailyQuizFeatureEnabled() {
  if (typeof window.dailyQuizFeatureEnabled === "boolean") return window.dailyQuizFeatureEnabled;
  if (!dailyQuizFeatureRequest) {
    dailyQuizFeatureRequest = db.getFeatureSetting("daily_quiz", false).then(result => {
      window.dailyQuizFeatureEnabled = !result.error && result.enabled === true;
      return window.dailyQuizFeatureEnabled;
    }).catch(() => false).finally(() => { dailyQuizFeatureRequest = null; });
  }
  return dailyQuizFeatureRequest;
}

// 每日靈修／小組聚會週計畫「功能設定」（migration 0156）：總開關（admin 專屬）
// + 每人一份的個人偏好。get_my_devotion_group_preferences 一次回三個值，這裡
// 快取到同一組全域變數，devotion/group-meeting 兩邊共用一支 request，不用各自
// 打一次 API。window.dailyDevotionFeatureEnabled / groupMeetingPlanFeatureEnabled
// 這兩個變數名稱是舊的（原本代表「全教會共用一個開關」），現在意思改成
// 「目前登入者自己的偏好」——沿用名稱是為了不用逐一改所有既有讀取點。
let devotionGroupPreferencesRequest = null;
async function ensureDevotionGroupPreferencesLoaded() {
  if (typeof window.devotionGroupFeaturesMasterEnabled === "boolean") {
    return {
      masterEnabled: window.devotionGroupFeaturesMasterEnabled,
      dailyDevotion: window.dailyDevotionFeatureEnabled === true,
      groupMeetingPlan: window.groupMeetingPlanFeatureEnabled === true
    };
  }
  if (!devotionGroupPreferencesRequest) {
    devotionGroupPreferencesRequest = Promise.all([
      db.getMyDevotionGroupPreferences(),
      db.getFeatureSetting ? db.getFeatureSetting("devotion_group_hidden", false) : Promise.resolve({ enabled: false })
    ]).then(([res, hiddenRes]) => {
      const data = (res && res.success && res.data) || {};
      window.devotionGroupHidden = !!(hiddenRes && hiddenRes.enabled === true);
      window.devotionGroupFeaturesMasterEnabled = data.masterEnabled === true;
      window.dailyDevotionFeatureEnabled = data.dailyDevotion === true;
      window.groupMeetingPlanFeatureEnabled = data.groupMeetingPlan === true;
      return {
        masterEnabled: window.devotionGroupFeaturesMasterEnabled,
        dailyDevotion: window.dailyDevotionFeatureEnabled,
        groupMeetingPlan: window.groupMeetingPlanFeatureEnabled
      };
    }).catch(() => ({ masterEnabled: false, dailyDevotion: false, groupMeetingPlan: false }))
      .finally(() => { devotionGroupPreferencesRequest = null; });
  }
  return devotionGroupPreferencesRequest;
}
window.ensureDevotionGroupPreferencesLoaded = ensureDevotionGroupPreferencesLoaded;

async function isDailyDevotionFeatureEnabled() {
  const prefs = await ensureDevotionGroupPreferencesLoaded();
  return prefs.dailyDevotion === true;
}
window.isDailyDevotionFeatureEnabled = isDailyDevotionFeatureEnabled;
// 每日靈修計畫對「這個人」看不看得到：
//  · 管理員 / 牧者：一律看得到（先建內容用）。
//  · 一般會友：要「總開關開著」而且「自己在個人分頁功能設定裡開啟」才看得到，
//    是每個人各自的偏好，不是全教會共用一個值。
function isDevotionalPlanVisibleToUser(plan) {
  if (!plan || (plan.planKind || plan.plan_kind) !== "devotional") return true; // 非靈修計畫不受此限
  if (window.devotionGroupHidden === true) return false; // 政策審核期間：對所有人隱藏（含 admin/pastor）
  const role = typeof getUserRoleCode === "function" ? getUserRoleCode(state.currentUser) : null;
  if (role === "admin" || role === "pastor") return true;
  if (window.devotionGroupFeaturesMasterEnabled !== true) return false;
  return window.dailyDevotionFeatureEnabled === true;
}
window.isDevotionalPlanVisibleToUser = isDevotionalPlanVisibleToUser;
// 總開關還沒開＝功能整個還沒對會友開放（只有管理員/牧者看得到，可以先建內容）。
function isDevotionalPlanDevMode(plan) {
  return (plan && (plan.planKind || plan.plan_kind) === "devotional")
    && window.devotionGroupHidden !== true
    && window.devotionGroupFeaturesMasterEnabled !== true;
}
window.isDevotionalPlanDevMode = isDevotionalPlanDevMode;

// 管理員預覽：直接把某靈修計畫設為 activePlan 並切到「計畫」分頁的詳情
// （enterPlanDetailState 的 devotional 分支會渲染 renderDevotionViewer）。
function previewDevotionalPlanAsMember(globalPlanId) {
  const gp = (state.globalPlans || []).find(p => String(p.id) === String(globalPlanId)
    || String(p.globalPlanId) === String(globalPlanId));
  if (!gp) return;
  state.activePlan = gp;
  state.planDetailOpen = true;
  state.planActiveSubTab = "today";
  const onPlanTab = typeof window.appRouter !== "undefined" && window.appRouter.currentTab === "plan-view";
  if (onPlanTab && typeof setPlanState === "function") {
    setPlanState(PLAN_ROUTE.DETAIL);
  } else if (typeof window.appRouter !== "undefined" && typeof window.appRouter.switchTab === "function") {
    window.appRouter.switchTab("plan-view", { keepPlanDetail: true });
  }
}
window.previewDevotionalPlanAsMember = previewDevotionalPlanAsMember;

// ── 小組聚會週計畫（plan_kind='group_meeting'，migration 0148）──────────────
// 跟每日靈修共用同一支「功能設定」總開關 + 個人偏好（見上面
// ensureDevotionGroupPreferencesLoaded，migration 0156）。
async function isGroupMeetingFeatureEnabled() {
  const prefs = await ensureDevotionGroupPreferencesLoaded();
  return prefs.groupMeetingPlan === true;
}
window.isGroupMeetingFeatureEnabled = isGroupMeetingFeatureEnabled;
function isGroupMeetingPlanVisibleToUser(plan) {
  if (!plan || (plan.planKind || plan.plan_kind) !== "group_meeting") return true;
  if (window.devotionGroupHidden === true) return false; // 政策審核期間：對所有人隱藏（含 admin/pastor）
  const role = typeof getUserRoleCode === "function" ? getUserRoleCode(state.currentUser) : null;
  if (role === "admin" || role === "pastor") return true;
  if (window.devotionGroupFeaturesMasterEnabled !== true) return false;
  return window.groupMeetingPlanFeatureEnabled === true;
}
window.isGroupMeetingPlanVisibleToUser = isGroupMeetingPlanVisibleToUser;
function isGroupMeetingPlanDevMode(plan) {
  return (plan && (plan.planKind || plan.plan_kind) === "group_meeting")
    && window.devotionGroupHidden !== true
    && window.devotionGroupFeaturesMasterEnabled !== true;
}
window.isGroupMeetingPlanDevMode = isGroupMeetingPlanDevMode;
function previewGroupMeetingPlanAsMember(globalPlanId) {
  const gp = (state.globalPlans || []).find(p => String(p.id) === String(globalPlanId)
    || String(p.globalPlanId) === String(globalPlanId));
  if (!gp) return;
  state.activePlan = gp;
  state.planDetailOpen = true;
  state.planActiveSubTab = "today";
  const onPlanTab = typeof window.appRouter !== "undefined" && window.appRouter.currentTab === "plan-view";
  if (onPlanTab && typeof setPlanState === "function") {
    setPlanState(PLAN_ROUTE.DETAIL);
  } else if (typeof window.appRouter !== "undefined" && typeof window.appRouter.switchTab === "function") {
    window.appRouter.switchTab("plan-view", { keepPlanDetail: true });
  }
}
window.previewGroupMeetingPlanAsMember = previewGroupMeetingPlanAsMember;

window.addEventListener("daily-quiz-feature-changed", event => {
  window.dailyQuizFeatureEnabled = event.detail?.enabled === true;
  if (!window.dailyQuizFeatureEnabled) {
    hideDailyQuizSection();
    return;
  }
  const selectedDay = Array.isArray(state.activePlan?.days)
    ? state.activePlan.days.find(day => day?.dayNum === state.selectedPlanDay)
    : null;
  if (state.activePlan && selectedDay) {
    void renderDailyQuizSection(state.activePlan, selectedDay, lastTrackerRequestId);
  }
});

function quizEscape(value) {
  return typeof escapeHTML === "function"
    ? escapeHTML(String(value ?? ""))
    : String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[character]);
}

function hideDailyQuizSection() {
  dailyQuizRenderRequestId += 1;
  const section = document.getElementById("daily-quiz-section");
  const content = document.getElementById("daily-quiz-content");
  if (section) section.classList.add("hidden");
  if (content) content.innerHTML = "";
}

function quizPublisherLabel(role) {
  return ({
    admin: "系統管理員",
    pastor: "牧者",
    great_zone_leader: "大區長",
    zone_leader: "區長",
    group_leader: "小組長"
  })[role] || "管理者";
}

function getDailyQuizTaiwanToday() {
  if (typeof window.getTaiwanTodayISO === "function") return window.getTaiwanTodayISO();
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// 已經讀完一遍（第一遍全部打卡，或已進入第 2 遍以後）就不再檢查當天進度，
// 每次小測驗都可以直接作答；判斷方式跟 memberIsCompletedOnce 同一套。
function hasCompletedDailyQuizFirstRound(plan) {
  return Boolean(plan?.isPlanCompleted) || Number(plan?.currentRound || 1) > 1;
}

function getDailyQuizReadingProgress(plan, quizDate) {
  const round = Number(plan?.currentRound || 1);
  if (hasCompletedDailyQuizFirstRound(plan)) {
    return { total: 0, completed: 0, remaining: 0, isComplete: true, firstRoundCompleted: true };
  }
  const day = Array.isArray(plan?.days)
    ? plan.days.find(item => String(item?.isoDate || "") === String(quizDate || ""))
    : null;
  const chapters = Array.isArray(day?.chapters)
    ? day.chapters.filter(chapter => Number(chapter?.round || round) === round)
    : [];
  const completed = chapters.filter(chapter => Boolean(chapter?.[`isReadR${round}`] || chapter?.isRead)).length;
  return {
    total: chapters.length,
    completed,
    remaining: Math.max(0, chapters.length - completed),
    isComplete: chapters.length > 0 && completed === chapters.length
  };
}

function openDailyQuizContent(content, context, plan, quizDate) {
  if (!context.myQuiz) return;
  renderAssignedDailyQuiz(content, context.myQuiz, plan, quizDate);
  if (typeof hydrateIcons === "function") hydrateIcons(content);
}

// 發佈／編輯／匯入題目已搬去系統管理後台（admin.js 的「小測驗」分頁），
// 打卡清單這裡只保留會友「進入小測驗/作答」的入口，所以只在有指派給自己
// 的測驗（context.myQuiz）時才會被呼叫——見 renderDailyQuizSection 的 gate。
function formatDailyQuizTaiwanClock(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false
    });
  } catch {
    return "";
  }
}

function renderDailyQuizEntry(content, context, plan, quizDate) {
  const assignedQuiz = context.myQuiz;
  if (!assignedQuiz) return;
  const isCompleted = Boolean(assignedQuiz.attempt);
  // answerCloseAt（migration 0189）是排程發佈才會有的可選作答截止時間；立即
  // 發佈的測驗沒有這個欄位，isClosed 一律是 false，行為跟以前完全一樣。
  const isClosed = !isCompleted && Boolean(assignedQuiz.answerCloseAt)
    && new Date(assignedQuiz.answerCloseAt).getTime() < Date.now();
  const buttonLabel = isCompleted ? "查看測驗結果" : isClosed ? "作答已截止" : "進入小測驗";
  const description = isCompleted
    ? "今天的小測驗已完成，可查看答案與解說"
    : isClosed
      ? `作答時間已於 ${formatDailyQuizTaiwanClock(assignedQuiz.answerCloseAt)} 截止`
      : hasCompletedDailyQuizFirstRound(plan)
        ? "你已讀完一遍，可以直接作答"
        : "完成今天的速讀進度後即可作答";

  content.innerHTML = `
    <button type="button" class="daily-quiz-entry-button" id="daily-quiz-entry-button" aria-describedby="daily-quiz-entry-description" ${isClosed ? "disabled" : ""}>
      <span class="daily-quiz-entry-icon" aria-hidden="true"><span class="nlc-icon" data-icon="checkOne"></span></span>
      <span class="daily-quiz-entry-copy">
        <strong>小測驗</strong>
        <small id="daily-quiz-entry-description">${description}</small>
      </span>
      <span class="daily-quiz-entry-action">${buttonLabel}<span class="nlc-icon nlc-icon--sm" data-icon="chevronRight" aria-hidden="true"></span></span>
    </button>`;

  if (isClosed) return;

  content.querySelector("#daily-quiz-entry-button")?.addEventListener("click", () => {
    if (!isCompleted) {
      const progress = getDailyQuizReadingProgress(plan, quizDate);
      if (!progress.isComplete) {
        const message = progress.total > 0
          ? `請先閱讀完今天的速讀進度，再進入小測驗（尚有 ${progress.remaining} 章）。`
          : "請先完成今天的速讀進度，再進入小測驗。";
        if (typeof showToast === "function") showToast(message);
        return;
      }
    }
    openDailyQuizContent(content, context, plan, quizDate);
  });
}

function renderCompletedDailyQuiz(content, quiz) {
  const attempt = quiz.attempt;
  const questions = (quiz.questions || []).map(normalizeQuestion);
  content.innerHTML = `
    <div class="daily-quiz-heading">
      <div><p class="daily-quiz-eyebrow">今日小測驗</p><h3 id="daily-quiz-title">完成作答</h3></div>
      <span class="daily-quiz-score">${Number(attempt.score ?? 0)}／${Number(attempt.total ?? questions.length)}</span>
    </div>
    ${renderDailyQuizReviewHtml(attempt, questions)}`;
  drawMatchReviewLines(content);
}

// 逐題送出＋最後結算，取代整份一次送出：每題一填完就各自小寫入一次
// （daily_quiz_submit_answer 設計成同一題重送會覆蓋、可安全重複執行），
// 「送出答案」按下去時再把每題目前的作答值保險地全部重送一次
// （排除競態/漏送風險），確認每題都成功後才呼叫 finalize 結算分數——
// 全程沒有「整份題目一次送出」這個動作，結構上排除大 payload 被截斷的風險。
function bindDailyQuizAnswering(content, quiz, questions, plan, quizDate) {
  const form = content.querySelector("#daily-quiz-form");
  if (!form) return;

  const fieldsetsByQuestionId = new Map(
    Array.from(form.querySelectorAll("[data-question-id]")).map(el => [el.getAttribute("data-question-id"), el])
  );
  const responses = new Map();
  const timings = new Map();
  let lastAnsweredAt = Date.now();

  questions.forEach(question => {
    const fieldset = fieldsetsByQuestionId.get(question.id);
    if (!fieldset) return;
    bindQuestionFieldset(fieldset, question.type, response => {
      responses.set(question.id, response);
      if (!isResponseComplete(question.type, response, question.payload)) return;
      if (!timings.has(question.id)) {
        const now = Date.now();
        timings.set(question.id, Math.max(0, Math.round((now - lastAnsweredAt) / 1000)));
        lastAnsweredAt = now;
      }
      void db.submitDailyQuizAnswer(quiz.publicationId, question.id, response, timings.get(question.id));
    });
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const incomplete = questions.some(question => {
      const response = readResponseFromFieldset(fieldsetsByQuestionId.get(question.id), question.type);
      responses.set(question.id, response);
      return !isResponseComplete(question.type, response, question.payload);
    });
    if (incomplete) {
      if (typeof showToast === "function") showToast(`請完成全部 ${questions.length} 題後再送出`);
      return;
    }
    const button = form.querySelector("button[type='submit']");
    const originalLabel = button?.textContent;
    if (button) { button.disabled = true; button.textContent = "送出中…"; }

    const submissions = await Promise.all(questions.map(question =>
      db.submitDailyQuizAnswer(quiz.publicationId, question.id, responses.get(question.id), timings.get(question.id) ?? null)
    ));
    const failed = submissions.find(result => !result.success);
    if (failed) {
      if (button) { button.disabled = false; button.textContent = originalLabel; }
      if (typeof showToast === "function") showToast(failed.message || "小測驗送出失敗");
      return;
    }

    const result = await db.finalizeDailyQuizAttempt(quiz.publicationId);
    if (!result.success) {
      if (button) { button.disabled = false; button.textContent = originalLabel; }
      if (typeof showToast === "function") showToast(result.message || "小測驗送出失敗");
      return;
    }
    // 離線時 db.finalizeDailyQuizAttempt 被 PwaCoordinator 攔截排進佇列，
    // 回傳 success:true 但沒有 data.score（伺服器還沒真的結算）。這裡先不要
    // 當作已完成重繪（伺服器端狀態其實還是 in_progress），恢復連線後佇列會
    // 自動送出，屆時再重新整理就能看到真正的分數。
    if (result.queued) {
      if (button) button.textContent = "已離線儲存，待連線後自動送出";
      if (typeof showToast === "function") showToast("目前離線，答案已安全儲存，恢復連線後會自動送出並計算成績。");
      return;
    }
    if (typeof showToast === "function") showToast(`作答完成：${result.data.score}／${result.data.total}`);
    void renderDailyQuizSection(plan, { isoDate: quizDate }, lastTrackerRequestId, { open: true });
  });
}

function renderAssignedDailyQuiz(content, quiz, plan, quizDate) {
  if (quiz.attempt) {
    renderCompletedDailyQuiz(content, quiz);
    return;
  }
  const questions = (quiz.questions || []).map(normalizeQuestion);
  // 同一位會友同一天重畫時選項順序不變（自訂題 id 如 c1 每天重複，所以帶計畫＋日期）。
  const shuffleSeed = `${state.currentUser?.id || ""}:${plan?.id || ""}:${quizDate}`;
  content.innerHTML = `
    <div class="daily-quiz-heading">
      <div><p class="daily-quiz-eyebrow">今日小測驗</p><h3 id="daily-quiz-title">${questions.length} 題</h3></div>
      <span class="daily-quiz-status">已由${quizPublisherLabel(quiz.publisherRole)}發佈</span>
    </div>
    <form id="daily-quiz-form" class="daily-quiz-form">
      ${questions.map((question, index) => renderQuestionFieldsetHtml(question, index, { shuffleSeed })).join("")}
      <button type="submit" class="primary-btn daily-quiz-submit">送出答案</button>
    </form>`;
  bindDailyQuizAnswering(content, quiz, questions, plan, quizDate);
}

async function renderDailyQuizSection(plan, selectedDay, trackerRequestId, options = {}) {
  const section = document.getElementById("daily-quiz-section");
  const content = document.getElementById("daily-quiz-content");
  if (!section || !content || !plan || !selectedDay) return;
  if (!await isDailyQuizFeatureEnabled()) {
    hideDailyQuizSection();
    return;
  }
  const quizDate = String(selectedDay.isoDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(quizDate)
    || quizDate !== getDailyQuizTaiwanToday()
    || typeof db === "undefined"
    || typeof db._quizPlanId !== "function"
    || !db._quizPlanId(plan)) {
    hideDailyQuizSection();
    return;
  }

  const requestId = ++dailyQuizRenderRequestId;
  const result = await db.getDailyQuizDashboard(plan, quizDate);
  if (requestId !== dailyQuizRenderRequestId || trackerRequestId !== lastTrackerRequestId) return;
  if (!result.success) {
    hideDailyQuizSection();
    return;
  }
  const context = result.context || {};
  if (!context.myQuiz) {
    hideDailyQuizSection();
    return;
  }

  section.classList.remove("hidden");
  if (options.open === true) {
    if (context.myQuiz && !context.myQuiz.attempt) {
      const progress = getDailyQuizReadingProgress(plan, quizDate);
      const isClosed = Boolean(context.myQuiz.answerCloseAt)
        && new Date(context.myQuiz.answerCloseAt).getTime() < Date.now();
      if (!progress.isComplete || isClosed) {
        renderDailyQuizEntry(content, context, plan, quizDate);
        return;
      }
    }
    openDailyQuizContent(content, context, plan, quizDate);
  } else {
    renderDailyQuizEntry(content, context, plan, quizDate);
  }
  if (typeof hydrateIcons === "function") hydrateIcons(section);
}

function getChapterCheckboxState(ch, currentRound) {
  const ICON_R1 = typeof renderIcon === "function" ? renderIcon("check", { size: "sm", className: "nlc-icon" }) : "";
  const ICON_R2 = typeof renderIcon === "function" ? renderIcon("zap", { size: "sm", className: "nlc-icon" }) : "";
  const ICON_R3 = typeof renderIcon === "function" ? renderIcon("star", { size: "sm", className: "nlc-icon" }) : "";
  const ICON_RX = typeof renderIcon === "function" ? renderIcon("trendingUp", { size: "sm", className: "nlc-icon" }) : "";

  if (currentRound === 1) {
    return ch.isReadR1 ? { cssClass: 'checked', content: ICON_R1 } : { cssClass: '', content: '' };
  }

  if (currentRound === 2) {
    return ch.isReadR2 ? { cssClass: 'checked round-2', content: ICON_R2 } : { cssClass: '', content: '' };
  }

  if (currentRound === 3) {
    return ch.isReadR3 ? { cssClass: 'checked round-3', content: ICON_R3 } : { cssClass: '', content: '' };
  }

  if (currentRound >= 4) {
    const isRead = Boolean(ch["isReadR" + currentRound] || ch.isRead);
    return isRead ? { cssClass: 'checked round-3', content: ICON_RX } : { cssClass: '', content: '' };
  }

  return { cssClass: '', content: '' };
}

window.toggleYouVersionChapter = function (checkboxEl, book, chapter, taskRound = null) {

  const isCurrentlyRead = checkboxEl.dataset.isCurrentRead === 'true';
  const willBeChecked = !isCurrentlyRead;
  const currentRound = taskRound || (state.activePlan ? (state.activePlan.currentRound || 1) : 1);

  // 未發布或尚未到開始日的階段只能預覽；允許取消先前誤記的已讀。
  if (willBeChecked && isPlanProgressLocked(state.activePlan, { hidden: window.isPlanHidden?.(state.activePlan) })) {
    showToast("此階段尚未正式開放，目前僅供預覽，無法記錄已讀。");
    if (checkboxEl) checkboxEl.checked = isCurrentlyRead;
    return;
  }

  // 💡 關鍵修復：唯讀歷史鎖定，防止誤觸修改已完成遍數的打卡紀錄
  if (state.activePlan && currentRound < (state.activePlan.currentRound || 1)) {
    showToast("此遍進度已完成存檔，無法修改以前的打卡紀錄。");
    if (checkboxEl) {
      checkboxEl.checked = isCurrentlyRead;
    }
    return;
  }

  if (state.activePlan && isPlanExpired(state.activePlan)) {
    showToast(getPlanEndedNotice(state.activePlan.endDate));
    if (checkboxEl) {
      checkboxEl.checked = isCurrentlyRead;
    }
    return;
  }

  if (state.offlineMode) {
    showToast("離線閱讀模式無法記錄進度，恢復連線後再試");
    if (checkboxEl) {
      checkboxEl.checked = isCurrentlyRead;
    }
    return;
  }

  if (checkboxEl) {
    checkboxEl.setAttribute("aria-pressed", String(willBeChecked));
    checkboxEl.setAttribute("aria-label", `${book} ${chapter}章，${willBeChecked ? "取消已讀" : "標記已讀"}`);
  }
  const selectedDay = state.activePlan && state.activePlan.days
    ? state.activePlan.days.find(d => d.dayNum === state.selectedPlanDay)
    : null;
  const chapterObj = selectedDay && selectedDay.chapters
    ? selectedDay.chapters.find(ch => ch.book === book && Number(ch.chapter) === Number(chapter) && (ch.round || currentRound) === currentRound)
    : null;

  const applyLocalReadState = (ch, checked) => {
    if (!ch) return;
    ch["isReadR" + currentRound] = checked;
    ch.isRead = checked;
  };

  const updateLocalReadingLogs = (book, chapter, round, checked) => {
    if (!state.readingLogs) state.readingLogs = [];
    if (checked) {
      const exists = state.readingLogs.some(l =>
        l.book === book &&
        Number(l.chapter) === Number(chapter) &&
        Number(l.round || 1) === Number(round) &&
        (l.plan_id === (state.activePlan ? state.activePlan.id : null) ||
          l.presetKey === (state.activePlan ? state.activePlan.presetKey : null))
      );
      if (!exists) {
        state.readingLogs.push({
          book: book,
          chapter: Number(chapter),
          round: Number(round),
          plan_id: state.activePlan ? state.activePlan.id : null,
          presetKey: state.activePlan ? state.activePlan.presetKey : null,
          preset_key: state.activePlan ? state.activePlan.presetKey : null,
          read_at: new Date().toISOString()
        });
      }
    } else {
      state.readingLogs = state.readingLogs.filter(l => !(
        l.book === book &&
        Number(l.chapter) === Number(chapter) &&
        Number(l.round || 1) === Number(round) &&
        ((state.activePlan && l.plan_id && l.plan_id === state.activePlan.id) ||
          (state.activePlan && l.presetKey && l.presetKey === state.activePlan.presetKey) ||
          (!state.activePlan && !l.plan_id && !l.presetKey) ||
          ((l.plan_id === null || l.plan_id === undefined) && (l.presetKey === null || l.presetKey === undefined)))
      ));
    }
  };

  // 1. 💡 立即在本機更新記憶體狀態與 UI 渲染（完全零延遲）
  updateLocalReadingLogs(book, chapter, currentRound, willBeChecked);
  applyLocalReadState(chapterObj, willBeChecked);
  calculatePlanProgress();

  // Set dataVersion to optimistically propagate changes to all listening views via CustomEvent
  window.setDataVersion(prev => prev + 1);

  // ── Cross-tab data sync: notify all loaded modules via unified event bus ──
  // Using an event prevents direct dependency on functions that may not be loaded yet.
  window.dispatchEvent(new CustomEvent("app:dataRefresh", { detail: { scope: "plan" } }));

  // 2. 💡 在背景非同步向 Supabase 發送寫入請求，不要阻塞使用者操作
  db.logChapterRead(book, chapter, willBeChecked, currentRound)
    .then(async () => {
      db.saveLocalUserStats();
      if (state.activePlan) {
        const plan = state.activePlan;
        calculatePlanProgress();
        if (plan.progress >= 100) {
          await handleRoundCompletion(plan);
        }
        if (willBeChecked && typeof window.checkAndPromptTodayCompletion === "function") {
          await window.checkAndPromptTodayCompletion();
        }
      }
    })
    .catch(error => {
      console.error("Failed to update reading progress in background", error);
      // 💡 同步失敗時，自動還原打勾狀態並提示使用者
      updateLocalReadingLogs(book, chapter, currentRound, isCurrentlyRead);
      applyLocalReadState(chapterObj, isCurrentlyRead);
      calculatePlanProgress();
      renderPlanScheduleTracker(true);
      showToast((window.APP_COPY && window.APP_COPY.plan.syncFail) || "進度沒同步成功，等一下再試試");
      // ── Re-sync dashboard after rollback via event bus ──
      window.dispatchEvent(new CustomEvent("app:dataRefresh", { detail: { scope: "plan" } }));
    });
};

// readChapterDirect removed 2026-09-16: zero callers anywhere in js/ —
// superseded by openReaderPassage.

// 靈修「打開閱讀器」：進入聖經讀經、整章顯示，直接跳到該經文的起始節。
// ref = {book, chapterFrom, verseFrom, verseTo}
function openReaderPassage(ref) {
  if (!ref || !ref.book) return;
  const book = BIBLE_BOOKS.find(b => b.name === ref.book);
  if (!book) return;
  state.readerState.bookId = book.id;
  state.readerState.chapter = Number(ref.chapterFrom) || 1;
  state.readerState.pendingScrollVerse = Number(ref.verseFrom) || 1;
  try { if (typeof saveReaderPreferences === "function") saveReaderPreferences(); } catch (_) {}
  if (typeof appRouter !== "undefined" && typeof appRouter.switchTab === "function") {
    appRouter.switchTab("reader-view");
  }
}
window.openReaderPassage = openReaderPassage;

// 從「使徒行傳 4:23-31」/「使徒行傳 7:54-8:1」這種標籤，退而求其次解析出經文範圍。
// 當批次匯入沒帶結構化 passageRefs 時，仍能讓「經文進度」列可點。
function parsePassageLabel(label) {
  if (!label || typeof label !== "string") return null;
  const m = label.trim().match(/^(.+?)\s*(\d+)\s*[:：]\s*(\d+)\s*(?:[-~–—]\s*(?:(\d+)\s*[:：]\s*)?(\d+))?\s*[a-z]?\s*$/i);
  if (!m) return null;
  const book = m[1].trim();
  if (!(window.BIBLE_BOOKS || []).some(b => b.name === book)) return null;
  const chapterFrom = Number(m[2]) || 1;
  const verseFrom = Number(m[3]) || 1;
  const chapterTo = m[4] ? Number(m[4]) : chapterFrom;
  const verseTo = m[5] ? Number(m[5]) : verseFrom;
  return { book, chapterFrom, verseFrom, chapterTo, verseTo };
}
window.parsePassageLabel = parsePassageLabel;

// 靈修「經文進度」點下去：先在靈修畫面內「只顯示該段經文」（風格沿用讀經系統的
// .bible-verse / .verse-num / .verse-text），再按「查看完整章節」才切到聖經讀經系統。
async function renderDevotionPassageInline(host, ref, label, onBack) {
  if (!host || !ref || !ref.book) { if (typeof onBack === "function") onBack(); return; }
  const version = String((state.readerState && state.readerState.version) || "CUNP").toUpperCase();
  const book = (window.BIBLE_BOOKS || []).find(b => b.name === ref.book);
  const chapFrom = Number(ref.chapterFrom) || 1;
  const chapTo = Math.max(chapFrom, Number(ref.chapterTo) || chapFrom);
  const vFrom = Number(ref.verseFrom) || 1;
  const vTo = Number(ref.verseTo) || 9999;
  const refLabel = label || `${ref.book} ${chapFrom}:${vFrom}`;
  const chevL = typeof renderIcon === "function" ? renderIcon("chevronLeft", { size: "sm", className: "nlc-icon" }) : "‹";

  host.innerHTML = `
    <div class="devotion-view">
      <section class="devotion-passage">
        <div class="devotion-passage__bar">
          <button type="button" class="devotion-passage__back" data-devo-passage-back>${chevL}<span>返回靈修</span></button>
          <span class="devotion-passage__ref">${escapeHTML(refLabel)}</span>
          <span class="devotion-passage__ver">${escapeHTML(version)}</span>
        </div>
        <div class="devotion-passage__text"><p class="devotion-view__muted">正在載入經文…</p></div>
        <button type="button" class="secondary-btn devotion-passage__full" data-devo-passage-full>查看完整章節</button>
      </section>
    </div>`;

  host.querySelector("[data-devo-passage-back]")?.addEventListener("click", () => { if (typeof onBack === "function") onBack(); });
  host.querySelector("[data-devo-passage-full]")?.addEventListener("click", () => {
    if (typeof openReaderPassage === "function") openReaderPassage(ref);
  });
  if (typeof hydrateIcons === "function") hydrateIcons(host);

  const textEl = host.querySelector(".devotion-passage__text");
  if (!book) {
    if (textEl) textEl.innerHTML = `<p class="devotion-view__muted">找不到「${escapeHTML(ref.book)}」這卷書，請直接看完整章節。</p>`;
    return;
  }

  try {
    const rows = [];
    const lastChap = Math.min(chapTo, chapFrom + 3); // 保險：最多跨 4 章
    for (let c = chapFrom; c <= lastChap; c++) {
      const data = await fetchBibleChapter(book.eng, c, version);
      const verses = (data && Array.isArray(data.verses)) ? data.verses : [];
      const lo = c === chapFrom ? vFrom : 1;
      const hi = c === chapTo ? vTo : 9999;
      const picked = verses.filter(v => Number(v.verse) >= lo && Number(v.verse) <= hi);
      if (lastChap > chapFrom && picked.length) rows.push(`<div class="devotion-passage__chap">${escapeHTML(book.name)} ${c}章</div>`);
      picked.forEach(v => {
        rows.push(`<div class="bible-verse" data-verse="${v.verse}"><span class="verse-num">${v.verse}</span><span class="verse-text">${v.text}</span></div>`);
      });
    }
    if (textEl) textEl.innerHTML = rows.length
      ? rows.join("")
      : `<p class="devotion-view__muted">這段經文暫時載入不到，請點「查看完整章節」。</p>`;
  } catch (_) {
    if (textEl) textEl.innerHTML = `<p class="devotion-view__muted">經文載入失敗，請點「查看完整章節」。</p>`;
  }
}
window.renderDevotionPassageInline = renderDevotionPassageInline;

// 分享用：把靈修某段經文抓成純文字（「1 經文內容\n2 …」，跨章加「書名 N章」標題）。
// 沿用 renderDevotionPassageInline 同一套抓法，只是輸出純文字（v.text 去標籤）。
async function fetchDevotionPassagePlainText(ref) {
  if (!ref || !ref.book || typeof fetchBibleChapter !== "function") return "";
  const version = String((state.readerState && state.readerState.version) || "CUNP").toUpperCase();
  const book = (window.BIBLE_BOOKS || []).find(b => b.name === ref.book);
  if (!book) return "";
  const chapFrom = Number(ref.chapterFrom) || 1;
  const chapTo = Math.max(chapFrom, Number(ref.chapterTo) || chapFrom);
  const vFrom = Number(ref.verseFrom) || 1;
  const vTo = Number(ref.verseTo) || 9999;
  const strip = (html) => {
    try {
      const d = document.createElement("div");
      d.innerHTML = String(html || "");
      return (d.textContent || "").replace(/\s+/g, " ").trim();
    } catch (_) {
      return String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    }
  };
  const out = [];
  const lastChap = Math.min(chapTo, chapFrom + 3); // 保險：最多跨 4 章
  for (let c = chapFrom; c <= lastChap; c++) {
    let data = null;
    try { data = await fetchBibleChapter(book.eng, c, version); } catch (_) { data = null; }
    const verses = (data && Array.isArray(data.verses)) ? data.verses : [];
    const lo = c === chapFrom ? vFrom : 1;
    const hi = c === chapTo ? vTo : 9999;
    const picked = verses.filter(v => Number(v.verse) >= lo && Number(v.verse) <= hi);
    if (lastChap > chapFrom && picked.length) out.push(`${book.name} ${c}章`);
    picked.forEach(v => { const t = strip(v.text); if (t) out.push(`${v.verse} ${t}`); });
  }
  return out.join("\n");
}
window.fetchDevotionPassagePlainText = fetchDevotionPassagePlainText;

// updatePlanCheckboxState removed 2026-09-16: zero callers anywhere in js/
// (already just a redraw-fallback stub; scripts/plan-reader-immersive.test.mjs
// already asserted bible.js doesn't call it).

async function checkPlanSchedule(plan) {
  // Since manual settings and downgrades are removed, and levels only go up automatically,
  // we do not perform lag/lead checks or automatic downgrades.
  return;
}

function showCongratsModal(plan, round) {
  const availability = getPlanUpgradeAvailability(plan, { expired: isPlanExpired(plan) });
  if (!availability.eligible || availability.currentRound !== Number(round)) return;

  const oldModal = document.getElementById("congrats-modal");
  if (oldModal) oldModal.remove();

  const modal = document.createElement("div");
  modal.id = "congrats-modal";
  modal.className = "congrats-modal-overlay plan-upgrade-gate";
  modal.dataset.planUpgradePrompt = "true";
  modal.dataset.planKey = String(plan.id || plan.globalPlanId || plan.presetKey || plan.name || "plan");
  modal.dataset.planRound = String(availability.currentRound);
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "plan-upgrade-title");

  modal.innerHTML = `
    <div class="congrats-modal-box plan-upgrade-gate__panel">
      <span class="plan-upgrade-gate__icon" aria-hidden="true">
        <span class="nlc-icon nlc-icon--lg" data-icon="trophy"></span>
      </span>
      <p class="plan-upgrade-gate__eyebrow">${availability.currentRoundLabel}已完成</p>
      <h3 class="congrats-title" id="plan-upgrade-title">是否開始${availability.nextRoundLabel}？</h3>
      <p class="congrats-desc-secondary">確認後會先建立${availability.nextRoundLabel}的閱讀排程，完成後才回到進度頁。</p>
      <p class="plan-upgrade-gate__status" id="plan-upgrade-status" aria-live="polite"></p>
      <div class="congrats-actions">
        <button id="btn-modal-upgrade" type="button" class="congrats-upgrade-btn">開始${availability.nextRoundLabel}</button>
        <button id="btn-modal-later" type="button" class="congrats-later-btn">稍後再說</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  if (typeof hydrateIcons === "function") hydrateIcons(modal);

  modal.querySelector("#btn-modal-upgrade")?.addEventListener("click", () => window.triggerPlanUpgradeFlow());
  modal.querySelector("#btn-modal-later")?.addEventListener("click", () => {
    plan.upgradeOverlayDismissedRound = availability.currentRound;
    modal.remove();
  });
}

function setPlanUpgradeOverlayBusy(busy, nextRoundLabel = "", errorMessage = "") {
  const modal = document.getElementById("congrats-modal");
  if (!modal || modal.dataset.planUpgradePrompt !== "true") return;
  const panel = modal.querySelector(".plan-upgrade-gate__panel");
  const upgradeButton = modal.querySelector("#btn-modal-upgrade");
  const laterButton = modal.querySelector("#btn-modal-later");
  const status = modal.querySelector("#plan-upgrade-status");

  modal.classList.toggle("is-busy", busy);
  panel?.setAttribute("aria-busy", String(busy));
  if (upgradeButton) {
    upgradeButton.disabled = busy;
    upgradeButton.textContent = busy ? `正在建立${nextRoundLabel}排程…` : `開始${nextRoundLabel}`;
  }
  if (laterButton) laterButton.disabled = busy;
  if (status) {
    status.textContent = errorMessage || (busy ? `正在分配${nextRoundLabel}進度，請稍候。` : "");
    status.classList.toggle("is-error", Boolean(errorMessage));
  }
}

window.triggerPlanUpgradeFlow = async function() {
  const plan = state.activePlan;
  if (!plan) return;
  if (planUpgradeInFlight) return;

  if (isPlanExpired(plan)) {
    showToast("計畫時間已過，無法再進行升級。");
    const modal = document.getElementById("congrats-modal");
    if (modal) modal.remove();
    return;
  }

  const upgradeAvailability = getPlanUpgradeAvailability(plan, { expired: false });
  if (!upgradeAvailability.eligible) {
    showToast("完成目前這一遍後，才能開始下一遍。");
    return;
  }

  const currentRound = upgradeAvailability.currentRound;
  const nextRound = upgradeAvailability.nextRound;
  const previousPlanState = {
    currentRound: plan.currentRound,
    days: plan.days,
    totalDays: plan.totalDays,
    totalChapters: plan.totalChapters,
    currentRoundTotalChapters: plan.currentRoundTotalChapters,
    completedChapters: plan.completedChapters,
    progress: plan.progress,
    currentRoundStartedAt: plan.currentRoundStartedAt,
    lastUpgradedRound: plan.lastUpgradedRound,
    upgradePromptHandled: plan.upgradePromptHandled
  };
  planUpgradeInFlight = true;
  setPlanUpgradeOverlayBusy(true, upgradeAvailability.nextRoundLabel);

  // 記錄此類別完成的遍數，並觸發勳章解鎖檢查（cohort 階段與正式階段拿同一個獎）
  if (window.isCampaignStagePlan(plan)) {
    const stageNo = Number(plan.stageNo || (plan.campaignDefinition && plan.campaignDefinition.stageNo) || 0);
    if (stageNo > 0) {
      const completedRoundsKey = `church_stage_completed_rounds_${stageNo}`;
      const previousCompletedRounds = Number(localStorage.getItem(completedRoundsKey) || 0);
      localStorage.setItem(completedRoundsKey, String(Math.max(previousCompletedRounds, currentRound)));

      const badgeId = `church_stage_award_${stageNo}`;
      const unlockedBadges = JSON.parse(localStorage.getItem("unlocked_badges") || "[]");
      if (!unlockedBadges.includes(badgeId)) {
        unlockedBadges.push(badgeId);
        localStorage.setItem("unlocked_badges", JSON.stringify(unlockedBadges));
      }

      const today = new Date();
      const roundUnlockDateKey = `date_unlocked_${badgeId}_lvl_${currentRound}`;
      if (!localStorage.getItem(roundUnlockDateKey)) {
        localStorage.setItem(roundUnlockDateKey, `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`);
      }
    }
  }

  if (typeof checkAchievements === "function") {
    checkAchievements().catch(console.error);
  }

  loader.show("進入下一遍...");
  try {
    plan.currentRound = nextRound;
    plan.lastUpgradedRound = currentRound;
    plan.upgradePromptHandled = true;
    // 下一遍的排程從「現在點選確認」這一刻算起，不是讀完上一遍的隔天，
    // 也不是之後第一次打卡下一遍的日期。
    plan.currentRoundStartedAt = new Date().toISOString();

    rebuildPlanSchedule(plan);
    await persistPlanRoundState(plan);

    const firstNextRoundDay = plan.days.find(day => (day.chapters || []).some(chapter =>
      Number(chapter.round || 1) === nextRound
    ));
    if (firstNextRoundDay) state.selectedPlanDay = firstNextRoundDay.dayNum;
    db.invalidateMergedUsersCache();

    calculatePlanProgress();
    await renderPlanView();
    window.dispatchEvent(new CustomEvent("app:dataRefresh", { detail: { scope: "plan" } }));

    const modal = document.getElementById("congrats-modal");
    if (modal) modal.remove();
    showToast(`恭喜！您已成功進入第 ${nextRound} 遍，開始新的讀經旅程。`);
  } catch (err) {
    Object.assign(plan, previousPlanState);
    calculatePlanProgress();
    console.error("Failed to upgrade plan:", err);
    setPlanUpgradeOverlayBusy(false, upgradeAvailability.nextRoundLabel, "排程建立失敗，請稍後再試。");
    showToast("升級失敗，請稍後再試");
  } finally {
    planUpgradeInFlight = false;
    loader.hide();
  }
};

// ── 進入下一遍 ───────────────────────────────────────────────────
// 打卡不限順序（#363）：「最後一個閱讀日勾完」不等於「整遍讀完」。進入下一遍前確認
// 整遍讀完，沒讀完就列出還沒勾的章；平常在當天清單上方提示前面跳過的章。

function getCurrentRoundLastReadingDay(plan) {
  if (!plan || !Array.isArray(plan.days)) return null;
  const round = plan.currentRound || 1;
  for (let i = plan.days.length - 1; i >= 0; i--) {
    const day = plan.days[i];
    if ((day.chapters || []).some(ch => Number(ch.round || round) === round)) return day;
  }
  return null;
}

// 本遍還沒讀完 → 回傳提示文字（列出還沒勾的章）；讀完 → null。
function getRoundIncompleteMessage(plan) {
  if (!plan || !Array.isArray(plan.days)) return null;
  const checkState = getRoundCheckState(plan.days, plan.currentRound || 1);
  if (checkState.isComplete || !checkState.next) return null;
  const unread = getRoundUnreadChapters(checkState);
  const template = (window.APP_COPY && window.APP_COPY.plan && window.APP_COPY.plan.roundIncomplete)
    || "這一遍還有 {count} 章沒勾：{chapters}";
  return template.replace("{count}", unread.length).replace("{chapters}", formatChapterList(unread));
}

function findPlanDayNumForChapter(plan, chapter, round) {
  const day = (plan.days || []).find(item => (item.chapters || []).some(ch =>
    ch.book === chapter.book
    && Number(ch.chapter) === Number(chapter.chapter)
    && Number(ch.round || round) === round
  ));
  return day ? day.dayNum : null;
}

// 當天清單上方：「第 N 遍前面還有 X 章沒勾：…」，章名點了直接用計畫情境打開（讀到底就會記錄）。
// 只提示「排在最後勾的那一章之前」的缺口；照順序讀、只是還沒讀到的章不算。
function renderRoundGapNotice(plan, checkState) {
  const gaps = getRoundGapChapters(checkState);
  if (!plan || gaps.length === 0) return null;
  const round = checkState.round;
  const planCopy = (window.APP_COPY && window.APP_COPY.plan) || {};
  const notice = document.createElement("div");
  notice.className = "plan-round-gap-notice";
  notice.setAttribute("role", "status");
  const text = document.createElement("p");
  text.className = "plan-round-gap-notice__text";
  text.textContent = (planCopy.roundGapNotice || "第 {round} 遍前面還有 {count} 章沒勾：")
    .replace("{round}", round)
    .replace("{count}", gaps.length);
  notice.appendChild(text);
  const links = document.createElement("div");
  links.className = "plan-round-gap-notice__links";
  const shown = gaps.slice(0, 5);
  shown.forEach(chapter => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "plan-round-gap-notice__link";
    button.textContent = `${chapter.book} ${Number(chapter.chapter)}章`;
    button.addEventListener("click", () => {
      window.openPlanChapterInReader(chapter.book, Number(chapter.chapter), findPlanDayNumForChapter(plan, chapter, round), round);
    });
    links.appendChild(button);
  });
  if (gaps.length > shown.length) {
    const more = document.createElement("span");
    more.className = "plan-round-gap-notice__more";
    more.textContent = (planCopy.roundGapMore || "…等 {count} 章").replace("{count}", gaps.length);
    links.appendChild(more);
  }
  notice.appendChild(links);
  return notice;
}

// 常駐「進入下一遍」按鈕：停在「本遍最後一個閱讀日」、而且整遍每一章都勾完才出現（#374）。
// 不限順序後「最後一天勾完」不等於整遍讀完；還缺章時不顯示按鈕，缺哪幾章由清單上方的
// 「前面還有 X 章沒勾」提示告訴會友，不讓會友按了才被擋。
function renderRoundAdvanceButton(plan, selectedDay) {
  const container = document.getElementById("plan-tasks-list");
  if (!container) return;
  container.querySelector("#plan-round-advance-footer")?.remove();
  if (!plan || !selectedDay || !Array.isArray(plan.days)) return;

  const round = plan.currentRound || 1;
  const lastDay = getCurrentRoundLastReadingDay(plan);
  if (!lastDay || lastDay.dayNum !== selectedDay.dayNum) return;
  if (!getRoundCheckState(plan.days, round).isComplete) return;

  const expired = isPlanExpired(plan);
  const footer = document.createElement("div");
  footer.id = "plan-round-advance-footer";
  footer.className = "plan-round-advance-footer";
  footer.innerHTML = `
    <button id="btn-plan-round-advance" type="button" class="congrats-upgrade-btn">${expired ? "結算本遍" : "進入下一遍"}</button>
  `;
  container.appendChild(footer);

  footer.querySelector("#btn-plan-round-advance")?.addEventListener("click", () => {
    if (typeof calculatePlanProgress === "function") calculatePlanProgress();
    // 防呆：按鈕出現後資料又變了（多裝置、同步中）→ 仍擋下並列出缺的章。
    const incompleteMessage = getRoundIncompleteMessage(plan);
    if (incompleteMessage) {
      showToast(incompleteMessage);
      return;
    }
    if (expired) {
      showToast("本遍已全部讀完。計畫時間已過，無法再進入下一遍。");
      return;
    }
    window.triggerPlanUpgradeFlow();
  });
}

async function handleRoundCompletion(plan) {
  if (!plan) return;
  calculatePlanProgress();

  const currentRound = plan.currentRound || 1;
  const currentRoundTotal = plan.currentRoundTotalChapters || 0;
  const currentRoundCompleted = plan.completedChapters || 0;
  const isCurrentRoundCompleted = currentRoundTotal > 0 && currentRoundCompleted >= currentRoundTotal;

  if (!isCurrentRoundCompleted) return;

  // Prevent multiple triggers for the same round completion in the same session
  if (plan.lastPromptedRound === currentRound) return;
  plan.lastPromptedRound = currentRound;

  if (isPlanExpired(plan)) {
    showToast("恭喜完成此遍補讀打卡！由於計畫時間已過，無法再進行升級。");
    return;
  }

  // Show the congrats medal modal, do NOT auto upgrade
  showCongratsModal(plan, currentRound);
};




window.openPlanChapterInReader = function (bookName, chapter, dayNum, round = null) {
  if (typeof window.guardPlanEligibility === "function" && window.guardPlanEligibility()) return;
  if (state.activePlan && isPlanExpired(state.activePlan)) {
    showToast(getPlanEndedNotice(state.activePlan.endDate));
    return;
  }
  const book = BIBLE_BOOKS.find(b => b.name === bookName || b.eng === bookName);
  if (!book) {
    console.warn('找不到本地聖經卷名，無法進入閱讀：', bookName);
    return;
  }

  state.readerState.bookId = book.id;
  state.readerState.chapter = Number(chapter) || 1;
  state.readerState.fromPlan = true;
  state.readerState.returnTab = "plan-view";
  state.readerState.planDayNum = dayNum || null;
  state.readerState.planRound = round || (state.activePlan ? state.activePlan.currentRound || 1 : 1);
  state.readerState.planContextId = window.getActivePlanContextId?.(state.activePlan)
    || state.activePlan?.id
    || state.activePlan?.globalPlanId
    || state.activePlan?.presetKey
    || null;
  console.info("[AutoRead] Opened plan chapter in reader", {
    planContextId: state.readerState.planContextId, book: book.name, chapter: state.readerState.chapter, round: state.readerState.planRound
  });

  if (typeof saveReaderPreferences === 'function') {
    saveReaderPreferences();
  } else {
    localStorage.setItem("reader_state", JSON.stringify({
      bookId: state.readerState.bookId,
      chapter: state.readerState.chapter
    }));
  }

  appRouter.switchTab('reader-view', { fromPlan: true });
};

// Initialize state for inline reader
state.inlineReader = {
  active: false,
  dayNum: 0,
  chaptersList: [],
  currentIndex: 0,
  autoMarked: false,
  autoMarkInFlight: false
};

let inlineReaderBottomDwellController = null;
let inlineReaderEndObserver = null;
let inlineReaderEndVisible = false;
// 這一章的章末是否已到過（#349）：到底後直接按上一章／下一章也算讀完。
let inlineReaderReachedEndKey = "";

function getInlineReaderTaskDecision(task) {
  if (!task) return getAutoRecordDecision({ hasTask: false });
  return getAutoRecordDecision({
    hasTask: true,
    alreadyRead: isInlineReaderTaskRead(task),
    offline: Boolean(state.offlineMode),
    expired: isPlanExpired(task.plan),
    locked: isPlanProgressLocked(task.plan, { hidden: window.isPlanHidden?.(task.plan) }),
    isOldRound: task.round < Number(task.plan.currentRound || 1)
  });
}

function getCurrentInlineReaderTask() {
  const plan = state.activePlan;
  const reader = state.inlineReader;
  if (!plan || !reader?.active) return null;
  const chapter = reader.chaptersList[reader.currentIndex];
  if (!chapter) return null;
  const round = Number(chapter.round || plan.currentRound || 1);
  return { plan, chapter, round };
}

function getInlineReaderTargetKey() {
  const task = getCurrentInlineReaderTask();
  if (!task) return "";
  return [
    task.plan.id || task.plan.globalPlanId || task.plan.presetKey || "plan",
    state.inlineReader.dayNum,
    task.round,
    task.chapter.book,
    task.chapter.chapter
  ].join("|");
}

function isInlineReaderTaskRead(task) {
  if (!task) return false;
  return Boolean(task.chapter[`isReadR${task.round}`] || (task.round === 1 && task.chapter.isRead));
}

function findInlineReaderLog(task) {
  return (state.readingLogs || []).find(log =>
    String(log.book) === String(task.chapter.book) &&
    Number(log.chapter) === Number(task.chapter.chapter) &&
    Number(log.round || 1) === task.round &&
    (log.plan_id === task.plan.id || log.presetKey === task.plan.presetKey || log.preset_key === task.plan.presetKey)
  );
}

async function autoMarkInlineReaderTaskRead(expectedTargetKey) {
  const task = getCurrentInlineReaderTask();
  if (!task || getInlineReaderTargetKey() !== expectedTargetKey) return false;
  const decision = getInlineReaderTaskDecision(task);
  if (decision.reason === AUTO_RECORD_REASONS.ALREADY_READ) return true;
  if (state.inlineReader.autoMarked || state.inlineReader.autoMarkInFlight) return false;
  // 讀到底照常記錄（#349）：這裡刻意沒有「照順序打卡」（#331）的檢查，那條只留在手動勾選。
  // 離線／已結束／鎖住／舊遍數仍不寫入（決定於共用的 getAutoRecordDecision）。
  if (!decision.ok) return false;

  const readKey = `isReadR${task.round}`;
  const previousRoundRead = Boolean(task.chapter[readKey]);
  const previousRead = Boolean(task.chapter.isRead);
  const existingLog = findInlineReaderLog(task);
  state.inlineReader.autoMarked = true;
  state.inlineReader.autoMarkInFlight = true;
  task.chapter[readKey] = true;
  if (task.round === 1) task.chapter.isRead = true;

  try {
    calculatePlanProgress();
    await db.logChapterRead(task.chapter.book, task.chapter.chapter, true, task.round, task.plan);
    if (typeof db.saveLocalUserStats === "function") db.saveLocalUserStats();
    calculatePlanProgress();
    window.setDataVersion?.(previous => previous + 1);
    window.dispatchEvent(new CustomEvent("app:dataRefresh", { detail: { scope: "plan" } }));
    if (task.plan.progress >= 100) {
      await window.closePlanInlineReader();
      await handleRoundCompletion(task.plan);
    }
    console.info("[AutoRead] Inline reading log persisted", { targetKey: expectedTargetKey });
    return true;
  } catch (error) {
    console.error("Failed to auto-mark inline reader progress", error);
    task.chapter[readKey] = previousRoundRead;
    task.chapter.isRead = previousRead;
    if (!existingLog && Array.isArray(state.readingLogs)) {
      state.readingLogs = state.readingLogs.filter(log => !(
        String(log.book) === String(task.chapter.book) &&
        Number(log.chapter) === Number(task.chapter.chapter) &&
        Number(log.round || 1) === task.round &&
        (log.plan_id === task.plan.id || log.presetKey === task.plan.presetKey || log.preset_key === task.plan.presetKey)
      ));
    }
    state.inlineReader.autoMarked = false;
    calculatePlanProgress();
    showToast((window.APP_COPY && window.APP_COPY.plan.syncFail) || "閱讀進度同步失敗，請稍後再試");
    return false;
  } finally {
    state.inlineReader.autoMarkInFlight = false;
  }
}

function checkInlineReaderBottomDwell(surface = document.querySelector(".main-content"), isAtBottom = null) {
  const task = getCurrentInlineReaderTask();
  inlineReaderBottomDwellController?.check(surface, {
    eligible: Boolean(
      task &&
      getInlineReaderTaskDecision(task).ok &&
      !state.inlineReader.autoMarked &&
      !state.inlineReader.autoMarkInFlight
    ),
    targetKey: getInlineReaderTargetKey(),
    isAtBottom
  });
}

function handleInlineReaderScroll(event) {
  checkInlineReaderBottomDwell(event.currentTarget || event.target);
}

function bindInlineReaderEndObserver() {
  inlineReaderEndObserver?.disconnect();
  inlineReaderEndObserver = null;
  inlineReaderEndVisible = false;
  const root = document.querySelector(".main-content");
  const sentinel = document.getElementById("plan-inline-reader-end-sentinel");
  if (!root || !sentinel) return;
  inlineReaderEndObserver = observeReaderEndSentinel({
    root,
    sentinel,
    onChange: isVisible => {
      inlineReaderEndVisible = isVisible;
      if (isVisible) {
        inlineReaderReachedEndKey = getInlineReaderTargetKey() || inlineReaderReachedEndKey;
        console.info("[AutoRead] Inline reader bottom detected", { targetKey: getInlineReaderTargetKey() || null });
        checkInlineReaderBottomDwell(root, () => inlineReaderEndVisible);
      } else inlineReaderBottomDwellController?.cancel();
    }
  });
}
function scheduleInlineReaderBottomDwellCheck() {
  requestAnimationFrame(() => requestAnimationFrame(() => checkInlineReaderBottomDwell()));
}

function initInlineReaderBottomDwell() {
  const scrollSurface = document.querySelector(".main-content");
  if (!scrollSurface) return;
  if (!inlineReaderBottomDwellController) {
    inlineReaderBottomDwellController = createReaderBottomDwellController({
      dwellMs: 1000,
      bottomThreshold: 96,
      onComplete: autoMarkInlineReaderTaskRead
    });
  }
  if (scrollSurface.dataset.inlineReaderBottomDwellBound !== "true") {
    scrollSurface.dataset.inlineReaderBottomDwellBound = "true";
    scrollSurface.addEventListener("scroll", handleInlineReaderScroll, { passive: true });
    scrollSurface.addEventListener("scrollend", handleInlineReaderScroll, { passive: true });
  }
}

window.openPlanInlineReader = async function (bookName, chapter, dayNum, round = null) {
  if (typeof window.guardPlanEligibility === "function" && window.guardPlanEligibility()) return;
  if (state.activePlan && isPlanExpired(state.activePlan)) {
    showToast(getPlanEndedNotice(state.activePlan.endDate));
    return;
  }
  if (!state.activePlan) return;

  state.selectedPlanDay = dayNum;

  const day = (state.activePlan.days || []).find(d => d.dayNum === dayNum);
  const targetRound = Number(round || state.activePlan.currentRound || 1);
  const chaptersForRound = (day && day.chapters || []).filter(ch =>
    Number(ch.round || targetRound) === targetRound
  );
  if (chaptersForRound.length === 0) return;

  // Set state before switchTab so renderPlanScheduleTracker sees inlineReader.active = true
  state.inlineReader.active = true;
  state.inlineReader.dayNum = dayNum;
  state.inlineReader.chaptersList = chaptersForRound;
  state.inlineReader.currentIndex = chaptersForRound.findIndex(ch =>
    ch.book === bookName &&
    Number(ch.chapter) === Number(chapter) &&
    (round == null || Number(ch.round || 1) === Number(round))
  );
  if (state.inlineReader.currentIndex === -1) state.inlineReader.currentIndex = 0;

  // Switch to plan-view and AWAIT renderPlanView() to finish before touching DOM
  if (typeof appRouter !== 'undefined' && typeof appRouter.switchTab === 'function') {
    await appRouter.switchTab('plan-view', { keepPlanDetail: true });
  }

  // Now that renderPlanView() is fully settled, apply inline reader DOM state
  document.body.classList.add("plan-inline-reader-open");
  console.info("[AutoRead] Opened inline plan reader", {
    planId: state.activePlan?.id || null, book: bookName, chapter: Number(chapter), round: targetRound
  });

  // Hide checklist interface elements
  const carousel = document.getElementById("plan-date-carousel");
  const planDayHeader = document.getElementById("plan-day-subtitle") ? document.getElementById("plan-day-subtitle").parentElement : null;
  const taskList = document.getElementById("plan-tasks-list");
  const readBtn = document.getElementById("plan-start-reading-container");

  if (carousel) carousel.classList.add("hidden");
  if (planDayHeader) planDayHeader.classList.add("hidden");
  if (taskList) taskList.classList.add("hidden");
  if (readBtn) readBtn.classList.add("hidden");

  // Show inline reader container
  const inlineReader = document.getElementById("plan-inline-reader");
  if (inlineReader) inlineReader.classList.remove("hidden");

  initInlineReaderBottomDwell();
  renderInlineScriptureText();
};

window.closePlanInlineReader = async function () {
  state.inlineReader.active = false;
  document.body.classList.remove("plan-inline-reader-open");
  inlineReaderBottomDwellController?.cancel();
  inlineReaderEndObserver?.disconnect();
  inlineReaderEndObserver = null;
  inlineReaderEndVisible = false;

  // Show checklist interface elements
  const carousel = document.getElementById("plan-date-carousel");
  const planDayHeader = document.getElementById("plan-day-subtitle") ? document.getElementById("plan-day-subtitle").parentElement : null;
  const taskList = document.getElementById("plan-tasks-list");
  const readBtn = document.getElementById("plan-start-reading-container");

  if (carousel) carousel.classList.remove("hidden");
  if (planDayHeader) planDayHeader.classList.remove("hidden");
  if (taskList) taskList.classList.remove("hidden");
  if (readBtn) readBtn.classList.remove("hidden");

  // Hide inline reader container
  const inlineReader = document.getElementById("plan-inline-reader");
  if (inlineReader) inlineReader.classList.add("hidden");

  // Re-render checklist and date carousel to show checked updates immediately
  calculatePlanProgress();
  if (typeof renderHorizontalDateStrip === "function") renderHorizontalDateStrip();
  await renderPlanScheduleTracker(true);
};

async function renderInlineScriptureText() {
  const currentCh = state.inlineReader.chaptersList[state.inlineReader.currentIndex];
  if (!currentCh) return;

  state.inlineReader.autoMarked = false;
  state.inlineReader.autoMarkInFlight = false;
  inlineReaderReachedEndKey = "";
  inlineReaderBottomDwellController?.reset();
  inlineReaderEndObserver?.disconnect();
  inlineReaderEndObserver = null;
  inlineReaderEndVisible = false;

  // Set Title
  const titleEl = document.getElementById("plan-inline-reader-title");
  if (titleEl) titleEl.textContent = `${currentCh.book} ${currentCh.chapter}章`;

  // Set Footer text
  const footerPlanName = document.getElementById("plan-inline-footer-plan-name");
  const footerProgress = document.getElementById("plan-inline-footer-progress");

  if (footerPlanName) footerPlanName.textContent = state.activePlan.name;
  if (footerProgress) footerProgress.textContent = `第 ${state.inlineReader.dayNum} 天 • ${state.inlineReader.chaptersList.length} 之 ${state.inlineReader.currentIndex + 1}`;

  // Load verses
  const container = document.getElementById("plan-inline-bible-content");
  if (container) {
    container.innerHTML = typeof ComponentSkeletonLoader !== "undefined"
      ? ComponentSkeletonLoader.getHtml("reader")
      : "";

    const book = BIBLE_BOOKS.find(b => b.name === currentCh.book);
    if (book) {
      try {
        const data = await fetchBibleChapter(book.eng, currentCh.chapter);
        container.innerHTML = "";
        data.verses.forEach(v => {
          const verseDiv = document.createElement("div");
          verseDiv.className = "bible-verse";
          verseDiv.style.marginBottom = "0.8rem";
          verseDiv.innerHTML = `<span class="verse-num" style="font-weight: 500; color: var(--primary-color); margin-right: 0.5rem; font-size: 0.875rem;">${v.verse}</span><span class="verse-text" style="font-size: 1.05rem; line-height: 1.8;">${v.text}</span>`;
          container.appendChild(verseDiv);
        });
        const sentinel = document.createElement("div");
        sentinel.id = "plan-inline-reader-end-sentinel";
        sentinel.setAttribute("aria-hidden", "true");
        sentinel.style.cssText = "height:1px;width:100%;pointer-events:none;";
        container.appendChild(sentinel);
      } catch (err) {
        container.innerHTML = `<div class="text-danger" style="text-align: center; padding: 2rem;">載入經文失敗: ${err.message || err}</div>`;
      }
    }
  }

  bindInlineReaderEndObserver();

  // Prev / Next button states
  const prevBtn = document.getElementById("plan-inline-prev-btn");
  const nextBtn = document.getElementById("plan-inline-next-btn");

  if (prevBtn) {
    if (state.inlineReader.currentIndex === 0) {
      prevBtn.setAttribute("disabled", "true");
      prevBtn.style.opacity = "0.3";
      prevBtn.style.pointerEvents = "none";
    } else {
      prevBtn.removeAttribute("disabled");
      prevBtn.style.opacity = "1";
      prevBtn.style.pointerEvents = "auto";
    }
  }

  if (nextBtn) {
    if (state.inlineReader.currentIndex === state.inlineReader.chaptersList.length - 1) {
      nextBtn.setAttribute("disabled", "true");
      nextBtn.style.opacity = "0.3";
      nextBtn.style.pointerEvents = "none";
    } else {
      nextBtn.removeAttribute("disabled");
      nextBtn.style.opacity = "1";
      nextBtn.style.pointerEvents = "auto";
    }
  }

  // The plan detail page scrolls inside .main-content, not the browser window.
  const scrollSurface = document.querySelector(".main-content" );
  if (scrollSurface) scrollSurface.scrollTop = 0;
  scheduleInlineReaderBottomDwellCheck();
}

window.navigateInlineChapter = function (direction) {
  const newIndex = state.inlineReader.currentIndex + direction;
  if (newIndex >= 0 && newIndex < state.inlineReader.chaptersList.length) {
    // 章末到過之後換章也算讀完（#349）。autoMarkInlineReaderTaskRead 在第一個 await 之前就
    // 已抓好「離開的這一章」的 task，之後才改 currentIndex，所以記的是舊的一章。
    const leavingKey = getInlineReaderTargetKey();
    if (leavingKey && inlineReaderReachedEndKey === leavingKey) void autoMarkInlineReaderTaskRead(leavingKey);
    state.inlineReader.currentIndex = newIndex;
    renderInlineScriptureText();
  }
};

// Window scroll listener for inline reader automatic check-in has been removed to prevent screen jumping and layout shift.


// ==================== PERSONAL STATS & HEATMAP & ACHIEVEMENTS ====================
// ==================== PERSONAL STATS & HEATMAP & ACHIEVEMENTS ====================
// ==================== CASCADING SELECTORS HELPER ====================
// A user's org placement (great_region/pastoral_zone/small_group, and the
// managed_* delegation columns derived from it) is synced from a DIFFERENT
// Member Hub field than their leadership role. A leadership *assignment*
// ("this person leads 大安小組") can exist even when their own personal
// placement is blank/unset — so before concluding a leader has no org data
// at all, also check member_context_leadership_assignments, which records
// exactly which unit(s) each of their leadership roles applies to.
export function getLeadershipAssignmentNodeNames(user, levelName) {
  const assignments = Array.isArray(user && user.member_context_leadership_assignments)
    ? user.member_context_leadership_assignments
    : [];
  const matches = assignments.filter(a => a && a.levelName === levelName && a.nodeName);
  if (matches.length === 0) return "";
  const primary = matches.find(a => a.isPrimary);
  return String((primary || matches[0]).nodeName || "").trim();
}

export function setupCascadingSelectors(regionId, zoneId, groupId, masterId) {
  const regionSelect = document.getElementById(regionId);
  const zoneSelect = document.getElementById(zoneId);
  const groupSelect = document.getElementById(groupId);
  const masterSelect = document.getElementById(masterId);

  if (!regionSelect || !zoneSelect || !groupSelect || !masterSelect) return;

  if (regionSelect.dataset.orgStructureRefreshBound !== "true") {
    regionSelect.dataset.orgStructureRefreshBound = "true";
    window.addEventListener("org-structure-updated", () => {
      if (!regionSelect.isConnected) return;
      delete regionSelect.dataset.populatedFor;
      setupCascadingSelectors(regionId, zoneId, groupId, masterId);
    });
  }

  const previousSelection = {
    region: regionSelect.value,
    zone: zoneSelect.value,
    group: groupSelect.value
  };
  const preservePreviousSelection = Boolean(regionSelect.dataset.populatedFor);

  const userKey = state.currentUser ? [
    state.currentUser.id || state.currentUser.name,
    getUserRoleCode(state.currentUser),
    state.currentUser.managed_regions || state.currentUser.great_region || "",
    state.currentUser.managed_zones || state.currentUser.pastoral_zone || "",
    state.currentUser.managed_groups || state.currentUser.small_group || "",
    Number(state.orgStructure?.revision || 0)
  ].join("|") : "anonymous";
  // Skip rebuilding once already populated for this exact user/role. The
  // check used to also require regionSelect.options.length > 1, but
  // zone_leader/group_leader roles always render exactly one disabled
  // region option by design (js/modules/plan.js populateGroups/populateZones
  // "else" branches), so that length check never became true for them.
  // Every subsequent re-render (e.g. after the group/zone/region "change"
  // handler calls renderPlanMembersView -> populateMembersSelector) then
  // wiped and rebuilt the selects from scratch, snapping the value back to
  // the default and making the filter look unresponsive.
  if (regionSelect.dataset.populatedFor === userKey) return;

  regionSelect.dataset.populated = "true";
  regionSelect.dataset.populatedFor = userKey;

  // Reset disabled states for fresh population
  regionSelect.disabled = false;
  zoneSelect.disabled = false;
  groupSelect.disabled = false;

  const userRole = (state.currentUser && getUserRoleCode(state.currentUser)) || "member";
  const isAdmin = hasWholeChurchPlanScope(userRole);
  const isGreatZoneLeader = userRole === "great_zone_leader";
  const isZoneLeader = userRole === "zone_leader";
  const isGroupLeader = userRole === "group_leader";

  let isInitializing = true;

  // Hide selectors that exceed user's permission level
  if (isAdmin || isGreatZoneLeader) {
    regionSelect.style.display = "";
    zoneSelect.style.display = "";
    groupSelect.style.display = "";
  } else if (isZoneLeader) {
    regionSelect.style.display = "none";
    zoneSelect.style.display = "";
    groupSelect.style.display = "";
  } else if (isGroupLeader) {
    regionSelect.style.display = "none";
    zoneSelect.style.display = "none";
    groupSelect.style.display = "";
  } else {
    regionSelect.style.display = "none";
    zoneSelect.style.display = "none";
    groupSelect.style.display = "none";
  }

  // Get regions list
  let regions = state.orgStructure.regions || [];
  let myRegions = [];
  if (isGreatZoneLeader) {
    const userGreatRegion = (state.currentUser.managed_regions || state.currentUser.great_region
      || getLeadershipAssignmentNodeNames(state.currentUser, "大區") || "");
    myRegions = userGreatRegion.split(",").map(s => s.trim()).filter(Boolean);
    regions = regions.filter(r => myRegions.includes(r));
  }

  // Helper to get zones for a region
  function getZonesForRegion(rName) {
    if (!rName) return [];
    if (state.isSupabaseMode && state.orgStructure.rawZones && state.orgStructure.rawRegions) {
      const regionObj = state.orgStructure.rawRegions.find(r => r.name === rName);
      if (!regionObj) return [];
      return state.orgStructure.rawZones.filter(z => z.great_region_id === regionObj.id).map(z => z.name);
    }
    return state.orgStructure.zones[rName] || [];
  }

  // Helper to get groups for a zone
  function getGroupsForZone(zName) {
    if (!zName) return [];
    if (state.isSupabaseMode && state.orgStructure.rawGroups && state.orgStructure.rawZones) {
      const zoneObj = state.orgStructure.rawZones.find(z => z.name === zName);
      if (!zoneObj) return [];
      return state.orgStructure.rawGroups.filter(g => g.pastoral_zone_id === zoneObj.id).map(g => g.name);
    }
    return state.orgStructure.groups[zName] || [];
  }

  // Populate Regions
  regionSelect.innerHTML = "";
  if (isAdmin) {
    regionSelect.options.add(new Option("-- 請選擇大區 --", ""));
    regions.forEach(r => regionSelect.options.add(new Option(`大區：${r}`, `region:${r}`)));
    if (isInitializing) {
      const userGreatRegion = state.currentUser ? (state.currentUser.managed_regions || state.currentUser.great_region || "") : "";
      if (userGreatRegion) {
        regionSelect.value = "region:" + userGreatRegion;
      }
    }
  } else if (isGreatZoneLeader) {
    if (myRegions.length === 0) {
      // managed_regions and great_region are both blank — this leader has no
      // org placement to scope by. Say so explicitly instead of silently
      // showing an unlabeled "全部大區 ()" option that resolves to "show
      // everything", which just looks like broken/missing data on screen.
      regionSelect.options.add(new Option("⚠️ 尚未設定大區歸屬，請聯絡系統管理員", "unassigned"));
      regionSelect.disabled = true;
    } else {
      regionSelect.options.add(new Option(`全部大區 (${myRegions.join(",")})`, ""));
      myRegions.forEach(r => regionSelect.options.add(new Option(`大區：${r}`, `region:${r}`)));
      if (isInitializing && myRegions.length === 1) {
        regionSelect.value = "region:" + myRegions[0];
      }
    }
  } else {
    const userReg = (state.currentUser.managed_regions || state.currentUser.great_region || "");
    regionSelect.options.add(new Option(userReg ? `大區：${userReg}` : "大區", ""));
    regionSelect.disabled = true;
  }
  if (preservePreviousSelection
    && Array.from(regionSelect.options).some(option => option.value === previousSelection.region)) {
    regionSelect.value = previousSelection.region;
  }

  // Update Master Select Value
  // "unassigned" is a sentinel option shown when a leader has no org
  // placement set at all — treat it the same as no selection rather than
  // building a nonsense "group:unassigned" filter value.
  function updateMasterValue(isInitialCall = false) {
    let finalVal = "all";
    const selectedGroup = groupSelect.value === "unassigned" ? "" : groupSelect.value;
    const selectedZone = zoneSelect.value === "unassigned" ? "" : zoneSelect.value;
    const selectedRegion = regionSelect.value === "unassigned" ? "" : regionSelect.value;

    if (isGroupLeader) {
      finalVal = selectedGroup ? `group:${selectedGroup}` : "all_groups";
    } else if (isZoneLeader) {
      if (selectedGroup) finalVal = `group:${selectedGroup}`;
      else if (selectedZone) finalVal = `zone:${selectedZone}`;
      else finalVal = "all_zones";
    } else if (isGreatZoneLeader) {
      if (selectedGroup) finalVal = `group:${selectedGroup}`;
      else if (selectedZone) finalVal = `zone:${selectedZone}`;
      else if (selectedRegion) finalVal = selectedRegion;
      else finalVal = "all_great_region";
    } else if (isAdmin) {
      if (selectedGroup) finalVal = `group:${selectedGroup}`;
      else if (selectedZone) finalVal = `zone:${selectedZone}`;
      else if (selectedRegion) finalVal = selectedRegion;
      else finalVal = "all";
    }

    masterSelect.innerHTML = "";
    masterSelect.options.add(new Option(finalVal, finalVal));
    masterSelect.value = finalVal;
    if (!isInitialCall) masterSelect.dispatchEvent(new Event("change"));
  }

  // Handle Region Change
  regionSelect.onchange = () => {
    populateZones();
    populateGroups();
    updateMasterValue();
  };

  // Populate Zones
  function populateZones() {
    zoneSelect.innerHTML = "";
    zoneSelect.disabled = false;

    if (isAdmin) {
      const regVal = regionSelect.value;
      if (!regVal || regVal === "all") {
        zoneSelect.options.add(new Option("-- 請先選擇大區 --", ""));
        zoneSelect.disabled = true;
      } else {
        const rName = regVal.replace("region:", "");
        zoneSelect.options.add(new Option("全部牧區", ""));
        const zones = getZonesForRegion(rName);
        zones.sort().forEach(z => zoneSelect.options.add(new Option(`牧區：${z}`, z)));
        if (isInitializing) {
          const userZone = state.currentUser ? (state.currentUser.managed_zones || state.currentUser.pastoral_zone || "") : "";
          if (userZone && zones.includes(userZone)) {
            zoneSelect.value = userZone;
          }
        }
      }
    } else if (isGreatZoneLeader) {
      const regVal = regionSelect.value;
      if (!regVal || regVal === "all_great_region") {
        zoneSelect.options.add(new Option("-- 請選擇特定大區 --", ""));
        zoneSelect.disabled = true;
      } else {
        const rName = regVal.replace("region:", "");
        zoneSelect.options.add(new Option("全部牧區", ""));
        const zones = getZonesForRegion(rName);
        zones.sort().forEach(z => zoneSelect.options.add(new Option(`牧區：${z}`, z)));
        if (isInitializing) {
          const userZone = state.currentUser ? (state.currentUser.managed_zones || state.currentUser.pastoral_zone || "") : "";
          if (userZone && zones.includes(userZone)) {
            zoneSelect.value = userZone;
          }
        }
      }
    } else if (isZoneLeader) {
      const userZone = (state.currentUser.managed_zones || state.currentUser.pastoral_zone
        || getLeadershipAssignmentNodeNames(state.currentUser, "牧區") || "");
      const myZones = userZone.split(",").map(s => s.trim()).filter(Boolean);
      if (myZones.length > 1) {
        zoneSelect.options.add(new Option(`全部牧區 (${myZones.join(",")})`, ""));
        myZones.forEach(z => zoneSelect.options.add(new Option(`牧區：${z}`, z)));
      } else if (myZones.length === 1) {
        zoneSelect.options.add(new Option(`牧區：${myZones[0]}`, myZones[0]));
        zoneSelect.disabled = true;
      } else {
        // managed_zones and pastoral_zone are both blank — same "no org
        // placement" gap as the great_zone_leader case above.
        zoneSelect.options.add(new Option("⚠️ 尚未設定牧區歸屬，請聯絡系統管理員", "unassigned"));
        zoneSelect.disabled = true;
      }
    } else {
      const userZone = (state.currentUser.managed_zones || state.currentUser.pastoral_zone || "");
      zoneSelect.options.add(new Option(userZone ? `牧區：${userZone}` : "牧區", ""));
      zoneSelect.disabled = true;
    }
  }

  // Handle Zone Change
  zoneSelect.onchange = () => {
    populateGroups();
    updateMasterValue();
  };

  // Populate Groups
  function populateGroups() {
    groupSelect.innerHTML = "";
    groupSelect.disabled = false;

    const zoneVal = zoneSelect.value;
    if (isAdmin || isGreatZoneLeader) {
      if (!zoneVal) {
        groupSelect.options.add(new Option("-- 請先選擇牧區 --", ""));
        groupSelect.disabled = true;
      } else {
        groupSelect.options.add(new Option("全部小組", ""));
        const groups = getGroupsForZone(zoneVal);
        groups.sort().forEach(g => groupSelect.options.add(new Option(`小組：${g}`, g)));
        if (isInitializing) {
          const userGroup = state.currentUser ? (state.currentUser.managed_groups || state.currentUser.small_group || "") : "";
          if (userGroup && groups.includes(userGroup)) {
            groupSelect.value = userGroup;
          }
        }
      }
    } else if (isZoneLeader) {
      const userZone = (state.currentUser.managed_zones || state.currentUser.pastoral_zone || "");
      const myZones = userZone.split(",").map(s => s.trim()).filter(Boolean);
      const activeZone = zoneVal || (myZones.length === 1 ? myZones[0] : "");
      if (!activeZone) {
        groupSelect.options.add(new Option("-- 請先選擇牧區 --", ""));
        groupSelect.disabled = true;
      } else {
        groupSelect.options.add(new Option("全部小組", ""));
        const groups = getGroupsForZone(activeZone);
        groups.sort().forEach(g => groupSelect.options.add(new Option(`小組：${g}`, g)));
        if (isInitializing) {
          const userGroup = state.currentUser ? (state.currentUser.managed_groups || state.currentUser.small_group || "") : "";
          if (userGroup && groups.includes(userGroup)) {
            groupSelect.value = userGroup;
          }
        }
      }
    } else if (isGroupLeader) {
      const userGroup = (state.currentUser.managed_groups || state.currentUser.small_group
        || getLeadershipAssignmentNodeNames(state.currentUser, "小組") || "");
      const myGroups = userGroup.split(",").map(s => s.trim()).filter(Boolean);
      if (myGroups.length > 1) {
        groupSelect.options.add(new Option(`全部小組 (${myGroups.join(",")})`, ""));
        myGroups.forEach(g => groupSelect.options.add(new Option(`小組：${g}`, g)));
      } else if (myGroups.length === 1) {
        groupSelect.options.add(new Option(`小組：${myGroups[0]}`, myGroups[0]));
        groupSelect.disabled = true;
      } else {
        // managed_groups and small_group are both blank — this is the
        // scenario reported as "篩選器沒得選的小組長無法更新資料": the
        // dropdown used to silently show a blank "小組：" label with an
        // empty value, so the leader had nothing they could click and no
        // indication of why. Now it says plainly what's missing.
        groupSelect.options.add(new Option("⚠️ 尚未設定小組歸屬，請聯絡系統管理員", "unassigned"));
        groupSelect.disabled = true;
      }
    } else {
      groupSelect.options.add(new Option("小組", ""));
      groupSelect.disabled = true;
    }
  }

  groupSelect.onchange = () => {
    updateMasterValue();
  };

  // Initialize
  populateZones();
  if (preservePreviousSelection
    && Array.from(zoneSelect.options).some(option => option.value === previousSelection.zone)) {
    zoneSelect.value = previousSelection.zone;
  }
  populateGroups();
  if (preservePreviousSelection
    && Array.from(groupSelect.options).some(option => option.value === previousSelection.group)) {
    groupSelect.value = previousSelection.group;
  }

  // Set initial master select value mapping without triggering render loop
  updateMasterValue(true);

  isInitializing = false;
}

// ==================== STATS SELECTOR POPULATOR ====================
export function populateStatsSelector() {
  const basicSelect = document.getElementById("stats-basic-scope-select");
  const regionSelect = document.getElementById("stats-admin-region-select");
  const zoneSelect = document.getElementById("stats-admin-zone-select");
  const groupSelect = document.getElementById("stats-admin-group-select");
  const rankingZoneSelector = document.getElementById("ranking-zone-selector");
  const canAdvanced = canUseAdvancedGroupStats();
  const myZone = (state.currentUser && state.currentUser.pastoral_zone || "").split(",")[0].trim();
  const zoneScope = myZone ? `zone:${myZone}` : "all";

  if (basicSelect && !basicSelect.dataset.initialized) {
    basicSelect.dataset.initialized = "true";
    basicSelect.addEventListener("change", async () => {
      const useAdvanced = basicSelect.value === "advanced";
      [regionSelect, zoneSelect, groupSelect].forEach(el => {
        if (el) el.style.display = canAdvanced && useAdvanced ? "" : "none";
      });
      window._statsTabScope = applyBasicStatsScope();
      if (rankingZoneSelector && window._statsTabScope) rankingZoneSelector.value = window._statsTabScope;
      await renderPlanStatsView();
    });
  }

  if (basicSelect) {
    const previous = basicSelect.value || zoneScope;
    basicSelect.innerHTML = "";
    basicSelect.options.add(new Option(myZone ? `\u6211\u7684\u7267\u5340\uFF1A${myZone}` : "\u6211\u7684\u7267\u5340", zoneScope));
    basicSelect.options.add(new Option("\u5168\u6559\u6703", "all"));
    if (canAdvanced) basicSelect.options.add(new Option("\u9032\u968E\u7BC4\u570D", "advanced"));
    basicSelect.value = [...basicSelect.options].some(o => o.value === previous) ? previous : zoneScope;
  }

  setupCascadingSelectors("stats-admin-region-select", "stats-admin-zone-select", "stats-admin-group-select", "ranking-zone-selector");

  const useAdvanced = canAdvanced && basicSelect && basicSelect.value === "advanced";
  [regionSelect, zoneSelect, groupSelect].forEach(el => {
    if (el) el.style.display = useAdvanced ? "" : "none";
  });
  window._statsTabScope = useAdvanced ? null : (basicSelect ? basicSelect.value : getDefaultGroupStatsScope());

  if (rankingZoneSelector && !rankingZoneSelector.dataset.listenerInitialized) {
    rankingZoneSelector.dataset.listenerInitialized = "true";
    rankingZoneSelector.addEventListener("change", async () => {
      if (basicSelect && basicSelect.value !== "advanced") return;
      window._statsTabScope = null;
      const tabStats = document.getElementById("tab-plan-stats");
      const tabRanking = document.getElementById("tab-plan-ranking");
      const tabMembers = document.getElementById("tab-plan-members");

      if (tabStats && tabStats.classList.contains("active")) {
        await renderPlanStatsView();
      } else if (tabRanking && tabRanking.classList.contains("active")) {
        await renderPlanRankingView();
      } else if (tabMembers && tabMembers.classList.contains("active")) {
        await renderPlanMembersView();
      }
    });
  }
}
export function logMatchesPlan(log, currentPlanId, currentPresetKey) {
  return logMatchesPlanScope(log, currentPlanId, currentPresetKey, state.activePlan);
}





window.showPlanStatsModal = function () {
  if (!state.activePlan) {
    showToast((window.APP_COPY && window.APP_COPY.plan.noPlanJoined) || "還沒加入任何計畫");
    return;
  }

  const plan = state.activePlan;
  const streakDays = computePlanScopedStreak(state.readingLogs || [], {
    planId: plan.id,
    presetKey: plan.presetKey
  });

  // 1. Calculate today's chapters progress
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();
  const todayDayObj = plan.days.find(d => {
    if (Number(d.year) !== todayYear || Number(d.month) !== todayMonth) return false;
    const parts = d.date.split('/');
    return parts.length === 2 && Number(parts[1]) === todayDay;
  });

  let todayTotalCount = 0;
  let todayReadCount = 0;
  if (todayDayObj && todayDayObj.chapters) {
    todayTotalCount = todayDayObj.chapters.length;
    todayDayObj.chapters.forEach(ch => {
      const currentRound = plan.currentRound || 1;
      const taskRound = ch.round || currentRound;
      if (Boolean(ch["isReadR" + taskRound] || (taskRound === 1 && ch.isRead))) todayReadCount++;
    });
  }

  // 2. Calculate overall plan progress
  const totalCompletionRate = plan.progress || 0;

  // 3. Calculate catch-up days (進度救援)
  const start = new Date(plan.startDate + "T00:00:00");
  start.setHours(0, 0, 0, 0);
  const end = new Date(plan.endDate + "T00:00:00");
  end.setHours(0, 0, 0, 0);
  const totalDays = plan.totalDays || (Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
  const todayZero = new Date();
  todayZero.setHours(0, 0, 0, 0);
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.round((todayZero - start) / (1000 * 60 * 60 * 24)) + 1));

  // 補讀：一律對「教會原始日程」算，只看第一遍的 log（第一遍後 log 不變 → 數值凍結）。
  const round1DateByChapter = buildRound1ReadDateMap(state.readingLogs, l =>
    l.plan_id === plan.id || l.presetKey === plan.presetKey
  );
  const canonicalDays = typeof window.getCanonicalStageScheduleDays === "function"
    ? window.getCanonicalStageScheduleDays(plan)
    : (plan.days || []);
  const catchUpDays = countLateCompletedDays(canonicalDays, plan.startDate, round1DateByChapter);

  // 4. Calculate cumulative chapters read (累計閱讀) — 嚴格以本計畫為範圍：
  // plan_id / global_plan_id / presetKey / preset_key 任一對得上；四個都沒有才當
  // 無歸屬退路。別再用「沒有 plan_id 就算這個計畫」的寬鬆退路。
  const planIds = [plan.id, plan.globalPlanId, plan.global_plan_id].filter(Boolean).map(String);
  const planKeys = [plan.presetKey, plan.preset_key].filter(Boolean).map(String);
  const uniqueKeys = new Set();
  const planChapters = new Set();
  if (plan && plan.days) {
    plan.days.forEach(d => {
      if (d.chapters) {
        d.chapters.forEach(ch => {
          planChapters.add(`${ch.book}_${ch.chapter}`);
        });
      }
    });
  }
  if (state.readingLogs) {
    state.readingLogs.forEach(l => {
      const logPlanId = l.plan_id || l.global_plan_id;
      const logKey = l.presetKey || l.preset_key;
      const logMatchesPlan =
        (logPlanId && planIds.includes(String(logPlanId))) ||
        (logKey && planKeys.includes(String(logKey))) ||
        (!l.plan_id && !l.global_plan_id && !l.presetKey && !l.preset_key);
      if (logMatchesPlan && planChapters.has(`${l.book}_${l.chapter}`)) {
        const r = l.round || 1;
        uniqueKeys.add(`${l.book}_${l.chapter}_${r}`);
      }
    });
  }
  const totalReadChapters = uniqueKeys.size;

  // 5. Calculate completed days (達標天數)
  const totalCompletedDays = plan.days.filter(day => {
    if (!day.chapters || day.chapters.length === 0) return false;
    return day.chapters.every(ch => {
      const currentRound = plan.currentRound || 1;
      const taskRound = ch.round || currentRound;
      return Boolean(ch["isReadR" + taskRound] || (taskRound === 1 && ch.isRead));
    });
  }).length;

  // 6. Progress status（落後/超前只在第一遍；之後只顯示輪次進度 —— 見 getPlanProgressStatus）
  const progressStatus = getPlanProgressStatus(plan);
  const statusLabel = progressStatus.label;
  const statusBadgeClass = progressStatus.badgeClass || "stat-badge--brand";

  // 7. Create Stats Modal Elements
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "modal-overlay";
  modalOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 1.2rem;
    opacity: 0;
    transition: opacity 0.25s ease;
  `;

  const modalContainer = document.createElement("div");
  modalContainer.className = "modal-container";
  modalContainer.style.cssText = `
    background: var(--bg-card);
    border: 1px solid var(--border-card);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-card);
    width: 100%;
    max-width: 420px;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    transform: scale(0.92);
    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  `;

  // Prevent background clicks closing modal unless clicked outside
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      closeStatsModal();
    }
  });

  const closeStatsModal = () => {
    modalOverlay.style.opacity = "0";
    modalContainer.style.transform = "scale(0.92)";
    setTimeout(() => {
      modalOverlay.remove();
    }, 250);
  };

  // Header content
  const headerDiv = document.createElement("div");
  headerDiv.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border-card);
    padding-bottom: 0.8rem;
  `;
  headerDiv.innerHTML = `
    <h3 style="font-size: 1.15rem; font-weight: 500; color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
      <span class="nlc-icon" data-icon="barChart" aria-hidden="true"></span> 詳細數據統計
    </h3>
    <button aria-label="關閉" class="dialog-close-button icon-button icon-button--subtle" onclick="this.closest('.modal-overlay').remove()"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button>
  `;

  headerDiv.querySelector("button").onclick = (e) => {
    e.stopPropagation();
    closeStatsModal();
  };

  // 2x2 Grid Layout Content
  const gridDiv = document.createElement("div");
  gridDiv.style.cssText = `
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem;
  `;

  // Helper to generate a styled card
  const makeCardHtml = (title, dataText, desc, iconColor, bgGlow = '') => {
    return `
      <div class="stat-grid-card" style="background: var(--bg-card); border: 1px solid var(--border-card); border-radius: var(--radius-sm); padding: 0.9rem; display: flex; flex-direction: column; justify-content: space-between; height: 120px; box-shadow: var(--shadow-sm); transition: all 0.2s; ${bgGlow}">
        <div style="font-size: 0.875rem; font-weight: 500; color: var(--text-secondary); display: flex; align-items: center; gap: 0.3rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">
          ${title}
        </div>
        <div style="font-size: 1.45rem; font-weight: 500; color: ${iconColor}; margin: 0.3rem 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">
          ${dataText}
        </div>
        <div style="font-size: 0.875rem; color: var(--text-muted); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; font-weight: 500;">
          ${desc}
        </div>
      </div>
    `;
  };

  // Card A: 進度救援
  const cardA = makeCardHtml(
    iconLabel("shieldCheck", "進度救援"),
    `${catchUpDays} 天`,
    `過去落後但已成功補讀完畢的天數。`,
    `var(--color-warning-text, rgb(217,119,6))`,
    `background: var(--color-warning-muted,rgba(251,191,36,0.15));`
  );

  // Card B: 累計閱讀
  const cardB = makeCardHtml(
    iconLabel("trophy", "累計閱讀"),
    `${totalReadChapters} 章`,
    `在此計畫中讀完的經文章節總數。`,
    `var(--primary-color)`
  );

  // Card C: 達標天數
  const cardC = makeCardHtml(
    iconLabel("calendarThirty", "達標天數"),
    `${totalCompletedDays} 天`,
    `計畫中所有章節皆 100% 讀完的累積總天數。`,
    `var(--color-success-foreground)`
  );

  // Card D: 計畫狀態 (Badge text with specific colors)
  const badgeHtml = `
    <span class="stat-badge ${statusBadgeClass}">${statusLabel}</span>
  `;
  const cardD = makeCardHtml(
    iconLabel("signpost", "計畫狀態"),
    badgeHtml,
    `目前讀經進度與計畫預期進度的比對結果。`,
    `var(--text-primary)`
  );

  gridDiv.innerHTML = cardA + cardB + cardC + cardD;

  // Bottom action close button
  const footerDiv = document.createElement("div");
  footerDiv.style.cssText = `
    display: flex;
    justify-content: flex-end;
    margin-top: 0.2rem;
  `;
  const closeBtn = document.createElement("button");
  closeBtn.className = "primary-btn";
  closeBtn.style.cssText = `
    padding: 0.5rem 1.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 20px;
    width: 100%;
  `;
  closeBtn.textContent = "關閉";
  closeBtn.onclick = closeStatsModal;
  footerDiv.appendChild(closeBtn);

  modalContainer.appendChild(headerDiv);
  modalContainer.appendChild(gridDiv);
  modalContainer.appendChild(footerDiv);
  modalOverlay.appendChild(modalContainer);

  document.body.appendChild(modalOverlay);

  // Trigger smooth enter transitions
  requestAnimationFrame(() => {
    modalOverlay.style.opacity = "1";
    modalContainer.style.transform = "scale(1)";
  });
};

function setViewMode() {
  viewMode = 'calendar';
  state.planViewMode = 'calendar';
  ensurePlanViewModeToggle();
  renderPlanScheduleView();
}

function renderPlanScheduleView() {
  const container = document.getElementById("plan-schedule-view-container");
  if (!container || !state.activePlan) return;

  container.innerHTML = "";

  const calContainer = document.createElement("div");
  calContainer.id = "calendar-view-container";
  calContainer.className = "w-full px-4 text-center mx-0";

  const calendarCarousel = document.createElement("div");
  calendarCarousel.className = "date-carousel";
  calendarCarousel.id = "plan-date-carousel";
  calendarCarousel.style.width = "100%";

  calContainer.appendChild(calendarCarousel);
  container.appendChild(calContainer);
  renderHorizontalDateStrip();
}

function snapCalendarToToday() {
  if (!state.activePlan) return;
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();
  const todayPlanDay = state.activePlan.days.find(d => {
    if (Number(d.year) !== todayYear || Number(d.month) !== todayMonth) return false;
    const parts = d.date.split('/');
    return parts.length === 2 && Number(parts[1]) === todayDay;
  });
  if (todayPlanDay) {
    state.selectedPlanDay = todayPlanDay.dayNum;
    state.calendarViewYear = todayYear;
    state.calendarViewMonth = todayMonth;

    // 🛡️ 只做 CSS active class 切換，嚴禁呼叫 renderHorizontalDateStrip 重繪整個日曆
    const prev = document.querySelector('.plan-day-cell.active');
    if (prev) {
      prev.classList.remove('active');
      prev.setAttribute('aria-selected', 'false');
    }
    const target = document.querySelector(`.plan-day-cell[data-day-num="${todayPlanDay.dayNum}"]`);
    if (target) {
      target.classList.add('active');
      target.setAttribute('aria-selected', 'true');
    }

    renderPlanScheduleTracker(true);
    showToast("已跳轉至今日進度");
  } else {
    showToast("今日不在計畫期間內");
  }
}

function snapCalendarToMyProgress() {
  if (!state.activePlan) return;
  const nextReadingDay = getNextReadingPlanDay(state.activePlan);
  if (nextReadingDay) {
    state.selectedPlanDay = nextReadingDay.dayNum;
    state.calendarViewYear = nextReadingDay.year || new Date().getFullYear();
    state.calendarViewMonth = nextReadingDay.month || (new Date().getMonth() + 1);

    // 🛡️ 只做 CSS active class 切換，嚴禁呼叫 renderHorizontalDateStrip 重繪整個日曆
    const prev = document.querySelector('.plan-day-cell.active');
    if (prev) {
      prev.classList.remove('active');
      prev.setAttribute('aria-selected', 'false');
    }
    const target = document.querySelector(`.plan-day-cell[data-day-num="${nextReadingDay.dayNum}"]`);
    if (target) {
      target.classList.add('active');
      target.setAttribute('aria-selected', 'true');
    }

    renderPlanScheduleTracker(true);
    showToast("已回到您的實際讀經進度");
  } else {
    showToast("計畫已全部完成！");
  }
}



// --- Stats View Logic removed 2026-09-16 ---
// This whole cluster (updateStatsView, renderRosterTable,
// populateStatsZoneSelector, renderCharts, updateGroupChart,
// renderMonthlyHallOfFame, getTeamLogs, renderHeatmap,
// renderTeamStatsAnalysisDashboard) only ever ran when the router switched to
// a tab id "stats-view", which the current tab bar has no button for and no
// code path routes to anymore (superseded by renderPlanStatsView /
// renderPlanRankingView and the org-stats-tree in renderPlanMembersView).
// Two of its Supabase queries (view_pastoral_zone_stats /
// view_small_group_stats) had been silently failing for a long time because
// the underlying views never existed in the active schema (only in
// supabase/migrations_legacy, never carried into 0001_clean_schema.sql).

// calculateProfileStats / renderProfileReadingStats removed 2026-09-16:
// renderProfileReadingStats had zero callers anywhere in js/ — this "Migrated
// from profile.js" block never actually ran post-migration. Confirmed dead
// (not just unreachable): its template literal has escaped `\${...}`
// placeholders (e.g. what's now gone from around here used to read
// `\${todayProgressText}`) that would have rendered as literal "${...}" text
// on screen, so even if something had called it, the output was broken.

async function enterPlanListState() {
  exitDevotionViewer();
  exitGroupMeetingViewer();
  window.currentPlanViewState = PLAN_ROUTE.LIST;
  state.planDetailOpen = false;
  state.planActiveSubTab = "today";
  if (window.PlanPageController) window.PlanPageController.groupLoadedForPlanKey = null;
  const shell = setOnlyPlanRouteVisible(PLAN_ROUTE.LIST);
  moveGroupNodesToDetail(shell);
  renderJoinedPlansList();
  renderPresetPlansList();
}

async function enterPlanDetailState() {
  if (!state.activePlan) {
    await enterPlanListState();
    return;
  }
  const activePlanKind = state.activePlan.planKind || state.activePlan.plan_kind;
  // 每日靈修 / 小組聚會週計畫：純看內容，不打卡、不組隊、沒有「重複幾遍」的輪次概念。
  // 也**不跑「會友資格」閘門**——那個閘門是給「加入讀經計畫」用的，純預覽內容
  // 不該被 onboarding 缺項（缺小組 / 會籍待審…）擋掉，否則點了卡片沒反應。
  if (activePlanKind === "devotional") {
    window.currentPlanViewState = PLAN_ROUTE.DETAIL;
    state.planDetailOpen = true;
    state.planActiveSubTab = "today";
    setOnlyPlanRouteVisible(PLAN_ROUTE.DETAIL);
    await renderDevotionViewer(state.activePlan);
    return;
  }
  if (activePlanKind === "group_meeting") {
    window.currentPlanViewState = PLAN_ROUTE.DETAIL;
    state.planDetailOpen = true;
    state.planActiveSubTab = "today";
    setOnlyPlanRouteVisible(PLAN_ROUTE.DETAIL);
    await renderGroupMeetingViewer(state.activePlan);
    return;
  }
  if (typeof window.guardPlanEligibility === "function" && window.guardPlanEligibility()) return;
  exitDevotionViewer();
  exitGroupMeetingViewer();
  calculatePlanProgress();
  window.currentPlanViewState = PLAN_ROUTE.DETAIL;
  state.planDetailOpen = true;
  state.planActiveSubTab = "today";
  setOnlyPlanRouteVisible(PLAN_ROUTE.DETAIL);
  if (window.PlanPageController) await window.PlanPageController.switchPage(PLAN_PAGE.READING, { skipChrome: true });
}

async function fetchGroupRankings(planId) {
  if (!state.activePlan && planId) {
    state.activePlan = (state.activePlans || []).find(plan =>
      plan.id === planId ||
      plan.globalPlanId === planId ||
      plan.presetKey === planId
    ) || null;
    if (typeof window.syncActivePlanContext === "function") window.syncActivePlanContext(state.activePlan);
  }
  if (!state.activePlan) return;

  window._statsTabScope = getDefaultGroupStatsScope();
  populateStatsSelector();
  await populateMembersSelector();
}

async function enterGroupProgressState() {
  if (typeof window.guardPlanEligibility === "function" && window.guardPlanEligibility()) return;
  if (!state.activePlan) {
    await enterPlanListState();
    return;
  }
  exitDevotionViewer();
  exitGroupMeetingViewer();
  window.currentPlanViewState = PLAN_ROUTE.GROUP;
  state.planDetailOpen = true;

  const isTeamPlan = typeof window.isReadingTeamPlan === "function" && window.isReadingTeamPlan(state.activePlan);
  let hasTeam = false;
  if (isTeamPlan) {
    hasTeam = await checkUserHasTeam();
  }

  let requestedSubview = Object.values(GROUP_SUBVIEW).includes(state.planActiveSubTab)
    ? state.planActiveSubTab
    : (window.PlanPageController?.groupSubview || GROUP_SUBVIEW.STATS);

  if (isTeamPlan && !hasTeam && requestedSubview === GROUP_SUBVIEW.STATS) {
    requestedSubview = GROUP_SUBVIEW.PERSONAL;
  }

  state.planActiveSubTab = requestedSubview;
  setOnlyPlanRouteVisible(PLAN_ROUTE.GROUP);
  if (window.PlanPageController) {
    window.PlanPageController.groupSubview = requestedSubview;
    await window.PlanPageController.switchPage(PLAN_PAGE.GROUP, { skipChrome: true, primaryView: requestedSubview });
  }
}

async function setPlanState(newState) {
  ensurePlanRouteShell();

  const normalized = String(newState || "").toUpperCase();
  if (normalized === PLAN_ROUTE.DETAIL || normalized === "DETAIL" || normalized === PLAN_ROUTE.GROUP || normalized === "GROUP") {
    if (state.activePlan && isPlanExpired(state.activePlan)) {
      showToast(getPlanEndedNotice(state.activePlan.endDate));
    }
  }


  if (normalized === PLAN_ROUTE.LIST || normalized === "LIST") {
    await enterPlanListState();
  } else if (normalized === PLAN_ROUTE.DETAIL || normalized === "DETAIL") {
    await enterPlanDetailState();
  } else if (normalized === PLAN_ROUTE.GROUP || normalized === "GROUP") {
    await enterGroupProgressState();

  } else {
    console.error(`[PlanSM] Unknown state: ${newState}`);
    return;
  }

  if (typeof appRouter !== "undefined" && typeof appRouter.updateNavigationChrome === "function") {
    appRouter.updateNavigationChrome();
  }
}

async function showDiscoverPlans() {
  await setPlanState(PLAN_ROUTE.LIST);
  document.querySelector('#plan-list-status-pills .pill-btn[data-filter="saved"]')?.click();
}

// ── 每日靈修 viewer（會友端；plan_kind='devotional'）─────────────────────────
let devotionViewerDayIndex = null;
let devotionViewerPlanId = null;

// 首頁「今日靈修」卡片一律要跳到「今天」那一天，即使使用者在 viewer 裡上次
// 瀏覽到別天也一樣——所以進場前先把記憶的頁碼清掉，讓 renderDevotionViewer
// 重新以「今天」為準（見下面 renderDevotionViewer 裡 devotionViewerDayIndex
// == null 的分支）。
function resetDevotionViewerDay() {
  devotionViewerDayIndex = null;
}
window.resetDevotionViewerDay = resetDevotionViewerDay;

// 靈修 viewer 用「獨立容器」#devotion-view-root（不碰 #plan-detail-subview，
// 那是一般計畫詳情的大結構，被 innerHTML 洗掉就回不來了）。
function showDevotionViewerRoot() {
  const detailView = document.getElementById("plan-detail-view");
  const legacy = document.getElementById("plan-detail-subview");
  let root = document.getElementById("devotion-view-root");
  if (!root && detailView) {
    root = document.createElement("div");
    root.id = "devotion-view-root";
    detailView.appendChild(root);
  }
  // #plan-detail-subview 在 index.html 帶 inline `display:flex`，光加 .hidden 蓋不掉。
  if (legacy) { legacy.classList.add("hidden"); legacy.style.display = "none"; }
  if (root) { root.classList.remove("hidden"); root.style.display = "block"; }
  return root;
}
function exitDevotionViewer() {
  // 心得編輯視窗掛在 document.body，離開 viewer 時一併收掉，避免變成孤兒遮罩。
  document.querySelectorAll(".devotion-note-modal").forEach(el => el.remove());
  const root = document.getElementById("devotion-view-root");
  if (root) { root.innerHTML = ""; root.classList.add("hidden"); root.style.display = "none"; }
  const legacy = document.getElementById("plan-detail-subview");
  if (legacy) {
    legacy.classList.remove("hidden");
    legacy.style.display = "flex"; // 還原 index.html 原本的 inline；之後 setOnlyPlanRouteVisible 會再依路由調整
  }
}
window.exitDevotionViewer = exitDevotionViewer;

function renderDevotionViewer(plan) {
  const host = showDevotionViewerRoot();
  if (!host) return Promise.resolve();
  host.innerHTML = '<div class="devotion-view"><p class="devotion-view__loading">正在載入每日靈修…</p></div>';

  const planId = plan.globalPlanId || plan.global_plan_id || plan.id;
  if (devotionViewerPlanId !== planId) { devotionViewerPlanId = planId; devotionViewerDayIndex = null; }
  return db.getDevotionalPlan(planId).then(async res => {
    if (!res.success) {
      host.innerHTML = `<div class="devotion-view"><p class="devotion-view__loading">${escapeHTML(res.message || "無法載入每日靈修。")}</p></div>`;
      return;
    }
    const d = res.data || {};
    const days = (Array.isArray(d.days) ? d.days : []).slice().sort((a, b) => a.dayIndex - b.dayIndex);
    if (!days.length) {
      host.innerHTML = '<div class="devotion-view"><p class="devotion-view__loading">內容準備中，敬請期待。</p></div>';
      return;
    }
    const total = days[days.length - 1].dayIndex;
    // 預設落在「今天對應的那天」，夾在有內容的範圍
    if (devotionViewerDayIndex == null) {
      const todayRow = days.find(x => x.displayDate === d.today);
      if (todayRow) devotionViewerDayIndex = todayRow.dayIndex;
      else {
        const past = days.filter(x => x.displayDate <= d.today);
        devotionViewerDayIndex = past.length ? past[past.length - 1].dayIndex : days[0].dayIndex;
      }
    }
    const clampToAvailable = (idx) => {
      const exact = days.find(x => x.dayIndex === idx);
      if (exact) return exact;
      const le = days.filter(x => x.dayIndex <= idx);
      return le.length ? le[le.length - 1] : days[0];
    };
    let cur = clampToAvailable(devotionViewerDayIndex);
    devotionViewerDayIndex = cur.dayIndex;

    // ── 個人打勾 + 思想經文心得 ──
    // 本機 localStorage 為底；心得一律同步到 Supabase（migration 0158），
    // 「最近一週」內的打勾也同步，更早的打勾只留本機。換裝置 / 清快取時心得
    // 不會弄丟。雲端載入失敗（示範模式 / 離線 / localhost）就純本機運作。
    const readKey = (di) => `devotion_read_${planId}_${di}`;
    const thinkKey = (di, i) => `devotion_thought_${planId}_${di}_${i}`;
    const noteMirrorKey = (di, i) => `devotion_think_note_${planId}_${di}_${i}`;
    const lsGet = (k) => { try { return localStorage.getItem(k) === "1"; } catch (_) { return false; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch (_) {} };
    const lsGetRaw = (k) => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
    const lsSetRaw = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (_) {} };

    const cloud = new Map(); // "di|kind|idx" -> { done, note }
    const cloudKey = (di, kind, i) => `${di}|${kind}|${i}`;
    try {
      const pr = await db.listDevotionProgress(planId);
      const items = pr && pr.success && pr.data && Array.isArray(pr.data.items) ? pr.data.items : [];
      items.forEach(it => {
        cloud.set(cloudKey(it.dayIndex, it.itemKind, it.itemIndex == null ? 0 : it.itemIndex), {
          done: it.done === true, note: String(it.note || "")
        });
      });
    } catch (_) { /* 純本機 */ }

    const parseISO = (s) => { const t = new Date(`${s}T00:00:00Z`); return Number.isNaN(t.getTime()) ? null : t; };
    const daysApart = (a, b) => {
      const da = parseISO(a), db2 = parseISO(b);
      if (!da || !db2) return Infinity;
      return Math.round((da - db2) / 86400000);
    };
    const todayISO = d.today || "";
    // 「最近一週」= 今天往前推 7 天（含今天）。範圍外的打勾只存本機。
    const withinSyncWindow = (displayDate) => {
      const diff = daysApart(todayISO, displayDate);
      return diff >= 0 && diff <= 7;
    };

    const isPassageDone = (row) => {
      const c = cloud.get(cloudKey(row.dayIndex, "passage", 0));
      return (c && c.done) || lsGet(readKey(row.dayIndex));
    };
    const isThinkDone = (di, i) => {
      const c = cloud.get(cloudKey(di, "think", i));
      return (c && c.done) || lsGet(thinkKey(di, i));
    };
    const thinkNote = (di, i) => {
      const c = cloud.get(cloudKey(di, "think", i));
      if (c && c.note) return c.note;
      return lsGetRaw(noteMirrorKey(di, i));
    };

    // 本機一定寫；符合「最近一週」視窗、或這一筆帶心得，才推雲端。
    const persistProgress = (di, displayDate, kind, i, done, note) => {
      lsSet(kind === "passage" ? readKey(di) : thinkKey(di, i), done);
      if (kind === "think") lsSetRaw(noteMirrorKey(di, i), note);
      cloud.set(cloudKey(di, kind, i), { done: !!done, note: String(note || "") });
      if (String(note || "").trim() || withinSyncWindow(displayDate)) {
        db.upsertDevotionProgress({
          globalPlanId: planId, dayIndex: di, itemKind: kind, itemIndex: i,
          done: !!done, note: String(note || "")
        }).catch(() => {});
      }
    };

    const dayDone = (row) => {
      if (row.locked) return false;
      if (!isPassageDone(row)) return false;
      const rs = Array.isArray(row.reflections) ? row.reflections : [];
      return rs.every((_, i) => isThinkDone(row.dayIndex, i));
    };

    const todayStr = d.today || "";
    const checkIcon = typeof renderIcon === "function" ? renderIcon("check", { size: "sm", className: "nlc-icon" }) : "✓";

    // ── 日曆（與一般計畫日曆完全一致：同樣的滑動視窗、淡色鄰月格、5 列高度上限）──
    const buildCalendar = () => {
      const dts = days.map(x => new Date(`${x.displayDate}T00:00:00`)).filter(x => !Number.isNaN(x.getTime()));
      if (!dts.length) return "";
      // 起訖：優先用計畫 start/end，否則退回第一 / 最後一個靈修日
      let planStart = d.startDate ? new Date(`${d.startDate}T00:00:00`) : null;
      let planEnd = d.endDate ? new Date(`${d.endDate}T00:00:00`) : null;
      if (!planStart || Number.isNaN(planStart.getTime())) planStart = new Date(Math.min(...dts));
      if (!planEnd || Number.isNaN(planEnd.getTime())) planEnd = new Date(Math.max(...dts));
      // 滑動視窗：start −14 天回到週日、end +21 天前進到週六（與 renderHorizontalDateStrip 同一套規則）
      const start = new Date(planStart);
      start.setDate(start.getDate() - 14);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(planEnd);
      end.setDate(end.getDate() + 21);
      end.setDate(end.getDate() + (6 - end.getDay()));
      const byDate = new Map(days.map(x => [x.displayDate, x]));
      let cells = "";
      for (let t = new Date(start); t <= end; t.setDate(t.getDate() + 1)) {
        const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
        const row = byDate.get(iso);
        const label = t.getDate() === 1 ? `${t.getMonth() + 1}/1` : `${t.getDate()}`;
        if (!row) {
          // 非靈修日：沿用一般計畫日曆的淡色 other-month 格（保留日期數字＋灰點）
          const isToday = iso === todayStr;
          cells += `<span class="plan-day-cell plan-day-cell--muted other-month${isToday ? " today" : ""}" aria-hidden="true"><span class="day-number">${label}</span>${isToday ? "" : '<span class="day-status-dot dot-grey"></span>'}</span>`;
          continue;
        }
        const cls = ["plan-day-cell"];
        if (row.dayIndex === cur.dayIndex) cls.push("active");
        if (iso === todayStr) cls.push("today");
        if (dayDone(row)) cls.push("completed");
        // 每日靈修不標「過期未完成」的紅色——沒打勾只是還沒做，不施壓。
        cells += `<button type="button" class="${cls.join(" ")}" data-devo-day="${row.dayIndex}"${iso === todayStr ? ' aria-current="date"' : ""}><span class="day-number">${label}</span></button>`;
      }
      return `<div class="calendar-component plan-calendar devotion-view__calendar">
        <div class="calendar-weekdays">${["週日","週一","週二","週三","週四","週五","週六"].map(w => `<div>${w}</div>`).join("")}</div>
        <div class="calendar-scroll-container scrollbar-none"><div class="calendar-grid">${cells}</div></div>
      </div>`;
    };

    // 與一般計畫日曆一致：把捲動區高度壓到 5 列，並在首次繪製時把選取日置中
    let calendarCentered = false;
    const tuneCalendar = () => {
      const sc = host.querySelector(".calendar-scroll-container");
      const grid = host.querySelector(".calendar-grid");
      const firstCell = grid && grid.querySelector(".plan-day-cell");
      if (!sc || !grid || !firstCell) return;
      const gs = getComputedStyle(grid);
      const rowGap = parseFloat(gs.rowGap) || 0;
      const padY = (parseFloat(gs.paddingTop) || 0) + (parseFloat(gs.paddingBottom) || 0);
      const rowH = firstCell.getBoundingClientRect().height;
      if (rowH > 0) {
        const rows = 5;
        sc.style.maxHeight = Math.ceil(rowH * rows + rowGap * (rows - 1) + padY) + "px";
      }
      if (!calendarCentered) {
        const activeCell = grid.querySelector(".plan-day-cell.active");
        if (activeCell && sc.clientHeight > 0) {
          sc.scrollTop = Math.max(0, activeCell.offsetTop - sc.clientHeight / 2 + activeCell.offsetHeight / 2);
        }
        calendarCentered = true;
      }
    };

    let devotionPassageView = null; // { ref, label } —非 null 時，靈修畫面內只顯示該段經文

    // ── 思想經文「寫心得」全螢幕編輯視窗（有返回鍵；掛 document.body，不受計畫詳情捲動容器限制）──
    let devotionNoteOverlay = null;
    function onDevotionNoteKey(e) { if (e.key === "Escape") closeDevotionNoteEditor(); }
    const closeDevotionNoteEditor = () => {
      if (devotionNoteOverlay) { devotionNoteOverlay.remove(); devotionNoteOverlay = null; }
      document.removeEventListener("keydown", onDevotionNoteKey);
    };
    const openDevotionNoteEditor = (row, idx, promptText) => {
      closeDevotionNoteEditor();
      const existing = thinkNote(row.dayIndex, idx);
      const overlay = document.createElement("div");
      overlay.className = "tts-guide-modal-overlay devotion-note-modal";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDevotionNoteEditor(); });
      overlay.innerHTML = `
        <div class="modal-panel devotion-note-modal__panel">
          <div class="devotion-note-modal__head">
            <button type="button" class="pill-btn" data-note-back>← 返回</button>
            <h4>寫下心得</h4>
            <button type="button" class="devotion-note-modal__x" data-note-x aria-label="關閉">&times;</button>
          </div>
          <div class="devotion-note-modal__body">
            ${promptText ? `<p class="devotion-note-modal__prompt">${escapeHTML(promptText)}</p>` : ""}
            <textarea class="form-control devotion-note-modal__text" rows="8" placeholder="把今天默想到的、想跟主說的話寫下來…">${escapeHTML(existing)}</textarea>
            <p class="devotion-note-modal__hint">只有你自己看得到，會存到雲端，換手機也還在。</p>
            <p class="devotion-note-modal__msg" data-note-msg></p>
          </div>
          <div class="devotion-note-modal__foot">
            <button type="button" class="primary-btn" data-note-save>儲存</button>
            <button type="button" class="pill-btn" data-note-cancel>取消</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      devotionNoteOverlay = overlay;
      document.addEventListener("keydown", onDevotionNoteKey);
      if (typeof hydrateIcons === "function") hydrateIcons(overlay);
      const ta = overlay.querySelector(".devotion-note-modal__text");
      setTimeout(() => { try { ta.focus(); } catch (_) {} }, 30);
      overlay.querySelector("[data-note-back]").addEventListener("click", closeDevotionNoteEditor);
      overlay.querySelector("[data-note-x]").addEventListener("click", closeDevotionNoteEditor);
      overlay.querySelector("[data-note-cancel]").addEventListener("click", closeDevotionNoteEditor);
      overlay.querySelector("[data-note-save]").addEventListener("click", async () => {
        const val = ta.value.trim();
        const msg = overlay.querySelector("[data-note-msg]");
        const btn = overlay.querySelector("[data-note-save]");
        btn.disabled = true;
        if (msg) { msg.textContent = "儲存中…"; msg.style.color = "var(--text-secondary)"; }
        const doneNow = isThinkDone(row.dayIndex, idx);
        const r = await db.upsertDevotionProgress({
          globalPlanId: planId, dayIndex: row.dayIndex, itemKind: "think", itemIndex: idx,
          done: doneNow, note: val
        });
        btn.disabled = false;
        if (!r || !r.success) {
          if (msg) { msg.textContent = (r && r.message) || "儲存失敗，請稍後再試。"; msg.style.color = "var(--color-danger)"; }
          return;
        }
        lsSetRaw(noteMirrorKey(row.dayIndex, idx), val);
        cloud.set(cloudKey(row.dayIndex, "think", idx), { done: doneNow, note: val });
        closeDevotionNoteEditor();
        paint();
      });
    };

    // ── 分享 / 複製內文：勾選要帶哪些段落（經文 / 思想經文 / 影片連結），組成純文字 ──
    let devotionShareOverlay = null;
    function onDevotionShareKey(e) { if (e.key === "Escape") closeDevotionShareModal(); }
    const closeDevotionShareModal = () => {
      if (devotionShareOverlay) { devotionShareOverlay.remove(); devotionShareOverlay = null; }
      document.removeEventListener("keydown", onDevotionShareKey);
    };
    const SHARE_OPTS_KEY = "devotion_share_opts";
    const readShareOpts = () => {
      try {
        const o = JSON.parse(localStorage.getItem(SHARE_OPTS_KEY) || "{}") || {};
        return { passage: o.passage !== false, reflections: o.reflections !== false, video: o.video !== false };
      } catch (_) { return { passage: true, reflections: true, video: true }; }
    };
    const openDevotionShareModal = (day) => {
      closeDevotionShareModal();
      const opts = readShareOpts();
      const dateLabel = day.displayDate || "";
      const refl = Array.isArray(day.reflections) ? day.reflections.filter(Boolean) : [];
      const hasVideo = !!(day.videoUrl && String(day.videoUrl).trim());

      let passageFetching = false;
      const buildText = (o) => {
        const lines = [`【每日靈修】${dateLabel}`.trim()];
        if (day.title) lines.push(`主題：${day.title}`);
        if (o.passage && day.passageLabel) {
          lines.push("", `經文：${day.passageLabel}`);
          if (day._sharePassageText) lines.push(day._sharePassageText);
          else if (passageFetching) lines.push("（讀取經文內文中…）");
        }
        if (o.reflections && refl.length) {
          lines.push("", "思想經文：");
          refl.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
        }
        if (o.video && hasVideo) {
          lines.push("", day.videoTitle ? `靈修影片：${day.videoTitle}` : "靈修影片：", String(day.videoUrl).trim());
        }
        return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      };

      const overlay = document.createElement("div");
      overlay.className = "tts-guide-modal-overlay devotion-note-modal devotion-share-modal";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDevotionShareModal(); });
      const optRow = (key, label, disabled) => `
        <label class="devotion-share-opt${disabled ? " is-disabled" : ""}">
          <input type="checkbox" data-share-opt="${key}" ${opts[key] && !disabled ? "checked" : ""} ${disabled ? "disabled" : ""}>
          <span>${escapeHTML(label)}</span>
        </label>`;
      const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
      overlay.innerHTML = `
        <div class="modal-panel devotion-note-modal__panel">
          <div class="devotion-note-modal__head">
            <button type="button" class="pill-btn" data-share-back>← 返回</button>
            <h4>分享 / 複製</h4>
            <button type="button" class="devotion-note-modal__x" data-share-x aria-label="關閉">&times;</button>
          </div>
          <div class="devotion-note-modal__body">
            <p class="devotion-note-modal__hint">選要帶哪些內容，下面會即時組成文字，可以複製或直接分享到別的地方。</p>
            <div class="devotion-share-opts">
              ${optRow("passage", "經文（含內文）", !day.passageLabel)}
              ${optRow("reflections", `思想經文（${refl.length} 題）`, !refl.length)}
              ${optRow("video", "靈修影片連結", !hasVideo)}
            </div>
            <textarea class="form-control devotion-note-modal__text devotion-share-preview" rows="9" readonly></textarea>
            <p class="devotion-note-modal__msg" data-share-msg></p>
          </div>
          <div class="devotion-note-modal__foot">
            <button type="button" class="primary-btn" data-share-copy>複製文字</button>
            ${canNativeShare ? '<button type="button" class="secondary-btn" data-share-native>分享…</button>' : ""}
            <button type="button" class="pill-btn" data-share-cancel>關閉</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      devotionShareOverlay = overlay;
      document.addEventListener("keydown", onDevotionShareKey);
      if (typeof hydrateIcons === "function") hydrateIcons(overlay);

      const preview = overlay.querySelector(".devotion-share-preview");
      const msgEl = overlay.querySelector("[data-share-msg]");
      const setMsg = (m, err) => { if (msgEl) { msgEl.textContent = m || ""; msgEl.style.color = err ? "var(--color-danger)" : "var(--text-secondary)"; } };
      const currentOpts = () => {
        const o = {};
        overlay.querySelectorAll("[data-share-opt]").forEach(cb => { o[cb.dataset.shareOpt] = cb.checked; });
        return o;
      };
      const refresh = () => {
        const o = currentOpts();
        preview.value = buildText(o);
        try { localStorage.setItem(SHARE_OPTS_KEY, JSON.stringify(o)); } catch (_) {}
      };
      overlay.querySelectorAll("[data-share-opt]").forEach(cb => cb.addEventListener("change", refresh));
      refresh();

      // 「經文」要附上經文內文：抓一次（快取在 day 上），回來重刷預覽
      const passageRef = (Array.isArray(day.passageRefs) && day.passageRefs[0] && day.passageRefs[0].book)
        ? day.passageRefs[0]
        : (typeof parsePassageLabel === "function" ? parsePassageLabel(day.passageLabel) : null);
      if (day.passageLabel && !day._sharePassageText && passageRef && passageRef.book
          && typeof fetchDevotionPassagePlainText === "function") {
        passageFetching = true;
        refresh();
        fetchDevotionPassagePlainText(passageRef).then(txt => {
          if (txt) day._sharePassageText = txt;
        }).catch(() => {}).finally(() => {
          passageFetching = false;
          if (devotionShareOverlay === overlay) refresh();
        });
      }

      overlay.querySelector("[data-share-back]").addEventListener("click", closeDevotionShareModal);
      overlay.querySelector("[data-share-x]").addEventListener("click", closeDevotionShareModal);
      overlay.querySelector("[data-share-cancel]").addEventListener("click", closeDevotionShareModal);

      overlay.querySelector("[data-share-copy]").addEventListener("click", async () => {
        const text = preview.value;
        if (!text) { setMsg("沒有可複製的內容，請至少勾一項。", true); return; }
        let ok = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; }
        } catch (_) { ok = false; }
        if (!ok) {
          try {
            preview.removeAttribute("readonly");
            preview.focus(); preview.select(); preview.setSelectionRange(0, text.length);
            ok = document.execCommand("copy");
            preview.setAttribute("readonly", "");
          } catch (_) { ok = false; }
        }
        if (ok) { if (typeof showToast === "function") showToast("已複製，可以貼到別的地方了"); setMsg("已複製。"); }
        else setMsg("這個瀏覽器不允許自動複製，請手動選取上面文字。", true);
      });

      const nativeBtn = overlay.querySelector("[data-share-native]");
      if (nativeBtn) nativeBtn.addEventListener("click", async () => {
        const text = preview.value;
        if (!text) { setMsg("沒有可分享的內容，請至少勾一項。", true); return; }
        try { await navigator.share({ text }); } catch (_) { /* 使用者取消或不支援 */ }
      });
    };

    const paint = () => {
      if (devotionPassageView) {
        renderDevotionPassageInline(host, devotionPassageView.ref, devotionPassageView.label, () => {
          devotionPassageView = null;
          paint();
        });
        return;
      }
      cur = days.find(x => x.dayIndex === devotionViewerDayIndex) || cur;
      const locked = cur.locked === true;
      const reflections = Array.isArray(cur.reflections) ? cur.reflections : [];
      const refs = Array.isArray(cur.passageRefs) ? cur.passageRefs : [];
      const firstRef = refs[0] || (typeof parsePassageLabel === "function" ? parsePassageLabel(cur.passageLabel) : null);
      const passageRead = isPassageDone(cur);
      const devotionVideoId = cur.videoUrl ? extractYoutubeVideoId(cur.videoUrl) : null;
      const devotionVideoThumbUrl = devotionVideoId ? `https://img.youtube.com/vi/${devotionVideoId}/hqdefault.jpg` : "";

      const taskRow = ({ checked, title, opens, arrow, dataAttr, trailing }) => `
        <div class="plan-task-item" ${dataAttr || ""}>
          <button type="button" class="task-read-toggle" data-devo-toggle
            aria-pressed="${checked ? "true" : "false"}" aria-label="${checked ? "取消已讀" : "標記已讀"}">
            <span class="task-checkbox ${checked ? "checked" : ""}" aria-hidden="true">${checked ? checkIcon : ""}</span>
          </button>
          ${opens
            ? `<button type="button" class="task-open-button" data-devo-open>
                 <span class="task-title">${title}</span>
                 ${arrow ? `<span class="task-arrow" aria-hidden="true">${typeof renderIcon === "function" ? renderIcon("chevronRight", { size: "sm", className: "nlc-icon" }) : "›"}</span>` : ""}
               </button>`
            : `<div class="task-open-button task-open-button--static"><span class="task-title">${title}</span></div>`}
          ${trailing || ""}
        </div>`;

      // 思想經文：點整條問題就進入心得編輯；寫過的加一個「已寫心得」淡標記。
      const thinkTitle = (t, i) => escapeHTML(t)
        + (thinkNote(cur.dayIndex, i).trim() ? ' <span class="devotion-think-note-flag">已寫心得</span>' : "");

      host.innerHTML = `
        <div class="devotion-view">
          ${buildCalendar()}
          <div class="devotion-view__daylabel">
            <strong>第 ${cur.dayIndex} 天</strong> / 共 ${total} 天　<span class="devotion-view__date">${escapeHTML(cur.displayDate || "")}</span>
          </div>
          ${(!locked && cur.title) ? `<h3 class="devotion-view__theme">${escapeHTML(cur.title)}</h3>` : ""}
          ${!locked ? `<div class="devotion-view__actions">
            <button type="button" class="devotion-view__share" data-devo-share>
              ${typeof renderIcon === "function" ? renderIcon("share", { size: "sm", className: "nlc-icon" }) : ""}分享 / 複製
            </button>
          </div>` : ""}
          ${locked ? `
            <div class="devotion-view__locked">
              <span class="nlc-icon nlc-icon--md" data-icon="lock" aria-hidden="true"></span>
              <p>這一天 ${escapeHTML(cur.displayDate || "")} 開放</p>
            </div>` : `
            <section class="devotion-view__block">
              <h4 class="devotion-view__h">經文進度</h4>
              <div class="plan-task-list">
                ${taskRow({ checked: passageRead, title: escapeHTML(cur.passageLabel || "（未設定）"),
                  opens: !!(firstRef && firstRef.book), arrow: true, dataAttr: 'data-devo-kind="passage"' })}
              </div>
            </section>
            <section class="devotion-view__block">
              <h4 class="devotion-view__h">思想經文</h4>
              ${reflections.length ? `<div class="plan-task-list">${reflections.map((t, i) =>
                taskRow({ checked: isThinkDone(cur.dayIndex, i), title: thinkTitle(t, i),
                  opens: true, arrow: true, dataAttr: `data-devo-kind="think" data-devo-i="${i}"` })).join("")}</div>`
                : `<p class="devotion-view__muted">（本日無思想題）</p>`}
            </section>
            ${cur.videoUrl ? `
            <section class="devotion-view__block">
              <h4 class="devotion-view__h">靈修影片</h4>
              <a class="devotion-video-link" href="${escapeHTML(cur.videoUrl)}" target="_blank" rel="noopener noreferrer"
                 aria-label="${escapeHTML(cur.videoTitle || '觀看影片')}">
                ${devotionVideoThumbUrl ? `
                <span class="devotion-video-link__thumb-wrap">
                  <img class="devotion-video-link__thumb" src="${escapeHTML(devotionVideoThumbUrl)}" alt="" loading="lazy">
                  <span class="devotion-video-link__play nlc-icon" data-icon="circlePlay" aria-hidden="true"></span>
                </span>` : ""}
                <span class="devotion-video-link__title">${escapeHTML(cur.videoTitle || "觀看影片")} ↗</span>
              </a>
            </section>` : ""}
          `}
        </div>`;

      if (typeof hydrateIcons === "function") hydrateIcons(host);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(tuneCalendar);
      else tuneCalendar();

      host.querySelector("[data-devo-share]")?.addEventListener("click", () => openDevotionShareModal(cur));

      host.querySelectorAll("[data-devo-day]").forEach(btn => btn.addEventListener("click", () => {
        devotionViewerDayIndex = Number(btn.dataset.devoDay);
        const sc = host.querySelector(".calendar-scroll-container");
        const st = sc ? sc.scrollTop : 0;
        paint();
        const sc2 = host.querySelector(".calendar-scroll-container");
        if (sc2) sc2.scrollTop = st;
      }));

      host.querySelectorAll(".plan-task-item").forEach(item => {
        const kind = item.dataset.devoKind;
        const i = item.dataset.devoI;
        item.querySelector("[data-devo-toggle]")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (kind === "think") {
            const idx = Number(i);
            persistProgress(cur.dayIndex, cur.displayDate, "think", idx,
              !isThinkDone(cur.dayIndex, idx), thinkNote(cur.dayIndex, idx));
          } else {
            persistProgress(cur.dayIndex, cur.displayDate, "passage", 0, !isPassageDone(cur), "");
          }
          paint();
        });
        item.querySelector("[data-devo-open]")?.addEventListener("click", () => {
          if (kind === "think") {
            const idx = Number(i);
            openDevotionNoteEditor(cur, idx, reflections[idx] || "");
          } else if (firstRef && firstRef.book) {
            devotionPassageView = { ref: firstRef, label: cur.passageLabel || "" };
            paint();
          }
        });
      });
    };
    paint();
  });
}
window.renderDevotionViewer = renderDevotionViewer;

// ── 小組聚會週計畫 viewer（會友端；plan_kind='group_meeting'）──────────────────
let groupMeetingViewerWeekIndex = null;
let groupMeetingViewerPlanId = null;
function resetGroupMeetingViewerWeek() {
  groupMeetingViewerWeekIndex = null;
}
window.resetGroupMeetingViewerWeek = resetGroupMeetingViewerWeek;

function showGroupMeetingViewerRoot() {
  const detailView = document.getElementById("plan-detail-view");
  const legacy = document.getElementById("plan-detail-subview");
  const devRoot = document.getElementById("devotion-view-root");
  let root = document.getElementById("group-meeting-view-root");
  if (!root && detailView) {
    root = document.createElement("div");
    root.id = "group-meeting-view-root";
    detailView.appendChild(root);
  }
  if (legacy) { legacy.classList.add("hidden"); legacy.style.display = "none"; }
  if (devRoot) { devRoot.classList.add("hidden"); devRoot.style.display = "none"; }
  if (root) { root.classList.remove("hidden"); root.style.display = "block"; }
  return root;
}
function exitGroupMeetingViewer() {
  const root = document.getElementById("group-meeting-view-root");
  if (root) { root.innerHTML = ""; root.classList.add("hidden"); root.style.display = "none"; }
  const legacy = document.getElementById("plan-detail-subview");
  if (legacy) { legacy.classList.remove("hidden"); legacy.style.display = "flex"; }
}
window.exitGroupMeetingViewer = exitGroupMeetingViewer;

function renderGroupMeetingViewer(plan) {
  const host = showGroupMeetingViewerRoot();
  if (!host) return Promise.resolve();
  host.innerHTML = '<div class="group-meeting-view"><p class="group-meeting-view__loading">正在載入小組聚會計畫…</p></div>';

  const planId = plan.globalPlanId || plan.global_plan_id || plan.id;
  if (groupMeetingViewerPlanId !== planId) { groupMeetingViewerPlanId = planId; groupMeetingViewerWeekIndex = null; }

  return db.getGroupMeetingPlan(planId).then(res => {
    if (!res.success) {
      host.innerHTML = `<div class="group-meeting-view"><p class="group-meeting-view__loading">${escapeHTML(res.message || "無法載入小組聚會計畫。")}</p></div>`;
      return;
    }
    const d = res.data || {};
    const weeks = (Array.isArray(d.weeks) ? d.weeks : []).slice().sort((a, b) => a.weekIndex - b.weekIndex);
    if (!weeks.length) {
      host.innerHTML = '<div class="group-meeting-view"><p class="group-meeting-view__loading">內容準備中，敬請期待。</p></div>';
      return;
    }
    // 預設落在「本週」，否則最後一個已過的週，否則第 1 週
    if (groupMeetingViewerWeekIndex == null) {
      const thisW = weeks.find(w => w.isThisWeek);
      if (thisW) groupMeetingViewerWeekIndex = thisW.weekIndex;
      else {
        const past = weeks.filter(w => w.isPast);
        groupMeetingViewerWeekIndex = past.length ? past[past.length - 1].weekIndex : weeks[0].weekIndex;
      }
    }
    const clamp = (idx) => weeks.find(w => w.weekIndex === idx)
      || weeks.filter(w => w.weekIndex <= idx).slice(-1)[0] || weeks[0];
    let cur = clamp(groupMeetingViewerWeekIndex);
    groupMeetingViewerWeekIndex = cur.weekIndex;

    let passageView = null; // { ref, label }

    const chevron = typeof renderIcon === "function" ? renderIcon("chevronRight", { size: "sm", className: "nlc-icon" }) : "›";

    const passageRow = (topic, label, refs, kind) => {
      const t = String(topic || "").trim();
      const l = String(label || "").trim() || "（未設定）";
      const titleHtml = t
        ? `<span class="gm-passage-topic">${escapeHTML(t)}</span><span class="gm-passage-sep" aria-hidden="true">｜</span><span class="gm-passage-ref">${escapeHTML(l)}</span>`
        : `<span class="gm-passage-ref">${escapeHTML(l)}</span>`;
      const first = Array.isArray(refs) && refs[0] && refs[0].book ? refs[0] : null;
      if (first) {
        return `<div class="plan-task-item" data-gm-open data-gm-kind="${kind}">
          <button type="button" class="task-open-button">
            <span class="task-title">${titleHtml}</span>
            <span class="task-arrow" aria-hidden="true">${chevron}</span>
          </button>
        </div>`;
      }
      return `<div class="plan-task-item"><div class="task-open-button task-open-button--static"><span class="task-title">${titleHtml}</span></div></div>`;
    };

    const buildStrip = () => {
      const chips = weeks.map(w => {
        const cls = ["gm-week-chip"];
        if (w.weekIndex === cur.weekIndex) cls.push("active");
        if (w.isThisWeek) cls.push("this-week");
        else if (w.isPast) cls.push("past");
        if (w.locked) cls.push("locked");
        return `<button type="button" class="${cls.join(" ")}" data-gm-week="${w.weekIndex}">
          <span class="gm-week-chip__n">${escapeHTML(w.dateLabel || "")}</span>
        </button>`;
      }).join("");
      return `<div class="group-meeting-view__strip scrollbar-none">${chips}</div>`;
    };

    const paint = () => {
      cur = weeks.find(w => w.weekIndex === groupMeetingViewerWeekIndex) || cur;

      if (passageView) {
        renderDevotionPassageInline(host, passageView.ref, passageView.label, () => { passageView = null; paint(); });
        return;
      }

      const songs = Array.isArray(cur.songs) ? cur.songs : [];
      const hasOffering = (cur.offeringPassageLabel && cur.offeringPassageLabel.trim())
        || (Array.isArray(cur.offeringPassageRefs) && cur.offeringPassageRefs.length);
      // 只有備註、沒有經文也沒有詩歌（例：Pastor Greg 特會週）→ 只顯示備註
      const noteOnly = !cur.locked && !songs.length
        && !(cur.messagePassageLabel && cur.messagePassageLabel.trim()) && !hasOffering
        && cur.note;

      host.innerHTML = `
        <div class="group-meeting-view">
          ${buildStrip()}
          ${cur.monthTheme ? `<p class="group-meeting-view__theme">月主題　${escapeHTML(cur.monthTheme)}</p>` : ""}
          <div class="group-meeting-view__weeklabel">
            <strong>${escapeHTML(cur.dateLabel || "")}</strong>
          </div>
          ${cur.locked ? `
            <div class="group-meeting-view__locked">
              <span class="nlc-icon nlc-icon--md" data-icon="lock" aria-hidden="true"></span>
              <p>${escapeHTML(cur.dateLabel || "")} 開放</p>
            </div>` : noteOnly ? `
            <div class="group-meeting-view__note">${escapeHTML(cur.note)}</div>` : `
            <section class="group-meeting-view__block">
              <h4 class="group-meeting-view__h">信息經文</h4>
              <div class="plan-task-list">${passageRow(cur.messageTopic, cur.messagePassageLabel, cur.messagePassageRefs, "message")}</div>
            </section>
            ${hasOffering ? `
            <section class="group-meeting-view__block">
              <h4 class="group-meeting-view__h">奉獻經文</h4>
              <div class="plan-task-list">${passageRow(cur.offeringTopic, cur.offeringPassageLabel, cur.offeringPassageRefs, "offering")}</div>
            </section>` : ""}
            <section class="group-meeting-view__block">
              <h4 class="group-meeting-view__h">敬拜讚美詩歌</h4>
              ${songs.length
                ? `<ul class="group-meeting-view__songs">${songs.map(s => `<li><span class="group-meeting-view__songcode">${escapeHTML(String(s.code || ""))}</span>${escapeHTML(String(s.title || ""))}</li>`).join("")}</ul>`
                : `<p class="group-meeting-view__muted">（無詩歌單）</p>`}
            </section>
            ${cur.note ? `<div class="group-meeting-view__note">${escapeHTML(cur.note)}</div>` : ""}
          `}
        </div>`;

      if (typeof hydrateIcons === "function") hydrateIcons(host);

      // 週切換：保留 strip 捲動位置
      host.querySelectorAll("[data-gm-week]").forEach(btn => btn.addEventListener("click", () => {
        const strip = host.querySelector(".group-meeting-view__strip");
        const sl = strip ? strip.scrollLeft : 0;
        groupMeetingViewerWeekIndex = Number(btn.dataset.gmWeek);
        paint();
        const s2 = host.querySelector(".group-meeting-view__strip");
        if (s2) s2.scrollLeft = sl;
      }));

      // 進入某週後把選中的 chip 捲進可視範圍
      const activeChip = host.querySelector(".gm-week-chip.active");
      if (activeChip && typeof activeChip.scrollIntoView === "function") {
        try { activeChip.scrollIntoView({ block: "nearest", inline: "center" }); } catch (_) {}
      }

      host.querySelectorAll("[data-gm-open]").forEach(item => {
        item.addEventListener("click", () => {
          const kind = item.dataset.gmKind;
          const refs = kind === "offering" ? cur.offeringPassageRefs : cur.messagePassageRefs;
          const label = kind === "offering" ? cur.offeringPassageLabel : cur.messagePassageLabel;
          const first = Array.isArray(refs) && refs[0] && refs[0].book ? refs[0] : null;
          if (first) { passageView = { ref: first, label }; paint(); }
        });
      });
    };

    paint();
  });
}
window.renderGroupMeetingViewer = renderGroupMeetingViewer;

function planGoBack() {
  if (getCurrentPlanRoute() !== PLAN_ROUTE.LIST) setPlanState(PLAN_ROUTE.LIST);
}


// ES Module exports
export function init() {
  if (typeof initPlanControls === 'function') {
    initPlanControls();
  }
}

// Global attachments for compatibility
window.initPlanControls = init;
if (typeof renderPlanView === 'function') {
  window.renderPlanView = renderPlanView;
}
export { renderPlanView, showDiscoverPlans };
// 給 plan-admin.js（管理員專用 chunk）用。
export { renderPresetPlansList, renderJoinedPlansList, renderPlanScheduleTracker };

if (typeof updateStatsView === 'function') {
  window.updateStatsView = updateStatsView;
}
if (typeof renderPlanScheduleTracker === 'function') {
  window.renderPlanScheduleTracker = renderPlanScheduleTracker;
  window.handleRoundCompletion = handleRoundCompletion;
}
if (typeof renderHorizontalDateStrip === 'function') {
  window.renderHorizontalDateStrip = renderHorizontalDateStrip;
}

if (typeof renderPlanRankingView === 'function') {
  window.renderPlanRankingView = renderPlanRankingView;
}
if (typeof renderPlanMembersView === 'function') {
  window.renderPlanMembersView = renderPlanMembersView;
}
if (typeof populateMembersSelector === 'function') {
  window.populateMembersSelector = populateMembersSelector;
}
if (typeof setupCascadingSelectors === 'function') {
  window.setupCascadingSelectors = setupCascadingSelectors;
}
if (typeof renderPlanStatsView === 'function') {
  window.renderPlanStatsView = renderPlanStatsView;
}
if (typeof showPlanStatsModal === 'function') {
  window.showPlanStatsModal = showPlanStatsModal;
}
if (typeof switchStatTab === 'function') {
  window.switchStatTab = switchStatTab;
}
if (typeof updateStatsScopeSelect === 'function') {
  window.updateStatsScopeSelect = updateStatsScopeSelect;
}
if (typeof snapCalendarToMyProgress === 'function') {
  window.snapCalendarToMyProgress = snapCalendarToMyProgress;
}
if (typeof snapCalendarToToday === 'function') {
  window.snapCalendarToToday = snapCalendarToToday;
}

function planToggleGroupProgress() {
  if (typeof window.syncActivePlanContext === "function") window.syncActivePlanContext();
  if (!state.activePlan || !window.PlanPageController) return;
  const nextIndex = window.PlanPageController.currentIndex === PLAN_PAGE.GROUP ? PLAN_PAGE.READING : PLAN_PAGE.GROUP;
  window.PlanPageController.switchPage(nextIndex);
}

window.fetchGroupRankings = fetchGroupRankings;
window.setPlanState = setPlanState;
window.showDiscoverPlans = showDiscoverPlans;
window.planGoBack = planGoBack;
window.planToggleGroupProgress = planToggleGroupProgress;
window.togglePlanDetailSubTab = planToggleGroupProgress;



// ==================== 關心戳一下 Dialog ====================
window.openCareReminderDialog = async function(member) {
  // Remove any existing dialog
  const existingDialog = document.getElementById("care-reminder-dialog-overlay");
  if (existingDialog) existingDialog.remove();

  // 打開對話框時先看看今天是不是已經傳過一則給這個人——有的話直接把內容
  // 帶進來顯示 + 開放編輯，而不是讓人送出後就再也看不到自己寫了什麼，
  // 也不會因為「今天已經傳過」而卡死。團隊入口送出的提醒存進 care_reminders
  // 時，plan_key 是 'reading-team:' + team.id（見 send_reading_team_reminder
  // RPC），跟一般組織階層提醒用的 presetKey/globalPlanId 不是同一組 key，
  // 這裡要分開組，否則團隊入口永遠查不到「今天已經傳過」，使用者在同一天對
  // 同一位隊友再按一次「傳送」時只會撞上後端的每日上限、看起來像是傳送失敗。
  const planKeyForCare = member.readingTeamId
    ? `reading-team:${member.readingTeamId}`
    : (state.activePlan ? (state.activePlan.presetKey || state.activePlan.globalPlanId || "") : "");
  let existingReminder = null;
  if (typeof db !== "undefined" && typeof db.getTodayCareReminderFor === "function") {
    try {
      const existingRes = await db.getTodayCareReminderFor(member.id, planKeyForCare);
      existingReminder = existingRes && existingRes.data ? existingRes.data : null;
    } catch (_) {
      existingReminder = null;
    }
  }
  // A dialog may have been opened again for someone else while this lookup
  // was in flight — bail out rather than showing stale data on top of it.
  if (document.getElementById("care-reminder-dialog-overlay")) return;

  const reasonLabels = {
    behind: "📉 進度落後",
    inactive: "😴 很久沒打卡",
    care: "💛 一般關心",
    encouragement: "🌟 特別鼓勵"
  };

  // Auto-pick a default reason based on member status
  const autoReason = member.isBehind ? "behind" : member.isNotStarted ? "inactive" : "care";

  const defaultMessages = {
    behind: `Hi ${member.name}！這週的讀經進度稍微落後囉，有任何困難都可以跟我說喔，加油！`,
    inactive: `${member.name} 你好，最近都沒看到你打卡讀經，希望一切都好，我們在等你哦！`,
    care: `${member.name} 你好，只是想關心一下你最近的讀經狀況，如果有任何需要都可以找我！`,
    encouragement: `${member.name}！你最近讀經很穩定，真的很棒！繼續加油哦，感謝主！`
  };

  // 今天已經傳過 → 帶入已發送的內容，讓對話框一打開就看得到自己寫了什麼；
  // 對方已讀/已關閉 → 鎖定不能再改，但內容還是看得到。
  const defaultReason = existingReminder ? existingReminder.reason : autoReason;
  const initialMessage = existingReminder ? existingReminder.message : defaultMessages[defaultReason];
  const isLocked = !!(existingReminder && existingReminder.status !== "unread");

  const overlay = document.createElement("div");
  overlay.id = "care-reminder-dialog-overlay";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
    animation: fadeIn 0.2s ease;
  `;

  overlay.innerHTML = `
    <div id="care-reminder-dialog" style="
      background: var(--bg-card, white);
      border-radius: 16px;
      padding: 1.5rem;
      width: 100%; max-width: 440px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      animation: slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);
    ">
      <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:1rem;">
        <span class="nlc-icon nlc-icon--md" data-icon="remind" style="color:var(--color-warning-text, rgb(217,119,6));" aria-hidden="true"></span>
        <h3 style="margin:0; font-size:1rem; font-weight:700; color:var(--text-primary);">關心提醒 ・ ${escapeHTML(member.name)}</h3>
      </div>

      <p style="margin:0 0 1rem; font-size:0.875rem; color:var(--text-muted);">
        進度：<strong style="color:${member.statusColor}">${member.statusStr}</strong>
        &nbsp;・&nbsp;完成：${member.completed} 天
      </p>

      ${existingReminder ? `<p id="care-existing-note" style="margin:0 0 1rem; font-size:0.875rem; color:var(--color-brand); background:var(--color-brand-subtle); border-radius:8px; padding:0.5rem 0.75rem;">
        今天已經傳過一則給${escapeHTML(member.name)}${isLocked ? '，對方已經看過，內容鎖定無法修改' : '，以下是當時的內容，可以直接修改後更新'}
      </p>` : ""}

      <label style="display:block; font-size:0.875rem; font-weight:600; color:var(--text-secondary); margin-bottom:0.4rem;">
        關心原因
      </label>
      <div id="care-reason-btns" style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
        ${Object.entries(reasonLabels).map(([key, label]) => `
          <button type="button"
            data-reason="${key}"
            ${isLocked ? "disabled" : ""}
            class="care-reason-btn${key === defaultReason ? ' active' : ''}"
            style="
              padding: 0.35rem 0.75rem; border-radius: 20px; font-size: 0.875rem; font-weight:500;
              border: 1.5px solid ${key === defaultReason ? 'var(--color-warning-text, rgb(217,119,6))' : 'var(--border-card)'};
              background: ${key === defaultReason ? 'var(--color-warning-muted,rgba(251,191,36,0.15))' : 'var(--bg-input)'};
              color: ${key === defaultReason ? 'var(--color-warning-text, rgb(217,119,6))' : 'var(--text-secondary)'};
              cursor: ${isLocked ? "not-allowed" : "pointer"}; opacity: ${isLocked ? "0.6" : "1"}; transition: all 0.15s;
            ">
            ${label}
          </button>
        `).join("")}
      </div>

      <label for="care-msg-input" style="display:block; font-size:0.875rem; font-weight:600; color:var(--text-secondary); margin-bottom:0.4rem;">
        訊息內容
      </label>
      <textarea id="care-msg-input"
        rows="4"
        maxlength="300"
        placeholder="輸入關心訊息..."
        ${isLocked ? "readonly" : ""}
        style="
          width:100%; box-sizing:border-box;
          padding: 0.65rem 0.75rem;
          border-radius: 10px;
          border: 1.5px solid var(--border-card);
          background: var(--bg-input);
          color: var(--text-primary);
          resize: vertical;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s;
          margin-bottom: 0.25rem;
          ${isLocked ? "opacity: 0.7; cursor: not-allowed;" : ""}
        "
      >${escapeHTML(initialMessage)}</textarea>
      <div id="care-char-count" style="text-align:right; font-size:0.875rem; color:var(--text-muted); margin-bottom:1rem;">
        ${initialMessage.length} / 300
      </div>

      <div id="care-dialog-error" style="display:none; color:var(--color-danger); font-size:0.875rem; margin-bottom:0.75rem; padding:0.5rem 0.75rem; background:var(--color-danger-muted,rgba(239,68,68,0.1)); border-radius:8px;"></div>

      <div style="display:flex; gap:0.75rem; justify-content:flex-end;">
        <button id="care-cancel-btn" type="button" style="
          padding:0.55rem 1.2rem; border-radius:10px; font-size:0.88rem; font-weight:600;
          border:1.5px solid var(--border-card); background:var(--bg-input);
          color:var(--text-secondary); cursor:pointer;
        ">${isLocked ? "關閉" : "取消"}</button>
        ${isLocked ? "" : `<button id="care-send-btn" type="button" style="
          padding:0.55rem 1.4rem; border-radius:10px; font-size:0.88rem; font-weight:600;
          border:none; background:var(--color-warning-text, rgb(217,119,6));
          color:white; cursor:pointer; display:flex; align-items:center; gap:0.4rem;
          transition: opacity 0.15s;
        ">
          <span class="nlc-icon nlc-icon--sm" data-icon="send" aria-hidden="true"></span>
          <span id="care-send-btn-label">${existingReminder ? "更新關心內容" : "傳送關心"}</span>
        </button>`}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  if (typeof hydrateIcons === "function") hydrateIcons(overlay);

  // Wire up reason buttons
  let selectedReason = defaultReason;
  const reasonBtns = overlay.querySelectorAll(".care-reason-btn");
  const msgInput = overlay.querySelector("#care-msg-input");
  const charCount = overlay.querySelector("#care-char-count");

  reasonBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      selectedReason = btn.dataset.reason;
      reasonBtns.forEach(b => {
        const isActive = b.dataset.reason === selectedReason;
        b.style.borderColor = isActive ? "var(--color-warning-text, rgb(217,119,6))" : "var(--border-card)";
        b.style.background = isActive ? "var(--color-warning-muted,rgba(251,191,36,0.15))" : "var(--bg-input)";
        b.style.color = isActive ? "var(--color-warning-text, rgb(217,119,6))" : "var(--text-secondary)";
      });
      msgInput.value = defaultMessages[selectedReason];
      charCount.textContent = `${msgInput.value.length} / 300`;
    });
  });

  msgInput.addEventListener("input", () => {
    charCount.textContent = `${msgInput.value.length} / 300`;
  });

  // Close on overlay click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector("#care-cancel-btn").addEventListener("click", () => overlay.remove());

  // Send / update — tracked locally so a second click in the same dialog
  // session (after a first successful send) is labeled/announced as an
  // edit instead of a brand new send.
  let alreadySentToday = !!existingReminder;
  const sendBtn = overlay.querySelector("#care-send-btn");
  if (sendBtn) sendBtn.addEventListener("click", async () => {
    const message = msgInput.value.trim();
    const errorEl = overlay.querySelector("#care-dialog-error");

    errorEl.style.display = "none";

    if (!message) {
      errorEl.textContent = "請輸入關心訊息！";
      errorEl.style.display = "block";
      return;
    }
    if (message.length > 300) {
      errorEl.textContent = "訊息不能超過 300 字！";
      errorEl.style.display = "block";
      return;
    }

    const wasEdit = alreadySentToday;
    const idleLabel = wasEdit ? "更新關心內容" : "傳送關心";
    sendBtn.disabled = true;
    sendBtn.style.opacity = "0.6";
    sendBtn.innerHTML = `<span class="nlc-icon nlc-icon--sm" data-icon="loader" aria-hidden="true"></span> ${wasEdit ? "更新中…" : "傳送中…"}`;
    if (typeof hydrateIcons === "function") hydrateIcons(sendBtn);

    try {
      const result = member.readingTeamId
        ? await db.sendReadingTeamReminder({
            teamId: member.readingTeamId,
            recipientId: member.id,
            globalPlanId: member.readingTeamPlanId,
            reason: selectedReason,
            message: message
          })
        : await db.sendCareReminder({
            recipientId: member.id,
            reason: selectedReason,
            message: message,
            planKey: planKeyForCare
          });

      if (result.error) throw result.error;

      alreadySentToday = true;
      if (typeof showToast === "function") {
        showToast(wasEdit ? `已更新給 ${member.name} 的關心內容 💛` : `已傳送關心提醒給 ${member.name} 💛`);
      }
      // Deliberately do NOT close the dialog — the whole point is that the
      // text just sent stays visible right here, still editable, instead of
      // disappearing the moment it's sent.
      sendBtn.disabled = false;
      sendBtn.style.opacity = "1";
      sendBtn.innerHTML = `<span class="nlc-icon nlc-icon--sm" data-icon="send" aria-hidden="true"></span> <span id="care-send-btn-label">更新關心內容</span>`;
      if (typeof hydrateIcons === "function") hydrateIcons(sendBtn);
    } catch (err) {
      console.error("sendCareReminder failed:", err);
      sendBtn.disabled = false;
      sendBtn.style.opacity = "1";
      sendBtn.innerHTML = `<span class="nlc-icon nlc-icon--sm" data-icon="send" aria-hidden="true"></span> <span id="care-send-btn-label">${idleLabel}</span>`;
      if (typeof hydrateIcons === "function") hydrateIcons(sendBtn);

      errorEl.textContent = `傳送失敗：${err.message || "請稍後再試"}`;
      errorEl.style.display = "block";
    }
  });

  // Focus textarea
  setTimeout(() => { if (msgInput) msgInput.focus(); }, 100);
};
