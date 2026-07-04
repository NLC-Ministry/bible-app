// ============================================================
// utils.js — Shared utilities used across all view controllers
// ============================================================

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
      font-weight: 600;
      box-shadow: 0 8px 30px rgba(0,0,0,0.3);
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
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";

  if (typeof ACHIEVEMENTS === "undefined") {
    container.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:1rem;">暫無解鎖勳章</div>`;
    return;
  }

  const unlocked = JSON.parse(localStorage.getItem("unlocked_badges") || "[]");

  // Force grid layout styling on container
  container.style.cssText = "display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-top: 1rem; width: 100%;";

  ACHIEVEMENTS.forEach(badge => {
    const isUnlocked = unlocked.includes(badge.id);

    const badgeItem = document.createElement("div");
    badgeItem.className = isUnlocked ? "honor-badge-item unlocked" : "honor-badge-item locked";
    
    // Grid card styling
    const baseCardStyle = `
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 0.75rem 0.5rem;
      border-radius: 0.75rem;
      transition: all 0.3s ease;
      cursor: pointer;
      position: relative;
      user-select: none;
    `;
    
    const stateStyle = isUnlocked 
      ? `background: linear-gradient(to tr, rgba(245, 158, 11, 0.1), rgba(249, 115, 22, 0.1)); border: 1px solid rgba(245, 158, 11, 0.25);`
      : `border: 1px dashed rgba(71, 85, 105, 0.6); background: rgba(15, 23, 42, 0.15);`;
      
    badgeItem.style.cssText = baseCardStyle + stateStyle;
    
    const iconColor = isUnlocked ? "color: #fbbf24;" : "color: #94a3b8; opacity: 0.35;";
    const textColor = isUnlocked ? "color: #ffffff;" : "color: #94a3b8; opacity: 0.55;";
    
    badgeItem.innerHTML = `
      <!-- Lock Badge for Locked State -->
      ${!isUnlocked ? `
        <div style="position: absolute; top: 6px; right: 8px; opacity: 0.55;">
          <i class="bi bi-lock-fill" style="font-size: 0.7rem; color: #64748b;"></i>
        </div>
      ` : ""}
      
      <!-- Badge Icon -->
      <div style="font-size: 1.6rem; display: flex; width: 44px; height: 44px; justify-content: center; align-items: center; flex-shrink: 0; ${iconColor}">
        <i class="${badge.iconClass}"></i>
      </div>
      
      <!-- Short Title Only -->
      <span style="font-size: 0.72rem; font-weight: 500; margin-top: 0.4rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; ${textColor}">
        ${badge.title}
      </span>
    `;

    // Click handler to open the Toast showing requirements
    badgeItem.onclick = () => {
      if (typeof window.showBadgeDetail === "function") {
        window.showBadgeDetail(badge.title, badge.description, isUnlocked);
      }
    };

    // Hover effects
    badgeItem.onmouseenter = () => {
      badgeItem.style.transform = "scale(1.05)";
      if (isUnlocked) {
        badgeItem.style.boxShadow = "0 4px 12px rgba(245, 158, 11, 0.15)";
      }
    };
    badgeItem.onmouseleave = () => {
      badgeItem.style.transform = "scale(1)";
      badgeItem.style.boxShadow = "none";
    };

    container.appendChild(badgeItem);
  });
}

// Global click drawer/toast
window.showBadgeDetail = function(title, description, isUnlocked) {
  const statusText = isUnlocked ? "【已解鎖】" : "【未解鎖】";
  if (typeof showToast === "function") {
    showToast(`${statusText} ${title}：\n${description.split('：').pop()}`, 4000);
  } else {
    alert(`${statusText} ${title}：\n${description.split('：').pop()}`);
  }
};

