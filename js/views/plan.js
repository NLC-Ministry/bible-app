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

  // Sub-tabs Toggle (Daily Reading vs Stats vs Ranking vs History)
  const tabSchedule = document.getElementById("tab-plan-schedule");
  const tabStats = document.getElementById("tab-plan-stats");
  const tabRanking = document.getElementById("tab-plan-ranking");
  const tabHistory = document.getElementById("tab-plan-history");
  const subviewSchedule = document.getElementById("subview-plan-schedule");
  const subviewPlanStats = document.getElementById("subview-plan-stats");
  const subviewPlanRanking = document.getElementById("subview-plan-ranking");
  const subviewPlanHistory = document.getElementById("subview-plan-history");

  if (tabSchedule && tabStats && tabRanking && tabHistory) {
    tabSchedule.addEventListener("click", () => {
      tabSchedule.classList.add("active");
      tabStats.classList.remove("active");
      tabRanking.classList.remove("active");
      tabHistory.classList.remove("active");
      if (subviewSchedule) subviewSchedule.classList.remove("hidden");
      if (subviewPlanStats) subviewPlanStats.classList.add("hidden");
      if (subviewPlanRanking) subviewPlanRanking.classList.add("hidden");
      if (subviewPlanHistory) subviewPlanHistory.classList.add("hidden");
      renderPlanScheduleTracker();
    });

    tabStats.addEventListener("click", async () => {
      tabStats.classList.add("active");
      tabSchedule.classList.remove("active");
      tabRanking.classList.remove("active");
      tabHistory.classList.remove("active");
      if (subviewSchedule) subviewSchedule.classList.add("hidden");
      if (subviewPlanStats) subviewPlanStats.classList.remove("hidden");
      if (subviewPlanRanking) subviewPlanRanking.classList.add("hidden");
      if (subviewPlanHistory) subviewPlanHistory.classList.add("hidden");
      if (state.activePlan) {
        await renderPlanStatsView();
      }
    });

    tabRanking.addEventListener("click", async () => {
      tabRanking.classList.add("active");
      tabSchedule.classList.remove("active");
      tabStats.classList.remove("active");
      tabHistory.classList.remove("active");
      if (subviewSchedule) subviewSchedule.classList.add("hidden");
      if (subviewPlanStats) subviewPlanStats.classList.add("hidden");
      if (subviewPlanRanking) subviewPlanRanking.classList.remove("hidden");
      if (subviewPlanHistory) subviewPlanHistory.classList.add("hidden");
      if (state.activePlan) {
        await renderPlanRankingView();
      }
    });

    tabHistory.addEventListener("click", async () => {
      tabHistory.classList.add("active");
      tabSchedule.classList.remove("active");
      tabStats.classList.remove("active");
      tabRanking.classList.remove("active");
      if (subviewSchedule) subviewSchedule.classList.add("hidden");
      if (subviewPlanStats) subviewPlanStats.classList.add("hidden");
      if (subviewPlanRanking) subviewPlanRanking.classList.add("hidden");
      if (subviewPlanHistory) subviewPlanHistory.classList.remove("hidden");
      if (state.activePlan) {
        await renderPlanHistoryView();
      }
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
    renderPlanDetailView();
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
  const tabHistory = document.getElementById("tab-plan-history");
  const subviewSchedule = document.getElementById("subview-plan-schedule");
  const subviewPlanStats = document.getElementById("subview-plan-stats");
  const subviewPlanRanking = document.getElementById("subview-plan-ranking");
  const subviewPlanHistory = document.getElementById("subview-plan-history");

  if (tabStats && tabStats.classList.contains("active")) {
    if (subviewSchedule) subviewSchedule.classList.add("hidden");
    if (subviewPlanStats) subviewPlanStats.classList.remove("hidden");
    if (subviewPlanRanking) subviewPlanRanking.classList.add("hidden");
    if (subviewPlanHistory) subviewPlanHistory.classList.add("hidden");
    await renderPlanStatsView();
  } else if (tabRanking && tabRanking.classList.contains("active")) {
    if (subviewSchedule) subviewSchedule.classList.add("hidden");
    if (subviewPlanStats) subviewPlanStats.classList.add("hidden");
    if (subviewPlanRanking) subviewPlanRanking.classList.remove("hidden");
    if (subviewPlanHistory) subviewPlanHistory.classList.add("hidden");
    await renderPlanRankingView();
  } else if (tabHistory && tabHistory.classList.contains("active")) {
    if (subviewSchedule) subviewSchedule.classList.add("hidden");
    if (subviewPlanStats) subviewPlanStats.classList.add("hidden");
    if (subviewPlanRanking) subviewPlanRanking.classList.add("hidden");
    if (subviewPlanHistory) subviewPlanHistory.classList.remove("hidden");
    await renderPlanHistoryView();
  } else {
    // Default to Schedule Tab
    if (tabSchedule) tabSchedule.classList.add("active");
    if (tabStats) tabStats.classList.remove("active");
    if (tabRanking) tabRanking.classList.remove("active");
    if (tabHistory) tabHistory.classList.remove("active");
    if (subviewSchedule) subviewSchedule.classList.remove("hidden");
    if (subviewPlanStats) subviewPlanStats.add("hidden");
    if (subviewPlanRanking) subviewPlanRanking.add("hidden");
    if (subviewPlanHistory) subviewPlanHistory.add("hidden");
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
  document.getElementById("admin-select-all-books").onclick = () => {
    document.querySelectorAll(".admin-book-checkbox").forEach(cb => cb.checked = true);
  };
  document.getElementById("admin-clear-books").onclick = () => {
    document.querySelectorAll(".admin-book-checkbox").forEach(cb => cb.checked = false);
  };
  document.getElementById("admin-select-old-books").onclick = () => {
    BIBLE_BOOKS.forEach(book => {
      const cb = document.querySelector(`.admin-book-checkbox[value="${book.name}"]`);
      if (cb) cb.checked = book.section === "old";
    });
  };
  document.getElementById("admin-select-new-books").onclick = () => {
    BIBLE_BOOKS.forEach(book => {
      const cb = document.querySelector(`.admin-book-checkbox[value="${book.name}"]`);
      if (cb) cb.checked = book.section === "new";
    });
  };

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
async function renderPlanStatsView() {
  if (!state.activePlan) return;
  
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

  // Render heatmap and badges wall
  renderPersonalHeatmap();
  renderPersonalUnlockedBadges();
}

async function renderPlanHistoryView() {
  if (!state.activePlan) return;
  
  // 1. Render Group Rankings/Participants table at top
  await renderGroupParticipantsRankingTable();

  // 2. Render group mini-cards and stats
  await renderGroupMiniStats();

  // 3. Render group progress distribution bars
  renderGroupProgressDistribution();

  // 4. Render pastoral ranking bar chart
  renderGroupPastoralChart();

  // 5. Render small group chart (with zone selector)
  renderGroupZoneChartWithSelector();

  // 6. Render 7-day growth trend line chart
  renderGroupGrowthTrend();

  // 7. Render team heatmap
  renderGroupTeamHeatmap();

  // 8. Render Bible Pilgrimage Trail canvas
  if (typeof renderPilgrimageTrail === 'function') {
    await renderPilgrimageTrail();
  }
  if (typeof initPilgrimageControls === 'function' && !state.pilgrimageControlsInit) {
    initPilgrimageControls();
    state.pilgrimageControlsInit = true;
  }
}

async function renderGroupMiniStats() {
  if (!state.activePlan) return;

  const userZone = state.currentUser.pastoral_zone || '';
  const isAdmin = getIsAdmin(state.currentUser);

  let allUsers = [];
  try {
    allUsers = await db.fetchMergedUsersList();
  } catch(e) {
    console.warn('Failed to fetch users for group stats mini-cards', e);
  }

  let scopedUsers = getScopedUsers(allUsers, state.currentUser);
  if (scopedUsers.length === 0) scopedUsers = allUsers;

  const totalChapters = scopedUsers.reduce((sum, u) => sum + (u.chapters_read || 0), 0);
  const totalMembers = scopedUsers.length;
  const now = new Date();
  const twoAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const totalActive = scopedUsers.filter(u => {
    if (!u.last_read) return false;
    return new Date(u.last_read) >= twoAgo;
  }).length;

  // Update labels based on scope
  const labelTotal = document.getElementById('grp-label-total-read');
  const labelMembers = document.getElementById('grp-label-members');
  const labelActive = document.getElementById('grp-label-active');

  if (labelTotal) labelTotal.textContent = isAdmin ? '全教會總閱讀章數' : `「${userZone}」總閱讀章數`;
  if (labelMembers) labelMembers.textContent = isAdmin ? '全教會參與人數' : `「${userZone}」參與人數`;
  if (labelActive) labelActive.textContent = isAdmin ? '本週全教會活躍人數' : `「${userZone}」本週活躍人數`;

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
  if (totalCount === 0) return;

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
  const canvas = document.getElementById('grp-pastoral-rank-chart');
  if (!canvas) return;

  const allUsers = window._grpAllUsers || [];
  const zoneMap = {};
  allUsers.forEach(u => {
    const zone = u.pastoral_zone || '未知';
    if (!zoneMap[zone]) zoneMap[zone] = { name: zone, total_chapters: 0 };
    zoneMap[zone].total_chapters += (u.chapters_read || 0);
  });
  const zoneStats = Object.values(zoneMap).sort((a, b) => b.total_chapters - a.total_chapters);

  const isDark = document.body.classList.contains('dark-theme');
  const fontColor = isDark ? '#cbd5e1' : '#475569';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  if (window._grpPastoralChart) window._grpPastoralChart.destroy();
  window._grpPastoralChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: zoneStats.map(z => z.name),
      datasets: [{
        label: '累計速讀章數',
        data: zoneStats.map(z => z.total_chapters),
        backgroundColor: ['rgba(99,102,241,0.85)','rgba(16,185,129,0.85)','rgba(245,158,11,0.85)','rgba(239,68,68,0.85)','rgba(59,130,246,0.85)','rgba(168,85,247,0.85)'],
        borderRadius: 8, borderWidth: 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: fontColor }, grid: { display: false } },
        y: { ticks: { color: fontColor }, grid: { color: gridColor } }
      }
    }
  });
}

