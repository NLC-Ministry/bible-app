// js/modules/admin.js

import {
  sendBulkPlanInvitations,
  wasPlanInviteRemindedToday
} from "./admin-bulk-plan-invite.mjs";
import { buildAdminRegistrationStatisticsPlans } from "./admin-registration-plan-options.mjs";
import { resolveAdminRegistrationSummary } from "./admin-registration-summary.mjs";

function updatePastoralWallControl(enabled, options = {}) {
  const toggle = document.getElementById("admin-pastoral-wall-toggle");
  const status = document.getElementById("admin-pastoral-wall-status");
  if (!toggle || !status) return;
  toggle.setAttribute("aria-checked", enabled ? "true" : "false");
  toggle.setAttribute("aria-label", enabled ? "牧區分享牆功能已開啟" : "牧區分享牆功能已關閉");
  toggle.disabled = options.disabled === true;
  status.textContent = enabled ? "已開啟：所有堂會成員皆可在首頁看見「牧區分享牆」，進行靈修分享與互動。" : "已關閉：首頁將隱藏「牧區分享牆」，僅保留個人靈修進度紀錄與團隊功能。";
}

export async function renderAdminFeatureSettings() {
  const card = document.querySelector(".admin-feature-settings-card")?.closest(".card-col");
  const toggle = document.getElementById("admin-pastoral-wall-toggle");
  const feedback = document.getElementById("admin-pastoral-wall-feedback");
  if (!card || !toggle || !feedback) return;

  const isAdmin = state.currentUser && getUserRoleCode(state.currentUser) === "admin";
  card.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;

  feedback.classList.add("hidden");
  feedback.textContent = "";
  updatePastoralWallControl(false, { disabled: true });

  const result = await db.getFeatureSetting("pastoral_sharing_wall", false);
  if (result.error) {
    updatePastoralWallControl(false, { disabled: true });
    feedback.textContent = "無法載入設定：從伺服器獲取牧區分享牆設定失敗。";
    feedback.classList.remove("hidden");
    return;
  }

  updatePastoralWallControl(result.enabled === true);

  if (!toggle.dataset.featureSettingBound) {
    toggle.dataset.featureSettingBound = "true";
    toggle.addEventListener("click", async () => {
      const currentEnabled = toggle.getAttribute("aria-checked") === "true";
      const nextEnabled = !currentEnabled;
      updatePastoralWallControl(currentEnabled, { disabled: true });
      feedback.classList.add("hidden");

      const saveResult = await db.updateFeatureSetting("pastoral_sharing_wall", nextEnabled);
      if (saveResult.error) {
        updatePastoralWallControl(currentEnabled);
        feedback.textContent = "更新設定失敗：無法將設定儲存至伺服器。";
        feedback.classList.remove("hidden");
        return;
      }

      updatePastoralWallControl(nextEnabled);
      if (typeof showToast === "function") {
        showToast(nextEnabled ? "牧區分享牆功能已開啟！" : "牧區分享牆功能已關閉。");
      }
      window.dispatchEvent(new CustomEvent("pastoral-sharing-wall-changed", {
        detail: { enabled: nextEnabled }
      }));
    });
  }

  if (typeof hydrateIcons === "function") hydrateIcons(card);
}

let adminUserDirectoryProfiles = [];

function formatAdminUserSyncTime(value) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未同步";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function renderAdminUserDirectoryList(query = "") {
  const list = document.getElementById("admin-user-directory-list");
  const count = document.getElementById("admin-user-directory-count");
  if (!list || !count) return;
  const incompleteOnly = document.getElementById("admin-user-directory-filter-incomplete")?.checked === true;
  const notJoinedStageOneOnly = document.getElementById("admin-user-directory-filter-stage-one")?.checked === true;
  const currentProfileId = String(state.currentProfileId || state.currentUser?.id || "");
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase("zh-Hant");
  const placeholderNames = new Set(["NLC User", "尚未取得姓名", "未命名使用者"]);
  const filteredProfiles = adminUserDirectoryProfiles.filter(profile => {
    const normalizedName = String(profile.name || "").trim();
    const missingRequiredProfile = !normalizedName || placeholderNames.has(normalizedName)
      || !String(profile.pastoral_zone || "").trim();
    if (incompleteOnly && !missingRequiredProfile) return false;
    const eligibleForStageOneInvitation = profile.is_active === true
      && String(profile.id || "") !== currentProfileId;
    if (notJoinedStageOneOnly && (profile.joined_stage_one === true || !eligibleForStageOneInvitation)) return false;
    const roleLabel = profile.role_definition?.label || profile.role_definition?.code || "一般會友";
    return [profile.name, profile.email, roleLabel, profile.great_region, profile.pastoral_zone, profile.small_group]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("zh-Hant")
      .includes(normalizedQuery);
  });
  count.textContent = normalizedQuery || incompleteOnly || notJoinedStageOneOnly
    ? `${filteredProfiles.length} / ${adminUserDirectoryProfiles.length} 人`
    : `${adminUserDirectoryProfiles.length} 人`;
  if (filteredProfiles.length === 0) {
    list.innerHTML = '<div class="admin-user-directory__empty">沒有符合條件的使用者。</div>';
    return;
  }

  list.innerHTML = filteredProfiles.map(profile => {
    const name = String(profile.name || "").trim() || "尚未取得姓名";
    const email = String(profile.email || "").trim() || "未提供電子信箱";
    const roleLabel = profile.role_definition?.label || profile.role_definition?.code || "一般會友";
    const greatRegion = String(profile.great_region || "").trim() || "未設定";
    const pastoralZone = String(profile.pastoral_zone || "").trim() || "未設定牧區";
    const smallGroup = String(profile.small_group || "").trim() || "未設定";
    const syncStatus = String(profile.member_context_sync_status || "").trim();
    const syncLabel = syncStatus === "success"
      ? "已同步"
      : (syncStatus === "degraded" || syncStatus === "failed" ? "同步異常" : "尚未同步");
    const config = getManagedScopeConfig(profile);
    const defaultScopes = getProfileDefaultManagedScopes(profile, config);
    const managedScopeText = config.role === "admin" || config.role === "senior_pastor"
      ? "全教會"
      : (defaultScopes.join("、") || "僅本人");
    const statusClass = profile.is_active === false ? "disabled" : "active";

    return `
      <details class="admin-user-directory__card">
        <summary class="admin-user-directory__card-summary">
          <span class="admin-user-directory__identity">
            <strong>${escapeHTML(name)}</strong>
            <span>${escapeHTML(pastoralZone)}</span>
          </span>
        </summary>
        <div class="admin-user-directory__detail-panel">
          <dl class="admin-user-directory__details">
            <div><dt>帳號狀態</dt><dd><span class="admin-user-directory__status admin-user-directory__status--${statusClass}">${profile.is_active === false ? "已停用" : "啟用中"}</span></dd></div>
            <div><dt>電子信箱</dt><dd>${escapeHTML(email)}</dd></div>
            <div><dt>角色</dt><dd>${escapeHTML(roleLabel)}</dd></div>
            <div><dt>權限管理範圍</dt><dd>${escapeHTML(managedScopeText)}</dd></div>
            <div><dt>大區</dt><dd>${escapeHTML(greatRegion)}</dd></div>
            <div><dt>牧區</dt><dd>${escapeHTML(pastoralZone)}</dd></div>
            <div><dt>小組</dt><dd>${escapeHTML(smallGroup)}</dd></div>
            <div><dt>第一階段計畫</dt><dd>${profile.joined_stage_one === true ? "已加入" : "未加入"}</dd></div>
            <div><dt>會員中心同步</dt><dd>${escapeHTML(syncLabel)}・${escapeHTML(formatAdminUserSyncTime(profile.member_context_synced_at))}</dd></div>
          </dl>
        </div>
      </details>`;
  }).join("");
}

