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

// ── User Avatar (shadcn-inspired: image + initials fallback) ──

function getUserAvatarInitial(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "N";
  return trimmed.charAt(0).toUpperCase();
}

function normalizeAvatarUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return "";
}

function getUserAvatarContext() {
  const name = state.currentUser?.name || "NLC User";
  let avatarUrl = normalizeAvatarUrl(state.currentUser?.avatar_url);

  if (!avatarUrl && typeof auth !== "undefined" && auth.isLoggedIn() && typeof auth._parseJwt === "function") {
    const payload = auth._parseJwt(localStorage.getItem(auth.keys.idToken) || "");
    avatarUrl = normalizeAvatarUrl(payload?.picture);
  }

  return { name, avatarUrl };
}

function resolveUserAvatarContext(done) {
  const base = getUserAvatarContext();
  if (base.avatarUrl) {
    done(base);
    return;
  }

  if (typeof auth !== "undefined" && auth.isLoggedIn()) {
    done(base);
    return;
  }

  if (state.isSupabaseMode && state.supabase?.auth?.getUser) {
    state.supabase.auth.getUser().then(({ data }) => {
      const user = data?.user;
      const avatarUrl = normalizeAvatarUrl(
        user?.user_metadata?.avatar_url || user?.user_metadata?.picture
      );
      done({
        name: state.currentUser?.name || user?.email || "NLC User",
        avatarUrl
      });
    }).catch(() => done(base));
    return;
  }

  done(base);
}

/**
 * Render avatar into a container (header button or profile summary).
 * @param {HTMLElement|null} container
 * @param {{ size?: "header"|"lg"|"sm", name?: string, avatarUrl?: string }} [options]
 */
function renderUserAvatar(container, options) {
  if (!container) return;

  const opts = options || {};
  const ctx = getUserAvatarContext();
  const name = opts.name || ctx.name || "NLC User";
  const avatarUrl = opts.avatarUrl != null ? normalizeAvatarUrl(opts.avatarUrl) : ctx.avatarUrl;
  const initial = getUserAvatarInitial(name);
  const size = opts.size || "sm";
  const sizeClass = size === "header"
    ? " nlc-avatar--header"
    : size === "lg"
      ? " nlc-avatar--lg"
      : " nlc-avatar--sm";

  container.innerHTML = "";
  const root = document.createElement("span");
  root.className = "nlc-avatar" + sizeClass;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", name);

  const fallback = document.createElement("span");
  fallback.className = "nlc-avatar__fallback";
  fallback.textContent = initial;
  root.appendChild(fallback);

  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "nlc-avatar__image";
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.onload = function () {
      img.classList.add("nlc-avatar__image--loaded");
    };
    img.onerror = function () {
      img.remove();
    };
    img.src = avatarUrl;
    root.insertBefore(img, fallback);
  }

  container.appendChild(root);
}

