// 計畫分頁的統計、排行、組員狀況畫面（#370 從 plan.js 拆出的 lazy chunk）。
// app.js 載入 plan.js 時登記載入函式（registerPlanStatsLoader），plan.js 裡同名的
// renderPlanStatsView / renderPlanRankingView / renderPlanMembersView / populateMembersSelector
// 第一次被叫到時才下載這個檔；Chart.js 也只從這裡（ensureChartLib）載入。

import {
  countScheduleDaysCoveredByChapters,
  countExpectedScheduleDays,
  countLateCompletedDays,
  buildRound1ReadDateMap
} from "../data/schedule-progress.mjs";
import { computePlanScopedStreak } from "./team-progress-metrics.mjs";
import { computeOrgUnitStats as computePlanOrgUnitStats } from "../data/plan-stats-rules.mjs";
import { formatTaiwanDate, prependTaiwanExportTime } from "./export-time.mjs";
import { csvCell } from "./csv-cell.mjs";
import { ensureChartLib } from "./chart-loader.mjs";
import {
  PLAN_ROUTE,
  getLeadershipAssignmentNodeNames,
  getPlanProgressStatus,
  logMatchesPlan,
  populateStatsSelector,
  prepareReadingTeamSubview,
  setupCascadingSelectors
} from "./plan.js";


// 個人統計「累積閱讀章數」的伺服器請求序號：只讓最後一次 render 的回應寫回畫面。
let planChapterTotalRenderToken = 0;

// 效能重構 A2：Chart.js 改成第一次要畫圖時才動態載入，載入器放在
// chart-loader.mjs 跟後台雲柱測驗趨勢圖共用。
window.ensureChartLib = ensureChartLib;

// 效能重構 B7：同一個 <canvas> 還在就只 chart.update()，不要每次 destroy + new Chart。
// destroy+new 會丟掉整個圖、重跑動畫、增加 GC，也是「Canvas is already in use」錯誤來源。
function renderOrUpdateChart(key, canvasEl, config) {
  if (!canvasEl) return null;
  // Chart.js 還沒載進來（A2 lazy load）：先觸發載入，好了以後用同樣的參數補畫一次。
  // 呼叫端都是同步函式、不看回傳值，所以這樣自我修復最省事。
  if (typeof Chart === "undefined") {
    ensureChartLib()
      .then(() => { if (typeof Chart !== "undefined") renderOrUpdateChart(key, canvasEl, config); })
      .catch(() => {});
    return null;
  }
  state.statsCharts = state.statsCharts || {};
  const existing = state.statsCharts[key];
  if (existing && existing.canvas === canvasEl) {
    try {
      existing.data = config.data;
      if (config.options) existing.options = config.options;
      existing.update("none");
      return existing;
    } catch (_) { /* 落到重建 */ }
  }
  try { existing && existing.destroy(); } catch (_) {}
  try {
    const stale = Chart.getChart ? Chart.getChart(canvasEl) : null;
    if (stale && stale !== existing) stale.destroy();
  } catch (_) {}
  state.statsCharts[key] = new Chart(canvasEl.getContext("2d"), config);
  return state.statsCharts[key];
}

// ==================== ORG FILTER UTILITY ====================
function getActiveOrgFilter() {
  const regionSelect = document.getElementById("members-admin-region-select");
  const zoneSelect = document.getElementById("members-admin-zone-select");
  const groupSelect = document.getElementById("members-admin-group-select");
  if (!regionSelect || !zoneSelect || !groupSelect) return "all";

  const role = (state.currentUser && getUserRoleCode(state.currentUser)) || "member";
  const selectedGroup = groupSelect.value === "unassigned" ? "" : groupSelect.value;
  const selectedZone = zoneSelect.value === "unassigned" ? "" : zoneSelect.value;
  const selectedRegion = regionSelect.value === "unassigned" ? "" : regionSelect.value;
  if (selectedGroup) return `group:${selectedGroup}`;
  if (selectedZone) return `zone:${selectedZone}`;
  if (selectedRegion) return selectedRegion;
  if (role === "group_leader") return "all_groups";
  if (role === "zone_leader") return "all_zones";
  if (role === "great_zone_leader") return "all_great_region";
  return "all";
}

// ==================== MEMBERS SELECTOR POPULATOR ====================
// Drives the collapsed 查看範圍 trigger's preview text (admin-plan-filter-card--org
// in index.html) so an admin can see the current scope without expanding it.
// Harmless no-op when that trigger isn't on screen (e.g. the 組員狀況/計畫統計
// subviews reuse the same three selects without this collapsed wrapper).
function updateAdminPlanFilterSummary() {
  const summaryText = document.getElementById("admin-plan-filter-summary-text");
  if (!summaryText) return;
  const parts = ["members-admin-region-select", "members-admin-zone-select", "members-admin-group-select"]
    .map(id => document.getElementById(id))
    .filter(select => select && !select.disabled && select.value && select.value !== "unassigned")
    .map(select => select.options[select.selectedIndex]?.text || "")
    .filter(Boolean);
  summaryText.textContent = parts.length ? `查看範圍：${parts.join(" · ")}` : "查看範圍：全部";
}

function populateMembersSelector() {
  setupCascadingSelectors("members-admin-region-select", "members-admin-zone-select", "members-admin-group-select", "members-zone-selector");

  // Direct bindings to guarantee that any dropdown selection change immediately updates stats
  const regionSelect = document.getElementById("members-admin-region-select");
  const zoneSelect = document.getElementById("members-admin-zone-select");
  const groupSelect = document.getElementById("members-admin-group-select");

  [regionSelect, zoneSelect, groupSelect].forEach(el => {
    if (el && !el.dataset.directListenerBound) {
      el.dataset.directListenerBound = "true";
      el.addEventListener("change", async () => {
        updateAdminPlanFilterSummary();
        await renderPlanMembersView();
        if (typeof window.refreshAdminTeamRegistrationFilters === "function") {
          await window.refreshAdminTeamRegistrationFilters();
        }
      });
    }
  });

  const membersZoneSelector = document.getElementById("members-zone-selector");
  if (membersZoneSelector && !membersZoneSelector.dataset.listenerInitialized) {
    membersZoneSelector.dataset.listenerInitialized = "true";
    membersZoneSelector.addEventListener("change", async () => {
      await renderPlanMembersView();
      if (typeof window.refreshAdminTeamRegistrationFilters === "function") {
        await window.refreshAdminTeamRegistrationFilters();
      }
    });
  }

  updateAdminPlanFilterSummary();
}

async function renderPlanStatsView() {
  ensureChartLib().catch(() => {}); // A2：統計分頁一開就開始抓 Chart.js，減少補畫延遲
  if (typeof window.syncActivePlanContext === 'function') window.syncActivePlanContext();
  if (!state.activePlan) return;

  const personalSec = document.getElementById("stats-personal-section");
  const groupSec = document.getElementById("stats-group-section");
  const currentTab = window._currentStatsTab || 'personal';

  if (currentTab !== 'personal' && !(await prepareReadingTeamSubview("stats"))) return;
  populateStatsSelector();
  if (currentTab === 'personal') {
    const teamSwitcher = document.getElementById("stats-team-view-switch");
    const teamInline = document.getElementById("reading-team-stats-inline");
    const regContainer = document.getElementById("reading-team-registration-inline");
    if (teamSwitcher) teamSwitcher.classList.add("hidden");
    if (teamInline) teamInline.classList.add("hidden");
    if (regContainer) regContainer.classList.add("hidden");
    // 還沒有隊伍的人在個人分頁頂端看到建立 / 加入團隊、帶隊入口（#652）；不等它，免得擋住個人統計。
    if (regContainer && typeof window.renderReadingTeamEntryInline === "function") {
      void window.renderReadingTeamEntryInline(regContainer, state.activePlan).catch(err => {
        console.warn("[plan-stats] team entry failed:", err);
        regContainer.classList.add("hidden");
      });
    }
    // Show personal, hide group
    if (personalSec) personalSec.classList.remove("hidden");
    if (groupSec) groupSec.classList.add("hidden");

    // Set User Profile names
    const statsUserName = document.getElementById("stats-user-name");
    const reportPlanTitle = document.getElementById("report-plan-title");

    const userName = state.currentUser.name || "弟兄姊妹";
    if (statsUserName) statsUserName.textContent = userName;
    if (reportPlanTitle) reportPlanTitle.textContent = state.activePlan.name;

    // Personal Streak val —— 這個計畫自己的最長連續打卡天數，不混用全域 streak。
    const personalStreak = computePlanScopedStreak(state.readingLogs || [], {
      planId: state.activePlan.id,
      presetKey: state.activePlan.presetKey
    });

    // 1. Highest streak (最高連續)
    const reportStatStreak = document.getElementById("report-stat-streak");
    if (reportStatStreak) reportStatStreak.textContent = personalStreak;

    const currentRound = state.activePlan.currentRound || 1;
    const totalPlanDays = state.activePlan.days.length;

    // Helper: count completed days for a given round
    const countCompletedDaysForRound = (rTarget) => {
      return state.activePlan.days.filter(d => {
        if (!d.chapters || d.chapters.length === 0) return false;
        // 同一份日程；某一遍完成 = 每章都有 isReadR{rTarget}。
        return d.chapters.every(ch => Boolean(ch["isReadR" + rTarget] || (rTarget === 1 && ch.isRead)));
      }).length;
    };

    // 2. Total completed (累計完成)
    // Round 2+: freeze display at round-1 completion total (which should be 100%)
    const completedR1 = countCompletedDaysForRound(1);
    const completedCurrentRound = countCompletedDaysForRound(currentRound);
    const displayCompletedDays = currentRound > 1 ? totalPlanDays : completedR1;

    const reportStatCompleted = document.getElementById("report-stat-completed");
    if (reportStatCompleted) reportStatCompleted.textContent = displayCompletedDays;

    const reportStatStartDate = document.getElementById("report-stat-start-date");
    if (reportStatStartDate) {
      const pDate = new Date(state.activePlan.startDate);
      if (!isNaN(pDate)) {
        reportStatStartDate.textContent = `從 ${pDate.getFullYear()}年${pDate.getMonth() + 1}月${pDate.getDate()}日起`;
      } else {
        reportStatStartDate.textContent = `從 ${state.activePlan.startDate} 起`;
      }
    }

    // 3. Progress Status（落後/超前只在第一遍；之後只顯示輪次進度 —— 見 getPlanProgressStatus）
    const reportStatProgressStatus = document.getElementById("report-stat-progress-status");
    if (reportStatProgressStatus) {
      const progressStatus = getPlanProgressStatus(state.activePlan);
      reportStatProgressStatus.textContent = progressStatus.label;
      reportStatProgressStatus.className = "stat-badge " + progressStatus.badgeClass;
    }

    // 4. Makeup/Catch up days (🛡️ 進度救援)
    // 一律對「教會原始日程」算，只看第一遍的 log（第一遍之後 log 不再變，數值自然凍結）。
    const round1DateByChapter = buildRound1ReadDateMap(state.readingLogs, l =>
      l.plan_id === state.activePlan.id || l.presetKey === state.activePlan.presetKey
    );
    const canonicalDays = typeof window.getCanonicalStageScheduleDays === "function"
      ? window.getCanonicalStageScheduleDays(state.activePlan)
      : (state.activePlan.days || []);
    const catchUpDaysVal = countLateCompletedDays(canonicalDays, state.activePlan.startDate, round1DateByChapter);
    const reportStatMakeup = document.getElementById("report-stat-makeup");
    if (reportStatMakeup) reportStatMakeup.textContent = catchUpDaysVal;
    const makeupCard = document.getElementById("report-stat-makeup-card");
    if (makeupCard) {
      makeupCard.classList.toggle("stat-bento--danger-active", catchUpDaysVal > 0);
    }

    // 5. Cumulative chapters read (累積閱讀章數) — 所有遍次累計，不重置。
    // 嚴格以「這個計畫」為範圍：一筆打卡的 plan_id / global_plan_id / presetKey /
    // preset_key 至少一個對得上本計畫才算。
    // 不再收「四個識別碼都沒有」的無歸屬打卡——那會把使用者在沉浸式閱讀器裡、
    // 沒有作用中計畫時讀的章節（plan_id = NULL）灌進來，導致總章數超過本計畫
    // 實際卷數（出埃及記只有 40 章卻顯示 45）。logChapterRead 每次都會寫 plan_id，
    // 屬於本計畫的打卡不會沒有識別碼。
    const reportStatTotalChapters = document.getElementById("report-stat-total-chapters");
    if (reportStatTotalChapters) {
      const planIds = [state.activePlan.id, state.activePlan.globalPlanId, state.activePlan.global_plan_id]
        .filter(Boolean).map(String);
      const planKeys = [state.activePlan.presetKey, state.activePlan.preset_key]
        .filter(Boolean).map(String);
      const uniqueKeys = new Set();
      if (state.readingLogs) {
        state.readingLogs.forEach(l => {
          const logPlanId = l.plan_id || l.global_plan_id;
          const logKey = l.presetKey || l.preset_key;
          const logMatchesPlan =
            (logPlanId && planIds.includes(String(logPlanId))) ||
            (logKey && planKeys.includes(String(logKey)));
          if (logMatchesPlan) {
            // 每一遍各章節分開計算，累積跨遍次總章數
            const r = l.round || 1;
            uniqueKeys.add(`${l.book}_${l.chapter}_${r}`);
          }
        });
      }
      const localTotal = uniqueKeys.size;
      reportStatTotalChapters.textContent = localTotal;

      // 伺服器數字為準（#348）：前端這份 readingLogs 是分頁抓回來的，只要載入
      // 出過差錯就會少算。先顯示本機數字，伺服器回來再換掉。取兩者較大的：
      // 本機多出來的只會是剛打勾、還沒寫進資料庫的章節（樂觀更新），伺服器
      // 多出來的就是本機漏抓的。
      const totalPlanId = state.activePlan.id;
      const totalRenderToken = ++planChapterTotalRenderToken;
      if (totalPlanId && typeof db.fetchPlanChapterTotal === "function") {
        db.fetchPlanChapterTotal(totalPlanId).then(serverTotal => {
          if (serverTotal === null || totalRenderToken !== planChapterTotalRenderToken) return;
          if (!state.activePlan || state.activePlan.id !== totalPlanId) return;
          reportStatTotalChapters.textContent = Math.max(serverTotal, localTotal);
        });
      }
    }

    // Render heatmap, trend chart, and badges wall
    renderPersonalHeatmap();
    renderPersonalTrendChart();
    renderPersonalUnlockedBadges();
  } else {
    // Show group, hide personal
    if (personalSec) personalSec.classList.add("hidden");
    if (groupSec) groupSec.classList.remove("hidden");

    // Render Group Stats
    await renderPlanHistoryView();
  }
}

