// ============================================================
// utils.js — Shared utilities used across all view controllers
// ============================================================
// iconLabel / renderIcon / hydrateIcons live in js/icons.js

// ── Toast Notification ──────────────────────────────────────
/**
 * Show a brief toast notification at the bottom of the screen.
 * @param {string} message - Text to display
 * @param {number} [duration=2500] - Duration in milliseconds
 */
function showToast(message, duration = 2500) {
  let toast = document.getElementById("app-auto-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-auto-toast";
    toast.style.cssText = `
      position: fixed;
      bottom: 85px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: rgba(30,30,46,0.95);
      color: #fff;
      padding: 0.7rem 1.4rem;
      border-radius: 24px;
      font-size: 0.88rem;
      font-weight: 500;
      box-shadow: ${(window.NLC_SHADOW && window.NLC_SHADOW.lg) || "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)"};
      z-index: 9999;
      opacity: 0;
      transition: opacity 0.3s ease, transform 0.3s ease;
      pointer-events: none;
      white-space: nowrap;
      max-width: 90vw;
      text-align: center;
    `;
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) translateY(0)";

  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(20px)";
  }, duration);
}

// ── User Scope Filtering ─────────────────────────────────────
/**
 * Returns true if the user has admin/senior-pastor level access.
 * @param {object} user
 */
function getIsAdmin(user) {
  if (!user) return false;
  const role = user.role || "member";
  return role === "admin" || role === "senior_pastor";
}

/**
 * Filter a list of users based on the current user's role.
 * - admin/senior_pastor → all users
 * - great_zone_leader   → same great_region
 * - zone_leader         → same pastoral_zone
 * - group_leader        → same pastoral_zone + small_group
 * - member              → only themselves
 *
 * @param {Array} allUsers - Unfiltered user list
 * @param {object} currentUser - The logged-in user object
 * @returns {Array}
 */
function getScopedUsers(allUsers, currentUser) {
  if (!currentUser) return allUsers;
  const role = currentUser.role || "member";

  if (role === "senior_pastor" || role === "admin") {
    return allUsers;
  }
  if (role === "great_zone_leader") {
    const assignedRegions = (currentUser.great_region || "").split(",");
    return allUsers.filter(u => assignedRegions.includes(u.great_region));
  }
  if (role === "zone_leader") {
    const assignedZones = (currentUser.pastoral_zone || "").split(",");
    return allUsers.filter(u => assignedZones.includes(u.pastoral_zone));
  }
  if (role === "group_leader") {
    const assignedZones = (currentUser.pastoral_zone || "").split(",");
    const assignedGroups = (currentUser.small_group || "").split(",");
    return allUsers.filter(u =>
      assignedZones.includes(u.pastoral_zone) &&
      assignedGroups.includes(u.small_group)
    );
  }
  // member — only themselves
  return allUsers.filter(u => u.name === currentUser.name);
}

// ── Heatmap Grid Builder ─────────────────────────────────────
/**
 * Build and render a 365-day heatmap grid into a container element.
 *
 * @param {string}  containerId  - ID of the container element
 * @param {object}  logsByDate   - Map of { "YYYY-MM-DD": count }
 * @param {number}  [teamSize=1] - Used to scale colour intensity (1 = personal)
 * @param {string}  [label="章"] - Word appended to count in tooltip
 */
