// js/modules/lightning-quiz-vouchers.mjs
// 個人頁「我的兌換券」（#445）。管理員公布雲柱測驗英雄榜（每週每天前三名，#429）時，
// 伺服器自動發給得獎者克勞斯抵用券：每一天的每個名次各一張，公布後 30 天內有效。
// 兌換流程：在店裡出示這張券，店員看過後由本人按「確認兌換」，券就變成已兌換、不能再用。
// 這一頁也是得獎證明：首頁英雄榜撤下後，得獎紀錄還留在這裡。

import { formatRankLabel, formatVoucherTime, formatWeekday } from "./lightning-quiz-analytics.mjs";

const STATUS_BADGES = {
  available: '<span class="stat-badge stat-badge--success">可使用</span>',
  redeemed: '<span class="stat-badge stat-badge--neutral">已兌換</span>',
  expired: '<span class="stat-badge stat-badge--neutral">已過期</span>'
};

// 可使用的放上面（快到期的在前）；已兌換／已過期的放下面（新的在前）。作廢的伺服器不會回傳。
export function splitVouchers(vouchers) {
  const list = Array.isArray(vouchers) ? vouchers.filter(v => v && v.status !== "void") : [];
  const usable = list.filter(v => v.status === "available")
    .sort((a, b) => String(a.expiresOn).localeCompare(String(b.expiresOn)) || String(a.riseDate).localeCompare(String(b.riseDate)));
  const past = list.filter(v => v.status !== "available")
    .sort((a, b) => String(b.riseDate).localeCompare(String(a.riseDate)) || Number(a.rank) - Number(b.rank));
  return { usable, past };
}

function voucherMetaText(voucher) {
  if (voucher.status === "redeemed") {
    const when = formatVoucherTime(voucher.redeemedAt);
    return when ? `已於 ${when} 兌換` : "已兌換";
  }
  if (voucher.status === "expired") return `已於 ${formatWeekday(voucher.expiresOn)} 到期`;
  return `有效期限至 ${formatWeekday(voucher.expiresOn)}`;
}

export function voucherCardHtml(voucher) {
  const amount = Number(voucher.amount) || 100;
  const status = STATUS_BADGES[voucher.status] ? voucher.status : "expired";
  return `<article class="lq-voucher lq-voucher--${status}">
    <div class="lq-voucher__head">
      <span class="nlc-icon lq-voucher__icon" data-icon="ticket" aria-hidden="true"></span>
      <div class="lq-voucher__title">
        <strong>克勞斯 ${escapeHTML(String(amount))} 元抵用券</strong>
        <span>雲柱測驗英雄榜・${escapeHTML(formatWeekday(voucher.riseDate))}${escapeHTML(formatRankLabel(voucher.rank))}</span>
      </div>
      ${STATUS_BADGES[status]}
    </div>
    <dl class="lq-voucher__fields">
      <div><dt>得獎者</dt><dd>${escapeHTML(voucher.name || "")}${voucher.pastoralZone ? `<span>${escapeHTML(voucher.pastoralZone)}</span>` : ""}</dd></div>
      <div><dt>兌換碼</dt><dd class="lq-voucher__code">${escapeHTML(voucher.code || "")}</dd></div>
    </dl>
    <p class="lq-voucher__meta">${escapeHTML(voucherMetaText(voucher))}</p>
    ${status === "available" ? `<button type="button" class="primary-btn lq-voucher__redeem" data-voucher-redeem="${escapeHTML(String(voucher.id))}">確認兌換</button>` : ""}
  </article>`;
}

export function renderVoucherListHtml(vouchers) {
  const { usable, past } = splitVouchers(vouchers);
  if (!usable.length && !past.length) {
    return '<div class="profile-exams__empty">目前沒有兌換券。雲柱測驗英雄榜公布後，得獎的券會出現在這裡。</div>';
  }
  const section = (title, items, empty) => `<section class="profile-exams__group">
    <h4>${title} <span>${items.length} 張</span></h4>
    ${items.length ? `<div class="lq-voucher__list">${items.map(voucherCardHtml).join("")}</div>` : `<div class="profile-exams__empty">${empty}</div>`}
  </section>`;
  return section("可使用", usable, "目前沒有可使用的兌換券。")
    + (past.length ? section("已使用／已過期", past, "") : "");
}

let lastVouchers = [];
const redeeming = new Set();

export async function refreshMyLightningQuizVouchers() {
  const host = document.getElementById("profile-vouchers-list");
  if (!host) return;
  if (typeof db === "undefined" || typeof db.getMyLightningQuizVouchers !== "function") {
    host.innerHTML = '<div class="profile-exams__empty">目前無法載入兌換券。</div>';
    return;
  }
  if (!host.childElementCount) host.innerHTML = '<div class="profile-exams__loading">正在整理你的兌換券…</div>';
  const result = await db.getMyLightningQuizVouchers();
  if (!result.success) {
    host.innerHTML = `<div class="profile-exams__empty">${escapeHTML(result.message || "目前無法載入兌換券，請稍後再試。")}</div>`;
    return;
  }
  lastVouchers = Array.isArray(result.data?.vouchers) ? result.data.vouchers : [];
  host.innerHTML = renderVoucherListHtml(lastVouchers);
  if (typeof hydrateIcons === "function") hydrateIcons(host);
}

async function redeemVoucher(voucherId, button) {
  if (redeeming.has(voucherId)) return;
  const voucher = lastVouchers.find(v => String(v.id) === voucherId);
  const confirmed = await window.showConfirmDialog({
    title: "確認兌換這張抵用券？",
    message: `${voucher ? `${formatWeekday(voucher.riseDate)}${formatRankLabel(voucher.rank)}・兌換碼 ${voucher.code}。` : ""}請在克勞斯店員面前按「確認兌換」，兌換後這張券就不能再使用。`,
    confirmText: "確認兌換",
    cancelText: "取消"
  });
  if (!confirmed) return;
  redeeming.add(voucherId);
  if (button) button.disabled = true;
  try {
    const result = await db.redeemMyLightningQuizVoucher(voucherId);
    if (!result.success) {
      window.showToast?.(result.message || "兌換失敗，請稍後再試。");
      if (button) button.disabled = false;
    } else {
      window.showToast?.("已兌換，請把畫面給店員看。");
    }
  } finally {
    redeeming.delete(voucherId);
  }
  await refreshMyLightningQuizVouchers();
}

// 子頁的點擊只綁一次，清單重繪不影響。
export function bindMyVouchersPage() {
  const root = document.getElementById("profile-tab-content-vouchers");
  if (!root || root.dataset.vouchersBound === "true") return;
  root.dataset.vouchersBound = "true";
  root.addEventListener("click", event => {
    const redeem = event.target.closest("[data-voucher-redeem]");
    if (redeem) { void redeemVoucher(redeem.dataset.voucherRedeem, redeem); return; }
    if (event.target.closest("#profile-vouchers-refresh")) void refreshMyLightningQuizVouchers();
  });
}