export async function renderAdminUserDirectory() {
  const column = document.getElementById("admin-user-directory-col");
  const search = document.getElementById("admin-user-directory-search");
  const list = document.getElementById("admin-user-directory-list");
  const count = document.getElementById("admin-user-directory-count");
  const incompleteFilter = document.getElementById("admin-user-directory-filter-incomplete");
  const stageOneFilter = document.getElementById("admin-user-directory-filter-stage-one");
  if (!column || !search || !list || !count || !incompleteFilter || !stageOneFilter) return;
  const isAdmin = state.currentUser && getUserRoleCode(state.currentUser) === "admin";
  column.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;
  search.disabled = true;
  incompleteFilter.disabled = true;
  stageOneFilter.disabled = true;
  count.textContent = "讀取中…";
  list.innerHTML = '<div class="admin-user-directory__empty">正在載入使用者資料…</div>';
  const result = await db.fetchAdminUserProfiles();
  if (result.error) {
    count.textContent = "0 人";
    list.innerHTML = '<div class="admin-user-directory__empty">目前無法載入使用者基本資料。</div>';
    return;
  }
  adminUserDirectoryProfiles = result.data || [];
  search.disabled = false;
  incompleteFilter.disabled = false;
  stageOneFilter.disabled = false;
  search.oninput = () => renderAdminUserDirectoryList(search.value);
  incompleteFilter.onchange = () => renderAdminUserDirectoryList(search.value);
  stageOneFilter.onchange = () => renderAdminUserDirectoryList(search.value);
  renderAdminUserDirectoryList(search.value);
}

let managedScopeProfiles = [];

function splitManagedScope(value) {
  return String(value || "").split(",").map(item => item.trim()).filter(Boolean);
}

function getManagedScopeConfig(profile) {
  const role = getUserRoleCode(profile) || "member";
  if (role === "great_zone_leader") {
    return { role, field: "managed_regions", payloadField: "managedRegions", label: "大區", options: state.orgStructure.rawRegions || [] };
  }
  if (role === "zone_leader") {
    return { role, field: "managed_zones", payloadField: "managedZones", label: "牧區", options: state.orgStructure.rawZones || [] };
  }
  if (role === "group_leader") {
    return { role, field: "managed_groups", payloadField: "managedGroups", label: "小組", options: state.orgStructure.rawGroups || [] };
  }
  return { role, field: null, payloadField: null, label: "", options: [] };
}

function getProfileDefaultManagedScopes(profile, config) {
  const explicitScopes = config.field ? splitManagedScope(profile[config.field]) : [];
  if (explicitScopes.length > 0) return explicitScopes;

  if (config.role === "great_zone_leader" && profile.great_region) {
    return [String(profile.great_region).trim()];
  }
  if (config.role === "zone_leader" && profile.pastoral_zone) {
    return [String(profile.pastoral_zone).trim()];
  }
  if (config.role === "group_leader" && profile.small_group) {
    return [String(profile.small_group).trim()];
  }
  return [];
}