// 系統管理「計畫統計」（ORG_STATS 模式，由 admin.js 的 selectManagementPlan
// 設定）看的是管理員在上方「計畫篩選」選的那個計畫（state.adminManagementPlan），
// 不是這個人自己目前在讀的 activePlan——這兩個欄位故意分開存放（見
// state.js 的 adminManagementPlan 註解），避免管理員切自己的計畫時連帶影響
// 全教會統計。這裡統一提供正確的來源，ORG_STATS 相關的函式都要透過這個入口
// 拿「現在該看哪個計畋」，不要直接讀 state.activePlan，否則「計畋篩選」怎麼
// 切，全教會/大區/牧區的統計數字都不會變。
function getOrgStatsContextPlan() {
  return (window.currentPlanViewState === PLAN_ROUTE.ORG_STATS && state.adminManagementPlan) || state.activePlan;
}

// db.fetchMergedUsersList / fetchMergedUsersWithLogs 依這個 key 分開快取。
function getPlanStatsCacheKey(plan) {
  return plan ? (plan.globalPlanId || plan.presetKey || plan.name || plan.id) : null;
}

async function renderPlanHistoryView() {
  if (!getOrgStatsContextPlan()) return;

  // 1. Render Group Rankings/Participants table at top (Wait, the ranking table is no longer at top of stats, but we still trigger it to update scoped user list)
  await renderGroupParticipantsRankingTable();

  // 2. Render the permission-scope org stats tree (大區／牧區／小組 逐層展開)
  await renderOrgStatsTree();
}

// 單一組織單位（大區／牧區／小組）範圍內的 6 項統計數字，供各層節點共用。
function computeOrgUnitStats(users) {
  return computePlanOrgUnitStats(users, getOrgStatsContextPlan());
}

// 依目前登入者的管理權限（全教會／大區／牧區／小組）組出可查看的組織樹，
// 每一層節點都帶著自己範圍內的統計數字，供 renderOrgStatsTree 畫成可逐層展開的條列清單。
function buildAccessibleOrgStatsTree(allUsers) {
  const userRole = (state.currentUser && getUserRoleCode(state.currentUser)) || "member";
  const isAdmin = hasWholeChurchPlanScope(userRole);
  const isGreatZoneLeader = userRole === "great_zone_leader";
  const isZoneLeader = userRole === "zone_leader";
  const isGroupLeader = userRole === "group_leader";

  const zonesOf = (rName) => {
    if (!rName) return [];
    if (state.isSupabaseMode && state.orgStructure.rawZones && state.orgStructure.rawRegions) {
      const regionObj = state.orgStructure.rawRegions.find(r => r.name === rName);
      if (!regionObj) return [];
      return state.orgStructure.rawZones.filter(z => z.great_region_id === regionObj.id).map(z => z.name).sort();
    }
    return (state.orgStructure.zones[rName] || []).slice().sort();
  };
  const groupsOf = (zName) => {
    if (!zName) return [];
    if (state.isSupabaseMode && state.orgStructure.rawGroups && state.orgStructure.rawZones) {
      const zoneObj = state.orgStructure.rawZones.find(z => z.name === zName);
      if (!zoneObj) return [];
      return state.orgStructure.rawGroups.filter(g => g.pastoral_zone_id === zoneObj.id).map(g => g.name).sort();
    }
    return (state.orgStructure.groups[zName] || []).slice().sort();
  };

  const usersInRegion = name => allUsers.filter(u => u.great_region === name);
  const usersInZone = name => allUsers.filter(u => u.pastoral_zone === name);
  const usersInGroup = name => allUsers.filter(u => u.small_group === name);

  const makeGroupNode = name => ({ level: "group", name, stats: computeOrgUnitStats(usersInGroup(name)), children: [] });
  const makeZoneNode = name => ({ level: "zone", name, stats: computeOrgUnitStats(usersInZone(name)), children: groupsOf(name).map(makeGroupNode) });
  const makeRegionNode = name => ({ level: "region", name, stats: computeOrgUnitStats(usersInRegion(name)), children: zonesOf(name).map(makeZoneNode) });

  let nodes = [];
  let summaryLabel = "";
  let summaryUsers = [];

  if (isAdmin) {
    nodes = (state.orgStructure.regions || []).map(makeRegionNode);
    summaryLabel = "全教會";
    summaryUsers = allUsers;
  } else if (isGreatZoneLeader) {
    const userGreatRegion = state.currentUser.managed_regions || state.currentUser.great_region
      || getLeadershipAssignmentNodeNames(state.currentUser, "大區") || "";
    const myRegions = userGreatRegion.split(",").map(s => s.trim()).filter(Boolean);
    nodes = myRegions.map(makeRegionNode);
    summaryLabel = "全部大區";
    summaryUsers = allUsers.filter(u => myRegions.includes(u.great_region));
  } else if (isZoneLeader) {
    const userZone = state.currentUser.managed_zones || state.currentUser.pastoral_zone
      || getLeadershipAssignmentNodeNames(state.currentUser, "牧區") || "";
    const myZones = userZone.split(",").map(s => s.trim()).filter(Boolean);
    nodes = myZones.map(makeZoneNode);
    summaryLabel = "全部牧區";
    summaryUsers = allUsers.filter(u => myZones.includes(u.pastoral_zone));
  } else if (isGroupLeader) {
    const userGroupStr = state.currentUser.managed_groups || state.currentUser.small_group
      || getLeadershipAssignmentNodeNames(state.currentUser, "小組") || "";
    const myGroups = userGroupStr.split(",").map(s => s.trim()).filter(Boolean);
    nodes = myGroups.map(makeGroupNode);
    summaryLabel = "全部小組";
    summaryUsers = allUsers.filter(u => myGroups.includes(u.small_group));
  } else {
    return [];
  }

  if (nodes.length === 0) return [];

  const summaryNode = { level: "summary", name: summaryLabel, stats: computeOrgUnitStats(summaryUsers), children: [] };
  return [summaryNode, ...nodes];
}

window._orgStatsExpandedKeys = window._orgStatsExpandedKeys || new Set();
const ORG_STATS_LEVEL_LABEL = { region: "大區", zone: "牧區", group: "小組" };

