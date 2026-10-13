// js/modules/pastoral.js — App 的「管理」分頁（#551）
//
// 牧者、大區長、區長、小組長看自己範圍的組員；系統管理員看全教會（系統管理功能在管理後台）。
// 上方共用「計畫＋範圍」，下面四個分頁：總覽／名單／團隊／測驗。
// 資料：get_pastoral_overview（js/data/pastoral-overview.mjs，範圍由 nlc-data 依登入者決定）；
// 計算：pastoral-metrics.mjs（純函式，落後天數沿用唯一的比對原語）。
import {
  CARE_THRESHOLDS,
  PASTORAL_TABS,
  ROSTER_FILTERS,
  SCOPE_LEVELS,
  SCOPE_LEVEL_LABEL,
  buildPlanContext,
  buildRosterCsv,
  buildScopeOptions,
  buildTeamsCsv,
  careReasonText,
  compareQuizUnits,
  compareUnits,
  countRosterFilters,
  describePeople,
  filterByScope,
  filterRoster,
  normalizeScope,
  pickUnitLevel,
  ratio,
  resolvePastoralTab,
  selectCareList,
  summarizeFunnel,
  summarizeQuiz,
  summarizeTeams,
  teamLabel
} from "./pastoral-metrics.mjs";
import { listManagementPlans, managementPlanKey } from "./management-plans.mjs";
import { fetchPastoralOverview } from "../data/pastoral-overview.mjs";
import { sendBulkPlanInvitations } from "./admin-bulk-plan-invite.mjs";
import { adminConsoleBase } from "../admin-console-link.mjs";

export const MANAGEMENT_ROLES = Object.freeze(["admin", "pastor", "great_zone_leader", "zone_leader", "group_leader"]);
const PLAN_STORAGE_KEY = "pastoral_plan_key";
const CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const ROSTER_PAGE = 60;
const CARE_PREVIEW = 12;
const NAME_PREVIEW = 80;

const view = {
  tab: "overview",
  planKey: "",
  scope: { greatRegion: "", pastoralZone: "", smallGroup: "" },
  rosterFilter: "all",
  rosterQuery: "",
  rosterLimit: ROSTER_PAGE,
  bound: false,
  loadToken: 0,
  invited: new Set()
};
const cache = new Map();
let examStatsLoader = null;
let quizFeatureEnabled = null;

const esc = (value) => (typeof window.escapeHTML === "function"
  ? window.escapeHTML(String(value ?? ""))
  : String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]));
const toast = (message) => { if (typeof window.showToast === "function") window.showToast(message); };
const $ = (id) => document.getElementById(id);
const panel = (tab) => document.querySelector(`[data-pastoral-panel="${tab}"]`);

function roleOf() {
  const user = window.state && window.state.currentUser;
  return (user && typeof window.getUserRoleCode === "function" && window.getUserRoleCode(user)) || "member";
}

export function canUsePastoralView(role = roleOf()) {
  return MANAGEMENT_ROLES.includes(role);
}

// app.js 登記大測驗統計的 lazy loader（exam.js 是 LAZY_MODULE_LOADERS 的一項）
export function registerExamStatsLoader(loader) {
  examStatsLoader = typeof loader === "function" ? loader : null;
}

// 網址 hash 路由（app-hash-routing.mjs）：目前的分頁；總覽是預設，網址就只寫 #/admin
export function getPastoralRouteTab() {
  return view.tab === "overview" ? null : view.tab;
}

export function openPastoralTab(value) {
  const tab = resolvePastoralTab(value);
  if (!tab) return false;
  if (value === "join-status") view.rosterFilter = "not_enrolled";
  setTab(tab);
  return true;
}

function orgComparator(level) {
  const org = window.state && window.state.orgStructure;
  const map = level === "greatRegion" ? org && org.regionSortOrder
    : level === "pastoralZone" ? org && org.zoneSortOrder
      : null;
  if (map && typeof window.compareByOrgDisplayOrder === "function") return window.compareByOrgDisplayOrder(map);
  return null;
}

