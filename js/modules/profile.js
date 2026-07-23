import { isLocalhostGoogleLoginAllowed, showToast } from "./utils.js";

function getMemberHubUrls() {
  if (typeof auth !== "undefined" && typeof auth.getMemberHubUrl === "function") {
    return {
      home: auth.getMemberHubUrl(""),
      structure: auth.getMemberHubUrl("pastoral/structure")
    };
  }
  return {
    home: "https://member.newlife.org.tw",
    structure: "https://member.newlife.org.tw/pastoral/structure"
  };
}

function isMemberHubManagedProfile() {
  return typeof auth !== "undefined" &&
    typeof auth.isMemberHubSession === "function" &&
    auth.isMemberHubSession();
}

function userNeedsOrgSetup() {
  const user = state.currentUser || {};
  return !String(user.great_region || "").trim() &&
    !String(user.pastoral_zone || "").trim() &&
    !String(user.small_group || "").trim();
}

function openMemberHubStructure() {
  scheduleProfileSyncOnReturn();
  if (typeof auth !== "undefined" && typeof auth.openMemberHub === "function") {
    auth.openMemberHub("pastoral/structure");
    return;
  }
  window.open(getMemberHubUrls().structure, "_blank", "noopener,noreferrer");
}

function scheduleProfileSyncOnReturn() {
  if (typeof document === "undefined" || document._nlcHubVisibilityBound) return;
  document._nlcHubVisibilityBound = true;
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (typeof auth === "undefined" || !auth.isLoggedIn()) return;
    if (typeof db === "undefined" || typeof db.syncNlcSessionWithSupabase !== "function") return;
    db.syncNlcSessionWithSupabase(true).then(function () {
      if (typeof renderProfileView === "function") renderProfileView();
      if (typeof renderMemberHubProfileLinks === "function") renderMemberHubProfileLinks();
    }).catch(function (err) {
      console.warn("Profile sync after Member Hub return failed:", err);
    });
  });
}

function renderMemberHubProfileLinks() {
  const copy = (window.APP_COPY && window.APP_COPY.memberHub) || {};
  const urls = getMemberHubUrls();
  const needsOrg = userNeedsOrgSetup();
  const hubManaged = isMemberHubManagedProfile();
  const lockedFields = new Set(state.profileLockedFields || []);
  const hasLockedIdentity = ["name", "great_region", "pastoral_zone", "small_group"]
    .some(function (field) { return lockedFields.has(field); });

  const structureEl = document.getElementById("btn-member-hub-structure");
  const homeEl = document.getElementById("btn-member-hub-home");
  const avatarHubEl = document.getElementById("btn-avatar-member-hub");
  if (structureEl) structureEl.href = urls.structure;
  if (homeEl) homeEl.href = urls.home;
  if (avatarHubEl) avatarHubEl.href = urls.structure;

  [structureEl, homeEl, avatarHubEl].forEach(function (linkEl) {
    if (!linkEl || linkEl._hubSyncBound) return;
    linkEl._hubSyncBound = true;
    linkEl.addEventListener("click", function () {
      scheduleProfileSyncOnReturn();
    });
  });

  const card = document.getElementById("profile-member-hub-card");
  const descEl = document.getElementById("profile-member-hub-desc");
  const titleEl = document.getElementById("profile-member-hub-title");
  const primaryLabel = document.getElementById("profile-member-hub-primary-label");
  if (titleEl) titleEl.textContent = copy.cardTitle || "新生命會員中心";
  if (descEl) {
    descEl.textContent = needsOrg
      ? (copy.cardBodyNeedsOrg || descEl.textContent)
      : (copy.cardBody || descEl.textContent);
  }
  if (primaryLabel) primaryLabel.textContent = copy.manageStructure || "管理身份與牧區歸屬";
  if (card) card.classList.toggle("member-hub-profile-card--needs-org", needsOrg);

  const formNotice = document.getElementById("profile-member-hub-form-notice");
  const formNoticeText = document.getElementById("profile-member-hub-form-notice-text");
  if (formNotice) formNotice.classList.toggle("hidden", !hubManaged && !hasLockedIdentity);
  if (formNoticeText) {
    formNoticeText.textContent = copy.formNotice || formNoticeText.textContent;
  }

  const formNoticeBtn = document.getElementById("btn-member-hub-form-notice");
  if (formNoticeBtn && !formNoticeBtn._hubBound) {
    formNoticeBtn._hubBound = true;
    formNoticeBtn.addEventListener("click", function (e) {
      e.preventDefault();
      openMemberHubStructure();
    });
  }

  const summaryOrg = document.getElementById("profile-summary-org");
  if (summaryOrg && needsOrg) {
    const label = (copy.orgUnset || "未設定所屬小組") + " · " + (copy.orgSetupCta || "前往會員中心設定");
    summaryOrg.innerHTML = `<button type="button" class="profile-summary-org-link" id="profile-org-setup-link">${label}</button>`;
    const setupLink = document.getElementById("profile-org-setup-link");
    if (setupLink && !setupLink._hubBound) {
      setupLink._hubBound = true;
      setupLink.addEventListener("click", function (e) {
        e.preventDefault();
        openMemberHubStructure();
      });
    }
  }

  const btnProfile = document.getElementById("btn-avatar-profile");
  if (btnProfile && copy.profileSettings) {
    btnProfile.innerHTML = `<span class="nlc-icon nlc-icon--sm" data-icon="setting" aria-hidden="true" style="margin-right: 0.4rem;"></span>${copy.profileSettings}`;
  }
  if (avatarHubEl && copy.dropdownLabel) {
    avatarHubEl.innerHTML = `<span class="nlc-icon nlc-icon--sm" data-icon="layers" aria-hidden="true" style="margin-right: 0.4rem;"></span>${copy.dropdownLabel}`;
  }

  const btnToggle = document.getElementById("btn-toggle-profile-form");
  const formWrapper = document.getElementById("profile-form-wrapper");
  if (btnToggle && hubManaged && formWrapper && formWrapper.classList.contains("hidden")) {
    btnToggle.innerHTML = typeof iconLabel === "function"
      ? iconLabel("setting", copy.profileSettings || "帳號設定（本 app）")
      : (copy.profileSettings || "帳號設定（本 app）");
  }

  if (typeof hydrateIcons === "function") {
    [card, formNotice, summaryOrg, btnProfile, avatarHubEl, btnToggle].forEach(function (el) {
      if (el) hydrateIcons(el);
    });
  }
}

