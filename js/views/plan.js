// Reading plans tab view controller

window._currentStatsTab = 'personal';
window._statsTabScope = null;

function canUseAdvancedGroupStats() {
  const role = (state.currentUser && state.currentUser.role) || "member";
  return ["admin", "senior_pastor", "great_zone_leader", "zone_leader", "group_leader"].includes(role);
}

function getDefaultGroupStatsScope() {
  const myZone = (state.currentUser && state.currentUser.pastoral_zone) || "";
  return myZone ? `zone:${myZone.split(",")[0].trim()}` : "all";
}

function applyBasicStatsScope() {
  const basicSelect = document.getElementById("stats-basic-scope-select");
  if (!basicSelect) return getDefaultGroupStatsScope();
  if (!basicSelect.value) basicSelect.value = getDefaultGroupStatsScope();
  if (basicSelect.value === "advanced") return null;
  return basicSelect.value;
}

window.switchStatTab = async function(tab) {
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
  renderPresetPlansList();

  // Back Button
  const backBtn = document.getElementById("btn-back-to-plans");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      state.activePlan = null;
      localStorage.removeItem("selected_plan_key");
      const listSubview = document.getElementById("plan-list-subview");
      const detailSubview = document.getElementById("plan-detail-subview");
      if (listSubview) listSubview.classList.remove("hidden");
      if (detailSubview) detailSubview.classList.add("hidden");
      renderPlanView();
    });
  }

  // Options Dropdown Menu Toggle
  const optionsBtn = document.getElementById("btn-plan-options");
  const dropdown = document.getElementById("plan-options-dropdown");
  if (optionsBtn && dropdown) {
    optionsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("hidden");
    });
    document.addEventListener("click", () => {
      dropdown.classList.add("hidden");
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

  // Sub-tabs Toggle (Daily Reading vs Stats vs Ranking vs History vs Members)
  const tabSchedule = document.getElementById("tab-plan-schedule");
  const tabStats = document.getElementById("tab-plan-stats");
  const tabRanking = document.getElementById("tab-plan-ranking");
  const tabMembers = document.getElementById("tab-plan-members");
  const subviewSchedule = document.getElementById("subview-plan-schedule");
  const subviewPlanStats = document.getElementById("subview-plan-stats");
  const subviewPlanRanking = document.getElementById("subview-plan-ranking");
  const subviewPlanMembers = document.getElementById("subview-plan-members");
  const subviewPlanLevel = document.getElementById("subview-plan-level");
  // Only leaders and above can see the 組員狀況 tab
  const _initUserRole = (state.currentUser && state.currentUser.role) || "member";
  const _canSeeMembers = ["admin", "senior_pastor", "great_zone_leader", "zone_leader", "group_leader"].includes(_initUserRole);
  if (tabMembers) tabMembers.style.display = _canSeeMembers ? "" : "none";
  if (subviewPlanMembers) subviewPlanMembers.style.display = _canSeeMembers ? "" : "none";

  // Control visibility of inner admin stats tab
  const innerAdminTab = document.getElementById("stats-inner-tab-admin");
  if (innerAdminTab) { innerAdminTab.style.display = ""; innerAdminTab.classList.remove("hidden"); }

  const allTabs = [tabSchedule, tabStats, tabRanking, _canSeeMembers ? tabMembers : null].filter(Boolean);
  const allSubviews = [subviewSchedule, subviewPlanStats, subviewPlanRanking, subviewPlanLevel, _canSeeMembers ? subviewPlanMembers : null].filter(Boolean);

  function switchToTab(activeTab, activeSubview) {
    allTabs.forEach(t => t && t.classList.remove("active"));
    allSubviews.forEach(s => s && s.classList.add("hidden"));
    if (activeTab) activeTab.classList.add("active");
    if (activeSubview) activeSubview.classList.remove("hidden");
  }

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
  if (tabSchedule) {
    tabSchedule.addEventListener("click", () => {
      switchToTab(tabSchedule, subviewSchedule);
      renderPlanScheduleTracker();
    });
  }

  if (tabStats) {
    tabStats.addEventListener("click", async () => {
      switchToTab(tabStats, subviewPlanStats);
      // Reset inner tab to 'personal' on click
      await window.switchStatTab('personal');
    });
  }

  if (tabRanking) {
    tabRanking.addEventListener("click", async () => {
      switchToTab(tabRanking, subviewPlanRanking);
      if (state.activePlan) await renderPlanRankingView();
    });
  }

  if (tabMembers && _canSeeMembers) {
    tabMembers.addEventListener("click", async () => {
      switchToTab(tabMembers, subviewPlanMembers);
      if (state.activePlan) await renderPlanMembersView();
    });
  }
bindPlanMenuItem("menu-plan-stats", async () => {
    switchToTab(tabStats, subviewPlanStats);
    await window.switchStatTab("personal");
  });

  bindPlanMenuItem("menu-plan-ranking", async () => {
    switchToTab(tabRanking, subviewPlanRanking);
    if (state.activePlan) await renderPlanRankingView();
  });

  bindPlanMenuItem("menu-plan-level", async () => {
    switchToTab(null, subviewPlanLevel);
    renderPlanLevelEditor();
  });

  const planLevelBackBtn = document.getElementById("btn-plan-level-back");
  if (planLevelBackBtn) {
    planLevelBackBtn.addEventListener("click", () => {
      switchToTab(tabSchedule, subviewSchedule);
      renderPlanScheduleTracker();
    });
  }

  document.querySelectorAll("#plan-level-options .plan-level-option").forEach(btn => {
    btn.addEventListener("click", async () => {
      const level = btn.dataset.level || "normal";
      await window.changePlanLevel(level);
      switchToTab(tabSchedule, subviewSchedule);
      renderPlanScheduleTracker();
    });
  });
  const membersMenuItem = document.getElementById("menu-plan-members");
  if (membersMenuItem) membersMenuItem.style.display = _canSeeMembers ? "" : "none";
  bindPlanMenuItem("menu-plan-members", async () => {
    if (!_canSeeMembers) return;
    switchToTab(tabMembers, subviewPlanMembers);
    if (state.activePlan) await renderPlanMembersView();
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
        
        const joinedList = document.getElementById("joined-plans-list");
        if (joinedList) {
          joinedList.innerHTML = `
            <div class="empty-state" style="text-align: center; padding: 3rem 0; width: 100%;">
              <p style="color: var(--text-secondary); margin-bottom: 1rem; font-weight: 700;">目前沒有已完成的計畫</p>
              <p style="font-size: 0.82rem; color: var(--text-muted);">前往「尋找計畫」加入新挑戰吧！</p>
            </div>
          `;
        }
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


function getPlanLevelRounds(level) {
  if (level === "breakthrough") return 2;
  if (level === "super") return 3;
  return 1;
}

function getPlanLevelLabel(level) {
  if (level === "breakthrough") return "突破";
  if (level === "super") return "興盛";
  return "一般";
}

function getPlanLevelOrder(level) {
  if (level === "super") return 3;
  if (level === "breakthrough") return 2;
  return 1;
}

function addDaysIso(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function getDowngradeLockedUntil(plan) {
  return (plan && plan.downgradeLockedUntil) || (typeof getLocalPlanDowngradeLock === "function" ? getLocalPlanDowngradeLock(plan) : null);
}

function isPlanUpgradeLocked(plan) {
  const lockedUntil = getDowngradeLockedUntil(plan);
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
}

function formatLockDate(lockedUntil) {
  const date = new Date(lockedUntil);
  if (isNaN(date)) return "兩週後";
  return date.getFullYear() + "/" + String(date.getMonth() + 1).padStart(2, "0") + "/" + String(date.getDate()).padStart(2, "0");
}

async function persistPlanLevelState(plan) {
  if (!plan) return;
  if (typeof setLocalPlanDowngradeLock === "function") {
    setLocalPlanDowngradeLock(plan, plan.downgradeLockedUntil || null);
  }

  if (state.isSupabaseMode && state.supabase && plan.id) {
    const payload = {
      level: plan.level,
      was_downgraded: !!plan.wasDowngraded,
      downgrade_locked_until: plan.downgradeLockedUntil || null,
      upgrade_prompt_handled: !!plan.upgradePromptHandled
    };
    const { error } = await state.supabase.from("reading_plans").update(payload).eq("id", plan.id);
    if (error) {
      console.warn("Failed to persist downgrade lock column, retrying without it", error);
      await state.supabase.from("reading_plans")
        .update({ level: plan.level, was_downgraded: !!plan.wasDowngraded, upgrade_prompt_handled: !!plan.upgradePromptHandled })
        .eq("id", plan.id);
    }
  } else if (!state.isSupabaseMode) {
    localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans || []));
  }
}

function expandChaptersForLevel(chapters, level) {
  const rounds = getPlanLevelRounds(level);
  const expanded = [];
  for (let round = 1; round <= rounds; round++) {
    chapters.forEach(ch => expanded.push({ ...ch, round }));
  }
  return expanded;
}

function distributeChaptersAcrossDays(chapters, readingDays) {
  const dailyChapters = Array.from({ length: readingDays }, () => []);
  const chsPerDay = Math.floor(chapters.length / readingDays);
  let remainder = chapters.length % readingDays;
  let chIdx = 0;

  for (let d = 0; d < readingDays; d++) {
    const todayCount = chsPerDay + (remainder > 0 ? 1 : 0);
    remainder--;
    for (let c = 0; c < todayCount; c++) {
      if (chIdx < chapters.length) {
        dailyChapters[d].push(chapters[chIdx]);
        chIdx++;
      }
    }
  }

  return dailyChapters;
}

function rebuildPlanScheduleForLevel(plan, level) {
  if (!plan) return plan;
  const rebuilt = generatePlanObject(
    plan.name,
    plan.startDate,
    plan.endDate,
    plan.target_books || plan.targetBooks || [],
    plan.presetKey,
    level
  );
  Object.assign(plan, {
    totalDays: rebuilt.totalDays,
    totalChapters: rebuilt.totalChapters,
    days: rebuilt.days,
    level,
    target_books: plan.target_books || rebuilt.target_books,
    targetBooks: plan.targetBooks || rebuilt.targetBooks
  });
  return plan;
}
function generatePlanObject(name, startDate, endDate, selectedBooks, presetKey = null, level = "normal") {
  const preset = presetKey ? CHURCH_PLAN_PRESETS[presetKey] : null;

  if (preset && preset.months) {
    const days = [];
    let dayNumCounter = 1;
    let totalChaptersCount = 0;

    preset.months.forEach(mSpec => {
      // 1. Get all chapters of the books in this month
      const allChapters = [];
      mSpec.books.forEach(bookName => {
        if (bookName === "詩篇 1-110") {
          for (let i = 1; i <= 110; i++) {
            allChapters.push({ book: "詩篇", chapter: i });
          }
        } else if (bookName === "詩篇 111-150") {
          for (let i = 111; i <= 150; i++) {
            allChapters.push({ book: "詩篇", chapter: i });
          }
        } else {
          const book = BIBLE_BOOKS.find(b => b.name === bookName);
          if (book) {
            for (let i = 1; i <= book.chapters; i++) {
              allChapters.push({ book: book.name, chapter: i });
            }
          }
        }
      });

      const expandedChapters = expandChaptersForLevel(allChapters, level);
      const totalChapters = expandedChapters.length;
      totalChaptersCount += totalChapters;

      const readingDays = mSpec.readingDays;
      const dailyChapters = distributeChaptersAcrossDays(expandedChapters, readingDays);

      // 2. Generate calendar days for this month
      const daysInMonth = new Date(mSpec.year, mSpec.month, 0).getDate();

      for (let dayOffset = 0; dayOffset < daysInMonth; dayOffset++) {
        const dayDate = new Date(mSpec.year, mSpec.month - 1, dayOffset + 1);
        const mm = String(dayDate.getMonth() + 1).padStart(2, '0');
        const dd = String(dayDate.getDate()).padStart(2, '0');
        const dateStr = `${mm}/${dd}`; // MM/DD
        
        let chapters = [];
        if (dayOffset < readingDays) {
          chapters = dailyChapters[dayOffset].map(ch => ({
            book: ch.book,
            chapter: ch.chapter,
            key: `${ch.book}_${ch.chapter}_${ch.round || 1}`,
            round: ch.round || 1
          }));
        }

        days.push({
          dayNum: dayNumCounter++,
          date: dateStr,
          year: mSpec.year,
          month: mSpec.month,
          chapters: chapters
        });
      }
    });

    return {
      name: preset.name,
      startDate: preset.startDate,
      endDate: preset.endDate,
      totalDays: days.length,
      totalChapters: totalChaptersCount,
      completedChapters: 0,
      progress: 0,
      days,
      presetKey,
      target_books: selectedBooks,
      level,
      currentRound: 1,
      wasDowngraded: false
    };
  }

  // FALLBACK: Standard linear generation
  const parseLocalDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  const allChapters = [];
  selectedBooks.forEach(bookName => {
    if (bookName === "詩篇 1-110") {
      for (let i = 1; i <= 110; i++) {
        allChapters.push({ book: "詩篇", chapter: i });
      }
    } else if (bookName === "詩篇 111-150") {
      for (let i = 111; i <= 150; i++) {
        allChapters.push({ book: "詩篇", chapter: i });
      }
    } else {
      const book = BIBLE_BOOKS.find(b => b.name === bookName);
      if (book) {
        for (let i = 1; i <= book.chapters; i++) {
          allChapters.push({ book: book.name, chapter: i });
        }
      }
    }
  });

  const expandedChapters = expandChaptersForLevel(allChapters, level);
  const totalChapters = expandedChapters.length;
  const dailyChapters = distributeChaptersAcrossDays(expandedChapters, totalDays);

  const days = dailyChapters.map((chapters, index) => {
    const dayDate = new Date(start);
    dayDate.setDate(start.getDate() + index);
    const mm = String(dayDate.getMonth() + 1).padStart(2, '0');
    const dd = String(dayDate.getDate()).padStart(2, '0');
    const dateStr = `${mm}/${dd}`; // MM/DD
    
    return {
      dayNum: index + 1,
      date: dateStr,
      year: dayDate.getFullYear(),
      month: dayDate.getMonth() + 1,
      chapters: chapters.map(ch => ({
        book: ch.book,
        chapter: ch.chapter,
        key: `${ch.book}_${ch.chapter}_${ch.round || 1}`,
        round: ch.round || 1
      }))
    };
  });

  return {
    name,
    startDate,
    endDate,
    totalDays,
    totalChapters,
    completedChapters: 0,
    progress: 0,
    days,
    presetKey,
    target_books: selectedBooks,
    level,
    currentRound: 1,
    wasDowngraded: false
  };
}

function calculatePlanProgress() {
  calculateAllPlansProgress();
  if (state.activePlan && state.activePlans) {
    const currentInList = state.activePlans.find(p => p.presetKey === state.activePlan.presetKey);
    if (currentInList) {
      state.activePlan = currentInList;
    }
  }
}

function isPlanStarted(plan) {
  if (!plan) return false;
  const todayStr = new Date().toISOString().split('T')[0];
  return todayStr >= plan.startDate;
}

function calculateAllPlansProgress() {
  const visibleActivePlans = getVisiblePlans(state.activePlans || []);

  if (visibleActivePlans.length === 0) {
    state.activePlan = null;
    return;
  }

  visibleActivePlans.forEach(plan => {
    const targetRounds = getPlanLevelRounds(plan.level || "normal");
    const hasMatchingRoundSchedule = plan.days && plan.days.some(day => day.chapters && day.chapters.some(ch => (ch.round || 1) === targetRounds));
    if (!hasMatchingRoundSchedule && targetRounds > 1) {
      rebuildPlanScheduleForLevel(plan, plan.level || "normal");
    }
    let completed = 0;
    plan.days.forEach(day => {
      day.chapters.forEach(ch => {
        const checkRoundLog = (rTarget) => {
          return state.readingLogs.some(l => {
            const logPlanId = l.plan_id || null;
            const logPresetKey = l.presetKey || l.preset_key || null;
            const isPlanMatch =
              (plan.id && logPlanId && logPlanId === plan.id) ||
              (plan.presetKey && logPresetKey && logPresetKey === plan.presetKey) ||
              ((plan.id || plan.presetKey) && !logPlanId && !logPresetKey) ||
              (!plan.id && !plan.presetKey && !logPlanId && !logPresetKey);
            const isRoundMatch = (l.round || 1) === rTarget;
            return l.book === ch.book && Number(l.chapter) === Number(ch.chapter) && isPlanMatch && isRoundMatch;
          });
        };

        ch.isReadR1 = checkRoundLog(1);
        ch.isReadR2 = checkRoundLog(2);
        ch.isReadR3 = checkRoundLog(3);

        const targetRound = ch.round || plan.currentRound || 1;
        const isRead = targetRound === 3 ? ch.isReadR3 : (targetRound === 2 ? ch.isReadR2 : ch.isReadR1);
        ch.isRead = isRead;
        if (isRead) completed++;
      });
    });
    plan.completedChapters = completed;
    const firstRoundTotalChapters = plan.days.reduce((sum, day) => {
      return sum + ((day.chapters || []).filter(ch => (ch.round || 1) === 1).length);
    }, 0) || plan.totalChapters;
    const firstRoundCompletedChapters = plan.days.reduce((sum, day) => {
      return sum + ((day.chapters || []).filter(ch => (ch.round || 1) === 1 && ch.isReadR1).length);
    }, 0);
    plan.firstRoundCompletedChapters = firstRoundCompletedChapters;
    plan.firstRoundTotalChapters = firstRoundTotalChapters;
    plan.isPlanCompleted = firstRoundTotalChapters > 0 && firstRoundCompletedChapters >= firstRoundTotalChapters;
    plan.progress = plan.isPlanCompleted
      ? 100
      : (Math.round((firstRoundCompletedChapters / firstRoundTotalChapters) * 100) || 0);
    if (!plan.isPlanCompleted) plan.upgradePromptHandled = false;
  });

  if (!state.isSupabaseMode) {
    localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
  }
}



function getPlanVisibilityKey(plan) {
  return plan ? String(plan.id || plan.presetKey || plan.globalPlanId || plan.name || '') : '';
}

function getHiddenPlanKeys() {
  try {
    return JSON.parse(localStorage.getItem('hidden_global_plan_keys') || '[]');
  } catch (e) {
    return [];
  }
}

function isPlanHidden(plan) {
  if (!plan) return false;
  const hiddenKeys = getHiddenPlanKeys();
  const keys = [plan.id, plan.presetKey, plan.globalPlanId, plan.name].filter(Boolean).map(String);
  return Boolean(plan.isHidden || plan.is_hidden || keys.some(key => hiddenKeys.includes(key)));
}

function canManageHiddenPlans() {
  const role = (state.currentUser && state.currentUser.role) || 'member';
  const realRole = state.realRole || role;
  return role === 'admin' || role === 'senior_pastor' || realRole === 'admin' || realRole === 'senior_pastor';
}

function getVisiblePlans(plans) {
  const list = plans || [];
  if (canManageHiddenPlans()) return list;
  return list.filter(plan => !isPlanHidden(plan));
}


async function renderPlanView() {
  if (state.activePlan && isPlanHidden(state.activePlan) && !canManageHiddenPlans()) {
    const nextVisiblePlan = (state.activePlans || []).find(plan => !isPlanHidden(plan));
    state.activePlan = nextVisiblePlan || null;
    if (state.activePlan) localStorage.setItem("selected_plan_key", state.activePlan.presetKey || state.activePlan.id || "");
    else localStorage.removeItem("selected_plan_key");
  }

  renderJoinedPlansList();
  renderPresetPlansList();

  const listSubview = document.getElementById("plan-list-subview");
  const detailSubview = document.getElementById("plan-detail-subview");

  if (state.activePlan && state.planDetailOpen) {
    if (listSubview) listSubview.classList.add("hidden");
    if (detailSubview) detailSubview.classList.remove("hidden");

    // Always close/reset inline reader when entering plan view tab to show the checklist directly
    state.inlineReader.active = false;
    const inlineReader = document.getElementById("plan-inline-reader");
    if (inlineReader) inlineReader.classList.add("hidden");
    
    const carousel = document.getElementById("plan-date-carousel");
    const planDayHeader = document.getElementById("plan-day-subtitle") ? document.getElementById("plan-day-subtitle").parentElement : null;
    const taskList = document.getElementById("plan-tasks-list");
    const readBtn = document.getElementById("plan-start-reading-container");
    if (carousel) carousel.classList.remove("hidden");
    if (planDayHeader) planDayHeader.classList.remove("hidden");
    if (taskList) taskList.classList.remove("hidden");
    if (readBtn) readBtn.classList.remove("hidden");

    await renderPlanDetailView();
  } else {
    if (listSubview) listSubview.classList.remove("hidden");
    if (detailSubview) detailSubview.classList.add("hidden");
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
}



function getPlanCoverHtml(plan) {
  let gradient = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
  let text = "速讀";
  if (plan.presetKey === "q1") {
    gradient = "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)";
    text = "第一季";
  } else if (plan.presetKey === "q2") {
    gradient = "linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)";
    text = "第二季";
  } else if (plan.presetKey === "q3") {
    gradient = "linear-gradient(135deg, #f6d365 0%, #fda085 100%)";
    text = "第三季";
  } else if (plan.presetKey === "q4") {
    gradient = "linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)";
    text = "第四季";
  }
  return `<div class="plan-cover-thumbnail" style="width: 72px; height: 72px; border-radius: 12px; background: ${gradient}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 0.95rem; flex-shrink: 0; box-shadow: 0 4px 10px rgba(0,0,0,0.15);">${text}</div>`;
}

function renderJoinedPlansList() {
  const container = document.getElementById("joined-plans-list");
  if (!container) return;

  container.innerHTML = "";

  if (!state.activePlans || state.activePlans.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 3rem 0;">
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-weight: 700;">您目前沒有加入任何讀經計畫。</p>
        <p style="font-size: 0.88rem; color: var(--text-muted);">請點擊頂部「<strong>尋找計畫</strong>」瀏覽並加入！</p>
      </div>
    `;
    return;
  }

  state.activePlans.forEach(plan => {
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
    card.onclick = () => {
      state.activePlan = plan;
      state.planDetailOpen = true;
      state.selectedPlanDay = null; // reset to first uncompleted day
      localStorage.setItem("selected_plan_key", plan.presetKey || "");
      renderPlanView();
    };

    const progress = plan.progress || 0;
    card.innerHTML = `
      ${getPlanCoverHtml(plan)}
      <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 0.25rem; min-width: 0;">
        <h4 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${plan.name}</h4>
        <div style="font-size: 0.78rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.3rem;">
          <span>📅</span> <span>${plan.startDate} ~ ${plan.endDate}</span>
        </div>
        <div class="plan-progress-wrapper" style="margin-top: 0.4rem; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; position: relative;">
          <div class="plan-progress-bar" style="width: ${progress}%; height: 100%; background: #ff4757 !important; border-radius: 2px;"></div>
        </div>
        <div style="font-size: 0.76rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.1rem;">
          已讀 ${progress}% (${plan.completedChapters} / ${plan.totalChapters} 章)
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderPresetPlansList() {
  const container = document.getElementById("preset-plans-list");
  if (!container) return;

  container.innerHTML = "";

  let plans = [];
  if (state.globalPlans && state.globalPlans.length > 0) {
    plans = getVisiblePlans(state.globalPlans);
  } else {
    plans = Object.entries(CHURCH_PLAN_PRESETS).map(([key, p]) => ({
      id: key,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      books: p.books,
      presetKey: key
    }));
  }

  plans = getVisiblePlans(plans);

  plans.forEach(plan => {
    const key = plan.presetKey || plan.id;
    // Check if user already joined
    const isJoined = state.activePlans && state.activePlans.some(p => p.presetKey === key || p.id === plan.id);

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
      if (isJoined) {
        state.activePlan = state.activePlans.find(p => p.presetKey === key || p.id === plan.id);
        state.planDetailOpen = true;
        state.selectedPlanDay = null;
        renderPlanView();
      } else {
        if (confirm(`確定要加入 ${plan.name} 讀經計畫挑戰嗎？`)) {
          await db.joinPresetPlan(key);
        }
      }
    };

    card.innerHTML = `
      ${getPlanCoverHtml({ presetKey: key })}
      <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 0.25rem; min-width: 0;">
        <h4 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${plan.name}</h4>
        <div style="font-size: 0.78rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.3rem;">
          <span>📅</span> <span>${plan.startDate} ~ ${plan.endDate}</span>
        </div>
        <div style="font-size: 0.76rem; font-weight: 700; color: ${isJoined ? '#10b981' : 'var(--primary-color)'}; margin-top: 0.2rem; display: flex; align-items: center; gap: 0.25rem;">
          ${isJoined ? '✓ 已加入挑戰' : '+ 點擊加入計畫挑戰'}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

async function renderPlanDetailView() {
  if (!state.activePlan) return;

  // Set Title
  const titleEl = document.getElementById("plan-detail-title");
  if (titleEl) titleEl.textContent = state.activePlan.name;

  // Set Cover title & dates
  const coverTitle = document.getElementById("plan-cover-title");
  const coverDates = document.getElementById("plan-cover-dates");
  const coverCard = document.getElementById("plan-detail-cover");

  if (coverTitle) coverTitle.textContent = state.activePlan.name;
  if (coverDates) coverDates.textContent = `${state.activePlan.startDate} ~ ${state.activePlan.endDate}`;
  
  if (coverCard) {
    let gradient = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
    if (state.activePlan.presetKey === "q1") {
      gradient = "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)";
    } else if (state.activePlan.presetKey === "q2") {
      gradient = "linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)";
    } else if (state.activePlan.presetKey === "q3") {
      gradient = "linear-gradient(135deg, #f6d365 0%, #fda085 100%)";
    } else if (state.activePlan.presetKey === "q4") {
      gradient = "linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)";
    }
    coverCard.style.background = gradient;
  }

  // Render current selected tab content
  const tabSchedule = document.getElementById("tab-plan-schedule");
  const tabStats = document.getElementById("tab-plan-stats");
  const tabRanking = document.getElementById("tab-plan-ranking");
  const tabMembers = document.getElementById("tab-plan-members");
  const subviewSchedule = document.getElementById("subview-plan-schedule");
  const subviewPlanStats = document.getElementById("subview-plan-stats");
  const subviewPlanRanking = document.getElementById("subview-plan-ranking");
  const subviewPlanMembers = document.getElementById("subview-plan-members");
  const subviewPlanLevel = document.getElementById("subview-plan-level");
  // Hide the 組員狀況 tab for regular members
  const _restoreRole = (state.currentUser && state.currentUser.role) || "member";
  const _restoreCanSeeMembers = ["admin", "senior_pastor", "great_zone_leader", "zone_leader", "group_leader"].includes(_restoreRole);
  if (tabMembers) tabMembers.style.display = _restoreCanSeeMembers ? "" : "none";
  if (subviewPlanMembers) subviewPlanMembers.style.display = _restoreCanSeeMembers ? "" : "none";

  const innerAdminTab = document.getElementById("stats-inner-tab-admin");
  if (innerAdminTab) {
    if (_restoreCanSeeMembers) {
      innerAdminTab.style.display = "";
      innerAdminTab.classList.remove("hidden");
    } else {
      innerAdminTab.style.display = "none";
      innerAdminTab.classList.add("hidden");
    }
  }

  const allSubviewsInit = [subviewSchedule, subviewPlanStats, subviewPlanRanking, subviewPlanLevel, _restoreCanSeeMembers ? subviewPlanMembers : null].filter(Boolean);

  // Always enter the plan on the daily reading screen; other screens are opened from the top-right menu.
  if (tabSchedule) tabSchedule.classList.add("active");
  if (tabStats) tabStats.classList.remove("active");
  if (tabRanking) tabRanking.classList.remove("active");
  if (tabMembers) tabMembers.classList.remove("active");
  allSubviewsInit.forEach(s => s.classList.add("hidden"));
  if (subviewSchedule) subviewSchedule.classList.remove("hidden");
  renderPlanScheduleTracker();
}
function renderHorizontalDateStrip() {
  const carousel = document.getElementById("plan-date-carousel");
  if (!carousel || !state.activePlan) return;

  carousel.innerHTML = "";
  
  const daysCount = state.activePlan.days.length;

  // 取今天的年/月/日，用於比對計畫日期
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();

  for (let dNum = 1; dNum <= daysCount; dNum++) {
    const day = state.activePlan.days.find(d => d.dayNum === dNum);
    if (!day) continue;

    const isDayCompleted = day.chapters && day.chapters.length > 0 && day.chapters.every(ch => ch.isRead);

    // 比對日期：day.year / day.month 已有；day.date 格式為 "MM/DD"
    let isToday = false;
    let isPast = false;
    if (day.year && day.month && day.date) {
      const parts = day.date.split('/');
      const dayOfMonth = parts.length === 2 ? parseInt(parts[1]) : null;
      if (dayOfMonth !== null) {
        const cardYear = day.year;
        const cardMonth = day.month;
        const cardDay = dayOfMonth;
        if (cardYear === todayYear && cardMonth === todayMonth && cardDay === todayDay) {
          isToday = true;
        } else if (
          cardYear < todayYear ||
          (cardYear === todayYear && cardMonth < todayMonth) ||
          (cardYear === todayYear && cardMonth === todayMonth && cardDay < todayDay)
        ) {
          isPast = true;
        }
      }
    }

    const dateCard = document.createElement("div");
    dateCard.className = [
      "date-card",
      dNum === state.selectedPlanDay ? "active" : "",
      isDayCompleted ? "completed" : "",
      isToday ? "today" : "",
      isPast ? "past" : ""
    ].filter(Boolean).join(" ");
    dateCard.setAttribute("data-day", dNum);
    
    let formattedDate = "";
    if (day.date) {
      const parts = day.date.split('/');
      if (parts.length === 2) {
        formattedDate = `${parseInt(parts[0])}月${parseInt(parts[1])}日`;
      } else {
        formattedDate = day.date;
      }
    }

    dateCard.innerHTML = `
      <span class="day-num">${dNum}</span>
      <span class="date-lbl">${formattedDate}</span>
    `;

    dateCard.addEventListener("click", () => {
      state.selectedPlanDay = dNum;
      
      // Update active highlight class
      const cards = carousel.querySelectorAll('.date-card');
      cards.forEach(c => c.classList.remove('active'));
      dateCard.classList.add('active');
      
      // Smoothly scroll the selected day card into the center of viewport
      dateCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      
      renderPlanScheduleTracker(true); // Pass true to skip rebuilding the carousel
    });

    carousel.appendChild(dateCard);
  }

  // Auto center active card on load
  setTimeout(() => {
    const activeCard = carousel.querySelector(`.date-card[data-day="${state.selectedPlanDay}"]`);
    if (activeCard) {
      activeCard.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
    }
  }, 100);
}

async function renderPlanScheduleTracker(skipCarouselUpdate = false) {
  const container = document.getElementById("plan-tasks-list");
  if (!container || !state.activePlan) return;

  container.innerHTML = "";

  // Set default selected day if not set
  if (!state.selectedPlanDay) {
    const firstUncompleted = state.activePlan.days.find(day => {
      if (!day.chapters || day.chapters.length === 0) return false;
      return !day.chapters.every(ch => ch.isRead);
    });
    state.selectedPlanDay = firstUncompleted ? firstUncompleted.dayNum : 1;
  }

  // Update date carousel
  if (!skipCarouselUpdate) {
    renderHorizontalDateStrip();
  }

  const selectedDay = state.activePlan.days.find(d => d.dayNum === state.selectedPlanDay);
  if (!selectedDay) return;

  // Render day subtitle
  const daySubtitle = document.getElementById("plan-day-subtitle");
  if (daySubtitle) {
    daySubtitle.textContent = `${state.activePlan.totalDays} 天中的第 ${state.selectedPlanDay} 天`;
  }

  // Check checkPlanSchedule
  await checkPlanSchedule(state.activePlan);

  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  const started = isPlanStarted(state.activePlan) || isAdmin;

  // Render status pill for day
  const statusPill = document.getElementById("plan-day-status-pill");
  if (statusPill) {
    if (!selectedDay.chapters || selectedDay.chapters.length === 0) {
      statusPill.textContent = "🧘 補讀/休息日";
      statusPill.style.background = "rgba(99, 102, 241, 0.1)";
      statusPill.style.color = "var(--primary-color)";
    } else {
      const allDone = selectedDay.chapters.every(ch => ch.isRead);
      if (allDone) {
        statusPill.textContent = "已完成";
        statusPill.style.background = "rgba(16, 185, 129, 0.1)";
        statusPill.style.color = "#10b981";
      } else {
        statusPill.textContent = "進行中";
        statusPill.style.background = "rgba(245, 158, 11, 0.1)";
        statusPill.style.color = "#f59e0b";
      }
    }
  }

  // Update completion check on the active date card in the carousel dynamically
  const activeCard = document.querySelector(`.date-card[data-day="${state.selectedPlanDay}"]`);
  if (activeCard && state.activePlan) {
    const isDayCompleted = selectedDay.chapters && selectedDay.chapters.length > 0 && selectedDay.chapters.every(ch => ch.isRead);
    if (isDayCompleted) {
      activeCard.classList.add("completed");
    } else {
      activeCard.classList.remove("completed");
    }
  }

  // Render items
  if (!selectedDay.chapters || selectedDay.chapters.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem; background: var(--bg-card); border: 1px dashed var(--border-card); border-radius: 14px; color: var(--text-secondary); font-weight: 700; width: 100%;">
        🧘 今天是補讀或靈修休息日，好好親近神吧！
      </div>
    `;
    return;
  }

  const currentRound = state.activePlan.currentRound || 1;

  selectedDay.chapters.forEach(ch => {
    const taskItem = document.createElement("div");
    taskItem.className = "plan-task-item";

    const taskRound = ch.round || currentRound;
    const { cssClass, content } = getChapterCheckboxState(ch, taskRound);
    const roundLabelHtml = taskRound >= 2
      ? `<div class="task-round-label round-${taskRound}">第${taskRound}遍</div>`
      : "";

    taskItem.innerHTML = `
      <div class="task-checkbox ${cssClass}"
           data-is-current-read="${ch.isRead ? 'true' : 'false'}"
           onclick="event.stopPropagation(); window.toggleYouVersionChapter(this, '${ch.book}', ${ch.chapter}, ${ch.round || currentRound})">
        ${content}
      </div>
      <div class="task-title" onclick="window.openPlanInlineReader('${ch.book}', ${ch.chapter}, ${state.selectedPlanDay}, ${ch.round || currentRound})">
        ${ch.book} ${ch.chapter}章
      </div>
      ${roundLabelHtml}
      <div class="task-arrow" onclick="window.openPlanInlineReader('${ch.book}', ${ch.chapter}, ${state.selectedPlanDay}, ${ch.round || currentRound})">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </div>
    `;
    container.appendChild(taskItem);
  });
}

function getChapterCheckboxState(ch, currentRound) {
  const ICON_R1 = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const ICON_R2 = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style="width:14px;height:14px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
  const ICON_R3 = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style="width:15px;height:15px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

  if (currentRound === 1) {
    return ch.isRead ? { cssClass: 'checked', content: ICON_R1 } : { cssClass: '', content: '' };
  }

  if (currentRound === 2) {
    if (ch.isReadR2) return { cssClass: 'checked round-2', content: ICON_R2 };
    if (ch.isReadR1) return { cssClass: 'checked round-1 dimmed', content: ICON_R1 };
    return { cssClass: '', content: '' };
  }

  if (currentRound >= 3) {
    if (ch.isReadR3) return { cssClass: 'checked round-3', content: ICON_R3 };
    if (ch.isReadR2) return { cssClass: 'checked round-2', content: ICON_R2 };
    if (ch.isReadR1) return { cssClass: 'checked round-1 dimmed', content: ICON_R1 };
  }

  return { cssClass: '', content: '' };
}

function getRoundBadge(ch, currentRound) {
  if (currentRound >= 3 && ch.isReadR2 && !ch.isReadR3) return '✓✓已讀';
  if (currentRound >= 2 && ch.isReadR1 && !ch.isReadR2) return '✓第1遍';
  return '';
}

window.toggleYouVersionChapter = async function(checkboxEl, book, chapter, taskRound = null) {
  if (checkboxEl.dataset.saving === "true") return;

  const isCurrentlyRead = checkboxEl.dataset.isCurrentRead === 'true';
  const willBeChecked = !isCurrentlyRead;
  const currentRound = taskRound || (state.activePlan ? (state.activePlan.currentRound || 1) : 1);
  const selectedDay = state.activePlan && state.activePlan.days
    ? state.activePlan.days.find(d => d.dayNum === state.selectedPlanDay)
    : null;
  const chapterObj = selectedDay && selectedDay.chapters
    ? selectedDay.chapters.find(ch => ch.book === book && Number(ch.chapter) === Number(chapter) && (ch.round || currentRound) === currentRound)
    : null;

  const applyLocalReadState = (ch, checked) => {
    if (!ch) return;
    if (currentRound === 1) ch.isReadR1 = checked;
    else if (currentRound === 2) ch.isReadR2 = checked;
    else if (currentRound === 3) ch.isReadR3 = checked;
    ch.isRead = checked;
  };

  checkboxEl.dataset.saving = "true";
  checkboxEl.classList.add("saving");
  applyLocalReadState(chapterObj, willBeChecked);
  calculatePlanProgress();
  renderPlanScheduleTracker(true);

  try {
    await db.logChapterRead(book, chapter, willBeChecked, currentRound);
    calculatePlanProgress();
    db.saveLocalUserStats();

    if (state.activePlan && state.activePlan.isPlanCompleted && !state.activePlan.upgradePromptHandled) {
      await handleRoundCompletion(state.activePlan);
    }
  } catch (error) {
    console.error("Failed to update reading progress", error);
    applyLocalReadState(chapterObj, isCurrentlyRead);
    calculatePlanProgress();
    renderPlanScheduleTracker(true);
    showToast("讀經進度更新失敗，請稍後再試");
  }
};

function renderPlanLevelEditor() {
  const currentLevel = state.activePlan ? (state.activePlan.level || "normal") : "normal";
  const options = document.querySelectorAll("#plan-level-options .plan-level-option");
  options.forEach(option => {
    option.classList.toggle("active", option.dataset.level === currentLevel);
  });
}
window.showPlanLevelModal = async function() {
  const subviewPlanLevel = document.getElementById("subview-plan-level");
  const subviews = [
    document.getElementById("subview-plan-schedule"),
    document.getElementById("subview-plan-stats"),
    document.getElementById("subview-plan-ranking"),
    document.getElementById("subview-plan-members"),
    subviewPlanLevel
  ].filter(Boolean);
  subviews.forEach(view => view.classList.add("hidden"));
  if (subviewPlanLevel) subviewPlanLevel.classList.remove("hidden");
  renderPlanLevelEditor();
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
  if (!plan) return;
  if (!isPlanStarted(plan)) return;

  const level = plan.level || "normal";
  if (getPlanLevelOrder(level) <= 1) return;

  const start = new Date(plan.startDate);
  const today = new Date();
  start.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const elapsedDays = Math.max(0, Math.min(
    plan.days.length,
    Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1
  ));
  const requiredDaysWithGrace = Math.max(0, elapsedDays - 2);
  if (requiredDaysWithGrace <= 0) return;

  const expectedChaptersWithGrace = plan.days
    .slice(0, requiredDaysWithGrace)
    .reduce((sum, day) => sum + ((day.chapters && day.chapters.length) || 0), 0);

  calculatePlanProgress();
  const actualCompletedChapters = plan.completedChapters || 0;
  if (expectedChaptersWithGrace <= 0 || actualCompletedChapters >= expectedChaptersWithGrace) return;

  const newLevel = level === "super" ? "breakthrough" : "normal";
  const oldLabel = getPlanLevelLabel(level);
  const newLabel = getPlanLevelLabel(newLevel);
  plan.wasDowngraded = true;
  plan.downgradeLockedUntil = addDaysIso(14);

  rebuildPlanScheduleForLevel(plan, newLevel);
  calculatePlanProgress();
  await persistPlanLevelState(plan);

  showToast("進度已落後超過 2 天，已自動降級。兩週內暫停升級申請。");
}
async function handleRoundCompletion(plan) {
  if (!plan) return;
  calculatePlanProgress();

  if (plan.pendingUpgradePrompt || plan.upgradePromptHandled) return;
  if (plan.currentRound && plan.currentRound > 1) {
    showToast("已完成本輪讀經。");
    return;
  }

  const currentLevel = plan.level || "normal";
  const nextLevel = currentLevel === "normal" ? "breakthrough" : (currentLevel === "breakthrough" ? "super" : null);
  if (!nextLevel) {
    showToast("恭喜完成讀經計畫！");
    return;
  }

  plan.pendingUpgradePrompt = true;
  const wantsUpgrade = confirm("恭喜完成第一遍！是否要升級到「" + getPlanLevelLabel(nextLevel) + "」並開始下一遍？");
  plan.pendingUpgradePrompt = false;

  if (!wantsUpgrade) {
    plan.upgradePromptHandled = true;
    showToast("已完成計畫。你可以之後到調整進度設定再升級。");
    await persistPlanLevelState(plan);
    if (!state.isSupabaseMode) localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans || []));
    return;
  }

  if (isPlanUpgradeLocked(plan)) {
    showToast("降級後兩週內暫停升級申請，可於 " + formatLockDate(getDowngradeLockedUntil(plan)) + " 後再升級。");
    return;
  }

  plan.upgradePromptHandled = true;
  plan.currentRound = 2;
  plan.wasDowngraded = false;
  plan.downgradeLockedUntil = null;
  rebuildPlanScheduleForLevel(plan, nextLevel);

  await persistPlanLevelState(plan);
  if (state.isSupabaseMode && state.supabase && plan.id) {
    await state.supabase.from("reading_plans")
      .update({ current_round: plan.currentRound, upgrade_prompt_handled: !!plan.upgradePromptHandled })
      .eq("id", plan.id);
  } else if (!state.isSupabaseMode) {
    localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans || []));
  }

  if (!state.isSupabaseMode) localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans || []));

  calculatePlanProgress();
  state.planDetailOpen = true;
  showToast("已升級到「" + getPlanLevelLabel(nextLevel) + "」，開始下一遍讀經。");
}

