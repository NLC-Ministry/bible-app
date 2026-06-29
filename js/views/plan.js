// Reading plans tab view controller

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

  // Only leaders and above can see the 組員狀況 tab
  const _initUserRole = (state.currentUser && state.currentUser.role) || "member";
  const _canSeeMembers = ["admin", "senior_pastor", "great_zone_leader", "zone_leader", "group_leader"].includes(_initUserRole);
  if (tabMembers) tabMembers.style.display = _canSeeMembers ? "" : "none";
  if (subviewPlanMembers) subviewPlanMembers.style.display = _canSeeMembers ? "" : "none";

  const allTabs = [tabSchedule, tabStats, tabRanking, _canSeeMembers ? tabMembers : null].filter(Boolean);
  const allSubviews = [subviewSchedule, subviewPlanStats, subviewPlanRanking, _canSeeMembers ? subviewPlanMembers : null].filter(Boolean);

  const filterCard = document.getElementById("global-stats-filter-card");

  function switchToTab(activeTab, activeSubview) {
    allTabs.forEach(t => t && t.classList.remove("active"));
    allSubviews.forEach(s => s && s.classList.add("hidden"));
    if (activeTab) activeTab.classList.add("active");
    if (activeSubview) activeSubview.classList.remove("hidden");

    if (activeTab === tabStats) {
      if (filterCard) {
        filterCard.classList.remove("hidden");
        filterCard.style.display = "flex";
      }
    } else {
      if (filterCard) {
        filterCard.classList.add("hidden");
        filterCard.style.display = "none";
      }
    }
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
      if (state.activePlan) await renderPlanStatsView();
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
              <p style="font-size: 0.82rem; color: var(--text-muted);">前往「已儲存」加入新挑戰吧！</p>
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
      window.openPlanInlineReader(firstUnread.book, firstUnread.chapter, state.selectedPlanDay);
    });
  }

  // Initialize Global Plans Admin Controls
  if (typeof initAdminPlanManagement === 'function') {
    initAdminPlanManagement();
  }
}


function generatePlanObject(name, startDate, endDate, selectedBooks, presetKey = null) {
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

      const totalChapters = allChapters.length;
      totalChaptersCount += totalChapters;

      const readingDays = mSpec.readingDays;
      const dailyChapters = Array.from({ length: readingDays }, () => []);
      const chsPerDay = Math.floor(totalChapters / readingDays);
      let remainder = totalChapters % readingDays;
      let chIdx = 0;

      for (let d = 0; d < readingDays; d++) {
        const todayCount = chsPerDay + (remainder > 0 ? 1 : 0);
        remainder--;
        for (let c = 0; c < todayCount; c++) {
          if (chIdx < totalChapters) {
            dailyChapters[d].push(allChapters[chIdx]);
            chIdx++;
          }
        }
      }

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
            key: `${ch.book}_${ch.chapter}`
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
      level: 'normal',
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

  const totalChapters = allChapters.length;
  const dailyChapters = Array.from({ length: totalDays }, () => []);

  const chsPerDay = Math.floor(totalChapters / totalDays);
  let remainder = totalChapters % totalDays;
  let chIdx = 0;

  for (let d = 0; d < totalDays; d++) {
    const todayCount = chsPerDay + (remainder > 0 ? 1 : 0);
    remainder--;
    
    for (let c = 0; c < todayCount; c++) {
      if (chIdx < totalChapters) {
        dailyChapters[d].push(allChapters[chIdx]);
        chIdx++;
      }
    }
  }

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
        key: `${ch.book}_${ch.chapter}`
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
    level: 'normal',
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
  if (!state.activePlans || state.activePlans.length === 0) {
    state.activePlan = null;
    return;
  }

  state.activePlans.forEach(plan => {
    let completed = 0;
    const currentRound = plan.currentRound || 1;
    plan.days.forEach(day => {
      day.chapters.forEach(ch => {
        const isRead = state.readingLogs.some(l => {
          const isPlanMatch = !l.presetKey || (l.presetKey === plan.presetKey) || (plan.id && l.plan_id === plan.id);
          const isRoundMatch = (l.round || 1) === currentRound;
          return l.book === ch.book && l.chapter === ch.chapter && isPlanMatch && isRoundMatch;
        });
        ch.isRead = isRead;
        if (isRead) completed++;
      });
    });
    plan.completedChapters = completed;
    plan.progress = Math.round((completed / plan.totalChapters) * 100) || 0;
  });

  if (!state.isSupabaseMode) {
    localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
  }
}



