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
    return allUsers.filter(u => u.great_region === currentUser.great_region);
  }
  if (role === "zone_leader") {
    return allUsers.filter(u => u.pastoral_zone === currentUser.pastoral_zone);
  }
  if (role === "group_leader") {
    return allUsers.filter(u =>
      u.pastoral_zone === currentUser.pastoral_zone &&
      u.small_group === currentUser.small_group
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
function buildHeatmapGrid(containerId, logsByDate, teamSize = 1, label = "章") {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "heatmap-grid";

  // Use UTC to prevent timezone offsets
  const startDate = new Date();
  startDate.setUTCHours(12, 0, 0, 0);
  startDate.setUTCDate(startDate.getUTCDate() - 365);
  const dayOfWeek = startDate.getUTCDay();
  startDate.setUTCDate(startDate.getUTCDate() - dayOfWeek);

  const today = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const daysDiff = Math.ceil((today.getTime() - startDate.getTime()) / oneDayMs);

  for (let i = 0; i <= daysDiff; i++) {
    const currentDate = new Date(startDate.getTime() + i * oneDayMs);
    const dateStr = currentDate.toISOString().substring(0, 10);
    const count = logsByDate[dateStr] || 0;

    const cell = document.createElement("div");
    cell.className = "heatmap-cell";
    cell.setAttribute("data-date", dateStr);
    cell.setAttribute("data-count", count);

    let background = "var(--border-card)";
    let opacity = "0.4";

    if (count > 0) {
      opacity = "1";
      const maxCount = Math.max(2, Math.round(teamSize * 1.5));
      const ratio = count / maxCount;
      if (ratio <= 0.1)      background = "rgba(99, 102, 241, 0.25)";
      else if (ratio <= 0.3) background = "rgba(99, 102, 241, 0.5)";
      else if (ratio <= 0.6) background = "rgba(99, 102, 241, 0.75)";
      else                   background = "rgba(99, 102, 241, 1)";
    }

    cell.style.backgroundColor = background;
    cell.style.opacity = opacity;
    cell.title = `${dateStr}: ${count} ${label}`;
    grid.appendChild(cell);
  }

  container.appendChild(grid);
}

// ── Badge Wall Renderer ──────────────────────────────────────
/**
 * Render the achievement badge wall into any container.
 * Can be used by both the stats tab and the plan's personal-stats tab.
 *
 * @param {string} containerId - ID of the container element
 */
function renderBadgeWall(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";

  if (typeof ACHIEVEMENTS === "undefined") {
    container.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:1rem;">暫無解鎖勳章</div>`;
    return;
  }

  const unlocked = JSON.parse(localStorage.getItem("unlocked_badges") || "[]");

  ACHIEVEMENTS.forEach(badge => {
    const isUnlocked = unlocked.includes(badge.id);
    const descParsed = badge.description.replace("{streak}", (state.currentUser && state.currentUser.streak) || 0);

    const badgeItem = document.createElement("div");
    badgeItem.className = isUnlocked ? "honor-badge-item unlocked" : "honor-badge-item locked";
    badgeItem.style.cssText = `
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.8rem 1rem;
      background: ${isUnlocked ? "var(--bg-input)" : "rgba(255,255,255,0.05)"};
      border: 1px solid ${isUnlocked ? "var(--border-card)" : "transparent"};
      border-radius: var(--radius-sm);
      opacity: ${isUnlocked ? "1" : "0.45"};
      filter: ${isUnlocked ? "none" : "grayscale(100%)"};
      transition: all 0.3s ease;
      cursor: default;
    `;

    badgeItem.innerHTML = `
      <div style="font-size: 2rem; display: flex; width: 50px; height: 50px; background: ${isUnlocked ? badge.color : "#e2e8f0"}; border-radius: 50%; justify-content: center; align-items: center; box-shadow: ${isUnlocked ? "0 4px 10px " + badge.shadow : "none"}; flex-shrink: 0;">
        ${badge.icon}
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.15rem; min-width: 0;">
        <span style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
          ${badge.title}
          ${isUnlocked ? '<span style="font-size:0.65rem;background:#e0f2fe;color:#0284c7;padding:0.05rem 0.35rem;border-radius:10px;font-weight:800;">已解鎖</span>' : ""}
        </span>
        <span style="font-size: 0.76rem; color: var(--text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${descParsed}</span>
      </div>
    `;

    if (isUnlocked) {
      badgeItem.onmouseenter = () => {
        badgeItem.style.borderColor = "var(--primary-color)";
        badgeItem.style.transform = "translateY(-1px)";
      };
      badgeItem.onmouseleave = () => {
        badgeItem.style.borderColor = "var(--border-card)";
        badgeItem.style.transform = "none";
      };
    }

    container.appendChild(badgeItem);
  });
}