function refreshUserAvatars() {
  resolveUserAvatarContext(function (ctx) {
    renderUserAvatar(document.getElementById("user-avatar-btn"), {
      size: "header",
      name: ctx.name,
      avatarUrl: ctx.avatarUrl
    });
    renderUserAvatar(document.getElementById("profile-summary-avatar"), {
      size: "lg",
      name: ctx.name,
      avatarUrl: ctx.avatarUrl
    });
  });
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
    const assignedRegions = (currentUser.managed_regions || currentUser.great_region || "").split(",").map(s => s.trim()).filter(Boolean);
    return allUsers.filter(u => assignedRegions.includes(u.great_region));
  }
  if (role === "zone_leader") {
    const assignedZones = (currentUser.managed_zones || currentUser.pastoral_zone || "").split(",").map(s => s.trim()).filter(Boolean);
    return allUsers.filter(u => assignedZones.includes(u.pastoral_zone));
  }
  if (role === "group_leader") {
    const assignedGroups = (currentUser.managed_groups || currentUser.small_group || "").split(",").map(s => s.trim()).filter(Boolean);
    return allUsers.filter(u => assignedGroups.includes(u.small_group));
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

const BADGE_UNLOCK_TARGETS = {
  subscribe_plan: 1, streak_30: 1, complete_plan: 1, share_verse: 1, read_all_bible: 10
};

function getCampaignStageCompletedRounds(stageNo) {
  const target = Number(stageNo || 0);
  let completedRounds = Number(localStorage.getItem(`church_stage_completed_rounds_${target}`) || 0);
  (state.activePlans || []).forEach(plan => {
    const planStageNo = Number(plan.stageNo || (plan.campaignDefinition && plan.campaignDefinition.stageNo) || 0);
    if (plan.planKind !== "church_campaign_stage" || planStageNo !== target) return;
    const currentRound = Math.max(1, Number(plan.currentRound || 1));
    const completed = Number(plan.progress || 0) >= 100 ? currentRound : currentRound - 1;
    completedRounds = Math.max(completedRounds, completed);
  });
  return completedRounds;
}

function getCampaignStageCurrentRound(stageNo) {
  const target = Number(stageNo || 0);
  return (state.activePlans || []).reduce((maxRound, plan) => {
    const planStageNo = Number(plan.stageNo || (plan.campaignDefinition && plan.campaignDefinition.stageNo) || 0);
    if (plan.planKind !== "church_campaign_stage" || planStageNo !== target) return maxRound;
    return Math.max(maxRound, Number(plan.currentRound || 1));
  }, 1);
}

function getBadgeMilestoneConfig(badgeId) {
  if (badgeId && badgeId.startsWith("church_stage_award_")) {
    const stageNo = Number(badgeId.replace("church_stage_award_", ""));
    return { levels: [5, 4, 3, 2, 1], unit: "遍", getValue: () => getCampaignStageCompletedRounds(stageNo) };
  }
  const activePlanCount = () => (state.activePlans || []).length;
  const completedPlanCount = () => (state.activePlans || []).filter(plan => Number(plan.progress || 0) >= 100 || Number(plan.currentRound || 1) > 1).length;
  const config = {
    subscribe_plan: { levels: [5, 4, 3, 2, 1], unit: "個計畫", getValue: activePlanCount },
    streak_30: { levels: [30, 21, 14, 7, 1], unit: "天", getValue: () => Number((state.currentUser && state.currentUser.streak) || 0) },
    complete_plan: { levels: [5, 4, 3, 2, 1], unit: "個計畫", getValue: completedPlanCount },
    share_verse: { levels: [50, 25, 10, 5, 1], unit: "次分享", getValue: () => Number(localStorage.getItem("verse_share_count") || (localStorage.getItem("has_shared_verse") === "true" ? 1 : 0)) },
    read_all_bible: { levels: [1189, 800, 500, 100, 10], unit: "章", getValue: () => {
      const uniqueChapters = new Set((state.readingLogs || []).map(log => `${log.book}_${log.chapter}`));
      return uniqueChapters.size;
    }}
  };
  return config[badgeId] || { levels: [5, 4, 3, 2, 1], unit: "次", getValue: () => 0 };
}

function getBadgeProgressValue(badgeId) {
  const conf = getBadgeMilestoneConfig(badgeId);
  return typeof conf.getValue === "function" ? Number(conf.getValue() || 0) : 0;
}

function getBadgeStarState(badge) {
  const conf = getBadgeMilestoneConfig(badge && badge.id);
  const currentValue = getBadgeProgressValue(badge && badge.id);
  const ascendingLevels = [...conf.levels].sort((a, b) => a - b);
  const maxStars = Math.max(1, Math.min(Number((badge && badge.maxStars) || 5), ascendingLevels.length));
  const achievedStars = Math.min(maxStars, ascendingLevels.filter(level => currentValue >= level).length);
  let displayedStars = Math.max(1, achievedStars);
  if (badge && badge.campaignStageNo) {
    displayedStars = Math.min(maxStars, Math.max(1, getCampaignStageCurrentRound(badge.campaignStageNo)));
  }
  return { level: achievedStars, displayedStars, currentValue, levels: ascendingLevels, unit: conf.unit };
}

function renderBadgeStars(badge, compact = false) {
  const starState = getBadgeStarState(badge);
  const stars = Array.from({ length: starState.displayedStars }, (_, index) => {
    const isLit = index < starState.level;
    return `<span class="badge-star ${isLit ? "badge-star--lit" : "badge-star--unlit"}"><span class="nlc-icon" data-icon="${isLit ? "starFill" : "star"}" aria-hidden="true"></span></span>`;
  }).join("");
  return `<span class="badge-stars ${compact ? "badge-stars--compact" : ""}" aria-label="已點亮 ${starState.level} 顆，共顯示 ${starState.displayedStars} 顆">${stars}</span>`;
}

function updateBadgeWallSummary(unlockedCount, total) {
  const summaryEl = document.getElementById("badge-wall-summary");
  if (summaryEl) {
    summaryEl.textContent = `${unlockedCount} / ${total}`;
  }
}

function bindBadgeStripProfileLink() {
  const linkBtn = document.getElementById("dashboard-badge-strip-link");
  if (!linkBtn || linkBtn._badgeStripLinkBound) return;
  linkBtn._badgeStripLinkBound = true;
  linkBtn.addEventListener("click", function (e) {
    e.preventDefault();
    if (typeof window.navigateToBadgeWall === "function") {
      window.navigateToBadgeWall();
    }
  });
}

function attachBadgeOpenHandlers(element, badge, isUnlocked) {
  const openDetail = function () {
    if (typeof window.openBadgeDetailPage === "function") {
      const isDark = state.theme === "dark" || document.body.classList.contains("dark-theme");
      window.openBadgeDetailPage(badge, isUnlocked, isDark);
    }
  };
  element.onclick = openDetail;
  element.onkeydown = function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDetail();
    }
  };
}window.getBadgeTierClass = function(starsCount) {
  if (starsCount === 1) return "tier-bronze";
  if (starsCount === 2) return "tier-silver";
  if (starsCount === 3) return "tier-gold";
  if (starsCount === 4) return "tier-platinum";
  if (starsCount >= 5) return "tier-legendary";
  return "";
};

const CAMPAIGN_MEDAL_FRAME_CLASSES = Array.from({ length: 10 }, (_, index) =>
  `campaign-medal-stage-${index + 1}`
);

