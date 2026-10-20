// js/modules/pastoral.js — App 的「管理」分頁（#551、#570、#584）
//
// 牧者、大區長、區長、小組長看自己範圍的組員；系統管理員看全教會（系統管理功能在管理後台）。
// 上方一行範圍列（點了開全頁選擇：計畫 → 大區 → 牧區 → 小組），下面四個分頁：總覽／名單／團隊／測驗。
// 資料和後台同一套規則（#570），範圍由 nlc-data 依登入者決定（js/data/pastoral-overview.mjs）：
//   · 總覽只拿數字（plan_summary）；換範圍就再問一次。
//   · 名單、團隊、測驗打開才調閱名單（plan_roster，伺服器記稽核）；一次拿齊，之後點人、篩選、換範圍都不再請求。
// 名單一人一列、預設依落後天數排序；篩選是「進度」「最後打卡」兩個條件（同條件內聯集、條件間交集）＋團隊，
// 規則在 supabase/functions/_shared/progress/plan-report.mjs，和後台共用。App 不提供匯出（只在後台，伺服器產生並記稽核）。
//
// 像 App 的部分（#584）：範圍選擇、名單篩選、個人頁都是全頁畫面（index.html 的 pastoral-layers，一開始就在 body 底下），
// 返回鍵一次關一層（app.js 看 body.pastoral-layer-open 呼叫 closePastoralLayer）。沒有「更新」鈕：
// 回到前景自動更新（快取 5 分鐘），範圍列旁的「X 分鐘前更新」點了才手動更新。不做下拉更新。
import {
  CHECKIN_BUCKETS,
  CARE_THRESHOLDS,
  PASTORAL_TABS,
  PROGRESS_BUCKETS,
  ROSTER_SHORTCUT_LABELS,
  ROSTER_SORTS,
  ROSTER_TEAM_OPTIONS,
  SCOPE_LEVELS,
  SCOPE_LEVEL_LABEL,
  UNSET_UNIT_LABEL,
  careReasonText,
  clearRosterCondition,
  compareQuizUnits,
  countRosterConditions,
  defaultRosterFilters,
  drillRosterFilters,
  filterByScope,
  filterPlanRoster,
  pickUnitLevel,
  presetRosterFilters,
  ratio,
  resolvePastoralTab,
  rosterConditionChips,
  rosterPerson,
  sortPlanRoster,
  summarizeQuiz,
  summarizeTeams,
  teamLabel
} from "./pastoral-metrics.mjs";
import { listManagementPlans, managementPlanKey } from "./management-plans.mjs";
import { fetchPlanRoster, fetchPlanSummary } from "../data/pastoral-overview.mjs";
import { sendBulkPlanInvitations } from "./admin-bulk-plan-invite.mjs";
import { adminConsoleBase } from "../admin-console-link.mjs";

export const MANAGEMENT_ROLES = Object.freeze(["admin", "pastor", "great_zone_leader", "zone_leader", "group_leader"]);
const PLAN_STORAGE_KEY = "pastoral_plan_key";
const CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const UPDATED_TICK_MS = 30 * 1000;
const ROSTER_PAGE = 60;
const NAME_PREVIEW = 80;
const ROSTER_TABS = Object.freeze(["roster", "teams", "quizzes"]);
const LAYERS = Object.freeze({ scope: "pastoral-scope-sheet", filters: "pastoral-filter-sheet", person: "pastoral-person-sheet" });
// 各單位比較：一次比一個指標（#584），分母都是範圍內人數
const UNIT_METRICS = Object.freeze([
  { id: "enrolled", label: "報名" },
  { id: "active7", label: "近 7 天有讀" },
  { id: "onTrack", label: "跟上進度" }
]);

const emptyScope = () => ({ greatRegion: "", pastoralZone: "", smallGroup: "" });

const view = {
  tab: "overview",
  planKey: "",
  scope: emptyScope(),
  filters: defaultRosterFilters(),
  sort: "behind",
  unitMetric: "",
  rosterLimit: ROSTER_PAGE,
  bound: false,
  loadToken: 0,
  refreshing: false,
  invited: new Set(),
  // 全頁畫面：目前開著哪一層、關掉時回到哪（捲動位置、焦點）
  layer: "",
  layerReturn: null,
  scopeSteps: [],
  scopeBusy: false,
  personId: ""
};
let currentPlan = null;
let planList = [];
// 總覽：計畫＋範圍 → { data, loadedAt, inconsistent }；名單：計畫 → { people, loadedAt, inconsistent }
const summaries = new Map();
const rosters = new Map();
const rosterLoading = new Map();
let examStatsLoader = null;
let quizFeatureEnabled = null;

const esc = (value) => (typeof window.escapeHTML === "function"
  ? window.escapeHTML(String(value ?? ""))
  : String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]));
const toast = (message) => { if (typeof window.showToast === "function") window.showToast(message); };
const $ = (id) => document.getElementById(id);
const panel = (tab) => document.querySelector(`[data-pastoral-panel="${tab}"]`);
const client = () => window.state && window.state.supabase;
const fresh = (entry) => Boolean(entry) && !entry.inconsistent && Date.now() - entry.loadedAt < CACHE_MAX_AGE_MS;
const hydrate = (root) => { if (root && typeof window.hydrateIcons === "function") window.hydrateIcons(root); };
const scroller = () => document.querySelector(".main-content");

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
  if (value === "join-status") view.filters = { ...defaultRosterFilters(), progress: ["not_enrolled"] };
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

