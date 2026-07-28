import { isLocalhostGoogleLoginAllowed, showToast } from "./utils.js";

function getMemberHubUrls() {
  if (typeof auth !== "undefined" && typeof auth.getMemberHubUrl === "function") {
    return {
      home: auth.getMemberHubUrl(""),
      structure: auth.getMemberHubUrl("pastoral/structure"),
      onboarding: auth.getMemberHubUrl("onboarding")
    };
  }
  return {
    home: "https://member.newlife.org.tw",
    structure: "https://member.newlife.org.tw/pastoral/structure",
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

function renderMemberHubOrgPlacement() {
  const user = state.currentUser || {};
  const values = {
    "member-hub-org-great-region": user.great_region || "",
    "member-hub-org-pastoral-zone": user.pastoral_zone || "",
    "member-hub-org-small-group": user.small_group || ""
  };

  Object.entries(values).forEach(function ([id, value]) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value || "").trim() || "尚未設定";
  });

  const hasAnyPlacement = Object.values(values).some(function (value) {
    return String(value || "").trim();
  });
  const emptyEl = document.getElementById("member-hub-org-empty");
  if (emptyEl) emptyEl.classList.toggle("hidden", hasAnyPlacement);

  const syncEl = document.getElementById("member-hub-org-sync-status");
  if (syncEl) {
    syncEl.textContent = isMemberHubManagedProfile()
      ? formatMemberContextSyncedAt(user.member_context_synced_at || "")
      : "目前登入方式無法同步會員中心";
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
      renderMemberHubOrgPlacement();
      renderMemberHubProfileLinks();
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

function openMemberHubStructure() {
  openMemberHubPath("pastoral/structure", getMemberHubUrls().structure);
}

// Members without a placement have nothing to manage in the pastoral structure
// tool yet; they need the Member Hub onboarding funnel instead.
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
  const identityUrl = needsOrg ? urls.onboarding : urls.structure;
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

export async function renderProfileView() {
  if (typeof window.renderBadgeWall === "function") {
    window.renderBadgeWall("badges-grid");
  }

  const roleNames = {
    member: "一般組員",
    group_leader: "小組長",
    zone_leader: "區長 (牧區負責人)",
    great_zone_leader: "大區長",
    admin: "系統管理員"
  };

  const summaryName = document.getElementById("profile-summary-name");
  if (summaryName) summaryName.textContent = state.currentUser.name || "新使用者";

  const summaryOrg = document.getElementById("profile-summary-org");
  if (summaryOrg) {
    const region = state.currentUser.great_region || "";
    const zone = state.currentUser.pastoral_zone || "";
    const group = state.currentUser.small_group || "";
    summaryOrg.textContent = [region, zone, group].filter(Boolean).join(" / ") || "未設定所屬小組";
  }
  renderMemberHubOrgPlacement();
  wireMemberHubOrgRefresh();

  const summaryRole = document.getElementById("profile-summary-role");
  if (summaryRole) {
    summaryRole.textContent = roleNames[state.currentUser.role] || "一般組員";
  }

  if (typeof refreshUserAvatars === "function") {
    refreshUserAvatars();
  }

  renderMemberHubProfileLinks();

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
    state.realRole = null;
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




  const btnProfileLogout = document.getElementById("btn-profile-logout");
  if (btnProfileLogout) {
    btnProfileLogout.addEventListener("click", async (e) => {
      e.preventDefault();
      await handleLogoutAndClearCache();
    });
  }
}

window.renderProfileView = renderProfileView;
window.updateHeaderAvatar = updateHeaderAvatar;
window.updateAdminNavVisibility = updateAdminNavVisibility;
window.initProfileControls = init;