function updateGoogleLoginVisibility() {
  const allowGoogle = isLocalhostGoogleLoginAllowed();
  ["btn-google-login", "btn-gate-google-login"].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.style.display = allowGoogle ? "inline-flex" : "none";
    btn.disabled = !allowGoogle;
  });
}


function getProfileStatsPlan(planId) {
  if (typeof window.findPlanByContextId === "function") {
    const found = window.findPlanByContextId(planId);
    if (found) return found;
  }
  if (!planId) return state.activePlan || null;
  return (state.activePlans || []).find(plan =>
    plan.id === planId ||
    plan.globalPlanId === planId ||
    plan.presetKey === planId
  ) || state.activePlan || null;
}

function planLogMatches(log, plan) {
  if (!plan) return false;
  return (plan.id && log.plan_id && log.plan_id === plan.id) ||
    (plan.globalPlanId && log.plan_id && log.plan_id === plan.globalPlanId) ||
    (plan.presetKey && log.presetKey && log.presetKey === plan.presetKey) ||
    (!log.plan_id && !log.presetKey);
}

function countUniqueCompletedChapters(plan) {
  const unique = new Set();
  (state.readingLogs || []).forEach(log => {
    if (!planLogMatches(log, plan)) return;
    unique.add(`${log.book}_${log.chapter}_${log.round || 1}`);
  });
  return unique.size;
}

function countCompletedPlanDays(plan) {
  if (!plan || !Array.isArray(plan.days)) return 0;
  const logs = state.readingLogs || [];
  return plan.days.filter(day => {
    if (!Array.isArray(day.chapters) || day.chapters.length === 0) return false;
    return day.chapters.every(ch => {
      if (ch.isRead || ch.isReadR1 || ch.isReadR2 || ch.isReadR3) return true;
      return logs.some(log => planLogMatches(log, plan) && log.book === ch.book && Number(log.chapter) === Number(ch.chapter));
    });
  }).length;
}

function calculatePlanDayDelta(plan, completedChapters) {
  if (!plan || !Array.isArray(plan.days) || !plan.startDate) {
    return { label: "\u9032\u5ea6\u4e00\u81f4", value: "0", tone: "brand" };
  }
  const start = new Date(plan.startDate);
  const today = new Date();
  start.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const elapsedCalendarDays = Math.max(0, Math.min(plan.days.length, Math.floor((today - start) / 86400000) + 1));
  const elapsedDays = plan.days
    .slice(0, elapsedCalendarDays)
    .filter(day => Array.isArray(day.chapters) && day.chapters.length > 0)
    .length;

  let equivalentDay = 0;
  let scheduledChapters = 0;
  const readingDays = plan.days.filter(day => Array.isArray(day.chapters) && day.chapters.length > 0);
  for (let i = 0; i < readingDays.length; i++) {
    scheduledChapters += readingDays[i].chapters.length;
    if (completedChapters >= scheduledChapters) equivalentDay = i + 1;
    else break;
  }

  const diff = equivalentDay - elapsedDays;
  if (diff > 0) return { label: "\u8d85\u524d\u5929\u6578", value: String(diff), tone: "success" };
  if (diff < 0) return { label: "\u843d\u5f8c\u5929\u6578", value: String(Math.abs(diff)), tone: "danger" };
  return { label: "\u9032\u5ea6\u4e00\u81f4", value: "0", tone: "brand" };
}