async function renderPlanView() {
  renderJoinedPlansList();
  renderPresetPlansList();

  const listSubview = document.getElementById("plan-list-subview");
  const detailSubview = document.getElementById("plan-detail-subview");

  if (state.activePlan) {
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

  const presets = Object.entries(CHURCH_PLAN_PRESETS);
  presets.forEach(([key, preset]) => {
    // Check if user already joined
    const isJoined = state.activePlans && state.activePlans.some(p => p.presetKey === key);

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
        state.activePlan = state.activePlans.find(p => p.presetKey === key);
        state.selectedPlanDay = null;
        renderPlanView();
      } else {
        if (confirm(`確定要加入「${preset.name}」讀經計畫挑戰嗎？`)) {
          loader.show("加入計畫中...");
          await db.joinPlan(preset.name, preset.startDate, preset.endDate, preset.books, key);
          loader.hide();
        }
      }
    };

    card.innerHTML = `
      ${getPlanCoverHtml({ presetKey: key })}
      <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 0.25rem; min-width: 0;">
        <h4 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${preset.name}</h4>
        <div style="font-size: 0.78rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.3rem;">
          <span>📅</span> <span>${preset.startDate} ~ ${preset.endDate}</span>
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

  // Hide the 組員狀況 tab for regular members
  const _restoreRole = (state.currentUser && state.currentUser.role) || "member";
  const _restoreCanSeeMembers = ["admin", "senior_pastor", "great_zone_leader", "zone_leader", "group_leader"].includes(_restoreRole);
  if (tabMembers) tabMembers.style.display = _restoreCanSeeMembers ? "" : "none";
  if (subviewPlanMembers) subviewPlanMembers.style.display = _restoreCanSeeMembers ? "" : "none";

  const allSubviewsInit = [subviewSchedule, subviewPlanStats, subviewPlanRanking, _restoreCanSeeMembers ? subviewPlanMembers : null].filter(Boolean);
  const filterCard = document.getElementById("global-stats-filter-card");

  if (tabStats && tabStats.classList.contains("active")) {
    allSubviewsInit.forEach(s => s.classList.add("hidden"));
    if (subviewPlanStats) subviewPlanStats.classList.remove("hidden");
    if (filterCard) {
      filterCard.classList.remove("hidden");
      filterCard.style.display = "flex";
    }
    await renderPlanStatsView();
  } else if (tabRanking && tabRanking.classList.contains("active")) {
    allSubviewsInit.forEach(s => s.classList.add("hidden"));
    if (subviewPlanRanking) subviewPlanRanking.classList.remove("hidden");
    if (filterCard) {
      filterCard.classList.add("hidden");
      filterCard.style.display = "none";
    }
    await renderPlanRankingView();
  } else if (_restoreCanSeeMembers && tabMembers && tabMembers.classList.contains("active")) {
    allSubviewsInit.forEach(s => s.classList.add("hidden"));
    if (subviewPlanMembers) subviewPlanMembers.classList.remove("hidden");
    if (filterCard) {
      filterCard.classList.add("hidden");
      filterCard.style.display = "none";
    }
    await renderPlanMembersView();
  } else {
    // Default to Schedule Tab
    if (tabSchedule) tabSchedule.classList.add("active");
    if (tabStats) tabStats.classList.remove("active");
    if (tabRanking) tabRanking.classList.remove("active");
    if (tabMembers) tabMembers.classList.remove("active");
    allSubviewsInit.forEach(s => s.classList.add("hidden"));
    if (subviewSchedule) subviewSchedule.classList.remove("hidden");
    if (filterCard) {
      filterCard.classList.add("hidden");
      filterCard.style.display = "none";
    }
    renderPlanScheduleTracker();
  }
}

function renderHorizontalDateStrip() {
  const carousel = document.getElementById("plan-date-carousel");
  if (!carousel || !state.activePlan) return;

  carousel.innerHTML = "";
  
  const daysCount = state.activePlan.days.length;

  for (let dNum = 1; dNum <= daysCount; dNum++) {
    const day = state.activePlan.days.find(d => d.dayNum === dNum);
    if (!day) continue;

    const isDayCompleted = day.chapters && day.chapters.length > 0 && day.chapters.every(ch => ch.isRead);
    const dateCard = document.createElement("div");
    dateCard.className = `date-card ${dNum === state.selectedPlanDay ? "active" : ""} ${isDayCompleted ? "completed" : ""}`;
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

  selectedDay.chapters.forEach(ch => {
    const taskItem = document.createElement("div");
    taskItem.className = "plan-task-item";
    
    const isChecked = ch.isRead;
    const checkState = isChecked ? "checked" : "";
    const svgIcon = isChecked ? `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>` : "";

    taskItem.innerHTML = `
      <div class="task-checkbox ${checkState}" onclick="event.stopPropagation(); window.toggleYouVersionChapter(this, '${ch.book}', ${ch.chapter})">
        ${svgIcon}
      </div>
      <div class="task-title" onclick="window.openPlanInlineReader('${ch.book}', ${ch.chapter}, ${state.selectedPlanDay})">
        ${ch.book} ${ch.chapter}章
      </div>
      <div class="task-arrow" onclick="window.openPlanInlineReader('${ch.book}', ${ch.chapter}, ${state.selectedPlanDay})">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </div>
    `;
    container.appendChild(taskItem);
  });
}

window.toggleYouVersionChapter = async function(checkboxEl, book, chapter) {
  const isChecked = !checkboxEl.classList.contains("checked");
  
  loader.show("記錄中...");
  await db.logChapterRead(book, chapter, isChecked);
  
  calculatePlanProgress();
  db.saveLocalUserStats();
  
  if (isChecked) {
    checkboxEl.classList.add("checked");
    checkboxEl.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else {
    checkboxEl.classList.remove("checked");
    checkboxEl.innerHTML = ``;
  }
  
  // Check if round completion is reached
  if (state.activePlan && state.activePlan.progress === 100) {
    await handleRoundCompletion(state.activePlan);
  }
  
  // Re-render to refresh status pills and details
  renderPlanScheduleTracker(true);
  loader.hide();
};

window.showPlanLevelModal = async function() {
  if (!state.activePlan) return;
  const level = state.activePlan.level || 'normal';
  const newLevel = prompt(
    "變更計畫進度等級：\n- normal: 一般進度 (讀1遍)\n- breakthrough: 突破進度 (讀2遍)\n- super: 超強進度 (讀3遍)\n\n請輸入 normal、breakthrough 或 super：", 
    level
  );
  if (newLevel && ['normal', 'breakthrough', 'super'].includes(newLevel)) {
    await window.changePlanLevel(newLevel);
  } else if (newLevel !== null) {
    alert("輸入無效，請重新嘗試！");
  }
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

  const started = isPlanStarted(plan);
  if (!started) return;

  const currentRound = plan.currentRound || 1;
  if (currentRound >= 4) return; // 3遍以上不安排進度，自主掌控

  // Calculate expected progress
  const start = new Date(plan.startDate);
  const end = new Date(plan.endDate);
  const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  const today = new Date();
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.ceil((today - start) / (1000 * 60 * 60 * 24)) + 1));

  const progressFactor = elapsedDays / totalDays;

  const level = plan.level || 'normal';
  let targetRounds = 1;
  if (level === 'breakthrough') targetRounds = 2;
  else if (level === 'super') targetRounds = 3;

  const expectedTotalChapters = progressFactor * targetRounds * plan.totalChapters;

  // Calculate actual total completed chapters across all rounds
  let actualCompletedChapters = 0;
  for (let r = 1; r <= currentRound; r++) {
    const roundLogs = state.readingLogs.filter(l => 
      (l.plan_id === plan.id || l.presetKey === plan.presetKey) &&
      (l.round || 1) === r
    );
    const uniqueChapters = new Set(roundLogs.map(l => `${l.book}_${l.chapter}`));
    actualCompletedChapters += uniqueChapters.size;
  }

  if (Math.floor(expectedTotalChapters) > 0 && actualCompletedChapters < Math.floor(expectedTotalChapters)) {
    let newLevel = level;
    let message = "";

    if (level === 'super') {
      newLevel = 'breakthrough';
      plan.wasDowngraded = true;
      message = `⚠️ 進度落後警告：您的累計讀經進度已落後於「超強進度」的預期範圍（預計需完成 ${Math.floor(expectedTotalChapters)} 章，實際完成 ${actualCompletedChapters} 章）。\n\n系統已自動將您降級為「突破進度」，讓進度回歸合理區間。`;
    } else if (level === 'breakthrough') {
      newLevel = 'normal';
      plan.wasDowngraded = true;
      message = `⚠️ 進度落後警告：您的累計讀經進度已落後於「突破進度」的預期範圍（預計需完成 ${Math.floor(expectedTotalChapters)} 章，實際完成 ${actualCompletedChapters} 章）。\n\n系統已自動將您降級為「一般進度」。您此後將不得手動申請升級，直到您讀完第一遍為止。`;
    }

    if (newLevel !== level) {
      plan.level = newLevel;

      if (state.isSupabaseMode && state.supabase) {
        await state.supabase.from("reading_plans")
          .update({ 
            level: newLevel,
            was_downgraded: plan.wasDowngraded
          })
          .eq("id", plan.id);
      } else {
        localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
      }

      alert(message);
      calculatePlanProgress();
    }
  }
}

async function handleRoundCompletion(plan) {
  const currentRound = plan.currentRound || 1;
  const level = plan.level || 'normal';

  let newRound = currentRound + 1;
  let newLevel = level;
  let wasDowngraded = plan.wasDowngraded;
  let message = "";

  if (currentRound === 1) {
    if (level === 'normal') {
      newLevel = 'breakthrough';
      wasDowngraded = false; // Reset downgrade restriction on round completion
      message = `🎉 恭喜您圓滿讀完第一遍！\n系統已自動將您升級為「突破進度 (第 2 遍)」，請繼續加油重複閱讀！`;
    } else {
      message = `🎉 恭喜您完成了第一遍的讀經進度！開始進入第二遍閱讀，加油！`;
    }
  } else if (currentRound === 2) {
    if (level === 'breakthrough') {
      newLevel = 'super';
      wasDowngraded = false;
      message = `🏆 太棒了！您已讀完第二遍！\n系統已自動將您升級為「超強進度 (第 3 遍)」，挑戰最高讀經榮譽！`;
    } else {
      message = `🎉 恭喜您完成了第二遍的讀經進度！開始進入第三遍閱讀！`;
    }
  } else if (currentRound === 3) {
    message = `🔥 震撼！您已成功完成三遍讀經！\n此後系統不再為您強制安排預計進度，您可以自行掌控後續的閱讀自主權。`;
  } else {
    message = `✨ 恭喜您完成了第 ${currentRound} 遍讀經！繼續挑戰第 ${newRound} 遍！`;
  }

  plan.currentRound = newRound;
  plan.level = newLevel;
  plan.wasDowngraded = wasDowngraded;

  if (state.isSupabaseMode && state.supabase) {
    const { error } = await state.supabase.from("reading_plans")
      .update({ 
        current_round: newRound,
        level: newLevel,
        was_downgraded: wasDowngraded
      })
      .eq("id", plan.id);
    if (error) console.error("Failed to update round completion in Supabase:", error);
  } else {
    localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
  }

  calculatePlanProgress();
  alert(message);
}

window.changePlanLevel = async function(newLevel) {
  if (!state.activePlan) return;

  if (state.activePlan.wasDowngraded && state.activePlan.level === 'normal' && newLevel !== 'normal') {
    alert("您目前因進度落後降為一般進度，需要先讀完第一遍後才可以重新升級！");
    return;
  }

  loader.show("正在變更進度等級...");

  state.activePlan.level = newLevel;

  if (state.isSupabaseMode && state.supabase) {
    const { error } = await state.supabase.from("reading_plans")
      .update({ level: newLevel })
      .eq("id", state.activePlan.id);
    if (error) console.error("Failed to update plan level in Supabase:", error);
  } else {
    localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans));
  }

  calculatePlanProgress();

  // Run schedule check immediately after upgrading level
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

  tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">載入計畫列表中...</td></tr>`;

  try {
    const plans = state.globalPlans || [];
    tableBody.innerHTML = "";

    if (plans.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">目前無任何計畫，請點擊上方「新增計畫」建立</td></tr>`;
      return;
    }

    plans.forEach(plan => {
      const tr = document.createElement("tr");

      const bookListText = plan.books.join(", ");
      const bookCount = plan.books.length;
      const booksDisplay = bookCount > 6 
        ? `<span title="${bookListText}" style="cursor: help; text-decoration: underline dashed; text-underline-offset: 3px;">${plan.books.slice(0, 6).join(", ")}... 等 ${bookCount} 卷</span>`
        : bookListText;

      tr.innerHTML = `
        <td><strong>${escapeHTML(plan.name)}</strong></td>
        <td><span style="font-size: 0.8rem; font-weight: 600;">📅 ${plan.startDate} ~ ${plan.endDate}</span></td>
        <td><span style="font-size: 0.78rem;">${booksDisplay}</span></td>
        <td style="text-align: center; vertical-align: middle;">
          <div style="display: flex; gap: 0.3rem; justify-content: center;">
            <button class="primary-btn admin-edit-plan-btn" style="font-size: 0.72rem; padding: 0.2rem 0.5rem; height: auto; cursor: pointer;">編輯</button>
            <button class="danger-btn admin-delete-plan-btn" style="font-size: 0.72rem; padding: 0.2rem 0.5rem; height: auto; cursor: pointer;">刪除</button>
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

      // Bind delete event
      tr.querySelector(".admin-delete-plan-btn").onclick = async () => {
        if (confirm(`您確定要刪除「${plan.name}」嗎？這將使其他會友無法再從列表「加入」此計畫，但已加入該計畫之會友仍可照常閱讀及打卡。`)) {
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

window.openPlanInlineReader = function(bookName, chapter, dayNum) {
  if (!state.activePlan) return;
  const day = state.activePlan.days.find(d => d.dayNum === dayNum);
  if (!day || !day.chapters || day.chapters.length === 0) return;

  state.inlineReader.active = true;
  state.inlineReader.dayNum = dayNum;
  state.inlineReader.chaptersList = day.chapters;
  state.inlineReader.currentIndex = day.chapters.findIndex(ch => ch.book === bookName && ch.chapter === chapter);
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

    // Check if already read
    const isAlreadyRead = state.readingLogs.some(l => l.book === currentCh.book && l.chapter === currentCh.chapter);
    if (!isAlreadyRead) {
      loader.show("記錄已讀中...");
      await db.logChapterRead(currentCh.book, currentCh.chapter, true);
      loader.hide();
      
      currentCh.isRead = true;
      calculatePlanProgress();
      db.saveLocalUserStats();

      if (state.activePlan && state.activePlan.progress === 100) {
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
// ==================== STATS SELECTOR POPULATOR ====================
function populateStatsSelector() {
  const rankingZoneSelector = document.getElementById("ranking-zone-selector");
  if (!rankingZoneSelector) return;
  if (rankingZoneSelector.dataset.populated) return; // avoid double populating
  
  rankingZoneSelector.innerHTML = "";
  const optionsList = [];
  
  const userRole = (state.currentUser && state.currentUser.role) || "member";
  const isAdmin = userRole === "admin" || userRole === "senior_pastor";
  const isGreatZoneLeader = userRole === "great_zone_leader";
  const isZoneLeader = userRole === "zone_leader";
  const isGroupLeader = userRole === "group_leader";
  
  // Everyone gets "個人統計 (我自己)"
  optionsList.push({ value: "me", label: "個人統計 (我自己)" });
  
  if (isAdmin) {
    optionsList.push({ value: "all", label: "全教會統計" });
    
    // Regions
    const regions = state.orgStructure.regions || [];
    regions.forEach(r => {
      optionsList.push({ value: `region:${r}`, label: `大區：${r}` });
    });
    
    // Zones
    let zones = [];
    if (state.orgStructure.rawZones) {
      zones = state.orgStructure.rawZones.map(z => z.name);
    } else if (state.orgStructure.zones) {
      zones = Object.keys(state.orgStructure.zones);
    }
    zones.sort().forEach(z => {
      optionsList.push({ value: `zone:${z}`, label: `牧區：${z}` });
    });
    
    // Groups
    let groups = [];
    if (state.orgStructure.rawGroups) {
      groups = state.orgStructure.rawGroups.map(g => g.name);
    } else if (state.orgStructure.groups) {
      groups = Object.keys(state.orgStructure.groups);
    }
    groups.sort().forEach(g => {
      optionsList.push({ value: `group:${g}`, label: `小組：${g}` });
    });
    
  } else if (isGreatZoneLeader) {
    const userGreatRegion = state.currentUser.great_region || "";
    const myRegions = userGreatRegion.split(",").map(s => s.trim()).filter(Boolean);
    
    optionsList.push({ value: "all_great_region", label: `全部 (${myRegions.join(",")})` });
    
    myRegions.forEach(r => {
      optionsList.push({ value: `region:${r}`, label: `大區：${r}` });
    });
    
    let zones = [];
    if (state.isSupabaseMode && state.orgStructure.rawZones && state.orgStructure.rawRegions) {
      const regionIds = state.orgStructure.rawRegions.filter(r => myRegions.includes(r.name)).map(r => r.id);
      zones = state.orgStructure.rawZones.filter(z => regionIds.includes(z.great_region_id)).map(z => z.name);
    } else if (state.orgStructure.zones) {
      myRegions.forEach(r => {
        const regionZones = state.orgStructure.zones[r] || [];
        zones = zones.concat(regionZones);
      });
    }
    zones = [...new Set(zones)].sort();
    zones.forEach(z => {
      optionsList.push({ value: `zone:${z}`, label: `牧區：${z}` });
    });
    
    let groups = [];
    if (state.isSupabaseMode && state.orgStructure.rawGroups && state.orgStructure.rawZones && state.orgStructure.rawRegions) {
      const regionIds = state.orgStructure.rawRegions.filter(r => myRegions.includes(r.name)).map(r => r.id);
      const zoneIds = state.orgStructure.rawZones.filter(z => regionIds.includes(z.great_region_id)).map(z => z.id);
      groups = state.orgStructure.rawGroups.filter(g => zoneIds.includes(g.pastoral_zone_id)).map(g => g.name);
    } else if (state.orgStructure.groups) {
      zones.forEach(z => {
        const zoneGroups = state.orgStructure.groups[z] || [];
        groups = groups.concat(zoneGroups);
      });
    }
    groups = [...new Set(groups)].sort();
    groups.forEach(g => {
      optionsList.push({ value: `group:${g}`, label: `小組：${g}` });
    });
    
  } else if (isZoneLeader) {
    const userZoneStr = state.currentUser.pastoral_zone || "";
    const myZones = userZoneStr.split(",").map(s => s.trim()).filter(Boolean);
    
    optionsList.push({ value: "all_zones", label: `全部 (${myZones.join(",")})` });
    
    myZones.forEach(z => {
      optionsList.push({ value: `zone:${z}`, label: `牧區：${z}` });
    });
    
    let groups = [];
    if (state.isSupabaseMode && state.orgStructure.rawGroups && state.orgStructure.rawZones) {
      const zoneIds = state.orgStructure.rawZones.filter(z => myZones.includes(z.name)).map(z => z.id);
      groups = state.orgStructure.rawGroups.filter(g => zoneIds.includes(g.pastoral_zone_id)).map(g => g.name);
    } else if (state.orgStructure.groups) {
      myZones.forEach(z => {
        const zoneGroups = state.orgStructure.groups[z] || [];
        groups = groups.concat(zoneGroups);
      });
    }
    groups = [...new Set(groups)].sort();
    groups.forEach(g => {
      optionsList.push({ value: `group:${g}`, label: `小組：${g}` });
    });
    
  } else if (isGroupLeader) {
    const userGroupStr = state.currentUser.small_group || "";
    const myGroups = userGroupStr.split(",").map(s => s.trim()).filter(Boolean);
    
    optionsList.push({ value: "all_groups", label: `全部 (${myGroups.join(",")})` });
    
    myGroups.forEach(g => {
      optionsList.push({ value: `group:${g}`, label: `小組：${g}` });
    });
    
  } else {
    // Normal member: only "Myself", "My Pastoral Zone", "All Church"
    const userZone = state.currentUser.pastoral_zone || "";
    if (userZone) {
      optionsList.push({ value: `zone:${userZone}`, label: `我的牧區：${userZone}` });
    }
    optionsList.push({ value: "all", label: "全教會統計" });
  }
  
  optionsList.forEach(opt => {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    rankingZoneSelector.appendChild(el);
  });
  
  // Set default selection value
  let defaultVal = "me"; // Default to Myself
  rankingZoneSelector.value = defaultVal;
  
  rankingZoneSelector.dataset.populated = "true";
  
  if (!rankingZoneSelector.dataset.listenerInitialized) {
    rankingZoneSelector.dataset.listenerInitialized = "true";
    rankingZoneSelector.addEventListener("change", async () => {
      // Re-render based on active subview
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
  const membersZoneSelector = document.getElementById("members-zone-selector");
  if (!membersZoneSelector) return;
  if (membersZoneSelector.dataset.populated) return; // avoid double populating
  
  membersZoneSelector.innerHTML = "";
  const optionsList = [];
  
  const userRole = (state.currentUser && state.currentUser.role) || "member";
  const isAdmin = userRole === "admin" || userRole === "senior_pastor";
  const isGreatZoneLeader = userRole === "great_zone_leader";
  const isZoneLeader = userRole === "zone_leader";
  const isGroupLeader = userRole === "group_leader";
  const userZone = state.currentUser.pastoral_zone || "";
  
  if (isAdmin) {
    // Zones
    let zones = [];
    if (state.orgStructure.rawZones) {
      zones = state.orgStructure.rawZones.map(z => z.name);
    } else if (state.orgStructure.zones) {
      zones = Object.keys(state.orgStructure.zones);
    }
    zones.sort().forEach(z => {
      optionsList.push({ value: `zone:${z}`, label: `牧區：${z}` });
    });
    
    // Groups
    let groups = [];
    if (state.orgStructure.rawGroups) {
      groups = state.orgStructure.rawGroups.map(g => g.name);
    } else if (state.orgStructure.groups) {
      groups = Object.keys(state.orgStructure.groups);
    }
    groups.sort().forEach(g => {
      optionsList.push({ value: `group:${g}`, label: `小組：${g}` });
    });
    
  } else if (isGreatZoneLeader) {
    const userGreatRegion = state.currentUser.great_region || "";
    const myRegions = userGreatRegion.split(",").map(s => s.trim()).filter(Boolean);
    
    let zones = [];
    if (state.isSupabaseMode && state.orgStructure.rawZones && state.orgStructure.rawRegions) {
      const regionIds = state.orgStructure.rawRegions.filter(r => myRegions.includes(r.name)).map(r => r.id);
      zones = state.orgStructure.rawZones.filter(z => regionIds.includes(z.great_region_id)).map(z => z.name);
    } else if (state.orgStructure.zones) {
      myRegions.forEach(r => {
        const regionZones = state.orgStructure.zones[r] || [];
        zones = zones.concat(regionZones);
      });
    }
    zones = [...new Set(zones)].sort();
    zones.forEach(z => {
      optionsList.push({ value: `zone:${z}`, label: `牧區：${z}` });
    });
    
    let groups = [];
    if (state.isSupabaseMode && state.orgStructure.rawGroups && state.orgStructure.rawZones && state.orgStructure.rawRegions) {
      const regionIds = state.orgStructure.rawRegions.filter(r => myRegions.includes(r.name)).map(r => r.id);
      const zoneIds = state.orgStructure.rawZones.filter(z => regionIds.includes(z.great_region_id)).map(z => z.id);
      groups = state.orgStructure.rawGroups.filter(g => zoneIds.includes(g.pastoral_zone_id)).map(g => g.name);
    } else if (state.orgStructure.groups) {
      zones.forEach(z => {
        const zoneGroups = state.orgStructure.groups[z] || [];
        groups = groups.concat(zoneGroups);
      });
    }
    groups = [...new Set(groups)].sort();
    groups.forEach(g => {
      optionsList.push({ value: `group:${g}`, label: `小組：${g}` });
    });
    
  } else if (isZoneLeader) {
    const userZoneStr = state.currentUser.pastoral_zone || "";
    const myZones = userZoneStr.split(",").map(s => s.trim()).filter(Boolean);
    
    myZones.forEach(z => {
      optionsList.push({ value: `zone:${z}`, label: `牧區：${z}` });
    });
    
    let groups = [];
    if (state.isSupabaseMode && state.orgStructure.rawGroups && state.orgStructure.rawZones) {
      const zoneIds = state.orgStructure.rawZones.filter(z => myZones.includes(z.name)).map(z => z.id);
      groups = state.orgStructure.rawGroups.filter(g => zoneIds.includes(g.pastoral_zone_id)).map(g => g.name);
    } else if (state.orgStructure.groups) {
      myZones.forEach(z => {
        const zoneGroups = state.orgStructure.groups[z] || [];
        groups = groups.concat(zoneGroups);
      });
    }
    groups = [...new Set(groups)].sort();
    groups.forEach(g => {
      optionsList.push({ value: `group:${g}`, label: `小組：${g}` });
    });
    
  } else if (isGroupLeader) {
    const userGroupStr = state.currentUser.small_group || "";
    const myGroups = userGroupStr.split(",").map(s => s.trim()).filter(Boolean);
    
    myGroups.forEach(g => {
      optionsList.push({ value: `group:${g}`, label: `小組：${g}` });
    });
    
  } else {
    if (userZone) {
      optionsList.push({ value: `zone:${userZone}`, label: `牧區：${userZone}` });
    }
  }
  
  optionsList.forEach(opt => {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    membersZoneSelector.appendChild(el);
  });
  
  let defaultMemberVal = optionsList[0] ? optionsList[0].value : "";
  membersZoneSelector.value = defaultMemberVal;
  membersZoneSelector.dataset.populated = "true";
  
  membersZoneSelector.disabled = optionsList.length <= 1;
  membersZoneSelector.classList.remove("hidden");
  
  if (!membersZoneSelector.dataset.listenerInitialized) {
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
  
  const rankingZoneSelector = document.getElementById("ranking-zone-selector");
  const selectedVal = rankingZoneSelector ? rankingZoneSelector.value : "me";
  
  const personalSec = document.getElementById("stats-personal-section");
  const groupSec = document.getElementById("stats-group-section");
  
  if (selectedVal === "me") {
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

    // 2. Total completed (累計完成)
    const completedDaysCount = state.activePlan.days.filter(d => {
      if (!d.chapters || d.chapters.length === 0) return false;
      return d.chapters.every(ch => ch.isRead);
    }).length;
    const reportStatCompleted = document.getElementById("report-stat-completed");
    if (reportStatCompleted) reportStatCompleted.textContent = completedDaysCount;

    const reportStatStartDate = document.getElementById("report-stat-start-date");
    if (reportStatStartDate) {
      const pDate = new Date(state.activePlan.startDate);
      if (!isNaN(pDate)) {
        reportStatStartDate.textContent = `從 ${pDate.getFullYear()}年${pDate.getMonth() + 1}月${pDate.getDate()}日起`;
      } else {
        reportStatStartDate.textContent = `從 ${state.activePlan.startDate} 起`;
      }
    }

    // Calculate expected days up to today
    const planStart = new Date(state.activePlan.startDate);
    const today = new Date();
    const diffTime = today.getTime() - planStart.getTime();
    const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1);
    const expectedDaysCount = Math.min(state.activePlan.days.length, diffDays);

    // 3. Progress Status (進度狀態)
    const reportStatProgressStatus = document.getElementById("report-stat-progress-status");
    if (reportStatProgressStatus) {
      const diff = completedDaysCount - expectedDaysCount;
      if (diff > 0) {
        reportStatProgressStatus.textContent = `超前 ${diff}天`;
        reportStatProgressStatus.style.color = "#10b981"; // Green
      } else if (diff < 0) {
        reportStatProgressStatus.textContent = `落後 ${Math.abs(diff)}天`;
        reportStatProgressStatus.style.color = "#ef4444"; // Red
      } else {
        reportStatProgressStatus.textContent = "進度一致";
        reportStatProgressStatus.style.color = "var(--text-primary)";
      }
    }

    // 4. Makeup/Catch up days (補讀)
    const makeupDays = Math.max(0, expectedDaysCount - completedDaysCount);
    const reportStatMakeup = document.getElementById("report-stat-makeup");
    if (reportStatMakeup) reportStatMakeup.textContent = makeupDays;

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

  // 8. Render Bible Pilgrimage Trail canvas
  const pilgrimageCard = document.getElementById("grp-pilgrimage-card");
  const currentScopeUsers = window._grpScopedUsers || [];
  if (currentScopeUsers.length === 0) {
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
  if (scopedUsers === undefined) {
    scopedUsers = getScopedUsers(allUsers, state.currentUser);
  }
  if (!scopedUsers) scopedUsers = [];

  const totalChapters = scopedUsers.reduce((sum, u) => sum + (u.chapters_read || 0), 0);
  const totalMembers = scopedUsers.length;
  const now = new Date();
  const twoAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const totalActive = scopedUsers.filter(u => {
    if (!u.last_read) return false;
    return new Date(u.last_read) >= twoAgo;
  }).length;

  // Determine current scope label from selector
  let scopeLabel = "全教會";
  const rankingZoneSelector = document.getElementById("ranking-zone-selector");
  const selectedFilter = rankingZoneSelector ? rankingZoneSelector.value : null;

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

  if (labelTotal) labelTotal.textContent = scopeLabel === "全教會" ? '全教會總閱讀章數' : `「${scopeLabel}」總閱讀章數`;
  if (labelMembers) labelMembers.textContent = scopeLabel === "全教會" ? '全教會參與人數' : `「${scopeLabel}」參與人數`;
  if (labelActive) labelActive.textContent = scopeLabel === "全教會" ? '本週全教會活躍人數' : `「${scopeLabel}」本週活躍人數`;

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
  } else {
    if (distCard) distCard.style.display = "";
  }

  // Calculate expected progress percentage from activePlan
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
  const todayRate = Math.round((todayDoneCount / totalCount) * 100);

  let aheadCount = 0, onCount = 0, behindCount = 0, round2Count = 0;
  scopedUsers.forEach(u => {
    const round = u.current_round !== undefined 
      ? u.current_round 
      : (u.chapters_read > 850 ? 3 : u.chapters_read > 500 ? 2 : 1);
    if (round >= 2) round2Count++;
    if (u.plan_progress === 0) { behindCount++; }
    else if (u.plan_progress > expectedPct + 5) { aheadCount++; }
    else if (u.plan_progress < expectedPct - 5) { behindCount++; }
    else { onCount++; }
  });

  const aheadRate = Math.round((aheadCount / totalCount) * 100);
  const onRate = Math.round((onCount / totalCount) * 100);
  const behindRate = Math.round((behindCount / totalCount) * 100);
  const round2Rate = Math.round((round2Count / totalCount) * 100);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.style.width = val + '%'; };
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText('grp-today-rate', todayRate + '%');
  set('grp-today-bar', todayRate);
  setText('grp-ahead-label', `${aheadCount} 人 (${aheadRate}%)`);
  set('grp-ahead-bar', aheadRate);
  setText('grp-on-schedule-label', `${onCount} 人 (${onRate}%)`);
  set('grp-on-schedule-bar', onRate);
  setText('grp-behind-label', `${behindCount} 人 (${behindRate}%)`);
  set('grp-behind-bar', behindRate);
  setText('grp-round2-label', `${round2Count} 人 (${round2Rate}%)`);
  set('grp-round2-bar', round2Rate);
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
  const selectedFilter = rankingZoneSelector ? rankingZoneSelector.value : null;

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
      ? '全教會讀經熱點地圖 (365天打卡活躍度)'
      : `「${scopeLabel}」團隊讀經熱點地圖 (365天打卡活躍度)`;
  }

  const userIds = new Set(scopedUsers.map(u => u.id).filter(Boolean));
  const userNames = new Set(scopedUsers.map(u => u.name).filter(Boolean));

  const logsByDate = {};
  if (state.readingLogs) {
    state.readingLogs.forEach(log => {
      let match = false;
      if (state.isSupabaseMode && state.supabase) {
        match = log.user_id && userIds.has(log.user_id);
      } else {
        // Mock fallback or local mode: match by name
        match = log.name ? userNames.has(log.name) : true;
      }
      if (match && log.read_at) {
        const dStr = log.read_at.substring(0, 10);
        logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
      }
    });
  }
  buildHeatmapGrid('grp-bible-heatmap-container', logsByDate, scopedUsers.length, '章');
}

function renderPersonalHeatmap() {
  const logsByDate = {};
  state.readingLogs.forEach(log => {
    if (log.read_at) {
      const dStr = log.read_at.substring(0, 10);
      logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
    }
  });
  buildHeatmapGrid("bible-heatmap-container", logsByDate, 1, "章");
}

function renderPersonalTrendChart() {
  const canvas = document.getElementById("personal-reading-trend-chart");
  if (!canvas) return;

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
    const dayOfWeek = today.getDay(); // 0 (Sunday) to 6 (Saturday)
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - dayOfWeek); // Back to Sunday
    
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
        if (log.read_at) {
          const dStr = log.read_at.substring(0, 10);
          logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
        }
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
        if (log.read_at) {
          const mStr = log.read_at.substring(0, 7); // "YYYY-MM"
          logsByMonth[mStr] = (logsByMonth[mStr] || 0) + 1;
        }
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
        if (log.read_at) {
          const dStr = log.read_at.substring(0, 10);
          logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
        }
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
  
  if (elRankZoneTitle && myZone) elRankZoneTitle.textContent = `「${myZone}」個人排行`;
  if (elRankZone) elRankZone.textContent = myZone ? `第 ${myRankZone} 名` : "未選牧區";
  if (elRankZoneTotal) elRankZoneTotal.textContent = myZone ? `共 ${sortedZone.length} 人` : "請設定所屬牧區";
}

async function renderPlanRankingView() {
  // Render my personal rankings
  await renderMyPersonalRankings();

  const container = document.getElementById("pastoral-ranking-list-container");
  if (!container) return;

  container.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.82rem;">載入排行中...</div>`;

  let pastoralStats = [];
  try {
    const allUsers = await db.fetchMergedUsersList();
    const zoneMap = {};
    allUsers.forEach(u => {
      const zone = u.pastoral_zone || "未知";
      if (!zoneMap[zone]) {
        zoneMap[zone] = { name: zone, total_chapters: 0 };
      }
      zoneMap[zone].total_chapters += (u.chapters_read || 0);
    });
    pastoralStats = Object.values(zoneMap).sort((a, b) => b.total_chapters - a.total_chapters);
  } catch(e) {
    console.error("Failed to load pastoral rankings", e);
  }

  container.innerHTML = "";
  if (pastoralStats.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted);">尚無排行資料</div>`;
    return;
  }

  pastoralStats.forEach((item, index) => {
    const row = document.createElement("div");
    row.style.cssText = `
      display: grid;
      grid-template-columns: 40px 1fr 100px;
      gap: 0.5rem;
      align-items: center;
      padding: 0.6rem 0.2rem;
      border-bottom: 1px solid var(--border-card);
      font-size: 0.88rem;
      font-weight: 700;
      text-align: center;
    `;
    const rankClass = index === 0 ? "color: #ef4444;" : index === 1 ? "color: #f59e0b;" : index === 2 ? "color: #10b981;" : "color: var(--text-secondary);";

    row.innerHTML = `
      <div style="font-weight: 800; font-size: 1rem; ${rankClass}">${index + 1}</div>
      <div style="text-align: left; padding-left: 0.5rem; color: var(--text-primary);">${escapeHTML(item.name)}</div>
      <div style="color: var(--primary-color);">${item.total_chapters} 章</div>
    `;
    container.appendChild(row);
  });
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
      if (window._cachedAllUsersList && window._cachedAllUsersList.length > 0) {
        allUsers = window._cachedAllUsersList;
      } else {
        allUsers = await db.fetchMergedUsersList();
        window._cachedAllUsersList = allUsers;
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
        if (rankingTitle) rankingTitle.textContent = `搜尋結果:「${query}」`;
      } else {
        const selectedFilter = membersZoneSelector ? membersZoneSelector.value : null;
        if (selectedFilter) {
          if (selectedFilter.startsWith("zone:")) {
            const zone = selectedFilter.replace("zone:", "");
            groupMembers = scopedUsersList.filter(u => u.pastoral_zone === zone);
            if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${zone}牧區)`;
          } else if (selectedFilter.startsWith("group:")) {
            const group = selectedFilter.replace("group:", "");
            groupMembers = scopedUsersList.filter(u => u.small_group === group);
            if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${group}小組)`;
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
      const selectedFilter = rankingZoneSelector ? rankingZoneSelector.value : null;
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
          groupMembers = allUsers.filter(u => u.pastoral_zone === zone);
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${zone}牧區排行)`;
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

  // Render group progress distribution bars (since it was moved to Members view)
  renderGroupProgressDistribution();
}
