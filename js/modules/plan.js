// Combined plan and stats module

// Reading plans tab view controller

window._currentStatsTab = 'personal';
window._statsTabScope = null;

// Asynchronous Request & Click Debounce state trackers
let lastTrackerRequestId = 0;
let dateClickDebounceTimer = null;
let viewMode = 'calendar'; // Today reading always shows calendar + chapter list

const PLAN_ROUTE = Object.freeze({
  LIST: "LIST",
  DETAIL: "DETAIL",
  GROUP: "GROUP"
});

window.currentPlanViewState = window.currentPlanViewState || PLAN_ROUTE.LIST;

function getPlanDetailTabs() {
  return document.querySelector(".plan-detail-tabs");
}

function getPlanGroupNodes() {
  return [
    getPlanDetailTabs(),
    document.getElementById("subview-plan-stats"),
    document.getElementById("subview-plan-ranking"),
    document.getElementById("subview-plan-members")
  ].filter(Boolean);
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
    document.getElementById("subview-plan-ranking"),
    document.getElementById("subview-plan-members")
  ].filter(Boolean).forEach(node => {
    if (node.parentElement !== shell.legacyDetail) shell.legacyDetail.appendChild(node);
  });
}

function moveGroupNodesToGroup(shell = ensurePlanRouteShell()) {
  if (!shell || !shell.groupView) return;
  getPlanGroupNodes().forEach(node => {
    if (node.parentElement !== shell.groupView) shell.groupView.appendChild(node);
  });
}

function forceHidden(el, hidden) {
  if (!el) return;
  el.classList.toggle("hidden", hidden);
  el.hidden = hidden;
  if (!hidden) el.style.display = "";
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
    planRoot.insertBefore(listView, legacyList);
    listView.appendChild(legacyList);
  }

  let detailView = document.getElementById("plan-detail-view");
  if (!detailView) {
    detailView = document.createElement("div");
    detailView.id = "plan-detail-view";
    detailView.className = "hidden";
    planRoot.insertBefore(detailView, legacyDetail);
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
    strip.innerHTML = `<div class="plan-detail-tab-strip__scroller" role="tablist"><button id="plan-primary-tab-progress" class="plan-detail-tab-btn active" type="button" role="tab" aria-selected="true" data-plan-primary-view="progress">進度</button><button id="plan-primary-tab-members" class="plan-detail-tab-btn" type="button" role="tab" aria-selected="false" data-plan-primary-view="members">組員狀況</button><button id="plan-primary-tab-stats" class="plan-detail-tab-btn" type="button" role="tab" aria-selected="false" data-plan-primary-view="stats">團體統計</button><button id="plan-primary-tab-ranking" class="plan-detail-tab-btn" type="button" role="tab" aria-selected="false" data-plan-primary-view="ranking">排名</button><div id="tab-indicator" aria-hidden="true"></div></div>`;
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
  const level = document.getElementById("subview-plan-level");
  const stats = document.getElementById("subview-plan-stats");
  const ranking = document.getElementById("subview-plan-ranking");
  const members = document.getElementById("subview-plan-members");
  if (page0 && schedule && schedule.parentElement !== page0) page0.appendChild(schedule);
  if (page0 && level && level.parentElement !== page0) page0.appendChild(level);
  [stats, ranking, members].filter(Boolean).forEach(node => { if (page1 && node.parentElement !== page1) page1.appendChild(node); });
  return { shell, detail, strip, windowEl, wrapper, page0, page1, schedule, level, stats, ranking, members };
}

const PLAN_PRIMARY_VIEW = Object.freeze({
  PROGRESS: "progress",
  MEMBERS: "members",
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

const GROUP_SUBVIEW = Object.freeze({ STATS: "stats", RANKING: "ranking", MEMBERS: "members" });

async function showPlanGroupSubview(view = GROUP_SUBVIEW.STATS) {
  const allowedViews = Object.values(GROUP_SUBVIEW);
  let target = allowedViews.includes(view) ? view : GROUP_SUBVIEW.STATS;

  const tabs = getPlanDetailTabs();
  const tabMap = {
    [GROUP_SUBVIEW.STATS]: document.getElementById("tab-plan-stats"),
    [GROUP_SUBVIEW.RANKING]: document.getElementById("tab-plan-ranking"),
    [GROUP_SUBVIEW.MEMBERS]: document.getElementById("tab-plan-members")
  };
  const viewMap = {
    [GROUP_SUBVIEW.STATS]: document.getElementById("subview-plan-stats"),
    [GROUP_SUBVIEW.RANKING]: document.getElementById("subview-plan-ranking"),
    [GROUP_SUBVIEW.MEMBERS]: document.getElementById("subview-plan-members")
  };

  if (tabs) forceHidden(tabs, true);
  const legacyScheduleTab = document.getElementById("tab-plan-schedule");
  if (legacyScheduleTab) {
    legacyScheduleTab.classList.remove("active");
    legacyScheduleTab.setAttribute("aria-selected", "false");
  }
  Object.entries(tabMap).forEach(([key, button]) => {
    if (!button) return;
    forceHidden(button, true);
    button.classList.toggle("active", key === target);
    button.setAttribute("aria-selected", key === target ? "true" : "false");
  });
  Object.entries(viewMap).forEach(([key, panel]) => forceHidden(panel, key !== target));

  window.PlanPageController.groupSubview = target;
  updatePlanPrimaryTabs(target);
  if (target === GROUP_SUBVIEW.STATS) {
    await window.switchStatTab(canUseAdvancedGroupStats() ? "admin" : "personal");
  } else if (target === GROUP_SUBVIEW.RANKING) {
    await renderPlanRankingView();
  } else if (target === GROUP_SUBVIEW.MEMBERS) {
    await renderPlanMembersView();
  }
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
        const buttons = [...shell.strip.querySelectorAll("[data-plan-primary-view]")];
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
        "tab-plan-members": GROUP_SUBVIEW.MEMBERS
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
    const targetView = Object.values(PLAN_PRIMARY_VIEW).includes(view) ? view : PLAN_PRIMARY_VIEW.PROGRESS;
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
      forceHidden(shell.level, true);
      state.inlineReader.active = false;
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
  async openSettingsPage() {
    if (!state.activePlan) return;
    const shell = this.ensureShell();
    if (!shell) return;

    this.currentIndex = PLAN_PAGE.READING;
    state.planDetailOpen = true;
    state.planActiveSubTab = "settings";
    window.currentPlanViewState = PLAN_ROUTE.DETAIL;

    forceHidden(shell.strip, true);
    forceHidden(shell.windowEl, true);
    forceHidden(shell.schedule, true);
    forceHidden(shell.stats, true);
    forceHidden(shell.ranking, true);
    forceHidden(shell.members, true);

    const level = document.getElementById("subview-plan-level");
    if (level && level.parentElement !== shell.detail) shell.detail.appendChild(level);
    if (level) level.classList.add("is-full-page-settings");
    forceHidden(level, false);
    renderPlanLevelEditor();

    if (typeof appRouter !== "undefined" && typeof appRouter.updateNavigationChrome === "function") {
      appRouter.updateNavigationChrome();
    }
  },

  async closeSettingsPage() {
    const shell = this.ensureShell();
    const level = document.getElementById("subview-plan-level");
    if (level) level.classList.remove("is-full-page-settings");
    if (shell?.page0 && level && level.parentElement !== shell.page0) shell.page0.appendChild(level);
    forceHidden(level, true);
    forceHidden(shell?.strip, false);
    forceHidden(shell?.windowEl, false);
    await this.switchPage(PLAN_PAGE.READING);
  },

  async openSettingsModal() {
    await this.openSettingsPage();
  },

  closeSettingsModal() {
    this.closeSettingsPage();
  }
};

function ensurePlanViewModeToggle() {
  const toggle = document.getElementById("plan-view-mode-toggle");
  if (toggle) toggle.remove();
}

// Reactive state propagation audit
window.addEventListener("planDataChanged", (e) => {
  console.log('🏗️ [系統審計] 收到資料變更事件通知，強制重新渲染組件，資料版本:', e.detail.dataVersion);
  renderHorizontalDateStrip();
  renderPlanScheduleTracker(true);
});

function canUseAdvancedGroupStats() {
  const allowedRoles = ["admin", "senior_pastor", "great_zone_leader", "zone_leader", "group_leader"];
  const currentRole = (state.currentUser && state.currentUser.role) || "member";
  const realRole = state.realRole || "member";
  return allowedRoles.includes(currentRole) || allowedRoles.includes(realRole);
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
  if (adminScopeBar) {
    adminScopeBar.classList.toggle("hidden", tab !== 'admin');
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

function initPlanControls() {
  ensurePlanRouteShell();
  renderPresetPlansList();

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
  if (backBtn) {
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
    optionsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const flexibleScheduleMenuButton = document.getElementById("edit-flexible-plan-schedule-btn");
      if (flexibleScheduleMenuButton) flexibleScheduleMenuButton.style.display = "";
      dropdown.classList.toggle("hidden");
    });
    document.addEventListener("click", () => {
      dropdown.classList.add("hidden");
    });
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
      if (!confirm("確定要放棄目前的讀經計畫嗎？已讀章節紀錄仍會保留。")) {
        return;
      }
      await db.leavePlan(state.activePlan.id, state.activePlan.presetKey);
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
    await showPlanGroupSubview(GROUP_SUBVIEW.MEMBERS);
  });
  // Category Pills filters inside Plan List Page
  const listPills = document.querySelectorAll("#plan-list-status-pills .pill-btn");
  listPills.forEach(pill => {
    pill.addEventListener("click", () => {
      listPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      const filter = pill.getAttribute("data-filter");

      const joinedContainer = document.getElementById("joined-plans-list-container");
      const presetContainer = document.getElementById("preset-plans-list-container");
      const sidebarCard = document.getElementById("plan-sidebar-info-card");

      if (filter === "mine") {
        if (joinedContainer) joinedContainer.classList.remove("hidden");
        if (presetContainer) presetContainer.classList.add("hidden");
        if (sidebarCard) sidebarCard.classList.remove("hidden");
        renderJoinedPlansList();
      } else if (filter === "saved") {
        if (joinedContainer) joinedContainer.classList.add("hidden");
        if (presetContainer) presetContainer.classList.remove("hidden");
        if (sidebarCard) sidebarCard.classList.remove("hidden");
        renderPresetPlansList();
      } else {
        if (joinedContainer) joinedContainer.classList.remove("hidden");
        if (presetContainer) presetContainer.classList.add("hidden");
        if (sidebarCard) sidebarCard.classList.add("hidden");
        renderJoinedPlansList();
      }
    });
  });

  // Action button: Start Reading Today
  const startReadingBtn = document.getElementById("btn-start-reading-today");
  if (startReadingBtn) {
    startReadingBtn.addEventListener("click", () => {
      if (!state.activePlan || !state.selectedPlanDay) return;
      const day = state.activePlan.days.find(d => d.dayNum === state.selectedPlanDay);
      if (!day || !day.chapters || day.chapters.length === 0) return;

      const firstUnread = day.chapters.find(ch => !ch.isRead) || day.chapters[0];
      window.openPlanInlineReader(firstUnread.book, firstUnread.chapter, state.selectedPlanDay, firstUnread.round || 1);
    });
  }

  // Initialize Global Plans Admin Controls
  if (typeof initAdminPlanManagement === 'function') {
    initAdminPlanManagement();
  }
}





async function renderPlanView() {
  try {
    if (state.activePlan && isPlanHidden(state.activePlan) && !canManageHiddenPlans()) {
      const nextVisiblePlan = (state.activePlans || []).find(plan => !isPlanHidden(plan));
      state.activePlan = nextVisiblePlan || null;
      if (state.activePlan) localStorage.setItem("selected_plan_key", state.activePlan.presetKey || state.activePlan.id || "");
      else localStorage.removeItem("selected_plan_key");
    }

    renderJoinedPlansList();
    renderPresetPlansList();

    ensurePlanRouteShell();

    if (state.activePlan && state.planDetailOpen) {
      const groupViews = [GROUP_SUBVIEW.MEMBERS, GROUP_SUBVIEW.STATS, GROUP_SUBVIEW.RANKING, "group"];
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

    // Admin simulation check
    const isRealAdmin = !state.isSupabaseMode || (state.realRole === "admin" || state.realRole === "senior_pastor");
    const isSimulatedAdmin = state.currentUser && (state.currentUser.role === "admin" || state.currentUser.role === "senior_pastor");
    const adminCard = document.getElementById("admin-plan-card");
    if (adminCard) {
      if (isRealAdmin && isSimulatedAdmin) {
        adminCard.classList.remove("hidden");
      } else {
        adminCard.classList.add("hidden");
      }
    }

    if (isRealAdmin && isSimulatedAdmin && typeof renderAdminPlanManagement === 'function') {
      renderAdminPlanManagement();
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
    || plan.id === window.CHURCH_CAMPAIGN_ID
    || plan.globalPlanId === window.CHURCH_CAMPAIGN_ID
  );
  const label = isCampaign ? "66卷" : escapeHTML(String(plan && plan.name || "讀經").slice(0, 2));
  return `<div class="plan-cover-thumbnail" style="width: 72px; height: 72px; border-radius: 12px; background: ${bg}; display: flex; align-items: center; justify-content: center; color: var(--color-black); font-weight: 500; font-size: 0.95rem; flex-shrink: 0; box-shadow: var(--shadow-sm);">${label}</div>`;
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

    if (plansToRender.length === 0) {
      if (filter === "mine") {
        container.innerHTML = `
          <div class="empty-state" style="text-align: center; padding: 3rem 0;">
            <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-weight: 500;">您目前沒有加入任何讀經計畫。</p>
            <p style="font-size: 0.88rem; color: var(--text-muted);">${(window.APP_COPY && window.APP_COPY.plan.clickFindPlans) || "請點擊頂部「找計畫」瀏覽並加入！"}</p>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="empty-state" style="text-align: center; padding: 3rem 0; width: 100%;">
            <p style="color: var(--text-secondary); margin-bottom: 1rem; font-weight: 500;">目前沒有已過期的計畫</p>
            <p style="font-size: 0.82rem; color: var(--text-muted);">前往「找計畫」加入新挑戰吧！</p>
          </div>
        `;
      }
      return;
    }

    plansToRender.forEach(plan => {
      const card = document.createElement("div");
      card.className = "joined-plan-item-card";
      card.style = `
        background: var(--bg-card);
        border: 1px solid var(--border-card);
        border-radius: 16px;
        padding: 1rem;
        display: flex;
        align-items: center;
        gap: 1rem;
        cursor: pointer;
        transition: all 0.2s ease;
      `;
      card.onclick = async () => {
        if (isPlanExpired(plan)) {
          showToast("此計畫已過期，無法再進入進度閱讀。");
          return;
        }
        state.activePlan = plan;
        state.planDetailOpen = true;
        state.planActiveSubTab = "today";
        window.currentPlanViewState = PLAN_ROUTE.DETAIL;
        if (typeof window.syncActivePlanContext === 'function') window.syncActivePlanContext(plan);
        state.selectedPlanDay = null; // reset to first uncompleted day
        localStorage.setItem("selected_plan_key", plan.presetKey || "");
        if (typeof window.setPlanState === 'function') {
          await window.setPlanState(PLAN_ROUTE.DETAIL);
        } else {
          renderPlanView();
        }
      };

      const progress = plan.progress || 0;
      const currentRound = plan.currentRound || 1;
      const isFlexiblePlan = plan.isFixed === false || plan.is_fixed === false;
      const flexibleScheduleSummary = isFlexiblePlan ? formatFlexibleScheduleSummary(plan) : "";

      if (filter === "completed") {
        // Expired plan: show status label instead of progress bar
        const isCompleted = (currentRound > 1) || (progress === 100);
        const statusText = isCompleted ? "已完成" : "未完成";
        const statusColor = isCompleted ? "var(--color-success-foreground)" : "var(--color-danger)";

        card.innerHTML = `
          ${getPlanCoverHtml(plan)}
          <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 0.25rem; min-width: 0;">
            <h4 style="margin: 0; font-size: 1.05rem; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${plan.name}</h4>
            <div style="font-size: 0.78rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.3rem;">
              <span class="nlc-icon" data-icon="calendarThirty" aria-hidden="true"></span> <span>${plan.startDate} ~ ${plan.endDate}</span>
            </div>
            <div style="font-size: 0.82rem; font-weight: 600; color: ${statusColor}; margin-top: 0.25rem; display: flex; align-items: center; gap: 0.25rem;">
              狀態：${statusText}
            </div>
          </div>
        `;
      } else {
        // Normal active plan: show progress bar
        const progressText = currentRound > 1
          ? `已完成第 ${currentRound - 1} 遍 👑<br>第 ${currentRound} 遍：已讀 ${progress}% (${plan.completedChapters} / ${plan.currentRoundTotalChapters || plan.totalChapters} 章)`
          : `已讀 ${progress}% (${plan.completedChapters} / ${plan.currentRoundTotalChapters || plan.totalChapters} 章)`;

        card.innerHTML = `
          ${getPlanCoverHtml(plan)}
          <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 0.25rem; min-width: 0;">
            <h4 style="margin: 0; font-size: 1.05rem; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${plan.name}</h4>
            <div style="font-size: 0.78rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.3rem;">
              <span class="nlc-icon" data-icon="calendarThirty" aria-hidden="true"></span> <span>${plan.startDate} ~ ${plan.endDate}</span>
            </div>
            <div class="plan-progress-wrapper plan-progress-wrapper--compact">
              <div class="plan-progress-bar" style="width: ${progress}%;"></div>
            </div>
            <div style="font-size: 0.76rem; font-weight: 500; color: var(--text-secondary); margin-top: 0.1rem; line-height: 1.35;">
              ${progressText}
            </div>
            ${isFlexiblePlan ? `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:.65rem;margin-top:.35rem;">
                <span style="font-size:.74rem;color:var(--text-muted);">${escapeHTML(flexibleScheduleSummary)}</span>
                <button type="button" class="edit-flexible-schedule-btn btn-secondary"
                  style="padding:.38rem .58rem;font-size:.72rem;white-space:nowrap;">調整每週安排</button>
              </div>
            ` : ""}
          </div>
        `;
      }

      const scheduleButton = card.querySelector(".edit-flexible-schedule-btn");
      if (scheduleButton) {
        scheduleButton.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          const scheduleSettings = await openFlexibleScheduleDialog(plan, { editing: true });
          if (!scheduleSettings) return;
          scheduleButton.disabled = true;
          const result = await db.updateFlexiblePlanSchedule(plan, scheduleSettings);
          scheduleButton.disabled = false;
          if (!result || !result.success) {
            showToast("儲存每週安排失敗：" + ((result && result.error && result.error.message) || "請稍後再試"));
            return;
          }
          showToast("每週讀經安排已更新，章節已重新分配。");
          renderJoinedPlansList();
        });
      }

      container.appendChild(card);
    });
  } catch (err) {
    console.error("Critical error inside renderJoinedPlansList:", err);
  }
}