function renderManagedScopeProfile(profile) {
  const summary = document.getElementById("admin-managed-scopes-summary");
  const optionsRoot = document.getElementById("admin-managed-scopes-options");
  const selectAll = document.getElementById("admin-managed-scopes-select-all");
  const clear = document.getElementById("admin-managed-scopes-clear");
  const save = document.getElementById("admin-managed-scopes-save");
  if (!summary || !optionsRoot || !selectAll || !clear || !save) return;
  if (!profile) {
    summary.innerHTML = "";
    optionsRoot.innerHTML = '<div class="admin-managed-scopes__empty">找不到可設定的人員。</div>';
    selectAll.disabled = true;
    clear.disabled = true;
    save.disabled = true;
    return;
  }

  const config = getManagedScopeConfig(profile);
  const roleLabel = profile.role_definition?.label || config.role;
  const placement = [profile.great_region, profile.pastoral_zone, profile.small_group].filter(Boolean).join(" / ") || "尚未設定";
  const email = String(profile.email || "").trim() || "未提供電子信箱";
  const defaultScopes = getProfileDefaultManagedScopes(profile, config);
  const effectiveScope = config.role === "admin" || config.role === "senior_pastor"
    ? "全教會"
    : (defaultScopes.join("、") || "僅本人");
  summary.innerHTML = `
    <span>姓名<strong>${escapeHTML(profile.name || "尚未取得姓名")}</strong></span>
    <span>電子信箱<strong>${escapeHTML(email)}</strong></span>
    <span>會員中心角色<strong>${escapeHTML(roleLabel)}</strong></span>
    <span>牧養歸屬<strong>${escapeHTML(placement)}</strong></span>
    <span>目前有效範圍<strong>${escapeHTML(effectiveScope)}</strong></span>`;

  const optionNames = Array.from(new Set([
    ...config.options.map(option => String(option?.name || option?.id || "").trim()),
    ...defaultScopes
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-Hant"));

  if (!config.field) {
    const message = config.role === "admin" || config.role === "senior_pastor"
      ? "此角色固定擁有全教會範圍，不需要另外設定 managed_*。"
      : "此角色只有本人範圍，不使用 managed_*。";
    optionsRoot.innerHTML = `<div class="admin-managed-scopes__empty">${message}</div>`;
  } else if (optionNames.length === 0) {
    optionsRoot.innerHTML = `<div class="admin-managed-scopes__empty">目前沒有可選擇的${config.label}資料。</div>`;
  } else {
    const selected = new Set(defaultScopes);
    optionsRoot.innerHTML = optionNames.map(name => `
      <label class="admin-managed-scopes__option">
        <input type="checkbox" value="${escapeHTML(name)}" ${selected.has(name) ? "checked" : ""}>
        <span>${escapeHTML(name)}</span>
      </label>`).join("");
  }
  optionsRoot.dataset.scopeField = config.payloadField || "";
  selectAll.disabled = !config.field || optionNames.length === 0;
  clear.disabled = !config.field;
  save.disabled = !config.field;
}

function getSelectedManagedScopeProfile() {
  const select = document.getElementById("admin-managed-scopes-profile");
  return managedScopeProfiles.find(profile => String(profile.id) === String(select?.value)) || null;
}

function setManagedScopeFeedback(message, isError = false) {
  const feedback = document.getElementById("admin-managed-scopes-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.style.color = isError ? "var(--color-danger-foreground)" : "var(--color-success-foreground)";
}

export async function renderAdminManagedScopes() {
  const column = document.getElementById("admin-managed-scopes-col");
  const profileSelect = document.getElementById("admin-managed-scopes-profile");
  const optionsRoot = document.getElementById("admin-managed-scopes-options");
  const selectAll = document.getElementById("admin-managed-scopes-select-all");
  const clear = document.getElementById("admin-managed-scopes-clear");
  const save = document.getElementById("admin-managed-scopes-save");
  if (!column || !profileSelect || !optionsRoot || !selectAll || !clear || !save) return;

  const isAdmin = state.currentUser && getUserRoleCode(state.currentUser) === "admin";
  column.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;
  setManagedScopeFeedback("");
  profileSelect.disabled = true;
  optionsRoot.innerHTML = '<div class="admin-managed-scopes__empty">正在載入管理範圍…</div>';

  if (!Array.isArray(state.orgStructure.rawRegions) || state.orgStructure.rawRegions.length === 0) {
    await db.loadOrgStructure();
  }
  const result = await db.fetchManagedScopeProfiles();
  if (result.error) {
    optionsRoot.innerHTML = '<div class="admin-managed-scopes__empty">無法載入管理範圍資料。</div>';
    setManagedScopeFeedback(result.error.message || "無法載入管理範圍資料。", true);
    return;
  }
  managedScopeProfiles = (result.data || []).filter(profile => getUserRoleCode(profile) !== "member");
  profileSelect.innerHTML = "";
  managedScopeProfiles.forEach(profile => {
    const roleLabel = profile.role_definition?.label || getUserRoleCode(profile) || "一般會友";
    profileSelect.options.add(new Option(`${profile.name || "尚未取得姓名"}（${roleLabel}）`, String(profile.id)));
  });
  profileSelect.disabled = managedScopeProfiles.length === 0;
  profileSelect.onchange = () => {
    setManagedScopeFeedback("");
    renderManagedScopeProfile(getSelectedManagedScopeProfile());
  };
  selectAll.onclick = () => optionsRoot.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = true; });
  clear.onclick = () => optionsRoot.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
  save.onclick = async () => {
    const profile = getSelectedManagedScopeProfile();
    const config = getManagedScopeConfig(profile);
    if (!profile || !config.payloadField) return;
    const values = Array.from(optionsRoot.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
    const payload = { managedRegions: [], managedZones: [], managedGroups: [], [config.payloadField]: values };
    save.disabled = true;
    setManagedScopeFeedback("正在儲存…");
    const updateResult = await db.updateManagedScopes(profile.id, payload);
    save.disabled = false;
    if (updateResult.error) {
      setManagedScopeFeedback(updateResult.error.message || "儲存失敗。", true);
      return;
    }
    profile.managed_regions = (updateResult.data?.managedRegions || []).join(",");
    profile.managed_zones = (updateResult.data?.managedZones || []).join(",");
    profile.managed_groups = (updateResult.data?.managedGroups || []).join(",");
    renderManagedScopeProfile(profile);
    setManagedScopeFeedback("管理範圍已儲存。");
    if (typeof showToast === "function") showToast("管理範圍已儲存");
  };
  renderManagedScopeProfile(managedScopeProfiles[0] || null);
}

let adminRegistrationStatistics = null;

function getAdminRegistrationStatisticsPlans() {
  return buildAdminRegistrationStatisticsPlans(Array.isArray(state.globalPlans) ? state.globalPlans : [],
    typeof CHURCH_PLAN_PRESETS !== "undefined" ? CHURCH_PLAN_PRESETS : {});
}

function renderAdminRegistrationStatisticsTable(title, label, rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const body = safeRows.length > 0
    ? safeRows.map(row => `
        <tr>
          <td>${escapeHTML(row.label || "未設定")}</td>
          <td>${Number(row.signupCount || 0)}</td>
          <td>${Number(row.registeredCount || 0)}</td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="admin-registration-statistics__empty">目前沒有資料</td></tr>`;
  return `
    <section class="admin-registration-statistics__table-section">
      <h4>${title}</h4>
      <div class="admin-registration-statistics__table-scroll">
        <table>
          <thead>
            <tr>
              <th>${label}</th>
              <th>報名人數</th>
              <th>註冊人數</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
}

function sanitizeRegistrationStatisticsText(value) {
  return String(value || "未設定")
    .replaceAll("/", "／")
    .replace(/[\r\n]+/g, " ")
    .trim() || "未設定";
}

function getAdminRegistrationStatisticsSummary(context) {
  return resolveAdminRegistrationSummary(context);
}

function renderAdminRegistrationStatisticsSummary(context) {
  const summary = getAdminRegistrationStatisticsSummary(context);
  const items = [
    ["無牧區資料未加入計畫", summary.withoutPastoralZoneNotJoined],
    ["無牧區資料已加入計畫", summary.withoutPastoralZoneJoined],
    ["有牧區資料未加入計畫", summary.withPastoralZoneNotJoined],
    ["有牧區資料已加入計畫", summary.withPastoralZoneJoined],
    ["總參加人數", summary.totalJoined, true],
    ["總註冊人數", summary.totalRegistered, true]
  ];
  return `
    <section class="admin-registration-statistics__summary" aria-labelledby="admin-registration-statistics-summary-title">
      <h4 id="admin-registration-statistics-summary-title">牧區資料與計畫參加總覽</h4>
      <div class="admin-registration-statistics__summary-grid">
        ${items.map(([label, value, isTotal]) => `
          <div class="admin-registration-statistics__summary-item${isTotal ? " admin-registration-statistics__summary-item--total" : ""}">
            <span>${label}</span>
            <strong>${Number(value || 0)}</strong>
          </div>`).join("")}
      </div>
    </section>`;
}

export function formatAdminRegistrationStatisticsText(context) {
  const greatRegions = Array.isArray(context && context.greatRegions) ? context.greatRegions : [];
  const pastoralZones = Array.isArray(context && context.pastoralZones) ? context.pastoralZones : [];
  const summary = getAdminRegistrationStatisticsSummary(context);
  const formatRows = rows => rows.map(row => [
    sanitizeRegistrationStatisticsText(row.label),
    Number(row.signupCount || 0),
    Number(row.registeredCount || 0)
  ].join("/"));
  return [
    "統計項目 / 人數",
    `無牧區資料未加入計畫/${Number(summary.withoutPastoralZoneNotJoined || 0)}`,
    `無牧區資料已加入計畫/${Number(summary.withoutPastoralZoneJoined || 0)}`,
    `有牧區資料未加入計畫/${Number(summary.withPastoralZoneNotJoined || 0)}`,
    `有牧區資料已加入計畫/${Number(summary.withPastoralZoneJoined || 0)}`,
    `總參加人數/${Number(summary.totalJoined || 0)}`,
    `總註冊人數/${Number(summary.totalRegistered || 0)}`,
    "",
    "大區 / 報名人數 / 註冊人數",
    ...formatRows(greatRegions),
    "",
    "牧區 / 報名人數 / 註冊人數",
    ...formatRows(pastoralZones)
  ].join("\r\n");
}

function exportAdminRegistrationStatistics() {
  if (!adminRegistrationStatistics) return;
  const text = formatAdminRegistrationStatisticsText(adminRegistrationStatistics);
  const blob = new Blob(["\uFEFF", text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const planName = String(adminRegistrationStatistics.planName || "讀經計畫")
    .replace(/[\\/:*?"<>|]/g, "-");
  anchor.href = url;
  const todayTW = typeof toTaiwanISODate === "function" ? toTaiwanISODate() : new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  anchor.download = `報名與註冊統計-${planName}-${todayTW}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function renderDailyChaptersReadTrendChart(canvasId, globalPlanId) {
  const canvasEl = document.getElementById(canvasId);
  if (!canvasEl) return;

  const today = new Date();
  const labels = [];
  const data = [];
  const DAYS = 30;

  const logsByDate = {};
  const selectedPlan = (state.globalPlans || []).find(p => String(p.id) === String(globalPlanId) || String(p.presetKey) === String(globalPlanId));
  const planPresetKey = selectedPlan?.presetKey || selectedPlan?.preset_key || globalPlanId;

  const logs = state.isSupabaseMode && state.allLogsCache
    ? state.allLogsCache
    : (state.readingLogs || []);

  logs.forEach(log => {
    if (!log.read_at) return;
    if (globalPlanId) {
      const matchesPlan = (log.global_plan_id && String(log.global_plan_id) === String(globalPlanId)) ||
        (log.plan_id && String(log.plan_id) === String(globalPlanId)) ||
        (planPresetKey && log.presetKey && log.presetKey === planPresetKey) ||
        (planPresetKey && log.preset_key && log.preset_key === planPresetKey);
      if (!matchesPlan && (log.global_plan_id || log.plan_id || log.presetKey || log.preset_key)) {
        return;
      }
    }
    const dStr = log.read_at.substring(0, 10);
    logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
  });

  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dStr = typeof toTaiwanISODate === "function" ? toTaiwanISODate(d) : d.toISOString().substring(0, 10);
    const mmdd = dStr.substring(5).replace('-', '/');
    labels.push(i % 5 === 0 || i === 0 ? mmdd : '');
    data.push(logsByDate[dStr] || 0);
  }

  if (!window._dailyChaptersCharts) window._dailyChaptersCharts = {};
  if (window._dailyChaptersCharts[canvasId]) {
    window._dailyChaptersCharts[canvasId].destroy();
  }

  const isDark = state.theme === 'dark' ||
    document.body.classList.contains('dark-theme') ||
    document.body.classList.contains('dark') ||
    document.documentElement.getAttribute('data-theme') === 'dark';

  const fontColor = isDark ? 'rgba(248, 250, 252, 0.85)' : 'rgba(15, 23, 42, 0.75)';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
  const brandColor = '#04A9D2';
  const brandFill = isDark ? 'rgba(4, 169, 210, 0.22)' : 'rgba(4, 169, 210, 0.12)';

  const ctx = canvasEl.getContext('2d');
  if (typeof Chart !== 'undefined') {
    window._dailyChaptersCharts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '每日閱讀章數',
          data,
          borderColor: brandColor,
          backgroundColor: brandFill,
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: brandColor,
          pointHoverRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `閱讀章數: ${ctx.parsed.y} 章`
            },
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            borderColor: brandColor,
            borderWidth: 1.5,
            titleColor: isDark ? '#F8FAFC' : '#0F172A',
            bodyColor: isDark ? "rgba(226, 232, 240, 0.9)" : "rgba(51, 65, 85, 0.9)",
            padding: 10,
            cornerRadius: 8,
          }
        },
        scales: {
          x: {
            ticks: {
              color: fontColor,
              font: { size: 10, weight: 'bold' },
              maxRotation: 0,
            },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            ticks: {
              color: fontColor,
              font: { size: 10, weight: 'bold' },
              stepSize: 1,
              precision: 0,
            },
            grid: { color: gridColor },
            border: { display: false },
            beginAtZero: true,
          }
        }
      }
    });
  }
}