function renderOrgStatsMetrics(stats) {
  return `
    <div class="org-stats-metrics">
      <div class="org-stats-metrics__row">
        <div class="org-stats-metric"><span class="nlc-icon org-stats-metric__icon" data-icon="peoples" aria-hidden="true"></span><span class="org-stats-metric__value">${stats.totalChapters}</span><span class="org-stats-metric__label">總閱讀章數</span></div>
        <div class="org-stats-metric"><span class="nlc-icon org-stats-metric__icon" data-icon="people" aria-hidden="true"></span><span class="org-stats-metric__value">${stats.totalMembers}</span><span class="org-stats-metric__label">參與人數</span></div>
        <div class="org-stats-metric"><span class="nlc-icon org-stats-metric__icon" data-icon="lightning" aria-hidden="true"></span><span class="org-stats-metric__value">${stats.totalActive}</span><span class="org-stats-metric__label">每日活躍</span></div>
      </div>
      <div class="org-stats-metrics__row">
        <div class="org-stats-metric"><span class="nlc-icon org-stats-metric__icon" data-icon="hourglass" aria-hidden="true"></span><span class="org-stats-metric__value">${stats.behindCount}</span><span class="org-stats-metric__label">落後人數</span></div>
        <div class="org-stats-metric"><span class="nlc-icon org-stats-metric__icon" data-icon="refresh" aria-hidden="true"></span><span class="org-stats-metric__value">${stats.rereadCount}</span><span class="org-stats-metric__label">複讀人數</span></div>
        <div class="org-stats-metric"><span class="nlc-icon org-stats-metric__icon" data-icon="trophy" aria-hidden="true"></span><span class="org-stats-metric__value">${stats.totalCompleted}</span><span class="org-stats-metric__label">完成計畫人數</span></div>
      </div>
    </div>
  `;
}

function renderOrgStatsNode(node) {
  const key = `${node.level}:${node.name}`;
  const expanded = window._orgStatsExpandedKeys.has(key);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const safeName = escapeHTML(node.name);
  const levelLabel = ORG_STATS_LEVEL_LABEL[node.level] || "";

  return `
    <div class="org-stats-node org-stats-node--${node.level}${expanded ? " is-expanded" : ""}" data-org-key="${escapeHTML(key)}">
      <button type="button" class="org-stats-node__header">
        <span class="nlc-icon org-stats-node__chevron" data-icon="chevronRight" aria-hidden="true"></span>
        <span class="org-stats-node__name">${levelLabel ? `<span class="org-stats-node__level-tag">${levelLabel}</span>` : ""}${safeName}</span>
        <span class="org-stats-node__badge">${node.stats.totalMembers} 人</span>
      </button>
      <div class="org-stats-node__body">
        ${renderOrgStatsMetrics(node.stats)}
        ${hasChildren ? `<div class="org-stats-node__children">${node.children.map(renderOrgStatsNode).join("")}</div>` : ""}
      </div>
    </div>
  `;
}

function bindOrgStatsTreeEvents(container) {
  if (!container || container.dataset.listenerBound === "true") return;
  container.dataset.listenerBound = "true";
  container.addEventListener("click", (event) => {
    const header = event.target.closest(".org-stats-node__header");
    if (!header) return;
    const node = header.closest(".org-stats-node");
    if (!node) return;
    const key = node.dataset.orgKey;
    const isExpanded = node.classList.toggle("is-expanded");
    if (isExpanded) window._orgStatsExpandedKeys.add(key);
    else window._orgStatsExpandedKeys.delete(key);
  });
}

// 「計畫統計」條列清單：先列出登入者權限範圍內的大區／牧區／小組（依角色決定
// 從哪一層開始），每一列可各自展開看該範圍的 6 項統計，取代舊版單一篩選器 +
// 熱力圖 + 趨勢圖的呈現方式。
async function renderOrgStatsTree() {
  const container = document.getElementById("admin-org-stats-tree");
  const contextPlan = getOrgStatsContextPlan();
  if (!container || !contextPlan) return;

  if (!state.orgStructure || !Array.isArray(state.orgStructure.regions) || state.orgStructure.regions.length === 0) {
    if (typeof db.loadOrgStructure === "function") {
      try { await db.loadOrgStructure(); } catch (e) { console.warn('Failed to load org structure for stats tree', e); }
    }
  }

  let allUsers = [];
  try {
    allUsers = await db.fetchMergedUsersList(getPlanStatsCacheKey(contextPlan));
  } catch (e) {
    console.warn('Failed to fetch users for org stats tree', e);
  }

  const tree = buildAccessibleOrgStatsTree(allUsers);

  if (tree.length === 0) {
    container.innerHTML = '<p class="org-stats-tree__empty">尚未設定可管理的組織範圍，請聯絡系統管理員。</p>';
    return;
  }

  container.innerHTML = tree.map(renderOrgStatsNode).join("");
  bindOrgStatsTreeEvents(container);
  if (typeof hydrateIcons === "function") hydrateIcons(container);
  bindOrgStatsExportButton();
}

// 從組織樹裡收集所有「牧區」層級的節點（大區長／全教會範圍的樹在大區底下才有牧區；
// 牧區長的樹本身就是從牧區開始）；小組長的樹只到小組層級，沒有牧區可匯出。
function collectZoneStatsForExport(tree) {
  const rows = [];
  const walk = (node, regionName) => {
    if (node.level === "region") {
      (node.children || []).forEach(child => walk(child, node.name));
    } else if (node.level === "zone") {
      rows.push({ region: regionName || "", zone: node.name, stats: node.stats });
    }
  };
  (tree || []).forEach(node => walk(node, null));
  return rows;
}

function convertZoneCompletionToCSV(rows, exportedAt = new Date()) {
  if (!rows || rows.length === 0) return "";
  const headers = ["大區", "牧區", "參與人數", "完成計畫人數", "完成率"];
  const csvRows = rows.map(r => {
    const rate = r.stats.totalMembers > 0 ? `${Math.round((r.stats.totalCompleted / r.stats.totalMembers) * 100)}%` : "0%";
    return [r.region || "未設定", r.zone, r.stats.totalMembers, r.stats.totalCompleted, rate];
  });
  return prependTaiwanExportTime([
    headers.join(","),
    ...csvRows.map(row => row.map(csvCell).join(","))
  ].join("\n"), exportedAt);
}

