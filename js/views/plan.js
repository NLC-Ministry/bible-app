// Reading plans tab view controller

function initPlanControls() {
  renderPresetPlansList();

  // Delete/Leave plan
  const deleteBtn = document.getElementById("delete-plan-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      if (!state.activePlan) return;
      if (!confirm("確定要放棄目前的讀經計畫嗎？已讀章節紀錄仍會保留。")) {
        return;
      }
      await db.leavePlan(state.activePlan.id, state.activePlan.presetKey);
    });
  }

  // Initialize Global Plans Admin Controls
  if (typeof initAdminPlanManagement === 'function') {
    initAdminPlanManagement();
  }
}

function getPresetKeyByName(name) {
  if (!name) return null;
  const foundDb = (state.globalPlans || []).find(p => p.name === name);
  if (foundDb) return foundDb.presetKey || foundDb.id;
  const found = Object.entries(CHURCH_PLAN_PRESETS).find(([key, preset]) => preset.name === name);
  return found ? found[0] : null;
}

window.changeActivePlan = function(key) {
  if (!state.activePlans) return;
  const plan = state.activePlans.find(p => p.presetKey === key);
  if (plan) {
    state.activePlan = plan;
    localStorage.setItem("selected_plan_key", key);
    renderPlanView();
    updateDashboardView();
  }
};