async function loadAdminRegistrationStatistics(globalPlanId) {
  const content = document.getElementById("admin-registration-statistics-content");
  const exportButton = document.getElementById("admin-registration-statistics-export");
  if (!content || !exportButton) return;
  adminRegistrationStatistics = null;
  exportButton.disabled = true;
  content.innerHTML = '<div class="admin-registration-statistics__empty">讀取統計資料中…</div>';

  const result = await db.getAdminRegistrationStatistics(globalPlanId);
  if (!result || !result.success) {
    content.innerHTML = `
      <div class="admin-registration-statistics__empty" role="status">
        ${escapeHTML(result && result.message || "目前無法載入報名與註冊統計。")}
      </div>`;
    return;
  }

  adminRegistrationStatistics = result.context;
  content.innerHTML = `
    ${renderAdminRegistrationStatisticsSummary(result.context)}
    <div class="admin-registration-statistics__tables">
      ${renderAdminRegistrationStatisticsTable("大區統計", "大區", result.context.greatRegions)}
      ${renderAdminRegistrationStatisticsTable("牧區統計", "牧區", result.context.pastoralZones)}
    </div>
    <section class="admin-registration-statistics__chart-section border border-slate-800 bg-slate-900/90 rounded-xl p-5 shadow-xl mt-4">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-md font-bold text-slate-100 flex items-center gap-2">
          ${typeof renderIcon === "function" ? renderIcon("trendTwo", { size: "sm", className: "nlc-icon text-cyan-400" }) : ""}
          <span id="admin-registration-statistics-chart-title">每天閱讀章數趨勢（近30天）</span>
        </h4>
        <span class="text-xs text-slate-400 font-medium">總章數</span>
      </div>
      <div style="position: relative; height: 220px; width: 100%;">
        <canvas id="admin-registration-daily-chapters-chart"></canvas>
      </div>
    </section>`;
  exportButton.disabled = false;
  renderDailyChaptersReadTrendChart("admin-registration-daily-chapters-chart", globalPlanId);
}

export async function renderAdminRegistrationStatistics() {
  const column = document.getElementById("admin-registration-statistics-col");
  const planSelect = document.getElementById("admin-registration-statistics-plan");
  const exportButton = document.getElementById("admin-registration-statistics-export");
  if (!column || !planSelect || !exportButton) return;

  const isAdmin = state.currentUser && getUserRoleCode(state.currentUser) === "admin";
  column.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;

  const plans = getAdminRegistrationStatisticsPlans();
  planSelect.innerHTML = "";
  if (plans.length === 0) {
    planSelect.options.add(new Option("目前沒有可統計的讀經計畫", ""));
    planSelect.disabled = true;
    document.getElementById("admin-registration-statistics-content").innerHTML =
      '<div class="admin-registration-statistics__empty">目前沒有可統計的讀經計畫。</div>';
    return;
  }

  plans.forEach(plan => planSelect.options.add(new Option(plan.name || "未命名計畫", String(plan.id))));
  // Default to the first phase plan (containing "第一期" or "第1期" in name, or fallback to the oldest plan)
  let defaultPlan = plans.find(plan => (plan.name || "").includes("第1階段") || (plan.name || "").includes("第一輪"));
  if (!defaultPlan && plans.length > 0) {
    defaultPlan = plans[plans.length - 1]; // plans is sorted descending by startDate, so the last is the oldest
  }
  if (defaultPlan && Array.from(planSelect.options).some(option => option.value === String(defaultPlan.id))) {
    planSelect.value = String(defaultPlan.id);
  }
  planSelect.onchange = () => loadAdminRegistrationStatistics(planSelect.value);
  exportButton.onclick = exportAdminRegistrationStatistics;
  await loadAdminRegistrationStatistics(planSelect.value);
  if (typeof hydrateIcons === "function") hydrateIcons(column);
}