function buildHeatmapGrid(containerId, logsByDate, teamSize = 1, label = "章", planStartDate = null, planEndDate = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";

  let startDate, endDate;

  if (planStartDate && planEndDate) {
    startDate = new Date(planStartDate);
    startDate.setUTCHours(12, 0, 0, 0);

    endDate = new Date(planEndDate);
    endDate.setUTCHours(12, 0, 0, 0);
  } else {
    startDate = new Date();
    startDate.setUTCHours(12, 0, 0, 0);
    startDate.setUTCDate(startDate.getUTCDate() - 30);

    endDate = new Date();
    endDate.setUTCHours(12, 0, 0, 0);
  }

  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const wrapper = document.createElement("div");
  wrapper.className = "calendar-heatmap";

  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1, 12));
  const lastMonth = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1, 12));

  while (cursor <= lastMonth) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const firstDay = new Date(Date.UTC(year, month, 1, 12));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();

    const monthBlock = document.createElement("section");
    monthBlock.className = "calendar-month";

    const title = document.createElement("div");
    title.className = "calendar-month-title";
    title.textContent = `${year} ${monthNames[month]}`;
    monthBlock.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "calendar-month-grid";

    weekdays.forEach(day => {
      const labelEl = document.createElement("div");
      labelEl.className = "calendar-weekday";
      labelEl.textContent = day;
      grid.appendChild(labelEl);
    });

    for (let i = 0; i < firstDay.getUTCDay(); i++) {
      const blank = document.createElement("div");
      blank.className = "calendar-day blank";
      grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const currentDate = new Date(Date.UTC(year, month, day, 12));
      const dateStr = currentDate.toISOString().substring(0, 10);
      const count = logsByDate[dateStr] || 0;
      const inPlanRange = currentDate >= startDate && currentDate <= endDate;

      const cell = document.createElement("div");
      cell.className = "calendar-day";
      cell.setAttribute("data-date", dateStr);
      cell.setAttribute("data-count", count);
      cell.textContent = day;

      let level = 0;
      if (count > 0) {
        const maxCount = Math.max(2, Math.round(teamSize * 1.5));
        const ratio = count / maxCount;
        if (ratio <= 0.1) level = 1;
        else if (ratio <= 0.3) level = 2;
        else if (ratio <= 0.6) level = 3;
        else level = 4;
      }
      cell.dataset.level = String(level);
      if (!inPlanRange) cell.classList.add("out-of-range");
      cell.title = `${dateStr}: ${count} ${label}`;
      grid.appendChild(cell);
    }

    monthBlock.appendChild(grid);
    wrapper.appendChild(monthBlock);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  container.appendChild(wrapper);
}
function renderBadgeWall(containerId) {
  const container = document.getElementById("badges-grid") || document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";

  if (typeof ACHIEVEMENTS === "undefined") {
    container.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:1rem;">暫無解鎖勳章</div>`;
    return;
  }

  const unlocked = JSON.parse(localStorage.getItem("unlocked_badges") || "[]");
  const getBadgeClasses = typeof getHonorBadgeItemClasses === "function"
    ? getHonorBadgeItemClasses
    : (isUnlocked) => (isUnlocked ? "honor-badge-item unlocked" : "honor-badge-item locked");

  ACHIEVEMENTS.forEach(badge => {
    const isUnlocked = unlocked.includes(badge.id);

    const badgeItem = document.createElement("div");
    badgeItem.className = getBadgeClasses(isUnlocked);

    badgeItem.innerHTML = `
      ${!isUnlocked ? `
        <div class="honor-badge-item__lock">
          <span class="nlc-icon" data-icon="lock" aria-hidden="true"></span>
        </div>
      ` : ""}
      <div class="honor-badge-item__icon">
        <span class="nlc-icon" data-icon="${badge.iconKey || "award"}" aria-hidden="true"></span>
      </div>
      <span class="honor-badge-item__title">${badge.title}</span>
    `;

    // Click handler: Open dynamic detail page subpage panel
    badgeItem.onclick = () => {
      if (typeof window.openBadgeDetailPage === "function") {
        const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
        window.openBadgeDetailPage(badge, isUnlocked, isDark);
      }
    };

    container.appendChild(badgeItem);
  });

  if (typeof hydrateIcons === "function") {
    hydrateIcons(container);
  }

  // Attach back button close event listener once
  const backBtn = document.getElementById("badge-page-back-btn");
  if (backBtn && !backBtn._hasBackListener) {
    backBtn.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      const page = document.getElementById("badge-detail-page");
      if (page) page.classList.add("hidden");
    });
    backBtn._hasBackListener = true;
  }
}