window.changePlanLevel = async function(newLevel) {
  if (!state.activePlan) return;

  const currentLevel = state.activePlan.level || "normal";
  const isUpgrade = getPlanLevelOrder(newLevel) > getPlanLevelOrder(currentLevel);
  const lockedUntil = getDowngradeLockedUntil(state.activePlan);
  if (isUpgrade && isPlanUpgradeLocked(state.activePlan)) {
    showToast("降級後兩週內暫停升級申請，可於 " + formatLockDate(lockedUntil) + " 後再升級。");
    return;
  }

  loader.show("正在變更進度等級...");

  if (isUpgrade && lockedUntil && !isPlanUpgradeLocked(state.activePlan)) {
    state.activePlan.wasDowngraded = false;
    state.activePlan.downgradeLockedUntil = null;
  }

  state.activePlan.upgradePromptHandled = false;
  rebuildPlanScheduleForLevel(state.activePlan, newLevel);
  if (state.activePlans) {
    const planInList = state.activePlans.find(p =>
      p === state.activePlan ||
      (p.id && p.id === state.activePlan.id) ||
      (p.presetKey && p.presetKey === state.activePlan.presetKey)
    );
    if (planInList && planInList !== state.activePlan) {
      rebuildPlanScheduleForLevel(planInList, newLevel);
      planInList.wasDowngraded = state.activePlan.wasDowngraded;
      planInList.downgradeLockedUntil = state.activePlan.downgradeLockedUntil || null;
      planInList.upgradePromptHandled = false;
    }
  }

  await persistPlanLevelState(state.activePlan);
  if (!state.isSupabaseMode) localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans || []));
  calculatePlanProgress();

  await checkPlanSchedule(state.activePlan);

  loader.hide();
  renderPlanView();
  updateDashboardView();
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

  // Toggle Form
  addBtn.onclick = () => {
    document.getElementById("admin-plan-form-title").textContent = "新增讀經計畫";
    document.getElementById("admin-edit-plan-id").value = "";
    document.getElementById("admin-plan-name").value = "";
    document.getElementById("admin-plan-start-date").value = "";
    document.getElementById("admin-plan-end-date").value = "";
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
    const startDate = document.getElementById("admin-plan-start-date").value;
    const endDate = document.getElementById("admin-plan-end-date").value;

    const checkedBooks = [];
    document.querySelectorAll(".admin-book-checkbox:checked").forEach(cb => {
      checkedBooks.push(cb.value);
    });

    if (!name) {
      alert("請輸入計畫名稱！");
      return;
    }
    if (!startDate || !endDate) {
      alert("請選擇計畫開始與結束日期！");
      return;
    }
    if (new Date(startDate) > new Date(endDate)) {
      alert("開始日期不可晚於結束日期！");
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
      books: checkedBooks
    });
    loader.hide();

    if (success) {
      alert("計畫儲存成功！");
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

  tableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">載入計畫列表中...</td></tr>`;

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

      tr.innerHTML = `
        <td>
          <strong style="display: block; margin-bottom: 0.15rem; font-size: 0.82rem; word-break: break-all;">${escapeHTML(plan.name)}${hidden ? ' <span style="color:#f59e0b; font-size:0.68rem; font-weight:800;">已隱藏</span>' : ''}</strong>
          <span title="${escapeHTML(bookListText)}" style="font-size: 0.7rem; color: var(--text-muted); cursor: help; text-decoration: underline dashed; text-underline-offset: 2px;">
            共 ${bookCount} 卷書卷
          </span>
        </td>
        <td>
          <span style="font-size: 0.72rem; font-weight: 600; display: block; white-space: nowrap;">📅 ${plan.startDate}</span>
          <span style="font-size: 0.72rem; font-weight: 600; display: block; white-space: nowrap; margin-left: 0.6rem; color: var(--text-muted);">~ ${plan.endDate}</span>
        </td>
        <td style="text-align: center; vertical-align: middle;">
          <div style="display: flex; flex-direction: column; gap: 0.25rem; align-items: center; justify-content: center;">
            <button class="primary-btn admin-edit-plan-btn" style="font-size: 0.68rem; padding: 0.2rem 0.4rem; min-width: 42px; text-align: center; height: auto; cursor: pointer;">編輯</button>
            <button class="danger-btn admin-delete-plan-btn" style="font-size: 0.68rem; padding: 0.2rem 0.4rem; min-width: 42px; text-align: center; height: auto; cursor: pointer;">刪除</button>
          </div>
        </td>
      `;

      // Bind edit event
      tr.querySelector(".admin-edit-plan-btn").onclick = () => {
        document.getElementById("admin-plan-form-title").textContent = "編輯讀經計畫";
        document.getElementById("admin-edit-plan-id").value = plan.id;
        document.getElementById("admin-plan-name").value = plan.name;
        document.getElementById("admin-plan-start-date").value = plan.startDate;
        document.getElementById("admin-plan-end-date").value = plan.endDate;
        
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
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444;">載入計畫失敗: ${err.message || err}</td></tr>`;
  }
}