export function init() {
  void renderAdminFeatureSettings();
  void renderAdminUserDirectory();
  void renderAdminManagedScopes();
  void renderAdminRegistrationStatistics();
  initAdminTeamRegistration();

  // Bind unjoined plan members section collapse toggle
  const unjoinedHeader = document.querySelector(".admin-unjoined-plan-card__header");
  if (unjoinedHeader && !unjoinedHeader.dataset.listenerBound) {
    unjoinedHeader.dataset.listenerBound = "true";
    unjoinedHeader.addEventListener("click", (event) => {
      if (event.target.closest?.("button")) return;
      const section = document.getElementById("admin-unjoined-plan-section") || unjoinedHeader.closest(".admin-unjoined-plan-card");
      const arrow = document.getElementById("admin-unjoined-toggle-arrow");
      const membersList = document.getElementById("admin-unjoined-plan-members");
      const desc = unjoinedHeader?.querySelector(".admin-unjoined-plan-desc");

      if (section && membersList) {
        const isCollapsed = section.classList.toggle("collapsed");
        if (isCollapsed) {
          membersList.style.display = "none";
          if (desc) desc.style.display = "none";
          if (arrow) arrow.style.transform = "rotate(-90deg)";
        } else {
          membersList.style.display = "";
          if (desc) desc.style.display = "";
          if (arrow) arrow.style.transform = "rotate(0deg)";
        }
      }
    });
  }
}

const MANAGEMENT_ROLES = ['admin', 'senior_pastor', 'great_zone_leader', 'zone_leader', 'group_leader'];
let managementPlanSelectionInitialized = false;

function isSystemAdministrator() {
  const role = (state.currentUser && getUserRoleCode(state.currentUser)) || 'member';

  return role === 'admin';
}