function openPlanDetailsDialog(plan) {
  if (!plan) return;
  const existing = document.getElementById("plan-details-dialog");
  if (existing) existing.remove();

  const isFlexible = plan.isFixed === false || plan.is_fixed === false;
  const books = plan.target_books || plan.targetBooks || [];
  const scheduleText = isFlexible
    ? formatFlexibleScheduleSummary(plan)
    : (plan.startDate + " ～ " + plan.endDate);
  const stageCount = Array.isArray(plan.campaignStages) ? plan.campaignStages.length : 0;
  const overlay = document.createElement("div");
  overlay.id = "plan-details-dialog";
  overlay.className = "modal-overlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:1rem;";
  overlay.innerHTML = `
    <div class="glass-card" role="dialog" aria-modal="true" aria-labelledby="plan-details-title"
      style="width:min(440px,100%);height:auto!important;max-height:80vh;overflow:auto;padding:1.5rem;background:var(--bg-card);border:1px solid var(--border-card);box-shadow:var(--shadow-lg);">
      <h3 id="plan-details-title" style="margin:0 0 1rem;font-size:1.15rem;font-weight:500;color:var(--text-primary);">${escapeHTML(plan.name || "讀經計畫")}</h3>
      ${plan.description ? `<p style="margin:0 0 1rem;font-size:.84rem;line-height:1.6;color:var(--text-secondary);">${escapeHTML(plan.description)}</p>` : ""}
      <dl style="display:grid;grid-template-columns:auto 1fr;gap:.65rem .9rem;margin:0;font-size:.82rem;">
        <dt style="color:var(--text-muted);">計畫類型</dt>
        <dd style="margin:0;color:var(--text-primary);">${isFlexible ? "非固定日期" : "固定日期"}</dd>
        <dt style="color:var(--text-muted);">日期／安排</dt>
        <dd style="margin:0;color:var(--text-primary);">${escapeHTML(scheduleText)}</dd>
        ${stageCount ? `<dt style="color:var(--text-muted);">獎勵階段</dt><dd style="margin:0;color:var(--text-primary);">${stageCount} 個階段</dd>` : ""}
        <dt style="color:var(--text-muted);">閱讀經卷</dt>
        <dd style="margin:0;color:var(--text-primary);line-height:1.55;">${books.length ? escapeHTML(books.join("、")) : "依計畫排程"}</dd>
      </dl>
      <div style="display:flex;justify-content:flex-end;margin-top:1.35rem;">
        <button type="button" id="plan-details-close" class="btn-primary">關閉</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("#plan-details-close").addEventListener("click", close);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) close();
  });
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
    const overlay = document.createElement("div");
    overlay.id = "flexible-schedule-dialog";
    overlay.className = "modal-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:1rem;";
    overlay.innerHTML = `
      <div class="glass-card" role="dialog" aria-modal="true" aria-labelledby="flexible-schedule-title"
        style="width:min(420px,100%);height:auto!important;padding:1.5rem;background:var(--bg-card);border:1px solid var(--border-card);box-shadow:var(--shadow-lg);">
        <h3 id="flexible-schedule-title" style="margin:0 0 .35rem;font-size:1.15rem;font-weight:500;color:var(--text-primary);">\u8a2d\u5b9a\u6bcf\u9031\u8b80\u7d93\u5b89\u6392</h3>
        <p style="margin:0 0 1.25rem;font-size:.82rem;line-height:1.55;color:var(--text-secondary);">
          ${escapeHTML((plan && plan.name) || "\u975e\u56fa\u5b9a\u65e5\u671f\u8a08\u756b")}\u6703\u5f9e\u4eca\u5929\u958b\u59cb\uff0c\u7ae0\u7bc0\u53ea\u6703\u5206\u914d\u5728\u60a8\u9078\u64c7\u7684\u8b80\u7d93\u65e5\u3002
        </p>
        <label for="flexible-reading-days" style="display:block;margin-bottom:.45rem;font-size:.85rem;font-weight:500;color:var(--text-primary);">\u4e00\u9031\u60f3\u8b80\u7d93\u5e7e\u5929</label>
        <select id="flexible-reading-days" class="form-control" style="width:100%;margin-bottom:1.1rem;">
          ${[1, 2, 3, 4, 5, 6, 7].map(days => `<option value="${days}" ${days === initialReadingDays ? "selected" : ""}>\u6bcf\u9031 ${days} \u5929</option>`).join("")}
        </select>
        <fieldset style="border:0;padding:0;margin:0;">
          <legend style="margin-bottom:.55rem;font-size:.85rem;font-weight:500;color:var(--text-primary);">\u56fa\u5b9a\u4f11\u606f\u661f\u671f</legend>
          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem;">
            ${weekdayLabels.map((label, day) => `
              <label style="display:flex;align-items:center;gap:.35rem;padding:.55rem .45rem;border:1px solid var(--border-card);border-radius:10px;cursor:pointer;font-size:.78rem;color:var(--text-primary);">
                <input class="schedule-weekday-checkbox" type="checkbox" value="${day}" ${initialRestDays.includes(day) ? "checked" : ""}>
                <span>${label}</span>
              </label>
            `).join("")}
          </div>
        </fieldset>
        <p id="flexible-schedule-summary" style="margin:.85rem 0 0;font-size:.78rem;color:var(--text-muted);"></p>
        <p id="flexible-schedule-error" role="alert" style="display:none;margin:.55rem 0 0;font-size:.78rem;color:var(--color-danger);"></p>
        <div style="display:flex;justify-content:flex-end;gap:.65rem;margin-top:1.25rem;">
          <button type="button" id="flexible-schedule-cancel" class="btn-secondary">\u53d6\u6d88</button>
          <button type="button" id="flexible-schedule-confirm" class="btn-primary">${isEditing ? "儲存安排" : "加入計畫"}</button>
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
      const hasReadingDay = Array.from({ length: durationDays }, (_, offset) => {
        const date = new Date(today);
        date.setDate(today.getDate() + offset);
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
    daysSelect.focus();
  });
}

function renderPresetPlansList() {
  const container = document.getElementById("preset-plans-list");
  if (!container) return;
  container.innerHTML = "";

  const legacyCategoryIdPrefix = "00000000-0000-0000-a000-";
  const isLegacyChoicePlan = plan =>
    String(plan && (plan.id || plan.globalPlanId || "")).startsWith(legacyCategoryIdPrefix)
    || String(plan && plan.presetKey || "").startsWith("m_")
    || ["q1", "q2", "q3", "q4"].includes(String(plan && plan.presetKey || ""));

  const sourcePlans = state.globalPlans && state.globalPlans.length > 0
    ? state.globalPlans
    : Object.entries(CHURCH_PLAN_PRESETS).map(([key, plan]) => ({
        ...plan,
        id: plan.id || key,
        presetKey: key
      }));

  const joinedKeys = new Set((state.activePlans || []).flatMap(plan => [
    plan.id,
    plan.globalPlanId,
    plan.presetKey,
    plan.name
  ].filter(Boolean).map(String)));

  const visiblePlans = sourcePlans.filter(plan => {
    if (!plan || isLegacyChoicePlan(plan)) return false;
    if (isPlanHidden(plan) && !canManageHiddenPlans()) return false;
    return ![plan.id, plan.globalPlanId, plan.presetKey, plan.name]
      .filter(Boolean)
      .some(value => joinedKeys.has(String(value)));
  });

  if (visiblePlans.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="text-align:center;padding:2.5rem 1rem;">
        <p style="color:var(--text-secondary);margin:0;">目前沒有其他可加入的讀經計畫。</p>
      </div>
    `;
    return;
  }

  const getDurationLabel = (startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "日期待管理員設定";
    const days = Math.max(1, Math.ceil((end - start) / 86400000) + 1);
    return days >= 365 ? `${startDate} ～ ${endDate}` : `共 ${days} 天`;
  };

  visiblePlans.forEach(plan => {
    const key = plan.id || plan.presetKey;
    const isCampaign = plan.planKind === "church_campaign"
      || key === window.CHURCH_CAMPAIGN_ID
      || key === window.CHURCH_CAMPAIGN_PRESET_KEY;
    const isFixed = isCampaign || (plan.isFixed !== false && plan.is_fixed !== false);
    const scheduleLabel = isCampaign
      ? "全教會統一進度・八輪十階段"
      : (isFixed ? getDurationLabel(plan.startDate, plan.endDate) : `彈性開始・${getDurationLabel(plan.startDate, plan.endDate)}`);
    const description = isCampaign
      ? "加入一次即可跟隨 2026 年 8 月至 2029 年 8 月的完整讀經進度；小組依會員基本資料自動分隊。"
      : (plan.description || "");

    const card = document.createElement("div");
    card.className = "joined-plan-item-card";
    card.style = "background:var(--bg-card);border:1px solid var(--border-card);border-radius:16px;padding:1rem;display:flex;align-items:center;gap:1rem;cursor:pointer;transition:all .2s ease;";
    card.innerHTML = `
      ${getPlanCoverHtml(plan)}
      <div style="flex-grow:1;display:flex;flex-direction:column;gap:.3rem;min-width:0;">
        <h4 style="margin:0;font-size:1.05rem;font-weight:500;color:var(--text-primary);">${escapeHTML(plan.name)}</h4>
        <div style="font-size:.78rem;color:var(--text-muted);display:flex;align-items:center;gap:.3rem;">
          <span class="nlc-icon" data-icon="calendarThirty" aria-hidden="true"></span>
          <span>${escapeHTML(scheduleLabel)}</span>
        </div>
        ${description ? `<p style="margin:.15rem 0 0;font-size:.76rem;line-height:1.45;color:var(--text-secondary);">${escapeHTML(description)}</p>` : ""}
        <div style="font-size:.76rem;font-weight:500;color:var(--primary-color);margin-top:.15rem;">+ 加入計畫</div>
      </div>
    `;

    card.onclick = async () => {
      if (!isFixed) {
        const scheduleSettings = await openFlexibleScheduleDialog(plan);
        if (!scheduleSettings) return;
        await db.joinPresetPlan(key, scheduleSettings);
        return;
      }
      const message = isCampaign
        ? "確定加入全教會聖經速讀計畫嗎？加入後不需要每月重新選擇。"
        : `確定加入「${plan.name}」嗎？`;
      if (confirm(message)) await db.joinPresetPlan(key);
    };

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

function countCompletedPlanDaysForRound(plan, round) {
  if (!plan || !plan.days) return 0;
  return plan.days.filter(day => isPlanDayCompletedForRound(day, round)).length;
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

function getPlanProgressStatus(plan = state.activePlan) {
  if (typeof getPlanProgressStatusFromDesignSystem === "function") {
    return getPlanProgressStatusFromDesignSystem(plan);
  }
  return { label: "進度一致", badgeClass: "stat-badge--brand", diff: 0 };
}

function renderHorizontalDateStrip() {
  console.log('[系統審計] 進入資料讀寫，當前操作類型：渲染日曆格子 (無縫滑動視窗優化)', '資料版本:', state.dataVersion);

  const container = document.getElementById("plan-date-carousel");
  if (!container || !state.activePlan) return;

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

      const totalChapters = day.chapters ? day.chapters.length : 0;
      let completedChapters = 0;

      if (totalChapters > 0) {
        day.chapters.forEach(ch => {
          const currentRound = state.activePlan.currentRound || 1;
          const taskRound = ch.round || currentRound;
          const isRead = Boolean(ch["isReadR" + taskRound] || ch.isRead);

          if (isRead) completedChapters++;
        });
      }

      const isDayCompleted = totalChapters > 0 && completedChapters === totalChapters;
      const isPartiallyCompleted = totalChapters > 0 && completedChapters > 0 && completedChapters < totalChapters;

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

        const clickedDate = `${cell.year}/${String(cell.month).padStart(2, '0')}/${String(cell.dayOfMonth).padStart(2, '0')}`;
        console.log('📅 [日曆切換防護] 已成功鎖定日期：', clickedDate, '準備渲染對應章節');

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

async function renderPlanScheduleTracker(skipCarouselUpdate = false, signal = null) {
  console.log('🏗️ [系統審計] 進入資料讀寫，當前操作類型：渲染任務章節', '資料版本:', state.dataVersion);

  const container = document.getElementById("plan-tasks-list");
  if (!container || !state.activePlan) return;

  const currentRequestId = ++lastTrackerRequestId;

  container.innerHTML = "";

  // Set default selected day if not set
  if (!state.selectedPlanDay) {
    const nextReadingDay = getNextReadingPlanDay(state.activePlan);
    state.selectedPlanDay = nextReadingDay ? nextReadingDay.dayNum : 1;
  }

  // 🛡️ 嚴禁在此處呼叫 renderPlanScheduleView() 或 renderHorizontalDateStrip()：
  // 此函式職責單一：只負責刷新底部章節任務清單（plan-tasks-list）。
  // 日曆重繪由外層呼叫方統一管理，禁止在任務渲染函式內循環觸發日曆重繪。

  const selectedDay = state.activePlan.days.find(d => d.dayNum === state.selectedPlanDay);
  if (!selectedDay) {
    container.innerHTML = "";
    return;
  }

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
    console.log('⏳ [日期切換防護] 偵測到 AbortController 取消，已自動忽略/取消舊日期的非同步請求');
    return;
  }
  // Validate request pointer after asynchronous block to prevent race condition overrides
  if (currentRequestId !== lastTrackerRequestId) {
    console.log('⏳ [日期切換防護] 偵測到快速切換，已自動忽略/取消舊日期的非同步請求，當前鎖定日期：', state.selectedPlanDay);
    return;
  }

  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  const started = isPlanStarted(state.activePlan) || isAdmin;

  // Render status pill for day
  const statusPill = document.getElementById("plan-day-status-pill");
  if (statusPill) {
    if (!selectedDay.chapters || selectedDay.chapters.length === 0) {
      statusPill.textContent = (window.APP_COPY && window.APP_COPY.plan.restDayPill) || "休息日";
      statusPill.className = "stat-badge stat-badge--brand";
    } else {
      const allDone = selectedDay.chapters.every(ch => {
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
    const isDayCompleted = selectedDay.chapters && selectedDay.chapters.length > 0 && selectedDay.chapters.every(ch => {
      const currentRound = state.activePlan.currentRound || 1;
      const taskRound = ch.round || currentRound;
      return Boolean(ch["isReadR" + taskRound] || ch.isRead);
    });

    if (isDayCompleted) {
      activeCard.classList.add("completed");
      const progressContainer = activeCard.querySelector('.micro-progress-container');
      if (progressContainer) progressContainer.remove();
    } else {
      activeCard.classList.remove("completed");
      const totalCh = selectedDay.chapters.length;
      let completedCh = 0;
      selectedDay.chapters.forEach(ch => {
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
  if (!selectedDay.chapters || selectedDay.chapters.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem; background: var(--bg-card); border: 1px dashed var(--border-card); border-radius: 14px; color: var(--text-secondary); font-weight: 500; width: 100%;">
        ${(window.APP_COPY && window.APP_COPY.plan.restDayBanner) || "今天是補讀或靈修休息日，好好親近神吧"}
      </div>
    `;
    return;
  }

  const currentRound = state.activePlan.currentRound || 1;

  if (state.activePlan.progress >= 100 && !isPlanExpired(state.activePlan)) {
    const upgradeBanner = document.createElement("div");
    upgradeBanner.className = "glass-card congrats-inline-banner";
    const nextRound = currentRound + 1;
    upgradeBanner.innerHTML = `
      <div style="font-size: 2.2rem; margin-bottom: 0.2rem; animation: pulseMedal 2s infinite ease-in-out;">🏆</div>
      <div style="font-weight: 600; color: var(--text-primary); font-size: 1.05rem;">您已完成了此遍的讀經進度！</div>
      <div style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.4;">恭喜獲得紀念勳章。確認要開始下一遍讀經了嗎？</div>
      <button onclick="window.triggerPlanUpgradeFlow()" class="primary-btn congrats-banner-btn">🏆 確認升級下一 Level (第 ${nextRound} 遍)</button>
    `;
    container.appendChild(upgradeBanner);
  }

  selectedDay.chapters.forEach(ch => {
    const taskItem = document.createElement("div");
    taskItem.className = "plan-task-item";

    const taskRound = ch.round || currentRound;
    const { cssClass, content } = getChapterCheckboxState(ch, taskRound);
    const roundLabelHtml = taskRound >= 2
      ? `<div class="task-round-label round-${taskRound}">第${taskRound}遍</div>`
      : "";

    taskItem.setAttribute("role", "button");
    taskItem.setAttribute("tabindex", "0");
    taskItem.innerHTML = `
      <div class="task-checkbox ${cssClass}"
           data-is-current-read="${ch.isRead ? 'true' : 'false'}"
           onclick="event.stopPropagation(); window.toggleYouVersionChapter(this, '${ch.book}', ${ch.chapter}, ${ch.round || currentRound})">
        ${content}
      </div>
      <div class="task-title">
        ${ch.book} ${ch.chapter}章
      </div>
      ${roundLabelHtml}
      <div class="task-arrow">
        ${typeof renderIcon === "function" ? renderIcon("chevronRight", { size: "sm", className: "nlc-icon" }) : ""}
      </div>
    `;
    const openChapter = () => window.openPlanChapterInReader(ch.book, ch.chapter, state.selectedPlanDay, ch.round || currentRound);
    taskItem.addEventListener("click", openChapter);
    taskItem.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openChapter();
      }
    });
    container.appendChild(taskItem);
  });
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

function getRoundBadge(ch, currentRound) {
  if (currentRound >= 2) {
    const prevRound = currentRound - 1;
    const prevCompleted = Boolean(ch["isReadR" + prevRound]);
    const currCompleted = Boolean(ch["isReadR" + currentRound]);
    if (prevCompleted && !currCompleted) {
      if (currentRound === 2) return '✓第1遍';
      if (currentRound === 3) return '✓✓已讀';
      return `✓第${prevRound}遍`;
    }
  }
  return '';
}

