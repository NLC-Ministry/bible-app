// js/modules/admin.js

import {
  sendBulkPlanInvitations,
  wasPlanInviteRemindedToday
} from "./admin-bulk-plan-invite.mjs";
import {
  buildAdminRegistrationStatisticsPlans,
  selectDefaultAdminRegistrationStatisticsPlan
} from "./admin-registration-plan-options.mjs";
import { resolveAdminRegistrationSummary } from "./admin-registration-summary.mjs";
import {
  ADMIN_ORG_UNASSIGNED,
  ADMIN_PLAN_FILTER_ALL,
  buildAdminUserDirectoryOrgOptions,
  formatProfilePlanTeams,
  getProfilePlanStatus,
  matchesAdminUserDirectoryOrgFilters,
  matchesAdminUserDirectoryPlanFilters
} from "./admin-user-directory-filter.mjs";
import {
  formatTaiwanDate,
  prependTaiwanExportTime
} from "./export-time.mjs";
import { parseQuizImportText } from "./quiz-import.mjs";
import { csvCell } from "./csv-cell.mjs";
import { renderAdminCommentary } from "./admin-commentary.mjs";
import { buildManagedScopeChoices, managedScopeErrorMessage } from "./admin-managed-scope-options.mjs";
import { renderAdminReadingActivity } from "./admin-reading-activity.mjs";
import { formatResponseForDisplay, normalizeQuestion, QUESTION_TYPE_LABELS } from "./quiz-question-types.mjs";
import { renderQuizEvidenceHtml } from "./quiz-evidence.mjs";
import {
  QUIZ_GENERATION_STAGES, quizGenerationElapsedSeconds, renderQuizGenerationErrorHtml, renderQuizGenerationProgressHtml
} from "./quiz-generation-status.mjs";
import { getQuestionImage, questionImageHtml, installQuizImageViewer, quizImagePublicUrl } from "./quiz-image.mjs";
import { canUploadQuizImage, QUIZ_IMAGE_ACCEPT, uploadQuizImageFile } from "./quiz-image-upload.mjs";
import { mountDailyQuizTrial } from "./daily-quiz-trial.mjs";
import {
  ATTEMPT_STATUS_LABELS,
  UNASSIGNED_REGION_LABEL,
  UNASSIGNED_ZONE_LABEL,
  buildOverviewCsv,
  addDays,
  buildRegionCsv,
  buildWeekLeaderboard,
  buildWeekMembersCsv,
  buildWeekRegionCsv,
  buildWeekZoneCsv,
  buildVoucherCsv,
  buildWeeklyTrendCsv,
  buildWeeklyTrendSeries,
  buildZoneCsv,
  filterAttempts,
  formatElapsedSeconds,
  formatRate,
  formatWeekRange,
  formatWeekday,
  formatRankLabel,
  normalizeRankingExcluded,
  pickDayWinners,
  rankAttempts,
  sortZoneRowsByRegion,
  summarizeVouchers,
  VOUCHER_REDEEMED_VIA_LABELS,
  VOUCHER_STATUS_LABELS,
  formatVoucherTime,
  summarizeByRegion,
  summarizeByZone,
  summarizeWeek,
  summarizeWeekByRegion,
  summarizeWeekByZone,
  weekStartOf
} from "./lightning-quiz-analytics.mjs";
import { openLightningQuizPreview, closeLightningQuizPreview } from "./lightning-quiz.mjs";
import {
  DEFAULT_LIGHTNING_QUIZ_SETTINGS,
  LIGHTNING_QUIZ_STAGE_LABELS,
  buildLightningQuizCalendar,
  copyLightningQuizQuestion,
  lightningQuizStage,
  parseLightningImportText,
  planLightningImport
} from "./lightning-quiz-schedule.mjs";
import { ensureChartLib } from "./chart-loader.mjs";
import { listManagementPlans } from "./management-plans.mjs";
import { renderExamPanel } from "./exam.js";

function updatePastoralWallControl(enabled, options = {}) {
  const toggle = document.getElementById("admin-pastoral-wall-toggle");
  const status = document.getElementById("admin-pastoral-wall-status");
  if (!toggle || !status) return;
  toggle.setAttribute("aria-checked", enabled ? "true" : "false");
  toggle.setAttribute("aria-label", enabled ? "牧區分享牆功能已開啟" : "牧區分享牆功能已關閉");
  toggle.disabled = options.disabled === true;
  status.textContent = enabled ? "已開啟：所有堂會成員皆可在首頁看見「牧區分享牆」，進行靈修分享與互動。" : "已關閉：首頁將隱藏「牧區分享牆」，僅保留個人靈修進度紀錄與團隊功能。";
}

function updateDailyQuizFeatureControl(enabled, options = {}) {
  const toggle = document.getElementById("admin-daily-quiz-feature-toggle");
  const status = document.getElementById("admin-daily-quiz-feature-status");
  if (!toggle || !status) return;
  toggle.setAttribute("aria-checked", enabled ? "true" : "false");
  toggle.setAttribute("aria-label", enabled ? "每日小測驗功能已開啟" : "每日小測驗功能已關閉");
  toggle.disabled = options.disabled === true;
  status.textContent = enabled
    ? "已開啟：顯示小測驗入口，並允許每日出題、發佈與作答。"
    : "已關閉：隱藏所有小測驗入口並暫停生成；既有題目與作答資料保留。";
}

function applyAdminDailyQuizFeatureVisibility(enabled) {
  const panel = document.getElementById("admin-section-quizzes");
  if (!enabled && activeAdminSection === "quizzes") setAdminSection("join-status");
  if (!enabled && panel) panel.classList.add("hidden");
  if (typeof renderAdminSectionNav === "function") renderAdminSectionNav();
}

function updateExamFeatureControl(enabled, options = {}) {
  const toggle = document.getElementById("admin-exam-feature-toggle");
  const status = document.getElementById("admin-exam-feature-status");
  if (!toggle || !status) return;
  toggle.setAttribute("aria-checked", enabled ? "true" : "false");
  toggle.setAttribute("aria-label", enabled ? "大測驗（速讀測驗）功能已開啟" : "大測驗（速讀測驗）功能已關閉");
  toggle.disabled = options.disabled === true;
  status.textContent = enabled
    ? "已開啟：計劃管理會出現「大測驗」分頁，可出題、排程、批改與作答。"
    : "已關閉：隱藏「大測驗」分頁並停止作答；既有試卷、題目與成績都會保留。";
}

// 「大測驗」計劃管理分頁：系統管理員 + speed_reading_exam 功能開啟時才顯示。
function applyAdminExamVisibility(enabled) {
  // 系統管理員：完整後台（出題 / 發佈 / 批改 / 統計）。
  // 牧者 / 牧區長 / 區長 / 小組長：只看統計（renderExamPanel 內部判斷，統計依委派範圍）。
  const roleCode = state.currentUser && typeof getUserRoleCode === "function"
    ? getUserRoleCode(state.currentUser) : null;
  const canSee = ["admin", "pastor", "great_zone_leader", "zone_leader", "group_leader"].includes(roleCode);
  const show = canSee && enabled === true;
  const panel = document.getElementById("admin-section-exam");
  if (!show && activeAdminSection === "exam") setAdminSection("join-status");
  if (!show && panel) panel.classList.add("hidden");
  if (typeof renderAdminSectionNav === "function") renderAdminSectionNav();
}