// ── Global Premium Skeleton UI Loader ──────────────────────
const ComponentSkeletonLoader = {
  /**
   * Renders a shimmer skeleton layout inside the specified container.
   * @param {string} type - 'reader', 'plan', or 'members'
   * @param {HTMLElement|string} container - Element object or CSS selector
   */
  show(type, container) {
    const parent = typeof container === "string" ? document.querySelector(container) : container;
    if (!parent) return;

    // Cache original content to restore on hide
    if (!parent.dataset.originalHtml) {
      parent.dataset.originalHtml = parent.innerHTML;
    }

    let skeletonHtml = "";

    if (type === "reader") {
      // 狀況 A：當處於【讀經頁面】載入時 (4~5 條長短不一、大字體行高的橫向圓角條狀骨架)
      skeletonHtml = `
        <div class="skeleton-wrapper space-y-6" style="padding: 1.5rem 0.2rem;">
          <div class="h-8 w-3/4 rounded-md skeleton-shimmer mb-8" style="height: 32px; width: 75%; margin-bottom: 2rem;"></div>
          <div class="space-y-4" style="display: flex; flex-direction: column; gap: 1.2rem;">
            <div class="h-6 w-full rounded-md skeleton-shimmer" style="height: 24px; width: 100%;"></div>
            <div class="h-6 w-11/12 rounded-md skeleton-shimmer" style="height: 24px; width: 91%;"></div>
            <div class="h-6 w-full rounded-md skeleton-shimmer" style="height: 24px; width: 100%;"></div>
            <div class="h-6 w-10/12 rounded-md skeleton-shimmer" style="height: 24px; width: 83%;"></div>
            <div class="h-6 w-3/5 rounded-md skeleton-shimmer" style="height: 24px; width: 60%;"></div>
          </div>
        </div>
      `;
    } else if (type === "plan") {
      // 狀況 B：當處於【計畫頁面】載入時 (頂部大圓角矩形 + 7個小正方形 + 滿版長條)
      skeletonHtml = `
        <div class="skeleton-wrapper space-y-6" style="padding: 1rem 0.5rem; display: flex; flex-direction: column; gap: 1.5rem;">
          <!-- Big rounded progress card -->
          <div class="h-32 w-full rounded-2xl skeleton-shimmer" style="height: 120px; width: 100%; border-radius: 16px;"></div>
          
          <!-- Horizontal 7 days calendar calendar slider -->
          <div class="flex space-x-3 overflow-hidden py-1" style="display: flex; gap: 0.75rem; overflow: hidden; padding: 0.25rem 0;">
            <div class="h-12 w-12 rounded-xl skeleton-shimmer flex-shrink-0" style="height: 48px; width: 48px; border-radius: 12px; flex-shrink: 0;"></div>
            <div class="h-12 w-12 rounded-xl skeleton-shimmer flex-shrink-0" style="height: 48px; width: 48px; border-radius: 12px; flex-shrink: 0;"></div>
            <div class="h-12 w-12 rounded-xl skeleton-shimmer flex-shrink-0" style="height: 48px; width: 48px; border-radius: 12px; flex-shrink: 0;"></div>
            <div class="h-12 w-12 rounded-xl skeleton-shimmer flex-shrink-0" style="height: 48px; width: 48px; border-radius: 12px; flex-shrink: 0;"></div>
            <div class="h-12 w-12 rounded-xl skeleton-shimmer flex-shrink-0" style="height: 48px; width: 48px; border-radius: 12px; flex-shrink: 0;"></div>
            <div class="h-12 w-12 rounded-xl skeleton-shimmer flex-shrink-0" style="height: 48px; width: 48px; border-radius: 12px; flex-shrink: 0;"></div>
            <div class="h-12 w-12 rounded-xl skeleton-shimmer flex-shrink-0" style="height: 48px; width: 48px; border-radius: 12px; flex-shrink: 0;"></div>
          </div>
          
          <!-- Full-width list task item -->
          <div class="space-y-3" style="display: flex; flex-direction: column; gap: 0.75rem;">
            <div class="h-14 w-full rounded-xl skeleton-shimmer" style="height: 56px; width: 100%; border-radius: 12px;"></div>
            <div class="h-14 w-full rounded-xl skeleton-shimmer" style="height: 56px; width: 100%; border-radius: 12px;"></div>
          </div>
        </div>
      `;
    } else if (type === "members") {
      // 狀況 C：當處於【成員管理頁面】載入時 (搜尋框下方 5 條高度 64px 橫向長條，左圓右兩行)
      skeletonHtml = `
        <div class="skeleton-wrapper space-y-4" style="display: flex; flex-direction: column; gap: 1rem; padding: 1rem 0;">
          ${[1, 2, 3, 4, 5].map(() => `
            <div class="h-16 w-full rounded-xl p-3 flex items-center" style="height: 64px; width: 100%; border-radius: 12px; display: flex; align-items: center; gap: 1rem; padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-card);">
              <!-- Left circle avatar -->
              <div class="h-10 w-10 rounded-full skeleton-shimmer" style="height: 40px; width: 40px; border-radius: 50%; flex-shrink: 0;"></div>
              <!-- Right two lines of text -->
              <div class="flex-1" style="flex: 1; display: flex; flex-direction: column; gap: 0.4rem; min-width: 0;">
                <div class="h-4 w-1/3 rounded skeleton-shimmer" style="height: 16px; width: 35%; border-radius: 4px;"></div>
                <div class="h-3 w-1/2 rounded skeleton-shimmer" style="height: 12px; width: 55%; border-radius: 4px;"></div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    parent.innerHTML = skeletonHtml;
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