// YouVersion high-grade full-screen detail subpage controller
window.openBadgeDetailPage = function(badge, isUnlocked, isDark) {
  const page = document.getElementById("badge-detail-page");
  const hero = document.getElementById("badge-detail-hero");
  const shield = document.getElementById("detail-shield");
  const icon = document.getElementById("detail-icon");
  const title = document.getElementById("detail-title");
  const desc = document.getElementById("detail-desc");
  const timeline = document.getElementById("detail-timeline-container");
  const levelPill = document.getElementById("detail-level-pill");
  const shareBtn = document.getElementById("badge-page-share-btn");
  
  if (!page) return;

  page.style.background = "";
  page.style.color = "";
  page.style.borderColor = "";
  if (hero) {
    hero.style.background = "";
    hero.style.borderColor = "";
    hero.style.color = "";
  }

  // Render text contents
  title.textContent = badge.title;
  desc.textContent = badge.description.split("：").pop();
  if (icon) {
    icon.className = "nlc-icon";
    icon.style.fontSize = "3rem";
    icon.setAttribute("data-icon", badge.iconKey || "award");
    icon.innerHTML = typeof renderIcon === "function"
      ? renderIcon(badge.iconKey || "award", { size: "3rem", className: "nlc-icon" })
      : "";
  }

  // Apply Shield styles based on unlock state (theme via CSS)
  if (shield) {
    shield.classList.remove("badge-shield--unlocked", "badge-shield--locked");
    shield.classList.add(isUnlocked ? "badge-shield--unlocked" : "badge-shield--locked");
    shield.style.background = "";
    shield.style.borderColor = "";
    shield.style.borderStyle = "";
    shield.style.borderWidth = "";
    shield.style.color = "";
  }

  // Dynamic milestone configurations for YouVersion level circles
  const milestoneConfig = {
    "badge-subscribe": { levels: [5, 3, 1], unit: "個計畫", getValue: () => (state.subscribedPlans ? state.subscribedPlans.length : 0) },
    "subscribe_plan": { levels: [5, 3, 1], unit: "個計畫", getValue: () => (state.subscribedPlans ? state.subscribedPlans.length : 0) },
    
    "badge-streak": { levels: [30, 15, 7, 1], unit: "天打卡", getValue: () => (state.currentUser ? state.currentUser.streak || 0 : 0) },
    "streak_30": { levels: [30, 15, 7, 1], unit: "天打卡", getValue: () => (state.currentUser ? state.currentUser.streak || 0 : 0) },
    
    "badge-complete": { levels: [5, 3, 1], unit: "個計畫", getValue: () => (state.completedPlans ? state.completedPlans.length : 0) },
    "complete_plan": { levels: [5, 3, 1], unit: "個計畫", getValue: () => (state.completedPlans ? state.completedPlans.length : 0) },
    
    "badge-share": { levels: [50, 10, 5, 1], unit: "次分享", getValue: () => (localStorage.getItem("has_shared_verse") === "true" ? 1 : 0) },
    "share_verse": { levels: [50, 10, 5, 1], unit: "次分享", getValue: () => (localStorage.getItem("has_shared_verse") === "true" ? 1 : 0) },
    
    "badge-bible": { levels: [1189, 500, 100, 10], unit: "章經文", getValue: () => {
      const uniqueChapters = new Set();
      if (state.readingLogs) {
        state.readingLogs.forEach(l => uniqueChapters.add(`${l.book}_${l.chapter}`));
      }
      return uniqueChapters.size;
    }}
  };

  const conf = milestoneConfig[badge.id] || { levels: [1], unit: "次", getValue: () => (isUnlocked ? 1 : 0) };
  const currentVal = conf.getValue();

  // Determine highest unlocked level
  let highestUnlockedLevel = 0;
  conf.levels.forEach(lvl => {
    if (currentVal >= lvl) {
      highestUnlockedLevel = Math.max(highestUnlockedLevel, lvl);
    }
  });

  // Update level display count pill
  if (levelPill) {
    if (highestUnlockedLevel > 0) {
      levelPill.textContent = highestUnlockedLevel;
      levelPill.style.display = "block";
    } else {
      levelPill.style.display = "none";
    }
  }

  // Populate milestone items dynamically
  timeline.innerHTML = "";
  conf.levels.forEach(lvl => {
    const isLvlUnlocked = currentVal >= lvl;
    
    const item = document.createElement("div");
    item.className = "badge-milestone-item";
    
    const circle = document.createElement("div");
    circle.className = `badge-milestone-circle ${isLvlUnlocked ? "badge-milestone-circle--unlocked" : "badge-milestone-circle--locked"}`;
    circle.textContent = lvl;
    
    const contentBox = document.createElement("div");
    contentBox.style.cssText = "flex: 1; display: flex; flex-direction: column; justify-content: center;";
    
    if (isLvlUnlocked) {
      let dateStr = localStorage.getItem(`date_unlocked_${badge.id}_lvl_${lvl}`);
      if (!dateStr) {
        const today = new Date();
        dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
        localStorage.setItem(`date_unlocked_${badge.id}_lvl_${lvl}`, dateStr);
      }
      contentBox.innerHTML = `
        <div class="badge-milestone-done">完成於 ${dateStr}</div>
      `;
    } else {
      const diff = lvl - currentVal;
      const pct = Math.min(100, Math.floor((currentVal / lvl) * 100));
      contentBox.innerHTML = `
        <div class="badge-milestone-remaining">還差 ${diff} ${conf.unit}</div>
        <div class="badge-milestone-track">
          <div class="badge-milestone-fill" style="width: ${pct}%;"></div>
        </div>
      `;
    }
    
    item.appendChild(circle);
    item.appendChild(contentBox);
    timeline.appendChild(item);
  });

  // Bind share button
  if (shareBtn) {
    shareBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (navigator.share) {
        navigator.share({
          title: `我解鎖了「${badge.title}」榮譽徽章！`,
          text: `我正在進行聖經速讀挑戰，解鎖了「${badge.title}」勳章！\n${badge.description}`,
          url: window.location.href
        }).catch(err => console.log(err));
      } else {
        if (typeof showToast === "function") {
          showToast(`已複製「${badge.title}」分享文字，快傳送給朋友吧！`);
        } else {
          alert(`已解鎖「${badge.title}」徽章！`);
        }
      }
    };
  }

  // Display page
  page.classList.remove("hidden");
};