async function exportZoneCompletionCSV() {
  const contextPlan = getOrgStatsContextPlan();
  if (!contextPlan) {
    if (typeof showToast === "function") showToast("請先選擇一個計畫。");
    return;
  }

  if (!state.orgStructure || !Array.isArray(state.orgStructure.regions) || state.orgStructure.regions.length === 0) {
    if (typeof db.loadOrgStructure === "function") {
      try { await db.loadOrgStructure(); } catch (e) { console.warn('Failed to load org structure for zone export', e); }
    }
  }

  let allUsers = [];
  try {
    allUsers = await db.fetchMergedUsersList(getPlanStatsCacheKey(contextPlan));
  } catch (e) {
    console.warn('Failed to fetch users for zone export', e);
  }

  const tree = buildAccessibleOrgStatsTree(allUsers);
  const rows = collectZoneStatsForExport(tree);
  if (rows.length === 0) {
    if (typeof showToast === "function") showToast("目前權限範圍內沒有可匯出的牧區資料。");
    return;
  }

  const csvContent = convertZoneCompletionToCSV(rows);
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = formatTaiwanDate();
  link.setAttribute("href", url);
  link.setAttribute("download", `zone_completion_${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function bindOrgStatsExportButton() {
  const btn = document.getElementById("admin-org-stats-export-zones-btn");
  if (!btn || btn.dataset.listenerBound === "true") return;
  btn.dataset.listenerBound = "true";
  btn.addEventListener("click", () => {
    exportZoneCompletionCSV().catch(e => console.warn('[Plan] exportZoneCompletionCSV error:', e));
  });
}

function renderPersonalHeatmap() {
  // 只顯示當前計畫的閱讀記錄
  const currentPlanId = state.activePlan && state.activePlan.id;
  const currentPresetKey = state.activePlan && state.activePlan.presetKey;
  const logsByDate = {};
  (state.readingLogs || []).forEach(log => {
    if (!log.read_at) return;
    const matches = logMatchesPlan(log, currentPlanId, currentPresetKey);
    if (matches) {
      const dStr = log.read_at.substring(0, 10);
      logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
    }
  });
  const start = state.activePlan ? state.activePlan.startDate : null;
  const end = state.activePlan ? state.activePlan.endDate : null;
  buildHeatmapGrid("bible-heatmap-container", logsByDate, 1, "章", start, end);
}

function renderPersonalTrendChart() {
  const canvas = document.getElementById("personal-reading-trend-chart");
  if (!canvas) return;

  const currentPlanId = state.activePlan && state.activePlan.id;
  const currentPresetKey = state.activePlan && state.activePlan.presetKey;

  // 已結束的計畫：把「今天」鎖定在計畫結束日，否則下面這三個區間（本週／
  // 30 天／12 個月）都是跟著真實日期往前滑動的視窗，時間一久，已經讀過的
  // 紀錄就會被擠出視窗範圍，圖表看起來變成全空白。
  const referenceDate = (typeof isPlanExpired === "function" && isPlanExpired(state.activePlan) && state.activePlan.endDate)
    ? new Date(`${state.activePlan.endDate}T00:00:00`)
    : new Date();

  const range = state.personalTrendRange || "month";

  // Style buttons according to range selection
  const btnWeek = document.getElementById("trend-range-week");
  const btnMonth = document.getElementById("trend-range-month");
  const btnYear = document.getElementById("trend-range-year");

  [btnWeek, btnMonth, btnYear].forEach((btn) => {
    if (btn) btn.classList.remove("active");
  });

  const activeBtn = document.getElementById(`trend-range-${range}`);
  if (activeBtn) activeBtn.classList.add("active");

  let labels = [];
  let chartData = [];

  if (range === "week") {
    // 7 days starting from Sunday of the current week
    const dates = [];
    const today = referenceDate;
    const dayOfWeek = today.getDay();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - dayOfWeek);

    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      const dStr = typeof toTaiwanISODate === "function" ? toTaiwanISODate(d) : d.toISOString().substring(0, 10);
      dates.push(dStr);
      labels.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
    }
    const logsByDate = {};
    if (state.readingLogs) {
      state.readingLogs.forEach(log => {
        if (!log.read_at) return;
        if (!logMatchesPlan(log, currentPlanId, currentPresetKey)) return;
        const dStr = log.read_at.substring(0, 10);
        logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
      });
    }
    chartData = dates.map(dStr => logsByDate[dStr] || 0);

  } else if (range === "year") {
    // 12 months
    const months = [];
    const today = referenceDate;
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const yStr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, '0');
      months.push(`${yStr}-${mStr}`);
      labels.push(`${yStr}/${mStr}`);
    }
    const logsByMonth = {};
    if (state.readingLogs) {
      state.readingLogs.forEach(log => {
        if (!log.read_at) return;
        if (!logMatchesPlan(log, currentPlanId, currentPresetKey)) return;
        const mStr = log.read_at.substring(0, 7);
        logsByMonth[mStr] = (logsByMonth[mStr] || 0) + 1;
      });
    }
    chartData = months.map(mStr => logsByMonth[mStr] || 0);

  } else {
    // 30 days (default)
    const dates = [];
    const today = referenceDate;
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dStr = typeof toTaiwanISODate === "function" ? toTaiwanISODate(d) : d.toISOString().substring(0, 10);
      dates.push(dStr);
      labels.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
    }
    const logsByDate = {};
    if (state.readingLogs) {
      state.readingLogs.forEach(log => {
        if (!log.read_at) return;
        if (!logMatchesPlan(log, currentPlanId, currentPresetKey)) return;
        const dStr = log.read_at.substring(0, 10);
        logsByDate[dStr] = (logsByDate[dStr] || 0) + 1;
      });
    }
    chartData = dates.map(dStr => logsByDate[dStr] || 0);
  }

  // Render Chart.js
  const isDark = state.theme === 'dark' ||
    document.body.classList.contains('dark-theme') ||
    document.body.classList.contains('dark') ||
    document.documentElement.getAttribute('data-theme') === 'dark';
  const fontColor = isDark ? 'rgba(248, 250, 252, 0.85)' : 'rgba(15, 23, 42, 0.75)';

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 160);
  gradient.addColorStop(0, 'rgba(4, 169, 210, 0.22)');
  gradient.addColorStop(1, 'rgba(4, 169, 210, 0)');

  renderOrUpdateChart('personalTrend', canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '每日讀經章數',
        data: chartData,
        borderColor: '#04A9D2',
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointBackgroundColor: '#04A9D2',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 1,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (context) {
              return `讀經章數: ${context.raw} 章`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: fontColor, font: { size: 9, weight: '400' } },
          grid: { display: false }
        },
        y: {
          ticks: { color: fontColor, stepSize: range === "year" ? 20 : 5, font: { size: 9, weight: '400' } },
          grid: { display: false },
          min: 0
        }
      }
    }
  });
}

// Window actions
window.changePersonalTrendRange = function (range) {
  state.personalTrendRange = range;
  renderPersonalTrendChart();
};

function renderPersonalUnlockedBadges() {
  // Deprecated: Badge strip is removed as badges only display on the profile page
}

async function renderMyPersonalRankings() {
  if (!state.activePlan) return;

  const rankSkeleton = typeof ComponentSkeletonLoader !== "undefined"
    ? ComponentSkeletonLoader.getHtml("inline", { width: "4.5rem", height: "1.4rem" })
    : "—";
  const elRankAll = document.getElementById("my-rank-all");
  const elRankAllTotal = document.getElementById("my-rank-all-total");
  const elRankZoneTitle = document.getElementById("my-rank-zone-title");
  const elRankZone = document.getElementById("my-rank-zone");
  const elRankZoneTotal = document.getElementById("my-rank-zone-total");

  if (elRankAll && firstPaint(elRankAll)) elRankAll.innerHTML = rankSkeleton;
  if (elRankAllTotal && firstPaint(elRankAllTotal)) elRankAllTotal.innerHTML = ComponentSkeletonLoader
    ? ComponentSkeletonLoader.getHtml("inline", { width: "3rem", height: "0.8rem" })
    : "—";
  if (elRankZone && firstPaint(elRankZone)) elRankZone.innerHTML = rankSkeleton;
  if (elRankZoneTotal && firstPaint(elRankZoneTotal)) elRankZoneTotal.innerHTML = ComponentSkeletonLoader
    ? ComponentSkeletonLoader.getHtml("inline", { width: "3rem", height: "0.8rem" })
    : "—";

  let result;
  try {
    result = await db.getPersonalPlanRankingSummary(state.activePlan);
  } catch (error) {
    console.warn("Failed to fetch personal plan ranking summary", error);
    result = { success: false };
  }

  const context = result && result.success ? result.context || {} : {};
  const churchRank = Number(context.churchRank || 0);
  const churchTotal = Number(context.churchTotal || 0);
  const zoneName = String(context.zoneName || state.currentUser.pastoral_zone || "").trim();
  const zoneRank = Number(context.zoneRank || 0);
  const zoneTotal = Number(context.zoneTotal || 0);

  if (elRankAll) elRankAll.textContent = churchRank > 0 ? `第 ${churchRank} 名` : "尚未加入";
  if (elRankAllTotal) elRankAllTotal.textContent = `共 ${churchTotal} 人報名`;
  if (elRankZoneTitle) elRankZoneTitle.textContent = zoneName ? `${zoneName} 個人排行` : "牧區個人排行";
  if (elRankZone) elRankZone.textContent = !zoneName ? "未選牧區" : (zoneRank > 0 ? `第 ${zoneRank} 名` : "尚未加入");
  if (elRankZoneTotal) elRankZoneTotal.textContent = zoneName ? `共 ${zoneTotal} 人報名` : "請設定所屬牧區";
}

function updateReadingTeamRankingSummary(division, text) {
  const summary = document.querySelector(`[data-team-ranking-summary="${division}"]`);
  if (summary) summary.textContent = text;
}

function focusReadingTeamRanking(container) {
  if (!container || container.hidden) return;
  const myTeamRow = container.querySelector(".bar-race-row--mine");
  if (!myTeamRow) {
    container.scrollTop = 0;
    return;
  }
  const containerRect = container.getBoundingClientRect();
  const rowRect = myTeamRow.getBoundingClientRect();
  const rowTop = container.scrollTop + rowRect.top - containerRect.top;
  const centeredOffset = rowTop - (container.clientHeight - rowRect.height) / 2;
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTop = Math.min(maxScroll, Math.max(0, centeredOffset));
}

function bindReadingTeamRankingToggles(sections) {
  sections.forEach(section => {
    const details = section.container.closest("[data-team-ranking-details]");
    if (!details || details.dataset.bound === "true") return;
    details.dataset.bound = "true";
    details.addEventListener("toggle", () => {
      if (details.open) requestAnimationFrame(() => focusReadingTeamRanking(section.container));
    });
  });
}

async function renderReadingTeamLeaderboards() {
  const sections = [
    { division: 3, key: "division3", container: document.getElementById("reading-team-ranking-3") },
    { division: 6, key: "division6", container: document.getElementById("reading-team-ranking-6") }
  ].filter(section => section.container);
  if (sections.length === 0) return;
  bindReadingTeamRankingToggles(sections);

  const skeleton = typeof ComponentSkeletonLoader !== "undefined"
    ? ComponentSkeletonLoader.getHtml("bar-race", { count: 3 })
    : '<div style="padding:1.25rem;text-align:center;color:var(--text-muted);">載入中…</div>';
  sections.forEach(section => {
    section.container.className = "bar-race-list reading-team-ranking-list";
    section.container.setAttribute("aria-busy", "true");
    if (firstPaint(section.container)) section.container.innerHTML = skeleton;
    updateReadingTeamRankingSummary(section.division, "團隊排行榜載入中…");
  });

  if (!state.activePlan) {
    sections.forEach(section => {
      section.container.removeAttribute("aria-busy");
      section.container.innerHTML = '<div style="padding:1.25rem;text-align:center;color:var(--text-muted);">請先選擇計畫</div>';
      updateReadingTeamRankingSummary(section.division, "尚未選擇計畫");
    });
    return;
  }

  const settleRequest = (request, timeoutMs) => new Promise(resolve => {
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish({
      success: false,
      message: "團隊排行榜載入逾時，請重新載入。"
    }), timeoutMs);
    Promise.resolve()
      .then(request)
      .then(finish, error => finish({ success: false, message: error && error.message }));
  });

  let result = await settleRequest(
    () => db.getReadingTeamLeaderboards(state.activePlan),
    8000
  );

  // Rolling-deployment compatibility: administrators can temporarily reuse the
  // existing aggregate statistics RPC until the dedicated leaderboard RPC is live.
  const canUseAdminFallback = hasWholeChurchPlanScope(state.currentUser);
  if ((!result || !result.success) && canUseAdminFallback && typeof db.getReadingTeamStatistics === "function") {
    const fallback = await settleRequest(
      () => db.getReadingTeamStatistics(state.activePlan),
      5000
    );
    if (fallback && fallback.success) {
      const fallbackTeams = Array.isArray(fallback.context && fallback.context.teams)
        ? fallback.context.teams
        : [];
      result = {
        success: true,
        context: {
          division3: fallbackTeams.filter(team => Number(team.division) === 3),
          division6: fallbackTeams.filter(team => Number(team.division) === 6)
        }
      };
    }
  }

  if (!result || !result.success) {
    const message = escapeHTML(result && result.message || "目前無法載入團隊排行榜。");
    sections.forEach(section => {
      section.container.removeAttribute("aria-busy");
      updateReadingTeamRankingSummary(section.division, "讀取失敗・請重新載入");
      section.container.innerHTML = `
        <div style="padding:1.25rem;text-align:center;color:var(--text-muted);">
          <div>${message}</div>
          <button type="button" class="secondary-btn" data-team-ranking-retry style="margin-top:0.75rem;">重新載入</button>
        </div>
      `;
      const retryButton = section.container.querySelector("[data-team-ranking-retry]");
      if (retryButton) retryButton.onclick = () => renderReadingTeamLeaderboards();
    });
    return;
  }

  const context = result.context || {};
  sections.forEach(section => {
    const teams = Array.isArray(context[section.key]) ? [...context[section.key]] : [];
    section.container.removeAttribute("aria-busy");
    const completedAt = team => {
      const time = team && team.lastReadAt ? new Date(team.lastReadAt).getTime() : Infinity;
      return Number.isFinite(time) ? time : Infinity;
    };
    teams.sort((a, b) => {
      const scoreDiff = Number(b.chaptersRead || 0) - Number(a.chaptersRead || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const aTime = completedAt(a);
      const bTime = completedAt(b);
      if (aTime !== bTime) return aTime - bTime;
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
    });

    if (teams.length === 0) {
      section.container.innerHTML = `<div style="padding:1.25rem;text-align:center;color:var(--text-muted);">目前尚無 ${section.division} 人團隊</div>`;
      updateReadingTeamRankingSummary(section.division, "共 0 隊");
      return;
    }

    const maxChapters = Math.max(...teams.map(team => Number(team.chaptersRead || 0)), 1);
    section.container.innerHTML = '<div class="bar-race-track"></div>';
    const track = section.container.querySelector(".bar-race-track");

    let calculatedRank = 1;
    teams.forEach((team, index) => {
      const chaptersRead = Math.max(0, Number(team.chaptersRead || 0));
      const memberCount = Math.max(0, Number(team.memberCount || 0));
      const previousTeam = index > 0 ? teams[index - 1] : null;
      const sharesRank = previousTeam
        && chaptersRead === Math.max(0, Number(previousTeam.chaptersRead || 0))
        && completedAt(team) === completedAt(previousTeam);
      if (index > 0 && !sharesRank) calculatedRank = index + 1;
      const serverRank = Number(team.rank);
      const rank = Number.isFinite(serverRank) && serverRank > 0 ? serverRank : calculatedRank;
      const progressPercent = Math.min(100, Math.round(chaptersRead / maxChapters * 100));
      const row = document.createElement("div");
      row.className = `bar-race-row${team.isMine ? " bar-race-row--mine" : ""}`;
      row.style.setProperty("--target-width", `${progressPercent}%`);
      row.dataset.teamRank = String(rank);
      row.style.transitionDelay = `${index * 70}ms`;
      row.innerHTML = `
        <div class="bar-race-rank">${rank}</div>
        <div class="bar-race-main">
          <div class="bar-race-meta">
            <span class="bar-race-name">${escapeHTML(team.name || "未命名隊伍")}${team.isMine ? '<span class="bar-race-mine-badge">我的團隊</span>' : ""}</span>
            <span class="bar-race-percent">${chaptersRead} 章</span>
          </div>
          <div class="bar-race-bar-shell" role="progressbar" aria-label="${escapeHTML(team.name || "未命名隊伍")}閱讀進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}">
            <div class="bar-race-bar"></div>
          </div>
          <div class="bar-race-details">
            <span class="bar-race-members">${memberCount}/${section.division} 人</span>
          </div>
        </div>
      `;
      track.appendChild(row);
    });

    const myTeamRow = track.querySelector(".bar-race-row--mine");
    const teamCountLabel = `共 ${teams.length} 隊`;
    updateReadingTeamRankingSummary(
      section.division,
      myTeamRow
        ? `我的團隊第 ${myTeamRow.dataset.teamRank} 名・${teamCountLabel}`
        : `${teamCountLabel}・尚未加入 ${section.division} 人團隊`
    );

    requestAnimationFrame(() => {
      track.querySelectorAll(".bar-race-row").forEach(row => row.classList.add("is-running"));
      requestAnimationFrame(() => focusReadingTeamRanking(section.container));
    });
  });
}

function focusPastoralRaceRanking(container) {
  if (!container || container.hidden) return;
  const myPastoralRow = container.querySelector(".pastoral-race-row--mine");
  if (!myPastoralRow) {
    container.scrollTop = 0;
    return;
  }
  const containerRect = container.getBoundingClientRect();
  const rowRect = myPastoralRow.getBoundingClientRect();
  const rowTop = container.scrollTop + rowRect.top - containerRect.top;
  const centeredOffset = rowTop - (container.clientHeight - rowRect.height) / 2;
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTop = Math.min(maxScroll, Math.max(0, centeredOffset));
}

function bindPastoralRankingToggle(container) {
  const details = container && container.closest("[data-pastoral-ranking-details]");
  if (!details || details.dataset.focusBound === "true") return;
  details.dataset.focusBound = "true";
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => focusPastoralRaceRanking(container));
    });
  });
}

async function renderPlanRankingView() {
  ensureChartLib().catch(() => {}); // A2：排名分頁也有成長趨勢圖，提前開始抓 Chart.js
  const rankingResults = await Promise.allSettled([
    Promise.resolve().then(() => renderReadingTeamLeaderboards()),
    Promise.resolve().then(() => renderMyPersonalRankings())
  ]);
  rankingResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(index === 0
        ? "Failed to render reading-team leaderboards"
        : "Failed to render personal rankings", result.reason);
    }
  });

  const container = document.getElementById("pastoral-ranking-list-container");
  if (!container) return;
  bindPastoralRankingToggle(container);

  const rankingCard = container.closest(".glass-card");
  if (rankingCard) rankingCard.style.display = "";

  const header = container.previousElementSibling;
  if (header) header.style.display = "none";
  container.className = "bar-race-list";
  container.style.cssText = "";
  if (firstPaint(container)) container.innerHTML = typeof ComponentSkeletonLoader !== "undefined"
    ? ComponentSkeletonLoader.getHtml("bar-race", { count: 4 })
    : "";

  let pastoralStats = [];
  let unassignedPastoralCount = 0;
  try {
    const result = await db.getPastoralZoneLeaderboard(state.activePlan);
    if (!result.success) throw result.error || new Error(result.message || "Failed to load pastoral leaderboard");
    const context = result.context || {};
    const completionTime = item => {
      const timestamp = item && item.completed_at ? new Date(item.completed_at).getTime() : Infinity;
      return Number.isFinite(timestamp) ? timestamp : Infinity;
    };
    pastoralStats = (Array.isArray(context.zones) ? context.zones : []).map(zone => ({
      name: zone.name || "",
      total_chapters: Number(zone.chaptersRead || 0),
      members: Number(zone.memberCount || 0),
      average_chapters: Math.round(Number(
        zone.averageChapters ?? (
          Number(zone.memberCount || 0) > 0
            ? Number(zone.chaptersRead || 0) / Number(zone.memberCount || 0)
            : 0
        )
      ) * 100) / 100,
      completed_at: zone.lastReadAt || null,
      is_mine: zone.isMine === true
    })).sort((a, b) => {
      const averageDiff = b.average_chapters - a.average_chapters;
      if (averageDiff !== 0) return averageDiff;
      const timeDiff = completionTime(a) - completionTime(b);
      if (timeDiff !== 0) return timeDiff;
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
    });
    unassignedPastoralCount = Number(context.unassignedCount || 0);
  } catch (e) {
    console.error("Failed to load pastoral rankings", e);
  }

  const badge = document.getElementById("pastoral-ranking-count-badge");
  if (badge) {
    badge.textContent = `共 ${pastoralStats.length} 個牧區`;
    badge.style.display = pastoralStats.length > 0 ? "inline-block" : "none";
  }

  if (pastoralStats.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted);">目前沒有排行資料</div>`;
    return;
  }

  const maxAverageChapters = Math.max(...pastoralStats.map(item => item.average_chapters), 1);
  const pastoralCompletionTime = item => {
    const timestamp = item && item.completed_at ? new Date(item.completed_at).getTime() : Infinity;
    return Number.isFinite(timestamp) ? timestamp : Infinity;
  };
  const formatPastoralCompletion = value => {
    if (!value) return "尚無完成時間";
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const [, month, day] = text.split("-");
      return `完成 ${Number(month)}/${Number(day)}`;
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "尚無完成時間";
    return `完成 ${new Intl.DateTimeFormat("zh-TW", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date)}`;
  };
  const formatAverageChapters = value => new Intl.NumberFormat("zh-TW", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
  const renderRace = () => {
    container.className = "pastoral-race-list";
    container.innerHTML = `
      <div class="pastoral-race-toolbar">
        <div>
          <div class="pastoral-race-title">即時閱讀表現</div>
          <div class="pastoral-race-subtitle">以目前最高平均每人閱讀章數為 100%</div>
        </div>
      </div>
      <div class="pastoral-race-average-notice" role="note" aria-label="平均數計算說明">
        <strong>提醒：此排行榜顯示平均數</strong>
        <span>平均每人閱讀章數＝牧區總閱讀章數 ÷ 全牧區在籍有效人數；不論是否報名此計畫、是否已開始閱讀都計入分母，所以這裡的人數通常比上方「我的讀經排名」的報名人數多。</span>
      </div>
      <div class="pastoral-race-track">
        ${pastoralStats.length === 0 ? '<div class="pastoral-race-empty">目前沒有已設定牧區的排行資料</div>' : ""}
      </div>
    `;
    const track = container.querySelector(".pastoral-race-track");

    let calculatedRank = 1;
    pastoralStats.forEach((item, index) => {
      const previousItem = index > 0 ? pastoralStats[index - 1] : null;
      const sharesRank = previousItem
        && item.average_chapters === previousItem.average_chapters
        && pastoralCompletionTime(item) === pastoralCompletionTime(previousItem);
      if (index > 0 && !sharesRank) calculatedRank = index + 1;
      const rank = calculatedRank;
      const pct = Math.min(100, Math.round((item.average_chapters / maxAverageChapters) * 100));
      const placementClass = rank <= 3 ? " pastoral-race-row--podium" : "";
      const ownershipClass = item.is_mine ? " pastoral-race-row--mine" : "";
      const row = document.createElement("div");
      row.className = `pastoral-race-row${placementClass}${ownershipClass}`;
      row.style.setProperty("--target-width", `${pct}%`);
      row.style.transitionDelay = `${index * 70}ms`;
      row.innerHTML = `
        <div class="pastoral-race-rank" aria-label="第 ${rank} 名">${rank}</div>
        <div class="pastoral-race-main">
          <div class="pastoral-race-heading">
            <div class="pastoral-race-identity">
              <span class="pastoral-race-name">${escapeHTML(item.name)}</span>
              ${item.is_mine ? '<span class="pastoral-race-mine-badge">我的牧區</span>' : ""}
              <span class="pastoral-race-members">總計 ${item.total_chapters} 章 · 全牧區 ${item.members} 人</span>
            </div>
            <div class="pastoral-race-score"><strong>${formatAverageChapters(item.average_chapters)}</strong><span>章／人</span></div>
          </div>
          <div class="pastoral-race-progress-meta">
            <span>相對閱讀速度</span>
            <strong>${pct}%</strong>
          </div>
          <div class="pastoral-race-progress" role="progressbar" aria-label="${escapeHTML(item.name)}平均每人閱讀章數" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="平均每人 ${formatAverageChapters(item.average_chapters)} 章，相對進度 ${pct}%">
            <div class="pastoral-race-progress-fill"></div>
          </div>
        </div>
      `;
      track.appendChild(row);
    });

    if (typeof hydrateIcons === "function") hydrateIcons(container);

    requestAnimationFrame(() => {
      track.querySelectorAll(".pastoral-race-row").forEach(row => row.classList.add("is-running"));
      requestAnimationFrame(() => focusPastoralRaceRanking(container));
    });
  };

  renderRace();
}

async function renderGroupParticipantsRankingTable() {
  // 管理頁「組員總覽」看的是計畫篩選選的計畫，跟同頁的組織統計樹一致（#369）；
  // 計畫分頁裡就是自己正在讀的計畫。
  const statsPlan = getOrgStatsContextPlan();
  if (!statsPlan) return;
  // 只有看的是自己正在讀的計畫時，「我」那一列才用本機即時的打卡與進度；
  // 否則跟其他人一樣用名單上的數字。
  const isViewingOwnPlan = Boolean(state.activePlan) && (
    statsPlan === state.activePlan
    || (statsPlan.id && statsPlan.id === state.activePlan.id)
    || (statsPlan.globalPlanId && statsPlan.globalPlanId === state.activePlan.globalPlanId)
  );

  const rankingTitle = document.getElementById("ranking-title") || document.getElementById("members-ranking-title");
  const currentPlanIdForStats = isViewingOwnPlan ? state.activePlan.id : null;
  const currentPresetKeyForStats = isViewingOwnPlan ? state.activePlan.presetKey : null;
  const uniquePlanLogs = (logs) => {
    const unique = new Set();
    const planChapters = new Set();
    if (state.activePlan && state.activePlan.days) {
      state.activePlan.days.forEach(d => {
        if (d.chapters) {
          d.chapters.forEach(ch => {
            planChapters.add(`${ch.book}_${ch.chapter}`);
          });
        }
      });
    }
    (logs || []).forEach(log => {
      if (!logMatchesPlan(log, currentPlanIdForStats, currentPresetKeyForStats)) return;
      if (planChapters.has(`${log.book}_${log.chapter}`)) {
        unique.add(`${log.book}_${log.chapter}_${log.round || 1}`);
      }
    });
    return unique.size;
  };
  const myPlanReadCount = isViewingOwnPlan ? uniquePlanLogs(state.readingLogs || []) : 0;
  // 「最高連續」各計畫獨立算：只看歸屬這個計畫的打卡，不混用全域 state.currentUser.streak。
  const personalStreak = myPlanReadCount > 0
    ? computePlanScopedStreak(state.readingLogs || [], {
        planId: currentPlanIdForStats,
        presetKey: currentPresetKeyForStats
      })
    : 0;

  // 進度狀態 / 補讀天數是「大家對同一把尺」的天數比較，尺一律是這個階段的
  // 教會原始日程（七日、不套任何使用者的 level 或個人休息日）。絕不能用
  // state.activePlan.days —— 那是「看榜這個人自己」的排程。
  const baselineScheduleDays = typeof window.getCanonicalStageScheduleDays === "function"
    ? window.getCanonicalStageScheduleDays(statsPlan)
    : (statsPlan.days || []);

  // 補讀、完成天數、應讀天數都走 schedule-progress.mjs 的共用原語（跟個人報告、團隊名冊同一套）。
  // 補讀只看第一遍的 log；呼叫端已經篩成這個計畫的 log。
  const calculateCatchUpDays = (userLogs) =>
    countLateCompletedDays(baselineScheduleDays, statsPlan.startDate, buildRound1ReadDateMap(userLogs));

  // 休息日（沒排章節）兩邊都不算：完成天數依序蓋掉有章節的天，應讀天數也只數有章節的天，
  // 否則照進度讀的人會被每個休息日誤判成落後一天。
  const expectedDaysCount = countExpectedScheduleDays(baselineScheduleDays, statsPlan.startDate);

  const userZone = state.currentUser.managed_zones || state.currentUser.pastoral_zone
    || getLeadershipAssignmentNodeNames(state.currentUser, "牧區") || "";
  const userRole = getUserRoleCode(state.currentUser) || "member";
  const isAdmin = hasWholeChurchPlanScope(userRole);
  const isGreatZoneLeader = userRole === "great_zone_leader";
  const isZoneLeader = userRole === "zone_leader";
  const isGroupLeader = userRole === "group_leader";

  const listContainer = document.getElementById("ranking-participants-list");
  if (listContainer) {
    if (firstPaint(listContainer)) listContainer.innerHTML = typeof ComponentSkeletonLoader !== "undefined"
      ? ComponentSkeletonLoader.getHtml("member-progress", { count: 5 })
      : "";

    let allUsers = [];
    // 名單和紀錄來自同一個快取項目，一定是同一個計畫的（#369）。
    let logsByUserId = new Map();
    try {
      const statsKey = getPlanStatsCacheKey(statsPlan);
      const merged = await db.fetchMergedUsersWithLogs(statsKey, { maxAgeMs: Infinity });
      allUsers = merged.users || [];
      logsByUserId = merged.logsByUserId || new Map();
    } catch (e) {
      console.warn("Failed to fetch merged users, fallback to empty array", e);
    }

    let scopedUsersList = allUsers;
    if (isAdmin) {
      scopedUsersList = allUsers;
    } else if (isGreatZoneLeader) {
      const userGreatRegion = state.currentUser.managed_regions || state.currentUser.great_region
        || getLeadershipAssignmentNodeNames(state.currentUser, "大區") || "";
      const myRegions = userGreatRegion.split(",").map(s => s.trim()).filter(Boolean);
      scopedUsersList = allUsers.filter(u => myRegions.includes(u.great_region));
    } else if (isZoneLeader) {
      const userZoneStr = state.currentUser.managed_zones || state.currentUser.pastoral_zone
        || getLeadershipAssignmentNodeNames(state.currentUser, "牧區") || "";
      const myZones = userZoneStr.split(",").map(s => s.trim()).filter(Boolean);
      scopedUsersList = allUsers.filter(u => myZones.includes(u.pastoral_zone));
    } else if (isGroupLeader) {
      const userGroupStr = state.currentUser.managed_groups || state.currentUser.small_group
        || getLeadershipAssignmentNodeNames(state.currentUser, "小組") || "";
      const myGroups = userGroupStr.split(",").map(s => s.trim()).filter(Boolean);
      scopedUsersList = allUsers.filter(u => myGroups.includes(u.small_group));
    } else {
      const userZones = (userZone || "").split(",").map(s => s.trim()).filter(Boolean);
      scopedUsersList = allUsers.filter(u => userZones.includes(u.pastoral_zone));
    }

    const tabMembers = document.getElementById("tab-plan-members");
    const isMembersActive = (tabMembers && tabMembers.classList.contains("active"))
      || window.currentPlanViewState === PLAN_ROUTE.ORG_STATS;

    if (isMembersActive) {
      populateMembersSelector();
    } else {
      populateStatsSelector();
    }
    const rankingZoneSelector = document.getElementById("ranking-zone-selector");
    const membersZoneSelector = document.getElementById("members-zone-selector");
    const searchInput = document.getElementById("member-search-input");
    const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

    let groupMembers = scopedUsersList;

    if (isMembersActive) {
      if (query) {
        groupMembers = scopedUsersList.filter(u => u.name.toLowerCase().includes(query));
        if (rankingTitle) rankingTitle.textContent = `搜尋結果: ${query}`;
      } else {
        const selectedFilter = getActiveOrgFilter();
        if (selectedFilter) {
          if (selectedFilter.startsWith("zone:")) {
            const zone = selectedFilter.replace("zone:", "");
            if (zone === "未設定牧區") {
              groupMembers = scopedUsersList.filter(u => !u.pastoral_zone || u.pastoral_zone.trim() === "");
              if (rankingTitle) rankingTitle.textContent = "參與者總覽 (未設定牧區成員)";
            } else {
              groupMembers = scopedUsersList.filter(u => u.pastoral_zone === zone);
              if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${zone}牧區)`;
            }
          } else if (selectedFilter.startsWith("group:")) {
            const group = selectedFilter.replace("group:", "");
            groupMembers = scopedUsersList.filter(u => u.small_group === group);
            if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${group}小組)`;
          } else if (selectedFilter.startsWith("region:")) {
            const region = selectedFilter.replace("region:", "");
            groupMembers = scopedUsersList.filter(u => u.great_region === region);
            if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${region}大區成員)`;
          } else if (selectedFilter === "all") {
            groupMembers = scopedUsersList;
            if (rankingTitle) rankingTitle.textContent = "參與者總覽 (全教會成員)";
          } else if (selectedFilter === "all_great_region") {
            groupMembers = scopedUsersList;
            if (rankingTitle) rankingTitle.textContent = "參與者總覽 (所屬大區成員)";
          } else {
            const userZones = (userZone || "").split(",").map(s => s.trim()).filter(Boolean);
            groupMembers = scopedUsersList.filter(u => userZones.includes(u.pastoral_zone));
            if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userZone}牧區)`;
          }
        } else {
          const userZones = (userZone || "").split(",").map(s => s.trim()).filter(Boolean);
          groupMembers = scopedUsersList.filter(u => userZones.includes(u.pastoral_zone));
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userZone}牧區)`;
        }
      }
    } else {
      const selectedFilter = window._statsTabScope !== null
        ? window._statsTabScope
        : (rankingZoneSelector ? rankingZoneSelector.value : null);
      if (selectedFilter) {
        if (selectedFilter === "all") {
          groupMembers = allUsers;
          if (rankingTitle) rankingTitle.textContent = "參與者總覽 (全教會排行)";
        } else if (selectedFilter === "all_great_region") {
          const userGreatRegion = state.currentUser.managed_regions || state.currentUser.great_region
            || getLeadershipAssignmentNodeNames(state.currentUser, "大區") || "";
          const userRegions = userGreatRegion.split(",").map(s => s.trim()).filter(Boolean);
          groupMembers = allUsers.filter(u => userRegions.includes(u.great_region));
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userGreatRegion}排行)`;
        } else if (selectedFilter === "all_zones") {
          const userZoneStr = state.currentUser.managed_zones || state.currentUser.pastoral_zone
            || getLeadershipAssignmentNodeNames(state.currentUser, "牧區") || "";
          const userZones = userZoneStr.split(",").map(s => s.trim()).filter(Boolean);
          groupMembers = allUsers.filter(u => userZones.includes(u.pastoral_zone));
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userZoneStr}排行)`;
        } else if (selectedFilter === "all_groups") {
          const userGroupStr = state.currentUser.managed_groups || state.currentUser.small_group
            || getLeadershipAssignmentNodeNames(state.currentUser, "小組") || "";
          const userGroups = userGroupStr.split(",").map(s => s.trim()).filter(Boolean);
          groupMembers = allUsers.filter(u => userGroups.includes(u.small_group));
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userGroupStr}排行)`;
        } else if (selectedFilter.startsWith("region:")) {
          const region = selectedFilter.replace("region:", "");
          groupMembers = allUsers.filter(u => u.great_region === region);
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${region}大區排行)`;
        } else if (selectedFilter.startsWith("zone:")) {
          const zone = selectedFilter.replace("zone:", "");
          if (zone === "未設定牧區") {
            groupMembers = allUsers.filter(u => !u.pastoral_zone || u.pastoral_zone.trim() === "");
            if (rankingTitle) rankingTitle.textContent = "參與者總覽 (未設定牧區成員排行)";
          } else {
            groupMembers = allUsers.filter(u => u.pastoral_zone === zone);
            if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${zone}牧區排行)`;
          }
        } else if (selectedFilter.startsWith("group:")) {
          const group = selectedFilter.replace("group:", "");
          groupMembers = allUsers.filter(u => u.small_group === group);
          if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${group}小組排行)`;
        }
      } else {
        const userZones = (userZone || "").split(",").map(s => s.trim()).filter(Boolean);
        groupMembers = allUsers.filter(u => userZones.includes(u.pastoral_zone));
        if (rankingTitle) rankingTitle.textContent = `參與者總覽 (${userZone}牧區排行)`;
      }
    }

    if (rankingTitle) {
      const adminParticipantsTitle = document.getElementById("admin-participants-title");
      if (adminParticipantsTitle) {
        adminParticipantsTitle.textContent = rankingTitle.textContent;
      }
    }

    groupMembers = groupMembers.map(u => {
      const isMe = u.name === state.currentUser.name;
      const useMyLiveData = isMe && isViewingOwnPlan;
      const memberLogs = logsByUserId.get(u.id) || [];
      const hasAnyPlanRead = useMyLiveData
        ? myPlanReadCount > 0
        : ((u.chapters_read || 0) > 0 || ((u.plan_progress || 0) > 0 && Boolean(u.last_read)));
      // 別人的紀錄已在查詢層限定到這個計畫（preset_key / global_plan_id），
      // 所以 preFiltered；他們的 log.plan_id 是各自的 enrollment，不能拿來比對我的。
      const streak = !hasAnyPlanRead
        ? 0
        : useMyLiveData
          ? personalStreak
          : computePlanScopedStreak(memberLogs, { preFiltered: true });

      let completed = 0;
      let makeup = 0;
      let diff = 0;

      if (hasAnyPlanRead) {
        let memberIsCompletedOnce;
        if (useMyLiveData) {
          completed = myPlanReadCount;
          const myUserLogs = (state.readingLogs || []).filter(l =>
            l.plan_id === state.activePlan.id || l.presetKey === state.activePlan.presetKey
          );
          makeup = calculateCatchUpDays(myUserLogs);
          memberIsCompletedOnce = state.activePlan.isPlanCompleted || (state.activePlan.currentRound || 1) > 1;
        } else {
          completed = u.chapters_read || 0;
          makeup = calculateCatchUpDays(memberLogs);
          memberIsCompletedOnce = (u.current_round || 1) > 1;
        }
        // 讀完一遍後直接視為天數全滿，避免進入二三遍後被誤判落後。
        // 一律對「基準日程」比對，不受看榜者自己的 level 影響。
        const completedDays = memberIsCompletedOnce
          ? baselineScheduleDays.length
          : countScheduleDaysCoveredByChapters(baselineScheduleDays, completed);
        diff = completedDays - expectedDaysCount;
      }

      const memberRound = Number(useMyLiveData ? state.activePlan.currentRound : u.current_round) || 1;
      const memberProgress = Math.max(0, Math.min(100, Math.round(Number(
        useMyLiveData ? state.activePlan.progress : u.plan_progress
      ) || 0)));
      let statusStr = hasAnyPlanRead ? "在進度上" : "未開始";
      let statusColor = "var(--text-muted)";
      if (hasAnyPlanRead && memberRound === 1 && memberProgress >= 100) {
        statusStr = "第一遍完成";
        statusColor = "var(--color-success-foreground)";
      } else if (hasAnyPlanRead && memberRound > 1) {
        statusStr = memberProgress > 0 ? `第${memberRound}遍完成${memberProgress}%` : `第${memberRound}遍進行中`;
        statusColor = memberProgress >= 100 ? "var(--color-success-foreground)" : "var(--color-brand)";
      } else if (hasAnyPlanRead && diff > 0) {
        statusStr = `超前 ${diff}天`;
        statusColor = "var(--color-success-foreground)";
      } else if (hasAnyPlanRead && diff < 0) {
        statusStr = diff === -1 ? "今日未完成" : `落後 ${Math.abs(diff)}天`;
        statusColor = "var(--color-danger)";
      }

      return {
        id: u.id,
        name: u.name,
        greatRegion: u.great_region || "",
        pastoralZone: u.pastoral_zone || "",
        smallGroup: u.small_group || "",
        streak: streak,
        completed: completed,
        makeup: makeup,
        statusStr: statusStr,
        statusColor: statusColor,
        isMe: isMe,
        isBehind: hasAnyPlanRead && diff < 0,
        isNotStarted: !hasAnyPlanRead,
        last_read: u.last_read_at || u.last_read || null
      };
    });

    // ── 多重排序 + Dense Rank（參與者排行榜）──
    // 排序一：completed DESC（進度天數高者優先）
    // 排序二：last_read ASC（相同進度時，最早完成者優先；null 排最後）
    // 排序三：id ASC（確定性防線，保證跨查詢順序 100% 穩定）
    groupMembers.sort((a, b) => {
      const diff = (b.completed ?? 0) - (a.completed ?? 0);
      if (diff !== 0) return diff;
      const aT = a.last_read ? new Date(a.last_read).getTime() : Infinity;
      const bT = b.last_read ? new Date(b.last_read).getTime() : Infinity;
      if (aT !== bT) return aT - bT;
      return String(a.id ?? a.name ?? '').localeCompare(String(b.id ?? b.name ?? ''));
    });

    // Dense Rank：進度 + last_read 完全相同者共享同一名次
    // 未開始（completed = 0）→ 一律顯示最後名次，讓人感受「從最後衝到最前」的動力
    const _totalMemberCount = groupMembers.length;
    let _denseRank = 1;
    groupMembers = groupMembers.map((m, i) => {
      // 未開始者：名次 = 總人數（最後一名）
      if ((m.completed ?? 0) === 0) return { ...m, rank: _totalMemberCount };
      if (i === 0) return { ...m, rank: 1 };
      const prev = groupMembers[i - 1];
      const same = (m.completed ?? 0) === (prev.completed ?? 0)
        && (m.last_read ?? null) === (prev.last_read ?? null);
      if (!same) _denseRank = i + 1;
      return { ...m, rank: _denseRank };
    });

    window._grpScopedProcessedMembers = groupMembers;

    if (searchInput && !searchInput.dataset.listenerInitialized) {
      searchInput.dataset.listenerInitialized = "true";
      let searchFrame = null;
      searchInput.addEventListener("input", () => {
        if (searchFrame !== null) window.cancelAnimationFrame(searchFrame);
        searchFrame = window.requestAnimationFrame(() => {
          searchFrame = null;
          window.displayParticipantsList(100);
        });
      });
    }
    window.displayParticipantsList(100);
  }
}

window.displayParticipantsList = function (limit = 100) {
  const listContainer = document.getElementById("ranking-participants-list");
  if (!listContainer) return;

  const searchInput = document.getElementById("member-search-input");
  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

  // Filter based on search query
  let items = window._grpScopedProcessedMembers || [];
  if (query) {
    items = items.filter(m => m.name.toLowerCase().includes(query));
  }

  // Load previous ranks for trend comparison
  // 名次趨勢跟著列表顯示的計畫存（管理頁可能是所選的另一個計畫）。
  const activeKey = getPlanStatsCacheKey(getOrgStatsContextPlan());
  const storageKey = `nlc_prev_ranks_${activeKey}`;
  let prevRanks = {};
  if (activeKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) prevRanks = JSON.parse(raw);
    } catch (e) {
      console.warn("Failed to load prev ranks:", e);
    }
  }

  listContainer.innerHTML = "";

  if (items.length === 0) {
    listContainer.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.88rem;">無符合搜尋條件的成員</div>`;
    return;
  }

  // Slice items to show only the specified limit
  const visibleItems = items.slice(0, limit);

  // Determine if current user is a leader who can send care reminders
  const _careRole = (state.currentUser && getUserRoleCode(state.currentUser)) || "member";
  const _canSendCare = ["group_leader", "zone_leader", "great_zone_leader", "pastor", "admin"].includes(_careRole);

  // 對齊 header 欄位動態調整（含名次欄）
  const headerEl = document.getElementById("members-ranking-header") || listContainer.previousElementSibling;
  if (headerEl) {
    // 名次欄寬度 36px
    if (_canSendCare) {
      headerEl.style.gridTemplateColumns = "36px minmax(4.5em, 1fr) 80px 80px 70px 90px 44px";
      let reminderHeader = document.getElementById("members-ranking-reminder-col");
      if (!reminderHeader) {
        reminderHeader = Array.from(headerEl.children).find(child => child.id === "members-ranking-reminder-col" || child.textContent === "提醒");
      }
      if (!reminderHeader) {
        reminderHeader = document.createElement("div");
        reminderHeader.id = "members-ranking-reminder-col";
        reminderHeader.style.color = "var(--text-muted)";
        reminderHeader.textContent = "提醒";
        headerEl.appendChild(reminderHeader);
      }
    } else {
      headerEl.style.gridTemplateColumns = "36px minmax(4.5em, 1fr) 80px 80px 70px 90px";
      const reminderHeader = document.getElementById("members-ranking-reminder-col")
        || Array.from(headerEl.children).find(child => child.id === "members-ranking-reminder-col" || child.textContent === "提醒");
      if (reminderHeader) reminderHeader.remove();
    }
    // 論是否已有名次 header—若編影第一個子元素不是名次欄，則插入
    const firstChild = headerEl.firstElementChild;
    if (!firstChild || firstChild.id !== "members-ranking-rank-col") {
      const rankHeader = document.createElement("div");
      rankHeader.id = "members-ranking-rank-col";
      rankHeader.style.cssText = "color: var(--text-muted); font-size: 0.875rem; text-align: center;";
      rankHeader.textContent = "名次";
      headerEl.insertBefore(rankHeader, firstChild);
    }
  }

  visibleItems.forEach(m => {
    const itemRow = document.createElement("div");
    // 名次欄 36px 加入 grid
    itemRow.style.cssText = `
      display: grid;
      grid-template-columns: 36px minmax(4.5em, 1fr) 80px 80px 70px 90px${_canSendCare ? ' 44px' : ''};
      gap: 0.4rem;
      align-items: center;
      padding: 0.6rem 0.2rem;
      border-bottom: 1px solid var(--border-card);
      font-size: 0.88rem;
      font-weight: 500;
      text-align: center;
    `;
    if (m.isMe) {
      itemRow.style.background = "var(--color-brand-muted, rgba(4,169,210,0.08))";
      itemRow.style.borderRadius = "8px";
    }

    const rankNum = m.rank ?? "—";
    let trendHtml = "";
    if (rankNum !== "—" && m.completed > 0 && activeKey) {
      const prevRank = prevRanks[m.id];
      if (prevRank !== undefined) {
        if (Number(rankNum) < Number(prevRank)) {
          trendHtml = `<span style="color: var(--color-success-foreground); font-size: 0.875rem; margin-left: 2px; display: inline-flex; align-items: center; justify-content: center;" title="相較上次更新上升 ${prevRank - rankNum} 名">▲</span>`;
        } else if (Number(rankNum) > Number(prevRank)) {
          trendHtml = `<span style="color: var(--color-danger); font-size: 0.875rem; margin-left: 2px; display: inline-flex; align-items: center; justify-content: center;" title="相較上次更新下降 ${rankNum - prevRank} 名">▼</span>`;
        }
      }
    }

    // 名次徽章樣式：Top 3 上色，其餘灰色
    const rankColor = rankNum === 1 ? 'var(--rank-gold)' : rankNum === 2 ? 'var(--text-secondary)' : rankNum === 3 ? 'var(--rank-bronze)' : 'var(--text-muted)';
    itemRow.innerHTML = `
      <div style="font-size: 0.875rem; font-weight: 700; color: ${rankColor}; text-align: center; display: flex; align-items: center; justify-content: center; gap: 2px;">
        #${rankNum}${trendHtml}
      </div>
      <div style="text-align: left; word-break: break-word; white-space: normal; line-height: 1.25; color: ${m.isMe ? 'var(--primary-color)' : 'var(--text-primary)'}">
        ${escapeHTML(m.name)}
      </div>
      <div class="text-danger">${m.streak}</div>
      <div class="text-success-fg">${m.completed}</div>
      <div class="text-warning">${m.makeup}</div>
      <div style="color: ${m.statusColor}; font-size: 0.875rem;">${m.statusStr}</div>
    `;

    // 💌 關心戳一下按鈕（僅限領袖，自己的列不顯示）
    if (_canSendCare) {
      if (!m.isMe) {
        const careBtn = document.createElement("button");
        careBtn.className = "secondary-btn";
        careBtn.title = "傳送關心提醒";
        careBtn.setAttribute("aria-label", `關心 ${m.name}`);
        careBtn.style.cssText = `
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 50%;
          padding: 0;
          margin: 0 auto;
          color: var(--color-brand, #04A9D2);
          background: transparent;
          border: 1px solid var(--border-card, rgba(0,0,0,0.1));
          cursor: pointer; transition: all 0.2s ease;
          flex-shrink: 0;
          box-shadow: none;
        `;
        careBtn.innerHTML = `<span class="nlc-icon nlc-icon--sm" data-icon="remind" aria-hidden="true" style="color: inherit; background: transparent;"></span>`;
        careBtn.addEventListener("mouseenter", () => {
          careBtn.style.background = "var(--color-brand-muted, rgba(4,169,210,0.08))";
          careBtn.style.borderColor = "var(--color-brand-border, rgba(4,169,210,0.24))";
        });
        careBtn.addEventListener("mouseleave", () => {
          careBtn.style.background = "transparent";
          careBtn.style.borderColor = "var(--border-card, rgba(0,0,0,0.1))";
        });
        careBtn.onclick = () => window.openCareReminderDialog(m);
        itemRow.appendChild(careBtn);
        if (typeof hydrateIcons === "function") hydrateIcons(careBtn);
      } else {
        // 自己的列提供空白的佔位元素，確保表格寬度跟 header 完全對齊
        const spacer = document.createElement("div");
        spacer.style.width = "44px";
        itemRow.appendChild(spacer);
      }
    }

    listContainer.appendChild(itemRow);
  });

  // If there are remaining items, append a "Load More" button at the bottom of the list
  if (items.length > limit) {
    const loadMoreRow = document.createElement("div");
    loadMoreRow.style.cssText = `
      text-align: center;
      padding: 0.8rem;
      margin-top: 0.4rem;
    `;

    const loadMoreBtn = document.createElement("button");
    loadMoreBtn.className = "secondary-btn";
    loadMoreBtn.style.cssText = `
      padding: 0.4rem 1.2rem;
      font-size: 0.875rem;
      font-weight: 500;
      border-radius: 20px;
      background: var(--bg-input);
      border: 1px solid var(--border-card);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
    `;
    loadMoreBtn.textContent = `載入更多成員 (剩餘 ${items.length - limit} 人)`;
    loadMoreBtn.onclick = () => {
      window.displayParticipantsList(limit + 100);
    };

    loadMoreRow.appendChild(loadMoreBtn);
    listContainer.appendChild(loadMoreRow);
  }

  // Save current ranks for next comparison
  if (activeKey) {
    const currentRanks = {};
    (window._grpScopedProcessedMembers || []).forEach(m => {
      if (m.rank && m.id) {
        currentRanks[m.id] = m.rank;
      }
    });
    try {
      localStorage.setItem(storageKey, JSON.stringify(currentRanks));
    } catch (e) {
      console.warn("Failed to save current ranks:", e);
    }
  }
}

