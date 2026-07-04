// Reading plans tab view controller

window._currentStatsTab = 'personal';
window._statsTabScope = null;

// Asynchronous Request & Click Debounce state trackers
let lastTrackerRequestId = 0;
let dateClickDebounceTimer = null;
let viewMode = 'card'; // 'card' or 'calendar'

// Reactive state propagation audit
window.addEventListener("planDataChanged", (e) => {
  console.log('🏗️ [系統審計] 收到資料變更事件通知，強制重新渲染組件，資料版本:', e.detail.dataVersion);
  renderHorizontalDateStrip();
  renderPlanScheduleTracker(true);
});

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

  // 1. Calculate parseLocalDate
  const parseLocalDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  // 2. If level is normal AND it is a preset plan, use the original month-by-month calendar grid
  if (level === "normal" && preset && preset.months) {
    const days = [];
    let dayNumCounter = 1;
    let totalChaptersCount = 0;

    preset.months.forEach(mSpec => {
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
      totalChaptersCount += expandedChapters.length;

      const readingDays = mSpec.readingDays;
      const dailyChapters = distributeChaptersAcrossDays(expandedChapters, readingDays);
      const daysInMonth = new Date(mSpec.year, mSpec.month, 0).getDate();

      for (let dayOffset = 0; dayOffset < daysInMonth; dayOffset++) {
        const dayDate = new Date(mSpec.year, mSpec.month - 1, dayOffset + 1);
        const mm = String(dayDate.getMonth() + 1).padStart(2, '0');
        const dd = String(dayDate.getDate()).padStart(2, '0');
        const dateStr = `${mm}/${dd}`;

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

  // 3. Otherwise (custom plans, or upgraded preset plans), use the new segmented round-distribution logic!
  const allChapters = [];
  const booksToUse = preset && preset.months ? preset.months.flatMap(m => m.books) : selectedBooks;
  booksToUse.forEach(bookName => {
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

  // Calculate D1 and D2 (round completion days) dynamically from reading logs
  let d1 = null;
  let d2 = null;

  if (level === "breakthrough" || level === "super") {
    const round1Logs = (state.readingLogs || []).filter(l => (l.round || 1) === 1);
    if (round1Logs.length > 0) {
      const maxDateStr = round1Logs.reduce((max, log) => log.read_at > max ? log.read_at : max, round1Logs[0].read_at);
      const maxDate = new Date(maxDateStr.substring(0, 10));
      maxDate.setHours(0, 0, 0, 0);
      start.setHours(0, 0, 0, 0);
      d1 = Math.max(1, Math.floor((maxDate - start) / (1000 * 60 * 60 * 24)) + 1);
      d1 = Math.min(d1, totalDays - 1);
    } else {
      d1 = Math.floor(totalDays / (level === "super" ? 3 : 2));
    }

    if (level === "super") {
      const round2Logs = (state.readingLogs || []).filter(l => l.round === 2);
      if (round2Logs.length > 0) {
        const maxDateStr = round2Logs.reduce((max, log) => log.read_at > max ? log.read_at : max, round2Logs[0].read_at);
        const maxDate = new Date(maxDateStr.substring(0, 10));
        maxDate.setHours(0, 0, 0, 0);
        start.setHours(0, 0, 0, 0);
        d2 = Math.max(d1 + 1, Math.floor((maxDate - start) / (1000 * 60 * 60 * 24)) + 1);
        d2 = Math.min(d2, totalDays - 1);
      } else {
        d2 = Math.floor(totalDays * 2 / 3);
      }
    }
  }

  let dailyChapters = Array.from({ length: totalDays }, () => []);

  // Distribute Round 1
  const round1Chapters = allChapters.map(ch => ({ ...ch, round: 1 }));
  if (d1 === null) {
    dailyChapters = distributeChaptersAcrossDays(round1Chapters, totalDays);
  } else {
    const r1Daily = distributeChaptersAcrossDays(round1Chapters, d1);
    for (let i = 0; i < d1; i++) {
      dailyChapters[i] = dailyChapters[i].concat(r1Daily[i]);
    }

    // Distribute Round 2
    const round2Chapters = allChapters.map(ch => ({ ...ch, round: 2 }));
    if (level === "breakthrough") {
      const r2Days = totalDays - d1;
      const r2Daily = distributeChaptersAcrossDays(round2Chapters, r2Days);
      for (let i = 0; i < r2Days; i++) {
        dailyChapters[d1 + i] = dailyChapters[d1 + i].concat(r2Daily[i]);
      }
    } else if (level === "super") {
      const r2Days = d2 - d1;
      const r2Daily = distributeChaptersAcrossDays(round2Chapters, r2Days);
      for (let i = 0; i < r2Days; i++) {
        dailyChapters[d1 + i] = dailyChapters[d1 + i].concat(r2Daily[i]);
      }

      // Distribute Round 3
      const round3Chapters = allChapters.map(ch => ({ ...ch, round: 3 }));
      const r3Days = totalDays - d2;
      const r3Daily = distributeChaptersAcrossDays(round3Chapters, r3Days);
      for (let i = 0; i < r3Days; i++) {
        dailyChapters[d2 + i] = dailyChapters[d2 + i].concat(r3Daily[i]);
      }
    }
  }

  const days = dailyChapters.map((chapters, index) => {
    const dayDate = new Date(start);
    dayDate.setDate(start.getDate() + index);
    const mm = String(dayDate.getMonth() + 1).padStart(2, '0');
    const dd = String(dayDate.getDate()).padStart(2, '0');
    const dateStr = `${mm}/${dd}`;

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
    totalChapters: allChapters.length * getPlanLevelRounds(level),
    completedChapters: 0,
    progress: 0,
    days,
    presetKey,
    target_books: selectedBooks,
    level,
    currentRound: getPlanLevelRounds(level),
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

  // Synchronize dynamic title and options menu in the Top App Bar
  if (typeof appRouter !== 'undefined' && typeof appRouter.updateNavigationChrome === 'function') {
    appRouter.updateNavigationChrome();
  }
}



function getPlanCoverColor(plan) {
  const covers = window.NLC_PLAN_COVERS || ["#B8E8F5", "#C8F5D8", "#FFE4CC", "#D4E4F7", "#E8E0F5"];
  const presetMap = { q1: 1, q2: 2, q3: 3, q4: 4 };
  const idx = presetMap[plan.presetKey] ?? 0;
  return covers[idx] || covers[0];
}

function getPlanCoverHtml(plan) {
  const bg = getPlanCoverColor(plan);
  let text = "速讀";
  if (plan.presetKey === "q1") text = "第一季";
  else if (plan.presetKey === "q2") text = "第二季";
  else if (plan.presetKey === "q3") text = "第三季";
  else if (plan.presetKey === "q4") text = "第四季";
  return `<div class="plan-cover-thumbnail" style="width: 72px; height: 72px; border-radius: 12px; background: ${bg}; display: flex; align-items: center; justify-content: center; color: #0F0F0F; font-weight: 800; font-size: 0.95rem; flex-shrink: 0; box-shadow: var(--shadow-sm);">${text}</div>`;
}

function renderJoinedPlansList() {
  const container = document.getElementById("joined-plans-list");
  if (!container) return;

  if (!state.activePlans) {
    ComponentSkeletonLoader.show('plan', container);
    return;
  }

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
    coverCard.style.background = getPlanCoverColor(state.activePlan);
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

  // Initialize plan view mode (default is 'card')
  const initialViewMode = state.planViewMode === 'calendar' ? 'calendar' : 'card';
  setViewMode(initialViewMode);

  renderPlanScheduleTracker();
}


function isChapterReadForRound(ch, round) {
  if (!ch) return false;
  const chRound = ch.round || 1;
  if (chRound < round) return true;
  if (chRound > round) return false;
  if (round === 1) return Boolean(ch.isReadR1 || ch.isRead);
  if (round === 2) return Boolean(ch.isReadR2);
  if (round >= 3) return Boolean(ch.isReadR3);
  return Boolean(ch.isRead);
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
  return plan.days.find(day => !isPlanDayCompletedForRound(day, currentRound)) || plan.days[plan.days.length - 1];
}

function getExpectedPlanDayCount(plan = state.activePlan, now = new Date()) {
  if (!plan || !plan.days || plan.days.length === 0 || !plan.startDate) return 0;
  const planStart = new Date(plan.startDate);
  if (isNaN(planStart.getTime())) return 0;
  planStart.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const elapsedDays = Math.floor((today - planStart) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(0, Math.min(plan.days.length, elapsedDays));
}

function getPlanProgressStatus(plan = state.activePlan) {
  if (!plan || !plan.days || plan.days.length === 0) {
    return { label: "進度一致", color: "var(--text-primary)", bg: "var(--color-brand-muted, rgba(4,169,210,0.08))", diff: 0 };
  }

  const currentRound = plan.currentRound || 1;
  if (currentRound > 1 || plan.isPlanCompleted) {
    return {
      label: "第" + currentRound + "遍",
      color: currentRound === 2 ? "#04A9D2" : "#FE7615",
      bg: currentRound === 2 ? "rgba(4, 169, 210, 0.15)" : "rgba(254, 118, 21, 0.15)",
      diff: 0
    };
  }

  const nextDay = getNextReadingPlanDay(plan);
  const nextDayNum = nextDay ? Number(nextDay.dayNum || 1) : 1;
  const completedBeforeNext = Math.max(0, nextDayNum - 1);
  const expectedDays = getExpectedPlanDayCount(plan);
  const diff = completedBeforeNext - expectedDays;

  if (diff > 0) {
    return { label: "超前 " + diff + "天", color: "#10b981", bg: "rgba(16, 185, 129, 0.15)", diff };
  }
  if (diff < 0) {
    return { label: "落後 " + Math.abs(diff) + "天", color: "#ef4444", bg: "rgba(239, 68, 68, 0.15)", diff };
  }
  return { label: "進度一致", color: "var(--text-primary)", bg: "var(--color-brand-muted, rgba(4,169,210,0.08))", diff: 0 };
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

  // 3. Create the Calendar Wrapper (Clean flat look, completely borderless)
  const calendarWrapper = document.createElement("div");
  calendarWrapper.className = "calendar-component";
  calendarWrapper.style.cssText = "background: transparent !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; padding: 0 !important; width: 100% !important; margin: 0 !important; display: flex; flex-direction: column;";

  // 4. Create Global Static Weekday Header (outside the scroll container)
  const weekdaysDiv = document.createElement("div");
  weekdaysDiv.className = "calendar-weekdays";
  weekdaysDiv.style.cssText = "display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; margin-bottom: 0.4rem; padding-bottom: 0.4rem; border-bottom: none !important; font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;";
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
  scrollContainer.style.cssText = "overflow-y: auto; width: 100%; display: flex; flex-direction: column; scrollbar-width: none; -ms-overflow-style: none;";

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
  gridDiv.style.cssText = "display: grid; grid-template-columns: repeat(7, 1fr); gap: 24px 4px !important; padding: 16px 0 !important; width: 100%;";



  // Render cells flatly
  cells.forEach(cell => {
    const dayCell = document.createElement("div");
    dayCell.className = "calendar-day";

    // Minimal Month Identifier: 1st of month displays "M/D" (e.g. 7/1), others display "D"
    const numberLabel = cell.dayOfMonth === 1 ? `${cell.month}/${cell.dayOfMonth}` : `${cell.dayOfMonth}`;
    dayCell.innerHTML = `<span class="day-number">${numberLabel}</span>`;

    const day = findPlanDay(cell.year, cell.month, cell.dayOfMonth);
    if (day) {
      dayCell.setAttribute("data-day-num", day.dayNum);

      const totalChapters = day.chapters ? day.chapters.length : 0;
      let completedChapters = 0;

      if (totalChapters > 0) {
        day.chapters.forEach(ch => {
          const currentRound = state.activePlan.currentRound || 1;
          const taskRound = ch.round || currentRound;
          let isRead = false;
          if (taskRound === 1) isRead = ch.isReadR1 || ch.isRead;
          else if (taskRound === 2) isRead = ch.isReadR2;
          else if (taskRound >= 3) isRead = ch.isReadR3;
          else isRead = ch.isRead;

          if (isRead) completedChapters++;
        });
      }

      const isDayCompleted = totalChapters > 0 && completedChapters === totalChapters;
      const isPartiallyCompleted = totalChapters > 0 && completedChapters > 0 && completedChapters < totalChapters;

      const isToday = cell.year === todayYear && cell.month === todayMonth && cell.dayOfMonth === todayDay;
      const isPast = cell.year < todayYear ||
        (cell.year === todayYear && cell.month < todayMonth) ||
        (cell.year === todayYear && cell.month === todayMonth && cell.dayOfMonth < todayDay);

      // Selected active focus highlight (circular grey background)
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
        e.stopPropagation();

        const clickedDate = `${cell.year}/${String(cell.month).padStart(2, '0')}/${String(cell.dayOfMonth).padStart(2, '0')}`;
        console.log('📅 [日曆切換防護] 已成功鎖定日期：', clickedDate, '準備渲染對應章節');

        if (window._dateSwitchAbortController) {
          window._dateSwitchAbortController.abort();
        }
        window._dateSwitchAbortController = new AbortController();
        const signal = window._dateSwitchAbortController.signal;

        state.selectedPlanDay = day.dayNum;

        // Redraw to refresh active highlights
        renderHorizontalDateStrip();
        renderPlanScheduleTracker(true, signal);
      });

    } else {
      // Not part of the reading plan
      dayCell.style.cursor = "default";
      dayCell.classList.add("other-month");

      const isToday = cell.year === todayYear && cell.month === todayMonth && cell.dayOfMonth === todayDay;
      if (isToday) {
        dayCell.classList.add("today");
      } else {
        const dot = document.createElement("div");
        dot.className = "day-status-dot dot-grey";
        dayCell.appendChild(dot);
      }
    }

    gridDiv.appendChild(dayCell);
  });



  scrollContainer.appendChild(gridDiv);
  calendarWrapper.appendChild(scrollContainer);
  container.appendChild(calendarWrapper);

  const applyCalendarMaxRows = () => {
    const firstCell = gridDiv.querySelector(".calendar-day");
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

  // Auto-scroll selected day into view (centered)
  setTimeout(() => {
    const activeDayCell = scrollContainer.querySelector(".calendar-day.active");
    const todayDayCell = scrollContainer.querySelector(".calendar-day.today");
    const targetCell = activeDayCell || todayDayCell;
    if (targetCell) {
      targetCell.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }, 60);
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

  // Ensure top view mode container is loaded (Card / Calendar mutual exclusion)
  renderPlanScheduleView();

  // Update date carousel
  if (!skipCarouselUpdate) {
    renderHorizontalDateStrip();
  }

  const selectedDay = state.activePlan.days.find(d => d.dayNum === state.selectedPlanDay);
  if (!selectedDay) return;

  // Render day subtitle
  const daySubtitle = document.getElementById("plan-day-subtitle");
  if (daySubtitle) {
    const year = selectedDay.year || new Date().getFullYear();
    const month = selectedDay.month || (new Date().getMonth() + 1);
    const dayOfMonth = selectedDay.date ? selectedDay.date.split('/')[1] : new Date().getDate();
    daySubtitle.textContent = `第 ${state.selectedPlanDay} 天 (${year}年${month}月${dayOfMonth}日)`;
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
      statusPill.textContent = "🧘 補讀/休息日";
      statusPill.style.background = "var(--color-brand-subtle, rgba(4,169,210,0.12))";
      statusPill.style.color = "var(--primary-color)";
    } else {
      const allDone = selectedDay.chapters.every(ch => {
        const currentRound = state.activePlan.currentRound || 1;
        const taskRound = ch.round || currentRound;
        if (taskRound === 1) return ch.isReadR1 || ch.isRead;
        if (taskRound === 2) return ch.isReadR2;
        if (taskRound >= 3) return ch.isReadR3;
        return ch.isRead;
      });
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

  // Update completion check on the active date card in the calendar dynamically
  const activeCard = document.querySelector(`.calendar-day[data-day-num="${state.selectedPlanDay}"]`);
  if (activeCard && state.activePlan) {
    const isDayCompleted = selectedDay.chapters && selectedDay.chapters.length > 0 && selectedDay.chapters.every(ch => {
      const currentRound = state.activePlan.currentRound || 1;
      const taskRound = ch.round || currentRound;
      if (taskRound === 1) return ch.isReadR1 || ch.isRead;
      if (taskRound === 2) return ch.isReadR2;
      if (taskRound >= 3) return ch.isReadR3;
      return ch.isRead;
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
        let isRead = false;
        if (taskRound === 1) isRead = ch.isReadR1 || ch.isRead;
        else if (taskRound === 2) isRead = ch.isReadR2;
        else if (taskRound >= 3) isRead = ch.isReadR3;
        else isRead = ch.isRead;
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
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
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
  const ICON_R1 = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const ICON_R2 = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style="width:14px;height:14px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
  const ICON_R3 = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style="width:15px;height:15px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

  if (currentRound === 1) {
    return ch.isReadR1 ? { cssClass: 'checked', content: ICON_R1 } : { cssClass: '', content: '' };
  }

  if (currentRound === 2) {
    return ch.isReadR2 ? { cssClass: 'checked round-2', content: ICON_R2 } : { cssClass: '', content: '' };
  }

  if (currentRound >= 3) {
    return ch.isReadR3 ? { cssClass: 'checked round-3', content: ICON_R3 } : { cssClass: '', content: '' };
  }

  return { cssClass: '', content: '' };
}

function getRoundBadge(ch, currentRound) {
  if (currentRound >= 3 && ch.isReadR2 && !ch.isReadR3) return '✓✓已讀';
  if (currentRound >= 2 && ch.isReadR1 && !ch.isReadR2) return '✓第1遍';
  return '';
}

window.toggleYouVersionChapter = function (checkboxEl, book, chapter, taskRound = null) {
  console.log('🏗️ [系統審計] 進入資料讀寫，當前操作類型：切換章節已讀狀態', '資料版本:', state.dataVersion);

  // Optimistic UI updates are instant, so we don't need to block click events via data-saving
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

  if (typeof updateDashboardView === "function") {
    updateDashboardView();
  }

  // 2. 💡 在背景非同步向 Supabase 發送寫入請求，不要阻塞使用者操作
  db.logChapterRead(book, chapter, willBeChecked, currentRound)
    .then(async () => {
      db.saveLocalUserStats();
      if (state.activePlan && state.activePlan.isPlanCompleted && !state.activePlan.upgradePromptHandled) {
        await handleRoundCompletion(state.activePlan);
      }
    })
    .catch(error => {
      console.error("Failed to update reading progress in background", error);
      // 💡 同步失敗時，自動還原打勾狀態並提示使用者
      updateLocalReadingLogs(book, chapter, currentRound, isCurrentlyRead);
      applyLocalReadState(chapterObj, isCurrentlyRead);
      calculatePlanProgress();
      renderPlanScheduleTracker(true);
      if (typeof updateDashboardView === "function") {
        updateDashboardView();
      }
      showToast("讀經進度同步失敗，請稍後再試");
    });
};

function renderPlanLevelEditor() {
  const currentLevel = state.activePlan ? (state.activePlan.level || "normal") : "normal";

  // 💡 關鍵修復：直接從計畫各章節的打卡狀態（R2, R3）計算實際已讀的最大遍數，避免與 raw logs 型態不合
  let maxReadRound = 1;
  if (state.activePlan && state.activePlan.days) {
    state.activePlan.days.forEach(day => {
      if (day.chapters) {
        day.chapters.forEach(ch => {
          if (ch.isReadR3) maxReadRound = Math.max(maxReadRound, 3);
          else if (ch.isReadR2) maxReadRound = Math.max(maxReadRound, 2);
        });
      }
    });
  }

  const options = document.querySelectorAll("#plan-level-options .plan-level-option");
  options.forEach(option => {
    const optLevel = option.dataset.level || "normal";
    const optRounds = getPlanLevelRounds(optLevel);

    option.classList.toggle("active", optLevel === currentLevel);

    // 只有當「目標選項的總遍數」低於「使用者實際已讀到的最大遍數」時，才進行防呆禁用
    if (optRounds < maxReadRound) {
      option.disabled = true;
      option.style.opacity = "0.4";
      option.style.cursor = "not-allowed";
      option.style.pointerEvents = "none";
      let span = option.querySelector("span");
      if (span && !span.innerHTML.includes("downgrade-warning")) {
        span.innerHTML += ` <span class="downgrade-warning" style="color: #ef4444; font-weight: bold;">(已讀至第 ${maxReadRound} 遍，不可調回此難度)</span>`;
      }
    } else {
      option.disabled = false;
      option.style.opacity = "";
      option.style.cursor = "pointer";
      option.style.pointerEvents = "auto";
      let span = option.querySelector("span");
      if (span) {
        // 清除舊有的防呆標示與警告字元
        const warningSpan = span.querySelector(".downgrade-warning");
        if (warningSpan) warningSpan.remove();
        span.innerHTML = span.innerHTML.replace(/\s*<span class="downgrade-warning".*?<\/span>/g, "");
        span.innerHTML = span.innerHTML.replace(/\s*<span style="color: #ef4444; font-weight: bold;">\(已晉升，不可調回低階難度\)<\/span>/g, "");
      }
    }
  });
}
window.showPlanLevelModal = async function () {
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

window.changePlanLevel = async function (newLevel) {
  if (!state.activePlan) return;

  const currentLevel = state.activePlan.level || "normal";

  // 💡 關鍵修復：直接從計畫各章節的打卡狀態（R2, R3）計算實際已讀的最大遍數
  let maxReadRound = 1;
  if (state.activePlan && state.activePlan.days) {
    state.activePlan.days.forEach(day => {
      if (day.chapters) {
        day.chapters.forEach(ch => {
          if (ch.isReadR3) maxReadRound = Math.max(maxReadRound, 3);
          else if (ch.isReadR2) maxReadRound = Math.max(maxReadRound, 2);
        });
      }
    });
  }

  const newRounds = getPlanLevelRounds(newLevel);
  if (newRounds < maxReadRound) {
    showToast(`您已打卡第 ${maxReadRound} 遍進度，無法調回低於此遍數的等級。`);
    return;
  }

  const currentLevelOrder = getPlanLevelOrder(currentLevel);
  const newLevelOrder = getPlanLevelOrder(newLevel);
  const isUpgrade = newLevelOrder > currentLevelOrder;
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
  if (typeof showToast === "function") {
    showToast(`已成功將計畫難度變更為「${getPlanLevelLabel(newLevel)}」！`);
  }
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



window.openPlanChapterInReader = function (bookName, chapter, dayNum, round = null) {
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

window.navigateInlineChapter = function (direction) {
  const newIndex = state.inlineReader.currentIndex + direction;
  if (newIndex >= 0 && newIndex < state.inlineReader.chaptersList.length) {
    state.inlineReader.currentIndex = newIndex;
    renderInlineScriptureText();
  }
};

// Window scroll listener for inline reader automatic check-in.
// This is intentionally limited to the plan detail inline reader only.
window.addEventListener("scroll", async () => {
  if (!state.inlineReader || !state.inlineReader.active) return;
  if (!state.activePlan || !state.planDetailOpen) return;
  if (typeof appRouter !== "undefined" && appRouter.currentTab !== "plan-view") return;

  const inlineReader = document.getElementById("plan-inline-reader");
  if (!inlineReader || inlineReader.classList.contains("hidden")) return;
  if (state.inlineReader.autoMarked) return;

  const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
  const windowHeight = window.innerHeight;
  const docHeight = document.documentElement.scrollHeight;

  if (scrollTop + windowHeight >= docHeight - 50) {
    state.inlineReader.autoMarked = true;

    const currentCh = state.inlineReader.chaptersList[state.inlineReader.currentIndex];
    if (!currentCh) return;

    const readRound = currentCh.round || (state.activePlan ? (state.activePlan.currentRound || 1) : 1);
    const isAlreadyRead = state.readingLogs.some(l =>
      l.book === currentCh.book &&
      Number(l.chapter) === Number(currentCh.chapter) &&
      Number(l.round || 1) === Number(readRound)
    );

    if (!isAlreadyRead) {
      // 1. 💡 立即在本機更新記憶體與進度狀態
      if (readRound === 1) currentCh.isReadR1 = true;
      else if (readRound === 2) currentCh.isReadR2 = true;
      else if (readRound === 3) currentCh.isReadR3 = true;
      currentCh.isRead = true;
      calculatePlanProgress();

      if (typeof showToast === "function") {
        showToast("已自動將 " + currentCh.book + " 第 " + currentCh.chapter + " 章標記為已讀！");
      }

      // 2. 💡 在背景非同步發送 Supabase 寫入
      db.logChapterRead(currentCh.book, currentCh.chapter, true, readRound)
        .then(async () => {
          db.saveLocalUserStats();
          if (state.activePlan && state.activePlan.isPlanCompleted && !state.activePlan.upgradePromptHandled) {
            await handleRoundCompletion(state.activePlan);
          }
        })
        .catch(error => {
          console.error("Failed to auto-mark reading progress in background", error);
          // 同步失敗時還原狀態
          if (readRound === 1) currentCh.isReadR1 = false;
          else if (readRound === 2) currentCh.isReadR2 = false;
          else if (readRound === 3) currentCh.isReadR3 = false;
          currentCh.isRead = false;
          calculatePlanProgress();
          showToast("自動標記已讀同步失敗，請稍後再試");
        });
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

    // 3. Progress Status
    const reportStatProgressStatus = document.getElementById("report-stat-progress-status");
    if (reportStatProgressStatus) {
      const progressStatus = getPlanProgressStatus(state.activePlan);
      reportStatProgressStatus.textContent = progressStatus.label;
      reportStatProgressStatus.style.color = progressStatus.color;
      reportStatProgressStatus.style.backgroundColor = progressStatus.bg;
      reportStatProgressStatus.style.borderColor = progressStatus.color + "33";
    }

    // 4. Makeup/Catch up days (🛡️ 進度救援)
    const statsStart = new Date(state.activePlan.startDate);
    statsStart.setHours(0, 0, 0, 0);
    const targetRoundsVal = getPlanLevelRounds(state.activePlan.level || "normal");
    let catchUpDaysVal = 0;
    for (let r = 1; r <= targetRoundsVal; r++) {
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
    if (currentRound >= 2) rereadCount++;

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
  const elTodayRate = document.getElementById('grp-today-rate');
  const elReread = document.getElementById('grp-reread-count');

  if (elTotal) elTotal.textContent = totalChapters;
  if (elMembers) elMembers.textContent = totalCount;
  if (elActive) elActive.textContent = dailyActiveCount;
  if (elTodayRate) elTodayRate.textContent = todayRate;
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
  renderBadgeWall("stats-badge-wall-container");
}

async function renderMyPersonalRankings() {
  if (!state.activePlan) return;

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
    (logs || []).forEach(log => {
      if (!logMatchesPlan(log, currentPlanIdForStats, currentPresetKeyForStats)) return;
      unique.add(`${log.book}_${log.chapter}_${log.round || 1}`);
    });
    return unique.size;
  };
  const myPlanReadCount = uniquePlanLogs(state.readingLogs || []);
  const personalStreak = myPlanReadCount > 0 ? (state.currentUser.streak || 0) : 0;

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
          makeup = Math.max(0, expectedDaysCount - completedDaysCount);
          diff = completed - expectedDaysCount;
        } else {
          completed = Math.round(((u.plan_progress || 0) / 100) * state.activePlan.days.length);
          completed = Math.min(completed, state.activePlan.days.length);
          makeup = Math.max(0, expectedDaysCount - completed);
          diff = completed - expectedDaysCount;
        }
      }

      let statusStr = hasAnyPlanRead ? "在進度上" : "未開始";
      let statusColor = "var(--text-muted)";
      if (hasAnyPlanRead && diff > 0) {
        statusStr = `超前 ${diff}天`;
        statusColor = "#10b981";
      } else if (hasAnyPlanRead && diff < 0) {
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
      itemRow.style.background = "var(--color-brand-muted, rgba(4,169,210,0.08))";
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

window.showPlanStatsModal = function () {
  if (!state.activePlan) {
    showToast("尚未加入任何計畫");
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
  for (let r = 1; r <= targetRounds; r++) {
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
  if (state.readingLogs) {
    state.readingLogs.forEach(l => {
      const logMatchesPlan =
        (currentPlanId && l.plan_id && l.plan_id === currentPlanId) ||
        (currentPresetKey && l.presetKey && l.presetKey === currentPresetKey) ||
        (!l.plan_id && !l.presetKey);
      if (logMatchesPlan) {
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
  const statusColor = progressStatus.color;
  const statusBg = progressStatus.bg;

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
    <h3 style="font-size: 1.15rem; font-weight: 800; color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
      <span>📊</span> 詳細數據統計
    </h3>
    <button class="circular-action-btn" style="width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border-card); background: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; color: var(--text-secondary);" onclick="this.closest('.modal-overlay').remove()">✕</button>
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
        <div style="font-size: 0.82rem; font-weight: 800; color: var(--text-secondary); display: flex; align-items: center; gap: 0.3rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">
          ${title}
        </div>
        <div style="font-size: 1.45rem; font-weight: 800; color: ${iconColor}; margin: 0.3rem 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">
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
    `🛡️ 進度救援`,
    `${catchUpDays} 天`,
    `過去落後但已成功補讀完畢的天數。`,
    `#ea580c`,
    `background: rgba(254, 118, 21, 0.06);`
  );

  // Card B: 累計閱讀
  const cardB = makeCardHtml(
    `🏆 累計閱讀`,
    `${totalReadChapters} 章`,
    `在此計畫中讀完的經文章節總數。`,
    `var(--primary-color)`
  );

  // Card C: 達標天數
  const cardC = makeCardHtml(
    `📅 達標天數`,
    `${totalCompletedDays} 天`,
    `計畫中所有章節皆 100% 讀完的累積總天數。`,
    `#10b981`
  );

  // Card D: 計畫狀態 (Badge text with specific colors)
  const badgeHtml = `
    <span style="font-size: 0.75rem; font-weight: 800; background: ${statusBg}; color: ${statusColor}; padding: 0.25rem 0.6rem; border-radius: 20px; display: inline-block; border: 1px solid rgba(${statusColor === '#10b981' ? '16,185,129' : (statusColor === '#ef4444' ? '239,68,68' : (statusColor === '#f59e0b' ? '245,158,11' : '59,130,246'))}, 0.25);">
      ${statusLabel}
    </span>
  `;
  const cardD = makeCardHtml(
    `🚦 計畫狀態`,
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
    font-weight: 800;
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

function setViewMode(mode) {
  // 🛡️ Strict fallback: if mode is not exactly 'calendar', default to 'card'
  viewMode = (mode === 'calendar') ? 'calendar' : 'card';
  state.planViewMode = viewMode;
  console.log('🔄 [視圖切換] 當前模式變更為：', viewMode);
  renderPlanScheduleView();
}

function renderPlanScheduleView() {
  const container = document.getElementById("plan-schedule-view-container");
  if (!container || !state.activePlan) return;

  container.innerHTML = "";

  if (viewMode === 'calendar') {
    // ─────────────────────────────────────────────
    // Render State B: Full Calendar Mode
    // ─────────────────────────────────────────────
    const calContainer = document.createElement("div");
    calContainer.id = "calendar-view-container";
    calContainer.className = "w-full px-4 text-center mx-0";

    // 1. Calendar Grid Component Container
    const calendarCarousel = document.createElement("div");
    calendarCarousel.className = "date-carousel";
    calendarCarousel.id = "plan-date-carousel";
    calendarCarousel.style.width = "100%";

    calContainer.appendChild(calendarCarousel);
    container.appendChild(calContainer);

    // Render the actual calendar grid DOM
    renderHorizontalDateStrip();

  } else {
    // 🛡️ 最高安全防線：只要不是 calendar，一律強制回退渲染「卡片模式」，絕不准開天窗！
    // ─────────────────────────────────────────────
    // Render State A: Card Mode (Themes & Progress Actions Bar)
    // ─────────────────────────────────────────────
    const cardContainer = document.createElement("div");
    cardContainer.id = "card-view-container";
    cardContainer.className = "w-full";

    // 1. Purple Cover Card
    const coverCard = document.createElement("div");
    coverCard.className = "plan-cover-card";
    coverCard.id = "plan-detail-cover";
    coverCard.innerHTML = `
      <div class="cover-title" id="plan-cover-title">${state.activePlan.name}</div>
      <div class="cover-subtitle" id="plan-cover-subtitle">
        <span>📅</span> <span id="plan-cover-dates">${state.activePlan.startDate || ''} ~ ${state.activePlan.endDate || ''}</span>
      </div>
    `;

    // Compute active state based on selected date vs today
    const now = new Date();
    const todayYear = now.getFullYear();
    const todayMonth = now.getMonth() + 1;
    const todayDay = now.getDate();
    const todayPlanDay = state.activePlan.days.find(d => {
      if (Number(d.year) !== todayYear || Number(d.month) !== todayMonth) return false;
      const parts = d.date.split('/');
      return parts.length === 2 && Number(parts[1]) === todayDay;
    });
    const isTodayActive = todayPlanDay && (state.selectedPlanDay === todayPlanDay.dayNum);

    console.log('🎨 [按鈕視覺更新] 當前高亮亮起的按鈕為：', viewMode === 'calendar' ? '查看日曆' : (isTodayActive ? '今天進度' : '我的進度'));

    // Tailwind CSS dynamic flat theme style rules (No borders, rounded-xl 12px, transition & active scale)
    const activeStyleStr = "flex: 1; font-weight: 700; font-size: 0.82rem; padding: 0.65rem; display: flex; align-items: center; justify-content: center; gap: 0.3rem; border-radius: 12px; border: 1px solid var(--color-brand) !important; background: var(--color-brand) !important; color: white !important; cursor: pointer; transition: all 0.2s ease; box-shadow: none;";
    const inactiveStyleStr = "flex: 1; font-weight: 500; font-size: 0.82rem; padding: 0.65rem; display: flex; align-items: center; justify-content: center; gap: 0.3rem; border-radius: 12px; border: 1px solid var(--border-card) !important; background: var(--bg-input) !important; color: var(--text-secondary) !important; cursor: pointer; transition: all 0.2s ease; box-shadow: none;";

    const calActiveStyleStr = "flex: 1.2; font-weight: 700; font-size: 0.82rem; padding: 0.65rem; display: flex; align-items: center; justify-content: center; gap: 0.3rem; border-radius: 12px; border: 1px solid var(--color-brand) !important; background: var(--color-brand) !important; color: white !important; cursor: pointer; transition: all 0.2s ease; box-shadow: none;";
    const calInactiveStyleStr = "flex: 1.2; font-weight: 500; font-size: 0.82rem; padding: 0.65rem; display: flex; align-items: center; justify-content: center; gap: 0.3rem; border-radius: 12px; border: 1px solid var(--border-card) !important; background: var(--bg-input) !important; color: var(--text-secondary) !important; cursor: pointer; transition: all 0.2s ease; box-shadow: none;";

    // 2. Action Buttons Row (我的進度, 今天進度, 查看日曆)
    const actionsBar = document.createElement("div");
    actionsBar.id = "plan-view-actions-bar";
    actionsBar.style.cssText = "display: flex; gap: 0.6rem; margin-bottom: 1rem; width: 100%; margin-top: 1rem;";

    const btnStats = document.createElement("button");
    btnStats.className = !isTodayActive ? "secondary-btn active-focus active:scale-95" : "secondary-btn inactive-focus active:scale-95";
    btnStats.style.cssText = !isTodayActive ? activeStyleStr : inactiveStyleStr;
    btnStats.innerHTML = `📊 我的進度`;
    btnStats.addEventListener("click", (e) => {
      e.stopPropagation();
      const nextReadingDay = getNextReadingPlanDay(state.activePlan);
      state.selectedPlanDay = nextReadingDay ? nextReadingDay.dayNum : 1;
      setViewMode('card');
      renderPlanScheduleTracker();
    });

    const btnToday = document.createElement("button");
    btnToday.className = isTodayActive ? "secondary-btn active-focus active:scale-95" : "secondary-btn inactive-focus active:scale-95";
    btnToday.style.cssText = isTodayActive ? activeStyleStr : inactiveStyleStr;
    btnToday.innerHTML = `📅 今天進度`;
    btnToday.addEventListener("click", (e) => {
      e.stopPropagation();
      snapCalendarToToday();
    });

    const btnCal = document.createElement("button");
    btnCal.className = (viewMode === 'calendar') ? "primary-btn active-focus active:scale-95" : "primary-btn inactive-focus active:scale-95";
    btnCal.style.cssText = (viewMode === 'calendar') ? calActiveStyleStr : calInactiveStyleStr;
    btnCal.innerHTML = `📅 查看日曆`;
    btnCal.addEventListener("click", (e) => {
      e.stopPropagation();
      setViewMode('calendar');
    });

    actionsBar.appendChild(btnStats);
    actionsBar.appendChild(btnToday);
    actionsBar.appendChild(btnCal);

    cardContainer.appendChild(coverCard);
    cardContainer.appendChild(actionsBar);
    container.appendChild(cardContainer);
  }
}

function snapCalendarToToday() {
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

    // Redraw if calendar is loaded in the DOM
    if (viewMode === 'calendar') {
      renderHorizontalDateStrip();
    }
    renderPlanScheduleTracker();
    showToast("已跳轉至今日進度");
  } else {
    showToast("今日不在計畫期間內");
  }
}

// Decoupled back navigation integration from top bar
document.addEventListener("plan-view-back-to-card", () => {
  setViewMode('card');
});
