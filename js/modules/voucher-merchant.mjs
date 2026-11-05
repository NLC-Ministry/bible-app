// js/modules/voucher-merchant.mjs
// 個人頁「克勞斯兌換紀錄」（#679）：後台指定的店家帳號查看雲柱測驗抵用券。只能看，核銷仍由得獎者本人按。
// 入口只在打開個人頁時判斷（5 分鐘內不重查），查不到（一般會友、migration／nlc-data 還沒部署）就是沒有入口，
// 不跳任何提示。權限在伺服器每次重查，這裡的入口只是顯示；被拒絕時立刻把入口收掉。

import { formatRankLabel, formatVoucherTime, formatWeekday } from "./lightning-quiz-analytics.mjs";

const ENTRY_RECHECK_MS = 5 * 60 * 1000;
const STATUS_KEYS = ["all", "available", "redeemed", "expired"];
const STATUS_BADGE_KIND = { available: "success", redeemed: "brand", expired: "neutral" };

// 同 _lightning_quiz_voucher_code：6 碼，不含 0/O、1/I/L。
const VOUCHER_CODE_RE = /^[A-HJKMNP-Z2-9]{6}$/;

const copy = () => window.APP_COPY.voucherMerchant;
const fill = (template, values) => Object.entries(values).reduce(
  (text, [key, value]) => text.replace(`{${key}}`, String(value)),
  template
);

export function normalizeVoucherCode(value) {
  return String(value ?? "").replace(/[\s-]/g, "").toUpperCase();
}

export function isValidVoucherCode(code) {
  return VOUCHER_CODE_RE.test(code);
}

// 「2026-11」→「2026 年 11 月」
export function formatMerchantMonth(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : "";
}

// 已作廢的伺服器本來就不回，這裡再擋一次，畫面絕對不出現。
export function visibleMerchantVouchers(vouchers) {
  return Array.isArray(vouchers) ? vouchers.filter(v => v && STATUS_BADGE_KIND[v.status]) : [];
}

export function countMerchantVouchers(vouchers) {
  const counts = { all: 0, available: 0, redeemed: 0, expired: 0 };
  for (const voucher of visibleMerchantVouchers(vouchers)) {
    counts.all += 1;
    counts[voucher.status] += 1;
  }
  return counts;
}

export function filterMerchantVouchers(vouchers, status) {
  const list = visibleMerchantVouchers(vouchers);
  return status && status !== "all" ? list.filter(v => v.status === status) : list;
}

function statusLabel(status) {
  const t = copy();
  return {
    all: t.statusAll,
    available: t.statusAvailable,
    redeemed: t.statusRedeemed,
    expired: t.statusExpired
  }[status] || "";
}

// 只畫白名單欄位：兌換碼、姓名、哪天第幾名、面額、狀態、兌換時間與方式、期限。沒有核銷按鈕。
export function merchantVoucherCardHtml(voucher) {
  const t = copy();
  const status = STATUS_BADGE_KIND[voucher.status] ? voucher.status : "expired";
  const via = voucher.redeemedVia === "admin" ? t.viaAdmin : t.viaSelf;
  const redeemedAt = status === "redeemed"
    ? `<div><dt>${escapeHTML(t.fieldRedeemedAt)}</dt><dd>${escapeHTML([formatVoucherTime(voucher.redeemedAt), via].filter(Boolean).join("・"))}</dd></div>`
    : "";
  return `<article class="lq-voucher lq-voucher--${status}" data-merchant-voucher="${escapeHTML(String(voucher.code || ""))}">
    <div class="voucher-merchant__card-head">
      <span class="lq-voucher__code" aria-label="${escapeHTML(`${t.fieldCode} ${voucher.code || ""}`)}">${escapeHTML(String(voucher.code || ""))}</span>
      <span class="stat-badge stat-badge--${STATUS_BADGE_KIND[status]}">${escapeHTML(statusLabel(status))}</span>
    </div>
    <dl class="voucher-merchant__fields">
      <div><dt>${escapeHTML(t.fieldName)}</dt><dd>${escapeHTML(voucher.name || "")}</dd></div>
      <div><dt>${escapeHTML(t.fieldAward)}</dt><dd>${escapeHTML(`${formatWeekday(voucher.riseDate)}${formatRankLabel(voucher.rank)}`)}</dd></div>
      <div><dt>${escapeHTML(t.fieldAmount)}</dt><dd>${escapeHTML(fill(t.amountValue, { amount: Number(voucher.amount) || 0 }))}</dd></div>
      <div><dt>${escapeHTML(t.fieldExpiresOn)}</dt><dd>${escapeHTML(formatWeekday(voucher.expiresOn))}</dd></div>
      ${redeemedAt}
    </dl>
  </article>`;
}