window.toggleYouVersionChapter = function (checkboxEl, book, chapter, taskRound = null) {
  console.log('🏗️ [系統審計] 進入資料讀寫，當前操作類型：切換章節已讀狀態', '資料版本:', state.dataVersion);

  const isCurrentlyRead = checkboxEl.dataset.isCurrentRead === 'true';
  const willBeChecked = !isCurrentlyRead;
  const currentRound = taskRound || (state.activePlan ? (state.activePlan.currentRound || 1) : 1);

  // 限制：如果計畫的開始時間尚未到達，不允許勾選已讀，只能進去查看進度
  if (state.activePlan && state.activePlan.startDate) {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const parts = state.activePlan.startDate.split("-");
    const planStart = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    
    if (todayStart < planStart) {
      showToast("此計畫尚未開始，目前僅供預覽，無法勾選已讀。");
      if (checkboxEl) {
        checkboxEl.checked = isCurrentlyRead;
      }
      return;
    }
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
    showToast("此計畫已過期，無法再修改打卡紀錄。");
    if (checkboxEl) {
      checkboxEl.checked = isCurrentlyRead;
    }
    return;
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

  console.log('✅ [進度同步完成] 成功標記已讀，已強制驅動畫面更新');

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

function renderPlanLevelEditor() {
  // Manual progress adjustments have been disabled.
}

window.showPlanLevelModal = async function () {
  // Disabled.
};

function readChapterDirect(bookName, chapter) {
  const book = BIBLE_BOOKS.find(b => b.name === bookName);
  if (book) {
    state.readerState.bookId = book.id;
    state.readerState.chapter = chapter;

    document.getElementById("reader-testament-select").value = "all";
    populateBookSelector("all");
    populateChapterSelector();
    saveReaderPreferences();

    appRouter.switchTab("reader-view");
  }
}

function updatePlanCheckboxState(key, isChecked) {
  // Safe empty fallback since we redraw tasks on update
  if (state.activePlan) {
    renderPlanScheduleTracker();
  }
}

async function checkPlanSchedule(plan) {
  // Since manual settings and downgrades are removed, and levels only go up automatically,
  // we do not perform lag/lead checks or automatic downgrades.
  return;
}

function showCongratsModal(plan, round) {
  const oldModal = document.getElementById("congrats-modal");
  if (oldModal) oldModal.remove();

  const modal = document.createElement("div");
  modal.id = "congrats-modal";
  modal.className = "congrats-modal-overlay";

  const nextRound = round + 1;
  const svgOpen = '<s' + 'vg viewBox="0 0 100 100" width="100%" height="100%">';
  const svgClose = '</s' + 'vg>';

  modal.innerHTML = `
    <div class="congrats-modal-box">
      <!-- Confetti Background Effects -->
      <div class="congrats-confetti-container">
        <div class="congrats-confetti-p1"></div>
        <div class="congrats-confetti-p2"></div>
        <div class="congrats-confetti-p3"></div>
        <div class="congrats-confetti-p4"></div>
      </div>

      <!-- Medal Icon -->
      <div class="congrats-medal-container">
        ${svgOpen}
          <!-- Ribbons -->
          <path d="M35 55 L25 85 L45 85 Z" class="congrats-svg-ribbon-left" />
          <path d="M65 55 L75 85 L55 85 Z" class="congrats-svg-ribbon-right" />
          <!-- Outer Glow / Ring -->
          <circle cx="50" cy="45" r="28" class="congrats-svg-glow-ring" />
          <!-- Gold Circle -->
          <circle cx="50" cy="45" r="24" class="congrats-svg-gold-circle" />
          <!-- Star in center -->
          <polygon points="50,28 55,38 67,39 58,47 61,59 50,52 39,59 42,47 33,39 45,38" class="congrats-svg-star" />
          <!-- Inner circle overlay -->
          <circle cx="50" cy="45" r="16" class="congrats-svg-inner-circle" />
          
          <defs>
            <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" class="congrats-stop-1" />
              <stop offset="50%" class="congrats-stop-2" />
              <stop offset="100%" class="congrats-stop-3" />
            </linearGradient>
          </defs>
        ${svgClose}
      </div>

      <h3 class="congrats-title">🎉 恭喜完成！</h3>
      <p class="congrats-desc-primary">您已讀完第 ${round} 遍挑戰</p>
      <p class="congrats-desc-secondary">獲得「第 ${round} 遍讀經紀念勳章」</p>

      <div class="congrats-actions">
        <button id="btn-modal-upgrade" onclick="window.triggerPlanUpgradeFlow()" class="congrats-upgrade-btn">🏆 確認升級第 ${nextRound} 遍</button>
        <button id="btn-modal-later" class="congrats-later-btn">稍後再說</button>
      </div>
    </div>
  `;

  if (!document.getElementById("congrats-anim-style")) {
    const style = document.createElement("style");
    style.id = "congrats-anim-style";
    style.textContent = `
      @keyframes float {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        50% { transform: translateY(-10px) rotate(10deg); }
      }
      @keyframes pulseMedal {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(modal);

  document.getElementById("btn-modal-later").onclick = () => modal.remove();
}

window.triggerPlanUpgradeFlow = async function() {
  const plan = state.activePlan;
  if (!plan) return;

  if (isPlanExpired(plan)) {
    showToast("計畫時間已過，無法再進行升級。");
    const modal = document.getElementById("congrats-modal");
    if (modal) modal.remove();
    return;
  }

  const currentRound = plan.currentRound || 1;
  const nextRound = currentRound + 1;

  // 記錄此類別完成的遍數，並觸發勳章解鎖檢查
  const pk = plan.presetKey || "";
  const planParts = pk.split("_");
  if (planParts.length >= 4) {
    const catKey = planParts[3]; // e.g. cat1
    const prevMax = parseInt(localStorage.getItem(`cat_completed_rounds_${catKey}`) || "0");
    if (currentRound > prevMax) {
      localStorage.setItem(`cat_completed_rounds_${catKey}`, currentRound.toString());
    }
    
    // 解鎖或更新該類別勳章
    const badgeId = `badge_${catKey}`;
    const unlockedBadges = JSON.parse(localStorage.getItem("unlocked_badges") || "[]");
    if (!unlockedBadges.includes(badgeId)) {
      unlockedBadges.push(badgeId);
      localStorage.setItem("unlocked_badges", JSON.stringify(unlockedBadges));
      const unlockDateKey = `date_unlocked_${badgeId}_lvl_1`; // round 1 unlock date
      if (!localStorage.getItem(unlockDateKey)) {
        localStorage.setItem(unlockDateKey, `${new Date().getFullYear()}年${new Date().getMonth() + 1}月${new Date().getDate()}日`);
      }
    }
    
    // 記錄該遍完成的解鎖日期（供勳章詳細頁的時間軸展示）
    const roundUnlockDateKey = `date_unlocked_${badgeId}_lvl_${currentRound}`;
    if (!localStorage.getItem(roundUnlockDateKey)) {
      localStorage.setItem(roundUnlockDateKey, `${new Date().getFullYear()}年${new Date().getMonth() + 1}月${new Date().getDate()}日`);
    }
  }

  if (typeof checkAchievements === "function") {
    checkAchievements().catch(console.error);
  }
  let nextLevel = "level" + nextRound;
  if (nextRound === 2) nextLevel = "breakthrough";
  else if (nextRound === 3) nextLevel = "super";

  loader.show("升級計畫中...");
  try {
    plan.currentRound = nextRound;
    plan.wasDowngraded = false;
    plan.downgradeLockedUntil = null;
    plan.lastUpgradedRound = currentRound;

    rebuildPlanScheduleForLevel(plan, nextLevel);
    await persistPlanLevelState(plan);

    if (state.isSupabaseMode && state.supabase && plan.id) {
      await state.supabase.from("reading_plans")
        .update({ current_round: plan.currentRound, level: nextLevel, was_downgraded: false, downgrade_locked_until: null })
        .eq("id", plan.id);
    } else if (!state.isSupabaseMode) {
      localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans || []));
    }

    calculatePlanProgress();

    const modal = document.getElementById("congrats-modal");
    if (modal) modal.remove();

    showToast(`恭喜！成功升級到第 ${nextRound} 遍並開始讀經。`);

    renderPlanView();
    window.dispatchEvent(new CustomEvent("app:dataRefresh", { detail: { scope: "plan" } }));
  } catch (err) {
    console.error("Failed to upgrade plan:", err);
    showToast("升級失敗，請重試");
  } finally {
    loader.hide();
  }
};

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

function initAdminPlanManagement() {
  const addBtn = document.getElementById("admin-add-plan-btn");
  const cancelBtn = document.getElementById("admin-cancel-plan-btn");
  const saveBtn = document.getElementById("admin-save-plan-btn");
  const formContainer = document.getElementById("admin-plan-form-container");

  if (!addBtn || !cancelBtn || !saveBtn || !formContainer) return;

  // Render Bible books selection grids
  const oldGrid = document.getElementById("admin-old-books-grid");
  const newGrid = document.getElementById("admin-new-books-grid");

  if (oldGrid && newGrid) {
    oldGrid.innerHTML = "";
    newGrid.innerHTML = "";
    BIBLE_BOOKS.forEach(book => {
      const label = document.createElement("label");
      label.style = `
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.72rem;
        cursor: pointer;
        padding: 0.2rem 0.3rem;
        border-radius: 4px;
        background: white;
        border: 1px solid var(--border-card);
        user-select: none;
      `;
      label.innerHTML = `
        <input type="checkbox" class="admin-book-checkbox" value="${book.name}" style="margin: 0; cursor: pointer;">
        ${book.name}
      `;
      if (book.section === "old") {
        oldGrid.appendChild(label);
      } else {
        newGrid.appendChild(label);
      }
    });
  }

  // Bind quick select buttons
  const btnSelectAll = document.getElementById("admin-select-all-books");
  if (btnSelectAll) {
    btnSelectAll.onclick = () => {
      document.querySelectorAll(".admin-book-checkbox").forEach(cb => cb.checked = true);
    };
  }
  const btnClear = document.getElementById("admin-clear-books");
  if (btnClear) {
    btnClear.onclick = () => {
      document.querySelectorAll(".admin-book-checkbox").forEach(cb => cb.checked = false);
    };
  }
  const btnSelectOld = document.getElementById("admin-select-old-books");
  if (btnSelectOld) {
    btnSelectOld.onclick = () => {
      BIBLE_BOOKS.forEach(book => {
        const cb = document.querySelector(`.admin-book-checkbox[value="${book.name}"]`);
        if (cb) cb.checked = book.section === "old";
      });
    };
  }
  const btnSelectNew = document.getElementById("admin-select-new-books");
  if (btnSelectNew) {
    btnSelectNew.onclick = () => {
      BIBLE_BOOKS.forEach(book => {
        const cb = document.querySelector(`.admin-book-checkbox[value="${book.name}"]`);
        if (cb) cb.checked = book.section === "new";
      });
    };
  }

  // Bind schedule time type radios change
  const typeRadios = document.getElementsByName("admin-plan-time-type");
  const dateInputs = document.getElementById("admin-plan-date-inputs");
  const durationContainer = document.getElementById("admin-plan-duration-container");

  const toggleTimeTypeFields = (type) => {
    if (type === "flexible") {
      if (dateInputs) dateInputs.style.display = "none";
      if (durationContainer) durationContainer.style.display = "block";
    } else {
      if (dateInputs) dateInputs.style.display = "grid";
      if (durationContainer) durationContainer.style.display = "none";
    }
  };

  typeRadios.forEach(radio => {
    radio.onchange = (e) => toggleTimeTypeFields(e.target.value);
  });

  // Toggle Form
  addBtn.onclick = () => {
    document.getElementById("admin-plan-form-title").textContent = "新增讀經計畫";
    document.getElementById("admin-edit-plan-id").value = "";
    document.getElementById("admin-plan-name").value = "";
    document.getElementById("admin-plan-start-date").value = "";
    document.getElementById("admin-plan-end-date").value = "";
    const durationInput = document.getElementById("admin-plan-duration-days");
    if (durationInput) durationInput.value = "";

    // Set fixed as default
    const fixedRadio = document.querySelector('input[name="admin-plan-time-type"][value="fixed"]');
    if (fixedRadio) fixedRadio.checked = true;
    toggleTimeTypeFields("fixed");

    document.querySelectorAll(".admin-book-checkbox").forEach(cb => cb.checked = false);
    formContainer.classList.remove("hidden");
  };

  cancelBtn.onclick = () => {
    formContainer.classList.add("hidden");
  };

  // Save Plan
  saveBtn.onclick = async () => {
    const id = document.getElementById("admin-edit-plan-id").value;
    const name = document.getElementById("admin-plan-name").value.trim();

    // Determine time type selection
    const checkedRadio = document.querySelector('input[name="admin-plan-time-type"]:checked');
    const isFixed = checkedRadio ? checkedRadio.value === "fixed" : true;

    let startDate = "";
    let endDate = "";

    if (isFixed) {
      startDate = document.getElementById("admin-plan-start-date").value;
      endDate = document.getElementById("admin-plan-end-date").value;

      if (!startDate || !endDate) {
        alert("請選擇計畫開始與結束日期！");
        return;
      }
      if (new Date(startDate) > new Date(endDate)) {
        alert("開始日期不可晚於結束日期！");
        return;
      }
    } else {
      const durationVal = document.getElementById("admin-plan-duration-days").value;
      const durationDays = parseInt(durationVal);
      if (!durationVal || isNaN(durationDays) || durationDays <= 0) {
        alert("請輸入有效的計畫總天數！");
        return;
      }

      // Generate start/end dates for the template starting today to satisfy database constraints
      const getLocalDateString = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };

      const today = new Date();
      startDate = getLocalDateString(today);
      const end = new Date(today);
      end.setDate(today.getDate() + durationDays - 1);
      endDate = getLocalDateString(end);
    }

    const checkedBooks = [];
    document.querySelectorAll(".admin-book-checkbox:checked").forEach(cb => {
      checkedBooks.push(cb.value);
    });

    if (!name) {
      alert("請輸入計畫名稱！");
      return;
    }
    if (checkedBooks.length === 0) {
      alert("請至少選取一個聖經書卷！");
      return;
    }

    loader.show("正在儲存計畫...");
    const success = await db.saveGlobalPlan({
      id: id || null,
      name,
      startDate,
      endDate,
      books: checkedBooks,
      isFixed: isFixed
    });
    loader.hide();

    if (success) {
      if (typeof showToast === "function") {
        showToast("計畫儲存成功！已自動同步更新所有使用者的挑戰時間。");
      } else {
        alert("計畫儲存成功！");
      }

      // 💡 關鍵修復：儲存成功後，重新載入用戶的活動計畫資料，使主頁挑戰卡片的進度與時間即時重新計算
      if (typeof db !== "undefined" && db.loadUserData) {
        await db.loadUserData();
      }
      if (typeof updateDashboardView === "function") {
        updateDashboardView();
      }
      if (typeof renderPlanScheduleTracker === "function") {
        renderPlanScheduleTracker(true);
      }

      formContainer.classList.add("hidden");
      renderAdminPlanManagement();
      if (typeof renderPresetPlansList === 'function') {
        renderPresetPlansList();
      }
    }
  };
}

async function renderAdminPlanManagement() {
  const tableBody = document.getElementById("admin-plans-table-body");
  if (!tableBody) return;

  tableBody.innerHTML = typeof ComponentSkeletonLoader !== "undefined"
    ? `<tr><td colspan="3">${ComponentSkeletonLoader.getHtml("table-rows", { count: 3, cols: 3 })}</td></tr>`
    : "";

  try {
    const plans = state.globalPlans || [];
    tableBody.innerHTML = "";

    if (plans.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">目前無任何計畫，請點擊上方「新增計畫」建立</td></tr>`;
      return;
    }

    plans.forEach(plan => {
      const tr = document.createElement("tr");

      const bookListText = plan.books.join(", ");
      const bookCount = plan.books.length;
      const hidden = isPlanHidden(plan);
      const isFixed = plan.isFixed !== false && plan.is_fixed !== false;
      const isCampaign = plan.planKind === "church_campaign" || plan.id === window.CHURCH_CAMPAIGN_ID;

      let timeColHtml = "";
      if (isFixed) {
        timeColHtml = `
          <span style="font-size: 0.72rem; font-weight: 500; display: block; white-space: nowrap;"><span class="nlc-icon" data-icon="calendarThirty" aria-hidden="true"></span> ${plan.startDate}</span>
          <span style="font-size: 0.72rem; font-weight: 500; display: block; white-space: nowrap; margin-left: 0.6rem; color: var(--text-muted);">~ ${plan.endDate}</span>
        `;
      } else {
        const duration = Math.ceil((new Date(plan.endDate) - new Date(plan.startDate)) / (1000 * 60 * 60 * 24)) + 1;
        timeColHtml = `
          <span style="font-size: 0.72rem; font-weight: 500; display: block; white-space: nowrap;"><span class="nlc-icon" data-icon="calendarThirty" aria-hidden="true"></span> 彈性時間</span>
          <span style="font-size: 0.72rem; font-weight: 500; display: block; white-space: nowrap; margin-left: 0.6rem; color: var(--text-muted);">共 ${duration} 天</span>
        `;
      }

      tr.innerHTML = `
        <td>
          <strong style="display: block; margin-bottom: 0.15rem; font-size: 0.82rem; word-break: break-all;">${escapeHTML(plan.name)}${hidden ? ' <span class="text-warning" style="font-size:0.68rem; font-weight: 500;">已隱藏</span>' : ''}</strong>
          <span title="${escapeHTML(bookListText)}" style="font-size: 0.7rem; color: var(--text-muted); cursor: help; text-decoration: underline dashed; text-underline-offset: 2px;">
            共 ${bookCount} 卷書卷
          </span>
        </td>
        <td>
          ${timeColHtml}
        </td>
        <td style="text-align: center; vertical-align: middle;">
          <div style="display: flex; flex-direction: column; gap: 0.25rem; align-items: center; justify-content: center;">
            <button class="primary-btn admin-campaign-rules-btn" style="font-size:0.68rem;padding:0.25rem 0.45rem;height:auto;">編輯規則</button>
            <button class="primary-btn admin-edit-plan-btn" style="font-size: 0.68rem; padding: 0.2rem 0.4rem; min-width: 42px; text-align: center; height: auto; cursor: pointer;">編輯</button>
            <button class="danger-btn admin-delete-plan-btn" style="font-size: 0.68rem; padding: 0.2rem 0.4rem; min-width: 42px; text-align: center; height: auto; cursor: pointer;">刪除</button>
          </div>
        </td>
      `;

      const campaignRulesBtn = tr.querySelector(".admin-campaign-rules-btn");
      if (isCampaign) {
        campaignRulesBtn.onclick = () => window.openCampaignRuleEditor(plan);
        tr.querySelector(".admin-edit-plan-btn").style.display = "none";
        tr.querySelector(".admin-delete-plan-btn").style.display = "none";
      } else {
        campaignRulesBtn.remove();
      }

      // Bind edit event
      tr.querySelector(".admin-edit-plan-btn").onclick = () => {
        document.getElementById("admin-plan-form-title").textContent = "編輯讀經計畫";
        document.getElementById("admin-edit-plan-id").value = plan.id;
        document.getElementById("admin-plan-name").value = plan.name;

        // Set radio button and fields visibility
        const fixedRadio = document.querySelector('input[name="admin-plan-time-type"][value="fixed"]');
        const flexRadio = document.querySelector('input[name="admin-plan-time-type"][value="flexible"]');
        const dateInputs = document.getElementById("admin-plan-date-inputs");
        const durationContainer = document.getElementById("admin-plan-duration-container");

        if (isFixed) {
          if (fixedRadio) fixedRadio.checked = true;
          document.getElementById("admin-plan-start-date").value = plan.startDate;
          document.getElementById("admin-plan-end-date").value = plan.endDate;
          document.getElementById("admin-plan-duration-days").value = "";
          if (dateInputs) dateInputs.style.display = "grid";
          if (durationContainer) durationContainer.style.display = "none";
        } else {
          if (flexRadio) flexRadio.checked = true;
          const duration = Math.ceil((new Date(plan.endDate) - new Date(plan.startDate)) / (1000 * 60 * 60 * 24)) + 1;
          document.getElementById("admin-plan-duration-days").value = duration;
          document.getElementById("admin-plan-start-date").value = "";
          document.getElementById("admin-plan-end-date").value = "";
          if (dateInputs) dateInputs.style.display = "none";
          if (durationContainer) durationContainer.style.display = "block";
        }

        // Check corresponding books
        document.querySelectorAll(".admin-book-checkbox").forEach(cb => {
          cb.checked = plan.books.includes(cb.value);
        });

        document.getElementById("admin-plan-form-container").classList.remove("hidden");
        document.getElementById("admin-plan-form-container").scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };

      const toggleHiddenBtn = tr.querySelector(".admin-toggle-hidden-plan-btn");
      if (toggleHiddenBtn) {
        toggleHiddenBtn.onclick = async () => {
          loader.show(hidden ? "正在恢復計畫..." : "正在隱藏計畫...");
          const success = await db.setGlobalPlanHidden(plan, !hidden);
          loader.hide();
          if (success) {
            showToast(hidden ? "計畫已恢復顯示。" : "計畫已隱藏，一般使用者不會看到。");
            renderAdminPlanManagement();
            if (typeof renderPresetPlansList === 'function') renderPresetPlansList();
            if (typeof renderJoinedPlansList === 'function') renderJoinedPlansList();
          }
        };
      }

      // Bind delete event
      tr.querySelector(".admin-delete-plan-btn").onclick = async () => {
        if (confirm(`您確定要刪除 ${plan.name} 嗎？這將使其他會友無法再從列表「加入」此計畫，但已加入該計畫之會友仍可照常閱讀及打卡。`)) {
          loader.show("刪除計畫中...");
          const success = await db.deleteGlobalPlan(plan.id);
          loader.hide();
          if (success) {
            alert("計畫已成功刪除！");
            renderAdminPlanManagement();
            if (typeof renderPresetPlansList === 'function') {
              renderPresetPlansList();
            }
          }
        }
      };

      tableBody.appendChild(tr);
    });

  } catch (err) {
    console.error("Failed to render admin plans:", err);
    tableBody.innerHTML = `<tr><td colspan="4" class="text-danger" style="text-align: center;">載入計畫失敗: ${err.message || err}</td></tr>`;
  }
}



window.openPlanChapterInReader = function (bookName, chapter, dayNum, round = null) {
  if (state.activePlan && isPlanExpired(state.activePlan)) {
    showToast("此計畫已過期，無法再進入進度閱讀。");
    return;
  }
  console.log('📖 [Debug] 已點選章節，進入全滿版沉浸閱讀模式');
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
  autoMarked: false
};

window.openPlanInlineReader = function (bookName, chapter, dayNum, round = null) {
  if (state.activePlan && isPlanExpired(state.activePlan)) {
    showToast("此計畫已過期，無法再進入進度閱讀。");
    return;
  }
  if (!state.activePlan) return;
  const day = state.activePlan.days.find(d => d.dayNum === dayNum);
  if (!day || !day.chapters || day.chapters.length === 0) return;

  state.inlineReader.active = true;
  state.inlineReader.dayNum = dayNum;
  state.inlineReader.chaptersList = day.chapters;
  state.inlineReader.currentIndex = day.chapters.findIndex(ch =>
    ch.book === bookName &&
    Number(ch.chapter) === Number(chapter) &&
    (round == null || Number(ch.round || 1) === Number(round))
  );
  if (state.inlineReader.currentIndex === -1) state.inlineReader.currentIndex = 0;

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

  renderInlineScriptureText();
};

window.closePlanInlineReader = function () {
  state.inlineReader.active = false;

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

  // Re-render checklist to show checked updates
  renderPlanScheduleTracker(true);
};

async function renderInlineScriptureText() {
  const currentCh = state.inlineReader.chaptersList[state.inlineReader.currentIndex];
  if (!currentCh) return;

  state.inlineReader.autoMarked = false;

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
          verseDiv.innerHTML = `<span class="verse-num" style="font-weight: 500; color: var(--primary-color); margin-right: 0.5rem; font-size: 0.85rem;">${v.verse}</span><span class="verse-text" style="font-size: 1.05rem; line-height: 1.8;">${v.text}</span>`;
          container.appendChild(verseDiv);
        });
      } catch (err) {
        container.innerHTML = `<div class="text-danger" style="text-align: center; padding: 2rem;">載入經文失敗: ${err.message || err}</div>`;
      }
    }
  }

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

  // Scroll window to top
  window.scrollTo({ top: 0, behavior: 'auto' });
}

window.navigateInlineChapter = function (direction) {
  const newIndex = state.inlineReader.currentIndex + direction;
  if (newIndex >= 0 && newIndex < state.inlineReader.chaptersList.length) {
    state.inlineReader.currentIndex = newIndex;
    renderInlineScriptureText();
  }
};

// Window scroll listener for inline reader automatic check-in has been removed to prevent screen jumping and layout shift.