function managementPlans() {
  const state = window.state || {};
  const globalIds = new Set((state.globalPlans || []).map((plan) => String(plan.id)));
  // 只列教會的計畫（有對應的 global_plans），個人計畫不在管理範圍
  return listManagementPlans({
    activePlans: state.activePlans,
    globalPlans: state.globalPlans,
    generatePlanObject: typeof window.generatePlanObject === "function" ? window.generatePlanObject : null,
    isPlanHidden: typeof window.isPlanHidden === "function" ? window.isPlanHidden : null,
    canManageHiddenPlans: typeof window.canManageHiddenPlans === "function" ? window.canManageHiddenPlans : null
  }).filter((plan) => globalIds.has(String(plan.globalPlanId || plan.id)));
}

function readStoredPlanKey() {
  try { return window.sessionStorage.getItem(PLAN_STORAGE_KEY) || ""; } catch (_err) { return ""; }
}

function storePlanKey(key) {
  try { window.sessionStorage.setItem(PLAN_STORAGE_KEY, key); } catch (_err) { /* 記不住就算了 */ }
}

function selectedPlan(plans) {
  const keys = (plan) => [plan.globalPlanId, plan.id, plan.presetKey, plan.name].filter(Boolean).map(String);
  const wanted = view.planKey || readStoredPlanKey();
  const reference = window.state && window.state.activePlan;
  return plans.find((plan) => wanted && keys(plan).includes(wanted))
    || (reference && plans.find((plan) => keys(plan).some((key) => keys(reference).includes(key))))
    || plans.find((plan) => plan.managementStatus === "ongoing")
    || plans[0]
    || null;
}

function setStatus(text) {
  const el = $("pastoral-status");
  if (el) el.textContent = text || "";
}

function setTab(tab, { announce = true } = {}) {
  if (!PASTORAL_TABS.includes(tab)) return;
  const changed = view.tab !== tab;
  view.tab = tab;
  document.querySelectorAll("[data-pastoral-tab]").forEach((button) => {
    const active = button.dataset.pastoralTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  PASTORAL_TABS.forEach((name) => panel(name)?.classList.toggle("hidden", name !== tab));
  renderActiveTab();
  if (changed && announce) window.dispatchEvent(new Event("app:route-changed"));
}

function bindOnce() {
  if (view.bound) return;
  const root = $("pastoral-root");
  if (!root) return;
  view.bound = true;
  root.querySelectorAll("[data-pastoral-tab]").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.pastoralTab));
  });
  $("pastoral-plan-select")?.addEventListener("change", (event) => {
    view.planKey = event.target.value;
    storePlanKey(view.planKey);
    view.scope = { greatRegion: "", pastoralZone: "", smallGroup: "" };
    view.rosterLimit = ROSTER_PAGE;
    void loadAndRender();
  });
  root.querySelectorAll("[data-pastoral-scope]").forEach((select) => {
    select.addEventListener("change", () => {
      view.scope = { ...view.scope, [select.dataset.pastoralScope]: select.value };
      view.rosterLimit = ROSTER_PAGE;
      renderScopeAndTab();
    });
  });
  $("pastoral-refresh")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await loadAndRender({ force: true });
      toast("資料已更新");
    } finally {
      button.disabled = false;
    }
  });
  // 名單、總覽裡的按鈕都用事件代理，畫面重畫不用重綁
  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-pastoral-action]");
    if (!target || !root.contains(target)) return;
    const action = target.dataset.pastoralAction;
    if (action === "filter") {
      view.rosterFilter = target.dataset.filter || "all";
      view.rosterLimit = ROSTER_PAGE;
      renderRoster();
    } else if (action === "show-care") {
      view.rosterFilter = "care";
      view.rosterLimit = ROSTER_PAGE;
      setTab("roster");
    } else if (action === "drill") {
      drillInto(target.dataset.level, target.dataset.unit);
    } else if (action === "more") {
      view.rosterLimit += ROSTER_PAGE;
      renderRosterList();
    } else if (action === "invite") {
      void inviteOne(target);
    } else if (action === "invite-all") {
      void inviteAll(target);
    } else if (action === "export-roster") {
      exportRoster();
    } else if (action === "export-teams") {
      exportTeams();
    }
  });
  root.addEventListener("input", (event) => {
    if (!event.target.matches("[data-pastoral-search]")) return;
    view.rosterQuery = event.target.value;
    view.rosterLimit = ROSTER_PAGE;
    renderRosterList();
  });
}

export function init() {
  bindOnce();
}