function getBadgeFrameClass(badge, starsCount) {
  const stageNo = Number(badge && badge.campaignStageNo || 0);
  if (stageNo >= 1 && stageNo <= CAMPAIGN_MEDAL_FRAME_CLASSES.length) {
    return `campaign-medal-stage-${stageNo}`;
  }
  return typeof window.getBadgeTierClass === "function"
    ? window.getBadgeTierClass(starsCount)
    : "";
}

function renderBadgeWall(containerId) {
  const container = document.getElementById("badges-grid") || document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  const list = window.ACHIEVEMENTS || (typeof ACHIEVEMENTS !== "undefined" ? ACHIEVEMENTS : null);
  if (!list) {
    container.innerHTML = `<div class="badge-wall__empty">暫無徽章</div>`;
    return;
  }
  if (container.id === "badges-grid") {
    updateBadgeWallSummary(list.filter(badge => getBadgeStarState(badge).level > 0).length, list.length);
  }
  const getClasses = typeof getHonorBadgeItemClasses === "function"
    ? getHonorBadgeItemClasses
    : unlocked => (unlocked ? "honor-badge-item unlocked" : "honor-badge-item locked");

  list.forEach(badge => {
    const starState = getBadgeStarState(badge);
    const isUnlocked = starState.level > 0;
    const badgeItem = document.createElement("div");
    badgeItem.className = getClasses(isUnlocked) + " honor-badge-item--tile";
    badgeItem.setAttribute("role", "button");
    badgeItem.setAttribute("tabindex", "0");
    badgeItem.setAttribute("aria-label", (isUnlocked ? "已點亮：" : "尚未點亮：") + badge.title);
    const safeTitle = typeof escapeHTML === "function" ? escapeHTML(badge.title) : badge.title;
    const hexState = isUnlocked ? "honor-badge-hex--unlocked" : "honor-badge-hex--locked";
    const tierClass = getBadgeFrameClass(badge, starState.level);
    badgeItem.innerHTML = `
      ${!isUnlocked ? `<div class="honor-badge-item__lock"><span class="nlc-icon nlc-icon--sm" data-icon="lock" aria-hidden="true"></span></div>` : ""}
      <div class="honor-badge-item__icon-wrap honor-badge-hex-shell">
        <div class="honor-badge-hex ${hexState} ${tierClass}">
          <span class="nlc-icon nlc-icon--md" data-icon="${badge.iconKey || "award"}" aria-hidden="true"></span>
        </div>
        ${isUnlocked ? `<span class="honor-badge-hex__check" aria-hidden="true"><span class="nlc-icon nlc-icon--sm" data-icon="checkCircle"></span></span>` : ""}
      </div>
      <span class="honor-badge-item__title">${safeTitle}</span>
      ${renderBadgeStars(badge)}
    `;
    attachBadgeOpenHandlers(badgeItem, badge, isUnlocked);
    container.appendChild(badgeItem);
  });
  if (typeof hydrateIcons === "function") hydrateIcons(container);
  bindBadgeDetailControls();
}

function renderBadgeStrip(containerId, options) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const opts = options || {};
  container.innerHTML = "";
  const list = window.ACHIEVEMENTS || (typeof ACHIEVEMENTS !== "undefined" ? ACHIEVEMENTS : null);
  if (!list) return;
  if (opts.linkToProfile) bindBadgeStripProfileLink();

  list.forEach(badge => {
    const starState = getBadgeStarState(badge);
    const isUnlocked = starState.level > 0;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "badge-strip__item " + (isUnlocked ? "unlocked" : "locked");
    item.setAttribute("aria-label", (isUnlocked ? "已點亮：" : "尚未點亮：") + badge.title);
    const tierClass = getBadgeFrameClass(badge, starState.level);
    const hexState = isUnlocked ? "honor-badge-hex--unlocked" : "honor-badge-hex--locked";
    item.innerHTML = `
      <span class="honor-badge-hex-shell honor-badge-hex-shell--sm">
        <span class="honor-badge-hex ${hexState} ${tierClass}">
          <span class="nlc-icon nlc-icon--sm" data-icon="${badge.iconKey || "award"}" aria-hidden="true"></span>
        </span>
        ${!isUnlocked ? `<span class="honor-badge-hex__lock" aria-hidden="true"><span class="nlc-icon nlc-icon--sm" data-icon="lock"></span></span>` : ""}
        ${isUnlocked ? `<span class="honor-badge-hex__check" aria-hidden="true"><span class="nlc-icon nlc-icon--sm" data-icon="checkCircle"></span></span>` : ""}
      </span>
      ${renderBadgeStars(badge, true)}
    `;
    attachBadgeOpenHandlers(item, badge, isUnlocked);
    container.appendChild(item);
  });
  if (typeof hydrateIcons === "function") hydrateIcons(container);
}