// ==================== PERSONAL STATS & HEATMAP & ACHIEVEMENTS ====================
// ==================== PERSONAL STATS & HEATMAP & ACHIEVEMENTS ====================
// ==================== CASCADING SELECTORS HELPER ====================
function setupCascadingSelectors(regionId, zoneId, groupId, masterId) {
  const regionSelect = document.getElementById(regionId);
  const zoneSelect = document.getElementById(zoneId);
  const groupSelect = document.getElementById(groupId);
  const masterSelect = document.getElementById(masterId);

  if (!regionSelect || !zoneSelect || !groupSelect || !masterSelect) return;

  const userKey = state.currentUser ? `${state.currentUser.name}_${state.currentUser.role}` : "anonymous";
  if (regionSelect.dataset.populatedFor === userKey) return;

  regionSelect.dataset.populated = "true";
  regionSelect.dataset.populatedFor = userKey;

  // Reset disabled states for fresh population
  regionSelect.disabled = false;
  zoneSelect.disabled = false;
  groupSelect.disabled = false;

  const userRole = (state.currentUser && state.currentUser.role) || "member";
  const isAdmin = userRole === "admin" || userRole === "senior_pastor";
  const isGreatZoneLeader = userRole === "great_zone_leader";
  const isZoneLeader = userRole === "zone_leader";
  const isGroupLeader = userRole === "group_leader";

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
    const userGreatRegion = state.currentUser.great_region || "";
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
  } else if (isGreatZoneLeader) {
    regionSelect.options.add(new Option(`全部大區 (${myRegions.join(",")})`, ""));
    myRegions.forEach(r => regionSelect.options.add(new Option(`大區：${r}`, `region:${r}`)));
  } else {
    const userReg = state.currentUser.great_region || "";
    regionSelect.options.add(new Option(userReg ? `大區：${userReg}` : "大區", ""));
    regionSelect.disabled = true;
  }

  // Update Master Select Value
  function updateMasterValue(isInitialCall = false) {
    let finalVal = "all";
    if (isGroupLeader) {
      const userGroup = state.currentUser.small_group || "";
      finalVal = userGroup ? `group:${userGroup}` : "all_groups";
    } else if (isZoneLeader) {
      const userZone = state.currentUser.pastoral_zone || "";
      const selectedGrp = groupSelect.value;
      finalVal = selectedGrp ? `group:${selectedGrp}` : (userZone ? `zone:${userZone}` : "all_zones");
    } else if (isGreatZoneLeader) {
      const selectedGrp = groupSelect.value;
      const selectedZone = zoneSelect.value;
      const selectedReg = regionSelect.value;
      if (selectedGrp) finalVal = `group:${selectedGrp}`;
      else if (selectedZone) finalVal = `zone:${selectedZone}`;
      else if (selectedReg) finalVal = selectedReg;
      else finalVal = "all_great_region";
    } else if (isAdmin) {
      const selectedGrp = groupSelect.value;
      const selectedZone = zoneSelect.value;
      const selectedReg = regionSelect.value;
      if (selectedGrp) finalVal = `group:${selectedGrp}`;
      else if (selectedZone) finalVal = `zone:${selectedZone}`;
      else if (selectedReg) finalVal = selectedReg;
      else finalVal = "all";
    }

    masterSelect.innerHTML = "";
    masterSelect.options.add(new Option(finalVal, finalVal));
    masterSelect.value = finalVal;

    if (!isInitialCall) {
      masterSelect.dispatchEvent(new Event("change"));
    }
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
      }
    } else if (isZoneLeader) {
      const userZone = state.currentUser.pastoral_zone || "";
      const myZones = userZone.split(",").map(s => s.trim()).filter(Boolean);
      if (myZones.length > 1) {
        zoneSelect.options.add(new Option(`全部牧區 (${myZones.join(",")})`, ""));
        myZones.forEach(z => zoneSelect.options.add(new Option(`牧區：${z}`, z)));
      } else {
        zoneSelect.options.add(new Option(`牧區：${userZone}`, userZone));
        zoneSelect.disabled = true;
      }
    } else {
      const userZone = state.currentUser.pastoral_zone || "";
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
      }
    } else if (isZoneLeader) {
      const userZone = state.currentUser.pastoral_zone || "";
      const myZones = userZone.split(",").map(s => s.trim()).filter(Boolean);
      const activeZone = zoneVal || myZones[0];
      if (!activeZone) {
        groupSelect.options.add(new Option("-- 請先選擇牧區 --", ""));
        groupSelect.disabled = true;
      } else {
        groupSelect.options.add(new Option("全部小組", ""));
        const groups = getGroupsForZone(activeZone);
        groups.sort().forEach(g => groupSelect.options.add(new Option(`小組：${g}`, g)));
      }
    } else if (isGroupLeader) {
      const userGroup = state.currentUser.small_group || "";
      const myGroups = userGroup.split(",").map(s => s.trim()).filter(Boolean);
      if (myGroups.length > 1) {
        groupSelect.options.add(new Option(`全部小組 (${myGroups.join(",")})`, ""));
        myGroups.forEach(g => groupSelect.options.add(new Option(`小組：${g}`, g)));
      } else {
        groupSelect.options.add(new Option(`小組：${userGroup}`, userGroup));
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
  populateGroups();

  // Set initial master select value mapping without triggering render loop
  updateMasterValue(true);
}

// ==================== STATS SELECTOR POPULATOR ====================
function populateStatsSelector() {
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
// ==================== MEMBERS SELECTOR POPULATOR ====================
function populateMembersSelector() {
  setupCascadingSelectors("members-admin-region-select", "members-admin-zone-select", "members-admin-group-select", "members-zone-selector");

  const membersZoneSelector = document.getElementById("members-zone-selector");
  if (membersZoneSelector && !membersZoneSelector.dataset.listenerInitialized) {
    membersZoneSelector.dataset.listenerInitialized = "true";
    membersZoneSelector.addEventListener("change", async () => {
      await renderPlanMembersView();
    });
  }
}

async function renderPlanStatsView() {
  if (typeof window.syncActivePlanContext === 'function') window.syncActivePlanContext();
  if (!state.activePlan) return;

  // Make sure stats selector is populated
  populateStatsSelector();

  const personalSec = document.getElementById("stats-personal-section");
  const groupSec = document.getElementById("stats-group-section");

  const currentTab = window._currentStatsTab || 'personal';
  if (currentTab === 'personal') {
    // Show personal, hide group
    if (personalSec) personalSec.classList.remove("hidden");
    if (groupSec) groupSec.classList.add("hidden");

    // Set User Profile names
    const statsUserName = document.getElementById("stats-user-name");
    const reportPlanTitle = document.getElementById("report-plan-title");

    const userName = state.currentUser.name || "弟兄姊妹";
    if (statsUserName) statsUserName.textContent = userName;
    if (reportPlanTitle) reportPlanTitle.textContent = state.activePlan.name;

    // Personal Streak val
    const personalStreak = state.currentUser.streak || 0;

    // 1. Highest streak (最高連續)
    const reportStatStreak = document.getElementById("report-stat-streak");
    if (reportStatStreak) reportStatStreak.textContent = personalStreak;

    const currentRound = state.activePlan.currentRound || 1;
    const totalPlanDays = state.activePlan.days.length;

    // Helper: count completed days for a given round
    const countCompletedDaysForRound = (rTarget) => {
      return state.activePlan.days.filter(d => {
        if (!d.chapters || d.chapters.length === 0) return false;
        // For round 1 use isReadR1, round 2 use isReadR2, etc.
        if (rTarget === 1) return d.chapters.every(ch => ch.isReadR1);
        if (rTarget === 2) return d.chapters.every(ch => ch.isReadR2);
        if (rTarget === 3) return d.chapters.every(ch => ch.isReadR3);
        return d.chapters.every(ch => ch.isRead);
      }).length;
    };

    // 2. Total completed (累計完成)
    // Round 2+: freeze display at round-1 completion total (which should be 100%)
    const completedR1 = countCompletedDaysForRound(1);
    const completedCurrentRound = countCompletedDaysForRound(currentRound);
    const displayCompletedDays = currentRound > 1 ? totalPlanDays : completedR1;

    const reportStatCompleted = document.getElementById("report-stat-completed");
    if (reportStatCompleted) reportStatCompleted.textContent = displayCompletedDays;

    const reportStatStartDate = document.getElementById("report-stat-start-date");
    if (reportStatStartDate) {
      const pDate = new Date(state.activePlan.startDate);
      if (!isNaN(pDate)) {
        reportStatStartDate.textContent = `從 ${pDate.getFullYear()}年${pDate.getMonth() + 1}月${pDate.getDate()}日起`;
      } else {
        reportStatStartDate.textContent = `從 ${state.activePlan.startDate} 起`;
      }
    }

    // Calculate expected days up to today (for round 1 logic only)
    const planStart = new Date(state.activePlan.startDate);
    const today = new Date();
    const diffTime = today.getTime() - planStart.getTime();
    const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1);
    const expectedDaysCount = Math.min(totalPlanDays, diffDays);

    // 3. Progress Status
    const reportStatProgressStatus = document.getElementById("report-stat-progress-status");
    if (reportStatProgressStatus) {
      const progressStatus = getPlanProgressStatus(state.activePlan);
      reportStatProgressStatus.textContent = progressStatus.label;
      reportStatProgressStatus.className = "stat-badge " + progressStatus.badgeClass;
    }

    // 4. Makeup/Catch up days (🛡️ 進度救援)
    const statsStart = new Date(state.activePlan.startDate);
    statsStart.setHours(0, 0, 0, 0);
    const targetRoundsVal = getPlanLevelRounds(state.activePlan.level || "normal");
    let catchUpDaysVal = 0;
    // 補讀是相對原始日程的概念，只計第一遍，數值不會超過計畫天數。
    for (let r = 1; r <= 1; r++) {
      state.activePlan.days.forEach((day, index) => {
        const d = index + 1;
        const scheduledDate = new Date(statsStart);
        scheduledDate.setDate(statsStart.getDate() + (d - 1));
        const scheduledDateStr = scheduledDate.toISOString().substring(0, 10);

        const roundLogs = (state.readingLogs || []).filter(l =>
          (l.plan_id === state.activePlan.id || l.presetKey === state.activePlan.presetKey) &&
          (l.round || 1) === r
        );

        let allChaptersCompleted = true;
        let maxReadDateStr = "";

        for (const ch of day.chapters) {
          const log = roundLogs.find(l => l.book === ch.book && l.chapter === ch.chapter);
          if (!log) {
            allChaptersCompleted = false;
            break;
          }
          const logDateStr = log.read_at.substring(0, 10);
          if (!maxReadDateStr || logDateStr > maxReadDateStr) {
            maxReadDateStr = logDateStr;
          }
        }

        if (allChaptersCompleted && maxReadDateStr) {
          if (maxReadDateStr > scheduledDateStr) {
            catchUpDaysVal++;
          }
        }
      });
    }
    const reportStatMakeup = document.getElementById("report-stat-makeup");
    if (reportStatMakeup) reportStatMakeup.textContent = catchUpDaysVal;
    const makeupCard = document.getElementById("report-stat-makeup-card");
    if (makeupCard) {
      makeupCard.classList.toggle("stat-bento--danger-active", catchUpDaysVal > 0);
    }

    // 5. Cumulative chapters read (累積閱讀章數) — 所有遍次累計，不重置
    const reportStatTotalChapters = document.getElementById("report-stat-total-chapters");
    if (reportStatTotalChapters) {
      const currentPlanId = state.activePlan.id;
      const currentPresetKey = state.activePlan.presetKey;
      const uniqueKeys = new Set();
      if (state.readingLogs) {
        state.readingLogs.forEach(l => {
          const logMatchesPlan =
            (currentPlanId && l.plan_id && l.plan_id === currentPlanId) ||
            (currentPresetKey && l.presetKey && l.presetKey === currentPresetKey) ||
            (!l.plan_id && !l.presetKey);
          if (logMatchesPlan) {
            // 每一遍各章節分開計算，累積跨遍次總章數
            const r = l.round || 1;
            uniqueKeys.add(`${l.book}_${l.chapter}_${r}`);
          }
        });
      }
      reportStatTotalChapters.textContent = uniqueKeys.size;
    }

    // Render heatmap, trend chart, and badges wall
    renderPersonalHeatmap();
    renderPersonalTrendChart();
    renderPersonalUnlockedBadges();
  } else {
    // Show group, hide personal
    if (personalSec) personalSec.classList.add("hidden");
    if (groupSec) groupSec.classList.remove("hidden");

    // Render Group Stats
    await renderPlanHistoryView();
  }
}

async function renderPlanHistoryView() {
  if (!state.activePlan) return;

  // 1. Render Group Rankings/Participants table at top (Wait, the ranking table is no longer at top of stats, but we still trigger it to update scoped user list)
  await renderGroupParticipantsRankingTable();

  // 2. Render group mini-cards and stats
  await renderGroupMiniStats();

  // 4. Render pastoral ranking bar chart
  renderGroupPastoralChart();

  // 5. Render small group chart (with zone selector)
  renderGroupZoneChartWithSelector();

  // 6. Render 7-day growth trend line chart
  renderGroupGrowthTrend();

  // 7. Render team heatmap
  renderGroupTeamHeatmap();

  // 7.5 Render Group Progress Distribution (only visible on Admin tab)
  const distCard = document.getElementById("grp-distribution-card");
  if (distCard) {
    if (window._currentStatsTab === 'admin') {
      distCard.classList.remove("hidden");
      distCard.style.display = "";
      renderGroupProgressDistribution();
    } else {
      distCard.classList.add("hidden");
      distCard.style.display = "none";
    }
  }

  // 8. Render Bible Pilgrimage Trail canvas
  const pilgrimageCard = document.getElementById("grp-pilgrimage-card");
  const currentScopeUsers = window._grpScopedUsers || [];

  const rankingZoneSelector = document.getElementById("ranking-zone-selector");
  const selectedFilter = window._statsTabScope !== null
    ? window._statsTabScope
    : (rankingZoneSelector ? rankingZoneSelector.value : null);
  const isChurchScope = (window._currentStatsTab === 'church') || (selectedFilter === 'all');

  if (currentScopeUsers.length === 0 || isChurchScope) {
    if (pilgrimageCard) pilgrimageCard.style.display = "none";
  } else {
    if (pilgrimageCard) pilgrimageCard.style.display = "";
    if (typeof renderPilgrimageTrail === 'function') {
      await renderPilgrimageTrail();
    }
    if (typeof initPilgrimageControls === 'function' && !state.pilgrimageControlsInit) {
      initPilgrimageControls();
      state.pilgrimageControlsInit = true;
    }
  }
}

async function renderGroupMiniStats() {
  if (!state.activePlan) return;

  let allUsers = [];
  try {
    allUsers = await db.fetchMergedUsersList();
  } catch (e) {
    console.warn('Failed to fetch users for group stats mini-cards', e);
  }

  // Use the selector's scoped users if available, otherwise fallback to user's scope
  let scopedUsers = window._grpScopedUsers;
  // If tab scope is overridden, recalculate scopedUsers using it instead of using cached window._grpScopedUsers
  if (window._statsTabScope !== null && allUsers.length > 0) {
    const overrideFilter = window._statsTabScope;
    if (overrideFilter === "all") {
      scopedUsers = allUsers;
    } else if (overrideFilter === "me") {
      scopedUsers = allUsers.filter(u => u.name === state.currentUser.name);
    } else if (overrideFilter === "all_groups") {
      scopedUsers = allUsers.filter(u => u.small_group === state.currentUser.small_group);
    } else if (overrideFilter.startsWith("group:")) {
      const group = overrideFilter.replace("group:", "");
      scopedUsers = allUsers.filter(u => u.small_group === group);
    } else if (overrideFilter.startsWith("zone:")) {
      const zone = overrideFilter.replace("zone:", "");
      scopedUsers = allUsers.filter(u => u.pastoral_zone === zone);
    }
  } else if (scopedUsers === undefined) {
    scopedUsers = getScopedUsers(allUsers, state.currentUser);
  }
  if (!scopedUsers) scopedUsers = [];

  const totalChapters = scopedUsers.reduce((sum, u) => sum + (u.chapters_read || 0), 0);
  const totalMembers = scopedUsers.length;
  const totalActive = scopedUsers.filter(u => (u.chapters_read || 0) > 0 || Boolean(u.last_read)).length;

  // Determine current scope label from selector
  let scopeLabel = "全教會";
  const rankingZoneSelector = document.getElementById("ranking-zone-selector");
  const selectedFilter = window._statsTabScope !== null
    ? window._statsTabScope
    : (rankingZoneSelector ? rankingZoneSelector.value : null);

  if (selectedFilter) {
    if (selectedFilter === "all") {
      scopeLabel = "全教會";
    } else if (selectedFilter === "all_great_region") {
      scopeLabel = state.currentUser.great_region || "大區";
    } else if (selectedFilter === "all_zones") {
      scopeLabel = state.currentUser.pastoral_zone || "牧區";
    } else if (selectedFilter === "all_groups") {
      scopeLabel = state.currentUser.small_group || "小組";
    } else if (selectedFilter.startsWith("region:")) {
      scopeLabel = selectedFilter.replace("region:", "");
    } else if (selectedFilter.startsWith("zone:")) {
      scopeLabel = selectedFilter.replace("zone:", "");
    } else if (selectedFilter.startsWith("group:")) {
      scopeLabel = selectedFilter.replace("group:", "");
    }
  } else {
    // If no selector filter is loaded yet, guess label from user role
    const userRole = state.currentUser.role || "member";
    if (userRole === "admin" || userRole === "senior_pastor") {
      scopeLabel = "全教會";
    } else if (userRole === "great_zone_leader") {
      scopeLabel = state.currentUser.great_region || "大區";
    } else if (userRole === "zone_leader") {
      scopeLabel = state.currentUser.pastoral_zone || "牧區";
    } else {
      scopeLabel = state.currentUser.small_group || "小組";
    }
  }

  // Update labels based on scope
  const labelTotal = document.getElementById('grp-label-total-read');
  const labelMembers = document.getElementById('grp-label-members');
  const labelActive = document.getElementById('grp-label-active');

  if (labelTotal) labelTotal.textContent = scopeLabel === "全教會" ? '全教會總閱讀章數' : `${scopeLabel} 總閱讀章數`;
  if (labelMembers) labelMembers.textContent = scopeLabel === "全教會" ? '全教會參與人數' : `${scopeLabel} 參與人數`;
  if (labelActive) labelActive.textContent = scopeLabel === "全教會" ? '每日活躍' : `${scopeLabel} 每日活躍`;

  const elTotal = document.getElementById('grp-total-read');
  const elMembers = document.getElementById('grp-total-members');
  const elActive = document.getElementById('grp-active-members');

  if (elTotal) elTotal.textContent = totalChapters;
  if (elMembers) elMembers.textContent = totalMembers;
  if (elActive) elActive.textContent = totalActive;

  // Also stash for charts
  window._grpScopedUsers = scopedUsers;
  window._grpAllUsers = allUsers;
}

function renderGroupProgressDistribution() {
  const scopedUsers = window._grpScopedUsers || [];
  const totalCount = scopedUsers.length;

  let titleSuffix = "團體進度狀態分佈";
  const rankingZoneSelector = document.getElementById("ranking-zone-selector");
  const selectedFilter = window._statsTabScope !== null
    ? window._statsTabScope
    : (rankingZoneSelector ? rankingZoneSelector.value : null);

  if (selectedFilter) {
    if (selectedFilter === "all") titleSuffix = "全教會進度狀態分佈";
    else if (selectedFilter === "all_great_region") titleSuffix = `${state.currentUser.great_region || "大區"}進度狀態分佈`;
    else if (selectedFilter === "all_zones") titleSuffix = `${state.currentUser.pastoral_zone || "牧區"}進度狀態分佈`;
    else if (selectedFilter === "all_groups") titleSuffix = `${state.currentUser.small_group || "小組"}進度狀態分佈`;
    else if (selectedFilter.startsWith("region:")) titleSuffix = `${selectedFilter.replace("region:", "")}大區進度狀態分佈`;
    else if (selectedFilter.startsWith("zone:")) titleSuffix = `${selectedFilter.replace("zone:", "")}牧區進度狀態分佈`;
    else if (selectedFilter.startsWith("group:")) titleSuffix = `${selectedFilter.replace("group:", "")}小組進度狀態分佈`;
  }

  let expectedPct = 50;
  if (state.activePlan) {
    const start = new Date(state.activePlan.startDate);
    const end = new Date(state.activePlan.endDate);
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const today = new Date();
    const elapsed = Math.max(0, Math.min(totalDays, Math.ceil((today - start) / (1000 * 60 * 60 * 24)) + 1));
    expectedPct = Math.round((elapsed / totalDays) * 100) || 0;
  }

  const todayStr = new Date().toISOString().substring(0, 10);
  const todayDoneCount = scopedUsers.filter(u => u.last_read === todayStr).length;
  const todayRate = totalCount ? Math.round((todayDoneCount / totalCount) * 100) : 0;
  const totalChapters = scopedUsers.reduce((sum, u) => sum + (u.chapters_read || 0), 0);
  const dailyActiveCount = scopedUsers.filter(u => u.last_read === todayStr).length;

  let aheadCount = 0;
  let onCount = 0;
  let behindCount = 0;
  let rereadCount = 0;

  scopedUsers.forEach(u => {
    const currentRound = u.current_round !== undefined
      ? u.current_round
      : (u.chapters_read > 850 ? 3 : u.chapters_read > 500 ? 2 : 1);
    if (currentRound >= 2) {
      rereadCount++;
      aheadCount++;
      return;
    }

    if (u.plan_progress === 0) behindCount++;
    else if (u.plan_progress > expectedPct + 5) aheadCount++;
    else if (u.plan_progress < expectedPct - 5) behindCount++;
    else onCount++;
  });

  const behindPct = totalCount ? Math.round((behindCount / totalCount) * 100) : 0;
  const onPct = totalCount ? Math.round((onCount / totalCount) * 100) : 0;
  const aheadPct = totalCount ? Math.round((aheadCount / totalCount) * 100) : 0;

  // Direct DOM Updates for Group Stats Bento Cards
  const elTotal = document.getElementById('grp-total-read');
  const elMembers = document.getElementById('grp-total-members');
  const elActive = document.getElementById('grp-active-members');
  const elBehindCount = document.getElementById('grp-behind-count');
  const elReread = document.getElementById('grp-reread-count');

  if (elTotal) elTotal.textContent = totalChapters;
  if (elMembers) elMembers.textContent = totalCount;
  if (elActive) elActive.textContent = dailyActiveCount;
  if (elBehindCount) elBehindCount.textContent = behindCount;
  if (elReread) elReread.textContent = rereadCount;

  // Update segments of three-color progress bar
  const barBehind = document.getElementById('grp-today-bar-behind');
  const barOn = document.getElementById('grp-today-bar-on-schedule');
  const barAhead = document.getElementById('grp-today-bar-ahead');

  if (barBehind) {
    barBehind.style.width = `${behindPct}%`;
    barBehind.title = `落後: ${behindCount} 人 (${behindPct}%)`;
  }
  if (barOn) {
    barOn.style.width = `${onPct}%`;
    barOn.title = `在進度上: ${onCount} 人 (${onPct}%)`;
  }
  if (barAhead) {
    barAhead.style.width = `${aheadPct}%`;
    barAhead.title = `超前: ${aheadCount} 人 (${aheadPct}%)`;
  }
}

function renderGroupPastoralChart() {
  return; // Disabled
}

function renderGroupZoneChartWithSelector() {
  // Merged into renderGroupPastoralChart above
  return;
}

function renderGroupGrowthTrend() {
  const scopedUsers = window._grpScopedUsers || [];
  const chartCard = document.getElementById('grp-daily-active-chart-card');
  const titleEl = document.getElementById('grp-daily-active-chart-title');
  const canvasEl = document.getElementById('grp-daily-active-chart');

  if (!canvasEl) return;

  // Hide chart if no data
  if (scopedUsers.length === 0) {
    if (chartCard) chartCard.style.display = 'none';
    return;
  }
  if (chartCard) chartCard.style.display = '';

  // Update title based on scope
  if (titleEl) {
    const rankingZoneSelector = document.getElementById('ranking-zone-selector');
    const selectedFilter = window._statsTabScope !== null
      ? window._statsTabScope
      : (rankingZoneSelector ? rankingZoneSelector.value : null);
    let scopeLabel = '全教會';
    if (selectedFilter) {
      if (selectedFilter === 'all') scopeLabel = '全教會';
      else if (selectedFilter === 'all_great_region') scopeLabel = state.currentUser.great_region || '大區';
      else if (selectedFilter === 'all_zones') scopeLabel = state.currentUser.pastoral_zone || '牧區';
      else if (selectedFilter === 'all_groups') scopeLabel = state.currentUser.small_group || '小組';
      else if (selectedFilter.startsWith('region:')) scopeLabel = selectedFilter.replace('region:', '');
      else if (selectedFilter.startsWith('zone:')) scopeLabel = selectedFilter.replace('zone:', '');
      else if (selectedFilter.startsWith('group:')) scopeLabel = selectedFilter.replace('group:', '');
    } else {
      const userRole = state.currentUser.role || 'member';
      if (userRole === 'admin' || userRole === 'senior_pastor') scopeLabel = '全教會';
      else if (userRole === 'great_zone_leader') scopeLabel = state.currentUser.great_region || '大區';
      else if (userRole === 'zone_leader') scopeLabel = state.currentUser.pastoral_zone || '牧區';
      else scopeLabel = state.currentUser.small_group || '小組';
    }
    titleEl.textContent = `${scopeLabel} 每日活躍人數（近30天）`;
  }

  // Build 30-day window
  const today = new Date();
  const labels = [];
  const data = [];
  const DAYS = 30;

  const userIds = new Set(scopedUsers.map(u => u.id).filter(Boolean));
  const userNames = new Set(scopedUsers.map(u => u.name).filter(Boolean));
  const scopedPlanIds = new Set(scopedUsers.map(u => u.plan_id).filter(Boolean));
  const currentPlanId = state.activePlan && state.activePlan.id;
  const currentPresetKey = state.activePlan && state.activePlan.presetKey;

  // Build per-day unique user sets from logs
  const activeByDate = {}; // date string -> Set of user_id / name

  if (state.isSupabaseMode && state.allLogsCache) {
    state.allLogsCache.forEach(log => {
      if (!log.read_at) return;
      if (!userIds.has(log.user_id)) return;
      if (scopedPlanIds.size > 0) {
        if (!scopedPlanIds.has(log.plan_id)) return;
      } else if (!logMatchesPlan(log, currentPlanId, currentPresetKey)) {
        return;
      }
      const dStr = log.read_at.substring(0, 10);
      if (!activeByDate[dStr]) activeByDate[dStr] = new Set();
      activeByDate[dStr].add(log.user_id || log.name);
    });
  } else {
    (state.readingLogs || []).forEach(log => {
      if (!log.read_at) return;
      const nameMatch = log.name ? userNames.has(log.name) : true;
      if (!nameMatch) return;
      if (!logMatchesPlan(log, currentPlanId, currentPresetKey)) return;
      const dStr = log.read_at.substring(0, 10);
      if (!activeByDate[dStr]) activeByDate[dStr] = new Set();
      activeByDate[dStr].add(log.user_id || log.name);
    });
  }

  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dStr = d.toISOString().substring(0, 10);
    const mmdd = dStr.substring(5).replace('-', '/');
    // Only show every 5th label to avoid crowding on mobile
    labels.push(i % 5 === 0 || i === 0 ? mmdd : '');
    data.push(activeByDate[dStr] ? activeByDate[dStr].size : 0);
  }

  // Destroy previous chart if exists
  if (state.statsCharts) {
    if (state.statsCharts.dailyActive) {
      state.statsCharts.dailyActive.destroy();
    }
  } else {
    state.statsCharts = {};
  }

  const isDark = state.theme === 'dark' || document.body.classList.contains('dark-theme');
  const fontColor = isDark ? 'rgba(180,180,180,0.85)' : 'rgba(60,60,60,0.75)';
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const brandColor = '#04A9D2';
  const brandFill = isDark
    ? 'rgba(4,169,210,0.18)'
    : 'rgba(4,169,210,0.10)';

  const ctx = canvasEl.getContext('2d');
  state.statsCharts.dailyActive = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '活躍人數',
        data,
        borderColor: brandColor,
        backgroundColor: brandFill,
        borderWidth: 2,
        fill: true,
        tension: 0.42,
        pointRadius: 2.5,
        pointBackgroundColor: brandColor,
        pointHoverRadius: 5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y} 人`
          },
          backgroundColor: isDark ? 'rgba(30,30,35,0.92)' : 'rgba(255,255,255,0.95)',
          borderColor: brandColor,
          borderWidth: 1,
          titleColor: isDark ? '#fff' : '#111',
          bodyColor: isDark ? 'rgba(200,200,200,0.9)' : 'rgba(60,60,60,0.85)',
          padding: 10,
          cornerRadius: 8,
        }
      },
      scales: {
        x: {
          ticks: {
            color: fontColor,
            font: { size: 10 },
            maxRotation: 0,
          },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          ticks: {
            color: fontColor,
            font: { size: 10 },
            stepSize: 1,
            precision: 0,
          },
          grid: { color: gridColor },
          border: { display: false },
          beginAtZero: true,
        }
      }
    }
  });
}

function renderGroupTeamHeatmap() {
  const scopedUsers = window._grpScopedUsers || [];
  const heatmapCard = document.getElementById("grp-heatmap-card");

  if (scopedUsers.length === 0) {
    if (heatmapCard) heatmapCard.style.display = "none";
    return;
  } else {
    if (heatmapCard) heatmapCard.style.display = "";
  }

  // Determine current scope label from selector
  let scopeLabel = "全教會";
  const rankingZoneSelector = document.getElementById("ranking-zone-selector");
  const selectedFilter = window._statsTabScope !== null
    ? window._statsTabScope
    : (rankingZoneSelector ? rankingZoneSelector.value : null);

  if (selectedFilter) {
    if (selectedFilter === "all") {
      scopeLabel = "全教會";
    } else if (selectedFilter === "all_great_region") {
      scopeLabel = state.currentUser.great_region || "大區";
    } else if (selectedFilter === "all_zones") {
      scopeLabel = state.currentUser.pastoral_zone || "牧區";
    } else if (selectedFilter === "all_groups") {
      scopeLabel = state.currentUser.small_group || "小組";
    } else if (selectedFilter.startsWith("region:")) {
      scopeLabel = selectedFilter.replace("region:", "");
    } else if (selectedFilter.startsWith("zone:")) {
      scopeLabel = selectedFilter.replace("zone:", "");
    } else if (selectedFilter.startsWith("group:")) {
      scopeLabel = selectedFilter.replace("group:", "");
    }
  } else {
    const userRole = state.currentUser.role || "member";
    if (userRole === "admin" || userRole === "senior_pastor") {
      scopeLabel = "全教會";
    } else if (userRole === "great_zone_leader") {
      scopeLabel = state.currentUser.great_region || "大區";
    } else if (userRole === "zone_leader") {
      scopeLabel = state.currentUser.pastoral_zone || "牧區";
    } else {
      scopeLabel = state.currentUser.small_group || "小組";
    }
  }

  const titleEl = document.getElementById('grp-heatmap-title');
  if (titleEl) {
    titleEl.textContent = scopeLabel === "全教會"
      ? '全教會讀經活躍度 (計畫期間打卡活躍度)'
      : `${scopeLabel} 讀經活躍度 (計畫期間打卡活躍度)`;
  }

  const userIds = new Set(scopedUsers.map(u => u.id).filter(Boolean));
  const userNames = new Set(scopedUsers.map(u => u.name).filter(Boolean));
  const scopedPlanIds = new Set(scopedUsers.map(u => u.plan_id).filter(Boolean));
  const currentPlanId = state.activePlan && state.activePlan.id;
  const currentPresetKey = state.activePlan && state.activePlan.presetKey;

  const logsByDate = {};

  if (state.isSupabaseMode && state.allLogsCache) {
    // Supabase mode: use full log cache, filter by team users AND current plan
    state.allLogsCache.forEach(log => {
      if (!log.read_at) return;
      if (!userIds.has(log.user_id)) return;
      // Each participant has their own reading_plans.id for the same global plan.
      if (scopedPlanIds.size > 0) {
        if (!scopedPlanIds.has(log.plan_id)) return;
      } else if (!logMatchesPlan(log, currentPlanId, currentPresetKey)) {
        return;
      }
      const dStr = log.read_at.substring(0, 10);
      logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
    });
  } else {
    // Local / mock mode: filter state.readingLogs by plan
    (state.readingLogs || []).forEach(log => {
      if (!log.read_at) return;
      const nameMatch = log.name ? userNames.has(log.name) : true;
      if (!nameMatch) return;
      if (!logMatchesPlan(log, currentPlanId, currentPresetKey)) return;
      const dStr = log.read_at.substring(0, 10);
      logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
    });
  }
  const planStart = state.activePlan ? state.activePlan.startDate : null;
  const planEnd = state.activePlan ? state.activePlan.endDate : null;
  buildHeatmapGrid('grp-bible-heatmap-container', logsByDate, scopedUsers.length, '章', planStart, planEnd);
}

function logMatchesPlan(log, currentPlanId, currentPresetKey) {
  return (currentPlanId && log.plan_id && log.plan_id === currentPlanId) ||
    (currentPresetKey && log.presetKey && log.presetKey === currentPresetKey) ||
    (!log.plan_id && !log.presetKey);
}

function renderPersonalHeatmap() {
  // 只顯示當前計畫的閱讀記錄
  const currentPlanId = state.activePlan && state.activePlan.id;
  const currentPresetKey = state.activePlan && state.activePlan.presetKey;
  const logsByDate = {};
  (state.readingLogs || []).forEach(log => {
    if (!log.read_at) return;
    const matches = logMatchesPlan(log, currentPlanId, currentPresetKey);
    if (matches) {
      const dStr = log.read_at.substring(0, 10);
      logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
    }
  });
  const start = state.activePlan ? state.activePlan.startDate : null;
  const end = state.activePlan ? state.activePlan.endDate : null;
  buildHeatmapGrid("bible-heatmap-container", logsByDate, 1, "章", start, end);
}

function renderPersonalTrendChart() {
  const canvas = document.getElementById("personal-reading-trend-chart");
  if (!canvas) return;

  const currentPlanId = state.activePlan && state.activePlan.id;
  const currentPresetKey = state.activePlan && state.activePlan.presetKey;

  const range = state.personalTrendRange || "month";

  // Style buttons according to range selection
  const btnWeek = document.getElementById("trend-range-week");
  const btnMonth = document.getElementById("trend-range-month");
  const btnYear = document.getElementById("trend-range-year");

  [btnWeek, btnMonth, btnYear].forEach((btn) => {
    if (btn) btn.classList.remove("active");
  });

  const activeBtn = document.getElementById(`trend-range-${range}`);
  if (activeBtn) activeBtn.classList.add("active");

  let labels = [];
  let chartData = [];

  if (range === "week") {
    // 7 days starting from Sunday of the current week
    const dates = [];
    const today = new Date();
    const dayOfWeek = today.getDay();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - dayOfWeek);

    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      const dStr = d.toISOString().substring(0, 10);
      dates.push(dStr);
      labels.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
    }
    const logsByDate = {};
    if (state.readingLogs) {
      state.readingLogs.forEach(log => {
        if (!log.read_at) return;
        if (!logMatchesPlan(log, currentPlanId, currentPresetKey)) return;
        const dStr = log.read_at.substring(0, 10);
        logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
      });
    }
    chartData = dates.map(dStr => logsByDate[dStr] || 0);

  } else if (range === "year") {
    // 12 months
    const months = [];
    const today = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const yStr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, '0');
      months.push(`${yStr}-${mStr}`);
      labels.push(`${yStr}/${mStr}`);
    }
    const logsByMonth = {};
    if (state.readingLogs) {
      state.readingLogs.forEach(log => {
        if (!log.read_at) return;
        if (!logMatchesPlan(log, currentPlanId, currentPresetKey)) return;
        const mStr = log.read_at.substring(0, 7);
        logsByMonth[mStr] = (logsByMonth[mStr] || 0) + 1;
      });
    }
    chartData = months.map(mStr => logsByMonth[mStr] || 0);

  } else {
    // 30 days (default)
    const dates = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dStr = d.toISOString().substring(0, 10);
      dates.push(dStr);
      labels.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
    }
    const logsByDate = {};
    if (state.readingLogs) {
      state.readingLogs.forEach(log => {
        if (!log.read_at) return;
        if (!logMatchesPlan(log, currentPlanId, currentPresetKey)) return;
        const dStr = log.read_at.substring(0, 10);
        logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
      });
    }
    chartData = dates.map(dStr => logsByDate[dStr] || 0);
  }

  // Render Chart.js
  const isDark = document.body.classList.contains('dark-theme');
  const fontColor = isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(71, 85, 105, 0.5)';

  if (window._personalTrendChart) window._personalTrendChart.destroy();

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 160);
  gradient.addColorStop(0, 'rgba(4, 169, 210, 0.22)');
  gradient.addColorStop(1, 'rgba(4, 169, 210, 0)');

  window._personalTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '每日讀經章數',
        data: chartData,
        borderColor: '#04A9D2',
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointBackgroundColor: '#04A9D2',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 1,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (context) {
              return `讀經章數: ${context.raw} 章`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: fontColor, font: { size: 9, weight: '300' } },
          grid: { display: false }
        },
        y: {
          ticks: { color: fontColor, stepSize: range === "year" ? 20 : 5, font: { size: 9, weight: '300' } },
          grid: { display: false },
          min: 0
        }
      }
    }
  });
}

// Window actions
window.changePersonalTrendRange = function (range) {
  state.personalTrendRange = range;
  renderPersonalTrendChart();
};

function renderPersonalUnlockedBadges() {
  if (typeof renderBadgeStrip === "function") {
    renderBadgeStrip("plan-badge-strip");
  }
}

async function renderMyPersonalRankings() {
  if (!state.activePlan) return;

  const rankSkeleton = typeof ComponentSkeletonLoader !== "undefined"
    ? ComponentSkeletonLoader.getHtml("inline", { width: "4.5rem", height: "1.4rem" })
    : "—";
  const elRankAll = document.getElementById("my-rank-all");
  const elRankAllTotal = document.getElementById("my-rank-all-total");
  const elRankZoneTitle = document.getElementById("my-rank-zone-title");
  const elRankZone = document.getElementById("my-rank-zone");
  const elRankZoneTotal = document.getElementById("my-rank-zone-total");

  if (elRankAll) elRankAll.innerHTML = rankSkeleton;
  if (elRankAllTotal) elRankAllTotal.innerHTML = ComponentSkeletonLoader
    ? ComponentSkeletonLoader.getHtml("inline", { width: "3rem", height: "0.8rem" })
    : "—";
  if (elRankZone) elRankZone.innerHTML = rankSkeleton;
  if (elRankZoneTotal) elRankZoneTotal.innerHTML = ComponentSkeletonLoader
    ? ComponentSkeletonLoader.getHtml("inline", { width: "3rem", height: "0.8rem" })
    : "—";

  // Calculate completedDaysCount (讀完一遍後直接顯示總天數，避免進入二三遍計算落後/超前不準確)
  const isCompletedOnce = state.activePlan.isPlanCompleted || (state.activePlan.currentRound || 1) > 1;
  const completedDaysCount = isCompletedOnce
    ? state.activePlan.days.length
    : state.activePlan.days.filter(d => {
      if (!d.chapters || d.chapters.length === 0) return false;
      return d.chapters.every(ch => ch.isRead);
    }).length;

  const planStart = new Date(state.activePlan.startDate);
  const today = new Date();
  const diffTime = today.getTime() - planStart.getTime();
  const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1);
  const expectedDaysCount = Math.min(state.activePlan.days.length, diffDays);

  let allUsers = [];
  try {
    allUsers = await db.fetchMergedUsersList();
  } catch (e) {
    console.warn("Failed to fetch users list for personal ranking", e);
  }

  const myName = state.currentUser.name;
  const myZone = state.currentUser.pastoral_zone || "";

  const userProgressList = allUsers.map(u => {
    let pct = u.plan_progress || 0;
    if (u.name === myName) {
      pct = state.activePlan ? Math.round((completedDaysCount / state.activePlan.days.length) * 100) : 0;
    }
    return {
      name: u.name,
      pastoral_zone: u.pastoral_zone,
      progress: pct
    };
  });

  // Sort for All Church Rank
  const sortedAll = [...userProgressList].sort((a, b) => b.progress - a.progress);
  const myIndexAll = sortedAll.findIndex(u => u.name === myName);
  const myRankAll = myIndexAll !== -1 ? myIndexAll + 1 : sortedAll.length;

  if (elRankAll) elRankAll.textContent = `第 ${myRankAll} 名`;
  if (elRankAllTotal) elRankAllTotal.textContent = `共 ${sortedAll.length} 人`;

  // Sort for Pastoral Zone Rank
  const zoneUsers = userProgressList.filter(u => u.pastoral_zone === myZone);
  const sortedZone = [...zoneUsers].sort((a, b) => b.progress - a.progress);
  const myIndexZone = sortedZone.findIndex(u => u.name === myName);
  const myRankZone = myIndexZone !== -1 ? myIndexZone + 1 : sortedZone.length;

  if (elRankZoneTitle && myZone) elRankZoneTitle.textContent = `${myZone} 個人排行`;
  if (elRankZone) elRankZone.textContent = myZone ? `第 ${myRankZone} 名` : "未選牧區";
  if (elRankZoneTotal) elRankZoneTotal.textContent = myZone ? `共 ${sortedZone.length} 人` : "請設定所屬牧區";
}

async function renderPlanRankingView() {
  await renderMyPersonalRankings();

  const container = document.getElementById("pastoral-ranking-list-container");
  if (!container) return;

  if (!canUseAdvancedGroupStats()) {
    const rankingCard = container.closest(".glass-card");
    if (rankingCard) rankingCard.style.display = "none";
    return;
  }
  const rankingCard = container.closest(".glass-card");
  if (rankingCard) rankingCard.style.display = "";

  const header = container.previousElementSibling;
  if (header) header.style.display = "none";
  container.className = "bar-race-list";
  container.style.cssText = "";
  container.innerHTML = typeof ComponentSkeletonLoader !== "undefined"
    ? ComponentSkeletonLoader.getHtml("bar-race", { count: 4 })
    : "";

  let pastoralStats = [];
  try {
    const allUsers = await db.fetchMergedUsersList();
    const zoneMap = {};
    allUsers.forEach(u => {
      const zone = u.pastoral_zone || "未設定";
      if (!zoneMap[zone]) zoneMap[zone] = { name: zone, total_chapters: 0, members: 0 };
      zoneMap[zone].total_chapters += (u.chapters_read || 0);
      zoneMap[zone].members += 1;
    });
    pastoralStats = Object.values(zoneMap).sort((a, b) => b.total_chapters - a.total_chapters);
  } catch (e) {
    console.error("Failed to load pastoral rankings", e);
  }

  if (pastoralStats.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted);">目前沒有排行資料</div>`;
    return;
  }

  const maxChapters = Math.max(...pastoralStats.map(item => item.total_chapters), 1);
  const renderRace = () => {
    container.innerHTML = `
      <div class="bar-race-toolbar">
        <div>
          <div class="bar-race-title">牧區動態長條圖競賽</div>
          <div class="bar-race-subtitle">依總累計閱讀章數排序</div>
        </div>
        <button type="button" class="bar-race-replay" onclick="window.replayPastoralRace()" title="重新播放排行動畫">重播</button>
      </div>
      <div class="bar-race-track"></div>
    `;
    const track = container.querySelector(".bar-race-track");

    pastoralStats.forEach((item, index) => {
      const pct = Math.max(4, Math.round((item.total_chapters / maxChapters) * 100));
      const row = document.createElement("div");
      row.className = "bar-race-row";
      row.style.setProperty("--target-width", `${pct}%`);
      row.style.transitionDelay = `${index * 90}ms`;
      row.innerHTML = `
        <div class="bar-race-rank">${index + 1}</div>
        <div class="bar-race-main">
          <div class="bar-race-meta">
            <span class="bar-race-name">${escapeHTML(item.name)}</span>
            <span class="bar-race-members">${item.members} 人</span>
          </div>
          <div class="bar-race-bar-shell">
            <div class="bar-race-bar"></div>
            <span class="bar-race-value">${item.total_chapters} 章</span>
          </div>
        </div>
      `;
      track.appendChild(row);
    });

    requestAnimationFrame(() => {
      track.querySelectorAll(".bar-race-row").forEach(row => row.classList.add("is-running"));
    });
  };

  window.replayPastoralRace = renderRace;
  renderRace();
}