function calculateDaysBetween(start, end) {
  const sDate = new Date(start);
  const eDate = new Date(end);
  const diffTime = Math.abs(eDate - sDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays;
}

function renderPresetPlansList() {
  const container = document.getElementById("preset-plans-list");
  if (!container) return;

  container.innerHTML = "";

  const availablePlans = state.globalPlans && state.globalPlans.length > 0
    ? state.globalPlans
    : Object.entries(CHURCH_PLAN_PRESETS).map(([key, p]) => ({ id: key, presetKey: key, ...p }));

  availablePlans.forEach(preset => {
    const key = preset.presetKey || preset.id;
    const isJoined = state.activePlans && state.activePlans.some(p => p.presetKey === key || getPresetKeyByName(p.name) === key);

    const card = document.createElement("div");
    card.className = "preset-plan-item-card";
    card.style = `
      background: rgba(255, 255, 255, 0.45);
      border: 1px solid var(--border-card);
      border-radius: var(--radius-sm);
      padding: 0.9rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      transition: all 0.2s ease;
      cursor: default;
    `;

    card.onmouseenter = () => {
      card.style.background = "rgba(99, 102, 241, 0.05)";
      card.style.borderColor = "var(--primary-color)";
    };
    card.onmouseleave = () => {
      card.style.background = "rgba(255, 255, 255, 0.45)";
      card.style.borderColor = "var(--border-card)";
    };

    const bookBadges = preset.books.map(b => `<span style="font-size: 0.72rem; background: var(--border-card); color: var(--text-primary); padding: 0.15rem 0.4rem; border-radius: 4px; display: inline-block;">${b}</span>`).join(" ");

    const started = isPlanStarted(preset);
    const badgeHtml = isJoined 
      ? (started 
          ? '<span style="font-size: 0.7rem; background: #10b981; color: white; padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">進行中</span>'
          : '<span style="font-size: 0.7rem; background: #3b82f6; color: white; padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">等待開始</span>'
        )
      : '';

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
        <h4 style="margin: 0; font-size: 0.9rem; font-weight: 700; color: var(--text-primary);">${preset.name}</h4>
        ${badgeHtml}
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">
        📅 ${preset.startDate} ~ ${preset.endDate} (${calculateDaysBetween(preset.startDate, preset.endDate)} 天)
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0.2rem 0;">
        ${bookBadges}
      </div>
      ${!isJoined ? `
        <button class="primary-btn join-preset-btn" data-key="${key}" style="font-size: 0.78rem; padding: 0.35rem 0.75rem; margin-top: 0.3rem; align-self: flex-end;">
          加入挑戰
        </button>
      ` : `
        <button class="secondary-btn" disabled style="font-size: 0.78rem; padding: 0.35rem 0.75rem; margin-top: 0.3rem; align-self: flex-end; cursor: not-allowed;">
          已加入
        </button>
      `}
    `;

    container.appendChild(card);
  });

  container.querySelectorAll(".join-preset-btn").forEach(btn => {
    btn.onclick = async (e) => {
      e.preventDefault();
      const key = btn.getAttribute("data-key");
      await db.joinPresetPlan(key);
    };
  });
}

function generatePlanObject(name, startDate, endDate, selectedBooks, presetKey = null) {
  const start = new Date(startDate);
  const end = new Date(endDate);
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
    const dateStr = dayDate.toISOString().substring(5, 10).replace("-", "/"); // MM/DD
    
    return {
      dayNum: index + 1,
      date: dateStr,
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
          const logDate = l.read_at.substring(0, 10);
          const isPlanMatch = !l.presetKey || (l.presetKey === plan.presetKey) || (plan.id && l.plan_id === plan.id);
          const isAdmin = state.currentUser && state.currentUser.role === 'admin';
          const isRoundMatch = (l.round || 1) === currentRound;
          return l.book === ch.book && l.chapter === ch.chapter && isPlanMatch && isRoundMatch && (logDate >= plan.startDate || isAdmin);
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
  const container = document.getElementById("plan-tracker-container");
  const deleteBtn = document.getElementById("delete-plan-btn");

  if (!state.activePlan) {
    container.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 3rem 0;">
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">您目前沒有進行中的讀經計畫。</p>
        <p style="font-size: 0.9rem; color: var(--text-muted);">請在右側欄位選擇欲加入的教會季度計畫！</p>
      </div>
    `;
    deleteBtn.classList.add("hidden");
    renderPresetPlansList();
    return;
  }

  // Check plan schedule alignment (downgrade check)
  await checkPlanSchedule(state.activePlan);

  deleteBtn.classList.remove("hidden");
  
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  const started = isPlanStarted(state.activePlan) || isAdmin;
  const isActuallyStarted = isPlanStarted(state.activePlan);
  
  let selectHtml = "";
  if (state.activePlans && state.activePlans.length > 1) {
    selectHtml = `
      <div class="plan-selector-bar" style="margin-bottom: 1.2rem; display: flex; align-items: center; gap: 0.5rem; background: rgba(255,255,255,0.3); padding: 0.6rem; border-radius: var(--radius-sm); border: 1px solid var(--border-card);">
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary); white-space: nowrap;">切換計畫：</label>
        <select id="active-plan-select" style="flex: 1; font-size: 0.85rem; padding: 0.35rem 0.5rem; border-radius: 4px; border: 1px solid var(--border-card); background: var(--bg-card); color: var(--text-primary); cursor: pointer;" onchange="window.changeActivePlan(this.value)">
          ${state.activePlans.map(plan => {
            const planStarted = isPlanStarted(plan);
            const statusLabel = planStarted ? "進行中" : "等待開始";
            const selected = plan.presetKey === state.activePlan.presetKey ? "selected" : "";
            return `<option value="${plan.presetKey}" ${selected}>${plan.name} (${statusLabel})</option>`;
          }).join("")}
        </select>
      </div>
    `;
  }

  let warningBanner = "";
  if (!isActuallyStarted) {
    if (isAdmin) {
      warningBanner = `
        <div class="not-started-banner" style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: var(--radius-sm); padding: 0.8rem; margin: 1rem 0; color: var(--text-primary); font-size: 0.85rem; font-weight: 600; line-height: 1.4;">
          💡 此計畫尚未開始 (開始日期：${state.activePlan.startDate})。您目前以<strong>系統管理員 (Admin)</strong> 身分進行測試，已為您解除限制。
        </div>
      `;
    } else {
      warningBanner = `
        <div class="not-started-banner" style="background: rgba(59, 130, 246, 0.1); border: 1px solid #3b82f6; border-radius: var(--radius-sm); padding: 0.8rem; margin: 1rem 0; color: var(--text-primary); font-size: 0.85rem; font-weight: 600; line-height: 1.4;">
          ⚠️ 此計畫尚未開始 (開始日期：${state.activePlan.startDate})。開始前無法標記讀經進度。
        </div>
      `;
    }
  }
  
  const currentRound = state.activePlan.currentRound || 1;
  const level = state.activePlan.level || 'normal';
  const wasDowngraded = state.activePlan.wasDowngraded || false;

  // Level selector HTML
  let levelSelectorHtml = `
    <div class="plan-level-selector-bar" style="margin-top: 0.5rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; background: rgba(255,255,255,0.25); padding: 0.6rem; border-radius: var(--radius-sm); border: 1px solid var(--border-card);">
      <label style="font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); display: flex; align-items: center; gap: 0.25rem; margin: 0;">
        🎯 進度等級：
      </label>
      <select id="plan-level-select" style="font-size: 0.82rem; padding: 0.25rem 0.4rem; border-radius: 4px; border: 1px solid var(--border-card); background: var(--bg-card); color: var(--text-primary); cursor: pointer;" 
        ${(wasDowngraded && level === 'normal') ? 'disabled title="因進度落後降為一般，已限制手動升級"' : ''}
        onchange="window.changePlanLevel(this.value)">
        <option value="normal" ${level === 'normal' ? 'selected' : ''}>一般進度 (讀1遍)</option>
        <option value="breakthrough" ${level === 'breakthrough' ? 'selected' : ''}>突破進度 (讀2遍)</option>
        <option value="super" ${level === 'super' ? 'selected' : ''}>超強進度 (讀3遍)</option>
      </select>
    </div>
  `;

  if (wasDowngraded && level === 'normal') {
    levelSelectorHtml += `
      <div style="font-size: 0.72rem; color: #ef4444; font-weight: 600; margin-top: -0.8rem; margin-bottom: 0.8rem; padding-left: 0.5rem;">
        ⚠️ 因落後降為一般，不得申請升級，讀完第一遍後將自動升級。
      </div>
    `;
  }

  let roundClass = "round-1";
  if (currentRound === 2) roundClass = "round-2";
  else if (currentRound === 3) roundClass = "round-3";
  else if (currentRound >= 4) roundClass = "round-4";

  let roundLabel = `第 ${currentRound} 遍`;
  if (currentRound >= 4) {
    roundLabel = `第 ${currentRound} 遍 (自主掌控)`;
  }

  let html = selectHtml + levelSelectorHtml + `
    <div class="plan-progress-header">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
        <h4 style="font-size: 1.3rem; font-weight: 800; color: var(--text-primary); margin: 0;">${state.activePlan.name}</h4>
        ${isActuallyStarted
          ? '<span style="font-size: 0.75rem; background: #10b981; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">進行中</span>'
          : '<span style="font-size: 0.75rem; background: #3b82f6; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">等待開始</span>'
        }
      </div>
      <div class="plan-progress-wrapper" style="margin-top: 1rem;">
        <div class="plan-progress-bar ${roundClass}" style="width: ${state.activePlan.progress}%;"></div>
      </div>
      <p style="font-size: 0.88rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.5rem; text-align: right; margin-bottom: 0.5rem;">
        ${roundLabel} 已讀: ${state.activePlan.progress}% (${state.activePlan.completedChapters} / ${state.activePlan.totalChapters} 章)
      </p>
    </div>
    
    ${warningBanner}
    
    <div class="days-scroll-list" style="max-height: 480px; overflow-y: auto; margin-top: 1.5rem; padding-right: 0.5rem;">
  `;

  state.activePlan.days.forEach(day => {
    const allDone = day.chapters.every(ch => ch.isRead);
    const badgeClass = allDone ? "day-badge complete" : "day-badge";
    const badgeText = allDone ? "已完成" : "未完";

    html += `
      <div class="day-section">
        <div class="day-title-flex" onclick="toggleDaySection(this)">
          <div class="day-title">Day ${day.dayNum} <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-muted); margin-left: 0.5rem;">(${day.date})</span></div>
          <span class="${badgeClass}">${badgeText}</span>
        </div>
        <div class="day-chapters-list">
    `;

    day.chapters.forEach(ch => {
      const isChecked = ch.isRead ? "checked" : "";
      const labelClass = ch.isRead ? "chapter-checkbox-item checked" : "chapter-checkbox-item";
      const isDisabled = started ? "" : "disabled style='cursor: not-allowed; opacity: 0.6;'";
      
      html += `
        <label class="${labelClass}" data-key="${ch.key}" ${!started ? 'style="opacity: 0.6; cursor: not-allowed;"' : ''}>
          <input type="checkbox" value="${ch.key}" ${isChecked} ${isDisabled} onchange="togglePlanChapterCheckbox(this, '${ch.book}', ${ch.chapter})">
          <span>${ch.book} ${ch.chapter}章</span>
          <button class="text-link-btn" style="margin-left: auto; font-size: 0.75rem; font-weight: 600;" onclick="readChapterDirect('${ch.book}', ${ch.chapter})">閱讀</button>
        </label>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
  renderPresetPlansList();

  // If user is admin/senior pastor and in simulated admin mode, render global plan management list
  const isRealAdmin = !state.isSupabaseMode || (state.realRole === "admin" || state.realRole === "senior_pastor");
  const isSimulatedAdmin = state.currentUser && (state.currentUser.role === "admin" || state.currentUser.role === "senior_pastor");
  if (isRealAdmin && isSimulatedAdmin && typeof renderAdminPlanManagement === 'function') {
    renderAdminPlanManagement();
  }
}

function toggleDaySection(headerEl) {
  const list = headerEl.nextElementSibling;
  list.classList.toggle("hidden");
}

async function togglePlanChapterCheckbox(cb, book, chapter) {
  const isChecked = cb.checked;
  const label = cb.parentElement;
  
  if (isChecked) {
    label.classList.add("checked");
  } else {
    label.classList.remove("checked");
  }

  loader.show("記錄中...");
  await db.logChapterRead(book, chapter, isChecked);
  
  calculatePlanProgress();
  db.saveLocalUserStats();
  
  // Check if round completion is reached
  if (state.activePlan && state.activePlan.progress === 100) {
    await handleRoundCompletion(state.activePlan);
  } else {
    const bar = document.querySelector("#plan-tracker-container .plan-progress-bar");
    const percentText = document.querySelector("#plan-tracker-container p");
    
    if (bar && percentText) {
      bar.style.width = `${state.activePlan.progress}%`;
      const currentRound = state.activePlan.currentRound || 1;
      let roundLabel = `第 ${currentRound} 遍`;
      if (currentRound >= 4) {
        roundLabel = `第 ${currentRound} 遍 (自主掌控)`;
      }
      percentText.innerHTML = `${roundLabel} 已讀: ${state.activePlan.progress}% (${state.activePlan.completedChapters} / ${state.activePlan.totalChapters} 章)`;
    }
  }

  const daySection = label.closest(".day-section");
  if (daySection) {
    const checkboxes = daySection.querySelectorAll("input[type='checkbox']");
    const allChecked = Array.from(checkboxes).every(box => box.checked);
    const badge = daySection.querySelector(".day-badge");
    if (allChecked) {
      badge.className = "day-badge complete";
      badge.textContent = "已完成";
    } else {
      badge.className = "day-badge";
      badge.textContent = "未完";
    }
  }

  loader.hide();
}

function updatePlanCheckboxState(key, isChecked) {
  const checkbox = document.querySelector(`.chapter-checkbox-item[data-key="${key}"] input`);
  if (checkbox) {
    checkbox.checked = isChecked;
    const label = checkbox.parentElement;
    if (isChecked) {
      label.classList.add("checked");
    } else {
      label.classList.remove("checked");
    }
    const daySection = label.closest(".day-section");
    if (daySection) {
      const checkboxes = daySection.querySelectorAll("input[type='checkbox']");
      const allChecked = Array.from(checkboxes).every(box => box.checked);
      const badge = daySection.querySelector(".day-badge");
      if (allChecked) {
        badge.className = "day-badge complete";
        badge.textContent = "已完成";
      } else {
        badge.className = "day-badge";
        badge.textContent = "未完";
      }
    }
  }
}

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
