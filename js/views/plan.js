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
}

function getPresetKeyByName(name) {
  if (!name) return null;
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

  Object.entries(CHURCH_PLAN_PRESETS).forEach(([key, preset]) => {
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
    presetKey
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
    plan.days.forEach(day => {
      day.chapters.forEach(ch => {
        const isRead = state.readingLogs.some(l => {
          const logDate = l.read_at.substring(0, 10);
          const isPlanMatch = !l.presetKey || (l.presetKey === plan.presetKey) || (plan.id && l.plan_id === plan.id);
          const isAdmin = state.currentUser && state.currentUser.role === 'admin';
          return l.book === ch.book && l.chapter === ch.chapter && isPlanMatch && (logDate >= plan.startDate || isAdmin);
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

function renderPlanView() {
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
  
  let html = selectHtml + `
    <div class="plan-progress-header">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
        <h4 style="font-size: 1.3rem; font-weight: 800; color: var(--text-primary); margin: 0;">${state.activePlan.name}</h4>
        ${isActuallyStarted
          ? '<span style="font-size: 0.75rem; background: #10b981; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">進行中</span>'
          : '<span style="font-size: 0.75rem; background: #3b82f6; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-weight: 700; white-space: nowrap;">等待開始</span>'
        }
      </div>
      <div class="plan-progress-wrapper" style="margin-top: 1rem;">
        <div class="plan-progress-bar" style="width: ${state.activePlan.progress}%;"></div>
      </div>
      <p style="font-size: 0.88rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.5rem; text-align: right;">
        已讀: ${state.activePlan.progress}% (${state.activePlan.completedChapters} / ${state.activePlan.totalChapters} 章)
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
  
  const bar = document.querySelector("#plan-tracker-container .plan-progress-bar");
  const percentText = document.querySelector("#plan-tracker-container p");
  
  if (bar && percentText) {
    bar.style.width = `${state.activePlan.progress}%`;
    percentText.innerHTML = `已讀: ${state.activePlan.progress}% (${state.activePlan.completedChapters} / ${state.activePlan.totalChapters} 章)`;
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