async function renderGroupParticipantsRankingTable() {
  if (!state.activePlan) return;

  const rankingTitle = document.getElementById("ranking-title");
  const currentPlanIdForStats = state.activePlan.id;
  const currentPresetKeyForStats = state.activePlan.presetKey;
  const uniquePlanLogs = (logs) => {
    const unique = new Set();
    const planChapters = new Set();
    if (state.activePlan && state.activePlan.days) {
      state.activePlan.days.forEach(d => {
        if (d.chapters) {
          d.chapters.forEach(ch => {
            planChapters.add(`${ch.book}_${ch.chapter}`);
          });
        }
      });
    }
    (logs || []).forEach(log => {
      if (!logMatchesPlan(log, currentPlanIdForStats, currentPresetKeyForStats)) return;
      if (planChapters.has(`${log.book}_${log.chapter}`)) {
        unique.add(`${log.book}_${log.chapter}_${log.round || 1}`);
      }
    });
    return unique.size;
  };
  const myPlanReadCount = uniquePlanLogs(state.readingLogs || []);
  const personalStreak = myPlanReadCount > 0 ? (state.currentUser.streak || 0) : 0;

  const calculateCatchUpDays = (userLogs) => {
    if (!state.activePlan || !state.activePlan.days) return 0;
    const statsStart = new Date(state.activePlan.startDate);
    statsStart.setHours(0, 0, 0, 0);
    let catchUpDaysVal = 0;
    // 第二遍起屬於超前閱讀，不重複算成補讀。
    for (let r = 1; r <= 1; r++) {
      const roundLogs = (userLogs || []).filter(l => (l.round || 1) === r);
      state.activePlan.days.forEach((day, index) => {
        const d = index + 1;
        const scheduledDate = new Date(statsStart);
        scheduledDate.setDate(statsStart.getDate() + (d - 1));
        const scheduledDateStr = scheduledDate.toISOString().substring(0, 10);

        let allChaptersCompleted = true;
        let maxReadDateStr = "";

        for (const ch of day.chapters) {
          const log = roundLogs.find(l => l.book === ch.book && l.chapter === ch.chapter);
          if (!log) {
            allChaptersCompleted = false;
            break;
          }
          const logDateStr = log.read_at.substring(0, 10);
          if (!maxReadDateStr || logDateStr > maxReadDateStr) {
            maxReadDateStr = logDateStr;
          }
        }

        if (allChaptersCompleted && maxReadDateStr) {
          if (maxReadDateStr > scheduledDateStr) {
            catchUpDaysVal++;
          }
        }
      });
    }
    return catchUpDaysVal;
  };

  // Calculate completedDaysCount (讀完一遍後直接顯示總天數，避免進入二三遍計算落後/超前不準確)
  const isCompletedOnce = state.activePlan.isPlanCompleted || (state.activePlan.currentRound || 1) > 1;
  const completedDaysCount = isCompletedOnce
    ? state.activePlan.days.length
    : state.activePlan.days.filter(d => {
      if (!d.chapters || d.chapters.length === 0) return false;
      return d.chapters.every(ch => ch.isRead);
    }).length;

  const planStart = new Date(state.activePlan.startDate);
  const today = new Date();
  const diffTime = today.getTime() - planStart.getTime();
  const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1);
  const expectedDaysCount = Math.min(state.activePlan.days.length, diffDays);

  const userZone = state.currentUser.pastoral_zone || "";
  const userRole = state.currentUser.role || "member";
  const isAdmin = userRole === "admin" || userRole === "senior_pastor";
  const isGreatZoneLeader = userRole === "great_zone_leader";
  const isZoneLeader = userRole === "zone_leader";
  const isGroupLeader = userRole === "group_leader";

  const listContainer = document.getElementById("ranking-participants-list");
  if (listContainer) {
    listContainer.innerHTML = typeof ComponentSkeletonLoader !== "undefined"
      ? ComponentSkeletonLoader.getHtml("member-progress", { count: 5 })
      : "";

    let allUsers = [];
    try {
      const activeKey = state.activePlan
        ? (state.activePlan.globalPlanId || state.activePlan.presetKey || state.activePlan.name || state.activePlan.id)
        : null;
      if (window._cachedAllUsersList && window._cachedAllUsersListKey === activeKey && window._cachedAllUsersList.length > 0) {
        allUsers = window._cachedAllUsersList;
      } else {
        allUsers = await db.fetchMergedUsersList(activeKey);
        window._cachedAllUsersList = allUsers;
        window._cachedAllUsersListKey = activeKey;
      }
    } catch (e) {
      console.warn("Failed to fetch merged users, fallback to empty array", e);
    }

    let scopedUsersList = allUsers;
    if (isAdmin) {
      scopedUsersList = allUsers;
    } else if (isGreatZoneLeader) {
      const userGreatRegion = state.currentUser.great_region || "";
      const myRegions = userGreatRegion.split(",").map(s => s.trim()).filter(Boolean);
      scopedUsersList = allUsers.filter(u => myRegions.includes(u.great_region));
    } else if (isZoneLeader) {
      const userZoneStr = state.currentUser.pastoral_zone || "";
      const myZones = userZoneStr.split(",").map(s => s.trim()).filter(Boolean);
      scopedUsersList = allUsers.filter(u => myZones.includes(u.pastoral_zone));
    } else if (isGroupLeader) {
      const userGroupStr = state.currentUser.small_group || "";
      const myGroups = userGroupStr.split(",").map(s => s.trim()).filter(Boolean);
      scopedUsersList = allUsers.filter(u => myGroups.includes(u.small_group));
    } else {
      const userZones = (userZone || "").split(",").map(s => s.trim()).filter(Boolean);
      scopedUsersList = allUsers.filter(u => userZones.includes(u.pastoral_zone));
    }

    const tabMembers = document.getElementById("tab-plan-members");
    const isMembersActive = tabMembers && tabMembers.classList.contains("active");

    if (isMembersActive) {
      populateMembersSelector();
    } else {
      populateStatsSelector();
    }
    const rankingZoneSelector = document.getElementById("ranking-zone-selector");
    const membersZoneSelector = document.getElementById("members-zone-selector");
    const searchInput = document.getElementById("member-search-input");
    const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

    let groupMembers = scopedUsersList;

    if (isMembersActive) {
      if (query) {
        groupMembers = scopedUsersList.filter(u => u.name.toLowerCase().includes(query));
        if (rankingTitle) rankingTitle.textContent = `搜尋結果: ${query}`;
      } else {
        const selectedFilter = membersZoneSelector ? membersZoneSelector.value : null;
        if (selectedFilter) {
          if (selectedFilter.startsWith("zone:")) {
            const zone = selectedFilter.replace("zone:", "");
            if (zone === "未設定牧區") {
              groupMembers = scopedUsersList.filter(u => !u.pastoral_zone || u.pastoral_zone.trim() === "");
              if (rankingTitle) rankingTitle.textContent = "參與者總覽 (未設定牧區成員)";
            } else {
              groupMembers = scopedUsersList.filter(u => u.pastoral_zone === zone);
              if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${zone}牧區)`;
            }
          } else if (selectedFilter.startsWith("group:")) {
            const group = selectedFilter.replace("group:", "");
            groupMembers = scopedUsersList.filter(u => u.small_group === group);
            if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${group}小組)`;
          } else if (selectedFilter.startsWith("region:")) {
            const region = selectedFilter.replace("region:", "");
            groupMembers = scopedUsersList.filter(u => u.great_region === region);
            if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${region}大區成員)`;
          } else if (selectedFilter === "all") {
            groupMembers = scopedUsersList;
            if (rankingTitle) rankingTitle.textContent = "參與者總覽 (全教會成員)";
          } else if (selectedFilter === "all_great_region") {
            groupMembers = scopedUsersList;
            if (rankingTitle) rankingTitle.textContent = "參與者總覽 (所屬大區成員)";
          } else {
            const userZones = (userZone || "").split(",").map(s => s.trim()).filter(Boolean);
            groupMembers = scopedUsersList.filter(u => userZones.includes(u.pastoral_zone));
            if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userZone}牧區)`;
          }
        } else {
          const userZones = (userZone || "").split(",").map(s => s.trim()).filter(Boolean);
          groupMembers = scopedUsersList.filter(u => userZones.includes(u.pastoral_zone));
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userZone}牧區)`;
        }
      }
    } else {
      const selectedFilter = window._statsTabScope !== null
        ? window._statsTabScope
        : (rankingZoneSelector ? rankingZoneSelector.value : null);
      if (selectedFilter) {
        if (selectedFilter === "all") {
          groupMembers = allUsers;
          if (rankingTitle) rankingTitle.textContent = "參與者總覽 (全教會排行)";
        } else if (selectedFilter === "all_great_region") {
          const userGreatRegion = state.currentUser.great_region || "";
          const userRegions = userGreatRegion.split(",").map(s => s.trim()).filter(Boolean);
          groupMembers = allUsers.filter(u => userRegions.includes(u.great_region));
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userGreatRegion}排行)`;
        } else if (selectedFilter === "all_zones") {
          const userZoneStr = state.currentUser.pastoral_zone || "";
          const userZones = userZoneStr.split(",").map(s => s.trim()).filter(Boolean);
          groupMembers = allUsers.filter(u => userZones.includes(u.pastoral_zone));
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userZoneStr}排行)`;
        } else if (selectedFilter === "all_groups") {
          const userGroupStr = state.currentUser.small_group || "";
          const userGroups = userGroupStr.split(",").map(s => s.trim()).filter(Boolean);
          groupMembers = allUsers.filter(u => userGroups.includes(u.small_group));
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userGroupStr}排行)`;
        } else if (selectedFilter.startsWith("region:")) {
          const region = selectedFilter.replace("region:", "");
          groupMembers = allUsers.filter(u => u.great_region === region);
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${region}大區排行)`;
        } else if (selectedFilter.startsWith("zone:")) {
          const zone = selectedFilter.replace("zone:", "");
          if (zone === "未設定牧區") {
            groupMembers = allUsers.filter(u => !u.pastoral_zone || u.pastoral_zone.trim() === "");
            if (rankingTitle) rankingTitle.textContent = "參與者總覽 (未設定牧區成員排行)";
          } else {
            groupMembers = allUsers.filter(u => u.pastoral_zone === zone);
            if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${zone}牧區排行)`;
          }
        } else if (selectedFilter.startsWith("group:")) {
          const group = selectedFilter.replace("group:", "");
          groupMembers = allUsers.filter(u => u.small_group === group);
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${group}小組排行)`;
        }
      } else {
        const userZones = (userZone || "").split(",").map(s => s.trim()).filter(Boolean);
        groupMembers = allUsers.filter(u => userZones.includes(u.pastoral_zone));
        if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userZone}牧區排行)`;
      }
    }

    window._grpScopedUsers = groupMembers;

    groupMembers = groupMembers.map(u => {
      const isMe = u.name === state.currentUser.name;
      const hasAnyPlanRead = isMe
        ? myPlanReadCount > 0
        : ((u.chapters_read || 0) > 0 || ((u.plan_progress || 0) > 0 && Boolean(u.last_read)));
      const streak = hasAnyPlanRead ? (isMe ? personalStreak : (u.streak || 0)) : 0;

      let completed = 0;
      let makeup = 0;
      let diff = 0;

      if (hasAnyPlanRead) {
        if (isMe) {
          completed = completedDaysCount;
          const myUserLogs = (state.readingLogs || []).filter(l =>
            l.plan_id === state.activePlan.id || l.presetKey === state.activePlan.presetKey
          );
          makeup = calculateCatchUpDays(myUserLogs);
          diff = completed - expectedDaysCount;
        } else {
          completed = Math.round(((u.plan_progress || 0) / 100) * state.activePlan.days.length);
          completed = Math.min(completed, state.activePlan.days.length);
          const otherUserLogs = (state.allLogsCache || []).filter(l => l.user_id === u.id);
          makeup = calculateCatchUpDays(otherUserLogs);
          diff = completed - expectedDaysCount;
        }
      }

      const memberRound = Number(isMe ? state.activePlan.currentRound : u.current_round) || 1;
      const memberProgress = Math.max(0, Math.min(100, Math.round(Number(
        isMe ? state.activePlan.progress : u.plan_progress
      ) || 0)));
      let statusStr = hasAnyPlanRead ? "在進度上" : "未開始";
      let statusColor = "var(--text-muted)";
      if (hasAnyPlanRead && memberRound > 1) {
        statusStr = `超前第${memberRound}遍完成${memberProgress}%`;
        statusColor = "var(--color-success-foreground)";
      } else if (hasAnyPlanRead && diff > 0) {
        statusStr = `超前 ${diff}天`;
        statusColor = "var(--color-success-foreground)";
      } else if (hasAnyPlanRead && diff < 0) {
        statusStr = diff === -1 ? "今日未完成" : `落後 ${Math.abs(diff)}天`;
        statusColor = "var(--color-danger)";
      }

      return {
        id: u.id,
        name: u.name,
        streak: streak,
        completed: completed,
        makeup: makeup,
        statusStr: statusStr,
        statusColor: statusColor,
        isMe: isMe,
        isBehind: hasAnyPlanRead && diff < 0,
        isNotStarted: !hasAnyPlanRead
      };
    });

    groupMembers.sort((a, b) => b.completed - a.completed);
    window._grpScopedProcessedMembers = groupMembers;

    if (searchInput && !searchInput.dataset.listenerInitialized) {
      searchInput.dataset.listenerInitialized = "true";
      searchInput.addEventListener("input", async () => {
        await renderGroupParticipantsRankingTable();
      });
    }

    window.displayParticipantsList(100);
  }
}