function getCountdownDays(plan) {
  if (!plan || !plan.endDate) return 0;
  const end = new Date(plan.endDate);
  const today = new Date();
  end.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((end - today) / 86400000));
}

function renderProfilePersonalStatsEmpty(message) {
  const container = document.getElementById("profile-personal-stats-container");
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state" style="grid-column: 1 / -1; text-align:center; padding: 1.75rem 1rem; color: var(--text-muted);">
      <p style="margin:0; font-weight: 650; color: var(--text-primary);">${message}</p>
    </div>
  `;
}

function renderProfileStatCard({ primary = false, value, unit, label, icon, tone = "brand" }) {
  return `
    <div class="bento-card ${primary ? "profile-stat-card--primary stat-card--primary" : ""}">
      <div class="profile-stat-card__meta">
        <div class="profile-stat-card__value">${value}<span class="profile-stat-card__unit">${unit}</span></div>
        <span class="stat-bento__icon-wrap stat-bento__icon-wrap--${tone}"><span class="nlc-icon" data-icon="${icon}" aria-hidden="true"></span></span>
      </div>
      <span class="profile-stat-card__label">${label}</span>
    </div>
  `;
}

export async function fetchAndRenderPersonalStats(planId) {
  const container = document.getElementById("profile-personal-stats-container");
  if (!container) return;

  if (!planId && typeof window.syncActivePlanContext === "function") {
    planId = window.syncActivePlanContext();
  }

  let plan = getProfileStatsPlan(planId);
  if (!plan && typeof db !== "undefined" && typeof db.loadUserData === "function") {
    try {
      await db.loadUserData(true);
      if (typeof window.syncActivePlanContext === "function") planId = window.syncActivePlanContext();
      plan = getProfileStatsPlan(planId);
    } catch (err) {
      console.warn("Failed to reload plan context for profile stats:", err);
    }
  }

  if (!plan) {
    renderProfilePersonalStatsEmpty("\u5c1a\u672a\u52a0\u5165\u8b80\u7d93\u8a08\u756b");
    return;
  }

  if (typeof window.syncActivePlanContext === "function") window.syncActivePlanContext(plan);

  const planNameEl = document.getElementById("profile-personal-stats-plan-name");
  if (planNameEl) planNameEl.textContent = plan.name || "\u76ee\u524d\u8a08\u756b";

  const totalChapters = countUniqueCompletedChapters(plan);
  const completedDays = countCompletedPlanDays(plan);
  const streakDays = state.currentUser.highest_streak || state.currentUser.best_streak || state.currentUser.streak || 0;
  const delta = calculatePlanDayDelta(plan, totalChapters);
  const countdownDays = getCountdownDays(plan);

  container.innerHTML = `
    ${renderProfileStatCard({ primary: true, value: totalChapters, unit: "\u7ae0", label: "\u7d2f\u7a4d\u95b1\u8b80\u7ae0\u6578", icon: "bookOpen", tone: "brand" })}
    ${renderProfileStatCard({ value: streakDays, unit: "\u5929", label: "\u6700\u9ad8\u9023\u7e8c", icon: "fire", tone: "warning" })}
    ${renderProfileStatCard({ value: completedDays, unit: "\u5929", label: "\u7d2f\u8a08\u5b8c\u6210", icon: "calendarCheck", tone: "success" })}
    ${renderProfileStatCard({ value: delta.value, unit: "\u5929", label: delta.label, icon: delta.tone === "danger" ? "hourglass" : "trendTwo", tone: delta.tone })}
    ${renderProfileStatCard({ value: countdownDays, unit: "\u5929", label: "\u5012\u6578\u5929\u6578", icon: "calendar", tone: "neutral" })}
  `;

  if (typeof hydrateIcons === "function") hydrateIcons(container);
}
export async function renderProfileView() {
  await fetchAndRenderPersonalStats(window.currentActivePlanId);
  if (typeof renderBadgeWall === "function") {
    renderBadgeWall("badges-grid");
  }
  const lockedFields = new Set(state.profileLockedFields || []);
  const profileNameInput = document.getElementById("profile-name");
  if (profileNameInput) {
    profileNameInput.value = state.currentUser.name || "";
    profileNameInput.readOnly = lockedFields.has("name");
    profileNameInput.classList.toggle("readonly-field", lockedFields.has("name"));
    profileNameInput.title = lockedFields.has("name") ? "此欄位由教會系統提供，不可編輯" : "";
  }

  const profileEmailInput = document.getElementById("profile-email");
  if (profileEmailInput) {
    profileEmailInput.value = state.currentUser.email || "";
  }
  
  const greatRegionSelect = document.getElementById("profile-great-region");
  const customGreatRegionInput = document.getElementById("profile-great-region-custom");
  const zoneSelect = document.getElementById("profile-zone");
  const customZoneInput = document.getElementById("profile-zone-custom");
  const groupSelect = document.getElementById("profile-group");
  const customGroupInput = document.getElementById("profile-group-custom");
  const roleDisplay = document.getElementById("profile-role-display");

  if (customGreatRegionInput) customGreatRegionInput.classList.add("hidden");
  if (customZoneInput) customZoneInput.classList.add("hidden");
  if (customGroupInput) customGroupInput.classList.add("hidden");

  const roleNames = {
    member: "一般組員",
    group_leader: "小組長",
    zone_leader: "區長 (牧區負責人)",
    great_zone_leader: "大區長",
    admin: "系統管理員"
  };

  if (roleDisplay) {
    roleDisplay.textContent = roleNames[state.currentUser.role] || "一般組員";
  }

  const summaryName = document.getElementById("profile-summary-name");
  if (summaryName) summaryName.textContent = state.currentUser.name || "新使用者";

  const summaryOrg = document.getElementById("profile-summary-org");
  if (summaryOrg) {
    const region = state.currentUser.great_region || "";
    const zone = state.currentUser.pastoral_zone || "";
    const group = state.currentUser.small_group || "";
    summaryOrg.textContent = [region, zone, group].filter(Boolean).join(" / ") || "未設定所屬小組";
  }

  const summaryRole = document.getElementById("profile-summary-role");
  if (summaryRole) {
    summaryRole.textContent = roleNames[state.currentUser.role] || "一般組員";
  }

  if (typeof refreshUserAvatars === "function") {
    refreshUserAvatars();
  }

  const urlParams = new URLSearchParams(window.location.search);
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '::1' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.') || window.location.hostname.startsWith('172.') || window.location.hostname.endsWith('.local');
  const forceOfflineDemo = isLocalhost && (urlParams.get("demo") === "true" || urlParams.get("offline") === "true");
  const showDemoData = (forceOfflineDemo && typeof MockStatsService !== 'undefined' && MockStatsService !== null) || (state.currentUser && !!state.currentUser.is_demo);

  let greatRegionsList = (state.orgStructure && state.orgStructure.regions && state.orgStructure.regions.length > 0) 
    ? state.orgStructure.regions 
    : ["東區", "南區", "西區", "北區", "青少年", "慶典", "創藝"];
  
  if (!showDemoData) {
    greatRegionsList = greatRegionsList.filter(r => !r.startsWith("示範"));
  }
  
  greatRegionSelect.innerHTML = `<option value="">-- 請選擇大區 --</option>`;
  greatRegionsList.forEach(rName => {
    const option = document.createElement("option");
    option.value = rName;
    option.textContent = rName;
    greatRegionSelect.appendChild(option);
  });
  
  const userGreatRegion = state.currentUser.great_region;

  if (userGreatRegion && userGreatRegion !== "custom" && !greatRegionsList.includes(userGreatRegion)) {
    const tempOpt = document.createElement("option");
    tempOpt.value = userGreatRegion;
    tempOpt.textContent = userGreatRegion;
    greatRegionSelect.appendChild(tempOpt);
  }

  const customRegionOpt = document.createElement("option");
  customRegionOpt.value = "custom";
  customRegionOpt.textContent = "自訂大區...";
  greatRegionSelect.appendChild(customRegionOpt);

  greatRegionSelect.value = userGreatRegion || "";

  populateProfileZones(greatRegionSelect.value, true);
  populateProfileGroupSelector(true);

  const applyProfileFieldLocks = () => {
    const lockTitle = "\u6b64\u6b04\u4f4d\u7531\u6559\u6703\u7cfb\u7d71\u63d0\u4f9b\uff0c\u4e0d\u53ef\u7de8\u8f2f";
    const controls = [
      [greatRegionSelect, customGreatRegionInput, "great_region"],
      [zoneSelect, customZoneInput, "pastoral_zone"],
      [groupSelect, customGroupInput, "small_group"]
    ];
    controls.forEach(([selectEl, customEl, field]) => {
      const locked = lockedFields.has(field);
      if (selectEl) {
        selectEl.disabled = locked;
        selectEl.title = locked ? lockTitle : "";
        selectEl.classList.toggle("readonly-field", locked);
      }
      if (customEl) {
        customEl.readOnly = locked;
        customEl.disabled = locked;
        customEl.title = locked ? lockTitle : "";
        customEl.classList.toggle("readonly-field", locked);
      }
    });
  };
  applyProfileFieldLocks();

  renderMemberHubProfileLinks();

  greatRegionSelect.onchange = () => {
    if (greatRegionSelect.value === "custom") {
      customGreatRegionInput.classList.remove("hidden");
    } else {
      customGreatRegionInput.classList.add("hidden");
      customGreatRegionInput.value = "";
    }
    populateProfileZones(greatRegionSelect.value, false);
    populateProfileGroupSelector(false);
  };

  zoneSelect.onchange = () => {
    if (zoneSelect.value === "custom") {
      customZoneInput.classList.remove("hidden");
    } else {
      customZoneInput.classList.add("hidden");
      customZoneInput.value = "";
    }
    populateProfileGroupSelector(false);
  };

  groupSelect.onchange = () => {
    if (groupSelect.value === "custom") {
      customGroupInput.classList.remove("hidden");
    } else {
      customGroupInput.classList.add("hidden");
      customGroupInput.value = "";
    }
  };

  document.getElementById("profile-form").onsubmit = async (e) => {
    e.preventDefault();
    const name = lockedFields.has("name") ? (state.currentUser.name || "") : document.getElementById("profile-name").value.trim();
    const greatRegion = lockedFields.has("great_region") ? (state.currentUser.great_region || "") : (greatRegionSelect.value === "custom" ? customGreatRegionInput.value.trim() : greatRegionSelect.value);
    const zone = lockedFields.has("pastoral_zone") ? (state.currentUser.pastoral_zone || "") : (zoneSelect.value === "custom" ? customZoneInput.value.trim() : zoneSelect.value);
    const group = lockedFields.has("small_group") ? (state.currentUser.small_group || "") : (groupSelect.value === "custom" ? customGroupInput.value.trim() : groupSelect.value);

    if (!greatRegion || !zone || !group) {
      alert("請完整填寫大區、牧區與小組資料！");
      return;
    }

    loader.show("儲存個人資料中...");
    
    const oldProfile = { ...state.currentUser };
    
    state.currentUser.name = name;
    state.currentUser.great_region = greatRegion;
    state.currentUser.pastoral_zone = zone;
    state.currentUser.small_group = group;

    try {
      let saveInfo = null;
      const isSupabase = !!(state.isSupabaseMode && state.supabase);
      if (isSupabase) {
        saveInfo = await db.syncProfileStatsToSupabase();
      }
      db.saveLocalUserStats();

      if (isSupabase) {
        if (saveInfo && saveInfo.aborted && saveInfo.reason === "demo") {
          showToast("個人資料已儲存 (Demo 模擬模式)");
        } else {
          showToast("個人基本資料已儲存成功！");
        }
      } else {
        showToast("個人資料已儲存至本機 (離線模式)");
      }
      if (typeof updateDashboardView === "function") updateDashboardView();
    } catch (err) {
      console.error("Failed to save profile:", err);
      state.currentUser = oldProfile;
      const isAdmin = state.currentUser && (state.currentUser.role === "admin");
      if (isAdmin) {
        showToast(`儲存個人資料失敗 (開發者除錯): ${err.message || err}`);
      } else {
        showToast("儲存個人資料失敗，請稍後再試。");
      }
    } finally {
      loader.hide();
    }
  };

  const demoRoleCard = document.querySelector(".demo-role-card");
  if (demoRoleCard) {
    if (!state.isSupabaseMode || isLocalhost) {
      demoRoleCard.classList.remove("hidden");
    } else {
      demoRoleCard.classList.add("hidden");
    }
  }

  const demoRoleSelect = document.getElementById("demo-role-select");
  if (demoRoleSelect) {
    if (state.isSupabaseMode) {
      demoRoleSelect.value = "real_user";
    } else {
      demoRoleSelect.value = state.currentUser.role || "member";
    }
    demoRoleSelect.onchange = async (e) => {
      await db.switchDemoRole(e.target.value);
    };
  }

  if (typeof updateAdminNavVisibility === 'function') {
    updateAdminNavVisibility();
  }

  await renderCareReminders();
}

async function renderCareReminders() {
  const containerCol = document.getElementById("profile-care-reminders-col");
  if (!containerCol) return;

  containerCol.innerHTML = "";
  containerCol.classList.add("hidden");

  // 🔒 安全防護：虛擬關心提醒 UI 僅在本機測試環境顯示
  const _hostname = window.location.hostname;
  const _isLocalhost = _hostname === 'localhost' || _hostname === '127.0.0.1' || _hostname === '::1' ||
                       _hostname.startsWith('192.168.') || _hostname.startsWith('10.') ||
                       _hostname.startsWith('172.') || _hostname.endsWith('.local');
  const isDemoMode = state.currentUser && !!state.currentUser.is_demo;
  const isSupabaseLive = state.isSupabaseMode && state.supabase && !isDemoMode;

  // Only proceed if: (a) localhost demo mode, OR (b) live Supabase with real user
  if (isDemoMode && !_isLocalhost) return;

  // 等待 mock_stats.js 動態載入完成（最多 2 秒）
  // mock_stats.js 是非同步插入的 <script>，可能在 renderCareReminders 被呼叫時還沒載入
  if (isDemoMode && _isLocalhost) {
    let waited = 0;
    while (!window.__mockStatsLoaded && waited < 2000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
  }

  const { data: reminders, error } = await db.fetchCareReminders();
  if (!error && typeof window.updateCareReminderBadge === "function") {
    window.updateCareReminderBadge(reminders || []);
  }
  if (error || !reminders || reminders.length === 0) {
    return;
  }

  containerCol.classList.remove("hidden");

  const titleEl = document.createElement("div");
  titleEl.style.cssText = "margin-bottom: 0.75rem; font-weight: 500; font-size: 0.9rem; color: var(--color-warning-text, #D97706); display: flex; align-items: center; gap: 0.4rem;";
  titleEl.innerHTML = `<span class="nlc-icon nlc-icon--md" data-icon="remind"></span><span>收到的關心提醒</span>`;
  containerCol.appendChild(titleEl);

  const roleNames = {
    member: "組員",
    group_leader: "小組長",
    zone_leader: "區長",
    great_zone_leader: "大區長",
    admin: "系統管理員"
  };

  reminders.forEach(reminder => {
    const card = document.createElement("div");
    card.className = "glass-card";
    card.style.cssText = "margin-bottom: 0.75rem; border-left: 4px solid var(--color-warning-text, rgb(217,119,6)); padding: 1rem; position: relative; transition: opacity 0.3s ease, transform 0.3s ease; height: auto !important;";

    // Sender details
    const sender = reminder.sender || {};
    const senderName = reminder.sender_name || sender.name || "牧長";
    const senderRoleRaw = reminder.sender_role || sender.role || "leader";
    const isTeamReminder = String(reminder.plan_key || "").startsWith("reading-team:");
    const senderRole = isTeamReminder ? "隊友" : (roleNames[senderRoleRaw] || "領袖");
    const dateStr = reminder.sent_on || "";

    const header = document.createElement("div");
    header.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--text-secondary);";
    header.innerHTML = `
      <span style="font-weight: 500; color: var(--text-primary);">
        <span class="nlc-icon nlc-icon--sm" data-icon="remind" aria-hidden="true"></span>
        來自${senderRole} <strong>${senderName}</strong>
      </span>
      <span>${dateStr}</span>
    `;

    const body = document.createElement("p");
    body.style.cssText = "font-size: 0.88rem; line-height: 1.5; color: var(--text-primary); margin: 0.5rem 0; word-break: break-all;";
    body.textContent = reminder.message || "加油！一起穩定讀經。";

    const actions = document.createElement("div");
    actions.style.cssText = "display: flex; justify-content: flex-end; margin-top: 0.75rem;";
    
    const ackBtn = document.createElement("button");
    ackBtn.className = "primary-btn";
    ackBtn.style.cssText = "padding: 0.35rem 0.8rem; font-size: 0.75rem; min-height: 28px; border-radius: 4px; background: var(--primary-color); color: white;";
    ackBtn.innerHTML = `<span class="btn-with-icon"><span class="nlc-icon nlc-icon--sm" data-icon="check" aria-hidden="true"></span><span>我知道了</span></span>`;
    
    ackBtn.onclick = async () => {
      ackBtn.disabled = true;
      card.style.opacity = "0.5";
      const { error } = await db.acknowledgeCareReminder(reminder.id);
      if (!error) {
        card.style.transform = "scale(0.95)";
        card.style.opacity = "0";
        setTimeout(() => {
          renderCareReminders();
        }, 300);
      } else {
        ackBtn.disabled = false;
        card.style.opacity = "1";
        alert("更新狀態失敗: " + (error.message || error));
      }
    };

    actions.appendChild(ackBtn);
    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);
    containerCol.appendChild(card);
  });

  if (typeof hydrateIcons === "function") {
    hydrateIcons(containerCol);
  }
}

function populateProfileZones(greatRegion, autoSelect = true) {
  const zoneSelect = document.getElementById("profile-zone");
  const customZoneInput = document.getElementById("profile-zone-custom");
  const userZone = state.currentUser.pastoral_zone;

  zoneSelect.innerHTML = `<option value="">-- 請選擇牧區 --</option>`;

  if (!autoSelect) {
    customZoneInput.classList.add("hidden");
    customZoneInput.value = "";
  }

  if (!greatRegion || greatRegion === "custom") {
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "自訂牧區...";
    zoneSelect.appendChild(customOpt);
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  const forceOfflineDemo = isLocalhost && (urlParams.get("demo") === "true" || urlParams.get("offline") === "true");
  const showDemoData = (forceOfflineDemo && typeof MockStatsService !== 'undefined' && MockStatsService !== null) || (state.currentUser && !!state.currentUser.is_demo);

  let predefinedZones = (state.orgStructure && state.orgStructure.zones && state.orgStructure.zones[greatRegion] && state.orgStructure.zones[greatRegion].length > 0) 
    ? state.orgStructure.zones[greatRegion] 
    : ((typeof MOCK_PASTORAL_ZONES_BY_REGION !== "undefined" && MOCK_PASTORAL_ZONES_BY_REGION[greatRegion]) || []);
  
  if (!showDemoData) {
    predefinedZones = predefinedZones.filter(z => !z.startsWith("示範"));
  }
  
  predefinedZones.forEach(zName => {
    const option = document.createElement("option");
    option.value = zName;
    option.textContent = zName;
    if (autoSelect && userZone === zName) {
      option.selected = true;
    }
    zoneSelect.appendChild(option);
  });

  if (autoSelect && userZone && userZone !== "custom" && !predefinedZones.includes(userZone)) {
    const tempOpt = document.createElement("option");
    tempOpt.value = userZone;
    tempOpt.textContent = userZone;
    tempOpt.selected = true;
    zoneSelect.appendChild(tempOpt);
  }

  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = "自訂牧區...";
  zoneSelect.appendChild(customOpt);

  if (autoSelect) {
    zoneSelect.value = userZone || "";
  }
}

function populateProfileGroupSelector(autoSelect = true) {
  const zoneSelect = document.getElementById("profile-zone");
  const groupSelect = document.getElementById("profile-group");
  const customGroupInput = document.getElementById("profile-group-custom");
  const userGroup = state.currentUser.small_group;

  groupSelect.innerHTML = `<option value="">-- 請選擇小組 --</option>`;

  if (!autoSelect) {
    customGroupInput.classList.add("hidden");
    customGroupInput.value = "";
  }

  const zone = zoneSelect.value;
  if (!zone || zone === "custom") {
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "自訂小組...";
    groupSelect.appendChild(customOpt);
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  const forceOfflineDemo = isLocalhost && (urlParams.get("demo") === "true" || urlParams.get("offline") === "true");
  const showDemoData = (forceOfflineDemo && typeof MockStatsService !== 'undefined' && MockStatsService !== null) || (state.currentUser && !!state.currentUser.is_demo);

  let predefinedGroups = (state.orgStructure && state.orgStructure.groups && state.orgStructure.groups[zone] && state.orgStructure.groups[zone].length > 0) 
    ? state.orgStructure.groups[zone] 
    : ((typeof MOCK_SMALL_GROUPS !== "undefined" && MOCK_SMALL_GROUPS[zone]) || []);

  if (!showDemoData) {
    predefinedGroups = predefinedGroups.filter(g => !g.startsWith("示範"));
  }

  predefinedGroups.forEach(groupName => {
    const option = document.createElement("option");
    option.value = groupName;
    option.textContent = groupName;
    if (autoSelect && userGroup === groupName) {
      option.selected = true;
    }
    groupSelect.appendChild(option);
  });

  if (autoSelect && userGroup && userGroup !== "custom" && !predefinedGroups.includes(userGroup)) {
    const tempOpt = document.createElement("option");
    tempOpt.value = userGroup;
    tempOpt.textContent = userGroup;
    tempOpt.selected = true;
    groupSelect.appendChild(tempOpt);
  }

  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = "自訂小組...";
  groupSelect.appendChild(customOpt);

  if (autoSelect) {
    groupSelect.value = userGroup || "";
  }
}

export function updateAdminNavVisibility() {
  const isRealAdmin = !state.isSupabaseMode || (state.realRole === "admin");
  const isSimulatedAdmin = state.currentUser && (state.currentUser.role === "admin");
  const shouldShowNav = isRealAdmin && isSimulatedAdmin;

  document.querySelectorAll(".admin-only-nav").forEach(btn => {
    btn.classList.toggle("hidden", !shouldShowNav);
  });

  document.querySelectorAll(".admin-only-plan-card").forEach(card => {
    card.classList.toggle("hidden", !shouldShowNav);
  });
}

export function updateHeaderAvatar() {
  const roleNames = {
    member: "\u6703\u53cb",
    small_group_leader: "\u5c0f\u7d44\u9577",
    group_leader: "\u5c0f\u7d44\u9577",
    zone_leader: "\u7267\u5340\u9577",
    great_zone_leader: "\u5927\u5340\u9577",
    admin: "\u7cfb\u7d71\u7ba1\u7406\u54e1",
  };

  const nameEl = document.getElementById("dropdown-user-name");
  const emailEl = document.getElementById("dropdown-user-email");
  const roleEl = document.getElementById("dropdown-user-role");

  const userName = state.currentUser.name || "NLC User";
  const userRole = state.currentUser.role || "member";
  const roleLabel = roleNames[userRole] || userRole;

  if (nameEl) nameEl.textContent = userName;
  if (roleEl) roleEl.textContent = roleLabel;

  if (typeof auth !== "undefined" && auth.isLoggedIn()) {
    const payload = auth._parseJwt ? auth._parseJwt(localStorage.getItem(auth.keys.idToken) || "") : null;
    const email = payload?.email || payload?.preferred_username || payload?.sub || "\u6559\u6703\u7cfb\u7d71\u767b\u5165\u4e2d";
    if (emailEl) emailEl.textContent = email;
    if (typeof refreshUserAvatars === "function") refreshUserAvatars();
    return;
  }

  if (state.isSupabaseMode && state.supabase) {
    // NLC/OIDC mode: email is already on state.currentUser (set by applyNlcProfile).
    // Calling supabase.auth.getUser() on the nlc-data custom client returns 403.
    if (state.currentUser && state.currentUser.email) {
      if (emailEl) emailEl.textContent = state.currentUser.email;
      if (typeof refreshUserAvatars === "function") refreshUserAvatars();
      return;
    }
    // Standard Supabase auth (non-OIDC): safe to call getUser().
    if (state.supabase.auth && state.supabase.auth.getUser && !localStorage.getItem("nlc_supabase_access_token")) {
      state.supabase.auth.getUser().then(({ data }) => {
        const user = data && data.user;
        if (user) {
          if (emailEl) emailEl.textContent = user.email || "教會系統登入中";
        } else if (emailEl) {
          emailEl.textContent = (window.APP_COPY && window.APP_COPY.auth.demoMode) || "Demo 模式";
        }
        if (typeof refreshUserAvatars === "function") refreshUserAvatars();
      }).catch(() => {
        if (emailEl) emailEl.textContent = (window.APP_COPY && window.APP_COPY.auth.demoMode) || "Demo 模式";
        if (typeof refreshUserAvatars === "function") refreshUserAvatars();
      });
      return;
    }
  }

  if (emailEl) emailEl.textContent = (window.APP_COPY && window.APP_COPY.auth.demoMode) || "Demo 模式";
  if (typeof refreshUserAvatars === "function") refreshUserAvatars();
}

function initAvatarDropdown() {
  const container   = document.getElementById("user-avatar-container");
  const btn         = document.getElementById("user-avatar-btn");
  const dropdown    = document.getElementById("avatar-dropdown-menu");
  const btnLogout   = document.getElementById("btn-avatar-logout");
  const btnProfile  = document.getElementById("btn-avatar-profile");

  if (!btn || !dropdown) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains("hidden");
    dropdown.classList.toggle("hidden", isOpen);
    btn.setAttribute("aria-expanded", String(!isOpen));
  });

  document.addEventListener("click", (e) => {
    if (container && !container.contains(e.target)) {
      dropdown.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    }
  });

  if (btnProfile) {
    btnProfile.addEventListener("click", (e) => {
      e.preventDefault();
      dropdown.classList.add("hidden");
      if (typeof appRouter !== 'undefined' && appRouter.switchTab) {
        appRouter.switchTab("profile-view");
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", async (e) => {
      e.preventDefault();
      dropdown.classList.add("hidden");
      loader.show("\u767b\u51fa\u4e2d...");
      try {
        if (typeof auth !== "undefined" && auth.logout) {
          await auth.logout();
          return;
        }
        if (state.isSupabaseMode && state.supabase?.auth?.signOut) {
          await state.supabase.auth.signOut();
        }
        state.realRole = null;
        db.updateAuthUI(null);
        await db.loadUserData();
        updateHeaderAvatar();
        alert("\u5df2\u767b\u51fa\u3002");
        appRouter.switchTab("dashboard-view");
      } catch (err) {
        alert(`\u767b\u51fa\u5931\u6557: ${err.message}`);
      } finally {
        loader.hide();
      }
    });
  }
}

export function init() {
  updateGoogleLoginVisibility();
  
  const btnToggleForm = document.getElementById("btn-toggle-profile-form");
  const formWrapper = document.getElementById("profile-form-wrapper");
  if (btnToggleForm && formWrapper) {
    btnToggleForm.onclick = (e) => {
      e.preventDefault();
      const isHidden = formWrapper.classList.contains("hidden");
      const copy = (window.APP_COPY && window.APP_COPY.memberHub) || {};
      if (isHidden) {
        formWrapper.classList.remove("hidden");
        btnToggleForm.innerHTML = iconLabel("chevronUp", "收起個人檔案編輯");
      } else {
        formWrapper.classList.add("hidden");
        btnToggleForm.innerHTML = iconLabel("edit", copy.profileSettings || "編輯個人檔案");
      }
    };
  }

  initAvatarDropdown();
}

window.renderProfileView = renderProfileView;
window.fetchAndRenderPersonalStats = fetchAndRenderPersonalStats;
window.updateHeaderAvatar = updateHeaderAvatar;
window.updateAdminNavVisibility = updateAdminNavVisibility;
window.initProfileControls = init;