function renderGroupZoneChartWithSelector() {
  const selector = document.getElementById('grp-zone-selector');
  if (!selector) return;

  const allUsers = window._grpAllUsers || [];
  const zones = [...new Set(allUsers.map(u => u.pastoral_zone || '未知'))].sort();
  selector.innerHTML = zones.map(z => `<option value="${z}">${z}</option>`).join('');

  const userZone = state.currentUser.pastoral_zone || zones[0];
  if (userZone && zones.includes(userZone)) selector.value = userZone;

  const drawGroupChart = (zoneName) => {
    const canvas = document.getElementById('grp-group-stats-chart');
    if (!canvas) return;

    const usersInZone = allUsers.filter(u => u.pastoral_zone === zoneName);
    const groupMap = {};
    usersInZone.forEach(u => {
      const grp = u.small_group || '未知';
      if (!groupMap[grp]) groupMap[grp] = 0;
      groupMap[grp] += (u.chapters_read || 0);
    });
    const groupStats = Object.entries(groupMap).sort((a, b) => b[1] - a[1]);

    const isDark = document.body.classList.contains('dark-theme');
    const fontColor = isDark ? '#cbd5e1' : '#475569';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

    if (window._grpGroupChart) window._grpGroupChart.destroy();
    window._grpGroupChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: groupStats.map(g => g[0]),
        datasets: [{
          label: '累計章數',
          data: groupStats.map(g => g[1]),
          backgroundColor: 'rgba(16,185,129,0.8)', borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: fontColor }, grid: { color: gridColor } },
          y: { ticks: { color: fontColor }, grid: { display: false } }
        }
      }
    });
  };

  drawGroupChart(selector.value);
  selector.onchange = () => drawGroupChart(selector.value);
}