window.displayParticipantsList = function (limit = 100) {
  const listContainer = document.getElementById("ranking-participants-list");
  if (!listContainer) return;

  const searchInput = document.getElementById("member-search-input");
  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

  // Filter based on search query
  let items = window._grpScopedProcessedMembers || [];
  if (query) {
    items = items.filter(m => m.name.toLowerCase().includes(query));
  }

  listContainer.innerHTML = "";

  if (items.length === 0) {
    listContainer.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.88rem;">無符合搜尋條件的成員</div>`;
    return;
  }

  // Slice items to show only the specified limit
  const visibleItems = items.slice(0, limit);

  // Determine if current user is a leader who can send care reminders
  const _careRole = (state.currentUser && state.currentUser.role) || "member";
  const _canSendCare = ["group_leader", "zone_leader", "great_zone_leader", "senior_pastor", "admin"].includes(_careRole);

  visibleItems.forEach(m => {
    const itemRow = document.createElement("div");
    itemRow.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 80px 80px 70px 90px${_canSendCare && !m.isMe ? ' 44px' : ''};
      gap: 0.4rem;
      align-items: center;
      padding: 0.6rem 0.2rem;
      border-bottom: 1px solid var(--border-card);
      font-size: 0.88rem;
      font-weight: 500;
      text-align: center;
    `;
    if (m.isMe) {
      itemRow.style.background = "var(--color-brand-muted, rgba(4,169,210,0.08))";
      itemRow.style.borderRadius = "8px";
    }

    itemRow.innerHTML = `
      <div style="text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${m.isMe ? 'var(--primary-color)' : 'var(--text-primary)'};">
        ${escapeHTML(m.name)}
      </div>
      <div class="text-danger">${m.streak}</div>
      <div class="text-success-fg">${m.completed}</div>
      <div class="text-warning">${m.makeup}</div>
      <div style="color: ${m.statusColor}; font-size: 0.8rem;">${m.statusStr}</div>
    `;

    // 💌 關心戳一下按鈕（僅限領袖，自己的列不顯示）
    if (_canSendCare && !m.isMe) {
      const careBtn = document.createElement("button");
      careBtn.title = "傳送關心提醒";
      careBtn.setAttribute("aria-label", `關心 ${m.name}`);
      careBtn.style.cssText = `
        display: flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; border-radius: 50%;
        border: 1px solid var(--border-card);
        background: var(--bg-input);
        cursor: pointer; transition: background 0.18s, border-color 0.18s;
        margin: 0 auto;
        color: var(--color-warning-text, #D97706);
        flex-shrink: 0;
      `;
      careBtn.innerHTML = `<span class="nlc-icon nlc-icon--sm" data-icon="remind" aria-hidden="true"></span>`;
      careBtn.addEventListener("mouseenter", () => {
        careBtn.style.background = "var(--color-warning-muted, rgba(251,191,36,0.15))";
        careBtn.style.borderColor = "var(--color-warning-text, #D97706)";
      });
      careBtn.addEventListener("mouseleave", () => {
        careBtn.style.background = "var(--bg-input)";
        careBtn.style.borderColor = "var(--border-card)";
      });
      careBtn.onclick = () => window.openCareReminderDialog(m);
      itemRow.appendChild(careBtn);
      if (typeof hydrateIcons === "function") hydrateIcons(careBtn);
    }

    listContainer.appendChild(itemRow);
  });

  // If there are remaining items, append a "Load More" button at the bottom of the list
  if (items.length > limit) {
    const loadMoreRow = document.createElement("div");
    loadMoreRow.style.cssText = `
      text-align: center;
      padding: 0.8rem;
      margin-top: 0.4rem;
    `;

    const loadMoreBtn = document.createElement("button");
    loadMoreBtn.className = "btn-secondary";
    loadMoreBtn.style.cssText = `
      padding: 0.4rem 1.2rem;
      font-size: 0.8rem;
      font-weight: 500;
      border-radius: 20px;
      background: var(--bg-input);
      border: 1px solid var(--border-card);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
    `;
    loadMoreBtn.textContent = `載入更多成員 (剩餘 ${items.length - limit} 人)`;
    loadMoreBtn.onclick = () => {
      window.displayParticipantsList(limit + 100);
    };

    loadMoreRow.appendChild(loadMoreBtn);
    listContainer.appendChild(loadMoreRow);
  }
}

// ==================== 組員狀況 TAB ====================
async function renderPlanMembersView() {
  if (!state.activePlan) return;

  // Make sure selectors are populated correctly
  populateMembersSelector();



  // Use members-ranking-title element instead of ranking-title so the title
  // updates show up in the members subview card.
  const membersTitleEl = document.getElementById("members-ranking-title");
  if (membersTitleEl) {
    // Temporarily swap the id so the shared function writes to the right element
    const rankingTitleEl = document.getElementById("ranking-title");
    if (rankingTitleEl) rankingTitleEl.id = "_ranking-title-backup";
    membersTitleEl.id = "ranking-title";
    await renderGroupParticipantsRankingTable();
    membersTitleEl.id = "members-ranking-title";
    if (rankingTitleEl) rankingTitleEl.id = "ranking-title";
  } else {
    await renderGroupParticipantsRankingTable();
  }
}

window.showPlanStatsModal = function () {
  if (!state.activePlan) {
    showToast((window.APP_COPY && window.APP_COPY.plan.noPlanJoined) || "還沒加入任何計畫");
    return;
  }

  const plan = state.activePlan;
  const streakDays = state.currentUser.streak || 0;

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
      let isRead = false;
      if (taskRound === 1) isRead = ch.isReadR1 || ch.isRead;
      else if (taskRound === 2) isRead = ch.isReadR2;
      else if (taskRound >= 3) isRead = ch.isReadR3;
      else isRead = ch.isRead;
      if (isRead) todayReadCount++;
    });
  }

  // 2. Calculate overall plan progress
  const totalCompletionRate = plan.progress || 0;

  // 3. Calculate catch-up days (進度救援)
  const start = new Date(plan.startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(plan.endDate);
  end.setHours(0, 0, 0, 0);
  const totalDays = plan.totalDays || (Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
  const todayZero = new Date();
  todayZero.setHours(0, 0, 0, 0);
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.round((todayZero - start) / (1000 * 60 * 60 * 24)) + 1));
  const targetRounds = getPlanLevelRounds(plan.level || "normal");

  let catchUpDays = 0;
  // 補讀只屬於第一遍；重讀進度不應疊加到補讀天數。
  for (let r = 1; r <= 1; r++) {
    plan.days.forEach((day, index) => {
      const d = index + 1;
      const scheduledDate = new Date(start);
      scheduledDate.setDate(start.getDate() + (d - 1));
      const scheduledDateStr = scheduledDate.toISOString().substring(0, 10);

      const roundLogs = (state.readingLogs || []).filter(l =>
        (l.plan_id === plan.id || l.presetKey === plan.presetKey) &&
        (l.round || 1) === r
      );

      let allChaptersCompleted = true;
      let maxReadDateStr = "";

      for (const ch of day.chapters) {
        const log = roundLogs.find(l => l.book === ch.book && l.chapter === ch.chapter);
        if (!log) {
          allChaptersCompleted = false;
          break;
        }
        const logDateStr = log.read_at.substring(0, 10);
        if (!maxReadDateStr || logDateStr > maxReadDateStr) {
          maxReadDateStr = logDateStr;
        }
      }

      if (allChaptersCompleted && maxReadDateStr) {
        if (maxReadDateStr > scheduledDateStr) {
          catchUpDays++;
        }
      }
    });
  }

  // 4. Calculate cumulative chapters read (累計閱讀)
  const currentPlanId = plan.id;
  const currentPresetKey = plan.presetKey;
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
      const logMatchesPlan =
        (currentPlanId && l.plan_id && l.plan_id === currentPlanId) ||
        (currentPresetKey && l.presetKey && l.presetKey === currentPresetKey) ||
        (!l.plan_id && !l.presetKey);
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
      if (taskRound === 1) return ch.isReadR1 || ch.isRead;
      if (taskRound === 2) return ch.isReadR2;
      if (taskRound >= 3) return ch.isReadR3;
      return ch.isRead;
    });
  }).length;

  // 6. Calculate progress status (計畫狀態)
  let equivalentDay = 0;
  const cumulativeScheduled = [];
  let sumChapters = 0;
  for (let i = 0; i < plan.days.length; i++) {
    sumChapters += plan.days[i].chapters.length;
    cumulativeScheduled.push(sumChapters * targetRounds);
  }

  // Calculate actual completed chapters across rounds
  let actualCompletedChaptersTotal = 0;
  for (let r = 1; r <= targetRounds; r++) {
    const roundLogs = (state.readingLogs || []).filter(l =>
      (l.plan_id === plan.id || l.presetKey === plan.presetKey) &&
      (l.round || 1) === r
    );
    const uniqueChapters = new Set(roundLogs.map(l => `${l.book}_${l.chapter}`));

    let planChaptersCount = 0;
    plan.days.forEach(day => {
      day.chapters.forEach(ch => {
        if (uniqueChapters.has(`${ch.book}_${ch.chapter}`)) {
          planChaptersCount++;
        }
      });
    });
    actualCompletedChaptersTotal += planChaptersCount;
  }

  for (let d = 1; d <= plan.days.length; d++) {
    if (actualCompletedChaptersTotal >= cumulativeScheduled[d - 1]) {
      equivalentDay = d;
    } else {
      break;
    }
  }

  const progressStatus = getPlanProgressStatus(plan);
  const statusLabel = progressStatus.label;
  const statusBadgeClass = progressStatus.badgeClass || "stat-badge--brand";

  // Mandatory debug log injection representing modal useEffect mount hook
  console.log('📊 [統計面板載入] 真實讀取 -> 累計章數:', totalReadChapters, '成功追回天數:', catchUpDays);

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
    <button class="circular-action-btn" style="width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border-card); background: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; color: var(--text-secondary);" onclick="this.closest('.modal-overlay').remove()" aria-label="關閉"><span class="nlc-icon" data-icon="closeLg" aria-hidden="true"></span></button>
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
        <div style="font-size: 0.82rem; font-weight: 500; color: var(--text-secondary); display: flex; align-items: center; gap: 0.3rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">
          ${title}
        </div>
        <div style="font-size: 1.45rem; font-weight: 500; color: ${iconColor}; margin: 0.3rem 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">
          ${dataText}
        </div>
        <div style="font-size: 0.65rem; color: var(--text-muted); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; font-weight: 500;">
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
    `#ea580c`,
    `background: rgba(254, 118, 21, 0.06);`
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
    font-size: 0.85rem;
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



// --- Stats View Logic ---

// Statistics & charts tab view controller


async function updateStatsView(filterPresetKey = null) {
  // If no filter is provided, fallback to the current active plan's global key.
  if (!filterPresetKey && state.activePlan) {
    filterPresetKey = state.activePlan.globalPlanId || state.activePlan.presetKey || state.activePlan.name || state.activePlan.id;
  }
  window.currentStatsFilterPresetKey = filterPresetKey;

  const statsTableBody = document.getElementById("stats-members-table-body");
  const statsValueIds = ["stats-total-read", "stats-total-members", "stats-active-members"];
  if (typeof ComponentSkeletonLoader !== "undefined") {
    if (statsTableBody) ComponentSkeletonLoader.fill("table-rows", statsTableBody, { count: 5, cols: 6 });
    statsValueIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.dataset.statsOriginalHtml = el.innerHTML;
        el.innerHTML = ComponentSkeletonLoader.getHtml("inline", { width: "3.5rem", height: "1.1rem" });
      }
    });
  }

  let pastoralStats = [];
  let rawAllUsers = [];

  // Pass filterPresetKey to fetchMergedUsersList so stats are plan-specific!
  const unfilteredAllUsers = await db.fetchMergedUsersList(filterPresetKey);
  window.unfilteredAllUsersCache = unfilteredAllUsers;

  const mockUser = unfilteredAllUsers.find(u => u.name === state.currentUser.name) || {
    name: state.currentUser.name,
    great_region: state.currentUser.great_region || "東區",
    pastoral_zone: state.currentUser.pastoral_zone || "大安1",
    small_group: state.currentUser.small_group || "馬鈴",
    role: state.currentUser.role || "member",
    chapters_read: 0,
    plan_progress: 0,
    last_read: null
  };
  window.mockUserCache = mockUser;
  rawAllUsers = [...unfilteredAllUsers];

  const role = mockUser.role;

  // Dynamically calculate pastoralStats in frontend from the filtered users list!
  const zoneMap = {};
  unfilteredAllUsers.forEach(u => {
    const zone = u.pastoral_zone || "未知";
    const region = u.great_region || "未知";
    if (!zoneMap[zone]) {
      zoneMap[zone] = {
        name: zone,
        great_region: region,
        member_count: 0,
        total_chapters: 0,
        total_progress: 0,
        active_count: 0
      };
    }
    zoneMap[zone].member_count++;
    zoneMap[zone].total_chapters += u.chapters_read || 0;
    zoneMap[zone].total_progress += u.plan_progress || 0;
    if (u.chapters_read > 0) {
      zoneMap[zone].active_count++;
    }
  });

  pastoralStats = Object.values(zoneMap).map(item => ({
    name: item.name,
    great_region: item.great_region,
    member_count: item.member_count,
    total_chapters: item.total_chapters,
    avg_progress: Math.round(item.total_progress / item.member_count) || 0,
    active_count: item.active_count
  })).sort((a, b) => b.total_chapters - a.total_chapters);

  rawAllUsers = getScopedUsers(rawAllUsers, mockUser);

  // Filter pastoralStats based on Great Region for non-admin roles
  if (role !== "admin" && role !== "senior_pastor") {
    pastoralStats = pastoralStats.filter(z => z.great_region === mockUser.great_region);
  }

  // 1. Determine Stats Scoped Users
  let statsUsers = [];
  if (role === "senior_pastor" || role === "admin") {
    const zoneSelectGroup = document.getElementById("stats-zone-selector");
    const selectedZone = zoneSelectGroup ? zoneSelectGroup.value : "";
    if (selectedZone) {
      statsUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === selectedZone);
    } else {
      statsUsers = unfilteredAllUsers;
    }
  } else if (role === "great_zone_leader") {
    statsUsers = unfilteredAllUsers.filter(u => u.great_region === mockUser.great_region);
  } else if (role === "zone_leader") {
    statsUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === mockUser.pastoral_zone);
  } else { // group_leader or member
    statsUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === mockUser.pastoral_zone && u.small_group === mockUser.small_group);
  }

  if (statsUsers.length === 0) {
    statsUsers = [mockUser];
  }

  // 2. Update Mini Card Labels based on Scoped Team
  const miniCardLabels = document.querySelectorAll('.stats-overview-row .label');
  if (miniCardLabels.length === 3) {
    if (role === "senior_pastor" || role === "admin") {
      const zoneSelectGroup = document.getElementById("stats-zone-selector");
      const selectedZone = zoneSelectGroup ? zoneSelectGroup.value : "";
      miniCardLabels[0].textContent = selectedZone ? `${selectedZone} 總閱讀章數` : "全教會總閱讀章數";
      miniCardLabels[1].textContent = selectedZone ? `${selectedZone} 參與人數` : "全教會參與人數";
      miniCardLabels[2].textContent = selectedZone ? `${selectedZone} 本週活躍人數` : "全教會本週活躍人數";
    } else if (role === "great_zone_leader") {
      miniCardLabels[0].textContent = "本大區總閱讀章數";
      miniCardLabels[1].textContent = "本大區參與人數";
      miniCardLabels[2].textContent = "本大區本週活躍人數";
    } else if (role === "zone_leader") {
      miniCardLabels[0].textContent = "本牧區總閱讀章數";
      miniCardLabels[1].textContent = "本牧區參與人數";
      miniCardLabels[2].textContent = "本牧區本週活躍人數";
    } else { // group_leader or member
      miniCardLabels[0].textContent = "本小組總閱讀章數";
      miniCardLabels[1].textContent = "本小組參與人數";
      miniCardLabels[2].textContent = "本小組本週活躍人數";
    }
  }

  // 3. Render Mini Card values
  const totalChaptersAll = statsUsers.reduce((sum, item) => sum + (item.chapters_read || 0), 0);
  const totalMembers = statsUsers.length;
  const totalActive = statsUsers.filter(u => {
    if (!u.last_read) return false;
    const lastReadDate = new Date(u.last_read);
    const today = new Date();
    const diffTime = Math.abs(today - lastReadDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 2;
  }).length;

  document.getElementById("stats-total-read").textContent = totalChaptersAll + " 章";
  document.getElementById("stats-total-members").textContent = totalMembers + " 人";
  document.getElementById("stats-active-members").textContent = totalActive + " 人";

  // 3. Render Roster Details Table
  renderRosterTable(rawAllUsers);

  // 4. Handle Chart visibility and rendering
  const chartsContainer = document.getElementById("pastoral-rank-chart").closest('.grid-layout');
  const groupChartContainer = document.getElementById("group-stats-chart").closest('.grid-layout');
  const zoneSelectGroup = document.getElementById("stats-zone-selector");

  // Show both charts to everyone, but apply filters/locks by role
  chartsContainer.classList.remove("hidden");
  groupChartContainer.classList.remove("hidden");

  if (role === "member" || role === "group_leader" || role === "zone_leader") {
    zoneSelectGroup.innerHTML = `<option value="${mockUser.pastoral_zone}">${mockUser.pastoral_zone}</option>`;
    zoneSelectGroup.value = mockUser.pastoral_zone;
    zoneSelectGroup.disabled = true;

    renderCharts(pastoralStats);
    updateGroupChart(mockUser.pastoral_zone);
  } else {
    zoneSelectGroup.disabled = false;

    populateStatsZoneSelector(pastoralStats);
    renderCharts(pastoralStats);
  }

  // Render Monthly Hall of Fame
  renderMonthlyHallOfFame();

  // Render Heatmap and Badges Wall
  renderHeatmap(statsUsers);
  if (typeof renderUnlockedBadgesWall !== 'undefined') {
    renderUnlockedBadgesWall();
  }

  // Render Team Progress Status & Growth Trend Dashboard
  renderTeamStatsAnalysisDashboard(unfilteredAllUsers, mockUser);

  if (typeof ComponentSkeletonLoader !== "undefined") {
    statsValueIds.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.dataset.statsOriginalHtml !== undefined) {
        delete el.dataset.statsOriginalHtml;
      }
    });
  }
}