// ── 資料 ────────────────────────────────────────────────────────────────

function currentEntry() {
  return cache.get(view.planKey) || null;
}

function scopedPeople() {
  const entry = currentEntry();
  return entry ? filterByScope(entry.people, view.scope) : [];
}

async function loadAndRender({ force = false } = {}) {
  const plans = managementPlans();
  const plan = selectedPlan(plans);
  renderPlanSelect(plans, plan);
  if (!plan) {
    setStatus("");
    renderEmptyAll("目前沒有可管理的計畫。");
    return;
  }
  view.planKey = managementPlanKey(plan);
  const cached = cache.get(view.planKey);
  if (!force && cached && Date.now() - cached.loadedAt < CACHE_MAX_AGE_MS) {
    renderScopeAndTab();
    return;
  }
  const token = ++view.loadToken;
  setStatus("載入中…");
  if (!cached) renderEmptyAll("載入中…");
  const result = await fetchPastoralOverview(window.state && window.state.supabase, plan);
  if (token !== view.loadToken) return;
  if (result.error) {
    console.warn("[Pastoral] overview failed:", result.error);
    setStatus("");
    if (!cached) renderEmptyAll("統計暫時載入不了，請稍後按「更新」再試一次。");
    else toast("更新失敗，先顯示上一次的資料。");
    return;
  }
  const ctx = buildPlanContext({
    plan,
    baselineDays: typeof window.getCanonicalStageScheduleDays === "function" ? window.getCanonicalStageScheduleDays(plan) : (plan.days || []),
    bibleBooks: window.BIBLE_BOOKS || [],
    today: result.today
  });
  cache.set(view.planKey, { plan, ctx, people: describePeople(result.people, ctx), loadedAt: Date.now() });
  renderScopeAndTab();
}

// ── 上方：計畫、範圍 ────────────────────────────────────────────────────

function renderPlanSelect(plans, plan) {
  const select = $("pastoral-plan-select");
  if (!select) return;
  select.innerHTML = plans.length
    ? plans.map((item) => {
      const key = managementPlanKey(item);
      const label = `${item.name || "未命名計畫"}${item.managementStatus === "upcoming" ? "（提前報名）" : ""}`;
      return `<option value="${esc(key)}"${plan && key === managementPlanKey(plan) ? " selected" : ""}>${esc(label)}</option>`;
    }).join("")
    : '<option value="">目前沒有可管理的計畫</option>';
  select.disabled = plans.length === 0;
}

function renderScopeSelects() {
  const entry = currentEntry();
  const optionsFor = buildScopeOptions(entry ? entry.people : [], { compare: orgComparator });
  view.scope = normalizeScope(view.scope, optionsFor);
  const options = optionsFor(view.scope);
  for (const level of SCOPE_LEVELS) {
    const select = document.querySelector(`[data-pastoral-scope="${level}"]`);
    if (!select) continue;
    const values = options[level];
    // 標籤已經寫了大區／牧區／小組，選項只寫「全部」，手機三欄並排時才放得下
    select.innerHTML = ['<option value="">全部</option>']
      .concat(values.map((value) => `<option value="${esc(value)}"${value === view.scope[level] ? " selected" : ""}>${esc(value)}</option>`))
      .join("");
    // 只有一個選項的層級（例如小組長只管一個小組）就不用選
    select.closest(".pastoral__field")?.classList.toggle("hidden", values.length <= 1);
  }
}

function drillInto(level, unit) {
  if (!SCOPE_LEVELS.includes(level) || !unit) return;
  view.scope = { ...view.scope, [level]: unit };
  const index = SCOPE_LEVELS.indexOf(level);
  SCOPE_LEVELS.slice(index + 1).forEach((lower) => { view.scope[lower] = ""; });
  view.rosterLimit = ROSTER_PAGE;
  renderScopeAndTab();
}