// Initialize state for inline reader
state.inlineReader = {
  active: false,
  dayNum: 0,
  chaptersList: [],
  currentIndex: 0,
  autoMarked: false
};

window.openPlanInlineReader = function(bookName, chapter, dayNum, round = null) {
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

window.closePlanInlineReader = function() {
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
    container.innerHTML = `<div class="loader-inline" style="text-align: center; padding: 2rem; color: var(--text-muted);">讀取經文中...</div>`;
    
    const book = BIBLE_BOOKS.find(b => b.name === currentCh.book);
    if (book) {
      try {
        const data = await fetchBibleChapter(book.eng, currentCh.chapter);
        container.innerHTML = "";
        data.verses.forEach(v => {
          const verseDiv = document.createElement("div");
          verseDiv.className = "bible-verse";
          verseDiv.style.marginBottom = "0.8rem";
          verseDiv.innerHTML = `<span class="verse-num" style="font-weight: 700; color: var(--primary-color); margin-right: 0.5rem; font-size: 0.85rem;">${v.verse}</span><span class="verse-text" style="font-size: 1.05rem; line-height: 1.8;">${v.text}</span>`;
          container.appendChild(verseDiv);
        });
      } catch (err) {
        container.innerHTML = `<div style="text-align: center; padding: 2rem; color: #ef4444;">載入經文失敗: ${err.message || err}</div>`;
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

window.navigateInlineChapter = function(direction) {
  const newIndex = state.inlineReader.currentIndex + direction;
  if (newIndex >= 0 && newIndex < state.inlineReader.chaptersList.length) {
    state.inlineReader.currentIndex = newIndex;
    renderInlineScriptureText();
  }
};

// Window scroll listener for inline reader automatic check-in
window.addEventListener("scroll", async () => {
  if (!state.inlineReader || !state.inlineReader.active) return;
  if (state.inlineReader.autoMarked) return;

  const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
  const windowHeight = window.innerHeight;
  const docHeight = document.documentElement.scrollHeight;

  if (scrollTop + windowHeight >= docHeight - 50) {
    state.inlineReader.autoMarked = true; // prevent double trigger
    
    const currentCh = state.inlineReader.chaptersList[state.inlineReader.currentIndex];
    if (!currentCh) return;

    const readRound = currentCh.round || (state.activePlan ? (state.activePlan.currentRound || 1) : 1);
    const isAlreadyRead = state.readingLogs.some(l =>
      l.book === currentCh.book &&
      Number(l.chapter) === Number(currentCh.chapter) &&
      Number(l.round || 1) === Number(readRound)
    );
    if (!isAlreadyRead) {
      await db.logChapterRead(currentCh.book, currentCh.chapter, true, readRound);
      
      if (readRound === 1) currentCh.isReadR1 = true;
      else if (readRound === 2) currentCh.isReadR2 = true;
      else if (readRound === 3) currentCh.isReadR3 = true;
      currentCh.isRead = true;
      calculatePlanProgress();
      db.saveLocalUserStats();

      if (state.activePlan && state.activePlan.isPlanCompleted && !state.activePlan.upgradePromptHandled) {
        await handleRoundCompletion(state.activePlan);
      }

      // Show toast
      if (typeof showToast === 'function') {
        showToast(`📖 已自動將 ${currentCh.book} 第 ${currentCh.chapter} 章標記為已讀！`);
      }
    }
  }
});


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

    // 3. Progress Status (進度狀態)
    const reportStatProgressStatus = document.getElementById("report-stat-progress-status");
    if (reportStatProgressStatus) {
      if (currentRound > 1) {
        // 第二遍以後：顯示「第N遍 第X天」，不再顯示落後/超前
        reportStatProgressStatus.textContent = `第${currentRound}遍 第${completedCurrentRound}天`;
        reportStatProgressStatus.style.color = currentRound === 2 ? "#6366f1" : "#f59e0b";
      } else {
        const diff = completedR1 - expectedDaysCount;
        if (diff > 0) {
          reportStatProgressStatus.textContent = `超前 ${diff}天`;
          reportStatProgressStatus.style.color = "#10b981";
        } else if (diff < 0) {
          reportStatProgressStatus.textContent = `落後 ${Math.abs(diff)}天`;
          reportStatProgressStatus.style.color = "#ef4444";
        } else {
          reportStatProgressStatus.textContent = "進度一致";
          reportStatProgressStatus.style.color = "var(--text-primary)";
        }
      }
    }

    // 4. Makeup/Catch up days (補讀)
    // Round 2+: freeze at round-1 value (should be 0 if round 1 is done)
    const makeupDays = currentRound > 1
      ? Math.max(0, totalPlanDays - completedR1)  // frozen from round 1
      : Math.max(0, expectedDaysCount - completedR1);
    const reportStatMakeup = document.getElementById("report-stat-makeup");
    if (reportStatMakeup) reportStatMakeup.textContent = makeupDays;

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
  } catch(e) {
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
    } else if (overrideFilter.startsWith("zone:")) {
      const zone = overrideFilter.replace("zone:", "");
      if (zone === "未設定牧區") {
        scopedUsers = allUsers.filter(u => !u.pastoral_zone || u.pastoral_zone.trim() === "");
      } else {
        scopedUsers = allUsers.filter(u => u.pastoral_zone === zone);
      }
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
  if (labelActive) labelActive.textContent = scopeLabel === "全教會" ? '本週全教會活躍人數' : `${scopeLabel} 本週活躍人數`;

  const legacyMiniStatsGrid = document.getElementById("grp-total-read")?.parentElement?.parentElement;
  if (legacyMiniStatsGrid) legacyMiniStatsGrid.style.display = "none";

  const elTotal = document.getElementById('grp-total-read');
  const elMembers = document.getElementById('grp-total-members');
  const elActive = document.getElementById('grp-active-members');

  if (elTotal) elTotal.textContent = totalChapters + ' 章';
  if (elMembers) elMembers.textContent = totalMembers + ' 人';
  if (elActive) elActive.textContent = totalActive + ' 人';

  // Also stash for charts
  window._grpScopedUsers = scopedUsers;
  window._grpAllUsers = allUsers;
}

function renderGroupProgressDistribution() {
  const scopedUsers = window._grpScopedUsers || [];
  const totalCount = scopedUsers.length;
  const distCard = document.getElementById("grp-distribution-card");

  if (totalCount === 0) {
    if (distCard) distCard.style.display = "none";
    return;
  }
  if (distCard) distCard.style.display = "";

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
    if (currentRound >= 2) rereadCount++;

    if (u.plan_progress === 0) behindCount++;
    else if (u.plan_progress > expectedPct + 5) aheadCount++;
    else if (u.plan_progress < expectedPct - 5) behindCount++;
    else onCount++;
  });

  const segments = [
    { key: "behind", label: "落後", count: behindCount, color: "#ef4444" },
    { key: "on", label: "在進度上", count: onCount, color: "#64748b" },
    { key: "ahead", label: "超前", count: aheadCount, color: "#10b981" }
  ].map(item => ({
    ...item,
    pct: totalCount ? Math.round((item.count / totalCount) * 100) : 0
  }));

  const titleEl = document.getElementById("grp-distribution-title");
  if (titleEl) titleEl.textContent = titleSuffix;

  Array.from(distCard.children).forEach(child => {
    if (child !== titleEl) child.remove();
  });

  const body = document.createElement("div");
  body.className = "stacked-progress-body distribution-redesign";
  body.innerHTML = `
    <div class="distribution-primary-stats">
      <div class="distribution-metric-card primary">
        <span>總閱讀章數</span>
        <strong>${totalChapters} 章</strong>
        <small>目前範圍累計</small>
      </div>
      <div class="distribution-metric-card success">
        <span>參與人數</span>
        <strong>${totalCount} 人</strong>
        <small>目前範圍</small>
      </div>
      <div class="distribution-metric-card warning">
        <span>每日活躍人數</span>
        <strong>${dailyActiveCount} 人</strong>
        <small>今日有讀即計入</small>
      </div>
    </div>
    <div class="distribution-secondary-stats">
      <div class="distribution-metric-card compact">
        <span>今日已完成</span>
        <strong>${todayRate}%</strong>
        <small>${todayDoneCount} / ${totalCount} 人</small>
      </div>
      <div class="distribution-metric-card compact">
        <span>複讀人數</span>
        <strong>${rereadCount} 人</strong>
        <small>${totalCount ? Math.round((rereadCount / totalCount) * 100) : 0}%</small>
      </div>
    </div>
    <div class="stacked-progress-summary">
      <span>落後</span>
      <span>在進度上</span>
      <span>超前</span>
    </div>
    <div class="stacked-percent-bar" role="img" aria-label="讀經進度分佈百分比堆疊條形圖：落後、在進度上、超前">
      ${segments.map(seg => `
        <div class="stacked-segment ${seg.key}" style="--segment-width: ${seg.pct}%; --segment-color: ${seg.color};" title="${seg.label}: ${seg.count} 人 (${seg.pct}%)">
          ${seg.pct >= 10 ? `<span>${seg.pct}%</span>` : ""}
        </div>
      `).join("")}
    </div>
    <div class="stacked-progress-legend">
      ${segments.map(seg => `
        <div class="stacked-legend-item ${seg.key}">
          <span class="stacked-dot" style="background: ${seg.color};"></span>
          <span class="stacked-label">${seg.label}</span>
          <strong>${seg.count} 人</strong>
          <span>${seg.pct}%</span>
        </div>
      `).join("")}
    </div>
  `;
  distCard.appendChild(body);
  requestAnimationFrame(() => {
    body.querySelectorAll(".stacked-segment").forEach(seg => {
      seg.style.width = seg.style.getPropertyValue("--segment-width");
    });
  });
}

function renderGroupPastoralChart() {
  return; // Disabled
}

function renderGroupZoneChartWithSelector() {
  // Merged into renderGroupPastoralChart above
  return;
}

function renderGroupGrowthTrend() {
  return; // Disabled
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
      ? '全教會讀經熱點地圖 (計畫期間打卡活躍度)'
      : `${scopeLabel} 讀經熱點地圖 (計畫期間打卡活躍度)`;
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
  
  const activeStyle = { background: "var(--primary-color)", color: "white" };
  const inactiveStyle = { background: "none", color: "var(--text-muted)" };
  
  [btnWeek, btnMonth, btnYear].forEach(btn => {
    if (btn) Object.assign(btn.style, inactiveStyle);
  });
  
  const activeBtn = document.getElementById(`trend-range-${range}`);
  if (activeBtn) Object.assign(activeBtn.style, activeStyle);

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
  const fontColor = isDark ? '#cbd5e1' : '#475569';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  if (window._personalTrendChart) window._personalTrendChart.destroy();
  
  window._personalTrendChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '每日讀經章數',
        data: chartData,
        borderColor: 'rgba(99, 102, 241, 1)',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointBackgroundColor: 'rgba(99, 102, 241, 1)',
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
            label: function(context) {
              return `讀經章數: ${context.raw} 章`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: fontColor, font: { size: 9 } },
          grid: { display: false }
        },
        y: {
          ticks: { color: fontColor, stepSize: range === "year" ? 20 : 5 },
          grid: { color: gridColor },
          min: 0
        }
      }
    }
  });
}