window.navigateToBadgeWall = function () {
  if (typeof appRouter !== "undefined" && typeof appRouter.switchTab === "function") {
    appRouter.switchTab("profile-view");
  }
  requestAnimationFrame(function () {
    const target = document.getElementById("profile-badges-card-col");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
};

window.renderBadgeStrip = renderBadgeStrip;

window.getBadgeMilestoneConfig = getBadgeMilestoneConfig;
window.getBadgeProgressValue = getBadgeProgressValue;
window.getCampaignStageCompletedRounds = getCampaignStageCompletedRounds;
window.getCampaignStageCurrentRound = getCampaignStageCurrentRound;
window.getBadgeStarState = getBadgeStarState;
window.renderBadgeStars = renderBadgeStars;

// YouVersion high-grade full-screen detail subpage controller
function closeBadgeDetailPage() {
  const page = document.getElementById("badge-detail-page");
  if (!page) return;
  page.classList.add("hidden");
  page.setAttribute("aria-hidden", "true");
  document.body.classList.remove("badge-detail-open");
}

function bindBadgeDetailControls() {
  const backBtn = document.getElementById("badge-page-back-btn");
  if (backBtn && !backBtn._hasBackListener) {
    backBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeBadgeDetailPage();
    });
    backBtn._hasBackListener = true;
  }
}

window.closeBadgeDetailPage = closeBadgeDetailPage;

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
  bindBadgeDetailControls();

  const badgeStarState = getBadgeStarState(badge);
  isUnlocked = badgeStarState.level > 0;

  page.style.background = "";
  page.style.color = "";
  page.style.borderColor = "";
  if (hero) {
    hero.style.background = "";
    hero.style.borderColor = "";
    hero.style.color = "";
  }

  // Render text contents
  const starsText = badgeStarState.level > 0
    ? `（${badgeStarState.level} 顆星）`
    : "（第一顆星待點亮）";
  title.textContent = badge.title + starsText;
  desc.textContent = badge.description;

  const triggerEl = document.getElementById("detail-trigger-text");
  const triggerCard = document.getElementById("detail-trigger-card");
  const triggerCopy = badge.triggerText || badge.description;
  if (triggerEl) {
    triggerEl.textContent = triggerCopy;
  }
  if (triggerCard) {
    triggerCard.classList.toggle("hidden", !triggerCopy);
  }

  if (icon) {
    icon.className = "nlc-icon";
    icon.style.fontSize = "3rem";
    icon.setAttribute("data-icon", badge.iconKey || "award");
    icon.innerHTML = typeof renderIcon === "function"
      ? renderIcon(badge.iconKey || "award", { size: "hero", className: "nlc-icon" })
      : "";
  }

  // Apply Shield styles based on unlock state (theme via CSS)
  if (shield) {
    shield.classList.remove("badge-shield--unlocked", "badge-shield--locked", "holographic-shine");
    shield.classList.add(isUnlocked ? "badge-shield--unlocked" : "badge-shield--locked");
    if (isUnlocked) {
      shield.classList.add("holographic-shine");
    }
    const hexInner = shield.querySelector(".honor-badge-hex");
    if (hexInner) {
      hexInner.classList.remove(
        "honor-badge-hex--unlocked", "honor-badge-hex--locked",
        "tier-bronze", "tier-silver", "tier-gold", "tier-platinum", "tier-legendary",
        ...CAMPAIGN_MEDAL_FRAME_CLASSES
      );
      hexInner.classList.add(isUnlocked ? "honor-badge-hex--unlocked" : "honor-badge-hex--locked");
      const frameClass = getBadgeFrameClass(badge, badgeStarState.level);
      if (frameClass) hexInner.classList.add(frameClass);
    }
    shield.style.background = "";
    shield.style.borderColor = "";
    shield.style.borderStyle = "";
    shield.style.borderWidth = "";
    shield.style.color = "";
  }

  // Dynamic milestone configurations for YouVersion level circles
  const conf = typeof getBadgeMilestoneConfig === "function"
    ? getBadgeMilestoneConfig(badge.id)
    : { levels: [1], unit: "次", getValue: () => (isUnlocked ? 1 : 0) };
  const currentVal = typeof getBadgeProgressValue === "function"
    ? getBadgeProgressValue(badge.id)
    : (typeof conf.getValue === "function" ? conf.getValue() : 0);

  // Determine highest unlocked level
  let highestUnlockedLevel = 0;
  conf.levels.forEach(lvl => {
    if (currentVal >= lvl) {
      highestUnlockedLevel = Math.max(highestUnlockedLevel, lvl);
    }
  });

  // Update star-level display pill
  if (levelPill) {
    levelPill.textContent = `★ ${Math.max(1, badgeStarState.level)}`;
    levelPill.style.display = "block";
    levelPill.classList.toggle("is-unlit", badgeStarState.level === 0);
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
  page.setAttribute("aria-hidden", "false");
  document.body.classList.add("badge-detail-open");
};

// Compatibility aliases
window.openBadgeModal = function(badge, isUnlocked, isDark) {
  window.openBadgeDetailPage(badge, isUnlocked, isDark);
};