function convertParticipantsOverviewToCSV(members, titleText, exportedAt = new Date()) {
  if (!Array.isArray(members) || members.length === 0) return "";
  const esc = csvCell;
  const lines = [];
  if (titleText) lines.push([esc("範圍"), esc(titleText)].join(","));
  if (state.activePlan && state.activePlan.name) lines.push([esc("計畫"), esc(state.activePlan.name)].join(","));
  if (lines.length > 0) lines.push("");
  lines.push([esc("名次"), esc("姓名"), esc("大區"), esc("牧區"), esc("小組"), esc("最高連續"), esc("累計完成"), esc("補讀"), esc("進度狀態")].join(","));
  members.forEach(m => {
    lines.push([
      m.rank ?? "",
      m.name || "",
      m.greatRegion || "未設定",
      m.pastoralZone || "未設定",
      m.smallGroup || "未設定",
      m.streak ?? 0,
      m.completed ?? 0,
      m.makeup ?? 0,
      m.statusStr || ""
    ].map(esc).join(","));
  });
  lines.push("");
  lines.push([esc("總人數"), esc(`${members.length} 人`)].join(","));
  return prependTaiwanExportTime(lines.join("\n"), exportedAt);
}

function exportParticipantsOverviewCSV() {
  const members = window._grpScopedProcessedMembers || [];
  if (members.length === 0) {
    if (typeof showToast === "function") showToast("目前沒有可供匯出的參與者資料。");
    return;
  }
  const titleEl = document.getElementById("members-ranking-title");
  const titleText = titleEl ? titleEl.textContent.trim() : "";
  const csvContent = convertParticipantsOverviewToCSV(members, titleText);
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = formatTaiwanDate();
  link.setAttribute("href", url);
  link.setAttribute("download", `participants_overview_${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
window.convertParticipantsOverviewToCSV = convertParticipantsOverviewToCSV;
window.exportParticipantsOverviewCSV = exportParticipantsOverviewCSV;

// ==================== 組員狀況 TAB ====================
async function renderPlanMembersView() {
  if (!state.activePlan) return;

  // Set up collapsible list logic
  const toggleBtn = document.getElementById("btn-toggle-members-collapse");
  const wrapper = document.getElementById("members-list-collapsible-wrapper");
  if (toggleBtn && wrapper && !toggleBtn.dataset.listenerBound) {
    toggleBtn.dataset.listenerBound = "true";
    toggleBtn.addEventListener("click", () => {
      const isCollapsed = wrapper.classList.toggle("hidden");
      toggleBtn.querySelector("span:first-child").textContent = isCollapsed ? "展開" : "收合";
      toggleBtn.querySelector("span:last-child").textContent = isCollapsed ? "▼" : "▲";
    });
  }

  const exportBtn = document.getElementById("btn-export-members-ranking");
  if (exportBtn && !exportBtn.dataset.listenerBound) {
    exportBtn.dataset.listenerBound = "true";
    exportBtn.addEventListener("click", () => exportParticipantsOverviewCSV());
  }

  const refreshBtn = document.getElementById("btn-refresh-members-ranking");
  if (refreshBtn && !refreshBtn.dataset.listenerBound) {
    refreshBtn.dataset.listenerBound = "true";
    refreshBtn.addEventListener("click", async () => {
      db.invalidateMergedUsersCache();
      if (typeof showToast === "function") showToast("更新排名中...");
      
      const membersTitleEl = document.getElementById("members-ranking-title");
      if (membersTitleEl) {
        const rankingTitleEl = document.getElementById("ranking-title");
        if (rankingTitleEl) rankingTitleEl.id = "_ranking-title-backup";
        membersTitleEl.id = "ranking-title";
        await renderGroupParticipantsRankingTable();
        membersTitleEl.id = "members-ranking-title";
        if (rankingTitleEl) rankingTitleEl.id = "ranking-title";
      } else {
        await renderGroupParticipantsRankingTable();
      }
      if (typeof showToast === "function") showToast("排名已更新");
    });
  }

  if (!(await prepareReadingTeamSubview("members"))) return;

  // Switch the header filter bars: show members controls, hide stats controls
  const adminScopeBar = document.getElementById("stats-admin-scope-bar");
  const membersOrgControls = document.getElementById("members-organization-controls");
  if (adminScopeBar) {
    adminScopeBar.classList.add("hidden");
    adminScopeBar.style.display = "none";
  }
  if (membersOrgControls) {
    membersOrgControls.style.display = "";
  }

  // Make sure selectors are populated correctly
  populateMembersSelector();

  // Use members-ranking-title element instead of ranking-title so the title
  // updates show up in the members subview card.
  const membersTitleEl = document.getElementById("members-ranking-title");
  if (membersTitleEl) {
    // Temporarily swap the id so the shared function writes to the right element
    const rankingTitleEl = document.getElementById("ranking-title");
    if (rankingTitleEl) rankingTitleEl.id = "_ranking-title-backup";
    membersTitleEl.id = "ranking-title";
    await renderGroupParticipantsRankingTable();
    membersTitleEl.id = "members-ranking-title";
    if (rankingTitleEl) rankingTitleEl.id = "ranking-title";
  } else {
    await renderGroupParticipantsRankingTable();
  }

  // The 計畫統計 admin section shows every org unit within the admin's
  // permission scope at once (大區／牧區／小組 逐層展開), not a single
  // selector-filtered scope, so it doesn't need the members filter's value.
  if (window.currentPlanViewState === PLAN_ROUTE.ORG_STATS) {
    await renderOrgStatsTree();

    // Also update the group stats section visibility
    const groupSec = document.getElementById("stats-group-section");
    if (groupSec) {
      groupSec.classList.remove("hidden");
      groupSec.style.display = "";
    }
  }
}

export {
  populateMembersSelector,
  renderPlanMembersView,
  renderPlanRankingView,
  renderPlanStatsView
};