// 伺服器照字排；畫面照教會的大區／牧區順序（未設定排最後）
function sortByOrg(items, level, nameOf = (item) => item) {
  const comparator = orgComparator(level);
  if (!comparator) return items;
  return [...items].sort((a, b) => {
    const x = nameOf(a);
    const y = nameOf(b);
    if (x === UNSET_UNIT_LABEL || y === UNSET_UNIT_LABEL) return x === y ? 0 : x === UNSET_UNIT_LABEL ? 1 : -1;
    return comparator(x, y);
  });
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

function setFilters(next) {
  view.filters = next;
  view.rosterLimit = ROSTER_PAGE;
  renderRoster();
}

// 捷徑（需要關心、近 7 天有讀）時點任何一格：回到一般篩選，只勾這一格（同後台）
function toggleBucket(key, id) {
  const { filters } = view;
  if (filters.shortcut) {
    setFilters({ ...defaultRosterFilters(), team: filters.team, q: filters.q, [key]: [id] });
    return;
  }
  const current = filters[key];
  setFilters({ ...filters, [key]: current.includes(id) ? current.filter((item) => item !== id) : [...current, id] });
}

// 名單上方固定的「需要關心」：沒開就打開（只留搜尋字），開著再點就回到報名者
function toggleCareShortcut() {
  const on = view.filters.shortcut === "care";
  setFilters({ ...(on ? defaultRosterFilters() : presetRosterFilters("care")), q: view.filters.q });
}

// 名單、總覽、全頁畫面裡的按鈕都用事件代理，畫面重畫不用重綁
function onAction(event) {
  const target = event.target.closest("[data-pastoral-action]");
  if (!target || !event.currentTarget.contains(target)) return;
  const action = target.dataset.pastoralAction;
  if (action === "drill-roster") {
    view.filters = drillRosterFilters(target.dataset.drill);
    view.rosterLimit = ROSTER_PAGE;
    setTab("roster");
  } else if (action === "drill") {
    void applyScope(target.dataset.level, target.dataset.unit);
  } else if (action === "unit-metric") {
    view.unitMetric = target.dataset.metric;
    renderOverview();
  } else if (action === "care-shortcut") {
    toggleCareShortcut();
  } else if (action === "clear-condition") {
    setFilters(clearRosterCondition(view.filters, target.dataset.condition));
  } else if (action === "bucket") {
    toggleBucket(target.dataset.key, target.dataset.id);
  } else if (action === "team") {
    setFilters({ ...view.filters, team: target.dataset.team });
  } else if (action === "sort") {
    view.sort = target.dataset.sort;
    view.rosterLimit = ROSTER_PAGE;
    renderRoster();
  } else if (action === "reset-filters") {
    setFilters({ ...defaultRosterFilters(), q: view.filters.q });
  } else if (action === "more") {
    view.rosterLimit += ROSTER_PAGE;
    renderRosterList();
  } else if (action === "open-person") {
    openPerson(target.dataset.person, target);
  } else if (action === "open-filters") {
    openLayer("filters", target);
    renderFilterSheet();
  } else if (action === "open-scope") {
    openScope(target);
  } else if (action === "pick-plan") {
    void pickPlan(target.dataset.plan);
  } else if (action === "pick-scope") {
    void pickScope(target.dataset.level, target.dataset.unit);
  } else if (action === "layer-back") {
    closePastoralLayer();
  } else if (action === "refresh") {
    void manualRefresh();
  } else if (action === "invite") {
    void inviteOne(target);
  } else if (action === "invite-all") {
    void inviteAll(target);
  } else if (action === "care") {
    openCare(target.dataset.person);
  }
}

function bindOnce() {
  if (view.bound) return;
  const root = $("pastoral-root");
  if (!root) return;
  view.bound = true;
  root.querySelectorAll("[data-pastoral-tab]").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.pastoralTab));
  });
  root.addEventListener("click", onAction);
  $("pastoral-layers")?.addEventListener("click", onAction);
  root.addEventListener("input", (event) => {
    if (!event.target.matches("[data-pastoral-search]")) return;
    view.filters = { ...view.filters, q: event.target.value };
    view.rosterLimit = ROSTER_PAGE;
    renderRosterList();
  });
  // 桌機鍵盤：Esc 和返回鍵一樣，一次關一層
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && view.layer && !$("care-reminder-dialog-overlay")) {
      event.preventDefault();
      closePastoralLayer();
    }
  });
  // 「X 分鐘前更新」跟著時間走
  window.setInterval(() => { if (!document.hidden) renderUpdated(); }, UPDATED_TICK_MS);
}

export function init() {
  bindOnce();
}

// ── 全頁畫面（範圍選擇、篩選、個人頁）──────────────────────────────────
// 打開時記下名單的捲動位置與焦點，關掉時放回去；底下的畫面不動，所以條件、展開的頁數都還在。

function layerEl(name) {
  return $(LAYERS[name]);
}