function setAdminPrimaryPanel(panelName) {
  const isAdmin = isSystemAdministrator();
  const requested = panelName === 'system' && isAdmin ? 'system' : 'plans';
  const tabs = document.getElementById('admin-primary-tabs');
  const systemPanel = document.getElementById('admin-system-panel');
  const plansPanel = document.getElementById('admin-plans-panel');
  if (tabs) tabs.classList.toggle('hidden', !isAdmin);
  if (systemPanel) {
    systemPanel.classList.toggle('hidden', requested !== 'system');
    systemPanel.style.display = requested === 'system' ? 'grid' : 'none';
  }
  if (plansPanel) {
    plansPanel.classList.remove('hidden');
    plansPanel.style.display = requested === 'plans' ? 'block' : 'none';
    plansPanel.style.visibility = 'visible';
    plansPanel.style.opacity = '1';
  }
  document.querySelectorAll('[data-admin-panel]').forEach(button => {
    const active = button.dataset.adminPanel === requested;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function mountPlanManagementSections() {
  const participantSlot = document.getElementById('admin-plan-participants-slot');
  const statisticsSlot = document.getElementById('admin-plan-statistics-slot');
  const orgHeader = document.getElementById('plan-org-stats-header');
  const memberList = document.getElementById('member-list-container');
  const statsSection = document.getElementById('stats-group-section');

  if (participantSlot) {
    participantSlot.classList.remove('hidden');
    participantSlot.style.display = 'block';
  }

  if (statisticsSlot) {
    statisticsSlot.classList.remove('hidden');
    statisticsSlot.style.display = 'block';
  }

  if (participantSlot && orgHeader) {
    if (orgHeader.parentElement !== participantSlot) participantSlot.appendChild(orgHeader);
    orgHeader.classList.remove('hidden');
    orgHeader.style.display = 'block';
  }

  if (participantSlot && memberList) {
    if (memberList.parentElement !== participantSlot) participantSlot.appendChild(memberList);
    memberList.classList.remove('hidden');
    memberList.style.display = 'block';
  }

  if (statisticsSlot && statsSection) {
    if (statsSection.parentElement !== statisticsSlot) statisticsSlot.appendChild(statsSection);
    statsSection.classList.remove('hidden');
    statsSection.style.display = 'flex';
  }
}

function getManagementPlanStageNo(plan) {
  const presetMatch = String(plan && plan.presetKey || '').match(/^church_stage_(\d+)$/);
  return Number(plan && plan.stageNo || (presetMatch && presetMatch[1]) || 0);
}

function getManagementPlanStatus(plan, today = new Date()) {
  const startValue = plan && (plan.startDate || plan.start_date);
  const endValue = plan && (plan.endDate || plan.end_date);
  const startDate = startValue ? new Date(`${String(startValue).slice(0, 10)}T00:00:00`) : null;
  const endDate = endValue ? new Date(`${String(endValue).slice(0, 10)}T23:59:59`) : null;
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 'unknown';
  if (today < startDate) return 'upcoming';
  if (today > endDate) return 'completed';
  return 'ongoing';
}

function getManagementPlans() {
  const seen = new Set();
  const plans = [...(state.activePlans || []), ...(state.globalPlans || [])].reduce((result, sourcePlan) => {
    const key = String(sourcePlan.globalPlanId || sourcePlan.id || sourcePlan.presetKey || sourcePlan.name || '');
    if (!key || seen.has(key) || sourcePlan.planKind === 'church_campaign') return result;
    seen.add(key);

    let plan = sourcePlan;
    if ((!Array.isArray(plan.days) || plan.days.length === 0) && typeof generatePlanObject === 'function') {
      const books = plan.books || plan.target_books || [];
      if (books.length > 0) {
        plan = generatePlanObject(plan.name, plan.startDate || plan.start_date, plan.endDate || plan.end_date, books, plan.presetKey || plan.id, plan.level || 'normal', plan.isFixed !== false && plan.is_fixed !== false);
        plan.globalPlanId = sourcePlan.globalPlanId || sourcePlan.id;
        plan.id = sourcePlan.id || plan.id;
        plan.name = sourcePlan.name || plan.name;
        plan.planKind = sourcePlan.planKind;
        plan.stageNo = sourcePlan.stageNo;
      }
    }
    const status = getManagementPlanStatus(plan);
    const isStageOneBootstrap = getManagementPlanStageNo(plan) === 1;
    if ((status === 'ongoing' || status === 'completed' || isStageOneBootstrap)
      && !(typeof isPlanHidden === 'function' && isPlanHidden(plan) && !canManageHiddenPlans())) {
      result.push({ ...plan, managementStatus: status });
    }
    return result;
  }, []);

  const statusPriority = { ongoing: 0, upcoming: 1, completed: 2 };
  return plans.sort((left, right) => {
    const statusDifference = (statusPriority[left.managementStatus] ?? 3) - (statusPriority[right.managementStatus] ?? 3);
    if (statusDifference !== 0) return statusDifference;
    const leftEnd = String(left.endDate || left.end_date || '');
    const rightEnd = String(right.endDate || right.end_date || '');
    return rightEnd.localeCompare(leftEnd);
  });
}

async function selectManagementPlan(planKey) {
  try {
    const plans = getManagementPlans();
    const plan = plans.find(item => [item.globalPlanId, item.id, item.presetKey, item.name].filter(Boolean).map(String).includes(String(planKey))) || plans[0] || null;
    if (!plan) return;
    state.activePlan = plan;
    if (typeof window.syncActivePlanContext === 'function') window.syncActivePlanContext(plan);
    localStorage.setItem('selected_plan_key', String(plan.presetKey || plan.globalPlanId || plan.id || ''));
    window.currentPlanViewState = 'ORG_STATS';
    if (typeof window.renderPlanMembersView === 'function') {
      try { await window.renderPlanMembersView(); } catch (e) { console.warn("[Admin] renderPlanMembersView error caught:", e); }
    }
    try { await renderAdminUnjoinedPlanMembers(true); } catch (e) { console.warn("[Admin] renderAdminUnjoinedPlanMembers error caught:", e); }
    try { await renderAdminTeamRegistrationStatus(false, 3, 'admin-team-status-content'); } catch (e) { console.warn("[Admin] renderAdminTeamRegistrationStatus (3) error caught:", e); }
    try { await renderAdminTeamRegistrationStatus(false, 6, 'admin-team-status-content-6'); } catch (e) { console.warn("[Admin] renderAdminTeamRegistrationStatus (6) error caught:", e); }
    try { renderDailyChaptersReadTrendChart("admin-plan-daily-chapters-chart", planKey); } catch (e) { console.warn("[Admin] renderDailyChaptersReadTrendChart error caught:", e); }
  } catch (err) {
    console.error("[AdminManagement] Error in selectManagementPlan:", err);
  }
}

export async function renderAdminPlanManagement() {
  try {
    const role = (state.currentUser && getUserRoleCode(state.currentUser)) || 'member';
    if (!MANAGEMENT_ROLES.includes(role)) {
      setAdminPrimaryPanel('plans');
      const plansPanel = document.getElementById('admin-plans-panel');
      if (plansPanel) {
        plansPanel.innerHTML = '<div class="admin-unjoined-plan-empty" style="padding: 2rem; text-align: center;">您目前沒有計畫管理權限。</div>';
      }
      return;
    }
    setAdminPrimaryPanel('plans');
    mountPlanManagementSections();

    const select = document.getElementById('admin-management-plan-select');
    const plans = getManagementPlans();
    if (select) {
      select.innerHTML = '';
      if (plans.length === 0) {
        select.options.add(new Option('目前沒有可管理的計畫', ''));
        select.disabled = true;
      } else {
        select.disabled = false;
        plans.forEach(plan => select.options.add(new Option(plan.name || '未命名計畫', String(plan.globalPlanId || plan.id || plan.presetKey || plan.name))));
        const activeKeys = state.activePlan ? [state.activePlan.globalPlanId, state.activePlan.id, state.activePlan.presetKey, state.activePlan.name].filter(Boolean).map(String) : [];
        const matchingOption = Array.from(select.options).find(option => activeKeys.includes(option.value));
        const stageOnePlan = plans.find(plan => getManagementPlanStageNo(plan) === 1);
        const defaultPlan = stageOnePlan || plans.find(plan => plan.managementStatus === 'ongoing') || plans[0];
        const defaultPlanKey = String(defaultPlan.globalPlanId || defaultPlan.id || defaultPlan.presetKey || defaultPlan.name);
        select.value = !managementPlanSelectionInitialized
          ? defaultPlanKey
          : (matchingOption ? matchingOption.value : select.options[0].value);
        managementPlanSelectionInitialized = true;
        select.onchange = () => selectManagementPlan(select.value);
        await selectManagementPlan(select.value);
      }
    }

    document.querySelectorAll('[data-admin-panel]').forEach(button => {
      button.onclick = () => setAdminPrimaryPanel(button.dataset.adminPanel);
    });
    if (typeof hydrateIcons === 'function') hydrateIcons(document.getElementById('admin-view'));
  } catch (err) {
    console.error("[AdminManagement] Error rendering admin plan management:", err);
  }
}

// Bind to window for global access compatibility
window.renderAdminFeatureSettings = renderAdminFeatureSettings;
window.renderAdminPlanManagement = renderAdminPlanManagement;
let activeTeamDivision = 3;
let cachedTeamsData = null;
let cachedTeamsDataKey = "";
let cachedUnjoinedPlanKey = "";
let cachedUnjoinedPlanMembers = [];
let unjoinedPlanRequestId = 0;
let bulkPlanInviteInProgress = false;

function getSelectedManagementOrgFilter() {
  const role = (state.currentUser && getUserRoleCode(state.currentUser)) || "member";
  const region = document.getElementById("members-admin-region-select")?.value || "";
  const zone = document.getElementById("members-admin-zone-select")?.value || "";
  const group = document.getElementById("members-admin-group-select")?.value || "";
  if (group) return { type: "group", value: group };
  if (zone) return { type: "zone", value: zone };
  if (region) return { type: "region", value: region.replace(/^region:/, "") };
  if (role === "group_leader") return { type: "all_groups", value: "" };
  if (role === "zone_leader") return { type: "all_zones", value: "" };
  if (role === "great_zone_leader") return { type: "all_regions", value: "" };
  return { type: "all", value: "" };
}

function teamMatchesManagementOrgFilter(team, filter = getSelectedManagementOrgFilter()) {
  if (!filter || filter.type.startsWith("all")) return true;
  const members = Array.isArray(team && team.members) ? team.members : [];
  const field = filter.type === "region" ? "greatRegion" : filter.type === "zone" ? "pastoralZone" : "smallGroup";
  return members.some(member => String(member && (member[field] || member[
    field === "greatRegion" ? "great_region" : field === "pastoralZone" ? "pastoral_zone" : "small_group"
  ]) || "").split(",").map(value => value.trim()).filter(Boolean).includes(filter.value));
}

function memberMatchesManagementOrgFilter(member, filter = getSelectedManagementOrgFilter()) {
  if (!filter || filter.type.startsWith("all")) return true;
  const field = filter.type === "region" ? "greatRegion" : filter.type === "zone" ? "pastoralZone" : "smallGroup";
  const fallbackField = field === "greatRegion" ? "great_region" : field === "pastoralZone" ? "pastoral_zone" : "small_group";
  return String(member && (member[field] || member[fallbackField]) || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .includes(filter.value);
}

function setBulkPlanInviteButton(button, members, options = {}) {
  if (!button) return [];
  const eligibleMembers = (Array.isArray(members) ? members : [])
    .filter(member => !wasPlanInviteRemindedToday(member));
  const busy = options.busy === true;
  const total = Number(options.total ?? eligibleMembers.length);
  button.disabled = busy || eligibleMembers.length === 0;
  button.textContent = busy
    ? `發送中 ${Number(options.completed || 0)}/${total}`
    : (eligibleMembers.length > 0 ? `全部戳一下（${eligibleMembers.length}）` : "今天皆已提醒");
  return eligibleMembers;
}

async function renderAdminUnjoinedPlanMembers(forceRefresh = false) {
  const container = document.getElementById("admin-unjoined-plan-members");
  const count = document.getElementById("admin-unjoined-plan-count");
  const inviteAllButton = document.getElementById("admin-unjoined-plan-invite-all");
  if (!container || !count || !inviteAllButton) return;

  const currentUser = state.currentUser || {};
  const plan = state.activePlan;
  if (!MANAGEMENT_ROLES.includes(getUserRoleCode(currentUser)) || !plan) {
    count.textContent = "0 人";
    setBulkPlanInviteButton(inviteAllButton, []);
    container.innerHTML = '<div class="admin-unjoined-plan-empty">目前沒有可查看的資料。</div>';
    return;
  }

  const cacheKey = [
    currentUser.id || currentUser.name || "anonymous",
    getUserRoleCode(currentUser) || "member",
    currentUser.managed_regions || currentUser.great_region || "",
    currentUser.managed_zones || currentUser.pastoral_zone || "",
    plan.globalPlanId || plan.id || "",
    plan.presetKey || plan.preset_key || ""
  ].join("|");

  if (forceRefresh || cachedUnjoinedPlanKey !== cacheKey) {
    const requestId = ++unjoinedPlanRequestId;
    cachedUnjoinedPlanKey = cacheKey;
    cachedUnjoinedPlanMembers = [];
    count.textContent = "讀取中";
    inviteAllButton.disabled = true;
    inviteAllButton.textContent = "讀取中…";
    container.innerHTML = '<div class="admin-unjoined-plan-empty">讀取尚未加入的人員中...</div>';

    const result = await db.getUnjoinedPlanMembers(plan);
    if (requestId !== unjoinedPlanRequestId) return;
    if (!result || !result.success) {
      console.warn("Unable to load unjoined plan members", result && (result.error || result.message));
      count.textContent = "0 人";
      setBulkPlanInviteButton(inviteAllButton, []);
      container.innerHTML = `
        <div class="admin-unjoined-plan-empty" role="status">
          <div>目前沒有可顯示的尚未加入人員。</div>
          <button type="button" class="secondary-btn" id="admin-unjoined-plan-retry" style="margin-top:0.75rem;">重新整理</button>
        </div>`;
      const retryButton = document.getElementById("admin-unjoined-plan-retry");
      if (retryButton) retryButton.onclick = () => renderAdminUnjoinedPlanMembers(true);
      return;
    }
    cachedUnjoinedPlanMembers = Array.isArray(result.context && result.context.members)
      ? result.context.members
      : [];
  }

  const visibleMembers = cachedUnjoinedPlanMembers.filter(member => memberMatchesManagementOrgFilter(member));
  count.textContent = `${visibleMembers.length} 人`;
  const eligibleMembers = setBulkPlanInviteButton(inviteAllButton, visibleMembers);
  if (visibleMembers.length === 0) {
    container.innerHTML = '<div class="admin-unjoined-plan-empty">目前篩選範圍內沒有尚未加入所選計畫的人員。</div>';
    return;
  }

  container.innerHTML = visibleMembers.map(member => {
    const memberId = escapeHTML(String(member.id || ""));
    const memberName = escapeHTML(member.name || "未命名使用者");
    const scope = [
      member.greatRegion || member.great_region,
      member.pastoralZone || member.pastoral_zone,
      member.smallGroup || member.small_group
    ].filter(Boolean).map(value => escapeHTML(String(value))).join("・") || "尚未設定牧養資料";
    const reminded = wasPlanInviteRemindedToday(member);
    return `
      <div class="admin-unjoined-plan-member">
        <div class="admin-unjoined-plan-member__identity">
          <div class="admin-unjoined-plan-member__name">${memberName}</div>
          <div class="admin-unjoined-plan-member__scope">${scope}</div>
        </div>
        <button type="button" class="secondary-btn admin-plan-invite-btn icon-button" data-plan-invite-member-id="${memberId}" ${reminded ? "disabled" : ""} title="${reminded ? "今天已提醒" : "戳一下提醒"}" aria-label="${reminded ? "今天已提醒" : "戳一下"}">
          ${reminded ? "今天已提醒" : '<span class="nlc-icon nlc-icon--sm" data-icon="poke" aria-hidden="true"></span>'}
        </button>
      </div>`;
  }).join("");
  if (typeof hydrateIcons === "function") hydrateIcons(container);

  inviteAllButton.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (bulkPlanInviteInProgress || eligibleMembers.length === 0) return;
    const planAtStart = state.activePlan;
    const confirmed = window.confirm(
      `確定要提醒目前篩選範圍內的 ${eligibleMembers.length} 人加入「${planAtStart?.name || "所選計畫"}」嗎？`
    );
    if (!confirmed) return;

    bulkPlanInviteInProgress = true;
    container.querySelectorAll("[data-plan-invite-member-id]").forEach(button => { button.disabled = true; });
    let bulkResult = null;
    try {
      bulkResult = await sendBulkPlanInvitations({
        members: eligibleMembers,
        plan: planAtStart,
        sendInvitation: (targetPlan, memberId) => db.sendPlanJoinInvitation(targetPlan, memberId),
        onProgress: progress => setBulkPlanInviteButton(inviteAllButton, eligibleMembers, {
          busy: true,
          completed: progress.completed,
          total: progress.total
        })
      });
    } finally {
      bulkPlanInviteInProgress = false;
    }

    const {
      sentCount = 0,
      duplicateCount = 0,
      failedMembers = []
    } = bulkResult || {};
    await renderAdminUnjoinedPlanMembers(false);
    const summary = [
      `成功 ${sentCount} 人`,
      duplicateCount > 0 ? `今天已提醒 ${duplicateCount} 人` : "",
      failedMembers.length > 0 ? `失敗 ${failedMembers.length} 人` : ""
    ].filter(Boolean).join("、");
    if (typeof showToast === "function") showToast(`批次提醒完成：${summary}`);
    if (failedMembers.length > 0) {
      console.warn("Bulk plan invitation failures", { planId: planAtStart?.id, members: failedMembers });
    }
  };

  container.querySelectorAll("[data-plan-invite-member-id]").forEach(button => {
    button.onclick = async () => {
      if (button.disabled) return;
      const memberId = button.dataset.planInviteMemberId;
      const member = cachedUnjoinedPlanMembers.find(item => String(item.id) === String(memberId));
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = "提醒中...";
      const result = await db.sendPlanJoinInvitation(state.activePlan, memberId);
      if (!result || !result.success) {
        button.disabled = false;
        button.textContent = originalText;
        if (typeof showToast === "function") showToast(result && result.message ? result.message : "提醒傳送失敗，請稍後再試。");
        return;
      }
      if (member) member.remindedToday = true;
      button.textContent = "今天已提醒";
      if (typeof showToast === "function") showToast(`已提醒 ${member && member.name || "這位夥伴"} 加入「${state.activePlan && state.activePlan.name || "所選計畫"}」`);
    };
  });
}
async function refreshAdminTeamRegistrationFilters() {
  await renderAdminUnjoinedPlanMembers(false);
  await renderAdminTeamRegistrationStatus(false, 3, "admin-team-status-content");
  await renderAdminTeamRegistrationStatus(false, 6, "admin-team-status-content-6");
}

export async function renderAdminTeamRegistrationStatus(forceRefresh = false, division = 3, contentId = division === 6 ? "admin-team-status-content-6" : "admin-team-status-content") {
  const contentEl = document.getElementById(contentId);
  if (!contentEl) return;

  const currentUser = state.currentUser || {};
  const role = getUserRoleCode(currentUser);
  if (!MANAGEMENT_ROLES.includes(role)) return;

  const scopeCacheKey = [
    currentUser.id || currentUser.name || "anonymous",
    role,
    currentUser.managed_regions || currentUser.great_region || "",
    currentUser.managed_zones || currentUser.pastoral_zone || "",
    currentUser.managed_groups || currentUser.small_group || ""
  ].join("|");
  if (cachedTeamsDataKey !== scopeCacheKey) {
    cachedTeamsData = null;
    cachedTeamsDataKey = scopeCacheKey;
  }

  if (!cachedTeamsData || forceRefresh) {
    contentEl.innerHTML = `
      <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        讀取團隊報名資料中...
      </div>
    `;

    const result = await db.getReadingTeamRegistrationOverview();
    if (!result || !result.success) {
      const message = escapeHTML(result && result.message ? result.message : "團隊報名資料讀取失敗，請稍後再試。");
      contentEl.innerHTML = `
        <div class="admin-team-status-empty" role="status" style="padding:2rem; display:flex; flex-direction:column; align-items:center; gap:0.75rem; text-align:center; color:var(--text-secondary);">
          <strong>目前無法載入團隊報名資料</strong>
          <span>${message}</span>
          <button type="button" class="secondary-btn" id="admin-team-status-retry">重新整理</button>
        </div>
      `;
      const retryButton = document.getElementById("admin-team-status-retry");
      if (retryButton) retryButton.onclick = () => renderAdminTeamRegistrationStatus(true, division, contentId);
      return;
    }
    cachedTeamsData = result.context || { summary: {}, plans: [] };
  }

  let overviewPlans = Array.isArray(cachedTeamsData.plans) ? cachedTeamsData.plans : [];
  const selectedPlan = state.activePlan;
  if (selectedPlan) {
    const selectedKeys = [selectedPlan.globalPlanId, selectedPlan.id, selectedPlan.presetKey, selectedPlan.name]
      .filter(Boolean).map(String);
    overviewPlans = overviewPlans.filter(item => selectedKeys.includes(String(item.id)) || selectedKeys.includes(String(item.name)));
  }
  const processedPlans = overviewPlans.map(item => {
    const allTeams = Array.isArray(item.teams) ? item.teams : [];
    const activeOrgFilter = getSelectedManagementOrgFilter();
    const teams = allTeams.filter(team => Number(team.division) === Number(division))
      .filter(team => teamMatchesManagementOrgFilter(team, activeOrgFilter));
    return {
      ...item,
      plan: item,
      teams
    };
  });

  if (processedPlans.length === 0) {
    contentEl.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        目前尚無任何計畫的團隊報名資料。
      </div>
    `;
    return;
  }

  const formatPlanDate = value => {
    if (!value) return "";
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
  };

  let html = "";
  processedPlans.forEach(item => {
    const planName = escapeHTML(item.plan.name || "（無名稱）");
    const planStart = formatPlanDate(item.plan.startDate);
    const planEnd = formatPlanDate(item.plan.endDate);
    const planPeriod = planStart && planEnd ? `${planStart}－${planEnd}` : "";
    const signupCount = item.teams.filter(team => team.status === "forming").length;
    const readyCount = item.teams.filter(t => t.status === "ready").length;
    const totalMembers = item.teams.reduce((acc, t) => acc + (t.memberCount || 0), 0);

    html += `
      <div class="team-plan-section" style="margin-bottom: 2rem;">
        <h4 style="margin: 0 0 0.5rem 0; font-size: 0.95rem; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
          <span class="nlc-icon nlc-icon--sm" data-icon="layers" aria-hidden="true" style="color: var(--primary-color);"></span>
          計畫：${planName}
        </h4>
        ${planPeriod ? `<p style="margin: 0 0 0.65rem; color: var(--text-muted); font-size: 0.75rem;">計畫期間：${planPeriod}</p>` : ""}
        <div style="display: flex; gap: 1rem; font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
          <span>招募中：<strong style="color: var(--primary-color);">${signupCount}</strong> 隊</span>
          <span>已成隊：<strong style="color: var(--color-success-foreground);">${readyCount}</strong> 隊</span>
          <span>總報名人數：<strong>${totalMembers}</strong> 人</span>
        </div>
    `;

    if (item.teams.length === 0) {
      html += `
        <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.8rem; background: var(--bg-input); border-radius: 8px; border: 1px dashed var(--border-card);">
          此計畫目前無 ${division} 人團隊的報名資料。
        </div>
      </div>
      `;
    } else {
      html += `
        <div class="admin-team-table-scroll" style="overflow: auto; max-height: min(60vh, 32rem); background: var(--bg-input); border-radius: 8px; border: 1px solid var(--border-card);">
          <table class="w-full" style="border-collapse: collapse; text-align: left; font-size: 0.8rem; min-width: 600px;">
            <thead style="position: sticky; top: 0; z-index: 2; background: var(--bg-input);">
              <tr style="border-bottom: 1px solid var(--border-card); background: rgba(255,255,255,0.02);">
                ${Number(division) === 3 ? `
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊長所屬牧區</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊名</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊長</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員2</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員3</th>
                ` : `
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊長所屬牧區</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊名</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊長</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員2</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員3</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員4</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員5</th>
                  <th style="padding: 0.6rem 0.8rem; font-weight: 600; color: var(--text-secondary);">隊員6</th>
                `}
              </tr>
            </thead>
            <tbody>
      `;

      item.teams.forEach(team => {
        const members = Array.isArray(team.members) ? team.members : [];
        const captain = members.find(member => member.role === "captain") || {};
        const captainZone = escapeHTML(team.captainPastoralZone || captain.pastoralZone || "未設定");
        const otherMembers = members.filter(member => member.role !== "captain");
        const teamName = escapeHTML(team.name || "（無名稱）");
        const captainName = captain.name ? escapeHTML(captain.name) : "-";
        const teamStatus = team.status === "ready" ? "已成隊" : "招募中";
        const memberCount = Number(team.memberCount || members.length || 0);

        let membersCells = "";
        for (let i = 0; i < Number(division) - 1; i++) {
          const m = otherMembers[i];
          const memberName = m && m.name ? escapeHTML(m.name) : "-";
          const memberZone = m && m.pastoralZone ? `<small style="display:block; margin-top:0.2rem; color:var(--text-muted);">${escapeHTML(m.pastoralZone)}</small>` : "";
          membersCells += `<td style="padding: 0.75rem 0.8rem; color: var(--text-secondary);">${memberName}${memberZone}</td>`;
        }

        html += `
          <tr style="border-bottom: 1px solid var(--border-card); transition: background-color 0.2s;">
            <td style="padding: 0.75rem 0.8rem; font-weight: 500; color: var(--text-primary);">${captainZone}</td>
            <td style="padding: 0.75rem 0.8rem; font-weight: 500; color: var(--text-primary);">
              ${teamName}
              <small style="display:block; margin-top:0.2rem; color:var(--text-muted); font-weight:400;">${teamStatus} · ${memberCount}/${division} 人</small>
            </td>
            <td style="padding: 0.75rem 0.8rem; color: var(--text-primary);">${captainName}</td>
            ${membersCells}
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>
        </div>
      </div>
      `;
    }
  });

  contentEl.innerHTML = html;

  if (typeof hydrateIcons === "function") {
    hydrateIcons(contentEl);
  }
}

export function initAdminTeamRegistration() {
  const tab3 = document.getElementById("admin-team-tab-3");
  const tab6 = document.getElementById("admin-team-tab-6");

  if (tab3 && tab6) {
    tab3.onclick = (e) => {
      e.preventDefault();
      if (activeTeamDivision === 3) return;
      activeTeamDivision = 3;
      tab3.classList.add("active");
      tab6.classList.remove("active");
      renderAdminTeamRegistrationStatus();
    };

    tab6.onclick = (e) => {
      e.preventDefault();
      if (activeTeamDivision === 6) return;
      activeTeamDivision = 6;
      tab6.classList.add("active");
      tab3.classList.remove("active");
      renderAdminTeamRegistrationStatus();
    };
  }
}

window.renderAdminUnjoinedPlanMembers = renderAdminUnjoinedPlanMembers;
window.renderAdminTeamRegistrationStatus = renderAdminTeamRegistrationStatus;
window.refreshAdminTeamRegistrationFilters = refreshAdminTeamRegistrationFilters;
window.initAdminTeamRegistration = initAdminTeamRegistration;
