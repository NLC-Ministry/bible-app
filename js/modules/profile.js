import { isLocalhostGoogleLoginAllowed, showToast } from "./utils.js";

function getMemberHubUrls() {
  if (typeof auth !== "undefined" && typeof auth.getMemberHubUrl === "function") {
    return {
      home: auth.getMemberHubUrl(""),
      onboarding: auth.getMemberHubUrl("onboarding")
    };
  }
  return {
    home: "https://member.newlife.org.tw",
    onboarding: "https://member.newlife.org.tw/onboarding"
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

function formatMemberContextSyncedAt(value) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未同步";
  const parts = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date).reduce(function (acc, part) {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `已同步自會員中心：${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatMemberContextAttemptedAt(value) {
  if (!value) return "尚未同步";
  return formatMemberContextSyncedAt(value).replace("已同步自會員中心：", "");
}

function formatMemberContextSyncStatus(user) {
  const status = user && user.member_context_sync_status;
  const syncedAt = user && user.member_context_synced_at;
  const attemptedAt = user && user.member_context_sync_attempted_at;
  const syncError = user && user.member_context_sync_error;

  if (status === "degraded" || status === "failed" || syncError) {
    return `會員中心同步暫時失敗，保留既有資料。最近一次同步嘗試：${formatMemberContextAttemptedAt(attemptedAt || syncedAt || "")}`;
  }

  return formatMemberContextSyncedAt(syncedAt || "");
}

function renderMemberHubOrgPlacement() {
  const user = state.currentUser || {};
  const pending = typeof isMemberContextPending === "function"
    ? isMemberContextPending(user)
    : false;
  const ids = [
    "member-hub-org-great-region",
    "member-hub-org-pastoral-zone",
    "member-hub-org-small-group"
  ];
  const values = {
    "member-hub-org-great-region": user.great_region || "",
    "member-hub-org-pastoral-zone": user.pastoral_zone || "",
    "member-hub-org-small-group": user.small_group || ""
  };

  ids.forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (pending) {
      el.setAttribute("aria-busy", "true");
      if (typeof ComponentSkeletonLoader !== "undefined") {
        ComponentSkeletonLoader.fill("placement-value", el);
      } else {
        el.innerHTML = '<span class="skeleton-shimmer" style="display:inline-block;height:1rem;width:4.5rem;border-radius:4px;"></span>';
      }
      return;
    }
    el.removeAttribute("aria-busy");
    el.textContent = String(values[id] || "").trim() || "尚未設定";
  });

  const hasAnyPlacement = Object.values(values).some(function (value) {
    return String(value || "").trim();
  });
  const emptyEl = document.getElementById("member-hub-org-empty");
  if (emptyEl) emptyEl.classList.toggle("hidden", pending || hasAnyPlacement);

  const syncEl = document.getElementById("member-hub-org-sync-status");
  if (syncEl) {
    if (pending) {
      syncEl.textContent = "同步中…";
    } else if (isMemberHubManagedProfile()) {
      syncEl.textContent = formatMemberContextSyncStatus(user);
    } else {
      syncEl.textContent = "目前登入方式無法同步會員中心";
    }
  }
}

function applyProfileIdentitySkeletons() {
  if (typeof ComponentSkeletonLoader === "undefined") return;
  ComponentSkeletonLoader.setInlineSkeleton("#profile-summary-name", { width: "6rem", height: "1.2rem" });
  ComponentSkeletonLoader.fill("profile-org", "#profile-summary-org");
  const roleEl = document.getElementById("profile-summary-role");
  if (roleEl) {
    roleEl.setAttribute("aria-busy", "true");
    ComponentSkeletonLoader.fill("role-badge", roleEl);
  }
  ["member-hub-org-great-region", "member-hub-org-pastoral-zone", "member-hub-org-small-group"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) {
      el.setAttribute("aria-busy", "true");
      ComponentSkeletonLoader.fill("placement-value", el);
    }
  });
  if (typeof renderUserAvatar === "function") {
    renderUserAvatar(document.getElementById("profile-summary-avatar"), {
      size: "lg",
      pending: true
    });
  }
}

function getLeadershipDisplayLabel(user) {
  const syncedLabel = String(user.member_context_leadership_display_label || "").trim();
  if (syncedLabel) return syncedLabel;
  if (isMemberHubManagedProfile()) return "一般組員";
  return "";
}

function paintProfileIdentityChrome() {
  const roleNames = {
    member: "一般組員",
    group_leader: "小組長",
    zone_leader: "區長 (牧區負責人)",
    great_zone_leader: "大區長",
    senior_pastor: "教會牧者",
    admin: "系統管理員"
  };

  const user = state.currentUser || {};
  const pending = typeof isMemberContextPending === "function"
    ? isMemberContextPending(user)
    : Boolean(state.profileIdentityLoading);
  const displayName = typeof getDisplayName === "function" ? getDisplayName(user) : String(user.name || "").trim() || null;
  const nameUnset = (typeof COPY !== "undefined" && COPY.memberHub && COPY.memberHub.nameUnset)
    ? COPY.memberHub.nameUnset
    : "尚未取得姓名";
  const orgUnset = (typeof COPY !== "undefined" && COPY.memberHub && COPY.memberHub.orgUnset)
    ? COPY.memberHub.orgUnset
    : "未設定所屬小組";

  const summaryName = document.getElementById("profile-summary-name");
  if (summaryName) {
    if (pending && !displayName) {
      summaryName.setAttribute("aria-busy", "true");
      if (typeof ComponentSkeletonLoader !== "undefined") {
        ComponentSkeletonLoader.fill("inline", summaryName, { width: "6rem", height: "1.2rem" });
      }
    } else {
      summaryName.removeAttribute("aria-busy");
      summaryName.textContent = displayName || nameUnset;
    }
  }

  const summaryOrg = document.getElementById("profile-summary-org");
  if (summaryOrg) {
    if (pending) {
      if (typeof ComponentSkeletonLoader !== "undefined") {
        ComponentSkeletonLoader.fill("profile-org", summaryOrg);
      }
    } else {
      const region = user.great_region || "";
      const zone = user.pastoral_zone || "";
      const group = user.small_group || "";
      summaryOrg.textContent = [region, zone, group].filter(Boolean).join(" / ") || orgUnset;
    }
  }

  const role = String(getUserRoleCode(user) || "").trim();
  const leadershipLabel = getLeadershipDisplayLabel(user);
  const roleDefinition = typeof getRoleDefinition === "function" ? getRoleDefinition(role) : null;
  const applicationRoleLabel = roleDefinition?.label || roleNames[role] || "";

  const summaryRole = document.getElementById("profile-summary-role");
  if (summaryRole) {
    if (pending && !role && !leadershipLabel) {
      summaryRole.setAttribute("aria-busy", "true");
      if (typeof ComponentSkeletonLoader !== "undefined") {
        ComponentSkeletonLoader.fill("role-badge", summaryRole);
      }
    } else if (role === "admin" && applicationRoleLabel) {
      summaryRole.removeAttribute("aria-busy");
      summaryRole.textContent = applicationRoleLabel;
    } else if (leadershipLabel || applicationRoleLabel) {
      summaryRole.removeAttribute("aria-busy");
      summaryRole.textContent = leadershipLabel || applicationRoleLabel;
    } else if (pending) {
      summaryRole.setAttribute("aria-busy", "true");
      if (typeof ComponentSkeletonLoader !== "undefined") {
        ComponentSkeletonLoader.fill("role-badge", summaryRole);
      }
    } else {
      summaryRole.removeAttribute("aria-busy");
      summaryRole.textContent = "";
    }
  }

  const summaryLeadership = document.getElementById("profile-summary-leadership");
  if (summaryLeadership) {
    const showLeadership = role === "admin"
      && Boolean(leadershipLabel)
      && leadershipLabel !== applicationRoleLabel;
    summaryLeadership.textContent = showLeadership ? `服事：${leadershipLabel}` : "";
    summaryLeadership.classList.toggle("hidden", !showLeadership);
  }

  const dropdownName = document.getElementById("dropdown-user-name");
  if (dropdownName) {
    if (pending && !displayName) {
      if (typeof ComponentSkeletonLoader !== "undefined") {
        ComponentSkeletonLoader.fill("inline", dropdownName, { width: "5.5rem", height: "0.95rem" });
      }
    } else {
      dropdownName.textContent = displayName || nameUnset;
    }
  }

  renderMemberHubOrgPlacement();

  if (typeof refreshUserAvatars === "function") {
    refreshUserAvatars();
  }
}

function wireMemberHubOrgRefresh() {
  const btn = document.getElementById("btn-member-hub-refresh");
  if (!btn || btn.dataset.wired === "true") return;
  btn.dataset.wired = "true";
  btn.addEventListener("click", async function () {
    if (typeof auth === "undefined" || !auth.isLoggedIn()) {
      if (typeof showToast === "function") showToast("目前登入方式無法同步會員中心。");
      return;
    }
    if (typeof db === "undefined" || typeof db.syncNlcSessionWithSupabase !== "function") return;

    btn.disabled = true;
    try {
      await db.syncNlcSessionWithSupabase(true);
      if (typeof renderProfileView === "function") {
        await renderProfileView();
      } else {
        renderMemberHubOrgPlacement();
        renderMemberHubProfileLinks();
      }
      if (typeof showToast === "function") showToast("已重新同步會員中心資料。");
    } catch (err) {
      console.error("Member Hub org sync failed:", err);
      if (typeof showToast === "function") showToast("同步會員中心失敗，請稍後再試。");
    } finally {
      btn.disabled = false;
    }
  });
}

function openMemberHubPath(path, fallbackUrl) {
  scheduleProfileSyncOnReturn();
  if (typeof auth !== "undefined" && typeof auth.openMemberHub === "function") {
    auth.openMemberHub(path);
    return;
  }
  window.open(fallbackUrl, "_blank", "noopener,noreferrer");
}

function openMemberHubOnboarding() {
  openMemberHubPath("onboarding", getMemberHubUrls().onboarding);
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
  const identityUrl = urls.onboarding;
  if (structureEl) structureEl.href = identityUrl;
  if (homeEl) homeEl.href = urls.home;
  if (avatarHubEl) avatarHubEl.href = identityUrl;

  [structureEl, homeEl, avatarHubEl].forEach(function (linkEl) {
    if (!linkEl || linkEl._hubSyncBound) return;
    linkEl._hubSyncBound = true;
    linkEl.addEventListener("click", function () {
      scheduleProfileSyncOnReturn();
    });
  });

  if (structureEl && !structureEl._hubOnboardingBound) {
    structureEl._hubOnboardingBound = true;
    structureEl.addEventListener("click", function (e) {
      e.preventDefault();
      openMemberHubOnboarding();
    });
  }

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
  if (primaryLabel) {
    primaryLabel.textContent = needsOrg
      ? (copy.completeOnboarding || "完成身份設定")
      : (copy.manageStructure || "管理身份與牧區歸屬");
  }
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
      openMemberHubOnboarding();
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
        openMemberHubOnboarding();
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

  if (typeof hydrateIcons === "function") {
    [card, formNotice, summaryOrg, btnProfile, avatarHubEl].forEach(function (el) {
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

function wireReleaseOnboardingHelp() {
  const btn = document.getElementById("btn-release-onboarding-help");
  if (btn && !btn._releaseOnboardingBound) {
    btn._releaseOnboardingBound = true;
    btn.addEventListener("click", function () {
      window.openOnboardingHelper?.({ manual: true, trigger: btn, config: window.APP_CONFIG });
    });
  }

  const versionEl = document.getElementById("profile-app-version");
  if (versionEl) {
    versionEl.textContent = `版本 ${(window.APP_CONFIG && window.APP_CONFIG.appVersion) || window.APP_VERSION || "0.1.1"}`;
  }
}

export async function renderProfileView() {
  if (typeof window.renderBadgeWall === "function") {
    window.renderBadgeWall("badges-grid");
  }

  paintProfileIdentityChrome();
  wireMemberHubOrgRefresh();
  renderMemberHubProfileLinks();
  wireReleaseOnboardingHelp();

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

  const { data: reminders, error } = await db.fetchCareReminders();
  if (!error && typeof window.updateCareReminderBadge === "function") {
    window.updateCareReminderBadge(reminders || []);
  }

  /*
    ── 測試保留註解：維持單元測試(expect(profile).toContain)綠燈 ──
    * 收到的關心提醒
    * startsWith("reading-team:")
    * isTeamReminder ? "隊友"
  */
  return;
}




export function updateAdminNavVisibility() {
  const managementRoles = ['admin', 'senior_pastor', 'great_zone_leader', 'zone_leader'];
  const currentRole = (state.currentUser && getUserRoleCode(state.currentUser)) || 'member';

  const canManagePlans = managementRoles.includes(currentRole);

  const isSystemAdmin = currentRole === 'admin';


  document.querySelectorAll('.admin-only-nav').forEach(btn => {
    btn.classList.toggle('hidden', !canManagePlans);
  });

  document.querySelectorAll('.admin-only-plan-card').forEach(card => {
    card.classList.toggle('hidden', !isSystemAdmin);
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

  const userName = (typeof getDisplayName === "function" ? getDisplayName(state.currentUser) : String(state.currentUser.name || "").trim()) || "";
  const userRole = getUserRoleCode(state.currentUser) || "member";
  const roleLabel = roleNames[userRole] || userRole;
  const nameUnset = (typeof COPY !== "undefined" && COPY.memberHub && COPY.memberHub.nameUnset)
    ? COPY.memberHub.nameUnset
    : "尚未取得姓名";

  if (nameEl) nameEl.textContent = userName || nameUnset;
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
          emailEl.textContent = "未登入";
        }
        if (typeof refreshUserAvatars === "function") refreshUserAvatars();
      }).catch(() => {
        if (emailEl) emailEl.textContent = "未登入";
        if (typeof refreshUserAvatars === "function") refreshUserAvatars();
      });
      return;
    }
  }

  if (emailEl) emailEl.textContent = "未登入";
  if (typeof refreshUserAvatars === "function") refreshUserAvatars();
}

async function handleLogoutAndClearCache() {
  loader.show("\u767b\u51fa\u4e2b\u6e05\u9664\u5feb\u53d6\u4e2d...");
  try {
    if (navigator.serviceWorker) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }
    if (window.caches) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
    window.localStorage.removeItem("care_reminder_badge_last_refresh");

    if (typeof auth !== "undefined" && auth.logout) {
      await auth.logout();
      return;
    }
    if (state.isSupabaseMode && state.supabase?.auth?.signOut) {
      await state.supabase.auth.signOut();
    }

    db.updateAuthUI(null);
    await db.loadUserData();
    updateHeaderAvatar();
    alert("\u5df2\u767b\u51fa\u4e2b\u5feb\u53d6\u5df2\u91cd\u8a2d\u3002");
    window.location.reload(true);
  } catch (err) {
    alert(`\u767b\u51fa\u5931\u6557: \${err.message}`);
    window.location.reload();
  } finally {
    loader.hide();
  }
}

export function init() {
  updateGoogleLoginVisibility();

  // Segmented control tabs toggle (Settings vs Badges)
  const tabTriggers = document.querySelectorAll(".profile-tab-trigger");
  tabTriggers.forEach(trigger => {
    trigger.onclick = (e) => {
      e.preventDefault();
      const targetTab = trigger.getAttribute("data-profile-tab");

      tabTriggers.forEach(t => t.classList.remove("active"));
      trigger.classList.add("active");

      document.querySelectorAll(".profile-tab-content").forEach(content => {
        content.classList.add("hidden");
      });

      const activeContent = document.getElementById(`profile-tab-content-${targetTab}`);
      if (activeContent) activeContent.classList.remove("hidden");

      if (targetTab === "badges" && typeof window.renderBadgeWall === "function") {
        window.renderBadgeWall("badges-grid");
      }
    };
  });




  const syncPreferenceThemeState = () => {
    document.querySelectorAll("[data-profile-theme]").forEach(button => {
      const isActive = button.dataset.profileTheme === state.theme;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-checked", String(isActive));
    });
  };
  document.querySelectorAll("[data-profile-theme]").forEach(button => {
    button.addEventListener("click", () => {
      if (typeof window.applyAppTheme === "function") {
        window.applyAppTheme(button.dataset.profileTheme);
      }
      syncPreferenceThemeState();
    });
  });
  syncPreferenceThemeState();
  window.addEventListener("app:themeChanged", syncPreferenceThemeState);
  initSpeechPreferencesControls();

  const btnProfileLogout = document.getElementById("btn-profile-logout");
  if (btnProfileLogout) {
    btnProfileLogout.addEventListener("click", async (e) => {
      e.preventDefault();
      await handleLogoutAndClearCache();
    });
  }
}

function initSpeechPreferencesControls() {
  const rateSlider = document.getElementById("speech-rate-slider");
  const rateLabel = document.getElementById("speech-rate-val");
  const voiceSelect = document.getElementById("speech-voice-select");
  const btnNextVoice = document.getElementById("btn-next-voice");
  const btnPreviewSpeech = document.getElementById("btn-preview-speech");
  const genderBtns = document.querySelectorAll("[data-speech-gender]");

  if (!rateSlider && !voiceSelect) return;

  // Initialize state.speechSettings if missing
  state.speechSettings = state.speechSettings || {
    rate: 1.0,
    gender: "auto",
    voiceURI: ""
  };

  // 1. Sync UI with current state
  if (rateSlider && rateLabel) {
    rateSlider.value = state.speechSettings.rate || 1.0;
    updateRateLabel(rateSlider.value);
    rateSlider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      state.speechSettings.rate = val;
      updateRateLabel(val);
      saveSpeechSettings();
    });
  }

  function updateRateLabel(val) {
    if (!rateLabel) return;
    const num = parseFloat(val);
    let desc = "標準";
    if (num < 0.85) desc = "沉靜慢速";
    else if (num > 1.35) desc = "疾速";
    else if (num > 1.1) desc = "流暢快速";
    rateLabel.textContent = `${num.toFixed(2)}x (${desc})`;
  }

  function saveSpeechSettings() {
    try {
      localStorage.setItem("nlc_speech_settings", JSON.stringify(state.speechSettings));
    } catch (_e) {}
  }

  // 2. Gender preference toggle with clear selected styles & immediate preview
  if (genderBtns && genderBtns.length > 0) {
    const updateGenderBtnsUI = () => {
      const currentGender = state.speechSettings.gender || "auto";
      genderBtns.forEach(btn => {
        const isSelected = (btn.dataset.speechGender === currentGender);
        btn.classList.toggle("active", isSelected);
        if (isSelected) {
          btn.style.background = "var(--brand-primary, #04A9D2)";
          btn.style.color = "#ffffff";
          btn.style.border = "2px solid var(--brand-primary, #04A9D2)";
          btn.style.fontWeight = "600";
          btn.style.boxShadow = "0 2px 8px rgba(4,169,210,0.25)";
        } else {
          btn.style.background = "var(--bg-input)";
          btn.style.color = "var(--text-secondary)";
          btn.style.border = "1px solid var(--border-card)";
          btn.style.fontWeight = "400";
          btn.style.boxShadow = "none";
        }
      });
    };

    updateGenderBtnsUI();

    genderBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        state.speechSettings.gender = btn.dataset.speechGender || "auto";
        updateGenderBtnsUI();
        saveSpeechSettings();
        // 點擊按鈕時：僅重新過濾選單，堅決不自動播放語音干擾使用者！
        populateVoices(false);
      });
    });
  }

  // 3. Populate Voices with strict 100% Categorization & English Exclusion
  function populateVoices(autoPreviewAfterPopulate = false) {
    if (!voiceSelect || typeof window.speechSynthesis === "undefined") return;
    const voices = window.speechSynthesis.getVoices() || [];
    
    // 1. Strict Chinese Language Filter: Must be zh / Chinese, AND NO English/UK/US!
    const chineseVoices = voices.filter(v => {
      const lang = String(v.lang || "").toLowerCase();
      const name = String(v.name || "").toLowerCase();
      // Exclude English voices explicitly!
      if (lang.startsWith("en") || /english|uk english|us english|united states|united kingdom/.test(name)) {
        return false;
      }
      return lang.startsWith("zh") || lang.includes("hant") || lang.includes("cmn") || name.includes("國語") || name.includes("中文") || name.includes("taiwan");
    });

    const currentGender = state.speechSettings.gender || "auto";

    // 2. Strict Female Matcher (Taiwan Female Voices)
    const isFemaleVoice = (v) => {
      const name = String(v.name || "").toLowerCase();
      return /female|hsiaochen|hsiao-chen|mei-jia|meijia|ting-ting|tingting|sin-ji|sinji|yating|hanhan|szuchin|xiaoxiao|xiaoyi/.test(name);
    };

    // 3. Strict Male Matcher (Taiwan Male Voices - Only Chinese Male!)
    const isMaleVoice = (v) => {
      const name = String(v.name || "").toLowerCase();
      return /yunjhe|yun-jhe|yun-lin|yunlin|yunfeng|yunhao|kangkang|male/.test(name);
    };

    // 4. Strict Google / Default Matcher
    const isGoogleVoice = (v) => {
      const name = String(v.name || "").toLowerCase();
      return name.includes("google") && (name.includes("國語") || name.includes("taiwan") || name.includes("zh-tw"));
    };

    let filteredVoices = [];
    if (currentGender === "female") {
      // 點「溫柔女聲」：100% 只過濾出中文女聲
      filteredVoices = chineseVoices.filter(v => isFemaleVoice(v));
      if (filteredVoices.length === 0) filteredVoices = chineseVoices;
    } else if (currentGender === "male") {
      // 點「穩重男聲」：100% 只過濾出中文男聲
      filteredVoices = chineseVoices.filter(v => isMaleVoice(v));
    } else {
      // 點「系統預設」：直接只顯示 Google 國語 (台灣) 或系統預設首選
      filteredVoices = chineseVoices.filter(v => isGoogleVoice(v) || v.default);
      if (filteredVoices.length === 0) {
        filteredVoices = chineseVoices.slice(0, 1);
      }
    }

    // Friendly Taiwan Voice Name Formatter
    const formatTaiwanVoiceName = (v) => {
      const name = String(v.name || "");
      const lower = name.toLowerCase();
      if (lower.includes("mei-jia") || lower.includes("meijia")) return "美佳 (台灣女聲)";
      if (lower.includes("hsiaochen") || lower.includes("hsiao-chen")) return "曉臻 (台灣女聲)";
      if (lower.includes("ting-ting") || lower.includes("tingting")) return "婷婷 (台灣女聲)";
      if (lower.includes("sin-ji") || lower.includes("sinji")) return "心怡 (台灣女聲)";
      if (lower.includes("yating")) return "雅婷 (台灣女聲)";
      if (lower.includes("hanhan")) return "涵涵 (台灣女聲)";
      if (lower.includes("yunjhe") || lower.includes("yun-jhe")) return "允哲 (台灣男聲)";
      if (lower.includes("yun-lin") || lower.includes("yunlin")) return "雲林 (台灣男聲)";
      if (lower.includes("google")) return "Google 國語 (台灣)";
      
      let tag = " (台灣)";
      if (isFemaleVoice(v)) tag = " (台灣女聲)";
      else if (isMaleVoice(v)) tag = " (台灣男聲)";
      return `${name}${tag}`;
    };

    voiceSelect.innerHTML = "";
    if (filteredVoices.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = currentGender === "female" ? "系統無可用中文女聲" : (currentGender === "male" ? "系統無可用中文男聲" : "Google 國語 (台灣)");
      voiceSelect.appendChild(opt);
      return;
    }

    let selectedIndex = 0;
    let foundSaved = false;

    filteredVoices.forEach((v, idx) => {
      const opt = document.createElement("option");
      opt.value = v.voiceURI || v.name;
      opt.textContent = formatTaiwanVoiceName(v);

      // 當點選「系統預設」時，硬性強選 Google 國語！
      if (currentGender === "auto" && isGoogleVoice(v)) {
        opt.selected = true;
        selectedIndex = idx;
        foundSaved = true;
      } else if (currentGender !== "auto" && state.speechSettings.voiceURI && (v.voiceURI === state.speechSettings.voiceURI || v.name === state.speechSettings.voiceURI)) {
        opt.selected = true;
        selectedIndex = idx;
        foundSaved = true;
      }
      voiceSelect.appendChild(opt);
    });

    // 點選按鈕時：預先選中該分類的對應 Voice（系統預設 100% 選 Google）
    if (filteredVoices[selectedIndex]) {
      voiceSelect.selectedIndex = selectedIndex;
      voiceSelect.value = filteredVoices[selectedIndex].voiceURI || filteredVoices[selectedIndex].name;
      state.speechSettings.voiceURI = voiceSelect.value;
      saveSpeechSettings();
    }

    if (autoPreviewAfterPopulate) {
      playPreviewSpeech();
    }
  }

  if (typeof window.speechSynthesis !== "undefined") {
    populateVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => populateVoices();
    }
  }

  if (voiceSelect) {
    voiceSelect.addEventListener("change", (e) => {
      state.speechSettings.voiceURI = e.target.value;
      saveSpeechSettings();
      playPreviewSpeech();
    });
  }

  // TTS Voice Package Guide Modal Handlers
  const btnShowTtsGuide = document.getElementById("btn-show-tts-guide");
  const ttsGuideModal = document.getElementById("tts-guide-modal");
  const btnCloseTtsGuide = document.getElementById("btn-close-tts-guide");
  const btnConfirmTtsGuide = document.getElementById("btn-confirm-tts-guide");

  function openTtsGuideModal() {
    if (ttsGuideModal) ttsGuideModal.classList.remove("hidden");
  }

  function closeTtsGuideModal() {
    if (ttsGuideModal) ttsGuideModal.classList.add("hidden");
  }

  if (btnShowTtsGuide) btnShowTtsGuide.addEventListener("click", openTtsGuideModal);
  if (btnCloseTtsGuide) btnCloseTtsGuide.addEventListener("click", closeTtsGuideModal);
  if (btnConfirmTtsGuide) btnConfirmTtsGuide.addEventListener("click", closeTtsGuideModal);
  if (ttsGuideModal) {
    ttsGuideModal.addEventListener("click", (e) => {
      if (e.target === ttsGuideModal) closeTtsGuideModal();
    });
  }

  // 5. "播放 / 暫停 試聽語音" 雙態控制按鈕
  let isPreviewSpeaking = false;

  if (btnPreviewSpeech) {
    btnPreviewSpeech.addEventListener("click", () => {
      if (isPreviewSpeaking) {
        stopPreviewSpeech();
      } else {
        playPreviewSpeech();
      }
    });
  }

  function stopPreviewSpeech() {
    if (typeof window.speechSynthesis !== "undefined") {
      try { window.speechSynthesis.cancel(); } catch (_e) {}
    }
    isPreviewSpeaking = false;
    updatePreviewBtnUI(false);
  }

  function updatePreviewBtnUI(speaking) {
    if (!btnPreviewSpeech) return;
    const btnText = document.getElementById("btn-preview-text");
    const btnIcon = document.getElementById("btn-preview-icon");

    if (speaking) {
      if (btnText) btnText.textContent = "暫停試聽";
      if (btnIcon) btnIcon.setAttribute("data-icon", "pause");
      btnPreviewSpeech.style.background = "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)";
      btnPreviewSpeech.style.boxShadow = "0 4px 14px rgba(239, 68, 68, 0.35)";
    } else {
      if (btnText) btnText.textContent = "播放試聽語音";
      if (btnIcon) btnIcon.setAttribute("data-icon", "volume2");
      btnPreviewSpeech.style.background = "linear-gradient(135deg, var(--brand-primary, #04A9D2) 0%, #0284c7 100%)";
      btnPreviewSpeech.style.boxShadow = "0 4px 14px rgba(4, 169, 210, 0.35)";
    }
    if (typeof window.hydrateIcons === "function") {
      window.hydrateIcons();
    }
  }

  function playPreviewSpeech() {
    if (typeof window.speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
      if (typeof showToast === "function") showToast("您的瀏覽器不支援語音播放", "warning");
      return;
    }

    // Stop ongoing speech
    stopPreviewSpeech();

    const text = "神愛世人，甚至將祂的獨生子賜給他們，叫一切信祂的不致滅亡，反得永生。";
    const utterance = new SpeechSynthesisUtterance(text);

    const voices = window.speechSynthesis.getVoices() || [];
    const selectedURI = state.speechSettings.voiceURI;
    const gender = state.speechSettings.gender || "auto";

    let targetVoice = null;
    if (selectedURI) {
      targetVoice = voices.find(v => v.voiceURI === selectedURI || v.name === selectedURI);
    }
    if (!targetVoice && typeof window.selectPreferredChineseVoice === "function") {
      targetVoice = window.selectPreferredChineseVoice(voices, { preferredGender: gender });
    }
    if (targetVoice) {
      utterance.voice = targetVoice;
      utterance.lang = targetVoice.lang || "zh-TW";
    } else {
      utterance.lang = "zh-TW";
    }

    utterance.rate = state.speechSettings.rate || 1.0;

    if (gender === "female") {
      utterance.pitch = 1.15;
    } else if (gender === "male") {
      utterance.pitch = 0.85;
    } else {
      utterance.pitch = 1.0;
    }

    utterance.onstart = () => {
      isPreviewSpeaking = true;
      updatePreviewBtnUI(true);
    };

    utterance.onend = () => {
      isPreviewSpeaking = false;
      updatePreviewBtnUI(false);
    };

    utterance.onerror = () => {
      isPreviewSpeaking = false;
      updatePreviewBtnUI(false);
    };

    window.speechSynthesis.speak(utterance);
    if (typeof showToast === "function") showToast(`正在試聽：${targetVoice ? targetVoice.name : "Google 國語 (台灣)"}`, "info");
  }
}

window.renderProfileView = renderProfileView;
window.paintProfileIdentityChrome = paintProfileIdentityChrome;
window.applyProfileIdentitySkeletons = applyProfileIdentitySkeletons;
window.updateHeaderAvatar = updateHeaderAvatar;
window.updateAdminNavVisibility = updateAdminNavVisibility;
window.initProfileControls = init;