function openLayer(name, opener) {
  const el = layerEl(name);
  if (!el) return;
  if (view.layer && view.layer !== name) layerEl(view.layer)?.classList.add("hidden");
  if (!view.layer) {
    const sc = scroller();
    view.layerReturn = { scrollTop: sc ? sc.scrollTop : 0, focus: opener || null };
  }
  view.layer = name;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");
  document.body.classList.add("pastoral-layer-open");
  hydrate(el);
  el.querySelector(".pastoral-sheet__body")?.scrollTo?.(0, 0);
  el.querySelector(".pastoral-sheet__back")?.focus({ preventScroll: true });
}

function closeLayer({ restore = true } = {}) {
  const name = view.layer;
  if (!name) return;
  const el = layerEl(name);
  el?.classList.add("hidden");
  el?.setAttribute("aria-hidden", "true");
  view.layer = "";
  view.scopeSteps = [];
  view.personId = "";
  document.body.classList.remove("pastoral-layer-open");
  const back = view.layerReturn;
  view.layerReturn = null;
  if (!restore || !back) return;
  const sc = scroller();
  // .main-content 是 scroll-behavior: smooth；放回原位要直接跳，不要看到它捲回去
  if (sc && typeof sc.scrollTo === "function") sc.scrollTo({ top: back.scrollTop, behavior: "instant" });
  else if (sc) sc.scrollTop = back.scrollTop;
  if (back.focus && back.focus.isConnected && typeof back.focus.focus === "function") back.focus.focus({ preventScroll: true });
}

/** 返回鍵／返回按鈕：一次退一層（範圍選擇先退回上一步）。沒有開著的層回 false。 */
export function closePastoralLayer() {
  if (!view.layer) return false;
  if (view.layer === "scope" && view.scopeSteps.length > 1 && !view.scopeBusy) {
    view.scopeSteps.pop();
    renderScopeSheet();
    return true;
  }
  closeLayer();
  return true;
}

/** 離開管理分頁時全部收起（不還原捲動，別的分頁用同一個捲動區） */
export function closePastoralLayers() {
  closeLayer({ restore: false });
}

// ── 資料 ────────────────────────────────────────────────────────────────

const summaryKey = () => `${view.planKey}\n${SCOPE_LEVELS.map((level) => view.scope[level] || "").join("\n")}`;
const currentSummary = () => summaries.get(summaryKey()) || null;
const currentRoster = () => rosters.get(view.planKey) || null;

function scopedRoster() {
  const entry = currentRoster();
  return entry ? filterByScope(entry.people, view.scope) : [];
}

async function loadAndRender({ force = false } = {}) {
  planList = managementPlans();
  const plan = selectedPlan(planList);
  if (!plan) {
    currentPlan = null;
    setStatus("");
    renderScopeBar();
    renderEmptyAll("目前沒有可管理的計畫。");
    return;
  }
  view.planKey = managementPlanKey(plan);
  currentPlan = plan;
  if (force) {
    // 名單也重拿：正在看名單就馬上拿，否則下次打開才拿
    if (ROSTER_TABS.includes(view.tab)) void ensureRoster({ force: true });
    else rosters.delete(view.planKey);
  } else if (ROSTER_TABS.includes(view.tab) && currentRoster() && !fresh(currentRoster())) {
    void ensureRoster({ force: true });
  }
  await refreshSummary({ force });
}

async function refreshSummary({ force = false } = {}) {
  const plan = currentPlan;
  if (!plan) return;
  const cached = currentSummary();
  if (!force && fresh(cached)) {
    renderScopeAndTab();
    return;
  }
  const token = ++view.loadToken;
  setStatus("載入中…");
  renderScopeBar();
  if (!cached && !summaries.size) renderEmptyAll("載入中…");
  const result = await fetchPlanSummary(client(), plan, view.scope);
  if (token !== view.loadToken) return;
  if (result.error) {
    console.warn("[Pastoral] summary failed:", result.error);
    setStatus("");
    if (!cached) renderPanelMessage("overview", "統計暫時載入不了，請稍後點上方的更新時間再試一次。");
    else toast("更新失敗，先顯示上一次的資料。");
    renderScopeBar();
    if (!cached && view.tab === "overview") return;
    renderScopeAndTab();
    return;
  }
  // 範圍以伺服器整理過的為準（例如換了大區，原本的牧區不在裡面就清掉）
  view.scope = { ...emptyScope(), ...(result.data.scope || {}) };
  summaries.set(summaryKey(), { data: result.data, loadedAt: Date.now(), inconsistent: result.inconsistent });
  renderScopeAndTab();
}

async function ensureRoster({ force = false } = {}) {
  const plan = currentPlan;
  const planKey = view.planKey;
  if (!plan) return;
  if (!force && fresh(rosters.get(planKey))) return;
  if (rosterLoading.has(planKey)) return rosterLoading.get(planKey);
  if (!rosters.has(planKey) && ROSTER_TABS.includes(view.tab)) renderPanelMessage(view.tab, "載入名單中…");
  const loading = (async () => {
    const result = await fetchPlanRoster(client(), plan);
    if (result.error) {
      console.warn("[Pastoral] roster failed:", result.error);
      if (planKey !== view.planKey || !ROSTER_TABS.includes(view.tab)) return;
      if (rosters.has(planKey)) toast("名單更新失敗，先顯示上一次的資料。");
      else renderPanelMessage(view.tab, "名單暫時載入不了，請稍後點上方的更新時間再試一次。");
      return;
    }
    rosters.set(planKey, {
      people: result.data.people.map(rosterPerson),
      loadedAt: Date.now(),
      inconsistent: result.inconsistent
    });
    if (planKey === view.planKey && ROSTER_TABS.includes(view.tab)) renderActiveTab();
  })().finally(() => rosterLoading.delete(planKey));
  rosterLoading.set(planKey, loading);
  return loading;
}