const noAccessCodes = ["voucher_merchant_required", "forbidden_rpc"];
function isNoAccess(result) {
  const raw = String(result?.error?.message || result?.error?.error || result?.error || "");
  return noAccessCodes.some(code => raw.includes(code));
}

let entryCheckedAt = 0;
let entryVisible = false;
let pageData = null;
let selectedMonth = null;
let selectedStatus = "all";
let requestSeq = 0;
let lookupSeq = 0;

const el = id => document.getElementById(id);

function setEntryVisible(visible) {
  entryVisible = visible;
  el("profile-voucher-merchant-entry")?.classList.toggle("hidden", !visible);
}

// 查不到時保留上次知道的結果：暫時的網路問題不要讓店家的入口消失。
export async function refreshVoucherMerchantEntry({ force = false } = {}) {
  if (!force && entryCheckedAt && Date.now() - entryCheckedAt < ENTRY_RECHECK_MS) {
    setEntryVisible(entryVisible);
    return entryVisible;
  }
  if (typeof db === "undefined" || typeof db.getVoucherMerchantAccess !== "function") {
    setEntryVisible(false);
    return false;
  }
  entryCheckedAt = Date.now();
  const result = await db.getVoucherMerchantAccess();
  setEntryVisible(result?.success ? result.isMerchant === true : entryVisible);
  return entryVisible;
}

function renderFilters() {
  const t = copy();
  const host = el("voucher-merchant-filters");
  if (!host) return;
  const months = Array.isArray(pageData?.months) ? pageData.months : [];
  const month = pageData?.month || selectedMonth || "";
  const counts = countMerchantVouchers(pageData?.vouchers);
  host.innerHTML = `
    <label class="voucher-merchant__month">${escapeHTML(t.monthLabel)}
      <select class="form-control" data-merchant-month>
        ${months.map(value => `<option value="${escapeHTML(value)}"${value === month ? " selected" : ""}>${escapeHTML(formatMerchantMonth(value))}</option>`).join("")}
      </select>
    </label>
    <div class="capsule-segmented-control segment-track" role="group" aria-label="${escapeHTML(t.statusGroupLabel)}">
      ${STATUS_KEYS.map(key => {
        const active = key === selectedStatus;
        return `<button type="button" class="segment-toggle-btn${active ? " active" : ""}" data-merchant-status="${key}" aria-pressed="${active}">${escapeHTML(statusLabel(key))} ${counts[key]}</button>`;
      }).join("")}
    </div>`;
}

function renderSummary() {
  const t = copy();
  const host = el("voucher-merchant-summary");
  if (!host) return;
  const summary = pageData?.summary || {};
  host.innerHTML = `<section class="voucher-merchant__summary" aria-label="${escapeHTML(fill(t.summaryTitle, { month: formatMerchantMonth(pageData?.month) }))}">
    <span class="voucher-merchant__summary-title">${escapeHTML(fill(t.summaryTitle, { month: formatMerchantMonth(pageData?.month) }))}</span>
    <span class="voucher-merchant__summary-value">${escapeHTML(fill(t.summaryValue, { count: Number(summary.redeemedCount) || 0, amount: Number(summary.redeemedAmount) || 0 }))}</span>
    <span class="voucher-merchant__summary-hint">${escapeHTML(t.summaryHint)}</span>
  </section>`;
}

function renderList() {
  const t = copy();
  const host = el("voucher-merchant-list");
  if (!host) return;
  const items = filterMerchantVouchers(pageData?.vouchers, selectedStatus);
  const truncated = pageData?.truncated ? `<p class="voucher-merchant__message">${escapeHTML(t.truncated)}</p>` : "";
  host.innerHTML = items.length
    ? `<div class="lq-voucher__list">${items.map(merchantVoucherCardHtml).join("")}</div>${truncated}`
    : `<div class="profile-exams__empty">${escapeHTML(t.emptyMonth)}</div>${truncated}`;
}