// Window actions
window.changePersonalTrendRange = function(range) {
  state.personalTrendRange = range;
  renderPersonalTrendChart();
};

function renderPersonalUnlockedBadges() {
  renderBadgeWall("stats-badge-wall-container");
}

async function renderMyPersonalRankings() {
  if (!state.activePlan) return;
  
  // Calculate completedDaysCount
  const completedDaysCount = state.activePlan.days.filter(d => {
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
  } catch(e) {
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
  
  const elRankAll = document.getElementById("my-rank-all");
  const elRankAllTotal = document.getElementById("my-rank-all-total");
  if (elRankAll) elRankAll.textContent = `第 ${myRankAll} 名`;
  if (elRankAllTotal) elRankAllTotal.textContent = `共 ${sortedAll.length} 人`;
  
  // Sort for Pastoral Zone Rank
  const zoneUsers = userProgressList.filter(u => u.pastoral_zone === myZone);
  const sortedZone = [...zoneUsers].sort((a, b) => b.progress - a.progress);
  const myIndexZone = sortedZone.findIndex(u => u.name === myName);
  const myRankZone = myIndexZone !== -1 ? myIndexZone + 1 : sortedZone.length;
  const elRankZoneTitle = document.getElementById("my-rank-zone-title");
  const elRankZone = document.getElementById("my-rank-zone");
  const elRankZoneTotal = document.getElementById("my-rank-zone-total");
  
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
  container.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.82rem;">載入牧區排行中...</div>`;

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
  } catch(e) {
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
  const personalStreak = state.currentUser.streak || 0;
  
  const completedDaysCount = state.activePlan.days.filter(d => {
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
    listContainer.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.82rem;">載入成員數據中...</div>`;
    
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
    } catch(e) {
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
      const streak = isMe ? personalStreak : (u.streak || 0);
      
      let completed = 0;
      let makeup = 0;
      let diff = 0;
      
      if (isMe) {
        completed = completedDaysCount;
        makeup = Math.max(0, expectedDaysCount - completedDaysCount);
        diff = completed - expectedDaysCount;
      } else {
        completed = Math.round(((u.plan_progress || 0) / 100) * state.activePlan.days.length);
        completed = Math.min(completed, state.activePlan.days.length);
        makeup = Math.max(0, expectedDaysCount - completed);
        diff = completed - expectedDaysCount;
      }
      
      let statusStr = "進度一致";
      let statusColor = "var(--text-muted)";
      if (diff > 0) {
        statusStr = `超前 ${diff}天`;
        statusColor = "#10b981";
      } else if (diff < 0) {
        statusStr = `落後 ${Math.abs(diff)}天`;
        statusColor = "#ef4444";
      }
      
      return {
        name: u.name,
        streak: streak,
        completed: completed,
        makeup: makeup,
        statusStr: statusStr,
        statusColor: statusColor,
        isMe: isMe
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

window.displayParticipantsList = function(limit = 100) {
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

  visibleItems.forEach(m => {
    const itemRow = document.createElement("div");
    itemRow.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 80px 80px 70px 90px;
      gap: 0.4rem;
      align-items: center;
      padding: 0.6rem 0.2rem;
      border-bottom: 1px solid var(--border-card);
      font-size: 0.88rem;
      font-weight: 700;
      text-align: center;
    `;
    if (m.isMe) {
      itemRow.style.background = "rgba(99, 102, 241, 0.08)";
      itemRow.style.borderRadius = "8px";
    }

    itemRow.innerHTML = `
      <div style="text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${m.isMe ? 'var(--primary-color)' : 'var(--text-primary)'};">
        ${escapeHTML(m.name)}
      </div>
      <div style="color: #ef4444;">${m.streak}</div>
      <div style="color: #10b981;">${m.completed}</div>
      <div style="color: #f59e0b;">${m.makeup}</div>
      <div style="color: ${m.statusColor}; font-size: 0.8rem;">${m.statusStr}</div>
    `;
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
      font-weight: 800;
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