window.closeBadgeModal = closeBadgeDetailPage;

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
    // Clear the plan list skeleton so it doesn't persist if user hasn't visited the plan tab yet.
    // renderJoinedPlansList() (called by renderPlanView) will repopulate it with real data.
    const joinedList = document.getElementById("joined-plans-list");
    if (joinedList) joinedList.innerHTML = "";
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
        <div class="skeleton-wrapper announcements-list__skeleton">
          ${Array.from({ length: count || 2 }, () => `
            <div class="skeleton-card announcement-item announcement-item--skeleton">
              ${this._bar("38%", "14px", "4px")}
              ${this._bar("92%", "12px", "4px")}
              ${this._bar("72%", "12px", "4px")}
            </div>
          `).join("")}
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

window.showToast = showToast;
window.getUserAvatarInitial = getUserAvatarInitial;
window.normalizeAvatarUrl = normalizeAvatarUrl;
window.getUserAvatarContext = getUserAvatarContext;
window.resolveUserAvatarContext = resolveUserAvatarContext;
window.renderUserAvatar = renderUserAvatar;
window.refreshUserAvatars = refreshUserAvatars;
window.getIsAdmin = getIsAdmin;
window.getScopedUsers = getScopedUsers;
window.buildHeatmapGrid = buildHeatmapGrid;
window.renderBadgeWall = renderBadgeWall;


// === Moved Plan Helpers ===
function getPlanLevelRounds(level) {
  if (level === "breakthrough") return 2;
  if (level === "super") return 3;
  if (typeof level === "string" && level.startsWith("level")) {
    const num = parseInt(level.substring(5), 10);
    if (!isNaN(num)) return num;
  }
  const num = parseInt(level, 10);
  if (!isNaN(num)) return num;
  return 1;
}

function getPlanLevelLabel(level) {
  if (level === "breakthrough") return "突破";
  if (level === "super") return "興盛";
  if (level === "normal") return "一般";
  const rounds = getPlanLevelRounds(level);
  if (rounds > 3) return `Level ${rounds}`;
  return "一般";
}

function getPlanLevelOrder(level) {
  return getPlanLevelRounds(level);
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
      current_round: plan.currentRound || getPlanLevelOrder(plan.level),
      was_downgraded: !!plan.wasDowngraded,
      downgrade_locked_until: plan.downgradeLockedUntil || null,
      upgrade_prompt_handled: !!plan.upgradePromptHandled
    };
    const { error } = await state.supabase.from("reading_plans").update(payload).eq("id", plan.id);
    if (error) {
      console.warn("Failed to persist downgrade lock column, retrying without it", error);
      await state.supabase.from("reading_plans")
        .update({
          level: plan.level,
          current_round: plan.currentRound || getPlanLevelOrder(plan.level),
          was_downgraded: !!plan.wasDowngraded,
          upgrade_prompt_handled: !!plan.upgradePromptHandled
        })
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
  if (typeof readingDays !== 'number' || isNaN(readingDays) || readingDays <= 0) {
    return [];
  }
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

function normalizePlanScheduleSettings(isFixed, readingDaysPerWeek = 7, restWeekdays = []) {

  const normalizedRestDays = Array.from(new Set((Array.isArray(restWeekdays) ? restWeekdays : [])
    .map(Number)
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)))
    .sort((a, b) => a - b);
  const requestedDays = Math.max(1, Math.min(7, Number(readingDaysPerWeek) || 7));

  if (normalizedRestDays.length !== 7 - requestedDays) {
    return { readingDaysPerWeek: 7 - normalizedRestDays.length, restWeekdays: normalizedRestDays };
  }

  return { readingDaysPerWeek: requestedDays, restWeekdays: normalizedRestDays };
}

function rebuildPlanScheduleForLevel(plan, level) {
  if (!plan) return plan;
  const rebuilt = generatePlanObject(
    plan.name,
    plan.startDate,
    plan.endDate,
    plan.target_books || plan.targetBooks || [],
    plan.presetKey,
    level,
    plan.isFixed !== false && plan.is_fixed !== false,
    {
      readingDaysPerWeek: plan.readingDaysPerWeek || plan.reading_days_per_week,
      restWeekdays: plan.restWeekdays || plan.rest_weekdays
    }
  );
  Object.assign(plan, {
    totalDays: rebuilt.totalDays,
    totalChapters: rebuilt.totalChapters,
    days: rebuilt.days,
    level,
    currentRound: getPlanLevelOrder(level),
    target_books: plan.target_books || rebuilt.target_books,
    targetBooks: plan.targetBooks || rebuilt.targetBooks,
    isFixed: rebuilt.isFixed,
    is_fixed: rebuilt.is_fixed,
    readingDaysPerWeek: rebuilt.readingDaysPerWeek,
    reading_days_per_week: rebuilt.reading_days_per_week,
    restWeekdays: rebuilt.restWeekdays,
    rest_weekdays: rebuilt.rest_weekdays
  });
  return plan;
}
function resolveChurchCampaignDefinition(presetKey, name) {
  const globalPlan = (state.globalPlans || []).find(plan =>
    plan.id === presetKey
    || plan.globalPlanId === presetKey
    || plan.presetKey === presetKey
    || (["church_campaign", "church_campaign_stage"].includes(plan.planKind) && plan.name === name)
  );
  if (globalPlan && ["church_campaign", "church_campaign_stage"].includes(globalPlan.planKind)) {
    return window.cloneChurchCampaign(globalPlan.campaignDefinition || window.CHURCH_CAMPAIGN);
  }
  if (presetKey === window.CHURCH_CAMPAIGN_PRESET_KEY || presetKey === window.CHURCH_CAMPAIGN_ID) {
    return window.cloneChurchCampaign();
  }
  const preset = presetKey && CHURCH_PLAN_PRESETS[presetKey];
  if (preset && preset.planKind === "church_campaign_stage") {
    return window.cloneChurchCampaign(preset.campaignDefinition);
  }
  const stage = window.createChurchCampaignStageDefinitions().find(item =>
    item.id === presetKey || item.presetKey === presetKey || item.name === name
  );
  return stage ? window.cloneChurchCampaign(stage) : null;
}