// Compatibility aliases
window.openBadgeModal = function(badge, isUnlocked, isDark) {
  window.openBadgeDetailPage(badge, isUnlocked, isDark);
};

window.closeBadgeModal = function() {
  const page = document.getElementById("badge-detail-page");
  if (page) page.classList.add("hidden");
};

window.showBadgeDetail = function(title, description, isUnlocked) {
  const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
  const badgeObj = ACHIEVEMENTS.find(b => b.title === title) || { title, description };
  window.openBadgeDetailPage(badgeObj, isUnlocked, isDark);
};

// ── Global Premium Skeleton UI Loader ──────────────────────
const ComponentSkeletonLoader = {
  _bar(width, height = "16px", radius = "6px", extra = "") {
    return `<div class="skeleton-shimmer" style="height:${height};width:${width};border-radius:${radius};${extra}"></div>`;
  },

  _cardShell(content, extraStyle = "") {
    return `<div class="skeleton-card" style="${extraStyle}">${content}</div>`;
  },

  setInlineSkeleton(element, options = {}) {
    const el = typeof element === "string" ? document.querySelector(element) : element;
    if (!el) return;
    if (el.dataset.inlineOriginalHtml === undefined) {
      el.dataset.inlineOriginalHtml = el.innerHTML;
    }
    el.innerHTML = this.getHtml("inline", options);
  },

  restoreInlineSkeleton(element) {
    const el = typeof element === "string" ? document.querySelector(element) : element;
    if (!el || el.dataset.inlineOriginalHtml === undefined) return;
    el.innerHTML = el.dataset.inlineOriginalHtml;
    delete el.dataset.inlineOriginalHtml;
  },

  applyBootSkeletons() {
    this.show("dashboard-plan", "#active-plan-summary");
    this.fill("announcement", "#church-announcements-list", { count: 2 });
    this.fill("plan-list", "#joined-plans-list", { count: 2 });
    this.fill("profile-org", "#profile-summary-org");
    this.setInlineSkeleton("#profile-summary-name", { width: "6rem", height: "1.2rem" });
    this.setInlineSkeleton("#dropdown-user-name", { width: "5.5rem", height: "0.95rem" });
    const rankingList = document.getElementById("pastoral-ranking-list-container");
    if (rankingList && !rankingList.innerHTML.trim()) {
      this.fill("ranking", rankingList, { count: 5 });
    }
  },

  clearBootInlineSkeletons() {
    this.restoreInlineSkeleton("#profile-summary-name");
    this.restoreInlineSkeleton("#dropdown-user-name");
  },

  _memberRow() {
    return `
      <div style="height:64px;width:100%;border-radius:12px;display:flex;align-items:center;gap:1rem;padding:0.75rem;background:var(--bg-card);border:1px solid var(--border-card);">
        ${this._bar("40px", "40px", "50%")}
        <div style="flex:1;display:flex;flex-direction:column;gap:0.4rem;min-width:0;">
          ${this._bar("35%", "16px", "4px")}
          ${this._bar("55%", "12px", "4px")}
        </div>
      </div>
    `;
  },

  /**
   * Returns skeleton HTML for a given layout type.
   * @param {string} type
   * @param {{ count?: number, cols?: number }} options
   */
  getHtml(type, options = {}) {
    const count = options.count || 1;

    if (type === "dashboard-plan") {
      return `
        <div class="skeleton-wrapper" style="display:flex;flex-direction:column;gap:1rem;padding:0.25rem 0;">
          ${this._bar("62%", "18px", "6px")}
          ${this._bar("88%", "12px", "4px")}
          ${this._bar("100%", "10px", "999px")}
          <div style="display:flex;justify-content:space-around;gap:0.75rem;padding:0.85rem 0.5rem;border-radius:12px;border:1px solid var(--border-card);background:var(--color-brand-muted);">
            ${Array.from({ length: 3 }, () => `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:0.35rem;">
                ${this._bar("3.5rem", "16px", "4px")}
                ${this._bar("2.8rem", "10px", "4px")}
              </div>
            `).join("")}
          </div>
          <div style="display:flex;gap:0.75rem;margin-top:0.25rem;">
            ${this._bar("50%", "40px", "10px")}
            ${this._bar("50%", "40px", "10px")}
          </div>
        </div>
      `;
    }

    if (type === "reader") {
      return `
        <div class="skeleton-wrapper" style="padding:1.5rem 0.2rem;display:flex;flex-direction:column;gap:1.2rem;">
          ${this._bar("75%", "32px", "8px", "margin-bottom:0.5rem;")}
          ${this._bar("100%", "24px", "6px")}
          ${this._bar("91%", "24px", "6px")}
          ${this._bar("100%", "24px", "6px")}
          ${this._bar("83%", "24px", "6px")}
          ${this._bar("60%", "24px", "6px")}
        </div>
      `;
    }

    if (type === "plan") {
      return `
        <div class="skeleton-wrapper" style="padding:1rem 0.5rem;display:flex;flex-direction:column;gap:1.5rem;">
          ${this._bar("100%", "120px", "16px")}
          <div style="display:flex;gap:0.75rem;overflow:hidden;padding:0.25rem 0;">
            ${Array.from({ length: 7 }, () => this._bar("48px", "48px", "12px", "flex-shrink:0;")).join("")}
          </div>
          <div style="display:flex;flex-direction:column;gap:0.75rem;">
            ${this._bar("100%", "56px", "12px")}
            ${this._bar("100%", "56px", "12px")}
          </div>
        </div>
      `;
    }

    if (type === "members" || type === "member-progress") {
      const rows = type === "members" ? 5 : (count || 4);
      return `
        <div class="skeleton-wrapper" style="display:flex;flex-direction:column;gap:1rem;padding:1rem 0;">
          ${Array.from({ length: rows }, () => this._memberRow()).join("")}
        </div>
      `;
    }

    if (type === "announcement") {
      return `
        <div class="skeleton-wrapper" style="display:flex;flex-direction:column;gap:0.8rem;">
          ${Array.from({ length: count || 2 }, () => this._cardShell(`
            <div style="padding:0.8rem 1rem;display:flex;flex-direction:column;gap:0.5rem;">
              ${this._bar("38%", "14px", "4px")}
              ${this._bar("92%", "12px", "4px")}
              ${this._bar("72%", "12px", "4px")}
            </div>
          `)).join("")}
        </div>
      `;
    }

    if (type === "ranking") {
      return `
        <div class="skeleton-wrapper" style="display:flex;flex-direction:column;gap:0.65rem;">
          ${Array.from({ length: count || 5 }, (_, index) => `
            <div style="display:flex;align-items:center;gap:0.75rem;padding:0.55rem 0.2rem;">
              ${this._bar("28px", "28px", "50%", "flex-shrink:0;")}
              ${this._bar(index % 2 === 0 ? "58%" : "46%", "14px", "4px")}
              <div style="margin-left:auto;">${this._bar("52px", "14px", "4px")}</div>
            </div>
          `).join("")}
        </div>
      `;
    }

    if (type === "plan-list") {
      return `
        <div class="skeleton-wrapper" style="display:flex;flex-direction:column;gap:1rem;padding:1rem 0;">
          ${Array.from({ length: count || 2 }, () => `
            <div class="skeleton-row">
              ${this._bar("72px", "72px", "12px", "flex-shrink:0;")}
              <div style="flex:1;display:flex;flex-direction:column;gap:0.45rem;min-width:0;">
                ${this._bar("55%", "16px", "4px")}
                ${this._bar("78%", "12px", "4px")}
                ${this._bar("42%", "10px", "4px")}
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }

    if (type === "table-rows") {
      const cols = options.cols || 3;
      return `
        <div class="skeleton-wrapper" style="display:flex;flex-direction:column;gap:0.55rem;padding:0.35rem 0;">
          ${Array.from({ length: count || 3 }, () => `
            <div style="display:grid;grid-template-columns:repeat(${cols}, minmax(0, 1fr));gap:0.75rem;align-items:center;padding:0.45rem 0.25rem;">
              ${Array.from({ length: cols }, (_, colIndex) => this._bar(colIndex === 0 ? "72%" : "58%", "14px", "4px")).join("")}
            </div>
          `).join("")}
        </div>
      `;
    }

    if (type === "bar-race") {
      return `
        <div class="skeleton-wrapper" style="display:flex;flex-direction:column;gap:0.75rem;padding:0.5rem 0;">
          ${Array.from({ length: count || 4 }, (_, index) => `
            <div style="display:flex;align-items:center;gap:0.65rem;">
              ${this._bar("24px", "24px", "6px", "flex-shrink:0;")}
              <div style="flex:1;display:flex;flex-direction:column;gap:0.35rem;">
                ${this._bar(index % 2 === 0 ? "42%" : "36%", "12px", "4px")}
                ${this._bar(`${Math.max(35, 88 - index * 12)}%`, "10px", "999px")}
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }

    if (type === "stats") {
      return `
        <div class="skeleton-wrapper" style="display:flex;flex-direction:column;gap:1rem;padding:0.5rem 0;">
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.75rem;">
            ${this._bar("100%", "88px", "14px", "grid-column:span 2;")}
            ${this._bar("100%", "72px", "14px")}
            ${this._bar("100%", "72px", "14px")}
            ${this._bar("100%", "72px", "14px")}
            ${this._bar("100%", "72px", "14px")}
          </div>
          ${this._bar("100%", "140px", "14px")}
          ${this._bar("100%", "180px", "14px")}
          ${this._bar("100%", "220px", "12px")}
        </div>
      `;
    }

    if (type === "verse-card") {
      return `
        <div class="skeleton-wrapper skeleton-on-dark verse-card-skeleton" style="display:flex;flex-direction:column;gap:1rem;height:100%;min-height:268px;justify-content:space-between;">
          <div style="display:flex;flex-direction:column;gap:0.5rem;">
            ${this._bar("32%", "10px", "4px")}
            ${this._bar("24%", "12px", "4px")}
          </div>
          <div style="display:flex;flex-direction:column;gap:0.65rem;flex:1;justify-content:center;padding:1rem 0;">
            ${this._bar("96%", "20px", "6px")}
            ${this._bar("88%", "20px", "6px")}
            ${this._bar("64%", "20px", "6px")}
          </div>
          <div style="display:flex;justify-content:space-between;gap:0.5rem;border-top:1px solid rgba(255,255,255,0.08);padding-top:0.75rem;">
            ${this._bar("28%", "36px", "8px")}
            ${this._bar("28%", "36px", "8px")}
            ${this._bar("28%", "36px", "8px")}
          </div>
        </div>
      `;
    }

    if (type === "inline") {
      return `<span class="skeleton-shimmer skeleton-inline" style="display:inline-block;width:${options.width || "4.5rem"};height:${options.height || "0.85em"};border-radius:4px;vertical-align:middle;"></span>`;
    }

    if (type === "task-list") {
      return `
        <div class="skeleton-wrapper" style="display:flex;flex-direction:column;gap:0.75rem;padding:0.25rem 0;">
          ${Array.from({ length: count || 3 }, () => this._bar("100%", "56px", "12px")).join("")}
        </div>
      `;
    }

    if (type === "profile-org") {
      return `
        <span class="skeleton-wrapper" style="display:inline-flex;flex-direction:column;gap:0.35rem;min-width:8rem;">
          ${this._bar("9rem", "12px", "4px")}
          ${this._bar("6.5rem", "10px", "4px")}
        </span>
      `;
    }

    return "";
  },

  /**
   * Sets skeleton HTML without caching the original content.
   */
  fill(type, container, options = {}) {
    const parent = typeof container === "string" ? document.querySelector(container) : container;
    if (!parent) return;
    parent.innerHTML = this.getHtml(type, options);
  },

  /**
   * Renders a shimmer skeleton layout inside the specified container.
   * @param {string} type
   * @param {HTMLElement|string} container
   * @param {{ count?: number, cols?: number }} options
   */
  show(type, container, options = {}) {
    const parent = typeof container === "string" ? document.querySelector(container) : container;
    if (!parent) return;

    if (!parent.dataset.originalHtml) {
      parent.dataset.originalHtml = parent.innerHTML;
    }

    parent.innerHTML = this.getHtml(type, options);
  },

  /**
   * Hides the skeleton loader and restores the cached HTML.
   * @param {HTMLElement|string} container
   */
  hide(container) {
    const parent = typeof container === "string" ? document.querySelector(container) : container;
    if (!parent) return;

    if (parent.dataset.originalHtml !== undefined) {
      parent.innerHTML = parent.dataset.originalHtml;
      delete parent.dataset.originalHtml;
    }
  }
};
window.ComponentSkeletonLoader = ComponentSkeletonLoader;