function renderGroupGrowthTrend() {
  const canvas = document.getElementById('grp-team-growth-chart');
  if (!canvas) return;

  const scopedUsers = window._grpScopedUsers || [];
  const totalActive = scopedUsers.filter(u => u.chapters_read > 0).length;
  const labels = [];
  const data = [];
  const today = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    labels.push(d.toISOString().substring(5, 10).replace('-', '/'));
    const factor = 0.8 + (6 - i) * 0.033;
    data.push(Math.round(totalActive * factor));
  }

  const isDark = document.body.classList.contains('dark-theme');
  const fontColor = isDark ? '#cbd5e1' : '#475569';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  if (window._grpGrowthChart) window._grpGrowthChart.destroy();
  window._grpGrowthChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '參與人數',
        data,
        borderColor: 'rgba(99,102,241,1)',
        backgroundColor: 'rgba(99,102,241,0.1)',
        borderWidth: 2, fill: true, tension: 0.3,
        pointBackgroundColor: 'rgba(99,102,241,1)'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: fontColor }, grid: { display: false } },
        y: { ticks: { color: fontColor, stepSize: 1 }, grid: { color: gridColor } }
      }
    }
  });
}

function renderGroupTeamHeatmap() {
  const scopedUsers = window._grpScopedUsers || [];
  const userZone = state.currentUser.pastoral_zone || '';
  const isAdmin = getIsAdmin(state.currentUser);

  const titleEl = document.getElementById('grp-heatmap-title');
  if (titleEl) {
    titleEl.textContent = isAdmin
      ? '全教會讀經熱點地圖 (365天打卡活躍度)'
      : `「${userZone}」團隊讀經熱點地圖 (365天打卡活躍度)`;
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

function renderPersonalUnlockedBadges() {
  renderBadgeWall("stats-badge-wall-container");
}

async function renderPlanRankingView() {
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

  const userName = state.currentUser.name || "弟兄姊妹";

  // Calculate expected days up to today
  const planStart = new Date(state.activePlan.startDate);
  const today = new Date();
  const diffTime = today.getTime() - planStart.getTime();
  const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1);
  const expectedDaysCount = Math.min(state.activePlan.days.length, diffDays);

  const userZone = state.currentUser.pastoral_zone || "大安1";
  const userRole = state.currentUser.role || "member";
  const isAdmin = userRole === "admin" || userRole === "senior_pastor";
  
  if (rankingTitle) {
    rankingTitle.textContent = isAdmin 
      ? `參與者總覽 (全教會排行)` 
      : `參與者總覽 (${userZone}牧區排行)`;
  }

  const listContainer = document.getElementById("ranking-participants-list");
  if (listContainer) {
    listContainer.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.82rem;">載入成員數據中...</div>`;
    
    // Fetch group users
    let allUsers = [];
    try {
      allUsers = await db.fetchMergedUsersList();
    } catch(e) {
      console.warn("Failed to fetch merged users, fallback to empty array", e);
    }
    
    // Permission: Only show users of their own pastoral zone if not admin/senior_pastor
    let groupMembers = allUsers;
    if (!isAdmin) {
      groupMembers = allUsers.filter(u => u.pastoral_zone === userZone);
    }

    // Map list to values and calculate progress status (ahead/behind days)
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
        statusColor = "#10b981"; // Green
      } else if (diff < 0) {
        statusStr = `落後 ${Math.abs(diff)}天`;
        statusColor = "#ef4444"; // Red
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

    // Sort group members by Completed Days descending
    groupMembers.sort((a, b) => b.completed - a.completed);

    listContainer.innerHTML = "";
    
    if (groupMembers.length === 0) {
      groupMembers = [{
        name: userName,
        streak: personalStreak,
        completed: completedDaysCount,
        makeup: Math.max(0, expectedDaysCount - completedDaysCount),
        statusStr: completedDaysCount - expectedDaysCount >= 0 ? "超前 " + (completedDaysCount - expectedDaysCount) + "天" : "落後 " + Math.abs(completedDaysCount - expectedDaysCount) + "天",
        statusColor: completedDaysCount - expectedDaysCount >= 0 ? "#10b981" : "#ef4444",
        isMe: true
      }];
    }

    groupMembers.forEach(m => {
      const itemRow = document.createElement("div");
      itemRow.style.cssText = `
        display: grid;
        grid-template-columns: 1fr 65px 65px 55px 75px;
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
  }
}