function renderPage() {
  renderSummary();
  renderFilters();
  renderList();
}

function clearPageData() {
  pageData = null;
  const summary = el("voucher-merchant-summary");
  if (summary) summary.innerHTML = "";
  const filters = el("voucher-merchant-filters");
  if (filters) filters.innerHTML = "";
}

function showPageMessage(message) {
  clearPageData();
  const host = el("voucher-merchant-list");
  if (host) host.innerHTML = `<div class="profile-exams__empty">${escapeHTML(message)}</div>`;
}

// 被移除的帳號：收掉入口，清掉畫面上已經載入的資料。
function revokeAccess() {
  setEntryVisible(false);
  entryCheckedAt = Date.now();
  const result = el("voucher-merchant-lookup-result");
  if (result) result.innerHTML = "";
  showPageMessage(copy().noAccess);
}

export async function refreshVoucherMerchantPage() {
  const t = copy();
  const host = el("voucher-merchant-list");
  if (!host) return;
  if (typeof db === "undefined" || typeof db.getVoucherMerchantVouchers !== "function") {
    showPageMessage(t.loadFail);
    return;
  }
  const seq = ++requestSeq;
  if (!pageData) host.innerHTML = `<div class="profile-exams__loading">${escapeHTML(t.loading)}</div>`;
  const result = await db.getVoucherMerchantVouchers(selectedMonth);
  if (seq !== requestSeq) return;
  if (!result?.success) {
    if (isNoAccess(result)) revokeAccess();
    else showPageMessage(result?.message || t.loadFail);
    return;
  }
  pageData = result.data || {};
  selectedMonth = pageData.month || selectedMonth;
  renderPage();
  if (typeof hydrateIcons === "function") hydrateIcons(host);
}

async function submitLookup() {
  const t = copy();
  const resultHost = el("voucher-merchant-lookup-result");
  const input = el("voucher-merchant-code");
  if (!resultHost || !input) return;
  const message = text => `<p class="voucher-merchant__message">${escapeHTML(text)}</p>`;
  const code = normalizeVoucherCode(input.value);
  // 格式不對就不送：伺服器也不查，只是少一個請求。
  if (!isValidVoucherCode(code)) {
    lookupSeq += 1;
    resultHost.innerHTML = message(t.lookupInvalid);
    return;
  }
  const seq = ++lookupSeq;
  const submit = el("voucher-merchant-lookup-submit");
  if (submit) submit.disabled = true;
  resultHost.innerHTML = message(t.lookupBusy);
  try {
    const result = await db.lookupVoucherMerchantCode(code);
    if (seq !== lookupSeq) return;
    if (!result?.success) {
      if (isNoAccess(result)) revokeAccess();
      else resultHost.innerHTML = message(t.lookupFail);
      return;
    }
    const data = result.data || {};
    if (data.rateLimited) resultHost.innerHTML = message(t.lookupRateLimited);
    else if (data.found && data.voucher) {
      resultHost.innerHTML = `<div class="voucher-merchant__lookup-result">${merchantVoucherCardHtml(data.voucher)}</div>`;
    } else resultHost.innerHTML = message(t.lookupNotFound);
  } finally {
    if (submit) submit.disabled = false;
  }
}

// 子頁的事件只綁一次，內容重繪不影響。
export function bindVoucherMerchantPage() {
  const root = el("profile-tab-content-voucher-merchant");
  if (!root || root.dataset.merchantBound === "true") return;
  root.dataset.merchantBound = "true";
  root.addEventListener("click", event => {
    const statusButton = event.target.closest("[data-merchant-status]");
    if (statusButton) {
      selectedStatus = STATUS_KEYS.includes(statusButton.dataset.merchantStatus) ? statusButton.dataset.merchantStatus : "all";
      renderFilters();
      renderList();
      return;
    }
    if (event.target.closest("#profile-voucher-merchant-refresh")) void refreshVoucherMerchantPage();
  });
  root.addEventListener("change", event => {
    if (!event.target.matches("[data-merchant-month]")) return;
    selectedMonth = event.target.value || null;
    void refreshVoucherMerchantPage();
  });
  root.addEventListener("submit", event => {
    if (event.target.id !== "voucher-merchant-lookup") return;
    event.preventDefault();
    void submitLookup();
  });
}