function renderScopeAndTab() {
  renderScopeSelects();
  const entry = currentEntry();
  if (entry) {
    const time = new Date(entry.loadedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
    setStatus(`範圍內 ${scopedPeople().length} 人・資料時間 ${time}`);
  }
  renderActiveTab();
}

function renderEmptyAll(message) {
  PASTORAL_TABS.forEach((tab) => {
    const el = panel(tab);
    if (el) el.innerHTML = `<p class="pastoral-empty">${esc(message)}</p>`;
  });
}

function renderActiveTab() {
  if (!currentEntry()) return;
  if (view.tab === "overview") renderOverview();
  else if (view.tab === "roster") renderRoster();
  else if (view.tab === "teams") renderTeams();
  else if (view.tab === "quizzes") void renderQuizzes();
  if (typeof window.hydrateIcons === "function") window.hydrateIcons($("pastoral-root"));
}

// ── 總覽 ────────────────────────────────────────────────────────────────

function funnelRow(label, value, whole) {
  const pct = ratio(value, whole);
  return `<li class="pastoral-funnel__row">
    <span class="pastoral-funnel__label">${esc(label)}</span>
    <span class="pastoral-bar" aria-hidden="true"><span class="pastoral-bar__fill" data-width="${pct}"></span></span>
    <span class="pastoral-funnel__value">${value}<small>${pct}%</small></span>
  </li>`;
}

// 長條寬度用 CSSOM 設，不寫行內 style 屬性
function paintBars(root) {
  root?.querySelectorAll(".pastoral-bar__fill[data-width]").forEach((bar) => {
    bar.style.width = `${Math.max(0, Math.min(100, Number(bar.dataset.width) || 0))}%`;
  });
}

function orgLine(person) {
  return [person.greatRegion, person.pastoralZone, person.smallGroup].filter(Boolean).join("・") || "未設定小組";
}

function renderOverview() {
  const el = panel("overview");
  const entry = currentEntry();
  if (!el || !entry) return;
  const people = scopedPeople();
  if (!people.length) {
    el.innerHTML = '<p class="pastoral-empty">這個範圍內沒有人。</p>';
    return;
  }
  const funnel = summarizeFunnel(people);
  const care = selectCareList(people);
  const level = pickUnitLevel(people);
  const units = compareUnits(people, level, { compare: orgComparator });
  const notStarted = !entry.ctx.started;
  el.innerHTML = `
    <section class="pastoral-card" aria-labelledby="pastoral-funnel-title">
      <div class="pastoral-card__head">
        <h3 class="pastoral-card__title" id="pastoral-funnel-title">進度</h3>
        <p class="pastoral-card__hint">${notStarted ? "計畫還沒開始，先看報名。" : "比例都以範圍內人數為分母；跟上進度含今天還沒讀完的人。"}</p>
      </div>
      <ol class="pastoral-funnel">
        ${funnelRow("範圍內", funnel.inScope, funnel.inScope)}
        ${funnelRow("已報名", funnel.enrolled, funnel.inScope)}
        ${funnelRow("近 7 天有讀", funnel.active7, funnel.inScope)}
        ${funnelRow("跟上進度", funnel.onTrack, funnel.inScope)}
        ${funnelRow("讀完一遍", funnel.completedOnce, funnel.inScope)}
      </ol>
    </section>
    <section class="pastoral-card" aria-labelledby="pastoral-care-title">
      <div class="pastoral-card__head">
        <h3 class="pastoral-card__title" id="pastoral-care-title">需要關心（${care.length} 人）</h3>
        <p class="pastoral-card__hint">已報名、還在第一遍，${CARE_THRESHOLDS.noCheckInDays} 天以上沒打卡或落後 ${CARE_THRESHOLDS.behindDays} 天以上。</p>
      </div>
      ${care.length ? `<ul class="pastoral-care">
        ${care.slice(0, CARE_PREVIEW).map((person) => `<li class="pastoral-care__item">
          <span><span class="pastoral-care__name">${esc(person.name)}</span>
            <span class="pastoral-care__org">${esc(orgLine(person))}</span></span>
          <span class="pastoral-badge pastoral-badge--danger">${esc(person.careReasons.map(careReasonText).join("、"))}</span>
        </li>`).join("")}
      </ul>
      <div class="pastoral-care__more pastoral-toolbar-row">
        <button type="button" class="secondary-btn" data-pastoral-action="show-care">在名單看全部</button>
      </div>` : '<p class="pastoral-empty">目前沒有需要關心的人。</p>'}
    </section>
    ${level ? `<section class="pastoral-card" aria-labelledby="pastoral-units-title">
      <div class="pastoral-card__head">
        <h3 class="pastoral-card__title" id="pastoral-units-title">各${SCOPE_LEVEL_LABEL[level]}比較</h3>
        <p class="pastoral-card__hint">點名稱只看那一個${SCOPE_LEVEL_LABEL[level]}。</p>
      </div>
      <div class="pastoral-table-wrap">
        <table class="pastoral-table">
          <thead><tr><th scope="col">${SCOPE_LEVEL_LABEL[level]}</th><th scope="col">人數</th><th scope="col">報名</th><th scope="col">近 7 天有讀</th><th scope="col">跟上進度</th><th scope="col">讀完一遍</th><th scope="col">需要關心</th></tr></thead>
          <tbody>${units.map((unit) => `<tr>
            <td><button type="button" class="pastoral-table__unit" data-pastoral-action="drill" data-level="${level}" data-unit="${esc(unit.name)}">${esc(unit.name)}</button></td>
            <td>${unit.inScope}</td>
            <td>${ratio(unit.enrolled, unit.inScope)}%</td>
            <td>${ratio(unit.active7, unit.inScope)}%</td>
            <td>${ratio(unit.onTrack, unit.inScope)}%</td>
            <td>${unit.completedOnce}</td>
            <td>${unit.care}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </section>` : ""}`;
  paintBars(el);
}

// ── 名單 ────────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  not_enrolled: "",
  not_started: "pastoral-badge--warning",
  today_pending: "pastoral-badge--brand",
  on_track: "pastoral-badge--brand",
  ahead: "pastoral-badge--ok",
  first_round_done: "pastoral-badge--ok",
  later_round: "pastoral-badge--ok",
  behind: "pastoral-badge--danger"
};

function lastReadText(person) {
  if (!person.lastReadKey) return "還沒有打卡";
  if (person.daysSinceRead === 0) return `今天（${person.lastReadKey}）`;
  if (person.daysSinceRead === 1) return `昨天（${person.lastReadKey}）`;
  return `${person.daysSinceRead} 天前（${person.lastReadKey}）`;
}

function personCard(person, { showQuiz }) {
  const facts = [];
  if (person.enrolled) {
    facts.push(["進度", `第 ${person.round} 遍 ${person.progress}%・已讀 ${person.chapters} 章`]);
    facts.push(["最後打卡", lastReadText(person)]);
    facts.push(["近 7 天", `${person.readDays7} 天有讀`]);
    facts.push(["團隊", person.teams.length ? person.teams.map(teamLabel).join("、") : "未組隊"]);
    if (showQuiz && person.quiz.published > 0) facts.push(["小測驗", `作答 ${person.quiz.submitted}／${person.quiz.published} 次`]);
    if (person.care) facts.push(["需要關心", person.careReasons.map(careReasonText).join("、")]);
  }
  const invited = view.invited.has(person.id);
  return `<li class="pastoral-person">
    <div class="pastoral-person__head">
      <div>
        <p class="pastoral-person__name">${esc(person.name)}</p>
        <p class="pastoral-person__org">${esc(orgLine(person))}</p>
      </div>
      <span class="pastoral-badge ${STATUS_BADGE[person.status] || ""}">${esc(person.statusLabel)}</span>
    </div>
    ${facts.length ? `<dl class="pastoral-person__facts">${facts.map(([term, value]) => `<dt>${esc(term)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>` : ""}
    ${person.enrolled ? "" : `<div class="pastoral-person__actions">
      <button type="button" class="secondary-btn" data-pastoral-action="invite" data-person="${esc(person.id)}"${invited ? " disabled" : ""}>${invited ? "已提醒" : "提醒加入"}</button>
    </div>`}
  </li>`;
}

function renderRoster() {
  const el = panel("roster");
  if (!el || !currentEntry()) return;
  const people = scopedPeople();
  const counts = countRosterFilters(people);
  el.innerHTML = `
    <section class="pastoral-card pastoral-roster">
      <div class="pastoral-roster__controls">
        <div class="pastoral-chips" role="group" aria-label="篩選">
          ${ROSTER_FILTERS.map((item) => `<button type="button" class="pastoral-chip" data-pastoral-action="filter" data-filter="${item.id}" aria-pressed="${item.id === view.rosterFilter}">${esc(item.label)} ${counts[item.id]}</button>`).join("")}
        </div>
        <div class="pastoral-roster__search">
          <input type="search" class="form-control" data-pastoral-search placeholder="搜尋姓名" aria-label="搜尋姓名" value="${esc(view.rosterQuery)}">
          ${view.rosterFilter === "not_enrolled" && counts.not_enrolled ? '<button type="button" class="secondary-btn" data-pastoral-action="invite-all">全部提醒加入</button>' : ""}
          <button type="button" class="secondary-btn" data-pastoral-action="export-roster">
            <span class="nlc-icon nlc-icon--sm" data-icon="download" aria-hidden="true"></span><span>匯出 CSV</span>
          </button>
        </div>
      </div>
    </section>
    <div data-pastoral-roster-list></div>`;
  renderRosterList();
}

function rosterRows() {
  return filterRoster(scopedPeople(), { filter: view.rosterFilter, query: view.rosterQuery });
}

function renderRosterList() {
  const host = document.querySelector("[data-pastoral-roster-list]");
  if (!host) return;
  const rows = rosterRows();
  const showQuiz = quizFeatureEnabled !== false;
  host.innerHTML = rows.length
    ? `<ul class="pastoral-people">${rows.slice(0, view.rosterLimit).map((person) => personCard(person, { showQuiz })).join("")}</ul>
      ${rows.length > view.rosterLimit ? `<button type="button" class="secondary-btn pastoral-more" data-pastoral-action="more">顯示更多（還有 ${rows.length - view.rosterLimit} 人）</button>` : ""}`
    : '<p class="pastoral-empty">沒有符合的人。</p>';
}

async function inviteOne(button) {
  const entry = currentEntry();
  const id = button.dataset.person;
  if (!entry || !id || view.invited.has(id) || !window.db) return;
  button.disabled = true;
  const result = await window.db.sendPlanJoinInvitation(entry.plan, id).catch(() => null);
  if (result && result.success) {
    view.invited.add(id);
    button.textContent = "已提醒";
    toast(result.context && (result.context.duplicate === true || result.context.sent === false) ? "今天已經提醒過了" : "已提醒加入");
  } else {
    button.disabled = false;
    toast((result && result.message) || "提醒失敗，請稍後再試。");
  }
}

async function inviteAll(button) {
  const entry = currentEntry();
  if (!entry || !window.db) return;
  const members = rosterRows().filter((person) => !person.enrolled && !view.invited.has(person.id))
    .map((person) => ({ id: person.id, name: person.name }));
  if (!members.length) {
    toast("沒有要提醒的人。");
    return;
  }
  if (!window.confirm(`要提醒 ${members.length} 位還沒報名的人加入「${entry.plan.name || "這個計畫"}」嗎？`)) return;
  button.disabled = true;
  const label = button.textContent;
  try {
    const summary = await sendBulkPlanInvitations({
      members,
      plan: entry.plan,
      sendInvitation: (plan, id) => window.db.sendPlanJoinInvitation(plan, id),
      onProgress: ({ completed, total }) => { button.textContent = `提醒中 ${completed}/${total}`; }
    });
    members.filter((member) => member.remindedToday).forEach((member) => view.invited.add(member.id));
    toast(`已提醒 ${summary.sentCount} 人${summary.duplicateCount ? `，${summary.duplicateCount} 人今天已提醒過` : ""}${summary.failedMembers.length ? `，${summary.failedMembers.length} 人失敗` : ""}`);
  } finally {
    button.textContent = label;
    button.disabled = false;
    renderRosterList();
  }
}

function downloadCsv(text, filename) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportName(kind) {
  const entry = currentEntry();
  const scope = SCOPE_LEVELS.map((level) => view.scope[level]).filter(Boolean).join("-");
  const today = entry ? entry.ctx.todayKey : "";
  return `${kind}-${(entry && entry.plan.name) || "計畫"}${scope ? `-${scope}` : ""}-${today}.csv`.replace(/[\\/:*?"<>|]/g, "_");
}

function exportRoster() {
  downloadCsv(buildRosterCsv(rosterRows()), exportName("名單"));
}

function exportTeams() {
  downloadCsv(buildTeamsCsv(summarizeTeams(scopedPeople())), exportName("團隊"));
}

// ── 團隊 ────────────────────────────────────────────────────────────────

function tile(label, value) {
  return `<div class="pastoral-tile"><span class="pastoral-tile__label">${esc(label)}</span><span class="pastoral-tile__value">${esc(value)}</span></div>`;
}

function teamItem(team) {
  return `<li class="pastoral-team">
    <div class="pastoral-team__head">
      <span class="pastoral-team__name">${esc(team.name || "未命名")}</span>
      <span class="pastoral-badge ${team.full ? "pastoral-badge--ok" : "pastoral-badge--warning"}">${team.division} 人隊・${team.full ? "已滿" : `還缺 ${team.missing} 人`}</span>
    </div>
    <p class="pastoral-team__members">${esc(team.members.map((member) => `${member.name}${member.captain ? "（隊長）" : ""}`).join("、"))}${team.size > team.members.length ? `（另有 ${team.size - team.members.length} 人不在這個範圍）` : ""}</p>
  </li>`;
}

function namesLine(people) {
  const names = people.slice(0, NAME_PREVIEW).map((person) => person.name).join("、");
  return `${esc(names)}${people.length > NAME_PREVIEW ? `…等 ${people.length} 人` : ""}`;
}

function renderTeams() {
  const el = panel("teams");
  if (!el || !currentEntry()) return;
  const summary = summarizeTeams(scopedPeople());
  if (!summary.teams.length && !summary.enrolled) {
    el.innerHTML = '<p class="pastoral-empty">這個範圍內還沒有人報名。</p>';
    return;
  }
  el.innerHTML = `
    <section class="pastoral-card" aria-label="組隊概況">
      <div class="pastoral-tiles">
        ${tile("已報名", summary.enrolled)}
        ${tile("已組隊", `${summary.inAny}（${ratio(summary.inAny, summary.enrolled)}%）`)}
        ${tile("3 人隊成員", summary.in3)}
        ${tile("6 人隊成員", summary.in6)}
        ${tile("還沒組隊", summary.noTeam.length)}
      </div>
    </section>
    <section class="pastoral-card" aria-labelledby="pastoral-open-teams-title">
      <div class="pastoral-card__head">
        <h3 class="pastoral-card__title" id="pastoral-open-teams-title">還沒滿的隊（${summary.openTeams.length}）</h3>
      </div>
      ${summary.openTeams.length ? `<ul class="pastoral-teams">${summary.openTeams.map(teamItem).join("")}</ul>` : '<p class="pastoral-empty">範圍內的隊都滿了。</p>'}
    </section>
    <section class="pastoral-card" aria-labelledby="pastoral-no-team-title">
      <div class="pastoral-card__head">
        <h3 class="pastoral-card__title" id="pastoral-no-team-title">已報名、還沒組隊（${summary.noTeam.length} 人）</h3>
      </div>
      ${summary.noTeam.length ? `<p class="pastoral-names">${namesLine(summary.noTeam)}</p>` : '<p class="pastoral-empty">已報名的人都有隊伍。</p>'}
    </section>
    <section class="pastoral-card" aria-labelledby="pastoral-all-teams-title">
      <div class="pastoral-card__head">
        <h3 class="pastoral-card__title" id="pastoral-all-teams-title">已滿的隊（${summary.teams.length - summary.openTeams.length}）</h3>
        <button type="button" class="secondary-btn" data-pastoral-action="export-teams"${summary.teams.length ? "" : " disabled"}>
          <span class="nlc-icon nlc-icon--sm" data-icon="download" aria-hidden="true"></span><span>匯出 CSV</span>
        </button>
      </div>
      ${summary.teams.length > summary.openTeams.length
        ? `<ul class="pastoral-teams">${summary.teams.filter((team) => team.full).map(teamItem).join("")}</ul>`
        : `<p class="pastoral-empty">${summary.teams.length ? "還沒有滿的隊。" : "這個計畫在範圍內還沒有隊伍。"}</p>`}
    </section>`;
}

// ── 測驗 ────────────────────────────────────────────────────────────────

async function ensureQuizFeature() {
  if (quizFeatureEnabled !== null || !window.db || typeof window.db.getFeatureSetting !== "function") return quizFeatureEnabled;
  try {
    const result = await window.db.getFeatureSetting("daily_quiz", false);
    quizFeatureEnabled = !result.error && result.enabled === true;
  } catch (_err) {
    quizFeatureEnabled = false;
  }
  return quizFeatureEnabled;
}

async function renderQuizzes() {
  const el = panel("quizzes");
  if (!el || !currentEntry()) return;
  if (!el.querySelector("[data-pastoral-quiz]")) {
    el.innerHTML = `
      <section class="pastoral-card" data-pastoral-quiz aria-labelledby="pastoral-quiz-title">
        <div class="pastoral-card__head"><h3 class="pastoral-card__title" id="pastoral-quiz-title">小測驗</h3></div>
        <div class="pastoral-stack" data-pastoral-quiz-body><p class="pastoral-empty">載入中…</p></div>
      </section>
      <section class="pastoral-card" aria-labelledby="pastoral-exam-title">
        <div class="pastoral-card__head"><h3 class="pastoral-card__title" id="pastoral-exam-title">大測驗</h3></div>
        <div data-pastoral-exam><p class="pastoral-empty">載入中…</p></div>
      </section>`;
    void renderExamStats(el.querySelector("[data-pastoral-exam]"));
  }
  const enabled = await ensureQuizFeature();
  const body = el.querySelector("[data-pastoral-quiz-body]");
  if (!body || view.tab !== "quizzes") return;
  if (!enabled) {
    body.innerHTML = '<p class="pastoral-empty">小測驗目前沒有開放。</p>';
    return;
  }
  const people = scopedPeople();
  const summary = summarizeQuiz(people);
  if (!summary.eligible) {
    body.innerHTML = '<p class="pastoral-empty">這個計畫在範圍內還沒有發過小測驗。</p>';
    return;
  }
  const level = pickUnitLevel(people);
  const units = compareQuizUnits(people, level, { compare: orgComparator });
  body.innerHTML = `
    <p class="pastoral-card__hint">只算已報名、有發題給他的小組；不看分數、不排名。</p>
    <div class="pastoral-tiles">
      ${tile("有發題的人", summary.eligible)}
      ${tile("作答率", `${summary.rate}%`)}
      ${tile("作答過", summary.answeredAny)}
      ${tile("從沒作答", summary.neverAnswered.length)}
    </div>
    ${units.length ? `<div class="pastoral-table-wrap">
      <table class="pastoral-table">
        <thead><tr><th scope="col">${SCOPE_LEVEL_LABEL[level]}</th><th scope="col">有發題的人</th><th scope="col">作答率</th><th scope="col">作答過</th><th scope="col">從沒作答</th></tr></thead>
        <tbody>${units.map((unit) => `<tr><td>${esc(unit.name)}</td><td>${unit.eligible}</td><td>${unit.rate}%</td><td>${unit.answeredAny}</td><td>${unit.neverAnswered.length}</td></tr>`).join("")}</tbody>
      </table>
    </div>` : ""}
    ${summary.neverAnswered.length ? `<p class="pastoral-names">從沒作答：${namesLine(summary.neverAnswered)}</p>` : ""}`;
}

async function renderExamStats(host) {
  if (!host) return;
  if (!examStatsLoader) {
    host.innerHTML = '<p class="pastoral-empty">大測驗統計載入不了。</p>';
    return;
  }
  try {
    const exam = await examStatsLoader();
    await exam.renderExamStatsPanel(host);
  } catch (err) {
    console.warn("[Pastoral] exam stats failed:", err);
    host.innerHTML = '<p class="pastoral-empty">大測驗統計載入不了，請稍後再試。</p>';
  }
}

// ── 進入點 ──────────────────────────────────────────────────────────────

function renderConsoleNote(role) {
  const note = $("pastoral-console-note");
  if (!note) return;
  const isAdmin = role === "admin";
  note.classList.toggle("hidden", !isAdmin);
  const link = $("pastoral-console-link");
  if (isAdmin && link) link.href = `${adminConsoleBase(window.location.hostname)}/`;
}

// app.js 切到管理分頁時呼叫
export async function renderPastoralView({ force = false } = {}) {
  bindOnce();
  const role = roleOf();
  renderConsoleNote(role);
  if (!canUsePastoralView(role)) {
    renderEmptyAll("您目前沒有管理權限。");
    return;
  }
  setTab(view.tab, { announce: false });
  await loadAndRender({ force });
}