export async function renderAdminFeatureSettings() {
  const card = document.querySelector(".admin-feature-settings-card")?.closest(".card-col");
  const toggle = document.getElementById("admin-pastoral-wall-toggle");
  const feedback = document.getElementById("admin-pastoral-wall-feedback");
  const quizToggle = document.getElementById("admin-daily-quiz-feature-toggle");
  const quizFeedback = document.getElementById("admin-daily-quiz-feature-feedback");
  if (!card || !toggle || !feedback || !quizToggle || !quizFeedback) return;

  const examToggle = document.getElementById("admin-exam-feature-toggle");
  const examFeedback = document.getElementById("admin-exam-feature-feedback");

  const isAdmin = state.currentUser && getUserRoleCode(state.currentUser) === "admin";
  card.classList.toggle("hidden", !isAdmin);

  if (!isAdmin) {
    const [quizResult, examResult] = await Promise.all([
      db.getFeatureSetting("daily_quiz", false),
      db.getFeatureSetting("speed_reading_exam", false)
    ]);
    const quizEnabled = !quizResult.error && quizResult.enabled === true;
    window.dailyQuizFeatureEnabled = quizEnabled;
    applyAdminDailyQuizFeatureVisibility(quizEnabled);
    const examEnabled = !examResult.error && examResult.enabled === true;
    window.speedReadingExamFeatureEnabled = examEnabled;
    applyAdminExamVisibility(examEnabled);
    return;
  }

  feedback.classList.add("hidden");
  feedback.textContent = "";
  updatePastoralWallControl(false, { disabled: true });
  quizFeedback.classList.add("hidden");
  quizFeedback.textContent = "";
  updateDailyQuizFeatureControl(false, { disabled: true });
  if (examFeedback) { examFeedback.classList.add("hidden"); examFeedback.textContent = ""; }
  updateExamFeatureControl(false, { disabled: true });

  const [result, quizResult, examResult] = await Promise.all([
    db.getFeatureSetting("pastoral_sharing_wall", false),
    db.getFeatureSetting("daily_quiz", false),
    db.getFeatureSetting("speed_reading_exam", false)
  ]);
  if (result.error) {
    updatePastoralWallControl(false, { disabled: true });
    feedback.textContent = "無法載入設定：從伺服器獲取牧區分享牆設定失敗。";
    feedback.classList.remove("hidden");
  } else {
    updatePastoralWallControl(result.enabled === true);
  }
  if (quizResult.error) {
    updateDailyQuizFeatureControl(false, { disabled: true });
    quizFeedback.textContent = "無法載入設定：從伺服器獲取每日小測驗設定失敗。";
    quizFeedback.classList.remove("hidden");
  } else {
    const quizEnabled = quizResult.enabled === true;
    window.dailyQuizFeatureEnabled = quizEnabled;
    updateDailyQuizFeatureControl(quizEnabled);
    applyAdminDailyQuizFeatureVisibility(quizEnabled);
  }
  if (examResult.error) {
    updateExamFeatureControl(false, { disabled: true });
    if (examFeedback) {
      examFeedback.textContent = "無法載入設定：從伺服器獲取大測驗設定失敗。";
      examFeedback.classList.remove("hidden");
    }
  } else {
    const examEnabled = examResult.enabled === true;
    window.speedReadingExamFeatureEnabled = examEnabled;
    updateExamFeatureControl(examEnabled);
    applyAdminExamVisibility(examEnabled);
  }
  if (examToggle && !examToggle.dataset.featureSettingBound) {
    examToggle.dataset.featureSettingBound = "true";
    examToggle.addEventListener("click", async () => {
      const currentEnabled = examToggle.getAttribute("aria-checked") === "true";
      const nextEnabled = !currentEnabled;
      updateExamFeatureControl(currentEnabled, { disabled: true });
      examFeedback?.classList.add("hidden");
      const saveResult = await db.updateFeatureSetting("speed_reading_exam", nextEnabled);
      if (saveResult.error) {
        updateExamFeatureControl(currentEnabled);
        if (examFeedback) {
          examFeedback.textContent = "更新設定失敗：無法將設定儲存至伺服器。";
          examFeedback.classList.remove("hidden");
        }
        return;
      }
      window.speedReadingExamFeatureEnabled = nextEnabled;
      updateExamFeatureControl(nextEnabled);
      applyAdminExamVisibility(nextEnabled);
      if (typeof showToast === "function") {
        showToast(nextEnabled ? "大測驗功能已開啟！" : "大測驗功能已關閉。");
      }
    });
  }

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

  if (!quizToggle.dataset.featureSettingBound) {
    quizToggle.dataset.featureSettingBound = "true";
    quizToggle.addEventListener("click", async () => {
      const currentEnabled = quizToggle.getAttribute("aria-checked") === "true";
      const nextEnabled = !currentEnabled;
      updateDailyQuizFeatureControl(currentEnabled, { disabled: true });
      quizFeedback.classList.add("hidden");
      const saveResult = await db.updateFeatureSetting("daily_quiz", nextEnabled);
      if (saveResult.error) {
        updateDailyQuizFeatureControl(currentEnabled);
        quizFeedback.textContent = "更新設定失敗：無法將設定儲存至伺服器。";
        quizFeedback.classList.remove("hidden");
        return;
      }
      window.dailyQuizFeatureEnabled = nextEnabled;
      updateDailyQuizFeatureControl(nextEnabled);
      applyAdminDailyQuizFeatureVisibility(nextEnabled);
      if (nextEnabled) {
        const quizRoot = document.getElementById("admin-daily-quiz-root");
        if (quizRoot) {
          // 清掉計畫 key，下次進小測驗分頁才會重新載入日曆（renderAdminDailyQuizManagement）
          delete quizRoot.dataset.quizPlanKey;
          quizRoot.innerHTML = '<div class="admin-user-directory__empty">小測驗已重新開啟，切換至小測驗分頁後會載入原有資料。</div>';
        }
      }
      window.dispatchEvent(new CustomEvent("daily-quiz-feature-changed", { detail: { enabled: nextEnabled } }));
      if (typeof showToast === "function") showToast(nextEnabled ? "每日小測驗功能已開啟！" : "每日小測驗功能已關閉。資料仍完整保留。");
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

let adminUserDirectoryFilteredProfiles = [];

// Display order for church org units, used by every CSV export that
// includes 大區 or 牧區 data — matches the order leadership actually uses on
// printed rosters, not alphabetical/insertion order. Anything outside the
// known names is still exported, just sorted after them (never silently
// dropped) and alphabetized among itself for determinism.
//
// The order itself is NOT hardcoded here — it's read live from
// state.orgStructure.regionSortOrder / zoneSortOrder, which db.js's
// loadOrgStructure() populates from great_regions/pastoral_zones.sort_order
// (migration 0133). A single source of truth in the database means updating
// the roster order only ever means updating that column, never chasing a
// duplicate array that could drift out of sync with it.
function compareByOrgOrder(sortOrderMap, aLabel, bLabel) {
  const a = String(aLabel || "").trim();
  const b = String(bLabel || "").trim();
  if (typeof window.compareByOrgDisplayOrder === "function") {
    return window.compareByOrgDisplayOrder(sortOrderMap || {})(a, b);
  }
  // db.js helper not loaded yet — alphabetical is still correct, just not
  // custom-ordered until state.orgStructure/that helper are available.
  return a.localeCompare(b, "zh-Hant");
}
function compareGreatRegions(aLabel, bLabel) {
  const orgStructure = typeof state !== "undefined" ? state.orgStructure : null;
  return compareByOrgOrder(orgStructure && orgStructure.regionSortOrder, aLabel, bLabel);
}
function comparePastoralZones(aLabel, bLabel) {
  const orgStructure = typeof state !== "undefined" ? state.orgStructure : null;
  return compareByOrgOrder(orgStructure && orgStructure.zoneSortOrder, aLabel, bLabel);
}

function sortByChurchOrgOrder(items, orderComparator, extractLabel) {
  return [...items].sort((a, b) => orderComparator(extractLabel(a), extractLabel(b)));
}

function sortProfilesByChurchOrgOrder(profiles) {
  return [...profiles].sort((a, b) => {
    const regionCompare = compareGreatRegions(a.great_region, b.great_region);
    if (regionCompare !== 0) return regionCompare;
    const zoneCompare = comparePastoralZones(a.pastoral_zone, b.pastoral_zone);
    if (zoneCompare !== 0) return zoneCompare;
    return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
  });
}

export function convertUserDirectoryToCSV(profiles, exportedAt = new Date()) {
  if (!profiles || profiles.length === 0) return "";
  const headers = ["大區", "牧區", "小組", "姓名", "電子信箱", "角色", "組隊狀態", "帳號狀態"];
  const rows = sortProfilesByChurchOrgOrder(profiles).map(p => [
    p.great_region || "未設定",
    p.pastoral_zone || "未設定牧區",
    p.small_group || "未設定",
    p.name || "未設定",
    p.email || "",
    p.role_definition?.label || p.role_definition?.code || "一般會友",
    p.team_name ? `${p.member_role === "leader" ? "[隊長] " : ""}${p.team_name}` : "未加入團隊 (個人速讀中)",
    p.is_active === false ? "已停用" : "啟用中"
  ]);

  return prependTaiwanExportTime([
    headers.join(","),
    ...rows.map(row => row.map(csvCell).join(","))
  ].join("\n"), exportedAt);
}

export function exportUserDirectoryCSV(profiles = adminUserDirectoryFilteredProfiles) {
  const target = Array.isArray(profiles) ? profiles : adminUserDirectoryProfiles;
  if (!target || target.length === 0) {
    if (typeof showToast === "function") showToast("沒有符合條件的使用者可供匯出。");
    return;
  }
  const csvContent = convertUserDirectoryToCSV(target);
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = formatTaiwanDate();
  link.setAttribute("href", url);
  link.setAttribute("download", `member_directory_${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function convertOrgStructureToCSV(orgStructure = state.orgStructure, exportedAt = new Date()) {
  if (!orgStructure) return "";
  const headers = ["大區", "牧區", "小組"];
  const rows = [];

  const regions = sortByChurchOrgOrder(orgStructure.regions || [], compareGreatRegions, region => region);
  const zonesMap = orgStructure.zones || {};
  const groupsMap = orgStructure.groups || {};

  regions.forEach(region => {
    const zones = sortByChurchOrgOrder(zonesMap[region] || [], comparePastoralZones, zone => zone);
    if (zones.length === 0) {
      rows.push([region, "無下屬牧區", "無下屬小組"]);
    } else {
      zones.forEach(zone => {
        const groups = groupsMap[zone] || [];
        if (groups.length === 0) {
          rows.push([region, zone, "無下屬小組"]);
        } else {
          groups.forEach(group => {
            rows.push([region, zone, group]);
          });
        }
      });
    }
  });

  if (rows.length === 0) return "";
  return prependTaiwanExportTime([
    headers.join(","),
    ...rows.map(row => row.map(csvCell).join(","))
  ].join("\n"), exportedAt);
}

export async function exportOrgStructureCSV() {
  if (!state.orgStructure || !Array.isArray(state.orgStructure.regions) || state.orgStructure.regions.length === 0) {
    if (typeof db.loadOrgStructure === "function") {
      await db.loadOrgStructure();
    }
  }
  const csvContent = convertOrgStructureToCSV(state.orgStructure);
  if (!csvContent) {
    if (typeof showToast === "function") showToast("目前沒有可供匯出的組織架構資料。");
    return;
  }
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = formatTaiwanDate();
  link.setAttribute("href", url);
  link.setAttribute("download", `church_org_structure_${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

let adminUserDirectoryOrgFilterState = { regions: [], zones: [], groups: [] };

const ADMIN_USER_DIRECTORY_ORG_PICKERS = {
  regions: {
    pickerId: "admin-user-directory-filter-region",
    optionsId: "admin-user-directory-filter-region-options",
    summaryId: "admin-user-directory-filter-region-summary",
    allLabel: "全部大區",
    countLabel: "個大區",
    comparator: compareGreatRegions
  },
  zones: {
    pickerId: "admin-user-directory-filter-zone",
    optionsId: "admin-user-directory-filter-zone-options",
    summaryId: "admin-user-directory-filter-zone-summary",
    allLabel: "全部牧區",
    countLabel: "個牧區",
    comparator: comparePastoralZones
  },
  groups: {
    pickerId: "admin-user-directory-filter-group",
    optionsId: "admin-user-directory-filter-group-options",
    summaryId: "admin-user-directory-filter-group-summary",
    allLabel: "全部小組",
    countLabel: "個小組"
  }
};

function getAdminUserDirectoryOrgFilters() {
  return {
    regions: [...adminUserDirectoryOrgFilterState.regions],
    zones: [...adminUserDirectoryOrgFilterState.zones],
    groups: [...adminUserDirectoryOrgFilterState.groups]
  };
}

function sortAdminUserDirectoryOrgValues(values, comparator) {
  return [...values].sort((a, b) => {
    if (a === ADMIN_ORG_UNASSIGNED) return 1;
    if (b === ADMIN_ORG_UNASSIGNED) return -1;
    return comparator ? comparator(a, b) : a.localeCompare(b, "zh-Hant");
  });
}

function renderAdminUserDirectoryOrgPicker(stateKey, values) {
  const config = ADMIN_USER_DIRECTORY_ORG_PICKERS[stateKey];
  const optionsContainer = document.getElementById(config.optionsId);
  const summary = document.getElementById(config.summaryId);
  if (!optionsContainer || !summary) return;

  const sortedValues = sortAdminUserDirectoryOrgValues(values, config.comparator);
  const selectedValues = adminUserDirectoryOrgFilterState[stateKey];
  optionsContainer.replaceChildren();

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "admin-user-directory__org-clear";
  clearButton.dataset.orgFilterClear = stateKey;
  clearButton.textContent = config.allLabel;
  optionsContainer.appendChild(clearButton);

  sortedValues.forEach(value => {
    const label = document.createElement("label");
    label.className = "admin-user-directory__org-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = value;
    checkbox.dataset.orgFilterKey = stateKey;
    checkbox.checked = selectedValues.includes(value);
    const text = document.createElement("span");
    text.textContent = value === ADMIN_ORG_UNASSIGNED ? "未設定" : value;
    label.append(checkbox, text);
    optionsContainer.appendChild(label);
  });

  if (selectedValues.length === 0) {
    summary.textContent = config.allLabel;
  } else if (selectedValues.length === 1) {
    summary.textContent = selectedValues[0] === ADMIN_ORG_UNASSIGNED ? "未設定" : selectedValues[0];
  } else {
    summary.textContent = `${selectedValues.length} ${config.countLabel}`;
  }
}

function refreshAdminUserDirectoryOrgFilterOptions() {
  let options = buildAdminUserDirectoryOrgOptions(adminUserDirectoryProfiles, adminUserDirectoryOrgFilterState);
  adminUserDirectoryOrgFilterState.regions = adminUserDirectoryOrgFilterState.regions
    .filter(value => options.regions.includes(value));
  options = buildAdminUserDirectoryOrgOptions(adminUserDirectoryProfiles, adminUserDirectoryOrgFilterState);
  adminUserDirectoryOrgFilterState.zones = adminUserDirectoryOrgFilterState.zones
    .filter(value => options.zones.includes(value));
  options = buildAdminUserDirectoryOrgOptions(adminUserDirectoryProfiles, adminUserDirectoryOrgFilterState);
  adminUserDirectoryOrgFilterState.groups = adminUserDirectoryOrgFilterState.groups
    .filter(value => options.groups.includes(value));

  renderAdminUserDirectoryOrgPicker("regions", options.regions);
  renderAdminUserDirectoryOrgPicker("zones", options.zones);
  renderAdminUserDirectoryOrgPicker("groups", options.groups);
}

function bindAdminUserDirectoryOrgFilterActions(root, search) {
  if (!root || root.dataset.orgFilterBound === "true") return;
  root.dataset.orgFilterBound = "true";
  root.addEventListener("change", event => {
    const checkbox = event.target.closest("input[data-org-filter-key]");
    if (!checkbox) return;
    const stateKey = checkbox.dataset.orgFilterKey;
    const selected = new Set(adminUserDirectoryOrgFilterState[stateKey]);
    if (checkbox.checked) selected.add(checkbox.value);
    else selected.delete(checkbox.value);
    adminUserDirectoryOrgFilterState[stateKey] = [...selected];
    refreshAdminUserDirectoryOrgFilterOptions();
    renderAdminUserDirectoryList(search.value);
  });
  root.addEventListener("click", event => {
    const clearButton = event.target.closest("[data-org-filter-clear]");
    if (!clearButton) return;
    adminUserDirectoryOrgFilterState[clearButton.dataset.orgFilterClear] = [];
    refreshAdminUserDirectoryOrgFilterOptions();
    renderAdminUserDirectoryList(search.value);
  });
}

function getAdminUserDirectoryPlanFilters() {
  return {
    planId: document.getElementById("admin-user-directory-filter-plan")?.value || "",
    participation: document.getElementById("admin-user-directory-filter-plan-participation")?.value || ADMIN_PLAN_FILTER_ALL,
    team: document.getElementById("admin-user-directory-filter-plan-team")?.value || ADMIN_PLAN_FILTER_ALL,
    currentProfileId: String(state.currentProfileId || state.currentUser?.id || "")
  };
}

// 計畫下拉選單：與報名統計同一份計畫清單，但不列出已隱藏的計畫。
function getAdminUserDirectoryPlans() {
  const globalPlans = Array.isArray(state.globalPlans) ? state.globalPlans : [];
  const hiddenPlanIds = new Set(globalPlans.filter(plan => plan && plan.isHidden).map(plan => String(plan.id)));
  return getAdminRegistrationStatisticsPlans().filter(plan => !plan.isHidden && !hiddenPlanIds.has(String(plan.id)));
}

function populateAdminUserDirectoryPlanSelect(planSelect) {
  const previousValue = planSelect.value;
  const plans = getAdminUserDirectoryPlans();
  planSelect.innerHTML = "";
  plans.forEach(plan => planSelect.options.add(new Option(plan.name || "未命名計畫", String(plan.id))));
  const optionValues = new Set(Array.from(planSelect.options).map(option => option.value));
  if (previousValue && optionValues.has(previousValue)) {
    planSelect.value = previousValue;
    return;
  }
  const defaultPlan = selectDefaultAdminRegistrationStatisticsPlan(plans);
  if (defaultPlan && optionValues.has(String(defaultPlan.id))) planSelect.value = String(defaultPlan.id);
}

function renderAdminUserDirectoryList(query = "") {
  const list = document.getElementById("admin-user-directory-list");
  const count = document.getElementById("admin-user-directory-count");
  if (!list || !count) return;
  const incompleteOnly = document.getElementById("admin-user-directory-filter-incomplete")?.checked === true;
  const planSelect = document.getElementById("admin-user-directory-filter-plan");
  const planFilters = getAdminUserDirectoryPlanFilters();
  const planName = planSelect?.selectedOptions?.[0]?.textContent || "所選計畫";
  const hasPlanFilter = planFilters.participation !== ADMIN_PLAN_FILTER_ALL || planFilters.team !== ADMIN_PLAN_FILTER_ALL;
  const orgFilters = getAdminUserDirectoryOrgFilters();
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase("zh-Hant");
  const filteredProfiles = adminUserDirectoryProfiles.filter(profile => {
    const normalizedName = String(profile.name || "").trim();
    const missingRequiredProfile = !normalizedName || !String(profile.pastoral_zone || "").trim();
    if (incompleteOnly && !missingRequiredProfile) return false;
    if (!matchesAdminUserDirectoryPlanFilters(profile, planFilters)) return false;
    if (!matchesAdminUserDirectoryOrgFilters(profile, orgFilters)) return false;
    const roleLabel = profile.role_definition?.label || profile.role_definition?.code || "一般會友";
    const teamLabel = formatProfilePlanTeams(getProfilePlanStatus(profile, planFilters.planId).teams);
    return [profile.name, profile.email, roleLabel, profile.great_region, profile.pastoral_zone, profile.small_group, teamLabel]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("zh-Hant")
      .includes(normalizedQuery);
  });
  // 匯出的組隊狀態跟著畫面上選的計畫走。
  adminUserDirectoryFilteredProfiles = filteredProfiles.map(profile => ({
    ...profile,
    team_name: formatProfilePlanTeams(getProfilePlanStatus(profile, planFilters.planId).teams) || null,
    member_role: null
  }));
  const hasOrgFilter = Object.values(orgFilters).some(values => values.length > 0);
  count.textContent = normalizedQuery || incompleteOnly || hasPlanFilter || hasOrgFilter
    ? `${filteredProfiles.length} / ${adminUserDirectoryProfiles.length} 人`
    : `${adminUserDirectoryProfiles.length} 人`;

  const appliedFilterCount = Object.values(orgFilters).filter(values => values.length > 0).length
    + (planFilters.participation !== ADMIN_PLAN_FILTER_ALL ? 1 : 0)
    + (planFilters.team !== ADMIN_PLAN_FILTER_ALL ? 1 : 0)
    + (incompleteOnly ? 1 : 0);
  const filtersSummary = document.getElementById("admin-user-directory-filters-summary");
  if (filtersSummary) filtersSummary.textContent = appliedFilterCount > 0 ? `已套用 ${appliedFilterCount} 項` : "未套用";
  const resultsSummary = document.getElementById("admin-user-directory-results-summary");
  if (resultsSummary) resultsSummary.textContent = `${filteredProfiles.length} 人`;

  if (filteredProfiles.length === 0) {
    list.innerHTML = '<div class="admin-user-directory__empty">沒有符合條件的使用者。</div>';
    return;
  }

  list.innerHTML = filteredProfiles.map(profile => {
    const name = String(profile.name || "").trim() || "未設定";
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
    const managedScopeText = config.role === "admin" || config.role === "pastor"
      ? "全教會"
      : (defaultScopes.join("、") || "僅本人");
    const statusClass = profile.is_active === false ? "disabled" : "active";
    const planStatus = getProfilePlanStatus(profile, planFilters.planId);
    const teamText = formatProfilePlanTeams(planStatus.teams) || "未加入團隊 (個人速讀中)";

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
            <div><dt>${escapeHTML(planName)}</dt><dd>${planStatus.joined ? "已加入" : "未加入"}</dd></div>
            <div><dt>團隊組隊狀態</dt><dd>${escapeHTML(teamText)}</dd></div>
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
  const planSelect = document.getElementById("admin-user-directory-filter-plan");
  const participationFilter = document.getElementById("admin-user-directory-filter-plan-participation");
  const teamFilter = document.getElementById("admin-user-directory-filter-plan-team");
  const orgFiltersRoot = document.querySelector(".admin-user-directory__org-filters");
  if (!column || !search || !list || !count || !incompleteFilter || !planSelect
    || !participationFilter || !teamFilter || !orgFiltersRoot) return;
  const isAdmin = state.currentUser && getUserRoleCode(state.currentUser) === "admin";
  column.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;
  const filterControls = [search, incompleteFilter, planSelect, participationFilter, teamFilter];
  filterControls.forEach(control => { control.disabled = true; });
  orgFiltersRoot.setAttribute("aria-disabled", "true");
  count.textContent = "讀取中…";
  if (firstPaint(list)) list.innerHTML = '<div class="admin-user-directory__empty">正在載入使用者資料…</div>';
  populateAdminUserDirectoryPlanSelect(planSelect);
  const result = await db.fetchAdminUserProfiles();
  if (result.error) {
    count.textContent = "0 人";
    list.innerHTML = '<div class="admin-user-directory__empty">目前無法載入使用者基本資料。</div>';
    return false;
  }
  adminUserDirectoryProfiles = result.data || [];
  filterControls.forEach(control => { control.disabled = false; });
  // 沒有可選的計畫時，計畫相關條件無從判斷，保持停用。
  const hasPlans = planSelect.options.length > 0;
  [planSelect, participationFilter, teamFilter].forEach(control => { control.disabled = !hasPlans; });
  orgFiltersRoot.setAttribute("aria-disabled", "false");
  refreshAdminUserDirectoryOrgFilterOptions();
  bindAdminUserDirectoryOrgFilterActions(orgFiltersRoot, search);
  const exportBtn = document.getElementById("admin-user-directory-export-btn");
  if (exportBtn) {
    exportBtn.onclick = () => exportUserDirectoryCSV();
  }
  const orgExportBtn = document.getElementById("admin-export-org-structure-btn");
  if (orgExportBtn) {
    orgExportBtn.onclick = () => exportOrgStructureCSV();
  }
  window.exportUserDirectoryCSV = exportUserDirectoryCSV;
  window.convertUserDirectoryToCSV = convertUserDirectoryToCSV;
  window.exportOrgStructureCSV = exportOrgStructureCSV;
  window.convertOrgStructureToCSV = convertOrgStructureToCSV;
  search.oninput = () => renderAdminUserDirectoryList(search.value);
  incompleteFilter.onchange = () => renderAdminUserDirectoryList(search.value);
  planSelect.onchange = () => renderAdminUserDirectoryList(search.value);
  participationFilter.onchange = () => renderAdminUserDirectoryList(search.value);
  teamFilter.onchange = () => renderAdminUserDirectoryList(search.value);
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
  const effectiveScope = config.role === "admin" || config.role === "pastor"
    ? "全教會"
    : (defaultScopes.join("、") || "僅本人");
  summary.innerHTML = `
    <span>姓名<strong>${escapeHTML(profile.name || "未設定")}</strong></span>
    <span>電子信箱<strong>${escapeHTML(email)}</strong></span>
    <span>會員中心角色<strong>${escapeHTML(roleLabel)}</strong></span>
    <span>牧養歸屬<strong>${escapeHTML(placement)}</strong></span>
    <span>目前有效範圍<strong>${escapeHTML(effectiveScope)}</strong></span>`;

  const { optionNames, selected: selectedScopes, dropped } = buildManagedScopeChoices(config.options, defaultScopes);

  if (!config.field) {
    const message = config.role === "admin" || config.role === "pastor"
      ? "此角色固定擁有全教會範圍，不需要另外設定 managed_*。"
      : "此角色只有本人範圍，不使用 managed_*。";
    optionsRoot.innerHTML = `<div class="admin-managed-scopes__empty">${message}</div>`;
  } else if (optionNames.length === 0) {
    optionsRoot.innerHTML = `<div class="admin-managed-scopes__empty">目前沒有可選擇的${config.label}資料。</div>`;
  } else {
    const selected = new Set(selectedScopes);
    const droppedNote = dropped.length
      ? `<div class="admin-managed-scopes__empty">「${escapeHTML(dropped.join("、"))}」不在${config.label}名單中，未勾選；儲存後會移除。</div>`
      : "";
    optionsRoot.innerHTML = droppedNote + optionNames.map(name => `
      <label class="admin-managed-scopes__option">
        <input type="checkbox" value="${escapeHTML(name)}" ${selected.has(name) ? "checked" : ""}>
        <span>${escapeHTML(name)}</span>
      </label>`).join("");
  }
  optionsRoot.dataset.scopeField = config.payloadField || "";
  selectAll.disabled = !config.field || optionNames.length === 0;
  clear.disabled = !config.field;
  save.disabled = !config.field || optionNames.length === 0;
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
  if (firstPaint(optionsRoot)) optionsRoot.innerHTML = '<div class="admin-managed-scopes__empty">正在載入管理範圍…</div>';

  if (!Array.isArray(state.orgStructure.rawRegions) || state.orgStructure.rawRegions.length === 0) {
    await db.loadOrgStructure();
  }
  const result = await db.fetchManagedScopeProfiles();
  if (result.error) {
    optionsRoot.innerHTML = '<div class="admin-managed-scopes__empty">無法載入管理範圍資料。</div>';
    setManagedScopeFeedback(result.error.message || "無法載入管理範圍資料。", true);
    return false;
  }
  managedScopeProfiles = (result.data || []).filter(profile => getUserRoleCode(profile) !== "member");
  profileSelect.innerHTML = "";
  managedScopeProfiles.forEach(profile => {
    const roleLabel = profile.role_definition?.label || getUserRoleCode(profile) || "一般會友";
    profileSelect.options.add(new Option(`${profile.name || "未設定"}（${roleLabel}）`, String(profile.id)));
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
      setManagedScopeFeedback(managedScopeErrorMessage(updateResult.error), true);
      return;
    }
    profile.managed_regions = (updateResult.data?.managedRegions || []).join(",");
    profile.managed_zones = (updateResult.data?.managedZones || []).join(",");
    profile.managed_groups = (updateResult.data?.managedGroups || []).join(",");
    renderManagedScopeProfile(profile);
    setManagedScopeFeedback("管理範圍已儲存。");
    if (typeof showToast === "function") showToast("管理範圍已儲存");
    void renderAdminOrgPermissionsOverview();
  };
  renderManagedScopeProfile(managedScopeProfiles[0] || null);
}

let orgPermissionsProfiles = [];

function jumpToManagedScopeEditor(profileId) {
  const column = document.getElementById("admin-managed-scopes-col");
  const select = document.getElementById("admin-managed-scopes-profile");
  if (!column || !select) return;
  const profile = orgPermissionsProfiles.find(candidate => String(candidate.id) === String(profileId));
  if (!profile) return;
  select.value = String(profileId);
  setManagedScopeFeedback("");
  renderManagedScopeProfile(profile);
  column.scrollIntoView({ behavior: "smooth", block: "start" });
}
window.jumpToManagedScopeEditor = jumpToManagedScopeEditor;

function renderLeaderChips(leaders) {
  if (!leaders || leaders.length === 0) {
    return '<span class="admin-org-permissions__unassigned">尚未指派</span>';
  }
  return leaders.map(profile => {
    const name = escapeHTML(String(profile.name || "").trim() || "未設定");
    const id = escapeHTML(String(profile.id || ""));
    return `<button type="button" class="admin-org-permissions__leader-chip" data-jump-profile-id="${id}">${name}</button>`;
  }).join("");
}

export async function renderAdminOrgPermissionsOverview() {
  const column = document.getElementById("admin-org-permissions-col");
  const tree = document.getElementById("admin-org-permissions-tree");
  const count = document.getElementById("admin-org-permissions-count");
  if (!column || !tree || !count) return;

  const isAdmin = state.currentUser && getUserRoleCode(state.currentUser) === "admin";
  column.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;

  count.textContent = "讀取中…";
  if (firstPaint(tree)) tree.innerHTML = '<div class="admin-user-directory__empty">正在載入組織架構…</div>';

  if (!Array.isArray(state.orgStructure.regions) || state.orgStructure.regions.length === 0) {
    await db.loadOrgStructure();
  }
  const result = await db.fetchManagedScopeProfiles();
  if (result.error) {
    tree.innerHTML = '<div class="admin-user-directory__empty">無法載入權限總覽。</div>';
    count.textContent = "";
    return false;
  }
  orgPermissionsProfiles = (result.data || []).filter(profile => getUserRoleCode(profile) !== "member");

  const WHOLE_CHURCH_ROLE_ORDER = ["admin", "pastor"];
  const WHOLE_CHURCH_ROLE_LABELS = { admin: "系統管理員", pastor: "牧者" };
  const wholeChurchLeadersByRole = new Map(WHOLE_CHURCH_ROLE_ORDER.map(role => [role, []]));
  const regionLeaders = new Map();
  const zoneLeaders = new Map();
  const groupLeaders = new Map();

  orgPermissionsProfiles.forEach(profile => {
    const role = getUserRoleCode(profile);
    if (wholeChurchLeadersByRole.has(role)) {
      wholeChurchLeadersByRole.get(role).push(profile);
      return;
    }
    const config = getManagedScopeConfig(profile);
    const scopes = getProfileDefaultManagedScopes(profile, config);
    const bucket = role === "great_zone_leader" ? regionLeaders
      : role === "zone_leader" ? zoneLeaders
      : role === "group_leader" ? groupLeaders
      : null;
    if (!bucket) return;
    scopes.forEach(scopeName => {
      if (!bucket.has(scopeName)) bucket.set(scopeName, []);
      bucket.get(scopeName).push(profile);
    });
  });

  const regions = state.orgStructure.regions || [];
  const zonesMap = state.orgStructure.zones || {};
  const groupsMap = state.orgStructure.groups || {};

  const unassignedCount = regions.filter(r => !regionLeaders.has(r)).length
    + Object.values(zonesMap).flat().filter(z => !zoneLeaders.has(z)).length
    + Object.values(groupsMap).flat().filter(g => !groupLeaders.has(g)).length;
  count.textContent = unassignedCount > 0 ? `${unassignedCount} 個單位尚未指派` : "全部已指派";

  const wholeChurchHtml = WHOLE_CHURCH_ROLE_ORDER.map(role => `
    <div class="admin-org-permissions__whole-church">
      <span>${escapeHTML(WHOLE_CHURCH_ROLE_LABELS[role])}（全教會範圍）</span>
      <div class="admin-org-permissions__leaders">${renderLeaderChips(wholeChurchLeadersByRole.get(role))}</div>
    </div>`).join("");

  const regionsHtml = regions.length === 0
    ? '<div class="admin-user-directory__empty">目前沒有任何大區資料。</div>'
    : regions.map(region => {
      const zones = zonesMap[region] || [];
      const zonesHtml = zones.map(zone => {
        const groups = groupsMap[zone] || [];
        const groupsHtml = groups.length === 0 ? "" : `
          <ul class="admin-org-permissions__groups">
            ${groups.map(group => `
              <li class="admin-org-permissions__group-row">
                <span class="admin-org-permissions__unit-name">${escapeHTML(group)}</span>
                <div class="admin-org-permissions__leaders">${renderLeaderChips(groupLeaders.get(group))}</div>
              </li>`).join("")}
          </ul>`;
        return `
          <details class="admin-org-permissions__zone">
            <summary>
              <span class="admin-org-permissions__unit-name">${escapeHTML(zone)}</span>
              <div class="admin-org-permissions__leaders">${renderLeaderChips(zoneLeaders.get(zone))}</div>
            </summary>
            ${groupsHtml}
          </details>`;
      }).join("");
      return `
        <details class="admin-org-permissions__region" open>
          <summary>
            <span class="admin-org-permissions__unit-name">${escapeHTML(region)}</span>
            <div class="admin-org-permissions__leaders">${renderLeaderChips(regionLeaders.get(region))}</div>
          </summary>
          ${zonesHtml || '<div class="admin-user-directory__empty">此大區目前沒有牧區資料。</div>'}
        </details>`;
    }).join("");

  tree.innerHTML = wholeChurchHtml + regionsHtml;

  if (!tree.dataset.jumpBound) {
    tree.dataset.jumpBound = "true";
    tree.addEventListener("click", event => {
      const chip = event.target.closest("[data-jump-profile-id]");
      if (!chip) return;
      jumpToManagedScopeEditor(chip.dataset.jumpProfileId);
    });
  }
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
          <td>${Number(row.team3Count || 0)}</td>
          <td>${Number(row.team6Count || 0)}</td>
        </tr>`).join("")
    : `<tr><td colspan="5" class="admin-registration-statistics__empty">目前沒有資料</td></tr>`;
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
              <th>3 人團隊人數</th>
              <th>6 人團隊人數</th>
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

export function convertAdminRegistrationStatisticsToCSV(context, exportedAt = new Date()) {
  const greatRegions = Array.isArray(context && context.greatRegions) ? context.greatRegions : [];
  const pastoralZones = Array.isArray(context && context.pastoralZones) ? context.pastoralZones : [];
  const summary = getAdminRegistrationStatisticsSummary(context);
  const esc = csvCell;
  const formatRows = rows => rows.map(row => [
    esc(sanitizeRegistrationStatisticsText(row.label)),
    esc(Number(row.signupCount || 0)),
    esc(Number(row.registeredCount || 0)),
    esc(Number(row.team3Count || 0)),
    esc(Number(row.team6Count || 0))
  ].join(","));

  return prependTaiwanExportTime([
    [esc("統計項目"), esc("人數")].join(","),
    [esc("無牧區資料未加入計畫"), esc(Number(summary.withoutPastoralZoneNotJoined || 0))].join(","),
    [esc("無牧區資料已加入計畫"), esc(Number(summary.withoutPastoralZoneJoined || 0))].join(","),
    [esc("有牧區資料未加入計畫"), esc(Number(summary.withPastoralZoneNotJoined || 0))].join(","),
    [esc("有牧區資料已加入計畫"), esc(Number(summary.withPastoralZoneJoined || 0))].join(","),
    [esc("總參加人數"), esc(Number(summary.totalJoined || 0))].join(","),
    [esc("總註冊人數"), esc(Number(summary.totalRegistered || 0))].join(","),
    "",
    [esc("大區"), esc("報名人數"), esc("註冊人數"), esc("3 人團隊人數"), esc("6 人團隊人數")].join(","),
    ...formatRows(sortByChurchOrgOrder(greatRegions, compareGreatRegions, row => row.label)),
    "",
    [esc("牧區"), esc("報名人數"), esc("註冊人數"), esc("3 人團隊人數"), esc("6 人團隊人數")].join(","),
    ...formatRows(sortByChurchOrgOrder(pastoralZones, comparePastoralZones, row => row.label))
  ].join("\n"), exportedAt);
}

function exportAdminRegistrationStatistics() {
  if (!adminRegistrationStatistics) return;
  const csvContent = convertAdminRegistrationStatisticsToCSV(adminRegistrationStatistics);
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const planName = String(adminRegistrationStatistics.planName || "讀經計畫")
    .replace(/[\\/:*?"<>|]/g, "-");
  anchor.href = url;
  const todayTW = formatTaiwanDate();
  anchor.download = `報名與註冊統計-${planName}-${todayTW}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Zone leaders come from the org-permissions data source (managed_zones/pastoral_zone), not the registration-stats RPC — it has no leader field. */
async function buildPastoralZoneLeaderNameMap() {
  const map = new Map();
  const result = await db.fetchManagedScopeProfiles();
  if (result.error) return map;
  (result.data || []).forEach(profile => {
    if (getUserRoleCode(profile) !== "zone_leader") return;
    const config = getManagedScopeConfig(profile);
    const scopes = getProfileDefaultManagedScopes(profile, config);
    const name = String(profile.name || "").trim();
    if (!name) return;
    scopes.forEach(zoneName => {
      const existing = map.get(zoneName);
      map.set(zoneName, existing ? `${existing}、${name}` : name);
    });
  });
  return map;
}

export async function buildAdminRegistrationStatisticsSheetPayload(context) {
  const greatRegions = Array.isArray(context && context.greatRegions) ? context.greatRegions : [];
  const pastoralZones = Array.isArray(context && context.pastoralZones) ? context.pastoralZones : [];
  const summary = getAdminRegistrationStatisticsSummary(context);
  const leaderNameByZone = await buildPastoralZoneLeaderNameMap();

  const toRow = row => ({
    label: sanitizeRegistrationStatisticsText(row.label),
    signupCount: Number(row.signupCount || 0),
    registeredCount: Number(row.registeredCount || 0),
    team3Count: Number(row.team3Count || 0),
    team6Count: Number(row.team6Count || 0)
  });

  return {
    planName: String(context && context.planName || ""),
    greatRegions: sortByChurchOrgOrder(greatRegions, compareGreatRegions, row => row.label).map(toRow),
    pastoralZones: sortByChurchOrgOrder(pastoralZones, comparePastoralZones, row => row.label).map(row => ({
      ...toRow(row),
      leaderName: leaderNameByZone.get(sanitizeRegistrationStatisticsText(row.label)) || ""
    })),
    summary: {
      withoutPastoralZoneNotJoined: Number(summary.withoutPastoralZoneNotJoined || 0),
      withoutPastoralZoneJoined: Number(summary.withoutPastoralZoneJoined || 0),
      withPastoralZoneNotJoined: Number(summary.withPastoralZoneNotJoined || 0),
      withPastoralZoneJoined: Number(summary.withPastoralZoneJoined || 0),
      totalJoined: Number(summary.totalJoined || 0),
      totalRegistered: Number(summary.totalRegistered || 0)
    }
  };
}

async function syncAdminRegistrationStatisticsToSheet() {
  if (!adminRegistrationStatistics) return;
  const button = document.getElementById("admin-registration-statistics-sheet-sync");
  if (button) {
    button.disabled = true;
    button.textContent = "更新中…";
  }
  try {
    const payload = await buildAdminRegistrationStatisticsSheetPayload(adminRegistrationStatistics);
    const result = await db.syncRegistrationStatisticsToSheet(payload);
    if (typeof showToast === "function") {
      showToast(result && result.success ? "已更新到 Google 試算表。" : (result && result.message) || "更新到 Google 試算表失敗，請稍後再試。");
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "更新到 Google 試算表";
    }
  }
}

async function loadAdminRegistrationStatistics(globalPlanId) {
  const content = document.getElementById("admin-registration-statistics-content");
  const exportButton = document.getElementById("admin-registration-statistics-export");
  const sheetSyncButton = document.getElementById("admin-registration-statistics-sheet-sync");
  if (!content || !exportButton) return;
  adminRegistrationStatistics = null;
  exportButton.disabled = true;
  if (sheetSyncButton) sheetSyncButton.disabled = true;
  if (firstPaint(content)) content.innerHTML = '<div class="admin-registration-statistics__empty">讀取統計資料中…</div>';

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
    </div>`;
  exportButton.disabled = false;
  if (sheetSyncButton) sheetSyncButton.disabled = false;
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
  const defaultPlan = selectDefaultAdminRegistrationStatisticsPlan(plans);
  if (defaultPlan && Array.from(planSelect.options).some(option => option.value === String(defaultPlan.id))) {
    planSelect.value = String(defaultPlan.id);
  }
  planSelect.onchange = () => loadAdminRegistrationStatistics(planSelect.value);
  exportButton.onclick = exportAdminRegistrationStatistics;
  const sheetSyncButton = document.getElementById("admin-registration-statistics-sheet-sync");
  if (sheetSyncButton) sheetSyncButton.onclick = syncAdminRegistrationStatisticsToSheet;
  await loadAdminRegistrationStatistics(planSelect.value);
  if (typeof hydrateIcons === "function") hydrateIcons(column);
}

let editingAdminAnnouncementId = null;
let editingAdminLightningQuizId = null;

function parseAdminAnnouncement(announcement = {}) {
  const rawTitle = String(announcement.title || "").trim();
  const urgent = /【重要】|\[重要\]|【緊急】|\[緊急\]/i.test(rawTitle);
  return {
    ...announcement,
    type: urgent ? "urgent" : "general",
    cleanTitle: rawTitle.replace(/【重要】|\[重要\]|【緊急】|\[緊急\]|【一般】|\[一般\]|【公告】|\[公告\]/gi, "").trim()
  };
}

function formatAdminAnnouncementTime(value) {
  if (!value) return "";
  if (typeof formatTaiwanDateTime === "function") return formatTaiwanDateTime(value, { relative: true });
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

function toAnnouncementLocalInput(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultUrgentAnnouncementExpiry() {
  return toAnnouncementLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
}

function syncAdminAnnouncementExpiryField(options = {}) {
  const type = document.getElementById("admin-announcement-type");
  const field = document.getElementById("admin-announcement-expiry-field");
  const input = document.getElementById("admin-announcement-expires-at");
  const urgent = type?.value === "urgent";
  field?.classList.toggle("hidden", !urgent);
  if (input) {
    input.required = urgent;
    if (urgent && !input.value && options.fillDefault !== false) input.value = defaultUrgentAnnouncementExpiry();
    if (!urgent) input.value = "";
  }
}

function closeAdminAnnouncementEditor() {
  editingAdminAnnouncementId = null;
  document.getElementById("admin-announcement-editor")?.classList.add("hidden");
  const title = document.getElementById("admin-announcement-title");
  const content = document.getElementById("admin-announcement-content");
  const type = document.getElementById("admin-announcement-type");
  const expiresAt = document.getElementById("admin-announcement-expires-at");
  const heading = document.getElementById("admin-announcement-form-title");
  const save = document.getElementById("admin-announcement-save");
  if (title) title.value = "";
  if (content) content.value = "";
  if (expiresAt) expiresAt.value = "";
  if (type) type.value = "general";
  syncAdminAnnouncementExpiryField({ fillDefault: false });
  if (heading) heading.textContent = "新增公告";
  if (save) save.textContent = "發布公告";
}

function openAdminAnnouncementEditor(announcement = null) {
  const parsed = parseAdminAnnouncement(announcement || {});
  editingAdminAnnouncementId = parsed.id || null;
  const editor = document.getElementById("admin-announcement-editor");
  const title = document.getElementById("admin-announcement-title");
  const content = document.getElementById("admin-announcement-content");
  const type = document.getElementById("admin-announcement-type");
  const expiresAt = document.getElementById("admin-announcement-expires-at");
  const heading = document.getElementById("admin-announcement-form-title");
  const save = document.getElementById("admin-announcement-save");
  editor?.classList.remove("hidden");
  if (title) title.value = parsed.cleanTitle;
  if (content) content.value = parsed.content || "";
  if (type) type.value = parsed.type;
  if (expiresAt) expiresAt.value = toAnnouncementLocalInput(parsed.expires_at);
  syncAdminAnnouncementExpiryField();
  if (heading) heading.textContent = editingAdminAnnouncementId ? "編輯公告" : "新增公告";
  if (save) save.textContent = editingAdminAnnouncementId ? "儲存修改" : "發布公告";
  title?.focus();
}

export async function renderAdminAnnouncements() {
  const host = document.getElementById("admin-announcements-list");
  const createButton = document.getElementById("admin-announcement-create");
  const cancelButton = document.getElementById("admin-announcement-cancel");
  const saveButton = document.getElementById("admin-announcement-save");
  const typeSelect = document.getElementById("admin-announcement-type");
  if (!host || !createButton || !cancelButton || !saveButton) return;

  createButton.onclick = () => openAdminAnnouncementEditor();
  cancelButton.onclick = closeAdminAnnouncementEditor;
  typeSelect.onchange = () => syncAdminAnnouncementExpiryField();
  saveButton.onclick = async () => {
    const title = document.getElementById("admin-announcement-title")?.value.trim() || "";
    const content = document.getElementById("admin-announcement-content")?.value.trim() || "";
    const type = document.getElementById("admin-announcement-type")?.value === "urgent" ? "urgent" : "general";
    const expiryInput = document.getElementById("admin-announcement-expires-at")?.value || "";
    if (!title || !content) {
      showToast("請輸入公告標題與內容。");
      return;
    }
    if (type === "urgent" && !expiryInput) {
      showToast("重要／緊急公告請設定顯示到期時間。");
      return;
    }
    const isEditing = Boolean(editingAdminAnnouncementId);
    const storedTitle = `${type === "urgent" ? "【緊急】" : "【一般】"}${title}`;
    const expiresAt = type === "urgent" ? new Date(expiryInput).toISOString() : null;
    saveButton.disabled = true;
    const success = isEditing
      ? await db.updateAnnouncement(editingAdminAnnouncementId, storedTitle, content, expiresAt)
      : await db.saveAnnouncement(storedTitle, content, expiresAt);
    saveButton.disabled = false;
    if (!success) return;
    showToast(isEditing ? "公告已更新。" : "公告已發布。");
    closeAdminAnnouncementEditor();
    await renderAdminAnnouncements();
  };

  const announcements = await db.fetchAnnouncements();
  if (!announcements.length) {
    host.innerHTML = '<div class="admin-user-directory__empty">目前尚無公告，請按「新增公告」。</div>';
    return;
  }

  host.innerHTML = announcements.map(announcement => {
    const parsed = parseAdminAnnouncement(announcement);
    const urgent = parsed.type === "urgent";
    const expiryTime = Date.parse(parsed.expires_at || "") || 0;
    const expired = urgent && expiryTime > 0 && expiryTime <= Date.now();
    return `
    <article class="announcement-item${urgent ? " announcement-item--featured" : ""}" data-admin-announcement-id="${escapeHTML(String(announcement.id))}">
      <div class="announcement-item__header">
        <div class="announcement-item__header-left">
          <div class="announcement-item__icon-avatar" aria-hidden="true"><span class="nlc-icon nlc-icon--sm" data-icon="${urgent ? "flame" : "megaphone"}"></span></div>
          <div class="announcement-item__title-group">
            <div class="announcement-item__tags"><span class="announcement-badge ${urgent ? "announcement-badge--danger" : "announcement-badge--default"}"><span class="nlc-icon nlc-icon--sm" data-icon="${urgent ? "flame" : "megaphone"}" aria-hidden="true"></span><span>${urgent ? "重要／緊急公告" : "一般公告"}</span></span>${expired ? '<span class="stat-badge stat-badge--neutral">已到期</span>' : ""}</div>
            <h4 class="announcement-item__title">${escapeHTML(parsed.cleanTitle)}</h4>
          </div>
        </div>
        <div class="announcement-item__meta">
          <time class="announcement-item__time">${urgent && parsed.expires_at ? `顯示至 ${escapeHTML(formatAdminAnnouncementTime(parsed.expires_at))}` : escapeHTML(formatAdminAnnouncementTime(announcement.updated_at || announcement.created_at))}</time>
          <button type="button" class="circular-action-btn announcement-item__edit" data-announcement-edit title="編輯公告" aria-label="編輯公告"><span class="nlc-icon nlc-icon--sm" data-icon="pencil" aria-hidden="true"></span></button>
          <button type="button" class="circular-action-btn btn-danger-soft announcement-item__delete" data-announcement-delete title="刪除公告" aria-label="刪除公告"><span class="nlc-icon nlc-icon--sm" data-icon="trash" aria-hidden="true"></span></button>
        </div>
      </div>
      <p class="announcement-item__body">${escapeHTML(announcement.content || "")}</p>
    </article>`;
  }).join("");

  host.querySelectorAll("[data-admin-announcement-id]").forEach(card => {
    const announcement = announcements.find(item => String(item.id) === card.dataset.adminAnnouncementId);
    card.querySelector("[data-announcement-edit]")?.addEventListener("click", () => openAdminAnnouncementEditor(announcement));
    card.querySelector("[data-announcement-delete]")?.addEventListener("click", async () => {
      const confirmed = await window.showConfirmDialog({
        title: "確定要刪除此公告嗎？",
        message: "此動作會立即從首頁移除公告，且無法復原。",
        confirmText: "確認刪除",
        cancelText: "取消",
        isDestructive: true
      });
      if (!confirmed) return;
      if (await db.deleteAnnouncement(announcement.id)) {
        showToast("公告已刪除。");
        closeAdminAnnouncementEditor();
        await renderAdminAnnouncements();
      }
    });
  });
  if (typeof hydrateIcons === "function") hydrateIcons(host);
}

// ── 首頁「雲柱測驗」(lightning quiz, migration 0202) ───────────────────────
// 完全獨立於 daily_quiz／speed_reading_exam；單題編輯器重用 daily_quiz 自訂
// 題目編輯器（ADMIN_QUIZ_CUSTOM_TYPE_LABELS / renderAdminQuizCustomQuestionBodyHtml
// / bindAdminQuizCustomQuestionBlock 等，定義在本檔案後段）的題型一～五輸入
// UI，因為題型定義、payload/answerKey 形狀完全共用（quiz-question-types.mjs）。
// 一次只編輯「一題」，所以不重用它的多題清單管理（新增/刪除/編號）那層。

// 題目附圖（#449、#585）：目前的 image 存在 fieldset 的 data-lq-image 上，存檔時帶回
// payload.image，不會因為表單只重組 stem/選項就把圖洗掉。在系統管理後台（照搬區塊）裡可以
// 「加入／更換／移除圖片」，圖片經 admin-api 上傳到 Supabase 的 quiz-images；不能上傳的地方
// 只顯示目前的圖。
function renderAdminLightningQuizImageSectionHtml(image) {
  const canUpload = canUploadQuizImage();
  if (!image && !canUpload) return '';
  const actions = canUpload ? `<div class="admin-lq-image__actions">
      <button type="button" class="secondary-btn" data-lq-image-pick>${image ? '更換圖片' : '加入圖片'}</button>
      ${image ? '<button type="button" class="secondary-btn" data-lq-image-remove>移除圖片</button>' : ''}
      <input type="file" accept="${QUIZ_IMAGE_ACCEPT}" data-lq-image-file hidden>
    </div>` : '';
  if (!image) {
    return `<div class="admin-lq-image" data-lq-image-section>
      <span class="admin-lq-image__label">題目附圖（選填，會顯示在題目下方）</span>
      ${actions}
    </div>`;
  }
  return `<div class="admin-lq-image" data-lq-image-section>
    <div class="admin-lq-image-note"><img src="${adminQuizEscape(image.src)}" alt="${adminQuizEscape(image.alt)}"><span>此題附圖，存檔時會一起儲存。</span></div>
    <label>圖片說明（給看不到圖的人，可留白）<input type="text" class="form-control" data-lq-image-alt maxlength="200" value="${image.alt === '題目附圖' ? '' : adminQuizEscape(image.alt)}" placeholder="例如：祭司獻燔祭的七個場景"></label>
    ${actions}
  </div>`;
}

function setAdminLightningQuizFieldsetImage(fieldset, image) {
  if (image) fieldset.dataset.lqImage = JSON.stringify(image);
  else delete fieldset.dataset.lqImage;
  const section = fieldset.querySelector('[data-lq-image-section]');
  if (section) section.outerHTML = renderAdminLightningQuizImageSectionHtml(getQuestionImage({ image }));
}

function bindAdminLightningQuizImageSection(fieldset) {
  if (!fieldset || !canUploadQuizImage()) return;
  fieldset.addEventListener('click', event => {
    if (event.target.closest('[data-lq-image-pick]')) {
      fieldset.querySelector('[data-lq-image-file]')?.click();
    } else if (event.target.closest('[data-lq-image-remove]')) {
      setAdminLightningQuizFieldsetImage(fieldset, null);
    }
  });
  fieldset.addEventListener('change', async event => {
    const input = event.target.closest('[data-lq-image-file]');
    if (!input) return;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const pick = fieldset.querySelector('[data-lq-image-pick]');
    const pickLabel = pick?.textContent;
    if (pick) { pick.disabled = true; pick.textContent = '上傳中…'; }
    try {
      const name = await uploadQuizImageFile(file);
      const src = quizImagePublicUrl(name);
      if (!src) throw new Error('上傳成功，但組不出圖片網址，請重新整理後再試。');
      const alt = fieldset.querySelector('[data-lq-image-alt]')?.value.trim() || '';
      setAdminLightningQuizFieldsetImage(fieldset, { src, alt: alt || '題目附圖' });
      showToast('圖片已上傳，記得按「儲存」。');
    } catch (error) {
      if (pick?.isConnected) { pick.disabled = false; pick.textContent = pickLabel; }
      showToast(error?.message || '上傳失敗，請再試一次。');
    }
  });
}

function renderAdminLightningQuizQuestionFieldsetHtml(question) {
  const normalized = question && question.type ? question : adminQuizCustomDefaultQuestion('single');
  const type = normalized.type || 'single';
  const image = getQuestionImage(normalized.payload);
  return `<fieldset class="admin-daily-quiz-question admin-quiz-custom-question" data-question-type="${type}" ${image ? `data-lq-image="${adminQuizEscape(JSON.stringify(normalized.payload.image))}"` : ''}>
    <label>題型<select class="form-control" data-field="type">
      ${Object.entries(ADMIN_QUIZ_CUSTOM_TYPE_LABELS).map(([value, label]) => `<option value="${value}" ${type === value ? 'selected' : ''}>${label}</option>`).join('')}
    </select></label>
    <label>題目<textarea class="form-control" data-field="stem" rows="2" placeholder="請輸入題目內容">${adminQuizEscape(normalized.payload?.stem || '')}</textarea></label>
    ${renderAdminLightningQuizImageSectionHtml(image)}
    <div data-question-body>${renderAdminQuizCustomQuestionBodyHtml(normalized)}</div>
    <label>詳解（作答結束後才顯示，可留白）<textarea class="form-control" data-field="explanation" rows="2" placeholder="例如：步驟名稱、經文出處">${adminQuizEscape(normalized.explanation || '')}</textarea></label>
  </fieldset>`;
}

// 讀取一題雲柱測驗題目（不需要 id/verseRef：雲柱測驗一次只有一題）。
// explanation 是獨立欄位、不放進 payload——payload 在作答時段內就會傳給會友。
function collectAdminLightningQuizQuestion(fieldset) {
  const question = collectAdminLightningQuizQuestionContent(fieldset);
  const imageJson = fieldset.dataset.lqImage;
  if (imageJson) {
    try { question.payload.image = JSON.parse(imageJson); } catch (_) { /* 壞掉的就不帶 */ }
    const altInput = fieldset.querySelector('[data-lq-image-alt]');
    if (altInput && question.payload.image && typeof question.payload.image === 'object') {
      question.payload.image = { ...question.payload.image, alt: altInput.value.trim() || '題目附圖' };
    }
  }
  question.explanation = fieldset.querySelector('[data-field="explanation"]')?.value.trim() || '';
  return question;
}

function collectAdminLightningQuizQuestionContent(fieldset) {
  const type = fieldset.querySelector('[data-field="type"]')?.value || 'single';
  const stem = fieldset.querySelector('[data-field="stem"]')?.value.trim() || '';

  if (type === 'truefalse') {
    const answerKey = fieldset.querySelector('[data-field="answerKey"]')?.value === 'true';
    return { type, payload: { stem }, answerKey };
  }
  if (type === 'single' || type === 'multiple') {
    const rows = Array.from(fieldset.querySelectorAll('[data-option-row]'));
    const options = rows.map(row => row.querySelector('[data-option-text]')?.value.trim() || '');
    if (type === 'single') {
      const correctIndex = rows.findIndex(row => row.querySelector('[data-option-correct]')?.checked);
      return { type, payload: { stem, options }, answerKey: correctIndex };
    }
    const answerKey = rows.reduce((acc, row, optionIndex) => {
      if (row.querySelector('[data-option-correct]')?.checked) acc.push(optionIndex);
      return acc;
    }, []);
    return { type, payload: { stem, options }, answerKey };
  }
  if (type === 'matching') {
    const rows = Array.from(fieldset.querySelectorAll('[data-pair-row]'));
    const left = rows.map((row, i) => ({ id: `L${i + 1}`, text: row.querySelector('[data-pair-left]')?.value.trim() || '' }));
    const right = rows.map((row, i) => ({ id: `R${i + 1}`, text: row.querySelector('[data-pair-right]')?.value.trim() || '' }));
    const answerKey = {};
    left.forEach((item, i) => { answerKey[item.id] = right[i].id; });
    return { type, payload: { stem, left, right }, answerKey };
  }
  if (type === 'ordering') {
    const rows = Array.from(fieldset.querySelectorAll('[data-item-row]'));
    const items = rows.map((row, i) => ({ id: `I${i + 1}`, text: row.querySelector('[data-item-text]')?.value.trim() || '' }));
    return { type, payload: { stem, items }, answerKey: items.map(item => item.id) };
  }
  return { type, payload: { stem }, answerKey: null };
}

function adminLightningQuizQuestionIsValid(question) {
  if (!question?.payload?.stem) return false;
  switch (question.type) {
    case 'truefalse':
      return typeof question.answerKey === 'boolean';
    case 'single': {
      const options = question.payload.options || [];
      return options.length >= 2 && options.every(Boolean)
        && Number.isInteger(question.answerKey) && question.answerKey >= 0 && question.answerKey < options.length;
    }
    case 'multiple': {
      const options = question.payload.options || [];
      return options.length >= 2 && options.every(Boolean)
        && Array.isArray(question.answerKey) && question.answerKey.length > 0;
    }
    case 'matching': {
      const left = question.payload.left || [];
      const right = question.payload.right || [];
      return left.length >= 2 && left.length === right.length
        && left.every(item => item.text) && right.every(item => item.text);
    }
    case 'ordering': {
      const items = question.payload.items || [];
      return items.length >= 2 && items.every(item => item.text);
    }
    default:
      return false;
  }
}

function formatAdminLightningQuizDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'short' });
}

// ── 彈出面板（#313、#317）─────────────────────────────────────────────
// 內容短的畫面（試作、題目內容、排程規則）是彈出面板（手機從下方滑出，桌機
// 置中）。面板在 index.html 裡就放在 body 底下，打開時不搬移：iPhone 上從後台
// 捲動區塊搬出來的面板曾經看得到卻點不到（#420）。✕ 與 Esc 能關（點外面不關，
// 避免誤觸），關掉後焦點回到原本按的按鈕。內容長的畫面（新增／編輯、匯入、作答
// 明細）是下面的完整頁面。
const adminLightningQuizSheetOpeners = new Map();
const adminLightningQuizSheetCloseHooks = {};

function closeAdminLightningQuizSheet(id) {
  const sheet = document.getElementById(id);
  if (!sheet || sheet.classList.contains('hidden')) return;
  sheet.classList.add('hidden');
  sheet.setAttribute('aria-hidden', 'true');
  adminLightningQuizSheetCloseHooks[id]?.();
  const opener = adminLightningQuizSheetOpeners.get(id);
  adminLightningQuizSheetOpeners.delete(id);
  if (opener?.isConnected) opener.focus?.();
}

function openAdminLightningQuizSheet(id) {
  const sheet = document.getElementById(id);
  if (!sheet) return null;
  if (!sheet.dataset.lqSheetBound) {
    sheet.dataset.lqSheetBound = 'true';
    sheet.addEventListener('click', event => {
      // 點面板外面不關閉，避免誤觸（#317）；只有 ✕ 與 Esc 會關
      if (event.target.closest('[data-lq-sheet-close]')) closeAdminLightningQuizSheet(id);
    });
  }
  if (!document.body.dataset.lqSheetEscBound) {
    document.body.dataset.lqSheetEscBound = 'true';
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const open = [...document.querySelectorAll('.admin-lq-sheet-backdrop:not(.hidden)')].pop();
      if (open) closeAdminLightningQuizSheet(open.id);
    });
  }
  adminLightningQuizSheetOpeners.set(id, document.activeElement);
  sheet.classList.remove('hidden');
  sheet.setAttribute('aria-hidden', 'false');
  sheet.querySelector('.bottom-sheet-body')?.scrollTo?.(0, 0);
  return sheet;
}

// ── 完整頁面（#317）──────────────────────────────────────────────────────
// 新增／編輯、匯入、作答明細在雲柱測驗區塊裡整頁顯示，主畫面（分頁區）先隱藏。
// 「← 返回雲柱測驗」回到原本的分頁與位置；isDirty() 為真時先確認要不要放棄。
let adminLightningQuizOpenSubpage = null;
const adminLightningQuizSubpageCloseHooks = {};

function openAdminLightningQuizSubpage(id, { isDirty = () => false } = {}) {
  const page = document.getElementById(id);
  const main = document.querySelector('.admin-lq');
  if (!page) return null;
  closeAdminLightningQuizSheet('admin-lightning-quiz-question-sheet');
  const previous = adminLightningQuizOpenSubpage;
  if (previous && previous.id !== id) {
    document.getElementById(previous.id)?.classList.add('hidden');
    adminLightningQuizSubpageCloseHooks[previous.id]?.();
  }
  adminLightningQuizOpenSubpage = {
    id,
    isDirty,
    opener: previous ? previous.opener : document.activeElement,
    scrollY: previous ? previous.scrollY : (window.scrollY || 0)
  };
  page.querySelectorAll('[data-lq-subpage-back]').forEach(button => {
    button.onclick = () => { void closeAdminLightningQuizSubpage(); };
  });
  main?.classList.add('hidden');
  page.classList.remove('hidden');
  page.scrollIntoView?.({ block: 'start' });
  return page;
}

async function closeAdminLightningQuizSubpage({ force = false } = {}) {
  const current = adminLightningQuizOpenSubpage;
  if (!current) return true;
  if (!force && current.isDirty()) {
    const confirmed = await window.showConfirmDialog({
      title: '要放棄這些內容嗎？',
      message: '剛剛輸入的內容還沒有儲存，返回後就會消失。',
      confirmText: '放棄並返回',
      cancelText: '繼續編輯',
      isDestructive: true
    });
    if (!confirmed) return false;
  }
  if (adminLightningQuizOpenSubpage !== current) return true;
  adminLightningQuizOpenSubpage = null;
  document.getElementById(current.id)?.classList.add('hidden');
  adminLightningQuizSubpageCloseHooks[current.id]?.();
  document.querySelector('.admin-lq')?.classList.remove('hidden');
  // 回到原本的位置：原本按的按鈕還在就捲過去；清單重畫過了就回到原本的捲動位置
  if (current.opener?.isConnected && current.opener.closest?.('.admin-lq')) {
    current.opener.scrollIntoView?.({ block: 'center' });
    current.opener.focus?.({ preventScroll: true });
  } else {
    try { window.scrollTo(0, current.scrollY); } catch (_) { /* 沒有捲動就算了 */ }
  }
  return true;
}

// 手機返回鍵（js/app.js 的 popstate）：先關彈窗、再關完整頁面，都沒有才離開後台區塊。
window.closeAdminLightningQuizLayer = () => {
  // 雲柱測驗區塊沒在畫面上（切到別的分頁或別的後台功能）就不攔返回鍵
  const section = document.getElementById('admin-section-lightning-quiz');
  if (!section || section.classList.contains('hidden') || !section.closest('.view-pane.active')) return false;
  const openSheet = [...document.querySelectorAll('.admin-lq-sheet-backdrop:not(.hidden)')].pop();
  if (openSheet) {
    closeAdminLightningQuizSheet(openSheet.id);
    return true;
  }
  if (adminLightningQuizOpenSubpage) {
    void closeAdminLightningQuizSubpage();
    return true;
  }
  return false;
};

// ── 新增／編輯題目 ─────────────────────────────────────────────────────────
function resetAdminLightningQuizEditor() {
  editingAdminLightningQuizId = null;
  const riseDate = document.getElementById('admin-lightning-quiz-rise-date');
  const timeStart = document.getElementById('admin-lightning-quiz-time-start');
  const timeEnd = document.getElementById('admin-lightning-quiz-time-end');
  const body = document.getElementById('admin-lightning-quiz-question-body');
  const heading = document.getElementById('admin-lightning-quiz-form-title');
  if (riseDate) riseDate.value = '';
  if (timeStart) timeStart.value = '';
  if (timeEnd) timeEnd.value = '';
  if (body) body.innerHTML = '';
  if (heading) heading.textContent = '新增題目';
}
adminLightningQuizSubpageCloseHooks['admin-lightning-quiz-editor'] = resetAdminLightningQuizEditor;

function adminLightningQuizEditorSnapshot() {
  const fieldset = document.querySelector('#admin-lightning-quiz-question-body fieldset');
  return JSON.stringify([
    document.getElementById('admin-lightning-quiz-rise-date')?.value || '',
    document.getElementById('admin-lightning-quiz-time-start')?.value || '',
    document.getElementById('admin-lightning-quiz-time-end')?.value || '',
    fieldset ? collectAdminLightningQuizQuestion(fieldset) : null
  ]);
}

// 新增、編輯（還沒開始的題目）、複製成新題（已開始的題目：內容帶進來、日期留空，
// 存成新的準備中題目）。開始後的題目不能編輯（#309）。新增時帶入排程規則的預設
// 時段；從日曆的「缺題」進來會再帶入那一天（prefill，#310）。
function openAdminLightningQuizEditor(question = null, { copy = false, prefill = null } = {}) {
  const rule = adminLightningQuizSettings || DEFAULT_LIGHTNING_QUIZ_SETTINGS;
  const source = copy
    ? copyLightningQuizQuestion(question)
    : question || { id: null, riseDate: '', riseTimeStart: rule.timeStart, riseTimeEnd: rule.timeEnd, ...prefill };
  const riseDate = document.getElementById('admin-lightning-quiz-rise-date');
  const timeStart = document.getElementById('admin-lightning-quiz-time-start');
  const timeEnd = document.getElementById('admin-lightning-quiz-time-end');
  const body = document.getElementById('admin-lightning-quiz-question-body');
  const heading = document.getElementById('admin-lightning-quiz-form-title');
  if (!body) return;

  closeAdminLightningQuizSheet('admin-lightning-quiz-question-sheet');
  editingAdminLightningQuizId = source?.id || null;
  if (riseDate) riseDate.value = source?.riseDate || '';
  if (timeStart) timeStart.value = source?.riseTimeStart?.slice(0, 5) || '';
  if (timeEnd) timeEnd.value = source?.riseTimeEnd?.slice(0, 5) || '';
  body.innerHTML = renderAdminLightningQuizQuestionFieldsetHtml(source ? {
    type: source.questionType,
    payload: source.payload,
    answerKey: source.answerKey,
    explanation: source.explanation
  } : null);
  bindAdminQuizCustomQuestionBlock(body.querySelector('fieldset'), () => {});
  bindAdminLightningQuizImageSection(body.querySelector('fieldset'));
  if (typeof hydrateIcons === 'function') hydrateIcons(body);
  if (heading) heading.textContent = copy ? '複製成新題（請選新的日期）' : question ? '編輯題目' : '新增題目';
  const snapshot = adminLightningQuizEditorSnapshot();
  openAdminLightningQuizSubpage('admin-lightning-quiz-editor', { isDirty: () => adminLightningQuizEditorSnapshot() !== snapshot });
  (source?.riseDate ? body.querySelector('textarea, input') : riseDate)?.focus?.();
}

// ── 試作：在後台跑完整作答流程，任何時間都能做，不寫入任何作答紀錄 ──────────
adminLightningQuizSheetCloseHooks['admin-lightning-quiz-preview'] = () => {
  const host = document.getElementById('admin-lightning-quiz-preview-host');
  if (host) closeLightningQuizPreview(host);
};

function openAdminLightningQuizPreviewPanel(question) {
  const host = document.getElementById('admin-lightning-quiz-preview-host');
  if (!host) return;
  const previewQuestion = {
    questionType: question.questionType,
    payload: question.payload,
    answerKey: question.answerKey
  };
  closeAdminLightningQuizSheet('admin-lightning-quiz-question-sheet');
  openAdminLightningQuizSheet('admin-lightning-quiz-preview');
  openLightningQuizPreview(host, previewQuestion);
  const restart = document.getElementById('admin-lightning-quiz-preview-restart');
  const close = document.getElementById('admin-lightning-quiz-preview-close');
  if (restart) restart.onclick = () => openLightningQuizPreview(host, previewQuestion);
  if (close) close.onclick = () => closeAdminLightningQuizSheet('admin-lightning-quiz-preview');
}

function adminLightningQuizTaipeiNow() {
  const now = new Date();
  return {
    date: now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }),
    time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Taipei', hour12: false })
  };
}

const ADMIN_LIGHTNING_QUIZ_STAGE_BADGE_KIND = {
  draft: 'warning',
  scheduled: 'brand',
  live: 'success',
  ended: 'neutral'
};

function adminLightningQuizStageBadge(stage) {
  return `<span class="stat-badge stat-badge--${ADMIN_LIGHTNING_QUIZ_STAGE_BADGE_KIND[stage]}" data-lightning-quiz-stage="${stage}">${LIGHTNING_QUIZ_STAGE_LABELS[stage]}</span>`;
}

function formatAdminLightningQuizWhen(question) {
  return `${formatAdminLightningQuizDate(question.riseDate)} ${(question.riseTimeStart || '').slice(0, 5)}–${(question.riseTimeEnd || '').slice(0, 5)}`;
}

// 題目面板裡的排程、取消排程、刪除在面板內原地確認：按鈕列換成確認列，不再疊一層
// 確認框，畫面上永遠只有一層彈窗（#420）。回傳 { confirmed, restore }；確認後按鈕
// 停用，請求失敗時呼叫 restore() 回到原本的按鈕列。
function confirmInAdminLightningQuizDetail({ title, message, confirmText, cancelText = '返回', isDestructive = false }) {
  const body = document.getElementById('admin-lightning-quiz-question-sheet-body');
  const actions = body?.querySelector('.admin-lq-detail__actions');
  if (!body || !actions) return Promise.resolve({ confirmed: false, restore: () => {} });
  body.querySelector('[data-lq-detail-confirm]')?.remove();
  const opener = document.activeElement;
  const row = document.createElement('div');
  row.className = 'admin-lq-detail__confirm';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-labelledby', 'admin-lq-detail-confirm-title');
  row.dataset.lqDetailConfirm = '';
  row.innerHTML = `
    <p class="admin-lq-detail__confirm-title" id="admin-lq-detail-confirm-title">${escapeHTML(title)}</p>
    <p class="admin-lq-detail__confirm-message">${escapeHTML(message)}</p>
    <div class="admin-lq-detail__confirm-actions">
      <button type="button" class="secondary-btn" data-lq-detail-confirm-cancel>${escapeHTML(cancelText)}</button>
      <button type="button" class="${isDestructive ? 'danger-btn' : 'primary-btn'}" data-lq-detail-confirm-ok>${escapeHTML(confirmText)}</button>
    </div>`;
  actions.classList.add('hidden');
  actions.after(row);
  const restore = () => {
    row.remove();
    actions.classList.remove('hidden');
    if (opener?.isConnected) opener.focus?.();
  };
  return new Promise(resolve => {
    row.querySelector('[data-lq-detail-confirm-cancel]').addEventListener('click', () => {
      restore();
      resolve({ confirmed: false, restore });
    });
    row.querySelector('[data-lq-detail-confirm-ok]').addEventListener('click', () => {
      row.querySelectorAll('button').forEach(button => { button.disabled = true; });
      resolve({ confirmed: true, restore });
    });
    row.querySelector('[data-lq-detail-confirm-cancel]').focus?.();
  });
}

async function changeAdminLightningQuizStatus(question, nextStatus) {
  const dialog = nextStatus === 'published'
    ? {
      title: '確定要排程這一題嗎？',
      message: `排程後，會友會在 ${formatAdminLightningQuizWhen(question)} 看到這一題。開始之前都還可以修改或取消排程。`,
      confirmText: '排程'
    }
    : {
      title: '確定要取消排程嗎？',
      message: '取消後回到「準備中」，會友看不到這一題。',
      confirmText: '取消排程'
    };
  const { confirmed, restore } = await confirmInAdminLightningQuizDetail(dialog);
  if (!confirmed) return;

  const result = await db.adminSetLightningQuizStatus(question.id, nextStatus);
  if (!result.success) {
    restore();
    showToast(result.message || '更新狀態失敗，請稍後再試。');
    return;
  }
  showToast(nextStatus === 'published' ? '已排程。' : '已取消排程，回到準備中。');
  closeAdminLightningQuizSheet('admin-lightning-quiz-question-sheet');
  await renderAdminLightningQuizQuestions();
  void renderAdminLightningQuizStats();
}

async function deleteAdminLightningQuizQuestion(question) {
  const { confirmed, restore } = await confirmInAdminLightningQuizDetail({
    title: '確定要刪除這一題雲柱測驗嗎？',
    message: '此動作無法復原。',
    confirmText: '確認刪除',
    cancelText: '取消',
    isDestructive: true
  });
  if (!confirmed) return;
  const result = await db.adminDeleteLightningQuizQuestion(question.id);
  if (!result.success) {
    restore();
    showToast(result.message || '刪除失敗，請稍後再試。');
    return;
  }
  showToast('題目已刪除。');
  closeAdminLightningQuizSheet('admin-lightning-quiz-question-sheet');
  await renderAdminLightningQuizQuestions();
  void renderAdminLightningQuizStats();
}

// 作答明細（#316、#317）：完整頁面，從統計的「逐日明細」或「每週統計」進來。
function openAdminLightningQuizResults(day) {
  const title = document.getElementById('admin-lightning-quiz-results-title');
  const body = document.getElementById('admin-lightning-quiz-results-body');
  if (!body || !day) return;
  if (title) title.textContent = `${formatAdminLightningQuizDate(day.riseDate)} 作答明細`;
  openAdminLightningQuizSubpage('admin-lightning-quiz-results');
  void renderAdminLightningQuizDetail(body, day);
}

// ── 題目面板：看題目與正解，所有操作都在這裡 ─────────────────────────────────
function openAdminLightningQuizDetail(question) {
  const body = document.getElementById('admin-lightning-quiz-question-sheet-body');
  const title = document.getElementById('admin-lightning-quiz-question-sheet-title');
  if (!body || !question) return;
  const stage = lightningQuizStage(question, adminLightningQuizTaipeiNow());
  // 已開始或已有人作答（locked）：不能編輯、不能取消排程、不能刪除，只能複製成新題
  const locked = question.locked === true;
  const payload = question.payload || {};
  const options = Array.isArray(payload.options) ? payload.options : [];
  installQuizImageViewer();
  if (title) title.textContent = formatAdminLightningQuizWhen(question);
  body.innerHTML = `
    <div class="announcement-item__tags">
      <span class="announcement-badge announcement-badge--default"><span>${escapeHTML(ADMIN_QUIZ_CUSTOM_TYPE_LABELS[question.questionType] || question.questionType)}</span></span>
      ${adminLightningQuizStageBadge(stage)}
    </div>
    <p class="admin-lq-detail__stem">${escapeHTML(payload.stem || '')}</p>
    ${questionImageHtml(payload)}
    ${options.length ? `<ol class="admin-lq-detail__options" type="A">${options.map(option => `<li>${escapeHTML(option)}</li>`).join('')}</ol>` : ''}
    <p class="admin-lq-detail__answer">正解：<strong>${escapeHTML(formatResponseForDisplay(question.questionType, payload, question.answerKey))}</strong></p>
    ${question.explanation ? `<p class="admin-lq-detail__explanation">詳解：${escapeHTML(question.explanation)}</p>` : ''}
    ${locked ? '<p class="admin-daily-quiz-note">已經開始或有人作答，題目已鎖定；要沿用請按「複製成新題」。</p>' : ''}
    <div class="admin-lq-detail__actions">
      <button type="button" class="secondary-btn" data-lq-detail-action="try">試作</button>
      ${stage === 'draft' ? '<button type="button" class="primary-btn" data-lq-detail-action="schedule" data-lightning-quiz-status="published">排程</button>' : ''}
      ${stage !== 'draft' && !locked ? '<button type="button" class="secondary-btn" data-lq-detail-action="unschedule" data-lightning-quiz-status="draft">取消排程</button>' : ''}
      ${locked ? '' : '<button type="button" class="secondary-btn" data-lq-detail-action="edit" data-lightning-quiz-edit>編輯</button>'}
      <button type="button" class="secondary-btn" data-lq-detail-action="copy" data-lightning-quiz-copy>複製成新題</button>
      ${locked ? '' : '<button type="button" class="secondary-btn admin-lq-detail__delete" data-lq-detail-action="delete" data-lightning-quiz-delete>刪除</button>'}
    </div>`;
  body.querySelectorAll('[data-lq-detail-action]').forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.lqDetailAction;
      if (action === 'try') openAdminLightningQuizPreviewPanel(question);
      else if (action === 'schedule') void changeAdminLightningQuizStatus(question, 'published');
      else if (action === 'unschedule') void changeAdminLightningQuizStatus(question, 'draft');
      else if (action === 'edit') openAdminLightningQuizEditor(question);
      else if (action === 'copy') openAdminLightningQuizEditor(question, { copy: true });
      else if (action === 'delete') void deleteAdminLightningQuizQuestion(question);
    });
  });
  openAdminLightningQuizSheet('admin-lightning-quiz-question-sheet');
}

// ── 排程規則（#310）─────────────────────────────────────────────────────────
let adminLightningQuizSettings = null;
const ADMIN_LIGHTNING_QUIZ_WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

async function loadAdminLightningQuizSettings() {
  if (adminLightningQuizSettings) return adminLightningQuizSettings;
  const result = await db.adminGetLightningQuizSettings();
  adminLightningQuizSettings = result.success && result.data ? result.data : { ...DEFAULT_LIGHTNING_QUIZ_SETTINGS };
  return adminLightningQuizSettings;
}

function describeAdminLightningQuizRule(settings) {
  const days = (settings.weekdays || []).map(day => ADMIN_LIGHTNING_QUIZ_WEEKDAY_LABELS[day - 1]).join('、');
  return `每週${days}　${settings.timeStart}–${settings.timeEnd}`;
}

function openAdminLightningQuizRule() {
  const body = document.getElementById('admin-lightning-quiz-rule-body');
  if (!body) return;
  const settings = adminLightningQuizSettings || DEFAULT_LIGHTNING_QUIZ_SETTINGS;
  body.innerHTML = `
    <div class="admin-lightning-quiz-rule">
      <fieldset class="admin-lightning-quiz-rule__days"><legend>哪幾天有雲柱測驗</legend>
        ${ADMIN_LIGHTNING_QUIZ_WEEKDAY_LABELS.map((label, index) => `<label><input type="checkbox" data-lq-rule-day value="${index + 1}" ${(settings.weekdays || []).includes(index + 1) ? 'checked' : ''}> 週${label}</label>`).join('')}
      </fieldset>
      <label>預設開始<input type="time" class="form-control" data-lq-rule-start value="${escapeHTML(settings.timeStart)}"></label>
      <label>預設結束<input type="time" class="form-control" data-lq-rule-end value="${escapeHTML(settings.timeEnd)}"></label>
    </div>
    <p class="admin-daily-quiz-note">日曆依這個規則標出「缺題」的日子；新增題目與文字匯入會帶入預設時段。</p>
    <div class="admin-lq-sheet__footer">
      <button type="button" class="pill-btn" data-lq-sheet-close>取消</button>
      <button type="button" class="primary-btn" data-lq-rule-save>儲存規則</button>
    </div>`;
  body.querySelector('[data-lq-rule-save]').addEventListener('click', async event => {
    const weekdays = [...body.querySelectorAll('[data-lq-rule-day]:checked')].map(input => Number(input.value));
    const timeStart = body.querySelector('[data-lq-rule-start]').value;
    const timeEnd = body.querySelector('[data-lq-rule-end]').value;
    if (!weekdays.length) { showToast('請至少選一天。'); return; }
    if (!timeStart || !timeEnd || timeStart >= timeEnd) { showToast('結束時間必須晚於開始時間。'); return; }
    event.currentTarget.disabled = true;
    const result = await db.adminSaveLightningQuizSettings({ weekdays, timeStart, timeEnd });
    event.currentTarget.disabled = false;
    if (!result.success) { showToast(result.message || '儲存失敗，請稍後再試。'); return; }
    adminLightningQuizSettings = result.data;
    showToast('排程規則已儲存。');
    closeAdminLightningQuizSheet('admin-lightning-quiz-rule');
    const planner = document.getElementById('admin-lightning-quiz-planner');
    renderAdminLightningQuizPlanner(planner?._questions || []);
  });
  openAdminLightningQuizSheet('admin-lightning-quiz-rule');
}

// ── 文字匯入（#310）─────────────────────────────────────────────────────────
function renderAdminLightningQuizImportPreview(preview, parsed, planned) {
  const errors = [...parsed.errors, ...planned.errors].sort((a, b) => a.number - b.number);
  if (errors.length) {
    preview.innerHTML = `<div class="admin-lightning-quiz-import__errors" role="alert">
      <p>有 ${errors.length} 題需要修正，修正後再按一次「解析」（這時候一題都還沒有存）：</p>
      <ul>${errors.map(error => `<li>第 ${escapeHTML(String(error.number))} 題：${escapeHTML(error.message)}</li>`).join('')}</ul>
    </div>`;
    return;
  }
  preview.innerHTML = `
    <p class="admin-daily-quiz-note">共 ${planned.plan.length} 題，會排在下面這些日子。確認沒問題再匯入：</p>
    ${adminLightningQuizOrgTable(['日期', '時段', '題型', '題目', ''],
      planned.plan.map(item => `<tr>
        <td>${escapeHTML(formatWeekday(item.date))}</td>
        <td>${escapeHTML(item.timeStart)}–${escapeHTML(item.timeEnd)}</td>
        <td>${escapeHTML(ADMIN_QUIZ_CUSTOM_TYPE_LABELS[item.question.type] || item.question.type)}</td>
        <td>${escapeHTML(item.question.payload?.stem || '')}</td>
        <td>${item.pinned ? '指定日期' : '自動排入'}</td>
      </tr>`).join(''))}
    <div class="admin-lq-subpage__footer">
      <button type="button" class="secondary-btn" data-lq-import-save="draft">匯入為準備中</button>
      <button type="button" class="primary-btn" data-lq-import-save="schedule">匯入並排程</button>
    </div>`;
}

function openAdminLightningQuizImport() {
  const body = document.getElementById('admin-lightning-quiz-import-body');
  if (!body) return;
  if (!body.querySelector('[data-lq-import-text]')) {
    body.innerHTML = `
      <p class="admin-daily-quiz-note">格式跟小測驗的文字匯入一樣，每題之間空一行。沒寫日期的題目會依序排進接下來還空著的規則日；想指定日期或時段，就在那一題上方加一行「日期：10/9」或「時段：12:00-13:00」。</p>
      <textarea class="form-control" rows="10" data-lq-import-text placeholder="[單選] 亞伯拉罕原本住在哪座城市？&#10;A. 哈蘭&#10;B. 吾珥&#10;答案：B&#10;&#10;日期：10/9&#10;[是非] 摩西在米甸住了四十年。&#10;答案：對"></textarea>
      <div><button type="button" class="secondary-btn" data-lq-import-parse>解析</button></div>
      <div data-lq-import-preview aria-live="polite"></div>`;
    const textarea = body.querySelector('[data-lq-import-text]');
    const preview = body.querySelector('[data-lq-import-preview]');
    let planned = null;
    body.querySelector('[data-lq-import-parse]').addEventListener('click', () => {
      const now = adminLightningQuizTaipeiNow();
      const parsed = parseLightningImportText(textarea.value, { today: now.date });
      if (!parsed.items.length && !parsed.errors.length) {
        preview.innerHTML = '<div class="admin-user-directory__empty">請先貼上題目。</div>';
        planned = null;
        return;
      }
      const planner = document.getElementById('admin-lightning-quiz-planner');
      planned = planLightningImport(parsed.items, {
        existingDates: (planner?._questions || []).map(question => question.riseDate),
        settings: adminLightningQuizSettings || DEFAULT_LIGHTNING_QUIZ_SETTINGS,
        now
      });
      renderAdminLightningQuizImportPreview(preview, parsed, planned);
    });
    preview.addEventListener('click', async event => {
      const button = event.target.closest('[data-lq-import-save]');
      if (!button || !planned || planned.errors.length) return;
      const schedule = button.dataset.lqImportSave === 'schedule';
      preview.querySelectorAll('[data-lq-import-save]').forEach(other => { other.disabled = true; });
      const result = await db.adminImportLightningQuizQuestions(planned.plan.map(item => ({
        riseDate: item.date,
        riseTimeStart: item.timeStart,
        riseTimeEnd: item.timeEnd,
        questionType: item.question.type,
        payload: item.question.payload,
        answerKey: item.question.answerKey
      })), schedule);
      if (!result.success) {
        preview.querySelectorAll('[data-lq-import-save]').forEach(other => { other.disabled = false; });
        showToast(result.message || '匯入失敗，這次一題都沒有匯入。');
        return;
      }
      showToast(`已匯入 ${result.data?.imported ?? planned.plan.length} 題${schedule ? '並排程' : '（準備中）'}。`);
      textarea.value = '';
      preview.innerHTML = '';
      planned = null;
      await closeAdminLightningQuizSubpage({ force: true });
      await renderAdminLightningQuizQuestions();
    });
  }
  openAdminLightningQuizSubpage('admin-lightning-quiz-import', {
    isDirty: () => Boolean(body.querySelector('[data-lq-import-text]')?.value.trim())
  });
  body.querySelector('[data-lq-import-text]')?.focus?.();
}

// ── 排程分頁：4 週日曆（#310、#313）──────────────────────────────────────────
function renderAdminLightningQuizCalendarHtml(questions, settings, now) {
  const weeks = buildLightningQuizCalendar({ weekdays: settings.weekdays, questions, now, weeks: 4 });
  return `<div class="admin-lightning-quiz-calendar" style="--lq-days: ${weeks[0]?.days.length || 3}">
    ${weeks.map(week => `<div class="admin-lightning-quiz-calendar__week">
      <span class="admin-lightning-quiz-calendar__week-label">${escapeHTML(formatWeekRange(week.weekStart))}</span>
      <div class="admin-lightning-quiz-calendar__days">
        ${week.days.map(day => {
          const label = `<span class="admin-lightning-quiz-calendar__date">${escapeHTML(formatWeekday(day.date))}</span>`;
          if (day.question) {
            return `<button type="button" class="admin-lightning-quiz-calendar__day" data-lq-calendar-open="${escapeHTML(String(day.question.id))}">
              ${label}
              ${adminLightningQuizStageBadge(day.stage)}
              <span class="admin-lightning-quiz-calendar__stem">${escapeHTML(day.question.payload?.stem || '')}</span>
            </button>`;
          }
          if (day.missing) {
            return `<button type="button" class="admin-lightning-quiz-calendar__day is-missing" data-lq-calendar-add="${escapeHTML(day.date)}" aria-label="${escapeHTML(formatWeekday(day.date))} 缺題，新增題目">
              ${label}
              <span class="stat-badge stat-badge--danger">缺題</span>
              <span class="admin-lightning-quiz-calendar__stem">＋ 新增</span>
            </button>`;
          }
          return `<div class="admin-lightning-quiz-calendar__day is-past">${label}<span class="admin-lightning-quiz-calendar__stem">—</span></div>`;
        }).join('')}
      </div>
    </div>`).join('')}
  </div>`;
}

function renderAdminLightningQuizPlanner(questions) {
  const host = document.getElementById('admin-lightning-quiz-planner');
  if (!host) return;
  const settings = adminLightningQuizSettings || DEFAULT_LIGHTNING_QUIZ_SETTINGS;
  host._questions = questions;
  if (!host.dataset.lqPlannerBound) {
    host.dataset.lqPlannerBound = 'true';
    host.addEventListener('click', event => {
      const add = event.target.closest('[data-lq-calendar-add]');
      if (add) {
        const rule = adminLightningQuizSettings || DEFAULT_LIGHTNING_QUIZ_SETTINGS;
        openAdminLightningQuizEditor(null, { prefill: { riseDate: add.dataset.lqCalendarAdd, riseTimeStart: rule.timeStart, riseTimeEnd: rule.timeEnd } });
        return;
      }
      const open = event.target.closest('[data-lq-calendar-open]');
      if (open) openAdminLightningQuizDetail((host._questions || []).find(item => String(item.id) === open.dataset.lqCalendarOpen));
    });
  }
  host.innerHTML = `
    <p class="admin-daily-quiz-note admin-lq__rule-summary" data-lq-rule-summary>排程規則：${escapeHTML(describeAdminLightningQuizRule(settings))}　點日期看題目；點「缺題」直接新增。</p>
    ${renderAdminLightningQuizCalendarHtml(questions, settings, adminLightningQuizTaipeiNow())}`;
}

// ── 題目清單分頁：一題一行，接下來／已結束（#313）──────────────────────────────
const ADMIN_LIGHTNING_QUIZ_ENDED_PAGE = 10;
let adminLightningQuizListFilter = 'upcoming';
let adminLightningQuizEndedLimit = ADMIN_LIGHTNING_QUIZ_ENDED_PAGE;

function renderAdminLightningQuizList(host, questions) {
  const now = adminLightningQuizTaipeiNow();
  const withStage = questions.map(question => ({ question, stage: lightningQuizStage(question, now) }));
  const upcoming = withStage.filter(item => item.stage !== 'ended')
    .sort((a, b) => String(a.question.riseDate).localeCompare(String(b.question.riseDate)));
  const ended = withStage.filter(item => item.stage === 'ended')
    .sort((a, b) => String(b.question.riseDate).localeCompare(String(a.question.riseDate)));
  const showing = adminLightningQuizListFilter === 'ended' ? ended.slice(0, adminLightningQuizEndedLimit) : upcoming;
  const emptyText = adminLightningQuizListFilter === 'ended' ? '還沒有已結束的題目。' : '接下來沒有題目，按「＋ 新增題目」或「匯入題目」加入。';
  host.innerHTML = `
    <div class="capsule-segmented-control segment-track admin-lq-list__filter" role="tablist" aria-label="題目清單">
      <button type="button" class="segment-toggle-btn${adminLightningQuizListFilter === 'upcoming' ? ' active' : ''}" role="tab" aria-selected="${adminLightningQuizListFilter === 'upcoming'}" data-lq-list-filter="upcoming">接下來（${upcoming.length}）</button>
      <button type="button" class="segment-toggle-btn${adminLightningQuizListFilter === 'ended' ? ' active' : ''}" role="tab" aria-selected="${adminLightningQuizListFilter === 'ended'}" data-lq-list-filter="ended">已結束（${ended.length}）</button>
    </div>
    ${showing.length ? `<ul class="admin-lq-list__rows">
      ${showing.map(({ question, stage }) => `<li>
        <button type="button" class="admin-lq-row" data-admin-lightning-quiz-id="${escapeHTML(String(question.id))}">
          <span class="admin-lq-row__when">${escapeHTML(formatWeekday(question.riseDate))} ${escapeHTML((question.riseTimeStart || '').slice(0, 5))}</span>
          ${adminLightningQuizStageBadge(stage)}
          <span class="admin-lq-row__stem">${escapeHTML(question.payload?.stem || '')}</span>
        </button>
      </li>`).join('')}
    </ul>` : `<div class="admin-user-directory__empty">${emptyText}</div>`}
    ${adminLightningQuizListFilter === 'ended' && ended.length > showing.length
      ? `<button type="button" class="secondary-btn admin-lq-list__more" data-lq-list-more>顯示更多（還有 ${ended.length - showing.length} 題）</button>`
      : ''}`;
  host.querySelectorAll('[data-lq-list-filter]').forEach(button => {
    button.addEventListener('click', () => {
      adminLightningQuizListFilter = button.dataset.lqListFilter;
      adminLightningQuizEndedLimit = ADMIN_LIGHTNING_QUIZ_ENDED_PAGE;
      renderAdminLightningQuizList(host, questions);
    });
  });
  host.querySelector('[data-lq-list-more]')?.addEventListener('click', () => {
    adminLightningQuizEndedLimit += ADMIN_LIGHTNING_QUIZ_ENDED_PAGE;
    renderAdminLightningQuizList(host, questions);
  });
  host.querySelectorAll('[data-admin-lightning-quiz-id]').forEach(row => {
    row.addEventListener('click', () => {
      openAdminLightningQuizDetail(questions.find(item => String(item.id) === row.dataset.adminLightningQuizId));
    });
  });
}

// ── 分頁與上方按鈕（#313）：只綁一次，記住上次看的分頁 ─────────────────────────
const ADMIN_LIGHTNING_QUIZ_TAB_KEY = 'adminLightningQuizTab';

function showAdminLightningQuizTab(tab) {
  document.querySelectorAll('[data-lq-tab]').forEach(button => {
    const active = button.dataset.lqTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-lq-tab-panel]').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.lqTabPanel !== tab);
  });
  try { localStorage.setItem(ADMIN_LIGHTNING_QUIZ_TAB_KEY, tab); } catch (_) { /* 無痕模式等存不了就算了 */ }
}

function bindAdminLightningQuizChrome() {
  const tabs = document.querySelector('.admin-lq__tabs');
  if (tabs && !tabs.dataset.lqBound) {
    tabs.dataset.lqBound = 'true';
    tabs.querySelectorAll('[data-lq-tab]').forEach(button => {
      button.addEventListener('click', () => showAdminLightningQuizTab(button.dataset.lqTab));
    });
    let saved = null;
    try { saved = localStorage.getItem(ADMIN_LIGHTNING_QUIZ_TAB_KEY); } catch (_) { saved = null; }
    showAdminLightningQuizTab(['schedule', 'list', 'stats'].includes(saved) ? saved : 'schedule');
  }
  const createButton = document.getElementById('admin-lightning-quiz-create');
  if (createButton) createButton.onclick = () => openAdminLightningQuizEditor();
  const importButton = document.getElementById('admin-lightning-quiz-import-open');
  if (importButton) importButton.onclick = openAdminLightningQuizImport;
  const ruleButton = document.getElementById('admin-lightning-quiz-rule-open');
  if (ruleButton) ruleButton.onclick = openAdminLightningQuizRule;
}

export async function renderAdminLightningQuizQuestions() {
  const host = document.getElementById('admin-lightning-quiz-list');
  const cancelButton = document.getElementById('admin-lightning-quiz-cancel');
  const saveButton = document.getElementById('admin-lightning-quiz-save');
  if (!host || !cancelButton || !saveButton) return;

  bindAdminLightningQuizChrome();
  cancelButton.onclick = () => { void closeAdminLightningQuizSubpage(); };
  saveButton.onclick = async () => {
    const riseDate = document.getElementById('admin-lightning-quiz-rise-date')?.value || '';
    const timeStart = document.getElementById('admin-lightning-quiz-time-start')?.value || '';
    const timeEnd = document.getElementById('admin-lightning-quiz-time-end')?.value || '';
    const fieldset = document.querySelector('#admin-lightning-quiz-question-body fieldset');
    if (!riseDate || !timeStart || !timeEnd) {
      showToast('請設定日期與開始／結束時間。');
      return;
    }
    if (timeStart >= timeEnd) {
      showToast('結束時間必須晚於開始時間。');
      return;
    }
    const question = fieldset ? collectAdminLightningQuizQuestion(fieldset) : null;
    if (!question || !adminLightningQuizQuestionIsValid(question)) {
      showToast('請完整填寫題目內容（含正確答案）後再儲存。');
      return;
    }
    saveButton.disabled = true;
    const result = await db.adminUpsertLightningQuizQuestion({
      id: editingAdminLightningQuizId,
      riseDate,
      riseTimeStart: timeStart,
      riseTimeEnd: timeEnd,
      questionType: question.type,
      payload: question.payload,
      answerKey: question.answerKey,
      explanation: question.explanation
    });
    saveButton.disabled = false;
    if (!result.success) {
      showToast(result.message || '儲存失敗，請稍後再試。');
      return;
    }
    if (result.data?.unchanged) showToast('內容沒有變更。');
    else showToast(editingAdminLightningQuizId ? '題目已更新。' : '已新增，目前是「準備中」；確認後按「排程」。');
    await closeAdminLightningQuizSubpage({ force: true });
    await renderAdminLightningQuizQuestions();
  };

  const [result] = await Promise.all([db.adminListLightningQuizQuestions(), loadAdminLightningQuizSettings()]);
  if (!result.success) {
    host.innerHTML = `<div class="admin-user-directory__empty">${escapeHTML(result.message || '載入失敗，請稍後再試。')}</div>`;
    return;
  }
  const questions = Array.isArray(result.data) ? result.data : [];
  renderAdminLightningQuizPlanner(questions);
  renderAdminLightningQuizList(host, questions);
  if (typeof hydrateIcons === 'function') hydrateIcons(host);
}

function formatAdminLightningQuizPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function downloadAdminLightningQuizCsv(csvContent, filename) {
  if (!csvContent) {
    showToast('沒有資料可以匯出。');
    return;
  }
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function adminLightningQuizExportButton(attr) {
  return `<button type="button" class="secondary-btn" ${attr}><span class="nlc-icon nlc-icon--sm" data-icon="download" aria-hidden="true"></span>匯出 CSV</button>`;
}

function adminLightningQuizOrgStatCells(row) {
  return `<td>${escapeHTML(String(row.eligible))}</td>
    <td>${escapeHTML(String(row.completed))}</td>
    <td>${escapeHTML(formatRate(row.participationRate))}</td>
    <td>${escapeHTML(String(row.correct))}</td>
    <td>${escapeHTML(formatRate(row.correctRate))}</td>`;
}

function renderAdminLightningQuizOverviewRows(attempts) {
  if (!attempts.length) {
    return '<tr><td colspan="6" class="admin-lightning-quiz-stats-empty-cell">沒有符合條件的作答紀錄。</td></tr>';
  }
  return attempts.map(attempt => `<tr>
    <td class="admin-lightning-quiz-rank">${attempt.rank == null ? '—' : escapeHTML(String(attempt.rank))}</td>
    <td>${escapeHTML(attempt.name || '（未命名）')}</td>
    <td>${escapeHTML(attempt.pastoralZone || UNASSIGNED_ZONE_LABEL)}</td>
    <td>${escapeHTML(attempt.smallGroup || '—')}</td>
    <td><span class="admin-lightning-quiz-status admin-lightning-quiz-status--${escapeHTML(attempt.status)}">${escapeHTML(ATTEMPT_STATUS_LABELS[attempt.status] || '')}</span></td>
    <td>${attempt.status === 'in_progress' ? '—' : `${escapeHTML(formatElapsedSeconds(attempt.elapsedMs))} 秒`}</td>
  </tr>`).join('');
}

function adminLightningQuizOrgTable(headers, bodyRows) {
  return `<div class="admin-lightning-quiz-stats-table-wrap">
    <table class="admin-lightning-quiz-stats-table">
      <thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </div>`;
}

// 一題的作答明細：作答總覽（依名次，可搜尋／篩選）、牧區分析、大區分析，各自可匯出 CSV。
// 顯示在完整頁面裡（#317），名次在搜尋／篩選之前算好（#316）。
async function renderAdminLightningQuizDetail(detailHost, day) {
  detailHost.innerHTML = '<div class="admin-user-directory__empty">正在載入作答明細…</div>';

  const result = await db.adminGetLightningQuizResults(day.questionId);
  if (!result.success) {
    detailHost.innerHTML = `<div class="admin-user-directory__empty">${escapeHTML(result.message || '載入作答明細失敗。')}</div>`;
    return;
  }
  const data = result.data || {};
  const attempts = rankAttempts(Array.isArray(data.attempts) ? data.attempts : []);
  const zoneSummary = summarizeByZone(data);
  const regionSummary = summarizeByRegion(data);
  const zoneRows = sortZoneRowsByRegion(zoneSummary.rows);
  const fileSuffix = day.riseDate;

  detailHost.innerHTML = `
    <section class="admin-lightning-quiz-detail__section" aria-label="作答總覽">
      <div class="admin-lightning-quiz-detail__section-head">
        <h5>作答總覽（依名次：答對的依作答時間由快到慢）</h5>
        ${adminLightningQuizExportButton('data-lq-export="overview"')}
      </div>
      <div class="admin-quiz-stats-roster-toolbar">
        <input type="search" class="form-control" data-lq-overview-search placeholder="搜尋姓名／小組／牧區">
        <select class="form-control" data-lq-overview-status aria-label="篩選結果">
          <option value="all">全部結果</option>
          <option value="correct">答對</option>
          <option value="wrong">答錯</option>
          <option value="in_progress">未完成</option>
        </select>
      </div>
      <div class="admin-lightning-quiz-stats-table-wrap">
        <table class="admin-lightning-quiz-stats-table">
          <thead><tr><th>名次</th><th>姓名</th><th>牧區</th><th>小組</th><th>結果</th><th>作答時間</th></tr></thead>
          <tbody data-lq-overview-body>${renderAdminLightningQuizOverviewRows(attempts)}</tbody>
        </table>
      </div>
    </section>

    <section class="admin-lightning-quiz-detail__section" aria-label="牧區分析">
      <div class="admin-lightning-quiz-detail__section-head">
        <h5>牧區分析</h5>
        ${adminLightningQuizExportButton('data-lq-export="zone"')}
      </div>
      ${adminLightningQuizOrgTable(
        ['大區', '牧區', '應答人數', '作答人數', '參與率', '答對人數', '答對率'],
        zoneRows.map(row => `<tr>
          <td>${escapeHTML(row.greatRegion || UNASSIGNED_REGION_LABEL)}</td>
          <td>${escapeHTML(row.pastoralZone || UNASSIGNED_ZONE_LABEL)}</td>
          ${adminLightningQuizOrgStatCells(row)}
        </tr>`).join('')
          + `<tr class="admin-lightning-quiz-stats-total"><td colspan="2">全教會合計</td>${adminLightningQuizOrgStatCells(zoneSummary.total)}</tr>`
      )}
    </section>

    <section class="admin-lightning-quiz-detail__section" aria-label="大區分析">
      <div class="admin-lightning-quiz-detail__section-head">
        <h5>大區分析</h5>
        ${adminLightningQuizExportButton('data-lq-export="region"')}
      </div>
      ${adminLightningQuizOrgTable(
        ['大區', '應答人數', '作答人數', '參與率', '答對人數', '答對率'],
        regionSummary.rows.map(row => `<tr>
          <td>${escapeHTML(row.greatRegion || UNASSIGNED_REGION_LABEL)}</td>
          ${adminLightningQuizOrgStatCells(row)}
        </tr>`).join('')
          + `<tr class="admin-lightning-quiz-stats-total"><td>全教會合計</td>${adminLightningQuizOrgStatCells(regionSummary.total)}</tr>`
      )}
    </section>
  `;
  if (typeof hydrateIcons === 'function') hydrateIcons(detailHost);

  const searchInput = detailHost.querySelector('[data-lq-overview-search]');
  const statusSelect = detailHost.querySelector('[data-lq-overview-status]');
  const overviewBody = detailHost.querySelector('[data-lq-overview-body]');
  const currentOverview = () => filterAttempts(attempts, { search: searchInput.value, status: statusSelect.value });
  const rerenderOverview = () => { overviewBody.innerHTML = renderAdminLightningQuizOverviewRows(currentOverview()); };
  searchInput.addEventListener('input', rerenderOverview);
  statusSelect.addEventListener('change', rerenderOverview);

  detailHost.querySelectorAll('[data-lq-export]').forEach(button => {
    button.addEventListener('click', () => {
      const kind = button.dataset.lqExport;
      if (kind === 'overview') {
        // 匯出目前搜尋／篩選後看到的名單
        downloadAdminLightningQuizCsv(buildOverviewCsv(currentOverview()), `雲柱測驗_作答總覽_${fileSuffix}.csv`);
      } else if (kind === 'zone') {
        downloadAdminLightningQuizCsv(buildZoneCsv(zoneSummary), `雲柱測驗_牧區分析_${fileSuffix}.csv`);
      } else if (kind === 'region') {
        downloadAdminLightningQuizCsv(buildRegionCsv(regionSummary), `雲柱測驗_大區分析_${fileSuffix}.csv`);
      }
    });
  });
}

let adminLightningQuizTrendCharts = [];

function destroyAdminLightningQuizTrendCharts() {
  adminLightningQuizTrendCharts.forEach(chart => { try { chart.destroy(); } catch (_) { /* 已經被移除就略過 */ } });
  adminLightningQuizTrendCharts = [];
}

function adminLightningQuizTrendChartConfig(series, valueKey, label, color, describe) {
  return {
    type: 'line',
    data: {
      labels: series.map(point => point.label),
      datasets: [{
        label,
        data: series.map(point => point[valueKey] == null ? null : Math.round(point[valueKey] * 1000) / 10),
        borderColor: color,
        backgroundColor: color,
        pointRadius: 3,
        tension: 0.25,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => `${label} ${context.formattedValue}%（${describe(series[context.dataIndex])}）`
          }
        }
      },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: value => `${value}%` } }
      }
    }
  };
}

// 週趨勢（#311）：參與率、答對率兩張折線圖＋每週資料表。週資料由
// admin_get_lightning_quiz_weeks 一次取回，依起迄週在前端篩選。
async function renderAdminLightningQuizTrendPanel(panel) {
  panel.innerHTML = '<div class="admin-user-directory__empty">正在載入週趨勢…</div>';
  const result = await db.adminGetLightningQuizWeeks();
  if (!result.success) {
    panel.innerHTML = `<div class="admin-user-directory__empty">${escapeHTML(result.message || '載入週趨勢失敗，請稍後再試。')}</div>`;
    return null;
  }
  const allSeries = buildWeeklyTrendSeries(result.data?.weeks);
  panel.innerHTML = `
    <div class="admin-lightning-quiz-trend__toolbar">
      <label>起（週）<input type="date" class="form-control" data-lq-trend-from></label>
      <label>迄（週）<input type="date" class="form-control" data-lq-trend-to></label>
      ${adminLightningQuizExportButton('data-lq-trend-export')}
    </div>
    <div data-lq-trend-body></div>
  `;
  if (typeof hydrateIcons === 'function') hydrateIcons(panel);
  const fromInput = panel.querySelector('[data-lq-trend-from]');
  const toInput = panel.querySelector('[data-lq-trend-to]');
  const body = panel.querySelector('[data-lq-trend-body]');
  if (allSeries.length) {
    fromInput.value = allSeries[0].weekStart;
    toInput.value = allSeries[allSeries.length - 1].weekStart;
  }
  // 選的日期不一定是週一：起日算它那一週，迄日也包含它那一週
  const currentSeries = () => {
    const from = fromInput.value ? weekStartOf(fromInput.value) : '';
    const to = toInput.value ? weekStartOf(toInput.value) : '';
    return allSeries.filter(point => (!from || point.weekStart >= from) && (!to || point.weekStart <= to));
  };

  const draw = async () => {
    destroyAdminLightningQuizTrendCharts();
    const series = currentSeries();
    if (!series.length) {
      body.innerHTML = '<div class="admin-user-directory__empty">這段期間沒有已發布的雲柱測驗。</div>';
      return;
    }
    body.innerHTML = `
      <div class="admin-lightning-quiz-trend__charts">
        <figure class="admin-lightning-quiz-trend__chart">
          <figcaption>參與率（這週至少答 1 題的人 ÷ 應答人數）</figcaption>
          <div class="admin-lightning-quiz-trend__canvas"><canvas data-lq-trend-chart="participationRate"></canvas></div>
        </figure>
        <figure class="admin-lightning-quiz-trend__chart">
          <figcaption>答對率（答對題數 ÷ 送出題數）</figcaption>
          <div class="admin-lightning-quiz-trend__canvas"><canvas data-lq-trend-chart="correctRate"></canvas></div>
        </figure>
      </div>
      <div class="admin-lightning-quiz-stats-table-wrap">
        <table class="admin-lightning-quiz-stats-table">
          <thead><tr><th>週</th><th>題數</th><th>參與／應答</th><th>參與率</th><th>全部答完</th><th>答對率</th><th>平均作答時間</th></tr></thead>
          <tbody>${series.map(point => `<tr>
            <td>${escapeHTML(point.label)}</td>
            <td>${escapeHTML(String(point.questionCount))}</td>
            <td>${escapeHTML(String(point.participants))} / ${escapeHTML(String(point.eligible))}</td>
            <td>${escapeHTML(formatRate(point.participationRate))}</td>
            <td>${escapeHTML(String(point.allAnswered))}</td>
            <td>${escapeHTML(formatRate(point.correctRate))}</td>
            <td>${point.avgElapsedMs == null ? '—' : `${escapeHTML(formatElapsedSeconds(point.avgElapsedMs))} 秒`}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    `;
    try {
      await ensureChartLib();
    } catch (_) {
      body.querySelector('.admin-lightning-quiz-trend__charts')?.remove();
      showToast('圖表元件載入失敗，先顯示資料表。');
      return;
    }
    const participationCanvas = body.querySelector('[data-lq-trend-chart="participationRate"]');
    const correctCanvas = body.querySelector('[data-lq-trend-chart="correctRate"]');
    if (!participationCanvas?.isConnected || !correctCanvas?.isConnected) return; // 載入圖表期間區間又被改了
    const rootStyle = getComputedStyle(document.body); // 主題 token 在 body 上（#456）
    const brand = rootStyle.getPropertyValue('--color-brand').trim() || '#04A9D2';
    const success = rootStyle.getPropertyValue('--color-success-foreground').trim() || brand;
    adminLightningQuizTrendCharts = [
      new Chart(participationCanvas.getContext('2d'), adminLightningQuizTrendChartConfig(series, 'participationRate', '參與率', brand,
        point => `${point.participants} / ${point.eligible} 人`)),
      new Chart(correctCanvas.getContext('2d'), adminLightningQuizTrendChartConfig(series, 'correctRate', '答對率', success,
        point => `${point.correct} / ${point.completed} 題`))
    ];
  };

  fromInput.addEventListener('change', () => { void draw(); });
  toInput.addEventListener('change', () => { void draw(); });
  panel.querySelector('[data-lq-trend-export]')?.addEventListener('click', () => {
    downloadAdminLightningQuizCsv(buildWeeklyTrendCsv(currentSeries()), `雲柱測驗_週趨勢_${formatTaiwanDate()}.csv`);
  });
  return draw;
}

function adminLightningQuizWeekOrgCells(row) {
  return `<td>${escapeHTML(String(row.eligible))}</td>
    <td>${escapeHTML(String(row.participants))}</td>
    <td>${escapeHTML(formatRate(row.participationRate))}</td>
    <td>${escapeHTML(String(row.allAnswered))}</td>
    <td>${escapeHTML(formatRate(row.correctRate))}</td>`;
}

// ── 首頁公布前三名（#429）───────────────────────────────────────────────────
// 週統計裡的一個區塊：依天列出答對的人（秒數由快到慢），管理員以天為單位排除，
// 下面的人遞補；按「公布」後伺服器依排除名單重算前三名、存成固定紀錄，首頁顯示
// 1～7 天。這裡算的前三名只是預覽，實際公布的名單以伺服器回傳為準。
const ADMIN_LQ_RANKING_ROWS_SHOWN = 10;

function formatAdminLightningQuizRankingStatus(publication) {
  if (!publication) return '尚未公布。';
  const until = `${formatWeekday(publication.displayUntil)} 23:59`;
  if (publication.revoked) return '已撤下，首頁目前不顯示。';
  if (publication.showing) return `首頁公布中，顯示到 ${until}。`;
  return `公布期間已結束（顯示到 ${until}）。`;
}

function adminLightningQuizRankingDayHtml(day, dayExcluded, expanded) {
  const candidates = Array.isArray(day.candidates) ? day.candidates : [];
  const winners = pickDayWinners(candidates, [...dayExcluded]);
  const winnerRank = new Map(winners.map(winner => [String(winner.userId), winner.rank]));
  // 至少列到第三名那一列，排除過的人才看得到、也才能取消排除。
  const lastWinnerIndex = winners.length
    ? candidates.findIndex(candidate => String(candidate.userId) === String(winners[winners.length - 1].userId))
    : -1;
  const shownCount = expanded
    ? candidates.length
    : Math.max(ADMIN_LQ_RANKING_ROWS_SHOWN, lastWinnerIndex + 1);
  const rows = candidates.slice(0, shownCount).map(candidate => {
    const id = String(candidate.userId);
    const isExcluded = dayExcluded.has(id);
    const rank = winnerRank.get(id);
    return `<li class="admin-lq-ranking__row${rank ? ' is-winner' : ''}${isExcluded ? ' is-excluded' : ''}">
      <span class="admin-lq-ranking__rank">${isExcluded ? '已排除' : rank ? escapeHTML(formatRankLabel(rank)) : ''}</span>
      <span class="admin-lq-ranking__name">${escapeHTML(candidate.name || '（未命名）')}</span>
      <span class="admin-lq-ranking__zone">${escapeHTML(candidate.pastoralZone || UNASSIGNED_ZONE_LABEL)}</span>
      <span class="admin-lq-ranking__time">${escapeHTML(formatElapsedSeconds(candidate.elapsedMs))} 秒</span>
      <button type="button" class="pill-btn" data-lq-ranking-toggle data-date="${escapeHTML(day.riseDate)}" data-user="${escapeHTML(id)}">${isExcluded ? '取消排除' : '排除'}</button>
    </li>`;
  }).join('');
  return `<div class="admin-lq-ranking__day">
    <h6>${escapeHTML(formatWeekday(day.riseDate))}${day.ended ? '' : '（還沒結束）'}</h6>
    ${candidates.length ? `<ol class="admin-lq-ranking__list">${rows}</ol>` : '<div class="admin-user-directory__empty">這天沒有人答對。</div>'}
    ${candidates.length > shownCount ? `<button type="button" class="pill-btn" data-lq-ranking-more="${escapeHTML(day.riseDate)}">顯示全部（${escapeHTML(String(candidates.length))} 人）</button>` : ''}
  </div>`;
}

// onPublished：公布／重新公布後通知週統計頁重畫兌換清單（#445）。
async function renderAdminLightningQuizWeekRanking(host, weekStart, isCurrent, onPublished) {
  if (!host) return;
  host.onclick = null;
  host.innerHTML = '<div class="admin-user-directory__empty">正在載入這週的答對名單…</div>';
  const result = await db.adminGetLightningQuizWeekRanking(weekStart);
  if (!isCurrent()) return;
  if (!result.success) {
    host.innerHTML = `<div class="admin-user-directory__empty">${escapeHTML(result.message || '載入答對名單失敗，請稍後再試。')}</div>`;
    return;
  }
  const data = result.data || {};
  const days = Array.isArray(data.days) ? data.days : [];
  const publication = data.publication || null;
  if (!days.length) {
    host.innerHTML = '<div class="admin-user-directory__empty">這週沒有已排程的雲柱測驗。</div>';
    return;
  }
  // 重新公布時從上次的排除名單接著調。
  const excluded = {};
  days.forEach(day => {
    const saved = publication?.excluded?.[day.riseDate];
    excluded[day.riseDate] = new Set(Array.isArray(saved) ? saved.map(String) : []);
  });
  const expanded = new Set();

  const draw = () => {
    const daysInput = host.querySelector('[data-lq-ranking-days]');
    const displayDays = daysInput ? daysInput.value : String(publication?.displayDays || 1);
    host.innerHTML = `
      <p class="admin-lq-ranking__status">${escapeHTML(formatAdminLightningQuizRankingStatus(publication))}</p>
      <p class="admin-daily-quiz-note">依作答秒數由快到慢列出答對的人。按「排除」把人移出名單，下面的人會遞補。名字照會員資料顯示；首頁不顯示個人名次。</p>
      <div class="admin-lq-ranking__days">
        ${days.map(day => adminLightningQuizRankingDayHtml(day, excluded[day.riseDate], expanded.has(day.riseDate))).join('')}
      </div>
      <div class="admin-lq-ranking__publish">
        <label>公布天數
          <input type="number" class="form-control" min="1" max="7" step="1" inputmode="numeric" value="${escapeHTML(displayDays)}" data-lq-ranking-days>
        </label>
        <button type="button" class="primary-btn" data-lq-ranking-publish ${data.allEnded ? '' : 'disabled'}>${publication ? '重新公布' : '公布到首頁'}</button>
        ${publication && !publication.revoked ? '<button type="button" class="secondary-btn" data-lq-ranking-revoke>撤下</button>' : ''}
      </div>
      <p class="admin-daily-quiz-note">${data.allEnded
        ? '公布天數從今天算起（1～7 天），1 天＝顯示到今天 23:59。重新公布會覆蓋首頁上的舊名單。'
        : '這週還有題目沒結束，全部結束後才能公布。'}</p>
    `;
  };

  const publish = async button => {
    const displayDays = Number(host.querySelector('[data-lq-ranking-days]')?.value);
    if (!Number.isInteger(displayDays) || displayDays < 1 || displayDays > 7) {
      showToast('公布天數只能是 1～7 天。');
      return;
    }
    const confirmed = await window.showConfirmDialog({
      title: `把 ${formatWeekRange(data.weekStart)} 的前三名公布到首頁？`,
      message: `全教會會友都會在首頁看到每天前三名的姓名、牧區與作答秒數，顯示 ${displayDays} 天。得獎者會自動拿到克勞斯 100 元抵用券（30 天內有效）。${publication ? '首頁上的舊名單會被覆蓋；不在新名單上、還沒兌換的券會作廢。' : ''}`,
      confirmText: '公布',
      cancelText: '取消'
    });
    if (!confirmed) return;
    button.disabled = true;
    const excludedPayload = normalizeRankingExcluded(days, Object.fromEntries(
      Object.entries(excluded).map(([date, set]) => [date, [...set]])
    ));
    const published = await db.adminPublishLightningQuizWeekRanking(data.weekStart, excludedPayload, displayDays);
    if (!published.success) {
      button.disabled = false;
      showToast(published.message || '公布失敗，請稍後再試。');
      return;
    }
    showToast(`已公布，首頁顯示到 ${formatWeekday(published.data?.displayUntil)} 23:59；得獎者的兌換券已發出。`);
    if (typeof onPublished === 'function') onPublished();
    void renderAdminLightningQuizWeekRanking(host, weekStart, isCurrent, onPublished);
  };

  const revoke = async () => {
    const confirmed = await window.showConfirmDialog({
      title: '撤下首頁的前三名？',
      message: '首頁會立即不顯示。排除名單會保留，之後可以再按「重新公布」。已發出的兌換券不受影響。',
      confirmText: '撤下',
      cancelText: '取消',
      isDestructive: true
    });
    if (!confirmed) return;
    const revoked = await db.adminRevokeLightningQuizWeekRanking(data.weekStart);
    if (!revoked.success) {
      showToast(revoked.message || '撤下失敗，請稍後再試。');
      return;
    }
    showToast('已撤下。');
    void renderAdminLightningQuizWeekRanking(host, weekStart, isCurrent, onPublished);
  };

  // 用 onclick（不是 addEventListener）：公布／撤下後同一個 host 會重畫，不能疊監聽。
  host.onclick = event => {
    const toggle = event.target.closest('[data-lq-ranking-toggle]');
    if (toggle) {
      const set = excluded[toggle.dataset.date];
      if (!set) return;
      if (set.has(toggle.dataset.user)) set.delete(toggle.dataset.user);
      else set.add(toggle.dataset.user);
      draw();
      return;
    }
    const more = event.target.closest('[data-lq-ranking-more]');
    if (more) {
      expanded.add(more.dataset.lqRankingMore);
      draw();
      return;
    }
    const publishButton = event.target.closest('[data-lq-ranking-publish]');
    if (publishButton) { void publish(publishButton); return; }
    if (event.target.closest('[data-lq-ranking-revoke]')) void revoke();
  };

  draw();
}

// 英雄榜兌換券（#445）：這週公布名單發出的券與兌換狀態。管理員可以手動標記兌換
// （例如店家事後回報）或撤銷誤按的兌換；作廢的券（重新公布時被排除）只顯示不能操作。
const ADMIN_VOUCHER_STATUS_KIND = { available: 'success', redeemed: 'brand', expired: 'neutral', void: 'neutral' };

function adminVoucherRowHtml(voucher) {
  const status = voucher.status || 'available';
  const badge = `<span class="stat-badge stat-badge--${ADMIN_VOUCHER_STATUS_KIND[status] || 'neutral'}">${escapeHTML(VOUCHER_STATUS_LABELS[status] || status)}</span>`;
  let action = '';
  if (status === 'redeemed') action = `<button type="button" class="pill-btn" data-lq-voucher-undo="${escapeHTML(String(voucher.id))}">撤銷兌換</button>`;
  else if (status !== 'void') action = `<button type="button" class="pill-btn" data-lq-voucher-redeem="${escapeHTML(String(voucher.id))}">標記已兌換</button>`;
  let note = `有效期限至 ${formatWeekday(voucher.expiresOn)}`;
  if (status === 'redeemed') {
    const via = VOUCHER_REDEEMED_VIA_LABELS[voucher.redeemedVia] || '';
    const by = voucher.redeemedVia === 'admin' && voucher.redeemedByName ? `（${voucher.redeemedByName}）` : '';
    note = `${formatVoucherTime(voucher.redeemedAt)} 兌換・${via}${by}`;
  } else if (status === 'void') {
    note = '重新公布時不在名單上，已作廢';
  }
  return `<li class="admin-lq-vouchers__row${status === 'void' ? ' admin-lq-vouchers--void' : ''}">
    <span>${escapeHTML(formatWeekday(voucher.riseDate))}${escapeHTML(formatRankLabel(voucher.rank))}</span>
    <span class="admin-lq-vouchers__who">${escapeHTML(voucher.name || '（未命名）')}${voucher.pastoralZone ? `<span>${escapeHTML(voucher.pastoralZone)}</span>` : ''}</span>
    <span class="admin-lq-vouchers__code">${escapeHTML(voucher.code || '')}</span>
    ${badge}
    ${action}
    <span class="admin-lq-vouchers__note">${escapeHTML(note)}</span>
  </li>`;
}

async function renderAdminLightningQuizWeekVouchers(host, weekStart, isCurrent) {
  if (!host) return;
  if (!host.childElementCount) host.innerHTML = '<div class="admin-user-directory__empty">正在載入兌換券…</div>';
  const result = await db.adminListLightningQuizVouchers(weekStart);
  if (!isCurrent()) return;
  if (!result.success) {
    host.lqVouchers = [];
    host.onclick = null;
    host.innerHTML = `<div class="admin-user-directory__empty">${escapeHTML(result.message || '載入兌換券失敗，請稍後再試。')}</div>`;
    return;
  }
  const vouchers = Array.isArray(result.data?.vouchers) ? result.data.vouchers : [];
  host.lqVouchers = vouchers;
  if (!vouchers.length) {
    host.onclick = null;
    host.innerHTML = '<div class="admin-user-directory__empty">這週還沒有發出兌換券；公布前三名後會自動發給得獎者。</div>';
    return;
  }
  const counts = summarizeVouchers(vouchers);
  host.innerHTML = `
    <div class="admin-lq-vouchers__summary">
      <span>發出 <strong>${counts.issued}</strong> 張</span>
      <span>已兌換 <strong>${counts.redeemed}</strong></span>
      <span>可使用 <strong>${counts.available}</strong></span>
      <span>已過期 <strong>${counts.expired}</strong></span>
      ${counts.void ? `<span>已作廢 <strong>${counts.void}</strong></span>` : ''}
    </div>
    <p class="admin-daily-quiz-note">得獎者在店裡由本人按「確認兌換」。店家事後回報、或會友誤按時，可在這裡標記或撤銷。</p>
    <ul class="admin-lq-vouchers__list">${vouchers.map(adminVoucherRowHtml).join('')}</ul>
  `;

  const setRedeemed = async (button, voucherId, redeemed) => {
    const voucher = vouchers.find(v => String(v.id) === voucherId);
    const label = voucher ? `${voucher.name || ''} ${formatWeekday(voucher.riseDate)}${formatRankLabel(voucher.rank)}（${voucher.code}）` : '這張券';
    const confirmed = await window.showConfirmDialog(redeemed
      ? { title: '標記為已兌換？', message: `${label} 會變成已兌換，會友就不能再使用。`, confirmText: '標記已兌換', cancelText: '取消' }
      : { title: '撤銷這次兌換？', message: `${label} 會恢復成可使用（過了期限的會顯示已過期）。`, confirmText: '撤銷兌換', cancelText: '取消', isDestructive: true });
    if (!confirmed) return;
    button.disabled = true;
    const saved = await db.adminSetLightningQuizVoucherRedeemed(voucherId, redeemed);
    if (!saved.success) {
      button.disabled = false;
      showToast(saved.message || '更新失敗，請稍後再試。');
      return;
    }
    showToast(redeemed ? '已標記為已兌換。' : '已撤銷兌換。');
    void renderAdminLightningQuizWeekVouchers(host, weekStart, isCurrent);
  };

  // 用 onclick（不是 addEventListener）：重畫時同一個 host 不能疊監聽。
  host.onclick = event => {
    const redeem = event.target.closest('[data-lq-voucher-redeem]');
    if (redeem) { void setRedeemed(redeem, redeem.dataset.lqVoucherRedeem, true); return; }
    const undo = event.target.closest('[data-lq-voucher-undo]');
    if (undo) void setRedeemed(undo, undo.dataset.lqVoucherUndo, false);
  };
}

// 每週統計（#311）：一週（週一到週日）的參與、全部答完、答對率、大區／牧區、
// 週排行榜。預設本週，可以前後切換；每一題再點進去看當天的作答明細。
const ADMIN_LIGHTNING_QUIZ_TOP_SHOWN = 5;

function renderAdminLightningQuizWeekPanel(panel) {
  const thisWeek = weekStartOf(formatTaiwanDate());
  let weekStart = thisWeek;
  panel.innerHTML = `
    <div class="admin-lightning-quiz-trend__toolbar admin-lightning-quiz-week__toolbar">
      <button type="button" class="secondary-btn" data-lq-week-prev>‹ 上一週</button>
      <strong data-lq-week-label></strong>
      <button type="button" class="secondary-btn" data-lq-week-next>下一週 ›</button>
      <button type="button" class="pill-btn" data-lq-week-today>本週</button>
    </div>
    <div data-lq-week-body></div>
  `;
  const label = panel.querySelector('[data-lq-week-label]');
  const body = panel.querySelector('[data-lq-week-body]');
  const nextButton = panel.querySelector('[data-lq-week-next]');
  let requestSeq = 0;

  const load = async () => {
    const seq = ++requestSeq;
    label.textContent = `${formatWeekRange(weekStart)}${weekStart === thisWeek ? '（本週）' : ''}`;
    nextButton.disabled = weekStart >= thisWeek;
    body.innerHTML = '<div class="admin-user-directory__empty">正在載入這週的統計…</div>';
    const result = await db.adminGetLightningQuizWeek(weekStart);
    if (seq !== requestSeq) return; // 載入期間又切到別週
    if (!result.success) {
      body.innerHTML = `<div class="admin-user-directory__empty">${escapeHTML(result.message || '載入週統計失敗，請稍後再試。')}</div>`;
      return;
    }
    const week = result.data || {};
    const questions = Array.isArray(week.questions) ? week.questions : [];
    if (!questions.length) {
      body.innerHTML = '<div class="admin-user-directory__empty">這週沒有已發布的雲柱測驗。</div>';
      return;
    }
    const summary = summarizeWeek(week);
    const zoneSummary = summarizeWeekByZone(week);
    const regionSummary = summarizeWeekByRegion(week);
    const leaderboard = buildWeekLeaderboard(week, 20);
    const fileSuffix = `${week.weekStart}週`;

    body.innerHTML = `
      <div class="admin-daily-quiz-metrics admin-lightning-quiz-week__metrics">
        <span>題數 <strong>${escapeHTML(String(summary.questionCount))}</strong></span>
        <span>參與 <strong>${escapeHTML(String(summary.participants))} / ${escapeHTML(String(summary.eligible))} 人（${escapeHTML(formatRate(summary.participationRate))}）</strong></span>
        <span>${escapeHTML(String(summary.questionCount))} 題全答 <strong>${escapeHTML(String(summary.allAnswered))} 人</strong></span>
        <span>答對率 <strong>${escapeHTML(formatRate(summary.correctRate))}</strong></span>
        <span>答對平均用時 <strong>${summary.avgCorrectElapsedMs == null ? '—' : `${escapeHTML(formatElapsedSeconds(summary.avgCorrectElapsedMs))} 秒`}</strong></span>
      </div>

      <section class="admin-lightning-quiz-detail__section admin-lq-ranking" aria-label="首頁公布前三名">
        <div class="admin-lightning-quiz-detail__section-head"><h5>首頁公布前三名</h5></div>
        <div data-lq-week-ranking></div>
      </section>

      <section class="admin-lightning-quiz-detail__section admin-lq-vouchers" aria-label="英雄榜兌換券">
        <div class="admin-lightning-quiz-detail__section-head">
          <h5>英雄榜兌換券</h5>
          <button type="button" class="pill-btn" data-lq-vouchers-export>匯出 CSV</button>
        </div>
        <div data-lq-week-vouchers></div>
      </section>

      <section class="admin-lightning-quiz-detail__section" aria-label="週排行榜">
        <div class="admin-lightning-quiz-detail__section-head">
          <h5>週排行榜（答對題數多的在前，同分比答對總用時）</h5>
          ${adminLightningQuizExportButton('data-lq-week-export="members"')}
        </div>
        ${leaderboard.length ? `<ol class="admin-lightning-quiz-leaderboard-list">
          ${leaderboard.map((entry, index) => `<li${index >= ADMIN_LIGHTNING_QUIZ_TOP_SHOWN ? ' class="hidden" data-lq-leaderboard-more' : ''}><span>${escapeHTML(String(entry.rank))}. ${escapeHTML(entry.name || '（未命名）')}</span><span>答對 ${escapeHTML(String(entry.correct))} 題・${escapeHTML(formatElapsedSeconds(entry.correctElapsedMs))} 秒</span></li>`).join('')}
        </ol>
        ${leaderboard.length > ADMIN_LIGHTNING_QUIZ_TOP_SHOWN ? `<button type="button" class="pill-btn" data-lq-leaderboard-toggle>看完整排行（前 ${leaderboard.length} 名）</button>` : ''}` : '<div class="admin-user-directory__empty">這週還沒有人答對。</div>'}
      </section>

      <details class="admin-lightning-quiz-detail__section admin-lq-collapse" aria-label="這週的題目">
        <summary><h5>這週的題目（${escapeHTML(String(questions.length))} 題）</h5></summary>
        ${adminLightningQuizOrgTable(['日期', '送出人數', '答對人數', '答對率', ''],
          questions.map(question => {
            const completed = Number(question.completedCount) || 0;
            const correct = Number(question.correctCount) || 0;
            return `<tr>
              <td>${escapeHTML(formatWeekday(question.riseDate))}</td>
              <td>${escapeHTML(String(completed))}</td>
              <td>${escapeHTML(String(correct))}</td>
              <td>${escapeHTML(formatRate(completed > 0 ? correct / completed : null))}</td>
              <td><button type="button" class="secondary-btn" data-lq-week-question="${escapeHTML(String(question.questionId))}">作答明細</button></td>
            </tr>`;
          }).join(''))}
      </details>

      <details class="admin-lightning-quiz-detail__section admin-lq-collapse" aria-label="大區分析">
        <summary><h5>大區分析</h5></summary>
        <div class="admin-lightning-quiz-detail__section-head">${adminLightningQuizExportButton('data-lq-week-export="region"')}</div>
        ${adminLightningQuizOrgTable(
          ['大區', '應答人數', '參與人數', '參與率', '全部答完', '答對率'],
          regionSummary.rows.map(row => `<tr>
            <td>${escapeHTML(row.greatRegion || UNASSIGNED_REGION_LABEL)}</td>
            ${adminLightningQuizWeekOrgCells(row)}
          </tr>`).join('')
            + `<tr class="admin-lightning-quiz-stats-total"><td>全教會合計</td>${adminLightningQuizWeekOrgCells(regionSummary.total)}</tr>`
        )}
      </details>

      <details class="admin-lightning-quiz-detail__section admin-lq-collapse" aria-label="牧區分析">
        <summary><h5>牧區分析</h5></summary>
        <div class="admin-lightning-quiz-detail__section-head">${adminLightningQuizExportButton('data-lq-week-export="zone"')}</div>
        ${adminLightningQuizOrgTable(
          ['大區', '牧區', '應答人數', '參與人數', '參與率', '全部答完', '答對率'],
          sortZoneRowsByRegion(zoneSummary.rows).map(row => `<tr>
            <td>${escapeHTML(row.greatRegion || UNASSIGNED_REGION_LABEL)}</td>
            <td>${escapeHTML(row.pastoralZone || UNASSIGNED_ZONE_LABEL)}</td>
            ${adminLightningQuizWeekOrgCells(row)}
          </tr>`).join('')
            + `<tr class="admin-lightning-quiz-stats-total"><td colspan="2">全教會合計</td>${adminLightningQuizWeekOrgCells(zoneSummary.total)}</tr>`
        )}
      </details>
    `;
    if (typeof hydrateIcons === 'function') hydrateIcons(body);
    const vouchersHost = body.querySelector('[data-lq-week-vouchers]');
    const isCurrentWeek = () => seq === requestSeq;
    const refreshVouchers = () => renderAdminLightningQuizWeekVouchers(vouchersHost, week.weekStart, isCurrentWeek);
    void renderAdminLightningQuizWeekRanking(body.querySelector('[data-lq-week-ranking]'), week.weekStart, isCurrentWeek, refreshVouchers);
    void refreshVouchers();
    body.querySelector('[data-lq-vouchers-export]')?.addEventListener('click', () => {
      const list = vouchersHost?.lqVouchers || [];
      downloadAdminLightningQuizCsv(list.length ? buildVoucherCsv(list) : '', `雲柱測驗_英雄榜兌換券_${week.weekStart}.csv`);
    });

    body.querySelector('[data-lq-leaderboard-toggle]')?.addEventListener('click', event => {
      body.querySelectorAll('[data-lq-leaderboard-more]').forEach(item => item.classList.remove('hidden'));
      event.currentTarget.remove();
    });
    body.querySelectorAll('[data-lq-week-question]').forEach(button => {
      button.addEventListener('click', () => {
        const question = questions.find(item => String(item.questionId) === button.dataset.lqWeekQuestion);
        if (question) openAdminLightningQuizResults(question);
      });
    });
    body.querySelectorAll('[data-lq-week-export]').forEach(button => {
      button.addEventListener('click', () => {
        const kind = button.dataset.lqWeekExport;
        if (kind === 'members') downloadAdminLightningQuizCsv(buildWeekMembersCsv(week), `雲柱測驗_週名單_${fileSuffix}.csv`);
        else if (kind === 'region') downloadAdminLightningQuizCsv(buildWeekRegionCsv(regionSummary), `雲柱測驗_週大區分析_${fileSuffix}.csv`);
        else if (kind === 'zone') downloadAdminLightningQuizCsv(buildWeekZoneCsv(zoneSummary), `雲柱測驗_週牧區分析_${fileSuffix}.csv`);
      });
    });
  };

  panel.querySelector('[data-lq-week-prev]').addEventListener('click', () => { weekStart = addDays(weekStart, -7); void load(); });
  nextButton.addEventListener('click', () => { if (weekStart < thisWeek) { weekStart = addDays(weekStart, 7); void load(); } });
  panel.querySelector('[data-lq-week-today]').addEventListener('click', () => { weekStart = thisWeek; void load(); });
  return load();
}

export async function renderAdminLightningQuizStats() {
  const host = document.getElementById('admin-lightning-quiz-stats-body');
  if (!host) return;

  const result = await db.adminGetLightningQuizTrend();
  if (!result.success) {
    host.innerHTML = `<div class="admin-user-directory__empty">${escapeHTML(result.message || '載入統計失敗，請稍後再試。')}</div>`;
    return;
  }
  const days = Array.isArray(result.data?.days) ? result.data.days : [];
  destroyAdminLightningQuizTrendCharts();

  // 一題一列（一天最多一題已排程）。
  const rowKey = day => String(day.questionId);
  const rows = days.map((day, index) => {
    // 成長率：跟「上一次有題目的那天」比參與率，而不是硬性比前一個日曆日——
    // 雲柱測驗一週只有一三五，相鄰兩筆資料本來就會隔好幾天。
    const prev = days[index - 1];
    const growth = prev && prev.participationRate > 0
      ? ((day.participationRate - prev.participationRate) / prev.participationRate) * 100
      : null;
    const growthLabel = growth == null ? '—' : `${growth > 0 ? '+' : ''}${growth.toFixed(0)}%`;
    return `<tr data-lightning-quiz-stats-row="${escapeHTML(rowKey(day))}">
      <td>${escapeHTML(formatAdminLightningQuizDate(day.riseDate))}</td>
      <td>${escapeHTML(String(day.completedCount))} / ${escapeHTML(String(day.totalEligible))}（${escapeHTML(formatAdminLightningQuizPercent(day.participationRate))}）</td>
      <td>${growthLabel}</td>
      <td>${escapeHTML(String(day.correctCount))}</td>
      <td>${day.avgElapsedMs != null ? `${(Number(day.avgElapsedMs) / 1000).toFixed(1)} 秒` : '—'}</td>
      <td>
        <div class="admin-lightning-quiz-stats-actions">
          <button type="button" class="secondary-btn" data-lightning-quiz-detail="${escapeHTML(rowKey(day))}">作答明細</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="capsule-segmented-control segment-track admin-lightning-quiz-stats-tabs" role="tablist" aria-label="統計檢視">
      <button type="button" class="segment-toggle-btn active" role="tab" aria-selected="true" data-lq-stats-tab="week">每週統計</button>
      <button type="button" class="segment-toggle-btn" role="tab" aria-selected="false" data-lq-stats-tab="trend">週趨勢</button>
      <button type="button" class="segment-toggle-btn" role="tab" aria-selected="false" data-lq-stats-tab="daily">逐日明細</button>
    </div>
    <div data-lq-stats-panel="week" class="admin-lightning-quiz-week"></div>
    <div data-lq-stats-panel="trend" class="admin-lightning-quiz-trend hidden"></div>
    <div data-lq-stats-panel="daily" class="hidden">
      ${days.length ? `<div class="admin-lightning-quiz-stats-table-wrap">
        <table class="admin-lightning-quiz-stats-table">
          <thead><tr><th>日期</th><th>完成／應答（參與率）</th><th>參與率成長</th><th>答對人數</th><th>平均耗時</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<div class="admin-user-directory__empty">目前還沒有任何題目的作答紀錄。</div>'}
    </div>
  `;
  if (typeof hydrateIcons === 'function') hydrateIcons(host);

  void renderAdminLightningQuizWeekPanel(host.querySelector('[data-lq-stats-panel="week"]'));
  const trendPanel = host.querySelector('[data-lq-stats-panel="trend"]');
  let drawTrend = null;
  host.querySelectorAll('[data-lq-stats-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.lqStatsTab;
      host.querySelectorAll('[data-lq-stats-tab]').forEach(other => {
        const isActive = other === tab;
        other.classList.toggle('active', isActive);
        other.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      host.querySelectorAll('[data-lq-stats-panel]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.lqStatsPanel !== target);
      });
      // 週趨勢第一次切進來才載資料、建圖表（Chart.js 也是這時候才載入）
      if (target === 'trend' && !drawTrend) {
        drawTrend = renderAdminLightningQuizTrendPanel(trendPanel).then(draw => draw && draw());
      }
    });
  });

  host.querySelectorAll('[data-lightning-quiz-detail]').forEach(button => {
    button.addEventListener('click', () => {
      const day = days.find(item => rowKey(item) === button.dataset.lightningQuizDetail);
      if (day) openAdminLightningQuizResults(day);
    });
  });
}

export function init() {
  void renderAdminFeatureSettings();
  // 使用者基本資料、權限管理第一次進入子頁才載（loadAdminSectionDataOnce，#395）。
  renderAdminSectionNav();
  void renderAdminRegistrationStatistics();
  void renderAdminAnnouncements();
  void renderAdminLightningQuizQuestions();
  void renderAdminLightningQuizStats();

  // Bind collapse toggles for every 加入計畫狀況 card (已加入計畫 and 尚未加入計畫
  // both use the same .admin-unjoined-plan-card markup) — each header toggles
  // only its own card, resolved via closest()/scoped querySelector rather than
  // hardcoded ids, so this works uniformly no matter how many such cards exist.
  document.querySelectorAll(".admin-unjoined-plan-card__header").forEach(header => {
    if (header.dataset.listenerBound) return;
    header.dataset.listenerBound = "true";
    header.addEventListener("click", (event) => {
      if (event.target.closest?.("button")) return;
      const section = header.closest(".admin-unjoined-plan-card");
      if (!section) return;
      const arrow = header.querySelector(".admin-unjoined-toggle-arrow");
      const membersList = section.querySelector(".admin-unjoined-plan-members");
      const desc = header.querySelector(".admin-unjoined-plan-desc");

      const isCollapsed = section.classList.toggle("collapsed");
      if (isCollapsed) {
        if (membersList) membersList.style.display = "none";
        if (desc) desc.style.display = "none";
        if (arrow) arrow.style.transform = "rotate(-90deg)";
      } else {
        if (membersList) membersList.style.display = "";
        if (desc) desc.style.display = "";
        if (arrow) arrow.style.transform = "rotate(0deg)";
      }
    });
  });
}

const MANAGEMENT_ROLES = ['admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader'];
let managementPlanSelectionInitialized = false;

function isSystemAdministrator() {
  const role = (state.currentUser && getUserRoleCode(state.currentUser)) || 'member';

  return role === 'admin';
}

function mountPlanManagementSections() {
  const orgFilterSlot = document.getElementById('admin-plan-org-filter-slot');
  const joinStatusPanel = document.getElementById('admin-section-join-status');
  const participantSlot = document.getElementById('admin-plan-participants-slot');
  const statisticsSlot = document.getElementById('admin-plan-statistics-slot');
  const orgControls = document.getElementById('members-organization-controls');
  const unjoinedSection = document.getElementById('admin-unjoined-plan-section');
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

  // The region/zone/group filters are shared across all four plan-management
  // tabs, so they move into the filter slot above the tab bar rather than
  // into any one tab's panel.
  if (orgFilterSlot && orgControls) {
    if (orgControls.parentElement !== orgFilterSlot) orgFilterSlot.appendChild(orgControls);
    orgControls.classList.remove('hidden');
    orgControls.style.display = 'flex';
  }

  // 尚未加入計畫 sits in the 加入計畫狀況 tab, below the (native) 已加入計畫 card.
  if (joinStatusPanel && unjoinedSection) {
    if (unjoinedSection.parentElement !== joinStatusPanel) joinStatusPanel.appendChild(unjoinedSection);
    unjoinedSection.classList.remove('hidden');
    unjoinedSection.style.display = 'block';
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

let activeAdminPlanSubtab = 'join-status';

// ── 統一管理架構：一份功能清單直接控制一組內容面板。 ──
const ADMIN_SECTIONS = [
  { id: 'users',         group: '帳號與權限', label: '使用者基本資料', icon: 'personBox',     panel: 'system', sub: 'users' },
  { id: 'permissions',   group: '帳號與權限', label: '權限管理',       icon: 'shieldCheck',   panel: 'system', sub: 'permissions' },
  { id: 'registrations', group: '報名與回報', label: '報名註冊統計',   icon: 'journalText',   panel: 'system', sub: 'registrations' },
  { id: 'reports',       group: '報名與回報', label: '回報管理',       icon: 'inbox',         panel: 'system', sub: 'reports' },
  { id: 'announcements', group: '內容管理',   label: '公告管理',       icon: 'megaphone',     panel: 'system', sub: 'announcements' },
  { id: 'commentary',    group: '內容管理',   label: '經文注釋',       icon: 'lightbulb',     panel: 'system', sub: 'commentary' },
  { id: 'join-status',   group: '計畫營運',   label: '加入計畫狀況',   icon: 'calendarCheck', panel: 'plans',  sub: 'join-status' },
  { id: 'members',       group: '計畫營運',   label: '組員總覽',       icon: 'peoples',       panel: 'plans',  sub: 'members' },
  { id: 'teams',         group: '計畫營運',   label: '組隊狀況',       icon: 'trophy',        panel: 'plans',  sub: 'teams' },
  { id: 'statistics',    group: '計畫營運',   label: '計畫統計',       icon: 'barChart',      panel: 'plans',  sub: 'statistics' },
  // 讀經使用率（#452）：放在計畫營運，但 panel: 'system' → 只有系統管理員看得到
  { id: 'reading-activity', group: '計畫營運', label: '讀經使用率',     icon: 'trendingUp',    panel: 'system', sub: 'reading-activity' },
  { id: 'quizzes',       group: '測驗',       label: '小測驗',         icon: 'checkCircle',   panel: 'plans',  sub: 'quizzes', flag: 'quiz' },
  { id: 'exam',          group: '測驗',       label: '大測驗',         icon: 'pencil',        panel: 'plans',  sub: 'exam',    flag: 'exam' },
  { id: 'lightning-quiz', group: '測驗',      label: '雲柱測驗',       icon: 'cloud',         panel: 'system', sub: 'lightning-quiz' },
  { id: 'settings',      group: '設定',       label: '功能開放設定',   icon: 'setting',       panel: 'system', sub: 'settings' }
];

function isAdminSectionAvailable(section) {
  if (!section) return false;
  // 系統管理面板（帳號權限 / 報名回報 / 設定）：只有系統管理員看得到。
  if (section.panel === 'system' && !isSystemAdministrator()) return false;
  if (section.flag === 'quiz') return window.dailyQuizFeatureEnabled === true;
  if (section.flag === 'exam') {
    const roleCode = state.currentUser && typeof getUserRoleCode === 'function'
      ? getUserRoleCode(state.currentUser) : null;
    const canSee = ['admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader'].includes(roleCode);
    return canSee && window.speedReadingExamFeatureEnabled === true;
  }
  return true;
}

function getAvailableAdminSections() {
  return ADMIN_SECTIONS.filter(isAdminSectionAvailable);
}

let activeAdminSection = null;

function getAdminSectionPanelId(section) {
  return section ? `admin-section-${section.id}` : '';
}

function revealAdminSectionContent(section) {
  if (!section) return;
  const target = document.getElementById(getAdminSectionPanelId(section));
  if (!target) return;

  requestAnimationFrame(() => {
    const rect = target.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    // 桌機雙欄時內容已在右側，不移動畫面；手機的內容位於長清單下方，
    // 點擊後平滑移到內容頂端，避免「狀態已切換但看起來沒有打開」。
    if (rect.top <= Math.max(120, viewportHeight * 0.55)) return;
    const stickyHeaderOffset = 84;
    window.scrollTo({
      top: Math.max(0, window.scrollY + rect.top - stickyHeaderOffset),
      behavior: 'smooth'
    });
  });
}

const ADMIN_SECTION_MOBILE_QUERY = '(max-width: 959.98px)';

function isAdminSectionMobile() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia(ADMIN_SECTION_MOBILE_QUERY).matches;
}

// 手機 drill-in：關掉子頁 overlay，回到功能清單。返回鍵走頂 bar。
function closeAdminSection() {
  document.body.classList.remove('admin-section-open');
  const content = document.getElementById('admin-section-content');
  if (content) content.scrollTop = 0;
  if (window.appRouter && typeof window.appRouter.updateNavigationChrome === 'function') {
    window.appRouter.updateNavigationChrome();
  }
}
window.closeAdminSection = closeAdminSection;
// 從其他地方（例如通知鈴，#471）直接打開某個後台子頁。
window.openAdminSection = id => setAdminSection(id, { userInitiated: true, focusContent: true });

// 使用者基本資料、權限管理的名單很大，第一次進入子頁才載（#395），權限管理的
// 兩個區塊共用 db 層同一份名單快取。載入失敗就清掉記號，下次進來再試。
const adminSectionDataLoaded = new Set();
const ADMIN_SECTION_DATA_LOADERS = {
  users: () => [renderAdminUserDirectory()],
  permissions: () => [renderAdminOrgPermissionsOverview(), renderAdminManagedScopes()],
  commentary: () => [renderAdminCommentary({
    db,
    books: window.BIBLE_BOOKS,
    verseCounts: window.BIBLE_VERSE_COUNTS || null,
    escapeHTML,
    showToast,
    confirm: options => window.showConfirmDialog(options),
    hydrateIcons: element => { if (typeof hydrateIcons === 'function') hydrateIcons(element); }
  })],
  'reading-activity': () => [renderAdminReadingActivity({ db, escapeHTML, ensureChartLib })]
};

function loadAdminSectionDataOnce(sectionId) {
  const loader = ADMIN_SECTION_DATA_LOADERS[sectionId];
  if (!loader || adminSectionDataLoaded.has(sectionId)) return;
  adminSectionDataLoaded.add(sectionId);
  Promise.all(loader()).then(results => {
    if (results.includes(false)) adminSectionDataLoaded.delete(sectionId);
  }, () => adminSectionDataLoaded.delete(sectionId));
}

function setAdminSection(id, options = {}) {
  const available = getAvailableAdminSections();
  if (available.length === 0) return;
  const section = available.find(s => s.id === id) || available[0];
  activeAdminSection = section.id;
  try { sessionStorage.setItem('selected_admin_section', section.id); } catch (_e) {}

  const targetId = getAdminSectionPanelId(section);
  document.querySelectorAll('#admin-section-content > .admin-section-panel').forEach(panel => {
    const active = panel.id === targetId;
    panel.classList.toggle('hidden', !active);
    panel.style.display = active ? 'flex' : 'none';
  });

  // 手機：只有使用者主動點清單才把內容當全螢幕子頁打開；還原上次選擇
  // （options.userInitiated 沒帶）時只設定狀態、畫面停在清單。
  window.__adminSectionLabel = section.label;
  if (options.userInitiated && isAdminSectionMobile()) {
    document.body.classList.add('admin-section-open');
    const content = document.getElementById('admin-section-content');
    if (content) content.scrollTop = 0;
  } else if (!isAdminSectionMobile()) {
    document.body.classList.remove('admin-section-open');
  }
  if (window.appRouter && typeof window.appRouter.updateNavigationChrome === 'function') {
    window.appRouter.updateNavigationChrome();
  }

  const isPlanSection = section.panel === 'plans';
  const planContext = document.getElementById('admin-plan-context');
  if (planContext) {
    planContext.classList.toggle('hidden', !isPlanSection);
    planContext.style.display = isPlanSection ? 'flex' : 'none';
  }

  if (isPlanSection) {
    activeAdminPlanSubtab = section.sub;
    const sharedOrgFilter = document.querySelector('.admin-plan-filter-card--org');
    if (sharedOrgFilter) {
      const hideSharedOrgFilter = section.sub === 'quizzes' || section.sub === 'exam'
        || section.sub === 'statistics';
      sharedOrgFilter.classList.toggle('hidden', hideSharedOrgFilter);
      sharedOrgFilter.style.display = hideSharedOrgFilter ? 'none' : 'flex';
    }
    const sharedPlanFilter = document.querySelector('.admin-plan-filter-card:not(.admin-plan-filter-card--org)');
    if (sharedPlanFilter) {
      const hidePlanFilter = section.sub === 'exam';
      sharedPlanFilter.classList.toggle('hidden', hidePlanFilter);
      sharedPlanFilter.style.display = hidePlanFilter ? 'none' : 'flex';
    }
    // 依子分頁重新過濾「計畫篩選」下拉，並載入該子分頁資料（涵蓋原本的 loadActiveAdminPlanSubtab）
    if (options.loadData !== false) void syncManagementPlanSelectForSubtab();
  }
  loadAdminSectionDataOnce(section.id);
  renderAdminSectionNav();
  if (options.focusContent === true) revealAdminSectionContent(section);
}

function renderAdminSectionNav() {
  const nav = document.getElementById('admin-section-nav');
  if (!nav) return;
  const sections = getAvailableAdminSections();
  if (sections.length === 0) { nav.innerHTML = ''; return; }
  if (!sections.some(s => s.id === activeAdminSection)) {
    let saved = null;
    try { saved = sessionStorage.getItem('selected_admin_section'); } catch (_e) {}
    activeAdminSection = sections.some(s => s.id === saved) ? saved : sections[0].id;
  }

  const groups = [];
  sections.forEach(section => {
    let bucket = groups.find(g => g.name === section.group);
    if (!bucket) { bucket = { name: section.group, items: [] }; groups.push(bucket); }
    bucket.items.push(section);
  });

  nav.innerHTML = groups.map(group => `
    <div class="admin-section-nav__group">
      <p class="admin-section-nav__group-label">${escapeHTML(group.name)}</p>
      <div class="admin-section-nav__list">
        ${group.items.map(section => `
          <button type="button" class="admin-section-nav__item${section.id === activeAdminSection ? ' is-active' : ''}"
            data-admin-section="${section.id}" aria-current="${section.id === activeAdminSection ? 'true' : 'false'}">
            <span class="admin-section-nav__icon"><span class="nlc-icon" data-icon="${section.icon}" aria-hidden="true"></span></span>
            <span class="admin-section-nav__label">${escapeHTML(section.label)}</span>
            <span class="admin-section-nav__chevron"><span class="nlc-icon nlc-icon--sm" data-icon="chevronRight" aria-hidden="true"></span></span>
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');

  nav.querySelectorAll('[data-admin-section]').forEach(button => {
    button.addEventListener('click', () => setAdminSection(button.dataset.adminSection, { userInitiated: true, focusContent: true }));
  });
  if (typeof hydrateIcons === 'function') hydrateIcons(nav);

  // 手機 drill-in 的返回鍵走頂 bar 的 #global-back-btn（appRouter.goBack 處理）。
  // 切回桌機寬度時，overlay 狀態就沒意義了 —— 清掉。
  if (!window.__adminSectionResizeBound && typeof window.matchMedia === 'function') {
    window.__adminSectionResizeBound = true;
    window.matchMedia(ADMIN_SECTION_MOBILE_QUERY).addEventListener('change', event => {
      if (!event.matches) closeAdminSection();
    });
  }
}

window.renderAdminSectionNav = renderAdminSectionNav;
window.setAdminSection = setAdminSection;

// 網址 hash 路由（app-hash-routing.mjs，#370）：目前開著的後台功能。手機上還停在功能清單
// （沒點進子頁）就不算，免得重新整理後直接跳進子頁。
export function getAdminRouteSection() {
  if (!activeAdminSection) return null;
  if (isAdminSectionMobile() && !document.body.classList.contains('admin-section-open')) return null;
  return activeAdminSection;
}

// 從網址開某個後台功能；這個人沒有這個功能（角色、功能開關）就停在清單。
export function openAdminSectionRoute(id) {
  if (!getAvailableAdminSections().some(section => section.id === id)) return false;
  setAdminSection(id, { userInitiated: true, focusContent: true });
  return true;
}

// 計畫篩選清單的規則在 management-plans.mjs，App 管理分頁（pastoral.js，#551）共用同一份。
function getManagementPlans() {
  return listManagementPlans({
    activePlans: state.activePlans,
    globalPlans: state.globalPlans,
    generatePlanObject: typeof generatePlanObject === 'function' ? generatePlanObject : null,
    isPlanHidden: typeof isPlanHidden === 'function' ? isPlanHidden : null,
    canManageHiddenPlans: typeof canManageHiddenPlans === 'function' ? canManageHiddenPlans : null
  });
}

async function selectManagementPlan(planKey, forceRefresh = false) {
  try {
    const plans = getManagementPlans();
    const plan = plans.find(item => [item.globalPlanId, item.id, item.presetKey, item.name].filter(Boolean).map(String).includes(String(planKey))) || plans[0] || null;
    if (!plan) return;
    state.adminManagementPlan = plan;
    window.currentPlanViewState = 'ORG_STATS';
    await loadActiveAdminPlanSubtab(forceRefresh);
  } catch (err) {
    console.error("[AdminManagement] Error in selectManagementPlan:", err);
  }
}

function adminQuizDateToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function adminQuizEscape(value) {
  return typeof escapeHTML === 'function' ? escapeHTML(String(value ?? '')) : String(value ?? '');
}

// 自訂題目（"Version C"）編輯器：題型一~五，跟 quiz-import.mjs 解析出來的
// {id, type, payload, answerKey, explanation, verseRef} 是同一種形狀，所以
// 匯入面板可以直接把解析結果塞進這裡的區塊，不用另外轉換。

const ADMIN_QUIZ_CUSTOM_TYPE_LABELS = { truefalse: '是非', single: '單選', multiple: '多選', matching: '配對', ordering: '排序' };

function adminQuizCustomDefaultQuestion(type) {
  switch (type) {
    case 'truefalse': return { type, payload: { stem: '' }, answerKey: true, explanation: '', verseRef: '' };
    case 'multiple': return { type, payload: { stem: '', options: ['', ''] }, answerKey: [], explanation: '', verseRef: '' };
    case 'matching': return { type, payload: { stem: '', left: [{ text: '' }, { text: '' }], right: [{ text: '' }, { text: '' }] }, answerKey: {}, explanation: '', verseRef: '' };
    case 'ordering': return { type, payload: { stem: '', items: [{ text: '' }, { text: '' }] }, answerKey: [], explanation: '', verseRef: '' };
    default: return { type: 'single', payload: { stem: '', options: ['', '', '', ''] }, answerKey: 0, explanation: '', verseRef: '' };
  }
}

function renderAdminQuizCustomOptionRowHtml(text = '', checked = false) {
  return `<div class="admin-quiz-custom-option-row" data-option-row>
    <input type="checkbox" data-option-correct ${checked ? 'checked' : ''}>
    <input class="form-control" data-option-text value="${adminQuizEscape(text)}" placeholder="選項文字">
    <button type="button" class="icon-button icon-button--subtle" data-option-remove aria-label="移除選項"><span class="nlc-icon" data-icon="close" aria-hidden="true"></span></button>
  </div>`;
}

function renderAdminQuizCustomPairRowHtml(leftText = '', rightText = '') {
  return `<div class="admin-quiz-custom-pair-row" data-pair-row>
    <input class="form-control" data-pair-left value="${adminQuizEscape(leftText)}" placeholder="左邊">
    <span class="admin-quiz-custom-pair-arrow" aria-hidden="true">${'↔'}</span>
    <input class="form-control" data-pair-right value="${adminQuizEscape(rightText)}" placeholder="右邊（正確配對）">
    <button type="button" class="icon-button icon-button--subtle" data-pair-remove aria-label="移除這組配對"><span class="nlc-icon" data-icon="close" aria-hidden="true"></span></button>
  </div>`;
}

function renderAdminQuizCustomItemRowHtml(text = '') {
  return `<div class="admin-quiz-custom-item-row" data-item-row>
    <input class="form-control" data-item-text value="${adminQuizEscape(text)}" placeholder="項目文字">
    <button type="button" class="icon-button icon-button--subtle" data-item-remove aria-label="移除這個項目"><span class="nlc-icon" data-icon="close" aria-hidden="true"></span></button>
  </div>`;
}

function renderAdminQuizCustomQuestionBodyHtml(question) {
  const { type, payload = {}, answerKey } = question;
  if (type === 'truefalse') {
    return `<label>正確答案<select class="form-control" data-field="answerKey">
      <option value="true" ${answerKey === true ? 'selected' : ''}>對</option>
      <option value="false" ${answerKey === false ? 'selected' : ''}>錯</option>
    </select></label>`;
  }
  if (type === 'single' || type === 'multiple') {
    const correctSet = type === 'single'
      ? new Set(Number.isInteger(answerKey) ? [answerKey] : [])
      : new Set(Array.isArray(answerKey) ? answerKey : []);
    const options = payload.options && payload.options.length ? payload.options : ['', ''];
    return `<div class="admin-quiz-custom-options" data-options>
      ${options.map((text, i) => renderAdminQuizCustomOptionRowHtml(text, correctSet.has(i))).join('')}
    </div>
    <button type="button" class="secondary-btn" data-option-add>新增選項</button>
    <p class="admin-daily-quiz-note">勾選核取方塊標記正確答案${type === 'single' ? '（只能選一個）' : '（可複選）'}。</p>`;
  }
  if (type === 'matching') {
    const left = payload.left && payload.left.length ? payload.left : [{ text: '' }, { text: '' }];
    const right = payload.right && payload.right.length ? payload.right : [{ text: '' }, { text: '' }];
    const rowCount = Math.max(left.length, right.length, 2);
    return `<div class="admin-quiz-custom-pairs" data-pairs>
      ${Array.from({ length: rowCount }).map((_, i) => renderAdminQuizCustomPairRowHtml(left[i]?.text || '', right[i]?.text || '')).join('')}
    </div>
    <button type="button" class="secondary-btn" data-pair-add>新增配對</button>
    <p class="admin-daily-quiz-note">同一列的左右兩邊即為正確配對，作答時會友看到的左右順序會被打亂。</p>`;
  }
  if (type === 'ordering') {
    const items = payload.items && payload.items.length ? payload.items : [{ text: '' }, { text: '' }];
    return `<div class="admin-quiz-custom-items" data-items>
      ${items.map(item => renderAdminQuizCustomItemRowHtml(item.text || '')).join('')}
    </div>
    <button type="button" class="secondary-btn" data-item-add>新增項目</button>
    <p class="admin-daily-quiz-note">由上到下即為正確順序，作答時會友看到的順序會被打亂。</p>`;
  }
  return '';
}

// 題型切換／新增選項｜配對｜項目 都會改動 DOM 結構，input 事件不會自動涵蓋到
// 這些「按按鈕才變動」的操作，要各自明確呼叫 onChange 通知外層重新檢查是否
// 可以送出。勾選「正確答案」核取方塊會自然觸發 input 事件（外層的委派監聽
// 已經接住），這裡只需要額外處理「單選只能勾一個」的互斥邏輯。
function bindAdminQuizCustomQuestionBlock(fieldset, onChange) {
  const typeSelect = fieldset.querySelector('[data-field="type"]');
  const body = fieldset.querySelector('[data-question-body]');
  if (!typeSelect || !body) return;

  typeSelect.addEventListener('change', () => {
    const nextType = typeSelect.value;
    fieldset.dataset.questionType = nextType;
    body.innerHTML = renderAdminQuizCustomQuestionBodyHtml(adminQuizCustomDefaultQuestion(nextType));
    if (typeof hydrateIcons === 'function') hydrateIcons(body);
    if (typeof onChange === 'function') onChange();
  });

  fieldset.addEventListener('click', event => {
    if (event.target.closest('[data-option-add]')) {
      body.querySelector('[data-options]')?.insertAdjacentHTML('beforeend', renderAdminQuizCustomOptionRowHtml());
      if (typeof hydrateIcons === 'function') hydrateIcons(body);
      if (typeof onChange === 'function') onChange();
    } else if (event.target.closest('[data-option-remove]')) {
      const rows = body.querySelectorAll('[data-option-row]');
      if (rows.length > 2) event.target.closest('[data-option-row]').remove();
      if (typeof onChange === 'function') onChange();
    } else if (event.target.closest('[data-option-correct]') && fieldset.dataset.questionType === 'single') {
      const checkbox = event.target.closest('[data-option-correct]');
      body.querySelectorAll('[data-option-correct]').forEach(other => { if (other !== checkbox) other.checked = false; });
      if (typeof onChange === 'function') onChange();
    } else if (event.target.closest('[data-pair-add]')) {
      body.querySelector('[data-pairs]')?.insertAdjacentHTML('beforeend', renderAdminQuizCustomPairRowHtml());
      if (typeof hydrateIcons === 'function') hydrateIcons(body);
      if (typeof onChange === 'function') onChange();
    } else if (event.target.closest('[data-pair-remove]')) {
      const rows = body.querySelectorAll('[data-pair-row]');
      if (rows.length > 2) event.target.closest('[data-pair-row]').remove();
      if (typeof onChange === 'function') onChange();
    } else if (event.target.closest('[data-item-add]')) {
      body.querySelector('[data-items]')?.insertAdjacentHTML('beforeend', renderAdminQuizCustomItemRowHtml());
      if (typeof hydrateIcons === 'function') hydrateIcons(body);
      if (typeof onChange === 'function') onChange();
    } else if (event.target.closest('[data-item-remove]')) {
      const rows = body.querySelectorAll('[data-item-row]');
      if (rows.length > 2) event.target.closest('[data-item-row]').remove();
      if (typeof onChange === 'function') onChange();
    }
  });
}

// ── 自動發佈規則（#306）：每天 00:00 發給全部小組、23:59 截止，用前一天中午 AI 出好的題目 ──
function renderAdminQuizAutoRuleHtml() {
  return `<section class="glass-card admin-daily-quiz-block" id="admin-quiz-auto-rule">
    <div class="admin-daily-quiz-heading">
      <div><p class="admin-registration-statistics__eyebrow">自動發佈</p><h2>每天自動發佈</h2></div>
    </div>
    <p class="admin-daily-quiz-note">開啟後，每天 00:00 自動發給全部小組、23:59 截止。題目用前一天中午 AI 出好的那一版，或你在日曆上設定的自訂題目；某一天還沒有題目就不會發。</p>
    <label class="admin-quiz-schedule-checkbox">
      <input type="checkbox" data-quiz-auto-rule-toggle disabled>
      <span data-quiz-auto-rule-label>讀取中…</span>
    </label>
  </section>`;
}

async function bindAdminQuizAutoRule(root) {
  const section = root.querySelector('#admin-quiz-auto-rule');
  const toggle = section?.querySelector('[data-quiz-auto-rule-toggle]');
  const label = section?.querySelector('[data-quiz-auto-rule-label]');
  if (!toggle || !label) return;
  const show = rule => {
    toggle.checked = rule.enabled === true;
    label.textContent = rule.enabled ? '已開啟每天 00:00 自動發佈' : '未開啟（小測驗不會自動發給小組）';
  };
  const result = await db.getDailyQuizAutoPublishRule(state.adminManagementPlan);
  if (!result.success) { label.textContent = result.message || '無法讀取自動發佈設定'; return; }
  show(result.data || {});
  toggle.disabled = false;
  toggle.addEventListener('change', async () => {
    const turnOn = toggle.checked;
    if (!window.confirm(turnOn
      ? '開啟後，每天 00:00 會自動把小測驗發給全部小組、23:59 截止。確定開啟？'
      : '關閉後，之後每天都要手動發佈。確定關閉？')) { toggle.checked = !turnOn; return; }
    toggle.disabled = true;
    const saved = await db.setDailyQuizAutoPublishRule(state.adminManagementPlan, turnOn);
    toggle.disabled = false;
    if (!saved.success) { toggle.checked = !turnOn; showToast(saved.message || '儲存失敗'); return; }
    show(saved.data || { enabled: turnOn });
    showToast(turnOn ? '已開啟每天自動發佈' : '已關閉每天自動發佈');
    root._refreshQuizCalendar?.();
  });
}

// 後台結果統計：參與率/平均分/平均時間趨勢 + 搜尋/匯出的逐人作答明細。

function adminQuizStatsDefaultRange() {
  const to = adminQuizDateToday();
  const from = new Date(`${to}T00:00:00`);
  from.setDate(from.getDate() - 13);
  return { from: from.toISOString().slice(0, 10), to };
}

function renderAdminQuizStatsSectionHtml() {
  const { from, to } = adminQuizStatsDefaultRange();
  return `<section class="glass-card admin-daily-quiz-block" aria-labelledby="admin-quiz-stats-title" data-quiz-stats-root>
    <div class="admin-daily-quiz-heading">
      <div><p class="admin-registration-statistics__eyebrow">結果統計</p><h2 id="admin-quiz-stats-title">小測驗結果</h2></div>
    </div>
    <div class="admin-daily-quiz-scope-row">
      <label>起<input type="date" class="form-control" data-quiz-stats-from value="${adminQuizEscape(from)}"></label>
      <label>迄<input type="date" class="form-control" data-quiz-stats-to value="${adminQuizEscape(to)}"></label>
      <button type="button" class="secondary-btn" data-quiz-stats-query>查詢</button>
    </div>
    <div data-quiz-stats-body><p class="admin-daily-quiz-empty">選擇日期區間後點查詢。</p></div>
  </section>`;
}

// 統計簡化版（migration 0196）：只留參與率跟完整名單（含還沒作答的人），
// 不再有平均分數／平均作答時間／每題正確率／PR 公布。
function renderAdminQuizStatsBodyHtml(stats) {
  const trend = Array.isArray(stats.trend) ? stats.trend : [];
  const roster = Array.isArray(stats.roster) ? stats.roster : [];
  return `
    <div class="admin-quiz-stats-table-wrap">
      <table class="admin-quiz-stats-table">
        <thead><tr><th>日期</th><th>參與率</th><th>作答／有資格人數</th></tr></thead>
        <tbody>
          ${trend.length ? trend.map(row => `<tr>
            <td>${adminQuizEscape(row.quizDate)}</td>
            <td>${row.participationRate != null ? `${row.participationRate}%` : '--'}</td>
            <td>${row.submitted}／${row.eligible}</td>
          </tr>`).join('') : '<tr><td colspan="3" class="admin-daily-quiz-empty">這段期間沒有資料。</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="admin-quiz-stats-roster-toolbar">
      <input type="search" class="form-control" data-quiz-stats-search placeholder="搜尋姓名／小組／牧區">
      <button type="button" class="secondary-btn" data-quiz-stats-export>
        <span class="nlc-icon" data-icon="download" aria-hidden="true"></span> 匯出 CSV
      </button>
    </div>
    <div class="admin-quiz-stats-table-wrap">
      <table class="admin-quiz-stats-table">
        <thead><tr><th>姓名</th><th>小組</th><th>牧區</th><th>日期</th><th>狀態</th><th>分數</th></tr></thead>
        <tbody>
          ${roster.length ? roster.map(row => {
            const searchText = `${row.name || ''} ${row.smallGroup || ''} ${row.pastoralZone || ''}`.toLowerCase();
            return `<tr data-quiz-stats-row data-search-text="${adminQuizEscape(searchText)}">
              <td>${adminQuizEscape(row.name || '未設定')}</td>
              <td>${adminQuizEscape(row.smallGroup || '未分組')}</td>
              <td>${adminQuizEscape(row.pastoralZone || '未分牧區')}</td>
              <td>${adminQuizEscape(row.quizDate)}</td>
              <td>${row.completed
                ? '<span class="stat-badge stat-badge--success">已作答</span>'
                : '<span class="stat-badge stat-badge--neutral">尚未作答</span>'}</td>
              <td>${row.completed ? `${row.score}／${row.total}` : '--'}</td>
            </tr>`;
          }).join('') : '<tr><td colspan="6" class="admin-daily-quiz-empty">這段期間沒有可管理的名單。</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

export function convertDailyQuizRosterToCSV(roster, exportedAt = new Date()) {
  if (!roster || roster.length === 0) return '';
  const headers = ['姓名', '小組', '牧區', '大區', '日期', '狀態', '分數', '總題數'];
  const rows = roster.map(row => [
    row.name || '未設定', row.smallGroup || '未分組', row.pastoralZone || '未分牧區', row.greatRegion || '未分區',
    row.quizDate || '', row.completed ? '已作答' : '尚未作答', row.completed ? row.score : '', row.completed ? row.total : ''
  ]);
  return prependTaiwanExportTime([
    headers.join(','),
    ...rows.map(row => row.map(csvCell).join(','))
  ].join('\n'), exportedAt);
}

export function exportDailyQuizRosterCSV(roster) {
  if (!roster || roster.length === 0) {
    if (typeof showToast === 'function') showToast('沒有可供匯出的小測驗結果。');
    return;
  }
  const csvContent = convertDailyQuizRosterToCSV(roster);
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const today = formatTaiwanDate();
  link.setAttribute('href', url);
  link.setAttribute('download', `daily_quiz_results_${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function bindAdminQuizStatsPanel(root, plan) {
  const statsRoot = root.querySelector('[data-quiz-stats-root]');
  if (!statsRoot || statsRoot.dataset.statsBound === 'true') return;
  statsRoot.dataset.statsBound = 'true';
  const fromInput = statsRoot.querySelector('[data-quiz-stats-from]');
  const toInput = statsRoot.querySelector('[data-quiz-stats-to]');
  const queryBtn = statsRoot.querySelector('[data-quiz-stats-query]');
  const body = statsRoot.querySelector('[data-quiz-stats-body]');
  if (!fromInput || !toInput || !queryBtn || !body) return;
  let currentRoster = [];

  const applySearchFilter = keyword => {
    const normalized = keyword.trim().toLowerCase();
    body.querySelectorAll('[data-quiz-stats-row]').forEach(row => {
      row.classList.toggle('hidden', normalized !== '' && !(row.dataset.searchText || '').includes(normalized));
    });
  };

  const runQuery = async () => {
    if (!fromInput.value || !toInput.value) {
      if (typeof showToast === 'function') showToast('請選擇起訖日期。');
      return;
    }
    queryBtn.disabled = true;
    const originalLabel = queryBtn.textContent;
    queryBtn.textContent = '查詢中…';
    const result = await db.getDailyQuizStats(plan, fromInput.value, toInput.value);
    queryBtn.disabled = false;
    queryBtn.textContent = originalLabel;
    if (!result.success) {
      body.innerHTML = `<p class="admin-daily-quiz-empty">${adminQuizEscape(result.message || '查詢失敗，請稍後再試。')}</p>`;
      currentRoster = [];
      return;
    }
    currentRoster = Array.isArray(result.stats.roster) ? result.stats.roster : [];
    body.innerHTML = renderAdminQuizStatsBodyHtml(result.stats);
    if (typeof hydrateIcons === 'function') hydrateIcons(body);

    const searchInput = body.querySelector('[data-quiz-stats-search]');
    searchInput?.addEventListener('input', () => applySearchFilter(searchInput.value));
    body.querySelector('[data-quiz-stats-export]')?.addEventListener('click', () => {
      const keyword = (searchInput?.value || '').trim().toLowerCase();
      const filtered = keyword
        ? currentRoster.filter(row => `${row.name || ''} ${row.smallGroup || ''} ${row.pastoralZone || ''}`.toLowerCase().includes(keyword))
        : currentRoster;
      exportDailyQuizRosterCSV(filtered);
    });
  };

  queryBtn.addEventListener('click', () => { void runQuery(); });
}

// ── 小測驗後台（#307）：三個分頁「日曆／規則設定／統計」────────────────────
// 日曆是未來 7 天，每天一格；點進某一天可以看題目、換一版、改成自訂題目、
// 試作、這天不發。畫面上不再有「版本 A／B」「審核」「發佈範圍」——發佈一律由
// 每天 00:00 的自動發佈負責（#306）。小組長、牧區長只看統計。
const ADMIN_QUIZ_TABS = [
  { key: 'calendar', label: '日曆' },
  { key: 'rules', label: '規則設定' },
  { key: 'stats', label: '統計' }
];

const ADMIN_QUIZ_DAY_STATUS = {
  waiting: { label: '等待出題', kind: 'neutral' },
  generating: { label: '出題中', kind: 'neutral' },
  failed: { label: '出題失敗', kind: 'danger' },
  scheduled: { label: '已排程', kind: 'brand' },
  skipped: { label: '這天不發', kind: 'neutral' },
  open: { label: '作答中', kind: 'success' },
  ended: { label: '已結束', kind: 'neutral' },
  not_published: { label: '沒有發佈', kind: 'neutral' },
  outside_plan: { label: '不在計畫期間', kind: 'neutral' }
};

const ADMIN_QUIZ_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
// 伺服器時間 − 本機時間（#465：算「已等幾秒」用，避免手機時鐘不準）
let adminQuizClockOffsetMs = 0;
const ADMIN_QUIZ_POLL_MS = 3000;
const ADMIN_QUIZ_POLL_LIMIT_MS = 8 * 60 * 1000;

function adminQuizDayLabel(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  if (!year) return String(iso || '');
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${month}/${day}（${ADMIN_QUIZ_WEEKDAYS[weekday]}）`;
}

function adminQuizDaySummary(day, today) {
  if (day.status === 'open' || day.status === 'ended') {
    const rate = `完成 ${Number(day.completed || 0)}／${Number(day.eligible || 0)}`;
    return day.status === 'ended' && day.averageScore != null ? `${rate}・平均 ${day.averageScore}` : rate;
  }
  if (day.status === 'scheduled') return day.source === 'custom' ? '自訂題目' : 'AI 題目';
  if (day.status === 'generating') return QUIZ_GENERATION_STAGES.find(stage => stage.key === (day.aiStage || 'queued'))?.label || '';
  if (day.needsAttention) return '還沒有題目';
  if (day.status === 'waiting' && day.date > today) return '前一天中午出題';
  return '';
}

function adminQuizIsEditableDay(day, today) {
  return day.date >= today && !['open', 'ended', 'outside_plan'].includes(day.status) && Number(day.publishedGroups || 0) === 0;
}

function renderAdminQuizCalendarHtml(calendar, selectedDate) {
  const today = calendar.today;
  const days = Array.isArray(calendar.days) ? calendar.days : [];
  return `${calendar.autoPublishEnabled ? '' : `<div class="admin-quiz-calendar-notice" role="status">
      每天自動發佈還沒開啟，下面這些天都不會自動發給小組。
      <button type="button" class="exam-admin__link" data-quiz-goto-rules>到「規則設定」開啟</button>
    </div>`}
    <div class="admin-quiz-calendar" role="list">
      ${days.map(day => {
        const status = ADMIN_QUIZ_DAY_STATUS[day.status] || { label: day.status, kind: 'neutral' };
        const classes = ['admin-quiz-calendar__day',
          day.date === selectedDate ? 'is-selected' : '',
          day.needsAttention ? 'is-alert' : '',
          day.date === today ? 'is-today' : ''].filter(Boolean).join(' ');
        const summary = adminQuizDaySummary(day, today);
        return `<button type="button" role="listitem" class="${classes}" data-quiz-day="${adminQuizEscape(day.date)}" aria-pressed="${day.date === selectedDate}">
          <span class="admin-quiz-calendar__date">${day.date === today ? '今天 ' : ''}${adminQuizEscape(adminQuizDayLabel(day.date))}</span>
          <span class="stat-badge stat-badge--${day.needsAttention ? 'danger' : status.kind}">${adminQuizEscape(status.label)}</span>
          ${summary ? `<span class="admin-quiz-calendar__summary">${adminQuizEscape(summary)}</span>` : ''}
        </button>`;
      }).join('')}
    </div>
    <div data-quiz-day-detail></div>`;
}

function renderAdminQuizDayQuestionsHtml(rawQuestions) {
  const questions = [];
  (Array.isArray(rawQuestions) ? rawQuestions : []).forEach(raw => {
    try { questions.push({ ...normalizeQuestion(raw), raw }); } catch { /* 格式不認得的題目略過，不讓整頁壞掉 */ }
  });
  if (!questions.length) return '';
  return `<ol class="admin-quiz-day-questions">${questions.map(question => `
    <li>
      <p class="admin-quiz-day-questions__stem"><span class="role-badge">${adminQuizEscape(QUESTION_TYPE_LABELS[question.type] || question.type)}</span> ${adminQuizEscape(question.payload?.stem || '')}</p>
      <p class="admin-quiz-day-questions__answer">正解：${adminQuizEscape(formatResponseForDisplay(question.type, question.payload, question.answerKey))}</p>
      ${renderQuizEvidenceHtml(question.raw)}
    </li>`).join('')}</ol>`;
}

function renderAdminQuizDayDetailHtml(day, today) {
  const status = ADMIN_QUIZ_DAY_STATUS[day.status] || { label: day.status, kind: 'neutral' };
  const editable = adminQuizIsEditableDay(day, today);
  const hasQuestions = Array.isArray(day.questions) && day.questions.length > 0;
  const actions = [];
  if (hasQuestions) actions.push('<button type="button" class="secondary-btn" data-quiz-day-act="trial">試作</button>');
  if (editable) {
    // 出題中不給「請 AI 出題」（伺服器也會擋 quiz_generating）；卡住 5 分鐘後狀態會變失敗，按鈕就回來
    if (day.source !== 'custom' && day.status !== 'generating') {
      actions.push(`<button type="button" class="secondary-btn" data-quiz-day-act="swap">${hasQuestions ? '換一版' : '請 AI 出題'}</button>`);
    }
    actions.push(`<button type="button" class="secondary-btn" data-quiz-day-act="custom">${day.source === 'custom' ? '修改自訂題目' : '改成自訂題目'}</button>`);
    if (day.source === 'custom') actions.push('<button type="button" class="secondary-btn" data-quiz-day-act="use-ai">改回 AI 題目</button>');
    actions.push(day.skip
      ? '<button type="button" class="secondary-btn" data-quiz-day-act="unskip">恢復發佈</button>'
      : '<button type="button" class="secondary-btn" data-quiz-day-act="skip">這天不發</button>');
  }
  const published = day.status === 'open' || day.status === 'ended';
  return `<section class="glass-card admin-daily-quiz-block" aria-live="polite">
    <div class="admin-daily-quiz-heading">
      <div>
        <p class="admin-registration-statistics__eyebrow">${adminQuizEscape(adminQuizDayLabel(day.date))}</p>
        <h2>${adminQuizEscape(status.label)}${day.source === 'custom' ? '・自訂題目' : day.source === 'ai' ? '・AI 題目' : ''}</h2>
      </div>
    </div>
    ${published ? `<p class="admin-daily-quiz-note">已發給 ${Number(day.publishedGroups || 0)} 個小組，完成 ${Number(day.completed || 0)}／${Number(day.eligible || 0)} 人${day.averageScore != null ? `，平均 ${day.averageScore} 分` : ''}。已經發佈的日子不能再修改。</p>` : ''}
    ${day.status === 'generating' ? `<div data-quiz-generation-slot>${renderQuizGenerationProgressHtml(day, quizGenerationElapsedSeconds(day, adminQuizClockOffsetMs))}</div>` : ''}
    ${day.status === 'failed' ? renderQuizGenerationErrorHtml(day.aiError) : ''}
    ${day.status === 'waiting' && day.needsAttention ? '<p class="admin-daily-quiz-note admin-quiz-day-alert">這一天還沒有題目。可以按「請 AI 出題」，或改成自訂題目。</p>' : ''}
    ${day.status === 'skipped' ? '<p class="admin-daily-quiz-note">這一天設成不發，00:00 不會自動發佈。</p>' : ''}
    ${day.status === 'outside_plan' ? '<p class="admin-daily-quiz-note">這一天不在這個計畫的期間，不會出題也不會發佈。</p>' : ''}
    ${actions.length ? `<div class="admin-quiz-day-actions">${actions.join('')}</div>` : ''}
    <div data-quiz-day-work></div>
    ${hasQuestions ? renderAdminQuizDayQuestionsHtml(day.questions) : '<p class="admin-daily-quiz-empty">這一天還沒有題目。</p>'}
  </section>`;
}

function renderAdminQuizDayImportHtml() {
  return `<div class="admin-quiz-custom-editor">
    <label for="admin-quiz-day-import">貼上題目（每題之間空一行，第一行寫題型，例如 [單選]、[是非]）</label>
    <textarea id="admin-quiz-day-import" class="form-control" rows="10" placeholder="[單選] 以色列人在曠野吃的食物叫什麼？
A. 嗎哪
B. 餅
答案：A

[是非] 摩西帶領以色列人出埃及。
答案：對"></textarea>
    <p class="admin-daily-quiz-note" data-quiz-import-result>共 2～10 題。貼上後按「檢查格式」。</p>
    <div class="admin-quiz-day-actions">
      <button type="button" class="secondary-btn" data-quiz-import-check>檢查格式</button>
      <button type="button" class="primary-btn" data-quiz-import-save disabled>儲存成這天的題目</button>
      <button type="button" class="secondary-btn" data-quiz-import-cancel>取消</button>
    </div>
  </div>`;
}

async function renderAdminQuizCalendar(root, selectedDate = null) {
  const panel = root.querySelector('[data-quiz-tab-panel="calendar"]');
  if (!panel) return;
  if (!panel.querySelector('.admin-quiz-calendar')) panel.innerHTML = '<div class="admin-user-directory__empty">正在載入小測驗日曆…</div>';
  const result = await db.getDailyQuizCalendar(state.adminManagementPlan, null, 7);
  if (!result.success) {
    panel.innerHTML = `<div class="admin-user-directory__empty">${adminQuizEscape(result.message || '無法載入小測驗日曆')}</div>`;
    return;
  }
  const calendar = result.data || {};
  const days = Array.isArray(calendar.days) ? calendar.days : [];
  const serverNow = Date.parse(calendar.serverNow || '');
  if (Number.isFinite(serverNow)) adminQuizClockOffsetMs = serverNow - Date.now();
  const current = days.some(day => day.date === selectedDate) ? selectedDate
    : (days.some(day => day.date === root.dataset.quizSelectedDay) ? root.dataset.quizSelectedDay : days[0]?.date);
  root.dataset.quizSelectedDay = current || '';
  panel.innerHTML = renderAdminQuizCalendarHtml(calendar, current);

  const showDetail = date => {
    const day = days.find(item => item.date === date);
    const host = panel.querySelector('[data-quiz-day-detail]');
    if (!day || !host) return;
    root.dataset.quizSelectedDay = date;
    panel.querySelectorAll('[data-quiz-day]').forEach(button => {
      const on = button.dataset.quizDay === date;
      button.classList.toggle('is-selected', on);
      button.setAttribute('aria-pressed', String(on));
    });
    host.innerHTML = renderAdminQuizDayDetailHtml(day, calendar.today);
    bindAdminQuizDayDetail(root, host, day);
    if (day.status === 'generating') watchAdminQuizGeneration(root, host, day);
  };
  panel.querySelectorAll('[data-quiz-day]').forEach(button => button.addEventListener('click', () => showDetail(button.dataset.quizDay)));
  panel.querySelector('[data-quiz-goto-rules]')?.addEventListener('click', () => switchAdminQuizTab(root, 'rules'));
  if (current) showDetail(current);
}

// #465：出題中每 3 秒查一次這一天的狀態，每秒更新「已等幾秒」；出好或失敗就重畫整個日曆。
// 換到別天、離開頁面（進度區塊不在畫面上）就停。
function watchAdminQuizGeneration(root, host, day) {
  const slot = host.querySelector('[data-quiz-generation-slot]');
  if (!slot) return;
  const plan = state.adminManagementPlan;
  const pollingSince = Date.now();
  let current = day;
  const draw = () => {
    slot.innerHTML = renderQuizGenerationProgressHtml(current, quizGenerationElapsedSeconds(current, adminQuizClockOffsetMs));
  };
  const clock = setInterval(() => (slot.isConnected ? draw() : clearInterval(clock)), 1000);
  const poll = async () => {
    if (!slot.isConnected) { clearInterval(clock); return; }
    const result = await db.getDailyQuizCalendar(plan, day.date, 1);
    if (!slot.isConnected) { clearInterval(clock); return; }
    const next = result.success && Array.isArray(result.data?.days) ? result.data.days[0] : null;
    if (next && next.date === day.date && next.status !== 'generating') {
      clearInterval(clock);
      showToast(next.status === 'failed' ? 'AI 出題失敗，請看下方說明。' : 'AI 已出好題目。');
      await renderAdminQuizCalendar(root, day.date);
      return;
    }
    if (next) { current = next; draw(); }
    if (Date.now() - pollingSince > ADMIN_QUIZ_POLL_LIMIT_MS) { clearInterval(clock); return; }
    setTimeout(poll, ADMIN_QUIZ_POLL_MS);
  };
  setTimeout(poll, ADMIN_QUIZ_POLL_MS);
}

function bindAdminQuizDayDetail(root, host, day) {
  const work = host.querySelector('[data-quiz-day-work]');
  const plan = state.adminManagementPlan;
  const reload = () => renderAdminQuizCalendar(root, day.date);
  const confirmDialog = async (title, message, confirmText) => (typeof window.showConfirmDialog === 'function'
    ? window.showConfirmDialog({ title, message, confirmText, cancelText: '返回' })
    : window.confirm(`${title}\n${message}`));
  const run = async (button, action, successText) => {
    button.disabled = true;
    const result = await action();
    button.disabled = false;
    if (!result.success) { showToast(result.message || '操作失敗，請稍後再試。'); return; }
    showToast(successText);
    await reload();
  };

  host.querySelectorAll('[data-quiz-day-act]').forEach(button => button.addEventListener('click', async () => {
    const act = button.dataset.quizDayAct;
    if (act === 'trial') {
      mountDailyQuizTrial(work, day.questions, { onClose: () => { work.innerHTML = ''; } });
      work.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (act === 'custom') {
      work.innerHTML = renderAdminQuizDayImportHtml();
      bindAdminQuizDayImport(work, day, reload);
      return;
    }
    if (act === 'swap') {
      if (!await confirmDialog('請 AI 重新出題？', `${adminQuizDayLabel(day.date)} 原本的 AI 題目會被換掉，出題通常要 30 秒到 1 分鐘，畫面上會顯示進度。`, '重新出題')) return;
      await run(button, () => db.swapDailyQuizVersion(plan, day.date), '已請 AI 出題，下面會顯示進度。');
      return;
    }
    if (act === 'use-ai') {
      if (!await confirmDialog('改回 AI 題目？', '這一天的自訂題目會刪掉，改用 AI 出的題目。', '改回 AI 題目')) return;
      await run(button, () => db.setDailyQuizDayCustom(plan, day.date, null), '已改回 AI 題目。');
      return;
    }
    if (act === 'skip') {
      if (!await confirmDialog('這天不發？', `${adminQuizDayLabel(day.date)} 00:00 不會自動發佈小測驗。之後還可以恢復。`, '這天不發')) return;
      await run(button, () => db.setDailyQuizDaySkip(plan, day.date, true), '這一天不會發佈。');
      return;
    }
    if (act === 'unskip') {
      await run(button, () => db.setDailyQuizDaySkip(plan, day.date, false), '已恢復發佈。');
    }
  }));
}

function bindAdminQuizDayImport(work, day, reload) {
  const textarea = work.querySelector('#admin-quiz-day-import');
  const resultEl = work.querySelector('[data-quiz-import-result]');
  const saveBtn = work.querySelector('[data-quiz-import-save]');
  let parsed = null;
  textarea?.addEventListener('input', () => { parsed = null; saveBtn.disabled = true; });
  work.querySelector('[data-quiz-import-check]')?.addEventListener('click', () => {
    const { questions, errors } = parseQuizImportText(textarea.value);
    const countOk = questions.length >= 2 && questions.length <= 10;
    parsed = errors.length === 0 && countOk ? questions : null;
    saveBtn.disabled = !parsed;
    resultEl.textContent = errors.length
      ? `有 ${errors.length} 個地方要修正：${errors.slice(0, 3).map(error => `第 ${Number(error.index) + 1} 題：${error.message || error}`).join('；')}`
      : countOk ? `格式正確，共 ${questions.length} 題。` : `目前 ${questions.length} 題，需要 2～10 題。`;
  });
  work.querySelector('[data-quiz-import-cancel]')?.addEventListener('click', () => { work.innerHTML = ''; });
  saveBtn?.addEventListener('click', async () => {
    if (!parsed) return;
    saveBtn.disabled = true;
    const result = await db.setDailyQuizDayCustom(state.adminManagementPlan, day.date, parsed);
    if (!result.success) { saveBtn.disabled = false; showToast(result.message || '儲存失敗'); return; }
    showToast(`已把 ${adminQuizDayLabel(day.date)} 改成自訂題目。`);
    await reload();
  });
}

function switchAdminQuizTab(root, target) {
  root.dataset.quizActiveTab = target;
  root.querySelectorAll('[data-quiz-tab]').forEach(button => {
    const on = button.dataset.quizTab === target;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', String(on));
  });
  root.querySelectorAll('[data-quiz-tab-panel]').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.quizTabPanel !== target);
  });
}

export async function renderAdminDailyQuizManagement(forceRefresh = false) {
  const root = document.getElementById('admin-daily-quiz-root');
  if (!root || !state.adminManagementPlan) return;
  const planKey = String(db._quizPlanId?.(state.adminManagementPlan) || '');
  // 回到這個分頁、同一個計畫：保留畫面，不重新載入（明確重新整理才重抓）
  if (!forceRefresh && root.dataset.quizPlanKey === planKey && root.childElementCount) return;
  root.dataset.quizPlanKey = planKey;

  const canPublish = typeof getUserRoleCode === 'function' && getUserRoleCode(state.currentUser) === 'admin';
  const tab = canPublish
    ? (ADMIN_QUIZ_TABS.some(item => item.key === root.dataset.quizActiveTab) ? root.dataset.quizActiveTab : 'calendar')
    : 'stats';
  root.dataset.quizActiveTab = tab;
  root.innerHTML = `
    ${canPublish ? `<div class="segment-track admin-quiz-subtab-nav" role="tablist" aria-label="小測驗管理">
      ${ADMIN_QUIZ_TABS.map(item => `<button type="button" class="segment-toggle-btn${item.key === tab ? ' active' : ''}" data-quiz-tab="${item.key}" role="tab" aria-selected="${item.key === tab}">${item.label}</button>`).join('')}
    </div>
    <div data-quiz-tab-panel="calendar" class="${tab === 'calendar' ? '' : 'hidden'}"></div>
    <div data-quiz-tab-panel="rules" class="${tab === 'rules' ? '' : 'hidden'}">${renderAdminQuizAutoRuleHtml()}</div>` : ''}
    <div data-quiz-tab-panel="stats" class="${tab === 'stats' ? '' : 'hidden'}">${renderAdminQuizStatsSectionHtml()}</div>`;

  if (canPublish) {
    root.querySelectorAll('[data-quiz-tab]').forEach(button => button.addEventListener('click', () => switchAdminQuizTab(root, button.dataset.quizTab)));
    // 規則開關改了，日曆上方的「還沒開啟」提示要跟著更新
    root._refreshQuizCalendar = () => renderAdminQuizCalendar(root, root.dataset.quizSelectedDay || null);
    void renderAdminQuizCalendar(root);
    void bindAdminQuizAutoRule(root);
  }
  bindAdminQuizStatsPanel(root, state.adminManagementPlan);
  if (typeof hydrateIcons === 'function') hydrateIcons(root);
}

async function loadActiveAdminPlanSubtab(forceRefresh = false) {
  const warnRejected = (label, result) => {
    if (result.status === 'rejected') console.warn(`[Admin] ${label} error caught:`, result.reason);
  };

  // The 大區/牧區/小組 org filter bar (members-organization-controls) is
  // shared across all four subtabs (mountPlanManagementSections() moves it
  // above the tab bar, outside any one tab's panel), but it only used to get
  // populated as a side effect of renderPlanMembersView() — which only runs
  // for the 'members'/'statistics' subtabs. On a fresh session the default
  // subtab is 'join-status', so the filter selects stayed empty (no
  // <option>s at all) until the user manually switched tabs. Populate them
  // here unconditionally instead — it's a cheap, synchronous DOM operation
  // (reads already-loaded state.orgStructure/state.currentUser, no network
  // call) and is idempotent (its change-listener bindings are dataset-guarded).
  if (activeAdminPlanSubtab !== 'quizzes' && activeAdminPlanSubtab !== 'exam' && typeof window.populateMembersSelector === 'function') {
    try { window.populateMembersSelector(); } catch (e) { console.warn('[Admin] populateMembersSelector error caught:', e); }
  }

  if (activeAdminPlanSubtab === 'join-status') {
    // These two independent RPCs are the only data needed for the first
    // visible subtab. Run them together instead of adding both network
    // latencies to the critical path.
    const results = await Promise.allSettled([
      renderAdminJoinedPlanMembers(forceRefresh),
      renderAdminUnjoinedPlanMembers(forceRefresh)
    ]);
    warnRejected('renderAdminJoinedPlanMembers', results[0]);
    warnRejected('renderAdminUnjoinedPlanMembers', results[1]);
    return;
  }

  if (activeAdminPlanSubtab === 'members' || activeAdminPlanSubtab === 'statistics') {
    if (typeof window.renderPlanMembersView === 'function') {
      try { await window.renderPlanMembersView(); } catch (e) { console.warn('[Admin] renderPlanMembersView error caught:', e); }
    }
    return;
  }

  if (activeAdminPlanSubtab === 'quizzes') {
    await renderAdminDailyQuizManagement(forceRefresh);
    return;
  }

  if (activeAdminPlanSubtab === 'exam') {
    const root = document.getElementById('admin-exam-root');
    if (root) {
      try { await renderExamPanel(root); } catch (e) { console.warn('[Admin] renderExamPanel error caught:', e); }
    }
    return;
  }

  if (activeAdminPlanSubtab === 'teams') {
    const results = await Promise.allSettled([
      renderAdminTeamPlacementLookup(state.adminManagementPlan, forceRefresh),
      (async () => {
        // Both divisions use the same overview payload. The first call may
        // refresh it; the second renders from the cache populated above.
        await renderAdminTeamRegistrationStatus(forceRefresh, 3, 'admin-team-status-content');
        await renderAdminTeamRegistrationStatus(false, 6, 'admin-team-status-content-6');
      })()
    ]);
    warnRejected('renderAdminTeamPlacementLookup', results[0]);
    warnRejected('renderAdminTeamRegistrationStatus', results[1]);
  }
}

// 「計畫篩選」下拉：列出可管理的計畫，onchange 走 selectManagementPlan。
async function syncManagementPlanSelectForSubtab() {
  const select = document.getElementById('admin-management-plan-select');
  if (!select) return;
  const plans = getManagementPlans();

  const keyOf = p => String(p.globalPlanId || p.id || p.presetKey || p.name);
  select.innerHTML = '';
  if (plans.length === 0) {
    select.options.add(new Option('目前沒有可管理的計畫', ''));
    select.disabled = true;
    select.onchange = null;
    return;
  }
  select.disabled = false;
  plans.forEach(plan => {
    const statusLabel = plan.managementStatus === 'upcoming' ? '（提前報名）' : '';
    select.options.add(new Option(`${plan.name || '未命名計畫'}${statusLabel}`, keyOf(plan)));
  });

  // 優先沿用「計畫篩選」上一次自己選的計畫（adminManagementPlan），只有從未選過時才預設帶入
  // 使用者自己目前在讀的計畫（activePlan）；兩者分開存放，選這裡的計畫不會影響使用者的首頁/繼續閱讀狀態。
  const referencePlan = state.adminManagementPlan || state.activePlan;
  const activeKeys = referencePlan
    ? [referencePlan.globalPlanId, referencePlan.id, referencePlan.presetKey, referencePlan.name].filter(Boolean).map(String)
    : [];
  const matchingOption = Array.from(select.options).find(o => activeKeys.includes(o.value));
  const ongoingPlan = plans.find(plan => plan.managementStatus === 'ongoing');
  const defaultPlan = (matchingOption ? plans.find(p => keyOf(p) === matchingOption.value) : null) || ongoingPlan || plans[0];
  select.value = !managementPlanSelectionInitialized
    ? keyOf(defaultPlan)
    : (matchingOption ? matchingOption.value : keyOf(defaultPlan));
  managementPlanSelectionInitialized = true;
  select.onchange = () => selectManagementPlan(select.value);
  await selectManagementPlan(select.value);
}

export async function renderAdminPlanManagement() {
  try {
    const role = (state.currentUser && getUserRoleCode(state.currentUser)) || 'member';
    if (!MANAGEMENT_ROLES.includes(role)) {
      const content = document.getElementById('admin-section-content');
      if (content) content.innerHTML = '<div class="admin-unjoined-plan-empty" style="padding: 2rem; text-align: center;">您目前沒有管理權限。</div>';
      return;
    }
    mountPlanManagementSections();
    applyAdminExamVisibility(window.speedReadingExamFeatureEnabled === true);

    // 還原統一功能清單的選擇；不再經過舊 system/plans tab 包裝層。
    let savedSection = null;
    try { savedSection = sessionStorage.getItem('selected_admin_section'); } catch (_e) {}
    setAdminSection(savedSection || activeAdminSection, { loadData: false });

    // 依目前子分頁把「計畫篩選」下拉過濾成只剩相關類型，並載入該子分頁的資料
    await syncManagementPlanSelectForSubtab();

    const refreshBtn = document.getElementById('admin-plan-refresh-btn');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = 'true';
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        try {
          // Clicking "更新" must force a genuine reload, not just re-run the
          // same render against whatever's cached: without clearing the
          // merged-users cache here selectManagementPlan() silently reuses
          // the stale list.
          db.invalidateMergedUsersCache();
          const currentSelect = document.getElementById('admin-management-plan-select');
          if (currentSelect && currentSelect.value) {
            await selectManagementPlan(currentSelect.value, true);
          }
          // 名單快取也清掉；權限總覽還沒打開過就不用現在載（#395）。
          db.invalidateAdminUserDirectoryCache();
          if (adminSectionDataLoaded.has('permissions')) void renderAdminOrgPermissionsOverview();
          if (typeof showToast === 'function') showToast('資料已更新');
        } finally {
          refreshBtn.disabled = false;
        }
      });
    }

    if (typeof hydrateIcons === 'function') hydrateIcons(document.getElementById('admin-view'));
  } catch (err) {
    console.error("[AdminManagement] Error rendering admin plan management:", err);
  }
}

// Bind to window for global access compatibility
window.renderAdminFeatureSettings = renderAdminFeatureSettings;
window.renderAdminPlanManagement = renderAdminPlanManagement;
let cachedTeamsData = null;
let cachedTeamsDataKey = "";
let lastRenderedTeamPlans = { 3: [], 6: [] };

function formatTeamPlanDate(value) {
  if (!value) return "";
  return formatTaiwanDate(value).replace(/-/g, "/");
}

export function convertTeamRegistrationStatusToCSV(plans, division, exportedAt = new Date()) {
  if (!Array.isArray(plans) || plans.length === 0) return "";
  const esc = csvCell;
  const memberHeaders = [];
  for (let i = 2; i <= Number(division); i++) memberHeaders.push(`隊員${i}`);
  const lines = [];

  plans.forEach((item, index) => {
    const teams = Array.isArray(item.teams) ? item.teams : [];
    const planName = item.plan?.name || item.name || "（無名稱）";
    const planStart = formatTeamPlanDate(item.plan?.startDate || item.startDate);
    const planEnd = formatTeamPlanDate(item.plan?.endDate || item.endDate);
    const planPeriod = planStart && planEnd ? `${planStart}－${planEnd}` : "";
    const signupCount = teams.filter(team => team.status === "forming").length;
    const readyCount = teams.filter(team => team.status === "ready").length;
    const totalMembers = teams.reduce((acc, team) => acc + (team.memberCount || 0), 0);

    if (index > 0) lines.push("");
    lines.push([esc("計畫"), esc(planName)].join(","));
    if (planPeriod) lines.push([esc("計畫期間"), esc(planPeriod)].join(","));
    lines.push([esc("招募中"), esc(`${signupCount} 隊`)].join(","));
    lines.push([esc("已成隊"), esc(`${readyCount} 隊`)].join(","));
    lines.push([esc("總報名人數"), esc(`${totalMembers} 人`)].join(","));
    lines.push("");
    lines.push([esc("隊長所屬牧區"), esc("隊名"), esc("狀態"), esc("人數"), esc("隊長"), ...memberHeaders.map(esc)].join(","));

    const sortedTeams = sortByChurchOrgOrder(teams, comparePastoralZones, team => {
      const members = Array.isArray(team.members) ? team.members : [];
      const captain = members.find(member => member.role === "captain") || {};
      return team.captainPastoralZone || captain.pastoralZone || "";
    });
    sortedTeams.forEach(team => {
      const members = Array.isArray(team.members) ? team.members : [];
      const captain = members.find(member => member.role === "captain") || {};
      const captainZone = team.captainPastoralZone || captain.pastoralZone || "未設定";
      const otherMembers = members.filter(member => member.role !== "captain");
      const teamStatus = team.status === "ready" ? "已成隊" : "招募中";
      const memberCount = Number(team.memberCount || members.length || 0);
      const row = [captainZone, team.name || "（無名稱）", teamStatus, `${memberCount}/${division} 人`, captain.name || "-"];
      for (let i = 0; i < Number(division) - 1; i++) {
        const member = otherMembers[i];
        row.push(member && member.name ? `${member.name}${member.pastoralZone ? `（${member.pastoralZone}）` : ""}` : "-");
      }
      lines.push(row.map(esc).join(","));
    });
  });

  return prependTaiwanExportTime(lines.join("\n"), exportedAt);
}

export function exportTeamRegistrationStatusCSV(division) {
  const plans = lastRenderedTeamPlans[Number(division)] || [];
  const hasAnyTeam = plans.some(item => Array.isArray(item.teams) && item.teams.length > 0);
  if (!hasAnyTeam) {
    if (typeof showToast === "function") showToast("目前沒有可供匯出的團隊報名資料。");
    return;
  }
  const csvContent = convertTeamRegistrationStatusToCSV(plans, division);
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = formatTaiwanDate();
  link.setAttribute("href", url);
  link.setAttribute("download", `team_registration_${division}person_${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
window.convertTeamRegistrationStatusToCSV = convertTeamRegistrationStatusToCSV;
window.exportTeamRegistrationStatusCSV = exportTeamRegistrationStatusCSV;

export function convertTeamMemberRosterToCSV(plans, division, exportedAt = new Date()) {
  if (!Array.isArray(plans) || plans.length === 0) return "";
  const esc = csvCell;
  const lines = [];
  let totalMembers = 0;

  plans.forEach((item, index) => {
    const teams = Array.isArray(item.teams) ? item.teams : [];
    const planName = item.plan?.name || item.name || "（無名稱）";
    const planStart = formatTeamPlanDate(item.plan?.startDate || item.startDate);
    const planEnd = formatTeamPlanDate(item.plan?.endDate || item.endDate);
    const planPeriod = planStart && planEnd ? `${planStart}－${planEnd}` : "";

    if (index > 0) lines.push("");
    lines.push([esc("計畫"), esc(planName)].join(","));
    if (planPeriod) lines.push([esc("計畫期間"), esc(planPeriod)].join(","));
    lines.push("");
    lines.push([esc("大區"), esc("牧區"), esc("小組"), esc("隊名"), esc("隊伍狀態"), esc("角色"), esc("姓名")].join(","));

    const sortedTeams = sortByChurchOrgOrder(teams, comparePastoralZones, team => {
      const members = Array.isArray(team.members) ? team.members : [];
      const captain = members.find(member => member.role === "captain") || {};
      return team.captainPastoralZone || captain.pastoralZone || "";
    });
    sortedTeams.forEach(team => {
      const members = Array.isArray(team.members) ? team.members : [];
      const teamStatus = team.status === "ready" ? "已成隊" : "招募中";
      const sortedMembers = [...members].sort((a, b) => {
        if (a.role === "captain" && b.role !== "captain") return -1;
        if (a.role !== "captain" && b.role === "captain") return 1;
        return 0;
      });
      sortedMembers.forEach(member => {
        totalMembers += 1;
        lines.push([
          member.greatRegion || "未設定",
          member.pastoralZone || "未設定",
          member.smallGroup || "未設定",
          team.name || "（無名稱）",
          teamStatus,
          member.role === "captain" ? "隊長" : "隊員",
          member.name || "未命名"
        ].map(esc).join(","));
      });
    });
  });

  lines.push("");
  lines.push([esc("總人數"), esc(`${totalMembers} 人`)].join(","));

  return prependTaiwanExportTime(lines.join("\n"), exportedAt);
}

export function exportTeamMemberRosterCSV(division) {
  const plans = lastRenderedTeamPlans[Number(division)] || [];
  const hasAnyTeam = plans.some(item => Array.isArray(item.teams) && item.teams.length > 0);
  if (!hasAnyTeam) {
    if (typeof showToast === "function") showToast("目前沒有可供匯出的組員資料。");
    return;
  }
  const csvContent = convertTeamMemberRosterToCSV(plans, division);
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = formatTaiwanDate();
  link.setAttribute("href", url);
  link.setAttribute("download", `team_member_roster_${division}person_${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
window.convertTeamMemberRosterToCSV = convertTeamMemberRosterToCSV;
window.exportTeamMemberRosterCSV = exportTeamMemberRosterCSV;
let cachedUnjoinedPlanKey = "";
let cachedUnjoinedPlanMembers = [];
let unjoinedPlanRequestId = 0;
let bulkPlanInviteInProgress = false;

function getSelectedManagementOrgFilter() {
  const role = (state.currentUser && getUserRoleCode(state.currentUser)) || "member";
  // "unassigned" is the sentinel shown when a leader has no org placement at
  // all (see setupCascadingSelectors in plan.js) — treat it as no selection.
  const readScope = id => {
    const value = document.getElementById(id)?.value || "";
    return value === "unassigned" ? "" : value;
  };
  const region = readScope("members-admin-region-select");
  const zone = readScope("members-admin-zone-select");
  const group = readScope("members-admin-group-select");
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
  const plan = state.adminManagementPlan;
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
    if (firstPaint(container)) container.innerHTML = '<div class="admin-unjoined-plan-empty">讀取尚未加入的人員中...</div>';

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
    const memberName = escapeHTML(member.name || "未設定");
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
    const planAtStart = state.adminManagementPlan;
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
      // Only ids — never the full member record (name, pastoral placement)
      // this list carries, even though the admin viewing it can already see
      // that same data rendered on screen; no reason to also put it in the
      // console history.
      console.warn("Bulk plan invitation failures", { planId: planAtStart?.id, memberIds: failedMembers.map(m => m?.id).filter(Boolean) });
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
      const result = await db.sendPlanJoinInvitation(state.adminManagementPlan, memberId);
      if (!result || !result.success) {
        button.disabled = false;
        button.textContent = originalText;
        if (typeof showToast === "function") showToast(result && result.message ? result.message : "提醒傳送失敗，請稍後再試。");
        return;
      }
      if (member) member.remindedToday = true;
      button.textContent = "今天已提醒";
      if (typeof showToast === "function") showToast(`已提醒 ${member && member.name || "這位夥伴"} 加入「${state.adminManagementPlan && state.adminManagementPlan.name || "所選計畫"}」`);
    };
  });
}
let cachedJoinedPlanKey = "";
let cachedJoinedPlanMembers = [];
let joinedPlanRequestId = 0;

function formatAdminJoinedPlanDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
}

async function renderAdminJoinedPlanMembers(forceRefresh = false) {
  const container = document.getElementById("admin-joined-plan-members");
  const count = document.getElementById("admin-joined-plan-count");
  if (!container || !count) return;

  const currentUser = state.currentUser || {};
  const plan = state.adminManagementPlan;
  if (!MANAGEMENT_ROLES.includes(getUserRoleCode(currentUser)) || !plan) {
    count.textContent = "0 人";
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

  if (forceRefresh || cachedJoinedPlanKey !== cacheKey) {
    const requestId = ++joinedPlanRequestId;
    cachedJoinedPlanKey = cacheKey;
    cachedJoinedPlanMembers = [];
    count.textContent = "讀取中";
    if (firstPaint(container)) container.innerHTML = '<div class="admin-unjoined-plan-empty">讀取已加入計畫的人員中...</div>';

    const result = await db.getJoinedPlanMembers(plan);
    if (requestId !== joinedPlanRequestId) return;
    if (!result || !result.success) {
      console.warn("Unable to load joined plan members", result && (result.error || result.message));
      count.textContent = "0 人";
      container.innerHTML = `
        <div class="admin-unjoined-plan-empty" role="status">
          <div>目前沒有可顯示的已加入人員。</div>
          <button type="button" class="secondary-btn" id="admin-joined-plan-retry" style="margin-top:0.75rem;">重新整理</button>
        </div>`;
      const retryButton = document.getElementById("admin-joined-plan-retry");
      if (retryButton) retryButton.onclick = () => renderAdminJoinedPlanMembers(true);
      return;
    }
    cachedJoinedPlanMembers = Array.isArray(result.context && result.context.members)
      ? result.context.members
      : [];
  }

  const visibleMembers = cachedJoinedPlanMembers.filter(member => memberMatchesManagementOrgFilter(member));
  count.textContent = `${visibleMembers.length} 人`;
  if (visibleMembers.length === 0) {
    container.innerHTML = '<div class="admin-unjoined-plan-empty">目前篩選範圍內沒有已加入所選計畫的人員。</div>';
    return;
  }

  container.innerHTML = visibleMembers.map(member => {
    const memberName = escapeHTML(member.name || "未設定");
    const scope = [
      member.greatRegion || member.great_region,
      member.pastoralZone || member.pastoral_zone,
      member.smallGroup || member.small_group
    ].filter(Boolean).map(value => escapeHTML(String(value))).join("・") || "尚未設定牧養資料";
    const joinedDate = formatAdminJoinedPlanDate(member.joinedAt);
    const round = Number(member.currentRound) || 1;
    return `
      <div class="admin-unjoined-plan-member">
        <div class="admin-unjoined-plan-member__identity">
          <div class="admin-unjoined-plan-member__name">${memberName}</div>
          <div class="admin-unjoined-plan-member__scope">${scope}</div>
        </div>
        <div class="admin-joined-plan-member__meta">
          ${joinedDate ? `<span>${escapeHTML(joinedDate)} 加入</span>` : ""}
          ${round > 1 ? `<span>第 ${round} 遍</span>` : ""}
        </div>
      </div>`;
  }).join("");
}

async function refreshAdminTeamRegistrationFilters() {
  // Re-render only what the user can currently see. Other subtabs render
  // from their cached raw data when opened, so org-filter changes no longer
  // trigger hidden network/DOM work.
  await loadActiveAdminPlanSubtab(false);
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
      <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.875rem;">
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
  const selectedPlan = state.adminManagementPlan;
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

  lastRenderedTeamPlans[Number(division)] = processedPlans;
  const exportBtn = document.getElementById(Number(division) === 6 ? "admin-team-status-export-btn-6" : "admin-team-status-export-btn");
  if (exportBtn) exportBtn.onclick = () => exportTeamRegistrationStatusCSV(division);
  const rosterExportBtn = document.getElementById(Number(division) === 6 ? "admin-team-roster-export-btn-6" : "admin-team-roster-export-btn");
  if (rosterExportBtn) rosterExportBtn.onclick = () => exportTeamMemberRosterCSV(division);

  if (processedPlans.length === 0) {
    contentEl.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.875rem;">
        目前尚無任何計畫的團隊報名資料。
      </div>
    `;
    return;
  }

  let html = "";
  processedPlans.forEach(item => {
    const planName = escapeHTML(item.plan.name || "（無名稱）");
    const planStart = formatTeamPlanDate(item.plan.startDate);
    const planEnd = formatTeamPlanDate(item.plan.endDate);
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
        ${planPeriod ? `<p style="margin: 0 0 0.65rem; color: var(--text-muted); font-size: 0.875rem;">計畫期間：${planPeriod}</p>` : ""}
        <div style="display: flex; gap: 1rem; font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
          <span>招募中：<strong style="color: var(--primary-color);">${signupCount}</strong> 隊</span>
          <span>已成隊：<strong style="color: var(--color-success-foreground);">${readyCount}</strong> 隊</span>
          <span>總報名人數：<strong>${totalMembers}</strong> 人</span>
        </div>
    `;

    if (item.teams.length === 0) {
      html += `
        <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.875rem; background: var(--bg-input); border-radius: 8px; border: 1px dashed var(--border-card);">
          此計畫目前無 ${division} 人團隊的報名資料。
        </div>
      </div>
      `;
    } else {
      html += `
        <div class="admin-team-table-scroll" style="overflow: auto; max-height: min(60vh, 32rem); background: var(--bg-input); border-radius: 8px; border: 1px solid var(--border-card);">
          <table class="w-full" style="border-collapse: collapse; text-align: left; font-size: 0.875rem; min-width: 600px;">
            <thead style="position: sticky; top: 0; z-index: 2; background: var(--bg-input);">
              <tr style="border-bottom: 1px solid var(--border-card); background: color-mix(in srgb, var(--text-primary) 2%, var(--bg-card));">
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

// initAdminTeamRegistration removed 2026-09-16: its whole body was gated on
// #admin-team-tab-3/-6, which don't exist — the 3人/6人 split is now done by
// two direct renderAdminTeamRegistrationStatus() calls elsewhere in this
// file, so this was a guaranteed no-op every time it ran.

let adminTeamPlacementsData = [];
let adminTeamPlacementsDataKey = "";

export async function renderAdminTeamPlacementLookup(selectedPlan, forceRefresh = false) {
  const contentEl = document.getElementById("admin-team-placements-content");
  const searchInput = document.getElementById("admin-team-placement-search");
  if (!contentEl) return;

  if (searchInput && !searchInput.dataset.placementBound) {
    searchInput.dataset.placementBound = "true";
    searchInput.addEventListener("input", () => {
      renderAdminTeamPlacementList();
    });
  }

  const currentUser = state.currentUser || {};
  const dataKey = [
    currentUser.id || currentUser.name || 'anonymous',
    currentUser.managed_regions || currentUser.great_region || '',
    currentUser.managed_zones || currentUser.pastoral_zone || '',
    currentUser.managed_groups || currentUser.small_group || '',
    selectedPlan && (selectedPlan.globalPlanId || selectedPlan.id || selectedPlan.presetKey || selectedPlan.name) || ''
  ].join('|');
  if (!forceRefresh && adminTeamPlacementsDataKey === dataKey) {
    renderAdminTeamPlacementList();
    return;
  }

  if (firstPaint(contentEl)) contentEl.innerHTML = '<div class="admin-user-directory__empty">正在載入尚未加入團隊的人員…</div>';

  const res = await db.getAdminMemberTeamPlacements(selectedPlan);
  if (!res.success) {
    contentEl.innerHTML = '<div class="admin-user-directory__empty">無法取得成員組隊狀態。</div>';
    return;
  }

  adminTeamPlacementsData = res.data || [];
  adminTeamPlacementsDataKey = dataKey;
  renderAdminTeamPlacementList();
}

function renderAdminTeamPlacementList() {
  const contentEl = document.getElementById("admin-team-placements-content");
  const searchInput = document.getElementById("admin-team-placement-search");
  if (!contentEl) return;

  const query = (searchInput?.value || "").trim().toLocaleLowerCase("zh-Hant");
  const unjoinedMembers = adminTeamPlacementsData.filter(item => item.isJoined !== true);

  const filtered = unjoinedMembers
    .filter(item => memberMatchesManagementOrgFilter(item))
    .filter(item => {
      if (!query) return true;
      const text = [item.name, item.email, item.pastoralZone, item.smallGroup]
        .filter(Boolean).join(" ").toLocaleLowerCase("zh-Hant");
      return text.includes(query);
    });

  if (filtered.length === 0) {
    contentEl.innerHTML = '<div class="admin-user-directory__empty">目前篩選範圍內沒有尚未加入團隊的人員。</div>';
    return;
  }

  const html = `
    <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
      共顯示 ${filtered.length} / ${unjoinedMembers.length} 位尚未加入團隊的人員
    </div>
    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
      ${filtered.map(item => {
        const name = escapeHTML(item.name || "未命名");
        const zone = escapeHTML([item.pastoralZone, item.smallGroup].filter(Boolean).join("・") || "未設定歸屬");
        return `
          <div style="background: var(--bg-input); border: 1px solid var(--border-card); border-radius: 10px; padding: 0.75rem 1rem;">
            <strong>${name}</strong>
            <span style="font-size: 0.875rem; font-weight: normal; color: var(--text-secondary);">(${zone})</span>
          </div>
        `;
      }).join("")}
    </div>
  `;

  contentEl.innerHTML = html;
  if (typeof hydrateIcons === "function") hydrateIcons(contentEl);
}

window.renderAdminUnjoinedPlanMembers = renderAdminUnjoinedPlanMembers;
window.renderAdminJoinedPlanMembers = renderAdminJoinedPlanMembers;
window.renderAdminTeamPlacementLookup = renderAdminTeamPlacementLookup;
window.renderAdminTeamRegistrationStatus = renderAdminTeamRegistrationStatus;
window.refreshAdminTeamRegistrationFilters = refreshAdminTeamRegistrationFilters;