function generateChurchCampaignPlanObject(definition, presetKey, scheduleSettings = null) {
  const weeklySchedule = normalizePlanScheduleSettings(
    false,
    scheduleSettings && scheduleSettings.readingDaysPerWeek,
    scheduleSettings && scheduleSettings.restWeekdays
  );
  const days = window.buildChurchCampaignDays(definition, BIBLE_BOOKS, weeklySchedule.restWeekdays);
  days.forEach(day => {
    day.chapters.forEach(chapter => {
      chapter.key = chapter.book + "_" + chapter.chapter + "_" + (chapter.round || 1);
    });
  });
  const targetBooks = Array.from(new Set(definition.segments.flatMap(segment =>
    segment.readings.map(reading => reading.book)
  )));
  const totalChapters = days.reduce((sum, day) => sum + day.chapters.length, 0);
  return {
    name: definition.name,
    description: definition.description || "",
    startDate: definition.startDate,
    endDate: definition.endDate,
    totalDays: days.length,
    totalChapters,
    currentRoundTotalChapters: totalChapters,
    completedChapters: 0,
    progress: 0,
    days,
    presetKey,
    target_books: targetBooks,
    targetBooks,
    level: "normal",
    currentRound: 1,
    wasDowngraded: false,
    isFixed: true,
    is_fixed: true,
    planKind: "church_campaign",
    campaignDefinition: window.cloneChurchCampaign(definition),
    campaignStages: definition.stages,
    campaignRules: definition.rules,
    ruleVersion: Number(definition.version || 1),
    readingDaysPerWeek: weeklySchedule.readingDaysPerWeek,
    reading_days_per_week: weeklySchedule.readingDaysPerWeek,
    restWeekdays: weeklySchedule.restWeekdays,
    rest_weekdays: weeklySchedule.restWeekdays
  };
}