function renderRosterTable(users) {
  const tbody = document.getElementById("stats-members-table-body");
  tbody.innerHTML = "";

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">尚無使用者資料</td></tr>`;
    return;
  }

  // Sort by chapters read descending
  const sorted = [...users].sort((a, b) => b.chapters_read - a.chapters_read);
  sorted.forEach(user => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHTML(user.name)}</strong></td>
      <td>${escapeHTML(user.pastoral_zone || "無")}</td>
      <td>${escapeHTML(user.small_group || "無")}</td>
      <td><span style="font-weight: 500; color: var(--primary-color);">${user.chapters_read}</span> 章</td>
      <td>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="font-size:0.8rem; font-weight: 500;">${user.plan_progress}%</span>
          <div style="flex:1; width:50px; height:6px; background: var(--color-progress-track); border-radius:5px; overflow:hidden;">
            <div style="width:${user.plan_progress}%; height:100%; background: var(--color-success);"></div>
          </div>
        </div>
      </td>
      <td>🔥 ${user.streak || 0} 天</td>
    `;
    tbody.appendChild(tr);
  });
}

function populateStatsZoneSelector(zones) {
  const selector = document.getElementById("stats-zone-selector");
  selector.innerHTML = "";

  zones.forEach(zone => {
    const option = document.createElement("option");
    option.value = zone.name;
    option.textContent = zone.name;
    selector.appendChild(option);
  });

  selector.onchange = () => {
    updateGroupChart(selector.value);
    if (typeof renderTeamStatsAnalysisDashboard === 'function') {
      renderTeamStatsAnalysisDashboard(window.unfilteredAllUsersCache, window.mockUserCache);
    }
  };

  if (zones.length > 0) {
    updateGroupChart(zones[0].name);
  }
}

function renderCharts(zoneStats) {
  const ctxRank = document.getElementById("pastoral-rank-chart").getContext("2d");
  const ctxProgress = document.getElementById("pastoral-progress-chart").getContext("2d");

  if (state.statsCharts.rank) state.statsCharts.rank.destroy();
  if (state.statsCharts.progress) state.statsCharts.progress.destroy();

  const labels = zoneStats.map(z => z.name);
  const chaptersData = zoneStats.map(z => z.total_chapters);
  const progressData = zoneStats.map(z => z.avg_progress);

  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
  const fontColor = isDark ? NLC_CHART.muted : NLC_DESIGN.black;
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

  // Chart 1: Ranking Chart
  state.statsCharts.rank = new Chart(ctxRank, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '累計速讀章數',
        data: chaptersData,
        backgroundColor: [
          'rgba(4, 169, 210, 0.85)',
          'color-mix(in srgb, var(--color-success) 85%, transparent)',
          'rgba(245, 158, 11, 0.85)',
          'rgba(252, 54, 90, 0.85)'
        ],
        borderRadius: 8,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { ticks: { color: fontColor }, grid: { display: false } },
        y: { ticks: { color: fontColor }, grid: { color: gridColor } }
      }
    }
  });

  // Chart 2: Average Progress Chart
  state.statsCharts.progress = new Chart(ctxProgress, {
    type: 'radar',
    data: {
      labels: labels,
      datasets: [{
        label: '平均進度 (%)',
        data: progressData,
        backgroundColor: 'rgba(4, 169, 210, 0.2)',
        borderColor: 'rgba(4, 169, 210, 0.9)',
        borderWidth: 2,
        pointBackgroundColor: '#04A9D2'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        r: {
          angleLines: { color: gridColor },
          grid: { color: gridColor },
          pointLabels: { color: fontColor, font: { weight: 'bold' } },
          ticks: { backdropColor: 'transparent', color: fontColor, min: 0, max: 100 }
        }
      }
    }
  });
}

async function updateGroupChart(zoneName) {
  const ctxGroup = document.getElementById("group-stats-chart").getContext("2d");
  if (state.statsCharts.group) state.statsCharts.group.destroy();

  let groupStats = [];
  const mockUser = {
    name: state.currentUser.name,
    pastoral_zone: state.currentUser.pastoral_zone || "大安1",
    small_group: state.currentUser.small_group || "馬鈴",
    chapters_read: state.currentUser.chapters_read,
    plan_progress: state.currentUser.plan_progress,
    last_read: state.currentUser.last_read
  };

  if (state.isSupabaseMode && state.supabase) {
    try {
      const { data } = await state.supabase
        .from("view_small_group_stats")
        .select("*")
        .eq("pastoral_zone", zoneName);

      if (data) {
        groupStats = data.map(item => ({
          name: item.small_group,
          total_chapters: item.total_chapters_read
        })).sort((a, b) => b.total_chapters - a.total_chapters);
      }
    } catch (e) {
      console.error("Failed to load small group stats from Supabase:", e);
    }
  } else {
    // Demo Mode
    groupStats = MockStatsService.getSmallGroupStats(zoneName, mockUser);
  }

  const labels = groupStats.map(g => g.name);
  const data = groupStats.map(g => g.total_chapters);

  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
  const fontColor = isDark ? NLC_CHART.muted : NLC_DESIGN.black;
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

  state.statsCharts.group = new Chart(ctxGroup, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '累計章數',
        data: data,
        backgroundColor: 'color-mix(in srgb, var(--color-success) 80%, transparent)',
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { ticks: { color: fontColor }, grid: { color: gridColor } },
        y: { ticks: { color: fontColor }, grid: { display: false } }
      }
    }
  });
}

function renderMonthlyHallOfFame() {
  const fameList = document.getElementById("monthly-fame-list");
  if (!fameList) return;

  fameList.innerHTML = "";

  const urlParams = new URLSearchParams(window.location.search);
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  const forceOfflineDemo = isLocalhost && (urlParams.get("demo") === "true" || urlParams.get("offline") === "true");
  const showDemoData = (forceOfflineDemo && typeof MockStatsService !== 'undefined' && MockStatsService !== null) || (state.currentUser && !!state.currentUser.is_demo);
  if (!showDemoData) {
    const placeholder = document.createElement("div");
    placeholder.style.cssText = "grid-column: span 3; text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.9rem;";
    placeholder.textContent = "正式計畫尚未結算，月度名人堂虛位以待！";
    fameList.appendChild(placeholder);
    return;
  }

  const winners = [
    {
      month: "2026年6月 (本月累計)",
      top3: [
        { rank: "gold", name: "示範組長丁", zone: "大安6", chapters: 980 },
        { rank: "silver", name: "示範組長戊", zone: "中永和", chapters: 800 },
        { rank: "bronze", name: "東區大區長", zone: "大安1", chapters: 750 }
      ]
    },
    {
      month: "2026年5月 (結算前三)",
      top3: [
        { rank: "gold", name: "示範組長乙", zone: "大安2", chapters: 650 },
        { rank: "silver", name: "示範組員八", zone: "文山", chapters: 620 },
        { rank: "bronze", name: "東區區長", zone: "大安1", chapters: 600 }
      ]
    },
    {
      month: "2026年4月 (結算前三)",
      top3: [
        { rank: "gold", name: "示範組員五", zone: "大安6", chapters: 540 },
        { rank: "silver", name: "示範組員二", zone: "大安1", chapters: 520 },
        { rank: "bronze", name: "示範組長甲", zone: "大安1", chapters: 480 }
      ]
    }
  ];

  winners.forEach(w => {
    const item = document.createElement("div");
    item.className = "monthly-fame-item";

    const title = document.createElement("div");
    title.className = "monthly-fame-month";
    title.textContent = w.month;
    item.appendChild(title);

    w.top3.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "fame-row";

      const rankSpan = document.createElement("span");
      rankSpan.className = `fame-rank ${t.rank}`;
      rankSpan.textContent = i + 1;
      row.appendChild(rankSpan);

      const nameSpan = document.createElement("span");
      nameSpan.className = "fame-name";
      nameSpan.textContent = `${t.name} (${t.zone})`;
      row.appendChild(nameSpan);

      const valSpan = document.createElement("span");
      valSpan.className = "fame-value";
      valSpan.textContent = `${t.chapters} 章`;
      row.appendChild(valSpan);

      item.appendChild(row);
    });

    fameList.appendChild(item);
  });
}

// ==========================================
// TEAM BIBLE READING HEATMAP
// ==========================================

function getTeamLogs(teamUsers) {
  const filterPresetKey = window.currentStatsFilterPresetKey;
  if (state.isSupabaseMode && state.allLogsCache) {
    const userIds = new Set(teamUsers.map(u => u.id));
    return state.allLogsCache.filter(l => {
      if (!userIds.has(l.user_id)) return false;
      if (filterPresetKey) {
        const cacheKey = l.user_id + '_' + filterPresetKey;
        if (window.userPlanIdCache && window.userPlanIdCache[cacheKey]) {
          return l.plan_id === window.userPlanIdCache[cacheKey];
        }
        if (l.user_id === state.currentUser.id && state.activePlan) {
          return l.plan_id === state.activePlan.id;
        }
        return false;
      }
      return true;
    });
  } else {
    // Generate mock logs for team users based on their chapters_read and last_read
    const logs = [];

    // Include current user's real logs
    const currentUserRealLogs = state.readingLogs.filter(l => {
      if (filterPresetKey) {
        return l.presetKey === filterPresetKey || (state.activePlan && l.plan_id === state.activePlan.id);
      }
      return true;
    }).map(l => ({
      user_id: state.currentUser.id || state.currentUser.name,
      read_at: l.read_at
    }));
    logs.push(...currentUserRealLogs);

    const otherUsers = teamUsers.filter(u => u.name !== state.currentUser.name);
    otherUsers.forEach(u => {
      if (!u.chapters_read) return;

      const lastReadDateStr = u.last_read || new Date().toISOString().substring(0, 10);
      const lastReadDate = new Date(lastReadDateStr);
      lastReadDate.setHours(12, 0, 0, 0);

      let chaptersRemaining = u.chapters_read;
      // We will distribute the check-ins backwards from lastReadDate
      let currentDate = new Date(lastReadDate);

      // Let's generate daily check-ins
      for (let i = 0; i < 365 && chaptersRemaining > 0; i++) {
        const seed = Math.sin(u.name.charCodeAt(0) + i) * 10000;
        const rand = seed - Math.floor(seed);

        if (rand < 0.35) {
          const count = Math.min(chaptersRemaining, Math.floor(rand * 5) + 1);
          const dateStr = currentDate.toISOString().substring(0, 10);
          for (let c = 0; c < count; c++) {
            logs.push({
              user_id: u.id || u.name,
              read_at: dateStr
            });
          }
          chaptersRemaining -= count;
        }
        currentDate.setDate(currentDate.getDate() - 1);
      }
    });
    return logs;
  }
}

function renderHeatmap(teamUsers = []) {
  const container = document.getElementById("bible-heatmap-container");
  if (!container) return;

  container.innerHTML = "";

  // Title update based on scope
  const titleEl = document.getElementById("heatmap-card-title");
  if (titleEl) {
    const role = state.currentUser.role || "member";
    if (role === "senior_pastor" || role === "admin") {
      const zoneSelectGroup = document.getElementById("stats-zone-selector");
      const selectedZone = zoneSelectGroup ? zoneSelectGroup.value : "";
      titleEl.textContent = selectedZone
        ? `${selectedZone} 團隊讀經活躍度 (近4個月打卡活躍度)`
        : "全教會團隊讀經活躍度 (近4個月打卡活躍度)";
    } else if (role === "great_zone_leader") {
      titleEl.textContent = `${state.currentUser.great_region} 團隊讀經活躍度 (近4個月打卡活躍度)`;
    } else if (role === "zone_leader") {
      titleEl.textContent = `${state.currentUser.pastoral_zone} 團隊讀經活躍度 (近4個月打卡活躍度)`;
    } else {
      titleEl.textContent = `${state.currentUser.small_group} 小組讀經活躍度 (近4個月打卡活躍度)`;
    }
  }

  // Build logs-by-date map from team logs
  const teamLogs = getTeamLogs(teamUsers);
  const logsByDate = {};
  teamLogs.forEach(log => {
    if (log.read_at) {
      const dStr = log.read_at.substring(0, 10);
      logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
    }
  });

  const planStart = state.activePlan ? state.activePlan.startDate : null;
  const planEnd = state.activePlan ? state.activePlan.endDate : null;
  buildHeatmapGrid("bible-heatmap-container", logsByDate, teamUsers.length, "章", planStart, planEnd);
}

// ==========================================
// TEAM STATISTICS ANALYSIS & GROWTH TREND
// ==========================================

function renderTeamStatsAnalysisDashboard(unfilteredAllUsers, mockUser) {
  let teamUsers = [];
  const role = mockUser.role || 'member';

  if (role === 'admin' || role === 'senior_pastor') {
    const zoneSelectGroup = document.getElementById("stats-zone-selector");
    const selectedZone = zoneSelectGroup ? zoneSelectGroup.value : "";
    if (selectedZone) {
      teamUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === selectedZone);
    } else {
      teamUsers = unfilteredAllUsers;
    }
  } else if (role === 'great_zone_leader') {
    teamUsers = unfilteredAllUsers.filter(u => u.great_region === mockUser.great_region);
  } else if (role === 'zone_leader') {
    teamUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === mockUser.pastoral_zone);
  } else {
    // member or group_leader
    teamUsers = unfilteredAllUsers.filter(u => u.pastoral_zone === mockUser.pastoral_zone && u.small_group === mockUser.small_group);
  }

  if (teamUsers.length === 0) {
    teamUsers = [mockUser];
  }

  const totalTeamCount = teamUsers.length;

  // 1. Completion Rate Today
  const todayStr = new Date().toISOString().substring(0, 10);
  const completedTodayCount = teamUsers.filter(u => u.last_read === todayStr).length;
  const todayCompletionRate = totalTeamCount > 0 ? Math.round((completedTodayCount / totalTeamCount) * 100) : 0;

  document.getElementById("team-today-completion-rate").textContent = todayCompletionRate + "%";

  // 2. Expected progress percentage
  let expectedPercentage = 0;
  if (state.activePlan) {
    const start = new Date(state.activePlan.startDate);
    const end = new Date(state.activePlan.endDate);
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const today = new Date();
    const elapsedDays = Math.max(0, Math.min(totalDays, Math.ceil((today - start) / (1000 * 60 * 60 * 24)) + 1));
    expectedPercentage = Math.round((elapsedDays / totalDays) * 100) || 0;
  } else {
    expectedPercentage = 50;
  }

  let aheadCount = 0;
  let onScheduleCount = 0;
  let behindCount = 0;
  let round2PlusCount = 0;

  teamUsers.forEach(u => {
    // Determine round proxy if round field is undefined (e.g. mock data)
    const round = u.current_round !== undefined
      ? u.current_round
      : (u.chapters_read > 500 ? (u.chapters_read > 850 ? 3 : 2) : 1);

    if (round >= 2) {
      round2PlusCount++;
      aheadCount++;
      return;
    }

    if (u.plan_progress === 0) {
      behindCount++;
    } else if (u.plan_progress > expectedPercentage + 5) {
      aheadCount++;
    } else if (u.plan_progress < expectedPercentage - 5) {
      behindCount++;
    } else {
      onScheduleCount++;
    }
  });

  const aheadRate = totalTeamCount > 0 ? Math.round((aheadCount / totalTeamCount) * 100) : 0;
  const onScheduleRate = totalTeamCount > 0 ? Math.round((onScheduleCount / totalTeamCount) * 100) : 0;
  const behindRate = totalTeamCount > 0 ? Math.round((behindCount / totalTeamCount) * 100) : 0;
  const round2PlusRate = totalTeamCount > 0 ? Math.round((round2PlusCount / totalTeamCount) * 100) : 0;

  document.getElementById("team-stat-ahead-label").textContent = `${aheadCount} 人 (${aheadRate}%)`;
  document.getElementById("team-stat-on-schedule-label").textContent = `${onScheduleCount} 人 (${onScheduleRate}%)`;
  document.getElementById("team-stat-behind-label").textContent = `${behindCount} 人 (${behindRate}%)`;
  document.getElementById("team-stat-round2-label").textContent = `${round2PlusCount} 人 (${round2PlusRate}%)`;

  document.getElementById("team-stat-ahead-bar").style.width = aheadRate + "%";
  document.getElementById("team-stat-on-schedule-bar").style.width = onScheduleRate + "%";
  document.getElementById("team-stat-behind-bar").style.width = behindRate + "%";
  document.getElementById("team-stat-round2-bar").style.width = round2PlusRate + "%";

  // 3. Render Growth Trend Chart
  const ctxGrowth = document.getElementById("team-growth-chart").getContext("2d");
  if (state.statsCharts.growth) state.statsCharts.growth.destroy();

  const totalActiveMembers = teamUsers.filter(u => u.chapters_read > 0).length;
  const trendData = [];
  const trendLabels = [];
  const todayDateObj = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayDateObj);
    d.setDate(todayDateObj.getDate() - i);
    trendLabels.push(d.toISOString().substring(5, 10).replace('-', '/'));

    const factor = 0.8 + (6 - i) * 0.033;
    trendData.push(Math.round(totalActiveMembers * factor));
  }

  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
  const fontColor = isDark ? NLC_CHART.muted : NLC_DESIGN.black;
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";

  state.statsCharts.growth = new Chart(ctxGrowth, {
    type: 'line',
    data: {
      labels: trendLabels,
      datasets: [{
        label: '參與人數',
        data: trendData,
        borderColor: '#04A9D2',
        backgroundColor: 'var(--color-brand-subtle, rgba(4,169,210,0.12))',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#04A9D2'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { ticks: { color: fontColor }, grid: { display: false } },
        y: { ticks: { color: fontColor, stepSize: 1 }, grid: { color: gridColor } }
      }
    }
  });

  // Render personal stats card
  renderProfileReadingStats();

  // Render team heatmap
  renderHeatmap(teamUsers);
}

// ─────────────────────────────────────────────
// Personal Reading Stats Calculation & Rendering (Migrated from profile.js)
// ─────────────────────────────────────────────

/**
 * Calculate reading statistics for the active plan.
 */
function calculateProfileStats(plan) {
  if (!plan) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(plan.startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(plan.endDate);
  end.setHours(0, 0, 0, 0);

  const totalDays = plan.totalDays || (Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.round((today - start) / (1000 * 60 * 60 * 24)) + 1));

  const level = plan.level || 'normal';
  let targetRounds = 1;
  if (level === 'breakthrough') targetRounds = 2;
  else if (level === 'super') targetRounds = 3;

  // 1. Calculate actual completed chapters across all relevant rounds
  let actualCompletedChapters = 0;
  for (let r = 1; r <= targetRounds; r++) {
    const roundLogs = state.readingLogs.filter(l =>
      (l.plan_id === plan.id || l.presetKey === plan.presetKey) &&
      (l.round || 1) === r
    );
    const uniqueChapters = new Set(roundLogs.map(l => `${l.book}_${l.chapter}`));

    let planChaptersCount = 0;
    plan.days.forEach(day => {
      day.chapters.forEach(ch => {
        if (uniqueChapters.has(`${ch.book}_${ch.chapter}`)) {
          planChaptersCount++;
        }
      });
    });
    actualCompletedChapters += planChaptersCount;
  }

  // 2. Build cumulative scheduled chapters list
  const cumulativeScheduled = [];
  let sum = 0;
  for (let i = 0; i < totalDays; i++) {
    sum += plan.days[i].chapters.length;
    cumulativeScheduled.push(sum * targetRounds);
  }

  // 3. Find equivalent day completed
  let equivalentDay = 0;
  for (let d = 1; d <= totalDays; d++) {
    if (actualCompletedChapters >= cumulativeScheduled[d - 1]) {
      equivalentDay = d;
    } else {
      break;
    }
  }

  // 4. Calculate lag and lead days
  let lagDays = 0;
  let leadDays = 0;

  const currentRound = plan.currentRound || 1;
  // If currentRound >= 4, the user is in self-managed phase, no lag/lead scheduling checks
  if (currentRound < 4 && elapsedDays > 0) {
    const diff = equivalentDay - elapsedDays;
    if (diff > 0) {
      leadDays = diff;
    } else if (diff < 0) {
      lagDays = -diff;
    }
  }

  // 5. Calculate makeup days
  let makeupDays = 0;
  // 超過第一遍後都是超前，不再累加補讀天數。
  for (let r = 1; r <= 1; r++) {
    plan.days.forEach((day, index) => {
      const d = index + 1;

      const scheduledDate = new Date(start);
      scheduledDate.setDate(start.getDate() + (d - 1));
      const scheduledDateStr = scheduledDate.toISOString().substring(0, 10);

      const roundLogs = state.readingLogs.filter(l =>
        (l.plan_id === plan.id || l.presetKey === plan.presetKey) &&
        (l.round || 1) === r
      );

      let allChaptersCompleted = true;
      let maxReadDateStr = "";

      for (const ch of day.chapters) {
        const log = roundLogs.find(l => l.book === ch.book && l.chapter === ch.chapter);
        if (!log) {
          allChaptersCompleted = false;
          break;
        }
        const logDateStr = log.read_at.substring(0, 10);
        if (!maxReadDateStr || logDateStr > maxReadDateStr) {
          maxReadDateStr = logDateStr;
        }
      }

      if (allChaptersCompleted && maxReadDateStr) {
        if (maxReadDateStr > scheduledDateStr) {
          makeupDays++;
        }
      }
    });
  }

  return {
    elapsedDays,
    totalDays,
    lagDays,
    leadDays,
    makeupDays,
    startDateStr: plan.startDate,
    endDateStr: plan.endDate,
    currentRound
  };
}

/**
 * Render personal reading stats card.
 */
function renderProfileReadingStats() {
  const container = document.getElementById("profile-reading-stats-container");
  if (!container) return;

  const streakDays = state.currentUser.streak || 0;
  const plan = state.activePlan;
  const stats = calculateProfileStats(plan);

  if (!plan || !stats) {
    // Empty state
    container.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
        <div style="margin: 0 auto 1rem; opacity: 0.6; display: block; width: 48px;">
          ${typeof renderIcon === "function" ? renderIcon("inbox", { size: "hero", className: "nlc-icon" }) : ""}
        </div>
        <p style="font-size: 0.9rem; font-weight: 500; margin-bottom: 0.5rem; color: var(--text-primary);">${(window.APP_COPY && window.APP_COPY.stats.noPlan) || "還沒加入讀經計畫"}</p>
        <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1.5rem;">
          請至「計畫」頁面選擇並加入，即可在此查看進度統計。
        </p>
        
        <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 0.8rem 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between; text-align: left;">
          <div style="display: flex; align-items: center; gap: 0.8rem;">
            <div class="stat-icon-wrapper stat-icon-wrapper--sm stat-icon-wrapper--danger">
              ${typeof renderIcon === "function" ? renderIcon("fire", { size: "sm", className: "nlc-icon" }) : ""}
            </div>
            <div>
              <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">連續讀經</div>
            </div>
          </div>
          <div class="stat-value stat-value--hero stat-value--danger">
            ${streakDays} <span class="stat-value__unit">天</span>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Determine Today's Progress display string
  let todayProgressText = "";
  const start = new Date(stats.startDateStr);
  const end = new Date(stats.endDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (today < start) {
    todayProgressText = `<span style="font-size: 0.8rem; font-weight: 500; color: var(--text-muted);">尚未開始 (開始於 ${stats.startDateStr})</span>`;
  } else if (today > end) {
    todayProgressText = `<span style="font-size: 0.8rem; font-weight: 500; color: var(--text-muted);">已結束 (共 ${stats.totalDays} 天)</span>`;
  } else {
    todayProgressText = `<span style="font-size: 1.25rem; font-weight: 500; color: var(--primary-color);">${stats.elapsedDays}</span> <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-secondary);">/ ${stats.totalDays} 天</span>`;
  }

  const lagDisplay = stats.lagDays > 0
    ? `${stats.lagDays} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">天</span>`
    : `<span style="font-size: 0.95rem; font-weight: 500; color: var(--text-muted);">0 天</span>`;

  const leadDisplay = stats.leadDays > 0
    ? `${stats.leadDays} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">天</span>`
    : `<span style="font-size: 0.95rem; font-weight: 500; color: var(--text-muted);">0 天</span>`;

  const makeupDisplay = stats.makeupDays > 0
    ? `${stats.makeupDays} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">天</span>`
    : `<span style="font-size: 0.95rem; font-weight: 500; color: var(--text-muted);">0 天</span>`;

  const lagIconClass = stats.lagDays > 0 ? "stat-icon-wrapper--danger" : "stat-icon-wrapper--neutral";
  const lagValueClass = stats.lagDays > 0 ? "stat-value--danger" : "stat-value--muted";
  const leadIconClass = stats.leadDays > 0 ? "stat-icon-wrapper--success" : "stat-icon-wrapper--neutral";
  const leadValueClass = stats.leadDays > 0 ? "stat-value--success" : "stat-value--muted";
  const makeupIconClass = stats.makeupDays > 0 ? "stat-icon-wrapper--brand" : "stat-icon-wrapper--neutral";
  const makeupValueClass = stats.makeupDays > 0 ? "stat-value--brand" : "stat-value--muted";

  container.innerHTML = `
    <div class="profile-stats-grid" style="display: grid; grid-template-columns: 1fr; gap: 1rem;">
      
      <!-- Today's Day -->
      <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper stat-icon-wrapper--brand">
            ${typeof renderIcon === "function" ? renderIcon("calendar", { size: "sm", className: "nlc-icon" }) : ""}
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">今天計畫進度</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">目前已進行的計畫天數</div>
          </div>
        </div>
        <div style="font-weight: 500; display: flex; align-items: baseline; gap: 0.1rem;">
          ${todayProgressText}
        </div>
      </div>

      <!-- Consecutive Streak -->
      <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper stat-icon-wrapper--danger">
            ${typeof renderIcon === "function" ? renderIcon("fire", { size: "sm", className: "nlc-icon" }) : ""}
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">連續讀經</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">每日穩定靈修天數</div>
          </div>
        </div>
        <div class="stat-value stat-value--danger">
          ${streakDays} <span class="stat-value__unit">天</span>
        </div>
      </div>

      <!-- Behind Days -->
      <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper ${lagIconClass}">
            ${typeof renderIcon === "function" ? renderIcon("exclamationCircle", { size: "sm", className: "nlc-icon" }) : ""}
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">落後進度</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">落後預計進度天數</div>
          </div>
        </div>
        <div class="stat-value ${lagValueClass}">
          ${lagDisplay}
        </div>
      </div>

      <!-- Ahead Days -->
      <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper ${leadIconClass}">
            ${typeof renderIcon === "function" ? renderIcon("trendTwo", { size: "sm", className: "nlc-icon" }) : ""}
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">超前進度</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">超前預計進度天數</div>
          </div>
        </div>
        <div class="stat-value ${leadValueClass}">
          ${leadDisplay}
        </div>
      </div>

      <!-- Makeup Days -->
      <div class="stat-item-card" style="background: var(--bg-card); border: 1px solid var(--border-card); padding: 1rem; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <div class="stat-icon-wrapper ${makeupIconClass}">
            ${typeof renderIcon === "function" ? renderIcon("refresh", { size: "sm", className: "nlc-icon" }) : ""}
          </div>
          <div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">補讀天數</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">事後補讀完畢天數</div>
          </div>
        </div>
        <div class="stat-value ${makeupValueClass}">
          ${makeupDisplay}
        </div>
      </div>

    </div>
  `;
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
export { renderPlanView };
if (typeof updateStatsView === 'function') {
  window.updateStatsView = updateStatsView;
}
if (typeof renderPlanScheduleTracker === 'function') {
  window.renderPlanScheduleTracker = renderPlanScheduleTracker;
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

// Plan route state machine: the plan tab has exactly three mutually exclusive screens.
async function enterPlanListState() {
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
  populateMembersSelector();
}
async function enterGroupProgressState() {
  if (!state.activePlan) {
    await enterPlanListState();
    return;
  }
  window.currentPlanViewState = PLAN_ROUTE.GROUP;
  state.planDetailOpen = true;
  const requestedSubview = Object.values(GROUP_SUBVIEW).includes(state.planActiveSubTab)
    ? state.planActiveSubTab
    : (window.PlanPageController?.groupSubview || GROUP_SUBVIEW.STATS);
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
      showToast("此計畫已過期，無法再進入進度閱讀。");
      await enterPlanListState();
      return;
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

function planGoBack() {
  if (state.planActiveSubTab === "settings" && window.PlanPageController) {
    window.PlanPageController.closeSettingsPage();
    return;
  }
  if (getCurrentPlanRoute() !== PLAN_ROUTE.LIST) setPlanState(PLAN_ROUTE.LIST);
}

function planToggleGroupProgress() {
  if (typeof window.syncActivePlanContext === "function") window.syncActivePlanContext();
  if (!state.activePlan || !window.PlanPageController) return;
  const nextIndex = window.PlanPageController.currentIndex === PLAN_PAGE.GROUP ? PLAN_PAGE.READING : PLAN_PAGE.GROUP;
  window.PlanPageController.switchPage(nextIndex);
}

window.fetchGroupRankings = fetchGroupRankings;
window.setPlanState = setPlanState;
window.planGoBack = planGoBack;
window.planToggleGroupProgress = planToggleGroupProgress;
window.togglePlanDetailSubTab = planToggleGroupProgress;

// ==================== 關心戳一下 Dialog ====================
window.openCareReminderDialog = function(member) {
  // Remove any existing dialog
  const existingDialog = document.getElementById("care-reminder-dialog-overlay");
  if (existingDialog) existingDialog.remove();

  const reasonLabels = {
    behind: "📉 進度落後",
    inactive: "😴 很久沒打卡",
    care: "💛 一般關心",
    encouragement: "🌟 特別鼓勵"
  };

  // Auto-pick a default reason based on member status
  const defaultReason = member.isBehind ? "behind" : member.isNotStarted ? "inactive" : "care";

  const defaultMessages = {
    behind: `Hi ${member.name}！這週的讀經進度稍微落後囉，有任何困難都可以跟我說喔，加油！`,
    inactive: `${member.name} 你好，最近都沒看到你打卡讀經，希望一切都好，我們在等你哦！`,
    care: `${member.name} 你好，只是想關心一下你最近的讀經狀況，如果有任何需要都可以找我！`,
    encouragement: `${member.name}！你最近讀經很穩定，真的很棒！繼續加油哦，感謝主！`
  };

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

      <p style="margin:0 0 1rem; font-size:0.82rem; color:var(--text-muted);">
        進度：<strong style="color:${member.statusColor}">${member.statusStr}</strong>
        &nbsp;・&nbsp;完成：${member.completed} 天
      </p>

      <label style="display:block; font-size:0.82rem; font-weight:600; color:var(--text-secondary); margin-bottom:0.4rem;">
        關心原因
      </label>
      <div id="care-reason-btns" style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
        ${Object.entries(reasonLabels).map(([key, label]) => `
          <button type="button"
            data-reason="${key}"
            class="care-reason-btn${key === defaultReason ? ' active' : ''}"
            style="
              padding: 0.35rem 0.75rem; border-radius: 20px; font-size: 0.8rem; font-weight:500;
              border: 1.5px solid ${key === defaultReason ? 'var(--color-warning-text, rgb(217,119,6))' : 'var(--border-card)'};
              background: ${key === defaultReason ? 'var(--color-warning-muted,rgba(251,191,36,0.15))' : 'var(--bg-input)'};
              color: ${key === defaultReason ? 'var(--color-warning-text, rgb(217,119,6))' : 'var(--text-secondary)'};
              cursor: pointer; transition: all 0.15s;
            ">
            ${label}
          </button>
        `).join("")}
      </div>

      <label for="care-msg-input" style="display:block; font-size:0.82rem; font-weight:600; color:var(--text-secondary); margin-bottom:0.4rem;">
        訊息內容
      </label>
      <textarea id="care-msg-input"
        rows="4"
        maxlength="300"
        placeholder="輸入關心訊息..."
        style="
          width:100%; box-sizing:border-box;
          padding: 0.65rem 0.75rem;
          border-radius: 10px;
          border: 1.5px solid var(--border-card);
          background: var(--bg-input);
          color: var(--text-primary);
          font-size: 0.88rem;
          resize: vertical;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s;
          margin-bottom: 0.25rem;
        "
      >${defaultMessages[defaultReason]}</textarea>
      <div id="care-char-count" style="text-align:right; font-size:0.75rem; color:var(--text-muted); margin-bottom:1rem;">
        ${defaultMessages[defaultReason].length} / 300
      </div>

      <div id="care-dialog-error" style="display:none; color:var(--color-danger); font-size:0.82rem; margin-bottom:0.75rem; padding:0.5rem 0.75rem; background:var(--color-danger-muted,rgba(239,68,68,0.1)); border-radius:8px;"></div>

      <div style="display:flex; gap:0.75rem; justify-content:flex-end;">
        <button id="care-cancel-btn" type="button" style="
          padding:0.55rem 1.2rem; border-radius:10px; font-size:0.88rem; font-weight:600;
          border:1.5px solid var(--border-card); background:var(--bg-input);
          color:var(--text-secondary); cursor:pointer;
        ">取消</button>
        <button id="care-send-btn" type="button" style="
          padding:0.55rem 1.4rem; border-radius:10px; font-size:0.88rem; font-weight:600;
          border:none; background:var(--color-warning-text, rgb(217,119,6));
          color:white; cursor:pointer; display:flex; align-items:center; gap:0.4rem;
          transition: opacity 0.15s;
        ">
          <span class="nlc-icon nlc-icon--sm" data-icon="send" aria-hidden="true"></span>
          傳送關心
        </button>
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

  // Send
  overlay.querySelector("#care-send-btn").addEventListener("click", async () => {
    const message = msgInput.value.trim();
    const errorEl = overlay.querySelector("#care-dialog-error");
    const sendBtn = overlay.querySelector("#care-send-btn");

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

    sendBtn.disabled = true;
    sendBtn.style.opacity = "0.6";
    sendBtn.innerHTML = `<span class="nlc-icon nlc-icon--sm" data-icon="loader" aria-hidden="true"></span> 傳送中...`;
    if (typeof hydrateIcons === "function") hydrateIcons(sendBtn);

    try {
      const { error } = await db.sendCareReminder({
        recipientId: member.id,
        reason: selectedReason,
        message: message,
        planKey: state.activePlan ? (state.activePlan.presetKey || state.activePlan.globalPlanId || "") : ""
      });

      if (error) throw error;

      overlay.remove();
      if (typeof showToast === "function") showToast(`已傳送關心提醒給 ${member.name} 💛`);
    } catch (err) {
      console.error("sendCareReminder failed:", err);
      sendBtn.disabled = false;
      sendBtn.style.opacity = "1";
      sendBtn.innerHTML = `<span class="nlc-icon nlc-icon--sm" data-icon="send" aria-hidden="true"></span> 傳送關心`;
      if (typeof hydrateIcons === "function") hydrateIcons(sendBtn);

      const isDemoOrNoId = !member.id || (state.currentUser && state.currentUser.is_demo);
      if (isDemoOrNoId) {
        overlay.remove();
        if (typeof showToast === "function") showToast(`(Demo) 已模擬傳送關心提醒給 ${member.name} 💛`);
      } else {
        errorEl.textContent = `傳送失敗：${err.message || "請稍後再試"}`;
        errorEl.style.display = "block";
      }
    }
  });

  // Focus textarea
  setTimeout(() => { if (msgInput) msgInput.focus(); }, 100);
};