async function manualRefresh() {
  if (view.refreshing || !currentPlan) return;
  view.refreshing = true;
  renderUpdated();
  try {
    await loadAndRender({ force: true });
    toast("資料已更新");
  } finally {
    view.refreshing = false;
    renderUpdated();
  }
}

/** app.js 回到前景時呼叫：只有超過 5 分鐘的資料才重拿 */
export async function refreshPastoralOnForeground() {
  if (!view.bound || !canUsePastoralView()) return;
  await loadAndRender();
}

// ── 上方：範圍列 ────────────────────────────────────────────────────────

function scopeOptions() {
  const summary = currentSummary();
  return (summary && summary.data.scopeOptions) || {};
}

// 可以選的層級：有兩個以上單位才需要選（例如小組長只管一個小組就跳過）
function choosableLevels(after = "") {
  const options = scopeOptions();
  const start = after ? SCOPE_LEVELS.indexOf(after) + 1 : 0;
  return SCOPE_LEVELS.slice(start).filter((level) => Array.isArray(options[level]) && options[level].length > 1);
}

// 「2026 Q4 速讀 · 全部牧區」：選了單位寫最小那一層；沒選就寫可選的最上層「全部○○」
function scopeUnitLabel() {
  const chosen = [...SCOPE_LEVELS].reverse().find((level) => view.scope[level]);
  if (chosen) return view.scope[chosen];
  if (!currentSummary()) return "";
  const options = scopeOptions();
  const level = choosableLevels()[0];
  if (level) return `全部${SCOPE_LEVEL_LABEL[level]}`;
  const single = [...SCOPE_LEVELS].reverse().find((item) => (options[item] || []).length === 1);
  return single ? options[single][0] : "";
}

function scopeLabel() {
  if (!currentPlan) return planList.length ? "載入中…" : "目前沒有可管理的計畫";
  return [currentPlan.name || "未命名計畫", scopeUnitLabel()].filter(Boolean).join(" · ");
}