function generatePlanObject(name, startDate, endDate, selectedBooks, presetKey = null, level = "normal", isFixed = true, scheduleSettings = null) {
  const preset = presetKey ? CHURCH_PLAN_PRESETS[presetKey] : null;
  const campaignDefinition = resolveChurchCampaignDefinition(presetKey, name);
  const weeklySchedule = normalizePlanScheduleSettings(
    isFixed,
    scheduleSettings && scheduleSettings.readingDaysPerWeek,
    scheduleSettings && scheduleSettings.restWeekdays
  );
  if (campaignDefinition) {
    return generateChurchCampaignPlanObject(
      campaignDefinition,
      presetKey || window.CHURCH_CAMPAIGN_PRESET_KEY,
      weeklySchedule
    );
  }
  const restWeekdaySet = new Set(weeklySchedule.restWeekdays);

  // 1. Calculate parseLocalDate
  const parseLocalDate = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') {
      return new Date();
    }
    const parts = dateStr.split('-');
    if (parts.length < 3) {
      return new Date();
    }
    const [year, month, day] = parts.map(Number);
    return new Date(year, month - 1, day);
  };
  const start = parseLocalDate(startDate || '');
  const end = parseLocalDate(endDate || '');
  const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  // 2. If level is normal AND it is a preset plan, use the original month-by-month calendar grid
  if (isFixed && level === "normal" && preset && preset.months) {
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

    const planStart = parseLocalDate(startDate || preset.startDate);
    days.forEach((day, index) => {
      const dayDate = new Date(planStart);
      dayDate.setDate(planStart.getDate() + index);
      const mm = String(dayDate.getMonth() + 1).padStart(2, '0');
      const dd = String(dayDate.getDate()).padStart(2, '0');
      day.date = `${mm}/${dd}`;
      day.year = dayDate.getFullYear();
      day.month = dayDate.getMonth() + 1;
    });

    return {
      name: preset.name,
      startDate: startDate || preset.startDate,
      endDate: endDate || preset.endDate,
      totalDays: days.length,
      totalChapters: totalChaptersCount,
      completedChapters: 0,
      progress: 0,
      days,
      presetKey,
      target_books: selectedBooks,
      targetBooks: selectedBooks,
      level,
      currentRound: 1,
      wasDowngraded: false,
      isFixed,
      is_fixed: isFixed,
      readingDaysPerWeek: weeklySchedule.readingDaysPerWeek,
      reading_days_per_week: weeklySchedule.readingDaysPerWeek,
      restWeekdays: weeklySchedule.restWeekdays,
      rest_weekdays: weeklySchedule.restWeekdays
    };
  }

  // 3. Otherwise (custom plans, or upgraded preset plans), use the new segmented round-distribution logic!
  const allChapters = [];
  const booksToUse = (preset && preset.months ? preset.months.flatMap(m => m.books) : selectedBooks) || [];
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

  // Calculate round completion days dynamically from reading logs
  const maxRounds = getPlanLevelRounds(level);
  const roundCompletionDays = []; // index 0 for round 1, index 1 for round 2, etc. (up to maxRounds-1)

  for (let r = 1; r < maxRounds; r++) {
    const roundLogs = (state.readingLogs || []).filter(l => (l.round || 1) === r);
    let d_r = null;
    if (roundLogs.length > 0) {
      const maxDateStr = roundLogs.reduce((max, log) => log.read_at > max ? log.read_at : max, roundLogs[0].read_at);
      const maxDate = new Date(maxDateStr.substring(0, 10));
      maxDate.setHours(0, 0, 0, 0);
      start.setHours(0, 0, 0, 0);
      d_r = Math.max(1, Math.floor((maxDate - start) / (1000 * 60 * 60 * 24)) + 1);
      const prevD = r > 1 ? roundCompletionDays[r - 2] : 0;
      d_r = Math.max(d_r, prevD + 1);
      d_r = Math.min(d_r, totalDays - (maxRounds - r));
    } else {
      const prevD = r > 1 ? roundCompletionDays[r - 2] : 0;
      d_r = Math.floor(prevD + (totalDays - prevD) / (maxRounds - r + 1));
    }
    roundCompletionDays.push(d_r);
  }

  let dailyChapters = Array.from({ length: totalDays }, () => []);
  const allEligibleOffsets = Array.from({ length: totalDays }, (_, index) => index)
    .filter(dayOffset => {
      const date = new Date(start);
      date.setDate(start.getDate() + dayOffset);
      return !restWeekdaySet.has(date.getDay());
    });

  for (let r = 1; r <= maxRounds; r++) {
    const roundChapters = allChapters.map(ch => ({ ...ch, round: r }));
    const roundStartDay = r > 1 ? roundCompletionDays[r - 2] : 0;
    const roundEndDay = r < maxRounds ? roundCompletionDays[r - 1] : totalDays;
    const calendarOffsets = Array.from(
      { length: Math.max(0, roundEndDay - roundStartDay) },
      (_, index) => roundStartDay + index
    );
    const eligibleOffsets = calendarOffsets.filter(dayOffset => allEligibleOffsets.includes(dayOffset));
    const readingOffsets = eligibleOffsets.length > 0 ? eligibleOffsets : allEligibleOffsets;

    if (readingOffsets.length > 0) {
      const rDaily = distributeChaptersAcrossDays(roundChapters, readingOffsets.length);
      for (let i = 0; i < readingOffsets.length; i++) {
        const dayOffset = readingOffsets[i];
        dailyChapters[dayOffset] = dailyChapters[dayOffset].concat(rDaily[i]);
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
      isRestDay: restWeekdaySet.has(dayDate.getDay()),
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
    wasDowngraded: false,
    isFixed,
    is_fixed: isFixed,
    readingDaysPerWeek: weeklySchedule.readingDaysPerWeek,
    reading_days_per_week: weeklySchedule.readingDaysPerWeek,
    restWeekdays: weeklySchedule.restWeekdays,
    rest_weekdays: weeklySchedule.restWeekdays
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
  if (plan.isFixed === false || plan.is_fixed === false) return true;
  const todayStr = new Date().toISOString().split('T')[0];
  return todayStr >= plan.startDate;
}

function isPlanExpired(plan) {
  if (!plan || !plan.endDate) return false;
  if (plan.isFixed === false || plan.is_fixed === false) return false;
  const todayStr = new Date().toISOString().split('T')[0];
  return todayStr > plan.endDate;
}

function calculateAllPlansProgress() {
  const visibleActivePlans = getVisiblePlans(state.activePlans || []);

  if (visibleActivePlans.length === 0) {
    state.activePlan = null;
    return;
  }

  visibleActivePlans.forEach(plan => {
    // 💡 數據一致性修正：直接從打卡日誌計算實際讀過的最大遍數
    let maxReadRound = plan.currentRound || 1;
    if (state.readingLogs) {
      state.readingLogs.forEach(l => {
        const logPlanId = l.plan_id || null;
        const logPresetKey = l.presetKey || l.preset_key || null;
        const isPlanMatch =
          (plan.id && logPlanId && logPlanId === plan.id) ||
          (plan.presetKey && logPresetKey && logPresetKey === plan.presetKey) ||
          ((plan.id || plan.presetKey) && !logPlanId && !logPresetKey) ||
          (!plan.id && !plan.presetKey && !logPlanId && !logPresetKey);
        
        if (isPlanMatch) {
          maxReadRound = Math.max(maxReadRound, l.round || 1);
        }
      });
    }

    const currentLevelOrder = getPlanLevelOrder(plan.level || "normal");
    if (maxReadRound > currentLevelOrder) {
      let newLevel = "normal";
      if (maxReadRound === 2) newLevel = "breakthrough";
      else if (maxReadRound === 3) newLevel = "super";
      else newLevel = "level" + maxReadRound;

      console.log(`[進度校正] 偵測到使用者已讀到第 ${maxReadRound} 遍，但計畫等級為 ${plan.level || "normal"}。自動修正等級為 ${newLevel}。`);
      plan.level = newLevel;
      plan.currentRound = maxReadRound;
      // 異步儲存到資料庫/localStorage，避免資料不一致
      if (typeof persistPlanLevelState === "function") {
        persistPlanLevelState(plan).catch(console.error);
      } else {
        if (!state.isSupabaseMode) localStorage.setItem("active_reading_plans", JSON.stringify(state.activePlans || []));
      }
    }

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

        const totalRounds = Math.max(plan.currentRound || 1, maxReadRound || 1, 3);
        for (let r = 1; r <= totalRounds; r++) {
          ch[`isReadR${r}`] = checkRoundLog(r);
        }

        const targetRound = ch.round || plan.currentRound || 1;
        const isRead = Boolean(ch["isReadR" + targetRound]);
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

    // Calculate current round progress dynamically
    const currentRoundTotal = plan.days.reduce((sum, day) => {
      return sum + ((day.chapters || []).filter(ch => (ch.round || 1) === plan.currentRound).length);
    }, 0) || plan.totalChapters;
    const currentRoundCompleted = plan.days.reduce((sum, day) => {
      const isCompleted = (ch) => {
        return Boolean(ch["isReadR" + plan.currentRound]);
      };
      return sum + ((day.chapters || []).filter(ch => (ch.round || 1) === plan.currentRound && isCompleted(ch)).length);
    }, 0);

    plan.currentRoundTotalChapters = currentRoundTotal;
    plan.completedChapters = currentRoundCompleted;

    const isCurrentRoundCompleted = currentRoundTotal > 0 && currentRoundCompleted >= currentRoundTotal;
    plan.progress = isCurrentRoundCompleted
      ? 100
      : (Math.round((currentRoundCompleted / currentRoundTotal) * 100) || 0);

    if (!plan.isPlanCompleted) plan.upgradePromptHandled = false;

    // Track second-round completion for the round-2 → round-3 upgrade prompt
    const secondRoundChapters = plan.days.reduce((sum, day) => {
      return sum + ((day.chapters || []).filter(ch => (ch.round || 1) === 2).length);
    }, 0);
    const secondRoundCompleted = plan.days.reduce((sum, day) => {
      return sum + ((day.chapters || []).filter(ch => (ch.round || 1) === 2 && ch.isReadR2).length);
    }, 0);
    plan.isRound2Completed = secondRoundChapters > 0 && secondRoundCompleted >= secondRoundChapters;
    if (!plan.isRound2Completed) plan.round2UpgradePromptHandled = false;

    // Clear downgrade lock in memory if the current round is completed
    if (isCurrentRoundCompleted) {
      plan.wasDowngraded = false;
      plan.downgradeLockedUntil = null;
    }
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

// ── Admin Nav Visibility ─────────────────────────────────────
// Defined here (in utils.js, which loads early) so db.init() and other
// early callers don't have to wait for profile.js to lazy-load.
function updateAdminNavVisibility() {
  const isRealAdmin = !state.isSupabaseMode || (state.realRole === 'admin' || state.realRole === 'senior_pastor');
  const isSimulatedAdmin = state.currentUser && (state.currentUser.role === 'admin' || state.currentUser.role === 'senior_pastor');
  const shouldShowNav = isRealAdmin && isSimulatedAdmin;

  document.querySelectorAll('.admin-only-nav').forEach(btn => {
    btn.classList.toggle('hidden', !shouldShowNav);
  });

  document.querySelectorAll('.admin-only-plan-card').forEach(card => {
    card.classList.toggle('hidden', !shouldShowNav);
  });
}

window.getPlanLevelRounds = getPlanLevelRounds;
window.getPlanLevelLabel = getPlanLevelLabel;
window.getPlanLevelOrder = getPlanLevelOrder;
window.addDaysIso = addDaysIso;
window.getDowngradeLockedUntil = getDowngradeLockedUntil;
window.isPlanUpgradeLocked = isPlanUpgradeLocked;
window.formatLockDate = formatLockDate;
window.persistPlanLevelState = persistPlanLevelState;
window.expandChaptersForLevel = expandChaptersForLevel;
window.distributeChaptersAcrossDays = distributeChaptersAcrossDays;
window.rebuildPlanScheduleForLevel = rebuildPlanScheduleForLevel;
window.generatePlanObject = generatePlanObject;
window.normalizePlanScheduleSettings = normalizePlanScheduleSettings;
window.calculatePlanProgress = calculatePlanProgress;
window.isPlanStarted = isPlanStarted;
window.isPlanExpired = isPlanExpired;
window.calculateAllPlansProgress = calculateAllPlansProgress;
window.getHiddenPlanKeys = getHiddenPlanKeys;
window.isPlanHidden = isPlanHidden;
window.canManageHiddenPlans = canManageHiddenPlans;
window.getVisiblePlans = getVisiblePlans;
window.updateAdminNavVisibility = updateAdminNavVisibility;