function updatedText() {
  if (view.refreshing) return "更新中…";
  const summary = currentSummary();
  if (!summary) return "";
  const minutes = Math.floor((Date.now() - summary.loadedAt) / 60000);
  if (minutes < 1) return "剛剛更新";
  if (minutes < 60) return `${minutes} 分鐘前更新`;
  const time = new Date(summary.loadedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${time} 更新`;
}

function renderUpdated() {
  const el = $("pastoral-refresh");
  if (!el) return;
  const text = updatedText();
  el.textContent = text;
  el.title = "點一下重新整理";
  el.disabled = view.refreshing;
  el.classList.toggle("hidden", !text);
}

function renderScopeBar() {
  const label = $("pastoral-scope-label");
  if (label) label.textContent = scopeLabel();
  const button = $("pastoral-scope-button");
  if (button) button.disabled = !currentPlan;
  renderUpdated();
}

function applyScope(level, unit) {
  if (!SCOPE_LEVELS.includes(level)) return Promise.resolve();
  view.scope = { ...view.scope, [level]: unit || "" };
  SCOPE_LEVELS.slice(SCOPE_LEVELS.indexOf(level) + 1).forEach((lower) => { view.scope[lower] = ""; });
  view.rosterLimit = ROSTER_PAGE;
  return refreshSummary();
}

function renderScopeAndTab() {
  renderScopeBar();
  const summary = currentSummary();
  if (summary) {
    const warning = summary.inconsistent ? "・人數對帳不一致，請點上方的更新時間重新整理" : "";
    setStatus(`範圍內 ${summary.data.funnel.inScope} 人${warning}`);
  }
  if (view.layer === "scope") renderScopeSheet();
  renderActiveTab();
}

// 範圍選擇（全頁）：先選計畫，再一層一層點大區 → 牧區 → 小組；每點一下就換範圍，下一層的單位依新範圍列出
function openScope(opener) {
  if (!currentPlan) return;
  const first = planList.length > 1 ? "plan" : choosableLevels()[0];
  if (!first) {
    toast("你負責的範圍只有這一個。");
    return;
  }
  view.scopeSteps = [first];
  openLayer("scope", opener);
  renderScopeSheet();
}

function pickItem({ action, attrs, label, note = "", on }) {
  return `<li><button type="button" class="pastoral-pick" data-pastoral-action="${action}" ${attrs}${on ? ' aria-current="true"' : ""}>
    <span class="pastoral-pick__label">${esc(label)}${note ? `<small>${esc(note)}</small>` : ""}</span>
    <span class="nlc-icon nlc-icon--sm pastoral-pick__mark" data-icon="${on ? "check" : "chevronRight"}" aria-hidden="true"></span>
  </button></li>`;
}

function renderScopeSheet() {
  const host = document.querySelector("[data-pastoral-scope-body]");
  const step = view.scopeSteps[view.scopeSteps.length - 1];
  if (!host || !step) return;
  const title = $("pastoral-scope-sheet-title");
  if (title) title.textContent = step === "plan" ? "選擇計畫" : `選擇${SCOPE_LEVEL_LABEL[step]}`;
  if (view.scopeBusy) {
    host.innerHTML = '<p class="pastoral-empty">載入中…</p>';
    return;
  }
  let items;
  if (step === "plan") {
    items = planList.map((plan) => {
      const key = managementPlanKey(plan);
      return pickItem({
        action: "pick-plan",
        attrs: `data-plan="${esc(key)}"`,
        label: plan.name || "未命名計畫",
        note: plan.managementStatus === "upcoming" ? "提前報名" : "",
        on: key === view.planKey
      });
    });
  } else {
    const parentLevel = SCOPE_LEVELS.slice(0, SCOPE_LEVELS.indexOf(step)).reverse().find((level) => view.scope[level]);
    const parent = parentLevel ? `${view.scope[parentLevel]} ` : "";
    const options = sortByOrg(Array.isArray(scopeOptions()[step]) ? scopeOptions()[step] : [], step);
    items = [pickItem({ action: "pick-scope", attrs: `data-level="${step}" data-unit=""`, label: `${parent}全部${SCOPE_LEVEL_LABEL[step]}`, on: !view.scope[step] })]
      .concat(options.map((unit) => pickItem({
        action: "pick-scope",
        attrs: `data-level="${step}" data-unit="${esc(unit)}"`,
        label: unit,
        on: view.scope[step] === unit
      })));
  }
  host.innerHTML = `<p class="pastoral-sheet__context">目前：${esc(scopeLabel())}</p><ul class="pastoral-picks">${items.join("")}</ul>`;
  hydrate(host);
}

// 選了一格之後：有下一層可選就往下，沒有就關掉
function nextScopeStep(next) {
  if (view.layer !== "scope") return;
  if (next) {
    view.scopeSteps.push(next);
    renderScopeSheet();
  } else {
    closeLayer();
  }
}

async function pickPlan(key) {
  if (!key || view.scopeBusy) return;
  if (key !== view.planKey) {
    view.planKey = key;
    storePlanKey(key);
    view.scope = emptyScope();
    view.rosterLimit = ROSTER_PAGE;
    view.scopeBusy = true;
    renderScopeSheet();
    try {
      await loadAndRender();
    } finally {
      view.scopeBusy = false;
    }
  }
  nextScopeStep(choosableLevels()[0]);
}

async function pickScope(level, unit) {
  if (view.scopeBusy) return;
  view.scopeBusy = true;
  renderScopeSheet();
  try {
    await applyScope(level, unit);
  } finally {
    view.scopeBusy = false;
  }
  nextScopeStep(unit ? choosableLevels(level)[0] : "");
}

function renderPanelMessage(tab, message) {
  const el = panel(tab);
  if (el) el.innerHTML = `<p class="pastoral-empty">${esc(message)}</p>`;
}

function renderEmptyAll(message) {
  PASTORAL_TABS.forEach((tab) => renderPanelMessage(tab, message));
}

function renderActiveTab() {
  if (!currentPlan) return;
  if (view.tab === "overview") {
    if (currentSummary()) renderOverview();
  } else if (!currentRoster()) {
    void ensureRoster();
    return;
  } else if (view.tab === "roster") renderRoster();
  else if (view.tab === "teams") renderTeams();
  else if (view.tab === "quizzes") void renderQuizzes();
  hydrate($("pastoral-root"));
}

// ── 總覽（只有數字；點數字進名單）──────────────────────────────────────

function funnelRow(drill, label, value, whole) {
  const pct = ratio(value, whole);
  return `<li class="pastoral-funnel__row">
    <button type="button" class="pastoral-funnel__label" data-pastoral-action="drill-roster" data-drill="${drill}">${esc(label)}</button>
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

function segmented(action, field, options, current, label) {
  return `<div class="segment-track pastoral-segmented" role="group" aria-label="${esc(label)}">
    ${options.map((option) => `<button type="button" class="segment-toggle-btn${option.id === current ? " active" : ""}" data-pastoral-action="${action}" data-${field}="${option.id}" aria-pressed="${option.id === current}">${esc(option.label)}</button>`).join("")}
  </div>`;
}

// 一個單位一列（#584）：名稱＋人數、右邊一句提醒、下面一條長條＋百分比。手機不用左右滑。
function unitItem({ name, level = "", size, pct, note, alert }) {
  const label = level
    ? `<button type="button" class="pastoral-unit__name" data-pastoral-action="drill" data-level="${level}" data-unit="${esc(name)}">${esc(name)}</button>`
    : `<span class="pastoral-unit__name">${esc(name)}</span>`;
  return `<li class="pastoral-unit">
    <span class="pastoral-unit__head">${label}<span class="pastoral-unit__size">${esc(size)}</span></span>
    <span class="pastoral-unit__note${alert ? " pastoral-unit__note--alert" : ""}">${esc(note)}</span>
    <span class="pastoral-unit__meter">
      <span class="pastoral-bar" aria-hidden="true"><span class="pastoral-bar__fill" data-width="${pct}"></span></span>
      <span class="pastoral-unit__pct">${pct}%</span>
    </span>
  </li>`;
}

function renderOverview() {
  const el = panel("overview");
  const summary = currentSummary();
  if (!el || !summary) return;
  const { funnel, care, units, schedule } = summary.data;
  if (!funnel.inScope) {
    el.innerHTML = '<p class="pastoral-empty">這個範圍內沒有人。</p>';
    return;
  }
  const level = units && units.level;
  const rows = level ? sortByOrg(units.rows || [], level, (row) => row.name) : [];
  const notStarted = !(schedule && schedule.started);
  const metric = UNIT_METRICS.some((item) => item.id === view.unitMetric) ? view.unitMetric : notStarted ? "enrolled" : "active7";
  el.innerHTML = `
    <section class="pastoral-card" aria-labelledby="pastoral-funnel-title">
      <div class="pastoral-card__head">
        <h3 class="pastoral-card__title" id="pastoral-funnel-title">進度</h3>
        <p class="pastoral-card__hint">${notStarted ? "計畫還沒開始，先看報名。" : "比例都以範圍內人數為分母；跟上進度含今天還沒讀完的人。"}點項目看名單。</p>
      </div>
      <ol class="pastoral-funnel">
        ${funnelRow("inScope", "範圍內", funnel.inScope, funnel.inScope)}
        ${funnelRow("enrolled", "已報名", funnel.enrolled, funnel.inScope)}
        ${funnelRow("active7", "近 7 天有讀", funnel.active7, funnel.inScope)}
        ${funnelRow("onTrack", "跟上進度", funnel.onTrack, funnel.inScope)}
        ${funnelRow("completedOnce", "讀完一遍", funnel.completedOnce, funnel.inScope)}
      </ol>
    </section>
    <section class="pastoral-card" aria-labelledby="pastoral-care-title">
      <div class="pastoral-card__head">
        <h3 class="pastoral-card__title" id="pastoral-care-title">需要關心（${care.total} 人）</h3>
        <p class="pastoral-card__hint">已報名、還在第一遍，${CARE_THRESHOLDS.noCheckInDays} 天以上沒打卡或落後 ${CARE_THRESHOLDS.behindDays} 天以上。</p>
      </div>
      ${care.total ? `<div class="pastoral-chips">
        <button type="button" class="pastoral-chip" data-pastoral-action="drill-roster" data-drill="careBehind">落後 ${CARE_THRESHOLDS.behindDays} 天以上 ${care.behind} 人</button>
        <button type="button" class="pastoral-chip" data-pastoral-action="drill-roster" data-drill="careCheckin">${CARE_THRESHOLDS.noCheckInDays} 天以上沒打卡 ${care.noCheckin + care.neverRead} 人</button>
      </div>
      <div class="pastoral-care__more pastoral-toolbar-row">
        <button type="button" class="secondary-btn" data-pastoral-action="drill-roster" data-drill="care">在名單看這 ${care.total} 人</button>
      </div>` : '<p class="pastoral-empty">目前沒有需要關心的人。</p>'}
    </section>
    ${level && rows.length ? `<section class="pastoral-card" aria-labelledby="pastoral-units-title">
      <div class="pastoral-card__head">
        <h3 class="pastoral-card__title" id="pastoral-units-title">各${SCOPE_LEVEL_LABEL[level]}比較</h3>
        <p class="pastoral-card__hint">點名稱只看那一個${SCOPE_LEVEL_LABEL[level]}。</p>
      </div>
      ${segmented("unit-metric", "metric", UNIT_METRICS, metric, "比較的指標")}
      <ul class="pastoral-units">${rows.map((unit) => unitItem({
        name: unit.name,
        level,
        size: `${unit.inScope} 人`,
        pct: ratio(unit[metric], unit.inScope),
        note: `需要關心 ${unit.care} 人`,
        alert: unit.care > 0
      })).join("")}</ul>
    </section>` : ""}`;
  paintBars(el);
}

// ── 名單（一人一列，點了推進個人頁）──────────────────────────────────────

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

// 名字旁的紅字：最後打卡 3 天以上；報名後還沒開始讀也標（同後台）
function lateText(person) {
  if (!person.enrolled) return "";
  if (person.daysSinceRead !== null && person.daysSinceRead !== undefined && person.daysSinceRead >= CARE_THRESHOLDS.noCheckInDays) return `${person.daysSinceRead} 天沒打卡`;
  if (person.careReasons.some((reason) => reason.type === "never_read")) return "還沒開始讀";
  return "";
}

function rosterRow(person) {
  const late = lateText(person);
  return `<li class="pastoral-row">
    <button type="button" class="pastoral-row__summary" data-pastoral-action="open-person" data-person="${esc(person.id)}" aria-haspopup="dialog">
      <span class="pastoral-row__who">
        <span class="pastoral-row__name">${esc(person.name || "（未填姓名）")}${late ? `<span class="pastoral-row__late">${esc(late)}</span>` : ""}</span>
        <span class="pastoral-row__org">${esc(orgLine(person))}</span>
      </span>
      <span class="pastoral-row__chapters">${person.enrolled ? `${person.chapters} 章` : "—"}</span>
      <span class="pastoral-badge ${STATUS_BADGE[person.status] || ""}">${esc(person.statusLabel)}</span>
      <span class="nlc-icon nlc-icon--sm pastoral-row__chevron" data-icon="chevronRight" aria-hidden="true"></span>
    </button>
  </li>`;
}

function chipGroup(key, buckets, field, people) {
  const { filters } = view;
  return buckets.map((bucket) => {
    const on = !filters.shortcut && filters[key].includes(bucket.id);
    const count = people.filter((person) => person[field] === bucket.id).length;
    return `<button type="button" class="pastoral-chip" data-pastoral-action="bucket" data-key="${key}" data-id="${bucket.id}" aria-pressed="${on}">${esc(bucket.label)} ${count}</button>`;
  }).join("");
}

function renderRoster() {
  const el = panel("roster");
  if (!el || !currentRoster()) return;
  const { filters } = view;
  const count = countRosterConditions(filters);
  const chips = rosterConditionChips(filters);
  el.innerHTML = `
    <div class="pastoral-roster__controls">
      <div class="pastoral-roster__bar">
        <input type="search" class="form-control" data-pastoral-search placeholder="搜尋姓名或單位" aria-label="搜尋姓名或單位" maxlength="50" value="${esc(filters.q)}">
        <button type="button" class="secondary-btn pastoral-roster__filter" data-pastoral-action="open-filters" aria-haspopup="dialog">篩選${count ? `<span class="pastoral-roster__filter-count" aria-label="${count} 個條件">${count}</span>` : ""}</button>
      </div>
      <div class="pastoral-chips pastoral-applied" role="group" aria-label="套用中的條件">
        <button type="button" class="pastoral-chip" data-pastoral-action="care-shortcut" aria-pressed="${filters.shortcut === "care"}">${esc(ROSTER_SHORTCUT_LABELS.care)}</button>
        ${chips.map((chip) => `<button type="button" class="pastoral-chip pastoral-chip--applied" data-pastoral-action="clear-condition" data-condition="${chip.id}" aria-label="拿掉條件：${esc(chip.label)}">
          <span>${esc(chip.label)}</span><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span>
        </button>`).join("")}
      </div>
    </div>
    <div data-pastoral-roster-list></div>`;
  renderRosterList();
  hydrate(el);
  if (view.layer === "filters") renderFilterSheet();
  if (view.layer === "person") renderPersonSheet();
}

function rosterRows() {
  const filters = { ...view.filters, q: String(view.filters.q || "").trim() };
  return sortPlanRoster(filterPlanRoster(scopedRoster(), filters), view.sort);
}

function renderRosterList() {
  const host = document.querySelector("[data-pastoral-roster-list]");
  if (!host) return;
  const rows = rosterRows();
  const onlyUnenrolled = rows.length > 0 && rows.every((person) => !person.enrolled);
  host.innerHTML = `
    <div class="pastoral-toolbar-row pastoral-roster__count">
      <p class="pastoral-card__hint" aria-live="polite">符合 ${rows.length} 人${currentRoster() && currentRoster().inconsistent ? "（人數對帳不一致，請點上方的更新時間重新整理）" : ""}</p>
      ${onlyUnenrolled ? '<button type="button" class="secondary-btn" data-pastoral-action="invite-all">全部提醒加入</button>' : ""}
    </div>
    ${rows.length
    ? `<ul class="pastoral-rows">${rows.slice(0, view.rosterLimit).map(rosterRow).join("")}</ul>
      ${rows.length > view.rosterLimit ? `<button type="button" class="secondary-btn pastoral-more" data-pastoral-action="more">顯示更多（還有 ${rows.length - view.rosterLimit} 人）</button>` : ""}`
    : '<p class="pastoral-empty">沒有符合的人。</p>'}`;
  hydrate(host);
  const done = document.querySelector("[data-pastoral-filter-done]");
  if (done) done.textContent = `顯示 ${rows.length} 人`;
}

// 篩選（全頁）：改了馬上套用到底下的名單，底部按鈕「顯示 N 人」關掉回名單
function renderFilterSheet() {
  const host = document.querySelector("[data-pastoral-filter-body]");
  if (!host || view.layer !== "filters") return;
  const people = scopedRoster();
  const { filters } = view;
  host.innerHTML = `
    ${filters.shortcut ? `<p class="pastoral-card__hint pastoral-filters__note">現在是「${esc(ROSTER_SHORTCUT_LABELS[filters.shortcut] || "捷徑")}」捷徑；點下面任何一格會回到一般篩選。</p>` : ""}
    <div class="pastoral-filters__group">
      <span class="pastoral-filters__label">進度<small>勾幾個＝其中之一</small></span>
      <div class="pastoral-chips">${chipGroup("progress", PROGRESS_BUCKETS, "progressBucket", people)}</div>
    </div>
    <div class="pastoral-filters__group">
      <span class="pastoral-filters__label">最後打卡<small>勾幾個＝其中之一</small></span>
      <div class="pastoral-chips">${chipGroup("checkin", CHECKIN_BUCKETS, "checkinBucket", people)}</div>
    </div>
    <div class="pastoral-filters__group">
      <span class="pastoral-filters__label">團隊</span>
      ${segmented("team", "team", ROSTER_TEAM_OPTIONS, filters.team, "團隊")}
    </div>
    <div class="pastoral-filters__group">
      <span class="pastoral-filters__label">排序</span>
      ${segmented("sort", "sort", ROSTER_SORTS, view.sort, "排序")}
    </div>
    <p class="pastoral-card__hint">不同條件之間是「而且」。</p>`;
  const done = document.querySelector("[data-pastoral-filter-done]");
  if (done) done.textContent = `顯示 ${rosterRows().length} 人`;
}

function findPerson(id) {
  const entry = currentRoster();
  return entry ? entry.people.find((person) => person.id === id) || null : null;
}

// 個人頁（全頁）：原本展開區的內容，加上「關心提醒」／「提醒加入」
function openPerson(id, opener) {
  if (!findPerson(id)) return;
  view.personId = id;
  openLayer("person", opener);
  renderPersonSheet();
}

function renderPersonSheet() {
  const host = document.querySelector("[data-pastoral-person-body]");
  const person = view.personId ? findPerson(view.personId) : null;
  if (!host || view.layer !== "person") return;
  if (!person) {
    closeLayer();
    return;
  }
  const title = $("pastoral-person-sheet-title");
  if (title) title.textContent = person.name || "（未填姓名）";
  const facts = [];
  if (person.enrolled) {
    facts.push(["進度", `第 ${person.round} 遍 ${person.progress}%・累計 ${person.chapters} 章`]);
    facts.push(["落後", person.behindDays >= 2 ? `${person.behindDays} 天` : "沒有落後"]);
    facts.push(["最後打卡", lastReadText(person)]);
    facts.push(["近 7 天", `${person.readDays7} 天有讀`]);
    facts.push(["團隊", person.teams.length ? person.teams.map(teamLabel).join("、") : "未組隊"]);
    if (quizFeatureEnabled !== false && person.quiz.published > 0) facts.push(["小測驗", `作答 ${person.quiz.submitted}／${person.quiz.published} 次`]);
    if (person.care) facts.push(["需要關心", person.careReasons.map(careReasonText).join("、")]);
  }
  const invited = view.invited.has(person.id);
  const late = lateText(person);
  const action = person.enrolled
    ? `<button type="button" class="primary-btn" data-pastoral-action="care" data-person="${esc(person.id)}">
        <span class="nlc-icon nlc-icon--sm" data-icon="remind" aria-hidden="true"></span><span>關心提醒</span>
      </button>`
    : `<button type="button" class="primary-btn" data-pastoral-action="invite" data-person="${esc(person.id)}"${invited ? " disabled" : ""}>${invited ? "已提醒" : "提醒加入"}</button>`;
  host.innerHTML = `
    <section class="pastoral-card pastoral-person">
      <div class="pastoral-person__head">
        <span class="pastoral-person__org">${esc(orgLine(person))}</span>
        <span class="pastoral-person__badges">
          <span class="pastoral-badge ${STATUS_BADGE[person.status] || ""}">${esc(person.statusLabel)}</span>
          ${late ? `<span class="pastoral-row__late">${esc(late)}</span>` : ""}
        </span>
      </div>
      ${facts.length ? `<dl class="pastoral-person__facts">${facts.map(([term, value]) => `<dt>${esc(term)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>` : '<p class="pastoral-card__hint">還沒報名這個計畫。</p>'}
      <div class="pastoral-person__actions">${action}</div>
    </section>`;
  hydrate(host);
}

// 關心提醒：同一人一天一則、送出後唯讀（#574）；伺服器檢查範圍並記稽核（#570）
function openCare(id) {
  const person = findPerson(id);
  if (!person || !currentPlan || typeof window.openCareReminderDialog !== "function") return;
  const behind = person.behindDays >= 2;
  void window.openCareReminderDialog({
    id: person.id,
    name: person.name,
    statusStr: person.statusLabel,
    statusColor: behind ? "var(--color-danger)" : "var(--color-brand)",
    progressText: `累計 ${person.chapters} 章`,
    isBehind: behind,
    isNotStarted: person.chapters === 0 || (person.daysSinceRead ?? 0) >= CARE_THRESHOLDS.noCheckInDays,
    carePlanKey: String(currentPlan.presetKey || currentPlan.globalPlanId || "")
  });
}

async function inviteOne(button) {
  const plan = currentPlan;
  const id = button.dataset.person;
  if (!plan || !id || view.invited.has(id) || !window.db) return;
  button.disabled = true;
  const result = await window.db.sendPlanJoinInvitation(plan, id).catch(() => null);
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
  const plan = currentPlan;
  if (!plan || !window.db) return;
  const members = rosterRows().filter((person) => !person.enrolled && !view.invited.has(person.id))
    .map((person) => ({ id: person.id, name: person.name }));
  if (!members.length) {
    toast("沒有要提醒的人。");
    return;
  }
  if (!window.confirm(`要提醒 ${members.length} 位還沒報名的人加入「${plan.name || "這個計畫"}」嗎？`)) return;
  button.disabled = true;
  const label = button.textContent;
  try {
    const summary = await sendBulkPlanInvitations({
      members,
      plan,
      sendInvitation: (target, id) => window.db.sendPlanJoinInvitation(target, id),
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
  if (!el || !currentRoster()) return;
  const summary = summarizeTeams(scopedRoster());
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
  if (!el || !currentRoster()) return;
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
  const people = scopedRoster();
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
    ${units.length ? `<div class="pastoral-stack">
      <p class="pastoral-filters__label">各${SCOPE_LEVEL_LABEL[level]}作答率</p>
      <ul class="pastoral-units">${units.map((unit) => unitItem({
        name: unit.name,
        size: `有發題 ${unit.eligible} 人`,
        pct: unit.rate,
        note: `從沒作答 ${unit.neverAnswered.length} 人`,
        alert: unit.neverAnswered.length > 0
      })).join("")}</ul>
    </div>` : ""}
    ${summary.neverAnswered.length ? `<p class="pastoral-names">從沒作答：${namesLine(summary.neverAnswered)}</p>` : ""}`;
  paintBars(body);
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
